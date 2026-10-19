import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { mediationSessionService } from "../services/mediation-session.service";
import { financialDisclosureService } from "../services/financial-disclosure.service";
import { financeService } from "../services/finance.service";
import { stripePaymentService } from "../services/stripe-payment.service";
import { notificationService } from "../services/notification.service";
import { paymentSettingsService } from "../services/payment-settings.service";
import { logAudit } from "../services/audit-log.service";
import { storage } from "../storage";
import type { FinancialDisclosureItemStatus, User } from "@shared/schema";
import { DRAFT_FINANCIAL_SCHEDULE_STATUSES, FINANCIAL_DISCLOSURE_ITEM_STATUSES, FINANCIAL_DISCLOSURE_UPLOAD_TARGETS, findDuplicateMediationSessionRoleIds } from "@shared/schema";
import { fileStorageService } from "../services/file-storage.service";
import { classifyCaseAccess, hasFinancialCaseAccess } from "../security/case-access-policy";
import { canDownloadCaseDocument, withProtectedCaseDocumentUrl } from "../security/document-access";
import { buildClientMediationSessionView, buildCoMediatorMediationSessionView, buildCoMediatorRequiredFormView, buildObserverMediationSessionView, filterAcceptedParticipantSessions } from "../security/session-visibility";

const router = Router();

async function canAccessCaseFinance(caseId: string, user: Pick<User, "id" | "role">): Promise<boolean> {
  return hasFinancialCaseAccess(await classifyCaseAccess(caseId, user));
}

const allocationSchema = z.object({
  leadMediatorId: z.string().min(1),
  coMediatorIds: z.array(z.string().min(1)).optional().default([]),
  observerIds: z.array(z.string().min(1)).optional().default([]),
}).superRefine((value, ctx) => {
  const duplicates = findDuplicateMediationSessionRoleIds(value.leadMediatorId, value.coMediatorIds, value.observerIds);
  if (duplicates.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A mediator cannot hold more than one role in the same session",
      path: ["coMediatorIds"],
    });
  }
});

const outcomeSchema = z.object({
  outcome: z.string().min(1),
  outcomeNotes: z.string().max(5000).optional().nullable(),
});

const postSessionSummarySchema = outcomeSchema.extend({
  nextAction: z.string().max(5000).optional().nullable(),
  documentsRequired: z.string().max(5000).optional().nullable(),
  followUpRequirements: z.string().max(5000).optional().nullable(),
  nextSessionRequired: z.boolean().optional(),
});

const postSessionReviewSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  reviewNotes: z.string().max(5000).optional().nullable(),
});

const sessionNoteSchema = z.object({
  content: z.string().trim().min(1).max(10000),
});

const caseDocumentUploadSchema = z.object({
  title: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(300),
  fileData: z.string().trim().min(1),
  mimeType: z.string().trim().max(200).optional().nullable(),
  documentDate: z.coerce.date().optional().nullable(),
  fileSizeBytes: z.number().int().nonnegative().optional().nullable(),
  mediationSessionId: z.string().trim().optional().nullable(),
  financialDisclosureFolderId: z.string().trim().optional().nullable(),
  financialDisclosureItemId: z.string().trim().optional().nullable(),
  financialDisclosureEvidenceCategoryId: z.string().trim().optional().nullable(),
  financialDisclosureUploadTarget: z.enum(FINANCIAL_DISCLOSURE_UPLOAD_TARGETS).optional().nullable(),
  readyForReview: z.boolean().optional(),
  sharedWithClients: z.boolean().optional(),
});

const caseDocumentReviewSchema = z.object({
  reviewStatus: z.string().min(1),
  sharedWithClients: z.boolean().optional(),
});

const documentBlankFormUploadSchema = z.object({
  signerName: z.string().min(1).max(200),
  signedAt: z.coerce.date(),
  fileName: z.string().trim().min(1).max(300),
  fileData: z.string().trim().min(1),
  mimeType: z.string().trim().max(200).optional().nullable(),
});

const financialDisclosureItemPatchSchema = z.object({
  status: z.enum(FINANCIAL_DISCLOSURE_ITEM_STATUSES).optional(),
  payload: z.record(z.unknown()).optional(),
});

const bookletSectionPatchSchema = z.object({
  status: z.enum(["not_started", "in_progress", "completed", "submitted"]),
  answers: z.record(z.unknown()).optional(),
  notes: z.string().max(10000).optional().nullable(),
});

const bookletSubmitSchema = z.object({});

const staffAnnotationPatchSchema = z.object({
  path: z.string().trim().min(1).max(500),
  note: z.string().max(5000).optional().nullable(),
  flagged: z.boolean().optional(),
});

const checklistRowPatchSchema = z.object({
  status: z.enum(["not_started", "in_progress", "completed"]),
  documentDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const draftFinancialSchedulePatchSchema = z.object({
  status: z.enum(DRAFT_FINANCIAL_SCHEDULE_STATUSES).optional(),
  payload: z.record(z.unknown()),
  presenceAttestation: z.object({
    sessionId: z.string().trim().min(1).nullable().optional(),
    bothPartiesPresent: z.boolean().optional(),
  }).optional().nullable(),
});

const draftFinancialSchedulePreviewSchema = z.object({
  payload: z.record(z.unknown()).optional().nullable(),
});

const bookletPdfPreviewSchema = z.object({
  payload: z.record(z.unknown()).optional().nullable(),
});

const bookletPdfFieldPatchSchema = z.object({
  source: z.string().trim().min(1).max(500),
  value: z.string().max(10000),
});

const financialDisclosureOfsPatchSchema = z.object({
  ofsRequired: z.enum(["yes", "no", "unknown", "waived"]).nullable(),
});

const attendanceSchema = z.object({
  noShowPartyIds: z.array(z.string().min(1)).default([]),
});

const cancelSessionSchema = z.object({
  reason: z.string().trim().min(1).max(5000),
});

const availabilityWindowSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  notes: z.string().max(1000).optional().nullable(),
});

const availabilitySchema = z.object({
  partyId: z.string().optional(),
  windows: z.array(availabilityWindowSchema).min(1).max(20),
});

const rescheduleRequestSchema = z.object({
  reason: z.string().trim().min(1).max(5000),
  windows: z.array(availabilityWindowSchema).min(1).max(20),
});

const holdSchema = z.object({
  dateTime: z.coerce.date(),
  duration: z.number().int().positive().max(480).optional(),
  voucherFormRequired: z.boolean().optional(),
});

const proposalResponseSchema = z.object({
  response: z.enum(["accepted", "declined"]),
  declineNotes: z.string().max(1000).optional().nullable(),
  windows: z.array(availabilityWindowSchema).max(20).optional(),
});

const resendRecipientLinkSchema = z.object({
  regenerateAccepted: z.boolean().optional(),
});

const durationFromQuery = (value: unknown) => {
  const n = Number.parseInt(String(value || "120"), 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 480) : 120;
};

function normalizeStripeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\?+$/, "");
  return trimmed || null;
}

const signFormSchema = z.object({
  signerName: z.string().min(1).max(200),
  attestationText: z.string().max(2000).optional().nullable(),
  confirmationTick: z.literal(true),
});

const signedFormUploadSchema = z.object({
  signerName: z.string().min(1).max(200),
  signedAt: z.coerce.date(),
  fileName: z.string().trim().min(1).max(300),
  fileData: z.string().trim().min(1),
  mimeType: z.string().trim().max(200).optional().nullable(),
  uploadNotes: z.string().max(2000).optional().nullable(),
});

const voucherClaimEligibilitySchema = z.object({
  voucherClaimEligible: z.boolean(),
});

const voucherClaimStatusSchema = z.object({
  status: z.enum(["voucher_claim_submitted", "claim_accepted", "claim_paid"]),
  opiaClaimReference: z.string().trim().max(200).optional().nullable(),
  statusDate: z.coerce.date().optional().nullable(),
});

const voucherRemittancePreviewSchema = z.object({
  csv: z.string().min(1),
});

function getUser(req: { user?: User }): User {
  return req.user as User;
}

async function sanitizeSessionsForClient<T extends {
  appointment?: Record<string, any> | null;
  requiredForms?: Array<Record<string, any>>;
  proposal?: (Record<string, any> & { recipients?: Array<Record<string, any>> }) | null;
  availabilityWindows?: Array<Record<string, any>>;
  invoices?: Array<Record<string, any>>;
  acknowledgementTasks?: Array<Record<string, any>>;
  partyAttendance?: Array<Record<string, any>>;
}>(sessions: T[], userId: string) {
  const clientParties = await storage.listPartiesByUserId(userId);
  const clientPartyIds = new Set(clientParties.map((party) => party.id));
  return sessions.map((session) => buildClientMediationSessionView(session, clientPartyIds));
}

function sanitizeSessionsForMediator<T extends {
  appointment?: Record<string, any> | null;
  invoices?: Array<Record<string, any>>;
  partyAttendance?: Array<Record<string, any>>;
}>(sessions: T[], access: "none" | "observer" | "co_mediator" | "full") {
  if (access === "observer") return sessions.map(buildObserverMediationSessionView);
  if (access === "co_mediator") return sessions.map(buildCoMediatorMediationSessionView);
  return sessions.map((session) => {
    const { invoices, partyAttendance, ...baseSession } = session;
    const sessionWithoutInvoices = { ...baseSession, partyAttendance };
    if (!session.appointment) return sessionWithoutInvoices;
    const { paymentStatus, ...appointment } = session.appointment;
    return {
      ...sessionWithoutInvoices,
      appointment,
    };
  });
}

async function sanitizeSessionMutationForActor<T extends { caseId: string }>(session: T, actor: User) {
  if (actor.role !== "mediator") return session;
  const access = await mediationSessionService.getCaseAccess(session.caseId, actor);
  return sanitizeSessionsForMediator([session], access)[0];
}

async function sanitizeRequiredFormMutationForActor<T extends { caseId: string }>(form: T, actor: User) {
  if (actor.role !== "mediator") return form;
  const access = await mediationSessionService.getCaseAccess(form.caseId, actor);
  return access === "co_mediator" ? buildCoMediatorRequiredFormView(form) : form;
}

router.get("/api/mediation-sessions/mediator-options", requirePermission("cases", "edit"), async (req, res) => {
  const user = getUser(req as any);
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only superadmins and subadmins can list mediation session mediators" });
  }
  return res.json(await mediationSessionService.listMediationRoleOptions());
});

router.get("/api/cases/:id/mediation-sessions", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req as any);
  const result = await mediationSessionService.listForCase(req.params.id, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  if (user.role === "mediator" && result.access === "none") {
    return res.json({ sessions: [], readiness: result.readiness, access: result.access, summary: result.summary });
  }
  const participantRole = result.access === "observer" ? "observer" : result.access === "co_mediator" ? "co_mediator" : null;
  const roleScopedSessions = user.role === "mediator" && participantRole
    ? filterAcceptedParticipantSessions(
        result.sessions,
        await storage.listMediationSessionParticipantsBySessionIds(result.sessions.map((session) => session.id)),
        user.id,
        participantRole,
      )
    : result.sessions;
  const sessions = user.role === "client"
    ? await sanitizeSessionsForClient(roleScopedSessions, user.id)
    : user.role === "mediator"
    ? sanitizeSessionsForMediator(roleScopedSessions, result.access)
    : roleScopedSessions;
  const summary = result.access === "observer" || result.access === "co_mediator"
    ? {
        numberOfSessions: sessions.length,
        totalMediationHours: sessions.reduce((total, session: any) => total + Number(session.appointment?.duration || 0), 0) / 60,
      }
    : result.summary;
  return res.json({
    sessions,
    readiness: result.readiness,
    access: result.access,
    summary,
  });
});

router.post("/api/cases/:id/mediation-sessions", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = allocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session allocation", issues: parsed.error.issues });

  const result = await mediationSessionService.createSession(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error, readiness: (result as any).readiness });
  return res.status(201).json(result.session);
});

router.patch("/api/mediation-sessions/:id/allocation", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = allocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session allocation", issues: parsed.error.issues });

  const result = await mediationSessionService.updateAllocation(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.session);
});

router.patch("/api/mediation-sessions/:id/outcome", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = outcomeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session outcome", issues: parsed.error.issues });

  const result = await mediationSessionService.recordOutcome(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(await sanitizeSessionMutationForActor(result.session, actor));
});

router.post("/api/mediation-sessions/:id/summary", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = postSessionSummarySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid post-session summary", issues: parsed.error.issues });

  const result = await mediationSessionService.recordPostSessionSummary(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(await sanitizeSessionMutationForActor(result.session, actor));
});

router.patch("/api/mediation-sessions/:id/post-session-review", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = postSessionReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid post-session review", issues: parsed.error.issues });

  const result = await mediationSessionService.reviewPostSessionSummary(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.session);
});

router.get("/api/mediation-sessions/:id/notes", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.listSessionNotes(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.notes);
});

router.post("/api/mediation-sessions/:id/notes", requirePermission("cases", "view"), async (req, res) => {
  const parsed = sessionNoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid session note", issues: parsed.error.issues });

  const result = await mediationSessionService.addSessionNote(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(result.note);
});

router.patch("/api/mediation-sessions/:id/attendance", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = attendanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session attendance", issues: parsed.error.issues });

  const result = await mediationSessionService.recordPartyAttendance(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(await sanitizeSessionMutationForActor(result.session, actor));
});

router.post("/api/mediation-sessions/:id/availability", requirePermission("cases", "view"), async (req, res) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid availability windows", issues: parsed.error.issues });
  const result = await mediationSessionService.submitAvailability(req.params.id, getUser(req as any), parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(result.windows);
});

router.post("/api/mediation-sessions/:id/reschedule-request", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = rescheduleRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session reschedule request", issues: parsed.error.issues });
  const result = await mediationSessionService.requestSessionReschedule(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json({ session: await sanitizeSessionMutationForActor(result.session, actor), windows: result.windows });
});

router.post("/api/mediation-sessions/:id/next-session-request", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = rescheduleRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session next-session request", issues: parsed.error.issues });
  const result = await mediationSessionService.requestNextSession(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json({ session: await sanitizeSessionMutationForActor(result.session, actor), windows: result.windows });
});

router.post("/api/mediation-sessions/:id/availability/admin", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = availabilitySchema.required({ partyId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid availability windows", issues: parsed.error.issues });
  const result = await mediationSessionService.submitAvailability(req.params.id, getUser(req as any), parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(result.windows);
});

router.get("/api/mediation-sessions/:id/availability/overlap", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.getAvailabilityOverlap(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result);
});

router.get("/api/mediation-sessions/:id/lead-mediator-available-dates", requirePermission("cases", "view"), async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : "";
  const result = await mediationSessionService.getLeadMediatorAvailableDates(req.params.id, getUser(req as any), month, durationFromQuery(req.query.duration));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ dates: result.dates, bookingPaused: result.bookingPaused, message: result.message });
});

router.get("/api/mediation-sessions/:id/lead-mediator-available-slots", requirePermission("cases", "view"), async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : "";
  const result = await mediationSessionService.getLeadMediatorAvailableSlots(req.params.id, getUser(req as any), date, durationFromQuery(req.query.duration));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ slots: result.slots, message: result.message });
});

router.post("/api/mediation-sessions/:id/propose-slot", requirePermission("cases", "edit"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session proposal", issues: parsed.error.issues });
  const result = await mediationSessionService.proposeSlot(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  const access = actor.role === "mediator" ? await mediationSessionService.getCaseAccess(result.session.caseId, actor) : "full";
  return res.status(201).json({
    session: await sanitizeSessionMutationForActor(result.session, actor),
    proposalLinks: access === "co_mediator" ? [] : result.proposalLinks,
  });
});

router.post("/api/mediation-sessions/:id/propose-next-session", requirePermission("cases", "view"), async (req, res) => {
  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid next mediation session proposal", issues: parsed.error.issues });
  const result = await mediationSessionService.proposeNextSession(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json({ session: result.session, proposalLinks: result.proposalLinks });
});

router.post("/api/mediation-sessions/:id/replace-proposed-slot", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid replacement mediation session proposal", issues: parsed.error.issues });
  const result = await mediationSessionService.replaceProposedSlot(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json({ session: result.session, proposalLinks: result.proposalLinks });
});

router.post("/api/mediation-sessions/:id/release-hold", requirePermission("cases", "edit"), async (req, res) => {
  const result = await mediationSessionService.releaseSessionHold(req.params.id, getUser(req as any), req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.session);
});

router.get("/api/cases/:id/documents", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.listCaseDocuments(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.documents);
});

router.get("/api/case-documents/:documentId/download", requirePermission("cases", "view"), async (req, res, next) => {
  const user = getUser(req as any);
  const document = await storage.getCaseDocument(req.params.documentId);
  const access = document ? await classifyCaseAccess(document.caseId, user) : { tier: "none" as const };
  if (!document || !canDownloadCaseDocument(document, access) || !document.storageKey) {
    await logAudit({
      userId: user.id,
      action: "case_document_download_denied",
      entity: "case_document",
      entityId: req.params.documentId,
      details: JSON.stringify({ role: user.role }),
      ipAddress: req.ip,
    });
    return res.status(404).json({ message: "Document not found" });
  }

  try {
    const file = await fileStorageService.openCaseDocumentByStorageKey(document.storageKey);
    const safeFileName = (document.fileName || document.title || "document")
      .replace(/["\r\n\\/]+/g, "_")
      .slice(0, 240);
    res.setHeader("Content-Type", document.mimeType || file.contentType || "application/octet-stream");
    if (file.contentLength != null) res.setHeader("Content-Length", String(file.contentLength));
    res.setHeader("Content-Disposition", `inline; filename="${safeFileName}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    await logAudit({
      userId: user.id,
      action: "case_document_downloaded",
      entity: "case_document",
      entityId: document.id,
      entityRef: document.caseId,
      ipAddress: req.ip,
    });
    file.body.on("error", next);
    return file.body.pipe(res);
  } catch (error) {
    return next(error);
  }
});

router.get("/api/cases/:id/document-blank-forms", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.listDocumentBlankForms(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.forms);
});

router.get("/api/cases/:id/document-blank-forms/:templateId/download", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.downloadDocumentBlankForm(req.params.id, req.params.templateId, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `${result.contentDisposition}; filename="${result.fileName}"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.send(result.buffer);
});

router.post("/api/cases/:id/document-blank-forms/:templateId/upload", requirePermission("cases", "view"), async (req, res) => {
  const parsed = documentBlankFormUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid completed form upload", issues: parsed.error.issues });
  const result = await mediationSessionService.uploadDocumentBlankForm(req.params.id, req.params.templateId, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(result.document);
});

router.get("/api/cases/:id/financial-disclosure-folders", requirePermission("cases", "view"), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  await financialDisclosureService.ensureFinancialDisclosureFoldersForCase(req.params.id, "case_type_update", user);
  const folders = await financialDisclosureService.getVisibleFoldersForCase(req.params.id, user);
  return res.json(folders);
});

router.get("/api/cases/:id/financial-disclosure-booklet/combined", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  await financialDisclosureService.ensureFinancialDisclosureFoldersForCase(req.params.id, "case_type_update", user);
  const result = await financialDisclosureService.getCombinedBookletView(req.params.id, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.combined);
});

router.get("/api/cases/:id/draft-financial-schedule", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  await financialDisclosureService.ensureFinancialDisclosureFoldersForCase(req.params.id, "case_type_update", user);
  const result = await financialDisclosureService.getDraftFinancialSchedule(req.params.id, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({
    schedule: result.schedule,
    payload: result.payload,
    latestVersion: result.latestVersion,
    versions: result.versions,
    editability: result.editability,
    pdfPreview: result.pdfPreview,
    reviewContext: result.reviewContext,
  });
});

router.patch("/api/cases/:id/draft-financial-schedule", requirePermission("cases", "view"), async (req, res) => {
  const parsed = draftFinancialSchedulePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid draft financial schedule", issues: parsed.error.issues });
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.saveDraftFinancialSchedule(req.params.id, user, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  const refreshed = await financialDisclosureService.getDraftFinancialSchedule(req.params.id, user);
  if (!refreshed.ok) return res.status(refreshed.status).json({ message: refreshed.error });
  return res.json({
    schedule: result.schedule,
    payload: result.payload,
    latestVersion: refreshed.latestVersion,
    versions: refreshed.versions,
    editability: refreshed.editability,
    pdfPreview: refreshed.pdfPreview,
    reviewContext: refreshed.reviewContext,
  });
});

router.post("/api/cases/:id/draft-financial-schedule/preview.pdf", requirePermission("cases", "view"), async (req, res) => {
  const parsed = draftFinancialSchedulePreviewSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid draft financial schedule preview", issues: parsed.error.issues });
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.previewDraftFinancialSchedulePdf(req.params.id, user, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${result.filename}"`);
  return res.send(result.buffer);
});

router.get("/api/cases/:id/draft-financial-schedule/export.pdf", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.exportDraftFinancialSchedulePdf(req.params.id, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  return res.send(result.buffer);
});

router.get("/api/cases/:id/financial-disclosure-booklet/:partyId/pdf-preview-state", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.getFinancialDisclosureBookletPdfPreviewState(req.params.id, req.params.partyId, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result);
});

router.post("/api/cases/:id/financial-disclosure-booklet/:partyId/preview.pdf", requirePermission("cases", "view"), async (req, res) => {
  const parsed = bookletPdfPreviewSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid financial disclosure booklet PDF preview", issues: parsed.error.issues });
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.previewFinancialDisclosureBookletPdf(req.params.id, req.params.partyId, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${result.filename}"`);
  return res.send(result.buffer);
});

router.get("/api/cases/:id/financial-disclosure-booklet/:partyId/export.pdf", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.exportFinancialDisclosureBookletPdf(req.params.id, req.params.partyId, user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  return res.send(result.buffer);
});

router.patch("/api/cases/:id/financial-disclosure-booklet/:partyId/pdf-field", requirePermission("cases", "view"), async (req, res) => {
  const parsed = bookletPdfFieldPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid financial disclosure booklet PDF field update", issues: parsed.error.issues });
  const user = getUser(req as any);
  if (!(await canAccessCaseFinance(req.params.id, user))) return res.status(403).json({ message: "Access denied" });
  const result = await financialDisclosureService.updateBookletPdfField(req.params.id, req.params.partyId, user, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.item);
});

router.post("/api/cases/:id/documents", requirePermission("cases", "view"), async (req, res) => {
  const parsed = caseDocumentUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid case document upload", issues: parsed.error.issues });
  const result = await mediationSessionService.uploadCaseDocument(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(result.document);
});

router.patch("/api/case-documents/:id/review", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = caseDocumentReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid document review update", issues: parsed.error.issues });
  const result = await mediationSessionService.updateCaseDocumentReview(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.document);
});

router.patch("/api/financial-disclosure-items/:id", requirePermission("cases", "view"), async (req, res) => {
  const parsed = financialDisclosureItemPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid financial disclosure item update", issues: parsed.error.issues });
  const item = await storage.getFinancialDisclosureItem(req.params.id);
  if (!item) return res.status(404).json({ message: "Financial disclosure item not found" });
  const folder = await storage.getFinancialDisclosureFolder(item.folderId);
  if (!folder) return res.status(404).json({ message: "Financial disclosure folder not found" });
  const actor = getUser(req as any);
  if (!(await canAccessCaseFinance(folder.caseId, actor))) return res.status(403).json({ message: "Access denied" });
  if (!financialDisclosureService.canUpdateItem(actor, item, folder)) {
    return res.status(403).json({ message: "Not authorised to update this financial disclosure item" });
  }
  const updated = await financialDisclosureService.updateItem(req.params.id, actor, parsed.data as { status?: FinancialDisclosureItemStatus; payload?: Record<string, unknown> });
  if (!updated) return res.status(400).json({ message: "Could not update financial disclosure item" });
  return res.json(updated);
});

router.patch("/api/financial-disclosure-items/:id/booklet-sections/:sectionKey", requirePermission("cases", "view"), async (req, res) => {
  const parsed = bookletSectionPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid booklet section update", issues: parsed.error.issues });
  const result = await financialDisclosureService.updateBookletSection(req.params.id, getUser(req as any), req.params.sectionKey, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.item);
});

router.post("/api/financial-disclosure-items/:id/booklet-submit", requirePermission("cases", "view"), async (req, res) => {
  const parsed = bookletSubmitSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid booklet submit request", issues: parsed.error.issues });
  const result = await financialDisclosureService.submitBooklet(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.item);
});

router.patch("/api/financial-disclosure-items/:id/booklet-annotations", requirePermission("cases", "view"), async (req, res) => {
  const parsed = staffAnnotationPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid booklet annotation update", issues: parsed.error.issues });
  const result = await financialDisclosureService.updateBookletAnnotation(req.params.id, getUser(req as any), parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.item);
});

router.patch("/api/financial-disclosure-items/:id/checklist-rows/:rowKey", requirePermission("cases", "view"), async (req, res) => {
  const parsed = checklistRowPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid checklist row update", issues: parsed.error.issues });
  const result = await financialDisclosureService.updateChecklistRow(req.params.id, getUser(req as any), req.params.rowKey, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.item);
});

router.patch("/api/financial-disclosure-folders/:folderId/ofs", requirePermission("cases", "view"), async (req, res) => {
  const parsed = financialDisclosureOfsPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid OFS update", issues: parsed.error.issues });
  const actor = getUser(req as any);
  const result = await financialDisclosureService.updateFolderOfsRequired(req.params.folderId, actor, parsed.data.ofsRequired);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.folder);
});

router.post("/api/mediation-session-proposals/:id/resend-links", requirePermission("cases", "edit"), async (req, res) => {
  const result = await mediationSessionService.resendProposalLinks(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ proposalLinks: result.proposalLinks });
});

router.post("/api/mediation-session-proposal-recipients/:id/resend-link", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = resendRecipientLinkSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid recipient resend request", issues: parsed.error.issues });
  const result = await mediationSessionService.resendProposalRecipientLink(req.params.id, getUser(req as any), parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ proposalLinks: result.proposalLinks });
});

router.post("/api/mediation-session-proposal-recipients/:id/whatsapp-template", requirePermission("cases", "edit"), requirePermission("whatsapp", "edit"), async (req, res) => {
  const user = getUser(req as any);
  if (!["superadmin", "subadmin"].includes(user.role)) return res.status(403).json({ message: "Case WhatsApp is restricted to administrators" });
  const parsed = z.object({ previewOnly: z.boolean().optional(), responseLink: z.string().trim().optional() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid WhatsApp template request", issues: parsed.error.issues });
  const result = await mediationSessionService.sendProposalRecipientWhatsappTemplate(req.params.id, user, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(parsed.data.previewOnly ? 200 : 202).json(result);
});

router.post("/api/mediation-sessions/:id/hold", requirePermission("cases", "edit"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = holdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session hold", issues: parsed.error.issues });
  const result = await mediationSessionService.placeHold(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(await sanitizeSessionMutationForActor(result.session, actor));
});

router.post("/api/mediation-sessions/:id/required-forms/issue", requirePermission("cases", "edit"), async (req, res) => {
  const result = await mediationSessionService.issueMissingRequiredForms(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.session);
});

router.patch("/api/cases/:caseId/voucher-claim-eligibility", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = voucherClaimEligibilitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid voucher claim eligibility", issues: parsed.error.issues });
  const result = await mediationSessionService.setVoucherClaimEligibility(req.params.caseId, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ case: result.case, forms: result.forms });
});

router.get("/api/mediation-sessions/:id/voucher-claim", requirePermission("cases", "edit"), async (req, res) => {
  const result = await mediationSessionService.getVoucherClaimReadiness(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result);
});

router.patch("/api/mediation-sessions/:id/voucher-claim", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = voucherClaimStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid voucher claim status", issues: parsed.error.issues });
  const result = await mediationSessionService.updateVoucherClaimStatus(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error, missingFields: (result as any).readiness?.missingFields });
  return res.json(result);
});

router.post("/api/voucher-claims/remittance-preview", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = voucherRemittancePreviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid voucher remittance upload", issues: parsed.error.issues });
  const result = await mediationSessionService.previewVoucherRemittanceCsv(getUser(req as any), parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result);
});

router.patch("/api/mediation-sessions/:id/confirm", requirePermission("cases", "edit"), async (req, res) => {
  const result = await mediationSessionService.confirmSession(req.params.id, getUser(req as any), req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.session);
});

router.post("/api/mediation-sessions/:id/cancel", requirePermission("cases", "edit"), async (req, res) => {
  const parsed = cancelSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid mediation session cancellation", issues: parsed.error.issues });
  const result = await mediationSessionService.cancelSession(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.session);
});

router.get("/api/session-availability/:token", async (req, res) => {
  const result = await mediationSessionService.getPublicProposal(req.params.token);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({
    proposal: result.proposal,
    recipient: {
      id: result.recipient.id,
      recipientType: result.recipient.recipientType,
      recipientName: result.recipient.recipientName,
      participantRole: result.recipient.participantRole,
      responseStatus: result.recipient.responseStatus,
      declineNotes: result.recipient.declineNotes,
    },
    caseRef: result.caseRef,
    sessionNumber: result.sessionNumber,
    leadMediatorName: result.leadMediatorName,
    linkStatus: result.linkStatus,
  });
});

router.post("/api/session-availability/:token/respond", async (req, res) => {
  const parsed = proposalResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid session availability response", issues: parsed.error.issues });
  const result = await mediationSessionService.respondToProposal(req.params.token, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({
    recipient: {
      id: result.recipient.id,
      recipientType: result.recipient.recipientType,
      recipientName: result.recipient.recipientName,
      participantRole: result.recipient.participantRole,
      responseStatus: result.recipient.responseStatus,
      declineNotes: result.recipient.declineNotes,
    },
    paymentRequired: result.payment?.paymentRequired || false,
    invoiceId: result.payment?.invoiceId,
    invoiceNumber: result.payment?.invoiceNumber,
    outstandingPence: result.payment?.outstandingPence,
    currency: result.payment?.currency,
    checkoutUrl: result.payment?.checkoutUrl,
    xeroInvoiceUrl: result.payment?.xeroInvoiceUrl,
    xeroInvoiceNumber: result.payment?.xeroInvoiceNumber,
    paymentReference: result.payment?.paymentReference,
    bankTransfer: result.payment?.paymentProvider === "xero_invoice" ? await paymentSettingsService.getBankTransferSettings() : undefined,
    paymentProvider: result.payment?.paymentProvider,
    paymentError: result.payment?.error,
    autoConfirmation: result.autoConfirmation,
  });
});

router.post("/api/mediation-session-proposal-recipients/:id/client-response", requireAuth, async (req, res) => {
  const user = getUser(req as any);
  const actor = user;
  if (user.role !== "client") {
    return res.status(403).json({ message: "Only clients can respond to mediation session proposals from the portal" });
  }
  const parsed = proposalResponseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid session availability response", issues: parsed.error.issues });
  const result = await mediationSessionService.respondToClientProposalRecipient(req.params.id, actor, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({
    recipient: {
      id: result.recipient.id,
      recipientType: result.recipient.recipientType,
      recipientName: result.recipient.recipientName,
      participantRole: result.recipient.participantRole,
      responseStatus: result.recipient.responseStatus,
      declineNotes: result.recipient.declineNotes,
    },
    paymentRequired: result.payment?.paymentRequired || false,
    invoiceId: result.payment?.invoiceId,
    invoiceNumber: result.payment?.invoiceNumber,
    outstandingPence: result.payment?.outstandingPence,
    currency: result.payment?.currency,
    checkoutUrl: result.payment?.checkoutUrl,
    xeroInvoiceUrl: result.payment?.xeroInvoiceUrl,
    xeroInvoiceNumber: result.payment?.xeroInvoiceNumber,
    paymentReference: result.payment?.paymentReference,
    bankTransfer: result.payment?.paymentProvider === "xero_invoice" ? await paymentSettingsService.getBankTransferSettings() : undefined,
    paymentProvider: result.payment?.paymentProvider,
    paymentError: result.payment?.error,
    autoConfirmation: result.autoConfirmation,
  });
});

router.post("/api/session-availability/:token/invoices/:invoiceId/bank-transfer-in-flight", async (req, res) => {
  const proposal = await mediationSessionService.getPublicProposal(req.params.token);
  if (!proposal.ok) return res.status(proposal.status).json({ message: proposal.error });
  if (proposal.recipient.recipientType !== "client") return res.status(403).json({ message: "Bank-transfer payment status is only available for client recipients" });
  const invoiceAllowed = await mediationSessionService.publicProposalInvoiceBelongsToRecipient(proposal.proposal, proposal.recipient, req.params.invoiceId);
  if (!invoiceAllowed) return res.status(403).json({ message: "Invoice does not belong to this session recipient" });

  const invoices = proposal.proposal.appointmentId ? await financeService.listInvoicesByAppointment(proposal.proposal.appointmentId) : [];
  const invoice = invoices.find((row) => row.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (invoice.paymentStatus === "paid") return res.json({ success: true, alreadyPaid: true });
  if (proposal.proposal.appointmentId) {
    await storage.updateAppointment(proposal.proposal.appointmentId, {
      holdExpiresAt: null,
      paymentNotes: "Client indicated bank transfer has been sent for mediation session; auto-release paused pending Xero reconciliation.",
      paymentStatusUpdatedAt: new Date(),
    });
  }
  await notificationService.createNotification({
    type: "bank_transfer_in_flight",
    title: "Bank transfer may be in flight",
    message: `Client indicated they paid ${invoice.invoiceNumber} by bank transfer for case ${proposal.caseRef}. Check Xero/bank reconciliation before releasing the session hold.`,
    urgency: "red",
    recipientRole: "superadmin",
    caseId: invoice.caseId,
    appointmentId: invoice.appointmentId,
  });
  await logAudit({
    action: "session_bank_transfer_in_flight",
    entity: "case_invoice",
    entityId: invoice.id,
    entityRef: invoice.invoiceNumber,
  });
  res.json({ success: true });
});

router.get("/api/session-availability/:token/payment-status", async (req, res) => {
  const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : "";
  const sessionId = normalizeStripeSessionId(req.query.session_id);
  if (!invoiceId || !sessionId) return res.status(400).json({ message: "invoiceId and session_id query params are required" });

  const proposal = await mediationSessionService.getPublicProposal(req.params.token);
  if (!proposal.ok) return res.status(proposal.status).json({ message: proposal.error });
  if (proposal.recipient.recipientType !== "client") return res.status(403).json({ message: "Payment status is only available for client recipients" });
  const invoiceAllowed = await mediationSessionService.publicProposalInvoiceBelongsToRecipient(proposal.proposal, proposal.recipient, invoiceId);
  if (!invoiceAllowed) return res.status(403).json({ message: "Invoice does not belong to this session recipient" });

  const result = await stripePaymentService.reconcileInvoiceCheckoutSessionReturn(invoiceId, sessionId, "return_status_check");
  return res.json({ invoiceId, reconciliationAction: result.action });
});

router.get("/api/session-availability/:token/available-dates", async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : "";
  const result = await mediationSessionService.getPublicLeadMediatorAvailableDates(req.params.token, month, durationFromQuery(req.query.duration));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ dates: result.dates, bookingPaused: result.bookingPaused, message: result.message });
});

router.get("/api/session-availability/:token/available-slots", async (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : "";
  const result = await mediationSessionService.getPublicLeadMediatorAvailableSlots(req.params.token, date, durationFromQuery(req.query.duration));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ slots: result.slots, message: result.message });
});

router.post("/api/party-required-forms/:id/viewed", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.markFormViewed(req.params.id, getUser(req as any));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.form);
});

router.post("/api/party-required-forms/:id/sign", requirePermission("cases", "view"), async (req, res) => {
  const parsed = signFormSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid form signature", issues: parsed.error.issues });
  const result = await mediationSessionService.signForm(req.params.id, getUser(req as any), parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ form: result.form, document: result.document });
});

router.post("/api/party-required-forms/:id/upload-signed", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const parsed = signedFormUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid signed form upload", issues: parsed.error.issues });
  const result = await mediationSessionService.uploadSignedRequiredForm(req.params.id, actor, parsed.data, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  const form = await sanitizeRequiredFormMutationForActor(result.form, actor);
  const document = actor.role === "mediator" ? withProtectedCaseDocumentUrl(result.document) : result.document;
  return res.json({ form, document });
});

router.post("/api/party-required-forms/:id/withdraw", requirePermission("cases", "view"), async (req, res) => {
  const result = await mediationSessionService.withdrawOptionalRequiredForm(req.params.id, getUser(req as any), req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ form: result.form });
});

router.post("/api/party-required-forms/:id/resend", requirePermission("cases", "edit"), async (req, res) => {
  const actor = getUser(req as any);
  const result = await mediationSessionService.resendRequiredForm(req.params.id, actor, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(await sanitizeRequiredFormMutationForActor(result.form, actor));
});

export default router;
