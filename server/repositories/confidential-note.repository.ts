import { type ConfidentialNote, type InsertConfidentialNote, caseConfidentialNotes } from "@shared/schema";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";

export class ConfidentialNoteRepository {
  async listByCaseId(caseId: string): Promise<ConfidentialNote[]> {
    return db.select().from(caseConfidentialNotes).where(eq(caseConfidentialNotes.caseId, caseId)).orderBy(desc(caseConfidentialNotes.createdAt));
  }

  async getById(id: string): Promise<ConfidentialNote | undefined> {
    const [note] = await db.select().from(caseConfidentialNotes).where(eq(caseConfidentialNotes.id, id));
    return note;
  }

  async create(data: InsertConfidentialNote): Promise<ConfidentialNote> {
    const [created] = await db.insert(caseConfidentialNotes).values(data).returning();
    return created;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(caseConfidentialNotes).where(eq(caseConfidentialNotes.id, id)).returning();
    return result.length > 0;
  }
}
