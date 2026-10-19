import { PDFDocument } from "pdf-lib";
import { storage } from "../storage";
import { extractCourtFormFieldMetadata } from "./court-form-field-metadata.service";
import { courtFormTemplateService } from "./court-form-template.service";

type FieldOrderRepairResult = {
  checked: number;
  updated: number;
  unchanged: number;
  failed: Array<{ templateId: string; formType: string; versionLabel: string; error: string }>;
};

function sameOrder(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function hasFieldMetadata(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export async function repairCourtFormTemplateFieldOrder(): Promise<FieldOrderRepairResult> {
  const templates = await storage.listCourtFormTemplates();
  const result: FieldOrderRepairResult = {
    checked: templates.length,
    updated: 0,
    unchanged: 0,
    failed: [],
  };

  for (const template of templates) {
    try {
      const buffer = await courtFormTemplateService.getTemplateBuffer(template);
      const pdf = await PDFDocument.load(buffer);
      const extractedFieldNames = pdf.getForm().getFields().map((field) => field.getName());
      const extractedFieldMetadata = await extractCourtFormFieldMetadata(buffer);
      if (sameOrder(template.fieldNames, extractedFieldNames) && hasFieldMetadata(template.fieldMetadata)) {
        result.unchanged += 1;
        continue;
      }
      await storage.updateCourtFormTemplate(template.id, { fieldNames: extractedFieldNames, fieldMetadata: extractedFieldMetadata });
      result.updated += 1;
    } catch (err) {
      result.failed.push({
        templateId: template.id,
        formType: template.formType,
        versionLabel: template.versionLabel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
