import { whatsappConversationService } from "./whatsapp-conversation.service";
import { whatsappNotificationService } from "./whatsapp-notification.service";
import { whatsappOutboxService } from "./whatsapp-outbox.service";
import { logger } from "../logger";
import { whatsappPrivateNoteService } from "./whatsapp-private-note.service";
import { shouldRestartWhatsappVerification } from "../utils/whatsapp-automation-intent";

const START_MENU_BODY = "Hello 👋\nWelcome to Brighter Future Mediation.\nHow can we help you today?";
const START_MENU_BUTTONS = [
  { id: "raise_new_enquiry", title: "Raise New Enquiry" },
  { id: "existing_case", title: "Existing Case" },
  { id: "chat_with_team", title: "Chat With Team" },
];
const NEW_ENQUIRY_FLOW_BODY = "Please complete this secure form so we can create your enquiry.";

function includesAny(value: string, terms: string[]) {
  const lowered = value.toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

function shortId(value: string | null | undefined): string | null {
  return value ? value.slice(0, 12) : null;
}

class WhatsappAutomationService {
  async handleInbound(conversationId: string, inboundText: string, inboundActionId?: string | null, inbound?: { messageId?: string | null; attachmentId?: string | null }) {
    const detail = await whatsappConversationService.getConversationDetail(conversationId);
    if (!detail) return;

    const phoneNumber = detail.contact?.phoneNumber || "";
    const displayName = detail.contact?.displayName || "WhatsApp client";
    const text = inboundText.trim();
    const intent = inboundActionId || text.toLowerCase();
    logger.info("Automation state", {
      conversationId: shortId(conversationId),
      flowType: detail.flowType,
      automationState: detail.automationState,
      interactive: Boolean(inboundActionId),
    }, "whatsapp");
    if (detail.automationPaused) {
      logger.info("Manual pause detected", {
        conversationId: shortId(conversationId),
        action: "notify_staff",
      }, "whatsapp");
      await whatsappNotificationService.notifyStaffInbound(conversationId, `Manual WhatsApp reply needed from ${displayName}.`, detail.caseId);
      return;
    }

    if (shouldRestartWhatsappVerification(detail.automationState, text)) {
      logger.info("Verification flow restart requested", {
        conversationId: shortId(conversationId),
        previousState: detail.automationState,
        action: "cancel_verification_and_send_start_menu",
      }, "whatsapp");
      await whatsappPrivateNoteService.cancel(conversationId);
      await this.sendStartMenu(conversationId, phoneNumber);
      return;
    }

    if (intent === "chat_with_team" || includesAny(intent, ["chat with team", "chat directly", "admin", "superadmin", "team"])) {
      logger.info("Chat with team requested", {
        conversationId: shortId(conversationId),
        action: "pause_automation_and_notify_staff",
      }, "whatsapp");
      await whatsappConversationService.updateState(conversationId, {
        flowType: "manual",
        automationState: "manual_chat_requested",
        automationPaused: true,
      });
      await whatsappNotificationService.notifyStaffInbound(conversationId, `WhatsApp chat request from ${displayName}.`, detail.caseId);
      await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "A team member will reply here shortly.");
      return;
    }

    if (detail.automationState === "awaiting_otp") {
      const result = await whatsappPrivateNoteService.verifyOtp(conversationId, text, inbound?.messageId);
      if (result.ok) {
        logger.info("OTP verified", {
          conversationId: shortId(conversationId),
          caseId: shortId(result.caseId),
          action: "prompt_for_case_note",
        }, "whatsapp");
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "Verified. Send your note text, an attachment, or both. When ready, choose Finish note.", undefined, { caseId: result.caseId, contentClassification: "verification", caseAssignmentSource: "private_note_session" });
      } else {
        logger.warn("OTP failed", {
          conversationId: shortId(conversationId),
          status: result.status,
          action: "send_failure_message",
        }, "whatsapp");
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, result.error, undefined, { contentClassification: "verification", caseAssignmentSource: "private_note_session" });
      }
      return;
    }

    if (detail.automationState === "awaiting_case_reference") {
      const result = await whatsappPrivateNoteService.setCaseReference(conversationId, text, inbound?.messageId);
      await whatsappOutboxService.enqueueText(conversationId, phoneNumber, result.ok ? "Now send the registered or account email address." : result.error, undefined, { contentClassification: "verification", caseAssignmentSource: "private_note_session" });
      return;
    }

    if (detail.automationState === "awaiting_identity_email") {
      const result = await whatsappPrivateNoteService.submitIdentity(conversationId, text, inbound?.messageId);
      logger.info("Existing case OTP flow started", {
        conversationId: shortId(conversationId),
        matched: result.ok,
      }, "whatsapp");
      await whatsappOutboxService.enqueueText(
        conversationId,
        phoneNumber,
        result.ok
          ? "We have sent a 6-digit OTP to the matched email. Please reply here with the code."
          : result.error,
        undefined,
        { ...(result.ok ? { caseId: result.caseId } : {}), contentClassification: "verification", caseAssignmentSource: "private_note_session" },
      );
      return;
    }

    if (detail.automationState === "awaiting_private_note_content") {
      if (intent === "add_private_attachment") {
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "Send the image, PDF, Word document, or text file you want to attach.", undefined, { contentClassification: "private_note_draft", caseAssignmentSource: "private_note_session" });
        return;
      }
      if (intent === "cancel_private_note") {
        await whatsappPrivateNoteService.cancel(conversationId);
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "Your private note draft was cancelled.", undefined, { contentClassification: "private_note_receipt", caseAssignmentSource: "private_note_session" });
        return;
      }
      if (intent === "finish_private_note") {
        const result = await whatsappPrivateNoteService.complete(conversationId);
        if (result.ok) logger.info("Case note logged", { conversationId: shortId(conversationId), caseId: shortId(result.caseId), noteId: shortId(result.noteId) }, "whatsapp");
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, result.ok ? "Thank you. Your private note has been added to the case." : result.error, undefined, { ...(result.ok ? { caseId: result.caseId } : {}), contentClassification: "private_note_receipt", caseAssignmentSource: "private_note_session" });
        return;
      }
      let result: { ok: boolean; error?: string } = { ok: false, error: "Send note text or an attachment." };
      if (inbound?.attachmentId && inbound.messageId) result = await whatsappPrivateNoteService.attachInboundMedia(conversationId, inbound.attachmentId, inbound.messageId);
      if (text && !inboundActionId) result = await whatsappPrivateNoteService.appendText(conversationId, text, inbound?.messageId);
      if (!result.ok) {
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, result.error || "We could not add that content.");
        return;
      }
      await whatsappOutboxService.enqueueInteractiveButtons(conversationId, phoneNumber, "Content added. You can add another attachment, finish, or cancel.", [
        { id: "add_private_attachment", title: "Add attachment" },
        { id: "finish_private_note", title: "Finish note" },
        { id: "cancel_private_note", title: "Cancel" },
      ], undefined, { contentClassification: "private_note_draft", caseAssignmentSource: "private_note_session" });
      return;
    }

    if (intent === "existing_case" || includesAny(intent, ["existing", "case", "reference", "ref"])) {
      logger.info("Existing case flow started", {
        conversationId: shortId(conversationId),
        action: "ask_case_ref_email",
      }, "whatsapp");
      const phoneMatched = await whatsappPrivateNoteService.startPhoneMatchedSession(conversationId, phoneNumber);
      if (phoneMatched.ok && phoneMatched.mode === "verified") {
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "You are verified for your active case. Send your note text, an attachment, or both. When ready, choose Finish note.", undefined, { caseId: phoneMatched.caseId, contentClassification: "verification", caseAssignmentSource: "private_note_session" });
        return;
      }
      if (phoneMatched.ok && phoneMatched.mode === "identity_required") {
        await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "We found your active case from your WhatsApp number. Please send the registered or account email address.", undefined, { caseId: phoneMatched.caseId, contentClassification: "verification", caseAssignmentSource: "private_note_session" });
        return;
      }
      await whatsappPrivateNoteService.startSession(conversationId);
      await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "Please send your case reference number.", undefined, { contentClassification: "verification", caseAssignmentSource: "private_note_session" });
      return;
    }

    if (intent === "raise_new_enquiry" || includesAny(intent, ["new enquiry", "raise", "enquiry", "new case"])) {
      logger.info("New enquiry handoff started", {
        conversationId: shortId(conversationId),
        action: "send_whatsapp_flow",
      }, "whatsapp");
      await this.sendNewEnquiryFlow(conversationId, phoneNumber, displayName);
      return;
    }

    logger.info("Start menu sent", {
      conversationId: shortId(conversationId),
      action: "send_start_menu",
    }, "whatsapp");
    await this.sendStartMenu(conversationId, phoneNumber);
  }

  private async sendStartMenu(conversationId: string, phoneNumber: string) {
    await whatsappConversationService.updateState(conversationId, {
      flowType: "start",
      automationState: "awaiting_menu",
    });
    await whatsappOutboxService.enqueueInteractiveButtons(conversationId, phoneNumber, START_MENU_BODY, START_MENU_BUTTONS);
  }

  private async sendNewEnquiryFlow(conversationId: string, phoneNumber: string, displayName: string) {
    const flowId = process.env.META_WHATSAPP_ENQUIRY_FLOW_ID;
    const screen = process.env.META_WHATSAPP_ENQUIRY_FLOW_SCREEN || "ENQUIRY_FORM";
    await whatsappConversationService.updateState(conversationId, {
      flowType: "new_enquiry",
      automationState: "awaiting_enquiry_flow",
    });

    if (!flowId) {
      logger.warn("WhatsApp enquiry Flow ID is not configured", {
        conversationId: shortId(conversationId),
        action: "fallback_staff_follow_up",
      }, "whatsapp");
      await whatsappNotificationService.notifyStaffInbound(conversationId, `New WhatsApp enquiry form requested by ${displayName}, but the Meta Flow ID is not configured.`);
      await whatsappOutboxService.enqueueText(conversationId, phoneNumber, "Our secure enquiry form is not available right now. Our team will follow up with you shortly.");
      return;
    }

    await whatsappOutboxService.enqueueFlow(conversationId, phoneNumber, {
      flowId,
      flowToken: conversationId,
      body: NEW_ENQUIRY_FLOW_BODY,
      cta: "Add enquiry",
      screen,
      data: {
        conversationId,
        gdprConsentText: "I consent to Brighter Future Mediation storing my information, contacting me about my enquiry, and processing my personal data as described in the Privacy Policy.",
      },
    });
  }
}

export const whatsappAutomationService = new WhatsappAutomationService();
