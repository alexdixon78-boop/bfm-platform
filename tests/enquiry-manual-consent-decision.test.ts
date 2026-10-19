/**
 * Regression test: enquiry privacy consent decisions must use the audited
 * tri-state flow instead of a plain boolean edit.
 *
 * Run with: npx tsx tests/enquiry-manual-consent-decision.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaSource = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/enquiry.routes.ts", import.meta.url), "utf8");
const bootstrapSource = readFileSync(new URL("../server/db-bootstrap.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../client/src/pages/enquiries.tsx", import.meta.url), "utf8");
const replitSource = readFileSync(new URL("../replit.md", import.meta.url), "utf8");

test("enquiries schema stores a tri-state privacy consent decision", () => {
  assert.match(schemaSource, /privacyConsentStatus:\s*text\("privacy_consent_status"\)\.notNull\(\)\.default\("pending"\)/);
  assert.match(schemaSource, /privacyConsentDecidedAt:\s*timestamp\("privacy_consent_decided_at"\)/);
  assert.match(schemaSource, /privacyConsentDecidedBy:\s*varchar\("privacy_consent_decided_by"\)/);
  assert.match(schemaSource, /privacyConsentDecisionSource:\s*text\("privacy_consent_decision_source"\)/);
  assert.match(schemaSource, /privacyConsentDecisionNote:\s*text\("privacy_consent_decision_note"\)/);
});

test("startup migration backfills status from the legacy boolean", () => {
  assert.match(bootstrapSource, /ADD COLUMN IF NOT EXISTS privacy_consent_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(bootstrapSource, /WHEN privacy_consent = true THEN 'granted'/);
});

test("public consent acceptance records granted status and public link source", () => {
  const postRouteStart = routeSource.indexOf('router.post("/api/enquiries/consent/:token"');
  const sendRouteStart = routeSource.indexOf('router.post("/api/enquiries/:id/send-consent"');
  assert.notEqual(postRouteStart, -1, "POST consent route must exist");
  assert.notEqual(sendRouteStart, -1, "send-consent route must exist");
  const postRouteSource = routeSource.slice(postRouteStart, sendRouteStart);

  assert.match(postRouteSource, /privacyConsent:\s*true/);
  assert.match(postRouteSource, /privacyConsentStatus:\s*"granted"/);
  assert.match(postRouteSource, /privacyConsentDecisionSource:\s*"public_link"/);
  assert.match(postRouteSource, /privacyConsentDecidedAt:\s*new Date\(\)/);
});

test("superadmin-only manual endpoint requires a note and clears active consent links", () => {
  const routeStart = routeSource.indexOf('router.patch("/api/enquiries/:id/privacy-consent"');
  assert.notEqual(routeStart, -1, "manual consent route must exist");
  const routeEnd = routeSource.indexOf('router.post("/api/enquiries/:id/send-consent"', routeStart);
  const manualRouteSource = routeSource.slice(routeStart, routeEnd);

  assert.match(manualRouteSource, /user\.role\s*!==\s*"superadmin"/);
  assert.match(manualRouteSource, /z\.enum\(\["granted",\s*"refused"\]\)/);
  assert.match(manualRouteSource, /note:\s*z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(manualRouteSource, /privacyConsent:\s*status\s*===\s*"granted"/);
  assert.match(manualRouteSource, /privacyConsentDecisionSource:\s*"manual_admin"/);
  assert.match(manualRouteSource, /consentToken:\s*null/);
  assert.match(manualRouteSource, /consentTokenExpiresAt:\s*null/);
  assert.match(manualRouteSource, /enquiry\.privacy_consent_manual_decision/);
  assert.doesNotMatch(manualRouteSource, /consentUrl/);
});

test("generic enquiry edit route does not accept consent decision fields", () => {
  const editRouteStart = routeSource.indexOf('router.patch("/api/enquiries/:id"');
  const nextRouteStart = routeSource.indexOf('router.get("/api/enquiries/consent/:token"', editRouteStart);
  const editRouteSource = routeSource.slice(editRouteStart, nextRouteStart);

  assert.match(editRouteSource, /stripConsentDecisionFields/);
  assert.doesNotMatch(editRouteSource, /enquiryService\.update\(req\.params\.id,\s*req\.body\)/);
});

test("enquiry details UI shows manual grant/refuse controls only for superadmin", () => {
  assert.match(pageSource, /privacyConsentStatus/);
  assert.match(pageSource, /selectedConsentStatus\s*===\s*"pending"/);
  assert.match(pageSource, /Mark granted/);
  assert.match(pageSource, /Mark refused/);
  assert.match(pageSource, /privacy-consent/);
  assert.match(pageSource, /consentDecisionNote\.trim\(\)/);
  assert.match(pageSource, /isSuperadmin/);
  assert.doesNotMatch(pageSource, /checkbox-edit-privacy-consent/);
});

test("replit docs describe manual consent decisions", () => {
  assert.match(replitSource, /privacyConsentStatus/);
  assert.match(replitSource, /manual superadmin/i);
  assert.match(replitSource, /required audit note/i);
});
