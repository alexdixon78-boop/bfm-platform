/**
 * Static regression checks for the case-level Draft Financial Schedule feature.
 *
 * Run with: npx tsx tests/draft-financial-schedule-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schema = read("../shared/schema.ts");
const storage = read("../server/storage.ts");
const financialService = read("../server/services/financial-disclosure.service.ts");
const repository = read("../server/repositories/financial-disclosure.repository.ts");
const routes = read("../server/routes/mediation-session.routes.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const activityTimeline = read("../client/src/components/case-activity-timeline.tsx");
const courtFormRoutes = read("../server/routes/court-form.routes.ts");
const courtFormsPage = read("../client/src/pages/court-forms.tsx");
const courtFormRepository = read("../server/repositories/court-form.repository.ts");
const migrationPath = new URL("../migrations/0024_case_draft_financial_schedule.sql", import.meta.url);
const confirmationMigrationPath = new URL("../migrations/0026_draft_financial_schedule_confirmation.sql", import.meta.url);
const versionMigrationPath = new URL("../migrations/0030_case_draft_financial_schedule_versions.sql", import.meta.url);
const sessionMigrationPath = new URL("../migrations/0064_session_draft_financial_schedules.sql", import.meta.url);
const bootstrap = read("../server/db-bootstrap.ts");

test("schema, migration, repository, and storage define one draft financial schedule per mediation session", () => {
  assert.match(schema, /caseDraftFinancialSchedules = pgTable\("case_draft_financial_schedules"/);
  assert.match(schema, /caseId: varchar\("case_id"\)\.notNull\(\)\.references\(\(\) => cases\.id/);
  assert.match(schema, /DRAFT_FINANCIAL_SCHEDULE_STATUSES[\s\S]*"draft"[\s\S]*"submitted"[\s\S]*"approved"[\s\S]*"archived"/);
  assert.match(schema, /mediationSessionId: varchar\("mediation_session_id"\)\.references\(\(\) => mediationSessions\.id/);
  assert.match(schema, /confirmedAt: timestamp\("confirmed_at"\)/);
  assert.match(schema, /confirmedBy: varchar\("confirmed_by"\)\.references\(\(\) => users\.id, \{ onDelete: "set null" \}\)/);
  assert.match(schema, /confirmedInSessionId: varchar\("confirmed_in_session_id"\)\.references\(\(\) => mediationSessions\.id, \{ onDelete: "set null" \}\)/);
  assert.match(schema, /uniqueIndex\("case_draft_financial_schedules_session_unique"\)\.on\(table\.mediationSessionId\)/);
  assert.match(schema, /insertCaseDraftFinancialScheduleSchema/);
  assert.match(schema, /export type CaseDraftFinancialSchedule/);
  assert.ok(existsSync(migrationPath), "0024 draft schedule migration must exist");
  const migration = read("../migrations/0024_case_draft_financial_schedule.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "case_draft_financial_schedules"/);
  assert.match(migration, /"case_id" varchar NOT NULL/);
  assert.ok(existsSync(sessionMigrationPath), "session draft schedule migration must exist");
  const sessionMigration = read("../migrations/0064_session_draft_financial_schedules.sql");
  assert.match(sessionMigration, /ADD COLUMN IF NOT EXISTS "mediation_session_id" varchar/);
  assert.match(sessionMigration, /DROP INDEX IF EXISTS "case_draft_financial_schedules_case_unique"/);
  assert.match(sessionMigration, /case_draft_financial_schedules_session_unique/);
  assert.ok(existsSync(confirmationMigrationPath), "0026 draft schedule confirmation migration must exist");
  const confirmationMigration = read("../migrations/0026_draft_financial_schedule_confirmation.sql");
  assert.match(confirmationMigration, /ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp/);
  assert.match(confirmationMigration, /ADD COLUMN IF NOT EXISTS "confirmed_by" varchar/);
  assert.match(confirmationMigration, /ADD COLUMN IF NOT EXISTS "confirmed_in_session_id" varchar/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_draft_financial_schedules/);
  assert.match(bootstrap, /ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP/);
  assert.match(bootstrap, /ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR/);
  assert.match(bootstrap, /ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS confirmed_in_session_id VARCHAR/);
  assert.match(repository, /getDraftScheduleBySession/);
  assert.match(repository, /upsertDraftSchedule/);
  assert.match(storage, /getMediationSessionDraftFinancialSchedule\(sessionId: string\)/);
  assert.match(storage, /upsertCaseDraftFinancialSchedule/);
});

test("draft financial schedule version history stores immutable snapshots with activity metadata", () => {
  assert.match(schema, /caseDraftFinancialScheduleVersions = pgTable\("case_draft_financial_schedule_versions"/);
  assert.match(schema, /scheduleId: varchar\("schedule_id"\)\.notNull\(\)\.references\(\(\) => caseDraftFinancialSchedules\.id/);
  assert.match(schema, /caseId: varchar\("case_id"\)\.notNull\(\)\.references\(\(\) => cases\.id/);
  assert.match(schema, /versionNumber: integer\("version_number"\)\.notNull\(\)/);
  assert.match(schema, /editedBy: varchar\("edited_by"\)\.references\(\(\) => users\.id, \{ onDelete: "set null" \}\)/);
  assert.match(schema, /editedAt: timestamp\("edited_at"\)\.notNull\(\)\.defaultNow\(\)/);
  assert.match(schema, /source: text\("source"\)\.notNull\(\)/);
  assert.match(schema, /confirmedInSessionId: varchar\("confirmed_in_session_id"\)\.references\(\(\) => mediationSessions\.id, \{ onDelete: "set null" \}\)/);
  assert.match(schema, /uniqueIndex\("case_draft_financial_schedule_versions_schedule_version_unique"\)\.on\(table\.scheduleId, table\.versionNumber\)/);
  assert.match(schema, /insertCaseDraftFinancialScheduleVersionSchema/);
  assert.match(schema, /export type CaseDraftFinancialScheduleVersion/);
  assert.ok(existsSync(versionMigrationPath), "0030 draft schedule version migration must exist");
  const versionMigration = read("../migrations/0030_case_draft_financial_schedule_versions.sql");
  assert.match(versionMigration, /CREATE TABLE IF NOT EXISTS "case_draft_financial_schedule_versions"/);
  assert.match(versionMigration, /"version_number" integer NOT NULL/);
  assert.match(versionMigration, /case_draft_financial_schedule_versions_schedule_version_unique/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_draft_financial_schedule_versions/);
  assert.match(repository, /listDraftScheduleVersions\(scheduleId: string\)/);
  assert.match(repository, /createDraftScheduleVersion/);
  assert.match(repository, /getNextDraftScheduleVersionNumber\(scheduleId: string\)/);
  assert.match(storage, /listDraftScheduleVersions\(scheduleId: string\)/);
  assert.match(storage, /createCaseDraftFinancialScheduleVersion/);
  assert.match(storage, /getNextDraftScheduleVersionNumber\(scheduleId: string\)/);
  assert.match(financialService, /latestVersion/);
  assert.match(financialService, /versions/);
  assert.match(financialService, /editedByName/);
  assert.match(financialService, /createCaseDraftFinancialScheduleVersion/);
  assert.match(financialService, /getNextDraftScheduleVersionNumber/);
  assert.match(financialService, /Draft Financial Schedule saved/);
  assert.match(financialService, /Draft Financial Schedule confirmed/);
  assert.match(financialService, /draft_financial_schedule_saved/);
  assert.match(financialService, /draft_financial_schedule_confirmed/);
  assert.match(financialService, /versionNumber/);
  assert.doesNotMatch(financialService, /metadata:[\s\S]{0,300}payload/);
  assert.match(routes, /latestVersion: result\.latestVersion/);
  assert.match(routes, /versions: result\.versions/);
  assert.match(routes, /latestVersion: refreshed\.latestVersion/);
  assert.match(routes, /versions: refreshed\.versions/);
  assert.match(caseDetail, /latestVersion/);
  assert.match(caseDetail, /draft-financial-schedule-latest-version/);
  assert.match(caseDetail, /Last edited/);
  assert.match(activityTimeline, /draft_financial_schedule_saved/);
  assert.match(activityTimeline, /draft_financial_schedule_confirmed/);
});

test("routes expose staff-only draft schedule read, save, and PDF export endpoints", () => {
  assert.match(routes, /\/api\/cases\/:id\/draft-financial-schedule"/);
  assert.match(routes, /\/api\/cases\/:id\/draft-financial-schedule\/preview\.pdf/);
  assert.match(routes, /\/api\/cases\/:id\/draft-financial-schedule\/export\.pdf/);
  assert.match(routes, /getDraftFinancialSchedule\(req\.params\.id,\s*user\)/);
  assert.match(routes, /saveDraftFinancialSchedule\(req\.params\.id,\s*user,\s*parsed\.data\)/);
  assert.match(routes, /previewDraftFinancialSchedulePdf\(req\.params\.id,\s*user,\s*parsed\.data\)/);
  assert.match(routes, /exportDraftFinancialSchedulePdf\(req\.params\.id,\s*user\)/);
  assert.match(routes, /Content-Type", "application\/pdf"/);
  assert.match(routes, /hasFinancialCaseAccess\(await classifyCaseAccess\(caseId, user\)\)/);
  assert.match(routes, /status: z\.enum\(DRAFT_FINANCIAL_SCHEDULE_STATUSES\)\.optional\(\)/);
  assert.match(routes, /presenceAttestation/);
  assert.match(financialService, /Clients cannot view the draft financial schedule/);
  assert.match(financialService, /Only staff can update draft financial schedules/);
  assert.match(financialService, /Only staff can export draft financial schedules/);
  assert.match(financialService, /No current DRAFT FINANCIAL SCHEDULE PDF template is configured/);
  assert.match(financialService, /getAutoMappedDraftFinancialScheduleTemplate/);
  assert.match(financialService, /reconcileDraftFinancialScheduleTemplateMapping/);
  assert.match(financialService, /updateCourtFormTemplateMappingIfUnchanged/);
  assert.match(courtFormRepository, /updateTemplateMappingIfUnchanged/);
  assert.match(financialService, /Draft financial schedule auto-mapping could not find any safe PDF field matches/);
  assert.match(financialService, /editability/);
  assert.match(financialService, /canEdit/);
  assert.match(financialService, /canConfirm/);
});

test("draft financial schedule editing is locked to live sessions for lead mediators", () => {
  assert.match(financialService, /buildDraftFinancialScheduleEditability/);
  assert.match(financialService, /actor\.role === "superadmin" \|\| actor\.role === "subadmin"/);
  assert.match(financialService, /session\.leadMediatorId === actor\.id/);
  assert.match(financialService, /session\.status === "scheduled"/);
  assert.match(financialService, /appointment\.status === "confirmed"/);
  assert.match(financialService, /now >= startAt && now <= endAt/);
  assert.match(financialService, /bothPartiesPresent !== true/);
  assert.match(financialService, /Confirm both parties are present before updating the draft financial schedule/);
  assert.match(financialService, /noShowPartyIds\.length > 0/);
  assert.match(financialService, /Draft financial schedule cannot be amended because a party is marked as no-show/);
  assert.match(financialService, /Draft financial schedule is locked outside a live mediation session/);
  assert.match(financialService, /confirmedAt: status === "confirmed" \? now : existing\?\.confirmedAt/);
  assert.match(financialService, /confirmedInSessionId: status === "confirmed" \? confirmedInSessionId : existing\?\.confirmedInSessionId/);
  assert.doesNotMatch(financialService, /mediation_session_post_session_review/);
});

test("draft financial schedule confirmation is prepared for post-session review without submitting a separate task", () => {
  assert.match(caseDetail, /will be included in admin review after the post-session summary is submitted/);
  assert.match(caseDetail, /Complete and save the post-session summary to submit this confirmed schedule for admin review/);
  assert.match(caseDetail, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId, "mediation-sessions"\] \}\)/);
  assert.doesNotMatch(financialService, /ensureAdminTask[\s\S]*draft financial schedule/i);
});

test("case detail renders the draft schedule button, modal tabs, save, and export controls beside PDF booklet workflow", () => {
  const combinedStart = caseDetail.indexOf("accordion-financial-disclosure-combined-booklet");
  const combinedBlock = caseDetail.slice(combinedStart, combinedStart + 3000);
  assert.match(combinedBlock, /button-draft-financial-schedule/);
  assert.doesNotMatch(combinedBlock, /button-export-financial-disclosure-booklet/);
  assert.match(caseDetail, /button-preview-financial-disclosure-booklet-pdf-\$\{folder\.partyId\}/);
  assert.match(caseDetail, /button-export-financial-disclosure-booklet-pdf-\$\{folder\.partyId\}/);
  assert.match(caseDetail, /DraftFinancialScheduleDialog/);
  assert.match(caseDetail, /draft-financial-schedule-dialog/);
  assert.match(caseDetail, /tab-draft-financial-schedule-assets/);
  assert.match(caseDetail, /tab-draft-financial-schedule-pensions/);
  assert.match(caseDetail, /tab-draft-financial-schedule-liabilities/);
  assert.match(caseDetail, /tab-draft-financial-schedule-income/);
  assert.match(caseDetail, /tab-draft-financial-schedule-expenditure/);
  assert.match(caseDetail, /button-save-draft-financial-schedule/);
  assert.match(caseDetail, /button-confirm-draft-financial-schedule/);
  assert.match(caseDetail, /button-preview-draft-financial-schedule/);
  assert.match(caseDetail, /button-export-draft-financial-schedule/);
  assert.match(caseDetail, /draft-financial-schedule\/preview\.pdf/);
  assert.match(caseDetail, /draft-financial-schedule\/export\.pdf/);
  assert.match(caseDetail, /CourtFormPdfEditorDialog/);
  assert.match(caseDetail, /Preview PDF/);
  assert.match(caseDetail, /previewStale/);
  assert.match(caseDetail, /mappingDiagnostics/);
  assert.match(caseDetail, /draft-financial-schedule-mapping-status/);
  assert.match(caseDetail, /mappingDiagnostics\.correctedMappings\.length/);
  assert.match(caseDetail, /mappingDiagnostics\.ignoredPdfFields\.length/);
  assert.match(caseDetail, /mappingDiagnostics\.unmappedPdfFields\.length > 0/);
  assert.match(caseDetail, /Draft financial schedule PDF unavailable/);
  assert.match(caseDetail, /Content-Disposition/);
  assert.match(caseDetail, /renderRepeatableRows/);
  assert.match(caseDetail, /button-add-draft-schedule-row-/);
  assert.match(caseDetail, /button-remove-draft-schedule-row-/);
  assert.match(caseDetail, /input-draft-schedule-row-description-/);
  assert.match(caseDetail, /editability/);
  assert.match(caseDetail, /Draft financial schedule is read-only/);
  assert.match(caseDetail, /Both parties are present/);
  assert.match(caseDetail, /presenceAttestation/);
  assert.match(caseDetail, /disabled=\{!canSaveDraftSchedule/);
  assert.match(caseDetail, /disabled=\{fieldDisabled/);
  assert.match(caseDetail, /Confirmed/);
  assert.match(caseDetail, /reviewContext/);
  assert.match(caseDetail, /willSubmitWithPostSessionReview/);
  assert.doesNotMatch(caseDetail, /\(\["joint", "clientA", "clientB", "notes"\]/);
  assert.doesNotMatch(caseDetail, /\(\["joint", "clientA", "clientB"\]/);
});

test("Draft Financial Schedule templates expose the shared mapping audit in Court Forms", () => {
  assert.match(courtFormRoutes, /auditDraftFinancialScheduleMapping/);
  assert.match(courtFormRoutes, /template\.formType !== "FinancialDisclosureBooklet" && template\.formType !== "DraftFinancialSchedule"/);
  assert.match(courtFormRoutes, /template\.formType === "DraftFinancialSchedule"/);
  assert.match(courtFormsPage, /selectedTemplate\?\.formType === "DraftFinancialSchedule"/);
  assert.match(courtFormsPage, /card-draft-financial-schedule-mapping-audit/);
  assert.match(courtFormsPage, /mappingAuditQuery\.data\.summary\.ignored/);
  assert.match(courtFormsPage, /mappingAuditQuery\.data\.summary\.corrected/);
});

test("preview-only PDF overrides stay in Draft Financial Schedule save and export paths", () => {
  assert.match(caseDetail, /PDF_FIELD_OVERRIDES_KEY/);
  assert.match(caseDetail, /updatePdfFieldOverride/);
  assert.match(financialService, /applyPdfFieldOverrides\(values, payload as unknown as Record<string, unknown>, template\)/);
});

test("case detail preserves repeatable draft schedule arrays during local row edits", () => {
  assert.match(caseDetail, /Array\.isArray\(current\)\s*\?\s*current\.slice\(\)/);
  assert.match(caseDetail, /Number\.isInteger\(Number\(head\)\)/);
  assert.match(caseDetail, /const safeRows = Array\.isArray\(rows\) \? rows : \[\]/);
  assert.match(caseDetail, /payload: normalizeDraftFinancialSchedulePayload\(draft\)/);
});
