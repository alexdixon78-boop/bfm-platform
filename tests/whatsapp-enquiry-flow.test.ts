import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("WhatsApp new enquiry Flow form", () => {
  it("ships a static Flow definition compatible with the enquiry webhook", () => {
    const flow = JSON.parse(read("docs/integrations/whatsapp-new-enquiry-flow.json")) as {
      version: string;
      data_api_version?: string;
      routing_model?: unknown;
      screens: Array<{
        id: string;
        terminal?: boolean;
        layout: {
          children: Array<{
            type: string;
            children?: Array<{
              type: string;
              name?: string;
              required?: boolean;
              "on-click-action"?: {
                name: string;
                payload: Record<string, string>;
              };
            }>;
          }>;
        };
      }>;
    };

    assert.equal(flow.version, "7.3");
    assert.equal(flow.data_api_version, undefined);
    assert.equal(flow.routing_model, undefined);

    const screen = flow.screens[0];
    assert.equal(screen.id, "ENQUIRY_FORM");
    assert.equal(screen.terminal, true);

    const form = screen.layout.children.find((component) => component.type === "Form");
    assert.ok(form?.children);
    const address = form.children.find((component) => component.name === "addressLine1");
    assert.equal(address?.type, "TextInput");
    assert.equal(address?.required, true);
    assert.equal(address?.["input-type"], "text");

    const footer = form.children.find((component) => component.type === "Footer");
    assert.equal(footer?.["on-click-action"]?.name, "complete");
    assert.equal(
      footer?.["on-click-action"]?.payload.addressLine1,
      "${form.addressLine1}",
    );
    assert.equal(
      footer?.["on-click-action"]?.payload.privacyConsent,
      "${form.privacyConsent}",
    );
  });

  it("supports sending a published WhatsApp Flow for the enquiry form", () => {
    const meta = read("server/services/whatsapp-meta.service.ts");
    const outbox = read("server/services/whatsapp-outbox.service.ts");
    const envExample = read(".env.example");

    assert.match(meta, /sendFlow/);
    assert.match(meta, /type: "flow"/);
    assert.match(meta, /flow_message_version/);
    assert.match(meta, /flow_id/);
    assert.match(meta, /flow_token/);
    assert.match(outbox, /kind: "flow"/);
    assert.match(outbox, /enqueueFlow/);
    assert.match(envExample, /META_WHATSAPP_ENQUIRY_FLOW_ID=/);
    assert.match(envExample, /META_WHATSAPP_ENQUIRY_FLOW_SCREEN=ENQUIRY_FORM/);
  });

  it("routes raise_new_enquiry to the WhatsApp Flow instead of a text prompt", () => {
    const automation = read("server/services/whatsapp-automation.service.ts");

    assert.match(automation, /sendNewEnquiryFlow/);
    assert.match(automation, /META_WHATSAPP_ENQUIRY_FLOW_ID/);
    assert.match(automation, /enqueueFlow/);
    assert.doesNotMatch(automation, /Please send your name, email, postcode/);
    assert.match(automation, /Please complete this secure form so we can create your enquiry/);
  });

  it("parses Flow nfm_reply responses and creates enquiries with required privacy consent", () => {
    const webhook = read("server/services/whatsapp-webhook.service.ts");
    const enquiry = read("server/services/whatsapp-enquiry.service.ts");

    assert.match(webhook, /nfm_reply/);
    assert.match(webhook, /response_json/);
    assert.match(webhook, /parseFlowResponse/);
    assert.match(webhook, /createFromFlowSubmission/);
    assert.match(enquiry, /privacyConsent !== true/);
    assert.match(enquiry, /Privacy consent is required/);
    assert.match(enquiry, /contactMethod: "WhatsApp message"/);
    assert.match(enquiry, /addressLine1/);
    assert.match(enquiry, /metaMessageId/);
    assert.match(enquiry, /enquiry_created/);
  });

  it("preserves the submitted lead source while tagging WhatsApp as the origin channel", () => {
    const enquiry = read("server/services/whatsapp-enquiry.service.ts");

    assert.match(enquiry, /contactMethod: "WhatsApp message"/);
    assert.match(enquiry, /leadSource: String\(body\.leadSource \|\| "Other \(please specify\)"\)/);
    assert.match(enquiry, /leadSourceOther: body\.leadSourceOther \? String\(body\.leadSourceOther\) : undefined/);
    assert.doesNotMatch(enquiry, /leadSourceOther: body\.leadSourceOther \? String\(body\.leadSourceOther\) : "WhatsApp"/);
    assert.match(enquiry, /metadata: JSON\.stringify\(\{ source: "whatsapp", conversationId/);
  });

  it("sends success and correction replies for Flow submissions", () => {
    const webhook = read("server/services/whatsapp-webhook.service.ts");

    assert.match(webhook, /Your enquiry has been received/);
    assert.match(webhook, /We could not create your enquiry/);
    assert.match(webhook, /Please reopen the form and tick the privacy consent checkbox/);
  });

  it("uses fast WhatsApp enquiry creation before the success reply is queued", () => {
    const webhook = read("server/services/whatsapp-webhook.service.ts");
    const enquiry = read("server/services/whatsapp-enquiry.service.ts");
    const service = read("server/services/enquiry.service.ts");

    assert.match(enquiry, /enquiryService\.create\(payload, \{ deferPostCreateSideEffects: true \}\)/);
    assert.match(service, /deferPostCreateSideEffects\?: boolean/);
    assert.match(service, /runPostCreateSideEffects\(updatedEnquiry \|\| enquiry, newCase\.id\)\.catch/);

    const createIndex = webhook.indexOf("createFromFlowSubmission");
    const successIndex = webhook.indexOf("Your enquiry has been received");
    assert.ok(createIndex > -1 && successIndex > createIndex, "success reply is queued after fast create returns a reference");
  });
});
