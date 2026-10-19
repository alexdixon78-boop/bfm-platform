import assert from "node:assert/strict";
import { test } from "node:test";

test("Custom Connection status is unavailable without credentials and makes no provider request", async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.XERO_CLIENT_ID;
  const originalClientSecret = process.env.XERO_CLIENT_SECRET;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let fetchCalls = 0;
  delete process.env.XERO_CLIENT_ID;
  delete process.env.XERO_CLIENT_SECRET;
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bfm_test";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    const { XeroService } = await import("../server/services/xero.service");
    const status = await new XeroService().getConnectionStatus();
    assert.equal(status.connected, false);
    assert.equal(status.connection, null);
    assert.equal(status.lastError, "Xero Custom Connection credentials are not configured");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.XERO_CLIENT_ID;
    else process.env.XERO_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.XERO_CLIENT_SECRET;
    else process.env.XERO_CLIENT_SECRET = originalClientSecret;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("Custom Connection credentials are cached and Organisation requests omit the tenant header", async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.XERO_CLIENT_ID;
  const originalClientSecret = process.env.XERO_CLIENT_SECRET;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  process.env.XERO_CLIENT_ID = "custom-client-id";
  process.env.XERO_CLIENT_SECRET = "custom-client-secret";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bfm_test";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://identity.xero.com/connect/token") {
      assert.equal(String(init?.body), "grant_type=client_credentials");
      assert.match(new Headers(init?.headers).get("Authorization") || "", /^Basic /);
      return new Response(JSON.stringify({ access_token: "custom-token", expires_in: 1800 }), { status: 200 });
    }
    assert.equal(url, "https://api.xero.com/api.xro/2.0/Organisation");
    assert.equal(new Headers(init?.headers).get("xero-tenant-id"), null);
    return new Response(JSON.stringify({ Organisations: [{ OrganisationID: "demo-org-id", Name: "Xero Demo Company" }] }), { status: 200 });
  };

  try {
    const { XeroService } = await import("../server/services/xero.service");
    const service = new XeroService();
    const first = await service.getConnectionStatus();
    const second = await service.getConnectionStatus();

    assert.equal(first.connected, true);
    assert.equal(first.connection?.tenantId, "demo-org-id");
    assert.equal(second.connected, true);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.XERO_CLIENT_ID;
    else process.env.XERO_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.XERO_CLIENT_SECRET;
    else process.env.XERO_CLIENT_SECRET = originalClientSecret;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("Custom Connection status hides upstream failures and clears the error after recovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.XERO_CLIENT_ID;
  const originalClientSecret = process.env.XERO_CLIENT_SECRET;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.XERO_CLIENT_ID = "custom-client-id";
  process.env.XERO_CLIENT_SECRET = "custom-client-secret";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/bfm_test";
  let shouldFail = true;

  globalThis.fetch = async (input) => {
    if (String(input) === "https://identity.xero.com/connect/token" && shouldFail) {
      return new Response("provider diagnostic: internal-only-value", { status: 401 });
    }
    if (String(input) === "https://identity.xero.com/connect/token") {
      return new Response(JSON.stringify({ access_token: "custom-token", expires_in: 1800 }), { status: 200 });
    }
    return new Response(JSON.stringify({ Organisations: [{ OrganisationID: "demo-org-id", Name: "Xero Demo Company" }] }), { status: 200 });
  };

  try {
    const { XeroService } = await import("../server/services/xero.service");
    const service = new XeroService();
    const failed = await service.getConnectionStatus();
    assert.equal(failed.connected, false);
    assert.doesNotMatch(failed.lastError || "", /internal-only-value/);

    shouldFail = false;
    const recovered = await service.getConnectionStatus();
    assert.equal(recovered.connected, true);
    assert.equal(recovered.lastError, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.XERO_CLIENT_ID;
    else process.env.XERO_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.XERO_CLIENT_SECRET;
    else process.env.XERO_CLIENT_SECRET = originalClientSecret;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
