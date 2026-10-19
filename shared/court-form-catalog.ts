import type { CourtFormType } from "./schema";

export type FormCategory = "court" | "mediation";

export const FORM_CATEGORIES: ReadonlyArray<{ id: FormCategory; label: string; description: string }> = [
  {
    id: "court",
    label: "Court Forms",
    description: "Manage HMCTS and GOV.UK court form templates, mappings, and procedural guidance.",
  },
  {
    id: "mediation",
    label: "Mediation Documents",
    description: "Manage Brighter Future Mediation document templates, mappings, and procedural guidance.",
  },
];

export const FORM_CATALOGUE: ReadonlyArray<{ id: CourtFormType; label: string; category: FormCategory; description: string }> = [
  { id: "FM1", label: "FM1", category: "court", description: "MIAM exemption / mediator certification form for court submission." },
  { id: "C100", label: "C100", category: "court", description: "Application under the Children Act 1989 — child arrangements, prohibited steps, specific issue." },
  { id: "FormA", label: "Form A", category: "court", description: "Notice of intention to proceed with a financial application to which the Standard Procedure applies." },
  { id: "FormE", label: "Form E", category: "court", description: "Financial statement template maintained against the current GOV.UK-published version." },
  { id: "AgreementToMediate", label: "Agreement to Mediate", category: "mediation", description: "Versioned agreement generated after the client signs the mediation-session form." },
  { id: "VoucherSchemeClientConsent", label: "Family Mediation Voucher Scheme client consent", category: "mediation", description: "Mandatory voucher consent block generated after the client signs the mediation-session form." },
  { id: "VoucherDiversityQuestionnaireOptIn", label: "Legacy Diversity questionnaire opt-in", category: "mediation", description: "Legacy optional voucher diversity consent retained for historical template support." },
  { id: "VoucherMojResearchContactOptIn", label: "Family Mediation Voucher Scheme: Privacy Policy and Client Consent", category: "mediation", description: "Optional MoJ voucher privacy and research-contact consent block." },
  { id: "DraftFinancialSchedule", label: "DRAFT FINANCIAL SCHEDULE", category: "mediation", description: "Draft financial schedule managed through the financial-disclosure workflow." },
  { id: "FinancialDisclosureBooklet", label: "Financial Disclosure Booklet", category: "mediation", description: "Disclosure booklet managed through the financial-disclosure workflow." },
];

export const FORM_CATEGORY_BY_TYPE: Readonly<Record<string, FormCategory>> = Object.fromEntries(
  FORM_CATALOGUE.map((form) => [form.id, form.category]),
) as Record<string, FormCategory>;

export type CaseFormType = Exclude<CourtFormType, "DraftFinancialSchedule" | "FinancialDisclosureBooklet">;

export const CASE_FORM_TYPES: readonly CaseFormType[] = FORM_CATALOGUE
  .map((form) => form.id)
  .filter((formType): formType is CaseFormType => formType !== "DraftFinancialSchedule" && formType !== "FinancialDisclosureBooklet");

export const CASE_FORM_CATALOGUE = FORM_CATALOGUE.filter(
  (form): form is typeof form & { id: CaseFormType } => form.id !== "DraftFinancialSchedule" && form.id !== "FinancialDisclosureBooklet",
);

export const CASE_FORM_CATEGORIES = FORM_CATEGORIES;

export function formCategoryForType(formType: CourtFormType): FormCategory {
  return FORM_CATEGORY_BY_TYPE[formType];
}
