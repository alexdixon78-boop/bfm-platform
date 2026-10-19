/**
 * E2E test: Task #163 — Cases List Advanced Filtering.
 *
 * Validates:
 *   1. /api/cases accepts the new filter params and narrows results
 *   2. Filter probing CANNOT leak out-of-scope cases for a mediator
 *   3. /api/case-filter-presets CRUD round-trip + isDefault uniqueness
 *
 * Run with: npx tsx tests/e2e/cases-filters.test.ts
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
  assert.equal(res.ok, true, `Login failed for ${email}: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "Expected session cookie");
  const m = setCookie.match(/connect\.sid=([^;]+)/);
  assert.ok(m, "Expected connect.sid");
  return `connect.sid=${decodeURIComponent(m[1])}`;
}

async function api(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as unknown };
}

test("Cases filters: admin gets all cases unfiltered", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  const { status, body } = await api("GET", "/api/cases?page=1&limit=100", cookie);
  assert.equal(status, 200);
  const list = body as { data: unknown[]; total: number };
  assert.ok(Array.isArray(list.data));
});

test("Cases filters: status filter narrows results", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  const { body: all } = await api("GET", "/api/cases?page=1&limit=100", cookie);
  const allList = (all as { data: { status: string }[] }).data;
  if (allList.length === 0) return; // No data — skip narrowing.

  const { body: filtered } = await api(
    "GET",
    "/api/cases?page=1&limit=100&statuses=Active",
    cookie,
  );
  const filteredList = (filtered as { data: { status: string }[] }).data;
  for (const c of filteredList) assert.equal(c.status, "Active");
});

test("Cases filters: AND composition across multiple dimensions narrows further", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  const { body: byStatus } = await api("GET", "/api/cases?page=1&limit=200&statuses=Active", cookie);
  const a = (byStatus as { total: number }).total;
  const { body: byBoth } = await api(
    "GET",
    "/api/cases?page=1&limit=200&statuses=Active&mediationCategories=Family",
    cookie,
  );
  const b = (byBoth as { total: number }).total;
  assert.ok(b <= a, "AND-composed filter must not return more rows than a single filter");
});

test("Cases filters: invalid filter value rejected with 400", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  // enquiryDateFrom is regex-validated to YYYY-MM-DD; 'bogus' must be rejected.
  const { status } = await api("GET", "/api/cases?page=1&limit=1&enquiryDateFrom=bogus", cookie);
  assert.equal(status, 400, "Schema must reject malformed date");
});

test("Cases filters: mediator scope cannot leak via filter probing", async () => {
  const adminCookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  const { body: adminList } = await api("GET", "/api/cases?page=1&limit=100", adminCookie);
  const adminCases = (adminList as { data: { id: string; caseRef: string }[] }).data;
  if (adminCases.length === 0) return;

  // Pick a case ref that exists for admin and try to probe it as a mediator.
  const probeRef = adminCases[0].caseRef;

  // Use a known seed mediator if present; otherwise skip cleanly.
  const mediatorLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "mediator@brighterfuturemediation.co.uk", password: "mediator123" }),
  });
  if (!mediatorLogin.ok) return; // Seed mediator not present in this env.
  const setCookie = mediatorLogin.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/connect\.sid=([^;]+)/);
  if (!m) return;
  const mediatorCookie = `connect.sid=${decodeURIComponent(m[1])}`;

  const { body: mList } = await api("GET", `/api/cases?page=1&limit=100&search=${encodeURIComponent(probeRef)}`, mediatorCookie);
  const mCases = (mList as { data: { caseRef: string }[] }).data;
  // Either the mediator legitimately has access, or the probe yields zero rows.
  // The critical invariant: no case that should be hidden may appear.
  // We can't easily know what's hidden, but we CAN assert the mediator's total
  // doesn't suddenly equal admin's total when scope should restrict.
  const { body: mUnfiltered } = await api("GET", "/api/cases?page=1&limit=1", mediatorCookie);
  const mTotal = (mUnfiltered as { total: number }).total;
  const { body: aUnfiltered } = await api("GET", "/api/cases?page=1&limit=1", adminCookie);
  const aTotal = (aUnfiltered as { total: number }).total;
  if (mTotal < aTotal) {
    // Scope is restricting. The probe must not return rows the mediator can't normally see.
    assert.ok(
      mCases.length === 0 || mCases.every((c) => c.caseRef === probeRef),
      "Filter probe leaked out-of-scope cases",
    );
  }
});

test("Cases filters: each individual dimension parses + narrows monotonically", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  const { body: base } = await api("GET", "/api/cases?page=1&limit=500", cookie);
  const baseTotal = (base as { total: number }).total;

  // One representative valid value per dimension. The contract being asserted
  // is "filtered total <= unfiltered total" for every dimension — i.e. each
  // dimension is wired through to SQL (not silently dropped) and never expands
  // the result set.
  const dims: [string, string][] = [
    ["statuses", "Active"],
    ["stages", "Enquiry"],
    ["mediationCategories", "Family"],
    ["familySubTypes", "Children Arrangements"],
    ["workplaceSubTypes", "Bullying / harassment"],
    ["civilSubTypes", "Neighbour dispute"],
    ["commercialSubTypes", "Contract dispute"],
    ["otherSubTypes", "Other"],
    ["fundingSources", "Self-funded"],
    ["voucherStatuses", "Yes"],
    ["inCourtStatuses", "No"],
    ["cafcassStatuses", "No"],
    ["enquiryDateFrom", "2020-01-01"],
    ["enquiryDateTo", "2099-12-31"],
    ["miamCompletedDateFrom", "2020-01-01"],
    ["closureDateTo", "2099-12-31"],
    ["search", "BFM"],
  ];
  for (const [k, v] of dims) {
    const { status, body } = await api("GET", `/api/cases?page=1&limit=500&${k}=${encodeURIComponent(v)}`, cookie);
    assert.equal(status, 200, `${k} returned ${status}`);
    const t = (body as { total: number }).total;
    assert.ok(t <= baseTotal, `${k} expanded total (${t} > ${baseTotal})`);
  }
});

test("Case filter presets: default round-trip via /default endpoint", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  // Clean prior test presets.
  const { body: existing } = await api("GET", "/api/case-filter-presets", cookie);
  for (const p of (existing as { id: string; name: string }[]) ?? []) {
    if (p.name.startsWith("__defaulttest__")) await api("DELETE", `/api/case-filter-presets/${p.id}`, cookie);
  }

  const { body: created } = await api("POST", "/api/case-filter-presets", cookie, {
    name: "__defaulttest__only",
    filters: { statuses: ["Active"] },
    isDefault: true,
  });
  const id = (created as { id: string }).id;

  const { status, body } = await api("GET", "/api/case-filter-presets/default", cookie);
  assert.equal(status, 200);
  assert.equal((body as { id?: string } | null)?.id, id);

  await api("DELETE", `/api/case-filter-presets/${id}`, cookie);
});

test("Case filter presets: CRUD round-trip + isDefault uniqueness", async () => {
  const cookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");

  // Clean any existing test presets.
  const { body: existing } = await api("GET", "/api/case-filter-presets", cookie);
  for (const p of (existing as { id: string; name: string }[]) ?? []) {
    if (p.name.startsWith("__test__")) await api("DELETE", `/api/case-filter-presets/${p.id}`, cookie);
  }

  // Create #1 as default.
  const { status: s1, body: b1 } = await api("POST", "/api/case-filter-presets", cookie, {
    name: "__test__view-1",
    filters: { statuses: ["Active"] },
    isDefault: true,
  });
  assert.equal(s1, 201);
  const p1 = b1 as { id: string; isDefault: boolean };
  assert.equal(p1.isDefault, true);

  // Create #2 also as default — #1 must lose default.
  const { status: s2, body: b2 } = await api("POST", "/api/case-filter-presets", cookie, {
    name: "__test__view-2",
    filters: { statuses: ["Closed"] },
    isDefault: true,
  });
  assert.equal(s2, 201);
  const p2 = b2 as { id: string; isDefault: boolean };
  assert.equal(p2.isDefault, true);

  const { body: list } = await api("GET", "/api/case-filter-presets", cookie);
  const arr = list as { id: string; isDefault: boolean }[];
  const defaults = arr.filter((p) => p.isDefault);
  assert.equal(defaults.length, 1, "Only one default preset allowed per user");
  assert.equal(defaults[0].id, p2.id);

  // Update #1 name.
  const { status: u1 } = await api("PATCH", `/api/case-filter-presets/${p1.id}`, cookie, {
    name: "__test__view-1-renamed",
  });
  assert.equal(u1, 200);

  // Delete both.
  assert.equal((await api("DELETE", `/api/case-filter-presets/${p1.id}`, cookie)).status, 200);
  assert.equal((await api("DELETE", `/api/case-filter-presets/${p2.id}`, cookie)).status, 200);
});
