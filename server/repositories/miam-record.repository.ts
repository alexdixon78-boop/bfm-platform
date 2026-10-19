import { db } from "../db";
import { miamRecords, type MiamRecord } from "@shared/schema";
import { desc, eq, and, isNotNull, isNull, or, sql } from "drizzle-orm";

export class MiamRecordRepository {
  async getById(id: string): Promise<MiamRecord | undefined> {
    const [record] = await db.select().from(miamRecords)
      .where(eq(miamRecords.id, id));
    return record;
  }

  async getByPartyAndCase(partyId: string, caseId: string): Promise<MiamRecord | undefined> {
    return this.getCurrentByPartyAndCase(partyId, caseId);
  }

  async getCurrentByPartyAndCase(partyId: string, caseId: string): Promise<MiamRecord | undefined> {
    const [record] = await db.select().from(miamRecords)
      .where(and(
        eq(miamRecords.partyId, partyId),
        eq(miamRecords.caseId, caseId),
        isNull(miamRecords.supersededAt),
      ))
      .orderBy(desc(miamRecords.renewalSequence), desc(miamRecords.createdAt))
      .limit(1);
    return record;
  }

  async listByCase(caseId: string): Promise<MiamRecord[]> {
    return db.select().from(miamRecords)
      .where(and(eq(miamRecords.caseId, caseId), isNull(miamRecords.supersededAt)))
      .orderBy(desc(miamRecords.renewalSequence), desc(miamRecords.createdAt));
  }

  async listHistoryByPartyAndCase(partyId: string, caseId: string): Promise<MiamRecord[]> {
    return db.select().from(miamRecords)
      .where(and(eq(miamRecords.partyId, partyId), eq(miamRecords.caseId, caseId)))
      .orderBy(desc(miamRecords.renewalSequence), desc(miamRecords.createdAt));
  }

  private sanitize(data: Record<string, unknown>): Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt" | "updatedAt">> {
    const forbidden = new Set([
      "id", "partyId", "caseId", "createdAt", "updatedAt",
      "approvalStatus", "submittedBy", "submittedAt", "reviewedBy", "reviewedAt", "reviewNotes",
      "pendingPartyUserId", "pendingPartyFirstName", "pendingPartyLastName", "pendingPartyEmail",
      "supersededAt", "supersededBy", "renewalOfMiamRecordId", "renewalSequence",
    ]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!forbidden.has(key)) {
        result[key] = value;
      }
    }
    return result as Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt" | "updatedAt">>;
  }

  async upsert(partyId: string, caseId: string, data: Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt" | "updatedAt">>): Promise<MiamRecord> {
    const safeData = this.sanitize(data as Record<string, unknown>);
    const existing = await this.getByPartyAndCase(partyId, caseId);
    if (existing) {
      const [updated] = await db.update(miamRecords)
        .set({ ...safeData, updatedAt: new Date() })
        .where(eq(miamRecords.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(miamRecords)
      .values({ ...safeData, partyId, caseId })
      .returning();
    return created;
  }

  async supersedeCurrentForPartyAndCase(partyId: string, caseId: string, supersededAt = new Date()): Promise<MiamRecord | undefined> {
    const current = await this.getCurrentByPartyAndCase(partyId, caseId);
    if (!current) return undefined;

    const [updated] = await db.update(miamRecords)
      .set({ supersededAt, updatedAt: supersededAt })
      .where(eq(miamRecords.id, current.id))
      .returning();
    return updated;
  }

  async createRenewal(
    partyId: string,
    caseId: string,
    data: Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt" | "updatedAt">>,
  ): Promise<MiamRecord> {
    const safeData = this.sanitize(data as Record<string, unknown>);
    return db.transaction(async (tx) => {
      const [previous] = await tx.select().from(miamRecords)
        .where(and(
          eq(miamRecords.partyId, partyId),
          eq(miamRecords.caseId, caseId),
          isNull(miamRecords.supersededAt),
        ))
        .orderBy(desc(miamRecords.renewalSequence), desc(miamRecords.createdAt))
        .limit(1);
      const now = new Date();
      if (previous) {
        await tx.update(miamRecords)
          .set({ supersededAt: now, updatedAt: now })
          .where(eq(miamRecords.id, previous.id));
      }

      const [created] = await tx.insert(miamRecords)
        .values({
          ...safeData,
          partyId,
          caseId,
          approvalStatus: "draft",
          submittedBy: null,
          submittedAt: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNotes: null,
          pendingPartyUserId: null,
          pendingPartyFirstName: null,
          pendingPartyLastName: null,
          pendingPartyEmail: null,
          supersededAt: null,
          renewalOfMiamRecordId: previous?.id ?? null,
          renewalSequence: (previous?.renewalSequence ?? 0) + 1,
        })
        .returning();

      if (previous) {
        await tx.update(miamRecords)
          .set({ supersededBy: created.id })
          .where(eq(miamRecords.id, previous.id));
      }

      return created;
    });
  }

  async updateApprovalStatus(
    id: string,
    updates: {
      approvalStatus: string;
      submittedBy?: string | null;
      submittedAt?: Date | null;
      reviewedBy?: string | null;
      reviewedAt?: Date | null;
      reviewNotes?: string | null;
    }
  ): Promise<MiamRecord | undefined> {
    const setData: Record<string, unknown> = {
      approvalStatus: updates.approvalStatus,
      updatedAt: new Date(),
    };
    if ("submittedBy" in updates) setData.submittedBy = updates.submittedBy;
    if ("submittedAt" in updates) setData.submittedAt = updates.submittedAt;
    if ("reviewedBy" in updates) setData.reviewedBy = updates.reviewedBy;
    if ("reviewedAt" in updates) setData.reviewedAt = updates.reviewedAt;
    if ("reviewNotes" in updates) setData.reviewNotes = updates.reviewNotes;

    const [updated] = await db.update(miamRecords)
      .set(setData)
      .where(eq(miamRecords.id, id))
      .returning();
    return updated;
  }

  async setPendingParty(
    id: string,
    data: {
      pendingPartyUserId?: string | null;
      pendingPartyFirstName?: string | null;
      pendingPartyLastName?: string | null;
      pendingPartyEmail?: string | null;
    }
  ): Promise<MiamRecord | undefined> {
    const [updated] = await db.update(miamRecords)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(miamRecords.id, id))
      .returning();
    return updated;
  }

  /**
   * Atomically clears the pending party fields on the MIAM record using a
   * transaction with a row-level lock (SELECT FOR UPDATE).  Returns the
   * snapshot of the pending fields before they were cleared, or null if no
   * pending party was present (also a no-op for concurrent callers – only
   * the first winner sees a non-null return value).
   */
  async claimAndClearPendingParty(id: string): Promise<{
    pendingPartyUserId: string | null;
    pendingPartyFirstName: string | null;
    pendingPartyLastName: string | null;
    pendingPartyEmail: string | null;
  } | null> {
    return db.transaction(async (tx) => {
      const rows = await tx.execute(
        sql`SELECT pending_party_user_id, pending_party_first_name, pending_party_last_name, pending_party_email
            FROM miam_records WHERE id = ${id} FOR UPDATE`
      );
      const row = rows.rows?.[0] as {
        pending_party_user_id: string | null;
        pending_party_first_name: string | null;
        pending_party_last_name: string | null;
        pending_party_email: string | null;
      } | undefined;

      if (!row) return null;
      const hasPending = row.pending_party_user_id || row.pending_party_first_name;
      if (!hasPending) return null;

      const snapshot = {
        pendingPartyUserId: row.pending_party_user_id ?? null,
        pendingPartyFirstName: row.pending_party_first_name ?? null,
        pendingPartyLastName: row.pending_party_last_name ?? null,
        pendingPartyEmail: row.pending_party_email ?? null,
      };

      await tx.update(miamRecords).set({
        pendingPartyUserId: null,
        pendingPartyFirstName: null,
        pendingPartyLastName: null,
        pendingPartyEmail: null,
        updatedAt: new Date(),
      }).where(
        and(
          eq(miamRecords.id, id),
          or(isNotNull(miamRecords.pendingPartyUserId), isNotNull(miamRecords.pendingPartyFirstName))
        )
      );

      return snapshot;
    });
  }
}
