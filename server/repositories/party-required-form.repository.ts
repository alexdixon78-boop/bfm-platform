import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  partyRequiredForms,
  type InsertPartyRequiredForm,
  type PartyRequiredForm,
  type PartyRequiredFormStatus,
  type PartyRequiredFormType,
} from "@shared/schema";

export class PartyRequiredFormRepository {
  async getById(id: string): Promise<PartyRequiredForm | undefined> {
    const [row] = await db.select().from(partyRequiredForms).where(eq(partyRequiredForms.id, id));
    return row;
  }

  async listByCase(caseId: string): Promise<PartyRequiredForm[]> {
    return db.select().from(partyRequiredForms).where(eq(partyRequiredForms.caseId, caseId));
  }

  async listBySession(sessionId: string): Promise<PartyRequiredForm[]> {
    return db.select().from(partyRequiredForms).where(eq(partyRequiredForms.mediationSessionId, sessionId));
  }

  async listByAppointment(appointmentId: string): Promise<PartyRequiredForm[]> {
    return db.select().from(partyRequiredForms).where(eq(partyRequiredForms.appointmentId, appointmentId));
  }

  async listByPartyIds(partyIds: string[]): Promise<PartyRequiredForm[]> {
    if (partyIds.length === 0) return [];
    return db.select().from(partyRequiredForms).where(inArray(partyRequiredForms.partyId, partyIds));
  }

  async upsert(data: InsertPartyRequiredForm): Promise<PartyRequiredForm> {
    const existing = await this.findByCasePartyType(data.caseId, data.partyId, data.formType);
    if (existing) {
      const [row] = await db
        .update(partyRequiredForms)
        .set({
          appointmentId: data.appointmentId ?? existing.appointmentId,
          mediationSessionId: data.mediationSessionId ?? existing.mediationSessionId,
          status: existing.status === "signed" || existing.status === "viewed" ? existing.status : data.status || existing.status,
          deliveryStatus: existing.status === "signed" ? existing.deliveryStatus : data.deliveryStatus || existing.deliveryStatus,
          deliveryLastAttemptedAt: existing.status === "signed" ? existing.deliveryLastAttemptedAt : data.deliveryLastAttemptedAt || existing.deliveryLastAttemptedAt,
          deliveryError: existing.status === "signed" ? existing.deliveryError : data.deliveryError ?? existing.deliveryError,
          issuedBy: existing.issuedBy || data.issuedBy || null,
          sentAt: existing.sentAt || data.sentAt || null,
          courtFormTemplateId: existing.status === "signed"
            ? existing.courtFormTemplateId || data.courtFormTemplateId || null
            : data.courtFormTemplateId || existing.courtFormTemplateId || null,
          courtFormGenerationId: existing.courtFormGenerationId || data.courtFormGenerationId || null,
          generatedDocumentId: existing.generatedDocumentId || data.generatedDocumentId || null,
          updatedAt: new Date(),
        })
        .where(eq(partyRequiredForms.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await db.insert(partyRequiredForms).values(data).returning();
    return row;
  }

  async update(id: string, data: Partial<Omit<PartyRequiredForm, "id" | "createdAt">>): Promise<PartyRequiredForm | undefined> {
    const [row] = await db
      .update(partyRequiredForms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(partyRequiredForms.id, id))
      .returning();
    return row;
  }

  async updateStatus(id: string, status: PartyRequiredFormStatus, patch: Partial<Pick<PartyRequiredForm, "viewedAt" | "signedAt" | "signedBy" | "signerName" | "signatureIpAddress" | "attestationText" | "attestationVersion" | "confirmationTickedAt" | "signatureSource" | "uploadedDocumentId" | "uploadNotes" | "withdrawnAt" | "withdrawnBy" | "generatedDocumentId">> = {}): Promise<PartyRequiredForm | undefined> {
    return this.update(id, { ...patch, status });
  }

  async updateAppointmentForSession(sessionId: string, appointmentId: string): Promise<PartyRequiredForm[]> {
    return db
      .update(partyRequiredForms)
      .set({ appointmentId, updatedAt: new Date() })
      .where(eq(partyRequiredForms.mediationSessionId, sessionId))
      .returning();
  }

  async findBySessionPartyType(sessionId: string, partyId: string, formType: PartyRequiredFormType): Promise<PartyRequiredForm | undefined> {
    const [row] = await db
      .select()
      .from(partyRequiredForms)
      .where(and(
        eq(partyRequiredForms.mediationSessionId, sessionId),
        eq(partyRequiredForms.partyId, partyId),
        eq(partyRequiredForms.formType, formType),
      ));
    return row;
  }

  async findByCasePartyType(caseId: string, partyId: string, formType: PartyRequiredFormType): Promise<PartyRequiredForm | undefined> {
    const [row] = await db
      .select()
      .from(partyRequiredForms)
      .where(and(
        eq(partyRequiredForms.caseId, caseId),
        eq(partyRequiredForms.partyId, partyId),
        eq(partyRequiredForms.formType, formType),
      ));
    return row;
  }
}
