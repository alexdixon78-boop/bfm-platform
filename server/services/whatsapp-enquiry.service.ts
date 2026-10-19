import { enquiryService } from "./enquiry.service";
import { whatsappConversationService } from "./whatsapp-conversation.service";

class WhatsappEnquiryService {
  async createFromFlowSubmission(conversationId: string, body: Record<string, unknown>, metaMessageId?: string | null) {
    const privacyConsent = body.privacyConsent === true || body.privacyConsent === "true";
    if (privacyConsent !== true) {
      return { ok: false as const, status: 400, error: "Privacy consent is required" };
    }
    return this.createFromWhatsapp(conversationId, {
      ...body,
      privacyConsent,
      consentFollowUp: body.consentFollowUp ?? privacyConsent,
      metaMessageId: metaMessageId || null,
    });
  }

  async createFromWhatsapp(conversationId: string, body: Record<string, unknown>) {
    const payload = {
      firstName: String(body.firstName || "").trim(),
      middleName: body.middleName ? String(body.middleName).trim() : null,
      lastName: String(body.lastName || "").trim(),
      email: String(body.email || "").trim(),
      mobileTelephone: String(body.mobileTelephone || body.phone || "").trim(),
      phoneCode: String(body.phoneCode || "+44"),
      contactMethod: "WhatsApp message",
      issueType: String(body.issueType || "Other (please give details below)"),
      issueTypeOther: body.issueTypeOther ? String(body.issueTypeOther) : undefined,
      referralType: String(body.referralType || "Self-referral"),
      addressLine1: String(body.addressLine1 || body.address || "").trim(),
      addressLine2: body.addressLine2 ? String(body.addressLine2).trim() : undefined,
      postcode: String(body.postcode || "").trim(),
      leadSource: String(body.leadSource || "Other (please specify)"),
      leadSourceOther: body.leadSourceOther ? String(body.leadSourceOther) : undefined,
      privacyConsent: Boolean(body.privacyConsent),
      consentFollowUp: Boolean(body.consentFollowUp ?? body.privacyConsent),
      consentAnonymisedData: Boolean(body.consentAnonymisedData),
      notes: body.notes ? String(body.notes) : "Created from WhatsApp conversation.",
      metadata: JSON.stringify({ source: "whatsapp", conversationId, metaMessageId: body.metaMessageId || null }),
    };

    const result = await enquiryService.create(payload, { deferPostCreateSideEffects: true });
    if (result.ok) {
      await whatsappConversationService.updateState(conversationId, {
        flowType: "new_enquiry",
        automationState: "enquiry_created",
        enquiryId: result.enquiry.id,
        caseId: result.newCase.id,
      });
    }
    return result;
  }
}

export const whatsappEnquiryService = new WhatsappEnquiryService();
