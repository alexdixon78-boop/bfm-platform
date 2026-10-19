import { Router } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "../middleware/permissions";
import { enquiryService } from "../services/enquiry.service";
import { logAudit } from "../services/audit-log.service";
import { caseActivityService, staffActor } from "../services/case-activity.service";
import { sendConsentRequestEmail } from "../services/email.service";
import { enquiryDuplicateService } from "../services/enquiry-duplicate.service";
import { enquiryAcknowledgementService } from "../services/enquiry-acknowledgement.service";
import { storage } from "../storage";
import { db } from "../db";
import { enquiries } from "@shared/schema";
import type { PaginationParams, User } from "@shared/schema";

function parsePaginationParams(query: Record<string, any>): PaginationParams {
  const sortOrder = query.sortOrder === "asc" ? "asc" as const : query.sortOrder === "desc" ? "desc" as const : undefined;
  const followUpFilter = ["due_today", "overdue", "unclaimed", "safeguarding"].includes(query.followUpFilter || "")
    ? query.followUpFilter as "due_today" | "overdue" | "unclaimed" | "safeguarding"
    : undefined;
  return {
    page: Math.max(1, parseInt(query.page) || 1),
    limit: Math.min(100, Math.max(1, parseInt(query.limit) || 20)),
    search: query.search || undefined,
    status: query.status || undefined,
    sortBy: query.sortBy || undefined,
    sortOrder,
    followUpFilter,
  };
}

function sanitizeEnquiry<T extends { consentToken?: string | null }>(enquiry: T) {
  const { consentToken: _consentToken, ...safeEnquiry } = enquiry;
  return safeEnquiry;
}

function sanitizePaginatedEnquiries<T extends { consentToken?: string | null }>(result: { data: T[] }) {
  return {
    ...result,
    data: result.data.map(sanitizeEnquiry),
  };
}

function sanitizeDuplicateReview(review: Awaited<ReturnType<typeof enquiryDuplicateService.listForEnquiry>>[number]) {
  return {
    ...review,
    sourceEnquiry: review.sourceEnquiry ? sanitizeEnquiry(review.sourceEnquiry) : null,
    matchedEnquiry: review.matchedEnquiry ? sanitizeEnquiry(review.matchedEnquiry) : null,
    primaryEnquiry: review.primaryEnquiry ? sanitizeEnquiry(review.primaryEnquiry) : null,
  };
}

function stripConsentDecisionFields(body: Record<string, unknown>) {
  const {
    privacyConsent: _privacyConsent,
    privacyConsentStatus: _privacyConsentStatus,
    privacyConsentDecidedAt: _privacyConsentDecidedAt,
    privacyConsentDecidedBy: _privacyConsentDecidedBy,
    privacyConsentDecisionSource: _privacyConsentDecisionSource,
    privacyConsentDecisionNote: _privacyConsentDecisionNote,
    consentToken: _consentToken,
    consentTokenExpiresAt: _consentTokenExpiresAt,
    consentRequestSentAt: _consentRequestSentAt,
    ...safeBody
  } = body;
  return safeBody;
}

async function getValidConsentEnquiry(token: string) {
  const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.consentToken, token)).limit(1);
  if (!enquiry) {
    return { ok: false as const, status: 404, message: "Invalid or expired consent link" };
  }
  if (!enquiry.consentTokenExpiresAt || new Date(enquiry.consentTokenExpiresAt) < new Date()) {
    return { ok: false as const, status: 410, message: "This consent link has expired. Please contact us to request a new one." };
  }
  return { ok: true as const, enquiry };
}

const router = Router();

router.get("/api/enquiries", requirePermission("enquiries", "view"), async (req, res) => {
  const params = parsePaginationParams(req.query);
  const result = await enquiryService.list(params);
  return res.json(sanitizePaginatedEnquiries(result));
});

router.get("/api/enquiries/:id", requirePermission("enquiries", "view"), async (req, res) => {
  const enquiry = await enquiryService.get(req.params.id);
  if (!enquiry) return res.status(404).json({ message: "Enquiry not found" });
  return res.json(sanitizeEnquiry(enquiry));
});

router.get("/api/enquiries/:id/duplicates", requirePermission("enquiries", "view"), async (req, res) => {
  const enquiry = await enquiryService.get(req.params.id);
  if (!enquiry) return res.status(404).json({ message: "Enquiry not found" });
  const reviews = await enquiryDuplicateService.listForEnquiry(req.params.id);
  return res.json({ reviews: reviews.map(sanitizeDuplicateReview) });
});

router.patch("/api/enquiries/duplicates/:reviewId", requirePermission("enquiries", "edit"), async (req, res) => {
  const user = (req as any).user as User;

  const parsed = z.object({
    status: z.enum(["linked", "dismissed"]),
    note: z.string().trim().min(1, "Review note is required").max(1000, "Review note is too long"),
    primaryEnquiryId: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid duplicate review data", errors: parsed.error.flatten().fieldErrors });
  }

  try {
    const updated = await enquiryDuplicateService.review({
      reviewId: req.params.reviewId,
      status: parsed.data.status,
      note: parsed.data.note,
      primaryEnquiryId: parsed.data.primaryEnquiryId ?? null,
      reviewedBy: user.id,
    });
    if (!updated) return res.status(404).json({ success: false, message: "Duplicate review not found" });

    logAudit({
      userId: user.id,
      action: "enquiry.duplicate_review",
      entity: "enquiry",
      entityId: updated.sourceEnquiryId,
      entityRef: updated.sourceEnquiryId,
      details: JSON.stringify({
        reviewId: updated.id,
        matchedEnquiryId: updated.matchedEnquiryId,
        status: updated.status,
        primaryEnquiryId: updated.primaryEnquiryId,
        note: updated.reviewNote,
      }),
    });

    return res.json({ success: true, review: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not review duplicate enquiry";
    return res.status(400).json({ success: false, message });
  }
});

router.post("/api/enquiries", requirePermission("enquiries", "edit"), async (req, res) => {
  const result = await enquiryService.create(req.body, { deferPostCreateSideEffects: true });
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  const user = (req as any).user as User;
  logAudit({ userId: user.id, action: "create", entity: "enquiry", entityId: result.enquiry.id, entityRef: result.enquiry.enquiryRef, details: JSON.stringify({ firstName: result.enquiry.firstName, lastName: result.enquiry.lastName, issueType: result.enquiry.issueType }) });
  if (result.newCase) {
    logAudit({ userId: user.id, action: "case_shell_created", entity: "enquiry", entityId: result.enquiry.id, entityRef: result.enquiry.enquiryRef, details: JSON.stringify({ newCaseRef: result.newCase.caseRef, newCaseId: result.newCase.id, autoCaseShellCreated: true }) });
    const clientName = `${result.enquiry.firstName} ${result.enquiry.lastName}`;
    caseActivityService.logEnquiryCreated(result.newCase.id, result.enquiry.enquiryRef, clientName, staffActor(user)).catch(() => {});
    caseActivityService.logCaseCreated(result.newCase.id, result.newCase.caseRef, result.enquiry.enquiryRef, staffActor(user)).catch(() => {});
  }
  return res.status(201).json({ enquiry: sanitizeEnquiry(result.enquiry), newCase: result.newCase || null });
});

router.post("/api/enquiries/:id/send-acknowledgement", requirePermission("enquiries", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role === "mediator" || user.role === "client") {
    return res.status(403).json({ success: false, message: "Not authorised" });
  }
  const enquiry = await enquiryService.get(req.params.id);
  if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found" });

  const updated = await enquiryAcknowledgementService.sendManualAcknowledgement(enquiry);
  const status = updated?.acknowledgementStatus || "failed";

  logAudit({
    userId: user.id,
    action: "enquiry.acknowledgement_resend",
    entity: "enquiry",
    entityId: enquiry.id,
    entityRef: enquiry.enquiryRef,
    details: JSON.stringify({
      status,
      sentTo: enquiry.email,
      error: updated?.acknowledgementLastError || null,
    }),
  });

  return res.json({
    success: true,
    emailSent: status === "sent",
    enquiry: updated ? sanitizeEnquiry(updated) : sanitizeEnquiry(enquiry),
  });
});

router.patch("/api/enquiries/:id/shuttle", requirePermission("enquiries", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role === "client") {
    return res.status(403).json({ message: "Not authorised" });
  }

  const { shuttleMediation } = req.body || {};
  if (typeof shuttleMediation !== "boolean") {
    return res.status(400).json({ message: "shuttleMediation must be true or false" });
  }

  const existing = await enquiryService.get(req.params.id);
  if (!existing) return res.status(404).json({ message: "Enquiry not found" });

  const updated = await storage.updateEnquiryShuttle(req.params.id, shuttleMediation);
  if (existing.convertedCaseId) {
    await storage.updateCaseShuttle(existing.convertedCaseId, shuttleMediation);
  }

  logAudit({
    userId: user.id,
    action: "enquiry.update_shuttle",
    entity: "enquiry",
    entityId: req.params.id,
    entityRef: existing.enquiryRef,
    details: JSON.stringify({ shuttleMediation, convertedCaseId: existing.convertedCaseId || null }),
  });

  return res.json(sanitizeEnquiry(updated || existing));
});

router.patch("/api/enquiries/:id", requirePermission("enquiries", "edit"), async (req, res) => {
  const safeBody = stripConsentDecisionFields(req.body || {});
  const result = await enquiryService.update(req.params.id, safeBody);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  const user = (req as any).user as User;
  logAudit({ userId: user.id, action: "update", entity: "enquiry", entityId: req.params.id, entityRef: result.enquiry.enquiryRef || req.params.id, details: JSON.stringify(safeBody) });
  return res.json(sanitizeEnquiry(result.enquiry));
});

// Public — no auth: validate a consent token without recording consent.
router.get("/api/enquiries/consent/:token", async (req, res) => {
  const result = await getValidConsentEnquiry(req.params.token);
  if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
  return res.json({ success: true, firstName: result.enquiry.firstName });
});

// Public — no auth: record consent only after the recipient clicks the page button.
router.post("/api/enquiries/consent/:token", async (req, res) => {
  const result = await getValidConsentEnquiry(req.params.token);
  if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
  const { enquiry } = result;
  await db.update(enquiries).set({
    privacyConsent: true,
    privacyConsentStatus: "granted",
    privacyConsentDecidedAt: new Date(),
    privacyConsentDecidedBy: null,
    privacyConsentDecisionSource: "public_link",
    privacyConsentDecisionNote: null,
    consentToken: null,
    consentTokenExpiresAt: null,
  }).where(eq(enquiries.id, enquiry.id));

  logAudit({
    userId: null,
    action: "enquiry.privacy_consent_recorded",
    entity: "enquiry",
    entityId: enquiry.id,
    entityRef: enquiry.enquiryRef,
    details: JSON.stringify({ firstName: enquiry.firstName, ip: req.ip || null }),
  });

  return res.json({ success: true, firstName: enquiry.firstName });
});

router.patch("/api/enquiries/:id/privacy-consent", requirePermission("enquiries", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Only superadmins can manually decide privacy consent" });
  }

  const manualConsentDecisionSchema = z.object({
    status: z.enum(["granted", "refused"]),
    note: z.string().trim().min(1, "Decision note is required").max(1000, "Decision note is too long"),
  });
  const parsed = manualConsentDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Decision note is required", errors: parsed.error.flatten().fieldErrors });
  }

  const existing = await enquiryService.get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: "Enquiry not found" });

  const { status, note } = parsed.data;
  const [updated] = await db.update(enquiries).set({
    privacyConsent: status === "granted",
    privacyConsentStatus: status,
    privacyConsentDecidedAt: new Date(),
    privacyConsentDecidedBy: user.id,
    privacyConsentDecisionSource: "manual_admin",
    privacyConsentDecisionNote: note,
    consentToken: null,
    consentTokenExpiresAt: null,
  }).where(eq(enquiries.id, req.params.id)).returning();

  logAudit({
    userId: user.id,
    action: "enquiry.privacy_consent_manual_decision",
    entity: "enquiry",
    entityId: existing.id,
    entityRef: existing.enquiryRef,
    details: JSON.stringify({ status, source: "manual_admin", note }),
  });

  return res.json(sanitizeEnquiry(updated));
});

router.post("/api/enquiries/:id/send-consent", requirePermission("enquiries", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role === "mediator" || user.role === "client") {
    return res.status(403).json({ success: false, message: "Not authorised" });
  }
  const enquiry = await enquiryService.get(req.params.id);
  if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found" });
  if (!enquiry.email) return res.status(400).json({ success: false, message: "No email address on record for this enquiry" });
  const consentStatus = enquiry.privacyConsentStatus || (enquiry.privacyConsent ? "granted" : "pending");
  if (consentStatus !== "pending") {
    return res.status(400).json({ success: false, message: "Privacy consent has already been decided" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const consentUrl = `${baseUrl}/consent/${token}`;

  await db.update(enquiries).set({
    consentToken: token,
    consentTokenExpiresAt: expiresAt,
    consentRequestSentAt: new Date(),
  }).where(eq(enquiries.id, enquiry.id));

  const linkedCase = enquiry.convertedCaseId ? await storage.getCase(enquiry.convertedCaseId) : null;
  let sent = false;
  try {
    sent = await sendConsentRequestEmail(enquiry.email, enquiry.firstName, consentUrl, linkedCase?.caseRef);
  } catch (err) {
    console.error("[enquiry.sendConsent] email send failed:", err);
  }

  logAudit({
    userId: user.id,
    action: "enquiry.consent_request_sent",
    entity: "enquiry",
    entityId: enquiry.id,
    entityRef: enquiry.enquiryRef,
    details: JSON.stringify({ sentTo: enquiry.email, emailDelivered: sent }),
  });

  if (!sent) {
    return res.json({ success: true, emailSent: false, consentUrl });
  }

  return res.json({ success: true, emailSent: true });
});

router.patch("/api/enquiries/:id/archive", requirePermission("enquiries", "edit"), async (req, res) => {
  try {
    const user = (req as any).user as User;
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ success: false, message: "Only admins can archive enquiries" });
    }
    const result = await enquiryService.archive(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.error });
    }
    logAudit({ userId: user.id, action: "update", entity: "enquiry", entityId: req.params.id, entityRef: result.enquiry.enquiryRef, details: JSON.stringify({ action: "archive" }) });
    return res.json({ success: true, archived: true, deleted: false, enquiryRef: result.enquiry.enquiryRef });
  } catch (err) {
    console.error("[enquiry.archive] error:", err);
    return res.status(500).json({ success: false, message: "Failed to archive enquiry" });
  }
});

router.patch("/api/enquiries/:id/restore", requirePermission("enquiries", "edit"), async (req, res) => {
  try {
    const user = (req as any).user as User;
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ success: false, message: "Only admins can restore enquiries" });
    }
    const result = await enquiryService.restore(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.error });
    }
    logAudit({ userId: user.id, action: "update", entity: "enquiry", entityId: req.params.id, entityRef: result.enquiry.enquiryRef, details: JSON.stringify({ action: "restore" }) });
    return res.json({ success: true, archived: false, deleted: false, enquiryRef: result.enquiry.enquiryRef });
  } catch (err) {
    console.error("[enquiry.restore] error:", err);
    return res.status(500).json({ success: false, message: "Failed to restore enquiry" });
  }
});

router.delete("/api/enquiries/:id", requirePermission("enquiries", "edit"), async (req, res) => {
  try {
    const user = (req as any).user as User;
    if (user.role !== "superadmin") {
      return res.status(403).json({ success: false, message: "Only superadmins can permanently delete enquiries" });
    }
    const existing = await enquiryService.get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Enquiry not found" });
    const { confirm } = req.body as { confirm?: string };
    if (!confirm || typeof confirm !== "string" || confirm !== existing.enquiryRef) {
      return res.status(400).json({ success: false, message: `Confirmation text must match the enquiry reference exactly: ${existing.enquiryRef}` });
    }
    const result = await enquiryService.hardDelete(req.params.id);
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });
    logAudit({ userId: user.id, action: "delete", entity: "enquiry", entityId: req.params.id, entityRef: result.enquiryRef, details: JSON.stringify({ action: "hard_delete" }) });
    return res.json({ success: true, archived: false, deleted: true, enquiryRef: result.enquiryRef });
  } catch (err) {
    console.error("[enquiry.hardDelete] error:", err);
    return res.status(500).json({ success: false, message: "Failed to permanently delete enquiry" });
  }
});

router.post("/api/enquiries/:id/convert", requirePermission("enquiries", "edit"), async (req, res) => {
  const enquiry = await enquiryService.get(req.params.id);
  const result = await enquiryService.convertToCase(req.params.id);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  const user = (req as any).user as User;
  logAudit({ userId: user.id, action: "convert", entity: "enquiry", entityId: req.params.id, entityRef: enquiry?.enquiryRef || req.params.id, details: JSON.stringify({ newCaseRef: result.newCase.caseRef, newCaseId: result.newCase.id }) });
  if (enquiry) {
    const clientName = `${enquiry.firstName} ${enquiry.lastName}`;
    caseActivityService.logEnquiryCreated(result.newCase.id, enquiry.enquiryRef, clientName, staffActor(user)).catch(() => {});
    caseActivityService.logCaseCreated(result.newCase.id, result.newCase.caseRef, enquiry.enquiryRef, staffActor(user)).catch(() => {});
  }
  return res.json(result.newCase);
});

export default router;
