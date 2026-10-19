import { db } from "../db";
import {
  clientRepresentatives,
  caseRepresentatives,
  type ClientRepresentative,
  type InsertClientRepresentative,
  type UpdateClientRepresentative,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Repository for the client-owned representatives master list (Task #202).
 * Person-level fields live here; per-case attachments live on
 * `case_representatives` and reference rows here via `clientRepresentativeId`.
 */
export class ClientRepresentativeRepository {
  async listByClient(clientId: string): Promise<ClientRepresentative[]> {
    return db
      .select()
      .from(clientRepresentatives)
      .where(eq(clientRepresentatives.clientId, clientId));
  }

  async getById(id: string): Promise<ClientRepresentative | undefined> {
    const [row] = await db
      .select()
      .from(clientRepresentatives)
      .where(eq(clientRepresentatives.id, id));
    return row;
  }

  /**
   * Dedupe lookup used by the upsert-on-attach flow. Matches a master record
   * by `(clientId, lower(email), lower(fullName))` ONLY when email is set.
   *
   * Spec (Task #202): two same-name reps with no email may both exist as
   * distinct records (they're likely different people the user couldn't
   * disambiguate by email). Returning `undefined` for null email forces the
   * caller to insert a fresh master row instead of collapsing namesakes.
   */
  async findByClientAndKey(
    clientId: string,
    fullName: string,
    email: string | null,
  ): Promise<ClientRepresentative | undefined> {
    if (!email) return undefined;
    const nameLower = fullName.trim().toLowerCase();
    if (!nameLower) return undefined;
    const emailLower = email.trim().toLowerCase();
    const [row] = await db
      .select()
      .from(clientRepresentatives)
      .where(and(
        eq(clientRepresentatives.clientId, clientId),
        sql`lower(${clientRepresentatives.email}) = ${emailLower}`,
        sql`lower(${clientRepresentatives.fullName}) = ${nameLower}`,
      ));
    return row;
  }

  async create(data: InsertClientRepresentative): Promise<ClientRepresentative> {
    const [row] = await db.insert(clientRepresentatives).values(data).returning();
    return row;
  }

  async update(id: string, data: UpdateClientRepresentative): Promise<ClientRepresentative | undefined> {
    await db.update(clientRepresentatives)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientRepresentatives.id, id));
    return this.getById(id);
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(clientRepresentatives).where(eq(clientRepresentatives.id, id));
  }

  /**
   * How many case-attachments currently point at this master record? Used by
   * the master-list "Delete representative entirely" guard.
   */
  async countAttachments(clientRepresentativeId: string): Promise<number> {
    const rows = await db
      .select({ id: caseRepresentatives.id })
      .from(caseRepresentatives)
      .where(eq(caseRepresentatives.clientRepresentativeId, clientRepresentativeId));
    return rows.length;
  }
}

export const clientRepresentativeRepository = new ClientRepresentativeRepository();
