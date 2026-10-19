import { db } from "../db";
import { miamEditRequests, type MiamEditRequest } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export class MiamEditRequestRepository {
  async getById(id: string): Promise<MiamEditRequest | undefined> {
    const [record] = await db.select().from(miamEditRequests)
      .where(eq(miamEditRequests.id, id));
    return record;
  }

  async getPendingByMiamRecordId(miamRecordId: string): Promise<MiamEditRequest | undefined> {
    const [record] = await db.select().from(miamEditRequests)
      .where(and(
        eq(miamEditRequests.miamRecordId, miamRecordId),
        eq(miamEditRequests.status, "pending")
      ))
      .orderBy(desc(miamEditRequests.createdAt))
      .limit(1);
    return record;
  }

  async getLatestByMiamRecordId(miamRecordId: string): Promise<MiamEditRequest | undefined> {
    const [record] = await db.select().from(miamEditRequests)
      .where(eq(miamEditRequests.miamRecordId, miamRecordId))
      .orderBy(desc(miamEditRequests.createdAt))
      .limit(1);
    return record;
  }

  async create(data: {
    miamRecordId: string;
    caseId: string;
    requestedBy: string;
    proposedChanges: Record<string, unknown>;
    originalValues: Record<string, unknown>;
    requestNote?: string;
  }): Promise<MiamEditRequest> {
    const [created] = await db.insert(miamEditRequests)
      .values({
        miamRecordId: data.miamRecordId,
        caseId: data.caseId,
        requestedBy: data.requestedBy,
        proposedChanges: data.proposedChanges,
        originalValues: data.originalValues,
        requestNote: data.requestNote || null,
      })
      .returning();
    return created;
  }

  async updateStatus(id: string, updates: {
    status: string;
    reviewedBy?: string | null;
    reviewedAt?: Date | null;
    reviewNotes?: string | null;
  }): Promise<MiamEditRequest | undefined> {
    const setData: Record<string, unknown> = { status: updates.status };
    if ("reviewedBy" in updates) setData.reviewedBy = updates.reviewedBy;
    if ("reviewedAt" in updates) setData.reviewedAt = updates.reviewedAt;
    if ("reviewNotes" in updates) setData.reviewNotes = updates.reviewNotes;

    const [updated] = await db.update(miamEditRequests)
      .set(setData)
      .where(eq(miamEditRequests.id, id))
      .returning();
    return updated;
  }

  async cancelPendingForRecord(miamRecordId: string): Promise<void> {
    await db.update(miamEditRequests)
      .set({ status: "cancelled" })
      .where(and(
        eq(miamEditRequests.miamRecordId, miamRecordId),
        eq(miamEditRequests.status, "pending")
      ));
  }
}
