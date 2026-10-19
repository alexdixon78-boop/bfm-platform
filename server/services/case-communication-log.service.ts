import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  caseActivities,
  caseCommunicationLogs,
  caseDocuments,
  cases,
  clients,
  gmailMessages,
  gmailCaseReplyAttachments,
  parties,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
  type CaseCommunicationLog,
  type GmailMessage,
  type InsertCaseCommunicationLog,
  type WhatsappMessage,
} from "@shared/schema";
import type { Actor } from "./case-activity.service";

type Channel = "email" | "whatsapp" | "phone" | "manual";
type Direction = "inbound" | "outbound" | "internal";
type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "received" | "skipped" | "manual" | "unknown";
type BackfillConfidence = "exact" | "inferred" | "partial";

export type RecordCommunicationInput = {
  caseId: string;
  caseRef?: string | null;
  partyId?: string | null;
  clientId?: string | null;
  recipientType?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  channel: Channel | string;
  direction: Direction | string;
  trigger?: string | null;
  templateName?: string | null;
  subject?: string | null;
  sentAt?: Date | string | null;
  deliveryStatus?: DeliveryStatus | string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  providerMessageId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  preview?: string | null;
  metadata?: Record<string, unknown> | null;
  backfillConfidence?: BackfillConfidence;
};

export type CommunicationFilters = {
  channel?: string;
  direction?: string;
  deliveryStatus?: string;
  recipientId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
};

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function preview(value: string | null | undefined, maxLength = 500): string | null {
  const compact = clean(value)?.replace(/\s+/g, " ");
  if (!compact) return null;
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

export function normalizeDeliveryStatus(status: string | null | undefined, direction?: string): DeliveryStatus {
  const normalized = clean(status)?.toLowerCase();
  if (normalized === "queued" || normalized === "pending") return "queued";
  if (normalized === "sent") return "sent";
  if (normalized === "delivered") return "delivered";
  if (normalized === "read") return "read";
  if (normalized === "failed" || normalized === "error") return "failed";
  if (normalized === "received" || normalized === "imported") return "received";
  if (normalized === "skipped" || normalized === "not_attempted") return "skipped";
  if (normalized === "manual") return "manual";
  if (direction === "inbound") return "received";
  return "unknown";
}

function channelFromActivityType(type: string): Channel {
  if (type === "email_sent") return "email";
  if (type === "whatsapp_logged") return "whatsapp";
  if (type === "call_logged") return "phone";
  return "manual";
}

function triggerFromActivityType(type: string): string {
  if (type === "email_sent") return "historical_email_activity";
  if (type === "whatsapp_logged") return "historical_whatsapp_activity";
  if (type === "call_logged") return "historical_phone_activity";
  return "historical_import";
}

const inferredBackfillDefaults = { backfillConfidence: "inferred" as const };
const partialBackfillDefaults = { backfillConfidence: "partial" as const };

class CaseCommunicationLogService {
  async record(input: RecordCommunicationInput): Promise<CaseCommunicationLog | null> {
    try {
      const existingCase = input.caseRef
        ? null
        : (await db.select({ caseRef: cases.caseRef }).from(cases).where(eq(cases.id, input.caseId)).limit(1))[0];
      const recipient = await this.inferRecipient(input.caseId, input);
      const values: InsertCaseCommunicationLog = {
        caseId: input.caseId,
        caseRef: clean(input.caseRef) || existingCase?.caseRef || input.caseId,
        partyId: input.partyId ?? recipient?.partyId ?? null,
        clientId: input.clientId ?? recipient?.clientId ?? null,
        recipientType: clean(input.recipientType) || recipient?.recipientType || "client",
        recipientName: clean(input.recipientName) || recipient?.recipientName || null,
        recipientEmail: clean(input.recipientEmail) || recipient?.recipientEmail || null,
        recipientPhone: clean(input.recipientPhone) || recipient?.recipientPhone || null,
        channel: clean(input.channel) || "manual",
        direction: clean(input.direction) || "internal",
        trigger: clean(input.trigger) || "manual",
        templateName: clean(input.templateName),
        subject: clean(input.subject),
        sentAt: input.sentAt ? new Date(input.sentAt) : new Date(),
        deliveryStatus: normalizeDeliveryStatus(input.deliveryStatus, input.direction),
        sourceEntityType: clean(input.sourceEntityType),
        sourceEntityId: clean(input.sourceEntityId),
        providerMessageId: clean(input.providerMessageId),
        actorType: clean(input.actorType) || "system",
        actorId: clean(input.actorId),
        actorName: clean(input.actorName),
        preview: preview(input.preview),
        metadata: input.metadata || {},
        backfillConfidence: input.backfillConfidence || "exact",
      };

      const [created] = await db
        .insert(caseCommunicationLogs)
        .values(values)
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      if (values.sourceEntityType && values.sourceEntityId) {
        const [existing] = await db
          .select()
          .from(caseCommunicationLogs)
          .where(and(
            eq(caseCommunicationLogs.sourceEntityType, values.sourceEntityType),
            eq(caseCommunicationLogs.sourceEntityId, values.sourceEntityId),
          ))
          .limit(1);
        return existing ?? null;
      }
      return null;
    } catch (err) {
      console.error("[CaseCommunicationLog] Failed to record communication:", err);
      return null;
    }
  }

  async recordManualCommunication(input: {
    caseId: string;
    type: "call_logged" | "whatsapp_logged" | "email_sent" | "manual";
    direction: "inbound" | "outbound" | "internal";
    summary: string;
    contactName?: string | null;
    recipientEmail?: string | null;
    recipientPhone?: string | null;
    occurredAt?: Date | string | null;
    actor: Actor;
    sourceEntityId?: string | null;
  }) {
    return this.record({
      caseId: input.caseId,
      channel: channelFromActivityType(input.type),
      direction: input.direction,
      trigger: "manual",
      recipientName: input.contactName,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      sentAt: input.occurredAt || new Date(),
      deliveryStatus: "manual",
      sourceEntityType: input.sourceEntityId ? "case_activity" : "manual_communication",
      sourceEntityId: input.sourceEntityId || undefined,
      actorType: input.actor.type,
      actorId: input.actor.id || null,
      actorName: input.actor.name,
      preview: input.summary,
      metadata: { contactName: input.contactName || null, direction: input.direction },
    });
  }

  async recordWhatsappMessage(message: WhatsappMessage): Promise<CaseCommunicationLog | null> {
    if (message.contentClassification !== "ordinary") return null;
    const [context] = await db
      .select({
        caseId: whatsappMessages.caseId,
        caseRef: cases.caseRef,
        partyId: whatsappMessages.partyId,
        clientId: whatsappMessages.clientId,
        phoneNumber: whatsappContacts.phoneNumber,
        displayName: whatsappContacts.displayName,
      })
      .from(whatsappMessages)
      .innerJoin(whatsappConversations, eq(whatsappMessages.conversationId, whatsappConversations.id))
      .leftJoin(whatsappContacts, eq(whatsappConversations.contactId, whatsappContacts.id))
      .leftJoin(cases, eq(whatsappMessages.caseId, cases.id))
      .where(eq(whatsappMessages.id, message.id))
      .limit(1);
    if (!message.caseId || !context?.caseId || !context.caseRef) return null;

    return this.record({
      caseId: context.caseId,
      caseRef: context.caseRef,
      partyId: context.partyId,
      clientId: context.clientId,
      recipientType: "client",
      recipientName: context.displayName,
      recipientPhone: context.phoneNumber,
      channel: "whatsapp",
      direction: message.direction,
      trigger: message.direction === "inbound" ? "whatsapp_inbound" : "whatsapp_outbound",
      templateName: message.templateName,
      sentAt: message.createdAt,
      deliveryStatus: normalizeDeliveryStatus(message.status, message.direction),
      sourceEntityType: "whatsapp_message",
      sourceEntityId: message.id,
      providerMessageId: message.metaMessageId,
      actorType: message.sentByUserId ? "staff" : message.direction === "inbound" ? "client" : "system",
      actorId: message.sentByUserId,
      preview: message.body || message.templateName,
      metadata: { conversationId: message.conversationId, messageType: message.type },
      backfillConfidence: "exact",
    });
  }

  async updateWhatsappDeliveryStatus(messageId: string, deliveryStatus: string) {
    const [updated] = await db.update(caseCommunicationLogs).set({ deliveryStatus: normalizeDeliveryStatus(deliveryStatus), updatedAt: new Date() }).where(and(eq(caseCommunicationLogs.sourceEntityType, "whatsapp_message"), eq(caseCommunicationLogs.sourceEntityId, messageId))).returning();
    return updated || null;
  }

  async recordGmailMessage(message: GmailMessage): Promise<CaseCommunicationLog | null> {
    if (!message.linkedCaseId) return null;
    const [caseRow] = await db.select({ caseRef: cases.caseRef }).from(cases).where(eq(cases.id, message.linkedCaseId)).limit(1);
    if (!caseRow) return null;
    return this.record({
      caseId: message.linkedCaseId,
      caseRef: caseRow.caseRef,
      recipientType: "client",
      recipientName: message.fromName,
      recipientEmail: message.fromEmail,
      channel: "email",
      direction: "inbound",
      trigger: "gmail_import",
      subject: message.subject,
      sentAt: message.receivedAt || message.importedAt,
      deliveryStatus: "received",
      sourceEntityType: "gmail_message",
      sourceEntityId: message.id,
      providerMessageId: message.gmailMessageId,
      actorType: "client",
      preview: message.snippet || message.textBody,
      metadata: { gmailThreadId: message.gmailThreadId, status: message.status },
      backfillConfidence: "exact",
    });
  }

  async listByCase(caseId: string, filters: CommunicationFilters = {}) {
    const clauses = [eq(caseCommunicationLogs.caseId, caseId)];
    if (filters.channel) clauses.push(eq(caseCommunicationLogs.channel, filters.channel));
    if (filters.direction) clauses.push(eq(caseCommunicationLogs.direction, filters.direction));
    if (filters.deliveryStatus) clauses.push(eq(caseCommunicationLogs.deliveryStatus, filters.deliveryStatus));
    if (filters.recipientId) {
      clauses.push(or(eq(caseCommunicationLogs.partyId, filters.recipientId), eq(caseCommunicationLogs.clientId, filters.recipientId))!);
    }
    if (filters.dateFrom) clauses.push(gte(caseCommunicationLogs.sentAt, filters.dateFrom));
    if (filters.dateTo) clauses.push(lte(caseCommunicationLogs.sentAt, filters.dateTo));
    const where = and(...clauses);
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(caseCommunicationLogs).where(where);
    const rows = await db
      .select()
      .from(caseCommunicationLogs)
      .where(where)
      .orderBy(desc(caseCommunicationLogs.sentAt), desc(caseCommunicationLogs.createdAt))
      .limit(filters.limit || 100)
      .offset(filters.offset || 0);
    const gmailMessageIds = rows
      .filter((row) => row.sourceEntityType === "gmail_message" && row.sourceEntityId)
      .map((row) => row.sourceEntityId!);
    const attachmentCounts = gmailMessageIds.length > 0
      ? await db.select({ gmailMessageId: gmailCaseReplyAttachments.gmailMessageId, count: sql<number>`count(*)` })
        .from(gmailCaseReplyAttachments)
        .where(inArray(gmailCaseReplyAttachments.gmailMessageId, gmailMessageIds))
        .groupBy(gmailCaseReplyAttachments.gmailMessageId)
      : [];
    const countByMessage = new Map(attachmentCounts.map((row) => [row.gmailMessageId, Number(row.count)]));
    const data = rows.map((row) => ({
      ...row,
      hasEmailDetail: row.sourceEntityType === "gmail_message" && row.trigger === "gmail_case_reply",
      attachmentCount: row.sourceEntityId ? countByMessage.get(row.sourceEntityId) || 0 : 0,
    }));
    return { data, total: Number(countResult.count) };
  }

  async getEmailDetail(caseId: string, communicationId: string) {
    const [row] = await db
      .select({
        communicationId: caseCommunicationLogs.id,
        gmailMessageId: gmailMessages.id,
        gmailThreadId: gmailMessages.gmailThreadId,
        fromName: gmailMessages.fromName,
        fromEmail: gmailMessages.fromEmail,
        toEmails: gmailMessages.toEmails,
        ccEmails: gmailMessages.ccEmails,
        subject: gmailMessages.subject,
        receivedAt: gmailMessages.receivedAt,
        textBody: gmailMessages.textBody,
        sanitizedHtmlBody: gmailMessages.sanitizedHtmlBody,
      })
      .from(caseCommunicationLogs)
      .innerJoin(gmailMessages, eq(caseCommunicationLogs.sourceEntityId, gmailMessages.id))
      .where(and(
        eq(caseCommunicationLogs.id, communicationId),
        eq(caseCommunicationLogs.caseId, caseId),
        eq(caseCommunicationLogs.sourceEntityType, "gmail_message"),
        eq(caseCommunicationLogs.trigger, "gmail_case_reply"),
      ))
      .limit(1);
    if (!row) return null;
    const attachments = await db
      .select({
        id: gmailCaseReplyAttachments.id,
        fileName: gmailCaseReplyAttachments.fileName,
        mimeType: gmailCaseReplyAttachments.mimeType,
        sizeBytes: gmailCaseReplyAttachments.sizeBytes,
        status: gmailCaseReplyAttachments.status,
        failureReason: gmailCaseReplyAttachments.failureReason,
        documentId: gmailCaseReplyAttachments.caseDocumentId,
        documentTitle: caseDocuments.title,
      })
      .from(gmailCaseReplyAttachments)
      .leftJoin(caseDocuments, eq(gmailCaseReplyAttachments.caseDocumentId, caseDocuments.id))
      .where(eq(gmailCaseReplyAttachments.gmailMessageId, row.gmailMessageId));
    return {
      ...row,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        downloadUrl: attachment.documentId ? `/api/case-documents/${attachment.documentId}/download` : null,
      })),
    };
  }

  async backfillExistingRecords() {
    const [activityCount, whatsappCount, gmailCount] = await Promise.all([
      this.backfillFromCaseActivities(),
      this.backfillFromWhatsappMessages(),
      this.backfillFromGmailMessages(),
    ]);
    return { activityCount, whatsappCount, gmailCount, total: activityCount + whatsappCount + gmailCount };
  }

  private async backfillFromCaseActivities(): Promise<number> {
    const rows = await db
      .select({
        id: caseActivities.id,
        caseId: caseActivities.caseId,
        caseRef: cases.caseRef,
        type: caseActivities.type,
        description: caseActivities.description,
        metadata: caseActivities.metadata,
        direction: caseActivities.direction,
        performedBy: caseActivities.performedBy,
        performedByName: caseActivities.performedByName,
        actorType: caseActivities.actorType,
        occurredAt: caseActivities.occurredAt,
      })
      .from(caseActivities)
      .innerJoin(cases, eq(caseActivities.caseId, cases.id))
      .where(or(
        eq(caseActivities.type, "call_logged"),
        eq(caseActivities.type, "whatsapp_logged"),
        eq(caseActivities.type, "email_sent"),
      ));
    let created = 0;
    for (const row of rows) {
      const metadata = parseJsonObject(row.metadata);
      const confidenceDefaults = row.type === "email_sent" ? inferredBackfillDefaults : partialBackfillDefaults;
      const result = await this.record({
        caseId: row.caseId,
        caseRef: row.caseRef,
        recipientName: typeof metadata.contactName === "string" ? metadata.contactName : null,
        recipientEmail: typeof metadata.recipientEmail === "string" ? metadata.recipientEmail : null,
        channel: channelFromActivityType(row.type),
        direction: clean(row.direction) || (row.type === "email_sent" ? "outbound" : "internal"),
        trigger: triggerFromActivityType(row.type),
        subject: typeof metadata.subject === "string" ? metadata.subject : null,
        sentAt: row.occurredAt,
        deliveryStatus: row.type === "call_logged" || row.type === "whatsapp_logged" ? "manual" : "sent",
        sourceEntityType: "case_activity",
        sourceEntityId: row.id,
        actorType: row.actorType || (row.performedBy ? "staff" : "system"),
        actorId: row.performedBy,
        actorName: row.performedByName,
        preview: row.description,
        metadata,
        ...confidenceDefaults,
      });
      if (result?.sourceEntityId === row.id) created += 1;
    }
    return created;
  }

  private async backfillFromWhatsappMessages(): Promise<number> {
    const rows = await db
      .select({ message: whatsappMessages })
      .from(whatsappMessages)
      .innerJoin(whatsappConversations, eq(whatsappMessages.conversationId, whatsappConversations.id))
      .where(isNotNull(whatsappConversations.caseId));
    let created = 0;
    for (const row of rows) {
      const result = await this.recordWhatsappMessage(row.message);
      if (result?.sourceEntityId === row.message.id) created += 1;
    }
    return created;
  }

  private async backfillFromGmailMessages(): Promise<number> {
    const rows = await db.select().from(gmailMessages).where(isNotNull(gmailMessages.linkedCaseId));
    let created = 0;
    for (const row of rows) {
      const result = await this.recordGmailMessage(row);
      if (result?.sourceEntityId === row.id) created += 1;
    }
    return created;
  }

  private async inferRecipient(caseId: string, input: RecordCommunicationInput) {
    const email = clean(input.recipientEmail)?.toLowerCase();
    const phone = clean(input.recipientPhone)?.replace(/[^\d]/g, "");
    if (!email && !phone) return null;
    const rows = await db
      .select({
        partyId: parties.id,
        clientId: clients.id,
        recipientName: sql<string>`trim(coalesce(${clients.firstName}, '') || ' ' || coalesce(${clients.lastName}, ''))`,
        recipientEmail: clients.email,
        recipientPhone: clients.phone,
      })
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.caseId, caseId));
    return rows.find((row) => {
      const rowEmail = clean(row.recipientEmail)?.toLowerCase();
      const rowPhone = clean(row.recipientPhone)?.replace(/[^\d]/g, "");
      return (email && rowEmail === email) || (phone && rowPhone === phone);
    }) ? {
      ...rows.find((row) => {
        const rowEmail = clean(row.recipientEmail)?.toLowerCase();
        const rowPhone = clean(row.recipientPhone)?.replace(/[^\d]/g, "");
        return (email && rowEmail === email) || (phone && rowPhone === phone);
      })!,
      recipientType: "client",
    } : null;
  }
}

export const caseCommunicationLogService = new CaseCommunicationLogService();
