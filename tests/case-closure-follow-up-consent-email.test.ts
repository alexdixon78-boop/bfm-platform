/**
 * Regression tests for post-closure follow-up consent request links.
 *
 * Run with: npx tsx tests/case-closure-follow-up-consent-email.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("schema can store pre-close pending follow-up consent request tokens safely", () => {
  const schema = read("shared/schema.ts");
  const migration = read("migrations/0033_case_closure_party_follow_up.sql");

  assert.match(schema, /CASE_PARTY_FOLLOW_UP_CONSENT_STATUSES = \["granted", "declined", "excluded", "pending"\]/);
  assert.match(schema, /closureRecordId: varchar\("closure_record_id"\)\.references/);
  assert.match(schema, /followUpConsentTokenHash: text\("follow_up_consent_token_hash"\)/);
  assert.match(schema, /followUpConsentTokenExpiresAt: timestamp\("follow_up_consent_token_expires_at"\)/);
  assert.match(schema, /followUpConsentRequestSentAt: timestamp\("follow_up_consent_request_sent_at"\)/);
  assert.match(migration, /"closure_record_id" varchar REFERENCES "case_closure_records"/);
  assert.match(migration, /"follow_up_consent_token_hash" text/);
  assert.match(migration, /case_closure_party_follow_ups_case_party_unique/);
});

test("case routes send, validate, and record follow-up consent without exposing broad tokens", () => {
  const route = read("server/routes/case.routes.ts");

  assert.match(route, /sendCaseFollowUpConsentRequestEmail/);
  assert.match(route, /router\.post\("\/api\/cases\/:caseId\/parties\/:partyId\/follow-up-consent\/send"/);
  assert.match(route, /router\.get\("\/api\/cases\/follow-up-consent\/:token"/);
  assert.match(route, /router\.post\("\/api\/cases\/follow-up-consent\/:token"/);
  assert.match(route, /emailSent:\s*false/);
  assert.match(route, /consentUrl/);
  assert.match(route, /followUpConsentTokenHash:\s*null/);
  assert.doesNotMatch(route, /followUpConsentToken:\s*token/);
});

test("close modal and public app route expose follow-up consent request UI", () => {
  const app = read("client/src/App.tsx");
  const publicRoutes = read("client/src/lib/public-routes.ts");
  const page = read("client/src/pages/case-detail.tsx");
  const consentPage = read("client/src/pages/case-follow-up-consent.tsx");

  assert.match(app, /case-follow-up-consent\/:token/);
  assert.match(publicRoutes, /case-follow-up-consent/);
  assert.match(page, /Send consent request/);
  assert.match(page, /Copy consent link/);
  assert.match(page, /follow-up-consent\/send/);
  assert.match(consentPage, /I consent to follow-up contact/);
  assert.match(consentPage, /method:\s*"POST"/);
});
