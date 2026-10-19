import { type DemographicData, type InsertDemographicData, demographicData } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export class DemographicDataRepository {
  async getByPartyId(partyId: string): Promise<DemographicData | undefined> {
    const [record] = await db.select().from(demographicData).where(eq(demographicData.partyId, partyId));
    return record;
  }

  async getByCaseId(caseId: string): Promise<DemographicData[]> {
    return db.select().from(demographicData).where(eq(demographicData.caseId, caseId));
  }

  async upsert(partyId: string, caseId: string, data: Partial<Omit<DemographicData, "id" | "partyId" | "caseId" | "createdAt">>): Promise<DemographicData> {
    const [result] = await db
      .insert(demographicData)
      .values({ ...data, partyId, caseId } as InsertDemographicData)
      .onConflictDoUpdate({
        target: demographicData.partyId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async delete(id: string): Promise<boolean> {
    await db.delete(demographicData).where(eq(demographicData.id, id));
    return true;
  }
}
