/**
 * Regression tests for CIM eligibility and CF10/CF12 parent consent tracking.
 *
 * Run with: npx tsx tests/cim-eligibility.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { computeCimEligibilityReadiness } from "../server/services/cim-eligibility.service";

const url = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => existsSync(url(path)) ? readFileSync(url(path), "utf8") : "";

const schema = read("../shared/schema.ts");
const caseRoutes = read("../server/routes/case.routes.ts");
const caseRepository = read("../server/repositories/case.repository.ts");
const caseService = read("../server/services/case.service.ts");
const storage = read("../server/storage.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const casesPage = read("../client/src/pages/cases.tsx");
const filterSheet = read("../client/src/components/cases/case-filter-sheet.tsx");
const bootstrap = read("../server/db-bootstrap.ts");
const migration = read("../migrations/0015_cim_eligibility.sql");
const journal = read("../migrations/meta/_journal.json");
const repository = read("../server/repositories/cim-consent.repository.ts");
const cimService = read("../server/services/cim-eligibility.service.ts");

const baseCase = { safeguardingStatus: "clear" };
const parties = [
  { id: "party-a", role: "A" },
  { id: "party-b", role: "B" },
];
const approvedMiams = [
  { partyId: "party-a", approvalStatus: "approved" },
  { partyId: "party-b", approvalStatus: "approved" },
];
const grantedConsents = [
  { partyId: "party-a", formType: "cf10", status: "granted" },
  { partyId: "party-b", formType: "cf12", status: "granted" },
];

test("CIM readiness requires both parent parties", () => {
  const readiness = computeCimEligibilityReadiness({
    caseRecord: baseCase,
    parties: [parties[0]],
    miamRecords: approvedMiams,
    consents: grantedConsents,
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.reason === "missing_parent" && b.role === "B"));
});

test("CIM readiness requires both MIAM records to be approved", () => {
  const readiness = computeCimEligibilityReadiness({
    caseRecord: baseCase,
    parties,
    miamRecords: [{ partyId: "party-a", approvalStatus: "submitted" }, approvedMiams[1]],
    consents: grantedConsents,
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.reason === "miam_not_approved" && b.role === "A"));
});

test("CIM readiness requires safeguarding screening to be clear", () => {
  const readiness = computeCimEligibilityReadiness({
    caseRecord: { safeguardingStatus: "pending" },
    parties,
    miamRecords: approvedMiams,
    consents: grantedConsents,
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.reason === "safeguarding_not_clear"));
});

test("CIM readiness requires granted CF10 and CF12 consent", () => {
  const readiness = computeCimEligibilityReadiness({
    caseRecord: baseCase,
    parties,
    miamRecords: approvedMiams,
    consents: [grantedConsents[0], { partyId: "party-b", formType: "cf12", status: "pending" }],
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some((b) => b.reason === "consent_not_granted" && b.formType === "cf12"));
});

test("CIM readiness passes only when both MIAMs, safeguarding, and parent consents are complete", () => {
  const readiness = computeCimEligibilityReadiness({
    caseRecord: baseCase,
    parties,
    miamRecords: approvedMiams,
    consents: grantedConsents,
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
});

test("schema and migrations define CIM eligibility fields and CF10/CF12 consent rows", () => {
  assert.ok(existsSync(url("../migrations/0015_cim_eligibility.sql")), "CIM migration should exist");
  assert.match(schema, /cimEligible:\s*boolean\("cim_eligible"\)\.notNull\(\)\.default\(false\)/);
  assert.match(schema, /cimEligibilityMarkedAt:\s*timestamp\("cim_eligibility_marked_at"\)/);
  assert.match(schema, /cimEligibilityMarkedBy:\s*varchar\("cim_eligibility_marked_by"\)\.references\(\(\) => users\.id/);
  assert.match(schema, /caseCimConsents = pgTable\("case_cim_consents"/);
  assert.match(schema, /CASE_CIM_CONSENT_FORM_TYPES = \["cf10", "cf12"\]/);
  assert.match(schema, /CASE_CIM_CONSENT_STATUSES = \["pending", "granted", "refused"\]/);
  assert.match(schema, /uniqueIndex\("case_cim_consents_case_party_form_unique"\)\.on\(table\.caseId, table\.partyId, table\.formType\)/);

  assert.match(migration, /ALTER TABLE "cases"[\s\S]*"cim_eligible"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "case_cim_consents"/);
  assert.match(migration, /case_cim_consents_case_party_form_unique/);
  assert.match(journal, /0015_cim_eligibility/);

  assert.match(bootstrap, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS cim_eligible/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_cim_consents/);
});

test("backend exposes server-gated CIM readiness and consent mutations", () => {
  assert.ok(existsSync(url("../server/repositories/cim-consent.repository.ts")), "CIM consent repository should exist");
  assert.ok(existsSync(url("../server/services/cim-eligibility.service.ts")), "CIM eligibility service should exist");
  assert.match(repository, /class CimConsentRepository/);
  assert.match(storage, /listCaseCimConsents/);
  assert.match(storage, /upsertCaseCimConsent/);
  assert.match(caseService, /getCimReadiness/);
  assert.match(cimService, /computeCimEligibilityReadiness/);
  assert.match(cimService, /requiredFormTypeForParty/);
  assert.match(cimService, /safeguardingStatus !== "clear"/);
  assert.match(cimService, /approvalStatus !== "approved"/);
  assert.match(cimService, /status !== "granted"/);

  assert.match(caseRoutes, /router\.get\("\/api\/cases\/:id\/cim-eligibility"/);
  assert.match(caseRoutes, /router\.patch\("\/api\/cases\/:id\/cim-consents\/:partyId"/);
  assert.match(caseRoutes, /router\.patch\("\/api\/cases\/:id\/cim-eligibility"/);
  assert.match(caseRoutes, /return res\.status\(409\)\.json\(\{ message: "CIM eligibility requirements are not complete"/);
  assert.match(caseRoutes, /clearCimEligibilityIfNotReady/);
  assert.match(caseService, /clearCimEligibilityIfNotReady/);
  assert.match(caseRoutes, /action: "case_cim_consent_updated"/);
  assert.match(caseRoutes, /action: "case_cim_eligibility_updated"/);
});

test("case detail and case filters surface CIM eligibility without relying on UI-only gating", () => {
  assert.match(caseDetail, /function CimEligibilityCard\(/);
  assert.match(caseDetail, /data-testid="card-cim-eligibility"/);
  assert.match(caseDetail, /\/api\/cases\/\$\{caseId\}\/cim-eligibility/);
  assert.match(caseDetail, /\/api\/cases\/\$\{caseId\}\/cim-consents\/\$\{partyId\}/);
  assert.match(caseDetail, /\/api\/cases\/\$\{caseId\}\/cim-eligibility/);
  assert.match(caseDetail, /data-testid="button-mark-cim-eligible"/);

  assert.match(schema, /cimEligible:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(caseRoutes, /cimEligible:\s*bool\(query\.cimEligible\)/);
  assert.match(caseRepository, /filters\.cimEligible/);
  assert.match(filterSheet, /CIM eligibility/);
  assert.match(casesPage, /cimEligible/);
});
