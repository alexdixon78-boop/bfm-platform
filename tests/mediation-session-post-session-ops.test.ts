/**
 * Regression checks for mediation session post-session operations.
 *
 * Run with: npx tsx tests/mediation-session-post-session-ops.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schema = read("../shared/schema.ts");
const bootstrap = read("../server/db-bootstrap.ts");
const storage = read("../server/storage.ts");
const sessionRepo = read("../server/repositories/mediation-session.repository.ts");
const sessionRoutes = read("../server/routes/mediation-session.routes.ts");
const sessionService = read("../server/services/mediation-session.service.ts");
const dashboardService = read("../server/services/dashboard.service.ts");
const fileStorage = read("../server/services/file-storage.service.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const dashboardPage = read("../client/src/pages/dashboard.tsx");
const docs = read("../replit.md");
const migrationPath = new URL("../migrations/0011_mediation_session_post_session_ops.sql", import.meta.url);
const reviewMigrationPath = new URL("../migrations/0027_post_session_review_gate.sql", import.meta.url);
const migration = existsSync(migrationPath) ? read("../migrations/0011_mediation_session_post_session_ops.sql") : "";
const reviewMigration = existsSync(reviewMigrationPath) ? read("../migrations/0027_post_session_review_gate.sql") : "";

test("schema, migration, and bootstrap define post-session summary, notes, and document records", () => {
  assert.match(schema, /nextAction: text\("next_action"\)/);
  assert.match(schema, /documentsRequired: text\("documents_required"\)/);
  assert.match(schema, /followUpRequirements: text\("follow_up_requirements"\)/);
  assert.match(schema, /nextSessionRequired: boolean\("next_session_required"\)/);
  assert.match(schema, /summarySubmittedBy: varchar\("summary_submitted_by"\)/);
  assert.match(schema, /summarySubmittedAt: timestamp\("summary_submitted_at"\)/);
  assert.match(schema, /POST_SESSION_REVIEW_STATUSES[\s\S]*not_submitted[\s\S]*submitted[\s\S]*changes_requested[\s\S]*approved/);
  assert.match(schema, /postSessionReviewStatus: text\("post_session_review_status"\)/);
  assert.match(schema, /postSessionReviewRequestedBy: varchar\("post_session_review_requested_by"\)/);
  assert.match(schema, /postSessionReviewRequestedAt: timestamp\("post_session_review_requested_at"\)/);
  assert.match(schema, /postSessionReviewedBy: varchar\("post_session_reviewed_by"\)/);
  assert.match(schema, /postSessionReviewedAt: timestamp\("post_session_reviewed_at"\)/);
  assert.match(schema, /postSessionReviewNotes: text\("post_session_review_notes"\)/);
  assert.match(schema, /mediationSessionNotes = pgTable\("mediation_session_notes"/);
  assert.match(schema, /caseDocuments = pgTable\("case_documents"/);
  assert.match(schema, /CASE_DOCUMENT_REVIEW_STATUSES[\s\S]*ready_for_review[\s\S]*reviewed/);
  assert.match(schema, /MEDIATION_SESSION_AVAILABILITY_SOURCES = \["client", "admin", "reschedule_request", "next_session_request"\] as const/);
  assert.match(migration, /ALTER TABLE "mediation_sessions"[\s\S]*ADD COLUMN IF NOT EXISTS "next_action"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "mediation_session_notes"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "case_documents"/);
  assert.match(bootstrap, /ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS next_action TEXT/);
  assert.match(reviewMigration, /ADD COLUMN IF NOT EXISTS "post_session_review_status" text DEFAULT 'not_submitted' NOT NULL/);
  assert.match(reviewMigration, /UPDATE "mediation_sessions"[\s\S]*SET "post_session_review_status" = 'approved'[\s\S]*WHERE "status" = 'completed'/);
  assert.match(bootstrap, /ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_review_status TEXT NOT NULL DEFAULT 'not_submitted'/);
  assert.match(bootstrap, /UPDATE mediation_sessions[\s\S]*SET post_session_review_status = 'approved'[\s\S]*WHERE status = 'completed'/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS mediation_session_notes/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_documents/);
});

test("storage and service expose staff-side post-session notes, summaries, indicators, and documents", () => {
  assert.match(storage, /listMediationSessionNotes\(sessionId: string\)/);
  assert.match(storage, /createMediationSessionNote\(data: InsertMediationSessionNote\)/);
  assert.match(storage, /listCaseDocumentsByCase\(caseId: string\)/);
  assert.match(storage, /createCaseDocument\(data: InsertCaseDocument\)/);
  assert.match(storage, /updateCaseDocument\(id: string, data: Partial<Omit<CaseDocument/);
  assert.match(sessionRepo, /listNotes\(sessionId: string\)/);
  assert.match(sessionRepo, /createNote\(data: InsertMediationSessionNote\)/);
  assert.match(sessionRepo, /listCaseDocuments\(caseId: string\)/);
  assert.match(sessionService, /recordPostSessionSummary/);
  assert.match(sessionService, /addSessionNote/);
  assert.match(sessionService, /uploadCaseDocument/);
  assert.match(sessionService, /updateCaseDocumentReview/);
  assert.match(sessionService, /reviewPostSessionSummary/);
  assert.match(sessionService, /mediation_session_post_session_review/);
  assert.match(sessionService, /postSessionReviewStatus: "submitted"/);
  assert.match(sessionService, /postSessionReviewStatus: input\.decision/);
  assert.match(sessionService, /draftFinancialSchedule\?: DraftFinancialScheduleReviewSummary \| null/);
  assert.match(sessionService, /storage\.getCaseDraftFinancialSchedule\(id\)/);
  assert.match(sessionService, /itemType: "draft_financial_schedule"[\s\S]*status: "awaiting_review"/);
  assert.doesNotMatch(sessionService, /createReviewedFinancialScheduleDocument/);
  assert.match(sessionService, /deriveSessionIndicator/);
  assert.match(sessionService, /documents_ready_for_review/);
  assert.match(sessionService, /mediation_session_next_session_scheduled/);
});

test("routes enforce staff-side access for notes, summaries, documents, and lead-mediator next scheduling", () => {
  assert.match(sessionRoutes, /router\.post\("\/api\/mediation-sessions\/:id\/summary"/);
  assert.match(sessionRoutes, /router\.patch\("\/api\/mediation-sessions\/:id\/post-session-review"/);
  assert.match(sessionRoutes, /postSessionReviewSchema/);
  assert.match(sessionRoutes, /router\.get\("\/api\/mediation-sessions\/:id\/notes"/);
  assert.match(sessionRoutes, /router\.post\("\/api\/mediation-sessions\/:id\/notes"/);
  assert.match(sessionRoutes, /router\.get\("\/api\/cases\/:id\/documents"/);
  assert.match(sessionRoutes, /router\.post\("\/api\/cases\/:id\/documents"/);
  assert.match(sessionRoutes, /router\.patch\("\/api\/case-documents\/:id\/review"/);
  assert.match(sessionRoutes, /router\.post\("\/api\/mediation-sessions\/:id\/next-session-request"/);
  assert.match(sessionRoutes, /router\.post\("\/api\/mediation-sessions\/:id\/propose-next-session"/);
  assert.match(sessionRoutes, /router\.post\("\/api\/mediation-sessions\/:id\/reschedule-request"/);
  assert.match(sessionService, /actor\.role === "client"[\s\S]*Staff-only session records are not available to clients/);
  assert.match(sessionService, /sanitizeSessionForClient/);
  assert.match(sessionService, /postSessionReviewStatus !== "approved"/);
  assert.match(sessionService, /documents\.filter\(\(document\) => document\.sharedWithClients[\s\S]*document\.reviewStatus === "reviewed"[\s\S]*document\.partyId === access\.partyId/);
  assert.match(sessionService, /Only superadmins can propose the next session/);
  assert.match(sessionService, /const nextSessionRequestAllowedStatuses = new Set\(\["submitted", "approved"\]\)/);
  assert.match(sessionService, /nextSessionRequestAllowedStatuses\.has\(session\.postSessionReviewStatus \|\| "not_submitted"\)/);
  assert.match(sessionService, /Post-session summary must be submitted before requesting the next session/);
  assert.match(sessionService, /Post-session changes must be resubmitted before requesting the next session/);
  assert.match(sessionService, /session\.outcome !== "next_session_needed" && !session\.nextSessionRequired/);
  assert.match(sessionService, /observer[\s\S]*Observer access cannot edit post-session records/);
});

test("case detail and mediator dashboard render post-session operations and rule-based indicators", () => {
  assert.match(caseDetail, /data-testid=\{`session-indicator-\$\{session\.id\}`\}/);
  assert.match(caseDetail, /data-testid=\{`session-notes-section-\$\{session\.id\}`\}/);
  assert.match(caseDetail, /data-testid=\{`session-post-summary-section-\$\{session\.id\}`\}/);
  assert.match(caseDetail, /textarea-session-next-action/);
  assert.match(caseDetail, /textarea-session-documents-required/);
  assert.match(caseDetail, /textarea-session-follow-up-requirements/);
  assert.match(caseDetail, /session-post-session-review-badge/);
  assert.match(caseDetail, /Submitted for admin review/);
  assert.match(caseDetail, /Confirmed Draft Financial Schedule will be sent for admin review with this summary/);
  assert.match(caseDetail, /Draft Financial Schedule is saved but not confirmed; confirm it before saving summary if it should be reviewed\/shared/);
  assert.match(caseDetail, /No confirmed Draft Financial Schedule will be sent/);
  assert.match(caseDetail, /session-post-session-review-schedule-status/);
  assert.match(caseDetail, /Approving this review will share the confirmed Draft Financial Schedule PDF with clients/);
  assert.match(caseDetail, /Approving this review will not create or share a Draft Financial Schedule PDF/);
  assert.match(caseDetail, /button-approve-post-session-review/);
  assert.match(caseDetail, /button-request-post-session-review-changes/);
  assert.match(caseDetail, /const canRequestNextSession = nextSessionNeeded[\s\S]*postSessionReviewStatus === "submitted"[\s\S]*postSessionReviewStatus === "approved"/);
  assert.match(caseDetail, /Save and submit this summary before requesting a next session/);
  assert.match(caseDetail, /Update and resubmit this summary before requesting a next session/);
  assert.match(caseDetail, /data-testid="card-case-documents"/);
  assert.match(caseDetail, /data-testid="input-case-document-file"/);
  assert.match(caseDetail, /canView=\{canViewOperationalStaffData \|\| isClient \|\| isSessionCoMediator\}/);
  assert.match(caseDetail, /canUpload=\{canViewOperationalStaffData\}/);
  assert.match(caseDetail, /ready_for_review/);
  assert.match(caseDetail, /button-request-session-reschedule/);
  assert.match(caseDetail, /textarea-session-reschedule-reason/);
  assert.match(caseDetail, /button-request-next-session/);
  assert.match(caseDetail, /textarea-next-session-request-reason/);
  assert.match(caseDetail, /data-testid=\{dialogTestId\}/);
  assert.match(caseDetail, /w-\[calc\(100vw-2rem\)\] sm:max-w-4xl max-h-\[90vh\] overflow-y-auto/);
  assert.match(caseDetail, /dialog-request-session-reschedule[\s\S]*dialog-request-next-session/);
  assert.match(caseDetail, /xl:grid-cols-\[minmax\(0,1fr\)_220px\]/);
  assert.match(caseDetail, /allocation-next-session-request-panel/);
  assert.doesNotMatch(caseDetail, /checkbox-session-next-required/);
  assert.match(dashboardService, /getMediatorSessionIndicators/);
  assert.match(dashboardPage, /data-testid="mediator-session-indicators"/);
});

test("case detail post-session review UI is role-aware and review-first for admins", () => {
  assert.match(caseDetail, /const canAuthorPostSessionSummary = Boolean\(/);
  assert.match(caseDetail, /user\?\.id === session\.leadMediatorId/);
  assert.match(caseDetail, /postSessionReviewStatus === "not_submitted" \|\| postSessionReviewStatus === "changes_requested"/);
  assert.match(caseDetail, /data-testid=\{`session-post-summary-readonly-\$\{session\.id\}`\}/);
  assert.match(caseDetail, /Submitted summary/);
  assert.match(caseDetail, /data-testid=\{`session-post-session-review-panel-\$\{session\.id\}`\}/);
  assert.match(caseDetail, /canAuthorPostSessionSummary && \(/);
  assert.match(caseDetail, /postSessionReviewStatus === "changes_requested" \? "Resubmit summary" : "Save summary"/);
  assert.match(caseDetail, /button-request-post-session-review-changes/);
  assert.match(caseDetail, /button-approve-post-session-review/);
  assert.doesNotMatch(caseDetail, /isAdmin && postSessionReviewPending[\s\S]*session-post-session-review-panel[\s\S]*canEditPostSession && \(/);
});

test("documentation records post-session operations and document workflow", () => {
  assert.match(docs, /Post-Session Operations/);
  assert.match(docs, /session notes/);
  assert.match(docs, /documents ready for review/);
  assert.match(docs, /rule-based red\/amber\/green/);
  assert.match(docs, /mediation-session reschedule requests/i);
  assert.match(docs, /fresh proposal emails/i);
  assert.match(docs, /once the post-session summary is submitted/i);
  assert.match(docs, /changes_requested[\s\S]*resubmitted before requesting/i);
  assert.match(docs, /final next-session proposal links[\s\S]*post-session review is approved/i);
  assert.doesNotMatch(docs, /request the next numbered mediation session with a suggested lead-mediator slot after post-session review approval/);
});

test("service supports mediation session reschedule requests and email-backed replacement links", () => {
  assert.match(sessionService, /requestSessionReschedule/);
  assert.match(sessionService, /mediation_session_reschedule_requested/);
  assert.match(sessionService, /caseNoteRequired: true/);
  assert.match(sessionService, /source: "reschedule_request"/);
  assert.match(sessionService, /sendMediationSessionProposalEmail/);
  assert.match(sessionService, /sendMediationSessionParticipantInviteEmail/);
  assert.match(sessionService, /replaceProposedSlot[\s\S]*voidInvoices: false/);
  assert.match(sessionService, /completeOpenAdminTasks\(session\.caseId[\s\S]*"mediation_session_reschedule_requested"/);
  assert.match(sessionService, /paid clients will not be charged again/i);
});

test("lead and accepted co-mediator next-session requests require superadmin review before proposal links are sent", () => {
  assert.match(sessionService, /requestNextSession/);
  assert.match(sessionService, /mediation_session_next_session_requested/);
  assert.match(sessionService, /source: "next_session_request"/);
  assert.match(sessionService, /Only the lead mediator or an accepted co-mediator can request the next session/);
  assert.match(sessionService, /Only superadmins can propose the next session/);
  assert.match(sessionService, /Post-session review must be approved before proposing the next session/);
  assert.match(sessionService, /cleanupEmptyDuplicateNextSessions/);
  assert.match(sessionService, /findReusableNextSessionDraft/);
  assert.match(sessionService, /deleteSafeEmptyMediationSession/);
  assert.match(sessionService, /existingNextSession\.appointmentId/);
  assert.match(sessionService, /return \{ ok: false, error: "Next mediation session already exists; review the existing session before retrying"/);
  assert.match(sessionService, /const expectedNextSessionNumber = allowed\.session\.sessionNumber \+ 1/);
  assert.match(sessionService, /session\.sessionNumber > expectedSessionNumber/);
  assert.match(sessionService, /session\.status !== "allocated"/);
  assert.match(sessionService, /proposals\.length > 0/);
  assert.match(sessionService, /forms\.length > 0/);
  assert.match(sessionService, /notes\.length > 0/);
  assert.match(sessionService, /documents\.length > 0/);
  assert.match(sessionService, /attendance\.length > 0/);
  assert.match(sessionService, /appointmentHistory\.length > 0/);
  assert.match(sessionService, /completeOpenAdminTasks\(allowed\.session\.caseId[\s\S]*"mediation_session_next_session_requested"/);
  assert.match(sessionService, /message: string/);
  assert.match(caseDetail, /Request next session/);
  assert.match(caseDetail, /pendingNextSessionRequest/);
  assert.match(caseDetail, /data-testid="allocation-next-session-request-panel"/);
  assert.match(caseDetail, /Post-session review must be approved before Session \{pendingNextSessionNumber\} can be proposed/);
  assert.match(caseDetail, /data-testid=\{`button-use-next-session-request-slot-\$\{window\.id\}`\}/);
  assert.match(caseDetail, /const nextSessionNeeded = draft\.outcome === "next_session_needed" \|\| Boolean\(session\.nextSessionRequired\)/);
  assert.match(caseDetail, /nextSessionRequired: draft\.outcome === "next_session_needed"/);
  assert.match(caseDetail, /onValueChange=\{\(value\) => \{[\s\S]*nextSessionRequired: value === "next_session_needed"/);
  assert.doesNotMatch(caseDetail, /session-next-session-request-windows/);
  assert.doesNotMatch(caseDetail, /user\?\.id === session\.leadMediatorId && postSessionReviewApproved[\s\S]*Propose next session/);
});
