import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
  whatsappOutbox,
  whatsappPrivateNoteSessions,
  partyWhatsappPreferences,
  parties,
  cases,
  clients,
  type WhatsappConversation,
  type WhatsappMessage,
} from "@shared/schema";
import { logAudit } from "./audit-log.service";
import { caseCommunicationLogService } from "./case-communication-log.service";
import { nextCustomerWindowExpiry } from "./whatsapp-window.service";
import { sanitizeWhatsappMessageForInbox } from "./whatsapp-message-privacy";
import { selectInboundCaseContext } from "./whatsapp-inbound-context";

export type WhatsappMessageContext = {
  caseId?: string | null;
  partyId?: string | null;
  clientId?: string | null;
  contentClassification?: string;
  caseAssignmentSource?: string | null;
};

export function normalizeWhatsappPhone(phone: string): string {
  const trimmed = String(phone || "").trim();
  if (!trimmed) return "";
  const prefix = trimmed.startsWith("+") ? "+" : "";
  return `${prefix}${trimmed.replace(/[^\d]/g, "")}`;
}

class WhatsappConversationService {
  async resolveInboundContext(conversationId: string, clientId?: string | null, phoneNumber?: string | null): Promise<WhatsappMessageContext> {
    const now = new Date();
    const [session] = await db.select().from(whatsappPrivateNoteSessions).where(and(
      eq(whatsappPrivateNoteSessions.conversationId, conversationId),
      isNull(whatsappPrivateNoteSessions.completedAt), isNull(whatsappPrivateNoteSessions.cancelledAt),
      gte(whatsappPrivateNoteSessions.expiresAt, now),
    )).orderBy(desc(whatsappPrivateNoteSessions.createdAt)).limit(1);
    if (session) return {
      caseId: session.caseId, partyId: session.partyId, clientId: clientId || null,
      contentClassification: session.state === "awaiting_private_note_content" ? "private_note_draft" : "verification",
      caseAssignmentSource: "private_note_session",
    };

    let resolvedClientId = clientId || null;
    if (!resolvedClientId && phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, "");
      const matches = await db.select({ id: clients.id }).from(clients).where(sql`regexp_replace(coalesce(${clients.phone}, ''), '[^0-9]', '', 'g') = ${digits}`).limit(2);
      if (matches.length === 1) resolvedClientId = matches[0].id;
    }
    if (!resolvedClientId) return {};
    const activeParties = await db.select({ caseId: parties.caseId, partyId: parties.id, noWhatsapp: cases.noWhatsappOrVoicemail }).from(parties).innerJoin(cases, eq(cases.id, parties.caseId)).where(and(
      eq(parties.clientId, resolvedClientId), ne(cases.status, "Closed"), ne(cases.status, "Archived"),
    ));
    let recentCaseIds: string[] = [];
    if (activeParties.length > 1) {
      const recent = await db.selectDistinct({ caseId: whatsappMessages.caseId }).from(whatsappMessages).where(and(
        eq(whatsappMessages.conversationId, conversationId),
        gte(whatsappMessages.createdAt, new Date(Date.now() - 24 * 60 * 60_000)),
        sql`${whatsappMessages.caseId} is not null`,
      ));
      recentCaseIds = recent.flatMap((row) => row.caseId ? [row.caseId] : []);
    }
    const selected = selectInboundCaseContext({ clientId: resolvedClientId, activeParties, recentCaseIds });
    if (!selected.caseId || !selected.partyId) {
      return selected.caseAssignmentSource ? { clientId: selected.clientId, caseAssignmentSource: selected.caseAssignmentSource } : {};
    }
    if (selected.shouldRecordOptIn) {
      await db.insert(partyWhatsappPreferences).values({ partyId: selected.partyId, status: "opted_in", source: "verified_inbound", recordedAt: now, updatedAt: now }).onConflictDoUpdate({ target: partyWhatsappPreferences.partyId, set: { status: "opted_in", source: "verified_inbound", recordedAt: now, updatedAt: now } });
    }
    return { caseId: selected.caseId, partyId: selected.partyId, clientId: selected.clientId, caseAssignmentSource: selected.caseAssignmentSource };
  }
  async findOrCreateConversation(data: { phoneNumber: string; displayName?: string | null }) {
    const phoneNumber = normalizeWhatsappPhone(data.phoneNumber);
    if (!phoneNumber) throw new Error("WhatsApp phone number is required");

    const [existingContact] = await db.select().from(whatsappContacts).where(eq(whatsappContacts.phoneNumber, phoneNumber)).limit(1);
    const contact = existingContact || (await db.insert(whatsappContacts).values({
      phoneNumber,
      displayName: data.displayName || null,
    }).returning())[0];

    if (!existingContact && data.displayName) {
      // contact already inserted with display name
    } else if (existingContact && data.displayName && existingContact.displayName !== data.displayName) {
      await db.update(whatsappContacts).set({ displayName: data.displayName, updatedAt: new Date() }).where(eq(whatsappContacts.id, existingContact.id));
    }

    const [existingConversation] = await db
      .select()
      .from(whatsappConversations)
      .where(and(eq(whatsappConversations.contactId, contact.id), eq(whatsappConversations.status, "open")))
      .limit(1);

    const conversation = existingConversation || (await db.insert(whatsappConversations).values({
      contactId: contact.id,
      status: "open",
      flowType: "start",
      automationState: "awaiting_menu",
    }).returning())[0];

    return { contact, conversation };
  }

  async getConversation(id: string): Promise<WhatsappConversation | null> {
    const [conversation] = await db.select().from(whatsappConversations).where(eq(whatsappConversations.id, id)).limit(1);
    return conversation || null;
  }

  async touchInbound(conversationId: string): Promise<WhatsappConversation> {
    const [updated] = await db.update(whatsappConversations).set({
      lastInboundAt: new Date(),
      customerServiceWindowExpiresAt: nextCustomerWindowExpiry(),
      updatedAt: new Date(),
    }).where(eq(whatsappConversations.id, conversationId)).returning();
    return updated;
  }

  async markOutbound(conversationId: string): Promise<void> {
    await db.update(whatsappConversations).set({
      lastOutboundAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(whatsappConversations.id, conversationId));
  }

  async updateState(conversationId: string, data: Partial<Pick<WhatsappConversation, "flowType" | "automationState" | "automationPaused" | "caseId" | "enquiryId">>) {
    const [updated] = await db.update(whatsappConversations).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(whatsappConversations.id, conversationId)).returning();
    return updated;
  }

  async recordMessage(data: {
    conversationId: string;
    metaMessageId?: string | null;
    direction: "inbound" | "outbound";
    type?: string;
    body?: string | null;
    templateName?: string | null;
    status?: string;
    errorPayload?: string | null;
    rawPayload?: Record<string, unknown>;
    sentByUserId?: string | null;
    caseId?: string | null;
    partyId?: string | null;
    clientId?: string | null;
    contentClassification?: string;
    caseAssignmentSource?: string | null;
  }): Promise<WhatsappMessage | null> {
    if (data.metaMessageId) {
      const [existing] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.metaMessageId, data.metaMessageId)).limit(1);
      if (existing) return null;
    }

    const [created] = await db.insert(whatsappMessages).values({
      conversationId: data.conversationId,
      metaMessageId: data.metaMessageId || null,
      direction: data.direction,
      type: data.type || "text",
      body: data.body || null,
      templateName: data.templateName || null,
      status: data.status || (data.direction === "inbound" ? "received" : "sent"),
      errorPayload: data.errorPayload || null,
      rawPayload: data.rawPayload || {},
      sentByUserId: data.sentByUserId || null,
      caseId: data.caseId || null,
      partyId: data.partyId || null,
      clientId: data.clientId || null,
      contentClassification: data.contentClassification || "ordinary",
      caseAssignmentSource: data.caseAssignmentSource || null,
    }).returning();
    await caseCommunicationLogService.recordWhatsappMessage(created);
    return created;
  }

  async listConversations(filters: { status?: string; caseId?: string; enquiryId?: string } = {}) {
    const clauses = [];
    if (filters.status) clauses.push(eq(whatsappConversations.status, filters.status));
    if (filters.caseId) clauses.push(sql`exists (select 1 from whatsapp_messages scoped_message where scoped_message.conversation_id = ${whatsappConversations.id} and scoped_message.case_id = ${filters.caseId})`);
    if (filters.enquiryId) clauses.push(eq(whatsappConversations.enquiryId, filters.enquiryId));

    const rows = await db
      .select({
        id: whatsappConversations.id,
        status: whatsappConversations.status,
        flowType: whatsappConversations.flowType,
        automationState: whatsappConversations.automationState,
        automationPaused: whatsappConversations.automationPaused,
        caseId: whatsappConversations.caseId,
        enquiryId: whatsappConversations.enquiryId,
        customerServiceWindowExpiresAt: whatsappConversations.customerServiceWindowExpiresAt,
        lastInboundAt: whatsappConversations.lastInboundAt,
        lastOutboundAt: whatsappConversations.lastOutboundAt,
        createdAt: whatsappConversations.createdAt,
        contactId: whatsappContacts.id,
        phoneNumber: whatsappContacts.phoneNumber,
        displayName: whatsappContacts.displayName,
        verificationStatus: whatsappContacts.verificationStatus,
      })
      .from(whatsappConversations)
      .leftJoin(whatsappContacts, eq(whatsappConversations.contactId, whatsappContacts.id))
      .where(clauses.length ? and(...clauses) : sql`true`)
      .orderBy(desc(sql`COALESCE(${whatsappConversations.lastInboundAt}, ${whatsappConversations.createdAt})`))
      .limit(100);

    return Promise.all(rows.map(async (row) => {
      const [lastMessage] = await db.select().from(whatsappMessages)
        .where(eq(whatsappMessages.conversationId, row.id))
        .orderBy(desc(whatsappMessages.createdAt))
        .limit(1);
      return { ...row, lastMessage: lastMessage ? sanitizeWhatsappMessageForInbox(lastMessage) : null };
    }));
  }

  async getConversationDetail(id: string) {
    const [row] = await db
      .select({
        id: whatsappConversations.id,
        status: whatsappConversations.status,
        flowType: whatsappConversations.flowType,
        automationState: whatsappConversations.automationState,
        automationPaused: whatsappConversations.automationPaused,
        caseId: whatsappConversations.caseId,
        enquiryId: whatsappConversations.enquiryId,
        customerServiceWindowExpiresAt: whatsappConversations.customerServiceWindowExpiresAt,
        lastInboundAt: whatsappConversations.lastInboundAt,
        lastOutboundAt: whatsappConversations.lastOutboundAt,
        createdAt: whatsappConversations.createdAt,
        contact: {
          id: whatsappContacts.id,
          phoneNumber: whatsappContacts.phoneNumber,
          displayName: whatsappContacts.displayName,
          verificationStatus: whatsappContacts.verificationStatus,
        },
      })
      .from(whatsappConversations)
      .leftJoin(whatsappContacts, eq(whatsappConversations.contactId, whatsappContacts.id))
      .where(eq(whatsappConversations.id, id))
      .limit(1);

    if (!row) return null;
    const messages = await db.select().from(whatsappMessages)
      .where(eq(whatsappMessages.conversationId, id))
      .orderBy(whatsappMessages.createdAt);
    return { ...row, messages: messages.map(sanitizeWhatsappMessageForInbox) };
  }

  async listCaseMessages(caseId: string, partyId?: string) {
    const clauses = [eq(whatsappMessages.caseId, caseId)];
    if (partyId) clauses.push(eq(whatsappMessages.partyId, partyId));
    const rows = await db.select().from(whatsappMessages).where(and(...clauses)).orderBy(whatsappMessages.createdAt);
    const outboxClauses = [eq(whatsappOutbox.status, "pending"), sql`${whatsappOutbox.payload}->'context'->>'caseId' = ${caseId}`];
    if (partyId) outboxClauses.push(sql`${whatsappOutbox.payload}->'context'->>'partyId' = ${partyId}`);
    const pendingRows = await db.select().from(whatsappOutbox).where(and(...outboxClauses));
    const queued = pendingRows.flatMap((row) => {
      const payload = row.payload as { kind?: string; body?: string; templateName?: string; fileName?: string; context?: WhatsappMessageContext };
      if (payload.context?.caseId !== caseId || (partyId && payload.context.partyId !== partyId)) return [];
      return [{ id: `outbox:${row.id}`, conversationId: row.conversationId, metaMessageId: null, direction: "outbound", type: payload.kind || "text", body: payload.body || payload.templateName || payload.fileName || null, templateName: payload.templateName || null, status: "queued", errorPayload: row.lastError, rawPayload: {}, sentByUserId: null, caseId, partyId: payload.context.partyId || null, clientId: payload.context.clientId || null, contentClassification: payload.context.contentClassification || "ordinary", caseAssignmentSource: payload.context.caseAssignmentSource || null, createdAt: row.createdAt, updatedAt: row.updatedAt }];
    });
    return [...rows.map(sanitizeWhatsappMessageForInbox), ...queued.map(sanitizeWhatsappMessageForInbox)].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async updateMessageStatus(providerMessageId: string, status: string, errorPayload?: string | null) {
    const [message] = await db.update(whatsappMessages).set({ status, errorPayload: errorPayload || null, updatedAt: new Date() }).where(eq(whatsappMessages.metaMessageId, providerMessageId)).returning();
    if (message) await caseCommunicationLogService.updateWhatsappDeliveryStatus(message.id, status);
    return message || null;
  }

  async assignMessageCase(messageId: string, context: { caseId: string; partyId: string; clientId: string }, actorId: string) {
    const [updated] = await db.update(whatsappMessages).set({ ...context, caseAssignmentSource: "manual", updatedAt: new Date() }).where(eq(whatsappMessages.id, messageId)).returning();
    if (updated) {
      await caseCommunicationLogService.recordWhatsappMessage(updated);
      await logAudit({ userId: actorId, action: "whatsapp_message_case_assigned", entity: "whatsapp_message", entityId: messageId, entityRef: context.caseId, details: JSON.stringify({ partyId: context.partyId }) });
    }
    return updated || null;
  }

  async setAutomationPaused(id: string, paused: boolean, actor: { id: string; email?: string | null }, note?: string | null) {
    const [updated] = await db.update(whatsappConversations).set({
      automationPaused: paused,
      flowType: paused ? "manual" : "start",
      updatedAt: new Date(),
    }).where(eq(whatsappConversations.id, id)).returning();
    if (!updated) return null;
    await logAudit({
      userId: actor.id,
      action: paused ? "whatsapp_automation_paused" : "whatsapp_automation_resumed",
      entity: "whatsapp_conversation",
      entityId: id,
      entityRef: updated.caseId || updated.enquiryId || id,
      details: JSON.stringify({ note: note || null }),
    });
    return updated;
  }

  async findLatestOtpConversationCase(conversationId: string) {
    const [row] = await db.select().from(whatsappConversations)
      .where(and(eq(whatsappConversations.id, conversationId), isNull(whatsappConversations.enquiryId)))
      .limit(1);
    return row?.caseId || null;
  }
}

export const whatsappConversationService = new WhatsappConversationService();
