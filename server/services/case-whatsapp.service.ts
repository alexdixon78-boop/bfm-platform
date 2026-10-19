import crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { caseDocuments, cases, clients, parties, partyWhatsappPreferences, whatsappContacts, whatsappConversations, whatsappOutboundMedia, whatsappTemplateCatalog, type User } from "@shared/schema";
import { whatsappConversationService, normalizeWhatsappPhone } from "./whatsapp-conversation.service";
import { whatsappWindowService } from "./whatsapp-window.service";
import { whatsappOutboxService } from "./whatsapp-outbox.service";
import { fileStorageService } from "./file-storage.service";
import { logAudit } from "./audit-log.service";
import { bookingService } from "./booking.service";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]);
export const MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME = "bfm_miam_booking";
export const MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME = "bfm_mediation_session_booking";
export const BOOKING_WHATSAPP_TEMPLATE_LANGUAGE = "en_GB";

class CaseWhatsappService {
  private async partyContext(caseId: string, partyId: string) {
    const [row] = await db.select({ party: parties, client: clients, preference: partyWhatsappPreferences, caseRecord: cases }).from(parties).innerJoin(clients, eq(clients.id, parties.clientId)).innerJoin(cases, eq(cases.id, parties.caseId)).leftJoin(partyWhatsappPreferences, eq(partyWhatsappPreferences.partyId, parties.id)).where(and(eq(parties.id, partyId), eq(parties.caseId, caseId))).limit(1);
    return row || null;
  }

  async listRecipients(caseId: string) {
    const rows = await db.select({ party: parties, client: clients, preference: partyWhatsappPreferences, caseRecord: cases }).from(parties).innerJoin(clients, eq(clients.id, parties.clientId)).innerJoin(cases, eq(cases.id, parties.caseId)).leftJoin(partyWhatsappPreferences, eq(partyWhatsappPreferences.partyId, parties.id)).where(eq(parties.caseId, caseId));
    return Promise.all(rows.map(async ({ party, client, preference, caseRecord }) => {
      const phone = normalizeWhatsappPhone(client.phone || "");
      const [contact] = phone ? await db.select().from(whatsappContacts).where(eq(whatsappContacts.phoneNumber, phone)).limit(1) : [];
      const [conversation] = contact ? await db.select().from(whatsappConversations).where(and(eq(whatsappConversations.contactId, contact.id), eq(whatsappConversations.status, "open"))).limit(1) : [];
      return { partyId: party.id, clientId: client.id, name: `${client.firstName || ""} ${client.lastName || ""}`.trim(), role: party.role, phone, optInStatus: preference?.status || "unknown", noWhatsappOrVoicemail: caseRecord.noWhatsappOrVoicemail, conversationId: conversation?.id || null, conversationStatus: conversation?.status || "not_started", automationState: conversation?.automationState || null, customerServiceWindowExpiresAt: conversation?.customerServiceWindowExpiresAt || null };
    }));
  }

  async listMessages(caseId: string, partyId: string) {
    if (!(await this.partyContext(caseId, partyId))) throw Object.assign(new Error("Recipient not found"), { status: 404 });
    return whatsappConversationService.listCaseMessages(caseId, partyId);
  }

  async recordPreference(caseId: string, partyId: string, status: "opted_in" | "opted_out", source: string, actor: User) {
    if (!(await this.partyContext(caseId, partyId))) throw Object.assign(new Error("Recipient not found"), { status: 404 });
    const now = new Date();
    const [row] = await db.insert(partyWhatsappPreferences).values({ partyId, status, source, recordedBy: actor.id, recordedAt: now, updatedAt: now }).onConflictDoUpdate({ target: partyWhatsappPreferences.partyId, set: { status, source, recordedBy: actor.id, recordedAt: now, updatedAt: now } }).returning();
    await logAudit({ userId: actor.id, action: "whatsapp_preference_recorded", entity: "party", entityId: partyId, entityRef: caseId, details: JSON.stringify({ status, source }) });
    return row;
  }

  async createUpload(caseId: string, partyId: string, input: { fileName?: string; fileData?: string; mimeType?: string; caseDocumentId?: string }, actor: User) {
    const context = await this.partyContext(caseId, partyId);
    if (!context) throw Object.assign(new Error("Recipient not found"), { status: 404 });
    let fileName = input.fileName || "attachment";
    let mimeType = input.mimeType || "application/octet-stream";
    let sizeBytes = 0;
    let storageKey: string | null = null;
    let sourceDocumentId: string | null = null;
    if (input.caseDocumentId) {
      const [document] = await db.select().from(caseDocuments).where(and(eq(caseDocuments.id, input.caseDocumentId), eq(caseDocuments.caseId, caseId))).limit(1);
      if (!document?.storageKey) throw Object.assign(new Error("Case document not found"), { status: 404 });
      fileName = document.fileName; mimeType = document.mimeType || "application/octet-stream"; sizeBytes = document.fileSizeBytes || 0; storageKey = document.storageKey; sourceDocumentId = document.id;
    } else {
      const match = input.fileData?.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw Object.assign(new Error("A valid file upload is required"), { status: 400 });
      mimeType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      sizeBytes = buffer.length;
      if (sizeBytes > MAX_MEDIA_BYTES || !ALLOWED_MEDIA_TYPES.has(mimeType)) throw Object.assign(new Error("Unsupported or oversized WhatsApp attachment"), { status: 400 });
      const stored = await fileStorageService.saveWhatsappOutboundMedia({ fileName: `${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`, buffer, mimeType });
      storageKey = stored.storageKey;
    }
    const [media] = await db.insert(whatsappOutboundMedia).values({ caseId, partyId, sourceType: sourceDocumentId ? "case_document" : "upload", sourceDocumentId, fileName, mimeType, sizeBytes, storageKey, status: "queued", createdBy: actor.id }).returning();
    return media;
  }

  async listUploads(caseId: string, partyId: string, ids: string[]) {
    if (!(await this.partyContext(caseId, partyId))) throw Object.assign(new Error("Recipient not found"), { status: 404 });
    if (!ids.length) return [];
    return db.select({ id: whatsappOutboundMedia.id, fileName: whatsappOutboundMedia.fileName, mimeType: whatsappOutboundMedia.mimeType, status: whatsappOutboundMedia.status, retryCount: whatsappOutboundMedia.retryCount, lastError: whatsappOutboundMedia.lastError }).from(whatsappOutboundMedia).where(and(eq(whatsappOutboundMedia.caseId, caseId), eq(whatsappOutboundMedia.partyId, partyId), inArray(whatsappOutboundMedia.id, ids)));
  }

  async send(caseId: string, input: { partyId: string; body?: string; template?: { name: string; language: string; parameters?: Record<string, string>; headerMediaId?: string }; mediaIds?: string[] }, actor: User) {
    const context = await this.partyContext(caseId, input.partyId);
    if (!context || context.party.caseId !== caseId) throw Object.assign(new Error("Recipient not found"), { status: 404 });
    if (context.caseRecord.noWhatsappOrVoicemail) throw Object.assign(new Error("WhatsApp is disabled for this case"), { status: 409 });
    if (context.preference?.status !== "opted_in") throw Object.assign(new Error("Recorded WhatsApp opt-in is required"), { status: 409 });
    const phone = normalizeWhatsappPhone(context.client.phone || "");
    if (!phone) throw Object.assign(new Error("Recipient has no valid mobile number"), { status: 400 });
    const { contact, conversation } = await whatsappConversationService.findOrCreateConversation({ phoneNumber: phone, displayName: `${context.client.firstName || ""} ${context.client.lastName || ""}`.trim() });
    const windowOpen = whatsappWindowService.isWindowOpen(conversation);
    if (!windowOpen && !input.template) throw Object.assign(new Error("The 24-hour WhatsApp window is closed. Send an approved template first."), { status: 409 });
    const messageContext = { caseId, partyId: context.party.id, clientId: context.client.id, contentClassification: "ordinary", caseAssignmentSource: "explicit_outbound" };
    let media: Array<typeof whatsappOutboundMedia.$inferSelect> = [];
    if (input.mediaIds?.length) {
      if (!windowOpen) throw Object.assign(new Error("Standalone files require an open 24-hour WhatsApp window"), { status: 409 });
      if (input.mediaIds.length > 5) throw Object.assign(new Error("Up to 5 files may be sent at once"), { status: 400 });
      media = await db.select().from(whatsappOutboundMedia).where(and(eq(whatsappOutboundMedia.caseId, caseId), eq(whatsappOutboundMedia.partyId, input.partyId), inArray(whatsappOutboundMedia.id, input.mediaIds)));
      if (media.length !== input.mediaIds.length || media.some((file) => file.status !== "clean" || !file.metaMediaId)) throw Object.assign(new Error("All attachments must finish file validation before sending"), { status: 409 });
    }
    const queued: unknown[] = [];
    if (input.template) {
      const [template] = await db.select().from(whatsappTemplateCatalog).where(and(eq(whatsappTemplateCatalog.name, input.template.name), eq(whatsappTemplateCatalog.language, input.template.language), eq(whatsappTemplateCatalog.status, "APPROVED"))).limit(1);
      if (!template) throw Object.assign(new Error("Approved WhatsApp template not found"), { status: 400 });
      const requiredKeys = (template.parameterDefinitions as Array<{ key?: string }>).map((item) => String(item.key || "")).filter(Boolean);
      if (requiredKeys.some((key) => !input.template?.parameters?.[key]?.trim())) throw Object.assign(new Error("All template variables are required"), { status: 400 });
      let headerMetaMediaId: string | undefined;
      if (input.template.headerMediaId) {
        const [header] = await db.select().from(whatsappOutboundMedia).where(and(eq(whatsappOutboundMedia.id, input.template.headerMediaId), eq(whatsappOutboundMedia.caseId, caseId), eq(whatsappOutboundMedia.partyId, input.partyId))).limit(1);
        if (!template.headerMediaType || !header || header.status !== "clean" || !header.metaMediaId) throw Object.assign(new Error("A clean compatible template header attachment is required"), { status: 409 });
        const compatible = template.headerMediaType === "image" ? header.mimeType.startsWith("image/") : template.headerMediaType === "document" ? !header.mimeType.startsWith("image/") : false;
        if (!compatible) throw Object.assign(new Error("The attachment type does not match the template header"), { status: 400 });
        headerMetaMediaId = header.metaMediaId;
      } else if (template.headerMediaType) throw Object.assign(new Error("This template requires a header attachment"), { status: 400 });
      queued.push(await whatsappOutboxService.enqueueParameterizedTemplate(conversation.id, phone, { templateName: template.name, languageCode: template.language, parameters: input.template.parameters, headerMediaId: headerMetaMediaId, headerMediaType: template.headerMediaType === "image" ? "image" : "document" }, actor.id, messageContext));
    } else if (input.body?.trim()) queued.push(await whatsappOutboxService.enqueueText(conversation.id, phone, input.body.trim(), actor.id, messageContext));
    if (media.length) {
      for (const file of media) queued.push(await whatsappOutboxService.enqueueMedia(conversation.id, phone, { mediaId: file.metaMediaId!, mimeType: file.mimeType, fileName: file.fileName }, actor.id, messageContext));
    }
    if (!queued.length) throw Object.assign(new Error("Message text, template, or attachment is required"), { status: 400 });
    await db.update(whatsappContacts).set({ clientId: context.client.id, updatedAt: new Date() }).where(eq(whatsappContacts.id, contact.id));
    return { queued };
  }

  async validateTemplateSendToParty(caseId: string, partyId: string, templateName: string, parameters?: Record<string, string>, options: { requireParameterValues?: boolean } = {}) {
    const context = await this.partyContext(caseId, partyId);
    if (!context || context.party.caseId !== caseId) throw Object.assign(new Error("Recipient not found"), { status: 404 });
    if (context.caseRecord.noWhatsappOrVoicemail) throw Object.assign(new Error("WhatsApp is disabled for this case"), { status: 409 });
    if (context.preference?.status !== "opted_in") throw Object.assign(new Error("Recorded WhatsApp opt-in is required"), { status: 409 });
    const phone = normalizeWhatsappPhone(context.client.phone || "");
    if (!phone) throw Object.assign(new Error("Recipient has no valid mobile number"), { status: 400 });
    const [template] = await db.select().from(whatsappTemplateCatalog).where(and(eq(whatsappTemplateCatalog.name, templateName), eq(whatsappTemplateCatalog.language, BOOKING_WHATSAPP_TEMPLATE_LANGUAGE), eq(whatsappTemplateCatalog.status, "APPROVED"))).limit(1);
    if (!template) throw Object.assign(new Error("Approved WhatsApp template not found"), { status: 400 });
    if (options.requireParameterValues !== false) {
      const requiredKeys = (template.parameterDefinitions as Array<{ key?: string }>).map((item) => String(item.key || "")).filter(Boolean);
      if (requiredKeys.some((key) => !parameters?.[key]?.trim())) throw Object.assign(new Error("All template variables are required"), { status: 400 });
      if (template.headerMediaType) throw Object.assign(new Error("This template requires a header attachment"), { status: 400 });
    }
    return { context, template, phone };
  }

  async sendTemplateToParty(caseId: string, partyId: string, templateName: string, parameters: Record<string, string>, actor: User) {
    return this.send(caseId, {
      partyId,
      template: {
        name: templateName,
        language: BOOKING_WHATSAPP_TEMPLATE_LANGUAGE,
        parameters,
      },
    }, actor);
  }

  async sendMiamBookingTemplate(caseId: string, partyId: string, actor: User, options: { previewOnly?: boolean } = {}) {
    const { context } = await this.validateTemplateSendToParty(caseId, partyId, MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME, undefined, { requireParameterValues: false });
    const booking = await bookingService.createOrReuseBookingTokenForAcknowledgement(partyId);
    if (!booking.ok) throw Object.assign(new Error(booking.error), { status: booking.status });
    const parameters = {
      client_first_name: context.client.firstName || context.client.lastName || "there",
      booking_link: booking.fullBookingUrl,
    };
    await this.validateTemplateSendToParty(caseId, partyId, MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME, parameters);
    if (options.previewOnly) {
      return { queued: [], bookingLink: booking.fullBookingUrl, templateName: MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME, language: BOOKING_WHATSAPP_TEMPLATE_LANGUAGE, parameters };
    }
    const result = await this.sendTemplateToParty(caseId, partyId, MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME, parameters, actor);
    await logAudit({
      userId: actor.id,
      action: "send_miam_booking_whatsapp_template",
      entity: "party",
      entityId: partyId,
      entityRef: caseId,
      details: JSON.stringify({ templateName: MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME, bookingLink: true }),
    });
    return { ...result, bookingLink: booking.fullBookingUrl, templateName: MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME, language: BOOKING_WHATSAPP_TEMPLATE_LANGUAGE, parameters };
  }
}

export const caseWhatsappService = new CaseWhatsappService();
