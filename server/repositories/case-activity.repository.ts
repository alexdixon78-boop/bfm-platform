import { db } from "../db";
import { caseActivities, type CaseActivity, type InsertCaseActivity } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export class CaseActivityRepository {
  async create(data: InsertCaseActivity): Promise<CaseActivity> {
    const [activity] = await db.insert(caseActivities).values(data).returning();
    return activity;
  }

  async listByCase(caseId: string, limit = 50, offset = 0): Promise<{ data: CaseActivity[]; total: number }> {
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(caseActivities).where(eq(caseActivities.caseId, caseId));
    const total = Number(countResult.count);
    const data = await db.select().from(caseActivities)
      .where(eq(caseActivities.caseId, caseId))
      .orderBy(desc(caseActivities.occurredAt))
      .limit(limit)
      .offset(offset);
    return { data, total };
  }
}
