/**
 * Regression checks for derived MoJ voucher eligibility and processing.
 *
 * Run with: npx tsx tests/moj-voucher-eligibility.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES,
  isMojVoucherEligibleCase,
  isVoucherClaimEligibleCase,
} from "../shared/schema";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schema = read("../shared/schema.ts");
const bootstrap = read("../server/db-bootstrap.ts");
const caseRepository = read("../server/repositories/case.repository.ts");
const caseService = read("../server/services/case.service.ts");
const sessionService = read("../server/services/mediation-session.service.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const casesPage = read("../client/src/pages/cases.tsx");
const docs = read("../replit.md");
const migrationPath = new URL("../migrations/0017_moj_voucher_eligibility.sql", import.meta.url);
const migration = existsSync(migrationPath) ? read("../migrations/0017_moj_voucher_eligibility.sql") : "";
const journal = read("../migrations/meta/_journal.json");

test("MoJ voucher eligibility is derived from Family CA/AIM subtype only", () => {
  assert.deepEqual([...MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES], [
    "Child arrangements (CA)",
    "All issues mediation (AIM)",
  ]);

  assert.equal(isMojVoucherEligibleCase({ mediationCategory: "Family", familySubType: "Child arrangements (CA)", issueType: null }), true);
  assert.equal(isMojVoucherEligibleCase({ mediationCategory: "Family", familySubType: "All issues mediation (AIM)", issueType: null }), true);
  assert.equal(isMojVoucherEligibleCase({ mediationCategory: "Family", familySubType: "Property & finance (PF)", issueType: null }), false);
  assert.equal(isMojVoucherEligibleCase({ mediationCategory: "Family", familySubType: "Grandparent", issueType: null }), false);
  assert.equal(isMojVoucherEligibleCase({ mediationCategory: "Workplace", familySubType: "Child arrangements (CA)", issueType: null }), false);
});

test("voucher claim eligibility prefers canonical Family subtype over legacy issue text", () => {
  assert.equal(isVoucherClaimEligibleCase({ mediationCategory: "Family", familySubType: "Child arrangements (CA)", issueType: null }), true);
  assert.equal(isVoucherClaimEligibleCase({ mediationCategory: "Family", familySubType: "All issues mediation (AIM)", issueType: "Children, property & Finance" }), true);
  assert.equal(isVoucherClaimEligibleCase({ mediationCategory: "Family", familySubType: "Property & finance (PF)", issueType: "Children" }), false);
  assert.equal(isVoucherClaimEligibleCase({ mediationCategory: "Workplace", familySubType: "Child arrangements (CA)", issueType: null }), false);
  assert.equal(isVoucherClaimEligibleCase({ mediationCategory: "Family", familySubType: null, issueType: "Child arrangements" }), true);
  assert.equal(isVoucherClaimEligibleCase({ mediationCategory: "Family", familySubType: null, issueType: "Property & finance" }), false);
});

test("schema, migration, and bootstrap persist the derived MoJ voucher flag", () => {
  assert.match(schema, /mojVoucherEligible:\s*boolean\("moj_voucher_eligible"\)\.notNull\(\)\.default\(false\)/);
  assert.match(schema, /index\("cases_moj_voucher_eligible_idx"\)\.on\(table\.mojVoucherEligible\)/);
  assert.match(schema, /MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES[\s\S]*Child arrangements \(CA\)[\s\S]*All issues mediation \(AIM\)/);
  assert.match(schema, /isMojVoucherEligibleCase/);

  assert.ok(existsSync(migrationPath), "0017 MoJ voucher eligibility migration should exist");
  assert.match(migration, /ALTER TABLE "cases"[\s\S]*"moj_voucher_eligible"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "cases_moj_voucher_eligible_idx"/);
  assert.match(migration, /'Child arrangements \(CA\)'[\s\S]*'All issues mediation \(AIM\)'/);
  assert.match(migration, /UPDATE "mediation_session_proposals"[\s\S]*SET "voucher_form_required" = false/);
  assert.match(journal, /0017_moj_voucher_eligibility/);

  assert.match(bootstrap, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS moj_voucher_eligible/);
  assert.match(bootstrap, /CREATE INDEX IF NOT EXISTS cases_moj_voucher_eligible_idx/);
});

test("case write/read paths recalculate and expose MoJ voucher eligibility", () => {
  assert.match(caseRepository, /mojVoucherEligible: r\.moj_voucher_eligible as boolean/);
  assert.match(caseRepository, /mojVoucherEligible: isMojVoucherEligibleCase/);
  assert.match(caseService, /update\.mojVoucherEligible = isMojVoucherEligibleCase/);
  assert.match(caseDetail, /MoJ Voucher Eligible/);
  assert.match(casesPage, /mojVoucherEligible/);
});

test("mediation-session voucher forms use explicit voucher claim eligibility, not the derived MoJ badge alone", () => {
  assert.match(sessionService, /const voucherFormRequired = Boolean\(c\.voucherClaimEligible\)/);
  assert.match(sessionService, /voucherFormRequired: Boolean\(heldCase\.voucherClaimEligible\)/);
  assert.match(caseDetail, /Voucher applied to session invoices/);
  assert.match(caseDetail, /button-toggle-voucher-claim-eligibility/);
  assert.match(sessionService, /const hasVoucherForms = forms\.some/);
  assert.match(sessionService, /Voucher consent is issued after an approved MIAM voucher decision\./);
});

test("replit documentation records the MoJ voucher eligibility rule", () => {
  assert.match(docs, /MoJ Voucher Eligibility/);
  assert.match(docs, /derived\/cache marker from the canonical Family subtype/);
  assert.match(docs, /Child arrangements \(CA\)/);
  assert.match(docs, /All issues mediation \(AIM\)/);
  assert.match(docs, /while `Property & finance \(PF\)` is excluded/);
  assert.match(docs, /explicit `voucherClaimEligible` setting/);
});
