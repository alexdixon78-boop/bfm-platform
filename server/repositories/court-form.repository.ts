import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  courtFormDrafts,
  courtFormGenerations,
  courtFormGuidance,
  courtFormTemplates,
  type CourtFormDraft,
  type CourtFormGeneration,
  type CourtFormGuidance,
  type CourtFormTemplate,
  type CourtFormType,
  type InsertCourtFormDraft,
  type InsertCourtFormGeneration,
  type InsertCourtFormGuidance,
  type InsertCourtFormTemplate,
} from "@shared/schema";

export class CourtFormRepository {
  listTemplates(): Promise<CourtFormTemplate[]> {
    return db
      .select()
      .from(courtFormTemplates)
      .where(isNull(courtFormTemplates.deletedAt))
      .orderBy(courtFormTemplates.formType, desc(courtFormTemplates.uploadedAt));
  }

  async getTemplate(id: string): Promise<CourtFormTemplate | undefined> {
    const [row] = await db.select().from(courtFormTemplates).where(eq(courtFormTemplates.id, id));
    return row;
  }

  async getCurrentTemplate(formType: CourtFormType): Promise<CourtFormTemplate | undefined> {
    const [row] = await db
      .select()
      .from(courtFormTemplates)
      .where(and(eq(courtFormTemplates.formType, formType), eq(courtFormTemplates.isCurrent, true), isNull(courtFormTemplates.deletedAt)))
      .limit(1);
    return row;
  }

  async createTemplate(data: InsertCourtFormTemplate): Promise<CourtFormTemplate> {
    const [row] = await db.insert(courtFormTemplates).values(data).returning();
    return row;
  }

  async updateTemplate(id: string, data: Partial<Omit<CourtFormTemplate, "id" | "uploadedAt">>): Promise<CourtFormTemplate | undefined> {
    const [row] = await db.update(courtFormTemplates).set(data).where(eq(courtFormTemplates.id, id)).returning();
    return row;
  }

  async updateTemplateMappingIfUnchanged(id: string, expectedMapping: unknown, fieldMapping: unknown): Promise<CourtFormTemplate | undefined> {
    const [row] = await db
      .update(courtFormTemplates)
      .set({ fieldMapping })
      .where(and(
        eq(courtFormTemplates.id, id),
        isNull(courtFormTemplates.deletedAt),
        sql`${courtFormTemplates.fieldMapping} = ${JSON.stringify(expectedMapping)}::jsonb`,
      ))
      .returning();
    return row;
  }

  async markCurrent(id: string, formType: CourtFormType, verifiedBy?: string | null, verifiedCurrentAt?: Date | null): Promise<CourtFormTemplate | undefined> {
    return db.transaction(async (tx) => {
      await tx
        .update(courtFormTemplates)
        .set({ isCurrent: false })
        .where(and(eq(courtFormTemplates.formType, formType), isNull(courtFormTemplates.deletedAt)));
      const [row] = await tx
        .update(courtFormTemplates)
        .set({ isCurrent: true, verifiedBy: verifiedBy ?? null, verifiedCurrentAt: verifiedCurrentAt ?? null })
        .where(and(eq(courtFormTemplates.id, id), isNull(courtFormTemplates.deletedAt)))
        .returning();
      return row;
    });
  }

  async deleteTemplate(id: string, deletedBy: string): Promise<CourtFormTemplate | undefined> {
    const [row] = await db
      .update(courtFormTemplates)
      .set({ isCurrent: false, deletedAt: new Date(), deletedBy })
      .where(and(eq(courtFormTemplates.id, id), isNull(courtFormTemplates.deletedAt)))
      .returning();
    return row;
  }

  listGuidance(formType?: CourtFormType, templateId?: string | null): Promise<CourtFormGuidance[]> {
    const conditions = [];
    if (formType) conditions.push(eq(courtFormGuidance.formType, formType));
    if (templateId) conditions.push(eq(courtFormGuidance.templateId, templateId));
    const query = db.select().from(courtFormGuidance);
    return (conditions.length ? query.where(and(...conditions)) : query).orderBy(courtFormGuidance.sortOrder);
  }

  async createGuidance(data: InsertCourtFormGuidance): Promise<CourtFormGuidance> {
    const [row] = await db.insert(courtFormGuidance).values(data).returning();
    return row;
  }

  async updateGuidance(id: string, data: Partial<Omit<CourtFormGuidance, "id" | "createdAt">>): Promise<CourtFormGuidance | undefined> {
    const [row] = await db
      .update(courtFormGuidance)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(courtFormGuidance.id, id))
      .returning();
    return row;
  }

  async getDraft(caseId: string, partyId: string, formType: CourtFormType): Promise<CourtFormDraft | undefined> {
    const [row] = await db
      .select()
      .from(courtFormDrafts)
      .where(and(eq(courtFormDrafts.caseId, caseId), eq(courtFormDrafts.partyId, partyId), eq(courtFormDrafts.formType, formType)));
    return row;
  }

  async upsertCourtFormDraft(data: InsertCourtFormDraft): Promise<CourtFormDraft> {
    const [row] = await db
      .insert(courtFormDrafts)
      .values(data)
      .onConflictDoUpdate({
        target: [courtFormDrafts.caseId, courtFormDrafts.partyId, courtFormDrafts.formType],
        set: {
          templateId: data.templateId ?? null,
          answers: data.answers ?? {},
          status: data.status ?? "draft",
          updatedBy: data.updatedBy ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  listGenerationsByCase(caseId: string): Promise<CourtFormGeneration[]> {
    return db
      .select()
      .from(courtFormGenerations)
      .where(eq(courtFormGenerations.caseId, caseId))
      .orderBy(desc(courtFormGenerations.generatedAt));
  }

  async getGeneration(id: string): Promise<CourtFormGeneration | undefined> {
    const [row] = await db.select().from(courtFormGenerations).where(eq(courtFormGenerations.id, id));
    return row;
  }

  async createCourtFormGeneration(data: InsertCourtFormGeneration): Promise<CourtFormGeneration> {
    const [row] = await db.insert(courtFormGenerations).values(data).returning();
    return row;
  }

  async updateGeneration(id: string, data: Partial<Omit<CourtFormGeneration, "id" | "generatedAt">>): Promise<CourtFormGeneration | undefined> {
    const [row] = await db.update(courtFormGenerations).set(data).where(eq(courtFormGenerations.id, id)).returning();
    return row;
  }
}
