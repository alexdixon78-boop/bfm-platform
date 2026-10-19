import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { selectInboundCaseContext } from "../server/services/whatsapp-inbound-context";

const root = process.cwd();
const read = (file: string) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : "";

describe("case-scoped WhatsApp messaging", () => {
  it("keeps multi-case inbound messages unassigned while retaining the matched client", () => {
    const selected = selectInboundCaseContext({
      clientId: "client-1",
      activeParties: [
        { caseId: "case-older", partyId: "party-a", noWhatsapp: false },
        { caseId: "case-newer", partyId: "party-b", noWhatsapp: false },
      ],
      recentCaseIds: [],
    });

    assert.deepEqual(selected, {
      clientId: "client-1",
      caseId: null,
      partyId: null,
      shouldRecordOptIn: false,
      caseAssignmentSource: "multiple_active_cases_unassigned",
    });
  });

  it("uses only single active or recent conversation context for inbound case assignment", () => {
    assert.deepEqual(selectInboundCaseContext({
      clientId: "client-1",
      activeParties: [{ caseId: "case-only", partyId: "party-a", noWhatsapp: false }],
      recentCaseIds: [],
    }), {
      clientId: "client-1",
      caseId: "case-only",
      partyId: "party-a",
      shouldRecordOptIn: true,
      caseAssignmentSource: "single_active_case",
    });

    assert.deepEqual(selectInboundCaseContext({
      clientId: "client-1",
      activeParties: [
        { caseId: "case-a", partyId: "party-a", noWhatsapp: false },
        { caseId: "case-b", partyId: "party-b", noWhatsapp: false },
      ],
      recentCaseIds: ["case-b"],
    }), {
      clientId: "client-1",
      caseId: "case-b",
      partyId: "party-b",
      shouldRecordOptIn: true,
      caseAssignmentSource: "recent_context",
    });

    assert.deepEqual(selectInboundCaseContext({
      clientId: "client-1",
      activeParties: [
        { caseId: "case-a", partyId: "party-a", noWhatsapp: false },
        { caseId: "case-b", partyId: "party-b", noWhatsapp: false },
      ],
      recentCaseIds: ["case-a", "case-b"],
    }), {
      clientId: "client-1",
      caseId: null,
      partyId: null,
      shouldRecordOptIn: false,
      caseAssignmentSource: "multiple_active_cases_unassigned",
    });
  });

  it("provides case recipients, messages, preferences, uploads, and sends", () => {
    const routes = read("server/routes/case-whatsapp.routes.ts");
    for (const route of ["/recipients", "/messages", "/preferences/:partyId", "/uploads"]) assert.match(routes, new RegExp(route.replaceAll("/", "\\/")));
    assert.match(routes, /requireCaseWhatsappWorkspace/);
  });

  it("enforces opt-in, safety flag, case membership, and Meta window rules", () => {
    const service = read("server/services/case-whatsapp.service.ts");
    assert.match(service, /noWhatsappOrVoicemail/);
    assert.match(service, /opted_in/);
    assert.match(service, /isWindowOpen/);
    assert.match(service, /The 24-hour WhatsApp window is closed/);
    assert.match(service, /party\.caseId/);
  });

  it("records case context on each message and sanitizes private content", () => {
    const conversations = read("server/services/whatsapp-conversation.service.ts");
    const ledger = read("server/services/case-communication-log.service.ts");
    assert.match(conversations, /contentClassification/);
    assert.match(conversations, /caseAssignmentSource/);
    assert.match(ledger, /message\.caseId/);
    assert.match(ledger, /contentClassification !== "ordinary"/);
  });

  it("syncs approved templates and supports configurable Graph API media", () => {
    const meta = read("server/services/whatsapp-meta.service.ts");
    const templates = read("server/services/whatsapp-template.service.ts");
    assert.match(meta, /META_WHATSAPP_GRAPH_VERSION/);
    assert.match(meta, /uploadMedia/);
    assert.match(meta, /sendMedia/);
    assert.match(meta, /sendParameterizedTemplate/);
    assert.match(templates, /status === "APPROVED"/);
    assert.match(templates, /whatsappTemplateCatalog/);
  });

  it("processes Meta delivery status webhooks idempotently", () => {
    const webhook = read("server/services/whatsapp-webhook.service.ts");
    assert.match(webhook, /value\.statuses/);
    assert.match(webhook, /updateMessageStatus/);
    assert.match(webhook, /providerMessageId/);
  });

  it("surfaces upload failures and lets the sender remove unusable attachments", () => {
    const panel = read("client/src/components/cases/case-whatsapp-panel.tsx");
    assert.match(panel, /Failed to upload attachment/);
    assert.match(panel, /uploadStatuses\.isError/);
    assert.match(panel, /setMediaIds\(\(current\) => current\.filter/);
    assert.match(panel, /Remove attachment/);
  });

  it("uses the shared production WhatsApp chat workspace and template catalogue metadata", () => {
    const panel = read("client/src/components/cases/case-whatsapp-panel.tsx");
    const workspace = read("client/src/components/whatsapp/whatsapp-chat-workspace.tsx");
    const routes = read("server/routes/whatsapp.routes.ts");
    const service = read("server/services/whatsapp-template.service.ts");

    assert.match(panel, /WhatsappChatWorkspace/);
    assert.match(workspace, /Meta only allows approved templates outside the 24-hour window/);
    assert.match(workspace, /Sync templates/);
    assert.match(workspace, /templateSyncStatus/);
    assert.match(workspace, /data-testid="whatsapp-chat-workspace"/);
    assert.doesNotMatch(workspace, /selectedMode === "template" && templateId === "none"[\s\S]*setSelectedMode\("text"\)/);
    assert.match(routes, /\/api\/whatsapp\/templates\/status/);
    assert.match(service, /getApprovedStatus/);
  });

  it("renders approved template preview from Meta components before send", () => {
    const workspace = read("client/src/components/whatsapp/whatsapp-chat-workspace.tsx");

    assert.match(workspace, /components: Array<Record<string, unknown>>/);
    assert.match(workspace, /renderTemplatePreviewText/);
    assert.match(workspace, /renderTemplateComponentPreview/);
    assert.match(workspace, /data-testid="whatsapp-template-preview"/);
    assert.match(workspace, /Template preview/);
    assert.match(workspace, /Missing value/);
    assert.match(workspace, /replace\(/);
  });

  it("supports case booking WhatsApp template shortcuts with approved named templates", () => {
    const routes = read("server/routes/case-whatsapp.routes.ts");
    const service = read("server/services/case-whatsapp.service.ts");
    const caseDetail = read("client/src/pages/case-detail.tsx");

    assert.match(routes, /\/api\/cases\/:caseId\/whatsapp\/miam-booking-template/);
    assert.match(routes, /sendMiamBookingTemplate/);
    assert.match(service, /MIAM_BOOKING_WHATSAPP_TEMPLATE_NAME\s*=\s*"bfm_miam_booking"/);
    assert.match(service, /MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME\s*=\s*"bfm_mediation_session_booking"/);
    assert.match(service, /sendMiamBookingTemplate/);
    assert.match(service, /validateTemplateSendToParty/);
    assert.match(service, /requireParameterValues: false/);
    assert.match(service, /createOrReuseBookingTokenForAcknowledgement/);
    assert.match(service, /booking_link/);
    assert.match(service, /client_first_name/);
    assert.match(caseDetail, /CaseWhatsappTemplateDialog/);
    assert.match(caseDetail, /Send MIAM WhatsApp/);
    assert.match(caseDetail, /testId="button-send-miam-whatsapp"/);
  });

  it("supports mediation session WhatsApp template links per client recipient", () => {
    const routes = read("server/routes/mediation-session.routes.ts");
    const service = read("server/services/mediation-session.service.ts");
    const caseDetail = read("client/src/pages/case-detail.tsx");

    assert.match(routes, /\/api\/mediation-session-proposal-recipients\/:id\/whatsapp-template/);
    assert.match(routes, /sendProposalRecipientWhatsappTemplate/);
    assert.match(service, /sendProposalRecipientWhatsappTemplate/);
    assert.match(service, /MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME/);
    assert.match(service, /recipient\.recipientType !== "client"/);
    assert.match(service, /previewProposalRecipientWhatsappLink/);
    const previewBranch = service.indexOf("if (options.previewOnly)");
    const previewHelperCall = service.indexOf("this.previewProposalRecipientWhatsappLink", previewBranch);
    const sendRotationCall = service.indexOf("this.rotateProposalRecipientWhatsappLink", previewBranch);
    assert.ok(previewBranch > -1 && previewHelperCall > previewBranch, "preview branch should use the side-effect-free link helper");
    assert.ok(sendRotationCall > previewHelperCall, "recipient token rotation should happen after the preview branch returns");
    assert.match(service, /extractSessionAvailabilityToken/);
    assert.match(service, /sessionAvailabilityUrl\(token\)/);
    assert.match(service, /response_link/);
    assert.match(service, /session_label/);
    assert.match(caseDetail, /testId="button-send-session-whatsapp-link"/);
    assert.match(caseDetail, /recipient\.recipientType === "client"/);
  });
});
