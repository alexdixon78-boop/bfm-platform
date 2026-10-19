import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  caseCimConsents,
  type CaseCimConsent,
  type InsertCaseCimConsent,
} from "@shared/schema";

export class CimConsentRepository {
  async listByCase(caseId: string): Promise<CaseCimConsent[]> {
    return db.select().from(caseCimConsents).where(eq(caseCimConsents.caseId, caseId));
  }

  async upsert(data: InsertCaseCimConsent): Promise<CaseCimConsent> {
    const [row] = await db
      .insert(caseCimConsents)
      .values(data)
      .onConflictDoUpdate({
        target: [
          caseCimConsents.caseId,
          caseCimConsents.partyId,
          caseCimConsents.formType,
        ],
        set: {
          status: data.status || "pending",
          recordedBy: data.recordedBy ?? null,
          recordedAt: data.recordedAt ?? new Date(),
          notes: data.notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async findByCasePartyForm(caseId: string, partyId: string, formType: string): Promise<CaseCimConsent | undefined> {
    const [row] = await db
      .select()
      .from(caseCimConsents)
      .where(and(
        eq(caseCimConsents.caseId, caseId),
        eq(caseCimConsents.partyId, partyId),
        eq(caseCimConsents.formType, formType),
      ));
    return row;
  }
}
