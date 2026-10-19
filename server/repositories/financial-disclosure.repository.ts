import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  caseDraftFinancialScheduleVersions,
  caseDraftFinancialSchedules,
  financialDisclosureBookletTemplates,
  financialDisclosureEvidenceCategories,
  financialDisclosureFolders,
  financialDisclosureItems,
  type CaseDraftFinancialSchedule,
  type CaseDraftFinancialScheduleVersion,
  type FinancialDisclosureBookletTemplate,
  type FinancialDisclosureEvidenceCategory,
  type FinancialDisclosureFolder,
  type FinancialDisclosureItem,
  type FinancialDisclosureItemStatus,
  type InsertCaseDraftFinancialSchedule,
  type InsertCaseDraftFinancialScheduleVersion,
  type InsertFinancialDisclosureBookletTemplate,
  type InsertFinancialDisclosureEvidenceCategory,
  type InsertFinancialDisclosureFolder,
  type InsertFinancialDisclosureItem,
} from "@shared/schema";

export class FinancialDisclosureRepository {
  async getFolder(id: string): Promise<FinancialDisclosureFolder | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureFolders)
      .where(eq(financialDisclosureFolders.id, id));
    return row;
  }

  async getFolderByCase(caseId: string): Promise<FinancialDisclosureFolder | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureFolders)
      .where(eq(financialDisclosureFolders.caseId, caseId));
    return row;
  }

  async getFolderByCaseAndParty(caseId: string, partyId: string): Promise<FinancialDisclosureFolder | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureFolders)
      .where(and(
        eq(financialDisclosureFolders.caseId, caseId),
        eq(financialDisclosureFolders.partyId, partyId),
      ));
    return row;
  }

  async listFoldersByCase(caseId: string): Promise<FinancialDisclosureFolder[]> {
    return db
      .select()
      .from(financialDisclosureFolders)
      .where(eq(financialDisclosureFolders.caseId, caseId));
  }

  async createFolder(data: InsertFinancialDisclosureFolder): Promise<FinancialDisclosureFolder> {
    const [row] = await db
      .insert(financialDisclosureFolders)
      .values(data)
      .onConflictDoUpdate({
        target: [financialDisclosureFolders.caseId, financialDisclosureFolders.partyId],
        set: { updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async listItems(folderId: string): Promise<FinancialDisclosureItem[]> {
    return db
      .select()
      .from(financialDisclosureItems)
      .where(eq(financialDisclosureItems.folderId, folderId));
  }

  async getItem(id: string): Promise<FinancialDisclosureItem | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureItems)
      .where(eq(financialDisclosureItems.id, id));
    return row;
  }

  async createItem(data: InsertFinancialDisclosureItem): Promise<FinancialDisclosureItem> {
    const [row] = await db
      .insert(financialDisclosureItems)
      .values(data)
      .onConflictDoUpdate({
        target: [financialDisclosureItems.folderId, financialDisclosureItems.itemType],
        set: { updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async updateItem(
    id: string,
    data: {
      status?: FinancialDisclosureItemStatus;
      payload?: Record<string, unknown>;
      completedAt?: Date | null;
      completedBy?: string | null;
      updatedBy?: string | null;
    },
  ): Promise<FinancialDisclosureItem | undefined> {
    const [row] = await db
      .update(financialDisclosureItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(financialDisclosureItems.id, id))
      .returning();
    return row;
  }

  async listEvidenceCategories(folderId: string): Promise<FinancialDisclosureEvidenceCategory[]> {
    return db
      .select()
      .from(financialDisclosureEvidenceCategories)
      .where(eq(financialDisclosureEvidenceCategories.folderId, folderId));
  }

  async getEvidenceCategory(id: string): Promise<FinancialDisclosureEvidenceCategory | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureEvidenceCategories)
      .where(eq(financialDisclosureEvidenceCategories.id, id));
    return row;
  }

  async getEvidenceCategoryByFolderAndKey(folderId: string, categoryKey: string): Promise<FinancialDisclosureEvidenceCategory | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureEvidenceCategories)
      .where(and(
        eq(financialDisclosureEvidenceCategories.folderId, folderId),
        eq(financialDisclosureEvidenceCategories.categoryKey, categoryKey),
      ));
    return row;
  }

  async createEvidenceCategory(data: InsertFinancialDisclosureEvidenceCategory): Promise<FinancialDisclosureEvidenceCategory> {
    const [row] = await db
      .insert(financialDisclosureEvidenceCategories)
      .values(data)
      .onConflictDoUpdate({
        target: [financialDisclosureEvidenceCategories.folderId, financialDisclosureEvidenceCategories.categoryKey],
        set: {
          label: data.label,
          description: data.description ?? null,
          sortOrder: data.sortOrder ?? 0,
        },
      })
      .returning();
    return row;
  }

  async listBookletTemplates(): Promise<FinancialDisclosureBookletTemplate[]> {
    return db
      .select()
      .from(financialDisclosureBookletTemplates);
  }

  async getBookletTemplate(id: string): Promise<FinancialDisclosureBookletTemplate | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureBookletTemplates)
      .where(eq(financialDisclosureBookletTemplates.id, id));
    return row;
  }

  async getCurrentBookletTemplate(): Promise<FinancialDisclosureBookletTemplate | undefined> {
    const [row] = await db
      .select()
      .from(financialDisclosureBookletTemplates)
      .where(eq(financialDisclosureBookletTemplates.isCurrent, true));
    return row;
  }

  async createBookletTemplate(data: InsertFinancialDisclosureBookletTemplate): Promise<FinancialDisclosureBookletTemplate> {
    const [row] = await db
      .insert(financialDisclosureBookletTemplates)
      .values(data)
      .returning();
    return row;
  }

  async markBookletTemplateCurrent(id: string, _actorId: string): Promise<FinancialDisclosureBookletTemplate | undefined> {
    await db
      .update(financialDisclosureBookletTemplates)
      .set({ isCurrent: false })
      .where(eq(financialDisclosureBookletTemplates.isCurrent, true));
    const [row] = await db
      .update(financialDisclosureBookletTemplates)
      .set({ isCurrent: true })
      .where(eq(financialDisclosureBookletTemplates.id, id))
      .returning();
    return row;
  }

  async getDraftScheduleByCase(caseId: string): Promise<CaseDraftFinancialSchedule | undefined> {
    const [row] = await db
      .select()
      .from(caseDraftFinancialSchedules)
      .where(eq(caseDraftFinancialSchedules.caseId, caseId));
    return row;
  }

  async getDraftScheduleBySession(sessionId: string): Promise<CaseDraftFinancialSchedule | undefined> {
    const [row] = await db.select().from(caseDraftFinancialSchedules)
      .where(eq(caseDraftFinancialSchedules.mediationSessionId, sessionId));
    return row;
  }

  async upsertDraftSchedule(data: InsertCaseDraftFinancialSchedule): Promise<CaseDraftFinancialSchedule> {
    const [row] = await db
      .insert(caseDraftFinancialSchedules)
      .values(data)
      .onConflictDoUpdate({
        target: caseDraftFinancialSchedules.caseId,
        set: {
          status: data.status || "draft",
          payload: data.payload,
          updatedBy: data.updatedBy ?? data.createdBy ?? null,
          confirmedAt: data.confirmedAt ?? null,
          confirmedBy: data.confirmedBy ?? null,
          confirmedInSessionId: data.confirmedInSessionId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async upsertDraftScheduleForSession(data: InsertCaseDraftFinancialSchedule & { mediationSessionId: string }): Promise<CaseDraftFinancialSchedule> {
    const [row] = await db.insert(caseDraftFinancialSchedules).values(data)
      .onConflictDoUpdate({
        target: caseDraftFinancialSchedules.mediationSessionId,
        set: { status: data.status || "draft", payload: data.payload, updatedBy: data.updatedBy ?? data.createdBy ?? null, updatedAt: new Date() },
      }).returning();
    return row;
  }

  async listDraftScheduleVersions(scheduleId: string): Promise<CaseDraftFinancialScheduleVersion[]> {
    return db
      .select()
      .from(caseDraftFinancialScheduleVersions)
      .where(eq(caseDraftFinancialScheduleVersions.scheduleId, scheduleId))
      .orderBy(desc(caseDraftFinancialScheduleVersions.versionNumber));
  }

  async getNextDraftScheduleVersionNumber(scheduleId: string): Promise<number> {
    const [latest] = await db
      .select({ versionNumber: caseDraftFinancialScheduleVersions.versionNumber })
      .from(caseDraftFinancialScheduleVersions)
      .where(eq(caseDraftFinancialScheduleVersions.scheduleId, scheduleId))
      .orderBy(desc(caseDraftFinancialScheduleVersions.versionNumber))
      .limit(1);
    return (latest?.versionNumber || 0) + 1;
  }

  async createDraftScheduleVersion(data: InsertCaseDraftFinancialScheduleVersion): Promise<CaseDraftFinancialScheduleVersion> {
    const [row] = await db
      .insert(caseDraftFinancialScheduleVersions)
      .values(data)
      .returning();
    return row;
  }
}
