export const DRAFT_FINANCIAL_SCHEDULE_SCHEMA_VERSION = 2;

export const DRAFT_FINANCIAL_SCHEDULE_PRIVILEGE_NOTICE =
  "This document is without prejudice and legally privileged and may only be shown by the parties to their legal advisors (if any) in connection with obtaining legal advice";

export const DRAFT_FINANCIAL_SCHEDULE_PDF_ROW_LIMIT = 20;

export type DraftScheduleMoneyRow = {
  joint: string;
  clientA: string;
  clientB: string;
  notes: string;
};

export type DraftScheduleRepeatableRow = DraftScheduleMoneyRow & {
  description: string;
};

export type DraftScheduleAssetMoneyRow = {
  clientA: string;
  clientB: string;
  notes: string;
};

export type DraftScheduleAssetRepeatableRow = DraftScheduleAssetMoneyRow & {
  description: string;
};

export type DraftScheduleClientRow = {
  clientA: string;
  clientB: string;
  notes: string;
};

export type DraftFinancialSchedulePayload = {
  schemaVersion: number;
  header: {
    ref: string;
    clientNames: string;
    clientAName: string;
    clientBName: string;
    date: string;
  };
  privilegeNotice: string;
  realisableAssets: {
    property: {
      value: DraftScheduleAssetMoneyRow;
      lessMortgage: DraftScheduleAssetMoneyRow;
      lessPenalties: DraftScheduleAssetMoneyRow;
      sellingFeesEstimate: DraftScheduleAssetMoneyRow;
      solicitorFeesEstimate: DraftScheduleAssetMoneyRow;
      equity: DraftScheduleAssetMoneyRow;
    };
    currentAccounts: DraftScheduleAssetRepeatableRow[];
    savingsAccounts: DraftScheduleAssetRepeatableRow[];
    insurancePoliciesOtherInvestments: DraftScheduleAssetRepeatableRow[];
    vehicles: DraftScheduleAssetRepeatableRow[];
    personalBelongings: DraftScheduleAssetRepeatableRow[];
  };
  unrealisableAssets: {
    pensions: {
      joint: string;
      clientA: {
        weeklyEstimate: string;
        monthly: string;
        annual: string;
        startDate: string;
        pensionPerWeek: string;
      };
      clientB: {
        weeklyEstimate: string;
        monthly: string;
        annual: string;
        startDate: string;
        pensionPerWeek: string;
      };
      notes: string;
    };
  };
  liabilities: {
    creditCards: DraftScheduleRepeatableRow[];
    loans: DraftScheduleRepeatableRow[];
    debtManagement: DraftScheduleRepeatableRow[];
  };
  monthlyIncome: {
    salaryGross: DraftScheduleClientRow;
    salaryNet: DraftScheduleClientRow;
    totalGrossPerAnnum: DraftScheduleClientRow;
    totalNetPerAnnum: DraftScheduleClientRow;
    selfAssessmentTaxReturn: DraftScheduleClientRow;
  };
  monthlyExpenditure: {
    accommodation: DraftScheduleClientRow;
    financialCommitments: DraftScheduleClientRow;
    utilities: DraftScheduleClientRow;
    transport: DraftScheduleClientRow;
    householdExpenses: DraftScheduleClientRow;
    personalExpenses: DraftScheduleClientRow;
    recreationalExpenses: DraftScheduleClientRow;
    childrensExpenses: DraftScheduleClientRow;
  };
  finalNotice: string;
};

export type DraftFinancialScheduleSource = {
  caseRef?: string | null;
  clientAName?: string | null;
  clientBName?: string | null;
  currentDate?: string | null;
  clientAAnswers?: Record<string, any> | null;
  clientBAnswers?: Record<string, any> | null;
};

function moneyRow(notes = ""): DraftScheduleMoneyRow {
  return { joint: "", clientA: "", clientB: "", notes };
}

function assetMoneyRow(rowOrNotes: Partial<DraftScheduleAssetMoneyRow> | string = ""): DraftScheduleAssetMoneyRow {
  if (isObject(rowOrNotes)) {
    return {
      clientA: text(rowOrNotes.clientA),
      clientB: text(rowOrNotes.clientB),
      notes: text(rowOrNotes.notes),
    };
  }
  return { clientA: "", clientB: "", notes: text(rowOrNotes) };
}

function clientRow(notes = ""): DraftScheduleClientRow {
  return { clientA: "", clientB: "", notes };
}

function assetRepeatableRow(row: Partial<DraftScheduleAssetRepeatableRow> = {}): DraftScheduleAssetRepeatableRow {
  return {
    description: text(row.description),
    clientA: text(row.clientA),
    clientB: text(row.clientB),
    notes: text(row.notes),
  };
}

function repeatableRow(row: Partial<DraftScheduleRepeatableRow> = {}): DraftScheduleRepeatableRow {
  return {
    description: text(row.description),
    joint: text(row.joint),
    clientA: text(row.clientA),
    clientB: text(row.clientB),
    notes: text(row.notes),
  };
}

export function buildDefaultDraftFinancialSchedulePayload(): DraftFinancialSchedulePayload {
  return {
    schemaVersion: DRAFT_FINANCIAL_SCHEDULE_SCHEMA_VERSION,
    header: { ref: "", clientNames: "", clientAName: "", clientBName: "", date: "" },
    privilegeNotice: DRAFT_FINANCIAL_SCHEDULE_PRIVILEGE_NOTICE,
    realisableAssets: {
      property: {
        value: assetMoneyRow("Purchased, deposit, deeds, equity etc"),
        lessMortgage: assetMoneyRow(),
        lessPenalties: assetMoneyRow(),
        sellingFeesEstimate: assetMoneyRow(),
        solicitorFeesEstimate: assetMoneyRow(),
        equity: assetMoneyRow(),
      },
      currentAccounts: [],
      savingsAccounts: [],
      insurancePoliciesOtherInvestments: [],
      vehicles: [],
      personalBelongings: [],
    },
    unrealisableAssets: {
      pensions: {
        joint: "",
        clientA: { weeklyEstimate: "", monthly: "", annual: "", startDate: "", pensionPerWeek: "" },
        clientB: { weeklyEstimate: "", monthly: "", annual: "", startDate: "", pensionPerWeek: "" },
        notes: "State pension provision https://www.gov.uk/check-state-pension",
      },
    },
    liabilities: {
      creditCards: [],
      loans: [],
      debtManagement: [],
    },
    monthlyIncome: {
      salaryGross: clientRow(),
      salaryNet: clientRow(),
      totalGrossPerAnnum: clientRow(),
      totalNetPerAnnum: clientRow(),
      selfAssessmentTaxReturn: clientRow(),
    },
    monthlyExpenditure: {
      accommodation: clientRow("Client A and Client B understand it is important to continually review their individual monthly expenditures, so any financial settlement options discussed are affordable."),
      financialCommitments: clientRow(),
      utilities: clientRow(),
      transport: clientRow(),
      householdExpenses: clientRow(),
      personalExpenses: clientRow(),
      recreationalExpenses: clientRow(),
      childrensExpenses: clientRow(),
    },
    finalNotice:
      "The need for full financial disclosure has been explained and where supporting documents have been produced this will be set out in an open financial statement in final paperwork if an agreement can be met. It is acknowledged that no independent verification has been undertaken by the mediator as to the accuracy or completeness of the documents provided other than is referred to specifically in this statement",
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function mergeDefaults<T>(defaults: T, incoming: unknown): T {
  if (!isObject(defaults) || !isObject(incoming)) return defaults;
  const output: Record<string, any> = { ...defaults as Record<string, any> };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) output[key] = value;
    else if (isObject(value) && isObject(output[key])) output[key] = mergeDefaults(output[key], value);
    else output[key] = value == null ? output[key] : value;
  }
  return output as T;
}

const ASSET_REPEATABLE_ROW_PATHS = [
  ["realisableAssets", "currentAccounts"],
  ["realisableAssets", "savingsAccounts"],
  ["realisableAssets", "insurancePoliciesOtherInvestments"],
  ["realisableAssets", "vehicles"],
  ["realisableAssets", "personalBelongings"],
] as const;

const MONEY_REPEATABLE_ROW_PATHS = [
  ["liabilities", "creditCards"],
  ["liabilities", "loans"],
  ["liabilities", "debtManagement"],
] as const;

function normalizeAssetRepeatableRows(value: unknown): DraftScheduleAssetRepeatableRow[] {
  if (Array.isArray(value)) {
    return value.map((row) => isObject(row) ? assetRepeatableRow(row) : assetRepeatableRow({ description: row }));
  }
  if (!isObject(value)) return [];
  const row = assetRepeatableRow(value);
  return Object.values(row).some((field) => text(field)) ? [row] : [];
}

function normalizeRepeatableRows(value: unknown): DraftScheduleRepeatableRow[] {
  if (Array.isArray(value)) {
    return value.map((row) => isObject(row) ? repeatableRow(row) : repeatableRow({ description: row }));
  }
  if (!isObject(value)) return [];
  const row = repeatableRow(value);
  return Object.values(row).some((field) => text(field)) ? [row] : [];
}

function getPath(source: Record<string, any>, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => isObject(current) ? current[key] : undefined, source);
}

function setPath<T extends Record<string, any>>(source: T, path: readonly string[], value: unknown): T {
  const [head, ...tail] = path;
  if (!head) return source;
  if (tail.length === 0) return { ...source, [head]: value };
  return {
    ...source,
    [head]: setPath(isObject(source[head]) ? source[head] : {}, tail, value),
  };
}

export function normalizeDraftFinancialSchedulePayload(payload: unknown): DraftFinancialSchedulePayload {
  let merged = mergeDefaults(buildDefaultDraftFinancialSchedulePayload(), payload);
  for (const path of ASSET_REPEATABLE_ROW_PATHS) {
    merged = setPath(merged, path, normalizeAssetRepeatableRows(getPath(merged, path)));
  }
  for (const path of MONEY_REPEATABLE_ROW_PATHS) {
    merged = setPath(merged, path, normalizeRepeatableRows(getPath(merged, path)));
  }
  const property = merged.realisableAssets.property;
  merged = setPath(merged, ["realisableAssets", "property"], {
    value: assetMoneyRow(property.value),
    lessMortgage: assetMoneyRow(property.lessMortgage),
    lessPenalties: assetMoneyRow(property.lessPenalties),
    sellingFeesEstimate: assetMoneyRow(property.sellingFeesEstimate),
    solicitorFeesEstimate: assetMoneyRow(property.solicitorFeesEstimate),
    equity: assetMoneyRow(property.equity),
  });
  return {
    ...merged,
    schemaVersion: DRAFT_FINANCIAL_SCHEDULE_SCHEMA_VERSION,
    privilegeNotice: DRAFT_FINANCIAL_SCHEDULE_PRIVILEGE_NOTICE,
  };
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function money(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const source = text(value).replace(/,/g, "").replace(/[£\s]/g, "");
  if (!source) return 0;
  const parsed = Number(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyText(value: unknown): string {
  const raw = text(value);
  return raw;
}

function setBlank<T extends Record<string, any>>(target: T, path: string[], value: unknown): T {
  const nextValue = text(value);
  if (!nextValue) return target;
  const [head, ...tail] = path;
  if (!head) return target;
  if (tail.length === 0) {
    return text(target[head]) ? target : { ...target, [head]: nextValue };
  }
  return {
    ...target,
    [head]: setBlank(isObject(target[head]) ? target[head] : {}, tail, nextValue),
  };
}

function sumFields(source: Record<string, any> | undefined, fields: string[]): string {
  const total = fields.reduce((sum, key) => sum + money(source?.[key]), 0);
  return total ? String(total) : "";
}

function sumObject(source: Record<string, any> | undefined, excluded = ["total"]): string {
  if (!source) return "";
  const total = Object.entries(source).reduce((sum, [key, value]) => excluded.includes(key) ? sum : sum + money(value), 0);
  return total ? String(total) : "";
}

function repeatableRowsFromSource(
  rows: unknown,
  labelKeys: string[],
  valueKeys: string[],
  side: "clientA" | "clientB",
): DraftScheduleRepeatableRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!isObject(row)) return repeatableRow({ description: text(row) });
      const description = labelKeys.map((key) => text(row[key])).filter(Boolean).join(" ");
      const value = valueKeys.map((key) => moneyText(row[key])).find(Boolean) || "";
      return repeatableRow({ description, [side]: value });
    })
    .filter((row) => Object.values(row).some((field) => text(field)));
}

function assetRepeatableRowsFromSource(
  rows: unknown,
  labelKeys: string[],
  valueKeys: string[],
  side: "clientA" | "clientB",
): DraftScheduleAssetRepeatableRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!isObject(row)) return assetRepeatableRow({ description: text(row) });
      const description = labelKeys.map((key) => text(row[key])).filter(Boolean).join(" ");
      const value = valueKeys.map((key) => moneyText(row[key])).find(Boolean) || "";
      return assetRepeatableRow({ description, [side]: value });
    })
    .filter((row) => Object.values(row).some((field) => text(field)));
}

function sourceCollection(answers: Record<string, any> | null | undefined, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => isObject(current) ? current[key] : undefined, answers || {});
}

function repeatableRowsForSides(
  clientAAnswers: Record<string, any> | null | undefined,
  clientBAnswers: Record<string, any> | null | undefined,
  sourcePath: string[],
  labelKeys: string[],
  valueKeys: string[],
): DraftScheduleRepeatableRow[] {
  return [
    ...repeatableRowsFromSource(sourceCollection(clientAAnswers, sourcePath), labelKeys, valueKeys, "clientA"),
    ...repeatableRowsFromSource(sourceCollection(clientBAnswers, sourcePath), labelKeys, valueKeys, "clientB"),
  ];
}

function assetRepeatableRowsForSides(
  clientAAnswers: Record<string, any> | null | undefined,
  clientBAnswers: Record<string, any> | null | undefined,
  sourcePath: string[],
  labelKeys: string[],
  valueKeys: string[],
): DraftScheduleAssetRepeatableRow[] {
  return [
    ...assetRepeatableRowsFromSource(sourceCollection(clientAAnswers, sourcePath), labelKeys, valueKeys, "clientA"),
    ...assetRepeatableRowsFromSource(sourceCollection(clientBAnswers, sourcePath), labelKeys, valueKeys, "clientB"),
  ];
}

function setRepeatableRowsIfEmpty(
  payload: DraftFinancialSchedulePayload,
  path: readonly string[],
  rows: DraftScheduleRepeatableRow[] | DraftScheduleAssetRepeatableRow[],
): DraftFinancialSchedulePayload {
  if (!rows.length) return payload;
  const isAssetPath = path[0] === "realisableAssets";
  const current = isAssetPath ? normalizeAssetRepeatableRows(getPath(payload, path)) : normalizeRepeatableRows(getPath(payload, path));
  return current.length ? payload : setPath(payload, path, rows);
}

function applyRepeatablePrefill(
  payload: DraftFinancialSchedulePayload,
  source: DraftFinancialScheduleSource,
): DraftFinancialSchedulePayload {
  let next = payload;
  next = setRepeatableRowsIfEmpty(next, ["realisableAssets", "currentAccounts"], assetRepeatableRowsForSides(
    source.clientAAnswers,
    source.clientBAnswers,
    ["c_assets_and_liabilities", "bank_building_society_national_savings"],
    ["name", "type_of_account"],
    ["balance"],
  ));
  next = setRepeatableRowsIfEmpty(next, ["realisableAssets", "savingsAccounts"], assetRepeatableRowsForSides(
    source.clientAAnswers,
    source.clientBAnswers,
    ["c_assets_and_liabilities", "savings_schemes_linked_to_mortgage"],
    ["name_of_company", "type_of_scheme"],
    ["current_surrender_transfer_fund_value", "estimated_maturity_value"],
  ));
  next = setRepeatableRowsIfEmpty(next, ["realisableAssets", "insurancePoliciesOtherInvestments"], [
    ...assetRepeatableRowsForSides(source.clientAAnswers, source.clientBAnswers, ["c_assets_and_liabilities", "insurance_policies"], ["name_of_company", "policy_type"], ["surrender_value", "estimated_maturity_value"]),
    ...assetRepeatableRowsForSides(source.clientAAnswers, source.clientBAnswers, ["c_assets_and_liabilities", "stocks_shares_quoted_securities"], ["name_of_company", "security_type"], ["current_value"]),
    ...assetRepeatableRowsForSides(source.clientAAnswers, source.clientBAnswers, ["c_assets_and_liabilities", "national_savings_certificates"], ["description"], ["current_value"]),
    ...assetRepeatableRowsForSides(source.clientAAnswers, source.clientBAnswers, ["c_assets_and_liabilities", "national_savings_bonds"], ["description"], ["current_value"]),
    ...assetRepeatableRowsForSides(source.clientAAnswers, source.clientBAnswers, ["c_assets_and_liabilities", "other_realisable_assets"], ["description"], ["current_value"]),
  ]);
  next = setRepeatableRowsIfEmpty(next, ["realisableAssets", "vehicles"], assetRepeatableRowsForSides(
    source.clientAAnswers,
    source.clientBAnswers,
    ["c_assets_and_liabilities", "vehicles_over_500"],
    ["description"],
    ["market_value"],
  ));
  next = setRepeatableRowsIfEmpty(next, ["realisableAssets", "personalBelongings"], assetRepeatableRowsForSides(
    source.clientAAnswers,
    source.clientBAnswers,
    ["c_assets_and_liabilities", "valuables_over_500"],
    ["description"],
    ["market_value"],
  ));
  next = setRepeatableRowsIfEmpty(next, ["liabilities", "loans"], repeatableRowsForSides(
    source.clientAAnswers,
    source.clientBAnswers,
    ["c_assets_and_liabilities", "liabilities_apart_from_mortgages"],
    ["nature_of_debt"],
    ["outstanding_amount"],
  ));
  return next;
}

function pensionSummary(pensions: unknown): { annual: string; notes: string } {
  const rows = Array.isArray(pensions) ? pensions : isObject(pensions) ? [pensions] : [];
  const total = rows.reduce((sum, row) => isObject(row) ? sum + money(row.cetv_ceb_valuation) : sum, 0);
  const notes = rows
    .map((row) => isObject(row) ? text(row.payment_drawdown_deferment_status || row.scheme_type || row.name_address_arrangement) : "")
    .filter(Boolean)
    .join("\n");
  return { annual: total ? String(total) : "", notes };
}

function applySidePrefill(payload: DraftFinancialSchedulePayload, side: "clientA" | "clientB", answers: Record<string, any> | null | undefined) {
  if (!answers) return payload;
  const a1 = answers.a1_monthly_income_employment_self_employment || {};
  const c = answers.c_assets_and_liabilities || {};
  const home = c.family_home || {};
  const b = answers.b_monthly_expenditure || {};
  const pension = pensionSummary(c.pensions);
  const gross = sumFields(a1, ["main_salary_wages_gross", "other_earnings", "overtime_bonus_commission"]);
  const deductions = sumFields(a1, ["less_national_insurance", "income_tax", "pension_contributions_private_plan", "other_deductions"]);
  const net = gross ? String(money(gross) - money(deductions)) : "";
  const grossAnnual = gross ? String(money(gross) * 12) : "";
  const netAnnual = net ? String(money(net) * 12) : "";

  let next = payload;
  next = setBlank(next, ["realisableAssets", "property", "value", side], home.current_value);
  next = setBlank(next, ["realisableAssets", "property", "lessMortgage", side], sumFields(home, ["less_mortgage_1", "less_mortgage_2"]));
  next = setBlank(next, ["realisableAssets", "property", "lessPenalties", side], home.less_penalties_if_sold_now);
  next = setBlank(next, ["realisableAssets", "property", "sellingFeesEstimate", side], home.estimated_sales_costs);
  next = setBlank(next, ["realisableAssets", "property", "equity", side], home.net_equity);
  next = setBlank(next, ["unrealisableAssets", "pensions", side, "annual"], pension.annual);
  next = setBlank(next, ["unrealisableAssets", "pensions", "notes"], pension.notes);
  next = setBlank(next, ["monthlyIncome", "salaryGross", side], gross);
  next = setBlank(next, ["monthlyIncome", "salaryNet", side], net);
  next = setBlank(next, ["monthlyIncome", "totalGrossPerAnnum", side], grossAnnual);
  next = setBlank(next, ["monthlyIncome", "totalNetPerAnnum", side], netAnnual);
  next = setBlank(next, ["monthlyExpenditure", "accommodation", side], sumObject(b.accommodation));
  next = setBlank(next, ["monthlyExpenditure", "financialCommitments", side], sumObject(b.financial_commitments));
  next = setBlank(next, ["monthlyExpenditure", "utilities", side], sumObject(b.utilities));
  next = setBlank(next, ["monthlyExpenditure", "transport", side], sumObject(b.transport));
  next = setBlank(next, ["monthlyExpenditure", "householdExpenses", side], sumObject(b.household_expenses));
  next = setBlank(next, ["monthlyExpenditure", "personalExpenses", side], sumObject(b.personal_expenses));
  next = setBlank(next, ["monthlyExpenditure", "recreationalExpenses", side], sumObject(b.recreational_expenses));
  const childrens = b.childrens_expenses || {};
  const childrenTotal = ["childcare", "recreation", "education", "personal_care"].reduce((sum, key) => sum + money(sumObject(childrens[key])), 0);
  next = setBlank(next, ["monthlyExpenditure", "childrensExpenses", side], childrenTotal ? String(childrenTotal) : "");
  return next;
}

export function applyDraftFinancialSchedulePrefill(
  payload: DraftFinancialSchedulePayload | Record<string, unknown> | null | undefined,
  source: DraftFinancialScheduleSource,
): DraftFinancialSchedulePayload {
  let next = normalizeDraftFinancialSchedulePayload(payload);
  next = setBlank(next, ["header", "ref"], source.caseRef);
  next = setBlank(next, ["header", "clientNames"], [source.clientAName, source.clientBName].filter(Boolean).join(" and "));
  next = setBlank(next, ["header", "clientAName"], source.clientAName);
  next = setBlank(next, ["header", "clientBName"], source.clientBName);
  next = setBlank(next, ["header", "date"], source.currentDate);
  next = applySidePrefill(next, "clientA", source.clientAAnswers);
  next = applySidePrefill(next, "clientB", source.clientBAnswers);
  next = applyRepeatablePrefill(next, source);
  return normalizeDraftFinancialSchedulePayload(next);
}

function flatten(prefix: string, value: unknown, output: Record<string, string>) {
  if (Array.isArray(value)) {
    output[prefix] = value
      .map((entry) => isObject(entry)
        ? [
          entry.description,
          Object.prototype.hasOwnProperty.call(entry, "joint") ? entry.joint : undefined,
          entry.clientA,
          entry.clientB,
          entry.notes,
        ].filter((item, index) => index !== 1 || Object.prototype.hasOwnProperty.call(entry, "joint")).map(text).join(" | ")
        : text(entry))
      .filter(Boolean)
      .join("\n");
    return;
  }
  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) flatten(prefix ? `${prefix}.${key}` : key, nested, output);
    return;
  }
  output[prefix] = text(value);
}

export function flattenDraftFinancialScheduleTemplateData(payload: DraftFinancialSchedulePayload | Record<string, unknown> | null | undefined): Record<string, string> {
  const normalized = normalizeDraftFinancialSchedulePayload(payload);
  const output: Record<string, string> = {};
  flatten("", normalized, output);
  delete output[""];
  return output;
}

function addPrefixedScalars(source: Record<string, string>, output: Record<string, string>) {
  for (const [key, value] of Object.entries(source)) {
    output[`draftFinancialSchedule.${key}`] = value;
  }
}

function addRepeatablePdfRows(
  output: Record<string, string>,
  prefix: string,
  rows: DraftScheduleRepeatableRow[] | DraftScheduleAssetRepeatableRow[],
  includeJoint = true,
) {
  rows.slice(0, DRAFT_FINANCIAL_SCHEDULE_PDF_ROW_LIMIT).forEach((row, index) => {
    const rowNumber = index + 1;
    output[`${prefix}.${rowNumber}.description`] = row.description;
    if (includeJoint && "joint" in row) output[`${prefix}.${rowNumber}.joint`] = text(row.joint);
    output[`${prefix}.${rowNumber}.clientA`] = row.clientA;
    output[`${prefix}.${rowNumber}.clientB`] = row.clientB;
    output[`${prefix}.${rowNumber}.notes`] = row.notes;
  });
}

export function buildDraftFinancialSchedulePdfTemplateData(
  payload: DraftFinancialSchedulePayload | Record<string, unknown> | null | undefined,
): Record<string, string> {
  const normalized = normalizeDraftFinancialSchedulePayload(payload);
  const output: Record<string, string> = {};
  addPrefixedScalars(flattenDraftFinancialScheduleTemplateData(normalized), output);
  addRepeatablePdfRows(output, "draftFinancialSchedule.realisableAssets.currentAccounts", normalized.realisableAssets.currentAccounts, false);
  addRepeatablePdfRows(output, "draftFinancialSchedule.realisableAssets.savingsAccounts", normalized.realisableAssets.savingsAccounts, false);
  addRepeatablePdfRows(output, "draftFinancialSchedule.realisableAssets.insurancePoliciesOtherInvestments", normalized.realisableAssets.insurancePoliciesOtherInvestments, false);
  addRepeatablePdfRows(output, "draftFinancialSchedule.realisableAssets.vehicles", normalized.realisableAssets.vehicles, false);
  addRepeatablePdfRows(output, "draftFinancialSchedule.realisableAssets.personalBelongings", normalized.realisableAssets.personalBelongings, false);
  addRepeatablePdfRows(output, "draftFinancialSchedule.liabilities.creditCards", normalized.liabilities.creditCards);
  addRepeatablePdfRows(output, "draftFinancialSchedule.liabilities.loans", normalized.liabilities.loans);
  addRepeatablePdfRows(output, "draftFinancialSchedule.liabilities.debtManagement", normalized.liabilities.debtManagement);
  return output;
}
