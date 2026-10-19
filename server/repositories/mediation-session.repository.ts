import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  caseDocuments,
  mediationSessionNotes,
  mediationSessionPartyAttendance,
  mediationSessionParticipants,
  mediationSessions,
  type CaseDocument,
  type InsertCaseDocument,
  type InsertMediationSession,
  type InsertMediationSessionNote,
  type InsertMediationSessionPartyAttendance,
  type InsertMediationSessionParticipant,
  type MediationSessionNote,
  type MediationSession,
  type MediationSessionPartyAttendance,
  type MediationSessionParticipant,
} from "@shared/schema";

export class MediationSessionRepository {
  listByCase(caseId: string): Promise<MediationSession[]> {
    return db
      .select()
      .from(mediationSessions)
      .where(eq(mediationSessions.caseId, caseId))
      .orderBy(mediationSessions.sessionNumber);
  }

  async getById(id: string): Promise<MediationSession | undefined> {
    const [row] = await db.select().from(mediationSessions).where(eq(mediationSessions.id, id));
    return row;
  }

  async getLatestByCase(caseId: string): Promise<MediationSession | undefined> {
    const [row] = await db
      .select()
      .from(mediationSessions)
      .where(eq(mediationSessions.caseId, caseId))
      .orderBy(desc(mediationSessions.sessionNumber))
      .limit(1);
    return row;
  }

  async create(data: InsertMediationSession): Promise<MediationSession> {
    const [created] = await db.insert(mediationSessions).values(data).returning();
    return created;
  }

  async update(id: string, data: Partial<Omit<MediationSession, "id" | "createdAt">>): Promise<MediationSession | undefined> {
    const [updated] = await db
      .update(mediationSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mediationSessions.id, id))
      .returning();
    return updated;
  }

  listParticipants(sessionId: string): Promise<MediationSessionParticipant[]> {
    return db
      .select()
      .from(mediationSessionParticipants)
      .where(eq(mediationSessionParticipants.sessionId, sessionId))
      .orderBy(mediationSessionParticipants.addedAt);
  }

  async listParticipantsBySessionIds(sessionIds: string[]): Promise<MediationSessionParticipant[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(mediationSessionParticipants)
      .where(inArray(mediationSessionParticipants.sessionId, sessionIds));
  }

  async listParticipantsByUser(userId: string): Promise<MediationSessionParticipant[]> {
    return db
      .select()
      .from(mediationSessionParticipants)
      .where(eq(mediationSessionParticipants.userId, userId));
  }

  async upsertParticipant(data: InsertMediationSessionParticipant): Promise<MediationSessionParticipant> {
    const [row] = await db
      .insert(mediationSessionParticipants)
      .values(data)
      .onConflictDoUpdate({
        target: [
          mediationSessionParticipants.sessionId,
          mediationSessionParticipants.userId,
          mediationSessionParticipants.role,
        ],
        set: {
          addedBy: data.addedBy ?? null,
          invitationStatus: data.invitationStatus ?? "accepted",
          invitationTokenHash: data.invitationTokenHash ?? null,
          invitationSentAt: data.invitationSentAt ?? null,
          invitationViewedAt: data.invitationViewedAt ?? null,
          invitationRespondedAt: data.invitationRespondedAt ?? null,
          invitationDeclineNotes: data.invitationDeclineNotes ?? null,
        },
      })
      .returning();
    return row;
  }

  async updateParticipant(id: string, data: Partial<Omit<MediationSessionParticipant, "id" | "addedAt">>): Promise<MediationSessionParticipant | undefined> {
    const [row] = await db
      .update(mediationSessionParticipants)
      .set(data)
      .where(eq(mediationSessionParticipants.id, id))
      .returning();
    return row;
  }

  async deleteParticipant(sessionId: string, userId: string, role: string): Promise<boolean> {
    const deleted = await db
      .delete(mediationSessionParticipants)
      .where(and(
        eq(mediationSessionParticipants.sessionId, sessionId),
        eq(mediationSessionParticipants.userId, userId),
        eq(mediationSessionParticipants.role, role),
      ))
      .returning({ id: mediationSessionParticipants.id });
    return deleted.length > 0;
  }

  async replaceParticipants(sessionId: string, rows: InsertMediationSessionParticipant[]): Promise<MediationSessionParticipant[]> {
    return db.transaction(async (tx) => {
      await tx.delete(mediationSessionParticipants).where(eq(mediationSessionParticipants.sessionId, sessionId));
      if (rows.length === 0) return [];
      return tx.insert(mediationSessionParticipants).values(rows).returning();
    });
  }

  async listPartyAttendanceBySessionIds(sessionIds: string[]): Promise<MediationSessionPartyAttendance[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(mediationSessionPartyAttendance)
      .where(inArray(mediationSessionPartyAttendance.mediationSessionId, sessionIds));
  }

  async replacePartyAttendance(sessionId: string, rows: InsertMediationSessionPartyAttendance[]): Promise<MediationSessionPartyAttendance[]> {
    return db.transaction(async (tx) => {
      await tx.delete(mediationSessionPartyAttendance).where(eq(mediationSessionPartyAttendance.mediationSessionId, sessionId));
      if (rows.length === 0) return [];
      return tx.insert(mediationSessionPartyAttendance).values(rows).returning();
    });
  }

  listNotes(sessionId: string): Promise<MediationSessionNote[]> {
    return db
      .select()
      .from(mediationSessionNotes)
      .where(eq(mediationSessionNotes.mediationSessionId, sessionId))
      .orderBy(desc(mediationSessionNotes.createdAt));
  }

  async listNotesBySessionIds(sessionIds: string[]): Promise<MediationSessionNote[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(mediationSessionNotes)
      .where(inArray(mediationSessionNotes.mediationSessionId, sessionIds))
      .orderBy(desc(mediationSessionNotes.createdAt));
  }

  async createNote(data: InsertMediationSessionNote): Promise<MediationSessionNote> {
    const [row] = await db.insert(mediationSessionNotes).values(data).returning();
    return row;
  }

  listCaseDocuments(caseId: string): Promise<CaseDocument[]> {
    return db
      .select()
      .from(caseDocuments)
      .where(eq(caseDocuments.caseId, caseId))
      .orderBy(desc(caseDocuments.createdAt));
  }

  async listCaseDocumentsBySessionIds(sessionIds: string[]): Promise<CaseDocument[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(caseDocuments)
      .where(inArray(caseDocuments.mediationSessionId, sessionIds))
      .orderBy(desc(caseDocuments.createdAt));
  }

  async getCaseDocument(id: string): Promise<CaseDocument | undefined> {
    const [row] = await db.select().from(caseDocuments).where(eq(caseDocuments.id, id));
    return row;
  }

  async createCaseDocument(data: InsertCaseDocument): Promise<CaseDocument> {
    const [row] = await db.insert(caseDocuments).values(data).returning();
    return row;
  }

  async createCaseDocumentOnce(id: string, data: InsertCaseDocument): Promise<CaseDocument> {
    const [created] = await db.insert(caseDocuments)
      .values({ ...data, id })
      .onConflictDoNothing({ target: caseDocuments.id })
      .returning();
    if (created) return created;
    const [existing] = await db.select().from(caseDocuments).where(eq(caseDocuments.id, id)).limit(1);
    if (!existing) throw new Error("Failed to create idempotent case document");
    return existing;
  }

  async updateCaseDocument(id: string, data: Partial<Omit<CaseDocument, "id" | "createdAt">>): Promise<CaseDocument | undefined> {
    const [row] = await db
      .update(caseDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(caseDocuments.id, id))
      .returning();
    return row;
  }
}
