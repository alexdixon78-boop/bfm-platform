import crypto from "node:crypto";
import ExcelJS from "exceljs";

export const LEGACY_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const LEGACY_IMPORT_MAX_ROWS = 5_000;
export const LEGACY_IMPORT_MAX_COLUMNS = 200;

export const LEGACY_TARGET_FIELDS = [
  "legacyReference", "sourceRecordId", "enquiryDate", "leadSource", "mediationType",
  "customMediationType", "legacyStatus", "closureOutcome", "closedAt", "reopenedAt",
  "sourceCreatedAt", "sourceUpdatedAt", "mediatorFirstName", "mediatorLastName",
  "mediatorEmail", "mediatorCompany",
  "client1FirstName", "client1LastName", "client1DateOfBirth", "client1Email",
  "client1Phone", "client1PhoneCountry", "client1AddressLine1", "client1AddressLine2",
  "client1City", "client1Postcode", "client1Country", "client1Gender",
  "client1EthnicOrigin", "client1EthnicOriginFormatted", "client1Disability",
  "client1DisabilityFormatted", "client1NationalInsuranceNumber", "client1AdditionalNeeds",
  "client1AssessmentDate",
  "client2FirstName", "client2MiddleName", "client2LastName", "client2DateOfBirth",
  "client2Email", "client2Phone", "client2PhoneCountry", "client2AddressLine1",
  "client2AddressLine2", "client2City", "client2Postcode", "client2Country",
  "client2Gender", "client2EthnicOrigin", "client2EthnicOriginFormatted",
  "client2Disability", "client2DisabilityFormatted", "client2NationalInsuranceNumber",
  "client2AdditionalNeeds", "client2AssessmentDate", "client2LegalAid", "client2Confidential",
] as const;

export type LegacyTargetField = typeof LEGACY_TARGET_FIELDS[number];
export type LegacyColumnMapping = Partial<Record<LegacyTargetField, string | null>>;

export type LegacyMappingSection = "Legacy record" | "Client 1" | "Client 2";

export interface LegacyMappingTarget {
  key: LegacyTargetField;
  label: string;
  section: LegacyMappingSection;
  required: boolean;
}

const LEGACY_FIELD_LABELS: Record<string, string> = {
  legacyReference: "Legacy reference",
  sourceRecordId: "Source record ID",
  enquiryDate: "Enquiry date",
  leadSource: "Lead source",
  mediationType: "Mediation type",
  customMediationType: "Custom mediation type",
  legacyStatus: "Legacy status",
  closureOutcome: "Closure outcome",
  closedAt: "Closed at",
  reopenedAt: "Reopened at",
  sourceCreatedAt: "Source created at",
  sourceUpdatedAt: "Source updated at",
  mediatorFirstName: "Mediator first name",
  mediatorLastName: "Mediator last name",
  mediatorEmail: "Mediator email",
  mediatorCompany: "Mediator company",
  FirstName: "First name",
  MiddleName: "Middle name",
  LastName: "Last name",
  DateOfBirth: "Date of birth",
  Email: "Email",
  Phone: "Phone",
  PhoneCountry: "Phone country code",
  AddressLine1: "Address line 1",
  AddressLine2: "Address line 2",
  City: "City",
  Postcode: "Postcode",
  Country: "Country",
  Gender: "Gender",
  EthnicOrigin: "Ethnic origin",
  EthnicOriginFormatted: "Formatted ethnic origin",
  Disability: "Disability / health condition",
  DisabilityFormatted: "Formatted disability / health condition",
  NationalInsuranceNumber: "National Insurance number",
  AdditionalNeeds: "Additional needs",
  AssessmentDate: "Assessment date",
  LegalAid: "Legal aid",
  Confidential: "Confidential",
};

export const LEGACY_MAPPING_TARGETS: LegacyMappingTarget[] =
  LEGACY_TARGET_FIELDS.map((key) => {
    const clientMatch = key.match(/^client([12])(.+)$/);
    const section: LegacyMappingSection = clientMatch
      ? clientMatch[1] === "1"
        ? "Client 1"
        : "Client 2"
      : "Legacy record";
    const labelKey = clientMatch?.[2] || key;
    return {
      key,
      label: LEGACY_FIELD_LABELS[labelKey] || labelKey,
      section,
      required: ["legacyReference", "client1FirstName", "client1LastName"].includes(key),
    };
  });

export interface LegacyClientProfile {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  phoneCode: string | null;
  gender: string | null;
  ethnicOrigin: string | null;
  nationalInsuranceNumber: string | null;
  disabilityOrHealthCondition: string | null;
  additionalNeeds: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
}

export interface LegacyImportIssue {
  code: string;
  message: string;
  field?: LegacyTargetField;
  cell?: string;
}

export interface ParsedLegacyPerson {
  personKey: string;
  sourceRowNumber: number;
  sourceRole: "client_1" | "client_2";
  legacyReference: string;
  profile: LegacyClientProfile;
  originalValues: Record<string, unknown>;
  legacyOnlyValues: Record<string, unknown>;
  errors: LegacyImportIssue[];
  warnings: LegacyImportIssue[];
}

export interface ParsedLegacyRecord {
  sourceRowNumber: number;
  legacyReference: string;
  sourceRecordId: string | null;
  originalValues: Record<string, unknown>;
  safeValues: Record<string, unknown>;
  errors: LegacyImportIssue[];
}

const DEFAULT_HEADERS: Record<LegacyTargetField, string> = {
  legacyReference: "custom_case_id",
  sourceRecordId: "id",
  enquiryDate: "enquiry_date",
  leadSource: "lead_source",
  mediationType: "mediation_type",
  customMediationType: "custom_mediation_type",
  legacyStatus: "status",
  closureOutcome: "closure_outcome",
  closedAt: "closed_at",
  reopenedAt: "reopened_at",
  sourceCreatedAt: "created_at",
  sourceUpdatedAt: "updated_at",
  mediatorFirstName: "currentMediator_first_name",
  mediatorLastName: "currentMediator_last_name",
  mediatorEmail: "currentMediator_email",
  mediatorCompany: "currentMediator_companyName",
  client1FirstName: "client_1_firstname",
  client1LastName: "client_1_lastname",
  client1DateOfBirth: "client_1_dob",
  client1Email: "client_1_email",
  client1Phone: "client_1_phone",
  client1PhoneCountry: "client_1_phone_country",
  client1AddressLine1: "client_1_address_line1",
  client1AddressLine2: "client_1_address_line2",
  client1City: "client_1_city",
  client1Postcode: "client_1_postcode",
  client1Country: "client_1_country",
  client1Gender: "client_1_gender",
  client1EthnicOrigin: "client_1_ethnic_origin",
  client1EthnicOriginFormatted: "client_1_ethnic_origin_formatted",
  client1Disability: "client_1_disability",
  client1DisabilityFormatted: "client_1_disability_formatted",
  client1NationalInsuranceNumber: "client_1_ni_number",
  client1AdditionalNeeds: "client_1_additional_needs",
  client1AssessmentDate: "client_1_assessment_date",
  client2FirstName: "client_2_firstname",
  client2MiddleName: "client_2_middlename",
  client2LastName: "client_2_lastname",
  client2DateOfBirth: "client_2_dob",
  client2Email: "client_2_email",
  client2Phone: "client_2_phone",
  client2PhoneCountry: "client_2_phone_country",
  client2AddressLine1: "client_2_address_line1",
  client2AddressLine2: "client_2_address_line2",
  client2City: "client_2_city",
  client2Postcode: "client_2_postcode",
  client2Country: "client_2_country",
  client2Gender: "client_2_gender",
  client2EthnicOrigin: "client_2_ethnic_origin",
  client2EthnicOriginFormatted: "client_2_ethnic_origin_formatted",
  client2Disability: "client_2_disability",
  client2DisabilityFormatted: "client_2_disability_formatted",
  client2NationalInsuranceNumber: "client_2_ni_number",
  client2AdditionalNeeds: "client_2_additional_needs",
  client2AssessmentDate: "client_2_assessment_date",
  client2LegalAid: "client_2_laa",
  client2Confidential: "client_2_confidential",
};

const RECORD_FIELDS: LegacyTargetField[] = [
  "legacyReference", "sourceRecordId", "enquiryDate", "leadSource", "mediationType",
  "customMediationType", "legacyStatus", "closureOutcome", "closedAt", "reopenedAt",
  "sourceCreatedAt", "sourceUpdatedAt", "mediatorFirstName", "mediatorLastName",
  "mediatorEmail", "mediatorCompany",
];

const FORBIDDEN_HEADER = /(bank|stripe|payment.?method|emailconnection|integration.?payload|external.?token|access.?token|refresh.?token|password|secret|credential|auth)/i;

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in (value as Record<string, unknown>)) return String((value as { text: unknown }).text ?? "");
    if ("result" in (value as Record<string, unknown>)) return text((value as { result: unknown }).result);
  }
  return String(value).trim();
}

function londonDate(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function normalizeLegacyDate(value: unknown): string | null {
  if (value == null || text(value) === "") return null;
  if (value instanceof Date) return londonDate(value);
  if (typeof value === "number" || /^\d+(?:\.0+)?$/.test(text(value))) {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  const raw = text(value);
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoDate) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
  }
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (uk) {
    const candidate = `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
    const parsed = new Date(`${candidate}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
  }
  return londonDate(new Date(raw));
}

export function normalizeLegacyPhone(phoneValue: unknown, countryValue: unknown): { phone: string | null; phoneCode: string | null } {
  const phoneRaw = text(phoneValue);
  if (!phoneRaw) return { phone: null, phoneCode: normalizeCountryCode(countryValue) };
  let digits: string;
  if (/^\d+(?:\.\d+)?[Ee][+-]?\d+$/.test(phoneRaw)) {
    const numeric = Number(phoneRaw);
    digits = Number.isSafeInteger(numeric) ? String(numeric) : "";
  } else {
    digits = phoneRaw.replace(/\D/g, "");
  }
  if (!digits || digits.length < 6 || digits.length > 15) return { phone: null, phoneCode: normalizeCountryCode(countryValue) };
  const phoneCode = normalizeCountryCode(countryValue) || (digits.startsWith("44") ? "+44" : "+44");
  const countryDigits = phoneCode.replace(/\D/g, "");
  if (countryDigits && digits.startsWith(countryDigits)) digits = digits.slice(countryDigits.length);
  if (phoneCode === "+44") digits = digits.replace(/^0/, "");
  return { phone: digits || null, phoneCode };
}

function normalizeCountryCode(value: unknown): string | null {
  const digits = text(value).replace(/\.0+$/, "").replace(/\D/g, "");
  return digits ? `+${digits}` : "+44";
}

function normalizeGender(value: unknown): string | null {
  const raw = text(value).toLowerCase();
  const aliases: Record<string, string> = {
    male: "Man", man: "Man", female: "Woman", woman: "Woman",
    other: "Self-describe", "self-describe": "Self-describe",
    "non-binary": "Non-binary", "prefer not to say": "Prefer not to say",
  };
  return aliases[raw] ?? null;
}

const ETHNIC_ALIASES: Record<string, string> = {
  "white - english, welsh, scottish, northern irish or british": "White - English, Welsh, Scottish, Northern Irish or British",
  "white - irish": "White - Irish",
  "white - gypsy or irish traveller": "White - Gypsy or Irish Traveller",
  "white - roma": "White - Roma",
  "white - any other white background": "White - Any other White background",
  "mixed - white and black caribbean": "Mixed - White and Black Caribbean",
  "mixed - white and black african": "Mixed - White and Black African",
  "mixed - white and asian": "Mixed - White and Asian",
  "mixed - any other mixed or multiple background": "Mixed - Any other Mixed or Multiple background",
  "asian - indian": "Asian - Indian",
  "asian - pakistani": "Asian - Pakistani",
  "asian - bangladeshi": "Asian - Bangladeshi",
  "asian - chinese": "Asian - Chinese",
  "asian - any other asian background": "Asian - Any other Asian background",
  "black - african": "Black - African",
  "black - caribbean": "Black - Caribbean",
  "black - any other black, african or caribbean background": "Black - Any other Black, African or Caribbean background",
  "other - arab": "Other - Arab",
  "other - any other ethnic group": "Other - Any other ethnic group",
  "prefer not to say": "Prefer not to say",
  "self-disclose": "Self-disclose",
  "client - british (01)": "White - English, Welsh, Scottish, Northern Irish or British",
  "client - irish (02)": "White - Irish",
  "black or black british african (03)": "Black - African",
  "black or black british caribbean (04)": "Black - Caribbean",
  "black or black british other (05)": "Black - Any other Black, African or Caribbean background",
  "asian or asian british indian (06)": "Asian - Indian",
  "asian or asian british pakistani (07)": "Asian - Pakistani",
  "asian or asian british bangladeshi (08)": "Asian - Bangladeshi",
  "asian or asian british chinese (09)": "Asian - Chinese",
  "mixed client & black caribbean (10)": "Mixed - White and Black Caribbean",
  "mixed client & black african (11)": "Mixed - White and Black African",
  "mixed client & asian (12)": "Mixed - White and Asian",
  "mixed other (13)": "Mixed - Any other Mixed or Multiple background",
  "client other (14)": "White - Any other White background",
  "asian or asian british other (15)": "Asian - Any other Asian background",
  "other (00)": "Other - Any other ethnic group",
};

const DISABILITY_ALIASES: Record<string, string> = {
  none: "None",
  "blindness or partial sight": "Blindness or partial sight",
  "deafness or partial hearing": "Deafness or partial hearing",
  "mental health condition": "Mental health condition",
  "learning disability or difficulty": "Learning disability or difficulty",
  "memory or cognitive difficulties": "Memory or cognitive difficulties",
  "autistic spectrum condition": "Autistic spectrum condition",
  "neurodivergent - adhd, dyslexia, dyspraxia or other": "Neurodivergent - ADHD, dyslexia, dyspraxia or other",
  "long-term physical health condition or illness": "Long-term physical health condition or illness",
  other: "Other",
  "prefer not to say": "Prefer not to say",
  "hearing impaired (hea)": "Deafness or partial hearing",
  "other (oth)": "Other",
  "mental health condition (mhc)": "Mental health condition",
  "no disabilities (ncd)": "None",
};

function normalizedAlias(values: unknown[], aliases: Record<string, string>): string | null {
  for (const value of values) {
    const matched = aliases[text(value).toLowerCase()];
    if (matched) return matched;
  }
  return null;
}

async function loadWorkbook(input: { fileName: string; contentBase64: string }) {
  if (!input.fileName.toLowerCase().endsWith(".xlsx")) throw new Error("Only .xlsx workbooks are supported");
  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new Error("Workbook content is not valid base64");
  }
  if (!bytes.length || bytes.length > LEGACY_IMPORT_MAX_BYTES) throw new Error("Workbook must be between 1 byte and 10 MB");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return { workbook, bytes };
}

function headersForSheet(sheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  const first = sheet.getRow(1);
  for (let column = 1; column <= first.cellCount; column += 1) values.push(text(first.getCell(column).value));
  return values;
}

export async function inspectLegacyWorkbook(input: { fileName: string; contentBase64: string }) {
  const { workbook, bytes } = await loadWorkbook(input);
  if (!workbook.worksheets.length) throw new Error("Workbook has no worksheets");
  const sheets = workbook.worksheets.map((sheet) => {
    const headers = headersForSheet(sheet);
    if (headers.length > LEGACY_IMPORT_MAX_COLUMNS) throw new Error(`Worksheet ${sheet.name} exceeds 200 columns`);
    if (Math.max(0, sheet.actualRowCount - 1) > LEGACY_IMPORT_MAX_ROWS) throw new Error(`Worksheet ${sheet.name} exceeds 5,000 data rows`);
    return { name: sheet.name, headers, dataRowCount: Math.max(0, sheet.actualRowCount - 1) };
  });
  const firstHeaders = new Set(sheets[0].headers);
  const suggestedMapping: LegacyColumnMapping = {};
  for (const target of LEGACY_TARGET_FIELDS) {
    const source = DEFAULT_HEADERS[target];
    if (firstHeaders.has(source) && !FORBIDDEN_HEADER.test(source)) suggestedMapping[target] = source;
  }
  const mapped = new Set(Object.values(suggestedMapping).filter(Boolean));
  return {
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    sheets,
    mappingTargets: LEGACY_MAPPING_TARGETS,
    suggestedMapping,
    unmappedHeaders: sheets[0].headers.filter((header) => header && !mapped.has(header) && !FORBIDDEN_HEADER.test(header)),
    ignoredHeaders: sheets[0].headers.filter((header) => FORBIDDEN_HEADER.test(header)),
  };
}

function validateMapping(mapping: LegacyColumnMapping, headers: string[]) {
  for (const required of ["legacyReference", "client1FirstName", "client1LastName"] as const) {
    if (!mapping[required]) throw new Error(`Missing required mapping: ${required}`);
  }
  for (const [target, header] of Object.entries(mapping)) {
    if (!header) continue;
    if (!headers.includes(header)) throw new Error(`Mapped header does not exist: ${header}`);
    if (FORBIDDEN_HEADER.test(header)) throw new Error(`Header cannot be imported: ${header}`);
    if (!LEGACY_TARGET_FIELDS.includes(target as LegacyTargetField)) throw new Error(`Unknown mapping target: ${target}`);
  }
}

function rawCell(sheet: ExcelJS.Worksheet, rowNumber: number, headerIndexes: Map<string, number>, mapping: LegacyColumnMapping, field: LegacyTargetField) {
  const header = mapping[field];
  const column = header ? headerIndexes.get(header) : undefined;
  if (!column) return { value: null as unknown, address: undefined as string | undefined, formula: false };
  const cell = sheet.getRow(rowNumber).getCell(column);
  const value = cell.value;
  return {
    value,
    address: cell.address,
    formula: !!value && typeof value === "object" && ("formula" in (value as unknown as Record<string, unknown>) || "sharedFormula" in (value as unknown as Record<string, unknown>)),
  };
}

function rawValuesForFields(sheet: ExcelJS.Worksheet, rowNumber: number, headerIndexes: Map<string, number>, mapping: LegacyColumnMapping, fields: LegacyTargetField[]) {
  return Object.fromEntries(fields.map((field) => [field, text(rawCell(sheet, rowNumber, headerIndexes, mapping, field).value) || null]));
}

function buildPerson(args: {
  sheet: ExcelJS.Worksheet;
  rowNumber: number;
  role: "client_1" | "client_2";
  mapping: LegacyColumnMapping;
  headerIndexes: Map<string, number>;
  legacyReference: string;
}): ParsedLegacyPerson | null {
  const prefix = args.role === "client_1" ? "client1" : "client2";
  const field = (suffix: string) => `${prefix}${suffix}` as LegacyTargetField;
  const originalFields = LEGACY_TARGET_FIELDS.filter((name) => name.startsWith(prefix));
  const originalValues = rawValuesForFields(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, originalFields);
  const firstName = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("FirstName")).value);
  const lastName = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("LastName")).value);
  if (args.role === "client_2" && !firstName && !lastName) return null;
  const errors: LegacyImportIssue[] = [];
  const warnings: LegacyImportIssue[] = [];
  if (!firstName || !lastName) errors.push({ code: "missing_name", message: "First and last name are required" });

  for (const mappedField of originalFields) {
    const cell = rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, mappedField);
    if (cell.formula) errors.push({ code: "formula_cell", message: "Mapped formula cells must be replaced during review", field: mappedField, cell: cell.address });
  }

  const dobCell = rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("DateOfBirth"));
  const dateOfBirth = normalizeLegacyDate(dobCell.value);
  if (text(dobCell.value) && !dateOfBirth) errors.push({ code: "invalid_date", message: "Date of birth could not be normalised", field: field("DateOfBirth"), cell: dobCell.address });
  const email = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("Email")).value).toLowerCase() || null;
  const phoneResult = normalizeLegacyPhone(
    rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("Phone")).value,
    rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("PhoneCountry")).value,
  );
  const phoneRaw = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("Phone")).value);
  if (phoneRaw && !phoneResult.phone) errors.push({ code: "invalid_phone", message: "Phone number could not be normalised", field: field("Phone") });
  if (!email) warnings.push({ code: "missing_email", message: "Email is missing" });
  if (!phoneResult.phone) warnings.push({ code: "missing_phone", message: "Phone is missing" });

  const genderRaw = rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("Gender")).value;
  const gender = normalizeGender(genderRaw);
  if (text(genderRaw) && !gender) warnings.push({ code: "unmapped_gender", message: `Gender value "${text(genderRaw)}" was retained only in legacy history`, field: field("Gender") });
  const ethnicFormatted = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("EthnicOriginFormatted")).value);
  const ethnicRaw = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("EthnicOrigin")).value);
  const disabilityFormatted = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("DisabilityFormatted")).value);
  const disabilityRaw = text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("Disability")).value);
  const ethnicOrigin = normalizedAlias([ethnicFormatted, ethnicRaw], ETHNIC_ALIASES);
  const disability = normalizedAlias([disabilityFormatted, disabilityRaw], DISABILITY_ALIASES);
  if ((ethnicFormatted || ethnicRaw) && !ethnicOrigin) warnings.push({ code: "unmapped_ethnic_origin", message: `Ethnic-origin value "${ethnicFormatted || ethnicRaw}" was retained only in legacy history`, field: field("EthnicOrigin") });
  if ((disabilityFormatted || disabilityRaw) && !disability) warnings.push({ code: "unmapped_disability", message: `Disability value "${disabilityFormatted || disabilityRaw}" was retained only in legacy history`, field: field("Disability") });
  const value = (suffix: string) => text(rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field(suffix)).value) || null;
  const assessmentCell = rawCell(args.sheet, args.rowNumber, args.headerIndexes, args.mapping, field("AssessmentDate"));
  const assessmentDate = normalizeLegacyDate(assessmentCell.value);
  if (text(assessmentCell.value) && !assessmentDate) errors.push({ code: "invalid_date", message: "Assessment date could not be normalised", field: field("AssessmentDate"), cell: assessmentCell.address });

  const profile: LegacyClientProfile = {
    firstName,
    lastName,
    dateOfBirth,
    email,
    phone: phoneResult.phone,
    phoneCode: phoneResult.phoneCode,
    gender,
    ethnicOrigin,
    nationalInsuranceNumber: value("NationalInsuranceNumber"),
    disabilityOrHealthCondition: disability,
    additionalNeeds: value("AdditionalNeeds"),
    addressLine1: value("AddressLine1"),
    addressLine2: value("AddressLine2"),
    city: value("City"),
    postcode: value("Postcode"),
    country: value("Country"),
  };
  const legacyOnlyValues: Record<string, unknown> = {
    middleName: args.role === "client_2" ? value("MiddleName") : null,
    assessmentDate,
    legalAid: args.role === "client_2" ? value("LegalAid") : null,
    confidential: args.role === "client_2" ? value("Confidential") : null,
  };
  return {
    personKey: `row-${args.rowNumber}:${args.role}`,
    sourceRowNumber: args.rowNumber,
    sourceRole: args.role,
    legacyReference: args.legacyReference,
    profile,
    originalValues,
    legacyOnlyValues,
    errors,
    warnings,
  };
}

export async function parseLegacyWorkbook(input: {
  fileName: string;
  contentBase64: string;
  sheetName: string;
  mapping: LegacyColumnMapping;
  confirmedPlaceholders: string[];
}) {
  const { workbook, bytes } = await loadWorkbook(input);
  const sheet = workbook.getWorksheet(input.sheetName);
  if (!sheet) throw new Error("Selected worksheet was not found");
  const headers = headersForSheet(sheet);
  if (headers.length > LEGACY_IMPORT_MAX_COLUMNS) throw new Error("Selected worksheet exceeds 200 columns");
  if (Math.max(0, sheet.actualRowCount - 1) > LEGACY_IMPORT_MAX_ROWS) throw new Error("Selected worksheet exceeds 5,000 data rows");
  validateMapping(input.mapping, headers);
  const headerIndexes = new Map(headers.map((header, index) => [header, index + 1]));
  const records: ParsedLegacyRecord[] = [];
  const people: ParsedLegacyPerson[] = [];
  const seenSourceIds = new Set<string>();
  const seenReferences = new Set<string>();

  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    if (!sheet.getRow(rowNumber).hasValues) continue;
    const recordRaw = rawValuesForFields(sheet, rowNumber, headerIndexes, input.mapping, RECORD_FIELDS);
    const legacyReference = text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "legacyReference").value);
    const sourceRecordId = text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "sourceRecordId").value) || null;
    const recordErrors: LegacyImportIssue[] = [];
    for (const mappedField of RECORD_FIELDS) {
      const cell = rawCell(sheet, rowNumber, headerIndexes, input.mapping, mappedField);
      if (cell.formula) recordErrors.push({ code: "formula_cell", message: "Mapped formula cells must be replaced during review", field: mappedField, cell: cell.address });
    }
    if (!legacyReference) recordErrors.push({ code: "missing_legacy_reference", message: "Legacy reference is required" });
    if (legacyReference && seenReferences.has(legacyReference)) recordErrors.push({ code: "duplicate_legacy_reference", message: "Legacy reference is repeated in this workbook" });
    if (sourceRecordId && seenSourceIds.has(sourceRecordId)) recordErrors.push({ code: "duplicate_source_id", message: "Source record ID is repeated in this workbook" });
    if (legacyReference) seenReferences.add(legacyReference);
    if (sourceRecordId) seenSourceIds.add(sourceRecordId);
    const recordDate = (field: LegacyTargetField) => {
      const cell = rawCell(sheet, rowNumber, headerIndexes, input.mapping, field);
      const normalized = normalizeLegacyDate(cell.value);
      if (text(cell.value) && !normalized) recordErrors.push({ code: "invalid_date", message: `${field} could not be normalised`, field, cell: cell.address });
      return normalized;
    };
    const safeValues = {
      legacyReference,
      sourceRecordId,
      enquiryDate: recordDate("enquiryDate"),
      leadSource: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "leadSource").value) || null,
      mediationType: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "mediationType").value) || null,
      customMediationType: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "customMediationType").value) || null,
      status: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "legacyStatus").value) || null,
      closureOutcome: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "closureOutcome").value) || null,
      closedAt: recordDate("closedAt"),
      reopenedAt: recordDate("reopenedAt"),
      sourceCreatedAt: recordDate("sourceCreatedAt"),
      sourceUpdatedAt: recordDate("sourceUpdatedAt"),
      mediatorName: [text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "mediatorFirstName").value), text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "mediatorLastName").value)].filter(Boolean).join(" ") || null,
      mediatorEmail: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "mediatorEmail").value).toLowerCase() || null,
      mediatorCompany: text(rawCell(sheet, rowNumber, headerIndexes, input.mapping, "mediatorCompany").value) || null,
    };
    records.push({ sourceRowNumber: rowNumber, legacyReference, sourceRecordId, originalValues: recordRaw, safeValues, errors: recordErrors });
    for (const role of ["client_1", "client_2"] as const) {
      const person = buildPerson({ sheet, rowNumber, role, mapping: input.mapping, headerIndexes, legacyReference });
      if (person) {
        if (recordErrors.length) person.errors.push(...recordErrors);
        people.push(person);
      }
    }
  }

  const contactCounts = new Map<string, { kind: "email" | "phone"; value: string; count: number }>();
  for (const person of people) {
    const contacts: Array<{ kind: "email" | "phone"; value: string | null }> = [
      { kind: "email", value: person.profile.email },
      { kind: "phone", value: person.profile.phone ? `${person.profile.phoneCode || ""}${person.profile.phone}` : null },
    ];
    for (const contact of contacts) {
      if (!contact.value) continue;
      const key = `${contact.kind}:${contact.value}`;
      const current = contactCounts.get(key);
      contactCounts.set(key, { kind: contact.kind, value: contact.value, count: (current?.count || 0) + 1 });
    }
  }
  const threshold = Math.max(10, Math.ceil(people.length * 0.05));
  const placeholderCandidates = Array.from(contactCounts.values()).filter((entry) => entry.count >= threshold).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const confirmed = new Set(input.confirmedPlaceholders.map((value) => value.toLowerCase()));
  for (const person of people) {
    if (person.profile.email && confirmed.has(person.profile.email.toLowerCase())) person.profile.email = null;
    const fullPhone = person.profile.phone ? `${person.profile.phoneCode || ""}${person.profile.phone}`.toLowerCase() : null;
    if (fullPhone && confirmed.has(fullPhone)) person.profile.phone = null;
  }

  return {
    fileHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    records,
    people,
    placeholderCandidates,
  };
}
