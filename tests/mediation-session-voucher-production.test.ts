/**
 * Regression checks for production mediation-session e-signature and voucher claim handling.
 *
 * Run with: npx tsx tests/mediation-session-voucher-production.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  const file = new URL(path, import.meta.url);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

const schema = read("../shared/schema.ts");
const bootstrap = read("../server/db-bootstrap.ts");
const migration = read("../migrations/0021_mediation_session_voucher_production.sql");
const sessionService = read("../server/services/mediation-session.service.ts");
const sessionRoutes = read("../server/routes/mediation-session.routes.ts");
const dashboardService = read("../server/services/dashboard.service.ts");
const partyRequiredFormRepository = read("../server/repositories/party-required-form.repository.ts");
const financeService = read("../server/services/finance.service.ts");
const stripePaymentService = read("../server/services/stripe-payment.service.ts");
const caseRepository = read("../server/repositories/case.repository.ts");
const miamRecordRoutes = read("../server/routes/miam-record.routes.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const miamRecordTab = read("../client/src/components/miam-record-tab.tsx");
const replitDoc = read("../replit.md");

test("required forms are split into agreement, mandatory voucher consent, and one optional MoJ voucher privacy consent", () => {
  assert.match(schema, /"agreement_to_mediate_confidentiality"/);
  assert.match(schema, /"voucher_scheme_client_consent"/);
  assert.match(schema, /"voucher_diversity_questionnaire_opt_in"/);
  assert.match(schema, /"voucher_moj_research_contact_opt_in"/);
  assert.doesNotMatch(schema, /"voucher_claim_moj_privacy_consent"/);
  assert.match(schema, /uniqueIndex\("party_required_forms_case_party_type_unique"\)/);
  assert.match(schema, /signatureSource: text\("signature_source"\)/);
  assert.match(schema, /uploadedDocumentId: varchar\("uploaded_document_id"\)/);
  assert.match(schema, /attestationVersion: text\("attestation_version"\)/);
  assert.match(bootstrap, /ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS signature_source/);
  assert.match(migration, /voucher_scheme_client_consent/);
  assert.match(sessionService, /const VOUCHER_PRIVACY_POLICY_CLIENT_CONSENT_FORM_TYPE = VOUCHER_RESEARCH_OPT_IN_FORM_TYPE/);
  assert.match(sessionService, /const OPTIONAL_VOUCHER_FORM_TYPES: PartyRequiredFormType\[\] = \[\s*VOUCHER_PRIVACY_POLICY_CLIENT_CONSENT_FORM_TYPE,\s*\]/);
  assert.match(sessionService, /Family Mediation Voucher Scheme: Privacy Policy and Client Consent/);
  assert.doesNotMatch(caseDetail, /Diversity and inclusion questionnaire opt-in/);
  assert.doesNotMatch(caseDetail, /MoJ research contact opt-in/);
});

test("signed voucher forms create party-scoped documents that admins review from Proofing", () => {
  assert.match(schema, /partyId: varchar\("party_id"\)\.references\(\(\) => parties\.id/);
  assert.match(schema, /documentCategory: text\("document_category"\)/);
  assert.match(schema, /deliveryStatus: text\("delivery_status"\)\.notNull\(\)\.default\("not_sent"\)/);
  assert.match(sessionService, /createSignedFormSnapshotDocument/);
  assert.match(sessionService, /uploadSignedRequiredForm/);
  assert.match(sessionService, /validateFormUploadAccess/);
  assert.match(sessionService, /canManageRequiredFormDelivery/);
  assert.match(sessionService, /signatureSource: "platform"/);
  assert.match(sessionService, /"upload"/);
  assert.match(sessionService, /"admin_offline"/);
  assert.match(sessionService, /generateRequiredFormTemplateAfterSignature/);
  assert.match(sessionService, /requiredFormCourtFormType/);
  assert.doesNotMatch(sessionService, /if \(form\.formType === "agreement_to_mediate_confidentiality"\) \{/);
  assert.match(sessionService, /Withdrawn optional opt-ins cannot be signed/);
  assert.match(sessionService, /Withdrawn optional opt-ins cannot be uploaded as signed/);
  assert.match(sessionRoutes, /\/api\/party-required-forms\/:id\/upload-signed/);
  assert.match(caseDetail, /dialog-required-form-signature/);
  assert.match(caseDetail, /prefillRequiredFormSignerName/);
  assert.match(caseDetail, /data-testid="input-required-form-signer-name"/);
  assert.match(caseDetail, /data-testid="checkbox-required-form-confirmation"/);
  assert.match(caseDetail, /data-testid="button-upload-signed-required-form"/);
  assert.match(caseDetail, /canManageRequiredFormDelivery\(session\)/);
  assert.match(sessionRoutes, /confirmationTick/);
  assert.match(sessionService, /private isVoucherFormType/);
  assert.match(sessionService, /const reviewStatus = this\.isVoucherFormType\(form\.formType\) \? "ready_for_review" : "reviewed"/);
  assert.match(sessionService, /const reviewStatus = actor\.role === "client" \? "ready_for_review" : this\.isVoucherFormType\(access\.form\.formType\) \? "ready_for_review" : "reviewed"/);
  assert.match(sessionService, /reviewStatus,/);
  assert.match(sessionService, /await this\.createDocumentsReadyForReviewTask\(document, actor as ActorUser\)/);
  assert.match(caseDetail, /Review signed voucher documents from the Proofing tab/);
});

test("documents tab exposes required form actions, client uploads, library filtering, and inline document preview", () => {
  assert.match(sessionRoutes, /\/api\/cases\/:id\/document-blank-forms/);
  assert.match(sessionRoutes, /\/api\/cases\/:id\/document-blank-forms\/:templateId\/download/);
  assert.match(sessionRoutes, /\/api\/cases\/:id\/document-blank-forms\/:templateId\/upload/);
  assert.match(sessionService, /listDocumentBlankForms/);
  assert.match(sessionService, /downloadDocumentBlankForm/);
  assert.match(sessionService, /uploadDocumentBlankForm/);
  assert.match(sessionService, /COURT_FORM_UPLOAD_DOCUMENT_CATEGORIES/);
  assert.match(sessionService, /addCurrentBlankTemplate/);
  assert.match(sessionService, /requiredFormLogicalKeys/);
  assert.match(sessionService, /AGREEMENT_FORM_TYPE/);
  assert.match(sessionService, /caseForBlankForms\.voucherClaimEligible/);
  assert.match(sessionService, /isDocumentBlankFormRelevant/);
  assert.match(sessionService, /contentDisposition: "attachment"/);
  assert.match(sessionService, /actor\.role === "client" \? "ready_for_review"/);
  assert.match(sessionService, /document\.sharedWithClients[\s\S]*document\.reviewStatus === "reviewed"[\s\S]*document\.partyId === access\.partyId/);
  assert.doesNotMatch(sessionService, /document\.reviewStatus === "ready_for_review"[\s\S]{0,220}document\.partyId === access\.partyId/);
  assert.match(caseDetail, /Forms to complete/);
  assert.match(caseDetail, /Document library/);
  assert.match(caseDetail, /Show form evidence/);
  assert.match(caseDetail, /genericDocuments = displayDocuments\.filter/);
  assert.match(caseDetail, /libraryDocuments = genericDocuments\.filter/);
  assert.match(caseDetail, /Download blank form/);
  assert.match(caseDetail, /Upload completed form/);
  assert.match(caseDetail, /form\.canUploadCompletedForm/);
  assert.match(caseDetail, /form\.completedDocumentUrl/);
  assert.match(caseDetail, /form\.status === "signed"[\s\S]*return "Completed"/);
  assert.match(caseDetail, /data-testid="input-document-form-signer-name"/);
  assert.match(caseDetail, /data-testid="input-document-form-signed-date"/);
  assert.match(caseDetail, /data-testid="button-preview-case-document"/);
  assert.match(caseDetail, /data-testid="dialog-case-document-preview"/);
  assert.match(caseDetail, /data-testid="iframe-case-document-preview"/);
});

test("case documents collapse legacy and active optional MoJ privacy consent documents", () => {
  assert.match(caseDetail, /dedupeMoJPrivacyConsentDocuments/);
  assert.match(caseDetail, /displayDocuments = dedupeMoJPrivacyConsentDocuments\(documents\)/);
  assert.match(caseDetail, /MOJ_PRIVACY_CONSENT_DOCUMENT_LABEL/);
  assert.match(caseDetail, /Family Mediation Voucher Scheme: Privacy Policy and Client Consent/);
  assert.match(caseDetail, /Family Mediation Voucher Scheme client consent/);
});

test("voucher forms use Template Library PDFs and only the optional privacy consent can be withdrawn", () => {
  assert.match(schema, /COURT_FORM_TYPES[\s\S]*"VoucherSchemeClientConsent"[\s\S]*"VoucherDiversityQuestionnaireOptIn"[\s\S]*"VoucherMojResearchContactOptIn"/);
  assert.match(sessionService, /VoucherSchemeClientConsent/);
  assert.match(sessionService, /VoucherMojResearchContactOptIn/);
  assert.match(sessionService, /courtFormTemplateId: template\?\.id \|\| null/);
  assert.match(partyRequiredFormRepository, /existing\.status === "signed"[\s\S]*existing\.courtFormTemplateId[\s\S]*data\.courtFormTemplateId \|\| existing\.courtFormTemplateId/);
  assert.match(sessionService, /withdrawOptionalRequiredForm/);
  assert.match(sessionService, /OPTIONAL_VOUCHER_FORM_TYPES\.includes/);
  assert.match(dashboardService, /form\.status === "signed" \|\| form\.withdrawnAt/);
  assert.match(sessionService, /BLOCKING_FORM_TYPES\.includes\(form\.formType as PartyRequiredFormType\) && form\.status !== "signed"/);
  assert.match(sessionRoutes, /\/api\/party-required-forms\/:id\/withdraw/);
  assert.match(caseDetail, /button-withdraw-optional-required-form/);
  assert.doesNotMatch(caseDetail, /page 5/i);
  assert.doesNotMatch(replitDoc, /page 5/i);
});

test("voucher eligibility is explicit, role-gated, and issues only voucher consent records", () => {
  assert.match(schema, /voucherClaimEligible: boolean\("voucher_claim_eligible"\)/);
  assert.match(sessionService, /setVoucherClaimEligibility/);
  assert.match(sessionService, /canSetVoucherClaimEligibility/);
  assert.match(sessionService, /voucherEligibilityAllowedForCase/);
  assert.match(sessionService, /ensureMiamVoucherComplianceForms/);
  assert.match(sessionService, /validateVoucherClaimConsentReviewed/);
  assert.match(sessionService, /Mandatory voucher consent must be reviewed before applying voucher claim eligibility/);
  assert.match(sessionService, /property and finance/i);
  assert.match(sessionRoutes, /\/api\/cases\/:caseId\/voucher-claim-eligibility/);
  assert.match(sessionService, /OPTIONAL_VOUCHER_FORM_TYPES/);
  assert.doesNotMatch(sessionService, /voucher_claim_moj_privacy_consent/);
});

test("approved MIAM voucher decision issues case-level voucher compliance forms before session scheduling", () => {
  assert.match(miamRecordRoutes, /ensureMiamVoucherComplianceForms/);
  assert.match(miamRecordRoutes, /approvalStatus: "approved"/);
  assert.match(miamRecordRoutes, /shouldEnsureMiamVoucherComplianceForms/);
  assert.match(miamRecordRoutes, /mojVoucherAppliedChangedToYes/);
  assert.match(sessionService, /mojVoucherAppliedStartsYes/);
  assert.doesNotMatch(sessionService, /mojVoucherScheme/);
  assert.match(sessionService, /if \(!this\.voucherEligibilityAllowedForCase\(c\)\)/);
  assert.doesNotMatch(sessionService, /!c\.mojVoucherEligible\s*\|\|\s*!this\.voucherEligibilityAllowedForCase\(c\)/);
  assert.match(sessionService, /mediationSessionId: null/);
  assert.match(sessionService, /appointmentId: null/);
  assert.match(sessionService, /Family Mediation Voucher Scheme client consent/);
  assert.match(sessionService, /Family Mediation Voucher Scheme: Privacy Policy and Client Consent/);
  assert.match(sessionService, /\/cases\/\$\{caseId\}\?tab=documents/);
  assert.match(sessionService, /Mandatory voucher consent must be reviewed before applying voucher claim eligibility/);
  assert.doesNotMatch(financeService, /mojVoucherEligible\s*\?/);
  assert.doesNotMatch(financeService, /mojVoucherApplied/);
});

test("MIAM record UI exposes MOJ Voucher Applied as an editable outcome field", () => {
  assert.match(miamRecordTab, /MOJ Voucher Applied/);
  assert.match(miamRecordTab, /updateField\("mojVoucherApplied", v\)/);
  assert.match(miamRecordTab, /id="moj-voucher-applied"/);
});

test("voucher claim status is admin-only with Opia reference, ageing, and CSV preview hooks", () => {
  assert.match(schema, /mediationSessionVoucherClaims = pgTable\("mediation_session_voucher_claims"/);
  assert.match(schema, /VOUCHER_CLAIM_STATUSES[\s\S]*voucher_claim_submitted[\s\S]*claim_accepted[\s\S]*claim_paid/);
  assert.match(schema, /opiaClaimReference: text\("opia_claim_reference"\)/);
  assert.match(sessionService, /updateVoucherClaimStatus/);
  assert.match(sessionService, /getVoucherClaimReadiness/);
  assert.match(sessionService, /previewVoucherRemittanceCsv/);
  assert.match(sessionService, /createVoucherClaimAgeingTasks/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/voucher-claim/);
  assert.match(sessionRoutes, /\/api\/voucher-claims\/remittance-preview/);
  assert.match(caseDetail, /Voucher claim submitted/);
  assert.match(caseDetail, /Claim paid/);
  assert.match(caseDetail, /signedCountLabel/);
  assert.match(caseDetail, /outstandingClientNames/);
});

test("voucher invoices can be discounted to zero without creating Stripe checkout", () => {
  assert.match(schema, /voucherDiscountPence: integer\("voucher_discount_pence"\)/);
  assert.match(financeService, /voucherDiscountPence/);
  assert.match(financeService, /payment_not_required/);
  assert.match(financeService, /Zero-value voucher invoice/);
  assert.match(stripePaymentService, /invoice\.outstandingPence <= 0/);
  assert.match(stripePaymentService, /paymentRequired: false/);
  assert.match(caseDetail, /voucherDiscountPence: number/);
  assert.match(caseDetail, /Voucher discount/);
  assert.match(caseDetail, /Total payable/);
});

test("case search includes MoJ Opia references as well as client identity fields", () => {
  assert.match(caseRepository, /opia_claim_reference/);
  assert.match(caseRepository, /date_of_birth/);
  assert.match(caseRepository, /cl\.email ILIKE/);
});

test("replit documentation describes the production voucher and e-signature workflow", () => {
  assert.match(replitDoc, /voucherClaimEligible/);
  assert.match(replitDoc, /voucher_scheme_client_consent/);
  assert.match(replitDoc, /voucher_moj_research_contact_opt_in/);
  assert.match(replitDoc, /Family Mediation Voucher Scheme: Privacy Policy and Client Consent/);
  assert.match(replitDoc, /Documents tab/);
  assert.match(replitDoc, /payment_not_required/);
  assert.match(replitDoc, /Opia\/MoJ claim reference/);
  assert.doesNotMatch(replitDoc, /combined voucher-claim \+ MoJ privacy-consent form/);
  assert.doesNotMatch(replitDoc, /combined voucher claim and MoJ privacy consent/i);
});
