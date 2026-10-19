import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { mediatorProfileService } from "../services/mediator-profile.service";
import { buildServiceApprovalActionPath, mediatorServiceApprovalService } from "../services/mediator-service-approval.service";
import { sendMediatorServiceApprovalDecisionEmail, sendMediatorServiceProofRequestEmail } from "../services/email.service";
import { getUkDateKey, toUkWallClockDateTime } from "../utils/uk-wall-clock";
import type { MediatorRole } from "@shared/mediator-rbac";
import { canManageMediatorServiceSlots } from "@shared/mediator-rbac";
import { z } from "zod";
import { db } from "../db";
import { mediatorProfileChangeRequests } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { canRequestMediatorField, canReviewMediatorField } from "@shared/mediator-rbac";
import { mediatorProfileRepository } from "../repositories/mediator-profile.repository";
import { logAudit } from "../services/audit-log.service";

const router = Router();

function getBaseUrl(req: any): string {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  return `${proto}://${host}`;
}

async function loadActor(req: any, res: any): Promise<{ actorRole: MediatorRole; actorId: string } | null> {
  const u = await storage.getUser(req.session.userId);
  if (!u) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return { actorRole: u.role as MediatorRole, actorId: u.id };
}

// ---------- Profile core ----------
router.get("/api/mediators/:id/profile", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const { actorRole, actorId } = actor;
  if (!["superadmin", "subadmin", "mediator"].includes(actorRole)) {
    return res.status(403).json({ message: "Access denied" });
  }
  const view = await mediatorProfileService.getView(req.params.id, actorRole, actorId);
  if (!view) return res.status(404).json({ message: "Mediator not found" });
  return res.json(view);
});

router.patch("/api/mediators/:id/profile", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const result = await mediatorProfileService.updateProfile(req.params.id, req.body ?? {}, actor.actorRole, actor.actorId);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json({ profile: result.profile });
});

router.get("/api/mediators/:id/change-requests", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole === "mediator" && actor.actorId !== req.params.id) return res.status(403).json({ message: "Access denied" });
  if (!["mediator", "superadmin", "subadmin"].includes(actor.actorRole)) return res.status(403).json({ message: "Access denied" });
  const target = await storage.getUser(req.params.id);
  if (!target || target.role !== "mediator") return res.status(404).json({ message: "Mediator not found" });
  const requests = await db.select().from(mediatorProfileChangeRequests)
    .where(eq(mediatorProfileChangeRequests.mediatorId, req.params.id))
    .orderBy(desc(mediatorProfileChangeRequests.submittedAt));
  return res.json(requests);
});

router.post("/api/mediators/:id/change-requests", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "mediator" || actor.actorId !== req.params.id) return res.status(403).json({ message: "Access denied" });
  const parsed = z.object({ field: z.string(), proposedValue: z.unknown() }).strict().safeParse(req.body);
  if (!parsed.success || !canRequestMediatorField(parsed.data.field, actor.actorId, req.params.id)) {
    return res.status(403).json({ message: "This field cannot be submitted for review" });
  }
  const current = await mediatorProfileRepository.getProfile(req.params.id);
  if (!current) return res.status(404).json({ message: "Mediator profile not found" });
  if (JSON.stringify((current as any)[parsed.data.field] ?? null) === JSON.stringify(parsed.data.proposedValue ?? null)) {
    return res.status(400).json({ message: "This value is already saved" });
  }
  const [request] = await db.insert(mediatorProfileChangeRequests).values({ mediatorId: req.params.id, field: parsed.data.field, proposedValue: parsed.data.proposedValue }).returning();
  await logAudit({ userId: actor.actorId, action: "create", entity: "mediator_profile_change_request", entityId: request.id, details: JSON.stringify({ field: request.field }) });
  return res.status(201).json(request);
});

router.post("/api/mediators/:id/change-requests/:requestId/review", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") return res.status(403).json({ message: "Access denied" });
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid review decision" });
  const [request] = await db.select().from(mediatorProfileChangeRequests).where(and(
    eq(mediatorProfileChangeRequests.id, req.params.requestId), eq(mediatorProfileChangeRequests.mediatorId, req.params.id),
  ));
  if (!request) return res.status(404).json({ message: "Request not found" });
  if (request.status !== "pending") return res.status(409).json({ message: "Request was already reviewed" });
  const canReview = request.field === "profilePhotoUrl"
    ? actor.actorRole === "superadmin" || actor.actorRole === "subadmin"
    : canReviewMediatorField(request.field, actor.actorRole);
  if (!canReview) return res.status(403).json({ message: "Field cannot be approved by this reviewer" });
  if (parsed.data.decision === "approved") {
    if (request.field === "profilePhotoUrl") {
      if (typeof request.proposedValue !== "string" || !/^\/uploads\/profile-images\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(request.proposedValue)) {
        return res.status(400).json({ message: "Invalid profile picture" });
      }
      await mediatorProfileRepository.upsertProfile(req.params.id, { profilePhotoUrl: request.proposedValue, profilePhotoApproved: true });
    } else {
      const result = await mediatorProfileService.updateProfile(req.params.id, { [request.field]: request.proposedValue }, actor.actorRole, actor.actorId);
      if (!result.ok) return res.status(result.status).json({ message: result.error });
      if (request.field === "firstName" || request.field === "lastName") {
        const directoryName = [result.profile.firstName, result.profile.lastName].filter(Boolean).join(" ").trim();
        if (directoryName) await storage.updateUser(req.params.id, { name: directoryName });
      }
    }
  }
  const [updated] = await db.update(mediatorProfileChangeRequests).set({ status: parsed.data.decision, reviewedBy: actor.actorId, reviewedAt: new Date(), reviewNote: parsed.data.note ?? null })
    .where(and(eq(mediatorProfileChangeRequests.id, request.id), eq(mediatorProfileChangeRequests.status, "pending"))).returning();
  if (!updated) return res.status(409).json({ message: "Request was already reviewed" });
  await logAudit({ userId: actor.actorId, action: parsed.data.decision, entity: "mediator_profile_change_request", entityId: request.id, details: JSON.stringify({ field: request.field }) });
  return res.json(updated);
});

// ---------- Bio workflow ----------
router.get("/api/mediators/:id/bio-versions", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const { actorRole, actorId } = actor;
  if (actorRole === "mediator" && actorId !== req.params.id) return res.status(403).json({ message: "Access denied" });
  if (!["superadmin", "subadmin", "mediator"].includes(actorRole)) return res.status(403).json({ message: "Access denied" });
  const rows = await mediatorProfileService.listBioVersions(req.params.id);
  return res.json(rows);
});

router.post("/api/mediators/:id/bio/submit", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const { actorRole, actorId } = actor;
  // Mediator can submit their own; superadmin can submit on behalf
  if (actorRole === "mediator" && actorId !== req.params.id) return res.status(403).json({ message: "Access denied" });
  if (!["superadmin", "mediator"].includes(actorRole)) return res.status(403).json({ message: "Access denied" });
  const v = await mediatorProfileService.submitBio(req.params.id, actorId, {
    bioLong: req.body?.bioLong ?? null,
    bioShort: req.body?.bioShort ?? null,
  });
  return res.status(201).json(v);
});

router.post("/api/mediators/:id/bio/:versionId/review", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  // Subadmin is the normal approval gate; Superadmin can override at any stage.
  if (!["subadmin", "superadmin"].includes(actor.actorRole)) {
    return res.status(403).json({ message: "Only Subadmin or Superadmin may approve bios" });
  }
  const decision = req.body?.decision;
  if (decision !== "approved" && decision !== "rejected") return res.status(400).json({ message: "decision must be approved or rejected" });
  const v = await mediatorProfileService.reviewBio(req.params.id, req.params.versionId, actor.actorId, decision, req.body?.reviewNotes);
  if (!v) return res.status(404).json({ message: "Bio version not found" });
  return res.json(v);
});

// ---------- Child collections ----------
// Reads: superadmin/subadmin always; mediator only on own record; everyone else 403.
function canReadChild(actorRole: MediatorRole, actorId: string, mediatorId: string): boolean {
  if (actorRole === "superadmin" || actorRole === "subadmin") return true;
  if (actorRole === "mediator" && actorId === mediatorId) return true;
  return false;
}
// Writes: when staffOnlyEdit=true → superadmin/subadmin only. When false → also mediator on own record.
function canWriteChild(actorRole: MediatorRole, actorId: string, mediatorId: string, staffOnlyEdit: boolean): boolean {
  if (actorRole === "superadmin" || actorRole === "subadmin") return true;
  if (!staffOnlyEdit && actorRole === "mediator" && actorId === mediatorId) return true;
  return false;
}

const serviceApprovalSubmitSchema = z.object({
  proofLink: z.string().nullable().optional(),
  proofFileName: z.string().nullable().optional(),
  proofFileData: z.string().nullable().optional(),
  proofMimeType: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
}).strict();

const serviceApprovalReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewReason: z.string().nullable().optional(),
}).strict();

const serviceApprovalRevokeSchema = z.object({
  reviewReason: z.string().trim().min(1, "Revocation reason is required."),
}).strict();

const MANUAL_APPROVAL_FILE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const manualServiceApprovalSchema = z.object({
  proofLink: z.string().trim().url("Supporting URL must be a valid URL.")
    .refine((value) => /^https?:\/\//i.test(value), "Supporting URL must use http or https.")
    .nullable().optional(),
  proofFileName: z.string().trim().min(1).max(255).nullable().optional(),
  proofFileData: z.string().min(1).nullable().optional(),
  proofMimeType: z.string().trim().min(1).nullable().optional(),
  evidenceNote: z.string().trim().max(5000).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must use YYYY-MM-DD.").nullable().optional(),
}).strict().superRefine((value, ctx) => {
  const hasFileName = !!value.proofFileName;
  const hasFileData = !!value.proofFileData;
  if (hasFileName !== hasFileData) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proofFileData"], message: "Supporting file name and data must be supplied together." });
  }
  if (!hasFileData && !value.proofLink && !value.evidenceNote) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one supporting file, URL, or evidence note is required." });
  }
  if (hasFileData) {
    const match = value.proofFileData!.match(/^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/);
    const declaredMime = value.proofMimeType || match?.[1];
    if (!match || !declaredMime || !MANUAL_APPROVAL_FILE_MIME_TYPES.has(declaredMime) || (value.proofMimeType && value.proofMimeType !== match[1])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proofFileData"], message: "Supporting file payload is malformed or unsupported." });
    } else {
      const decodedSize = Buffer.byteLength(match[2], "base64");
      if (decodedSize === 0 || decodedSize > 10 * 1024 * 1024) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proofFileData"], message: "Supporting file must be between 1 byte and 10 MB." });
      }
    }
  }
  if (value.expiryDate) {
    const parsedExpiry = new Date(`${value.expiryDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.toISOString().slice(0, 10) !== value.expiryDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry date must be a real calendar date." });
    }
  }
  if (value.expiryDate && value.expiryDate < getUkDateKey()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry date cannot be in the past." });
  }
});

const serviceScheduleSlotsSchema = z.object({
  groupedSourceAware: z.boolean().optional(),
  slots: z.array(z.object({
    id: z.string().nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    preserveOnly: z.boolean().optional(),
  })).min(0),
}).strict();

const serviceCalendarEventSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  title: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

function childRoute<TBody>(
  path: string,
  list: (id: string) => Promise<unknown>,
  create?: (id: string, actorId: string, data: TBody) => Promise<unknown>,
  remove?: (childId: string, actorId: string, mediatorId: string) => Promise<void>,
  update?: (childId: string, actorId: string, mediatorId: string, data: Record<string, unknown>) => Promise<unknown>,
  staffOnlyEdit = true,
) {
  router.get(`/api/mediators/:id/${path}`, requireAuth, async (req, res) => {
    const actor = await loadActor(req, res);
    if (!actor) return;
    if (!canReadChild(actor.actorRole, actor.actorId, req.params.id)) return res.status(403).json({ message: "Access denied" });
    res.json(await list(req.params.id));
  });
  if (create) {
    router.post(`/api/mediators/:id/${path}`, requireAuth, async (req, res) => {
      const actor = await loadActor(req, res);
      if (!actor) return;
      if (!canWriteChild(actor.actorRole, actor.actorId, req.params.id, staffOnlyEdit)) return res.status(403).json({ message: "Access denied" });
      try {
        const row = await create(req.params.id, actor.actorId, req.body as TBody);
        res.status(201).json(row);
      } catch (e) {
        const status = (e as any)?.status;
        if (typeof status === "number") return res.status(status).json({ message: (e as Error).message });
        throw e;
      }
    });
  }
  if (update) {
    router.patch(`/api/mediators/:id/${path}/:childId`, requireAuth, async (req, res) => {
      const actor = await loadActor(req, res);
      if (!actor) return;
      if (!canWriteChild(actor.actorRole, actor.actorId, req.params.id, staffOnlyEdit)) return res.status(403).json({ message: "Access denied" });
      const row = await update(req.params.childId, actor.actorId, req.params.id, req.body ?? {});
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json(row);
    });
  }
  if (remove) {
    router.delete(`/api/mediators/:id/${path}/:childId`, requireAuth, async (req, res) => {
      const actor = await loadActor(req, res);
      if (!actor) return;
      if (!canWriteChild(actor.actorRole, actor.actorId, req.params.id, staffOnlyEdit)) return res.status(403).json({ message: "Access denied" });
      try {
        await remove(req.params.childId, actor.actorId, req.params.id);
        res.status(204).end();
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "not_found_or_wrong_mediator") return res.status(404).json({ message: "Not found" });
        throw e;
      }
    });
  }
}

// Off-boarding workflow: list open cases for a mediator (staff only).
router.get("/api/mediators/:id/open-cases", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") {
    return res.status(403).json({ message: "Access denied" });
  }
  const rows = await mediatorProfileService.listOpenCases(req.params.id);
  res.json(rows);
});

// Off-boarding workflow: confirm off-board with reassignment map (staff only — superadmin or subadmin).
router.post("/api/mediators/:id/offboard", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") {
    return res.status(403).json({ message: "Only superadmin or subadmin can off-board a mediator." });
  }
  const result = await mediatorProfileService.offboardMediator(req.params.id, actor.actorId, req.body ?? {});
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json({ success: true, reassigned: result.reassigned });
});

childRoute("cpd", mediatorProfileService.listCpd, mediatorProfileService.createCpd, mediatorProfileService.deleteCpd, undefined, false);
childRoute("references", mediatorProfileService.listReferences, mediatorProfileService.createReference, mediatorProfileService.deleteReference, mediatorProfileService.updateReference, true);
childRoute("trainings", mediatorProfileService.listTrainings, mediatorProfileService.createTraining, mediatorProfileService.deleteTraining, undefined, true);
childRoute("holidays", mediatorProfileService.listHolidays, mediatorProfileService.createHoliday, mediatorProfileService.deleteHoliday, undefined, false);
childRoute("complaints", mediatorProfileService.listComplaints, mediatorProfileService.createComplaint, mediatorProfileService.deleteComplaint, undefined, true);
childRoute("timebank", mediatorProfileService.listTimebank, mediatorProfileService.createTimebank, mediatorProfileService.deleteTimebank, undefined, true);

router.get("/api/mediators/:id/service-approvals", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!canReadChild(actor.actorRole, actor.actorId, req.params.id)) return res.status(403).json({ message: "Access denied" });
  res.json(await mediatorServiceApprovalService.listForMediator(req.params.id));
});

router.put("/api/mediators/:id/service-approvals/:serviceTypeId", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!canWriteChild(actor.actorRole, actor.actorId, req.params.id, false)) return res.status(403).json({ message: "Access denied" });
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceApprovalSubmitSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const row = await mediatorServiceApprovalService.upsertSubmission(actor.actorId, {
    mediatorId: req.params.id,
    serviceTypeId: req.params.serviceTypeId,
    proofLink: parsed.data.proofLink ?? null,
    proofFileName: parsed.data.proofFileName ?? null,
    proofFileData: parsed.data.proofFileData ?? null,
    proofMimeType: parsed.data.proofMimeType ?? null,
    expiryDate: parsed.data.expiryDate ?? null,
  });
  res.json(row);
});

router.post("/api/mediators/:id/service-approvals/:serviceTypeId/request", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") {
    return res.status(403).json({ message: "Only superadmin or subadmin can request service proof." });
  }
  const mediator = await storage.getUser(req.params.id);
  if (!mediator) return res.status(404).json({ message: "Mediator not found" });
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });

  const row = await mediatorServiceApprovalService.requestForMediator(actor.actorId, req.params.id, req.params.serviceTypeId);
  const profileUrl = `${getBaseUrl(req)}${buildServiceApprovalActionPath(req.params.id, req.params.serviceTypeId)}`;
  const emailSent = mediator.email
    ? await sendMediatorServiceProofRequestEmail(mediator.email, mediator.name, service.name, profileUrl)
    : false;
  return res.status(201).json({ row, emailSent });
});

router.get("/api/mediators/:id/service-schedule-slots", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const canView = (actor.actorRole === "mediator" && actor.actorId === req.params.id) || actor.actorRole === "superadmin" || actor.actorRole === "subadmin";
  if (!canView) {
    return res.status(403).json({ message: "Access denied" });
  }
  const rows = await mediatorServiceApprovalService.listScheduleSlots(req.params.id);
  res.json(rows);
});

router.get("/api/mediators/:id/service-approvals/:serviceTypeId/schedule-slots", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const canView = (actor.actorRole === "mediator" && actor.actorId === req.params.id) || actor.actorRole === "superadmin" || actor.actorRole === "subadmin";
  if (!canView) {
    return res.status(403).json({ message: "Access denied" });
  }
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const rows = await mediatorServiceApprovalService.listScheduleSlots(req.params.id, req.params.serviceTypeId);
  res.json(rows);
});

router.put("/api/mediators/:id/service-approvals/:serviceTypeId/schedule-slots", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!canManageMediatorServiceSlots(actor.actorRole, actor.actorId, req.params.id)) {
    return res.status(403).json({ message: "Access denied" });
  }
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceScheduleSlotsSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const rows = parsed.data.slots.map((slot) => ({
    id: slot.id ?? undefined,
    startAt: toUkWallClockDateTime(slot.date, slot.startTime),
    endAt: toUkWallClockDateTime(slot.date, slot.endTime),
    preserveOnly: slot.preserveOnly ?? false,
  }));
  const saved = await mediatorServiceApprovalService.replaceScheduleSlots(actor.actorId, req.params.id, req.params.serviceTypeId, rows, { groupedSourceAware: parsed.data.groupedSourceAware ?? false });
  res.json(saved);
});

router.put("/api/mediators/:id/service-approvals/:serviceTypeId/calendar-event", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!canWriteChild(actor.actorRole, actor.actorId, req.params.id, false)) return res.status(403).json({ message: "Access denied" });
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceCalendarEventSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const row = await mediatorServiceApprovalService.saveCalendarEvent(
    actor.actorId,
    { mediatorId: req.params.id },
    req.params.serviceTypeId,
    {
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      title: parsed.data.title ?? null,
      notes: parsed.data.notes ?? null,
    },
  );
  if (!row) return res.status(404).json({ message: "Service approval not found" });
  res.json(row);
});

router.delete("/api/mediators/:id/service-approvals/:serviceTypeId/calendar-event", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!canWriteChild(actor.actorRole, actor.actorId, req.params.id, false)) return res.status(403).json({ message: "Access denied" });
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const row = await mediatorServiceApprovalService.deleteCalendarEvent(
    actor.actorId,
    { mediatorId: req.params.id },
    req.params.serviceTypeId,
  );
  if (!row) return res.status(404).json({ message: "Service approval not found" });
  res.json(row);
});

router.post("/api/mediators/:id/service-approvals/:serviceTypeId/manual-approve", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") {
    return res.status(403).json({ message: "Only a Superadmin or Subadmin can manually approve a mediator service." });
  }

  const [mediator, service] = await Promise.all([
    storage.getUser(req.params.id),
    storage.getServiceType(req.params.serviceTypeId),
  ]);
  if (!mediator || mediator.role !== "mediator") {
    return res.status(404).json({ message: "Active mediator not found." });
  }
  if (mediator.status !== "active") {
    return res.status(400).json({ message: "Only an active mediator can receive a manual service approval." });
  }
  if (!service) return res.status(404).json({ message: "Service type not found." });
  if (!service.isActive) return res.status(400).json({ message: "Only an active service type can be approved." });

  const parsed = manualServiceApprovalSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

  const row = await mediatorServiceApprovalService.manualApprove(actor.actorId, {
    mediatorId: req.params.id,
    serviceTypeId: req.params.serviceTypeId,
    proofLink: parsed.data.proofLink ?? null,
    proofFileName: parsed.data.proofFileName ?? null,
    proofFileData: parsed.data.proofFileData ?? null,
    proofMimeType: parsed.data.proofMimeType ?? null,
    evidenceNote: parsed.data.evidenceNote ?? null,
    expiryDate: parsed.data.expiryDate ?? null,
  });
  return res.json({ row });
});

router.post("/api/mediators/:id/service-approvals/:serviceTypeId/review", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") return res.status(403).json({ message: "Access denied" });
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceApprovalReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const row = await mediatorServiceApprovalService.review(actor.actorId, { mediatorId: req.params.id }, req.params.serviceTypeId, parsed.data.decision, parsed.data.reviewReason ?? null);
  if (!row) return res.status(404).json({ message: "Service approval not found" });
  const mediator = await storage.getUser(req.params.id);
  const decisionPath = buildServiceApprovalActionPath(req.params.id, req.params.serviceTypeId);
  let emailSent = false;
  if (mediator?.email) {
    emailSent = await sendMediatorServiceApprovalDecisionEmail(
      mediator.email,
      mediator.name,
      service.name,
      parsed.data.decision,
      `${getBaseUrl(req)}${decisionPath}`,
      parsed.data.reviewReason ?? null,
    );
  }
  res.json({ row, emailSent });
});

router.post("/api/mediators/:id/service-approvals/:serviceTypeId/revoke", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (actor.actorRole !== "superadmin" && actor.actorRole !== "subadmin") return res.status(403).json({ message: "Access denied" });
  const mediator = await storage.getUser(req.params.id);
  if (!mediator) return res.status(404).json({ message: "Mediator not found" });
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceApprovalRevokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });

  const row = await mediatorServiceApprovalService.revoke(
    actor.actorId,
    { mediatorId: req.params.id },
    req.params.serviceTypeId,
    parsed.data.reviewReason,
  );
  if (!row) return res.status(404).json({ message: "Service approval not found" });

  const decisionPath = buildServiceApprovalActionPath(req.params.id, req.params.serviceTypeId);
  const profileUrl = `${getBaseUrl(req)}${decisionPath}`;
  let emailSent = mediator.email
    ? await sendMediatorServiceApprovalDecisionEmail(mediator.email, mediator.name, service.name, "revoked", profileUrl, parsed.data.reviewReason)
    : false;
  if (mediator.email && !emailSent) {
    emailSent = await sendMediatorServiceProofRequestEmail(mediator.email, mediator.name, service.name, profileUrl).catch(() => false);
  }
  res.json({ row, emailSent });
});

// Consents (mediator manages own; superadmin can manage anyone)
router.get("/api/mediators/:id/consents", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!canReadChild(actor.actorRole, actor.actorId, req.params.id)) return res.status(403).json({ message: "Access denied" });
  res.json(await mediatorProfileService.listConsents(req.params.id));
});
router.post("/api/mediators/:id/consents", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  const { actorRole, actorId } = actor;
  if (!(actorRole === "superadmin" || (actorRole === "mediator" && actorId === req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const consentType = String(req.body?.consentType ?? "");
  const granted = Boolean(req.body?.granted);
  if (!["name_bio", "photo", "edi_aggregate"].includes(consentType)) return res.status(400).json({ message: "Invalid consentType" });
  const row = await mediatorProfileService.upsertConsent(req.params.id, actorId, consentType, granted);
  res.json(row);
});

// EDI aggregate (subadmin only — superadmin sees raw values via /profile)
router.get("/api/mediators/edi/aggregate", requireAuth, async (req, res) => {
  const actor = await loadActor(req, res);
  if (!actor) return;
  if (!["superadmin", "subadmin"].includes(actor.actorRole)) return res.status(403).json({ message: "Access denied" });
  res.json(await mediatorProfileService.ediAggregate());
});

export default router;
