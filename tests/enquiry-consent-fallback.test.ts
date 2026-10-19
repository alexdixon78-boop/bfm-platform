/**
 * Regression test: enquiry consent fallback links are intentionally exposed
 * only from the failed send-consent response, not broad enquiry payloads.
 *
 * Run with: npx tsx tests/enquiry-consent-fallback.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(new URL("../server/routes/enquiry.routes.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../client/src/pages/enquiries.tsx", import.meta.url), "utf8");
const consentPageSource = readFileSync(new URL("../client/src/pages/consent.tsx", import.meta.url), "utf8");

test("send-consent failure returns a copyable fallback link instead of a hard failure", () => {
  assert.match(routeSource, /emailSent:\s*false/);
  assert.match(routeSource, /consentUrl/);
  assert.doesNotMatch(
    routeSource,
    /if \(!sent\) return res\.status\(500\)/,
    "send-consent must not 500 only because email delivery failed",
  );
});

test("enquiry list and detail responses sanitize raw consent tokens", () => {
  assert.match(routeSource, /sanitizeEnquiry/);
  assert.match(routeSource, /sanitizePaginatedEnquiries/);
  assert.match(routeSource, /consentToken:\s*_consentToken/);
});

test("enquiries UI exposes a one-time copy action for failed consent sends", () => {
  assert.match(pageSource, /manualConsentLink/);
  assert.match(pageSource, /Copy consent link/);
  assert.match(pageSource, /navigator\.clipboard\.writeText/);
  assert.match(pageSource, /emailSent\s*===\s*false/);
});

test("public enquiry consent link validates on GET and records only on POST", () => {
  const getRouteStart = routeSource.indexOf('router.get("/api/enquiries/consent/:token"');
  const postRouteStart = routeSource.indexOf('router.post("/api/enquiries/consent/:token"');
  assert.notEqual(getRouteStart, -1, "GET consent route must exist");
  assert.notEqual(postRouteStart, -1, "POST consent route must exist");

  const getRouteSource = routeSource.slice(getRouteStart, postRouteStart);
  const postRouteSource = routeSource.slice(postRouteStart, routeSource.indexOf('router.post("/api/enquiries/:id/send-consent"'));

  assert.doesNotMatch(getRouteSource, /privacyConsent:\s*true/, "GET must not record consent");
  assert.doesNotMatch(getRouteSource, /consentToken:\s*null/, "GET must not consume the token");
  assert.match(postRouteSource, /privacyConsent:\s*true/, "POST must record consent");
  assert.match(postRouteSource, /consentToken:\s*null/, "POST must consume the token after acceptance");
  assert.match(postRouteSource, /enquiry\.privacy_consent_recorded/, "POST should write an audit entry");
});

test("public consent page shows review content before accepting", () => {
  assert.match(consentPageSource, /Checking your consent link/);
  assert.match(consentPageSource, /Privacy Policy Consent/);
  assert.match(consentPageSource, /I give my consent/);
  assert.match(consentPageSource, /View Privacy Policy/);
  assert.match(consentPageSource, /method:\s*"POST"/);
  assert.doesNotMatch(consentPageSource, /Recording your consent/);
});
