import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("WhatsApp interactive start menu", () => {
  it("sends the start menu as a 3-button interactive WhatsApp message", () => {
    const meta = read("server/services/whatsapp-meta.service.ts");
    const outbox = read("server/services/whatsapp-outbox.service.ts");
    const automation = read("server/services/whatsapp-automation.service.ts");

    assert.match(meta, /sendInteractiveButtons/);
    assert.match(meta, /type: "interactive"/);
    assert.match(meta, /type: "button"/);
    assert.match(outbox, /interactive_button/);
    assert.match(outbox, /enqueueInteractiveButtons/);
    assert.match(automation, /START_MENU_BUTTONS/);
    assert.match(automation, /raise_new_enquiry/);
    assert.match(automation, /existing_case/);
    assert.match(automation, /chat_with_team/);
    assert.doesNotMatch(automation, /Reply with: Raise a New Enquiry/);
  });

  it("routes interactive reply ids before typed fallback text", () => {
    const webhook = read("server/services/whatsapp-webhook.service.ts");
    const automation = read("server/services/whatsapp-automation.service.ts");

    assert.match(webhook, /extractInteractiveReplyId/);
    assert.match(webhook, /interactiveReplyId/);
    assert.match(automation, /inboundActionId/);
    assert.match(automation, /intent === "raise_new_enquiry"/);
    assert.match(automation, /intent === "existing_case"/);
    assert.match(automation, /intent === "chat_with_team"/);
  });

  it("chat with team pauses automation and notifies staff", () => {
    const automation = read("server/services/whatsapp-automation.service.ts");

    assert.match(automation, /Chat with team requested/);
    assert.match(automation, /automationPaused: true/);
    assert.match(automation, /notifyStaffInbound/);
    assert.match(automation, /A team member will reply here shortly/);
  });
});
