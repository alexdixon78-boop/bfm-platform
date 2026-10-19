import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  mediationSessionAvailabilityWindows,
  type InsertMediationSessionAvailabilityWindow,
  type MediationSessionAvailabilityWindow,
} from "@shared/schema";

export class MediationSessionAvailabilityRepository {
  async getById(id: string): Promise<MediationSessionAvailabilityWindow | undefined> {
    const [row] = await db.select().from(mediationSessionAvailabilityWindows).where(eq(mediationSessionAvailabilityWindows.id, id));
    return row;
  }

  async listBySession(sessionId: string): Promise<MediationSessionAvailabilityWindow[]> {
    return db
      .select()
      .from(mediationSessionAvailabilityWindows)
      .where(eq(mediationSessionAvailabilityWindows.mediationSessionId, sessionId));
  }

  async listBySessions(sessionIds: string[]): Promise<MediationSessionAvailabilityWindow[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(mediationSessionAvailabilityWindows)
      .where(inArray(mediationSessionAvailabilityWindows.mediationSessionId, sessionIds));
  }

  async replaceForParty(sessionId: string, partyId: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(mediationSessionAvailabilityWindows)
        .where(and(
          eq(mediationSessionAvailabilityWindows.mediationSessionId, sessionId),
          eq(mediationSessionAvailabilityWindows.partyId, partyId),
        ));
      if (rows.length === 0) return [];
      return tx.insert(mediationSessionAvailabilityWindows).values(rows).returning();
    });
  }

  async replaceForProposalRecipient(proposalRecipientId: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(mediationSessionAvailabilityWindows)
        .where(eq(mediationSessionAvailabilityWindows.proposalRecipientId, proposalRecipientId));
      if (rows.length === 0) return [];
      return tx.insert(mediationSessionAvailabilityWindows).values(rows).returning();
    });
  }

  async replaceForRescheduleRequest(sessionId: string, submittedBy: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]> {
    return this.replaceForRequestSource(sessionId, submittedBy, "reschedule_request", rows);
  }

  async replaceForNextSessionRequest(sessionId: string, submittedBy: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]> {
    return this.replaceForRequestSource(sessionId, submittedBy, "next_session_request", rows);
  }

  private async replaceForRequestSource(sessionId: string, submittedBy: string, source: "reschedule_request" | "next_session_request", rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(mediationSessionAvailabilityWindows)
        .where(and(
          eq(mediationSessionAvailabilityWindows.mediationSessionId, sessionId),
          eq(mediationSessionAvailabilityWindows.submittedBy, submittedBy),
          eq(mediationSessionAvailabilityWindows.source, source),
        ));
      if (rows.length === 0) return [];
      return tx.insert(mediationSessionAvailabilityWindows).values(rows).returning();
    });
  }
}
