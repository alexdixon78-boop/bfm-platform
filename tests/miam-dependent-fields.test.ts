/**
 * Regression checks for MIAM dependent fields controlled by Yes/No/N/A answers.
 *
 * Run with: npx tsx tests/miam-dependent-fields.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const componentSource = read("../client/src/components/miam-record-tab.tsx");
const routeSource = read("../server/routes/miam-record.routes.ts");
const pdfSource = read("../server/services/miam-pdf.service.ts");

test("MIAM client clears top-level dependent fields when controllers are not yes", () => {
  assert.match(componentSource, /const TOP_LEVEL_DEPENDENT_FIELD_CLEARS/);
  assert.match(componentSource, /ppcRequired:[\s\S]*ppcReason: \[\][\s\S]*ppcReasonOther: null[\s\S]*ppcDate: null[\s\S]*ppcConsultantName: null[\s\S]*ppcOutcomes: null/);
  assert.match(componentSource, /referralToChildrenServices:[\s\S]*referralToChildrenServicesDetails: null[\s\S]*referralFollowUpContact: null/);
  assert.match(componentSource, /welfareAgencyContacted:[\s\S]*welfareAgencyName: null[\s\S]*welfareAgencyDate: null[\s\S]*welfareAgencyTime: null/);
  assert.match(componentSource, /married:[\s\S]*dateOfMarriage: null[\s\S]*divorceStarted: null[\s\S]*decreeAbsoluteDate: null/);
  assert.match(componentSource, /childInclusiveExplained:[\s\S]*childInclusiveClientResponse: null[\s\S]*childInclusiveConsentAgreed: null[\s\S]*childInclusiveNotes: null/);
  assert.match(componentSource, /normalizeMiamDependentFields\(\{ \.\.\.prev, \[field\]: value \}\)/);
  assert.match(componentSource, /JSON\.stringify\(normalizeMiamDependentFields\(formData\)\)/);
});

test("MIAM client only renders dependent edit fields when controllers allow them", () => {
  assert.match(componentSource, /\{ppcRequiredYes && \(/);
  assert.match(componentSource, /ppcReasons\.includes\("Other"\)/);
  assert.match(componentSource, /\{referralToChildrenServicesYes && \(/);
  assert.match(componentSource, /\{welfareAgencyContactedYes && \(/);
  assert.match(componentSource, /\{childInclusiveExplainedYes && \(/);
  assert.match(componentSource, /\{marriedYes && \(/);
  assert.match(componentSource, /\{livedTogetherYes && \(/);
  assert.match(componentSource, /\{divorceStartedYes && \(/);
  assert.match(componentSource, /const showFurtherInfoNotes = isYes\(val\.status\)/);
  assert.match(componentSource, /const showChecklistNotes = isYesOrNo\(val\.status\)/);
});

test("MIAM server normalizes dependent fields for direct saves and edit-request flows", () => {
  assert.match(routeSource, /const MIAM_DEPENDENT_FIELD_CLEARS/);
  assert.match(routeSource, /function normalizeMiamDependentFields/);
  assert.match(routeSource, /updateData = normalizeMiamDependentFields\(/);
  assert.match(routeSource, /const normalizedProposedData = normalizeMiamDependentFields\(parsed\.data as Record<string, unknown>, currentData\)/);
  assert.match(routeSource, /finalChanges = normalizeMiamDependentFields\(parsed\.data as Record<string, unknown>, record as Record<string, unknown>\)/);
  assert.match(routeSource, /next\["furtherInfoRequested"\] = normalizeMiamNestedNotes\(readValue\("furtherInfoRequested"\), isMiamYes\)/);
  assert.match(routeSource, /next\["checklist"\] = normalizeMiamNestedNotes\(readValue\("checklist"\), isMiamYesOrNo\)/);
});

test("MIAM PDF hides dependent values when controllers do not allow them", () => {
  assert.match(pdfSource, /const ppcRequiredYes = record\.ppcRequired === "yes"/);
  assert.match(pdfSource, /if \(ppcRequiredYes && ppcReasons\.length > 0\)/);
  assert.match(pdfSource, /if \(ppcRequiredYes\) \{[\s\S]*PPC discussion date/);
  assert.match(pdfSource, /const referralToChildrenServicesYes = record\.referralToChildrenServices === "yes"/);
  assert.match(pdfSource, /if \(referralToChildrenServicesYes && s\(record\.referralToChildrenServicesDetails\)\)/);
  assert.match(pdfSource, /if \(welfareAgencyContactedYes\) \{[\s\S]*Agency name/);
  assert.match(pdfSource, /if \(childInclusiveExplainedYes\) \{[\s\S]*Client's response/);
  assert.match(pdfSource, /if \(showSuitabilityReasons && s\(record\.suitabilityReasons\)\)/);
});
