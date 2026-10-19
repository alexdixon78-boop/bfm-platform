import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  caseDocumentRequests,
  caseDocuments,
  caseActivities,
  auditLogs,
  type CaseDocument,
  type CaseDocumentRequest,
  type InsertAuditLog,
  type InsertCaseActivity,
  type InsertCaseDocument,
  type InsertCaseDocumentRequest,
} from "@shared/schema";

export type DocumentRequestLifecycleEvent = {
  activity: InsertCaseActivity;
  audit: InsertAuditLog;
};
export type DocumentRequestLifecycleEventDraft = DocumentRequestLifecycleEvent;

async function insertLifecycleEvent(tx: any, event: DocumentRequestLifecycleEvent): Promise<void> {
  await tx.insert(caseActivities).values(event.activity);
  await tx.insert(auditLogs).values(event.audit);
}

export class CaseDocumentRequestRepository {
  async create(data: InsertCaseDocumentRequest, event?: DocumentRequestLifecycleEventDraft): Promise<CaseDocumentRequest> {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(caseDocumentRequests).values(data).returning();
      if (event) await insertLifecycleEvent(tx, {
        activity: { ...event.activity, relatedEntityId: row.id, metadata: JSON.stringify({ documentRequestId: row.id }) },
        audit: { ...event.audit, entityId: row.id },
      });
      return row;
    });
  }

  async getById(id: string): Promise<CaseDocumentRequest | undefined> {
    const [row] = await db.select().from(caseDocumentRequests).where(eq(caseDocumentRequests.id, id)).limit(1);
    return row;
  }

  listByCase(caseId: string): Promise<CaseDocumentRequest[]> {
    return db.select().from(caseDocumentRequests).where(eq(caseDocumentRequests.caseId, caseId)).orderBy(desc(caseDocumentRequests.createdAt));
  }

  async listByPartyIds(partyIds: string[]): Promise<CaseDocumentRequest[]> {
    if (partyIds.length === 0) return [];
    return db.select().from(caseDocumentRequests).where(inArray(caseDocumentRequests.partyId, partyIds)).orderBy(desc(caseDocumentRequests.createdAt));
  }

  async update(id: string, updates: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent): Promise<CaseDocumentRequest | undefined> {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(caseDocumentRequests).set({ ...updates, updatedAt: new Date() }).where(eq(caseDocumentRequests.id, id)).returning();
      if (row && event) await insertLifecycleEvent(tx, event);
      return row;
    });
  }

  async transition(
    id: string,
    expectedStatuses: string[],
    updates: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>,
    event?: DocumentRequestLifecycleEvent,
  ): Promise<CaseDocumentRequest | undefined> {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(caseDocumentRequests)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(
          eq(caseDocumentRequests.id, id),
          inArray(caseDocumentRequests.status, expectedStatuses),
        ))
        .returning();
      if (row && event) await insertLifecycleEvent(tx, event);
      return row;
    });
  }

  async commitSubmission(
    id: string,
    requestUpdates: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>,
    documentData: InsertCaseDocument,
    event: DocumentRequestLifecycleEvent,
  ): Promise<{ request: CaseDocumentRequest; document: CaseDocument } | undefined> {
    return db.transaction(async (tx) => {
      const [request] = await tx.update(caseDocumentRequests)
        .set({ ...requestUpdates, updatedAt: new Date() })
        .where(and(
          eq(caseDocumentRequests.id, id),
          eq(caseDocumentRequests.status, "outstanding"),
        ))
        .returning();
      if (!request) return undefined;
      const [document] = await tx.insert(caseDocuments).values(documentData).returning();
      await insertLifecycleEvent(tx, event);
      return { request, document };
    });
  }

  listDocuments(requestId: string): Promise<CaseDocument[]> {
    return db.select().from(caseDocuments).where(eq(caseDocuments.documentRequestId, requestId)).orderBy(desc(caseDocuments.createdAt));
  }
}
