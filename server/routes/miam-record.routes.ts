import { Router, Request, Response } from "express";
import { requirePermission } from "../middleware/permissions";
import { storage } from "../storage";
import { db } from "../db";
import { logAudit } from "../services/audit-log.service";
import { caseService } from "../services/case.service";
import { clientService } from "../services/client.service";
import { userService } from "../services/user.service";
import { mediationSessionService } from "../services/mediation-session.service";
import { caseActivityService, staffActor, systemActor } from "../services/case-activity.service";
import { notificationService } from "../services/notification.service";
import { generateMiamPdf } from "../services/miam-pdf.service";
import { formatCaseRefWithRole, getNextRoleLetter, compareRoleLetters } from "../utils/case-ref";
import { CASE_STAGES, notifications } from "@shared/schema";
import type { Party, DemographicData, MiamRecord } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { classifyCaseAccess } from "../security/case-access-policy";

const router = Router();

const checklistItemSchema = z.object({
  status: z.string().max(10),
  notes: z.string().max(2000).optional().default(""),
}).passthrough();

const miamUpdateSchema = z.object({
  sessionMediator: z.string().max(500).optional().nullable(),
  sessionDate: z.string().max(20).optional().nullable(),
  sessionTime: z.string().max(20).optional().nullable(),
  otherPeoplePresent: z.string().max(500).optional().nullable(),
  caseReference: z.string().max(100).optional().nullable(),
  caseType: z.string().max(200).optional().nullable(),
  clientName: z.string().max(500).optional().nullable(),
  clientFirstName: z.string().max(250).optional().nullable(),
  clientLastName: z.string().max(250).optional().nullable(),
  clientDob: z.string().max(20).optional().nullable(),
  clientAddress: z.string().max(1000).optional().nullable(),
  clientPhone: z.string().max(50).optional().nullable(),
  howHeardAboutBfm: z.string().max(200).optional().nullable(),
  clientOccupation: z.string().max(200).optional().nullable(),
  clientDisability: z.string().max(2000).optional().nullable(),
  clientAccessibility: z.string().max(2000).optional().nullable(),
  clientEthnicity: z.string().max(200).optional().nullable(),
  clientReligiousCulturalNeeds: z.string().max(500).optional().nullable(),
  clientNewPartner: z.string().max(500).optional().nullable(),
  introNotes: z.string().max(5000).optional().nullable(),
  introPurposeDiscussed: z.string().max(10).optional().nullable(),
  introConfidentialityExplained: z.string().max(10).optional().nullable(),
  children: z.array(z.object({
    name: z.string().max(200).optional().default(""),
    firstName: z.string().max(200).optional().default(""),
    lastName: z.string().max(200).optional().default(""),
    dob: z.string().max(20).optional().default(""),
    age: z.string().max(10).optional().default(""),
    gender: z.string().max(50).optional().default(""),
    livesWithClient: z.string().max(200).optional().default(""),
    residenceAddress: z.string().max(500).optional().default(""),
    contactArrangements: z.string().max(500).optional().default(""),
    school: z.string().max(200).optional().default(""),
    notes: z.string().max(1000).optional().default(""),
  })).optional().nullable(),
  otherClientName: z.string().max(500).optional().nullable(),
  otherClientFirstName: z.string().max(250).optional().nullable(),
  otherClientLastName: z.string().max(250).optional().nullable(),
  otherClientDob: z.string().max(20).optional().nullable(),
  otherClientAddress: z.string().max(1000).optional().nullable(),
  otherClientPhone: z.string().max(50).optional().nullable(),
  otherClientEmail: z.string().max(255).optional().nullable(),
  married: z.string().max(10).optional().nullable(),
  dateOfMarriage: z.string().max(20).optional().nullable(),
  livedTogether: z.string().max(10).optional().nullable(),
  dateOfCohabitation: z.string().max(20).optional().nullable(),
  dateOfSeparation: z.string().max(20).optional().nullable(),
  bothParentsPr: z.string().max(10).optional().nullable(),
  prIsIssue: z.string().max(10).optional().nullable(),
  divorceStarted: z.string().max(10).optional().nullable(),
  divorceStartedDate: z.string().max(20).optional().nullable(),
  petitioner: z.string().max(200).optional().nullable(),
  decreeNisiDate: z.string().max(20).optional().nullable(),
  decreeAbsoluteDate: z.string().max(20).optional().nullable(),
  courtOrders: z.string().max(5000).optional().nullable(),
  applicationsToCourtText: z.string().max(5000).optional().nullable(),
  checklist: z.record(z.string(), checklistItemSchema).optional().nullable(),
  backgroundNotes: z.string().max(10000).optional().nullable(),
  bgWhatBringsYou: z.string().max(5000).optional().nullable(),
  bgLivingArrangements: z.string().max(5000).optional().nullable(),
  bgChildrenDetails: z.string().max(5000).optional().nullable(),
  bgContactArrangements: z.string().max(5000).optional().nullable(),
  welfareOfChildren: z.string().max(10).optional().nullable(),
  welfareAgencyContacted: z.string().max(10).optional().nullable(),
  welfareAgencyName: z.string().max(500).optional().nullable(),
  welfareAgencyDate: z.string().max(20).optional().nullable(),
  welfareAgencyTime: z.string().max(20).optional().nullable(),
  welfareNotes: z.string().max(5000).optional().nullable(),
  welfareChildrensServices: z.string().max(5000).optional().nullable(),
  welfareSafetyConcerns: z.string().max(5000).optional().nullable(),
  welfareWitnessedConflict: z.string().max(5000).optional().nullable(),
  welfareInjuriesBehaviouralChanges: z.string().max(5000).optional().nullable(),
  welfareSafeguardingPlans: z.string().max(5000).optional().nullable(),
  childInclusiveExplained: z.string().max(10).optional().nullable(),
  childInclusiveClientResponse: z.string().max(5000).optional().nullable(),
  childInclusiveConfidentialityExplained: z.string().max(10).optional().nullable(),
  childInclusiveNotes: z.string().max(5000).optional().nullable(),
  childInclusiveConsentAgreed: z.string().max(10).optional().nullable(),
  domesticAbuseScreening: z.string().max(5000).optional().nullable(),
  daHurtOrScared: z.string().max(5000).optional().nullable(),
  daPoliceInvolved: z.string().max(5000).optional().nullable(),
  daPhysical: z.string().max(5000).optional().nullable(),
  daPowerControl: z.string().max(5000).optional().nullable(),
  daFeelSafe: z.string().max(5000).optional().nullable(),
  daFinancialControl: z.string().max(5000).optional().nullable(),
  daPermissionToDecide: z.string().max(5000).optional().nullable(),
  daAfraidOfReaction: z.string().max(5000).optional().nullable(),
  domesticAbuseSafetyConclusions: z.string().max(5000).optional().nullable(),
  domesticAbuseSupportServices: z.array(z.string().max(200)).max(20).optional().nullable(),
  domesticAbuseSupportServicesOther: z.string().max(500).optional().nullable(),
  domesticAbuseLegalAidInfo: z.string().max(5000).optional().nullable(),
  domesticAbuseNotes: z.string().max(5000).optional().nullable(),
  emotionalReadiness: z.string().max(5000).optional().nullable(),
  erEqualBasis: z.string().max(5000).optional().nullable(),
  erChoosingFreely: z.string().max(5000).optional().nullable(),
  erPressuredToAttend: z.string().max(5000).optional().nullable(),
  erCanWithdraw: z.string().max(5000).optional().nullable(),
  erSameRoom: z.string().max(5000).optional().nullable(),
  erCapacity: z.string().max(5000).optional().nullable(),
  safetyMeasuresDiscussed: z.string().max(5000).optional().nullable(),
  safetyMeasuresAgreed: z.string().max(5000).optional().nullable(),
  issuesForMediation: z.record(z.string(), checklistItemSchema).optional().nullable(),
  issuesOther: z.string().max(5000).optional().nullable(),
  furtherInfoRequested: z.record(z.string(), checklistItemSchema).optional().nullable(),
  furtherInfoOther: z.string().max(5000).optional().nullable(),
  suitableForMediation: z.string().max(50).optional().nullable(),
  suitabilityReasons: z.string().max(5000).optional().nullable(),
  nextSteps: z.string().max(5000).optional().nullable(),
  mediationType: z.string().max(50).optional().nullable(),
  timeline: z.string().max(500).optional().nullable(),
  agreedWithClient: z.string().max(10).optional().nullable(),
  ofsRequired: z.string().max(10).optional().nullable(),
  mouRequired: z.string().max(10).optional().nullable(),
  statementOfChildArrangements: z.string().max(10).optional().nullable(),
  ppcRequired: z.string().max(10).optional().nullable(),
  ppcReason: z.array(z.string().max(200)).max(10).optional().nullable(),
  ppcReasonOther: z.string().max(500).optional().nullable(),
  ppcDate: z.string().max(20).optional().nullable(),
  ppcConsultantName: z.string().max(200).optional().nullable(),
  ppcOutcomes: z.string().max(5000).optional().nullable(),
  referralToCafcass: z.string().max(10).optional().nullable(),
  referralToChildrenServices: z.string().max(10).optional().nullable(),
  referralToChildrenServicesDetails: z.string().max(5000).optional().nullable(),
  referralFollowUpContact: z.string().max(10).optional().nullable(),
  feePerSession: z.string().max(50).optional().nullable(),
  totalEstimatedFee: z.string().max(50).optional().nullable(),
  mojVoucherApplied: z.string().max(10).optional().nullable(),
  legalAidApplied: z.string().max(10).optional().nullable(),
  paymentMethod: z.string().max(200).optional().nullable(),
  followUpContactRequired: z.string().max(10).optional().nullable(),
});

const STAFF_ROLES = ["superadmin", "subadmin", "mediator"] as const;
const OPEN_MIAM_REVIEW_STATUSES = ["active", "in_progress", "follow_up"] as const;

function getUser(req: Request) {
  return (req as Request & { user?: unknown }).user as { id: string; role: string; name: string; email: string };
}

function isStaffRole(role: string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

async function clearInvalidCimEligibilityAfterMiamChange(
  caseId: string,
  user: { id: string; name: string; role: string; email: string },
  ipAddress: string | undefined,
  reason: string,
): Promise<void> {
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

function partyDisplayName(party: Pick<Party, "firstName" | "lastName">): string {
  return `${party.firstName || ""} ${party.lastName || ""}`.trim() || "Client";
}

function miamActivityMetadata(
  record: Pick<MiamRecord, "id" | "partyId" | "approvalStatus" | "submittedBy" | "submittedAt" | "reviewedBy" | "reviewedAt">,
  party: Pick<Party, "id" | "role">,
  approvalStatus: string,
  actorId: string,
) {
  return JSON.stringify({
    miamRecordId: record.id,
    partyId: party.id,
    partyRole: party.role,
    approvalStatus,
    submittedBy: record.submittedBy ?? actorId,
    submittedAt: record.submittedAt ? new Date(record.submittedAt).toISOString() : null,
    reviewedBy: record.reviewedBy ?? null,
    reviewedAt: record.reviewedAt ? new Date(record.reviewedAt).toISOString() : null,
    timestamp: new Date().toISOString(),
  });
}

async function createMiamReviewRequiredNotification(
  record: MiamRecord,
  party: Party,
  user: { id: string; role: string; name: string },
) {
  const openMiamReviewTasks = await db
    .select()
    .from(notifications)
    .where(and(
      eq(notifications.caseId, party.caseId),
      eq(notifications.type, "miam_review_required"),
      inArray(notifications.status, OPEN_MIAM_REVIEW_STATUSES as unknown as string[]),
      sql`${notifications.message} LIKE ${`%${record.id}%`}`,
    ));

  if (openMiamReviewTasks.length > 0) return null;

  const caseRecord = await storage.getCase(party.caseId);
  const clientName = partyDisplayName(party);
  const caseRef = caseRecord?.caseRef || party.caseId;
  const created = await notificationService.createNotification({
    recipientId: null,
    recipientRole: "admin",
    type: "miam_review_required",
    urgency: "amber",
    caseId: party.caseId,
    appointmentId: null,
    title: `MIAM review required — Client ${party.role}`,
    message: `${user.name} submitted the MIAM record for ${clientName} (${caseRef}). Please review and approve, reject, or flag it. MIAM record ${record.id}`,
    status: "active",
    caseNoteRequired: false,
  });

  if (created) {
    await caseActivityService.logTaskCreated(party.caseId, created.title, created.urgency, staffActor(user));
  }

  return created;
}

async function completeMiamReviewRequiredNotifications(
  record: MiamRecord,
  decision: "approved" | "rejected" | "flagged",
  user: { id: string; role: string; name: string },
) {
  const openMiamReviewTasks = await db
    .select()
    .from(notifications)
    .where(and(
      eq(notifications.caseId, record.caseId),
      eq(notifications.type, "miam_review_required"),
      inArray(notifications.status, OPEN_MIAM_REVIEW_STATUSES as unknown as string[]),
      sql`${notifications.message} LIKE ${`%${record.id}%`}`,
    ));

  for (const task of openMiamReviewTasks) {
    await notificationService.complete(task.id, user, `MIAM record ${decision} by ${user.name}`);
  }
}

async function verifyCaseAccess(caseId: string, req: Request, res: Response): Promise<boolean> {
  const user = getUser(req);
  const result = await caseService.getCaseDetailForUser(caseId, user);
  if (!result.ok) {
    res.status(result.status).json({ message: result.error });
    return false;
  }
  return true;
}

interface MiamPrefill {
  sessionMediator: string;
  clientName: string;
  clientFirstName: string;
  clientLastName: string;
  clientDob: string;
  clientAddress: string;
  clientPhone: string;
  howHeardAboutBfm: string;
  clientDisability: string;
  clientAccessibility: string;
  clientEthnicity: string;
  caseReference: string;
  caseType: string;
  otherClientName: string;
  otherClientFirstName: string;
  otherClientLastName: string;
  otherClientDob: string;
  otherClientAddress: string;
  otherClientPhone: string;
  otherClientEmail: string;
  otherPartyHasMiamMediator?: boolean;
}

function buildPartyAddress(party: Party): string {
  const parts = [party.addressLine1, party.addressLine2, party.city, party.postcode].filter(Boolean);
  return parts.join(", ");
}

async function verifyMiamPartyAccess(user: { id: string; role: string }, party: Party, caseId: string): Promise<boolean> {
  if (user.role === "superadmin" || user.role === "subadmin") return true;
  if (user.role !== "mediator") return false;

  const caseRecord = await storage.getCase(caseId);
  if (caseRecord?.mediatorId === user.id) return true;

  const allParties = await storage.listPartiesByCase(caseId);
  const isAllocatedMediator = allParties.some(p => p.allocatedMediatorId === user.id);
  if (isAllocatedMediator) return true;

  if (party.miamMediatorId === user.id) {
    const isCaseMediator = caseRecord?.mediatorId === user.id;
    const hasAllocated = allParties.some(p => p.allocatedMediatorId === user.id);
    if (!isCaseMediator && !hasAllocated) {
      const miamRecord = await storage.getMiamRecord(party.id, caseId);
      const status = miamRecord?.approvalStatus || "draft";
      if (status === "submitted" || status === "approved" || status === "flagged") {
        return false;
      }
    }
    return true;
  }

  return false;
}

async function resolveMediatorName(mediatorId: string | null | undefined): Promise<string> {
  if (!mediatorId) return "";
  const mediator = await storage.getUser(mediatorId);
  return mediator?.name || "";
}

function isBlankMiamHeaderValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function getCurrentUkDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function listActiveMediatorOptions(): Promise<Array<{ id: string; name: string }>> {
  const result = await userService.listMediators({ page: 1, limit: 100 });
  return result.data
    .filter((m: { id: string; name: string; status?: string | null }) => m.status !== "archived")
    .map((m: { id: string; name: string }) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const MIAM_DEPENDENT_FIELD_CLEARS: Record<string, Record<string, unknown>> = {
  ppcRequired: {
    ppcReason: [],
    ppcReasonOther: null,
    ppcDate: null,
    ppcConsultantName: null,
    ppcOutcomes: null,
  },
  referralToChildrenServices: {
    referralToChildrenServicesDetails: null,
    referralFollowUpContact: null,
  },
  welfareAgencyContacted: {
    welfareAgencyName: null,
    welfareAgencyDate: null,
    welfareAgencyTime: null,
  },
  married: {
    dateOfMarriage: null,
    divorceStarted: null,
    divorceStartedDate: null,
    petitioner: null,
    decreeNisiDate: null,
    decreeAbsoluteDate: null,
  },
  livedTogether: {
    dateOfCohabitation: null,
  },
  divorceStarted: {
    divorceStartedDate: null,
    petitioner: null,
    decreeNisiDate: null,
    decreeAbsoluteDate: null,
  },
  childInclusiveExplained: {
    childInclusiveClientResponse: null,
    childInclusiveConfidentialityExplained: null,
    childInclusiveConsentAgreed: null,
    childInclusiveNotes: null,
  },
};

function isMiamYes(value: unknown): boolean {
  return value === "yes";
}

function isMiamYesOrNo(value: unknown): boolean {
  return value === "yes" || value === "no";
}

function normalizeMiamNestedNotes(
  collection: unknown,
  shouldKeepNotes: (status: string) => boolean,
): Record<string, { status: string; notes: string }> {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) return {};
  return Object.fromEntries(
    Object.entries(collection as Record<string, { status?: string; notes?: string }>).map(([key, value]) => {
      const status = value?.status || "";
      return [key, { ...value, status, notes: shouldKeepNotes(status) ? value?.notes || "" : "" }];
    }),
  );
}

function normalizeMiamDependentFields(
  data: Record<string, unknown>,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  const readValue = (field: string) => next[field] ?? base[field];

  for (const [controller, clears] of Object.entries(MIAM_DEPENDENT_FIELD_CLEARS)) {
    if (!isMiamYes(readValue(controller))) {
      Object.assign(next, clears);
    }
  }

  if (!isMiamYesOrNo(readValue("suitableForMediation"))) {
    next["suitabilityReasons"] = null;
  }

  next["furtherInfoRequested"] = normalizeMiamNestedNotes(readValue("furtherInfoRequested"), isMiamYes);
  next["checklist"] = normalizeMiamNestedNotes(readValue("checklist"), isMiamYesOrNo);

  return next;
}

router.get(["/api/miam-records/case/:caseId", "/api/cases/:caseId/miam"], requirePermission("cases", "view"), async (req, res) => {
  try {
    const user = getUser(req);
    if (!isStaffRole(user.role)) {
      return res.status(403).json({ message: "MIAM records are accessible to staff only" });
    }

    const caseId = String(req.params.caseId);
    if (!(await verifyCaseAccess(caseId, req, res))) return;
    const access = await classifyCaseAccess(caseId, user);
    if (access.tier === "session_observer" || access.tier === "none" || access.tier === "client_party") {
      return res.status(403).json({ message: "MIAM records are not available for this case access tier" });
    }

    const records = await storage.listMiamRecordsByCase(caseId);
    const parties = await storage.listPartiesByCase(caseId);
    const caseRecord = await storage.getCase(caseId);
    const allDemographic = await storage.getDemographicDataByCase(caseId);

    const prefillByParty: Record<string, MiamPrefill> = {};
    for (const party of parties) {
      const demo = allDemographic.find((d: DemographicData) => d.partyId === party.id);
      // "Other party" prefill is intentionally A↔B only:
      //   - For Party A → otherParty = Party B (if any)
      //   - For Party B → otherParty = Party A
      //   - For Party C, D, … → no otherParty prefill (the legacy free-text
      //     "Other Client" form is hidden in Section 5 once Party B exists,
      //     so prefilling a random extra party would be misleading).
      const partyRoleUpper = (party.role || "").toUpperCase();
      let otherParty: Party | undefined;
      if (partyRoleUpper === "A") {
        otherParty = parties.find((p: Party) => (p.role || "").toUpperCase() === "B");
      } else if (partyRoleUpper === "B") {
        otherParty = parties.find((p: Party) => (p.role || "").toUpperCase() === "A");
      }
      const otherDemo = otherParty
        ? allDemographic.find((d: DemographicData) => d.partyId === otherParty.id)
        : undefined;

      const mediatorName = await resolveMediatorName(party.miamMediatorId || party.allocatedMediatorId);

      prefillByParty[party.id] = {
        sessionMediator: mediatorName,
        clientName: `${party.firstName || ""} ${party.lastName || ""}`.trim(),
        clientFirstName: party.firstName || "",
        clientLastName: party.lastName || "",
        clientDob: party.dateOfBirth || demo?.dateOfBirth || "",
        clientAddress: buildPartyAddress(party),
        clientPhone: party.phone || "",
        howHeardAboutBfm: caseRecord?.leadSource || "",
        clientDisability: demo?.disabilityOrHealthConditions || "",
        clientAccessibility: demo?.additionalNeeds || "",
        clientEthnicity: demo?.ethnicity || party.ethnicOrigin || "",
        // Per-party MIAM reference: BFM-YYYY-####-X (A, B, C, ...).
        caseReference: caseRecord ? formatCaseRefWithRole(caseRecord.caseRef, party.role) : "",
        caseType: caseRecord?.issueType || "",
        otherClientName: otherParty ? `${otherParty.firstName || ""} ${otherParty.lastName || ""}`.trim() : "",
        otherClientFirstName: otherParty?.firstName || "",
        otherClientLastName: otherParty?.lastName || "",
        otherClientDob: otherParty?.dateOfBirth || otherDemo?.dateOfBirth || "",
        otherClientAddress: otherParty ? buildPartyAddress(otherParty) : "",
        otherClientPhone: otherParty?.phone || "",
        otherClientEmail: otherParty?.email || "",
      };
    }

    const editRequests: Record<string, unknown> = {};
    const lastEditRequestFeedback: Record<string, unknown> = {};
    for (const record of records) {
      const pending = await storage.getPendingMiamEditRequest(record.id);
      if (pending) {
        const requester = await storage.getUser(pending.requestedBy);
        editRequests[record.id] = { ...pending, requesterName: requester?.name || "Unknown" };
      } else {
        const latest = await storage.getLatestMiamEditRequest(record.id);
        if (latest && (latest.status === "rejected" || latest.status === "flagged")) {
          const requester = await storage.getUser(latest.requestedBy);
          const reviewer = latest.reviewedBy ? await storage.getUser(latest.reviewedBy) : null;
          lastEditRequestFeedback[record.id] = {
            ...latest,
            requesterName: requester?.name || "Unknown",
            reviewerName: reviewer?.name || "Unknown",
          };
        }
      }
    }

    let miamMediatorTabHidden = false;
    let scopedRecords = records;
    let scopedParties = parties;
    let scopedPrefill = prefillByParty;
    let scopedEditRequests = editRequests;
    let scopedLastFeedback = lastEditRequestFeedback;

    if (user.role === "mediator") {
      const isCaseMediator = caseRecord?.mediatorId === user.id;
      const isAllocatedMediator = parties.some((p: Party) => p.allocatedMediatorId === user.id);
      const miamAssignedParties = parties.filter((p: Party) => p.miamMediatorId === user.id);

      if (miamAssignedParties.length > 0 && !isCaseMediator && !isAllocatedMediator) {
        const visiblePartyIds: string[] = [];
        for (const assignedParty of miamAssignedParties) {
          const miamRecord = records.find(r => r.partyId === assignedParty.id);
          const status = miamRecord?.approvalStatus || "draft";
          if (status === "draft" || status === "rejected") {
            visiblePartyIds.push(assignedParty.id);
          }
        }

        if (visiblePartyIds.length === 0) {
          miamMediatorTabHidden = true;
        }

        scopedRecords = records.filter(r => visiblePartyIds.includes(r.partyId));
        scopedParties = parties.filter(p => visiblePartyIds.includes(p.id));
        scopedPrefill = {};
        for (const pid of visiblePartyIds) {
          if (!prefillByParty[pid]) continue;
          // Explicit A↔B "other party" lookup (not "first party that is not me"),
          // so the legacy MIAM-only-mediator scoping is unambiguous on multi-
          // party (>2) cases. C/D/… parties have no "other client" counterpart.
          const currentParty = parties.find((p: Party) => p.id === pid);
          const currentRole = (currentParty?.role || "").toUpperCase();
          let otherParty: Party | undefined;
          if (currentRole === "A") {
            otherParty = parties.find((p: Party) => (p.role || "").toUpperCase() === "B");
          } else if (currentRole === "B") {
            otherParty = parties.find((p: Party) => (p.role || "").toUpperCase() === "A");
          }
          const otherPartyHasMiamMediator = !!(otherParty?.miamMediatorId);
          if (otherPartyHasMiamMediator) {
            scopedPrefill[pid] = {
              ...prefillByParty[pid],
              otherClientDob: "",
              otherClientAddress: "",
              otherClientPhone: "",
              otherClientEmail: "",
              otherPartyHasMiamMediator: true,
            };
          } else {
            scopedPrefill[pid] = { ...prefillByParty[pid], otherPartyHasMiamMediator: false };
          }
        }
        scopedRecords = scopedRecords.map(record => {
          if (scopedPrefill[record.partyId]?.otherPartyHasMiamMediator) {
            return {
              ...record,
              otherClientDob: null,
              otherClientAddress: null,
              otherClientPhone: null,
              otherClientEmail: null,
            };
          }
          return record;
        });

        scopedEditRequests = {};
        scopedLastFeedback = {};
        for (const record of scopedRecords) {
          if (editRequests[record.id]) scopedEditRequests[record.id] = editRequests[record.id];
          if (lastEditRequestFeedback[record.id]) scopedLastFeedback[record.id] = lastEditRequestFeedback[record.id];
        }
      }
    }

    // Authoritative case-level party flags (computed from UNSCOPED parties)
    // so MIAM-only mediators with a scoped tab list still see the correct
    // "Party B exists" / next-letter behaviour in Section 5.
    const partyBExistsOnCase = parties.some((p: Party) => (p.role || "").toUpperCase() === "B");
    const nextRoleLetterOnCase = getNextRoleLetter(parties.map((p: Party) => p.role));

    // Sort the (possibly scoped) parties by role letter (A→Z) so MIAM tabs
    // render in deterministic order regardless of insertion order.
    const sortedScopedParties = [...scopedParties].sort((a: Party, b: Party) =>
      compareRoleLetters(a.role, b.role)
    );
    const mediatorOptions = user.role === "superadmin" ? await listActiveMediatorOptions() : undefined;
    const miamValidity = await caseService.getCaseMiamValidity(caseId);
    const visiblePartyIds = new Set(scopedParties.map((party) => party.id));
    const scopedMiamValidity = {
      ...miamValidity,
      parties: miamValidity.parties.filter((party) => visiblePartyIds.has(party.partyId)),
    };

    res.json({
      records: scopedRecords,
      parties: sortedScopedParties,
      prefill: scopedPrefill,
      caseRef: caseRecord?.caseRef,
      miamValidity: scopedMiamValidity,
      ...(mediatorOptions ? { mediatorOptions } : {}),
      editRequests: scopedEditRequests,
      lastEditRequestFeedback: scopedLastFeedback,
      miamMediatorTabHidden,
      partyBExistsOnCase,
      nextRoleLetterOnCase,
    });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error fetching MIAM records:", err);
    res.status(500).json({ message: "Failed to fetch MIAM records" });
  }
});

router.get(["/api/miam-records/party/:partyId", "/api/cases/:caseId/miam/:partyId"], requirePermission("cases", "view"), async (req, res) => {
  try {
    const user = getUser(req);
    if (!isStaffRole(user.role)) {
      return res.status(403).json({ message: "MIAM records are accessible to staff only" });
    }

    const partyId = String(req.params.partyId);
    const routeCaseId = req.params.caseId ? String(req.params.caseId) : undefined;
    const party = await storage.getParty(partyId);
    if (!party) return res.status(404).json({ message: "Party not found" });

    if (routeCaseId && party.caseId !== routeCaseId) {
      return res.status(403).json({ message: "Party does not belong to this case" });
    }

    if (!(await verifyCaseAccess(party.caseId, req, res))) return;

    if (!(await verifyMiamPartyAccess(user, party, party.caseId))) {
      return res.status(403).json({ message: "You do not have access to this party's MIAM record" });
    }

    const record = await storage.getMiamRecord(party.id, party.caseId);
    res.json(record || null);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch MIAM record" });
  }
});

router.put(["/api/miam-records/party/:partyId", "/api/cases/:caseId/miam/:partyId"], requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (!isStaffRole(user.role)) {
      return res.status(403).json({ message: "MIAM records are editable by staff only" });
    }

    const partyId = String(req.params.partyId);
    const routeCaseId = req.params.caseId ? String(req.params.caseId) : undefined;
    const party = await storage.getParty(partyId);
    if (!party) return res.status(404).json({ message: "Party not found" });

    if (routeCaseId && party.caseId !== routeCaseId) {
      return res.status(403).json({ message: "Party does not belong to this case" });
    }

    if (!(await verifyCaseAccess(party.caseId, req, res))) return;

    if (!(await verifyMiamPartyAccess(user, party, party.caseId))) {
      return res.status(403).json({ message: "You do not have access to this party's MIAM record" });
    }

    const existingRecord = await storage.getMiamRecord(party.id, party.caseId);
    const currentStatus = existingRecord?.approvalStatus || "draft";
    const previousMojVoucherAppliedYes = isMiamYes(existingRecord?.mojVoucherApplied);
    const isAdminUser = user.role === "superadmin" || user.role === "subadmin";

    if (existingRecord && !isAdminUser) {
      if (currentStatus === "submitted" || currentStatus === "approved" || currentStatus === "flagged") {
        return res.status(403).json({
          message: `This MIAM record is currently "${currentStatus}" and can only be edited by an admin.`,
        });
      }
      if (currentStatus === "rejected" && existingRecord.submittedBy && existingRecord.submittedBy !== user.id) {
        return res.status(403).json({
          message: "Only the original submitter can revise and resubmit a rejected MIAM record.",
        });
      }
    }

    const parsed = miamUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid MIAM data", errors: parsed.error.flatten().fieldErrors });
    }

    let { ...updateData } = parsed.data;
    const sessionDate = updateData.sessionDate?.trim();
    if (sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) && sessionDate > getCurrentUkDateString()) {
      return res.status(400).json({ message: "sessionDate cannot be in the future" });
    }

    if (user.role === "mediator" || user.role === "subadmin") {
      const assignedMediator = await resolveMediatorName(party.miamMediatorId || party.allocatedMediatorId);
      updateData.sessionMediator = isBlankMiamHeaderValue(existingRecord?.sessionMediator)
        ? assignedMediator || null
        : existingRecord?.sessionMediator || null;
    } else if (
      user.role === "superadmin"
      && updateData.sessionMediator
      && updateData.sessionMediator !== existingRecord?.sessionMediator
    ) {
      const mediatorOptions = await listActiveMediatorOptions();
      const selectedMediator = mediatorOptions.find(m => m.name === updateData.sessionMediator);
      if (!selectedMediator) {
        return res.status(400).json({ message: "Session mediator must be an active mediator" });
      }
      updateData.sessionMediator = selectedMediator.name;
    }

    updateData = normalizeMiamDependentFields(
      updateData as Record<string, unknown>,
      (existingRecord || {}) as Record<string, unknown>,
    ) as typeof updateData;

    if (updateData.clientFirstName !== undefined || updateData.clientLastName !== undefined) {
      updateData.clientName = [updateData.clientFirstName || "", updateData.clientLastName || ""].filter(Boolean).join(" ") || null;
    }
    if (updateData.otherClientFirstName !== undefined || updateData.otherClientLastName !== undefined) {
      updateData.otherClientName = [updateData.otherClientFirstName || "", updateData.otherClientLastName || ""].filter(Boolean).join(" ") || null;
    }
    const record = await storage.upsertMiamRecord(party.id, party.caseId, updateData);
    const currentMojVoucherAppliedYes = isMiamYes(record.mojVoucherApplied);
    const mojVoucherAppliedChangedToYes = !previousMojVoucherAppliedYes && currentMojVoucherAppliedYes;

    let approvalStatusChanged = false;
    let newApprovalStatus = currentStatus;

    if (isAdminUser) {
      if (currentStatus !== "approved") {
        await storage.updateMiamApprovalStatus(record.id, {
          approvalStatus: "approved",
          ...(!existingRecord ? { submittedBy: user.id, submittedAt: new Date() } : {}),
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNotes: null,
        });
        approvalStatusChanged = true;
        newApprovalStatus = "approved";
      }
    } else if (!existingRecord || currentStatus === "draft") {
      await storage.updateMiamApprovalStatus(record.id, {
        approvalStatus: "submitted",
        submittedBy: user.id,
        submittedAt: new Date(),
      });
      approvalStatusChanged = true;
      newApprovalStatus = "submitted";
    } else if (currentStatus === "rejected") {
      await storage.updateMiamApprovalStatus(record.id, {
        approvalStatus: "submitted",
        submittedBy: user.id,
        submittedAt: new Date(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
      });
      approvalStatusChanged = true;
      newApprovalStatus = "submitted";
    }

    if (isAdminUser && existingRecord) {
      const pendingReq = await storage.getPendingMiamEditRequest(record.id);
      if (pendingReq) {
        await storage.updateMiamEditRequestStatus(pendingReq.id, {
          status: "approved",
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNotes: `Auto-resolved: ${user.name} directly edited and saved the MIAM record`,
        });
        await caseActivityService.log({
          caseId: party.caseId,
          type: "note_added",
          title: "MIAM edit request auto-resolved",
          description: `Pending edit request was auto-resolved because ${user.name} directly edited and saved the MIAM record.`,
          actor: staffActor(user),
        });
      }
    }

    const shouldRefreshMiamVoucherCaseCache =
      approvalStatusChanged || (currentStatus === "approved" && mojVoucherAppliedChangedToYes);
    const shouldEnsureMiamVoucherComplianceForms =
      newApprovalStatus === "approved" && (approvalStatusChanged || (currentStatus === "approved" && mojVoucherAppliedChangedToYes));

    if (approvalStatusChanged) {
      const statusRecord = await storage.getMiamRecordById(record.id) || record;
      await caseActivityService.log({
        caseId: party.caseId,
        type: `miam_${newApprovalStatus}`,
        title: `MIAM record ${newApprovalStatus}`,
        description: `MIAM record for ${party.firstName} ${party.lastName} (Client ${party.role}) status changed to "${newApprovalStatus}" by ${user.name}`,
        metadata: miamActivityMetadata(statusRecord, party, newApprovalStatus, user.id),
        actor: staffActor(user),
        relatedEntityId: record.id,
        relatedEntityType: "miam_record",
      });
      if (approvalStatusChanged && newApprovalStatus === "submitted" && !isAdminUser) {
        await createMiamReviewRequiredNotification(statusRecord, party, user);
      }
    }

    if (shouldRefreshMiamVoucherCaseCache) {
      caseService.refreshCaseFilterCache(party.caseId).catch(() => {});
    }
    if (shouldEnsureMiamVoucherComplianceForms) {
      await mediationSessionService.ensureMiamVoucherComplianceForms(party.caseId, user, req.ip);
    }

    await logAudit({
      userId: user.id,
      action: "update",
      entity: "miam_record",
      entityId: record.id,
      details: `Updated MIAM record for party ${party.firstName} ${party.lastName}${approvalStatusChanged ? ` (status: ${newApprovalStatus})` : ""}`,
      ipAddress: req.ip,
    });

    let clientBCreated = false;
    let clientBName = "";

    const otherFirstName = parsed.data.otherClientFirstName?.trim() || "";
    const otherLastName = parsed.data.otherClientLastName?.trim() || "";
    const otherFullName = parsed.data.otherClientName?.trim() || "";
    const hasOtherName = otherFirstName || otherFullName;

    // NOTE: This auto-creation path is intentionally A/B-only.
    // It only fires when the MIAM "Other Client's Details" form has been filled in
    // and Party B does not yet exist on the case. Once Party B exists, the MIAM
    // tab swaps the free-text "Other Client" form for a structured AddPartyCard
    // that calls POST /api/cases/:caseId/parties to add Party C, D, … (A→Z).
    if (hasOtherName) {
      const existingParties = await storage.listPartiesByCase(party.caseId);
      const hasClientB = existingParties.some((p: Party) => p.role === "B");

      if (!hasClientB) {
        let firstName: string;
        let lastName: string;
        if (otherFirstName) {
          firstName = otherFirstName;
          lastName = otherLastName || "-";
        } else {
          const lastSpaceIdx = otherFullName.lastIndexOf(" ");
          firstName = lastSpaceIdx > 0 ? otherFullName.substring(0, lastSpaceIdx) : otherFullName;
          lastName = lastSpaceIdx > 0 ? otherFullName.substring(lastSpaceIdx + 1) : "-";
        }

        const addResult = await clientService.createClient({
          caseId: party.caseId,
          role: "B",
          firstName,
          lastName,
          email: parsed.data.otherClientEmail || undefined,
          phone: parsed.data.otherClientPhone || undefined,
          dateOfBirth: parsed.data.otherClientDob || undefined,
          addressLine1: parsed.data.otherClientAddress || undefined,
        });

        if (addResult.ok) {
          clientBCreated = true;
          clientBName = `${firstName} ${lastName}`.trim();

          await caseActivityService.log({
            caseId: party.caseId,
            type: "client_added",
            title: "Client B added from MIAM",
            description: `${clientBName} was automatically added as Client B from MIAM record`,
            actor: staffActor(user),
          });

          await logAudit({
            userId: user.id,
            action: "create",
            entity: "party",
            entityId: addResult.party.id,
            details: `Auto-created Client B (${clientBName}) from MIAM Other Client's Details`,
            ipAddress: req.ip,
          });
        } else {
          console.error("[MiamRecordRoutes] Failed to auto-create Client B:", addResult.error);
        }
      }
    }

    let stageUpdated = false;
    let newStage = "";

    // NOTE: MIAM stage auto-progression is intentionally A/B-only.
    // The CASE_STAGES pipeline only models Client A and Client B MIAM milestones;
    // saving MIAM records for Party C, D, … (added via the generic add-party flow)
    // does not advance the case stage. Any non-A/B party falls through both
    // branches below as a no-op.
    if (parsed.data.suitableForMediation) {
      const caseRecord = await storage.getCase(party.caseId);
      if (caseRecord) {
        const currentStage = caseRecord.stage || "";
        const currentStageIdx = (CASE_STAGES as readonly string[]).indexOf(currentStage);

        let targetStage: string | null = null;
        let shouldAdvance = false;

        if (party.role === "A") {
          const isSuitable = parsed.data.suitableForMediation.toLowerCase().startsWith("yes");
          targetStage = isSuitable
            ? "Client A MIAM complete - suitable"
            : "Client A MIAM complete - unsuitable";
          const alreadyAtMiamComplete = currentStage === "Client A MIAM complete - suitable"
            || currentStage === "Client A MIAM complete - unsuitable";
          const suitableIdx = (CASE_STAGES as readonly string[]).indexOf("Client A MIAM complete - suitable");
          shouldAdvance = !alreadyAtMiamComplete && (currentStageIdx < 0 || currentStageIdx < suitableIdx);
        } else if (party.role === "B") {
          targetStage = "Client B MIAM completed";
          const targetIdx = (CASE_STAGES as readonly string[]).indexOf(targetStage);
          shouldAdvance = targetIdx >= 0 && (currentStageIdx < 0 || currentStageIdx < targetIdx);
        }

        if (targetStage && shouldAdvance) {
            await storage.updateCaseStage(party.caseId, targetStage);
            stageUpdated = true;
            newStage = targetStage;

            await caseActivityService.log({
              caseId: party.caseId,
              type: "stage_changed",
              title: `Case stage: ${targetStage}`,
              description: `Case stage advanced from "${caseRecord.stage}" to "${targetStage}" based on MIAM suitability assessment`,
              actor: staffActor(user),
            });

            await logAudit({
              userId: user.id,
              action: "update_stage",
              entity: "case",
              entityId: party.caseId,
              entityRef: caseRecord.caseRef,
              details: JSON.stringify({
                previousStage: caseRecord.stage,
                newStage: targetStage,
                trigger: "miam_suitability",
                suitableForMediation: parsed.data.suitableForMediation,
              }),
              ipAddress: req.ip,
            });
        }
      }
    }

    // Promote staged pending party whenever MIAM is in (or transitions to) submitted/approved.
    // This mirrors the A→B auto-create-on-submit behaviour but for Party C, D, …
    //
    const isSubmittedOrApproved = newApprovalStatus === "submitted" || newApprovalStatus === "approved";
    if (isSubmittedOrApproved) {
      // Atomically claim the pending payload (read + clear with FOR UPDATE lock).
      // Returns null if: no pending party, or a concurrent request already claimed it.
      const claimed = await storage.claimAndClearPendingPartyOnMiamRecord(record.id);

      if (claimed) {
        const { pendingPartyUserId, pendingPartyFirstName, pendingPartyLastName, pendingPartyEmail } = claimed;
        const allPartiesNow = await storage.listPartiesByCase(party.caseId);
        const nextLetter = getNextRoleLetter(allPartiesNow.map((p) => p.role));
        const caseRecordForParty = await storage.getCase(party.caseId);

        if (!nextLetter) {
          // Restore before returning so staff can unlink and retry without data loss.
          await storage.setPendingPartyOnMiamRecord(record.id, claimed);
          return res.status(422).json({
            message: "MIAM submitted but the staged party could not be added: the case has reached the maximum number of parties (A–Z). Please unlink the staged party and retry.",
            miamSaved: true,
          });
        }

        let promotionSucceeded = false;
        let promotionError = "Unexpected error during party promotion";

        try {
          if (pendingPartyUserId) {
            // Promote a linked existing user.
            // Re-validate at submission time: case membership may have changed since staging.
            const existingUser = await storage.getUser(pendingPartyUserId);
            if (!existingUser) throw new Error(`Staged user ${pendingPartyUserId} not found`);

            // Re-check duplicate-party membership (matches POST /api/cases/:caseId/parties guard)
            const isAlreadyParty = allPartiesNow.some((p) => p.userId === pendingPartyUserId);
            if (isAlreadyParty) {
              promotionError = "The staged client is already a party in this case";
            } else {
              let linkedClient = await storage.getClientByUserId(existingUser.id);
              if (!linkedClient) linkedClient = await storage.findClientByEmail(existingUser.email);
              if (!linkedClient) {
                const nameParts = (existingUser.name || "").split(" ");
                linkedClient = await storage.createClient({
                  firstName: nameParts[0] || "",
                  lastName: nameParts.slice(1).join(" ") || "",
                  email: existingUser.email,
                  userId: existingUser.id,
                });
              } else if (!linkedClient.userId) {
                await storage.updateClient(linkedClient.id, { userId: existingUser.id });
              }

              const newParty = await storage.createParty({
                caseId: party.caseId,
                clientId: linkedClient.id,
                role: nextLetter,
                portalStatus: existingUser.status === "active" ? "active" : "inactive",
              });
              promotionSucceeded = true;
              try {
                await logAudit({
                  userId: user.id,
                  action: "link_party",
                  entity: "party",
                  entityId: newParty.id,
                  entityRef: caseRecordForParty?.caseRef,
                  details: `Linked ${existingUser.name} (${existingUser.email}) as Party ${nextLetter} on MIAM submission`,
                  ipAddress: req.ip,
                });
                await caseActivityService.log({
                  caseId: party.caseId,
                  type: "party_linked",
                  title: `Party ${nextLetter} linked`,
                  description: `${existingUser.name} (${existingUser.email}) was linked as Party ${nextLetter} when MIAM was submitted.`,
                  actor: staffActor(user),
                  relatedEntityId: newParty.id,
                  relatedEntityType: "party",
                });
              } catch (logErr) {
                console.error("[MiamRecordRoutes] Promotion audit/activity log failed (non-fatal):", logErr);
              }
            }

          } else if (pendingPartyFirstName) {
            // Promote a brand-new pending person.
            // Validate email against existing accounts to match POST /api/cases/:caseId/parties semantics.
            const firstName = pendingPartyFirstName;
            const lastName = pendingPartyLastName || "-";
            const email = pendingPartyEmail || undefined;

            if (email) {
              const existingUserWithEmail = await storage.getUserByEmail(email);
              if (existingUserWithEmail && existingUserWithEmail.role !== "client") {
                promotionError = `The email ${email} belongs to a staff account and cannot be used for a client`;
              } else if (existingUserWithEmail && allPartiesNow.some((p) => p.userId === existingUserWithEmail.id)) {
                promotionError = "A client with this email is already a party in this case";
              } else {
                const addResult = await clientService.createClient({
                  caseId: party.caseId,
                  role: nextLetter,
                  firstName,
                  lastName,
                  email,
                });
                if (addResult.ok) {
                  promotionSucceeded = true;
                  try {
                    await logAudit({
                      userId: user.id,
                      action: "add_party",
                      entity: "party",
                      entityId: addResult.party.id,
                      entityRef: caseRecordForParty?.caseRef,
                      details: `Added Party ${nextLetter} (${firstName} ${lastName}) on MIAM submission`,
                      ipAddress: req.ip,
                    });
                    await caseActivityService.log({
                      caseId: party.caseId,
                      type: "party_added",
                      title: `Party ${nextLetter} added`,
                      description: `${firstName} ${lastName} was added as Party ${nextLetter} when MIAM was submitted.`,
                      actor: staffActor(user),
                      relatedEntityId: addResult.party.id,
                      relatedEntityType: "party",
                    });
                  } catch (logErr) {
                    console.error("[MiamRecordRoutes] Promotion audit/activity log failed (non-fatal):", logErr);
                  }
                } else {
                  promotionError = addResult.error || "Failed to create client";
                }
              }
            } else {
              // No email — create without email validation
              const addResult = await clientService.createClient({
                caseId: party.caseId,
                role: nextLetter,
                firstName,
                lastName,
                email: undefined,
              });
              if (addResult.ok) {
                promotionSucceeded = true;
                try {
                  await logAudit({
                    userId: user.id,
                    action: "add_party",
                    entity: "party",
                    entityId: addResult.party.id,
                    entityRef: caseRecordForParty?.caseRef,
                    details: `Added Party ${nextLetter} (${firstName} ${lastName}) on MIAM submission`,
                    ipAddress: req.ip,
                  });
                  await caseActivityService.log({
                    caseId: party.caseId,
                    type: "party_added",
                    title: `Party ${nextLetter} added`,
                    description: `${firstName} ${lastName} was added as Party ${nextLetter} when MIAM was submitted.`,
                    actor: staffActor(user),
                    relatedEntityId: addResult.party.id,
                    relatedEntityType: "party",
                  });
                } catch (logErr) {
                  console.error("[MiamRecordRoutes] Promotion audit/activity log failed (non-fatal):", logErr);
                }
              } else {
                promotionError = addResult.error || "Failed to create client";
              }
            }
          }
        } catch (err) {
          promotionError = err instanceof Error ? err.message : String(err);
          console.error("[MiamRecordRoutes] Promotion attempt threw:", err);
        }

        if (!promotionSucceeded) {
          // Restore pending fields so the user can retry — even with status already "submitted".
          await storage.setPendingPartyOnMiamRecord(record.id, claimed);
          return res.status(500).json({
            message: `MIAM record was submitted but the staged party could not be added: ${promotionError}. Please retry or contact support.`,
            miamSaved: true,
          });
        }
      }
    }

    const freshRecord = await storage.getMiamRecord(party.id, party.caseId);
    res.json({ ...freshRecord, clientBCreated, clientBName, stageUpdated, newStage, approvalStatus: newApprovalStatus });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error saving MIAM record:", err);
    res.status(500).json({ message: "Failed to save MIAM record" });
  }
});

// Staging endpoints — set or clear the pending party on a MIAM record.
// These are used by Section 5 of the MIAM tab to stage a Party C/D/…
// without immediately committing them to the case.  The staged person is
// promoted to a real Party only when the MIAM record is submitted.

const setPendingPartySchema = z.union([
  z.object({ userId: z.string().min(1) }),
  z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email().max(255).optional().nullable(),
  }),
]);

router.patch("/api/miam-records/:id/pending-party", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    const allowedRoles = new Set(["superadmin", "subadmin", "mediator"]);
    if (!allowedRoles.has(user.role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const record = await storage.getMiamRecordById(req.params.id);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    if (!(await verifyCaseAccess(record.caseId, req, res))) return;

    // Enforce MIAM-party level access (matches existing MIAM route pattern)
    const miamParty = await storage.getParty(record.partyId);
    if (!miamParty) return res.status(404).json({ message: "MIAM party not found" });
    if (!(await verifyMiamPartyAccess(user, miamParty, record.caseId))) {
      return res.status(403).json({ message: "Not authorised to modify this MIAM record" });
    }

    // Status guard: non-admin users can only stage on editable (draft/rejected) records.
    const isAdmin = user.role === "superadmin" || user.role === "subadmin";
    const recordStatus = record.approvalStatus || "draft";
    if (!isAdmin && !["draft", "rejected"].includes(recordStatus)) {
      return res.status(409).json({ message: `Cannot stage a party on a MIAM record with status "${recordStatus}". The record must be in draft or rejected state.` });
    }

    const parsed = setPendingPartySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    }

    const data = parsed.data;
    let updatePayload: {
      pendingPartyUserId: string | null;
      pendingPartyFirstName: string | null;
      pendingPartyLastName: string | null;
      pendingPartyEmail: string | null;
    };

    // Guard: ensure a next role letter (C, D, …) is still available before allowing staging.
    const existingPartiesForRole = await storage.listPartiesByCase(record.caseId);
    const nextLetterForStage = getNextRoleLetter(existingPartiesForRole.map((p) => p.role));
    if (!nextLetterForStage) {
      return res.status(422).json({ message: "Cannot stage a party: this case already has the maximum number of parties (A–Z)." });
    }

    if ("userId" in data) {
      const existingUser = await storage.getUser(data.userId);
      if (!existingUser || existingUser.role !== "client") {
        return res.status(404).json({ message: "Client user not found" });
      }
      // Make sure they're not already a party on the case
      const existingParties = existingPartiesForRole;
      if (existingParties.some((p) => p.userId === data.userId)) {
        return res.status(409).json({ message: "This client is already a party in this case" });
      }
      updatePayload = {
        pendingPartyUserId: data.userId,
        pendingPartyFirstName: existingUser.name?.split(" ")[0] || null,
        pendingPartyLastName: existingUser.name?.split(" ").slice(1).join(" ") || null,
        pendingPartyEmail: existingUser.email,
      };
    } else {
      // For manual (name/email) staging, validate email eagerly to give early feedback.
      if (data.email) {
        const existingUserWithEmail = await storage.getUserByEmail(data.email);
        if (existingUserWithEmail && existingUserWithEmail.role !== "client") {
          return res.status(409).json({ message: `The email ${data.email} belongs to a staff account and cannot be used for a client` });
        }
        if (existingUserWithEmail) {
          const existingPartiesForEmail = await storage.listPartiesByCase(record.caseId);
          if (existingPartiesForEmail.some((p) => p.userId === existingUserWithEmail.id)) {
            return res.status(409).json({ message: "A client with this email is already a party in this case" });
          }
        }
      }
      updatePayload = {
        pendingPartyUserId: null,
        pendingPartyFirstName: data.firstName,
        pendingPartyLastName: data.lastName,
        pendingPartyEmail: data.email ?? null,
      };
    }

    const updated = await storage.setPendingPartyOnMiamRecord(record.id, updatePayload);

    await logAudit({
      userId: user.id,
      action: "stage_party",
      entity: "miam_record",
      entityId: record.id,
      details: `Staged pending party on MIAM record: ${"userId" in data ? `linked user ${data.userId}` : `new person ${updatePayload.pendingPartyFirstName} ${updatePayload.pendingPartyLastName}`}`,
      ipAddress: req.ip,
    });

    res.json({ record: updated });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error setting pending party:", err);
    res.status(500).json({ message: "Failed to stage pending party" });
  }
});

router.delete("/api/miam-records/:id/pending-party", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    const allowedRoles = new Set(["superadmin", "subadmin", "mediator"]);
    if (!allowedRoles.has(user.role)) {
      return res.status(403).json({ message: "Not authorised" });
    }

    const record = await storage.getMiamRecordById(req.params.id);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    if (!(await verifyCaseAccess(record.caseId, req, res))) return;

    // Enforce MIAM-party level access (matches existing MIAM route pattern)
    const miamPartyForDelete = await storage.getParty(record.partyId);
    if (!miamPartyForDelete) return res.status(404).json({ message: "MIAM party not found" });
    if (!(await verifyMiamPartyAccess(user, miamPartyForDelete, record.caseId))) {
      return res.status(403).json({ message: "Not authorised to modify this MIAM record" });
    }

    // Status guard for unlink: same policy as staging.
    const isAdminForDelete = user.role === "superadmin" || user.role === "subadmin";
    const recordStatusForDelete = record.approvalStatus || "draft";
    if (!isAdminForDelete && !["draft", "rejected"].includes(recordStatusForDelete)) {
      return res.status(409).json({ message: `Cannot unlink a staged party on a MIAM record with status "${recordStatusForDelete}".` });
    }

    const updated = await storage.setPendingPartyOnMiamRecord(record.id, {
      pendingPartyUserId: null,
      pendingPartyFirstName: null,
      pendingPartyLastName: null,
      pendingPartyEmail: null,
    });

    await logAudit({
      userId: user.id,
      action: "unstage_party",
      entity: "miam_record",
      entityId: record.id,
      details: "Cleared staged pending party from MIAM record",
      ipAddress: req.ip,
    });

    res.json({ record: updated });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error clearing pending party:", err);
    res.status(500).json({ message: "Failed to clear staged party" });
  }
});

router.post("/api/miam-records/:id/approve", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ message: "Only admins can approve MIAM records" });
    }

    const record = await storage.getMiamRecordById(req.params.id);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    if (!(await verifyCaseAccess(record.caseId, req, res))) return;

    const allowedFrom = ["submitted", "flagged", "rejected"];
    if (!allowedFrom.includes(record.approvalStatus || "")) {
      return res.status(409).json({ message: `Cannot approve a record with status "${record.approvalStatus}". Must be submitted, flagged, or rejected.` });
    }

    const updated = await storage.updateMiamApprovalStatus(record.id, {
      approvalStatus: "approved",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: null,
    });

    const party = await storage.getParty(record.partyId);

    await caseActivityService.log({
      caseId: record.caseId,
      type: "miam_approved",
      title: "MIAM record approved",
      description: `MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} (Client ${party?.role || "?"}) approved by ${user.name}`,
      metadata: party ? miamActivityMetadata(updated || record, party, "approved", user.id) : undefined,
      actor: staffActor(user),
      relatedEntityId: record.id,
      relatedEntityType: "miam_record",
    });
    await completeMiamReviewRequiredNotifications(record, "approved", user);

    await logAudit({
      userId: user.id,
      action: "approve",
      entity: "miam_record",
      entityId: record.id,
      details: `Approved MIAM record for party ${party?.firstName} ${party?.lastName}`,
      ipAddress: req.ip,
    });

    caseService.refreshCaseFilterCache(record.caseId).catch(() => {});
    await mediationSessionService.ensureMiamVoucherComplianceForms(record.caseId, user, req.ip);
    clearInvalidCimEligibilityAfterMiamChange(record.caseId, user, req.ip, "MIAM approval is no longer complete").catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error("[MiamRecordRoutes] Error approving MIAM record:", err);
    res.status(500).json({ message: "Failed to approve MIAM record" });
  }
});

router.post("/api/miam-records/:id/reject", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ message: "Only admins can reject MIAM records" });
    }

    const { notes } = req.body || {};
    if (!notes || typeof notes !== "string" || notes.trim().length === 0) {
      return res.status(400).json({ message: "Rejection notes are required" });
    }

    const record = await storage.getMiamRecordById(req.params.id);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    if (!(await verifyCaseAccess(record.caseId, req, res))) return;

    const allowedFrom = ["submitted", "flagged"];
    if (!allowedFrom.includes(record.approvalStatus || "")) {
      return res.status(409).json({ message: `Cannot reject a record with status "${record.approvalStatus}". Must be submitted or flagged.` });
    }

    const updated = await storage.updateMiamApprovalStatus(record.id, {
      approvalStatus: "rejected",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: notes.trim(),
    });

    const party = await storage.getParty(record.partyId);

    await caseActivityService.log({
      caseId: record.caseId,
      type: "miam_rejected",
      title: "MIAM record rejected",
      description: `MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} (Client ${party?.role || "?"}) rejected by ${user.name}: ${notes.trim()}`,
      metadata: party ? miamActivityMetadata(updated || record, party, "rejected", user.id) : undefined,
      actor: staffActor(user),
      relatedEntityId: record.id,
      relatedEntityType: "miam_record",
    });
    await completeMiamReviewRequiredNotifications(record, "rejected", user);

    await logAudit({
      userId: user.id,
      action: "reject",
      entity: "miam_record",
      entityId: record.id,
      details: `Rejected MIAM record for party ${party?.firstName} ${party?.lastName}: ${notes.trim()}`,
      ipAddress: req.ip,
    });

    if (record.submittedBy) {
      const submitter = await storage.getUser(record.submittedBy);
      const taskTitle = `Revise and resubmit MIAM — ${party?.firstName || ""} ${party?.lastName || ""}`.trim();
      const taskMessage = `Your MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} was rejected. Reason: ${notes.trim()}. Please revise and resubmit.`;
      await notificationService.createNotification({
        recipientId: record.submittedBy,
        recipientRole: submitter?.role || "mediator",
        type: "miam_revision_required",
        urgency: "red",
        caseId: record.caseId,
        title: taskTitle,
        message: taskMessage,
        status: "active",
      });
      await caseActivityService.logTaskCreated(record.caseId, taskTitle, "red", staffActor(user));
    }

    caseService.refreshCaseFilterCache(record.caseId).catch(() => {});
    clearInvalidCimEligibilityAfterMiamChange(record.caseId, user, req.ip, "MIAM approval is no longer complete").catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error("[MiamRecordRoutes] Error rejecting MIAM record:", err);
    res.status(500).json({ message: "Failed to reject MIAM record" });
  }
});

router.post("/api/miam-records/:id/flag", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ message: "Only admins can flag MIAM records" });
    }

    const { notes } = req.body || {};

    const record = await storage.getMiamRecordById(req.params.id);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    if (!(await verifyCaseAccess(record.caseId, req, res))) return;

    const allowedFrom = ["submitted"];
    if (!allowedFrom.includes(record.approvalStatus || "")) {
      return res.status(409).json({ message: `Cannot flag a record with status "${record.approvalStatus}". Must be submitted.` });
    }

    const updated = await storage.updateMiamApprovalStatus(record.id, {
      approvalStatus: "flagged",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: notes?.trim() || null,
    });

    const party = await storage.getParty(record.partyId);

    await caseActivityService.log({
      caseId: record.caseId,
      type: "miam_flagged",
      title: "MIAM record flagged",
      description: `MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} (Client ${party?.role || "?"}) flagged by ${user.name}${notes ? `: ${notes.trim()}` : ""}`,
      metadata: party ? miamActivityMetadata(updated || record, party, "flagged", user.id) : undefined,
      actor: staffActor(user),
      relatedEntityId: record.id,
      relatedEntityType: "miam_record",
    });
    await completeMiamReviewRequiredNotifications(record, "flagged", user);

    await logAudit({
      userId: user.id,
      action: "flag",
      entity: "miam_record",
      entityId: record.id,
      details: `Flagged MIAM record for party ${party?.firstName} ${party?.lastName}${notes ? `: ${notes.trim()}` : ""}`,
      ipAddress: req.ip,
    });

    caseService.refreshCaseFilterCache(record.caseId).catch(() => {});
    clearInvalidCimEligibilityAfterMiamChange(record.caseId, user, req.ip, "MIAM approval is no longer complete").catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error("[MiamRecordRoutes] Error flagging MIAM record:", err);
    res.status(500).json({ message: "Failed to flag MIAM record" });
  }
});

const MIAM_FIELD_LABELS: Record<string, string> = {
  sessionMediator: "Session Mediator",
  sessionDate: "Session Date",
  sessionTime: "Session Time",
  otherPeoplePresent: "Other People Present",
  caseReference: "Case Reference",
  caseType: "Case Type",
  clientName: "Client Name",
  clientDob: "Client Date of Birth",
  clientAddress: "Client Address",
  clientPhone: "Client Phone",
  howHeardAboutBfm: "How Heard About BFM",
  clientOccupation: "Client Occupation",
  clientDisability: "Client Disability",
  clientAccessibility: "Client Accessibility",
  clientEthnicity: "Client Ethnicity",
  clientReligiousCulturalNeeds: "Religious/Cultural Needs",
  clientNewPartner: "Client New Partner",
  introNotes: "Introduction Notes",
  introPurposeDiscussed: "Purpose Discussed",
  introConfidentialityExplained: "Confidentiality Explained",
  children: "Children",
  otherClientName: "Other Client Name",
  otherClientDob: "Other Client DOB",
  otherClientAddress: "Other Client Address",
  otherClientPhone: "Other Client Phone",
  otherClientEmail: "Other Client Email",
  married: "Married",
  dateOfMarriage: "Date of Marriage",
  livedTogether: "Lived Together",
  dateOfCohabitation: "Date of Cohabitation",
  dateOfSeparation: "Date of Separation",
  bothParentsPr: "Both Parents PR",
  prIsIssue: "PR Is Issue",
  divorceStarted: "Divorce Started",
  divorceStartedDate: "Divorce Started Date",
  petitioner: "Petitioner",
  decreeNisiDate: "Decree Nisi Date",
  decreeAbsoluteDate: "Decree Absolute Date",
  courtOrders: "Court Orders",
  applicationsToCourtText: "Applications to Court",
  checklist: "Checklist",
  backgroundNotes: "Background Notes",
  bgWhatBringsYou: "What Brings You",
  bgLivingArrangements: "Living Arrangements",
  bgChildrenDetails: "Children Details",
  bgContactArrangements: "Contact Arrangements",
  welfareOfChildren: "Welfare of Children",
  welfareAgencyContacted: "Welfare Agency Contacted",
  welfareAgencyName: "Welfare Agency Name",
  welfareAgencyDate: "Welfare Agency Date",
  welfareAgencyTime: "Welfare Agency Time",
  welfareNotes: "Welfare Notes",
  welfareChildrensServices: "Children's Services",
  welfareSafetyConcerns: "Safety Concerns",
  welfareWitnessedConflict: "Witnessed Conflict",
  welfareInjuriesBehaviouralChanges: "Injuries/Behavioural Changes",
  welfareSafeguardingPlans: "Safeguarding Plans",
  childInclusiveExplained: "Child Inclusive Explained",
  childInclusiveClientResponse: "Child Inclusive Client Response",
  childInclusiveConfidentialityExplained: "Child Inclusive Confidentiality",
  childInclusiveNotes: "Child Inclusive Notes",
  childInclusiveConsentAgreed: "Child Inclusive Consent",
  domesticAbuseScreening: "DA Screening",
  daHurtOrScared: "DA Hurt or Scared",
  daPoliceInvolved: "DA Police Involved",
  daPhysical: "DA Physical",
  daPowerControl: "DA Power/Control",
  daFeelSafe: "DA Feel Safe",
  daFinancialControl: "DA Financial Control",
  daPermissionToDecide: "DA Permission to Decide",
  daAfraidOfReaction: "DA Afraid of Reaction",
  domesticAbuseSafetyConclusions: "DA Safety Conclusions",
  domesticAbuseSupportServices: "DA Support Services",
  domesticAbuseSupportServicesOther: "Other DA Support Service",
  domesticAbuseLegalAidInfo: "DA Legal Aid Info",
  domesticAbuseNotes: "DA Notes",
  emotionalReadiness: "Emotional Readiness",
  erEqualBasis: "ER Equal Basis",
  erChoosingFreely: "ER Choosing Freely",
  erPressuredToAttend: "ER Pressured to Attend",
  erCanWithdraw: "ER Can Withdraw",
  erSameRoom: "ER Same Room",
  erCapacity: "ER Capacity",
  safetyMeasuresDiscussed: "Safety Measures Discussed",
  safetyMeasuresAgreed: "Safety Measures Agreed",
  issuesForMediation: "Issues for Mediation",
  issuesOther: "Issues Other",
  furtherInfoRequested: "Further Info Requested",
  furtherInfoOther: "Further Info Other",
  suitableForMediation: "Suitable for Mediation",
  suitabilityReasons: "Suitability Reasons",
  nextSteps: "Next Steps",
  mediationType: "Mediation Type",
  timeline: "Timeline",
  agreedWithClient: "Agreed With Client",
  ofsRequired: "OFS Required",
  mouRequired: "MOU Required",
  statementOfChildArrangements: "Statement of Child Arrangements",
  ppcRequired: "PPC Required",
  ppcReason: "PPC Reason",
  ppcReasonOther: "Other PPC Reason",
  ppcDate: "PPC Date",
  ppcConsultantName: "PPC Consultant Name",
  ppcOutcomes: "PPC Outcomes",
  referralToCafcass: "Referral to Cafcass",
  referralToChildrenServices: "Referral to Children Services",
  referralToChildrenServicesDetails: "Referral Details",
  referralFollowUpContact: "Referral Follow-up",
  feePerSession: "Fee Per Session",
  totalEstimatedFee: "Total Estimated Fee",
  mojVoucherApplied: "MOJ Voucher Applied",
  legalAidApplied: "Legal Aid Applied",
  paymentMethod: "Payment Method",
  followUpContactRequired: "Follow-up Contact Required",
};

function computeChangedFields(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>
): { proposedChanges: Record<string, unknown>; originalValues: Record<string, unknown> } {
  const proposedChanges: Record<string, unknown> = {};
  const originalValues: Record<string, unknown> = {};
  const skipFields = new Set(["id", "partyId", "caseId", "createdAt", "updatedAt", "approvalStatus", "submittedBy", "submittedAt", "reviewedBy", "reviewedAt", "reviewNotes"]);

  for (const [key, newVal] of Object.entries(proposed)) {
    if (skipFields.has(key)) continue;
    const oldVal = current[key];
    const oldStr = JSON.stringify(oldVal ?? null);
    const newStr = JSON.stringify(newVal ?? null);
    if (oldStr !== newStr) {
      proposedChanges[key] = newVal;
      originalValues[key] = oldVal ?? null;
    }
  }
  return { proposedChanges, originalValues };
}

router.post("/api/miam-edit-requests", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (!isStaffRole(user.role) || user.role === "superadmin") {
      return res.status(403).json({ message: "Only mediators and subadmins can submit edit requests" });
    }

    const { miamRecordId, proposedData, requestNote } = req.body;
    if (!miamRecordId || !proposedData) {
      return res.status(400).json({ message: "miamRecordId and proposedData are required" });
    }

    const record = await storage.getMiamRecordById(miamRecordId);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    if (!(await verifyCaseAccess(record.caseId, req, res))) return;
    const recordParty = await storage.getParty(record.partyId);
    if (!recordParty || !(await verifyMiamPartyAccess(user, recordParty, record.caseId))) {
      return res.status(403).json({ message: "You do not have access to this party's MIAM record" });
    }

    const lockedStatuses = ["submitted", "approved", "flagged"];
    if (!lockedStatuses.includes(record.approvalStatus || "")) {
      return res.status(409).json({ message: "Edit requests can only be made on submitted, approved, or flagged records" });
    }

    const existingPending = await storage.getPendingMiamEditRequest(miamRecordId);
    if (existingPending) {
      return res.status(409).json({ message: "There is already a pending edit request for this record" });
    }

    const parsed = miamUpdateSchema.safeParse(proposedData);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid proposed data", errors: parsed.error.flatten().fieldErrors });
    }

    const currentData = record as Record<string, unknown>;
    const normalizedProposedData = normalizeMiamDependentFields(parsed.data as Record<string, unknown>, currentData);
    const { proposedChanges, originalValues } = computeChangedFields(currentData, normalizedProposedData);

    if (Object.keys(proposedChanges).length === 0) {
      return res.status(400).json({ message: "No changes detected" });
    }

    const editRequest = await storage.createMiamEditRequest({
      miamRecordId: record.id,
      caseId: record.caseId,
      requestedBy: user.id,
      proposedChanges,
      originalValues,
      requestNote: requestNote?.trim() || undefined,
    });

    const party = await storage.getParty(record.partyId);
    const caseRecord = await storage.getCase(record.caseId);
    const changedFieldNames = Object.keys(proposedChanges).map(k => MIAM_FIELD_LABELS[k] || k).join(", ");

    await caseActivityService.log({
      caseId: record.caseId,
      type: "note_added",
      title: "MIAM edit request submitted",
      description: `${user.name} requested edits to MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} (Client ${party?.role || "?"}). Changed fields: ${changedFieldNames}`,
      actor: staffActor(user),
    });

    await logAudit({
      userId: user.id,
      action: "create",
      entity: "miam_edit_request",
      entityId: editRequest.id,
      details: `Edit request for MIAM record (${record.id}). Fields: ${changedFieldNames}`,
      ipAddress: req.ip,
    });

    const superadmins = (await storage.listUsers()).filter(u => u.role === "superadmin");
    for (const sa of superadmins) {
      await notificationService.createNotification({
        recipientId: sa.id,
        recipientRole: "admin",
        type: "held",
        urgency: "amber",
        caseId: record.caseId,
        appointmentId: null,
        title: `MIAM edit request — ${party?.firstName || ""} ${party?.lastName || ""}`,
        message: `${user.name} has requested changes to the MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} (Case ${caseRecord?.caseRef || ""}). ${Object.keys(proposedChanges).length} field(s) changed.`,
        caseNoteRequired: false,
      });
    }

    await caseActivityService.log({
      caseId: record.caseId,
      type: "task_created",
      title: "MIAM edit request task created",
      description: `Task created for superadmin review: ${user.name} requested edits to MIAM record for ${party?.firstName || ""} ${party?.lastName || ""} (${Object.keys(proposedChanges).length} field(s)).`,
      actor: staffActor(user),
    });

    res.status(201).json(editRequest);
  } catch (err) {
    console.error("[MiamRecordRoutes] Error creating edit request:", err);
    res.status(500).json({ message: "Failed to create edit request" });
  }
});

router.get("/api/miam-edit-requests/:miamRecordId", requirePermission("cases", "view"), async (req, res) => {
  try {
    const user = getUser(req);
    if (!isStaffRole(user.role)) {
      return res.status(403).json({ message: "Staff only" });
    }

    const pending = await storage.getPendingMiamEditRequest(req.params.miamRecordId);
    if (!pending) return res.json(null);

    if (!(await verifyCaseAccess(pending.caseId, req, res))) return;
    const pendingRecord = await storage.getMiamRecordById(pending.miamRecordId);
    const pendingParty = pendingRecord ? await storage.getParty(pendingRecord.partyId) : null;
    if (!pendingParty || !(await verifyMiamPartyAccess(user, pendingParty, pending.caseId))) {
      return res.status(403).json({ message: "You do not have access to this party's MIAM record" });
    }

    const requester = await storage.getUser(pending.requestedBy);
    res.json({ ...pending, requesterName: requester?.name || "Unknown" });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch edit request" });
  }
});

router.post("/api/miam-edit-requests/:id/approve", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin") {
      return res.status(403).json({ message: "Only superadmins can approve edit requests" });
    }

    const editRequest = await storage.getMiamEditRequestById(req.params.id);
    if (!editRequest) return res.status(404).json({ message: "Edit request not found" });

    if (editRequest.status !== "pending") {
      return res.status(409).json({ message: `Cannot approve an edit request with status "${editRequest.status}"` });
    }

    if (!(await verifyCaseAccess(editRequest.caseId, req, res))) return;

    const record = await storage.getMiamRecordById(editRequest.miamRecordId);
    if (!record) return res.status(404).json({ message: "MIAM record not found" });

    const changes = editRequest.proposedChanges as Record<string, unknown>;
    const overrides = req.body?.overrides as Record<string, unknown> | undefined;
    let finalChanges = overrides ? { ...changes, ...overrides } : changes;

    const parsed = miamUpdateSchema.safeParse(finalChanges);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid override data", errors: parsed.error.flatten().fieldErrors });
    }
    finalChanges = normalizeMiamDependentFields(parsed.data as Record<string, unknown>, record as Record<string, unknown>);

    await storage.upsertMiamRecord(record.partyId, record.caseId, finalChanges as Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt">>);

    await storage.updateMiamApprovalStatus(record.id, {
      approvalStatus: "approved",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: null,
    });

    await storage.updateMiamEditRequestStatus(editRequest.id, {
      status: "approved",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: null,
    });

    const party = await storage.getParty(record.partyId);
    const changedFieldNames = Object.keys(finalChanges).map(k => MIAM_FIELD_LABELS[k] || k).join(", ");

    await caseActivityService.log({
      caseId: record.caseId,
      type: "note_added",
      title: "MIAM edit request approved",
      description: `${user.name} approved edit request for MIAM record (${party?.firstName || ""} ${party?.lastName || ""}). Applied changes: ${changedFieldNames}`,
      actor: staffActor(user),
    });

    await logAudit({
      userId: user.id,
      action: "approve",
      entity: "miam_edit_request",
      entityId: editRequest.id,
      details: `Approved edit request for MIAM record (${record.id}). Applied fields: ${changedFieldNames}`,
      ipAddress: req.ip,
    });

    const freshRecord = await storage.getMiamRecord(record.partyId, record.caseId);
    caseService.refreshCaseFilterCache(record.caseId).catch(() => {});
    await mediationSessionService.ensureMiamVoucherComplianceForms(record.caseId, user, req.ip);
    res.json({ editRequest: { ...editRequest, status: "approved" }, record: freshRecord });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error approving edit request:", err);
    res.status(500).json({ message: "Failed to approve edit request" });
  }
});

router.post("/api/miam-edit-requests/:id/reject", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin") {
      return res.status(403).json({ message: "Only superadmins can reject edit requests" });
    }

    const { notes } = req.body || {};
    if (!notes || typeof notes !== "string" || notes.trim().length === 0) {
      return res.status(400).json({ message: "Rejection notes are required" });
    }

    const editRequest = await storage.getMiamEditRequestById(req.params.id);
    if (!editRequest) return res.status(404).json({ message: "Edit request not found" });

    if (editRequest.status !== "pending") {
      return res.status(409).json({ message: `Cannot reject an edit request with status "${editRequest.status}"` });
    }

    if (!(await verifyCaseAccess(editRequest.caseId, req, res))) return;

    await storage.updateMiamEditRequestStatus(editRequest.id, {
      status: "rejected",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: notes.trim(),
    });

    const record = await storage.getMiamRecordById(editRequest.miamRecordId);
    const party = record ? await storage.getParty(record.partyId) : null;

    await caseActivityService.log({
      caseId: editRequest.caseId,
      type: "note_added",
      title: "MIAM edit request rejected",
      description: `${user.name} rejected edit request for MIAM record (${party?.firstName || ""} ${party?.lastName || ""}): ${notes.trim()}`,
      actor: staffActor(user),
    });

    await logAudit({
      userId: user.id,
      action: "reject",
      entity: "miam_edit_request",
      entityId: editRequest.id,
      details: `Rejected edit request: ${notes.trim()}`,
      ipAddress: req.ip,
    });

    res.json({ ...editRequest, status: "rejected", reviewNotes: notes.trim() });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error rejecting edit request:", err);
    res.status(500).json({ message: "Failed to reject edit request" });
  }
});

router.post("/api/miam-edit-requests/:id/flag", requirePermission("cases", "edit"), async (req, res) => {
  try {
    const user = getUser(req);
    if (user.role !== "superadmin") {
      return res.status(403).json({ message: "Only superadmins can flag edit requests" });
    }

    const { notes } = req.body || {};

    const editRequest = await storage.getMiamEditRequestById(req.params.id);
    if (!editRequest) return res.status(404).json({ message: "Edit request not found" });

    if (editRequest.status !== "pending") {
      return res.status(409).json({ message: `Cannot flag an edit request with status "${editRequest.status}"` });
    }

    if (!(await verifyCaseAccess(editRequest.caseId, req, res))) return;

    await storage.updateMiamEditRequestStatus(editRequest.id, {
      status: "flagged",
      reviewedBy: user.id,
      reviewedAt: new Date(),
      reviewNotes: notes?.trim() || null,
    });

    const record = await storage.getMiamRecordById(editRequest.miamRecordId);
    const party = record ? await storage.getParty(record.partyId) : null;

    await caseActivityService.log({
      caseId: editRequest.caseId,
      type: "note_added",
      title: "MIAM edit request flagged",
      description: `${user.name} flagged edit request for MIAM record (${party?.firstName || ""} ${party?.lastName || ""})${notes ? `: ${notes.trim()}` : ""}`,
      actor: staffActor(user),
    });

    await logAudit({
      userId: user.id,
      action: "flag",
      entity: "miam_edit_request",
      entityId: editRequest.id,
      details: `Flagged edit request${notes ? `: ${notes.trim()}` : ""}`,
      ipAddress: req.ip,
    });

    res.json({ ...editRequest, status: "flagged", reviewNotes: notes?.trim() || null });
  } catch (err) {
    console.error("[MiamRecordRoutes] Error flagging edit request:", err);
    res.status(500).json({ message: "Failed to flag edit request" });
  }
});

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, "_").replace(/_+/g, "_");
}

router.get("/api/miam-records/party/:partyId/pdf", requirePermission("cases", "view"), async (req, res) => {
  try {
    const user = getUser(req);
    if (!isStaffRole(user.role)) {
      return res.status(403).json({ message: "MIAM PDF is accessible to staff only" });
    }

    const party = await storage.getParty(req.params.partyId);
    if (!party) return res.status(404).json({ message: "Party not found" });

    if (!(await verifyCaseAccess(party.caseId, req, res))) return;

    if (!(await verifyMiamPartyAccess(user, party, party.caseId))) {
      return res.status(403).json({ message: "You do not have access to this party's MIAM record" });
    }

    const record = await storage.getMiamRecord(party.id, party.caseId);
    if (!record) {
      return res.status(404).json({ message: "No MIAM record found for this party" });
    }

    const caseRecord = await storage.getCase(party.caseId);
    const baseCaseRef = caseRecord?.caseRef || "";
    // Per-party MIAM PDF: use BFM-YYYY-####-X reference and include role in filename.
    const partyCaseRef = baseCaseRef ? formatCaseRefWithRole(baseCaseRef, party.role) : "";
    const partyName = `${party.firstName || ""}_${party.lastName || ""}`.trim();
    const filename = sanitizeFilename(`MIAM_Record_${partyCaseRef || baseCaseRef}${partyName ? `_${partyName}` : ""}.pdf`);

    const doc = generateMiamPdf(record, partyCaseRef);

    doc.on("error", (err) => {
      console.error("[MiamRecordRoutes] PDF generation stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to generate MIAM PDF" });
      }
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    doc.pipe(res);
    doc.end();

    logAudit({
      userId: user.id,
      action: "export",
      entity: "miam_record",
      entityId: record.id,
      details: `Exported MIAM record PDF for party ${party.firstName} ${party.lastName}`,
      ipAddress: req.ip,
    }).catch(err => console.error("[MiamRecordRoutes] Audit log error:", err));
  } catch (err) {
    console.error("[MiamRecordRoutes] Error generating MIAM PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to generate MIAM PDF" });
    }
  }
});

export default router;
