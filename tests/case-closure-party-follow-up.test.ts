/**
 * Regression tests for per-client case closure follow-up consent.
 *
 * Run with: npx tsx tests/case-closure-party-follow-up.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("schema and migration define per-party closure consent rows", () => {
  const schema = read("shared/schema.ts");
  const migration = read("migrations/0033_case_closure_party_follow_up.sql");

  assert.match(schema, /caseClosurePartyFollowUps = pgTable\("case_closure_party_follow_ups"/);
  assert.match(schema, /partyId: varchar\("party_id"\)\.notNull\(\)\.references\(\(\) => parties\.id/);
  assert.match(schema, /CASE_PARTY_FOLLOW_UP_CONSENT_STATUSES = \["granted", "declined", "excluded", "pending"\]/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "case_closure_party_follow_ups"/);
  assert.match(migration, /UNIQUE \("closure_record_id","party_id"\)/);
});

test("close route creates client follow-up tasks only for granted party consent", () => {
  const route = read("server/routes/case.routes.ts");

  assert.match(route, /partyFollowUpConsents/);
  assert.match(route, /createCaseClosureFollowUpTasks/);
  assert.match(route, /case_closure_follow_up/);
  assert.match(route, /two-week/i);
  assert.match(route, /one-month/i);
  assert.match(route, /three-month/i);
});

test("case detail exposes party follow-up consent state for the close-case dialog", () => {
  const service = read("server/services/case.service.ts");
  const page = read("client/src/pages/case-detail.tsx");

  assert.match(service, /partyFollowUpConsents/);
  assert.match(service, /sourceEnquiry\?\.consentFollowUp/);
  assert.match(page, /Consent already granted/);
  assert.match(page, /Not captured yet/);
  assert.match(page, /partyFollowUpConsents/);
});

test("close-case dialog uses responsive layout classes", () => {
  const page = read("client/src/pages/case-detail.tsx");

  assert.match(page, /<DialogContent\s+className="[^"]*w-\[calc\(100vw-1rem\)\][^"]*max-h-\[90vh\][^"]*overflow-y-auto[^"]*p-4 sm:p-6[^"]*"\s+data-testid="dialog-close-case"/);
  assert.match(page, /className="[^"]*flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between[^"]*"/);
  assert.match(page, /className="[^"]*min-w-0[^"]*"/);
  assert.match(page, /className="[^"]*flex flex-wrap gap-1[^"]*"/);
  assert.match(page, /className="[^"]*grid grid-cols-1 sm:grid-cols-2 gap-3[^"]*"/);
  assert.match(page, /className="[^"]*min-w-0[^"]*" data-testid=\{`manual-follow-up-consent-link/);
});
