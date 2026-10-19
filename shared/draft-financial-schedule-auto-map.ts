import { COURT_FORM_MERGE_SOURCE_VALUES } from "./court-form-merge-sources";

export type DraftFinancialScheduleMappingEntry = {
  pdfField: string;
  source: string;
  required?: boolean;
  defaultValue?: string | null;
};

export type DraftFinancialScheduleCorrectedMapping = {
  pdfField: string;
  previousSource: string;
  source: string;
};

export type DraftFinancialScheduleAutoMapDiagnostics = {
  createdMappings: number;
  correctedMappings: DraftFinancialScheduleCorrectedMapping[];
  preservedMappings: number;
  removedStaleMappings: string[];
  ignoredPdfFields: string[];
  unmappedPdfFields: string[];
};

export type DraftFinancialScheduleAutoMapResult = {
  fieldMapping: DraftFinancialScheduleMappingEntry[];
  diagnostics: DraftFinancialScheduleAutoMapDiagnostics;
  changed: boolean;
};

export type DraftFinancialScheduleMappingAuditStatus = "mapped" | "corrected" | "ignored" | "unmapped" | "stale";

export type DraftFinancialScheduleMappingAuditRow = {
  pdfField: string;
  currentSource: string | null;
  proposedSource: string | null;
  status: DraftFinancialScheduleMappingAuditStatus;
  sourceLabel: string | null;
  candidates: Array<{ source: string; sourceLabel: string; score: number }>;
};

export type DraftFinancialScheduleMappingAudit = {
  rows: DraftFinancialScheduleMappingAuditRow[];
  staleMappings: DraftFinancialScheduleMappingEntry[];
  summary: {
    fieldCount: number;
    mapped: number;
    corrected: number;
    ignored: number;
    unmapped: number;
    stale: number;
  };
};

const DFS_PREFIX = "draftFinancialSchedule.";
const DRAFT_SCHEDULE_SOURCES = new Set(COURT_FORM_MERGE_SOURCE_VALUES.filter((source) => source.startsWith(DFS_PREFIX)));

const HEADER_FIELDS: Record<string, string> = {
  ref: `${DFS_PREFIX}header.ref`,
  caseref: `${DFS_PREFIX}header.ref`,
  casereference: `${DFS_PREFIX}header.ref`,
  reference: `${DFS_PREFIX}header.ref`,
  refnumber: `${DFS_PREFIX}header.ref`,
  clientnames: `${DFS_PREFIX}header.clientNames`,
  clients: `${DFS_PREFIX}header.clientNames`,
  parties: `${DFS_PREFIX}header.clientNames`,
  clientaname: `${DFS_PREFIX}header.clientAName`,
  clientbname: `${DFS_PREFIX}header.clientBName`,
  date: `${DFS_PREFIX}header.date`,
  scheduledate: `${DFS_PREFIX}header.date`,
};

const PROPERTY_ROWS: Record<string, string> = {
  propertyvalue: "value",
  mortgage: "lessMortgage",
  lessmortgage: "lessMortgage",
  penalties: "lessPenalties",
  lesspenalties: "lessPenalties",
  sellingfees: "sellingFeesEstimate",
  sellingfeesestimate: "sellingFeesEstimate",
  solicitorfees: "solicitorFeesEstimate",
  solicitorfeesestimate: "solicitorFeesEstimate",
  equity: "equity",
};

const SCALAR_FIELDS: Record<string, string> = {
  pensionjoint: `${DFS_PREFIX}unrealisableAssets.pensions.joint`,
  pensionnotes: `${DFS_PREFIX}unrealisableAssets.pensions.notes`,
  salarynotes: `${DFS_PREFIX}monthlyIncome.salaryGross.notes`,
  selfassessmenta: `${DFS_PREFIX}monthlyIncome.selfAssessmentTaxReturn.clientA`,
  selfassessmentb: `${DFS_PREFIX}monthlyIncome.selfAssessmentTaxReturn.clientB`,
  selfassessmentnotes: `${DFS_PREFIX}monthlyIncome.selfAssessmentTaxReturn.notes`,
};

const EXPENDITURE_ROWS: Record<string, string> = {
  accommodation: "accommodation",
  commitments: "financialCommitments",
  utilities: "utilities",
  transport: "transport",
  household: "householdExpenses",
  personal: "personalExpenses",
  recreation: "recreationalExpenses",
  children: "childrensExpenses",
};

const REPEATABLE_PREFIXES: Record<string, { path: string; asset: boolean }> = {
  current_account: { path: "realisableAssets.currentAccounts", asset: true },
  savings_account: { path: "realisableAssets.savingsAccounts", asset: true },
  investment: { path: "realisableAssets.insurancePoliciesOtherInvestments", asset: true },
  vehicle: { path: "realisableAssets.vehicles", asset: true },
  belongings: { path: "realisableAssets.personalBelongings", asset: true },
  credit_card: { path: "liabilities.creditCards", asset: false },
  loan: { path: "liabilities.loans", asset: false },
  debt_mgmt: { path: "liabilities.debtManagement", asset: false },
};

const REPEATABLE_FIELD_NAMES: Record<string, string> = {
  name: "description",
  description: "description",
  joint: "joint",
  a: "clientA",
  client_a: "clientA",
  b: "clientB",
  client_b: "clientB",
  notes: "notes",
  note: "notes",
};

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizedUnderscores(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function sourceAllowed(source: string): boolean {
  return source === "static" || DRAFT_SCHEDULE_SOURCES.has(source);
}

function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  return source.replace(/^draftFinancialSchedule\./, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll(".", " / ");
}

function inferPropertySource(pdfField: string): string | null {
  const match = normalizedUnderscores(pdfField).match(/^(property_value|mortgage|less_mortgage|penalties|less_penalties|selling_fees|selling_fees_estimate|solicitor_fees|solicitor_fees_estimate|equity)_(client_)?(a|b|notes)$/);
  if (!match) return null;
  const row = PROPERTY_ROWS[normalize(match[1])];
  const field = match[3] === "a" ? "clientA" : match[3] === "b" ? "clientB" : "notes";
  const source = `${DFS_PREFIX}realisableAssets.property.${row}.${field}`;
  return DRAFT_SCHEDULE_SOURCES.has(source) ? source : null;
}

function inferRepeatableSource(pdfField: string): string | null {
  const match = normalizedUnderscores(pdfField).match(/^(current_account|savings_account|investment|vehicle|belongings|credit_card|loan|debt_mgmt)_(\d+)_(name|description|joint|a|client_a|b|client_b|notes|note)$/);
  if (!match) return null;
  const category = REPEATABLE_PREFIXES[match[1]];
  const row = Number.parseInt(match[2], 10);
  const field = REPEATABLE_FIELD_NAMES[match[3]];
  if (!category || !Number.isInteger(row) || row < 1 || row > 20 || !field) return null;
  if (category.asset && field === "joint") return null;
  const source = `${DFS_PREFIX}${category.path}.${row}.${field}`;
  return DRAFT_SCHEDULE_SOURCES.has(source) ? source : null;
}

function inferExpenditureSource(pdfField: string): string | null {
  const match = normalizedUnderscores(pdfField).match(/^exp_(accommodation|commitments|utilities|transport|household|personal|recreation|children)_(a|b|notes)$/);
  if (!match) return null;
  const row = EXPENDITURE_ROWS[match[1]];
  const field = match[2] === "a" ? "clientA" : match[2] === "b" ? "clientB" : "notes";
  const source = `${DFS_PREFIX}monthlyExpenditure.${row}.${field}`;
  return DRAFT_SCHEDULE_SOURCES.has(source) ? source : null;
}

export function isIgnoredDraftFinancialSchedulePdfField(pdfField: string): boolean {
  return /^(current_account|savings_account|investment|vehicle|belongings)_\d+_joint$/.test(normalizedUnderscores(pdfField));
}

export function inferDraftFinancialScheduleSource(pdfField: string): string | null {
  const normalized = normalize(pdfField);
  if (!normalized || /^text\d+$/.test(normalized)) return null;
  const direct = HEADER_FIELDS[normalized] || SCALAR_FIELDS[normalized];
  if (direct && DRAFT_SCHEDULE_SOURCES.has(direct)) return direct;
  return inferPropertySource(pdfField) || inferRepeatableSource(pdfField) || inferExpenditureSource(pdfField);
}

export function auditDraftFinancialScheduleMapping(input: {
  fieldNames: string[];
  existingMapping: DraftFinancialScheduleMappingEntry[];
}): DraftFinancialScheduleMappingAudit {
  const fieldSet = new Set(input.fieldNames.map(String));
  const currentByField = new Map((input.existingMapping || []).map((entry) => [entry.pdfField, entry]));
  const staleMappings = (input.existingMapping || []).filter((entry) => (
    !fieldSet.has(entry.pdfField)
    || (!sourceAllowed(entry.source) && !inferDraftFinancialScheduleSource(entry.pdfField))
  ));
  const rows = input.fieldNames.map<DraftFinancialScheduleMappingAuditRow>((pdfField) => {
    const current = currentByField.get(pdfField);
    const currentSource = current?.source || null;
    const proposedSource = inferDraftFinancialScheduleSource(pdfField);
    let status: DraftFinancialScheduleMappingAuditStatus;
    if (isIgnoredDraftFinancialSchedulePdfField(pdfField)) status = "ignored";
    else if (proposedSource && currentSource && currentSource !== proposedSource) status = "corrected";
    else if (proposedSource || (currentSource && sourceAllowed(currentSource))) status = "mapped";
    else if (currentSource) status = "stale";
    else status = "unmapped";
    return {
      pdfField,
      currentSource,
      proposedSource,
      status,
      sourceLabel: sourceLabel(proposedSource || (currentSource && sourceAllowed(currentSource) ? currentSource : null)),
      candidates: proposedSource ? [{ source: proposedSource, sourceLabel: sourceLabel(proposedSource) || proposedSource, score: 1000 }] : [],
    };
  });
  const summary = rows.reduce<DraftFinancialScheduleMappingAudit["summary"]>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, { fieldCount: rows.length, mapped: 0, corrected: 0, ignored: 0, unmapped: 0, stale: 0 });
  return { rows, staleMappings, summary };
}

export function autoRepairDraftFinancialScheduleMapping(input: {
  fieldNames: string[];
  existingMapping: DraftFinancialScheduleMappingEntry[];
}): DraftFinancialScheduleAutoMapResult {
  const audit = auditDraftFinancialScheduleMapping(input);
  const currentByField = new Map((input.existingMapping || []).map((entry) => [entry.pdfField, entry]));
  const fieldMapping: DraftFinancialScheduleMappingEntry[] = [];
  const correctedMappings: DraftFinancialScheduleCorrectedMapping[] = [];
  const removedStaleMappings = audit.staleMappings.map((entry) => entry.pdfField);
  const ignoredPdfFields: string[] = [];
  const unmappedPdfFields: string[] = [];
  let createdMappings = 0;
  let preservedMappings = 0;

  for (const row of audit.rows) {
    const current = currentByField.get(row.pdfField);
    if (row.status === "ignored") {
      ignoredPdfFields.push(row.pdfField);
      if (current) removedStaleMappings.push(row.pdfField);
      continue;
    }
    if (row.proposedSource) {
      if (current?.source === row.proposedSource) {
        fieldMapping.push(current);
        preservedMappings++;
      } else {
        fieldMapping.push({
          pdfField: row.pdfField,
          source: row.proposedSource,
          required: current?.required ?? false,
          defaultValue: current?.defaultValue ?? null,
        });
        if (current) correctedMappings.push({ pdfField: row.pdfField, previousSource: current.source, source: row.proposedSource });
        else createdMappings++;
      }
      continue;
    }
    if (current && sourceAllowed(current.source)) {
      fieldMapping.push(current);
      preservedMappings++;
      continue;
    }
    unmappedPdfFields.push(row.pdfField);
  }

  return {
    fieldMapping,
    diagnostics: {
      createdMappings,
      correctedMappings,
      preservedMappings,
      removedStaleMappings: Array.from(new Set(removedStaleMappings)),
      ignoredPdfFields,
      unmappedPdfFields,
    },
    changed: JSON.stringify(fieldMapping) !== JSON.stringify(input.existingMapping || []),
  };
}
