import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCalendlyWebhookSubscription,
  getCalendlySubscriptionConfigStatus,
  preflightCalendlyCallbackUrl,
  validateCalendlyCallbackUrl,
} from "../server/services/calendly-subscription.service";

const endpoint =
  "https://example.com/api/public/integrations/calendly-consultations";
const organization = "https://api.calendly.com/organizations/org-1";

test("Calendly callback URL validation requires HTTPS and the consultation endpoint path", () => {
  assert.deepEqual(validateCalendlyCallbackUrl(endpoint), { ok: true });
  assert.deepEqual(validateCalendlyCallbackUrl("http://example.com/api/public/integrations/calendly-consultations"), {
    ok: false,
    message: "Calendly callback URL must use HTTPS",
  });
  assert.deepEqual(validateCalendlyCallbackUrl("https://example.com/api/public/integrations/other"), {
    ok: false,
    message: "Calendly callback URL must end with /api/public/integrations/calendly-consultations",
  });
});

test("Calendly config status exposes only safe booleans", () => {
  assert.deepEqual(getCalendlySubscriptionConfigStatus({
    CALENDLY_PAT: "pat",
    CALENDLY_WEBHOOK_SIGNING_KEY: "secret",
    CALENDLY_ORGANIZATION_URI: organization,
  }), {
    calendlyPatConfigured: true,
    calendlyWebhookSigningKeyConfigured: true,
    calendlyOrganizationUriConfigured: true,
  });
});

function healthyPreflight() {
  return new Response(JSON.stringify({
    success: false,
    message: "Invalid Calendly webhook signature",
  }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

test("Calendly callback preflight accepts the expected unsigned webhook signature rejection", async () => {
  const result = await preflightCalendlyCallbackUrl(endpoint, async (url, init) => {
    assert.equal(String(url), endpoint);
    assert.equal(init?.method, "POST");
    return healthyPreflight();
  });

  assert.deepEqual(result, {
    ok: true,
    status: 401,
    reason: "Webhook endpoint reached",
  });
});

test("Calendly callback preflight rejects Cloudflare HTML errors without leaking HTML", async () => {
  await assert.rejects(
    preflightCalendlyCallbackUrl(endpoint, async () =>
      new Response("<!DOCTYPE html><title>trycloudflare.com | 502: Bad gateway</title>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
    ),
    (error: any) => {
      assert.equal(error.status, 502);
      assert.equal(error.safeMessage, "Callback URL is not reachable by the server: Bad gateway");
      assert.equal(JSON.stringify(error).includes("<!DOCTYPE"), false);
      return true;
    },
  );
});

test("Calendly subscription update deletes stale endpoint subscriptions and returns safe fields", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await createCalendlyWebhookSubscription({
    callbackUrl: endpoint,
    token: "pat-secret",
    signingKey: "signing-secret",
    organizationUri: organization,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === endpoint) return healthyPreflight();
      if (String(url).startsWith("https://api.calendly.com/webhook_subscriptions?")) {
        return new Response(JSON.stringify({
          collection: [
            {
              uri: "https://api.calendly.com/webhook_subscriptions/stale-1",
              callback_url: "https://old.trycloudflare.com/api/public/integrations/calendly-consultations",
            },
            {
              uri: "https://api.calendly.com/webhook_subscriptions/keep-1",
              callback_url: "https://old.trycloudflare.com/api/public/integrations/other",
            },
          ],
        }), { status: 200 });
      }
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.url, endpoint);
      assert.equal(body.signing_key, "signing-secret");
      return new Response(JSON.stringify({
        resource: {
          uri: "https://api.calendly.com/webhook_subscriptions/new-1",
          callback_url: endpoint,
          state: "active",
          events: ["invitee.created"],
          scope: "organization",
          organization,
        },
      }), { status: 201 });
    },
  });

  assert.equal(result.deletedCount, 1);
  assert.deepEqual(result.subscription, {
    uri: "https://api.calendly.com/webhook_subscriptions/new-1",
    callbackUrl: endpoint,
    state: "active",
    events: ["invitee.created"],
    scope: "organization",
    organization,
  });
  assert.equal(JSON.stringify(result).includes("pat-secret"), false);
  assert.equal(JSON.stringify(result).includes("signing-secret"), false);
  assert.equal(calls.filter((call) => call.init?.method === "DELETE").length, 1);
  assert.deepEqual(
    calls.map((call) => call.init?.method || "GET"),
    ["POST", "GET", "POST", "DELETE"],
  );
});

test("Calendly subscription update reports safe upstream errors", async () => {
  await assert.rejects(
    createCalendlyWebhookSubscription({
      callbackUrl: endpoint,
      token: "pat-secret",
      signingKey: "signing-secret",
      organizationUri: organization,
      fetchImpl: async (url) =>
        String(url) === endpoint ? healthyPreflight() : new Response(JSON.stringify({ message: "invalid token detail" }), {
          status: 401,
        }),
    }),
    (error: any) => {
      assert.equal(error.status, 401);
      assert.equal(error.safeMessage, "invalid token detail");
      assert.equal(JSON.stringify(error).includes("pat-secret"), false);
      return true;
    },
  );
});

test("Calendly subscription update sanitizes upstream HTML errors", async () => {
  await assert.rejects(
    createCalendlyWebhookSubscription({
      callbackUrl: endpoint,
      token: "pat-secret",
      signingKey: "signing-secret",
      organizationUri: organization,
      fetchImpl: async (url) =>
        String(url) === endpoint ? healthyPreflight() : new Response("<!DOCTYPE html><title>Calendly | 502: Bad gateway</title>", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/html" },
        }),
    }),
    (error: any) => {
      assert.equal(error.status, 502);
      assert.equal(error.safeMessage, "Bad gateway");
      assert.equal(JSON.stringify(error).includes("<!DOCTYPE"), false);
      return true;
    },
  );
});

test("Calendly subscription update returns an active exact subscription without create or delete", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await createCalendlyWebhookSubscription({
    callbackUrl: endpoint,
    token: "pat-secret",
    signingKey: "signing-secret",
    organizationUri: organization,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === endpoint) return healthyPreflight();
      return new Response(JSON.stringify({
        collection: [{
          uri: "https://api.calendly.com/webhook_subscriptions/exact-1",
          callback_url: endpoint,
          state: "active",
          events: ["invitee.created"],
          scope: "organization",
          organization,
        }],
      }), { status: 200 });
    },
  });

  assert.equal(result.deletedCount, 0);
  assert.equal(result.subscription.uri, "https://api.calendly.com/webhook_subscriptions/exact-1");
  assert.deepEqual(calls.map((call) => call.init?.method || "GET"), ["POST", "GET"]);
});

test("Calendly subscription update preserves old subscriptions when create fails", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  await assert.rejects(
    createCalendlyWebhookSubscription({
      callbackUrl: endpoint,
      token: "pat-secret",
      signingKey: "signing-secret",
      organizationUri: organization,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url) === endpoint) return healthyPreflight();
        if (String(url).startsWith("https://api.calendly.com/webhook_subscriptions?")) {
          return new Response(JSON.stringify({
            collection: [{
              uri: "https://api.calendly.com/webhook_subscriptions/stale-1",
              callback_url: "https://old.trycloudflare.com/api/public/integrations/calendly-consultations",
            }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ message: "create failed" }), { status: 500 });
      },
    }),
    (error: any) => {
      assert.equal(error.status, 500);
      assert.equal(error.safeMessage, "create failed");
      return true;
    },
  );

  assert.equal(calls.some((call) => call.init?.method === "DELETE"), false);
});
