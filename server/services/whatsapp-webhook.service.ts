import { whatsappAttachmentService } from "./whatsapp-attachment.service";
import { whatsappAutomationService } from "./whatsapp-automation.service";
import { whatsappConversationService } from "./whatsapp-conversation.service";
import { whatsappEnquiryService } from "./whatsapp-enquiry.service";
import { whatsappNotificationService } from "./whatsapp-notification.service";
import { whatsappOutboxService } from "./whatsapp-outbox.service";
import { logger } from "../logger";

type MetaInboundMessage = {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
    nfm_reply?: { name?: string; body?: string; response_json?: string };
  };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
};

function extractText(message: MetaInboundMessage): string {
  if (message.text?.body) return message.text.body;
  if (message.interactive?.nfm_reply?.body) return message.interactive.nfm_reply.body;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.document?.caption) return message.document.caption;
  if (message.image?.caption) return message.image.caption;
  if (message.video?.caption) return message.video.caption;
  return "";
}

function parseFlowResponse(message: MetaInboundMessage): { flowToken?: string | null; data: Record<string, unknown> } | null {
  if (message.type !== "interactive" || message.interactive?.type !== "nfm_reply") return null;
  const responseJson = message.interactive.nfm_reply?.response_json;
  if (!responseJson) return null;
  try {
    const parsed = JSON.parse(responseJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const data = parsed as Record<string, unknown>;
    return {
      flowToken: typeof data.flow_token === "string" ? data.flow_token : null,
      data,
    };
  } catch {
    return null;
  }
}

function extractInteractiveReplyId(message: MetaInboundMessage): string | null {
  return message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null;
}

function shortId(value: string | null | undefined): string | null {
  return value ? value.slice(0, 12) : null;
}

function getMedia(message: MetaInboundMessage) {
  const media = message.image || message.document || message.audio || message.video;
  if (!media?.id) return null;
  const fileName = "filename" in media && typeof media.filename === "string" ? media.filename : null;
  return {
    metaMediaId: media.id,
    mimeType: media.mime_type || null,
    fileName,
  };
}

class WhatsappWebhookService {
  async processInboundWebhook(payload: Record<string, unknown>) {
    const processed: Array<{ messageId: string | null; conversationId: string; duplicate: boolean }> = [];
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries as Array<Record<string, unknown>>) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes as Array<Record<string, unknown>>) {
        const value = (change.value || {}) as Record<string, unknown>;
        for (const statusEvent of (Array.isArray(value.statuses) ? value.statuses : []) as Array<Record<string, unknown>>) {
          const providerMessageId = typeof statusEvent.id === "string" ? statusEvent.id : "";
          const status = typeof statusEvent.status === "string" ? statusEvent.status : "";
          if (!providerMessageId || !status) continue;
          const errors = Array.isArray(statusEvent.errors) ? JSON.stringify(statusEvent.errors) : null;
          await whatsappConversationService.updateMessageStatus(providerMessageId, status, errors);
        }
        const contacts = new Map<string, { displayName?: string | null }>();
        for (const contact of (Array.isArray(value.contacts) ? value.contacts : []) as Array<Record<string, unknown>>) {
          const waId = typeof contact.wa_id === "string" ? contact.wa_id : "";
          const profile = (contact.profile || {}) as Record<string, unknown>;
          if (waId) contacts.set(waId, { displayName: typeof profile.name === "string" ? profile.name : null });
        }

        for (const message of (Array.isArray(value.messages) ? value.messages : []) as MetaInboundMessage[]) {
          if (!message.from) continue;
          const metaContact = contacts.get(message.from);
          const { contact, conversation } = await whatsappConversationService.findOrCreateConversation({
            phoneNumber: message.from,
            displayName: metaContact?.displayName || null,
          });
          const updatedConversation = await whatsappConversationService.touchInbound(conversation.id);
          const text = extractText(message);
          const flowResponse = parseFlowResponse(message);
          const interactiveReplyId = extractInteractiveReplyId(message);
          const inboundContext = await whatsappConversationService.resolveInboundContext(conversation.id, contact.clientId, message.from);
          const recorded = await whatsappConversationService.recordMessage({
            conversationId: conversation.id,
            metaMessageId: message.id || null,
            direction: "inbound",
            type: message.type || "unknown",
            body: text || null,
            rawPayload: message as Record<string, unknown>,
            ...inboundContext,
          });

          processed.push({ messageId: message.id || null, conversationId: conversation.id, duplicate: !recorded });
          logger.info("Inbound message", {
            message: shortId(message.id),
            type: message.type || "unknown",
            interactive: Boolean(interactiveReplyId),
            flowResponse: Boolean(flowResponse),
            conversationId: shortId(conversation.id),
            duplicate: !recorded,
          }, "whatsapp");
          if (!recorded) continue;

          const media = getMedia(message);
          let recordedAttachmentId: string | null = null;
          if (media) {
            const attachment = await whatsappAttachmentService.recordMetadata({
              messageId: recorded.id,
              caseId: updatedConversation.caseId,
              ...media,
            });
            recordedAttachmentId = attachment.id;
            logger.info("Attachment metadata received", {
              message: shortId(message.id),
              conversationId: shortId(conversation.id),
              mediaId: shortId(media.metaMediaId),
              mimeType: media.mimeType,
            }, "whatsapp");
          }

          if (flowResponse) {
            let targetConversationId = conversation.id;
            if (flowResponse.flowToken) {
              const tokenConversation = await whatsappConversationService.getConversation(flowResponse.flowToken);
              if (tokenConversation) targetConversationId = flowResponse.flowToken;
            }
            const result = await whatsappEnquiryService.createFromFlowSubmission(targetConversationId, flowResponse.data, message.id || null);
            if (result.ok) {
              logger.info("Enquiry Flow submitted", {
                conversationId: shortId(targetConversationId),
                enquiryId: shortId(result.enquiry.id),
                caseId: shortId(result.newCase.id),
              }, "whatsapp");
              await whatsappOutboxService.enqueueText(
                targetConversationId,
                message.from,
                `Your enquiry has been received. Your reference number is ${result.enquiry.enquiryRef}. Our team will be in touch with you soon.`,
              );
            } else {
              logger.warn("Enquiry Flow submission rejected", {
                conversationId: shortId(targetConversationId),
                status: result.status,
              }, "whatsapp");
              const correction = result.error === "Privacy consent is required"
                ? "Please reopen the form and tick the privacy consent checkbox so we can create your enquiry."
                : "We could not create your enquiry from that form submission. Please check the required fields and try again.";
              await whatsappOutboxService.enqueueText(targetConversationId, message.from, correction);
            }
            continue;
          }

          await whatsappAutomationService.handleInbound(conversation.id, text, interactiveReplyId, { messageId: recorded.id, attachmentId: recordedAttachmentId });
          if (!text && media) {
            await whatsappNotificationService.notifyStaffInbound(conversation.id, "WhatsApp attachment received.", updatedConversation.caseId);
          }
        }
      }
    }

    return { processed };
  }
}

export const whatsappWebhookService = new WhatsappWebhookService();
