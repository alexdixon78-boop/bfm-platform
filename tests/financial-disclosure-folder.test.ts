/**
 * Regression checks for SOP 1.3a Financial Disclosure and Support folders.
 *
 * Run with: npx tsx tests/financial-disclosure-folder.test.ts
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
const financialServicePath = new URL("../server/services/financial-disclosure.service.ts", import.meta.url);
const financialService = existsSync(financialServicePath) ? read("../server/services/financial-disclosure.service.ts") : "";
const bookingService = read("../server/services/booking.service.ts");
const caseRoutes = read("../server/routes/case.routes.ts");
const sessionService = read("../server/services/mediation-session.service.ts");
const sessionRoutes = read("../server/routes/mediation-session.routes.ts");
const courtFormRoutes = read("../server/routes/court-form.routes.ts");
const courtFormPage = read("../client/src/pages/court-forms.tsx");
const courtFormService = read("../server/services/court-form-generation.service.ts");
const mergeSources = read("../shared/court-form-merge-sources.ts");
const bookletAutoMapPath = new URL("../shared/financial-disclosure-booklet-auto-map.ts", import.meta.url);
const bookletAutoMap = existsSync(bookletAutoMapPath) ? read("../shared/financial-disclosure-booklet-auto-map.ts") : "";
const bookletMappingAuditScriptPath = new URL("../server/scripts/audit-financial-disclosure-booklet-mapping.ts", import.meta.url);
const bookletMappingAuditScript = existsSync(bookletMappingAuditScriptPath) ? read("../server/scripts/audit-financial-disclosure-booklet-mapping.ts") : "";
const dashboardService = read("../server/services/dashboard.service.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const docs = read("../replit.md");
const migrationPath = new URL("../migrations/0012_financial_disclosure_folders.sql", import.meta.url);
const migration = existsSync(migrationPath) ? read("../migrations/0012_financial_disclosure_folders.sql") : "";
const repairMigrationPath = new URL("../migrations/0013_repair_financial_disclosure_party_scope.sql", import.meta.url);
const repairMigration = existsSync(repairMigrationPath) ? read("../migrations/0013_repair_financial_disclosure_party_scope.sql") : "";
const structuredMigrationPath = new URL("../migrations/0023_financial_disclosure_structured_booklet.sql", import.meta.url);
const structuredMigration = existsSync(structuredMigrationPath) ? read("../migrations/0023_financial_disclosure_structured_booklet.sql") : "";
const fieldBookletSchemaPath = new URL("../shared/financial-disclosure-booklet-schema.ts", import.meta.url);
const fieldBookletSchema = existsSync(fieldBookletSchemaPath) ? read("../shared/financial-disclosure-booklet-schema.ts") : "";
const folderSchemaBlock = schema.slice(
  schema.indexOf("export const financialDisclosureFolders"),
  schema.indexOf("export const financialDisclosureItems"),
);

test("schema, migration, and bootstrap define party-scoped financial disclosure folders", () => {
  assert.match(schema, /financialDisclosureFolders = pgTable\("financial_disclosure_folders"/);
  assert.match(schema, /partyId: varchar\("party_id"\)\.notNull\(\)\.references\(\(\) => parties\.id/);
  assert.match(schema, /uniqueIndex\("financial_disclosure_folders_case_party_unique"\)\.on\(table\.caseId,\s*table\.partyId\)/);
  assert.doesNotMatch(folderSchemaBlock, /caseId: varchar\("case_id"\)[\s\S]*\.unique\(\)/);
  assert.match(schema, /financialDisclosureItems = pgTable\("financial_disclosure_items"/);
  assert.match(schema, /financialDisclosureEvidenceCategories = pgTable\("financial_disclosure_evidence_categories"/);
  assert.match(schema, /FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES[\s\S]*Property & finance \(PF\)[\s\S]*All issues mediation \(AIM\)/);
  assert.match(schema, /FINANCIAL_DISCLOSURE_ITEM_TYPES[\s\S]*online_disclosure_booklet[\s\S]*financial_disclosure_checklist/);
  assert.doesNotMatch(schema, /"ofs_requirement"/);
  assert.match(schema, /FINANCIAL_DISCLOSURE_UPLOAD_TARGETS[\s\S]*online_disclosure_booklet[\s\S]*ofs[\s\S]*financial_disclosure_checklist[\s\S]*evidence_category/);
  assert.match(schema, /financialDisclosureFolderId: varchar\("financial_disclosure_folder_id"\)/);
  assert.match(schema, /financialDisclosureItemId: varchar\("financial_disclosure_item_id"\)/);
  assert.match(schema, /financialDisclosureEvidenceCategoryId: varchar\("financial_disclosure_evidence_category_id"\)/);
  assert.match(schema, /financialDisclosureUploadTarget: text\("financial_disclosure_upload_target"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "financial_disclosure_folders"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "financial_disclosure_items"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "financial_disclosure_evidence_categories"/);
  assert.match(migration, /"party_id" varchar NOT NULL/);
  assert.match(migration, /financial_disclosure_folders_case_party_unique/);
  assert.match(migration, /ALTER TABLE "case_documents"[\s\S]*ADD COLUMN IF NOT EXISTS "financial_disclosure_folder_id"/);
  assert.match(migration, /ALTER TABLE "case_documents"[\s\S]*ADD COLUMN IF NOT EXISTS "financial_disclosure_upload_target"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS financial_disclosure_folders/);
  assert.match(bootstrap, /party_id VARCHAR NOT NULL REFERENCES parties\(id\) ON DELETE CASCADE/);
  assert.match(bootstrap, /ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS financial_disclosure_folder_id VARCHAR/);
});

test("repair migration patches databases that already applied old case-scoped financial disclosure folders", () => {
  assert.ok(existsSync(repairMigrationPath), "0013 repair migration must exist");
  assert.match(repairMigration, /ADD COLUMN IF NOT EXISTS "party_id"/);
  assert.match(repairMigration, /DROP CONSTRAINT IF EXISTS "financial_disclosure_folders_case_id_unique"/);
  assert.match(repairMigration, /first_party/);
  assert.match(repairMigration, /UPDATE "financial_disclosure_folders" folder[\s\S]*SET "party_id" = first_party\.party_id/);
  assert.match(repairMigration, /DELETE FROM "financial_disclosure_folders" duplicate/);
  assert.match(repairMigration, /ALTER COLUMN "party_id" SET NOT NULL/);
  assert.match(repairMigration, /financial_disclosure_folders_case_party_unique/);
  assert.match(repairMigration, /ADD COLUMN IF NOT EXISTS "financial_disclosure_upload_target"/);
});

test("service creates folders idempotently per party only for AIM and Property & finance cases", () => {
  assert.match(storage, /getFinancialDisclosureFolderByCaseAndParty\(caseId: string,\s*partyId: string\)/);
  assert.match(storage, /listFinancialDisclosureFoldersByCase\(caseId: string\)/);
  assert.match(storage, /createFinancialDisclosureFolder/);
  assert.match(storage, /createFinancialDisclosureItem/);
  assert.match(storage, /createFinancialDisclosureEvidenceCategory/);
  assert.match(financialService, /isFinancialDisclosureEligibleCase/);
  assert.match(financialService, /ensureFinancialDisclosureFoldersForCase/);
  assert.match(financialService, /listPartiesByCase/);
  assert.match(financialService, /FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES/);
  assert.match(financialService, /online_disclosure_booklet/);
  assert.match(financialService, /financial_disclosure_checklist/);
  assert.match(financialService, /getMiamRecord\(folder\.partyId,\s*folder\.caseId\)/);
  assert.match(financialService, /updateFolderOfsRequired/);
  assert.doesNotMatch(financialService, /itemType:\s*"ofs_requirement"/);
});

test("booking, case type updates, and mediation-session holds ensure the folder before later workflow gates", () => {
  const persistIndex = bookingService.indexOf("persistBookingOnboardingDetails");
  const appointmentIndex = bookingService.indexOf("storage.createAppointment");
  const ensureBookingIndex = bookingService.indexOf("ensureFinancialDisclosureFoldersForCase");
  assert.ok(ensureBookingIndex > persistIndex, "booking ensure should run after onboarding subtype persistence is reached");
  assert.ok(ensureBookingIndex > 0 && ensureBookingIndex < appointmentIndex, "booking ensure should run before appointment/payment side effects");

  assert.match(caseRoutes, /ensureFinancialDisclosureFoldersForCase\(req\.params\.id,\s*"case_type_update"/);

  const placeHoldIndex = sessionService.indexOf("async placeHold");
  const createHoldIndex = sessionService.indexOf("storage.createAppointment", placeHoldIndex);
  const ensureSessionIndex = sessionService.indexOf("ensureFinancialDisclosureFoldersForCase", placeHoldIndex);
  assert.ok(ensureSessionIndex > placeHoldIndex && ensureSessionIndex < createHoldIndex, "session hold should defensively ensure folder before creating the hold appointment");
});

test("routes and document upload support party-scoped financial disclosure targets", () => {
  assert.match(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-folders/);
  assert.doesNotMatch(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-folder"/);
  const folderGetRouteIndex = sessionRoutes.indexOf('router.get("/api/cases/:id/financial-disclosure-folders"');
  const folderGetRouteEndIndex = sessionRoutes.indexOf('router.post("/api/cases/:id/documents"', folderGetRouteIndex);
  const folderGetRoute = sessionRoutes.slice(folderGetRouteIndex, folderGetRouteEndIndex);
  assert.match(folderGetRoute, /ensureFinancialDisclosureFoldersForCase\(req\.params\.id,\s*"case_type_update"/);
  assert.ok(
    folderGetRoute.indexOf("ensureFinancialDisclosureFoldersForCase") < folderGetRoute.indexOf("getVisibleFoldersForCase"),
    "folder GET should defensively ensure eligible party folders before listing them",
  );
  assert.match(sessionRoutes, /\/api\/financial-disclosure-folders\/:folderId\/ofs/);
  assert.match(sessionRoutes, /financialDisclosureFolderId: z\.string\(\)\.trim\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(sessionRoutes, /financialDisclosureItemId: z\.string\(\)\.trim\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(sessionRoutes, /financialDisclosureEvidenceCategoryId: z\.string\(\)\.trim\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(sessionRoutes, /financialDisclosureUploadTarget: z\.enum\(FINANCIAL_DISCLOSURE_UPLOAD_TARGETS\)\.optional\(\)\.nullable\(\)/);
  assert.match(sessionService, /validateFinancialDisclosureUploadMetadata/);
  assert.match(sessionService, /financialDisclosureFolderId: financialDisclosureTag\?\.folderId \|\| null/);
  assert.match(sessionService, /financialDisclosureItemId: financialDisclosureTag\?\.itemId \|\| null/);
  assert.match(sessionService, /financialDisclosureEvidenceCategoryId: financialDisclosureTag\?\.evidenceCategoryId \|\| null/);
  assert.match(sessionService, /financialDisclosureUploadTarget: financialDisclosureTag\?\.uploadTarget \|\| null/);
});

test("financial disclosure folder reloads bypass browser and intermediary caches", () => {
  const folderGetRouteIndex = sessionRoutes.indexOf('router.get("/api/cases/:id/financial-disclosure-folders"');
  const folderGetRouteEndIndex = sessionRoutes.indexOf('router.get("/api/cases/:id/financial-disclosure-booklet/combined"', folderGetRouteIndex);
  const folderGetRoute = sessionRoutes.slice(folderGetRouteIndex, folderGetRouteEndIndex);
  assert.match(folderGetRoute, /res\.setHeader\("Cache-Control",\s*"no-store"\)/);
  assert.match(folderGetRoute, /res\.setHeader\("Pragma",\s*"no-cache"\)/);
  assert.match(folderGetRoute, /res\.setHeader\("Expires",\s*"0"\)/);

  const folderQueryStart = caseDetail.indexOf("const folderQuery = useQuery<FinancialDisclosureFolderView[]>");
  const folderQueryEnd = caseDetail.indexOf("const updateItemMutation = useMutation", folderQueryStart);
  const folderQueryBlock = caseDetail.slice(folderQueryStart, folderQueryEnd);
  assert.match(folderQueryBlock, /cache:\s*"no-store"/);
});

test("Form E is a standalone per-client financial disclosure upload target", () => {
  assert.match(schema, /FINANCIAL_DISCLOSURE_UPLOAD_TARGETS[\s\S]*"form_e"/);
  assert.match(sessionRoutes, /financialDisclosureUploadTarget: z\.enum\(FINANCIAL_DISCLOSURE_UPLOAD_TARGETS\)\.optional\(\)\.nullable\(\)/);
  assert.match(financialService, /input\.financialDisclosureUploadTarget === "form_e"/);
  assert.doesNotMatch(financialService, /input\.financialDisclosureUploadTarget === "form_e"[\s\S]{0,200}!input\.financialDisclosureItemId/);
  assert.doesNotMatch(financialService, /input\.financialDisclosureUploadTarget === "form_e"[\s\S]{0,200}!input\.financialDisclosureEvidenceCategoryId/);
});

test("Form E uploads are editable only by clients, staff, and assigned mediators", () => {
  const caseAccessPolicy = read("../server/security/case-access-policy.ts");

  assert.match(financialService, /canActorUploadToFolder/);
  assert.match(financialService, /input\.financialDisclosureUploadTarget === "form_e"[\s\S]*canActorUploadToFolder/);
  assert.match(financialService, /Only clients, staff, or assigned mediators can upload Form E documents/);
  assert.match(financialService, /hasFullOperationalCaseAccess\(await classifyCaseAccess\(folder\.caseId, actor\)\)/);
  assert.match(caseAccessPolicy, /access\.tier === "admin" \|\| access\.tier === "operational_staff" \|\| access\.tier === "full_mediator"/);
  assert.doesNotMatch(caseAccessPolicy, /hasFullOperationalCaseAccess[\s\S]{0,200}session_co_mediator/);
  assert.doesNotMatch(financialService, /miamMediatorId === actor\.id/);
});

test("case detail exposes party folder panels with MIAM-backed OFS and upload targets", () => {
  assert.match(caseDetail, /financial-disclosure/);
  assert.match(caseDetail, /Financial Disclosure/);
  assert.match(caseDetail, /FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES/);
  assert.match(caseDetail, /function isFinancialDisclosureEligibleCaseDetail/);
  assert.match(caseDetail, /const showFinancialDisclosureTab = !isSessionObserverOnly && !isSessionCoMediator && isFinancialDisclosureEligibleCaseDetail\(caseData\)/);
  assert.match(caseDetail, /caseData && activeTab === "financial-disclosure" && !showFinancialDisclosureTab/);
  assert.match(caseDetail, /\{showFinancialDisclosureTab && <TabsTrigger[\s\S]*data-testid="tab-financial-disclosure"/);
  assert.match(caseDetail, /\{showFinancialDisclosureTab && \(\s*<TabsContent value="financial-disclosure"/);
  assert.match(caseDetail, /partyId/);
  assert.match(caseDetail, /folders\.map/);
  assert.match(caseDetail, /online_disclosure_booklet/);
  assert.match(caseDetail, /financial_disclosure_checklist/);
  assert.doesNotMatch(caseDetail, /ofs_requirement/);
  assert.match(caseDetail, /ofsRequired/);
  assert.doesNotMatch(caseDetail, /select-financial-disclosure-upload-target/);
  assert.match(caseDetail, /select-financial-disclosure-evidence-category/);
  assert.match(caseDetail, /input-financial-disclosure-booklet-file/);
  assert.match(caseDetail, /button-upload-financial-disclosure-booklet/);
  assert.match(caseDetail, /input-financial-disclosure-ofs-file/);
  assert.match(caseDetail, /button-upload-financial-disclosure-ofs/);
  assert.match(caseDetail, /input-financial-disclosure-checklist-file/);
  assert.match(caseDetail, /button-upload-financial-disclosure-checklist/);
  assert.match(caseDetail, /Form E/);
  assert.match(caseDetail, /uploadTarget="form_e"/);
  assert.match(caseDetail, /input-financial-disclosure-form-e-file/);
  assert.match(caseDetail, /button-upload-financial-disclosure-form-e/);
  assert.match(caseDetail, /No Form E documents uploaded\./);
  assert.doesNotMatch(caseDetail, /md:grid-cols-\[minmax\(0,1fr\)_minmax\(220px,320px\)_auto\]/);
  assert.doesNotMatch(caseDetail, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(180px,260px\)_auto\]/);
  const sectionUploadStart = caseDetail.indexOf("function FinancialDisclosureSectionUpload");
  const sectionUploadEnd = caseDetail.indexOf("function FinancialDisclosurePanel", sectionUploadStart);
  const sectionUpload = caseDetail.slice(sectionUploadStart, sectionUploadEnd);
  assert.match(sectionUpload, /<p className="text-sm font-medium">Document<\/p>/);
  assert.match(sectionUpload, /<Label className="text-xs"[^>]*>Title<\/Label>/);
  assert.doesNotMatch(sectionUpload, />Document title<\/Label>/);
  assert.match(sectionUpload, /sm:flex-row sm:items-end/);
  assert.match(sectionUpload, /className="w-full shrink-0 sm:w-28"/);
  assert.match(docs, /Financial Disclosure and Support Folder/);
  assert.match(docs, /one idempotent folder per eligible case per active party/);
  assert.match(docs, /Financial Disclosure tab is hidden for non-PF\/AIM cases/i);
  assert.match(docs, /preserved folders remain stored/i);
  assert.match(docs, /MIAM `ofs_required` value/);
});

test("case detail collapses each party financial disclosure folder by default with scan-friendly progress", () => {
  const panelStart = caseDetail.indexOf("function FinancialDisclosurePartyFolderPanel");
  const panelEnd = caseDetail.indexOf("function FinancialDisclosureDocumentLinks", panelStart);
  const partyPanel = caseDetail.slice(panelStart, panelEnd);

  assert.match(partyPanel, /const \[isExpanded,\s*setIsExpanded\] = useState\(false\)/);
  assert.match(partyPanel, /data-testid=\{`button-toggle-financial-disclosure-folder-\$\{folder\.partyId\}`\}/);
  assert.match(partyPanel, /aria-expanded=\{isExpanded\}/);
  assert.match(partyPanel, /completedItems/);
  assert.match(partyPanel, /folder\.documents\.length/);
  assert.match(partyPanel, /folder\.status\.replace\(/);
  assert.match(partyPanel, /isExpanded && \(/);
});

test("client dashboard derives financial disclosure pending actions from folder completion", () => {
  assert.match(dashboardService, /financialDisclosureService/);
  assert.match(dashboardService, /getVisibleFoldersForCase\(row\.case\.id,\s*user\)/);
  assert.match(dashboardService, /findFinancialDisclosureAction/);
  assert.match(dashboardService, /online_disclosure_booklet/);
  assert.match(dashboardService, /booklet\.status !== "completed"/);
  assert.match(dashboardService, /document\.uploadedBy === user\.id/);
  assert.match(dashboardService, /title: "Complete financial disclosure"/);
  assert.match(dashboardService, /Please complete your online financial disclosure booklet and upload supporting evidence\./);
  assert.match(dashboardService, /href: `\/cases\/\$\{caseId\}\?tab=financial-disclosure`/);
  assert.match(dashboardService, /kind: "document"/);
  assert.match(dashboardService, /source: "derived"/);
});

test("financial disclosure client tasks route to the financial disclosure tab", () => {
  assert.match(dashboardService, /text\.includes\("financial disclosure"\)/);
  assert.match(dashboardService, /`\/cases\/\$\{caseId\}\?tab=financial-disclosure`/);
});

test("case detail refreshes client dashboard actions after financial disclosure updates", () => {
  const sectionUploadStart = caseDetail.indexOf("function FinancialDisclosureSectionUpload");
  const uploadMutationStart = caseDetail.indexOf("const uploadMutation = useMutation", sectionUploadStart);
  const uploadMutationEnd = caseDetail.indexOf("return (", uploadMutationStart);
  const uploadMutationBlock = caseDetail.slice(uploadMutationStart, uploadMutationEnd);
  assert.match(uploadMutationBlock, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/dashboard\/client"\] \}\)/);

  const updateItemMutationStart = caseDetail.indexOf("const updateItemMutation = useMutation");
  const updateItemMutationEnd = caseDetail.indexOf("const updateOfsMutation = useMutation", updateItemMutationStart);
  const updateItemMutationBlock = caseDetail.slice(updateItemMutationStart, updateItemMutationEnd);
  assert.match(updateItemMutationBlock, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/dashboard\/client"\] \}\)/);

  assert.match(docs, /financial disclosure actions are derived from folder completion/i);
  assert.match(docs, /\/cases\/:caseId\?tab=financial-disclosure/);
});

test("case detail refreshes financial disclosure folders after source detail updates", () => {
  const personalMutationStart = caseDetail.indexOf("const personalMutation = useMutation");
  const personalMutationEnd = caseDetail.indexOf("// Case link settings edit state", personalMutationStart);
  const personalMutationBlock = caseDetail.slice(personalMutationStart, personalMutationEnd);
  assert.match(personalMutationBlock, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId, "financial-disclosure-folders"\] \}\)/);

  const demographicSaveStart = caseDetail.indexOf("const saveMutation = useMutation", caseDetail.indexOf("function DemographicPartyCard"));
  const demographicSaveEnd = caseDetail.indexOf("const startEditing", demographicSaveStart);
  const demographicSaveBlock = caseDetail.slice(demographicSaveStart, demographicSaveEnd);
  assert.match(demographicSaveBlock, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId, "financial-disclosure-folders"\] \}\)/);
});

test("structured online booklet and per-client checklist rows are seeded in folder payloads", () => {
  assert.match(fieldBookletSchema, /FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA_VERSION/);
  assert.match(fieldBookletSchema, /applyDisclosureSourcePrefill/);
  assert.match(fieldBookletSchema, /a1_monthly_income_employment_self_employment/);
  assert.match(fieldBookletSchema, /a2_other_income/);
  assert.match(fieldBookletSchema, /b_monthly_expenditure/);
  assert.match(fieldBookletSchema, /c_assets_and_liabilities/);
  assert.match(fieldBookletSchema, /document_checklist/);
  assert.match(financialService, /ensureFieldBasedBookletPayload/);
  assert.match(financialService, /bookletSchemaVersion/);
  assert.match(financialService, /legacyNotes/);
  assert.match(financialService, /CHECKLIST_ROW_DEFINITIONS/);
  assert.match(financialService, /matrimonial_home_valuation/);
  assert.match(financialService, /personal_bank_building_society_national_savings/);
  assert.match(financialService, /pension_cetv_statements/);
  assert.match(financialService, /application_to_vary_order/);
  assert.match(financialService, /ensureChecklistPayload/);
  assert.match(financialService, /sourceSummary/);
  assert.match(financialService, /getDemographicDataByParty\(folder\.partyId\)/);
  assert.match(financialService, /applyDisclosureSourcePrefill/);
});

test("financial disclosure item patch can update one booklet section or checklist row without replacing sibling payload data", () => {
  assert.match(sessionRoutes, /bookletSectionPatchSchema/);
  assert.match(sessionRoutes, /checklistRowPatchSchema/);
  assert.match(sessionRoutes, /bookletSubmitSchema/);
  assert.match(sessionRoutes, /staffAnnotationPatchSchema/);
  assert.match(sessionRoutes, /\/api\/financial-disclosure-items\/:id\/booklet-sections\/:sectionKey/);
  assert.match(sessionRoutes, /\/api\/financial-disclosure-items\/:id\/booklet-submit/);
  assert.match(sessionRoutes, /\/api\/financial-disclosure-items\/:id\/booklet-annotations/);
  assert.match(sessionRoutes, /\/api\/financial-disclosure-items\/:id\/checklist-rows\/:rowKey/);
  assert.match(financialService, /updateBookletSection/);
  assert.match(financialService, /submitBooklet/);
  assert.match(financialService, /updateBookletAnnotation/);
  assert.match(financialService, /updateChecklistRow/);
  assert.match(sessionRoutes, /status: z\.enum\(\["not_started", "in_progress", "completed", "submitted"\]\)/);
});

test("financial disclosure uploads capture document dates, upload sizes, and reject unsafe file payloads", () => {
  assert.match(schema, /documentDate: timestamp\("document_date"\)/);
  assert.match(schema, /fileSizeBytes: integer\("file_size_bytes"\)/);
  assert.match(structuredMigration, /ADD COLUMN IF NOT EXISTS "document_date" timestamp/);
  assert.match(structuredMigration, /ADD COLUMN IF NOT EXISTS "file_size_bytes" integer/);
  assert.match(sessionRoutes, /documentDate: z\.coerce\.date\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(sessionRoutes, /fileSizeBytes: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(sessionService, /MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES = 25 \* 1024 \* 1024/);
  assert.match(sessionService, /isAllowedFinancialDisclosureUpload/);
  assert.match(sessionService, /Financial disclosure uploads must be PDF, image, Word, Excel, or CSV files/);
  assert.match(sessionService, /Financial disclosure uploads must be 25MB or smaller/);
  assert.match(sessionService, /documentDate: input\.documentDate/);
  assert.match(sessionService, /fileSizeBytes: parsed\.buffer\.byteLength/);
});

test("case detail renders structured booklet, closed staff combined accordion, checklist row controls, and upload document dates", () => {
  assert.match(caseDetail, /FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA/);
  assert.match(caseDetail, /FinancialDisclosureBookletWizard/);
  assert.match(caseDetail, /FinancialDisclosureCombinedBookletView/);
  assert.match(caseDetail, /accordion-financial-disclosure-combined-booklet/);
  assert.match(caseDetail, /trigger-financial-disclosure-combined-booklet/);
  assert.match(caseDetail, /import \{ ScrollArea \} from "@\/components\/ui\/scroll-area"/);
  assert.match(caseDetail, /data-testid="financial-disclosure-combined-booklet-scroll"/);
  assert.match(caseDetail, /className="h-\[50vh\] max-h-\[680px\] rounded-md border bg-background sm:h-\[60vh\]"/);
  assert.match(caseDetail, /sticky top-0 z-10/);
  assert.match(caseDetail, /Scroll inside the panel to review all booklet sections\./);
  assert.match(caseDetail, /button-preview-financial-disclosure-booklet-pdf-\$\{folder\.partyId\}/);
  assert.match(caseDetail, /button-export-financial-disclosure-booklet-pdf-\$\{folder\.partyId\}/);
  assert.match(caseDetail, /FinancialDisclosureBookletPdfDialog/);
  assert.match(caseDetail, /financial-disclosure-booklet-mapping-status/);
  assert.match(caseDetail, /financial-disclosure-booklet\/\$\{partyId\}\/preview\.pdf/);
  assert.match(caseDetail, /financial-disclosure-booklet\/\$\{partyId\}\/export\.pdf/);
  assert.match(caseDetail, /financial-disclosure-booklet\/\$\{partyId\}\/pdf-field/);
  assert.doesNotMatch(caseDetail, /button-upload-financial-disclosure-booklet-template/);
  assert.doesNotMatch(caseDetail, /DOCX template/);
  assert.doesNotMatch(caseDetail, /Export DOCX/);
  assert.match(caseDetail, /CHECKLIST_ROWS/);
  assert.match(caseDetail, /booklet-section-\$\{section\.key\}/);
  assert.match(caseDetail, /input-booklet-field-\$\{section\.key\}-\$\{field\.key\}/);
  assert.doesNotMatch(caseDetail, /disabled=\{Boolean\(field\.calculated\)\}/);
  assert.doesNotMatch(caseDetail, /value=\{String\(\(totals\.b as any\)\[field\.key\]/);
  assert.doesNotMatch(caseDetail, /combined\.totals\.clientA\.b as any/);
  assert.match(caseDetail, /section\.summaryFields\.map\(\(field\) => renderField\(section, \["summary"\], field\)\)/);
  assert.match(caseDetail, /section\.summaryFields\.map\(\(field\) => renderCombinedField\(section\.key, \["summary"\], field\)\)/);
  assert.match(fieldBookletSchema, /main_salary_wages_gross/);
  assert.match(caseDetail, /button-save-booklet-section-\$\{section\.key\}/);
  assert.match(caseDetail, /text-booklet-section-save-status-\$\{section\.key\}/);
  assert.match(caseDetail, /Saving\.\.\./);
  assert.match(caseDetail, /Last saved/);
  assert.match(caseDetail, /setSaveStates/);
  assert.match(caseDetail, /mutateAsync/);
  assert.match(caseDetail, /queryClient\.setQueryData<FinancialDisclosureFolderView\[\]>/);
  assert.match(caseDetail, /queryClient\.refetchQueries\(\{ queryKey \}\)/);
  assert.match(caseDetail, /Client source details/);
  assert.match(caseDetail, /sourceSummary/);
  assert.match(caseDetail, /submitBookletPending/);
  assert.match(caseDetail, /submitBookletPending \? "Submitting\.\.\." : "Submit booklet"/);
  assert.doesNotMatch(caseDetail, /autosaveBookletSection/);
  assert.doesNotMatch(caseDetail, /window\.setTimeout\(\(\) => \{\s*if \(activeSection\)/);
  assert.match(caseDetail, /financial-disclosure-checklist-row-\$\{row\.key\}/);
  assert.match(caseDetail, /select-checklist-row-status-\$\{row\.key\}/);
  assert.match(caseDetail, /input-checklist-row-document-date-\$\{row\.key\}/);
  assert.match(caseDetail, /input-financial-disclosure-document-date/);
  assert.match(caseDetail, /const \[isPreparingFile, setIsPreparingFile\] = useState\(false\)/);
  assert.match(caseDetail, /const uploadBusy = isPreparingFile \|\| uploadMutation\.isPending/);
  assert.match(caseDetail, /disabled=\{uploadBusy\}/);
  assert.match(caseDetail, /disabled=\{disabled \|\| uploadBusy \|\| !fileDraft\}/);
  assert.match(caseDetail, /uploadBusy \? <Loader2 className="w-3\.5 h-3\.5 mr-1 animate-spin" \/> : <Upload className="w-3\.5 h-3\.5 mr-1" \/>/);
  assert.match(caseDetail, /isPreparingFile \? "Preparing\.\.\." : uploadMutation\.isPending \? "Uploading\.\.\." : "Upload"/);
  assert.match(caseDetail, /Preparing \{preparingFileName\}\.\.\./);
  assert.match(caseDetail, /Uploading \{fileDraft\.fileName\}\.\.\./);
  assert.match(caseDetail, /MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES/);
  assert.match(caseDetail, /ACCEPTED_FINANCIAL_DISCLOSURE_FILE_TYPES/);
});

test("booklet submit saves the visible active section draft before final submission", () => {
  const wizardStart = caseDetail.indexOf("function FinancialDisclosureBookletWizard");
  const wizardEnd = caseDetail.indexOf("function FinancialDisclosureCombinedBookletView", wizardStart);
  const wizardBlock = caseDetail.slice(wizardStart, wizardEnd);
  assert.match(wizardBlock, /submitBooklet:\s*\(item: FinancialDisclosureItemView,\s*sectionKey: string,\s*answers: Record<string, unknown>,\s*status: FinancialDisclosureProgressStatus\) => Promise<void>/);
  assert.match(wizardBlock, /const submitCurrentBooklet = async \(\) =>/);
  assert.match(wizardBlock, /await submitBooklet\(item,\s*activeSectionKey,\s*answerDrafts\[activeSectionKey\] \|\| \{\},\s*"submitted"\)/);
  assert.match(wizardBlock, /disabled=\{submitBookletPending \|\| saveStates\[section\.key\]\?\.status === "saving"\}/);
  assert.match(wizardBlock, /onClick=\{\(\) => void submitCurrentBooklet\(\)\}/);

  const submitMutationStart = caseDetail.indexOf("const submitBookletMutation = useMutation");
  const submitMutationEnd = caseDetail.indexOf("const updateChecklistRowMutation = useMutation", submitMutationStart);
  const submitMutationBlock = caseDetail.slice(submitMutationStart, submitMutationEnd);
  assert.match(submitMutationBlock, /updateBookletSectionMutation\.mutateAsync\(\{ item, sectionKey, status, answers \}\)/);
  assert.match(submitMutationBlock, /apiRequest\("POST", `\/api\/financial-disclosure-items\/\$\{updatedItem\.id\}\/booklet-submit`, \{\}\)/);
});

test("financial disclosure booklet fillable PDF templates and export are first-class staff-only interfaces", () => {
  assert.match(schema, /COURT_FORM_TYPES[\s\S]*"FinancialDisclosureBooklet"/);
  assert.match(courtFormPage, /FinancialDisclosureBooklet/);
  assert.match(courtFormPage, /Financial Disclosure Booklet/);
  assert.match(courtFormService, /formType !== "FinancialDisclosureBooklet"/);
  assert.match(mergeSources, /Financial Disclosure Booklet/);
  assert.match(mergeSources, /financialDisclosureBooklet\.partyName/);
  assert.match(mergeSources, /FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA/);
  assert.match(bookletAutoMap, /autoRepairFinancialDisclosureBookletMapping/);
  assert.match(bookletAutoMap, /inferFinancialDisclosureBookletSource/);
  assert.match(bookletAutoMap, /auditFinancialDisclosureBookletMapping/);
  assert.match(bookletAutoMap, /getFinancialDisclosureBookletMappingCandidates/);
  assert.match(bookletAutoMap, /financialDisclosureBooklet\./);
  assert.match(courtFormRoutes, /\/api\/court-form-templates\/:id\/mapping-audit/);
  assert.match(courtFormRoutes, /FinancialDisclosureBooklet/);
  assert.match(courtFormRoutes, /auditFinancialDisclosureBookletMapping/);
  assert.match(bookletMappingAuditScript, /loadRuntimeEnv/);
  assert.match(bookletMappingAuditScript, /auditFinancialDisclosureBookletMapping/);
  assert.doesNotMatch(bookletMappingAuditScript, /DATABASE_URL/);
  assert.match(courtFormPage, /type MappingAuditRow/);
  assert.match(courtFormPage, /mappingAuditQuery/);
  assert.match(courtFormPage, /data-testid="card-financial-disclosure-booklet-mapping-audit"/);
  assert.match(courtFormPage, /data-testid="row-booklet-mapping-audit"/);
  assert.match(financialService, /getAutoMappedFinancialDisclosureBookletTemplate/);
  assert.match(financialService, /storage\.updateCourtFormTemplate\(template\.id, \{ fieldMapping: repaired\.fieldMapping \}\)/);
  assert.match(financialService, /Financial disclosure booklet auto-mapping could not find any safe PDF field matches/);
  assert.match(financialService, /previewFinancialDisclosureBookletPdf/);
  assert.match(financialService, /exportFinancialDisclosureBookletPdf/);
  assert.match(financialService, /updateBookletPdfField/);
  assert.match(financialService, /Clients cannot preview financial disclosure booklet PDFs/);
  assert.match(financialService, /Clients cannot export financial disclosure booklet PDFs/);
  assert.match(financialService, /source\.startsWith\("financialDisclosureBooklet\."\)/);
  assert.match(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-booklet\/:partyId\/pdf-preview-state/);
  assert.match(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-booklet\/:partyId\/preview\.pdf/);
  assert.match(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-booklet\/:partyId\/export\.pdf/);
  assert.match(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-booklet\/:partyId\/pdf-field/);
  assert.match(sessionRoutes, /previewFinancialDisclosureBookletPdf\(req\.params\.id,\s*req\.params\.partyId/);
  assert.match(sessionRoutes, /exportFinancialDisclosureBookletPdf\(req\.params\.id,\s*req\.params\.partyId/);
  assert.match(sessionRoutes, /updateBookletPdfField\(req\.params\.id,\s*req\.params\.partyId/);
  assert.match(sessionRoutes, /Content-Type", "application\/pdf"/);
  assert.doesNotMatch(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-booklet\/export\.docx/);
  assert.doesNotMatch(financialService, /exportCombinedBookletDocx/);
  assert.doesNotMatch(caseDetail, /export\.docx/);
  assert.match(schema, /financialDisclosureBookletTemplates = pgTable\("financial_disclosure_booklet_templates"/);
  assert.match(schema, /sourceFileName: text\("source_file_name"\)\.notNull\(\)/);
  assert.match(schema, /storageKey: text\("storage_key"\)\.notNull\(\)/);
  assert.match(schema, /placeholderKeys: jsonb\("placeholder_keys"\)/);
  assert.match(schema, /isCurrent: boolean\("is_current"\)\.notNull\(\)\.default\(false\)/);
  assert.match(structuredMigration, /CREATE TABLE IF NOT EXISTS "financial_disclosure_booklet_templates"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS financial_disclosure_booklet_templates/);
  assert.doesNotMatch(sessionRoutes, /\/api\/financial-disclosure-booklet-templates/);
  assert.doesNotMatch(sessionRoutes, /\/api\/financial-disclosure-booklet-templates\/:id\/mark-current/);
});

test("booklet section save stores A1 field answers at the canonical payload path used by combined view", () => {
  assert.match(sessionRoutes, /\/api\/financial-disclosure-items\/:id\/booklet-sections\/:sectionKey/);
  assert.match(financialService, /\[sectionKey\]: \{\s*\.\.\.\(payload\.answers as any\)\[sectionKey\],\s*\.\.\.\(input\.answers \|\| \{\}\),\s*\}/);
  assert.match(fieldBookletSchema, /main_salary_wages_gross/);
  assert.match(fieldBookletSchema, /answerAt\(input\.clientA\?\.payload\.answers \|\| \{\}, \[section\.key, field\.key\]\)/);
  assert.match(fieldBookletSchema, /answerAt\(input\.clientB\?\.payload\.answers \|\| \{\}, \[section\.key, field\.key\]\)/);
});
