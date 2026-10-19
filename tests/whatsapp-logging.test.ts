import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isConfidentialResponsePath } from "../server/logger";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("WhatsApp terminal logging", () => {
  it("never logs private-note API response bodies", () => {
    assert.equal(isConfidentialResponsePath("/api/cases/case-1/private-notes"), true);
    assert.equal(isConfidentialResponsePath("/api/cases/case-1/private-notes/note-1/attachments/file-1/download"), true);
  });

  it("logs inbound webhook events with human-readable safe fields", () => {
    const webhook = read("server/services/whatsapp-webhook.service.ts");
    const route = read("server/routes/whatsapp.routes.ts");
    const summary = read("server/services/whatsapp-webhook-summary.ts");

    assert.match(route, /logger\.info\("Webhook received"/);
    assert.match(webhook, /messageId/);
    assert.match(webhook, /conversationId/);
    assert.match(webhook, /duplicate/);
    assert.match(webhook, /Attachment metadata received/);
    assert.match(route, /summarizeWhatsappWebhookPayload/);
    assert.match(summary, /statusUpdateCount/);
  });

  it("logs automation decisions and outbound Meta results", () => {
    const automation = read("server/services/whatsapp-automation.service.ts");
    const outbox = read("server/services/whatsapp-outbox.service.ts");

    assert.match(automation, /Automation state/);
    assert.match(automation, /Manual pause detected/);
    assert.match(automation, /Existing case flow started/);
    assert.match(automation, /OTP verified/);
    assert.match(automation, /OTP failed/);
    assert.match(automation, /New enquiry handoff started/);
    assert.match(automation, /Case note logged/);

    assert.match(outbox, /Outbound send attempted/);
    assert.match(outbox, /Outbound send succeeded/);
    assert.match(outbox, /Outbound send failed/);
    assert.match(outbox, /providerErrorNumber/);
  });

  it("does not log known secret names or full raw webhook payloads", () => {
    const files = [
      "server/routes/whatsapp.routes.ts",
      "server/services/whatsapp-webhook.service.ts",
      "server/services/whatsapp-automation.service.ts",
      "server/services/whatsapp-outbox.service.ts",
    ];
    const combined = files.map(read).join("\n");

    assert.doesNotMatch(combined, /console\.(log|warn|error)/);
    assert.doesNotMatch(combined, /bodyPreview|sender:/);
    assert.doesNotMatch(combined, /logger\.(?:debug|info|warn|error)\([^)]*rawBody/);
    assert.doesNotMatch(combined, /logger\.(?:debug|info|warn|error)\([^)]*req\.body/);
  });

  it("runs a non-overlapping due-outbox worker every minute", () => {
    const app = read("server/app.ts");
    const outbox = read("server/services/whatsapp-outbox.service.ts");

    assert.match(app, /whatsappOutboxWorkerRunning/);
    assert.match(app, /processDue/);
    assert.match(app, /15 \* 1000/);
    assert.match(app, /60 \* 1000/);
    assert.match(outbox, /getWhatsappOutboxLeaseExpiry/);
    assert.match(outbox, /lte\(whatsappOutbox\.nextAttemptAt/);
  });
});
