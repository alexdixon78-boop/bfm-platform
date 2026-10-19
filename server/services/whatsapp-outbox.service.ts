import { and, eq, lte } from "drizzle-orm";
import { db } from "../db";
import { whatsappOutbox } from "@shared/schema";
import { whatsappMetaService, type WhatsappFlowParams, type WhatsappReplyButton } from "./whatsapp-meta.service";
import { whatsappConversationService, type WhatsappMessageContext } from "./whatsapp-conversation.service";
import { logger } from "../logger";
import {
  getWhatsappOutboxFailureDecision,
  getWhatsappOutboxLeaseExpiry,
} from "./whatsapp-outbox-rules";

type OutboundPayload =
  | { kind: "text"; to: string; body: string; sentByUserId?: string | null; context?: WhatsappMessageContext }
  | { kind: "template"; to: string; templateName: string; languageCode?: string; parameters?: Record<string, string>; headerMediaId?: string | null; headerMediaType?: "image" | "document"; sentByUserId?: string | null; context?: WhatsappMessageContext }
  | { kind: "media"; to: string; mediaId: string; mimeType: string; fileName?: string | null; caption?: string | null; sentByUserId?: string | null; context?: WhatsappMessageContext }
  | { kind: "interactive_button"; to: string; body: string; buttons: WhatsappReplyButton[]; sentByUserId?: string | null; context?: WhatsappMessageContext }
  | { kind: "flow"; to: string; flow: WhatsappFlowParams; sentByUserId?: string | null; context?: WhatsappMessageContext };

class WhatsappOutboxService {
  async enqueueText(conversationId: string, to: string, body: string, sentByUserId?: string | null, context?: WhatsappMessageContext) {
    return this.enqueue(conversationId, { kind: "text", to, body, sentByUserId, context });
  }

  async enqueueParameterizedTemplate(conversationId: string, to: string, input: { templateName: string; languageCode: string; parameters?: Record<string, string>; headerMediaId?: string | null; headerMediaType?: "image" | "document" }, sentByUserId?: string | null, context?: WhatsappMessageContext) {
    return this.enqueue(conversationId, { kind: "template", to, ...input, sentByUserId, context });
  }

  async enqueueMedia(conversationId: string, to: string, input: { mediaId: string; mimeType: string; fileName?: string | null; caption?: string | null }, sentByUserId?: string | null, context?: WhatsappMessageContext) {
    return this.enqueue(conversationId, { kind: "media", to, ...input, sentByUserId, context });
  }

  async enqueueTemplate(conversationId: string, to: string, templateName: string, languageCode = "en_GB", sentByUserId?: string | null) {
    return this.enqueue(conversationId, { kind: "template", to, templateName, languageCode, sentByUserId });
  }

  async enqueueInteractiveButtons(conversationId: string, to: string, body: string, buttons: WhatsappReplyButton[], sentByUserId?: string | null, context?: WhatsappMessageContext) {
    return this.enqueue(conversationId, { kind: "interactive_button", to, body, buttons, sentByUserId, context });
  }

  async enqueueFlow(conversationId: string, to: string, flow: WhatsappFlowParams, sentByUserId?: string | null) {
    return this.enqueue(conversationId, { kind: "flow", to, flow, sentByUserId });
  }

  async enqueue(conversationId: string, payload: OutboundPayload) {
    const [row] = await db.insert(whatsappOutbox).values({
      conversationId,
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    }).returning();
    return this.processOne(row.id);
  }

  async processOne(outboxId: string) {
    const now = new Date();
    const [row] = await db.update(whatsappOutbox).set({
      nextAttemptAt: getWhatsappOutboxLeaseExpiry(now),
      updatedAt: now,
    }).where(and(
      eq(whatsappOutbox.id, outboxId),
      eq(whatsappOutbox.status, "pending"),
      lte(whatsappOutbox.nextAttemptAt, now),
    )).returning();
    if (!row) {
      const [current] = await db.select().from(whatsappOutbox).where(eq(whatsappOutbox.id, outboxId)).limit(1);
      return current;
    }

    const payload = row.payload as OutboundPayload;
    logger.info("Outbound send attempted", {
      outboxId: row.id.slice(0, 12),
      conversationId: row.conversationId.slice(0, 12),
      kind: payload.kind,
      attempt: row.retryCount + 1,
    }, "whatsapp");
    const result = payload.kind === "template"
      ? await whatsappMetaService.sendParameterizedTemplate(payload.to, payload.templateName, payload.languageCode, payload.parameters, payload.headerMediaId, payload.headerMediaType)
      : payload.kind === "media"
        ? await whatsappMetaService.sendMedia(payload.to, payload.mediaId, payload.mimeType, payload.fileName, payload.caption)
      : payload.kind === "interactive_button"
        ? await whatsappMetaService.sendInteractiveButtons(payload.to, payload.body, payload.buttons)
        : payload.kind === "flow"
          ? await whatsappMetaService.sendFlow(payload.to, payload.flow)
          : await whatsappMetaService.sendText(payload.to, payload.body);

    if (!result.ok) {
      const decision = getWhatsappOutboxFailureDecision({
        httpStatus: result.status,
        providerCode: result.providerCode,
        retryCount: row.retryCount,
      });
      logger.warn("Outbound send failed", {
        outboxId: row.id.slice(0, 12),
        conversationId: row.conversationId.slice(0, 12),
        httpStatus: result.status,
        providerErrorNumber: result.providerCode,
        retryCount: decision.retryCount,
        terminal: decision.status === "failed",
      }, "whatsapp");
      const [updated] = await db.update(whatsappOutbox).set({
        status: decision.status,
        retryCount: decision.retryCount,
        nextAttemptAt: decision.nextAttemptAt,
        lastError: result.error,
        updatedAt: new Date(),
      }).where(eq(whatsappOutbox.id, row.id)).returning();
      if (decision.status === "failed") {
        await whatsappConversationService.recordMessage({
          conversationId: row.conversationId,
          direction: "outbound",
          type: this.messageType(payload),
          body: this.messageBody(payload),
          templateName: payload.kind === "template" ? payload.templateName : null,
          rawPayload: this.safePayloadMetadata(payload),
          status: "failed",
          errorPayload: result.error,
          sentByUserId: payload.sentByUserId || null,
          ...(payload.context || {}),
        });
      }
      return updated;
    }

    logger.info("Outbound send succeeded", {
      outboxId: row.id.slice(0, 12),
      conversationId: row.conversationId.slice(0, 12),
      message: result.messageId?.slice(0, 12) || null,
    }, "whatsapp");
    const [updated] = await db.update(whatsappOutbox).set({
      status: "sent",
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(whatsappOutbox.id, row.id)).returning();
    await whatsappConversationService.recordMessage({
      conversationId: row.conversationId,
      metaMessageId: result.messageId || null,
      direction: "outbound",
      type: this.messageType(payload),
      body: this.messageBody(payload),
      templateName: payload.kind === "template" ? payload.templateName : null,
      status: "sent",
      rawPayload: payload.kind === "interactive_button"
        ? { meta: result.payload as Record<string, unknown>, buttons: payload.buttons }
        : payload.kind === "flow"
          ? { meta: result.payload as Record<string, unknown>, flow: payload.flow }
          : { meta: result.payload as Record<string, unknown> },
      sentByUserId: payload.sentByUserId || null,
      ...(payload.context || {}),
    });
    await whatsappConversationService.markOutbound(row.conversationId);
    return updated;
  }

  async processDue(limit = 20): Promise<{ processed: number }> {
    const due = await db.select({ id: whatsappOutbox.id })
      .from(whatsappOutbox)
      .where(and(
        eq(whatsappOutbox.status, "pending"),
        lte(whatsappOutbox.nextAttemptAt, new Date()),
      ))
      .orderBy(whatsappOutbox.nextAttemptAt)
      .limit(limit);
    for (const row of due) await this.processOne(row.id);
    return { processed: due.length };
  }

  private messageType(payload: OutboundPayload) {
    return payload.kind === "template"
      ? "template"
      : payload.kind === "media"
        ? payload.mimeType.startsWith("image/") ? "image" : "document"
      : payload.kind === "interactive_button" || payload.kind === "flow"
        ? "interactive"
        : "text";
  }

  private messageBody(payload: OutboundPayload) {
    return payload.kind === "text" || payload.kind === "interactive_button"
      ? payload.body
      : payload.kind === "media"
        ? payload.caption || payload.fileName || null
      : payload.kind === "flow"
        ? payload.flow.body
        : null;
  }

  private safePayloadMetadata(payload: OutboundPayload): Record<string, unknown> {
    if (payload.kind === "interactive_button") return { buttons: payload.buttons };
    if (payload.kind === "flow") return { flowId: payload.flow.flowId };
    return {};
  }
}

export const whatsappOutboxService = new WhatsappOutboxService();
