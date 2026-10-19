import { mediatorApplicantRepository } from "../repositories/mediator-applicant.repository";
import { mediatorProfileRepository } from "../repositories/mediator-profile.repository";
import { storage } from "../storage";
import { userService } from "./user.service";
import { logAudit } from "./audit-log.service";
import { sendMediatorInviteEmail } from "./email.service";
import { db } from "../db";
import { mediatorServiceApprovalService } from "./mediator-service-approval.service";
import {
  MEDIATOR_APPLICANT_STAGES,
  APPLICANT_CHECK_KINDS,
  APPLICANT_CHECK_STATUSES,
  mediatorApplicantChecks,
  mediatorApplicantReferences,
  mediatorApplicants,
  mediatorReferences,
  type InsertMediatorProfile,
  type MediatorApplicant,
  type MediatorApplicantStage,
  type MediatorApplicantCheck,
  type MediatorApplicantReference,
  type ApplicantCheckKind,
  type ApplicantCheckStatus,
  type ApplicantContractPatch,
} from "@shared/schema";
import type { ServiceResult } from "./types";
import { eq, and, asc } from "drizzle-orm";
import crypto from "crypto";
import { getPublicAppUrl } from "../utils/app-url";

const APPLICANT_CHECK_LABELS: Record<ApplicantCheckKind, string> = {
  fmc_cmc: "FMC / CMC accreditation",
  other_regulator: "Other regulator check",
  pi_insurance: "PI insurance",
  dbs: "DBS check",
  ppc_supervision: "PPC supervision",
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class MediatorApplicantService {
  list() {
    return mediatorApplicantRepository.list();
  }

  getById(id: string) {
    return mediatorApplicantRepository.getById(id);
  }

  async create(actorId: string, data: { firstName: string; lastName: string; email: string; phone?: string; source?: string; notes?: string; accreditationStatus?: string; areaOfPractice?: string[] | null; stage?: MediatorApplicantStage }): Promise<ServiceResult<{ applicant: MediatorApplicant }>> {
    if (!data.firstName || !data.lastName || !data.email) {
      return { ok: false, error: "First name, last name, and email are required.", status: 400 };
    }
    const stage = data.stage ?? "recruitment_approach";
    if (!MEDIATOR_APPLICANT_STAGES.includes(stage)) {
      return { ok: false, error: "Invalid stage.", status: 400 };
    }
    const existing = await mediatorApplicantRepository.findByEmail(data.email);
    if (existing) {
      return { ok: false, error: "An applicant with this email already exists.", status: 409 };
    }
    const applicant = await mediatorApplicantRepository.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone ?? null,
      source: data.source ?? null,
      notes: data.notes ?? null,
      accreditationStatus: data.accreditationStatus ?? null,
      areaOfPractice: Array.isArray(data.areaOfPractice) && data.areaOfPractice.length > 0 ? data.areaOfPractice : null,
      stage,
      createdBy: actorId,
    });
    await logAudit({ userId: actorId, action: "create", entity: "mediator", entityId: applicant.id, entityRef: applicant.email, details: JSON.stringify({ kind: "applicant", stage }) });
    return { ok: true, applicant };
  }

  async update(actorId: string, id: string, data: Partial<{ firstName: string; lastName: string; email: string; phone: string | null; source: string | null; notes: string | null; accreditationStatus: string | null; areaOfPractice: string[] | null; stage: MediatorApplicantStage; rejectedReason: string | null }>): Promise<ServiceResult<{ applicant: MediatorApplicant }>> {
    const existing = await mediatorApplicantRepository.getById(id);
    if (!existing) return { ok: false, error: "Applicant not found.", status: 404 };
    if (data.stage && !MEDIATOR_APPLICANT_STAGES.includes(data.stage)) {
      return { ok: false, error: "Invalid stage.", status: 400 };
    }
    if (existing.convertedUserId && data.stage && data.stage !== "onboarded") {
      return { ok: false, error: "This applicant has already been converted to a mediator and can't be moved back.", status: 400 };
    }
    const normalized = { ...data } as typeof data;
    if ("areaOfPractice" in normalized) {
      const arr = normalized.areaOfPractice;
      normalized.areaOfPractice = Array.isArray(arr) && arr.length > 0 ? arr : null;
    }
    const updated = await mediatorApplicantRepository.update(id, normalized);
    if (!updated) return { ok: false, error: "Applicant not found.", status: 404 };
    await logAudit({ userId: actorId, action: "update", entity: "mediator", entityId: id, entityRef: updated.email, details: JSON.stringify({ kind: "applicant", changes: data }) });
    return { ok: true, applicant: updated };
  }

  // ===== Task #207 — Credential checks (expanded: FMC/CMC, other regulator, PI, DBS, PPC)
  async listChecks(applicantId: string): Promise<MediatorApplicantCheck[]> {
    const rows = await db
      .select()
      .from(mediatorApplicantChecks)
      .where(eq(mediatorApplicantChecks.applicantId, applicantId));
    const kindOrder = new Map(APPLICANT_CHECK_KINDS.map((kind, index) => [kind, index]));
    return rows.sort((a, b) => (kindOrder.get(a.kind as ApplicantCheckKind) ?? 999) - (kindOrder.get(b.kind as ApplicantCheckKind) ?? 999));
  }

  async upsertCheck(
    actorId: string,
    applicantId: string,
    kind: string,
    data: Partial<{
      status: string;
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
    }>,
  ): Promise<ServiceResult<{ check: MediatorApplicantCheck }>> {
    if (!(APPLICANT_CHECK_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: "Invalid check kind.", status: 400 };
    }
    if (data.status && !(APPLICANT_CHECK_STATUSES as readonly string[]).includes(data.status)) {
      return { ok: false, error: "Invalid status.", status: 400 };
    }
    const applicant = await mediatorApplicantRepository.getById(applicantId);
    if (!applicant) return { ok: false, error: "Applicant not found.", status: 404 };

    const existing = await db
      .select()
      .from(mediatorApplicantChecks)
      .where(
        and(
          eq(mediatorApplicantChecks.applicantId, applicantId),
          eq(mediatorApplicantChecks.kind, kind),
        ),
      );

    // Transition-aware verify stamping: only stamp on actual status change
    // (non-verified → verified) and only clear on verified → non-verified.
    const prevStatus = existing[0]?.status;
    const nextStatus = data.status ?? prevStatus;
    let verifyStamp: Record<string, unknown> = {};
    if (data.status !== undefined && nextStatus !== prevStatus) {
      if (nextStatus === "verified") {
        verifyStamp = { verifiedBy: actorId, verifiedAt: new Date() };
      } else if (prevStatus === "verified") {
        verifyStamp = { verifiedBy: null, verifiedAt: null };
      }
    }

    let row: MediatorApplicantCheck;
    if (existing.length === 0) {
      const [inserted] = await db
        .insert(mediatorApplicantChecks)
        .values({
          applicantId,
          kind: kind as ApplicantCheckKind,
          status: (data.status as ApplicantCheckStatus) ?? "pending",
          referenceNumber: data.referenceNumber ?? null,
          provider: data.provider ?? null,
          issuedAt: data.issuedAt ?? null,
          expiresAt: data.expiresAt ?? null,
          evidenceUrl: data.evidenceUrl ?? null,
          notes: data.notes ?? null,
          ppcSupervisorName: data.ppcSupervisorName ?? null,
          ppcSupervisorOrg: data.ppcSupervisorOrg ?? null,
          ppcSupervisorEmail: data.ppcSupervisorEmail ?? null,
          ppcSupervisorPhone: data.ppcSupervisorPhone ?? null,
          ppcSupervisorLastSignoff: data.ppcSupervisorLastSignoff ?? null,
          ppcSupervisorNextReview: data.ppcSupervisorNextReview ?? null,
          requestedBy: actorId,
          ...verifyStamp,
        })
        .returning();
      row = inserted;
    } else {
      const patch: Record<string, unknown> = { ...verifyStamp };
      if (data.status !== undefined) patch.status = data.status;
      if (data.referenceNumber !== undefined) patch.referenceNumber = data.referenceNumber;
      if (data.provider !== undefined) patch.provider = data.provider;
      if (data.issuedAt !== undefined) patch.issuedAt = data.issuedAt;
      if (data.expiresAt !== undefined) patch.expiresAt = data.expiresAt;
      if (data.evidenceUrl !== undefined) patch.evidenceUrl = data.evidenceUrl;
      if (data.notes !== undefined) patch.notes = data.notes;
      if (data.ppcSupervisorName !== undefined) patch.ppcSupervisorName = data.ppcSupervisorName;
      if (data.ppcSupervisorOrg !== undefined) patch.ppcSupervisorOrg = data.ppcSupervisorOrg;
      if (data.ppcSupervisorEmail !== undefined) patch.ppcSupervisorEmail = data.ppcSupervisorEmail;
      if (data.ppcSupervisorPhone !== undefined) patch.ppcSupervisorPhone = data.ppcSupervisorPhone;
      if (data.ppcSupervisorLastSignoff !== undefined) patch.ppcSupervisorLastSignoff = data.ppcSupervisorLastSignoff;
      if (data.ppcSupervisorNextReview !== undefined) patch.ppcSupervisorNextReview = data.ppcSupervisorNextReview;
      const [updated] = await db
        .update(mediatorApplicantChecks)
        .set(patch)
        .where(eq(mediatorApplicantChecks.id, existing[0].id))
        .returning();
      row = updated;
    }
    const previousStatus = existing[0]?.status ?? null;
    const action =
      row.status === "verified" || row.status === "failed"
        ? "applicant_check_reviewed"
        : previousStatus !== row.status
          ? "applicant_check_updated"
          : "applicant_check_upserted";

    await logAudit({
      userId: actorId,
      action,
      entity: "mediator",
      entityId: applicantId,
      entityRef: applicant.email,
      details: JSON.stringify({
        kind,
        label: APPLICANT_CHECK_LABELS[kind as ApplicantCheckKind] ?? kind,
        previousStatus,
        nextStatus: row.status,
        decisionAt: row.status === "verified" ? (row.verifiedAt ?? new Date()) : new Date(),
        referenceNumber: row.referenceNumber ?? null,
        provider: row.provider ?? null,
        issuedAt: row.issuedAt ?? null,
        expiresAt: row.expiresAt ?? null,
        evidenceUrl: row.evidenceUrl ?? null,
        ppcSupervisorName: row.ppcSupervisorName ?? null,
        ppcSupervisorOrg: row.ppcSupervisorOrg ?? null,
        ppcSupervisorEmail: row.ppcSupervisorEmail ?? null,
        ppcSupervisorPhone: row.ppcSupervisorPhone ?? null,
        ppcSupervisorLastSignoff: row.ppcSupervisorLastSignoff ?? null,
        ppcSupervisorNextReview: row.ppcSupervisorNextReview ?? null,
      }),
    });
    return { ok: true, check: row };
  }

  async requestCheck(
    actorId: string,
    applicantId: string,
    kind: string,
  ): Promise<ServiceResult<{ check: MediatorApplicantCheck }>> {
    if (!(APPLICANT_CHECK_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: "Invalid check kind.", status: 400 };
    }
    const applicant = await mediatorApplicantRepository.getById(applicantId);
    if (!applicant) return { ok: false, error: "Applicant not found.", status: 404 };
    const existing = await db
      .select()
      .from(mediatorApplicantChecks)
      .where(
        and(
          eq(mediatorApplicantChecks.applicantId, applicantId),
          eq(mediatorApplicantChecks.kind, kind),
        ),
      );
    let row: MediatorApplicantCheck;
    if (existing.length > 0) {
      // Re-request: reset status back to pending, refresh requestedBy/At, and
      // clear any prior verify stamp so the row reflects a fresh chase.
      const [updated] = await db
        .update(mediatorApplicantChecks)
        .set({
          status: "pending",
          requestedBy: actorId,
          requestedAt: new Date(),
          verifiedBy: null,
          verifiedAt: null,
        })
        .where(eq(mediatorApplicantChecks.id, existing[0].id))
        .returning();
      row = updated;
    } else {
      const [inserted] = await db
        .insert(mediatorApplicantChecks)
        .values({
          applicantId,
          kind: kind as ApplicantCheckKind,
          status: "pending",
          requestedBy: actorId,
        })
        .returning();
      row = inserted;
    }
    await logAudit({
      userId: actorId,
      action: "applicant_check_requested",
      entity: "mediator",
      entityId: applicantId,
      entityRef: applicant.email,
      details: JSON.stringify({
        kind,
        label: APPLICANT_CHECK_LABELS[kind as ApplicantCheckKind] ?? kind,
        requestedAt: new Date().toISOString(),
      }),
    });
    return { ok: true, check: row };
  }

  // ===== Task #207 — Professional references at applicant stage (cap 2)
  async listReferences(applicantId: string): Promise<MediatorApplicantReference[]> {
    return db
      .select()
      .from(mediatorApplicantReferences)
      .where(eq(mediatorApplicantReferences.applicantId, applicantId))
      .orderBy(asc(mediatorApplicantReferences.requestedAt));
  }

  async createReference(
    actorId: string,
    applicantId: string,
    data: {
      refereeName: string;
      refereeEmail: string;
      refereePhone?: string | null;
      organisation?: string | null;
      relationship?: string | null;
      status?: string;
      notes?: string | null;
    },
  ): Promise<ServiceResult<{ reference: MediatorApplicantReference }>> {
    const applicant = await mediatorApplicantRepository.getById(applicantId);
    if (!applicant) return { ok: false, error: "Applicant not found.", status: 404 };
    if (!data.refereeName?.trim() || !data.refereeEmail?.trim()) {
      return { ok: false, error: "Referee name and email are required.", status: 400 };
    }
    const existing = await db
      .select()
      .from(mediatorApplicantReferences)
      .where(eq(mediatorApplicantReferences.applicantId, applicantId));
    if (existing.length >= 2) {
      return {
        ok: false,
        error: "An applicant can have at most 2 references. Delete an existing reference before adding another.",
        status: 400,
      };
    }
    const status = data.status ?? "pending";
    if (!(APPLICANT_CHECK_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, error: "Invalid status.", status: 400 };
    }
    const [row] = await db
      .insert(mediatorApplicantReferences)
      .values({
        applicantId,
        refereeName: data.refereeName.trim(),
        refereeEmail: data.refereeEmail.trim(),
        refereePhone: data.refereePhone ?? null,
        organisation: data.organisation ?? null,
        relationship: data.relationship ?? null,
        status: status as ApplicantCheckStatus,
        notes: data.notes ?? null,
        requestedBy: actorId,
        ...(status === "verified" ? { verifiedBy: actorId, verifiedAt: new Date() } : {}),
      })
      .returning();
    await logAudit({
      userId: actorId,
      action: "applicant_reference_created",
      entity: "mediator",
      entityId: applicantId,
      entityRef: applicant.email,
      details: JSON.stringify({ refereeEmail: row.refereeEmail }),
    });
    return { ok: true, reference: row };
  }

  async updateReference(
    actorId: string,
    applicantId: string,
    refId: string,
    data: Partial<{
      refereeName: string;
      refereeEmail: string;
      refereePhone: string | null;
      organisation: string | null;
      relationship: string | null;
      status: string;
      notes: string | null;
    }>,
  ): Promise<ServiceResult<{ reference: MediatorApplicantReference }>> {
    const applicant = await mediatorApplicantRepository.getById(applicantId);
    if (!applicant) return { ok: false, error: "Applicant not found.", status: 404 };
    if (data.status && !(APPLICANT_CHECK_STATUSES as readonly string[]).includes(data.status)) {
      return { ok: false, error: "Invalid status.", status: 400 };
    }
    const patch: Record<string, unknown> = {};
    if (data.refereeName !== undefined) patch.refereeName = data.refereeName;
    if (data.refereeEmail !== undefined) patch.refereeEmail = data.refereeEmail;
    if (data.refereePhone !== undefined) patch.refereePhone = data.refereePhone;
    if (data.organisation !== undefined) patch.organisation = data.organisation;
    if (data.relationship !== undefined) patch.relationship = data.relationship;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.status !== undefined) {
      patch.status = data.status;
      // Transition-aware: stamp only on actual status change.
      const existing = await db
        .select()
        .from(mediatorApplicantReferences)
        .where(eq(mediatorApplicantReferences.id, refId));
      const prevStatus = existing[0]?.status;
      if (data.status !== prevStatus) {
        if (data.status === "verified") {
          patch.verifiedBy = actorId;
          patch.verifiedAt = new Date();
        } else if (prevStatus === "verified") {
          patch.verifiedBy = null;
          patch.verifiedAt = null;
        }
      }
    }
    const [row] = await db
      .update(mediatorApplicantReferences)
      .set(patch)
      .where(
        and(
          eq(mediatorApplicantReferences.id, refId),
          eq(mediatorApplicantReferences.applicantId, applicantId),
        ),
      )
      .returning();
    if (!row) return { ok: false, error: "Reference not found.", status: 404 };
    await logAudit({
      userId: actorId,
      action: "applicant_reference_updated",
      entity: "mediator",
      entityId: applicantId,
      entityRef: applicant.email,
      details: JSON.stringify({ refId, status: row.status }),
    });
    return { ok: true, reference: row };
  }

  async deleteReference(
    actorId: string,
    applicantId: string,
    refId: string,
  ): Promise<ServiceResult<{ success: true }>> {
    const applicant = await mediatorApplicantRepository.getById(applicantId);
    if (!applicant) return { ok: false, error: "Applicant not found.", status: 404 };
    const removed = await db
      .delete(mediatorApplicantReferences)
      .where(
        and(
          eq(mediatorApplicantReferences.id, refId),
          eq(mediatorApplicantReferences.applicantId, applicantId),
        ),
      )
      .returning();
    if (removed.length === 0) return { ok: false, error: "Reference not found.", status: 404 };
    await logAudit({
      userId: actorId,
      action: "applicant_reference_deleted",
      entity: "mediator",
      entityId: applicantId,
      entityRef: applicant.email,
      details: JSON.stringify({ refId }),
    });
    return { ok: true, success: true };
  }

  async delete(actorId: string, id: string): Promise<ServiceResult<{ success: true }>> {
    const existing = await mediatorApplicantRepository.getById(id);
    if (!existing) return { ok: false, error: "Applicant not found.", status: 404 };
    if (existing.convertedUserId) {
      return { ok: false, error: "Converted applicants can't be deleted — archive on the mediator record instead.", status: 400 };
    }
    await mediatorApplicantRepository.delete(id);
    await logAudit({ userId: actorId, action: "delete", entity: "mediator", entityId: id, entityRef: existing.email, details: JSON.stringify({ kind: "applicant" }) });
    return { ok: true, success: true };
  }

  /** Convert an applicant into a mediator user. Reuses existing invite flow. */
  async convert(actorId: string, id: string, opts: { sendInvite?: boolean }): Promise<ServiceResult<{ applicant: MediatorApplicant; mediatorId: string; emailSent: boolean }>> {
    const applicant = await mediatorApplicantRepository.getById(id);
    if (!applicant) return { ok: false, error: "Applicant not found.", status: 404 };
    if (applicant.convertedUserId) {
      return { ok: false, error: "This applicant has already been converted.", status: 409 };
    }

    const fullName = `${applicant.firstName} ${applicant.lastName}`.trim();
    const created = await userService.createMediator({ name: fullName, email: applicant.email, mediationRoleQualification: "unclassified" });
    if (!created.ok) {
      return { ok: false, error: created.error, status: created.status };
    }
    const mediatorId = created.user.id as string;

    // Carry applicant fields onto the new mediator profile so recruitment
    // context (phone, split first/last, area of practice) survives the move.
    // The applicant's source + notes + accreditationStatus remain on the
    // applicant row itself (preserved + linked via `convertedUserId`), so
    // historic recruitment context is never lost.
    const profilePatch: Partial<InsertMediatorProfile> = {
      firstName: applicant.firstName,
      lastName: applicant.lastName,
    };
    if (applicant.phone) profilePatch.mobilePhone = applicant.phone;
    if (applicant.accreditationStatus) {
      profilePatch.fmcAccreditationStatus = applicant.accreditationStatus;
    }

    // Task #208 — Carry contract & registration fields. Only populated values
    // overwrite the profile (so reconverting / partial fills never wipe data).
    const carriedContract: Record<string, unknown> = {};
    const a = applicant as unknown as Record<string, unknown>;
    const copyIf = (src: string, dst: keyof InsertMediatorProfile) => {
      const v = a[src];
      if (v !== null && v !== undefined && v !== "") {
        (profilePatch as Record<string, unknown>)[dst as string] = v;
        carriedContract[src] = v;
      }
    };
    // engagementType is carried directly into the profile per spec. Note
    // the applicant value uses the freelance-agreement domain ("wta" |
    // "accredited"), which is intentionally different from the canonical
    // profile ENGAGEMENT_TYPES set (Self-employed contractor / Time-bank
    // pilot / Employed / Volunteer / Other). Admins can re-select on the
    // profile if they need the canonical value; the carried value is also
    // recorded in the audit summary.
    copyIf("engagementType", "engagementType");
    copyIf("contractVersion", "contractVersion");
    copyIf("contractSignedDate", "contractSignedDate");
    copyIf("contractFileUrl", "contractFileUrl");
    if (a.timebankAgreement === true) {
      profilePatch.timebankAgreement = true;
      carriedContract.timebankAgreement = true;
    }
    copyIf("timebankSignedDate", "timebankSignedDate");
    if (typeof a.timebankHoursPerWeek === "number") {
      profilePatch.timebankHoursPerWeek = a.timebankHoursPerWeek;
      carriedContract.timebankHoursPerWeek = a.timebankHoursPerWeek;
    }
    copyIf("timebankCheckinDay", "timebankCheckinDay");
    copyIf("timebankCheckinTime", "timebankCheckinTime");
    copyIf("fmcUrn", "fmcUrn");
    copyIf("fmcAccreditationStatus", "fmcAccreditationStatus");
    copyIf("fmcAccreditationDate", "fmcAccreditationDate");
    copyIf("cmcRegNumber", "cmcRegNumber");
    copyIf("otherRegulatorName", "otherRegulatorName");
    copyIf("otherRegulatorNumber", "otherRegulatorNumber");
    copyIf("higherQualifications", "higherQualifications");
    copyIf("piProvider", "piProvider");
    copyIf("piPolicyNumber", "piPolicyNumber");
    copyIf("piCoverAmount", "piCoverAmount");
    copyIf("piExpiryDate", "piExpiryDate");
    copyIf("piCertificateUrl", "piCertificateUrl");
    copyIf("icoRegistration", "icoRegistration");
    copyIf("icoExpiryDate", "icoExpiryDate");
    copyIf("dbsLevel", "dbsLevel");
    copyIf("dbsCertNumber", "dbsCertNumber");
    copyIf("dbsIssueDate", "dbsIssueDate");
    copyIf("dbsCertificateUrl", "dbsCertificateUrl");
    copyIf("ppcSupervisorName", "ppcSupervisorName");
    copyIf("ppcSupervisorOrg", "ppcSupervisorOrg");
    copyIf("ppcSupervisorEmail", "ppcSupervisorEmail");
    copyIf("ppcSupervisorPhone", "ppcSupervisorPhone");
    copyIf("ppcSupervisorLastSignoff", "ppcSupervisorLastSignoff");
    copyIf("ppcSupervisorNextReview", "ppcSupervisorNextReview");

    // Task #207 — Carry verified credential checks across to the mediator
    // profile columns. Only `verified` rows write field values so a half-
    // credentialled applicant doesn't silently appear "verified" on the
    // mediator page. Skipped (pending/failed) rows still contribute to the
    // audit summary so admins can see what didn't move.
    const checks: MediatorApplicantCheck[] = await db
      .select()
      .from(mediatorApplicantChecks)
      .where(eq(mediatorApplicantChecks.applicantId, id));
    const carried: Record<string, unknown> = {};
    const skipped: Array<{ kind: string; status: string }> = [];
    for (const c of checks) {
      if (c.status !== "verified") {
        skipped.push({ kind: c.kind, status: c.status });
        // Per-skipped audit entry for fine-grained traceability — admins can
        // see exactly which credential check was not carried and why.
        await logAudit({
          userId: actorId,
          action: "applicant_check_skipped_on_conversion",
          entity: "mediator",
          entityId: mediatorId,
          entityRef: applicant.email,
          details: JSON.stringify({ applicantId: id, kind: c.kind, status: c.status }),
        });
        continue;
      }
      if (c.kind === "fmc_cmc") {
        if (c.referenceNumber) profilePatch.fmcUrn = c.referenceNumber;
        if (c.issuedAt) profilePatch.fmcAccreditationDate = c.issuedAt;
        carried.fmc_cmc = { fmcUrn: c.referenceNumber ?? null, issuedAt: c.issuedAt ?? null };
      } else if (c.kind === "other_regulator") {
        if (c.provider) profilePatch.otherRegulatorName = c.provider;
        if (c.referenceNumber) profilePatch.otherRegulatorNumber = c.referenceNumber;
        carried.other_regulator = {
          otherRegulatorName: c.provider ?? null,
          otherRegulatorNumber: c.referenceNumber ?? null,
        };
      } else if (c.kind === "pi_insurance") {
        if (c.provider) profilePatch.piProvider = c.provider;
        if (c.referenceNumber) profilePatch.piPolicyNumber = c.referenceNumber;
        if (c.expiresAt) profilePatch.piExpiryDate = c.expiresAt;
        // Task #208 — PI evidence URL is the certificate the verifier checked;
        // mirror it into mediator_profiles.piCertificateUrl on conversion so
        // it stays traceable on the live record.
        if (c.evidenceUrl) profilePatch.piCertificateUrl = c.evidenceUrl;
        carried.pi_insurance = {
          provider: c.provider ?? null,
          policyNumber: c.referenceNumber ?? null,
          expiresAt: c.expiresAt ?? null,
          certificateUrl: c.evidenceUrl ?? null,
        };
      } else if (c.kind === "dbs") {
        if (c.referenceNumber) profilePatch.dbsCertNumber = c.referenceNumber;
        if (c.issuedAt) profilePatch.dbsIssueDate = c.issuedAt;
        if (c.evidenceUrl) profilePatch.dbsCertificateUrl = c.evidenceUrl;
        carried.dbs = { certNumber: c.referenceNumber ?? null, issuedAt: c.issuedAt ?? null, certificateUrl: c.evidenceUrl ?? null };
      } else if (c.kind === "ppc_supervision") {
        if (c.ppcSupervisorName) profilePatch.ppcSupervisorName = c.ppcSupervisorName;
        if (c.ppcSupervisorOrg) profilePatch.ppcSupervisorOrg = c.ppcSupervisorOrg;
        if (c.ppcSupervisorEmail) profilePatch.ppcSupervisorEmail = c.ppcSupervisorEmail;
        if (c.ppcSupervisorPhone) profilePatch.ppcSupervisorPhone = c.ppcSupervisorPhone;
        if (c.ppcSupervisorLastSignoff) profilePatch.ppcSupervisorLastSignoff = c.ppcSupervisorLastSignoff;
        if (c.ppcSupervisorNextReview) profilePatch.ppcSupervisorNextReview = c.ppcSupervisorNextReview;
        carried.ppc_supervision = {
          name: c.ppcSupervisorName ?? null,
          organisation: c.ppcSupervisorOrg ?? null,
          email: c.ppcSupervisorEmail ?? null,
          phone: c.ppcSupervisorPhone ?? null,
          lastSignoff: c.ppcSupervisorLastSignoff ?? null,
          nextReview: c.ppcSupervisorNextReview ?? null,
        };
      }
    }

    try {
      await mediatorProfileRepository.upsertProfile(mediatorId, profilePatch);
    } catch {
      // Non-fatal — the mediator user is created. Logged in audit details below.
    }
    try {
      await mediatorServiceApprovalService.linkApplicantRowsToMediator(id, mediatorId);
    } catch {
      // Non-fatal — service-proof rows can be linked later from the profile.
    }

    // Carry applicant references → mediator references (max 2 by construction).
    const applicantRefs: MediatorApplicantReference[] = await db
      .select()
      .from(mediatorApplicantReferences)
      .where(eq(mediatorApplicantReferences.applicantId, id));
    let carriedRefCount = 0;
    for (const r of applicantRefs.slice(0, 2)) {
      try {
        await db.insert(mediatorReferences).values({
          mediatorId,
          name: r.refereeName,
          email: r.refereeEmail,
          phone: r.refereePhone ?? null,
          organisation: r.organisation ?? null,
          role: r.relationship ?? null,
          status: r.status,
          notes: r.notes ?? null,
          verifiedBy: r.verifiedBy ?? null,
          verifiedAt: r.verifiedAt ?? null,
        });
        carriedRefCount++;
      } catch {
        // Non-fatal — continue carrying remaining refs.
      }
    }

    await logAudit({
      userId: actorId,
      action: "applicant_converted_credentials_carried",
      entity: "mediator",
      entityId: mediatorId,
      entityRef: applicant.email,
      details: JSON.stringify({
        applicantId: id,
        carriedChecks: carried,
        skippedChecks: skipped,
        carriedReferenceCount: carriedRefCount,
        carriedContract,
      }),
    });

    let emailSent = false;
    if (opts.sendInvite !== false) {
      const rawToken = crypto.randomUUID();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await storage.updateUser(mediatorId, { onboardingToken: tokenHash, onboardingTokenExpiresAt: expiresAt });
      const inviteUrl = `${getPublicAppUrl()}/onboarding?token=${rawToken}`;
      try {
        emailSent = await sendMediatorInviteEmail(applicant.email, fullName, inviteUrl);
      } catch {
        emailSent = false;
      }
      await logAudit({ userId: actorId, action: "invite_sent", entity: "mediator", entityId: mediatorId, entityRef: applicant.email });
    }

    const updated = await mediatorApplicantRepository.update(id, {
      stage: "onboarded",
      convertedUserId: mediatorId,
      convertedAt: new Date(),
    });
    // Canonical post-conversion lifecycle: every conversion entry point lands
    // the new mediator in column 4 (Onboarding Portal Access).
    try {
      await mediatorProfileRepository.upsertProfile(mediatorId, {
        lifecycleStage: "onboarding_portal_access",
      });
    } catch { /* profile may not exist yet for legacy paths */ }
    await logAudit({
      userId: actorId,
      action: "create",
      entity: "mediator",
      entityId: mediatorId,
      entityRef: applicant.email,
      details: JSON.stringify({ kind: "applicant_converted", applicantId: id, emailSent }),
    });
    return { ok: true, applicant: updated!, mediatorId, emailSent };
  }

  // Task #208 — Update contract / time-banking / ICO fields. Computes which
  // logical group(s) actually changed and emits a per-group audit entry so the
  // applicant timeline shows distinct contract / ico / timebank events.
  async updateContract(actorId: string, id: string, patch: ApplicantContractPatch): Promise<ServiceResult<{ applicant: MediatorApplicant }>> {
    const existing = await mediatorApplicantRepository.getById(id);
    if (!existing) return { ok: false, error: "Applicant not found.", status: 404 };
    if (existing.convertedUserId) {
      return { ok: false, error: "Applicant has already been converted; edit the mediator profile instead.", status: 400 };
    }
    // Applicant stages allowed to record contract details: "contract_issued"
    // and the later pre-conversion "onboarded" stage. After conversion the
    // PATCH is rejected by the convertedUserId check above.
    const CONTRACT_STAGES = new Set(["contract_issued", "onboarded"]);
    if (!CONTRACT_STAGES.has(existing.stage)) {
      return { ok: false, error: "Contract details can only be recorded once the applicant reaches the 'Contract issued' stage.", status: 400 };
    }

    const before = existing as unknown as Record<string, unknown>;
    const CONTRACT_FIELDS = ["engagementType", "contractVersion", "contractSignedDate", "contractFileUrl"] as const;
    const ICO_FIELDS = ["icoRegistration", "icoExpiryDate", "icoEvidenceUrl"] as const;
    const TIMEBANK_FIELDS = [
      "timebankAgreement", "timebankSignedDate", "timebankHoursPerWeek",
      "timebankCheckinDay", "timebankCheckinTime", "timebankFileUrl",
    ] as const;
    // Normalise: when timebankAgreement is false (or being set to false),
    // clear any detail fields in the same patch so they don't linger and
    // get carried forward on conversion.
    const normalised: Record<string, unknown> = { ...patch };
    if (normalised.timebankAgreement === false || (existing.timebankAgreement === false && !("timebankAgreement" in normalised))) {
      normalised.timebankSignedDate = null;
      normalised.timebankHoursPerWeek = null;
      normalised.timebankCheckinDay = null;
      normalised.timebankCheckinTime = null;
      normalised.timebankFileUrl = null;
    }

    // Compute change groups AFTER normalisation so any persisted clear
    // operation is always audited as a timebank change.
    const changedNorm = (fields: readonly string[]) => fields.some((f) => {
      if (!Object.prototype.hasOwnProperty.call(normalised, f)) return false;
      return (normalised as Record<string, unknown>)[f] !== before[f];
    });
    const contractChanged = changedNorm(CONTRACT_FIELDS);
    const icoChanged = changedNorm(ICO_FIELDS);
    const timebankChanged = changedNorm(TIMEBANK_FIELDS);

    const [updated] = await db
      .update(mediatorApplicants)
      .set({ ...normalised, updatedAt: new Date() })
      .where(eq(mediatorApplicants.id, id))
      .returning();

    if (contractChanged) {
      await logAudit({
        userId: actorId,
        action: "applicant_contract_recorded",
        entity: "mediator_applicant",
        entityId: id,
        entityRef: existing.email,
        details: JSON.stringify({
          engagementType: updated.engagementType ?? null,
          contractVersion: updated.contractVersion ?? null,
          contractSignedDate: updated.contractSignedDate ?? null,
          contractFileUrl: updated.contractFileUrl ?? null,
        }),
      });
    }
    if (icoChanged) {
      await logAudit({
        userId: actorId,
        action: "applicant_ico_recorded",
        entity: "mediator_applicant",
        entityId: id,
        entityRef: existing.email,
        details: JSON.stringify({
          icoRegistration: updated.icoRegistration ?? null,
          icoExpiryDate: updated.icoExpiryDate ?? null,
          icoEvidenceUrl: updated.icoEvidenceUrl ?? null,
        }),
      });
    }
    if (timebankChanged) {
      await logAudit({
        userId: actorId,
        action: "applicant_timebank_recorded",
        entity: "mediator_applicant",
        entityId: id,
        entityRef: existing.email,
        details: JSON.stringify({
          timebankAgreement: updated.timebankAgreement ?? false,
          timebankSignedDate: updated.timebankSignedDate ?? null,
          timebankHoursPerWeek: updated.timebankHoursPerWeek ?? null,
          timebankCheckinDay: updated.timebankCheckinDay ?? null,
          timebankCheckinTime: updated.timebankCheckinTime ?? null,
          timebankFileUrl: updated.timebankFileUrl ?? null,
        }),
      });
    }
    // No-op saves (user re-saved identical values) intentionally do not
    // emit a timeline entry — the per-group actions above are the
    // canonical events.
    return { ok: true, applicant: updated };
  }
}

export const mediatorApplicantService = new MediatorApplicantService();
