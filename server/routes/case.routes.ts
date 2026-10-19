import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { caseService } from "../services/case.service";
import { courtFormService, type CourtFormType } from "../services/court-form.service";
import { notificationService } from "../services/notification.service";
import { recordIntakeFirstContact, recordDynamicIntakeFirstContact } from "../services/intake-first-contact.service";
import { completeIntakeChase } from "../services/intake-chase.service";
import { completeDynamicIntakeFollowUp } from "../services/intake-dynamic-follow-up.service";
import { canReadIntakeWorkflowTasks, listIntakeWorkflowTasks } from "../services/intake-workflow-query.service";
import {
  intakeStatusAfterSafeguardingClear,
  isIntakeAdminRole,
  validateIntakeWorker,
  validateSafeguardingWorker,
} from "../services/intake-access-policy";
import { logAudit } from "../services/audit-log.service";
import { caseActivityService, staffActor } from "../services/case-activity.service";
import { financialDisclosureService } from "../services/financial-disclosure.service";
import { mediationSessionService } from "../services/mediation-session.service";
import { caseLeadMediatorService } from "../services/case-lead-mediator.service";
import { sendCaseClosureThankYouEmail, sendCaseFollowUpConsentRequestEmail, sendSafeguardingRebeccaNotificationEmail } from "../services/email.service";
import { isClientDemographicComplete } from "../utils/demographic-completion";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";
import type { PaginationParams, User, ConfidentialNote, CaseFilters, Case, MediationCategory } from "@shared/schema";
import {
  CASE_CLOSURE_REASONS, CASE_STAGES, CONFIDENTIAL_NOTE_CATEGORIES, ENQUIRY_CONTACT_METHODS,
  MEDIATION_CATEGORIES, FAMILY_CASE_SUBTYPES, WORKPLACE_CASE_SUBTYPES, CIVIL_CASE_SUBTYPES,
  COMMERCIAL_CASE_SUBTYPES, OTHER_CASE_SUBTYPES,
  CASE_CIM_CONSENT_STATUSES, caseClosurePayloadSchema, caseFiltersSchema, cases, enquiries, mediationSessionProposals, notifications,
} from "@shared/schema";

interface AuthenticatedRequest extends Request {
  user: User;
}

function getUser(req: Request): User {
  return (req as AuthenticatedRequest).user;
}

function parsePaginationParams(query: Record<string, string | undefined>): PaginationParams {
  const sortOrder = query.sortOrder === "asc" ? "asc" as const : query.sortOrder === "desc" ? "desc" as const : undefined;
  return {
    page: Math.max(1, parseInt(query.page || "1") || 1),
    limit: Math.min(100, Math.max(1, parseInt(query.limit || "20") || 20)),
    search: query.search || undefined,
    status: query.status || undefined,
    sortBy: query.sortBy || undefined,
    sortOrder,
  };
}

const router = Router();
const INTAKE_PERSISTENT_FOLLOW_UP_TYPE = "enquiry_persistent_follow_up";
const CASE_CLOSURE_FOLLOW_UP_TASK_TYPE = "case_closure_follow_up";
const CASE_CLOSURE_FOLLOW_UP_OFFSETS = [
  { label: "two-week", title: "Two-week follow-up", days: 14 },
  { label: "one-month", title: "One-month follow-up", months: 1 },
  { label: "three-month", title: "Three-month follow-up", months: 3 },
] as const;

function hashFollowUpConsentToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function addClosureFollowUpOffset(base: Date, offset: { days?: number; months?: number }): Date {
  const due = new Date(base);
  if (offset.days) due.setDate(due.getDate() + offset.days);
  if (offset.months) due.setMonth(due.getMonth() + offset.months);
  return due;
}

async function collectSensitiveCaseMediatorRecipientIds(caseRecord: Case, actorId?: string): Promise<string[]> {
  const sessions = await storage.listMediationSessionsByCase(caseRecord.id);
  const participants = await storage.listMediationSessionParticipantsBySessionIds(sessions.map((session) => session.id));
  const sensitiveCaseMediatorRecipientIds = new Set<string>();

  if (caseRecord.mediatorId) sensitiveCaseMediatorRecipientIds.add(caseRecord.mediatorId);
  for (const session of sessions) {
    if (session.leadMediatorId) sensitiveCaseMediatorRecipientIds.add(session.leadMediatorId);
  }
  for (const participant of participants) {
    if (
      participant.invitationStatus === "accepted" &&
      (participant.role === "lead_mediator" || participant.role === "co_mediator")
    ) {
      sensitiveCaseMediatorRecipientIds.add(participant.userId);
    }
  }

  if (actorId) sensitiveCaseMediatorRecipientIds.delete(actorId);
  return Array.from(sensitiveCaseMediatorRecipientIds);
}

async function notifySensitiveCaseAudience(input: {
  caseRecord: Case;
  actor: User;
  type: string;
  urgency: string;
  title: string;
  message: string;
}): Promise<void> {
  const { caseRecord, actor, type, urgency, title, message } = input;

  await notificationService.createNotification({
    recipientRole: "admin",
    type,
    urgency,
    caseId: caseRecord.id,
    title,
    message,
    status: "active",
    caseNoteRequired: false,
  });

  const mediatorRecipientIds = await collectSensitiveCaseMediatorRecipientIds(caseRecord, actor.id);
  await Promise.all(mediatorRecipientIds.map((recipientId) => notificationService.createNotification({
    recipientId,
    recipientRole: "mediator",
    type,
    urgency,
    caseId: caseRecord.id,
    title,
    message,
    status: "active",
    caseNoteRequired: false,
  })));
}

async function completeOpenIntakeFollowUpTasks(caseId: string, user: User, closureReason: string): Promise<void> {
  const completionNotes = `Intake closed: ${closureReason}`;
  const completedAt = new Date();
  await db.update(notifications)
    .set({
      status: "completed",
      completedBy: user.id,
      completedAt,
      completionNotes,
    })
    .where(and(
      eq(notifications.caseId, caseId),
      inArray(notifications.type, ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up"]),
      inArray(notifications.status, ["active", "in_progress", "follow_up"]),
    ));
}

async function createCaseClosureFollowUpTasks(
  caseRecord: Case,
  partyRows: Array<{ partyId: string; role: string; firstName: string; lastName: string; consentStatus: string }>,
): Promise<void> {
  const base = new Date();
  for (const party of partyRows.filter((row) => row.consentStatus === "granted")) {
    const clientName = `${party.firstName} ${party.lastName}`.trim() || `Client ${party.role}`;
    for (const offset of CASE_CLOSURE_FOLLOW_UP_OFFSETS) {
      await notificationService.createNotification({
        recipientRole: "admin",
        type: CASE_CLOSURE_FOLLOW_UP_TASK_TYPE,
        urgency: "green",
        caseId: caseRecord.id,
        appointmentId: null,
        title: `${offset.title}: ${caseRecord.caseRef}`,
        message: `Phone ${clientName} for the ${offset.label} post-closure follow-up. If there is no answer, send the online form link by email.`,
        status: "active",
        followUpDate: addClosureFollowUpOffset(base, offset),
        caseNoteRequired: false,
      });
    }
  }
}

async function getValidCaseFollowUpConsent(token: string): Promise<
  | { ok: true; row: Awaited<ReturnType<typeof storage.getCaseFollowUpConsentByTokenHash>> & {} }
  | { ok: false; status: number; message: string }
> {
  const row = await storage.getCaseFollowUpConsentByTokenHash(hashFollowUpConsentToken(token));
  if (!row) return { ok: false, status: 404, message: "Consent link not found" };
  if (row.consentStatus === "granted") return { ok: false, status: 400, message: "Follow-up consent has already been recorded" };
  if (!row.followUpConsentTokenExpiresAt || new Date(row.followUpConsentTokenExpiresAt) < new Date()) {
    return { ok: false, status: 400, message: "Consent link has expired" };
  }
  return { ok: true, row };
}

function parseFiltersFromQuery(query: Record<string, unknown>): CaseFilters {
  const arr = (v: unknown): string[] | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (Array.isArray(v)) return v.map(String).filter((s) => s.length > 0);
    return String(v).split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  };
  const str = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length > 0 ? s : undefined;
  };
  const bool = (v: unknown): boolean | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    return undefined;
  };
  const raw = {
    search: str(query.search),
    statuses: arr(query.statuses),
    stages: arr(query.stages),
    mediationCategories: arr(query.mediationCategories),
    familySubTypes: arr(query.familySubTypes),
    workplaceSubTypes: arr(query.workplaceSubTypes),
    civilSubTypes: arr(query.civilSubTypes),
    commercialSubTypes: arr(query.commercialSubTypes),
    otherSubTypes: arr(query.otherSubTypes),
    assignedMediatorIds: arr(query.assignedMediatorIds),
    miamMediatorIds: arr(query.miamMediatorIds),
    fundingSources: arr(query.fundingSources),
    voucherStatuses: arr(query.voucherStatuses),
    inCourtStatuses: arr(query.inCourtStatuses),
    cafcassStatuses: arr(query.cafcassStatuses),
    cimEligible: bool(query.cimEligible),
    enquiryDateFrom: str(query.enquiryDateFrom),
    enquiryDateTo: str(query.enquiryDateTo),
    miamCompletedDateFrom: str(query.miamCompletedDateFrom),
    miamCompletedDateTo: str(query.miamCompletedDateTo),
    closureDateFrom: str(query.closureDateFrom),
    closureDateTo: str(query.closureDateTo),
  };
  // Drop undefined keys then parse with strict schema.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) cleaned[k] = v;
  const parsed = caseFiltersSchema.safeParse(cleaned);
  if (!parsed.success) {
    const err = new Error("Invalid filter parameters");
    (err as Error & { status?: number; issues?: unknown }).status = 400;
    (err as Error & { status?: number; issues?: unknown }).issues = parsed.error.issues;
    throw err;
  }
  return parsed.data;
}

router.get("/api/cases", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const params = parsePaginationParams(req.query as Record<string, string | undefined>);
  let filters: CaseFilters;
  try {
    filters = parseFiltersFromQuery(req.query as Record<string, unknown>);
  } catch (e) {
    const err = e as Error & { status?: number; issues?: unknown };
    if (err.status === 400) return res.status(400).json({ message: err.message, issues: err.issues });
    throw e;
  }
  const result = await caseService.listCasesForUser(user, params, filters);
  return res.json(result);
});

router.get("/api/cases/lead-mediator-options", requirePermission("cases", "edit"), async (req, res) => {
  const user = getUser(req);
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only superadmins and subadmins can list case lead mediators" });
  }
  return res.json(await caseLeadMediatorService.listOptions());
});

router.get("/api/cases/follow-up-consent/:token", async (req, res) => {
  const result = await getValidCaseFollowUpConsent(req.params.token);
  if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
  return res.json({
    success: true,
    firstName: result.row.clientFirstName,
    caseRef: result.row.caseRef,
  });
});

router.post("/api/cases/follow-up-consent/:token", async (req, res) => {
  const result = await getValidCaseFollowUpConsent(req.params.token);
  if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
  const { row } = result;
  let scheduledTaskCount = 0;
  if (row.caseStatus === "Closed" && row.followUpTasksScheduled === 0) {
    const caseRecord = await storage.getCase(row.caseId);
    if (caseRecord) {
      await createCaseClosureFollowUpTasks(caseRecord, [{
        partyId: row.partyId,
        role: row.partyRole,
        firstName: row.clientFirstName,
        lastName: row.clientLastName,
        consentStatus: "granted",
      }]);
      scheduledTaskCount = CASE_CLOSURE_FOLLOW_UP_OFFSETS.length;
    }
  }
  await storage.recordCaseFollowUpConsentGranted(row.id, scheduledTaskCount, {
    followUpConsentTokenHash: null,
    followUpConsentTokenExpiresAt: null,
  });

  logAudit({
    userId: null,
    action: "case.follow_up_consent_recorded",
    entity: "case",
    entityId: row.caseId,
    entityRef: row.caseRef,
    details: JSON.stringify({ partyId: row.partyId, clientId: row.clientId, ip: req.ip || null, scheduledTaskCount }),
  });

  return res.json({ success: true, firstName: row.clientFirstName });
});

router.get("/api/cases/:id", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const result = await caseService.getCaseDetailForUser(req.params.id, user);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  // caseDetail includes miamValidity for court-form/package gating.
  return res.json(result.caseDetail);
});

const cimConsentPayloadSchema = z.object({
  status: z.enum(CASE_CIM_CONSENT_STATUSES),
  notes: z.string().max(5000).optional().nullable(),
});

const cimEligibilityPayloadSchema = z.object({
  cimEligible: z.boolean(),
});

const caseConfidentialPayloadSchema = z.object({
  confidential: z.boolean(),
});

const manualRevenuePayloadSchema = z.object({
  manualRevenuePence: z.number().int().min(0).nullable(),
});

function isAdminUser(user: Pick<User, "role">): boolean {
  return user.role === "superadmin" || user.role === "subadmin";
}

async function clearInvalidCimEligibility(caseId: string, user: User, ipAddress: string | undefined, reason: string): Promise<void> {
  const before = await storage.getCase(caseId);
  const cleared = await caseService.clearCimEligibilityIfNotReady(caseId);
  if (!before?.cimEligible || !cleared || cleared.cimEligible) return;
  await logAudit({
    userId: user.id,
    action: "case_cim_eligibility_updated",
    entity: "case",
    entityId: caseId,
    entityRef: cleared.caseRef,
    details: JSON.stringify({ cimEligible: false, reason }),
    ipAddress,
  });
  await caseActivityService.log({
    caseId,
    type: "note_added",
    title: "CIM eligibility cleared",
    description: `CIM eligibility was cleared because ${reason}.`,
    relatedEntityType: "case",
    metadata: JSON.stringify({ cimEligible: false, reason }),
    actor: staffActor(user),
  });
}

router.get("/api/cases/:id/cim-eligibility", requirePermission("cases", "view"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (user.role === "client") return res.status(403).json({ message: "Not authorised" });
  const readiness = await caseService.getCimReadiness(req.params.id);
  if (!readiness) return res.status(404).json({ message: "Case not found" });
  return res.json(readiness);
});

router.patch("/api/cases/:id/manual-revenue", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (user.role !== "superadmin") {
    return res.status(403).json({ message: "Only superadmins can update manual case revenue" });
  }

  const parsed = manualRevenuePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Manual revenue must be a non-negative amount in pence or null", issues: parsed.error.issues });
  }

  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  const updated = await storage.updateCaseManualRevenue(req.params.id, {
    manualRevenuePence: parsed.data.manualRevenuePence,
    updatedBy: user.id,
  });
  if (!updated) return res.status(404).json({ message: "Case not found" });

  await logAudit({
    userId: user.id,
    action: "case_manual_revenue_updated",
    entity: "case",
    entityId: req.params.id,
    entityRef: updated.caseRef,
    details: JSON.stringify({
      previousManualRevenuePence: existing.manualRevenuePence ?? null,
      manualRevenuePence: updated.manualRevenuePence ?? null,
    }),
    ipAddress: req.ip,
  });

  return res.json({
    manualRevenuePence: updated.manualRevenuePence,
    manualRevenueUpdatedAt: updated.manualRevenueUpdatedAt,
    manualRevenueUpdatedBy: updated.manualRevenueUpdatedBy,
  });
});

router.patch("/api/cases/:id/cim-consents/:partyId", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (!isAdminUser(user)) return res.status(403).json({ message: "Only superadmins and subadmins can record CIM consent" });
  const existingCase = await storage.getCase(req.params.id);
  if (!existingCase) return res.status(404).json({ message: "Case not found" });
  const party = await storage.getParty(req.params.partyId);
  if (!party || party.caseId !== req.params.id) return res.status(404).json({ message: "Party not found" });
  const formType = party.role.toUpperCase() === "A" ? "cf10" : party.role.toUpperCase() === "B" ? "cf12" : null;
  if (!formType) return res.status(400).json({ message: "Only Client A and Client B can have CIM parent consent recorded" });

  const parsed = cimConsentPayloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid CIM consent data", issues: parsed.error.issues });
  const consent = await storage.upsertCaseCimConsent({
    caseId: req.params.id,
    partyId: party.id,
    formType,
    status: parsed.data.status,
    recordedBy: user.id,
    recordedAt: new Date(),
    notes: parsed.data.notes?.trim().slice(0, 5000) || null,
  });

  await logAudit({
    userId: user.id,
    action: "case_cim_consent_updated",
    entity: "case",
    entityId: req.params.id,
    entityRef: existingCase.caseRef,
    details: JSON.stringify({ partyId: party.id, role: party.role, formType, status: consent.status }),
    ipAddress: req.ip,
  });
  await caseActivityService.log({
    caseId: req.params.id,
    type: "note_added",
    title: `${formType.toUpperCase()} consent ${consent.status}`,
    description: `${user.name} recorded ${formType.toUpperCase()} CIM consent for Client ${party.role} as ${consent.status}.`,
    relatedEntityType: "case",
    metadata: JSON.stringify({ partyId: party.id, role: party.role, formType, status: consent.status }),
    actor: staffActor(user),
  });

  await clearInvalidCimEligibility(req.params.id, user, req.ip, "parent consent is no longer complete");
  const readiness = await caseService.getCimReadiness(req.params.id);
  return res.json({ consent, readiness });
});

router.patch("/api/cases/:id/cim-eligibility", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (!isAdminUser(user)) return res.status(403).json({ message: "Only superadmins and subadmins can update CIM eligibility" });
  const parsed = cimEligibilityPayloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid CIM eligibility data", issues: parsed.error.issues });

  const existingCase = await storage.getCase(req.params.id);
  if (!existingCase) return res.status(404).json({ message: "Case not found" });
  const readiness = await caseService.getCimReadiness(req.params.id);
  if (!readiness) return res.status(404).json({ message: "Case not found" });
  if (parsed.data.cimEligible && !readiness.ready) {
    return res.status(409).json({ message: "CIM eligibility requirements are not complete", readiness });
  }

  const updated = await storage.updateCaseCimEligibility(req.params.id, { cimEligible: parsed.data.cimEligible, markedBy: user.id });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await logAudit({
    userId: user.id,
    action: "case_cim_eligibility_updated",
    entity: "case",
    entityId: req.params.id,
    entityRef: updated.caseRef,
    details: JSON.stringify({ cimEligible: updated.cimEligible }),
    ipAddress: req.ip,
  });
  await caseActivityService.log({
    caseId: req.params.id,
    type: "note_added",
    title: updated.cimEligible ? "CIM eligibility marked" : "CIM eligibility cleared",
    description: `${user.name} ${updated.cimEligible ? "marked this case as eligible for CIM" : "cleared the CIM eligibility flag"}.`,
    relatedEntityType: "case",
    metadata: JSON.stringify({ cimEligible: updated.cimEligible }),
    actor: staffActor(user),
  });

  const nextReadiness = await caseService.getCimReadiness(req.params.id);
  return res.json({ case: updated, readiness: nextReadiness });
});

router.patch("/api/cases/:id/mediator", requirePermission("cases", "edit"), async (req, res) => {
  const user = getUser(req);
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only superadmins and subadmins can update the lead mediator" });
  }

  const caseId = String(req.params.id);
  const existingCase = await storage.getCase(caseId);
  if (!existingCase) return res.status(404).json({ message: "Case not found" });

  const rawMediatorId = req.body?.mediatorId;
  if (rawMediatorId !== null && typeof rawMediatorId !== "string") {
    return res.status(400).json({ message: "mediatorId must be a user id or null" });
  }

  const mediatorId = rawMediatorId === "" ? null : rawMediatorId;
  let nextMediator: User | null = null;
  if (mediatorId) {
    nextMediator = (await storage.getUser(mediatorId) as User | undefined) || null;
    const isSelfSuperadmin = mediatorId === user.id && user.role === "superadmin";
    if (!isSelfSuperadmin) {
      const eligibility = await caseLeadMediatorService.validateAssignment(mediatorId);
      if (!eligibility.ok) return res.status(eligibility.status).json({ message: eligibility.error });
      nextMediator = eligibility.user;
    }
  }

  const previousMediator = existingCase.mediatorId
    ? (await storage.getUser(existingCase.mediatorId) as User | undefined)
    : undefined;
  const updated = await storage.updateCaseMediator(caseId, mediatorId);
  if (!updated) return res.status(404).json({ message: "Case not found" });

  const previousName = mediatorDisplayName(previousMediator);
  const nextName = mediatorDisplayName(nextMediator);

  await caseActivityService.log({
    caseId,
    type: "note_added",
    title: "Lead mediator updated",
    description: `${user.name} changed the lead mediator from ${previousName} to ${nextName}.`,
    actor: staffActor(user),
  });

  await logAudit({
    userId: user.id,
    action: "update",
    entity: "case",
    entityId: caseId,
    entityRef: existingCase.caseRef,
    details: JSON.stringify({
      field: "mediatorId",
      previousMediatorId: existingCase.mediatorId,
      nextMediatorId: mediatorId,
      previousMediatorName: previousName,
      nextMediatorName: nextName,
    }),
    ipAddress: req.ip,
  });

  if (nextMediator?.role === "mediator") {
    await notificationService.createNotification({
      recipientId: nextMediator.id,
      recipientRole: "mediator",
      type: "task_assigned",
      urgency: "green",
      caseId,
      title: `Lead mediator assigned — ${existingCase.caseRef}`,
      message: `${user.name} assigned you as the lead mediator for case ${existingCase.caseRef}.`,
      caseNoteRequired: false,
    });
  }

  const refreshed = await caseService.getCaseDetailForUser(caseId, user);
  return res.json(refreshed.ok ? refreshed.caseDetail : updated);
});

type ConfidentialNoteCategory = (typeof CONFIDENTIAL_NOTE_CATEGORIES)[number];

function isValidCategory(val: string): val is ConfidentialNoteCategory {
  return (CONFIDENTIAL_NOTE_CATEGORIES as readonly string[]).includes(val);
}

function isValidStage(val: string): boolean {
  return (CASE_STAGES as readonly string[]).includes(val);
}

function isValidContactMethod(val: string): boolean {
  return (ENQUIRY_CONTACT_METHODS as readonly string[]).includes(val);
}

function isValidClosureReason(val: string): boolean {
  return (CASE_CLOSURE_REASONS as readonly string[]).includes(val);
}

function isValidMediationCategory(val: string): val is MediationCategory {
  return (MEDIATION_CATEGORIES as readonly string[]).includes(val);
}

function subtypeOptionsForCategory(category: MediationCategory): readonly string[] {
  switch (category) {
    case "Family":
      return FAMILY_CASE_SUBTYPES;
    case "Workplace":
      return WORKPLACE_CASE_SUBTYPES;
    case "Civil":
      return CIVIL_CASE_SUBTYPES;
    case "Commercial":
      return COMMERCIAL_CASE_SUBTYPES;
    case "Other":
      return OTHER_CASE_SUBTYPES;
  }
}

function mediatorDisplayName(user: Pick<User, "name" | "email"> | null | undefined): string {
  return user?.name || user?.email || "Unassigned";
}

async function verifyCaseAccess(req: Request, res: Response, caseIdOverride?: string): Promise<boolean> {
  const user = getUser(req);
  const caseId = caseIdOverride ?? String(req.params.id);
  const access = await classifyCaseAccess(caseId, user);
  if (!hasFullOperationalCaseAccess(access)) {
    res.status(403).json({ message: "Not authorised" });
    return false;
  }
  return true;
}

async function verifyFullOperationalCaseAccess(req: Request, res: Response, caseIdOverride?: string): Promise<boolean> {
  return verifyCaseAccess(req, res, caseIdOverride);
}

async function updateCaseIntake(caseId: string, updates: Partial<Case>): Promise<Case | null> {
  const [updated] = await db
    .update(cases)
    .set({ ...updates, lastUpdated: new Date() })
    .where(eq(cases.id, caseId))
    .returning();
  if (updated && typeof updates.intakeStatus === "string") {
    await syncLinkedEnquiryStatus(caseId, updates.intakeStatus);
  }
  return updated || null;
}

async function syncLinkedEnquiryStatus(caseId: string, status: string): Promise<void> {
  await db
    .update(enquiries)
    .set({ status })
    .where(eq(enquiries.convertedCaseId, caseId));
}

async function syncLinkedEnquiryShuttle(caseId: string, shuttleMediation: boolean): Promise<void> {
  await db
    .update(enquiries)
    .set({ shuttleMediation })
    .where(eq(enquiries.convertedCaseId, caseId));
}

function isSafeguardingDecided(existing: Pick<Case, "safeguardingStatus">): boolean {
  return existing.safeguardingStatus === "clear" || existing.safeguardingStatus === "concern";
}

function isSafeguardingClear(existing: Pick<Case, "safeguardingStatus" | "standardChaseStopped">): boolean {
  return existing.safeguardingStatus === "clear" && !existing.standardChaseStopped;
}

function ensureSafeguardingClear(existing: Case, pendingMessage: string, concernMessage: string): { ok: true } | { ok: false; status: number; message: string } {
  if (!isSafeguardingDecided(existing)) {
    return { ok: false, status: 409, message: pendingMessage };
  }
  if (!isSafeguardingClear(existing)) {
    return { ok: false, status: 409, message: concernMessage };
  }
  return { ok: true };
}

router.patch("/api/cases/:id/stage", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { stage } = req.body;
  if (!stage || typeof stage !== "string") return res.status(400).json({ message: "Stage is required" });
  if (!isValidStage(stage)) return res.status(400).json({ message: "Invalid stage value" });
  const existing = await storage.getCase(req.params.id);
  const previousStage = existing?.stage || "Unknown";
  const updated = await storage.updateCaseStage(req.params.id, stage);
  if (!updated) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  logAudit({ userId: user.id, action: "update_stage", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ stage }) });
  caseActivityService.logStageChanged(req.params.id, updated.caseRef, previousStage, stage, staffActor(user)).catch(() => {});
  return res.json(updated);
});

router.patch("/api/cases/:id/confidential", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only admins can update case confidentiality" });
  }
  const parsed = caseConfidentialPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "confidential must be true or false", errors: parsed.error.flatten().fieldErrors });
  }
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  const updated = await storage.updateCaseConfidential(req.params.id, parsed.data.confidential);
  if (!updated) return res.status(404).json({ message: "Case not found" });
  if (existing.confidential !== updated.confidential) {
    await logAudit({
      userId: user.id,
      action: "case_confidentiality_updated",
      entity: "case",
      entityId: updated.id,
      entityRef: updated.caseRef,
      details: JSON.stringify({ from: existing.confidential, to: updated.confidential }),
    });
    await caseActivityService.log({
      caseId: updated.id,
      type: "case_confidentiality_updated",
      title: updated.confidential ? "Case marked confidential" : "Case confidentiality removed",
      description: updated.confidential
        ? "This case was manually marked confidential."
        : "The manual confidential marker was removed from this case.",
      relatedEntityType: "case",
      metadata: JSON.stringify({ from: existing.confidential, to: updated.confidential }),
      actor: staffActor(user),
    });
    if (updated.confidential) {
      await notifySensitiveCaseAudience({
        caseRecord: updated,
        actor: user,
        type: "case_confidentiality_updated",
        urgency: "amber",
        title: `Case marked confidential — ${updated.caseRef}`,
        message: `${user.name} marked case ${updated.caseRef} as confidential. Review the case before taking further action.`,
      });
    }
  }
  return res.json(updated);
});

router.patch("/api/cases/:id/notes", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { notes } = req.body;
  if (typeof notes !== "string") return res.status(400).json({ message: "Notes must be a string" });
  const trimmed = notes.trim().slice(0, 10000);
  const updated = await storage.updateCaseNotes(req.params.id, trimmed);
  if (!updated) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  logAudit({ userId: user.id, action: "update_notes", entity: "case", entityId: req.params.id, entityRef: updated.caseRef });
  return res.json(updated);
});

router.patch("/api/cases/:id/shuttle", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { shuttleMediation } = req.body;
  if (typeof shuttleMediation !== "boolean") return res.status(400).json({ message: "shuttleMediation must be true or false" });
  const updated = await storage.updateCaseShuttle(req.params.id, shuttleMediation);
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await syncLinkedEnquiryShuttle(req.params.id, shuttleMediation);
  const user = getUser(req);
  logAudit({ userId: user.id, action: "update_shuttle", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ shuttleMediation }) });
  return res.json(updated);
});

router.patch("/api/cases/:id/type", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (!["superadmin", "subadmin", "staff"].includes(user.role)) {
    return res.status(403).json({ message: "Only authorised staff can update the case type" });
  }

  const { mediationCategory, subType } = req.body;
  if (!mediationCategory || typeof mediationCategory !== "string") {
    return res.status(400).json({ message: "mediationCategory is required" });
  }
  if (!isValidMediationCategory(mediationCategory)) {
    return res.status(400).json({ message: "Invalid mediationCategory" });
  }
  if (!subType || typeof subType !== "string") {
    return res.status(400).json({ message: "subType is required" });
  }
  if (!subtypeOptionsForCategory(mediationCategory).includes(subType)) {
    return res.status(400).json({ message: "subType is not valid for the selected mediationCategory" });
  }

  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });

  const updated = await storage.updateCaseType(req.params.id, { mediationCategory, subType });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await financialDisclosureService.ensureFinancialDisclosureFoldersForCase(req.params.id, "case_type_update", user);
  if (!updated.mojVoucherEligible) {
    await db
      .update(mediationSessionProposals)
      .set({ voucherFormRequired: false })
      .where(eq(mediationSessionProposals.caseId, req.params.id));
  }

  await logAudit({
    userId: user.id,
    action: "update",
    entity: "case",
    entityId: req.params.id,
    entityRef: updated.caseRef,
    details: JSON.stringify({
      field: "caseType",
      previousMediationCategory: existing.mediationCategory,
      nextMediationCategory: mediationCategory,
      previousFamilySubType: existing.familySubType,
      previousWorkplaceSubType: existing.workplaceSubType,
      previousCivilSubType: existing.civilSubType,
      previousCommercialSubType: existing.commercialSubType,
      previousOtherSubType: existing.otherSubType,
      nextSubType: subType,
    }),
    ipAddress: req.ip,
  });

  return res.json(updated);
});

router.post("/api/cases/:caseId/parties/:partyId/follow-up-consent/send", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res, req.params.caseId))) return;
  const user = getUser(req);
  if (!["superadmin", "subadmin", "staff"].includes(user.role)) {
    return res.status(403).json({ success: false, message: "Only authorised staff can send follow-up consent requests" });
  }
  const caseRecord = await storage.getCase(req.params.caseId);
  if (!caseRecord) return res.status(404).json({ success: false, message: "Case not found" });
  if (caseRecord.status === "Archived") return res.status(400).json({ success: false, message: "Archived cases cannot send follow-up consent requests" });

  const partiesForCase = await storage.listPartiesByCase(req.params.caseId);
  const party = partiesForCase.find((row) => row.id === req.params.partyId);
  if (!party) return res.status(404).json({ success: false, message: "Party not found on this case" });
  if (!party.email) return res.status(400).json({ success: false, message: "No email address on record for this client" });

  const existingRows = await storage.listCaseClosurePartyFollowUps(req.params.caseId);
  const existing = existingRows.find((row) => row.partyId === req.params.partyId);
  if (existing && existing.consentStatus !== "pending") {
    return res.status(400).json({ success: false, message: "Follow-up consent has already been decided for this client" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashFollowUpConsentToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const consentUrl = `${baseUrl}/case-follow-up-consent/${token}`;
  const clientName = `${party.firstName} ${party.lastName}`.trim();

  let sent = false;
  let emailError: string | null = null;
  try {
    sent = await sendCaseFollowUpConsentRequestEmail(party.email, party.firstName, consentUrl, caseRecord.caseRef);
    if (!sent) emailError = "Email delivery failed";
  } catch (err) {
    emailError = err instanceof Error ? err.message : "Email delivery failed";
    console.error("[case.followUpConsent] email send failed:", err);
  }

  await storage.upsertCaseFollowUpConsentRequest({
    caseId: req.params.caseId,
    partyId: party.id,
    clientId: party.clientId,
    tokenHash,
    expiresAt,
    requestedBy: user.id,
    emailSent: sent,
    emailError,
  });

  await logAudit({
    userId: user.id,
    action: "case.follow_up_consent_request_sent",
    entity: "case",
    entityId: req.params.caseId,
    entityRef: caseRecord.caseRef,
    details: JSON.stringify({ partyId: party.id, clientId: party.clientId, sentTo: party.email, clientName, emailDelivered: sent }),
    ipAddress: req.ip,
  });

  if (!sent) return res.json({ success: true, emailSent: false, consentUrl });
  return res.json({ success: true, emailSent: true });
});

router.patch("/api/cases/:id/close", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (!["superadmin", "subadmin", "staff"].includes(user.role)) {
    return res.status(403).json({ message: "Only authorised staff can close cases" });
  }

  const parsed = caseClosurePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    const hasConsentIssue = parsed.error.issues.some(issue => issue.path.join(".") === "followUpConsentStatus");
    const hasReasonIssue = parsed.error.issues.some(issue => issue.path.join(".") === "closureReason");
    return res.status(400).json({
      message: hasReasonIssue
        ? "Closure reason is required"
        : hasConsentIssue
        ? "Follow-up consent decision is required"
        : parsed.error.issues[0]?.message || "Invalid closure data",
      issues: parsed.error.issues,
    });
  }

  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  if (existing.status === "Closed" || existing.status === "Archived") {
    return res.status(400).json({ message: "Closed or archived cases cannot be closed" });
  }

  const closureData = parsed.data;
  const partiesForCase = await storage.listPartiesByCase(req.params.id);
  const activePartyIds = new Set(partiesForCase.map((party) => party.id));
  const partyFollowUpConsents = closureData.partyFollowUpConsents ?? [];
  if (partyFollowUpConsents.length > 0) {
    const submittedPartyIds = new Set(partyFollowUpConsents.map((row) => row.partyId));
    const missingParties = partiesForCase.filter((party) => !submittedPartyIds.has(party.id));
    const invalidParties = partyFollowUpConsents.filter((row) => !activePartyIds.has(row.partyId));
    if (invalidParties.length > 0) {
      return res.status(400).json({ message: "Follow-up consent includes a party that is not active on this case" });
    }
    if (missingParties.length > 0) {
      return res.status(400).json({ message: "Follow-up consent decision is required for every active client" });
    }
  }
  const partyById = new Map(partiesForCase.map((party) => [party.id, party]));
  const existingPartyFollowUps = await storage.listCaseClosurePartyFollowUps(req.params.id);
  const existingPartyFollowUpByPartyId = new Map(existingPartyFollowUps.map((row) => [row.partyId, row]));
  const pendingWithoutEmailRequest = partyFollowUpConsents.some((row) => {
    if (row.consentStatus !== "pending") return false;
    const existingFollowUp = existingPartyFollowUpByPartyId.get(row.partyId);
    return !existingFollowUp?.followUpConsentRequestSentAt;
  });
  if (pendingWithoutEmailRequest) {
    return res.status(400).json({ message: "Pending follow-up consent requires a sent consent request" });
  }
  const persistedPartyFollowUpConsents = partyFollowUpConsents.map((row) => {
    const party = partyById.get(row.partyId);
    if (!party) throw new Error("Follow-up consent party not found");
    return {
      partyId: row.partyId,
      clientId: party.clientId,
      consentStatus: row.consentStatus,
      consentSource: row.source,
      exclusionReason: row.exclusionReason?.trim() || null,
      followUpTasksScheduled: row.consentStatus === "granted" ? CASE_CLOSURE_FOLLOW_UP_OFFSETS.length : 0,
    };
  });
  const trimmedDetails = closureData.closureDetails?.trim().slice(0, 10000) || null;
  const updated = await storage.updateCaseClosure(req.params.id, {
    closureReason: closureData.closureReason,
    closureDetails: trimmedDetails,
    followUpConsentStatus: closureData.followUpConsentStatus,
    lifeSatisfaction: closureData.lifeSatisfaction,
    anxietyScore: closureData.anxietyScore,
    serviceRating: closureData.serviceRating,
    netPromoterScore: closureData.netPromoterScore,
    closedById: user.id,
    ...(persistedPartyFollowUpConsents.length > 0 ? { partyFollowUpConsents: persistedPartyFollowUpConsents } : {}),
  });
  if (!updated) return res.status(404).json({ message: "Case not found" });

  if (persistedPartyFollowUpConsents.length > 0) {
    const consentByPartyId = new Map(persistedPartyFollowUpConsents.map((row) => [row.partyId, row.consentStatus]));
    await createCaseClosureFollowUpTasks(updated, partiesForCase.map((party) => ({
      partyId: party.id,
      role: party.role,
      firstName: party.firstName,
      lastName: party.lastName,
      consentStatus: consentByPartyId.get(party.id) || "excluded",
    })));
  }

  await logAudit({
    userId: user.id,
    action: "case_closed",
    entity: "case",
    entityId: req.params.id,
    entityRef: updated.caseRef,
    details: JSON.stringify({
      closureReason: closureData.closureReason,
      closureDetails: trimmedDetails?.slice(0, 500) || null,
      followUpConsentStatus: closureData.followUpConsentStatus,
      partyFollowUpConsents: persistedPartyFollowUpConsents.map((row) => ({
        partyId: row.partyId,
        consentStatus: row.consentStatus,
        source: row.consentSource,
        followUpTasksScheduled: row.followUpTasksScheduled,
      })),
      outreachExcluded: persistedPartyFollowUpConsents.length > 0
        ? persistedPartyFollowUpConsents.every((row) => row.consentStatus !== "granted")
        : closureData.followUpConsentStatus === "declined",
    }),
    ipAddress: req.ip,
  });

  await caseActivityService.log({
    caseId: req.params.id,
    type: "stage_changed",
    title: "Case closed",
    description: `${user.name} closed the case: ${closureData.closureReason}${trimmedDetails ? ` — ${trimmedDetails.slice(0, 500)}` : ""}`,
    relatedEntityType: "case",
    metadata: JSON.stringify({
      closureReason: closureData.closureReason,
      closureDetails: trimmedDetails,
      followUpConsentStatus: closureData.followUpConsentStatus,
      partyFollowUpConsents: persistedPartyFollowUpConsents.map((row) => ({
        partyId: row.partyId,
        consentStatus: row.consentStatus,
        source: row.consentSource,
        followUpTasksScheduled: row.followUpTasksScheduled,
      })),
      outreachExcluded: persistedPartyFollowUpConsents.length > 0
        ? persistedPartyFollowUpConsents.every((row) => row.consentStatus !== "granted")
        : closureData.followUpConsentStatus === "declined",
    }),
    actor: staffActor(user),
  });

  for (const party of partiesForCase) {
    if (!party.email) continue;
    const sent = await sendCaseClosureThankYouEmail(
      party.email,
      party.firstName,
      updated.caseRef,
      closureData.closureReason,
    );
    if (sent) {
      await caseActivityService.logEmailSent(
        req.params.id,
        party.email,
        "case_closure_thank_you_sent",
        party.firstName,
        staffActor(user),
      );
    }
  }

  return res.json(updated);
});

router.patch("/api/cases/:id/intake/claim", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  if (existing.status === "Closed" || existing.status === "Archived") return res.status(400).json({ message: "Closed or archived cases cannot be claimed" });
  const safeguardingGate = ensureSafeguardingClear(
    existing,
    "Please complete the safeguarding check before claiming",
    "Safeguarding must be clear before claiming",
  );
  if (!safeguardingGate.ok) return res.status(safeguardingGate.status).json({ message: safeguardingGate.message });
  const user = getUser(req);
  if (existing.claimedBy && existing.claimedBy !== user.id && user.role !== "superadmin") {
    return res.status(409).json({ message: "This enquiry is claimed by another staff member" });
  }
  const updated = await updateCaseIntake(req.params.id, {
    claimedBy: user.id,
    claimedAt: new Date(),
    intakeStatus: existing.intakeStatus === "New" ? "Claimed" : existing.intakeStatus,
  });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await logAudit({ userId: user.id, action: "case_intake_claimed", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ claimedBy: user.name }) });
  await caseActivityService.log({
    caseId: req.params.id,
    type: "intake_claimed",
    title: "Intake claimed",
    description: `${user.name} claimed the enquiry contact before acting on it.`,
    relatedEntityType: "case",
    actor: staffActor(user),
  });
  return res.json(updated);
});

router.patch("/api/cases/:id/intake/revoke-claim", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  if (user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can revoke intake claims" });
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  if (!existing.claimedBy) return res.status(400).json({ message: "This enquiry is not claimed" });
  const previousClaimant = existing.claimedBy;
  const updated = await updateCaseIntake(req.params.id, {
    claimedBy: null,
    claimedAt: null,
    intakeStatus: existing.intakeStatus || "New",
  });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await logAudit({ userId: user.id, action: "case_intake_claim_revoked", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ previousClaimant }) });
  await caseActivityService.log({
    caseId: req.params.id,
    type: "intake_claim_revoked",
    title: "Intake claim revoked",
    description: `${user.name} revoked the intake claim so another staff member can work on it.`,
    relatedEntityType: "case",
    actor: staffActor(user),
  });
  return res.json(updated);
});

router.get("/api/cases/:id/intake/tasks", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  if (!canReadIntakeWorkflowTasks(user, existing)) {
    return res.status(403).json({ message: "Intake history is unavailable" });
  }
  if (!(await verifyCaseAccess(req, res))) return;
  return res.json({ items: await listIntakeWorkflowTasks(req.params.id) });
});

router.patch("/api/cases/:id/intake/first-contact", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const user = getUser(req);
  const { contactMethod, notes, nextFollowUpDays, nextFollowUpDate, assignedUserIds, timeWindow } = req.body as { contactMethod?: string; notes?: string; nextFollowUpDays?: number; nextFollowUpDate?: string; assignedUserIds?: string[]; timeWindow?: { startTime?: string; endTime?: string } | null };
  if (!contactMethod || !isValidContactMethod(contactMethod)) return res.status(400).json({ message: "Valid contact method is required" });
  if (notes !== undefined && typeof notes !== "string") return res.status(400).json({ message: "Notes must be a string" });
  const result = nextFollowUpDays !== undefined || nextFollowUpDate !== undefined || assignedUserIds !== undefined
    ? await recordDynamicIntakeFirstContact({ caseId: req.params.id, contactMethod, notes, actor: user,
      intervalDays: nextFollowUpDays === undefined ? undefined : Number(nextFollowUpDays), followUpDate: nextFollowUpDate,
      assignedUserIds: Array.isArray(assignedUserIds) ? assignedUserIds : [],
      timeWindow: timeWindow ? { startTime: timeWindow.startTime ?? "", endTime: timeWindow.endTime ?? "" } : null })
    : await recordIntakeFirstContact({ caseId: req.params.id, contactMethod, notes, actor: user });
  if (!result.ok) return res.status(result.status).json({ message: result.message });
  return res.json(result.caseRecord);
});

router.patch("/api/cases/:caseId/intake/chase-tasks/:taskId/complete", requirePermission("cases", "edit"), async (req, res) => {
  const user = getUser(req);
  if (!["superadmin", "subadmin", "staff"].includes(user.role)) return res.status(403).json({ message: "Only authorised staff can record intake chase contacts" });
  const { contactMethod, notes, nextFollowUpDays, nextFollowUpDate, assignedUserIds, timeWindow } = req.body as { contactMethod?: string; notes?: string; nextFollowUpDays?: number; nextFollowUpDate?: string; assignedUserIds?: string[]; timeWindow?: { startTime?: string; endTime?: string } | null };
  if (!contactMethod || !isValidContactMethod(contactMethod)) return res.status(400).json({ message: "Valid contact method is required" });
  if (typeof notes !== "string" || !notes.trim()) return res.status(400).json({ message: "Notes are required" });
  const result = nextFollowUpDays !== undefined || nextFollowUpDate !== undefined || assignedUserIds !== undefined
    ? await completeDynamicIntakeFollowUp({ caseId: req.params.caseId, taskId: req.params.taskId, contactMethod, notes, actor: user,
      intervalDays: nextFollowUpDays === undefined ? undefined : Number(nextFollowUpDays), followUpDate: nextFollowUpDate,
      assignedUserIds: Array.isArray(assignedUserIds) ? assignedUserIds : [],
      timeWindow: timeWindow ? { startTime: timeWindow.startTime ?? "", endTime: timeWindow.endTime ?? "" } : null })
    : await completeIntakeChase({ caseId: req.params.caseId, taskId: req.params.taskId, contactMethod, notes, actor: user });
  if (!result.ok) return res.status(result.status).json({ message: result.message });
  return res.json(result.notification);
});

router.patch("/api/cases/:id/intake/safeguarding", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  const worker = validateSafeguardingWorker(existing, user);
  if (!worker.ok) return res.status(worker.status).json({ message: worker.message });
  const { status, notes } = req.body as { status?: string; notes?: string };
  if (status !== "clear" && status !== "concern") return res.status(400).json({ message: "status must be clear or concern" });
  if (notes !== undefined && typeof notes !== "string") return res.status(400).json({ message: "Notes must be a string" });
  const isNewSafeguardingConcern = status === "concern" && existing.safeguardingStatus !== "concern";
  const claimBypass = isIntakeAdminRole(user.role) && !!existing.claimedBy && existing.claimedBy !== user.id;
  const shouldAutoClaimFromSafeguarding = !existing.claimedBy;
  const autoClaimUpdates: Partial<Case> = shouldAutoClaimFromSafeguarding
    ? {
      claimedBy: user.id,
      claimedAt: new Date(),
    }
    : {};
  const updates: Partial<Case> = status === "concern"
    ? {
      ...autoClaimUpdates,
      intakeStatus: "Safeguarding",
      safeguardingStatus: "concern",
      safeguardingCheckedAt: new Date(),
      safeguardingCheckedBy: user.id,
      safeguardingNotes: notes?.trim() || null,
      safeguardingConfidential: true,
      standardChaseStopped: true,
      noWhatsappOrVoicemail: true,
      nationalDaHelplineSignposted: true,
    }
    : {
      ...autoClaimUpdates,
      safeguardingStatus: "clear",
      safeguardingCheckedAt: new Date(),
      safeguardingCheckedBy: user.id,
      safeguardingNotes: notes?.trim() || null,
      safeguardingConfidential: false,
      standardChaseStopped: false,
      noWhatsappOrVoicemail: false,
      nationalDaHelplineSignposted: false,
      intakeStatus: intakeStatusAfterSafeguardingClear({
        firstContactAttemptedAt: existing.firstContactAttemptedAt,
        claimedBy: existing.claimedBy || (shouldAutoClaimFromSafeguarding ? user.id : null),
      }),
    };
  const updated = await updateCaseIntake(req.params.id, updates);
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await clearInvalidCimEligibility(req.params.id, user, req.ip, "safeguarding is no longer clear");
  await logAudit({
    userId: user.id,
    action: "case_intake_safeguarding",
    entity: "case",
    entityId: req.params.id,
    entityRef: updated.caseRef,
    details: JSON.stringify({
      status,
      notes: notes?.slice(0, 500) || null,
      claimOwnerId: existing.claimedBy || null,
      claimBypass,
      actorRole: user.role,
    }),
  });
  if (shouldAutoClaimFromSafeguarding) {
    await caseActivityService.log({
      caseId: req.params.id,
      type: "intake_claimed",
      title: "Intake claimed",
      description: `${user.name} was automatically assigned when recording the safeguarding decision.`,
      relatedEntityType: "case",
      metadata: JSON.stringify({ source: "safeguarding_gate", safeguardingStatus: status }),
      actor: staffActor(user),
    });
  }
  await caseActivityService.log({
    caseId: req.params.id,
    type: "safeguarding_gate",
    title: status === "concern" ? "Safeguarding concern raised" : "Safeguarding checked",
    description: status === "concern"
      ? "Standard chase stopped, case marked confidential, no WhatsApp or voicemail, No email or WhatsApp follow-up will be triggered, and National Domestic Abuse Helpline 0808 2000 247 signposted."
      : "No safeguarding concern recorded for enquiry intake.",
    relatedEntityType: "case",
    metadata: JSON.stringify({ status, notes: notes || null }),
    actor: staffActor(user),
  });
  if (isNewSafeguardingConcern) {
    await notifySensitiveCaseAudience({
      caseRecord: updated,
      actor: user,
      type: "safeguarding_concern_raised",
      urgency: "red",
      title: `Safeguarding concern raised — ${updated.caseRef}`,
      message: `${user.name} raised a safeguarding concern for case ${updated.caseRef}. Review the safeguarding pathway in the CRM.`,
    });
  }
  return res.json(updated);
});

router.patch("/api/cases/:id/intake/notify-rebecca", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  const worker = validateSafeguardingWorker(existing, user);
  if (!worker.ok) return res.status(worker.status).json({ message: worker.message });
  const notifiedAt = new Date();
  const updated = await updateCaseIntake(req.params.id, { rebeccaNotifiedAt: notifiedAt });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  const notification = await notificationService.createNotification({
    recipientRole: "admin",
    type: "safeguarding_rebecca_notification",
    urgency: "red",
    caseId: req.params.id,
    title: `Notify Rebecca — ${updated.caseRef}`,
    message: `Safeguarding pathway action for ${updated.caseRef}. National Domestic Abuse Helpline: 0808 2000 247.`,
    status: "active",
    followUpDate: new Date(),
    caseNoteRequired: true,
  });
  if (notification) await caseActivityService.logTaskCreated(req.params.id, notification.title, notification.urgency, staffActor(user));
  await logAudit({
    userId: user.id,
    action: "case_intake_rebecca_notified",
    entity: "case",
    entityId: req.params.id,
    entityRef: updated.caseRef,
    details: JSON.stringify({
      claimOwnerId: existing.claimedBy || null,
      claimBypass: isIntakeAdminRole(user.role) && !!existing.claimedBy && existing.claimedBy !== user.id,
      actorRole: user.role,
    }),
  });
  await caseActivityService.log({
    caseId: req.params.id,
    type: "safeguarding_rebecca_notified",
    title: "Rebecca notification stamped",
    description: `${user.name} stamped the Rebecca notification action.`,
    relatedEntityType: "case",
    actor: staffActor(user),
  });
  try {
    const rebeccaUser = await storage.getUserByEmail("rebecca@brighterfuturemediation.co.uk");
    if (rebeccaUser?.role === "superadmin" && rebeccaUser.status === "active") {
      const sent = await sendSafeguardingRebeccaNotificationEmail({
        to: rebeccaUser.email,
        caseRef: updated.caseRef,
        actorName: user.name || user.email,
        notifiedAt,
      });
      if (!sent) console.error("[Safeguarding] Notify Rebecca email failed", { caseId: updated.id, to: rebeccaUser.email });
    } else {
      console.error("[Safeguarding] Notify Rebecca email skipped: active Rebecca superadmin account not found", { caseId: updated.id });
    }
  } catch (emailErr) {
    console.error("[Safeguarding] Notify Rebecca email failed", emailErr);
  }
  return res.json(updated);
});

router.patch("/api/cases/:id/intake/close", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { closureReason, closureDetails } = req.body as { closureReason?: string; closureDetails?: string };
  if (!closureReason || !isValidClosureReason(closureReason)) return res.status(400).json({ message: "Closure reason is required" });
  if (closureDetails !== undefined && typeof closureDetails !== "string") return res.status(400).json({ message: "closureDetails must be a string" });
  if (closureReason === "Other" && !closureDetails?.trim()) return res.status(400).json({ message: "Other closure reason requires an explanation" });
  const user = getUser(req);
  const existing = await storage.getCase(req.params.id);
  if (!existing) return res.status(404).json({ message: "Case not found" });
  if (!isSafeguardingDecided(existing)) {
    return res.status(409).json({ message: "Please complete the safeguarding check before closing intake" });
  }
  const worker = existing.safeguardingStatus === "concern"
    ? validateSafeguardingWorker(existing, user)
    : validateIntakeWorker(existing, user);
  if (!worker.ok) return res.status(worker.status).json({ message: worker.message });
  const updated = await updateCaseIntake(req.params.id, {
    intakeStatus: "Closed",
    closureReason,
    closureDetails: closureDetails?.trim().slice(0, 10000) || null,
    closureDate: new Date(),
  });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  await completeOpenIntakeFollowUpTasks(req.params.id, user, closureReason);
  await logAudit({ userId: user.id, action: "case_intake_closed", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ closureReason, closureDetails: closureDetails?.slice(0, 500) || null }) });
  await caseActivityService.log({
    caseId: req.params.id,
    type: "intake_closed",
    title: "Intake closed",
    description: `Intake closed from enquiry workflow: ${closureReason}${closureDetails?.trim() ? ` — ${closureDetails.trim().slice(0, 500)}` : ""}`,
    relatedEntityType: "case",
    metadata: JSON.stringify({ closureReason, closureDetails: closureDetails || null }),
    actor: staffActor(user),
  });
  return res.json(updated);
});

export interface ConfidentialNoteWithAuthor extends ConfidentialNote {
  createdByName: string;
}

router.get("/api/cases/:id/confidential-notes", requirePermission("cases", "view"), async (req, res) => {
  if (!(await verifyFullOperationalCaseAccess(req, res))) return;
  const notes = await storage.listConfidentialNotes(req.params.id);
  const users = await storage.listUsers();
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const enriched: ConfidentialNoteWithAuthor[] = notes.map((n) => ({ ...n, createdByName: userMap.get(n.createdBy) || "Unknown" }));
  return res.json(enriched);
});

router.post("/api/cases/:id/confidential-notes", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyFullOperationalCaseAccess(req, res))) return;
  const { category, content } = req.body as { category: string; content: string };
  if (!category || !content?.trim()) return res.status(400).json({ message: "Category and content are required" });
  if (!isValidCategory(category)) return res.status(400).json({ message: "Invalid category" });
  const user = getUser(req);
  const note = await storage.createConfidentialNote({ caseId: req.params.id, category, content: content.trim(), createdBy: user.id });
  logAudit({ userId: user.id, action: "create", entity: "confidential_note", entityId: note.id, entityRef: req.params.id, details: JSON.stringify({ category }) });
  caseActivityService.logNoteAdded(req.params.id, category, staffActor(user)).catch(() => {});
  return res.status(201).json(note);
});

router.patch("/api/cases/:id/referral", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { referralPartnerName, referralPartnerCode } = req.body;
  if (referralPartnerName !== undefined && referralPartnerName !== null && typeof referralPartnerName !== "string") return res.status(400).json({ message: "referralPartnerName must be a string" });
  if (referralPartnerCode !== undefined && referralPartnerCode !== null && typeof referralPartnerCode !== "string") return res.status(400).json({ message: "referralPartnerCode must be a string" });
  const updated = await storage.updateCaseReferral(req.params.id, {
    referralPartnerName: typeof referralPartnerName === "string" ? referralPartnerName.trim().slice(0, 500) || null : null,
    referralPartnerCode: typeof referralPartnerCode === "string" ? referralPartnerCode.trim().slice(0, 100) || null : null,
  });
  if (!updated) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  logAudit({ userId: user.id, action: "update", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ referralPartnerName, referralPartnerCode }) });
  return res.json(updated);
});

router.patch("/api/cases/:id/closure-details", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { closureDetails } = req.body;
  if (typeof closureDetails !== "string") return res.status(400).json({ message: "closureDetails must be a string" });
  const updated = await storage.updateCaseClosureDetails(req.params.id, closureDetails.trim().slice(0, 10000));
  if (!updated) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  logAudit({ userId: user.id, action: "update", entity: "case", entityId: req.params.id, entityRef: updated.caseRef, details: JSON.stringify({ closureDetails: closureDetails.slice(0, 200) }) });
  return res.json(updated);
});

const VALID_COURT_FORM_TYPES: CourtFormType[] = ["C100", "FormA", "FM1"];

router.post("/api/cases/:id/generate-court-form", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyCaseAccess(req, res))) return;
  const { formType } = req.body;
  if (!formType || !VALID_COURT_FORM_TYPES.includes(formType)) {
    return res.status(400).json({ message: "formType must be one of: C100, FormA, FM1" });
  }
  const result = await courtFormService.generateCourtForm(req.params.id, formType);
  if (!result) return res.status(404).json({ message: "Case not found" });
  const user = getUser(req);
  logAudit({ userId: user.id, action: "create", entity: "case", entityId: req.params.id, details: JSON.stringify({ action: "generate_court_form", formType }) });
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  return res.send(result.html);
});

router.patch("/api/cases/:id/archive", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ success: false, message: "Only admins can archive cases" });
    }
    if (!(await verifyCaseAccess(req, res))) return;
    const result = await caseService.archiveCase(req.params.id);
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });
    logAudit({ userId: user.id, action: "update", entity: "case", entityId: req.params.id, entityRef: result.caseDetail.caseRef, details: JSON.stringify({ action: "archive" }) });
    return res.json({ success: true, archived: true, deleted: false, caseRef: result.caseDetail.caseRef });
  } catch (err) {
    console.error("[case.archive] error:", err);
    return res.status(500).json({ success: false, message: "Failed to archive case" });
  }
});

router.patch("/api/cases/:id/restore", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Only superadmins can restore cases" });
    }
    if (!(await verifyCaseAccess(req, res))) return;
    const result = await caseService.restoreCase(req.params.id);
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });
    logAudit({ userId: user.id, action: "update", entity: "case", entityId: req.params.id, entityRef: result.caseDetail.caseRef, details: JSON.stringify({ action: "restore" }) });
    return res.json({ success: true, archived: false, deleted: false, caseRef: result.caseDetail.caseRef });
  } catch (err) {
    console.error("[case.restore] error:", err);
    return res.status(500).json({ success: false, message: "Failed to restore case" });
  }
});

router.delete("/api/cases/:id", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Only superadmins can permanently delete cases" });
    }
    const existing = await storage.getCase(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Case not found" });
    const { confirm } = req.body as { confirm?: string };
    if (!confirm || typeof confirm !== "string" || confirm !== existing.caseRef) {
      return res.status(400).json({ success: false, message: `Confirmation text must match the case reference exactly: ${existing.caseRef}` });
    }
    const result = await caseService.hardDeleteCase(req.params.id);
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });
    logAudit({ userId: user.id, action: "delete", entity: "case", entityId: req.params.id, entityRef: result.caseRef, details: JSON.stringify({ action: "hard_delete", removedCounts: result.removedCounts }) });
    return res.json({ success: true, archived: false, deleted: true, caseRef: result.caseRef, removedCounts: result.removedCounts });
  } catch (err) {
    console.error("[case.hardDelete] error:", err);
    return res.status(500).json({ success: false, message: "Failed to permanently delete case" });
  }
});

router.delete("/api/cases/:id/confidential-notes/:noteId", requirePermission("cases", "edit"), async (req, res) => {
  if (!(await verifyFullOperationalCaseAccess(req, res))) return;
  const note = await storage.getConfidentialNote(req.params.noteId);
  if (!note) return res.status(404).json({ message: "Note not found" });
  if (note.caseId !== req.params.id) return res.status(404).json({ message: "Note not found" });
  const user = getUser(req);
  if (note.createdBy !== user.id && user.role !== "superadmin") {
    return res.status(403).json({ message: "You can only delete your own notes" });
  }
  await storage.deleteConfidentialNote(req.params.noteId);
  logAudit({ userId: user.id, action: "delete", entity: "confidential_note", entityId: req.params.noteId, entityRef: req.params.id, details: JSON.stringify({ category: note.category }) });
  return res.json({ message: "Deleted" });
});

// GET /api/client/cases/missing-demographics
// Client-only: returns all of the logged-in client's cases that have incomplete
// mandatory demographic data.
router.get("/api/client/cases/missing-demographics", requireAuth, async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  if (user.role !== "client") return res.status(403).json({ message: "Forbidden" });

  const parties = await storage.listPartiesByUserId(user.id);
  const result: { caseId: string; caseRef: string; stage: string; status: string }[] = [];

  for (const party of parties) {
    const c = await storage.getCase(party.caseId);
    if (!c || c.status === "Archived" || c.status === "Closed") continue;
    const dem = await storage.getDemographicDataByParty(party.id);
    if (!isClientDemographicComplete(dem)) {
      result.push({ caseId: c.id, caseRef: c.caseRef, stage: c.stage, status: c.status });
    }
  }

  return res.json(result);
});

export default router;
