/**
 * Regression tests for the demographic form token flow and client reminder gate.
 *
 * Run with: npx tsx tests/demographic-form-flow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getMissingClientDemographicFields, isClientDemographicComplete, REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS } from "../server/utils/demographic-completion";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const formSource = readFileSync(new URL("../client/src/pages/demographic-form.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/demographic.routes.ts", import.meta.url), "utf8");
const caseRouteSource = readFileSync(new URL("../server/routes/case.routes.ts", import.meta.url), "utf8");
const caseDetailSource = readFileSync(new URL("../client/src/pages/case-detail.tsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../client/src/components/layout/dashboard-layout.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../client/src/pages/dashboard.tsx", import.meta.url), "utf8");

test("public demographic form hard-renames the old miam-form route", () => {
  assert.match(appSource, /path="\/demographic-form\/:token"/);
  assert.doesNotMatch(appSource, /path="\/miam-form\/:token"/);
  assert.match(formSource, /useRoute\("\/demographic-form\/:token"\)/);
  assert.match(formSource, /\/api\/public\/demographic-form/);
  assert.doesNotMatch(formSource, /\/api\/public\/miam-form/);
});

test("backend public routes and generated links use demographic-form", () => {
  assert.match(routeSource, /\/api\/public\/demographic-form\/:token/);
  assert.match(routeSource, /\/demographic-form\/\$\{token\}/);
  assert.match(routeSource, /sendDemographicFormEmail/);
  assert.match(routeSource, /send_demographic_form/);
  assert.match(routeSource, /submit_demographic_form/);
  assert.doesNotMatch(routeSource, /\/api\/public\/miam-form\/:token/);
  assert.doesNotMatch(routeSource, /\/miam-form\/\$\{token\}/);
});

test("mandatory demographic completion does not trust completedAt alone", () => {
  const blankCompletedRecord = { completedAt: new Date(), workplaceCaseSubtype: "General mediation" };
  assert.equal(isClientDemographicComplete(blankCompletedRecord), false);
  assert.deepEqual(getMissingClientDemographicFields(blankCompletedRecord), [...REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS]);

  const completeRecord = {
    completedAt: new Date(),
    genderIdentity: "Prefer not to say",
    ethnicity: "Prefer not to say",
    firstLanguage: "English",
    interpreterNeeded: "No",
    employmentStatus: "Prefer not to say",
    legalAidEligible: "Unknown or not yet assessed",
    voucherSchemeEligible: "Not applicable",
    courtProceedingsStatus: "Unknown",
    cafcassInvolved: "Unknown",
    lifeSatisfaction: 0,
    anxietyScore: 0,
    emotionalWellbeing: 1,
  };
  assert.equal(isClientDemographicComplete(completeRecord), true);
  assert.deepEqual(getMissingClientDemographicFields(completeRecord), []);
});

test("client missing-demographics endpoint uses mandatory completion helper and skips closed cases", () => {
  assert.match(caseRouteSource, /isClientDemographicComplete\(dem\)/);
  assert.match(caseRouteSource, /c\.status === "Archived" \|\| c\.status === "Closed"/);
  assert.doesNotMatch(caseRouteSource, /!dem \|\| !dem\.completedAt/);
});

test("missing demographic reminder is mounted in the client layout, not only dashboard", () => {
  assert.match(layoutSource, /MissingDemographicsModal/);
  assert.match(layoutSource, /\/api\/client\/cases\/missing-demographics/);
  assert.match(layoutSource, /const isClientDashboard = location === "\/dashboard" \|\| location === "\/"/);
  assert.match(layoutSource, /if \(isClientDashboard\) \{\s*setDemogModalOpen\(false\);\s*return;\s*\}/);
  assert.match(layoutSource, /sessionStorage\.getItem\("bfm:demogPromptDismissed"\)/);
  assert.match(layoutSource, /sessionStorage\.setItem\("bfm:demogPromptDismissed", "1"\)/);
  assert.doesNotMatch(dashboardSource, /MissingDemographicsModal/);
});

test("case detail demographic edit uses sliders for baseline wellbeing", () => {
  assert.match(caseDetailSource, /import \{ Slider \} from "@\/components\/ui\/slider"/);
  assert.match(caseDetailSource, /data-testid="slider-edit-life-satisfaction"/);
  assert.match(caseDetailSource, /data-testid="slider-edit-anxiety"/);
  assert.match(caseDetailSource, /data-testid="slider-edit-emotional-wellbeing"/);
  assert.doesNotMatch(caseDetailSource, /data-testid="input-edit-lifeSatisfaction"/);
  assert.doesNotMatch(caseDetailSource, /data-testid="input-edit-anxietyScore"/);
  assert.doesNotMatch(caseDetailSource, /data-testid="select-edit-emotionalWellbeing"/);
});

test("client demographic completion notifies superadmins once on completion transition", () => {
  assert.match(routeSource, /import \{ notificationService \} from "\.\.\/services\/notification\.service"/);
  assert.match(routeSource, /async function notifySuperadminDemographicCompleted/);
  assert.match(routeSource, /notificationService\.createNotification\(\{/);
  assert.match(routeSource, /recipientRole: "superadmin"/);
  assert.match(routeSource, /type: "demographic_data_completed"/);
  assert.match(routeSource, /urgency: "green"/);
  assert.match(routeSource, /caseNoteRequired: false/);
  assert.match(routeSource, /const wasClientDemographicComplete = isClientDemographicComplete\(existingDemographicData\)/);
  assert.match(routeSource, /user\.role === "client" && !wasClientDemographicComplete && isClientDemographicComplete\(data\)/);
  assert.match(routeSource, /if \(!wasClientDemographicComplete && isClientDemographicComplete\(data\)\)/);
});

test("case detail client completions refresh dashboard pending actions", () => {
  assert.match(caseDetailSource, /import \{ queryClient, apiRequest, refreshClientDashboardActions \} from "@\/lib\/queryClient"/);
  assert.match(caseDetailSource, /refreshClientDashboardActions\(\)/);
  assert.match(caseDetailSource, /apiRequest\("PUT", `\/api\/demographic-data\/party\/\$\{party\.id\}`/);
  assert.match(caseDetailSource, /apiRequest\("POST", `\/api\/party-required-forms\/\$\{formId\}\/sign`/);
});
