/**
 * Regression tests for the public applicant update flow:
 * starred services must have proof before the mediator can submit.
 *
 * Run with: npx tsx tests/public-update-proof-required.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(new URL("../client/src/pages/applicant-update.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/mediator-application-link.routes.ts", import.meta.url), "utf8");

test("public update form blocks submit when a starred service has no proof", () => {
  assert.match(pageSource, /const proofRequiredServiceIds/);
  assert.match(pageSource, /hasMissingRequiredServiceProof/);
  assert.match(pageSource, /disabled=\{!canSubmit \|\| hasMissingRequiredServiceProof\}/);
  assert.match(pageSource, /At least one starred service needs a file or link before you can submit/);
});

test("public update endpoint rejects bypassed submissions missing proof for starred services", () => {
  assert.match(routeSource, /missingRequiredServiceProof/);
  assert.match(routeSource, /requestedServiceApprovals/);
  assert.match(routeSource, /submittedServiceApprovals/);
  assert.match(routeSource, /return res\.status\(400\)\.json\(\{ message: `Missing proof for requested service:/);
  assert.match(routeSource, /proofLink\?\.trim\(\)/);
  assert.match(routeSource, /proofFileData\?\.trim\(\)/);
});

test("public update form shows the rejection reason for requested services", () => {
  assert.match(pageSource, /Reason for reupload:/);
  assert.match(pageSource, /reviewReason/);
  assert.match(routeSource, /reviewReason: row\.reviewReason \?\? ""/);
});
