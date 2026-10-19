import crypto from "crypto";
import { storage } from "../storage";
import { caseService } from "./case.service";
import { caseActivityService, staffActor } from "./case-activity.service";
import { logAudit } from "./audit-log.service";
import { fileStorageService } from "./file-storage.service";
import { applyPdfFieldOverrides, fillCourtFormPdfBytes, normalizePdfFieldOverrides, PDF_FIELD_OVERRIDES_KEY } from "./court-form-pdf-fill.service";
import { courtFormMappingService, normalizeCourtFormMapping } from "./court-form-mapping.service";
import { courtFormTemplateService } from "./court-form-template.service";
import { sendCourtFormPdfEmail } from "./court-form-email.service";
import { caseProofingService } from "./case-proofing.service";
import { COURT_FORM_TYPES, type CourtFormDraft, type CourtFormGeneration, type CourtFormTemplate, type CourtFormType, type Party, type User } from "@shared/schema";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";

type ActorUser = Pick<User, "id" | "name" | "role">;

const FORM_LABELS: Record<CourtFormType, string> = {
  FM1: "FM1",
  C100: "C100",
  FormA: "Form A",
  FormE: "Form E",
  AgreementToMediate: "Agreement to Mediate",
  VoucherSchemeClientConsent: "Family Mediation Voucher Scheme client consent",
  VoucherDiversityQuestionnaireOptIn: "Family Mediation Voucher Scheme: Privacy Policy and Client Consent",
  VoucherMojResearchContactOptIn: "Family Mediation Voucher Scheme: Privacy Policy and Client Consent",
  DraftFinancialSchedule: "DRAFT FINANCIAL SCHEDULE",
  FinancialDisclosureBooklet: "Financial Disclosure Booklet",
};

const CASE_COURT_FORM_TYPES = COURT_FORM_TYPES.filter((formType) => formType !== "DraftFinancialSchedule" && formType !== "FinancialDisclosureBooklet");

function isAdmin(actor: Pick<User, "role">): boolean {
  return actor.role === "superadmin" || actor.role === "subadmin";
}

function accessDenied(): Error & { status: number } {
  return Object.assign(new Error("Access denied"), { status: 403 });
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function templateFieldNames(template: Pick<CourtFormTemplate, "fieldNames" | "fieldMetadata">): Set<string> {
  const metadataNames = Array.isArray(template.fieldMetadata)
    ? template.fieldMetadata
      .map((field) => field && typeof field === "object" ? (field as { name?: unknown }).name : null)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
    : [];
  return new Set(metadataNames.length ? metadataNames : Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : []);
}

function isArchivedTemplate(template: CourtFormTemplate): boolean {
  return Boolean(template.deletedAt);
}

function validatePdfFieldOverrides(answers: Record<string, unknown>, template: Pick<CourtFormTemplate, "fieldNames" | "fieldMetadata">): Record<string, string> {
  const overrides = normalizePdfFieldOverrides(answers);
  const allowedFields = templateFieldNames(template);
  for (const fieldName of Object.keys(overrides)) {
    if (!allowedFields.has(fieldName)) throw new Error(`Unknown PDF draft override field: ${fieldName}`);
  }
  return overrides;
}

async function assertCaseEditAccess(caseId: string, partyId: string, actor: ActorUser): Promise<void> {
  const party = await storage.getParty(partyId);
  if (!party || party.caseId !== caseId) throw new Error("Party does not belong to this case");
  const caseRecord = await storage.getCase(caseId);
  if (!caseRecord || (!isAdmin(actor) && !(actor.role === "mediator" && caseRecord.mediatorId === actor.id))) throw accessDenied();
}

type CourtFormReadiness = {
  formType: CourtFormType;
  partyId: string;
  templateId: string | null;
  templateVersionLabel: string | null;
  hasUploadedTemplate: boolean;
  hasCurrentTemplate: boolean;
  requiresGovUkVerification: boolean;
  mappingCount: number;
  requiredMappedFields: number;
  resolvedRequiredFields: number;
  missingRequiredFields: Array<{ pdfField: string; source: string; draftKey?: string | null }>;
  resolvedFields: Array<{ pdfField: string; source: string; value: string; required: boolean }>;
  canGenerate: boolean;
  blockingReasons: string[];
};

class CourtFormGenerationService {
  async getCaseCourtForms(caseId: string, actor: ActorUser) {
    const c = await storage.getCase(caseId);
    if (!c) throw new Error("Case not found");
    if (!hasFullOperationalCaseAccess(await classifyCaseAccess(caseId, actor))) throw accessDenied();
    const [templates, generations, parties] = await Promise.all([
      storage.listCourtFormTemplates(),
      storage.listCourtFormGenerationsByCase(caseId),
      storage.listPartiesByCase(caseId),
    ]);
    const repairedTemplates = await Promise.all(templates.map((template) => courtFormTemplateService.ensureTemplateFieldMetadata(template)));
    const draftEntries = await Promise.all(
      parties.flatMap((party) => CASE_COURT_FORM_TYPES.map(async (formType) => await storage.getCourtFormDraft(caseId, party.id, formType))),
    );
    const drafts = draftEntries.filter((draft): draft is CourtFormDraft => Boolean(draft));
    const readiness = await this.buildReadiness(caseId, parties, repairedTemplates, drafts);
    return { templates: repairedTemplates, generations, parties, drafts, readiness };
  }

  private async buildReadiness(
    caseId: string,
    parties: Party[],
    templates: CourtFormTemplate[],
    drafts: CourtFormDraft[],
  ): Promise<CourtFormReadiness[]> {
    const miamValidity = await caseService.getMiamValidityForCourtAction(caseId);
    return Promise.all(parties.flatMap((party) => CASE_COURT_FORM_TYPES.map(async (formType) => {
      const formTemplates = templates.filter((template) => template.formType === formType);
      const currentTemplate = formTemplates.find((template) => template.isCurrent);
      const draft = drafts.find((item) => item.partyId === party.id && item.formType === formType);
      const mapping = normalizeCourtFormMapping(currentTemplate?.fieldMapping);
      const context = await courtFormMappingService.buildContext(caseId, party.id, asRecord(draft?.answers));
      const resolved = courtFormMappingService.resolveAllWithDetails(mapping, context);
      const missingRequiredFields = resolved
        .filter((field) => field.missing)
        .map((field) => ({ pdfField: field.pdfField, source: field.source, draftKey: field.draftKey }));
      const requiredMappedFields = mapping.filter((entry) => entry.required).length;
      const blockingReasons: string[] = [];
      const requiresGovUkVerification = formType === "FormE" && Boolean(formTemplates.length) && !currentTemplate;
      if (!formTemplates.length) blockingReasons.push("No template uploaded");
      else if (!currentTemplate) blockingReasons.push(requiresGovUkVerification ? "Form E verification required" : "Template uploaded, not current");
      if (currentTemplate && mapping.length === 0) blockingReasons.push("Mapping incomplete");
      if (missingRequiredFields.length > 0) blockingReasons.push("Missing case data");
      if (!miamValidity.valid) blockingReasons.push("MIAM has expired for court applications");
      return {
        formType,
        partyId: party.id,
        templateId: currentTemplate?.id || null,
        templateVersionLabel: currentTemplate?.versionLabel || null,
        hasUploadedTemplate: formTemplates.length > 0,
        hasCurrentTemplate: Boolean(currentTemplate),
        requiresGovUkVerification,
        mappingCount: mapping.length,
        requiredMappedFields,
        resolvedRequiredFields: requiredMappedFields - missingRequiredFields.length,
        missingRequiredFields,
        resolvedFields: resolved.map((field) => ({
          pdfField: field.pdfField,
          source: field.source,
          value: field.value,
          required: Boolean(field.required),
        })),
        canGenerate: blockingReasons.length === 0,
        blockingReasons,
      };
    })));
  }

  private async getReadinessFor(caseId: string, partyId: string, formType: CourtFormType, template: CourtFormTemplate): Promise<CourtFormReadiness> {
    const draft = await storage.getCourtFormDraft(caseId, partyId, formType);
    const readinessRows = await this.buildReadiness(caseId, [await this.requireParty(caseId, partyId)], [template], draft ? [draft] : []);
    const readiness = readinessRows.find((row) => row.formType === formType);
    if (!readiness) throw new Error("Court form readiness could not be calculated");
    return readiness;
  }

  async previewFilledPdf(caseId: string, actor: ActorUser, input: {
    partyId: string;
    formType: CourtFormType;
    templateId?: string | null;
    answers?: Record<string, unknown>;
  }): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
    await assertCaseEditAccess(caseId, input.partyId, actor);
    const template = input.templateId
      ? await storage.getCourtFormTemplate(input.templateId)
      : await courtFormTemplateService.getCurrentCourtFormTemplate(input.formType);
    if (!template) throw new Error(`No ${FORM_LABELS[input.formType]} template is configured`);
    if (isArchivedTemplate(template)) throw new Error("Selected court form template is archived");
    if (template.formType !== input.formType) throw new Error("Selected template does not match the requested court form");
    const draft = await storage.getCourtFormDraft(caseId, input.partyId, input.formType);
    const answers = input.answers ? asRecord(input.answers) : asRecord(draft?.answers);
    validatePdfFieldOverrides(answers, template);
    const context = await courtFormMappingService.buildContext(caseId, input.partyId, answers);
    const mapping = normalizeCourtFormMapping(template.fieldMapping);
    const resolved = courtFormMappingService.resolveAllWithDetails(mapping, context);
    const values = Object.fromEntries(resolved.map((field) => [field.pdfField, field.value]));
    const previewValues = applyPdfFieldOverrides(values, answers, template);
    const pdfBytes = await this.generatePdfBytes(template, previewValues);
    const fileName = `${safeFileName(context.caseRecord.caseRef)}-${safeFileName(FORM_LABELS[input.formType])}-preview.pdf`;
    return { pdfBytes, fileName };
  }

  private async requireParty(caseId: string, partyId: string): Promise<Party> {
    const party = await storage.getParty(partyId);
    if (!party || party.caseId !== caseId) throw new Error("Party does not belong to this case");
    return party;
  }

  async getDraft(caseId: string, partyId: string, formType: CourtFormType, actor: ActorUser): Promise<CourtFormDraft | null> {
    await assertCaseEditAccess(caseId, partyId, actor);
    return await storage.getCourtFormDraft(caseId, partyId, formType) ?? null;
  }

  async saveDraft(caseId: string, partyId: string, formType: CourtFormType, actor: ActorUser, input: {
    templateId?: string | null;
    answers?: Record<string, unknown>;
    status?: "draft" | "ready_to_generate" | "generated";
  }): Promise<CourtFormDraft> {
    await assertCaseEditAccess(caseId, partyId, actor);
    const answers = input.answers || {};
    const template = input.templateId
      ? await storage.getCourtFormTemplate(input.templateId)
      : await courtFormTemplateService.getCurrentCourtFormTemplate(formType);
    const overrides = normalizePdfFieldOverrides(answers);
    if (!template && Object.keys(overrides).length > 0) throw new Error("Select a template before saving PDF field overrides");
    if (template) {
      if (isArchivedTemplate(template)) throw new Error("Selected court form template is archived");
      if (template.formType !== formType) throw new Error("Selected template does not match the requested court form");
      validatePdfFieldOverrides(answers, template);
    }
    const saved = await storage.upsertCourtFormDraft({
      caseId,
      partyId,
      formType,
      templateId: input.templateId || null,
      answers,
      status: input.status || "draft",
      updatedBy: actor.id,
    });
    const changedFieldCount = Object.keys(normalizePdfFieldOverrides(answers)).length;
    if (changedFieldCount > 0) {
      const c = await storage.getCase(caseId);
      await caseActivityService.log({
        caseId,
        type: "court_form_draft_saved",
        title: "PDF field draft saved",
        description: `${actor.name} saved PDF draft overrides for ${FORM_LABELS[formType]}.`,
        relatedEntityId: saved.id,
        relatedEntityType: "court_form_draft",
        metadata: JSON.stringify({ formType, templateId: saved.templateId, partyId, changedFieldCount }),
        actor: staffActor(actor),
      });
      await logAudit({
        userId: actor.id,
        action: "court_form_draft_saved",
        entity: "court_form_draft",
        entityId: saved.id,
        entityRef: c?.caseRef || caseId,
        details: JSON.stringify({ caseId, partyId, formType, templateId: saved.templateId, changedFieldCount, overrideNamespace: PDF_FIELD_OVERRIDES_KEY }),
      });
    }
    return saved;
  }

  async generate(caseId: string, actor: ActorUser, input: {
    partyId: string;
    formType: CourtFormType;
    draftId?: string | null;
    recipientEmail?: string | null;
    sendEmail?: boolean;
  }, ipAddress?: string): Promise<CourtFormGeneration> {
    await assertCaseEditAccess(caseId, input.partyId, actor);
    const validity = await caseService.getMiamValidityForCourtAction(caseId);
    if (!validity.valid) throw new Error("MIAM has expired for court applications");
    const template = await courtFormTemplateService.getCurrentCourtFormTemplate(input.formType);
    if (!template) throw new Error(`No current ${FORM_LABELS[input.formType]} template is configured`);
    const readiness = await this.getReadinessFor(caseId, input.partyId, input.formType, template);
    if (!readiness.canGenerate) throw new Error(`Court form is not ready to generate: ${readiness.blockingReasons.join(", ")}`);
    return this.generateWithTemplate(caseId, input.partyId, input.formType, template, actor, {
      draftId: input.draftId || null,
      recipientEmail: input.recipientEmail || null,
      sendEmail: false,
      ipAddress,
    });
  }

  async generateAgreementToMediateAfterSignature(formId: string, actor: ActorUser, ipAddress?: string): Promise<CourtFormGeneration | null> {
    return this.generateRequiredFormTemplateAfterSignature(formId, actor, ipAddress);
  }

  async generateRequiredFormTemplateAfterSignature(formId: string, actor: ActorUser, ipAddress?: string): Promise<CourtFormGeneration | null> {
    const form = await storage.getPartyRequiredForm(formId);
    const formType = this.requiredFormCourtFormType(form?.formType || "");
    if (!form || !formType) return null;
    if (form.courtFormGenerationId) return await storage.getCourtFormGeneration(form.courtFormGenerationId) ?? null;
    const template = form.courtFormTemplateId
      ? await storage.getCourtFormTemplate(form.courtFormTemplateId)
      : await courtFormTemplateService.getCurrentCourtFormTemplate(formType);
    if (!template) return null;
    if (isArchivedTemplate(template)) return null;
    const generation = await this.generateWithTemplate(form.caseId, form.partyId, formType, template, actor, {
      draftId: null,
      recipientEmail: null,
      sendEmail: false,
      ipAddress,
    });
    await storage.updatePartyRequiredForm(form.id, {
      courtFormTemplateId: template.id,
      courtFormGenerationId: generation.id,
      generatedDocumentId: generation.caseDocumentId,
    });
    return generation;
  }

  private requiredFormCourtFormType(formType: string): CourtFormType | null {
    if (formType === "agreement_to_mediate_confidentiality") return "AgreementToMediate";
    if (formType === "voucher_scheme_client_consent") return "VoucherSchemeClientConsent";
    if (formType === "voucher_diversity_questionnaire_opt_in") return "VoucherDiversityQuestionnaireOptIn";
    if (formType === "voucher_moj_research_contact_opt_in") return "VoucherMojResearchContactOptIn";
    return null;
  }

  async resend(generationId: string, actor: ActorUser, ipAddress?: string): Promise<CourtFormGeneration> {
    const generation = await storage.getCourtFormGeneration(generationId);
    if (!generation) throw new Error("Court form generation not found");
    await assertCaseEditAccess(generation.caseId, generation.partyId, actor);
    if (!generation.caseDocumentId) throw new Error("Generated court form document is missing");
    const [template, document, c, party] = await Promise.all([
      storage.getCourtFormTemplate(generation.templateId),
      storage.getCaseDocument(generation.caseDocumentId),
      storage.getCase(generation.caseId),
      storage.getParty(generation.partyId),
    ]);
    if (!template || !document || !c || !party) throw new Error("Generated court form record is incomplete");
    const client = await storage.getClient(party.clientId);
    const recipientEmail = generation.recipientEmail || client?.email;
    if (!recipientEmail) throw new Error("Recipient email is missing");
    const pdfBuffer = document.storageKey ? await fileStorageService.getStoredFileBuffer(document.storageKey, "case-documents") : Buffer.alloc(0);
    const result = await sendCourtFormPdfEmail({
      to: recipientEmail,
      clientName: client ? `${client.firstName} ${client.lastName}`.trim() : "Client",
      caseRef: c.caseRef,
      formName: FORM_LABELS[template.formType as CourtFormType],
      fileName: document.fileName,
      pdfBuffer,
    });
    const sent = result.sent;
    const resendHistory = Array.isArray(generation.resendHistory) ? generation.resendHistory : [];
    const updated = await storage.updateCourtFormGeneration(generation.id, {
      recipientEmail,
      deliveryStatus: sent ? "sent" : "failed",
      deliveryLastAttemptedAt: new Date(),
      deliveryLastError: sent ? null : result.error || "Email send failed",
      resendHistory: [...resendHistory, { at: new Date().toISOString(), by: actor.id, sent, error: result.error || null }],
      status: sent ? "sent" : generation.status,
    });
    if (!updated) throw new Error("Failed to update court form resend status");
    await logAudit({
      userId: actor.id,
      action: "resend_court_form",
      entity: "court_form_generation",
      entityId: generation.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ caseId: generation.caseId, partyId: generation.partyId, sent }),
      ipAddress,
    });
    return updated;
  }

  private async generateWithTemplate(caseId: string, partyId: string, formType: CourtFormType, template: CourtFormTemplate, actor: ActorUser, options: {
    draftId: string | null;
    recipientEmail: string | null;
    sendEmail: boolean;
    ipAddress?: string;
  }): Promise<CourtFormGeneration> {
    const draft = options.draftId
      ? await storage.getCourtFormDraft(caseId, partyId, formType)
      : await storage.getCourtFormDraft(caseId, partyId, formType);
    const answers = asRecord(draft?.answers);
    const context = await courtFormMappingService.buildContext(caseId, partyId, answers);
    const mapping = normalizeCourtFormMapping(template.fieldMapping);
    const values = courtFormMappingService.resolveAll(mapping, context);
    const generationValues = applyPdfFieldOverrides(values, answers, template);
    const pdfBytes = await this.generatePdfBytes(template, generationValues);
    const c = context.caseRecord;
    const clientName = `${context.client.firstName} ${context.client.lastName}`.trim() || `Client ${context.party.role}`;
    const fileName = `${safeFileName(c.caseRef)}-${safeFileName(FORM_LABELS[formType])}-${Date.now()}.pdf`;
    const stored = await fileStorageService.saveCaseDocumentFile({ fileName: `${crypto.randomUUID()}-${fileName}`, buffer: Buffer.from(pdfBytes), mimeType: "application/pdf" });
    const document = await storage.createCaseDocument({
      caseId,
      mediationSessionId: null,
      financialDisclosureFolderId: null,
      financialDisclosureItemId: null,
      financialDisclosureEvidenceCategoryId: null,
      financialDisclosureUploadTarget: null,
      title: `${FORM_LABELS[formType]} - ${clientName}`,
      fileName,
      fileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType: "application/pdf",
      uploadedBy: actor.id,
      reviewStatus: "ready_for_review",
      readyForReviewAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
      sharedWithClients: false,
    });
    const recipientEmail = options.recipientEmail || context.client.email;
    const generation = await storage.createCourtFormGeneration({
      caseId,
      partyId,
      templateId: template.id,
      templateVersionLabel: template.versionLabel,
      draftId: draft?.id || null,
      caseDocumentId: document.id,
      generatedBy: actor.id,
      generatedAt: new Date(),
      status: "saved",
      recipientEmail: recipientEmail || null,
      deliveryStatus: "not_attempted",
      deliveryLastAttemptedAt: null,
      deliveryLastError: null,
      resendHistory: [],
    });
    await caseProofingService.ensureProofingItemForSource({
      caseId,
      sessionId: null,
      itemType: "court_form",
      sourceEntityType: "court_form_generation",
      sourceEntityId: generation.id,
      status: "awaiting_review",
      submittedBy: actor.id,
      submittedAt: generation.generatedAt || new Date(),
    });
    if (draft) {
      await storage.upsertCourtFormDraft({
        caseId: draft.caseId,
        partyId: draft.partyId,
        formType,
        templateId: draft.templateId,
        answers: asRecord(draft.answers),
        status: "generated",
        updatedBy: actor.id,
      });
    }
    await caseActivityService.log({
      caseId,
      type: "court_form_generated",
      title: "Court form generated",
      description: `${actor.name} generated ${FORM_LABELS[formType]} for ${clientName}.`,
      relatedEntityId: generation.id,
      relatedEntityType: "court_form_generation",
      metadata: JSON.stringify({ formType, templateId: template.id, templateVersionLabel: template.versionLabel, documentId: document.id }),
      actor: staffActor(actor),
    });
    await logAudit({
      userId: actor.id,
      action: "generate_court_form",
      entity: "court_form_generation",
      entityId: generation.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ caseId, partyId, formType, templateId: template.id, deliveryStatus: generation.deliveryStatus }),
      ipAddress: options.ipAddress,
    });
    return generation;
  }

  private async generatePdfBytes(template: CourtFormTemplate, values: Record<string, string>): Promise<Uint8Array> {
    return fillCourtFormPdfBytes(await courtFormTemplateService.getTemplateBuffer(template), values);
  }
}

export const courtFormGenerationService = new CourtFormGenerationService();
