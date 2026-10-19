import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  mediationSessionProposalRecipients,
  mediationSessionProposals,
  type InsertMediationSessionProposal,
  type InsertMediationSessionProposalRecipient,
  type MediationSessionProposal,
  type MediationSessionProposalRecipient,
  type MediationSessionProposalResponseStatus,
} from "@shared/schema";

export class MediationSessionProposalRepository {
  async create(data: InsertMediationSessionProposal): Promise<MediationSessionProposal> {
    const [row] = await db.insert(mediationSessionProposals).values(data).returning();
    return row;
  }

  async getById(id: string): Promise<MediationSessionProposal | undefined> {
    const [row] = await db.select().from(mediationSessionProposals).where(eq(mediationSessionProposals.id, id));
    return row;
  }

  async getByAppointment(appointmentId: string): Promise<MediationSessionProposal | undefined> {
    const [row] = await db.select().from(mediationSessionProposals).where(eq(mediationSessionProposals.appointmentId, appointmentId));
    return row;
  }

  async listBySessions(sessionIds: string[]): Promise<MediationSessionProposal[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(mediationSessionProposals)
      .where(inArray(mediationSessionProposals.mediationSessionId, sessionIds))
      .orderBy(desc(mediationSessionProposals.createdAt));
  }

  async update(id: string, data: Partial<Omit<MediationSessionProposal, "id" | "createdAt">>): Promise<MediationSessionProposal | undefined> {
    const [row] = await db
      .update(mediationSessionProposals)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mediationSessionProposals.id, id))
      .returning();
    return row;
  }

  async createRecipient(data: InsertMediationSessionProposalRecipient): Promise<MediationSessionProposalRecipient> {
    const [row] = await db.insert(mediationSessionProposalRecipients).values(data).returning();
    return row;
  }

  async listRecipientsByProposal(proposalId: string): Promise<MediationSessionProposalRecipient[]> {
    return db
      .select()
      .from(mediationSessionProposalRecipients)
      .where(eq(mediationSessionProposalRecipients.proposalId, proposalId));
  }

  async listRecipientsBySessions(sessionIds: string[]): Promise<MediationSessionProposalRecipient[]> {
    if (sessionIds.length === 0) return [];
    return db
      .select()
      .from(mediationSessionProposalRecipients)
      .where(inArray(mediationSessionProposalRecipients.mediationSessionId, sessionIds));
  }

  async getRecipientByTokenHash(tokenHash: string): Promise<MediationSessionProposalRecipient | undefined> {
    const [row] = await db
      .select()
      .from(mediationSessionProposalRecipients)
      .where(eq(mediationSessionProposalRecipients.tokenHash, tokenHash));
    return row;
  }

  async getRecipientById(id: string): Promise<MediationSessionProposalRecipient | undefined> {
    const [row] = await db
      .select()
      .from(mediationSessionProposalRecipients)
      .where(eq(mediationSessionProposalRecipients.id, id));
    return row;
  }

  async updateRecipient(id: string, data: Partial<Omit<MediationSessionProposalRecipient, "id" | "createdAt">>): Promise<MediationSessionProposalRecipient | undefined> {
    const [row] = await db
      .update(mediationSessionProposalRecipients)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mediationSessionProposalRecipients.id, id))
      .returning();
    return row;
  }

  async updateRecipientResponse(id: string, responseStatus: MediationSessionProposalResponseStatus, declineNotes?: string | null): Promise<MediationSessionProposalRecipient | undefined> {
    return this.updateRecipient(id, {
      responseStatus,
      declineNotes: declineNotes || null,
      respondedAt: new Date(),
      viewedAt: new Date(),
    });
  }

  async markRecipientViewed(id: string): Promise<MediationSessionProposalRecipient | undefined> {
    const existing = await db
      .select()
      .from(mediationSessionProposalRecipients)
      .where(eq(mediationSessionProposalRecipients.id, id))
      .limit(1);
    if (!existing[0]) return undefined;
    if (existing[0].responseStatus !== "pending") return existing[0];
    return this.updateRecipient(id, {
      responseStatus: "viewed",
      viewedAt: existing[0].viewedAt || new Date(),
    });
  }

  async hasDeclines(proposalId: string): Promise<boolean> {
    const rows = await db
      .select({ id: mediationSessionProposalRecipients.id })
      .from(mediationSessionProposalRecipients)
      .where(and(
        eq(mediationSessionProposalRecipients.proposalId, proposalId),
        eq(mediationSessionProposalRecipients.responseStatus, "declined"),
      ))
      .limit(1);
    return rows.length > 0;
  }
}
