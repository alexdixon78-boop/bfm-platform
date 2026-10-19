import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeWhatsappWebhookPayload } from "../server/services/whatsapp-webhook-summary";

test("counts inbound messages and status updates without retaining payload data", () => {
  const summary = summarizeWhatsappWebhookPayload({
    entry: [{
      changes: [{
        value: {
          messages: [{ id: "wamid.one", from: "447700900111", text: { body: "private" } }],
          statuses: [{ id: "wamid.outbound", status: "delivered" }],
        },
      }],
    }],
  });

  assert.deepEqual(summary, {
    entryCount: 1,
    changeCount: 1,
    receivedMessageCount: 1,
    statusUpdateCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(summary), /447700900111|private/);
});

test("returns zero counts for malformed and empty webhook payloads", () => {
  assert.deepEqual(summarizeWhatsappWebhookPayload({ entry: "invalid" }), {
    entryCount: 0,
    changeCount: 0,
    receivedMessageCount: 0,
    statusUpdateCount: 0,
  });
});
