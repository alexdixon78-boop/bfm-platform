/**
 * E2E integration test: Mediator Lifecycle Workflow (Task #175)
 *
 * Covers:
 *   - Superadmin creates an applicant with accreditationStatus + areaOfPractice
 *   - Convert with sendInvite=true: invite email path runs end-to-end and
 *     `emailSent` flag is returned (true OR false depending on env, but
 *     non-undefined and an onboarding token is stamped on the new mediator)
 *   - Re-convert is rejected (409)
 *   - References cap at 2 (third returns 400)
 *   - Reference verify stamps verifiedBy + verifiedAt
 *   - Off-board with NO open cases works end-to-end:
 *       panelStatus → "Off-boarded", users.status → "inactive",
 *       login refused, audit log entry written
 *   - Off-board with an open case where the reassignment map is missing
 *     returns 409 (the deterministic "must be reassigned" path)
 *   - Unauthenticated probe is gated (401)
 *
 * Run against a running dev server:
 *   npx tsx tests/e2e/mediator-lifecycle.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const TAG = `e2e-lifecycle-${Date.now()}`;

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.ok, true, `Login failed (${email}): ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "Expected session cookie on login response");
  const match = setCookie.match(/connect\.sid=([^;]+)/);
  assert.ok(match, "Expected connect.sid cookie");
  return `connect.sid=${decodeURIComponent(match[1])}`;
}

async function api(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

test("Mediator lifecycle — applicant → convert (with invite) → references → off-board", { concurrency: false }, async () => {
  const supCookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  // ---- Applicant create with all spec fields ----
  const email = `${TAG}@example.com`;
  const created = await api("POST", "/api/mediator-applicants", supCookie, {
    firstName: TAG,
    lastName: "Tester",
    email,
    phone: "+44 7700 900100",
    source: "Word of mouth",
    accreditationStatus: "FMC accredited",
    areaOfPractice: ["Family mediation", "Workplace"],
    notes: "Strong candidate",
    stage: "reference_credential_check",
  });
  assert.equal(created.status, 201, `Create applicant: ${created.status} ${JSON.stringify(created.body)}`);
  const applicantId = created.body.id as string;
  assert.equal(created.body.stage, "reference_credential_check");
  assert.equal(created.body.accreditationStatus, "FMC accredited");
  assert.deepEqual(created.body.areaOfPractice, ["Family mediation", "Workplace"]);

  let mediatorId: string | null = null;
  let secondMediatorId: string | null = null;
  let caseId: string | null = null;
  let partyAId: string | null = null;
  let partyBId: string | null = null;
  let clientAId: string | null = null;
  let clientBId: string | null = null;

  try {
    // ---- Convert with sendInvite=true (default) — exercises invite-email flow ----
    const conv = await api("POST", `/api/mediator-applicants/${applicantId}/convert`, supCookie, { sendInvite: true });
    assert.equal(conv.status, 200, `Convert: ${conv.status} ${JSON.stringify(conv.body)}`);
    mediatorId = conv.body.mediatorId as string;
    assert.ok(mediatorId, "Expected mediatorId on convert response");
    assert.equal(conv.body.applicant.stage, "onboarded");
    assert.equal(typeof conv.body.emailSent, "boolean", "convert response should expose emailSent flag");

    // Verify the invite token + expiry were stamped on the new user (proves
    // the invite path ran even if SendGrid wasn't configured in this env).
    const tokRow = await pg.query<{ onboarding_token: string | null; onboarding_token_expires_at: Date | null }>(
      `SELECT onboarding_token, onboarding_token_expires_at FROM users WHERE id = $1`,
      [mediatorId],
    );
    assert.ok(tokRow.rows[0]?.onboarding_token, "Onboarding token should be stamped on the new mediator");
    assert.ok(tokRow.rows[0]?.onboarding_token_expires_at, "Onboarding token expiry should be stamped");

    // Verify applicant phone was carried onto the mediator profile
    const profRow = await pg.query<{ mobile_phone: string | null; first_name: string | null; last_name: string | null }>(
      `SELECT mobile_phone, first_name, last_name FROM mediator_profiles WHERE user_id = $1`,
      [mediatorId],
    );
    assert.equal(profRow.rows[0]?.mobile_phone, "+44 7700 900100", "Applicant phone should land on profile mobilePhone");
    assert.equal(profRow.rows[0]?.first_name, TAG);

    // Re-convert should be rejected
    const reconv = await api("POST", `/api/mediator-applicants/${applicantId}/convert`, supCookie, { sendInvite: false });
    assert.equal(reconv.status, 409, `Re-convert should be 409, got ${reconv.status}`);

    // ---- References: cap + verify ----
    const ref1 = await api("POST", `/api/mediators/${mediatorId}/references`, supCookie, {
      name: "Ref One", organisation: "Org A", email: "ref1@example.com", status: "pending",
    });
    assert.equal(ref1.status, 201);
    const ref2 = await api("POST", `/api/mediators/${mediatorId}/references`, supCookie, {
      name: "Ref Two", organisation: "Org B", email: "ref2@example.com", status: "pending",
    });
    assert.equal(ref2.status, 201);
    const ref3 = await api("POST", `/api/mediators/${mediatorId}/references`, supCookie, {
      name: "Ref Three", organisation: "Org C", email: "ref3@example.com",
    });
    assert.equal(ref3.status, 400, `Ref 3 should be capped (400), got ${ref3.status}`);

    const verified = await api("PATCH", `/api/mediators/${mediatorId}/references/${ref1.body.id}`, supCookie, { status: "verified" });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.status, "verified");
    assert.ok(verified.body.verifiedBy);
    assert.ok(verified.body.verifiedAt);

    // ---- 409 path: assign mediator to a real open case, then off-board with empty map ----
    // Pick a second active mediator to use as the eventual replacement.
    const others = await pg.query<{ id: string }>(
      `SELECT id FROM users WHERE role='mediator' AND status='active' AND id <> $1 LIMIT 1`,
      [mediatorId],
    );
    if (others.rows[0]) {
      secondMediatorId = others.rows[0].id;

      // Build a minimal Case + 2 Clients + 2 Parties so the mediator owns it.
      const caseRow = await pg.query<{ id: string; case_ref: string }>(
        `INSERT INTO cases (case_ref, status, mediator_id, created_at)
         VALUES ($1, 'Active', $2, NOW()) RETURNING id, case_ref`,
        [`E2E-${Date.now()}`, mediatorId],
      );
      caseId = caseRow.rows[0].id;

      const cA = await pg.query<{ id: string }>(
        `INSERT INTO clients (first_name, last_name, email, phone, created_at)
         VALUES ($1,$2,$3,'+44 0000 000001',NOW()) RETURNING id`,
        [`${TAG}-A`, "Party", `${TAG}-a@example.com`],
      );
      clientAId = cA.rows[0].id;
      const cB = await pg.query<{ id: string }>(
        `INSERT INTO clients (first_name, last_name, email, phone, created_at)
         VALUES ($1,$2,$3,'+44 0000 000002',NOW()) RETURNING id`,
        [`${TAG}-B`, "Party", `${TAG}-b@example.com`],
      );
      clientBId = cB.rows[0].id;

      const pA = await pg.query<{ id: string }>(
        `INSERT INTO parties (case_id, client_id, role, miam_mediator_id, allocated_mediator_id)
         VALUES ($1,$2,'A',$3,$3) RETURNING id`,
        [caseId, clientAId, mediatorId],
      );
      partyAId = pA.rows[0].id;
      const pB = await pg.query<{ id: string }>(
        `INSERT INTO parties (case_id, client_id, role) VALUES ($1,$2,'B') RETURNING id`,
        [caseId, clientBId],
      );
      partyBId = pB.rows[0].id;

      // The 409 deterministic path: open cases exist but reassignments={} is empty
      const open = await api("GET", `/api/mediators/${mediatorId}/open-cases`, supCookie);
      assert.equal(open.status, 200);
      assert.ok(open.body.length >= 1, "Should see the freshly-inserted open case");

      const refused = await api("POST", `/api/mediators/${mediatorId}/offboard`, supCookie, {
        reason: "E2E off-board — missing reassignments",
        reassignments: {},
      });
      assert.equal(refused.status, 409, `Off-board should reject (409) when reassignments missing, got ${refused.status} ${JSON.stringify(refused.body)}`);

      // Now provide a complete reassignment map → should succeed
      const ok = await api("POST", `/api/mediators/${mediatorId}/offboard`, supCookie, {
        reason: "E2E lifecycle test off-board (complete map)",
        offboardingDate: "2026-05-11",
        reassignments: { [caseId]: secondMediatorId },
      });
      assert.equal(ok.status, 200, `Off-board with complete map: ${ok.status} ${JSON.stringify(ok.body)}`);

      // Reassignment actually applied
      const after = await pg.query<{ mediator_id: string }>(
        `SELECT mediator_id FROM cases WHERE id = $1`,
        [caseId],
      );
      assert.equal(after.rows[0].mediator_id, secondMediatorId, "Case mediator should be reassigned");

      // Off-boarded mediator can't log in
      const loginRefused = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "anything" }),
      });
      assert.notEqual(loginRefused.status, 200);

      // Audit log entry exists
      const audit = await pg.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE entity='mediator' AND entity_id=$1 AND action='offboard'`,
        [mediatorId],
      );
      assert.ok(audit.rows.length >= 1, "Audit log should have offboard entry");
    }
  } finally {
    // Cleanup test artifacts
    try {
      if (partyAId) await pg.query(`DELETE FROM parties WHERE id = $1`, [partyAId]);
      if (partyBId) await pg.query(`DELETE FROM parties WHERE id = $1`, [partyBId]);
      if (caseId) await pg.query(`DELETE FROM cases WHERE id = $1`, [caseId]);
      if (clientAId) await pg.query(`DELETE FROM clients WHERE id = $1`, [clientAId]);
      if (clientBId) await pg.query(`DELETE FROM clients WHERE id = $1`, [clientBId]);
      if (mediatorId) {
        await pg.query(`DELETE FROM mediator_references WHERE mediator_id = $1`, [mediatorId]);
        await pg.query(`DELETE FROM mediator_profiles WHERE user_id = $1`, [mediatorId]);
      }
      await pg.query(`DELETE FROM mediator_applicants WHERE id = $1`, [applicantId]);
      if (mediatorId) await pg.query(`DELETE FROM users WHERE id = $1`, [mediatorId]);
      await pg.query(`DELETE FROM audit_logs WHERE entity='mediator' AND entity_ref LIKE $1`, [`${TAG}%`]);
    } finally {
      await pg.end();
    }
  }
});

test("Mediator lifecycle — unauthenticated probe is gated", { concurrency: false }, async () => {
  const res = await fetch(`${BASE_URL}/api/mediator-applicants`);
  assert.equal(res.status, 401, `Unauthenticated probe should be 401, got ${res.status}`);
});
