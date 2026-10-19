import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  caseProofingItemCycles,
  caseProofingItems,
  type CaseProofingItemCycle,
  type CaseProofingItem,
  type InsertCaseProofingItemCycle,
  type InsertCaseProofingItem,
} from "@shared/schema";

export class CaseProofingRepository {
  async listByCase(caseId: string): Promise<CaseProofingItem[]> {
    return db
      .select()
      .from(caseProofingItems)
      .where(eq(caseProofingItems.caseId, caseId))
      .orderBy(desc(caseProofingItems.submittedAt), desc(caseProofingItems.createdAt));
  }

  async getById(id: string): Promise<CaseProofingItem | undefined> {
    const [row] = await db
      .select()
      .from(caseProofingItems)
      .where(eq(caseProofingItems.id, id));
    return row;
  }

  async getBySource(sourceEntityType: string, sourceEntityId: string, itemType: string): Promise<CaseProofingItem | undefined> {
    const [row] = await db
      .select()
      .from(caseProofingItems)
      .where(and(
        eq(caseProofingItems.sourceEntityType, sourceEntityType),
        eq(caseProofingItems.sourceEntityId, sourceEntityId),
        eq(caseProofingItems.itemType, itemType),
      ));
    return row;
  }

  async upsertForSource(data: InsertCaseProofingItem): Promise<CaseProofingItem> {
    const [row] = await db
      .insert(caseProofingItems)
      .values(data)
      .onConflictDoUpdate({
        target: [caseProofingItems.sourceEntityType, caseProofingItems.sourceEntityId, caseProofingItems.itemType],
        set: {
          caseId: data.caseId,
          sessionId: data.sessionId ?? null,
          status: data.status || "awaiting_review",
          submittedBy: data.submittedBy ?? null,
          submittedAt: data.submittedAt ?? new Date(),
          reviewedBy: data.reviewedBy ?? null,
          reviewedAt: data.reviewedAt ?? null,
          returnComments: data.returnComments ?? null,
          returnedBy: data.returnedBy ?? null,
          returnedAt: data.returnedAt ?? null,
          withdrawnBy: data.withdrawnBy ?? null,
          withdrawnAt: data.withdrawnAt ?? null,
          withdrawReason: data.withdrawReason ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async listCyclesByProofingItemIds(proofingItemIds: string[]): Promise<CaseProofingItemCycle[]> {
    if (proofingItemIds.length === 0) return [];
    return db
      .select()
      .from(caseProofingItemCycles)
      .where(inArray(caseProofingItemCycles.proofingItemId, proofingItemIds))
      .orderBy(desc(caseProofingItemCycles.cycleNumber));
  }

  async createNextCycle(proofingItemId: string, data: Omit<InsertCaseProofingItemCycle, "proofingItemId" | "cycleNumber">): Promise<CaseProofingItemCycle> {
    const [latest] = await db
      .select({ cycleNumber: caseProofingItemCycles.cycleNumber })
      .from(caseProofingItemCycles)
      .where(eq(caseProofingItemCycles.proofingItemId, proofingItemId))
      .orderBy(desc(caseProofingItemCycles.cycleNumber))
      .limit(1);
    const [row] = await db
      .insert(caseProofingItemCycles)
      .values({
        proofingItemId,
        cycleNumber: (latest?.cycleNumber || 0) + 1,
        ...data,
      })
      .returning();
    return row;
  }

  async updateCurrentCycle(
    proofingItemId: string,
    data: Partial<Pick<CaseProofingItemCycle, "status" | "reviewedBy" | "reviewedAt" | "returnComments" | "returnedBy" | "returnedAt" | "withdrawnBy" | "withdrawnAt" | "withdrawReason">>,
  ): Promise<CaseProofingItemCycle | undefined> {
    const [latest] = await db
      .select({ id: caseProofingItemCycles.id })
      .from(caseProofingItemCycles)
      .where(eq(caseProofingItemCycles.proofingItemId, proofingItemId))
      .orderBy(desc(caseProofingItemCycles.cycleNumber))
      .limit(1);
    if (!latest) return undefined;
    const [row] = await db
      .update(caseProofingItemCycles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseProofingItemCycles.id, latest.id))
      .returning();
    return row;
  }

  async updateStatus(
    id: string,
    data: Partial<Pick<CaseProofingItem, "status" | "reviewedBy" | "reviewedAt" | "returnComments" | "returnedBy" | "returnedAt" | "withdrawnBy" | "withdrawnAt" | "withdrawReason">>,
  ): Promise<CaseProofingItem | undefined> {
    const [row] = await db
      .update(caseProofingItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseProofingItems.id, id))
      .returning();
    return row;
  }
}
