import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { whatsappMetaService } from "../server/services/whatsapp-meta.service";

const originalFetch = globalThis.fetch;
const originalToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
const originalPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken == null) delete process.env.META_WHATSAPP_ACCESS_TOKEN;
  else process.env.META_WHATSAPP_ACCESS_TOKEN = originalToken;
  if (originalPhoneId == null) delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  else process.env.META_WHATSAPP_PHONE_NUMBER_ID = originalPhoneId;
});

function configureWhatsapp() {
  process.env.META_WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.META_WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
}

test("returns structured Meta provider errors", async () => {
  configureWhatsapp();
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      message: "Recipient phone number not in allowed list",
      code: 131030,
    },
  }), { status: 400, headers: { "Content-Type": "application/json" } });

  const result = await whatsappMetaService.sendText("447700900111", "Hello");

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    providerCode: 131030,
    error: "Recipient phone number not in allowed list",
  });
});

test("converts network failures into retryable structured failures", async () => {
  configureWhatsapp();
  globalThis.fetch = async () => {
    throw new Error("socket closed");
  };

  const result = await whatsappMetaService.sendText("447700900111", "Hello");

  assert.deepEqual(result, {
    ok: false,
    status: 503,
    providerCode: null,
    error: "WhatsApp network request failed: socket closed",
  });
});

test("applies a request deadline to Meta sends", async () => {
  configureWhatsapp();
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal;
    return new Response(JSON.stringify({ messages: [{ id: "wamid.sent" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await whatsappMetaService.sendText("447700900111", "Hello");

  assert.equal(result.ok, true);
  assert.ok(signal instanceof AbortSignal);
});
