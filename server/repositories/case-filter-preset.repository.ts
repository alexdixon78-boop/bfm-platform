import { caseFilterPresets, type CaseFilterPreset, type CaseFilters } from "@shared/schema";
import { db } from "../db";
import { and, eq, desc, asc } from "drizzle-orm";

export class CaseFilterPresetRepository {
  async listForUser(userId: string): Promise<CaseFilterPreset[]> {
    return db.select().from(caseFilterPresets)
      .where(eq(caseFilterPresets.userId, userId))
      .orderBy(desc(caseFilterPresets.isDefault), asc(caseFilterPresets.name));
  }

  async getDefaultForUser(userId: string): Promise<CaseFilterPreset | undefined> {
    const [row] = await db.select().from(caseFilterPresets)
      .where(and(eq(caseFilterPresets.userId, userId), eq(caseFilterPresets.isDefault, true)));
    return row;
  }

  async getById(id: string, userId: string): Promise<CaseFilterPreset | undefined> {
    const [row] = await db.select().from(caseFilterPresets)
      .where(and(eq(caseFilterPresets.id, id), eq(caseFilterPresets.userId, userId)));
    return row;
  }

  async create(userId: string, name: string, filters: CaseFilters, isDefault: boolean): Promise<CaseFilterPreset> {
    return db.transaction(async (tx) => {
      if (isDefault) {
        await tx.update(caseFilterPresets)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(caseFilterPresets.userId, userId), eq(caseFilterPresets.isDefault, true)));
      }
      const [created] = await tx.insert(caseFilterPresets).values({
        userId,
        name,
        filters: filters as object,
        isDefault,
      }).returning();
      return created;
    });
  }

  async update(id: string, userId: string, data: { name?: string; filters?: CaseFilters; isDefault?: boolean }): Promise<CaseFilterPreset | undefined> {
    return db.transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.update(caseFilterPresets)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(caseFilterPresets.userId, userId), eq(caseFilterPresets.isDefault, true)));
      }
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) set.name = data.name;
      if (data.filters !== undefined) set.filters = data.filters;
      if (data.isDefault !== undefined) set.isDefault = data.isDefault;
      const [updated] = await tx.update(caseFilterPresets)
        .set(set)
        .where(and(eq(caseFilterPresets.id, id), eq(caseFilterPresets.userId, userId)))
        .returning();
      return updated;
    });
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const rows = await db.delete(caseFilterPresets)
      .where(and(eq(caseFilterPresets.id, id), eq(caseFilterPresets.userId, userId)))
      .returning({ id: caseFilterPresets.id });
    return rows.length > 0;
  }
}
