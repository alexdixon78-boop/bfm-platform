import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { logAudit } from "../services/audit-log.service";
import { db } from "../db";
import { contractorApplicationLinks, contractorApplicants } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { User } from "@shared/schema";
import type { Request, Response } from "express";

const router = Router();

async function loadStaff(req: Request, res: Response): Promise<User | null> {
  const u = await storage.getUser(req.session.userId!);
  if (!u) { res.status(401).json({ message: "Not authenticated" }); return null; }
  if (u.role !== "superadmin" && u.role !== "subadmin") {
    res.status(403).json({ message: "Only superadmin or subadmin can manage contractor application links." });
    return null;
  }
  return u;
}

function getBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  return `${proto}://${host}`;
}

// ── GET /api/contractor-application-link ────────────────────────────────────
router.get("/api/contractor-application-link", requireAuth, async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const rows = await db
    .select({ token: contractorApplicationLinks.token, createdAt: contractorApplicationLinks.createdAt, createdBy: contractorApplicationLinks.createdBy })
    .from(contractorApplicationLinks)
    .limit(1);

  if (rows.length === 0) return res.json({ token: null, url: null, createdAt: null, createdByName: null });

  const row = rows[0];
  const url = `${getBaseUrl(req)}/apply/contractor/${row.token}`;

  let createdByName: string | null = null;
  if (row.createdBy) {
    const creator = await storage.getUser(row.createdBy);
    if (creator) {
      createdByName = (creator as any).firstName && (creator as any).lastName
        ? `${(creator as any).firstName} ${(creator as any).lastName}`
        : (creator.email ?? null);
    }
  }

  return res.json({ token: row.token, url, createdAt: row.createdAt, createdByName });
});

// ── POST /api/contractor-application-link ────────────────────────────────────
router.post("/api/contractor-application-link", requireAuth, async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const token = crypto.randomUUID();
  await db.delete(contractorApplicationLinks);
  await db.insert(contractorApplicationLinks).values({ token, createdBy: actor.id });

  logAudit({
    userId: actor.id, action: "application_link_generated",
    entity: "contractor_application_link", entityId: token,
    details: JSON.stringify({ generatedBy: actor.email }),
  });

  const url = `${getBaseUrl(req)}/apply/contractor/${token}`;
  return res.status(201).json({ token, url, createdAt: new Date() });
});

// ── GET /api/public/contractor-application-link/validate/:token ──────────────
router.get("/api/public/contractor-application-link/validate/:token", async (req, res) => {
  const { token } = req.params;
  const rows = await db
    .select({ id: contractorApplicationLinks.id })
    .from(contractorApplicationLinks)
    .where(eq(contractorApplicationLinks.token, token))
    .limit(1);
  if (rows.length === 0) return res.status(410).json({ error: "link_expired" });
  return res.json({ ok: true });
});

// ── POST /api/public/contractor-application ──────────────────────────────────
const publicApplySchema = z.object({
  token: z.string().min(1),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  contractorType: z.string().min(1, "Contractor type is required"),
  contractorTypeOther: z.string().optional(),
  source: z.string().optional(),
  sourceOther: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/api/public/contractor-application", async (req, res) => {
  const parsed = publicApplySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid submission.", errors: parsed.error.flatten() });
  const data = parsed.data;

  const linkRows = await db
    .select()
    .from(contractorApplicationLinks)
    .where(eq(contractorApplicationLinks.token, data.token))
    .limit(1);
  if (linkRows.length === 0) return res.status(410).json({ error: "link_expired" });

  const existing = await db
    .select({ id: contractorApplicants.id })
    .from(contractorApplicants)
    .where(eq(contractorApplicants.email, data.email.toLowerCase().trim()))
    .limit(1);
  if (existing.length > 0) return res.status(409).json({ message: "An application with this email address has already been submitted." });

  const resolvedSource = data.source === "Other" && data.sourceOther?.trim()
    ? `Other — ${data.sourceOther.trim()}`
    : (data.source?.trim() || null);

  const resolvedContractorType = data.contractorType === "Other" && data.contractorTypeOther?.trim()
    ? `Other — ${data.contractorTypeOther.trim()}`
    : data.contractorType.trim();

  let applicantId: string;
  try {
    const [applicant] = await db.insert(contractorApplicants).values({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email.toLowerCase().trim(),
      phone: data.phone?.trim() || null,
      contractorType: resolvedContractorType,
      source: resolvedSource,
      notes: data.notes?.trim() || null,
      stage: "prospect",
      createdBy: null,
    }).returning();
    applicantId = applicant.id;
  } catch (err) {
    console.error("[ContractorApplication] Insert failed:", err);
    return res.status(500).json({ message: "Failed to submit application. Please try again." });
  }

  logAudit({
    userId: null, action: "public_application_submitted",
    entity: "contractor_applicant", entityId: applicantId,
    details: JSON.stringify({ email: data.email.toLowerCase().trim(), name: `${data.firstName.trim()} ${data.lastName.trim()}`, contractorType: data.contractorType }),
  });

  const applicantEmail = data.email.toLowerCase().trim();
  const applicantName = `${data.firstName.trim()} ${data.lastName.trim()}`;
  try {
    const { sendContractorApplicationConfirmationEmail, sendNewContractorApplicationAdminEmail } = await import("../services/email.service");
    await Promise.all([
      sendContractorApplicationConfirmationEmail(applicantEmail, applicantName, data.contractorType),
      sendNewContractorApplicationAdminEmail(applicantName, applicantEmail, data.contractorType),
    ]);
  } catch (err) {
    console.error("[ContractorApplication] Email dispatch error:", err);
  }

  return res.status(201).json({ success: true, message: "Application submitted successfully." });
});

export default router;
