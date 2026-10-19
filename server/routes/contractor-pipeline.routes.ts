import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/permissions";
import { storage } from "../storage";
import { db } from "../db";
import {
  contractorApplicants,
  CONTRACTOR_APPLICANT_STAGES,
  type ContractorApplicantStage,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { contractorPipelineService } from "../services/contractor-pipeline.service";
import { logAudit } from "../services/audit-log.service";
import type { User } from "@shared/schema";
import { getPublicAppUrl } from "../utils/app-url";

const router = Router();

async function loadStaff(req: Request, res: Response): Promise<User | null> {
  const u = (req as any).user as User | undefined;
  if (!u) { res.status(401).json({ message: "Not authenticated" }); return null; }
  return u;
}

// ── GET /api/contractor-pipeline ─────────────────────────────────────────────
router.get("/api/contractor-pipeline", requirePermission("contractors", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const board = await contractorPipelineService.getBoard();
  res.json(board);
});

// ── PATCH /api/contractor-pipeline/move ──────────────────────────────────────
router.patch("/api/contractor-pipeline/move", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const { kind, id, toStage, fromStage } = req.body ?? {};
  if (!kind || !id || !toStage) {
    return res.status(400).json({ message: "kind, id, and toStage are required." });
  }
  const result = await contractorPipelineService.move(actor.id, { kind, id, toStage, fromStage });
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

// ── GET /api/contractor-applicants ───────────────────────────────────────────
router.get("/api/contractor-applicants", requirePermission("contractors", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const rows = await db.select().from(contractorApplicants);
  res.json(rows);
});

// ── POST /api/contractor-applicants ──────────────────────────────────────────
const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  contractorType: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  stage: z.enum(CONTRACTOR_APPLICANT_STAGES).optional(),
});

router.post("/api/contractor-applicants", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid data.", errors: parsed.error.flatten() });
  const d = parsed.data;
  const [row] = await db.insert(contractorApplicants).values({
    firstName: d.firstName.trim(),
    lastName: d.lastName.trim(),
    email: d.email.toLowerCase().trim(),
    phone: d.phone?.trim() || null,
    contractorType: d.contractorType?.trim() || null,
    source: d.source?.trim() || null,
    notes: d.notes?.trim() || null,
    stage: d.stage ?? "prospect",
    createdBy: actor.id,
  }).returning();
  logAudit({ userId: actor.id, action: "create", entity: "contractor_applicant", entityId: row.id, entityRef: row.email });
  res.status(201).json(row);
});

// ── PATCH /api/contractor-applicants/:id ─────────────────────────────────────
const updateSchema = createSchema.partial();

router.patch("/api/contractor-applicants/:id", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid data.", errors: parsed.error.flatten() });

  const rows = await db.select().from(contractorApplicants).where(eq(contractorApplicants.id, req.params.id)).limit(1);
  if (!rows.length) return res.status(404).json({ message: "Applicant not found." });

  // Converted applicants: only non-staging fields may be edited (read-only stage/converted state)
  if (rows[0].convertedUserId) {
    return res.status(400).json({ message: "Converted applicants cannot be edited via this endpoint. Update the contractor user account instead." });
  }

  const d = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (d.firstName !== undefined) update.firstName = d.firstName.trim();
  if (d.lastName !== undefined) update.lastName = d.lastName.trim();
  if (d.email !== undefined) update.email = d.email.toLowerCase().trim();
  if (d.phone !== undefined) update.phone = d.phone?.trim() || null;
  if (d.contractorType !== undefined) update.contractorType = d.contractorType?.trim() || null;
  if (d.source !== undefined) update.source = d.source?.trim() || null;
  if (d.notes !== undefined) update.notes = d.notes?.trim() || null;
  if (d.stage !== undefined) update.stage = d.stage;
  const [updated] = await db.update(contractorApplicants).set(update as never).where(eq(contractorApplicants.id, req.params.id)).returning();
  logAudit({ userId: actor.id, action: "update", entity: "contractor_applicant", entityId: req.params.id, entityRef: updated.email });
  res.json(updated);
});

// ── DELETE /api/contractor-applicants/:id ────────────────────────────────────
router.delete("/api/contractor-applicants/:id", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  if (actor.role !== "superadmin" && actor.role !== "subadmin") {
    return res.status(403).json({ message: "Only administrators can permanently delete contractor applicants." });
  }
  const rows = await db.select().from(contractorApplicants).where(eq(contractorApplicants.id, req.params.id)).limit(1);
  if (!rows.length) return res.status(404).json({ message: "Applicant not found." });
  if (rows[0].convertedUserId) return res.status(400).json({ message: "Converted applicants cannot be deleted." });
  await db.delete(contractorApplicants).where(eq(contractorApplicants.id, req.params.id));
  logAudit({ userId: actor.id, action: "delete", entity: "contractor_applicant", entityId: req.params.id, entityRef: rows[0].email });
  res.json({ success: true });
});

// ── POST /api/contractor-applicants/:id/accept ───────────────────────────────
const acceptSchema = z.object({
  emailSubject: z.string().min(1, "Subject is required"),
  emailBody: z.string().min(1, "Body is required"),
});

router.post("/api/contractor-applicants/:id/accept", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const rows = await db.select().from(contractorApplicants).where(eq(contractorApplicants.id, req.params.id)).limit(1);
  if (!rows.length) return res.status(404).json({ message: "Applicant not found." });
  const a = rows[0];
  if (a.convertedUserId) return res.status(400).json({ message: "Converted applicants cannot be accepted via this endpoint." });
  if (a.stage !== "prospect") return res.status(400).json({ message: "Applicant must be at the Applications stage to accept." });

  const parsed = acceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload.", errors: parsed.error.flatten() });
  const { emailSubject, emailBody } = parsed.data;

  await db.update(contractorApplicants)
    .set({ stage: "screening", updatedAt: new Date() })
    .where(eq(contractorApplicants.id, req.params.id));

  try {
    const { sendContractorApplicantAcceptEmail } = await import("../services/email.service");
    await sendContractorApplicantAcceptEmail(a.email, emailSubject, emailBody);
  } catch (err) {
    console.error("[ContractorPipeline] Accept email error:", err);
  }

  logAudit({
    userId: actor.id, action: "applicant_accepted", entity: "contractor_applicant",
    entityId: req.params.id, entityRef: a.email,
    details: JSON.stringify({ name: `${a.firstName} ${a.lastName}`, movedTo: "screening" }),
  });

  res.json({ ok: true });
});

// ── POST /api/contractor-applicants/:id/reject ───────────────────────────────
router.post("/api/contractor-applicants/:id/reject", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const { reason } = req.body ?? {};
  const result = await contractorPipelineService.reject(actor.id, req.params.id, reason ?? "");
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

// ── POST /api/contractor-applicants/:id/convert ──────────────────────────────
const convertSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  contractorType: z.string().optional(),
  password: z.string().optional(),
  sendInvite: z.boolean().optional(),
});

router.post("/api/contractor-applicants/:id/convert", requirePermission("contractors", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const parsed = convertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid data.", errors: parsed.error.flatten() });
  const d = parsed.data;

  // Validate: password or sendInvite must be set (one way to set up the account)
  if (!d.password && !d.sendInvite) {
    return res.status(400).json({ message: "Either provide a password or choose to send an invite email." });
  }

  const result = await contractorPipelineService.convert(actor.id, req.params.id, {
    name: d.name,
    email: d.email,
    contractorType: d.contractorType,
    password: d.password,
  });
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  // Optionally send invite email
  if (d.sendInvite) {
    try {
      const crypto = await import("crypto");
      const rawToken = crypto.default.randomUUID();
      const tokenHash = crypto.default.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await storage.updateUser(result.userId, { onboardingToken: tokenHash, onboardingTokenExpiresAt: expiresAt });
      const inviteUrl = `${getPublicAppUrl()}/onboarding?token=${rawToken}`;
      const { sendContractorInviteEmail } = await import("../services/email.service");
      await sendContractorInviteEmail(result.email, d.name, inviteUrl);
      logAudit({ userId: actor.id, action: "invite_sent", entity: "contractor", entityId: result.userId, entityRef: result.email });
    } catch (err) {
      console.error("[ContractorPipeline] Invite email error:", err);
    }
  }

  res.status(201).json({ success: true, userId: result.userId, email: result.email });
});

// ── GET /api/contractor-pipeline/:kind/:id/timeline ──────────────────────────
router.get("/api/contractor-pipeline/:kind/:id/timeline", requirePermission("contractors", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const kind = req.params.kind === "contractor" ? "contractor" : "applicant";
  const rows = await contractorPipelineService.timeline(kind, req.params.id);
  res.json(rows);
});

export default router;
