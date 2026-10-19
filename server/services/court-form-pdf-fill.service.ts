import {
  PDFCheckBox,
  PDFDropdown,
  PDFDocument,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import { PDF_FIELD_OVERRIDES_KEY } from "@shared/court-form-pdf-overrides";

export { PDF_FIELD_OVERRIDES_KEY };

function stringifyOverride(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return value == null ? "" : String(value);
}

function getAllowedFieldNames(template: { fieldMetadata?: unknown; fieldNames?: unknown }): Set<string> {
  const metadata = Array.isArray(template.fieldMetadata) ? template.fieldMetadata : [];
  const names = metadata
    .map((field) => field && typeof field === "object" ? (field as { name?: unknown }).name : null)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (names.length) return new Set(names);
  return new Set(Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : []);
}

export function normalizePdfFieldOverrides(answers: Record<string, unknown>): Record<string, string> {
  const raw = answers[PDF_FIELD_OVERRIDES_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([fieldName]) => fieldName.trim())
      .map(([fieldName, value]) => [fieldName, stringifyOverride(value)]),
  );
}

export function applyPdfFieldOverrides(
  values: Record<string, string>,
  answers: Record<string, unknown>,
  template: { fieldMetadata?: unknown; fieldNames?: unknown },
): Record<string, string> {
  const allowedFieldNames = getAllowedFieldNames(template);
  const overrides = normalizePdfFieldOverrides(answers);
  return Object.entries(overrides).reduce<Record<string, string>>((next, [fieldName, value]) => {
    if (allowedFieldNames.has(fieldName)) next[fieldName] = value;
    return next;
  }, { ...values });
}

function isCheckedValue(value: string): boolean {
  return /^(true|yes|checked|1|on|y)$/i.test(value.trim());
}

function isUncheckedValue(value: string): boolean {
  return value.trim() === "" || /^(false|no|unchecked|0|off|n)$/i.test(value.trim());
}

function selectIfValid(field: PDFDropdown | PDFOptionList | PDFRadioGroup, value: string): void {
  if (!value.trim()) return;
  try {
    field.select(value);
  } catch {
    // Leave fields blank when CRM values do not match a PDF option exactly.
  }
}

function setPdfField(form: ReturnType<PDFDocument["getForm"]>, fieldName: string, value: string): void {
  const field = form.getFieldMaybe(fieldName);
  if (!field) return;
  if (field instanceof PDFTextField) {
    field.setText(value);
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (isCheckedValue(value)) field.check();
    else if (isUncheckedValue(value)) field.uncheck();
    return;
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
    selectIfValid(field, value);
  }
}

export async function fillCourtFormPdfBytes(
  templateBytes: Buffer | Uint8Array | ArrayBuffer,
  values: Record<string, string>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  for (const [fieldName, value] of Object.entries(values)) setPdfField(form, fieldName, value);
  const appearanceFont = await pdf.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(appearanceFont);
  form.flatten();
  return pdf.save();
}
