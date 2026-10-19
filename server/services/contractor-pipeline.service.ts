import { db } from "../db";
import {
  contractorApplicants,
  users,
  auditLogs,
  type ContractorApplicantStage,
  type ContractorApplicant,
  CONTRACTOR_APPLICANT_STAGES,
} from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { logAudit } from "./audit-log.service";
import type { ServiceResult } from "./types";

export type ContractorPipelineCard = {
  kind: "applicant" | "contractor";
  id: string;
  stage: ContractorApplicantStage;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  contractorType: string | null;
  source: string | null;
  notes: string | null;
  rejectedReason?: string | null;
  convertedUserId?: string | null;
  updatedAt: string | null;
};

export type ContractorPipelineResponse = {
  columns: Record<ContractorApplicantStage, ContractorPipelineCard[]>;
  rejectedCount: number;
  rejected: ContractorPipelineCard[];
};

const APPLICANT_STAGES: ContractorApplicantStage[] = ["prospect", "screening", "contract_sent"];

function emptyColumns(): Record<ContractorApplicantStage, ContractorPipelineCard[]> {
  return CONTRACTOR_APPLICANT_STAGES.reduce((acc, k) => {
    acc[k] = [];
    return acc;
  }, {} as Record<ContractorApplicantStage, ContractorPipelineCard[]>);
}

function splitName(name: string): { firstName: string; lastName: string } {
  const idx = name.indexOf(" ");
  if (idx === -1) return { firstName: name, lastName: "" };
  return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) };
}

class ContractorPipelineService {
  async getBoard(): Promise<ContractorPipelineResponse> {
    const [applicants, contractorUsers] = await Promise.all([
      db.select().from(contractorApplicants).orderBy(desc(contractorApplicants.updatedAt)),
      db.select().from(users).where(eq(users.role, "contractor")),
    ]);

    const columns = emptyColumns();
    const rejected: ContractorPipelineCard[] = [];

    // --- Unconverted applicants (prospect / screening / contract_sent / rejected) ---
    for (const a of applicants) {
      if (a.convertedUserId) continue; // Converted → shown as contractor user
      if (a.stage === "rejected") {
        rejected.push(this.applicantCard(a));
        continue;
      }
      const stage = (
        APPLICANT_STAGES.includes(a.stage as ContractorApplicantStage)
          ? a.stage
          : "prospect"
      ) as ContractorApplicantStage;
      columns[stage].push(this.applicantCard(a, stage));
    }

    // --- Contractor users (active / off_boarded) ---
    for (const u of contractorUsers) {
      const { firstName, lastName } = splitName(u.name);
      const stage: ContractorApplicantStage = u.status === "inactive" ? "off_boarded" : "active";
      const card: ContractorPipelineCard = {
        kind: "contractor",
        id: u.id,
        stage,
        firstName,
        lastName,
        email: u.email,
        phone: null,
        contractorType: u.contractorType ?? null,
        source: null,
        notes: null,
        updatedAt: u.lastLoginAt ? new Date(u.lastLoginAt as unknown as string).toISOString() : null,
      };
      columns[stage].push(card);
    }

    // Sort each column most-recently-updated first
    for (const k of CONTRACTOR_APPLICANT_STAGES) {
      columns[k].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    }

    return { columns, rejectedCount: rejected.length, rejected };
  }

  private applicantCard(a: ContractorApplicant, stage?: ContractorApplicantStage): ContractorPipelineCard {
    return {
      kind: "applicant",
      id: a.id,
      stage: (stage ?? a.stage) as ContractorApplicantStage,
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      phone: a.phone,
      contractorType: a.contractorType,
      source: a.source,
      notes: a.notes,
      rejectedReason: (a as any).rejectedReason ?? null,
      convertedUserId: a.convertedUserId ?? null,
      updatedAt: a.updatedAt ? new Date(a.updatedAt as unknown as string).toISOString() : null,
    };
  }

  async move(
    actorId: string,
    payload: { kind: "applicant" | "contractor"; id: string; toStage: ContractorApplicantStage; fromStage?: ContractorApplicantStage },
  ): Promise<ServiceResult<{ moved: true }>> {
    const { kind, id, toStage } = payload;

    if (!CONTRACTOR_APPLICANT_STAGES.includes(toStage)) {
      return { ok: false, status: 400, error: "Invalid target stage." };
    }

    if (kind === "applicant") {
      if (!APPLICANT_STAGES.includes(toStage)) {
        return { ok: false, status: 400, error: "Applicants cannot be moved to active or off-boarded via drag — use the Convert action." };
      }
      const rows = await db.select().from(contractorApplicants).where(eq(contractorApplicants.id, id)).limit(1);
      if (!rows.length) return { ok: false, status: 404, error: "Applicant not found." };
      if (rows[0].convertedUserId) return { ok: false, status: 400, error: "This applicant has already been converted." };
      await db.update(contractorApplicants)
        .set({ stage: toStage, updatedAt: new Date() })
        .where(eq(contractorApplicants.id, id));
      await logAudit({
        userId: actorId, action: "pipeline_move", entity: "contractor_applicant",
        entityId: id, entityRef: rows[0].email,
        details: JSON.stringify({ fromStage: payload.fromStage ?? null, toStage }),
      });
      return { ok: true, moved: true };
    }

    // kind === "contractor"
    const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!u || u.role !== "contractor") return { ok: false, status: 404, error: "Contractor not found." };

    if (toStage === "off_boarded") {
      await db.update(users).set({ status: "inactive" }).where(eq(users.id, id));
      await logAudit({
        userId: actorId, action: "pipeline_move", entity: "contractor",
        entityId: id, entityRef: u.email,
        details: JSON.stringify({ fromStage: payload.fromStage ?? null, toStage, action: "off_boarded" }),
      });
      return { ok: true, moved: true };
    }

    if (toStage === "active") {
      await db.update(users).set({ status: "active" }).where(eq(users.id, id));
      await logAudit({
        userId: actorId, action: "pipeline_move", entity: "contractor",
        entityId: id, entityRef: u.email,
        details: JSON.stringify({ fromStage: payload.fromStage ?? null, toStage, action: "reactivated" }),
      });
      return { ok: true, moved: true };
    }

    return { ok: false, status: 400, error: "Contractor users can only be moved to active or off-boarded." };
  }

  async reject(
    actorId: string,
    applicantId: string,
    reason: string,
  ): Promise<ServiceResult<{ rejected: true }>> {
    const rows = await db.select().from(contractorApplicants).where(eq(contractorApplicants.id, applicantId)).limit(1);
    if (!rows.length) return { ok: false, status: 404, error: "Applicant not found." };
    if (rows[0].convertedUserId) return { ok: false, status: 400, error: "Converted applicants cannot be rejected." };
    if (rows[0].stage === "rejected") return { ok: false, status: 400, error: "Applicant is already rejected." };

    await db.update(contractorApplicants)
      .set({ stage: "rejected", rejectedReason: reason.trim() || null, updatedAt: new Date() } as never)
      .where(eq(contractorApplicants.id, applicantId));

    await logAudit({
      userId: actorId, action: "contractor_applicant_rejected", entity: "contractor_applicant",
      entityId: applicantId, entityRef: rows[0].email,
      details: JSON.stringify({ reason: reason.trim() || null }),
    });

    return { ok: true, rejected: true };
  }

  async convert(
    actorId: string,
    applicantId: string,
    opts: { name: string; email: string; password?: string; contractorType?: string },
  ): Promise<ServiceResult<{ userId: string; email: string }>> {
    const rows = await db.select().from(contractorApplicants).where(eq(contractorApplicants.id, applicantId)).limit(1);
    if (!rows.length) return { ok: false, status: 404, error: "Applicant not found." };
    const a = rows[0];
    if (a.convertedUserId) return { ok: false, status: 400, error: "This applicant has already been converted." };

    const { userService } = await import("./user.service");
    const contractorType = opts.contractorType ?? a.contractorType ?? undefined;
    const createResult = await userService.createContractor({
      name: opts.name,
      email: opts.email,
      contractorType,
      password: opts.password,
    });
    if (!createResult.ok) return { ok: false, status: createResult.status, error: createResult.error };

    const userId = createResult.user.id;
    await db.update(contractorApplicants)
      .set({ convertedUserId: userId, convertedAt: new Date(), stage: "active", updatedAt: new Date() })
      .where(eq(contractorApplicants.id, applicantId));

    await logAudit({
      userId: actorId, action: "contractor_applicant_converted", entity: "contractor_applicant",
      entityId: applicantId, entityRef: a.email,
      details: JSON.stringify({ convertedUserId: userId, email: opts.email }),
    });

    return { ok: true, userId, email: opts.email };
  }

  async timeline(kind: "applicant" | "contractor", id: string) {
    const entityName = kind === "applicant" ? "contractor_applicant" : "contractor";
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

export const contractorPipelineService = new ContractorPipelineService();
