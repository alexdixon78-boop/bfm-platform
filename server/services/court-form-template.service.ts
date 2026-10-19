import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { storage } from "../storage";
import { fileStorageService } from "./file-storage.service";
import { courtFormMappingService, normalizeCourtFormMapping } from "./court-form-mapping.service";
import { extractCourtFormFieldMetadata, type CourtFormFieldMetadata } from "./court-form-field-metadata.service";
import { COURT_FORM_TYPES, type CourtFormTemplate, type CourtFormType, type User } from "@shared/schema";

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseDataUrl(data: string, fallbackMimeType?: string | null): { buffer: Buffer; mimeType: string } {
  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  return { mimeType: fallbackMimeType || "application/pdf", buffer: Buffer.from(data, "base64") };
}

async function extractAndStoreTemplatePdf(input: {
  sourceFileName: string;
  fileData: string;
  mimeType?: string | null;
}): Promise<{ sourceFileUrl: string; storageKey: string; fieldNames: string[]; fieldMetadata: CourtFormFieldMetadata[] }> {
  const parsed = parseDataUrl(input.fileData, input.mimeType);
  const mimeType = input.mimeType || parsed.mimeType;
  if (mimeType !== "application/pdf" && !input.sourceFileName.toLowerCase().endsWith(".pdf")) {
    throw new Error("Court form templates must be PDF files");
  }
  const pdf = await PDFDocument.load(parsed.buffer);
  const fieldNames = pdf.getForm().getFields().map((field) => field.getName());
  const fieldMetadata = await extractCourtFormFieldMetadata(parsed.buffer);
  const safeName = `${crypto.randomUUID()}-${sanitizeFileName(input.sourceFileName || "court-form-template.pdf")}`;
  const stored = await fileStorageService.saveCourtFormTemplateFile({ fileName: safeName, buffer: parsed.buffer, mimeType: "application/pdf" });
  return { sourceFileUrl: stored.fileUrl, storageKey: stored.storageKey, fieldNames, fieldMetadata };
}

export function isCourtFormType(value: string): value is CourtFormType {
  return (COURT_FORM_TYPES as readonly string[]).includes(value);
}

function hasCompleteFieldMetadata(template: CourtFormTemplate): boolean {
  const fieldNames = Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : [];
  if (fieldNames.length === 0) return true;
  const metadataNames = new Set(
    (Array.isArray(template.fieldMetadata) ? template.fieldMetadata : [])
      .map((field) => field && typeof field === "object" ? (field as { name?: unknown }).name : null)
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  );
  return fieldNames.every((fieldName) => metadataNames.has(fieldName));
}

function ensureTemplateIsActive(template: CourtFormTemplate, message: string): void {
  if (template.deletedAt) throw new Error(message);
}

class CourtFormTemplateService {
  async listTemplates(): Promise<CourtFormTemplate[]> {
    const templates = await storage.listCourtFormTemplates();
    return Promise.all(templates.map((template) => this.ensureTemplateFieldMetadata(template)));
  }

  getCurrentCourtFormTemplate(formType: CourtFormType): Promise<CourtFormTemplate | undefined> {
    return storage.getCurrentCourtFormTemplate(formType);
  }

  async createTemplate(actor: Pick<User, "id">, input: {
    formType: CourtFormType;
    versionLabel: string;
    sourceFileName: string;
    fileData: string;
    mimeType?: string | null;
    notes?: string | null;
  }): Promise<CourtFormTemplate> {
    if (!isCourtFormType(input.formType)) throw new Error("Invalid court form type");
    const stored = await extractAndStoreTemplatePdf(input);
    return storage.createCourtFormTemplate({
      formType: input.formType,
      versionLabel: input.versionLabel.trim(),
      sourceFileName: input.sourceFileName,
      sourceFileUrl: stored.sourceFileUrl,
      storageKey: stored.storageKey,
      mimeType: "application/pdf",
      isCurrent: false,
      uploadedBy: actor.id,
      uploadedAt: new Date(),
      notes: input.notes || null,
      verifiedCurrentAt: null,
      verifiedBy: null,
      fieldNames: stored.fieldNames,
      fieldMetadata: stored.fieldMetadata,
      fieldMapping: [],
    });
  }

  async reuploadTemplate(id: string, input: {
    sourceFileName: string;
    fileData: string;
    mimeType?: string | null;
    notes?: string | null;
  }): Promise<{ template: CourtFormTemplate; removedMappings: ReturnType<typeof normalizeCourtFormMapping> }> {
    const existing = await storage.getCourtFormTemplate(id);
    if (!existing) throw new Error("Court form template not found");
    ensureTemplateIsActive(existing, "Cannot replace an archived court form template");
    const stored = await extractAndStoreTemplatePdf(input);
    const fieldNames = stored.fieldNames;
    const fieldSet = new Set(fieldNames);
    const existingMapping = normalizeCourtFormMapping(existing.fieldMapping);
    const fieldMapping = existingMapping.filter((entry) => fieldSet.has(entry.pdfField));
    const removedMappings = existingMapping.filter((entry) => !fieldSet.has(entry.pdfField));
    const updated = await storage.updateCourtFormTemplate(id, {
      sourceFileName: input.sourceFileName,
      sourceFileUrl: stored.sourceFileUrl,
      storageKey: stored.storageKey,
      mimeType: "application/pdf",
      fieldNames,
      fieldMetadata: stored.fieldMetadata,
      fieldMapping,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    if (!updated) throw new Error("Court form template not found");
    return { template: updated, removedMappings };
  }

  async updateTemplate(id: string, input: { versionLabel?: string; notes?: string | null }): Promise<CourtFormTemplate> {
    const template = await storage.getCourtFormTemplate(id);
    if (!template) throw new Error("Court form template not found");
    ensureTemplateIsActive(template, "Cannot update an archived court form template");
    const updated = await storage.updateCourtFormTemplate(id, {
      ...(input.versionLabel !== undefined ? { versionLabel: input.versionLabel.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    if (!updated) throw new Error("Court form template not found");
    return updated;
  }

  async updateMapping(id: string, mapping: unknown): Promise<CourtFormTemplate> {
    const template = await storage.getCourtFormTemplate(id);
    if (!template) throw new Error("Court form template not found");
    ensureTemplateIsActive(template, "Cannot map an archived court form template");
    const fieldMapping = courtFormMappingService.validateFieldMapping(template, mapping);
    const updated = await storage.updateCourtFormTemplate(id, { fieldMapping });
    if (!updated) throw new Error("Court form template not found");
    return updated;
  }

  async markCurrent(id: string, actor: Pick<User, "id">, input: { verifiedCurrentAt?: string | null }): Promise<CourtFormTemplate> {
    const template = await storage.getCourtFormTemplate(id);
    if (!template) throw new Error("Court form template not found");
    ensureTemplateIsActive(template, "Cannot mark an archived court form template current");
    const verifiedAt = input.verifiedCurrentAt ? new Date(input.verifiedCurrentAt) : null;
    if (template.formType === "FormE" && (!verifiedAt || isNaN(verifiedAt.valueOf()))) {
      throw new Error("Form E template must be verified against gov.uk before it can be marked current");
    }
    const updated = await storage.markCourtFormTemplateCurrent(template.id, template.formType as CourtFormType, actor.id, verifiedAt);
    if (!updated) throw new Error("Court form template not found");
    return updated;
  }

  async deleteTemplate(id: string, actor: Pick<User, "id">): Promise<CourtFormTemplate> {
    const template = await storage.getCourtFormTemplate(id);
    if (!template || template.deletedAt) throw new Error("Court form template not found");
    const deleted = await storage.deleteCourtFormTemplate(id, actor.id);
    if (!deleted) throw new Error("Court form template not found");
    return deleted;
  }

  async getTemplateBuffer(template: CourtFormTemplate): Promise<Buffer> {
    if (!template.storageKey) throw new Error("Court form template file is missing");
    return fileStorageService.getStoredFileBuffer(template.storageKey, "court-form-templates");
  }

  async ensureTemplateFieldMetadata(template: CourtFormTemplate): Promise<CourtFormTemplate> {
    if (hasCompleteFieldMetadata(template)) return template;
    const buffer = await this.getTemplateBuffer(template);
    const pdf = await PDFDocument.load(buffer);
    const fieldNames = pdf.getForm().getFields().map((field) => field.getName());
    const fieldMetadata = await extractCourtFormFieldMetadata(buffer);
    return await storage.updateCourtFormTemplate(template.id, { fieldNames, fieldMetadata }) || template;
  }
}

export const courtFormTemplateService = new CourtFormTemplateService();
