import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { logAudit } from "../services/audit-log.service";
import { db } from "../db";
import { mediatorProfileRepository } from "../repositories/mediator-profile.repository";
import {
  mediatorApplicationLinks,
  mediatorApplicants,
  mediatorApplicantChecks,
  mediatorApplicantReferences,
  APPLICANT_CHECK_KINDS,
} from "@shared/schema";
import { eq, sql as dsql } from "drizzle-orm";
import type { User } from "@shared/schema";
import type { Request, Response } from "express";
import { mediatorServiceApprovalService } from "../services/mediator-service-approval.service";

const router = Router();

async function loadStaff(req: Request, res: Response): Promise<User | null> {
  const u = await storage.getUser(req.session.userId!);
  if (!u) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  if (u.role !== "superadmin" && u.role !== "subadmin") {
    res.status(403).json({ message: "Only superadmin or subadmin can manage application links." });
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

// ── GET /api/mediator-application-link ───────────────────────────────────────
// Returns the current shared link row (token + createdAt + full URL + creator name) or null.
router.get("/api/mediator-application-link", requireAuth, async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const rows = await db
    .select({
      token: mediatorApplicationLinks.token,
      createdAt: mediatorApplicationLinks.createdAt,
      createdBy: mediatorApplicationLinks.createdBy,
    })
    .from(mediatorApplicationLinks)
    .limit(1);

  if (rows.length === 0) {
    return res.json({ token: null, url: null, createdAt: null, createdByName: null });
  }
  const row = rows[0];
  const url = `${getBaseUrl(req)}/apply/mediator/${row.token}`;

  // Look up creator separately to avoid leftJoin crashing when createdBy is
  // null or the user row has been deleted (Drizzle orderSelectedFields bug).
  let createdByName: string | null = null;
  if (row.createdBy) {
    const creator = await storage.getUser(row.createdBy);
    if (creator) {
      createdByName = (creator.firstName && creator.lastName)
        ? `${creator.firstName} ${creator.lastName}`
        : (creator.email ?? null);
    }
  }

  return res.json({ token: row.token, url, createdAt: row.createdAt, createdByName });
});

// ── POST /api/mediator-application-link ──────────────────────────────────────
// Generates a new token (hard-deletes any previous row so old links break).
router.post("/api/mediator-application-link", requireAuth, async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;

  const token = crypto.randomUUID();

  await db.delete(mediatorApplicationLinks);
  await db.insert(mediatorApplicationLinks).values({
    token,
    createdBy: actor.id,
  });

  logAudit({
    userId: actor.id,
    action: "application_link_generated",
    entity: "mediator_application_link",
    entityId: token,
    details: JSON.stringify({ generatedBy: actor.email }),
  });

  const url = `${getBaseUrl(req)}/apply/mediator/${token}`;
  return res.status(201).json({ token, url, createdAt: new Date() });
});

// ── GET /api/public/mediator-application-link/validate/:token ────────────────
// Unauthenticated. Returns 200 if the token is valid, 410 if expired/replaced.
router.get("/api/public/mediator-application-link/validate/:token", async (req, res) => {
  const { token } = req.params;
  const rows = await db
    .select({ id: mediatorApplicationLinks.id })
    .from(mediatorApplicationLinks)
    .where(eq(mediatorApplicationLinks.token, token))
    .limit(1);
  if (rows.length === 0) {
    return res.status(410).json({ error: "link_expired" });
  }
  return res.json({ ok: true });
});

// ── POST /api/public/mediator-application ────────────────────────────────────
// Unauthenticated. Validates token, creates applicant + credential check rows
// + reference rows (all in one transaction), writes audit log, and sends
// confirmation email.
const refSchema = z.object({
  refereeName: z.string().min(1, "Referee name is required"),
  refereeEmail: z.string().email("Valid referee email is required"),
  refereePhone: z.string().optional(),
  organisation: z.string().optional(),
  roleOrJobTitle: z.string().optional(),
});

const publicApplySchema = z.object({
  token: z.string().min(1),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  source: z.string().optional(),
  sourceOther: z.string().optional(),
  accreditationStatus: z.string().optional(),
  areaOfPractice: z.array(z.string()).optional(),
  // Section C — Credentials (all optional; stored as check rows)
  fmcUrn: z.string().optional(),
  fmcDate: z.string().optional(),
  piProvider: z.string().optional(),
  piPolicy: z.string().optional(),
  piExpiry: z.string().optional(),
  dbsCert: z.string().optional(),
  dbsDate: z.string().optional(),
  // Section D — Professional references (up to 2)
  references: z.array(refSchema).max(2).optional(),
  serviceApprovals: z.array(z.object({
    serviceTypeId: z.string().min(1),
    proofLink: z.string().optional(),
    proofFileName: z.string().optional(),
    proofFileData: z.string().optional(),
    proofMimeType: z.string().optional(),
    expiryDate: z.string().optional(),
  })).max(50).optional(),
});

router.post("/api/public/mediator-application", async (req, res) => {
  const parsed = publicApplySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid submission.", errors: parsed.error.flatten() });
  }
  const data = parsed.data;

  // Validate token
  const linkRows = await db
    .select()
    .from(mediatorApplicationLinks)
    .where(eq(mediatorApplicationLinks.token, data.token))
    .limit(1);
  if (linkRows.length === 0) {
    return res.status(410).json({ error: "link_expired" });
  }

  // Duplicate email guard
  const existing = await db
    .select({ id: mediatorApplicants.id })
    .from(mediatorApplicants)
    .where(eq(mediatorApplicants.email, data.email.toLowerCase().trim()))
    .limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ message: "An application with this email address has already been submitted." });
  }

  const serviceTypeRows = await storage.listServiceTypes();
  const validServiceIds = new Set(serviceTypeRows.map((row) => row.id));
  const serviceApprovals = (data.serviceApprovals ?? []).filter((row) => validServiceIds.has(row.serviceTypeId));

  // Resolve "how did you hear about us" — if "Other" was selected, use the
  // freeform sourceOther value so the data is still human-readable.
  const resolvedSource = data.source === "Other" && data.sourceOther?.trim()
    ? `Other — ${data.sourceOther.trim()}`
    : (data.source?.trim() || null);

  // All inserts in a single transaction so a partial failure leaves no orphans.
  let applicantId: string;
  try {
    const result = await db.transaction(async (tx) => {
      const [applicant] = await tx
        .insert(mediatorApplicants)
        .values({
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          email: data.email.toLowerCase().trim(),
          phone: data.phone?.trim() || null,
          source: resolvedSource,
          accreditationStatus: data.accreditationStatus?.trim() || null,
          areaOfPractice: data.areaOfPractice && data.areaOfPractice.length > 0
            ? data.areaOfPractice
            : null,
          stage: "recruitment_approach",
          createdBy: null,
        })
        .returning();

      // Create all three credential check rows (status=pending)
      await tx.insert(mediatorApplicantChecks).values([
        {
          applicantId: applicant.id,
          kind: "fmc_cmc",
          status: "pending",
          referenceNumber: data.fmcUrn?.trim() || null,
          issuedAt: data.fmcDate?.trim() || null,
        },
        {
          applicantId: applicant.id,
          kind: "pi_insurance",
          status: "pending",
          provider: data.piProvider?.trim() || null,
          referenceNumber: data.piPolicy?.trim() || null,
          expiresAt: data.piExpiry?.trim() || null,
        },
        {
          applicantId: applicant.id,
          kind: "dbs",
          status: "pending",
          referenceNumber: data.dbsCert?.trim() || null,
          issuedAt: data.dbsDate?.trim() || null,
        },
      ]);

      // Create reference rows (up to 2)
      if (data.references && data.references.length > 0) {
        const refRows = data.references.slice(0, 2).map((r) => ({
          applicantId: applicant.id,
          refereeName: r.refereeName.trim(),
          refereeEmail: r.refereeEmail.toLowerCase().trim(),
          refereePhone: r.refereePhone?.trim() || null,
          organisation: r.organisation?.trim() || null,
          relationship: r.roleOrJobTitle?.trim() || null,
          status: "pending",
          requestedBy: null,
        }));
        await tx.insert(mediatorApplicantReferences).values(refRows);
      }

      return applicant;
    });

    applicantId = result.id;

    for (const serviceApproval of serviceApprovals) {
      await mediatorServiceApprovalService.upsertSubmission(null, {
        applicantId,
        serviceTypeId: serviceApproval.serviceTypeId,
        proofLink: serviceApproval.proofLink?.trim() || null,
        proofFileName: serviceApproval.proofFileName?.trim() || null,
        proofFileData: serviceApproval.proofFileData || null,
        proofMimeType: serviceApproval.proofMimeType?.trim() || null,
        expiryDate: serviceApproval.expiryDate?.trim() || null,
      });
    }
  } catch (err) {
    console.error("[MediatorApplication] Transaction failed:", err);
    return res.status(500).json({ message: "Failed to submit application. Please try again." });
  }

  // Audit log (public submission — userId is null)
  logAudit({
    userId: null,
    action: "public_application_submitted",
    entity: "mediator_applicant",
    entityId: applicantId,
    details: JSON.stringify({
      email: data.email.toLowerCase().trim(),
      name: `${data.firstName.trim()} ${data.lastName.trim()}`,
      referenceCount: data.references?.length ?? 0,
      hasCredentials: !!(data.fmcUrn || data.piProvider || data.dbsCert),
    }),
  });

  // Confirmation + admin notification emails (best-effort — don't fail the submission on email error)
  const applicantEmail = data.email.toLowerCase().trim();
  const applicantName = `${data.firstName.trim()} ${data.lastName.trim()}`;
  try {
    const {
      sendMediatorApplicationConfirmationEmail,
      sendNewMediatorApplicationAdminEmail,
    } = await import("../services/email.service");
    const [confirmOk, adminOk] = await Promise.all([
      sendMediatorApplicationConfirmationEmail(applicantEmail, applicantName),
      sendNewMediatorApplicationAdminEmail(applicantName, applicantEmail),
    ]);
    if (confirmOk) {
      console.log(`[MediatorApplication] Confirmation email sent to ${applicantEmail}`);
    } else {
      console.error(`[MediatorApplication] Confirmation email FAILED for ${applicantEmail}`);
    }
    if (!adminOk) {
      console.error("[MediatorApplication] Admin notification email FAILED");
    }
  } catch (err) {
    console.error("[MediatorApplication] Email dispatch error:", err);
  }

  return res.status(201).json({
    success: true,
    message: "Application submitted successfully.",
  });
});

// ===== Task #244 — Public pre-fill and submit endpoints for applicant self-service

const credentialCheckLabelMap: Record<string, string> = {
  fmc_cmc: "FMC / CMC accreditation",
  other_regulator: "Other regulator check",
  pi_insurance: "PI insurance",
  dbs: "DBS check",
  ppc_supervision: "PPC supervision",
};

const publicCredentialCheckSchema = z.object({
  kind: z.enum(APPLICANT_CHECK_KINDS),
  referenceNumber: z.string().optional(),
  provider: z.string().optional(),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  evidenceUrl: z.string().optional(),
  notes: z.string().optional(),
  ppcSupervisorName: z.string().optional(),
  ppcSupervisorOrg: z.string().optional(),
  ppcSupervisorEmail: z.string().optional(),
  ppcSupervisorPhone: z.string().optional(),
  ppcSupervisorLastSignoff: z.string().optional(),
  ppcSupervisorNextReview: z.string().optional(),
});

const publicUpdateSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  source: z.string().optional(),
  sourceOther: z.string().optional(),
  accreditationStatus: z.string().optional(),
  areaOfPractice: z.array(z.string()).optional(),
  fmcUrn: z.string().optional(),
  fmcDate: z.string().optional(),
  fmcAccreditationStatus: z.string().optional(),
  fmcAccreditationDate: z.string().optional(),
  cmcRegNumber: z.string().optional(),
  otherRegulatorName: z.string().optional(),
  otherRegulatorNumber: z.string().optional(),
  higherQualifications: z.string().optional(),
  piProvider: z.string().optional(),
  piPolicy: z.string().optional(),
  piPolicyNumber: z.string().optional(),
  piExpiry: z.string().optional(),
  piCoverAmount: z.string().optional(),
  piExpiryDate: z.string().optional(),
  piCertificateUrl: z.string().optional(),
  icoRegistration: z.string().optional(),
  icoExpiryDate: z.string().optional(),
  dbsLevel: z.string().optional(),
  dbsCert: z.string().optional(),
  dbsCertNumber: z.string().optional(),
  dbsDate: z.string().optional(),
  dbsIssueDate: z.string().optional(),
  dbsCertificateUrl: z.string().optional(),
  ppcSupervisorName: z.string().optional(),
  ppcSupervisorOrg: z.string().optional(),
  ppcSupervisorEmail: z.string().optional(),
  ppcSupervisorPhone: z.string().optional(),
  ppcSupervisorLastSignoff: z.string().optional(),
  ppcSupervisorNextReview: z.string().optional(),
  credentialChecks: z.array(publicCredentialCheckSchema).max(10).optional(),
  references: z.array(refSchema).max(2).optional(),
  serviceApprovals: z.array(z.object({
    serviceTypeId: z.string().min(1),
    proofLink: z.string().optional(),
    proofFileName: z.string().optional(),
    proofFileData: z.string().optional(),
    proofMimeType: z.string().optional(),
    expiryDate: z.string().optional(),
  })).max(50).optional(),
});

// GET /api/public/applicant-update/:token
// Returns pre-fill data for the personalised update form. Validates the token.
router.get("/api/public/applicant-update/:token", async (req, res) => {
  const { token } = req.params;

  const rows = await db
    .select()
    .from(mediatorApplicants)
    .where(eq(mediatorApplicants.updateToken, token))
    .limit(1);

  if (rows.length === 0) {
    return res.status(410).json({ error: "link_expired" });
  }

  const applicant = rows[0];

  if (
    !applicant.updateTokenExpiresAt ||
    applicant.updateTokenExpiresAt < new Date() ||
    applicant.updateTokenUsedAt
  ) {
    return res.status(410).json({ error: "link_expired" });
  }

  // Fetch credential checks
  const checks = await db
    .select()
    .from(mediatorApplicantChecks)
    .where(eq(mediatorApplicantChecks.applicantId, applicant.id));

  const fmc = checks.find((c) => c.kind === "fmc_cmc");
  const otherRegulator = checks.find((c) => c.kind === "other_regulator");
  const pi = checks.find((c) => c.kind === "pi_insurance");
  const dbs = checks.find((c) => c.kind === "dbs");
  const ppc = checks.find((c) => c.kind === "ppc_supervision");

  // Fetch references
  const refs = await db
    .select()
    .from(mediatorApplicantReferences)
    .where(eq(mediatorApplicantReferences.applicantId, applicant.id))
    .limit(2);
  const serviceApprovals = await mediatorServiceApprovalService.listForApplicant(applicant.id);

  // Parse "Other — [custom]" source back to source + sourceOther
  let parsedSource = applicant.source ?? "";
  let parsedSourceOther = "";
  if (parsedSource.startsWith("Other — ")) {
    parsedSourceOther = parsedSource.slice("Other — ".length);
    parsedSource = "Other";
  }

  return res.json({
    firstName: applicant.firstName,
    lastName: applicant.lastName,
    email: applicant.email,
    emailReadOnly: true,
    updatePurpose: applicant.updateTokenPurpose ?? "application",
    phone: applicant.phone ?? "",
    source: parsedSource,
    sourceOther: parsedSourceOther,
    accreditationStatus: applicant.accreditationStatus ?? "",
    areaOfPractice: applicant.areaOfPractice ?? [],
    fmcUrn: applicant.fmcUrn ?? fmc?.referenceNumber ?? "",
    fmcAccreditationStatus: applicant.fmcAccreditationStatus ?? "",
    fmcAccreditationDate: applicant.fmcAccreditationDate ?? fmc?.issuedAt ?? "",
    cmcRegNumber: applicant.cmcRegNumber ?? "",
    otherRegulatorName: applicant.otherRegulatorName ?? otherRegulator?.provider ?? "",
    otherRegulatorNumber: applicant.otherRegulatorNumber ?? otherRegulator?.referenceNumber ?? "",
    higherQualifications: applicant.higherQualifications ?? "",
    piProvider: applicant.piProvider ?? pi?.provider ?? "",
    piPolicyNumber: applicant.piPolicyNumber ?? pi?.referenceNumber ?? "",
    piCoverAmount: applicant.piCoverAmount ?? pi?.notes ?? "",
    piExpiryDate: applicant.piExpiryDate ?? pi?.expiresAt ?? "",
    piCertificateUrl: applicant.piCertificateUrl ?? pi?.evidenceUrl ?? "",
    icoRegistration: applicant.icoRegistration ?? "",
    icoExpiryDate: applicant.icoExpiryDate ?? "",
    dbsLevel: applicant.dbsLevel ?? dbs?.provider ?? "",
    dbsCertNumber: applicant.dbsCertNumber ?? dbs?.referenceNumber ?? "",
    dbsIssueDate: applicant.dbsIssueDate ?? dbs?.issuedAt ?? "",
    dbsCertificateUrl: applicant.dbsCertificateUrl ?? dbs?.evidenceUrl ?? "",
    ppcSupervisorName: applicant.ppcSupervisorName ?? ppc?.ppcSupervisorName ?? "",
    ppcSupervisorOrg: applicant.ppcSupervisorOrg ?? ppc?.ppcSupervisorOrg ?? "",
    ppcSupervisorEmail: applicant.ppcSupervisorEmail ?? ppc?.ppcSupervisorEmail ?? "",
    ppcSupervisorPhone: applicant.ppcSupervisorPhone ?? ppc?.ppcSupervisorPhone ?? "",
    ppcSupervisorLastSignoff: applicant.ppcSupervisorLastSignoff ?? ppc?.ppcSupervisorLastSignoff ?? "",
    ppcSupervisorNextReview: applicant.ppcSupervisorNextReview ?? ppc?.ppcSupervisorNextReview ?? "",
    credentialChecks: checks.map((check) => ({
      kind: check.kind,
      label: credentialCheckLabelMap[check.kind] ?? check.kind,
      status: check.status,
      referenceNumber: check.referenceNumber ?? "",
      provider: check.provider ?? "",
      issuedAt: check.issuedAt ?? "",
      expiresAt: check.expiresAt ?? "",
      evidenceUrl: check.evidenceUrl ?? "",
      notes: check.notes ?? "",
      ppcSupervisorName: check.ppcSupervisorName ?? "",
      ppcSupervisorOrg: check.ppcSupervisorOrg ?? "",
      ppcSupervisorEmail: check.ppcSupervisorEmail ?? "",
      ppcSupervisorPhone: check.ppcSupervisorPhone ?? "",
      ppcSupervisorLastSignoff: check.ppcSupervisorLastSignoff ?? "",
      ppcSupervisorNextReview: check.ppcSupervisorNextReview ?? "",
    })),
    references: refs.map((r) => ({
      refereeName: r.refereeName ?? "",
      refereeEmail: r.refereeEmail ?? "",
      refereePhone: r.refereePhone ?? "",
      organisation: r.organisation ?? "",
      roleOrJobTitle: r.relationship ?? "",
    })),
    serviceApprovals: serviceApprovals.map((row) => ({
      serviceTypeId: row.serviceTypeId,
      proofLink: row.proofLink ?? "",
      proofFileName: row.proofFileName ?? "",
      proofFileData: "",
      proofMimeType: row.proofMimeType ?? "",
      expiryDate: row.expiryDate ?? "",
      status: row.status,
      effectiveStatus: row.effectiveStatus,
      reviewReason: row.reviewReason ?? "",
    })),
  });
});

// PUT /api/public/applicant-update/:token
// Validates the token, updates the applicant record, consumes the token.
router.put("/api/public/applicant-update/:token", async (req, res) => {
  const { token } = req.params;

  const rows = await db
    .select()
    .from(mediatorApplicants)
    .where(eq(mediatorApplicants.updateToken, token))
    .limit(1);

  if (rows.length === 0) {
    return res.status(410).json({ error: "link_expired" });
  }

  const applicant = rows[0];

  if (
    !applicant.updateTokenExpiresAt ||
    applicant.updateTokenExpiresAt < new Date() ||
    applicant.updateTokenUsedAt
  ) {
    return res.status(410).json({ error: "link_expired" });
  }

  const parsed = publicUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid submission.", errors: parsed.error.flatten() });
  }
  const data = parsed.data;

  const resolvedSource =
    data.source === "Other" && data.sourceOther?.trim()
      ? `Other — ${data.sourceOther.trim()}`
      : data.source?.trim() || null;

  const serviceTypeRows = await storage.listServiceTypes();
  const serviceTypeById = new Map(serviceTypeRows.map((row) => [row.id, row]));
  const submittedServiceApprovals = new Map(
    (data.serviceApprovals ?? []).map((approval) => [approval.serviceTypeId, approval]),
  );
  const requestedServiceApprovals = await mediatorServiceApprovalService.listForApplicant(applicant.id);
  const existingCredentialChecks = await db
    .select()
    .from(mediatorApplicantChecks)
    .where(eq(mediatorApplicantChecks.applicantId, applicant.id));
  const existingCredentialByKind = new Map(existingCredentialChecks.map((check) => [check.kind, check]));
  const missingRequiredServiceProof = requestedServiceApprovals.filter((approval) => {
    if (approval.status !== "requested" && approval.effectiveStatus !== "requested") {
      return false;
    }
    const submitted = submittedServiceApprovals.get(approval.serviceTypeId);
    return !submitted || !(submitted.proofLink?.trim() || submitted.proofFileData?.trim());
  });
  if (missingRequiredServiceProof.length > 0) {
    const names = missingRequiredServiceProof.map((approval) => serviceTypeById.get(approval.serviceTypeId)?.name ?? approval.serviceTypeId).join(", ");
    return res.status(400).json({ message: `Missing proof for requested service: ${names}` });
  }

  try {
    await db.transaction(async (tx) => {
      // Update core applicant fields and consume token
      await tx
        .update(mediatorApplicants)
        .set({
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          phone: data.phone?.trim() || null,
          source: resolvedSource,
          accreditationStatus: data.accreditationStatus?.trim() || null,
          areaOfPractice:
            data.areaOfPractice && data.areaOfPractice.length > 0
              ? data.areaOfPractice
              : null,
          fmcUrn: data.fmcUrn?.trim() || null,
          fmcAccreditationStatus: data.fmcAccreditationStatus?.trim() || null,
          fmcAccreditationDate: data.fmcAccreditationDate?.trim() || data.fmcDate?.trim() || null,
          cmcRegNumber: data.cmcRegNumber?.trim() || null,
          otherRegulatorName: data.otherRegulatorName?.trim() || null,
          otherRegulatorNumber: data.otherRegulatorNumber?.trim() || null,
          higherQualifications: data.higherQualifications?.trim() || null,
          piProvider: data.piProvider?.trim() || null,
          piPolicyNumber: data.piPolicyNumber?.trim() || data.piPolicy?.trim() || null,
          piCoverAmount: data.piCoverAmount?.trim() || null,
          piExpiryDate: data.piExpiryDate?.trim() || data.piExpiry?.trim() || null,
          piCertificateUrl: data.piCertificateUrl?.trim() || null,
          icoRegistration: data.icoRegistration?.trim() || null,
          icoExpiryDate: data.icoExpiryDate?.trim() || null,
          dbsLevel: data.dbsLevel?.trim() || null,
          dbsCertNumber: data.dbsCertNumber?.trim() || data.dbsCert?.trim() || null,
          dbsIssueDate: data.dbsIssueDate?.trim() || data.dbsDate?.trim() || null,
          dbsCertificateUrl: data.dbsCertificateUrl?.trim() || null,
          ppcSupervisorName: data.ppcSupervisorName?.trim() || null,
          ppcSupervisorOrg: data.ppcSupervisorOrg?.trim() || null,
          ppcSupervisorEmail: data.ppcSupervisorEmail?.trim() || null,
          ppcSupervisorPhone: data.ppcSupervisorPhone?.trim() || null,
          ppcSupervisorLastSignoff: data.ppcSupervisorLastSignoff?.trim() || null,
          ppcSupervisorNextReview: data.ppcSupervisorNextReview?.trim() || null,
          updateTokenUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mediatorApplicants.id, applicant.id));

      // Upsert each credential check via raw SQL ON CONFLICT — preserves staff-set
      // status, only updates data fields the applicant controls.
      await tx.execute(
        dsql`INSERT INTO mediator_applicant_checks (applicant_id, kind, status, reference_number, issued_at)
          VALUES (${applicant.id}, 'fmc_cmc', 'pending', ${data.fmcUrn?.trim() || null}, ${data.fmcAccreditationDate?.trim() || data.fmcDate?.trim() || null})
          ON CONFLICT (applicant_id, kind) DO UPDATE SET
            reference_number = EXCLUDED.reference_number,
            issued_at = EXCLUDED.issued_at,
            notes = ${data.fmcAccreditationStatus?.trim() || null}`
      );

      await tx.execute(
        dsql`INSERT INTO mediator_applicant_checks (applicant_id, kind, status, provider, reference_number, notes)
          VALUES (${applicant.id}, 'other_regulator', 'pending', ${data.otherRegulatorName?.trim() || null}, ${data.otherRegulatorNumber?.trim() || null}, ${data.higherQualifications?.trim() || null})
          ON CONFLICT (applicant_id, kind) DO UPDATE SET
            provider = EXCLUDED.provider,
            reference_number = EXCLUDED.reference_number,
            notes = EXCLUDED.notes`
      );

      await tx.execute(
        dsql`INSERT INTO mediator_applicant_checks (applicant_id, kind, status, provider, reference_number, expires_at, evidence_url, notes)
          VALUES (${applicant.id}, 'pi_insurance', 'pending', ${data.piProvider?.trim() || null}, ${data.piPolicyNumber?.trim() || data.piPolicy?.trim() || null}, ${data.piExpiryDate?.trim() || data.piExpiry?.trim() || null}, ${data.piCertificateUrl?.trim() || null}, ${data.piCoverAmount?.trim() || null})
          ON CONFLICT (applicant_id, kind) DO UPDATE SET
            provider = EXCLUDED.provider,
            reference_number = EXCLUDED.reference_number,
            expires_at = EXCLUDED.expires_at,
            evidence_url = EXCLUDED.evidence_url,
            notes = EXCLUDED.notes`
      );

      await tx.execute(
        dsql`INSERT INTO mediator_applicant_checks (applicant_id, kind, status, provider, reference_number, issued_at, evidence_url)
          VALUES (${applicant.id}, 'dbs', 'pending', ${data.dbsLevel?.trim() || null}, ${data.dbsCertNumber?.trim() || data.dbsCert?.trim() || null}, ${data.dbsIssueDate?.trim() || data.dbsDate?.trim() || null}, ${data.dbsCertificateUrl?.trim() || null})
          ON CONFLICT (applicant_id, kind) DO UPDATE SET
            provider = EXCLUDED.provider,
            reference_number = EXCLUDED.reference_number,
            issued_at = EXCLUDED.issued_at,
            evidence_url = EXCLUDED.evidence_url`
      );

      await tx.execute(
        dsql`INSERT INTO mediator_applicant_checks (applicant_id, kind, status, ppc_supervisor_name, ppc_supervisor_org, ppc_supervisor_email, ppc_supervisor_phone, ppc_supervisor_last_signoff, ppc_supervisor_next_review)
          VALUES (${applicant.id}, 'ppc_supervision', 'pending', ${data.ppcSupervisorName?.trim() || null}, ${data.ppcSupervisorOrg?.trim() || null}, ${data.ppcSupervisorEmail?.trim() || null}, ${data.ppcSupervisorPhone?.trim() || null}, ${data.ppcSupervisorLastSignoff?.trim() || null}, ${data.ppcSupervisorNextReview?.trim() || null})
          ON CONFLICT (applicant_id, kind) DO UPDATE SET
            ppc_supervisor_name = EXCLUDED.ppc_supervisor_name,
            ppc_supervisor_org = EXCLUDED.ppc_supervisor_org,
            ppc_supervisor_email = EXCLUDED.ppc_supervisor_email,
            ppc_supervisor_phone = EXCLUDED.ppc_supervisor_phone,
            ppc_supervisor_last_signoff = EXCLUDED.ppc_supervisor_last_signoff,
            ppc_supervisor_next_review = EXCLUDED.ppc_supervisor_next_review`
      );

      if (data.serviceApprovals && data.serviceApprovals.length > 0) {
        for (const serviceApproval of data.serviceApprovals) {
          await mediatorServiceApprovalService.upsertSubmission(null, {
            applicantId: applicant.id,
            serviceTypeId: serviceApproval.serviceTypeId,
            proofLink: serviceApproval.proofLink?.trim() || null,
            proofFileName: serviceApproval.proofFileName?.trim() || null,
            proofFileData: serviceApproval.proofFileData || null,
            proofMimeType: serviceApproval.proofMimeType?.trim() || null,
            expiryDate: serviceApproval.expiryDate?.trim() || null,
          });
        }
      }

      // Replace references: delete existing, insert new (resets status to pending)
      await tx
        .delete(mediatorApplicantReferences)
        .where(eq(mediatorApplicantReferences.applicantId, applicant.id));

      if (data.references && data.references.length > 0) {
        const refRows = data.references.slice(0, 2).map((r) => ({
          applicantId: applicant.id,
          refereeName: r.refereeName.trim(),
          refereeEmail: r.refereeEmail.toLowerCase().trim(),
          refereePhone: r.refereePhone?.trim() || null,
          organisation: r.organisation?.trim() || null,
          relationship: r.roleOrJobTitle?.trim() || null,
          status: "pending",
          requestedBy: null,
        }));
        await tx.insert(mediatorApplicantReferences).values(refRows);
      }
    });
  } catch (err) {
    console.error("[ApplicantUpdate] Transaction failed:", err);
    return res.status(500).json({ message: "Failed to update application. Please try again." });
  }

  const submittedCredentialSnapshots = (data.credentialChecks?.length ? data.credentialChecks : APPLICANT_CHECK_KINDS.map((kind) => {
    switch (kind) {
      case "fmc_cmc":
        return {
          kind,
          referenceNumber: data.fmcUrn?.trim() || null,
          provider: data.fmcAccreditationStatus?.trim() || null,
          issuedAt: data.fmcAccreditationDate?.trim() || data.fmcDate?.trim() || null,
          expiresAt: null,
          evidenceUrl: null,
          notes: null,
          ppcSupervisorName: null,
          ppcSupervisorOrg: null,
          ppcSupervisorEmail: null,
          ppcSupervisorPhone: null,
          ppcSupervisorLastSignoff: null,
          ppcSupervisorNextReview: null,
        };
      case "other_regulator":
        return {
          kind,
          referenceNumber: data.otherRegulatorNumber?.trim() || null,
          provider: data.otherRegulatorName?.trim() || null,
          issuedAt: null,
          expiresAt: null,
          evidenceUrl: null,
          notes: data.higherQualifications?.trim() || null,
          ppcSupervisorName: null,
          ppcSupervisorOrg: null,
          ppcSupervisorEmail: null,
          ppcSupervisorPhone: null,
          ppcSupervisorLastSignoff: null,
          ppcSupervisorNextReview: null,
        };
      case "pi_insurance":
        return {
          kind,
          referenceNumber: data.piPolicyNumber?.trim() || data.piPolicy?.trim() || null,
          provider: data.piProvider?.trim() || null,
          issuedAt: null,
          expiresAt: data.piExpiryDate?.trim() || data.piExpiry?.trim() || null,
          evidenceUrl: data.piCertificateUrl?.trim() || null,
          notes: data.piCoverAmount?.trim() || null,
          ppcSupervisorName: null,
          ppcSupervisorOrg: null,
          ppcSupervisorEmail: null,
          ppcSupervisorPhone: null,
          ppcSupervisorLastSignoff: null,
          ppcSupervisorNextReview: null,
        };
      case "dbs":
        return {
          kind,
          referenceNumber: data.dbsCertNumber?.trim() || data.dbsCert?.trim() || null,
          provider: data.dbsLevel?.trim() || null,
          issuedAt: data.dbsIssueDate?.trim() || data.dbsDate?.trim() || null,
          expiresAt: null,
          evidenceUrl: data.dbsCertificateUrl?.trim() || null,
          notes: null,
          ppcSupervisorName: null,
          ppcSupervisorOrg: null,
          ppcSupervisorEmail: null,
          ppcSupervisorPhone: null,
          ppcSupervisorLastSignoff: null,
          ppcSupervisorNextReview: null,
        };
      case "ppc_supervision":
        return {
          kind,
          referenceNumber: null,
          provider: null,
          issuedAt: null,
          expiresAt: null,
          evidenceUrl: null,
          notes: null,
          ppcSupervisorName: data.ppcSupervisorName?.trim() || null,
          ppcSupervisorOrg: data.ppcSupervisorOrg?.trim() || null,
          ppcSupervisorEmail: data.ppcSupervisorEmail?.trim() || null,
          ppcSupervisorPhone: data.ppcSupervisorPhone?.trim() || null,
          ppcSupervisorLastSignoff: data.ppcSupervisorLastSignoff?.trim() || null,
          ppcSupervisorNextReview: data.ppcSupervisorNextReview?.trim() || null,
        };
    }
  }) as Array<{
    kind: (typeof APPLICANT_CHECK_KINDS)[number];
    referenceNumber: string | null;
    provider: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    evidenceUrl: string | null;
    notes: string | null;
    ppcSupervisorName: string | null;
    ppcSupervisorOrg: string | null;
    ppcSupervisorEmail: string | null;
    ppcSupervisorPhone: string | null;
    ppcSupervisorLastSignoff: string | null;
    ppcSupervisorNextReview: string | null;
  }>);

  for (const check of submittedCredentialSnapshots) {
    const previous = existingCredentialByKind.get(check.kind);
    const hasCurrentData = Object.values(check).some((value, index) => index > 0 && value !== null && String(value).trim() !== "");
    const snapshotChanged =
      !previous ||
      previous.referenceNumber !== check.referenceNumber ||
      previous.provider !== check.provider ||
      previous.issuedAt !== check.issuedAt ||
      previous.expiresAt !== check.expiresAt ||
      previous.evidenceUrl !== check.evidenceUrl ||
      previous.notes !== check.notes ||
      previous.ppcSupervisorName !== check.ppcSupervisorName ||
      previous.ppcSupervisorOrg !== check.ppcSupervisorOrg ||
      previous.ppcSupervisorEmail !== check.ppcSupervisorEmail ||
      previous.ppcSupervisorPhone !== check.ppcSupervisorPhone ||
      previous.ppcSupervisorLastSignoff !== check.ppcSupervisorLastSignoff ||
      previous.ppcSupervisorNextReview !== check.ppcSupervisorNextReview;
    // Only surface a submission/resubmission when the current payload actually
    // contains credential data. This prevents non-credential profile saves from
    // being mislabelled as credential re-submissions just because prior rows
    // already exist in the database.
    if (!hasCurrentData || !snapshotChanged) continue;
    await logAudit({
      userId: null,
      action: previous ? "applicant_check_resubmitted" : "applicant_check_submitted",
      entity: "mediator_applicant",
      entityId: applicant.id,
      entityRef: applicant.email,
      details: JSON.stringify({
        kind: check.kind,
        label: credentialCheckLabelMap[check.kind] ?? check.kind,
        mediator: `${data.firstName.trim()} ${data.lastName.trim()}`.trim(),
        previousStatus: previous?.status ?? null,
        nextStatus: "pending",
        submittedAt: new Date().toISOString(),
        referenceNumber: check.referenceNumber,
        provider: check.provider,
        issuedAt: check.issuedAt,
        expiresAt: check.expiresAt,
        evidenceUrl: check.evidenceUrl,
        notes: check.notes,
        ppcSupervisorName: check.ppcSupervisorName,
        ppcSupervisorOrg: check.ppcSupervisorOrg,
        ppcSupervisorEmail: check.ppcSupervisorEmail,
        ppcSupervisorPhone: check.ppcSupervisorPhone,
        ppcSupervisorLastSignoff: check.ppcSupervisorLastSignoff,
        ppcSupervisorNextReview: check.ppcSupervisorNextReview,
      }),
    });
  }

  if (applicant.convertedUserId) {
    try {
      await mediatorProfileRepository.upsertProfile(applicant.convertedUserId, {
        fmcUrn: data.fmcUrn?.trim() || null,
        fmcAccreditationStatus: data.fmcAccreditationStatus?.trim() || null,
        fmcAccreditationDate: data.fmcAccreditationDate?.trim() || data.fmcDate?.trim() || null,
        cmcRegNumber: data.cmcRegNumber?.trim() || null,
        otherRegulatorName: data.otherRegulatorName?.trim() || null,
        otherRegulatorNumber: data.otherRegulatorNumber?.trim() || null,
        higherQualifications: data.higherQualifications?.trim() || null,
        piProvider: data.piProvider?.trim() || null,
        piPolicyNumber: data.piPolicyNumber?.trim() || data.piPolicy?.trim() || null,
        piCoverAmount: data.piCoverAmount?.trim() || null,
        piExpiryDate: data.piExpiryDate?.trim() || data.piExpiry?.trim() || null,
        piCertificateUrl: data.piCertificateUrl?.trim() || null,
        icoRegistration: data.icoRegistration?.trim() || null,
        icoExpiryDate: data.icoExpiryDate?.trim() || null,
        dbsLevel: data.dbsLevel?.trim() || null,
        dbsCertNumber: data.dbsCertNumber?.trim() || data.dbsCert?.trim() || null,
        dbsIssueDate: data.dbsIssueDate?.trim() || data.dbsDate?.trim() || null,
        dbsCertificateUrl: data.dbsCertificateUrl?.trim() || null,
        ppcSupervisorName: data.ppcSupervisorName?.trim() || null,
        ppcSupervisorOrg: data.ppcSupervisorOrg?.trim() || null,
        ppcSupervisorEmail: data.ppcSupervisorEmail?.trim() || null,
        ppcSupervisorPhone: data.ppcSupervisorPhone?.trim() || null,
        ppcSupervisorLastSignoff: data.ppcSupervisorLastSignoff?.trim() || null,
        ppcSupervisorNextReview: data.ppcSupervisorNextReview?.trim() || null,
      });
    } catch (err) {
      console.error("[ApplicantUpdate] Mediator profile sync failed:", err);
    }
  }

  const name = `${data.firstName.trim()} ${data.lastName.trim()}`;

  logAudit({
    userId: null,
    action: "application_updated_by_applicant",
    entity: "mediator_applicant",
    entityId: applicant.id,
    details: JSON.stringify({
      email: applicant.email,
      name,
      referenceCount: data.references?.length ?? 0,
      hasCredentials: !!(
        data.fmcUrn ||
        data.fmcAccreditationStatus ||
        data.piProvider ||
        data.piPolicyNumber ||
        data.dbsCertNumber ||
        data.dbsLevel ||
        data.ppcSupervisorName
      ),
    }),
  });

  // Confirmation + admin notification (best-effort)
  try {
    const {
      sendMediatorApplicationConfirmationEmail,
      sendNewMediatorApplicationAdminEmail,
    } = await import("../services/email.service");
    await Promise.all([
      sendMediatorApplicationConfirmationEmail(applicant.email, name),
      sendNewMediatorApplicationAdminEmail(name, applicant.email),
    ]);
  } catch (err) {
    console.error("[ApplicantUpdate] Email dispatch error:", err);
  }

  return res.json({ success: true });
});

export default router;
