import { db } from "../db";
import {
  mediatorApplicants,
  mediatorProfiles,
  mediatorReferences,
  users,
  auditLogs,
  type MediatorLifecycleStage,
  type MediatorApplicant,
  MEDIATOR_LIFECYCLE_STAGES,
  MEDIATOR_PROFILE_LIFECYCLE_STAGES,
} from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { logAudit } from "./audit-log.service";
import { mediatorApplicantService } from "./mediator-applicant.service";
import type { ServiceResult } from "./types";

export type CredentialStatus = "verified" | "pending" | "failed" | "none";
export type InsuranceStatus = "valid" | "expiring" | "expired" | "none";

export type PipelineCard = {
  kind: "applicant" | "mediator";
  id: string;                       // applicant.id OR user.id
  stage: MediatorLifecycleStage;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  accreditationStatus: string | null;
  areaOfPractice: string[];
  credentialStatus: CredentialStatus;
  insuranceStatus: InsuranceStatus;
  convertedUserId?: string | null;  // for applicants only
  panelStatus?: string | null;      // mediators only
  reviewDueSoon?: boolean;          // mediators only — PI/accreditation within 60 days
  // Task #208 — applicant kanban readiness signal: true when the freelance
  // mediator agreement is signed AND ICO registration is recorded with a
  // future expiry. Only set on applicant cards in contract-relevant stages.
  contractReady?: boolean;
  updatedAt: string | null;
};

export type PipelineResponse = {
  columns: Record<MediatorLifecycleStage, PipelineCard[]>;
  rejectedCount: number;
  rejected: PipelineCard[];
};

const APPLICANT_STAGES: MediatorLifecycleStage[] = [
  "recruitment_approach",
  "interview",
  "reference_credential_check",
  "contract_issued",
];
const MEDIATOR_STAGES: MediatorLifecycleStage[] = [
  "onboarding_portal_access",
  "active_on_panel",
  "annual_review",
  "off_boarded",
];

function emptyColumns(): Record<MediatorLifecycleStage, PipelineCard[]> {
  return MEDIATOR_LIFECYCLE_STAGES.reduce((acc, k) => {
    acc[k] = [];
    return acc;
  }, {} as Record<MediatorLifecycleStage, PipelineCard[]>);
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function insuranceFromExpiry(expiry: string | null | undefined): InsuranceStatus {
  const d = daysUntil(expiry);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d <= 60) return "expiring";
  return "valid";
}

class MediatorPipelineService {
  async getBoard(): Promise<PipelineResponse> {
    const [applicants, profiles, mediatorUsers, refs] = await Promise.all([
      db.select().from(mediatorApplicants).orderBy(desc(mediatorApplicants.updatedAt)),
      db.select().from(mediatorProfiles),
      db.select().from(users).where(eq(users.role, "mediator")),
      db.select().from(mediatorReferences),
    ]);

    const refsByMediator = new Map<string, typeof refs>();
    for (const r of refs) {
      const arr = refsByMediator.get(r.mediatorId) ?? [];
      arr.push(r);
      refsByMediator.set(r.mediatorId, arr);
    }
    const profileByUserId = new Map(profiles.map((p) => [p.userId, p]));

    const columns = emptyColumns();
    const rejected: PipelineCard[] = [];

    // --- Applicants ---
    // Skip applicants that have been converted (their card now lives on the
    // mediator side, anchored to the user record).
    for (const a of applicants) {
      if (a.convertedUserId) continue;
      if (a.stage === "rejected") {
        rejected.push(this.applicantCard(a));
        continue;
      }
      const stage = (
        APPLICANT_STAGES.includes(a.stage as MediatorLifecycleStage)
          ? a.stage
          : "recruitment_approach"
      ) as MediatorLifecycleStage;
      columns[stage].push(this.applicantCard(a, stage));
    }

    // --- Mediators ---
    for (const u of mediatorUsers) {
      const p = profileByUserId.get(u.id);
      const myRefs = refsByMediator.get(u.id) ?? [];
      const verified = myRefs.filter((r) => r.status === "verified").length;
      const failed = myRefs.some((r) => r.status === "failed");
      const credentialStatus: CredentialStatus = failed
        ? "failed"
        : (verified >= 2 && !!p?.fmcAccreditationStatus)
          ? "verified"
          : (verified > 0 || !!p?.fmcAccreditationStatus)
            ? "pending"
            : "none";
      const insuranceStatus = insuranceFromExpiry(p?.piExpiryDate);
      // Annual-review pulse: PI within 60 days OR accreditation reviewed >12 months ago.
      const piDays = daysUntil(p?.piExpiryDate);
      const reviewedAt = p?.updatedAt;
      const monthsSinceReview = reviewedAt
        ? Math.floor((Date.now() - new Date(reviewedAt as unknown as string).getTime()) / (1000 * 60 * 60 * 24 * 30))
        : null;
      const reviewDueSoon = (piDays !== null && piDays <= 60) || (monthsSinceReview !== null && monthsSinceReview >= 12);

      let stage = (p?.lifecycleStage as MediatorLifecycleStage | undefined) ?? null;
      if (!stage) {
        // Existing live mediators (no lifecycle_stage row yet) belong on the
        // Active on Panel column unless they've been off-boarded.
        stage = p?.panelStatus === "Off-boarded" ? "off_boarded" : "active_on_panel";
      }
      if (!MEDIATOR_PROFILE_LIFECYCLE_STAGES.includes(stage as never)) {
        stage = "onboarding_portal_access";
      }
      // Column-5 invariant: only mediators with panelStatus="Active" (or null
      // legacy) belong in Active on Panel. Anyone paused/suspended is routed
      // to Annual Review for admin attention; off-boarded → off_boarded.
      if (stage === "active_on_panel" && p?.panelStatus && p.panelStatus !== "Active") {
        stage = p.panelStatus === "Off-boarded" ? "off_boarded" : "annual_review";
      }

      const [first, ...rest] = (u.name || "").split(" ");
      const card: PipelineCard = {
        kind: "mediator",
        id: u.id,
        stage,
        firstName: p?.firstName ?? first ?? "",
        lastName: p?.lastName ?? rest.join(" ") ?? "",
        email: u.email,
        phone: p?.mobilePhone ?? null,
        accreditationStatus: p?.fmcAccreditationStatus ?? null,
        areaOfPractice: Array.isArray(p?.mediationTypes) ? (p?.mediationTypes as string[]) : [],
        credentialStatus,
        insuranceStatus,
        panelStatus: p?.panelStatus ?? null,
        reviewDueSoon,
        updatedAt: p?.updatedAt ? new Date(p.updatedAt as unknown as string).toISOString() : null,
      };
      columns[stage].push(card);
    }

    // Sort each column most-recently-updated first.
    for (const k of MEDIATOR_LIFECYCLE_STAGES) {
      columns[k].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    }

    return { columns, rejectedCount: rejected.length, rejected };
  }

  private applicantCard(a: MediatorApplicant, stage?: MediatorLifecycleStage): PipelineCard {
    const effectiveStage = (stage ?? (a.stage as MediatorLifecycleStage));
    // Contract readiness — show a small green dot on cards in contract /
    // onboarding stages once contract is signed AND ICO is registered with a
    // non-expired date. Drives the kanban "ready to convert" signal.
    const aAny = a as unknown as Record<string, unknown>;
    const contractSigned = !!aAny.contractSignedDate;
    const icoNumber = (aAny.icoRegistration as string | null) ?? null;
    const icoExpiry = (aAny.icoExpiryDate as string | null) ?? null;
    // ICO is only "active" when both registration number AND a valid future
    // expiry are recorded. Missing or past expiry → not active.
    const icoActive = !!icoNumber && !!icoExpiry && new Date(icoExpiry + "T23:59:59").getTime() >= Date.now();
    const contractReady = (effectiveStage === "contract_issued" || effectiveStage === "onboarded")
      && contractSigned && icoActive;
    return {
      kind: "applicant",
      id: a.id,
      stage: effectiveStage,
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      phone: a.phone,
      accreditationStatus: a.accreditationStatus,
      areaOfPractice: Array.isArray(a.areaOfPractice) ? a.areaOfPractice : [],
      credentialStatus: this.deriveApplicantCredentialStatus(a),
      insuranceStatus: "none",
      convertedUserId: a.convertedUserId ?? null,
      contractReady,
      updatedAt: a.updatedAt ? new Date(a.updatedAt as unknown as string).toISOString() : null,
    };
  }

  /**
   * Applicants don't have stored references yet, so the credential signal is
   * derived from accreditation_status text + lifecycle stage:
   *  - explicit failure keywords → "failed"
   *  - "accredited"/"approved" + past Reference & Credential Check → "verified"
   *  - any accreditation set → "pending"
   *  - otherwise → "none"
   */
  private deriveApplicantCredentialStatus(a: MediatorApplicant): CredentialStatus {
    const acc = (a.accreditationStatus ?? "").toLowerCase();
    if (!acc) return "none";
    if (acc.includes("rejected") || acc.includes("failed") || acc.includes("not accredited")) return "failed";
    const passedCheck = a.stage === "contract_issued" || a.stage === "onboarded";
    const looksAccredited = acc.includes("accredited") || acc.includes("approved") || acc.includes("verified");
    if (passedCheck && looksAccredited) return "verified";
    return "pending";
  }

  /**
   * Validates and applies a stage move. Returns a status code that the route
   * layer maps to HTTP. Off-boarding returns 409 with `requiresOffboardDialog`
   * so the client opens the existing OffboardDialog flow.
   */
  async move(
    actorId: string,
    payload: { kind: "applicant" | "mediator"; id: string; toStage: MediatorLifecycleStage; fromStage?: MediatorLifecycleStage },
  ): Promise<ServiceResult<{ moved: true; convertedMediatorId?: string } | { requiresOffboardDialog: true }>> {
    const { kind, id, toStage } = payload;
    if (!MEDIATOR_LIFECYCLE_STAGES.includes(toStage)) {
      return { ok: false, status: 400, error: "Invalid target stage." };
    }

    if (kind === "applicant") {
      // Applicant → applicant column move
      if (APPLICANT_STAGES.includes(toStage)) {
        const fromStage = payload.fromStage ?? null;
        const updated = await mediatorApplicantService.update(actorId, id, { stage: toStage as "recruitment_approach" | "interview" | "reference_credential_check" | "contract_issued" });
        if (!updated.ok) return { ok: false, status: updated.status, error: updated.error };
        await logAudit({
          userId: actorId, action: "pipeline_move", entity: "mediator_applicant",
          entityId: id, entityRef: updated.applicant.email,
          details: JSON.stringify({ kind: "applicant_pipeline_move", fromStage, toStage }),
        });
        return { ok: true, moved: true };
      }
      // Applicant → onboarding_portal_access ⇒ run convert flow.
      // The convert service is the canonical place that stamps lifecycleStage,
      // so both the table-view and pipeline drag-drop entry points land the
      // new mediator in column 4 consistently.
      if (toStage === "onboarding_portal_access") {
        const fromStage = payload.fromStage ?? null;
        const result = await mediatorApplicantService.convert(actorId, id, { sendInvite: true });
        if (!result.ok) return { ok: false, status: result.status, error: result.error };
        await logAudit({
          userId: actorId, action: "pipeline_move", entity: "mediator_applicant",
          entityId: id, entityRef: result.applicant.email,
          details: JSON.stringify({ kind: "applicant_pipeline_convert", fromStage, toStage, convertedMediatorId: result.mediatorId }),
        });
        return { ok: true, moved: true, convertedMediatorId: result.mediatorId };
      }
      return { ok: false, status: 400, error: "Applicants must move through Applications, Interview, Reference & Credential, Contract Issued — or be converted by dropping into Onboarding Portal Access." };
    }

    // kind === "mediator"
    if (APPLICANT_STAGES.includes(toStage)) {
      return { ok: false, status: 400, error: "This mediator has already been converted and can't move back to the applicant stages." };
    }
    if (toStage === "off_boarded") {
      // Off-boarding requires the dedicated case-reassignment dialog. The
      // client should respond by opening OffboardDialog; the actual move
      // happens via /api/mediators/:id/offboard, which sets panel_status and
      // triggers the post-offboard sync below.
      return { ok: false, status: 409, error: "Off-boarding requires case reassignment — use the off-board dialog.", requiresOffboardDialog: true };
    }

    const [profile] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, id));
    if (!profile) return { ok: false, status: 404, error: "Mediator profile not found." };
    if (profile.panelStatus === "Off-boarded") {
      return { ok: false, status: 400, error: "Off-boarded mediators can't be re-staged from the board. Reactivate the user account first." };
    }
    // Active on Panel column requires panelStatus="Active" — set it on move so
    // the column invariant holds (and clear any stale pause reason).
    const profileUpdate: Record<string, unknown> = { lifecycleStage: toStage, updatedAt: new Date() };
    if (toStage === "active_on_panel") {
      profileUpdate.panelStatus = "Active";
      profileUpdate.panelStatusReason = null;
    }
    await db.update(mediatorProfiles)
      .set(profileUpdate as never)
      .where(eq(mediatorProfiles.userId, id));
    const [u] = await db.select().from(users).where(eq(users.id, id));
    await logAudit({
      userId: actorId, action: "pipeline_move", entity: "mediator",
      entityId: id, entityRef: u?.email ?? null,
      details: JSON.stringify({ kind: "mediator_pipeline_move", fromStage: payload.fromStage ?? null, toStage }),
    });
    return { ok: true, moved: true };
  }

  /** After an off-board completes, ensure lifecycle_stage is in sync. */
  async syncOffboarded(mediatorId: string): Promise<void> {
    await db.update(mediatorProfiles)
      .set({ lifecycleStage: "off_boarded", updatedAt: new Date() })
      .where(eq(mediatorProfiles.userId, mediatorId));
  }

  /** Audit-log derived activity timeline for a card (applicant or mediator). */
  async timeline(kind: "applicant" | "mediator", id: string) {
    const entityName = kind === "applicant" ? "mediator_applicant" : "mediator";
    const rows = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.entityId, id), eq(auditLogs.entity, entityName)))
      .orderBy(desc(auditLogs.timestamp))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      action: r.action,
      details: r.details,
      userId: r.userId,
    }));
  }
}

export const mediatorPipelineService = new MediatorPipelineService();
