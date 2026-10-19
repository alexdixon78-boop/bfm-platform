import { Router, type Request, type Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requirePermission } from "../middleware/permissions";
import { storage } from "../storage";
import { mediatorApplicantService } from "../services/mediator-applicant.service";
import { mediatorServiceApprovalService } from "../services/mediator-service-approval.service";
import { db } from "../db";
import { mediatorApplicants } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "../services/audit-log.service";
import {
  insertMediatorApplicantCheckSchema,
  insertMediatorApplicantReferenceSchema,
  applicantContractPatchSchema,
  insertMediatorServiceApprovalSchema,
  type User,
} from "@shared/schema";

const router = Router();

async function loadStaff(req: Request, res: Response): Promise<User | null> {
  const u = (req as any).user as User | undefined;
  if (!u) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return u;
}

async function sendApplicantUpdateLink(
  req: Request,
  applicant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    updateToken?: string | null;
    updateTokenExpiresAt?: Date | string | null;
    updateTokenUsedAt?: Date | string | null;
    updateTokenPurpose?: string | null;
  },
  purpose: "application" | "credentials" | "service_proof" = "application",
  serviceName?: string,
) {
  const existingToken = applicant.updateToken ?? null;
  const tokenExpiresAt = applicant.updateTokenExpiresAt ? new Date(applicant.updateTokenExpiresAt) : null;
  const tokenUsedAt = applicant.updateTokenUsedAt ? new Date(applicant.updateTokenUsedAt) : null;
  const tokenStillValid =
    !!existingToken &&
    !!tokenExpiresAt &&
    tokenExpiresAt > new Date() &&
    !tokenUsedAt;

  const token = tokenStillValid ? existingToken : crypto.randomUUID();
  const expiresAt = tokenStillValid
    ? tokenExpiresAt!
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db
    .update(mediatorApplicants)
    .set({
      updateToken: token,
      updateTokenExpiresAt: expiresAt,
      updateTokenUsedAt: null,
      updateTokenPurpose: purpose,
    })
    .where(eq(mediatorApplicants.id, applicant.id));

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  const baseUrl = process.env.APP_URL?.replace(/\/$/, "") ?? `${proto}://${host}`;
  const updateUrl = purpose === "application"
    ? `${baseUrl}/update-application/${token}`
    : `${baseUrl}/update-application/${token}?purpose=${encodeURIComponent(purpose)}`;
  const name = `${applicant.firstName} ${applicant.lastName}`;
  const requestLabel = serviceName ? `${serviceName.toUpperCase()} PROOF` : "APPLICATION UPDATE";

  console.log(`[APPLICANT UPDATE LINK] SENDING UPDATED LINK TO MEDIATOR ${applicant.email.toUpperCase()} FOR ${requestLabel}: ${updateUrl}`);

  try {
    const { sendApplicantFormResendEmail } = await import("../services/email.service");
    const ok = await sendApplicantFormResendEmail(applicant.email, name, updateUrl, serviceName);
    if (ok) console.log(`[APPLICANT UPDATE LINK] EMAIL SENT TO MEDIATOR ${applicant.email.toUpperCase()}: ${updateUrl}`);
    else console.error(`[APPLICANT UPDATE LINK] EMAIL FAILED FOR MEDIATOR ${applicant.email.toUpperCase()}: ${updateUrl}`);
    return { token, updateUrl, emailSent: ok };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[APPLICANT UPDATE LINK] EMAIL DISPATCH ERROR FOR MEDIATOR ${applicant.email.toUpperCase()}: ${message}. LINK: ${updateUrl}`);
    return { token, updateUrl, emailSent: false };
  }
}

router.get("/api/mediator-applicants", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const rows = await mediatorApplicantService.list();
  res.json(rows);
});

router.get("/api/mediator-applicants/:id", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const row = await mediatorApplicantService.getById(req.params.id);
  if (!row) return res.status(404).json({ message: "Applicant not found." });
  res.json(row);
});

router.post("/api/mediator-applicants", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const result = await mediatorApplicantService.create(actor.id, req.body ?? {});
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.status(201).json(result.applicant);
});

router.patch("/api/mediator-applicants/:id", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const result = await mediatorApplicantService.update(actor.id, req.params.id, req.body ?? {});
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.applicant);
});

router.delete("/api/mediator-applicants/:id", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  if (actor.role !== "superadmin" && actor.role !== "subadmin") {
    return res.status(403).json({ message: "Only administrators can permanently delete mediator applicants." });
  }
  const result = await mediatorApplicantService.delete(actor.id, req.params.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json({ success: true });
});

// ===== Task #207 — Credential checks (FMC/CMC, PI insurance, DBS)
// Reuse the shared insert schemas, drop applicant_id (URL-supplied) and kind
// (URL param for checks), and make every field optional for upsert/PATCH.
const checkPayloadSchema = insertMediatorApplicantCheckSchema
  .omit({ applicantId: true, kind: true })
  .partial()
  .strict();

const referenceCreateSchema = insertMediatorApplicantReferenceSchema
  .omit({ applicantId: true })
  .strict();

const referenceUpdateSchema = insertMediatorApplicantReferenceSchema
  .omit({ applicantId: true })
  .partial()
  .strict();

const serviceApprovalUpsertSchema = insertMediatorServiceApprovalSchema
  .omit({ id: true, applicantId: true, mediatorId: true, serviceTypeId: true, status: true, submittedAt: true })
  .partial()
  .extend({
    serviceTypeId: z.string().min(1),
    proofLink: z.string().nullable().optional(),
    proofFileName: z.string().nullable().optional(),
    proofFileData: z.string().nullable().optional(),
    proofMimeType: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
  })
  .strict();

const serviceApprovalReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewReason: z.string().nullable().optional(),
});

const applicantCheckEmailLabels: Record<string, string> = {
  fmc_cmc: "FMC / CMC accreditation",
  other_regulator: "Other regulator check",
  pi_insurance: "PI insurance",
  dbs: "DBS check",
  ppc_supervision: "PPC supervision",
};

router.get("/api/mediator-applicants/:id/checks", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const rows = await mediatorApplicantService.listChecks(req.params.id);
  res.json(rows);
});

router.put("/api/mediator-applicants/:id/checks/:kind", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = checkPayloadSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const result = await mediatorApplicantService.upsertCheck(actor.id, req.params.id, req.params.kind, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.check);
});

router.post("/api/mediator-applicants/:id/checks/:kind/request", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const result = await mediatorApplicantService.requestCheck(actor.id, req.params.id, req.params.kind);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  const applicant = await mediatorApplicantService.getById(req.params.id);
  let emailSent = false;
  let updateUrl: string | null = null;
  if (applicant) {
    const emailResult = await sendApplicantUpdateLink(req, applicant, "credentials", applicantCheckEmailLabels[req.params.kind] ?? "application update");
    emailSent = emailResult.emailSent;
    updateUrl = emailResult.updateUrl;
  }
  res.status(201).json({ check: result.check, emailSent, updateUrl });
});

router.post("/api/mediator-applicants/:id/update-link/request", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const applicant = await mediatorApplicantService.getById(req.params.id);
  if (!applicant) return res.status(404).json({ message: "Applicant not found." });
  const emailResult = await sendApplicantUpdateLink(req, applicant, "credentials");
  await logAudit({
    userId: actor.id,
    action: "applicant_update_link_requested",
    entity: "mediator",
    entityId: applicant.id,
    entityRef: applicant.email,
    details: JSON.stringify({ kind: "credentials_update", emailSent: emailResult.emailSent, updateUrl: emailResult.updateUrl }),
  });
  res.status(201).json(emailResult);
});

// ===== Task #207 — Professional references (max 2 per applicant)
router.get("/api/mediator-applicants/:id/references", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const rows = await mediatorApplicantService.listReferences(req.params.id);
  res.json(rows);
});

router.post("/api/mediator-applicants/:id/references", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = referenceCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const result = await mediatorApplicantService.createReference(actor.id, req.params.id, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.status(201).json(result.reference);
});

router.patch("/api/mediator-applicants/:id/references/:refId", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = referenceUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const result = await mediatorApplicantService.updateReference(actor.id, req.params.id, req.params.refId, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.reference);
});

router.delete("/api/mediator-applicants/:id/references/:refId", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const result = await mediatorApplicantService.deleteReference(actor.id, req.params.id, req.params.refId);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json({ success: true });
});

// ===== Task #208 — Contract & registrations panel
router.patch("/api/mediator-applicants/:id/contract", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = applicantContractPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  }
  const result = await mediatorApplicantService.updateContract(actor.id, req.params.id, parsed.data);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result.applicant);
});

router.get("/api/mediator-applicants/:id/service-approvals", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const rows = await mediatorServiceApprovalService.listForApplicant(req.params.id);
  res.json(rows);
});

router.post("/api/mediator-applicants/:id/service-approvals/:serviceTypeId/request", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const row = await mediatorServiceApprovalService.requestMissing(actor.id, req.params.id, req.params.serviceTypeId);
  const applicant = await mediatorApplicantService.getById(req.params.id);
  if (applicant) {
    await sendApplicantUpdateLink(req, applicant, "service_proof", service.name);
  }
  res.status(201).json(row);
});

router.put("/api/mediator-applicants/:id/service-approvals/:serviceTypeId", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceApprovalUpsertSchema.safeParse({ ...req.body, serviceTypeId: req.params.serviceTypeId });
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const row = await mediatorServiceApprovalService.upsertSubmission(actor.id, {
    applicantId: req.params.id,
    serviceTypeId: req.params.serviceTypeId,
    proofLink: parsed.data.proofLink ?? null,
    proofFileName: parsed.data.proofFileName ?? null,
    proofFileData: parsed.data.proofFileData ?? null,
    proofMimeType: parsed.data.proofMimeType ?? null,
    expiryDate: parsed.data.expiryDate ?? null,
  });
  res.json(row);
});

router.post("/api/mediator-applicants/:id/service-approvals/:serviceTypeId/review", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const service = await storage.getServiceType(req.params.serviceTypeId);
  if (!service) return res.status(404).json({ message: "Service type not found" });
  const parsed = serviceApprovalReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const row = await mediatorServiceApprovalService.review(actor.id, { applicantId: req.params.id }, req.params.serviceTypeId, parsed.data.decision, parsed.data.reviewReason ?? null);
  if (!row) return res.status(404).json({ message: "Service approval not found" });
  let notificationSentToMediator = false;
  if (parsed.data.decision === "rejected") {
    const applicant = await mediatorApplicantService.getById(req.params.id);
    if (applicant) {
      const result = await sendApplicantUpdateLink(req, applicant, "service_proof", service.name);
      notificationSentToMediator = result.emailSent;
      await logAudit({
        userId: actor.id,
        action: notificationSentToMediator ? "service_proof_rejection_notification_sent" : "service_proof_rejection_notification_failed",
        entity: "mediator_applicant",
        entityId: req.params.id,
        details: JSON.stringify({
          serviceTypeId: req.params.serviceTypeId,
          serviceName: service.name,
          email: applicant.email,
          emailSent: notificationSentToMediator,
        }),
      });
    }
  }
  res.json({ ...row, notificationSentToMediator });
});

// ===== Task #244 — Resend pre-filled application form to the applicant
const RESEND_STAGES = new Set(["recruitment_approach", "interview"]);

router.post("/api/mediator-applicants/:id/resend-form", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const applicant = await mediatorApplicantService.getById(req.params.id);
  if (!applicant) return res.status(404).json({ message: "Applicant not found." });
  if (applicant.convertedUserId) {
    return res.status(400).json({ message: "This applicant has already been converted to a mediator." });
  }
  if (!RESEND_STAGES.has(applicant.stage)) {
    return res.status(400).json({ message: "Form resend is only available at the Applications and Interview stages." });
  }

  await sendApplicantUpdateLink(req, applicant, "application");

  logAudit({
    userId: actor.id,
    action: "resend_application_form",
    entity: "mediator_applicant",
    entityId: req.params.id,
    details: JSON.stringify({ email: applicant.email, name, sentBy: actor.email }),
  });

  return res.json({ ok: true });
});

// ===== Task #249 — Accept for interview / Reject applicant
const ACCEPT_INTERVIEW_STAGES = new Set(["recruitment_approach"]);
const REJECT_APPLICANT_STAGES = new Set(["recruitment_approach", "interview"]);

const acceptInterviewSchema = z.object({
  interviewLink: z.string().optional(),
  emailSubject: z.string().min(1, "Subject is required"),
  emailBody: z.string().min(1, "Body is required"),
});

const rejectApplicantSchema = z.object({
  reason: z.string().optional(),
  sendEmail: z.boolean(),
  emailSubject: z.string().optional(),
  emailBody: z.string().optional(),
});

router.post("/api/mediator-applicants/:id/accept-interview", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const applicant = await mediatorApplicantService.getById(req.params.id);
  if (!applicant) return res.status(404).json({ message: "Applicant not found." });
  if (!ACCEPT_INTERVIEW_STAGES.has(applicant.stage)) {
    return res.status(400).json({ message: "Applicant must be at the Applications stage to accept for interview." });
  }

  const parsed = acceptInterviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const { interviewLink, emailSubject, emailBody } = parsed.data;

  const result = await mediatorApplicantService.update(actor.id, req.params.id, { stage: "interview" });
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  try {
    const { sendApplicantInterviewInviteEmail } = await import("../services/email.service");
    const ok = await sendApplicantInterviewInviteEmail(applicant.email, emailSubject, emailBody);
    if (ok) console.log(`[AcceptInterview] Email sent to ${applicant.email}`);
    else console.error(`[AcceptInterview] Email failed for ${applicant.email}`);
  } catch (err) {
    console.error("[AcceptInterview] Email dispatch error:", err);
  }

  logAudit({
    userId: actor.id,
    action: "applicant_accepted_for_interview",
    entity: "mediator_applicant",
    entityId: req.params.id,
    details: JSON.stringify({
      email: applicant.email,
      name: `${applicant.firstName} ${applicant.lastName}`,
      interviewLink: interviewLink || null,
    }),
  });

  return res.json(result.applicant);
});

router.post("/api/mediator-applicants/:id/reject", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const applicant = await mediatorApplicantService.getById(req.params.id);
  if (!applicant) return res.status(404).json({ message: "Applicant not found." });
  if (applicant.convertedUserId) {
    return res.status(400).json({ message: "Cannot reject a converted applicant. Use the off-boarding workflow instead." });
  }
  if (!REJECT_APPLICANT_STAGES.has(applicant.stage)) {
    return res.status(400).json({ message: "Applicant must be at the Applications or Interview stage to reject." });
  }

  const parsed = rejectApplicantSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
  const { reason, sendEmail, emailSubject, emailBody } = parsed.data;

  const result = await mediatorApplicantService.update(actor.id, req.params.id, {
    stage: "rejected",
    rejectedReason: reason || null,
  });
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  if (sendEmail && emailSubject && emailBody) {
    try {
      const { sendApplicantRejectionEmail } = await import("../services/email.service");
      const ok = await sendApplicantRejectionEmail(applicant.email, emailSubject, emailBody);
      if (ok) console.log(`[RejectApplicant] Email sent to ${applicant.email}`);
      else console.error(`[RejectApplicant] Email failed for ${applicant.email}`);
    } catch (err) {
      console.error("[RejectApplicant] Email dispatch error:", err);
    }
  }

  logAudit({
    userId: actor.id,
    action: "applicant_rejected",
    entity: "mediator_applicant",
    entityId: req.params.id,
    details: JSON.stringify({
      email: applicant.email,
      name: `${applicant.firstName} ${applicant.lastName}`,
      reason: reason || null,
      emailSent: sendEmail,
    }),
  });

  return res.json(result.applicant);
});

router.post("/api/mediator-applicants/:id/convert", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const sendInvite = req.body?.sendInvite !== false;
  const result = await mediatorApplicantService.convert(actor.id, req.params.id, { sendInvite });
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json({
    applicant: result.applicant,
    mediatorId: result.mediatorId,
    emailSent: result.emailSent,
    message: result.emailSent
      ? "Mediator created and invite email sent."
      : sendInvite
        ? "Mediator created. The invite email failed to send — share the invite link manually."
        : "Mediator created (no invite sent).",
  });
});

export default router;
