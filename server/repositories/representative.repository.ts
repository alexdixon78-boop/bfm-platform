import { db } from "../db";
import {
  caseRepresentatives,
  type CaseRepresentative,
  type InsertCaseRepresentative,
  type UpdateCaseRepresentative,
} from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Internal-only "create" payload — service layer is responsible for hashing tokens
 * and stamping audit / consent metadata before calling this repository.
 */
export type CreateRepresentativeRow = InsertCaseRepresentative & {
  caseId: string;
  createdBy?: string | null;
  // Task #202: required server-side. Public schema omits it so users can't
  // forge cross-client links; the service always sets it after upserting the
  // master record.
  clientRepresentativeId: string;
};

/**
 * Internal-only "update" payload — wider than the public Update schema because
 * the service updates consent metadata (hash, expiry, decision IP, etc.) which
 * must NEVER be settable via the public PATCH endpoint.
 */
export type UpdateRepresentativeRow = Partial<Omit<CaseRepresentative, "id" | "createdAt" | "updatedAt">>;

export class RepresentativeRepository {
  async listByCase(caseId: string): Promise<CaseRepresentative[]> {
    return db.select().from(caseRepresentatives).where(eq(caseRepresentatives.caseId, caseId));
  }

  async listByParty(partyId: string): Promise<CaseRepresentative[]> {
    return db.select().from(caseRepresentatives).where(eq(caseRepresentatives.partyId, partyId));
  }

  async getById(id: string): Promise<CaseRepresentative | undefined> {
    const [row] = await db.select().from(caseRepresentatives).where(eq(caseRepresentatives.id, id));
    return row;
  }

  async getByConsentTokenHash(tokenHash: string): Promise<CaseRepresentative | undefined> {
    const [row] = await db.select().from(caseRepresentatives).where(eq(caseRepresentatives.consentTokenHash, tokenHash));
    return row;
  }

  async create(data: CreateRepresentativeRow): Promise<CaseRepresentative> {
    const [row] = await db.insert(caseRepresentatives).values(data).returning();
    return row;
  }

  async update(id: string, data: UpdateRepresentativeRow): Promise<CaseRepresentative | undefined> {
    await db.update(caseRepresentatives)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseRepresentatives.id, id));
    return this.getById(id);
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(caseRepresentatives).where(eq(caseRepresentatives.id, id));
  }

  async deleteByCase(caseId: string): Promise<void> {
    await db.delete(caseRepresentatives).where(eq(caseRepresentatives.caseId, caseId));
  }

  /**
   * Task #202: propagate person-level edits made on the master record out to
   * every attached `case_representatives` row so case-detail cards always
   * render the canonical contact data without a manual per-attachment edit.
   * Returns the IDs of the rows that were touched (for audit logging).
   */
  async updateByClientRepresentativeId(
    clientRepresentativeId: string,
    data: UpdateRepresentativeRow,
  ): Promise<string[]> {
    if (Object.keys(data).length === 0) return [];
    const rows = await db.update(caseRepresentatives)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseRepresentatives.clientRepresentativeId, clientRepresentativeId))
      .returning({ id: caseRepresentatives.id });
    return rows.map((r) => r.id);
  }
}

export const representativeRepository = new RepresentativeRepository();
