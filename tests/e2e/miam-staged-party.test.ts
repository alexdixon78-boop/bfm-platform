/**
 * E2E integration test: MIAM staged-party (Task #152)
 *
 * Tests the full staged C/D party lifecycle:
 *   stage → persist → unlink → restage → email-conflict guard → audit log
 *
 * Run against the local dev server (npm run dev must be running):
 *   npx tsx tests/e2e/miam-staged-party.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.ok, true, `Login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "Expected session cookie on login response");
  const match = setCookie.match(/connect\.sid=([^;]+)/);
  assert.ok(match, "Expected connect.sid cookie");
  // Decode the URL-encoded cookie value so the Cookie request header is correct
  return `connect.sid=${decodeURIComponent(match[1])}`;
}

async function api(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function getDraftMiam(
  cookie: string,
): Promise<{ caseId: string; miamRecordId: string } | null> {
  const r = await api("GET", "/api/cases?limit=100", cookie);
  assert.equal(r.status, 200, `GET /api/cases failed: ${r.status}`);

  type CaseItem = { id: string };
  type CasesBody = CaseItem[] | { data: CaseItem[] } | { cases: CaseItem[] };
  const casesBody = r.body as CasesBody;
  const cases: CaseItem[] = Array.isArray(casesBody)
    ? casesBody
    : (casesBody as { data?: CaseItem[]; cases?: CaseItem[] }).data ??
      (casesBody as { cases?: CaseItem[] }).cases ?? [];

  for (const c of cases) {
    const mr = await api("GET", `/api/miam-records/case/${c.id}`, cookie);
    if (mr.status !== 200) continue;
    type MiamBody =
      | { records: { id: string; approvalStatus: string }[] }
      | { id: string; approvalStatus: string }[];
    const miamBody = mr.body as MiamBody;
    const records = Array.isArray(miamBody)
      ? miamBody
      : (miamBody as { records: { id: string; approvalStatus: string }[] }).records ?? [];
    const draft = records.find((rec) => rec.approvalStatus === "draft");
    if (draft) return { caseId: c.id, miamRecordId: draft.id };
  }
  return null;
}

// ============================= tests =============================

test("MIAM staged party — full lifecycle", async (t) => {
  const cookie = await login(
    "rebecca@brighterfuturemediation.co.uk",
    "admin123",
  );

  const target = await getDraftMiam(cookie);
  assert.ok(
    target,
    "No case with a draft MIAM record found — create one in the system first",
  );

  const { caseId, miamRecordId } = target;

  // Clear any pre-existing pending party so the test is idempotent
  await api("DELETE", `/api/miam-records/${miamRecordId}/pending-party`, cookie);

  // 1. Stage a new person (name only, no email)
  await t.test("stage new person without email", async () => {
    const r = await api(
      "PATCH",
      `/api/miam-records/${miamRecordId}/pending-party`,
      cookie,
      { firstName: "StagedE2E", lastName: "Person" },
    );
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    type PatchBody = { record: { pendingPartyFirstName: string } };
    const record = (r.body as PatchBody).record;
    assert.equal(record.pendingPartyFirstName, "StagedE2E");
  });

  // 2. Verify persistence via GET
  await t.test("pending party persists after staging", async () => {
    const r = await api("GET", `/api/miam-records/case/${caseId}`, cookie);
    assert.equal(r.status, 200);
    type GetBody =
      | { records: { id: string; pendingPartyFirstName: string | null }[] }
      | { id: string; pendingPartyFirstName: string | null }[];
    const body = r.body as GetBody;
    const records = Array.isArray(body)
      ? body
      : (body as { records: { id: string; pendingPartyFirstName: string | null }[] }).records ?? [];
    const miam = records.find((rec) => rec.id === miamRecordId);
    assert.ok(miam, "MIAM record not found in response");
    assert.equal(
      miam!.pendingPartyFirstName,
      "StagedE2E",
      "pendingPartyFirstName should be StagedE2E",
    );
  });

  // 3. Unlink the staged party
  await t.test("unlink staged party clears pending fields", async () => {
    const r = await api(
      "DELETE",
      `/api/miam-records/${miamRecordId}/pending-party`,
      cookie,
    );
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);

    // Verify cleared
    const r2 = await api("GET", `/api/miam-records/case/${caseId}`, cookie);
    assert.equal(r2.status, 200);
    type GetBody =
      | { records: { id: string; pendingPartyFirstName: string | null }[] }
      | { id: string; pendingPartyFirstName: string | null }[];
    const body = r2.body as GetBody;
    const records = Array.isArray(body)
      ? body
      : (body as { records: { id: string; pendingPartyFirstName: string | null }[] }).records ?? [];
    const miam = records.find((rec) => rec.id === miamRecordId);
    assert.ok(miam, "MIAM record not found after unlink");
    assert.equal(
      miam!.pendingPartyFirstName,
      null,
      "pendingPartyFirstName should be null after unlink",
    );
  });

  // 4. Restage with email
  await t.test("restage with valid email", async () => {
    const r = await api(
      "PATCH",
      `/api/miam-records/${miamRecordId}/pending-party`,
      cookie,
      {
        firstName: "RestagedE2E",
        lastName: "Person",
        email: "restaged-e2e-unique@example.com",
      },
    );
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    type PatchBody = { record: { pendingPartyFirstName: string } };
    const record = (r.body as PatchBody).record;
    assert.equal(record.pendingPartyFirstName, "RestagedE2E");
  });

  // 5. Email conflict guard: existing staff email must be rejected immediately
  await t.test("staging rejects staff email with 409", async () => {
    const r = await api(
      "PATCH",
      `/api/miam-records/${miamRecordId}/pending-party`,
      cookie,
      {
        firstName: "BadActor",
        lastName: "Staff",
        email: "rebecca@brighterfuturemediation.co.uk",
      },
    );
    assert.equal(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    const msg = ((r.body as { message: string }) ?? {}).message ?? "";
    assert.match(msg, /staff account/i, "Error should mention 'staff account'");
  });

  // 6. Audit log must contain stage_party and unstage_party entries
  await t.test("audit log records stage_party and unstage_party", async () => {
    const r = await api("GET", "/api/audit-logs?page=1&limit=50", cookie);
    assert.equal(r.status, 200, `Audit log endpoint failed: ${r.status}`);
    type LogEntry = { action: string };
    type AuditBody = LogEntry[] | { data: LogEntry[] } | { logs: LogEntry[] };
    const body = r.body as AuditBody;
    const logs: LogEntry[] = Array.isArray(body)
      ? body
      : (body as { data?: LogEntry[]; logs?: LogEntry[] }).data ??
        (body as { logs?: LogEntry[] }).logs ?? [];
    assert.ok(
      logs.some((l) => l.action === "stage_party"),
      `Expected 'stage_party' in audit log, found: ${logs.slice(0, 10).map((l) => l.action).join(", ")}`,
    );
    assert.ok(
      logs.some((l) => l.action === "unstage_party"),
      `Expected 'unstage_party' in audit log, found: ${logs.slice(0, 10).map((l) => l.action).join(", ")}`,
    );
  });

  // Clean up: remove the restaged party
  await api("DELETE", `/api/miam-records/${miamRecordId}/pending-party`, cookie);
});
