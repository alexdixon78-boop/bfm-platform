/**
 * Regression checks for the case-level proofing workflow.
 *
 * Run with: npx tsx tests/case-proofing-workflow.test.ts
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
const proofingRepo = existsSync(new URL("../server/repositories/case-proofing.repository.ts", import.meta.url))
  ? read("../server/repositories/case-proofing.repository.ts")
  : "";
const proofingService = existsSync(new URL("../server/services/case-proofing.service.ts", import.meta.url))
  ? read("../server/services/case-proofing.service.ts")
  : "";
const proofingRoutes = existsSync(new URL("../server/routes/case-proofing.routes.ts", import.meta.url))
  ? read("../server/routes/case-proofing.routes.ts")
  : "";
const routesIndex = read("../server/routes/index.ts");
const sessionService = read("../server/services/mediation-session.service.ts");
const courtFormService = read("../server/services/court-form-generation.service.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const docs = read("../replit.md");
const migrationPath = new URL("../migrations/0031_case_proofing_items.sql", import.meta.url);
const cyclesMigrationPath = new URL("../migrations/0032_case_proofing_item_cycles.sql", import.meta.url);
const releaseGateMigrationPath = new URL("../migrations/0062_proofing_gated_client_document_release.sql", import.meta.url);

test("schema, migration, and bootstrap define case proofing source of truth", () => {
  assert.match(schema, /CASE_PROOFING_ITEM_TYPES[\s\S]*session_summary[\s\S]*draft_financial_schedule[\s\S]*financial_disclosure_checklist[\s\S]*court_form[\s\S]*case_document/);
  assert.match(schema, /CASE_PROOFING_STATUSES[\s\S]*awaiting_review[\s\S]*approved[\s\S]*returned[\s\S]*withdrawn/);
  assert.match(schema, /caseProofingItems = pgTable\("case_proofing_items"/);
  assert.match(schema, /caseProofingItemCycles = pgTable\("case_proofing_item_cycles"/);
  assert.match(schema, /proofingItemId: varchar\("proofing_item_id"\)\.notNull\(\)\.references\(\(\) => caseProofingItems\.id/);
  assert.match(schema, /cycleNumber: integer\("cycle_number"\)\.notNull\(\)/);
  assert.match(schema, /sourceMetadata: jsonb\("source_metadata"\)/);
  assert.match(schema, /uniqueIndex\("case_proofing_item_cycles_item_cycle_unique"\)\.on\(table\.proofingItemId, table\.cycleNumber\)/);
  assert.match(schema, /caseId: varchar\("case_id"\)\.notNull\(\)\.references\(\(\) => cases\.id/);
  assert.match(schema, /sessionId: varchar\("session_id"\)\.references\(\(\) => mediationSessions\.id/);
  assert.match(schema, /itemType: text\("item_type"\)\.notNull\(\)/);
  assert.match(schema, /sourceEntityType: text\("source_entity_type"\)\.notNull\(\)/);
  assert.match(schema, /sourceEntityId: varchar\("source_entity_id"\)\.notNull\(\)/);
  assert.match(schema, /submittedBy: varchar\("submitted_by"\)\.references\(\(\) => users\.id/);
  assert.match(schema, /submittedAt: timestamp\("submitted_at"\)\.notNull\(\)/);
  assert.match(schema, /reviewedBy: varchar\("reviewed_by"\)\.references\(\(\) => users\.id/);
  assert.match(schema, /reviewedAt: timestamp\("reviewed_at"\)/);
  assert.match(schema, /returnComments: text\("return_comments"\)/);
  assert.match(schema, /withdrawReason: text\("withdraw_reason"\)/);
  assert.match(schema, /uniqueIndex\("case_proofing_items_source_unique"\)\.on\(table\.sourceEntityType, table\.sourceEntityId, table\.itemType\)/);
  assert.match(schema, /insertCaseProofingItemSchema/);
  assert.match(schema, /export type CaseProofingItem/);
  assert.ok(existsSync(migrationPath), "0031 case proofing migration must exist");
  assert.ok(existsSync(cyclesMigrationPath), "0032 case proofing cycles migration must exist");
  const migration = read("../migrations/0031_case_proofing_items.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "case_proofing_items"/);
  assert.match(migration, /"status" text NOT NULL DEFAULT 'awaiting_review'/);
  assert.match(migration, /case_proofing_items_source_unique/);
  assert.match(migration, /INSERT INTO "case_proofing_items"[\s\S]*"session_summary"/);
  assert.match(migration, /INSERT INTO "case_proofing_items"[\s\S]*"draft_financial_schedule"/);
  assert.match(migration, /INSERT INTO "case_proofing_items"[\s\S]*"financial_disclosure_checklist"/);
  assert.match(migration, /INSERT INTO "case_proofing_items"[\s\S]*"court_form"/);
  assert.match(migration, /INSERT INTO "case_proofing_items"[\s\S]*"case_document"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_proofing_items/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_proofing_item_cycles/);
  assert.match(bootstrap, /INSERT INTO case_proofing_item_cycles[\s\S]*cycle_number[\s\S]*1/);
  assert.match(bootstrap, /INSERT INTO case_proofing_items[\s\S]*session_summary/);
  assert.match(bootstrap, /INSERT INTO case_proofing_items[\s\S]*draft_financial_schedule/);
});

test("repository, storage, service, and routes expose proofing operations", () => {
  assert.match(proofingRepo, /class CaseProofingRepository/);
  assert.match(proofingRepo, /listByCase\(caseId: string\)/);
  assert.match(proofingRepo, /listCyclesByProofingItemIds/);
  assert.match(proofingRepo, /createNextCycle/);
  assert.match(proofingRepo, /updateCurrentCycle/);
  assert.match(proofingRepo, /upsertForSource/);
  assert.match(proofingRepo, /updateStatus/);
  assert.match(storage, /listCaseProofingItems\(caseId: string\)/);
  assert.match(storage, /listCaseProofingItemCycles/);
  assert.match(storage, /createNextCaseProofingItemCycle/);
  assert.match(storage, /updateCurrentCaseProofingItemCycle/);
  assert.match(storage, /upsertCaseProofingItem/);
  assert.match(storage, /updateCaseProofingItemStatus/);
  assert.match(proofingService, /calculateProofingAgeingStatus/);
  assert.match(proofingService, /displayTitle/);
  assert.match(proofingService, /displaySubtitle/);
  assert.match(proofingService, /partyName/);
  assert.match(proofingService, /sessionLabel/);
  assert.match(proofingService, /submittedByName/);
  assert.match(proofingService, /reviewedByName/);
  assert.match(proofingService, /previewKind/);
  assert.match(proofingService, /releaseEffect/);
  assert.match(proofingService, /resolveProofingReviewContext/);
  assert.match(proofingService, /currentCycleNumber/);
  assert.match(proofingService, /reviewCycleLabel/);
  assert.match(proofingService, /versionNumber/);
  assert.match(proofingService, /versionLabel/);
  assert.match(proofingService, /cycles/);
  assert.match(proofingService, /Review cycle/);
  assert.match(proofingService, /createNextCaseProofingItemCycle/);
  assert.match(proofingService, /updateCurrentCaseProofingItemCycle/);
  assert.match(proofingService, /"draft_financial_schedule_pdf"/);
  assert.match(proofingService, /"metadata_only"/);
  assert.match(proofingService, /listCaseProofingItems/);
  assert.match(proofingService, /ensureProofingItemForSource/);
  assert.match(proofingService, /approveProofingItem/);
  assert.match(proofingService, /returnProofingItem/);
  assert.match(proofingService, /withdrawProofingItem/);
  assert.match(proofingService, /returnComments\.trim\(\)/);
  assert.match(proofingService, /withdrawReason\.trim\(\)/);
  assert.match(proofingService, /proofing_returned_to_mediator/);
  assert.match(proofingService, /proofing_approved/);
  assert.match(proofingService, /proofing_withdrawn/);
  assert.match(proofingService, /caseActivityService\.log/);
  assert.match(proofingService, /logAudit/);
  assert.match(proofingRoutes, /router\.get\("\/api\/cases\/:id\/proofing-items"/);
  assert.match(proofingRoutes, /router\.patch\("\/api\/case-proofing-items\/:id\/approve"/);
  assert.match(proofingRoutes, /router\.patch\("\/api\/case-proofing-items\/:id\/return"/);
  assert.match(proofingRoutes, /router\.patch\("\/api\/case-proofing-items\/:id\/withdraw"/);
  assert.match(routesIndex, /caseProofingRoutes/);
});

test("proofing integrates with session summaries, draft schedules, documents, and court form release", () => {
  assert.match(sessionService, /ensureProofingItemForSource[\s\S]*"session_summary"/);
  assert.match(sessionService, /ensureProofingItemForSource[\s\S]*"draft_financial_schedule"/);
  assert.match(sessionService, /ensureProofingItemForSource[\s\S]*"case_document"/);
  assert.match(sessionService, /ensureProofingItemForSource[\s\S]*"financial_disclosure_checklist"/);
  assert.match(sessionService, /ensureCaseDocumentProofingItem/);
  assert.match(sessionService, /createSignedFormSnapshotDocument[\s\S]*ensureCaseDocumentProofingItem/);
  assert.match(sessionService, /uploadSignedRequiredForm[\s\S]*ensureCaseDocumentProofingItem/);
  assert.match(sessionService, /uploadDocumentBlankForm[\s\S]*ensureCaseDocumentProofingItem/);
  assert.match(proofingService, /prepareDraftFinancialSchedule/);
  assert.match(proofingService, /exportDraftFinancialSchedulePdf/);
  assert.match(sessionService, /documents\.filter\(\(document\) => document\.sharedWithClients\s*&& document\.reviewStatus === "reviewed"/);
  assert.doesNotMatch(sessionService, /document\.reviewStatus === "ready_for_review"[\s\S]{0,220}clientPartyIds\.has\(document\.partyId\)/);
  assert.match(courtFormService, /reviewStatus: "ready_for_review"/);
  assert.match(courtFormService, /sendEmail: false/);
  assert.doesNotMatch(courtFormService, /if \(options\.sendEmail && recipientEmail\)/);
});

test("post-session approval queues the financial schedule without releasing it", () => {
  const reviewStart = sessionService.indexOf("async reviewPostSessionSummary(");
  const reviewEnd = sessionService.indexOf("private async completePostSessionReviewTask", reviewStart);
  const reviewImplementation = sessionService.slice(reviewStart, reviewEnd);

  assert.match(reviewImplementation, /itemType: "draft_financial_schedule"[\s\S]*status: "awaiting_review"/);
  assert.doesNotMatch(reviewImplementation, /createReviewedFinancialScheduleDocument/);
});

test("proofing approval releases documents and creates idempotent client notifications", () => {
  const approveStart = proofingService.indexOf("async approveProofingItem(");
  const approveEnd = proofingService.indexOf("async returnProofingItem(", approveStart);
  const approveImplementation = proofingService.slice(approveStart, approveEnd);
  const hideStart = proofingService.indexOf("private async hideSource(");
  const hideEnd = proofingService.indexOf("private async createReturnTask", hideStart);
  const hideImplementation = proofingService.slice(hideStart, hideEnd);

  assert.match(proofingService, /case_document_released/);
  assert.match(proofingService, /New document available/);
  assert.match(proofingService, /tab=documents/);
  assert.match(proofingService, /currentCycleNumber/);
  assert.match(proofingService, /createNotification/);
  assert.match(proofingService, /sourceEntityType === "case_document"/);
  assert.match(proofingService, /partyId/);
  assert.match(proofingService, /client\?\.userId/);
  assert.match(proofingService, /hideDraftFinancialSchedule/);
  assert.match(hideImplementation, /sourceEntityType === "case_document"/);
  assert.ok(
    approveImplementation.indexOf("prepareReleaseSource") < approveImplementation.indexOf("updateCaseProofingItemStatus")
      && approveImplementation.indexOf("updateCaseProofingItemStatus") < approveImplementation.lastIndexOf("releaseDocument"),
    "proofing must be approved before the document becomes client-visible",
  );
  assert.match(proofingService, /createCaseDocumentOnce/);
  assert.match(proofingService, /cycleDocumentId = proofingReleaseDocumentId/);
  assert.match(proofingService, /cycleNumber === 1[\s\S]*!document\.sharedWithClients/);
});

test("document review cannot bypass proofing release", () => {
  const reviewStart = sessionService.indexOf("async updateCaseDocumentReview(");
  const reviewEnd = sessionService.indexOf("async deleteCaseDocument(", reviewStart);
  const reviewImplementation = sessionService.slice(reviewStart, reviewEnd);

  assert.match(reviewImplementation, /Approve this document from Proofing/);
  assert.match(reviewImplementation, /sharedWithClients: false/);
  assert.doesNotMatch(caseDetail, /Share with clients/);
});

test("migration hides legacy schedules that are not proofing-approved", () => {
  assert.ok(existsSync(releaseGateMigrationPath), "0062 proofing release gate migration must exist");
  const migration = read("../migrations/0062_proofing_gated_client_document_release.sql");
  assert.match(migration, /draft_financial_schedule/);
  assert.match(migration, /status[^;]*<> 'approved'/s);
  assert.match(migration, /shared_with_clients[^;]*FALSE/is);
  assert.match(migration, /review_status[^;]*ready_for_review/is);
});

test("case detail renders a case-level proofing panel with filters and admin actions", () => {
  assert.match(caseDetail, /type CaseProofingItemView/);
  assert.match(caseDetail, /CaseProofingPanel/);
  assert.match(caseDetail, /\/api\/cases\/\$\{caseId\}\/proofing-items/);
  assert.match(caseDetail, /tab-proofing/);
  assert.match(caseDetail, /card-case-proofing/);
  assert.match(caseDetail, /selectedProofingItem/);
  assert.match(caseDetail, /proofing-master-detail/);
  assert.match(caseDetail, /proofing-queue-list/);
  assert.match(caseDetail, /proofing-detail-pane/);
  assert.match(caseDetail, /select-proofing-type-filter/);
  assert.match(caseDetail, /select-proofing-status-filter/);
  assert.match(caseDetail, /select-proofing-ageing-filter/);
  assert.match(caseDetail, /statusFilter, setStatusFilter\] = useState\("active"\)/);
  assert.match(caseDetail, /awaiting_review[\s\S]*returned[\s\S]*approved[\s\S]*withdrawn/);
  assert.match(caseDetail, /button-approve-proofing-item/);
  assert.match(caseDetail, /button-return-proofing-item/);
  assert.match(caseDetail, /button-withdraw-proofing-item/);
  assert.match(caseDetail, /dialog-approve-proofing-item/);
  assert.match(caseDetail, /dialog-return-proofing-item/);
  assert.match(caseDetail, /dialog-withdraw-proofing-item/);
  assert.match(caseDetail, /iframe-proofing-document-preview/);
  assert.match(caseDetail, /iframe-proofing-draft-financial-schedule-preview/);
  assert.match(caseDetail, /reviewCycleLabel/);
  assert.match(caseDetail, /versionLabel/);
  assert.match(caseDetail, /Review history/);
  assert.match(caseDetail, /proofing-review-history/);
  assert.match(caseDetail, /No PDF preview available/);
  assert.doesNotMatch(caseDetail, /grid gap-3 lg:grid-cols-\[1fr_1fr_auto\]/);
  assert.match(caseDetail, /textarea-proofing-return-comments/);
  assert.match(caseDetail, /textarea-proofing-withdraw-reason/);
  assert.match(caseDetail, /Awaiting review/);
  assert.match(caseDetail, /Returned/);
});

test("documents tab remains a library and points reviewable documents to proofing", () => {
  assert.match(sessionService, /type CaseDocumentView = CaseDocument &/);
  assert.match(sessionService, /uploadedByName/);
  assert.match(sessionService, /partyName/);
  assert.match(sessionService, /partyRole/);
  assert.match(sessionService, /proofingItemId/);
  assert.match(sessionService, /proofingStatus/);
  assert.match(sessionService, /signatureSource/);
  assert.match(sessionService, /completedDocumentProofingStatus/);
  assert.match(caseDetail, /Review in Proofing/);
  assert.match(caseDetail, /document\.uploadedByName/);
  assert.match(caseDetail, /document\.partyName/);
  assert.match(caseDetail, /document\.proofingStatus/);
  assert.match(caseDetail, /form\.completedDocumentProofingStatus === "returned"/);
  assert.match(caseDetail, /Awaiting admin review/);
  assert.doesNotMatch(caseDetail, /Mark reviewed/);
});

test("documents tab uses action plus library UX without default form-evidence duplication", () => {
  assert.match(caseDetail, /Forms to complete/);
  assert.doesNotMatch(caseDetail, />Blank forms</);
  assert.match(caseDetail, /Document library/);
  assert.match(caseDetail, /showFormEvidence/);
  assert.match(caseDetail, /Show form evidence/);
  assert.match(caseDetail, /isRequiredFormEvidenceDocument/);
  assert.match(caseDetail, /displayDocuments\.filter\(\(document\) => !document\.documentRequestId && document\.documentCategory !== "requested_evidence"\)/);
  assert.match(caseDetail, /genericDocuments\.filter\(\(document\) => showFormEvidence \|\| !isRequiredFormEvidenceDocument\(document\)\)/);
  assert.doesNotMatch(caseDetail, /return "Ready for review";/);
  assert.match(caseDetail, /data-testid="switch-show-form-evidence"/);
  assert.match(caseDetail, /data-testid="section-document-library"/);
  assert.match(caseDetail, /data-testid="section-required-forms"/);
});

test("documentation records completed proofing workflow", () => {
  assert.match(docs, /Case Proofing Workflow/);
  assert.match(docs, /case_proofing_items/);
  assert.match(docs, /case_proofing_item_cycles/);
  assert.match(docs, /Review cycle/);
  assert.match(docs, /Version[\s\S]*Draft Financial Schedule/);
  assert.match(docs, /session summaries, Draft Financial Schedules, Financial Disclosure Checklists, Court Forms, and other client-facing documents/);
  assert.match(docs, /Strict client release/);
  assert.match(docs, /3 working days[\s\S]*5 working days/);
  assert.match(docs, /return-to-mediator/);
});
