/**
 * Regression tests for the case detail Overview MIAM readiness card.
 *
 * Run with: npx tsx tests/case-detail-miam-readiness-overview.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const caseDetailSource = readFileSync(new URL("../client/src/pages/case-detail.tsx", import.meta.url), "utf8");
const intakeWorkflowSource = readFileSync(new URL("../client/src/components/enquiry-intake-workflow-card.tsx", import.meta.url), "utf8");
const caseRoutesSource = readFileSync(new URL("../server/routes/case.routes.ts", import.meta.url), "utf8");
const caseRepositorySource = readFileSync(new URL("../server/repositories/case.repository.ts", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../server/storage.ts", import.meta.url), "utf8");
const caseServiceSource = readFileSync(new URL("../server/services/case.service.ts", import.meta.url), "utf8");
const sharedSchemaSource = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const bookingOnboardingSource = readFileSync(new URL("../server/services/booking-onboarding.ts", import.meta.url), "utf8");
const docsSource = readFileSync(new URL("../replit.md", import.meta.url), "utf8");

test("case detail uses a shared MIAM readiness card for overview and mediation sessions", () => {
  assert.match(caseDetailSource, /function MiamReadinessCard\(/);
  assert.match(caseDetailSource, /dataTestId="card-overview-miam-readiness"/);
  assert.match(caseDetailSource, /dataTestId="card-mediation-readiness"/);
});

test("overview intake workflow appears below source enquiry and owns the case shuttle control", () => {
  const sourceSummaryIndex = caseDetailSource.indexOf("<SourceEnquirySummaryCard");
  const intakeWorkflowIndex = caseDetailSource.indexOf("<IntakeWorkflowCard");

  assert.notEqual(sourceSummaryIndex, -1);
  assert.notEqual(intakeWorkflowIndex, -1);
  assert.ok(sourceSummaryIndex < intakeWorkflowIndex, "Intake workflow should render after Source Enquiry summary");
  assert.match(caseDetailSource, /shuttleControl=\{\{/);
  assert.doesNotMatch(caseDetailSource, /data-testid="card-shuttle-mediation"/);
});

test("case detail hides full intake workflow from mediators and shows compact intake badges", () => {
  assert.match(caseDetailSource, /\{isAdmin && !isSessionObserverOnly && \(\s*<IntakeWorkflowCard/);
  assert.match(caseDetailSource, /mode="safeguarding-only"/);
  assert.doesNotMatch(caseDetailSource, /\{isStaff && !isClient && !isSessionObserverOnly && \(\s*<IntakeWorkflowCard/);
  assert.match(caseDetailSource, /const showMediatorIntakeBadges = user\?\.role === "mediator" && !isClient && !isSessionObserverOnly/);
  assert.match(caseDetailSource, /data-testid="mediator-intake-badges"/);
  assert.match(caseDetailSource, /data-testid="badge-mediator-intake-status"/);
  assert.match(caseDetailSource, /data-testid="badge-mediator-safeguarding-status"/);
  assert.match(caseDetailSource, /data-testid="badge-mediator-first-contact-status"/);
  assert.match(caseDetailSource, /data-testid="badge-mediator-intake-closed"/);
});

test("case overview intake card uses safeguarding-only mode without claim, chase, or intake closure sections", () => {
  assert.match(intakeWorkflowSource, /mode\?: "full" \| "safeguarding-only"/);
  assert.match(intakeWorkflowSource, /const safeguardingOnly = mode === "safeguarding-only"/);
  assert.match(intakeWorkflowSource, /<SafeguardingGatePanel/);
  assert.match(intakeWorkflowSource, /!safeguardingOnly && \(\s*<FunctionalIntakeProgress/);
  assert.match(intakeWorkflowSource, /!safeguardingOnly && \(\s*<div className="rounded-lg border border-\[#a7baa4\]\/40 bg-\[#a7baa4\]\/10 p-4" data-testid="intake-next-action-summary"/);
  assert.match(intakeWorkflowSource, /!safeguardingOnly && \(\s*<>/);
  assert.match(intakeWorkflowSource, /data-testid="section-intake-safeguarding"/);
  assert.match(intakeWorkflowSource, /data-testid="panel-safeguarding-gate"/);
  assert.match(intakeWorkflowSource, /shuttleControl\?:/);
  assert.match(intakeWorkflowSource, /data-testid="section-case-safeguarding-shuttle"/);
  assert.match(intakeWorkflowSource, /data-testid="switch-shuttle-mediation"/);
});

test("safeguarding gate uses a shared status-aware decision panel", () => {
  assert.match(intakeWorkflowSource, /function SafeguardingGatePanel/);
  assert.match(intakeWorkflowSource, /function getSafeguardingStatusMeta/);
  assert.match(intakeWorkflowSource, /Pending/);
  assert.match(intakeWorkflowSource, /Clear/);
  assert.match(intakeWorkflowSource, /Concern raised/);
  assert.match(intakeWorkflowSource, /data-testid="badge-safeguarding-status"/);
  assert.match(intakeWorkflowSource, /data-testid="safeguarding-status-help"/);
  assert.match(intakeWorkflowSource, /data-testid="panel-safeguarding-gate"/);
  assert.match(intakeWorkflowSource, /data-testid="button-safeguarding-clear"/);
  assert.match(intakeWorkflowSource, /data-testid="button-safeguarding-concern"/);
  assert.match(intakeWorkflowSource, /data-testid="button-notify-rebecca"/);
  assert.doesNotMatch(intakeWorkflowSource, /Record the safeguarding decision before contact, chase, or closure actions/);
  assert.doesNotMatch(intakeWorkflowSource, /Recording a decision assigns unclaimed intake work to you/);
});

test("overview MIAM readiness appears below safeguarding intake card and before Case Notes", () => {
  const intakeWorkflowIndex = caseDetailSource.indexOf("<IntakeWorkflowCard");
  const overviewReadinessIndex = caseDetailSource.indexOf('dataTestId="card-overview-miam-readiness"');
  const caseNotesIndex = caseDetailSource.indexOf("<CaseNotesCard");

  assert.notEqual(intakeWorkflowIndex, -1);
  assert.notEqual(overviewReadinessIndex, -1);
  assert.notEqual(caseNotesIndex, -1);
  assert.ok(intakeWorkflowIndex < overviewReadinessIndex, "Overview MIAM readiness card should render after safeguarding intake card");
  assert.ok(overviewReadinessIndex < caseNotesIndex, "Overview MIAM readiness card should render before Case Notes");
});

test("overview MIAM readiness button switches to the mediation sessions tab", () => {
  assert.match(caseDetailSource, /data-testid="button-go-mediation-sessions"/);
  assert.match(caseDetailSource, /setActiveTab\("mediation-sessions"\)/);
});

test("overview MIAM readiness query uses the shared mediation sessions cache key", () => {
  assert.match(caseDetailSource, /queryKey:\s*\["\/api\/cases",\s*caseId,\s*"mediation-sessions"\]/);
  assert.match(caseDetailSource, /enabled:\s*!!caseId\s*&&\s*isAdmin\s*&&\s*!isMiamOnlyMediator\s*&&\s*!isSessionObserverOnly/);
});

test("case information exposes admin case type and subtype controls from shared schema constants", () => {
  assert.match(caseDetailSource, /MEDIATION_CATEGORIES/);
  assert.match(caseDetailSource, /FAMILY_CASE_SUBTYPES/);
  assert.match(caseDetailSource, /CIVIL_CASE_SUBTYPES/);
  assert.match(caseDetailSource, /COMMERCIAL_CASE_SUBTYPES/);
  assert.match(caseDetailSource, /OTHER_CASE_SUBTYPES/);
  assert.match(sharedSchemaSource, /"Child arrangements \(CA\)"/);
  assert.match(sharedSchemaSource, /"Property & finance \(PF\)"/);
  assert.match(sharedSchemaSource, /"All issues mediation \(AIM\)"/);
  assert.match(caseDetailSource, /isAdmin\s*=\s*user\?\.role === "superadmin" \|\| user\?\.role === "subadmin"/);
  assert.match(caseDetailSource, /data-testid="select-case-type"/);
  assert.match(caseDetailSource, /data-testid="select-case-subtype"/);
  assert.match(caseDetailSource, /\/api\/cases\/\$\{caseId\}\/type/);
});

test("case information shows inline pending feedback for immediate-save selects", () => {
  const cardStart = caseDetailSource.indexOf("function CaseInformationCard");
  const cardEnd = caseDetailSource.indexOf("function SourceEnquirySummaryCard", cardStart);
  const cardSource = caseDetailSource.slice(cardStart, cardEnd);

  assert.match(cardSource, /Loader2/);
  assert.match(cardSource, /caseTypePendingField/);
  assert.match(cardSource, /onSettled:\s*\(\)\s*=>\s*setCaseTypePendingField\(null\)/);
  assert.match(cardSource, /data-testid="text-case-type-updating"/);
  assert.match(cardSource, /data-testid="text-case-subtype-updating"/);
  assert.match(cardSource, /data-testid="text-lead-mediator-updating"/);
});

test("project docs mention Case Information inline pending feedback", () => {
  assert.match(docsSource, /Case Information card/);
  assert.match(docsSource, /inline pending feedback/);
  assert.match(docsSource, /case type, subtype, and lead mediator/);
});

test("case filter cache normalizes legacy family subtype values into client-friendly labels", () => {
  assert.match(bookingOnboardingSource, /normalizeFamilyCaseSubtype/);
  assert.match(caseServiceSource, /normalizeFamilyCaseSubtype\(d\.familyCaseSubtype\)/);
});

test("migration repairs legacy family subtype labels in stored rows", () => {
  const migrationSource = readFileSync(new URL("../migrations/0010_client_friendly_family_subtypes.sql", import.meta.url), "utf8");
  assert.match(migrationSource, /cases/);
  assert.match(migrationSource, /demographic_data/);
  assert.match(migrationSource, /miam_records/);
  assert.match(migrationSource, /Child arrangements \(CA\)/);
  assert.match(migrationSource, /Property & finance \(PF\)/);
  assert.match(migrationSource, /All issues mediation \(AIM\)/);
});

test("case type route is admin-gated, validates subtype pairs, and clears stale subtype fields", () => {
  assert.match(caseRoutesSource, /router\.patch\("\/api\/cases\/:id\/type", requirePermission\("cases", "edit"\)/);
  assert.match(caseRoutesSource, /user\.role !== "superadmin" && user\.role !== "subadmin"/);
  assert.match(caseRoutesSource, /isValidMediationCategory/);
  assert.match(caseRoutesSource, /subtypeOptionsForCategory\(mediationCategory\)\.includes\(subType\)/);
  assert.match(caseRoutesSource, /updateCaseType\(req\.params\.id/);
  assert.match(caseRepositorySource, /async updateCaseType/);
  assert.match(caseRepositorySource, /familySubType: null/);
  assert.match(caseRepositorySource, /workplaceSubType: null/);
  assert.match(caseRepositorySource, /civilSubType: null/);
  assert.match(caseRepositorySource, /commercialSubType: null/);
  assert.match(caseRepositorySource, /otherSubType: null/);
  assert.match(storageSource, /updateCaseType\(id: string, data:/);
});

test("source enquiry overview card is visible only to case admins", () => {
  assert.match(caseDetailSource, /\{isAdmin && <SourceEnquirySummaryCard caseData=\{caseData\} \/>\}/);
  assert.doesNotMatch(caseDetailSource, /\{!isClient && <SourceEnquirySummaryCard caseData=\{caseData\} \/>\}/);
});

test("case detail service only includes source enquiry for admin users", () => {
  assert.match(caseServiceSource, /const isAdmin = user\.role === "superadmin" \|\| user\.role === "subadmin"/);
  assert.match(caseServiceSource, /if \(isAdmin\) \{\s*try \{/);
  assert.match(caseServiceSource, /\.\.\.\(isAdmin \? \{ sourceEnquiry \} : \{\}\)/);
});

test("case information exposes admin-only close case dialog using enquiry closure reasons", () => {
  assert.match(caseDetailSource, /CASE_CLOSURE_REASONS/);
  assert.match(caseDetailSource, /data-testid="button-open-close-case"/);
  assert.match(caseDetailSource, /data-testid="dialog-close-case"/);
  assert.match(caseDetailSource, /data-testid="select-case-closure-reason"/);
  assert.match(caseDetailSource, /data-testid="textarea-case-closure-details"/);
  assert.match(caseDetailSource, /data-testid="select-case-follow-up-consent"/);
  assert.match(caseDetailSource, /data-testid="input-case-close-life-satisfaction"/);
  assert.match(caseDetailSource, /data-testid="input-case-close-anxiety"/);
  assert.match(caseDetailSource, /data-testid="input-case-close-service-rating"/);
  assert.match(caseDetailSource, /data-testid="input-case-close-nps"/);
  assert.match(caseDetailSource, /data-testid="text-info-closed-by"/);
  assert.match(caseDetailSource, /data-testid="text-info-follow-up-consent"/);
  assert.match(caseDetailSource, /data-testid="text-info-closure-scores"/);
  assert.match(caseDetailSource, /\/api\/cases\/\$\{caseId\}\/close/);
  assert.match(caseDetailSource, /isAdmin && caseData\.status !== "Closed" && caseData\.status !== "Archived"/);
});

test("case close route is admin-gated, validates reason, persists closure fields, and logs", () => {
  assert.match(caseRoutesSource, /router\.patch\("\/api\/cases\/:id\/close", requirePermission\("cases", "edit"\)/);
  assert.match(caseRoutesSource, /user\.role !== "superadmin" && user\.role !== "subadmin"/);
  assert.match(caseRoutesSource, /isValidClosureReason\(closureReason\)/);
  assert.match(caseRoutesSource, /existing\.status === "Closed" \|\| existing\.status === "Archived"/);
  assert.match(caseRoutesSource, /updateCaseClosure\(req\.params\.id/);
  assert.match(caseRoutesSource, /action: "case_closed"/);
  assert.match(caseRoutesSource, /title: "Case closed"/);
  assert.match(caseRepositorySource, /async updateCaseClosure/);
  assert.match(caseRepositorySource, /status: "Closed"/);
  assert.match(caseRepositorySource, /closureReason: data\.closureReason/);
  assert.match(caseRepositorySource, /closureDetails: data\.closureDetails/);
  assert.match(caseRepositorySource, /closureDate: now/);
  assert.match(caseRepositorySource, /caseClosureRecords/);
  assert.match(caseRepositorySource, /closedById: data\.closedById/);
  assert.match(caseRepositorySource, /outreachExcluded: data\.followUpConsentStatus === "declined"/);
  assert.match(storageSource, /updateCaseClosure\(id: string, data:/);
});
