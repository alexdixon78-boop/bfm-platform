/**
 * Regression checks for SOP 1.7 / Section 9 court form generation.
 *
 * Run with: npx tsx tests/court-form-generation.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const packageJson = read("../package.json");
const replitDocs = read("../replit.md");
const schema = read("../shared/schema.ts");
const permissions = read("../shared/permissions.ts");
const storage = read("../server/storage.ts");
const routesIndex = read("../server/routes/index.ts");
const fileStorage = read("../server/services/file-storage.service.ts");
const sessionService = read("../server/services/mediation-session.service.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const documentsCourtFormsSection = read("../client/src/components/case-progress/documents-court-forms-section.tsx");
const courtFormsStatusCard = read("../client/src/components/case-progress/court-forms-status-card.tsx");
const derivation = read("../client/src/components/case-progress/derivation.ts");
const courtFormsPagePath = new URL("../client/src/pages/court-forms.tsx", import.meta.url);
const courtFormsPage = existsSync(courtFormsPagePath) ? read("../client/src/pages/court-forms.tsx") : "";
const courtFormCatalog = read("../shared/court-form-catalog.ts");
const appSidebar = read("../client/src/components/layout/app-sidebar.tsx");
const courtFormRoutesPath = new URL("../server/routes/court-form.routes.ts", import.meta.url);
const courtFormRoutes = existsSync(courtFormRoutesPath) ? read("../server/routes/court-form.routes.ts") : "";
const templateServicePath = new URL("../server/services/court-form-template.service.ts", import.meta.url);
const templateService = existsSync(templateServicePath) ? read("../server/services/court-form-template.service.ts") : "";
const fieldMetadataServicePath = new URL("../server/services/court-form-field-metadata.service.ts", import.meta.url);
const fieldMetadataService = existsSync(fieldMetadataServicePath) ? read("../server/services/court-form-field-metadata.service.ts") : "";
const mappingServicePath = new URL("../server/services/court-form-mapping.service.ts", import.meta.url);
const mappingService = existsSync(mappingServicePath) ? read("../server/services/court-form-mapping.service.ts") : "";
const sourceCatalogPath = new URL("../shared/court-form-merge-sources.ts", import.meta.url);
const sourceCatalog = existsSync(sourceCatalogPath) ? read("../shared/court-form-merge-sources.ts") : "";
const generationServicePath = new URL("../server/services/court-form-generation.service.ts", import.meta.url);
const generationService = existsSync(generationServicePath) ? read("../server/services/court-form-generation.service.ts") : "";
const pdfFillServicePath = new URL("../server/services/court-form-pdf-fill.service.ts", import.meta.url);
const pdfFillService = existsSync(pdfFillServicePath) ? read("../server/services/court-form-pdf-fill.service.ts") : "";
const mappingPickerPath = new URL("../client/src/components/court-forms/court-form-mapping-picker.tsx", import.meta.url);
const mappingPicker = existsSync(mappingPickerPath) ? read("../client/src/components/court-forms/court-form-mapping-picker.tsx") : "";
const pdfEditorDialogPath = new URL("../client/src/components/case-progress/court-form-pdf-editor-dialog.tsx", import.meta.url);
const pdfEditorDialog = existsSync(pdfEditorDialogPath) ? read("../client/src/components/case-progress/court-form-pdf-editor-dialog.tsx") : "";
const fieldOrderRepairServicePath = new URL("../server/services/court-form-field-order-repair.service.ts", import.meta.url);
const fieldOrderRepairService = existsSync(fieldOrderRepairServicePath) ? read("../server/services/court-form-field-order-repair.service.ts") : "";
const fieldOrderRepairScriptPath = new URL("../server/scripts/repair-court-form-field-order.ts", import.meta.url);
const fieldOrderRepairScript = existsSync(fieldOrderRepairScriptPath) ? read("../server/scripts/repair-court-form-field-order.ts") : "";
const emailServicePath = new URL("../server/services/court-form-email.service.ts", import.meta.url);
const courtFormEmailService = existsSync(emailServicePath) ? read("../server/services/court-form-email.service.ts") : "";
const dbBootstrapPath = new URL("../server/db-bootstrap.ts", import.meta.url);
const dbBootstrap = existsSync(dbBootstrapPath) ? read("../server/db-bootstrap.ts") : "";
const migrationPath = new URL("../migrations/0014_court_form_generation.sql", import.meta.url);
const migration = existsSync(migrationPath) ? read("../migrations/0014_court_form_generation.sql") : "";
const fieldMetadataMigrationPath = new URL("../migrations/0020_court_form_field_metadata.sql", import.meta.url);
const fieldMetadataMigration = existsSync(fieldMetadataMigrationPath) ? read("../migrations/0020_court_form_field_metadata.sql") : "";
const templateSoftDeleteMigrationPath = new URL("../migrations/0025_court_form_template_soft_delete.sql", import.meta.url);
const templateSoftDeleteMigration = existsSync(templateSoftDeleteMigrationPath) ? read("../migrations/0025_court_form_template_soft_delete.sql") : "";
const courtFormTypesBlock = schema.slice(
  schema.indexOf("export const COURT_FORM_TYPES"),
  schema.indexOf("export const COURT_FORM_TEMPLATE_FORM_TYPES"),
);

test("schema and migration define versioned court form templates, guidance, drafts, and generations", () => {
  assert.match(packageJson, /"pdf-lib"/);
  assert.match(schema, /COURT_FORM_TYPES[\s\S]*"FM1"[\s\S]*"C100"[\s\S]*"FormA"[\s\S]*"FormE"[\s\S]*"AgreementToMediate"[\s\S]*"VoucherSchemeClientConsent"[\s\S]*"VoucherDiversityQuestionnaireOptIn"[\s\S]*"VoucherMojResearchContactOptIn"[\s\S]*"DraftFinancialSchedule"/);
  assert.doesNotMatch(courtFormTypesBlock, /"C1A"|"C2"|"C8"|"C79"|"C63"|"D81"|"A1"/);
  assert.match(schema, /courtFormTemplates = pgTable\("court_form_templates"/);
  assert.match(schema, /fieldNames: jsonb\("field_names"\)/);
  assert.match(schema, /fieldMetadata: jsonb\("field_metadata"\)/);
  assert.match(schema, /fieldMapping: jsonb\("field_mapping"\)/);
  assert.match(schema, /deletedAt: timestamp\("deleted_at"\)/);
  assert.match(schema, /deletedBy: varchar\("deleted_by"\)\.references\(\(\) => users\.id, \{ onDelete: "set null" \}\)/);
  assert.match(schema, /uniqueIndex\("court_form_templates_type_version_unique"\)[\s\S]*\.where\(sql`deleted_at IS NULL`\)/);
  assert.match(schema, /courtFormGuidance = pgTable\("court_form_guidance"/);
  assert.match(schema, /legalSignoffStatus: text\("legal_signoff_status"\)\.notNull\(\)\.default\("draft"\)/);
  assert.match(schema, /courtFormDrafts = pgTable\("court_form_drafts"/);
  assert.match(schema, /uniqueIndex\("court_form_drafts_case_party_type_unique"\)\.on\(table\.caseId,\s*table\.partyId,\s*table\.formType\)/);
  assert.match(schema, /courtFormGenerations = pgTable\("court_form_generations"/);
  assert.match(schema, /resendHistory: jsonb\("resend_history"\)/);
  assert.match(schema, /courtFormTemplateId: varchar\("court_form_template_id"\)/);
  assert.match(schema, /courtFormGenerationId: varchar\("court_form_generation_id"\)/);
  assert.match(schema, /generatedDocumentId: varchar\("generated_document_id"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "court_form_templates"/);
  assert.match(fieldMetadataMigration, /ADD COLUMN IF NOT EXISTS "field_metadata" jsonb DEFAULT '\[\]'::jsonb NOT NULL/);
  assert.match(templateSoftDeleteMigration, /ADD COLUMN IF NOT EXISTS "deleted_at" timestamp/);
  assert.match(templateSoftDeleteMigration, /ADD COLUMN IF NOT EXISTS "deleted_by" varchar/);
  assert.match(templateSoftDeleteMigration, /DROP INDEX IF EXISTS "court_form_templates_type_version_unique"/);
  assert.match(templateSoftDeleteMigration, /WHERE "deleted_at" IS NULL/);
  assert.match(dbBootstrap, /ALTER TABLE court_form_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP/);
  assert.match(dbBootstrap, /ALTER TABLE court_form_templates ADD COLUMN IF NOT EXISTS deleted_by VARCHAR/);
  assert.match(dbBootstrap, /WHERE deleted_at IS NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "court_form_guidance"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "court_form_drafts"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "court_form_generations"/);
  assert.match(migration, /ALTER TABLE "party_required_forms"[\s\S]*ADD COLUMN IF NOT EXISTS "court_form_template_id"/);
});

test("permissions and routes expose court forms through RBAC and admin-only template management", () => {
  assert.match(permissions, /"court_forms"/);
  assert.match(permissions, /role: "superadmin", section: "court_forms", canView: true, canEdit: true/);
  assert.match(permissions, /role: "subadmin", section: "court_forms", canView: true, canEdit: true/);
  assert.match(permissions, /role: "mediator", section: "court_forms", canView: true, canEdit: true/);
  assert.match(permissions, /role: "client", section: "court_forms", canView: false, canEdit: false/);
  assert.match(permissions, /role: "staff", section: "court_forms", canView: false, canEdit: false/);
  assert.match(routesIndex, /courtFormRoutes/);
  assert.match(courtFormRoutes, /requirePermission\("court_forms", "view"\)/);
  assert.match(courtFormRoutes, /requirePermission\("court_forms", "edit"\)/);
  assert.match(courtFormRoutes, /requireTemplateManager/);
  assert.match(courtFormRoutes, /\/api\/court-form-templates/);
  assert.match(courtFormRoutes, /\/api\/court-form-guidance/);
  assert.match(courtFormRoutes, /\/api\/cases\/:caseId\/court-forms/);
  assert.match(courtFormRoutes, /\/api\/court-form-generations\/:id\/resend/);
});

test("court form routes do not install broad auth middleware that blocks the SPA shell", () => {
  assert.doesNotMatch(courtFormRoutes, /router\.use\(requireAuth\)/);
  assert.match(courtFormRoutes, /router\.get\("\/api\/court-form-templates", requireAuth, requirePermission\("court_forms", "view"\)/);
  assert.match(courtFormRoutes, /router\.get\("\/api\/cases\/:caseId\/court-forms", requireAuth, requirePermission\("court_forms", "view"\)/);
});

test("court form templates are soft-deleted from active library without breaking history", () => {
  assert.match(storage, /deleteCourtFormTemplate/);
  assert.match(templateService, /async deleteTemplate\(id: string, actor: Pick<User, "id">\)/);
  assert.match(templateService, /template\.deletedAt/);
  assert.match(templateService, /storage\.deleteCourtFormTemplate\(id, actor\.id\)/);
  assert.match(templateService, /Cannot update an archived court form template/);
  assert.match(templateService, /Cannot replace an archived court form template/);
  assert.match(templateService, /Cannot map an archived court form template/);
  assert.match(templateService, /Cannot mark an archived court form template current/);
  assert.match(courtFormRoutes, /router\.delete\("\/api\/court-form-templates\/:id", requireAuth, requirePermission\("court_forms", "edit"\)/);
  assert.match(courtFormRoutes, /courtFormTemplateService\.deleteTemplate\(req\.params\.id, getUser\(req as \{ user\?: User \}\)\)/);
  assert.match(courtFormRoutes, /logAudit\(\{[\s\S]*action: "delete"[\s\S]*entity: "court_form_template"/);
  assert.match(generationService, /Selected court form template is archived/);
  assert.match(generationService, /isArchivedTemplate\(template\)/);
  assert.match(schema, /courtFormGenerations = pgTable\("court_form_generations"[\s\S]*onDelete: "restrict"/);
  assert.match(replitDocs, /Archived court-form templates are hidden from active template management/i);
});

test("court form repository excludes archived templates from active list and current lookups", () => {
  const repositoryPath = new URL("../server/repositories/court-form.repository.ts", import.meta.url);
  const repository = existsSync(repositoryPath) ? read("../server/repositories/court-form.repository.ts") : "";
  assert.match(repository, /isNull\(courtFormTemplates\.deletedAt\)/);
  assert.match(repository, /listTemplates\(\)[\s\S]*where\(isNull\(courtFormTemplates\.deletedAt\)\)/);
  assert.match(repository, /getCurrentTemplate[\s\S]*isNull\(courtFormTemplates\.deletedAt\)/);
  assert.match(repository, /async deleteTemplate\(id: string, deletedBy: string\)/);
  assert.match(repository, /isCurrent: false/);
  assert.match(repository, /deletedAt: new Date\(\)/);
  assert.match(repository, /deletedBy/);
});

test("backend services fill and flatten uploaded PDFs, gate generation by MIAM validity, and track send attempts", () => {
  assert.match(fileStorage, /saveCourtFormTemplateFile/);
  assert.match(fileStorage, /getStoredFileBuffer/);
  assert.match(fileStorage, /saveCaseDocumentFile[\s\S]*folder: "case-documents"/);
  assert.match(fileStorage, /saveCourtFormTemplateFile[\s\S]*folder: "court-form-templates"/);
  assert.match(storage, /courtFormTemplateRepo/);
  assert.match(storage, /createCourtFormGeneration/);
  assert.match(storage, /upsertCourtFormDraft/);
  assert.match(templateService, /PDFDocument\.load/);
  assert.match(templateService, /getForm\(\)\.getFields\(\)/);
  assert.match(templateService, /extractCourtFormFieldMetadata/);
  assert.match(templateService, /markCurrent/);
  assert.match(templateService, /Form E template must be verified against gov\.uk before it can be marked current/);
  assert.match(mappingService, /COURT_FORM_MERGE_SOURCES/);
  assert.match(mappingService, /draft\./);
  assert.match(mappingService, /validateFieldMapping/);
  assert.match(generationService, /getMiamValidityForCourtAction/);
  assert.match(pdfFillService, /form\.flatten\(\)/);
  assert.match(generationService, /saveCaseDocumentFile/);
  assert.match(generationService, /createCaseDocument/);
  assert.match(generationService, /deliveryStatus: sent \? "sent" : "failed"/);
  assert.match(courtFormEmailService, /attachments/);
  assert.match(courtFormEmailService, /sendCourtFormPdfEmail/);
});

test("court form template extraction records field metadata for editable previews", async () => {
  assert.match(fieldMetadataService, /export type CourtFormFieldMetadata/);
  assert.match(fieldMetadataService, /type: "text" \| "checkbox" \| "radio" \| "select" \| "unsupported"/);
  assert.match(fieldMetadataService, /pageIndex/);
  assert.match(fieldMetadataService, /rect: \{ x: number; y: number; width: number; height: number \}/);
  assert.match(fieldMetadataService, /options\?: string\[\]/);
  assert.match(templateService, /extractCourtFormFieldMetadata/);
  assert.match(fieldOrderRepairService, /fieldMetadata: extractedFieldMetadata/);

  const { extractCourtFormFieldMetadata } = await import("../server/services/court-form-field-metadata.service");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  const form = pdf.getForm();
  const textField = form.createTextField("clientName");
  textField.addToPage(page, { x: 24, y: 120, width: 180, height: 24 });
  const checkBox = form.createCheckBox("confirmed");
  checkBox.addToPage(page, { x: 24, y: 80, width: 16, height: 16 });
  const bytes = await pdf.save();

  const metadata = await extractCourtFormFieldMetadata(bytes);

  assert.deepEqual(metadata.map((field) => field.name), ["clientName", "confirmed"]);
  assert.equal(metadata[0].type, "text");
  assert.equal(metadata[0].pageIndex, 0);
  assert.ok(Math.abs(metadata[0].rect.x - 23.5) < 0.01);
  assert.ok(Math.abs(metadata[0].rect.y - 119.5) < 0.01);
  assert.ok(Math.abs(metadata[0].rect.width - 181) < 0.01);
  assert.ok(Math.abs(metadata[0].rect.height - 25) < 0.01);
  assert.equal(metadata[1].type, "checkbox");
});

test("court form templates can be previewed through an authenticated inline PDF endpoint", () => {
  assert.match(courtFormRoutes, /router\.get\("\/api\/court-form-templates\/:id\/preview", requireAuth, requirePermission\("court_forms", "view"\)/);
  assert.match(courtFormRoutes, /courtFormTemplateService\.getTemplateBuffer\(template\)/);
  assert.match(courtFormRoutes, /Content-Type", "application\/pdf"/);
  assert.match(courtFormRoutes, /inline; filename=/);
  assert.match(courtFormRoutes, /Cache-Control", "private, max-age=300"/);
});

test("court form PDF filling uses typed fields and regenerates appearances before flattening", () => {
  assert.match(pdfFillService, /PDFTextField/);
  assert.match(pdfFillService, /PDFCheckBox/);
  assert.match(pdfFillService, /PDFDropdown/);
  assert.match(pdfFillService, /PDFOptionList/);
  assert.match(pdfFillService, /PDFRadioGroup/);
  assert.match(pdfFillService, /StandardFonts\.Helvetica/);
  assert.match(pdfFillService, /embedFont\(StandardFonts\.Helvetica\)/);
  assert.match(pdfFillService, /form\.updateFieldAppearances\(appearanceFont\)/);
  assert.match(pdfFillService, /form\.flatten\(\)/);
  assert.doesNotMatch(pdfFillService, /setText\?:/);
  assert.match(generationService, /fillCourtFormPdfBytes/);
});

test("court form PDF filling applies draft field overrides before mapped source values", async () => {
  assert.match(pdfFillService, /PDF_FIELD_OVERRIDES_KEY/);
  assert.match(pdfFillService, /applyPdfFieldOverrides/);
  assert.match(generationService, /applyPdfFieldOverrides\(values, answers, template\)/);

  const { applyPdfFieldOverrides, PDF_FIELD_OVERRIDES_KEY } = await import("../server/services/court-form-pdf-fill.service");
  const values = applyPdfFieldOverrides(
    { clientName: "Mapped Name", confirmed: "no" },
    { [PDF_FIELD_OVERRIDES_KEY]: { clientName: "Edited Name", confirmed: true, unknown: "Ignored" } },
    { fieldMetadata: [{ name: "clientName" }, { name: "confirmed" }] },
  );

  assert.deepEqual(values, { clientName: "Edited Name", confirmed: "true" });
});

test("court form PDF fill service flattens a generated AcroForm preview without records", async () => {
  assert.ok(existsSync(pdfFillServicePath), "expected a pure court-form PDF fill service");
  const { fillCourtFormPdfBytes } = await import("../server/services/court-form-pdf-fill.service");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  const form = pdf.getForm();
  const nameField = form.createTextField("clientName");
  nameField.addToPage(page, { x: 24, y: 120, width: 180, height: 24 });
  const confirmedField = form.createCheckBox("confirmed");
  confirmedField.addToPage(page, { x: 24, y: 80, width: 16, height: 16 });
  const sourceBytes = await pdf.save();

  const previewBytes = await fillCourtFormPdfBytes(sourceBytes, { clientName: "Jane Example", confirmed: "yes" });
  const flattened = await PDFDocument.load(previewBytes);

  assert.equal(flattened.getForm().getFields().length, 0);
  assert.ok(previewBytes.length > 0);
});

test("draft financial schedule is available as a PDF court form template with mapping sources", async () => {
  assert.match(courtFormCatalog, /DraftFinancialSchedule/);
  assert.match(courtFormCatalog, /DRAFT FINANCIAL SCHEDULE/);
  assert.match(generationService, /DraftFinancialSchedule: "DRAFT FINANCIAL SCHEDULE"/);
  assert.match(sourceCatalog, /Draft Financial Schedule/);
  assert.match(sourceCatalog, /DRAFT_FINANCIAL_SCHEDULE_PDF_ROW_LIMIT = 20/);
  const { COURT_FORM_MERGE_SOURCE_VALUES } = await import("../shared/court-form-merge-sources");
  assert.ok(COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.header.ref"));
  assert.ok(COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.realisableAssets.currentAccounts.1.description"));
  assert.ok(COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.realisableAssets.currentAccounts.1.clientA"));
  assert.ok(COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.realisableAssets.currentAccounts.1.clientB"));
  assert.ok(!COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.realisableAssets.property.value.joint"));
  assert.ok(!COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.realisableAssets.currentAccounts.1.joint"));
  assert.ok(COURT_FORM_MERGE_SOURCE_VALUES.includes("draftFinancialSchedule.liabilities.loans.20.clientB"));

  const { buildDefaultDraftFinancialSchedulePayload, buildDraftFinancialSchedulePdfTemplateData } = await import("../shared/draft-financial-schedule-schema");
  const values = buildDraftFinancialSchedulePdfTemplateData({
    ...buildDefaultDraftFinancialSchedulePayload(),
    header: { ref: "BFM-2026-0002", clientNames: "A Client and B Client", date: "2026-09-09" },
    realisableAssets: {
      ...buildDefaultDraftFinancialSchedulePayload().realisableAssets,
      currentAccounts: [{ description: "Main current", clientA: "50", clientB: "50", notes: "Party account" }],
    },
  });

  assert.equal(values["draftFinancialSchedule.header.ref"], "BFM-2026-0002");
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.1.description"], "Main current");
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.1.joint"], undefined);
});

test("draft financial schedule PDF values fill and flatten a mapped AcroForm template", async () => {
  const { fillCourtFormPdfBytes } = await import("../server/services/court-form-pdf-fill.service");
  const { buildDefaultDraftFinancialSchedulePayload, buildDraftFinancialSchedulePdfTemplateData } = await import("../shared/draft-financial-schedule-schema");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 240]);
  const form = pdf.getForm();
  form.createTextField("caseRef").addToPage(page, { x: 24, y: 180, width: 160, height: 20 });
  form.createTextField("account1Description").addToPage(page, { x: 24, y: 140, width: 180, height: 20 });
  const sourceBytes = await pdf.save();
  const scheduleValues = buildDraftFinancialSchedulePdfTemplateData({
    ...buildDefaultDraftFinancialSchedulePayload(),
    header: { ref: "BFM-2026-0003", clientNames: "Client One and Client Two", date: "2026-09-09" },
    realisableAssets: {
      ...buildDefaultDraftFinancialSchedulePayload().realisableAssets,
      currentAccounts: [{ description: "Everyday Bank Current", clientA: "", clientB: "1200", notes: "" }],
    },
  });
  const previewBytes = await fillCourtFormPdfBytes(sourceBytes, {
    caseRef: scheduleValues["draftFinancialSchedule.header.ref"],
    account1Description: scheduleValues["draftFinancialSchedule.realisableAssets.currentAccounts.1.description"],
  });
  const flattened = await PDFDocument.load(previewBytes);

  assert.equal(flattened.getForm().getFields().length, 0);
  assert.ok(previewBytes.length > 0);
});

test("required form signing is linked to current templates and produces generated PDFs after signature", () => {
  assert.match(sessionService, /VoucherSchemeClientConsent/);
  assert.match(sessionService, /VoucherDiversityQuestionnaireOptIn/);
  assert.match(sessionService, /VoucherMojResearchContactOptIn/);
  assert.match(sessionService, /templateForRequiredForm/);
  assert.match(sessionService, /generateRequiredFormTemplateAfterSignature/);
  assert.match(generationService, /generateRequiredFormTemplateAfterSignature/);
  assert.match(sessionService, /courtFormGenerationId/);
  assert.match(sessionService, /generatedDocumentId/);
});

test("frontend replaces court form mock UI with template management, drafts, generation history, and guidance banner", () => {
  assert.match(courtFormCatalog, /AgreementToMediate/);
  assert.match(courtFormCatalog, /VoucherSchemeClientConsent/);
  assert.match(courtFormCatalog, /VoucherDiversityQuestionnaireOptIn/);
  assert.match(courtFormCatalog, /VoucherMojResearchContactOptIn/);
  assert.match(courtFormCatalog, /FormE/);
  assert.match(courtFormCatalog, /Court Forms/);
  assert.match(courtFormCatalog, /Family Mediation Voucher Scheme client consent/);
  assert.match(courtFormCatalog, /Family Mediation Voucher Scheme: Privacy Policy and Client Consent/);
  assert.match(courtFormsPage, /verified against GOV\.UK/i);
  assert.match(courtFormsPage, /extracted PDF fields/i);
  assert.match(courtFormsPage, /Mapping/i);
  assert.match(courtFormsPage, /Guidance/i);
  assert.match(caseDetail, /<DocumentsCourtFormsSection/);
  assert.match(caseDetail, /<CourtFormsStatusCard caseId=\{caseId!\}/);
  assert.match(courtFormsStatusCard, /\/api\/cases\/\$\{caseId\}\/court-forms/);
  assert.match(courtFormsStatusCard, /generationState/);
  assert.match(documentsCourtFormsSection, /\/api\/cases\/\$\{caseId\}\/court-forms/);
  assert.match(documentsCourtFormsSection, /Procedural guidance only\. This is not legal advice\./);
  assert.match(documentsCourtFormsSection, /Generate locked PDF/);
  assert.match(documentsCourtFormsSection, /deliveryStatus/);
  assert.doesNotMatch(caseDetail, /UI preview only/);
  assert.doesNotMatch(caseDetail, /no email is sent and no record is saved/i);
});

test("forms workspace separates court forms from mediation documents without changing the route or permission", () => {
  assert.match(appSidebar, /\{ title: "Forms", url: "\/court-forms", icon: FileText, section: "court_forms" \}/);
  assert.match(courtFormsPage, /const DEFAULT_FORM_CATEGORY = "court"/);
  assert.match(courtFormCatalog, /id: "court",\s*label: "Court Forms"/);
  assert.match(courtFormCatalog, /id: "mediation",\s*label: "Mediation Documents"/);
  for (const formType of ["FM1", "C100", "FormA", "FormE"]) {
    assert.match(courtFormCatalog, new RegExp(`id: "${formType}"[^\\n]+category: "court"`));
  }
  for (const formType of ["AgreementToMediate", "VoucherSchemeClientConsent", "VoucherDiversityQuestionnaireOptIn", "VoucherMojResearchContactOptIn", "DraftFinancialSchedule", "FinancialDisclosureBooklet"]) {
    assert.match(courtFormCatalog, new RegExp(`id: "${formType}"[^\\n]+category: "mediation"`));
  }
  assert.match(courtFormsPage, /filteredTemplates/);
  assert.match(courtFormsPage, /visibleUploadTypes/);
  assert.match(courtFormsPage, /filteredTemplates\.find\(\(template\) => template\.id === selectedTemplateId\) \|\| filteredTemplates\?\.\[0\]/);
  assert.match(courtFormsPage, /setSelectedTemplateId\(""\)/);
});

test("court forms upload menu exposes only one active MoJ privacy consent option", () => {
  assert.match(courtFormsPage, /const COURT_FORM_UPLOAD_TYPES = FORM_TYPES\.filter/);
  assert.match(courtFormsPage, /form\.id !== "VoucherDiversityQuestionnaireOptIn"/);
  assert.match(courtFormsPage, /visibleUploadTypes\.map/);
  assert.equal([...courtFormCatalog.matchAll(/Family Mediation Voucher Scheme: Privacy Policy and Client Consent/g)].length, 1);
  assert.match(courtFormCatalog, /Legacy Diversity questionnaire opt-in/);
});

test("court forms mapping card previews the selected uploaded template in a modal", () => {
  assert.match(courtFormsPage, /Preview uploaded PDF/);
  assert.match(courtFormsPage, /data-testid="button-preview-template-pdf"/);
  assert.match(courtFormsPage, /data-testid="dialog-template-pdf-preview"/);
  assert.match(courtFormsPage, /data-testid="iframe-template-pdf-preview"/);
  assert.match(courtFormsPage, /\/api\/court-form-templates\/\$\{selectedTemplate\.id\}\/preview/);
  assert.doesNotMatch(courtFormsPage, /iframe[\s\S]{0,120}sourceFileUrl/);
});

test("court form template upload shows a blocking staged progress dialog", () => {
  assert.match(courtFormsPage, /Dialog open=\{uploadProgressOpen\}/);
  assert.match(courtFormsPage, /data-testid="dialog-court-form-upload-progress"/);
  assert.match(courtFormsPage, /Preparing PDF/);
  assert.match(courtFormsPage, /Uploading template/);
  assert.match(courtFormsPage, /Extracting PDF fields/);
  assert.match(courtFormsPage, /Refreshing template library/);
  assert.match(courtFormsPage, /Upload failed/);
  assert.match(courtFormsPage, /uploadProgressStatus === "error"/);
  assert.match(courtFormsPage, /disabled=\{uploadMutation\.isPending \|\| !file \|\| !versionLabel\.trim\(\)\}/);
  assert.match(courtFormsPage, /setUploadProgressOpen\(true\)/);
  assert.match(courtFormsPage, /setUploadProgressStep\("refreshing"\)/);
  assert.match(courtFormsPage, /setUploadProgressOpen\(false\)/);
});

test("court form templates can replace the PDF on an existing uploaded template", () => {
  assert.match(courtFormRoutes, /\/api\/court-form-templates\/:id\/reupload/);
  assert.match(courtFormRoutes, /templateReuploadSchema/);
  assert.match(courtFormRoutes, /courtFormTemplateService\.reuploadTemplate/);
  assert.match(templateService, /async reuploadTemplate/);
  assert.match(templateService, /removedMappings/);
  assert.match(templateService, /existing\.fieldMapping/);
  assert.match(templateService, /new Set\(fieldNames\)/);
  assert.match(templateService, /storage\.updateCourtFormTemplate\(id, \{/);
  assert.match(templateService, /sourceFileName: input\.sourceFileName/);
  assert.match(templateService, /sourceFileUrl: stored\.fileUrl/);
  assert.match(templateService, /storageKey: stored\.storageKey/);
  assert.match(templateService, /fieldNames/);
  assert.doesNotMatch(templateService, /reuploadTemplate[\s\S]*storage\.createCourtFormTemplate/);
});

test("court forms page exposes a selected-template replace PDF flow", () => {
  assert.match(courtFormsPage, /Replace PDF/);
  assert.match(courtFormsPage, /data-testid="button-replace-template-pdf"/);
  assert.match(courtFormsPage, /data-testid="dialog-template-pdf-reupload"/);
  assert.match(courtFormsPage, /reuploadMutation/);
  assert.match(courtFormsPage, /\/api\/court-form-templates\/\$\{selectedTemplate\.id\}\/reupload/);
  assert.match(courtFormsPage, /removedMappings/);
  assert.match(courtFormsPage, /mappings need review/);
  assert.match(courtFormsPage, /setSelectedTemplateId\(updatedTemplate\.id\)/);
});

test("court forms page exposes a safe delete flow for uploaded templates", () => {
  assert.match(courtFormsPage, /DeleteDialog/);
  assert.match(courtFormsPage, /deleteTemplateMutation/);
  assert.match(courtFormsPage, /\/api\/court-form-templates\/\$\{deleteTemplateTarget\.id\}/);
  assert.match(courtFormsPage, /data-testid=\{`button-delete-court-form-template-\$\{template\.id\}`\}/);
  assert.match(courtFormsPage, /confirmTestId="dialog-delete-court-form-template-confirm"/);
  assert.match(courtFormsPage, /This removes the template from active use but keeps historical generated documents\./);
  assert.match(courtFormsPage, /setSelectedTemplateId\(""\)/);
  assert.match(courtFormsPage, /Template deleted/);
});

test("court form docs describe replacing an existing template PDF", () => {
  assert.match(replitDocs, /replace an existing template PDF/i);
  assert.match(replitDocs, /preserving matching mappings/i);
});

test("court form mapping presents PDF fields in uploaded document order without changing raw values", () => {
  assert.ok(existsSync(mappingPickerPath), "expected a reusable searchable court form mapping picker");
  assert.match(courtFormsPage, /formatPdfFieldLabel/);
  assert.match(documentsCourtFormsSection, /formatPdfFieldLabel/);
  assert.match(mappingPicker, /CommandInput/);
  assert.match(mappingPicker, /CommandList[\s\S]{0,120}max-h-\[320px\]/);
  assert.match(mappingPicker, /PopoverContent/);
  assert.match(mappingPicker, /FieldMappingPicker/);
  assert.match(mappingPicker, /SourceMappingPicker/);
  assert.match(mappingPicker, /selectedOption\?\.label \|\| formatPdfFieldLabel\(value\)/);
  assert.match(mappingPicker, /value=\{option\.raw\}/);
  assert.match(mappingPicker, /\{option\.label\}/);
  assert.match(courtFormsPage, /getPdfFieldOptions/);
  assert.match(courtFormsPage, /pdfField: pdfFieldOptions\[0\]\?\.raw \|\| ""/);
  assert.match(documentsCourtFormsSection, /pdfField: pdfFieldOptions\[0\]\?\.raw \|\| ""/);
  assert.doesNotMatch(courtFormsPage, /getSortedPdfFields/);
  assert.doesNotMatch(documentsCourtFormsSection, /sortedPdfFields/);
  assert.doesNotMatch(courtFormsPage, /localeCompare\([^)]*numeric: true/);
  assert.doesNotMatch(documentsCourtFormsSection, /localeCompare\([^)]*numeric: true/);
  assert.doesNotMatch(templateService, /getFields\(\)\.map\(\(field\) => field\.getName\(\)\)\.sort\(\)/);
});

test("court form field order repair re-extracts stored templates without touching mappings", () => {
  assert.ok(existsSync(fieldOrderRepairServicePath), "expected a court form field order repair service");
  assert.ok(existsSync(fieldOrderRepairScriptPath), "expected an explicit court form field order repair script");
  assert.match(packageJson, /"court-forms:repair-field-order"/);
  assert.match(fieldOrderRepairService, /repairCourtFormTemplateFieldOrder/);
  assert.match(fieldOrderRepairService, /storage\.listCourtFormTemplates\(\)/);
  assert.match(fieldOrderRepairService, /courtFormTemplateService\.getTemplateBuffer\(template\)/);
  assert.match(fieldOrderRepairService, /PDFDocument\.load\(buffer\)/);
  assert.match(fieldOrderRepairService, /getForm\(\)\.getFields\(\)\.map\(\(field\) => field\.getName\(\)\)/);
  assert.match(fieldOrderRepairService, /storage\.updateCourtFormTemplate\(template\.id, \{ fieldNames: extractedFieldNames, fieldMetadata: extractedFieldMetadata \}\)/);
  assert.doesNotMatch(fieldOrderRepairService, /fieldMapping/);
  assert.match(fieldOrderRepairScript, /import \{ loadRuntimeEnv \} from "\.\.\/config\/runtime-env"/);
  assert.match(fieldOrderRepairScript, /await loadRuntimeEnv\(\)/);
  assert.ok(
    fieldOrderRepairScript.indexOf("await loadRuntimeEnv()") < fieldOrderRepairScript.indexOf('await import("../services/court-form-field-order-repair.service")'),
    "repair script should load runtime env before importing repair service",
  );
  assert.ok(
    fieldOrderRepairScript.indexOf("await loadRuntimeEnv()") < fieldOrderRepairScript.indexOf('await import("../db")'),
    "repair script should load runtime env before importing the db pool",
  );
  assert.match(fieldOrderRepairScript, /repairCourtFormTemplateFieldOrder/);
  assert.match(fieldOrderRepairScript, /pool\.end\(\)/);
});

test("case court forms payload backfills missing field metadata for editable previews", () => {
  assert.match(templateService, /ensureTemplateFieldMetadata/);
  assert.match(templateService, /hasCompleteFieldMetadata/);
  assert.match(templateService, /storage\.updateCourtFormTemplate\(template\.id, \{ fieldNames, fieldMetadata \}\)/);
  assert.match(generationService, /Promise\.all\(templates\.map\(\(template\) => courtFormTemplateService\.ensureTemplateFieldMetadata\(template\)\)\)/);
});

test("saving court form PDF draft overrides is validated and audited without field values", () => {
  assert.match(generationService, /validatePdfFieldOverrides/);
  assert.match(generationService, /Unknown PDF draft override field/);
  assert.match(generationService, /court_form_draft_saved/);
  assert.match(generationService, /changedFieldCount/);
  assert.match(generationService, /PDF field draft saved/);
  assert.doesNotMatch(generationService, /JSON\.stringify\(\{[\s\S]{0,120}answers/);
});

test("case court forms endpoint exposes readiness, richer case data sources, and case-completion fields", () => {
  assert.match(mappingService, /DemographicData/);
  assert.match(sourceCatalog, /demographic\.courtName/);
  assert.match(sourceCatalog, /demographic\.courtReference/);
  assert.match(sourceCatalog, /demographic\.disabilityOrHealthConditions/);
  assert.match(sourceCatalog, /demographic\.childrenAges/);
  assert.match(sourceCatalog, /miam\.bgLivingArrangements/);
  assert.match(sourceCatalog, /miam\.bgChildrenDetails/);
  assert.match(sourceCatalog, /miam\.welfareOfChildren/);
  assert.match(mappingService, /resolveAllWithDetails/);
  assert.match(generationService, /readiness/);
  assert.match(generationService, /hasUploadedTemplate/);
  assert.match(generationService, /hasCurrentTemplate/);
  assert.match(generationService, /requiresGovUkVerification/);
  assert.match(generationService, /missingRequiredFields/);
  assert.match(generationService, /blockingReasons/);
  assert.match(generationService, /Court form is not ready to generate/);
  assert.match(documentsCourtFormsSection, /readiness:/);
  assert.match(documentsCourtFormsSection, /Template uploaded, not current/);
  assert.match(documentsCourtFormsSection, /Form E verification required/);
  assert.match(documentsCourtFormsSection, /Mapping incomplete/);
  assert.match(documentsCourtFormsSection, /Missing case data/);
  assert.match(documentsCourtFormsSection, /Ready to generate/);
  assert.match(documentsCourtFormsSection, /resolvedFields/);
  assert.match(documentsCourtFormsSection, /missingRequiredFields/);
  assert.match(documentsCourtFormsSection, /draftAnswers/);
  assert.match(documentsCourtFormsSection, /source\.startsWith\("draft\."\)/);
});

test("court form mapping uses a shared friendly source catalog", () => {
  assert.match(sourceCatalog, /COURT_FORM_MERGE_SOURCE_GROUPS/);
  assert.match(sourceCatalog, /groupLabel: "Demographic form"/);
  assert.match(sourceCatalog, /label: "Legal aid eligible\?"/);
  assert.match(sourceCatalog, /groupLabel: "MIAM record"/);
  assert.match(sourceCatalog, /label: "OFS required\? \(inform of fees and payment upfront\)"/);
  assert.match(sourceCatalog, /sensitive: true/);
  assert.match(sourceCatalog, /value: "miam\.domesticAbuseScreening"/);
  assert.match(mappingService, /COURT_FORM_MERGE_SOURCE_VALUES/);
  assert.match(mappingService, /COURT_FORM_MERGE_SOURCE_GROUPS/);
  assert.match(mappingPicker, /SourceMappingPicker/);
  assert.match(mappingPicker, /CommandGroup/);
  assert.match(mappingPicker, /source\.label\}\{source\.sensitive \? " \(sensitive\)" : ""\}/);
  assert.match(courtFormsPage, /SourceMappingPicker/);
  assert.match(documentsCourtFormsSection, /SourceMappingPicker/);
  assert.doesNotMatch(courtFormsPage, /const MERGE_SOURCES = \[/);
});

test("case documents court forms card exposes template mapping and preview actions", () => {
  assert.match(packageJson, /"pdfjs-dist"/);
  assert.match(documentsCourtFormsSection, /Manage mapping/);
  assert.match(documentsCourtFormsSection, /CourtFormMappingDialog/);
  assert.match(documentsCourtFormsSection, /\/api\/cases\/\$\{caseId\}\/court-form-templates\/\$\{template\.id\}\/mapping/);
  assert.match(documentsCourtFormsSection, /Preview filled PDF/);
  assert.match(documentsCourtFormsSection, /\/api\/cases\/\$\{caseId\}\/court-form-preview/);
  assert.match(documentsCourtFormsSection, /CourtFormPdfEditorDialog/);
  assert.match(pdfEditorDialog, /data-testid="dialog-court-form-preview"/);
  assert.match(pdfEditorDialog, /getDocument/);
  assert.match(pdfEditorDialog, /render\(\{ canvasContext, viewport \}\)/);
  assert.match(pdfEditorDialog, /data-testid=\{`input-pdf-field-\$\{field\.name\}`\}/);
  assert.match(pdfEditorDialog, /data-testid=\{`checkbox-pdf-field-\$\{field\.name\}`\}/);
  assert.match(pdfEditorDialog, /Save draft/);
  assert.match(documentsCourtFormsSection, /PDF_FIELD_OVERRIDES_KEY/);
  assert.match(documentsCourtFormsSection, /fieldMetadata/);
  assert.match(documentsCourtFormsSection, /fieldNames=\{editableTemplate\?\.fieldNames \|\| \[\]\}/);
  assert.match(pdfEditorDialog, /data-testid="panel-court-form-preview-values"/);
  assert.match(pdfEditorDialog, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(420px,520px\)\]/);
  assert.match(pdfEditorDialog, /data-testid="panel-court-form-preview-values"[\s\S]*min-w-0 max-w-full/);
  assert.match(pdfEditorDialog, /data-testid="panel-court-form-preview-values-scroll"/);
  assert.match(pdfEditorDialog, /data-testid="panel-court-form-preview-actions"/);
  assert.match(pdfEditorDialog, /sticky bottom-0/);
  assert.match(pdfEditorDialog, /max-w-full whitespace-normal break-words/);
  assert.match(pdfEditorDialog, /className=\{`w-full min-w-0/);
  assert.match(pdfEditorDialog, /<SelectTrigger className="w-full min-w-0"/);
  assert.match(pdfEditorDialog, /buildPreviewFieldRows/);
  assert.match(pdfEditorDialog, /fieldNames\.map/);
  assert.match(pdfEditorDialog, /mappingByName/);
  assert.match(pdfEditorDialog, /resolvedByName/);
  assert.match(pdfEditorDialog, /data-testid=\{`input-preview-pdf-field-\$\{field\.name\}`\}/);
  assert.match(pdfEditorDialog, /Manual override/);
  assert.match(pdfEditorDialog, /Unmapped/);
  assert.match(pdfEditorDialog, /onPdfFieldOverrideChange\(field\.name, event\.target\.value\)/);
  assert.match(pdfEditorDialog, /Refresh preview/);
  assert.match(documentsCourtFormsSection, /previewStale/);
  assert.match(documentsCourtFormsSection, /URL\.revokeObjectURL\(previewUrl\)/);
  assert.doesNotMatch(documentsCourtFormsSection, /window\.open\(previewUrl/);
});

test("case documents tab supports blank form downloads and uploaded document preview", () => {
  assert.match(caseDetail, /\/api\/cases\/\$\{caseId\}\/document-blank-forms/);
  assert.match(caseDetail, /canViewOperationalStaffData && \(\s*<DocumentsCourtFormsSection/);
  assert.match(caseDetail, /<CaseDocumentsPanel caseId=\{caseId!\} canView=\{canViewOperationalStaffData \|\| isClient \|\| isSessionCoMediator\}/);
  assert.match(caseDetail, /Preview/);
  assert.match(caseDetail, /Download/);
  assert.match(caseDetail, /form\.canUploadCompletedForm/);
  assert.match(caseDetail, /uploadMode === "required_form"/);
  assert.match(caseDetail, /uploadMode === "case_document"/);
  assert.match(caseDetail, /data-testid=\{`row-document-blank-form-\$\{form\.formType\}`\}/);
  assert.match(caseDetail, /data-testid="button-preview-completed-form-document"/);
  assert.match(replitDocs, /Documents follows an Action \+ Library model/i);
  assert.match(replitDocs, /client completed-form upload/i);
  assert.match(replitDocs, /clients do not see the Court Forms/i);
  assert.match(replitDocs, /FM1\/C100\/Form E client uploads create reviewable case documents/i);
  assert.match(replitDocs, /preview uploaded documents/i);
});

test("case documents mapping-incomplete state points admins to the local mapping editor", () => {
  assert.match(documentsCourtFormsSection, /inlineFieldRows/);
  assert.match(documentsCourtFormsSection, /data-testid="panel-inline-court-form-mapping"/);
  assert.match(documentsCourtFormsSection, /data-testid=\{`row-inline-court-form-field-\$\{field\.pdfField\}`\}/);
  assert.match(documentsCourtFormsSection, /Unmapped/);
  assert.match(documentsCourtFormsSection, /Save mapping/);
  assert.match(documentsCourtFormsSection, /hasInlineMappingChanges/);
  assert.match(documentsCourtFormsSection, /clearInlineMapping/);
  assert.match(documentsCourtFormsSection, /button-open-mapping-empty-state/);
  assert.match(documentsCourtFormsSection, /No uploaded template is available for this form\./);
  assert.match(documentsCourtFormsSection, /You do not have permission to edit court form mappings\./);
  assert.doesNotMatch(documentsCourtFormsSection, /Add template-level mappings in Court Forms before completing case values\./);
});

test("case documents mapping editor uses admin or case lead mediator access instead of generic RBAC only", () => {
  assert.match(caseDetail, /caseLeadMediatorId=\{caseData\.mediatorId\}/);
  assert.match(documentsCourtFormsSection, /caseLeadMediatorId/);
  assert.match(documentsCourtFormsSection, /user\?\.role === "superadmin" \|\| user\?\.role === "subadmin"/);
  assert.match(documentsCourtFormsSection, /user\?\.role === "mediator" && caseLeadMediatorId === user\.id/);
  assert.match(documentsCourtFormsSection, /canManageCaseForms/);
  assert.match(documentsCourtFormsSection, /const editableTemplate = currentTemplate \|\| latestUploadedTemplate/);
  assert.match(documentsCourtFormsSection, /disabled=\{!canManageCaseForms \|\| !editableTemplate\}/);
  assert.doesNotMatch(documentsCourtFormsSection, /disabled=\{[^}]*mappingCount[^}]*\}[\s\S]{0,160}<Settings2/);
  assert.match(courtFormRoutes, /router\.patch\("\/api\/cases\/:caseId\/court-form-templates\/:id\/mapping", requireAuth,/);
  assert.doesNotMatch(courtFormRoutes, /router\.patch\("\/api\/cases\/:caseId\/court-form-templates\/:id\/mapping", requireAuth, requirePermission\("court_forms", "edit"\)/);
});

test("routes allow only admins or the case lead mediator to update mapping from case context", () => {
  assert.match(courtFormRoutes, /\/api\/court-form-merge-sources/);
  assert.match(courtFormRoutes, /\/api\/cases\/:caseId\/court-form-templates\/:id\/mapping/);
  assert.match(courtFormRoutes, /requireCaseLeadMediatorOrTemplateManager/);
  assert.match(courtFormRoutes, /existingCase\?\.mediatorId === req\.user\?\.id/);
  assert.match(courtFormRoutes, /Only superadmins, subadmins, and the case lead mediator can manage this court form mapping/);
});

test("routes allow admins or the case lead mediator to save case court form drafts", () => {
  assert.match(courtFormRoutes, /router\.put\("\/api\/cases\/:caseId\/court-form-drafts\/:formType\/:partyId", requireAuth,/);
  assert.match(courtFormRoutes, /requireCaseLeadMediatorOrTemplateManager/);
  assert.doesNotMatch(courtFormRoutes, /router\.put\("\/api\/cases\/:caseId\/court-form-drafts\/:formType\/:partyId", requireAuth, requirePermission\("court_forms", "edit"\)/);
});

test("preview produces a temporary filled pdf without document or generation records", () => {
  assert.match(courtFormRoutes, /\/api\/cases\/:caseId\/court-form-preview/);
  assert.match(courtFormRoutes, /router\.post\("\/api\/cases\/:caseId\/court-form-preview", requireAuth,/);
  assert.doesNotMatch(courtFormRoutes, /router\.post\("\/api\/cases\/:caseId\/court-form-preview", requireAuth, requirePermission\("court_forms", "edit"\)/);
  assert.match(courtFormRoutes, /Content-Type", "application\/pdf"/);
  assert.match(courtFormRoutes, /inline; filename=/);
  assert.match(courtFormRoutes, /templateId: z\.string\(\)\.trim\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(documentsCourtFormsSection, /const canPreviewCourtForm = canManageCaseForms/);
  assert.match(documentsCourtFormsSection, /templateId: editableTemplate\.id/);
  assert.match(documentsCourtFormsSection, /disabled=\{!canPreviewCourtForm \|\| !editableTemplate \|\| !selectedParty \|\| previewMutation\.isPending\}/);
  assert.doesNotMatch(documentsCourtFormsSection, /disabled=\{[^}]*selectedReadiness\?\.canGenerate[^}]*\}[\s\S]{0,160}<Eye/);
  assert.doesNotMatch(documentsCourtFormsSection, /disabled=\{!canManage \|\| !currentTemplate \|\| !selectedParty \|\| previewMutation\.isPending\}/);
  assert.match(generationService, /previewFilledPdf/);
  assert.match(generationService, /input\.templateId[\s\S]{0,120}storage\.getCourtFormTemplate\(input\.templateId\)/);
  assert.match(generationService, /template\.formType !== input\.formType/);
  assert.match(generationService, /generatePdfBytes/);
  assert.match(generationService, /const values = Object\.fromEntries\(resolved\.map\(\(field\) => \[field\.pdfField, field\.value\]\)\)/);
  const previewMethod = generationService.slice(
    generationService.indexOf("async previewFilledPdf"),
    generationService.indexOf("\n  private async requireParty", generationService.indexOf("async previewFilledPdf")),
  );
  assert.doesNotMatch(previewMethod, /createCaseDocument|createCourtFormGeneration|sendCourtFormPdfEmail|caseActivityService\.log|logAudit/);
});
