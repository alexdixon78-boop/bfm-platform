export const FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA_VERSION = 1;

export const DISCLOSURE_BOOKLET_PROGRESS_STATUSES = ["not_started", "in_progress", "completed", "submitted"] as const;
export type DisclosureBookletProgressStatus = typeof DISCLOSURE_BOOKLET_PROGRESS_STATUSES[number];

export type DisclosureBookletFieldType = "currency" | "text" | "number" | "date" | "document_status";

export type DisclosureBookletField = {
  key: string;
  label: string;
  type: DisclosureBookletFieldType;
  calculated?: boolean;
};

export type DisclosureBookletSection = {
  key: string;
  title: string;
  fields?: DisclosureBookletField[];
  subsections?: Array<{
    key: string;
    title: string;
    fields?: DisclosureBookletField[];
    columns?: DisclosureBookletField[];
    repeatable?: boolean;
    subsections?: Array<{
      key: string;
      title: string;
      fields: DisclosureBookletField[];
    }>;
    totalField?: DisclosureBookletField;
  }>;
  summaryFields?: DisclosureBookletField[];
};

export type DisclosureBookletPayload = {
  bookletSchemaVersion: number;
  answers: Record<string, any>;
  progress: Record<string, {
    status: DisclosureBookletProgressStatus;
    updatedAt: string | null;
    submittedAt?: string | null;
    submittedBy?: string | null;
  }>;
  staffAnnotations: Record<string, { note: string; flagged: boolean; updatedAt: string | null; updatedBy: string | null }>;
  legacyNotes?: {
    clientNotes?: string;
    sections?: Record<string, string>;
  };
};

export type DisclosureSourcePrefill = {
  address?: string | null;
  nationalInsuranceNumber?: string | null;
};

function currencyField(key: string, label: string, calculated = false): DisclosureBookletField {
  return { key, label, type: "currency", calculated };
}

function textField(key: string, label: string): DisclosureBookletField {
  return { key, label, type: "text" };
}

function dateField(key: string, label: string): DisclosureBookletField {
  return { key, label, type: "date" };
}

export const FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA: DisclosureBookletSection[] = [
  {
    key: "a1_monthly_income_employment_self_employment",
    title: "A1 Monthly Income From Employment & Self Employment",
    fields: [
      currencyField("main_salary_wages_gross", "Main salary/wages (gross)"),
      currencyField("other_earnings", "Any other earnings"),
      currencyField("overtime_bonus_commission", "Overtime/Bonus/commission (not included in above)"),
      currencyField("less_national_insurance", "LESS National Insurance"),
      currencyField("income_tax", "Income Tax"),
      currencyField("pension_contributions_private_plan", "Pension Contributions/Private Plan"),
      currencyField("other_deductions", "Other - please specify (e.g. Union Sub.)"),
      currencyField("total_deductions", "TOTAL DEDUCTIONS", true),
      currencyField("net_income_from_employment", "Net income from employment", true),
      currencyField("self_employed_drawings", "OR If SELF EMPLOYED - drawings (provide latest accounts)"),
    ],
  },
  {
    key: "a2_other_income",
    title: "A2 Other Income",
    fields: [
      currencyField("child_benefit", "Child Benefit"),
      currencyField("working_tax_credit", "Working Tax Credit (if not paid with wages)"),
      currencyField("child_tax_credit", "Child Tax Credit"),
      currencyField("child_support_previous_partner", "Child Support from any previous partner"),
      currencyField("dividends_or_interest_received", "Dividends or Interest Received"),
      currencyField("income_from_property", "Income from Property"),
      currencyField("income_from_trusts_shares_pension", "Income from Trusts & Shares and any Pension"),
      currencyField("other_income", "Other income from any source, e.g. fees, casual payments"),
      currencyField("total_other_income", "TOTAL", true),
      currencyField("less_likely_tax_liability", "LESS likely tax liability"),
      currencyField("total_net_monthly_income", "TOTAL NET MONTHLY INCOME", true),
    ],
  },
  {
    key: "b_monthly_expenditure",
    title: "B Monthly Expenditure",
    summaryFields: [
      currencyField("accommodation", "Accommodation", true),
      currencyField("financial_commitments", "Financial commitments", true),
      currencyField("utilities", "Utilities", true),
      currencyField("transport", "Transport", true),
      currencyField("household_expenses", "Household expenses", true),
      currencyField("personal_expenses", "Personal expenses", true),
      currencyField("recreational_expenses", "Recreational expenses", true),
      currencyField("childrens_expenses", "Children's expenses", true),
    ],
    subsections: [
      {
        key: "accommodation",
        title: "1. Accommodation",
        fields: [
          currencyField("mortgage_rent_service_charge", "Mortgage/rent/service charge"),
          currencyField("pension_endowments_linked_to_mortgage", "Pension/endowments (linked to mortgage)"),
          currencyField("building_contents_insurance", "Building & contents insurance"),
          currencyField("repairs_decorating_maintenance", "Repairs/decorating/maintenance"),
          currencyField("other", "Other (please specify)"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "financial_commitments",
        title: "2. Financial Commitments",
        fields: [
          currencyField("bank_other_loan_repayments", "Bank & other loan repayments"),
          currencyField("hp_finance_houses", "HP & Finance Houses"),
          currencyField("clubs_mail_order_catalogues", "Clubs/mail order catalogues"),
          currencyField("credit_store_cards", "Credit & Store cards"),
          currencyField("pension_contributions_not_included_in_pay", "Pension contributions (not included in pay)"),
          currencyField("other_insurance", "Other insurance (e.g. medical, life - specify)"),
          currencyField("regular_savings_or_investments", "Any regular savings or investments"),
          currencyField("maintenance_previous_partner", "Maintenance to previous partner"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "utilities",
        title: "3. Utilities",
        fields: [
          currencyField("council_tax", "Council Tax"),
          currencyField("water_sewerage_rates", "Water/sewerage rates"),
          currencyField("gas_oil_solid_fuel", "Gas/oil/Solid fuel"),
          currencyField("electricity", "Electricity"),
          currencyField("telephone", "Telephone"),
          currencyField("mobile_phone", "Mobile Phone"),
          currencyField("tv_licence", "TV licence"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "transport",
        title: "4. Transport",
        fields: [
          currencyField("vehicle_repayments", "Vehicle repayments"),
          currencyField("insurance_road_tax", "Insurance/road tax"),
          currencyField("servicing_repairs_mot", "Servicing/repairs & MOT"),
          currencyField("breakdown_cover", "AA/RAC/breakdown"),
          currencyField("petrol_parking", "Petrol/Parking"),
          currencyField("public_transport", "Public Transport"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "household_expenses",
        title: "5. Household Expenses",
        fields: [
          currencyField("food_milk_general_house", "Food/milk/general house"),
          currencyField("vet_bills", "Vet bills etc"),
          currencyField("domestic_window_cleaning_gardening", "Domestic/window cleaning/gardening"),
          currencyField("dry_cleaning_laundry_shoe_repairs", "Dry cleaning/laundry/shoe repairs"),
          currencyField("tv_video_recorder_rental", "TV/video recorder rental"),
          currencyField("satellite_cable_internet_subscriptions", "Satellite/Cable/internet subscriptions"),
          currencyField("other", "Other (please specify)"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "personal_expenses",
        title: "6. Personal Expenses",
        fields: [
          currencyField("clothes_for_self", "Clothes (for self)"),
          currencyField("hair_toiletries_cosmetics", "Hair/toiletries/cosmetics"),
          currencyField("newspaper_magazine", "Newspaper/magazine"),
          currencyField("dental_optician", "Dental/optician"),
          currencyField("other_health_expenses", "Other health expenses"),
          currencyField("tobacco_alcohol", "Tobacco/alcohol"),
          currencyField("meals_at_work", "Meals at work"),
          currencyField("presents_christmas_birthdays", "Presents (Christmas/birthdays)"),
          currencyField("charitable_giving", "Charitable giving"),
          currencyField("stationery_postage", "Stationery/postage"),
          currencyField("other", "Other (please specify)"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "recreational_expenses",
        title: "7. Recreation",
        fields: [
          currencyField("holidays_outings", "Holidays/outings"),
          currencyField("sports_hobbies", "Sports/hobbies"),
          currencyField("cinema_theatre_concerts_video", "Cinema/theatre/concerts/video"),
          currencyField("meals_out_entertaining", "Meals out/entertaining"),
          currencyField("other", "Other (please specify)"),
          currencyField("total", "Total", true),
        ],
      },
      {
        key: "childrens_expenses",
        title: "8. Children's Expenses",
        subsections: [
          { key: "childcare", title: "Childcare", fields: [currencyField("child_care", "Child care"), currencyField("babysitting", "Babysitting"), currencyField("nursery_playgroup", "Nursery/playgroup"), currencyField("childminder_nanny", "Childminder/nanny"), currencyField("other", "Other (please specify)"), currencyField("total", "Total", true)] },
          { key: "recreation", title: "Recreation", fields: [currencyField("clothes_shoes", "Clothes/shoes"), currencyField("clubs_groups", "Clubs/groups"), currencyField("equipment_lessons", "Equipment/lessons (e.g. sport, music)"), currencyField("pocket_money_allowance", "Pocket money/allowance"), currencyField("other", "Other (please specify)"), currencyField("total", "Total", true)] },
          { key: "education", title: "Education", fields: [currencyField("travel_to_school", "Travel to school"), currencyField("school_meals", "School meals"), currencyField("school_trips", "School trips"), currencyField("school_uniform_sports_gear", "School Uniform/sports gear"), currencyField("school_college_fees", "School & college fees"), currencyField("extra_tuition", "Extra tuition"), currencyField("support_students_further_higher_education", "Support to students in Further and/or Higher Education"), currencyField("total", "Total", true)] },
          { key: "personal_care", title: "Personal Care", fields: [currencyField("nappies", "Nappies"), currencyField("toiletries_hairdresser", "Toiletries/hairdresser"), currencyField("total", "Total", true)] },
        ],
        totalField: currencyField("total_childrens_expenses", "Total Children's Expenses", true),
      },
    ],
  },
  {
    key: "c_assets_and_liabilities",
    title: "C Assets and Liabilities",
    subsections: [
      { key: "family_home", title: "1. The Family Home", fields: [textField("address", "Address"), dateField("date_of_purchase", "Date of Purchase"), textField("joint_sole_ownership", "Joint/sole ownership"), currencyField("deposit", "Deposit"), textField("freehold_leasehold", "Freehold/Leasehold"), currencyField("purchase_price", "Purchase price"), dateField("date_of_valuation", "Date of valuation"), currencyField("current_value", "Current Value"), currencyField("less_mortgage_1", "Less mortgage 1"), currencyField("less_mortgage_2", "Less mortgage 2"), currencyField("less_penalties_if_sold_now", "Less penalties under mortgage if sold now"), currencyField("estimated_sales_costs", "Estimated Sales Costs"), currencyField("net_equity", "NET EQUITY", true), textField("type_of_mortgage_1", "Type of mortgage 1"), textField("type_of_mortgage_2", "Type of mortgage 2"), textField("mortgage_company_1", "Name and address of mortgage company/ies 1"), textField("mortgage_company_2", "Name and address of mortgage company/ies 2")] },
      { key: "other_properties", title: "2. Other properties - land or buildings", repeatable: true, fields: [textField("address", "Address"), dateField("date_of_purchase", "Date of Purchase"), textField("joint_sole_ownership", "Joint/sole ownership"), currencyField("deposit", "Deposit"), textField("freehold_leasehold", "Freehold/Leasehold"), currencyField("purchase_price", "Purchase price"), dateField("date_of_valuation", "Date of valuation"), currencyField("current_value", "Current Value"), currencyField("less_mortgage_1", "Less mortgage 1"), currencyField("less_mortgage_2", "Less mortgage 2"), currencyField("less_penalties_if_sold_now", "Less penalties under mortgage if sold now"), currencyField("estimated_sales_costs", "Estimated Sales Costs"), currencyField("net_equity", "NET EQUITY", true), textField("type_of_mortgage_1", "Type of mortgage 1"), textField("type_of_mortgage_2", "Type of mortgage 2"), textField("mortgage_company_1", "Name and address of mortgage company/ies 1"), textField("mortgage_company_2", "Name and address of mortgage company/ies 2")] },
      { key: "savings_schemes_linked_to_mortgage", title: "3. Savings schemes linked to mortgage", repeatable: true, columns: [textField("name_of_company", "Name of company"), textField("type_of_scheme", "Type of scheme"), textField("joint_sole_names", "In joint/sole names"), dateField("maturity_date", "Maturity date"), currencyField("estimated_maturity_value", "Estimated maturity value"), currencyField("sum_assured", "Sum assured"), currencyField("current_surrender_transfer_fund_value", "Current surrender/transfer/fund value"), dateField("date", "Date")] },
      { key: "bank_building_society_national_savings", title: "4. Bank, Building Society, National Savings accounts", repeatable: true, columns: [textField("name", "Name of Bank, Building Society, Other"), textField("last_four_account_no", "Last four figures of account no."), textField("type_of_account", "Type of account"), textField("joint_sole_names", "In joint/sole names"), currencyField("balance", "Balance"), dateField("date", "Date")] },
      { key: "stocks_shares_quoted_securities", title: "5. Stocks, shares & quoted securities", repeatable: true, columns: [textField("name_of_holding", "Name of holding"), textField("type_of_holding", "Type of holding"), textField("number_size", "Number/size"), textField("joint_sole_names", "In joint/sole names"), currencyField("current_value", "Current value"), dateField("date", "Date")] },
      { key: "national_savings_certificates", title: "5. National Savings certificates", repeatable: true, columns: [textField("name_of_issue", "Name of Issue"), currencyField("nominal_amount", "Nominal amount"), textField("joint_sole_names", "In joint/sole names"), currencyField("current_value", "Current value"), dateField("date", "Date")] },
      { key: "national_savings_bonds", title: "5. National Savings Bonds, including premium bonds", repeatable: true, columns: [textField("type_of_bond", "Type of Bond"), textField("bondholder_no", "Bondholder's no."), textField("joint_sole_names", "In joint/sole names"), currencyField("current_value", "Current value"), dateField("date", "Date")] },
      { key: "insurance_policies", title: "6. Insurance policies, including those with no surrender value", repeatable: true, columns: [textField("name_of_company", "Name of Company"), textField("policy_number", "Policy number"), textField("policy_type", "Policy Type"), textField("life_assured", "Life assured"), currencyField("estimated_maturity_value", "Estimated maturity value"), dateField("maturity_date", "Maturity date"), currencyField("surrender_value", "Surrender value")] },
      { key: "money_owed_to_you", title: "7. Money owed to you", repeatable: true, columns: [textField("description", "Description of all sums owed to you"), textField("joint_sole", "Joint/sole"), currencyField("amount", "Amount")] },
      { key: "cash_over_500", title: "8. Cash over £500 not included anywhere above", repeatable: true, columns: [textField("where_held", "Where it is held"), textField("joint_sole", "Joint/sole"), textField("currency", "Currency"), currencyField("amount", "Amount")] },
      { key: "vehicles_over_500", title: "9. Cars, boats, caravans and other vehicles worth more than £500", repeatable: true, columns: [textField("description", "Description"), textField("joint_sole", "Joint/sole"), currencyField("market_value", "Market Value")] },
      { key: "valuables_over_500", title: "10. Valuables including furniture, antiques, jewellery, pictures, house contents worth more than £500", repeatable: true, columns: [textField("description", "Description"), textField("joint_sole", "Joint/sole"), currencyField("market_value", "Market Value")] },
      { key: "other_realisable_assets", title: "11. Other realisable assets", repeatable: true, columns: [textField("type_of_asset", "Type of asset"), currencyField("value", "Value")] },
      { key: "business_interests", title: "12. Business interests", repeatable: true, columns: [textField("name_and_nature", "Name and Nature of Business"), textField("basis_of_valuation", "Basis of Valuation"), currencyField("current_value_estimate", "Your estimate of current value"), currencyField("sums_owed_to_you", "Total amount owed to you by directors loan/partnership/current account")] },
      { key: "liabilities_apart_from_mortgages", title: "13. Any liabilities apart from mortgages", repeatable: true, columns: [textField("nature_of_debt", "Nature of debts and to whom owed"), currencyField("outstanding_amount", "Outstanding amount")] },
      { key: "capital_gains_tax_liability", title: "14. Capital Gains Tax liability", repeatable: true, columns: [textField("asset", "Asset"), currencyField("estimated_capital_gains_tax", "Estimated Capital Gains Tax")] },
      { key: "pensions", title: "15. Pensions", repeatable: true, fields: [textField("name_address_arrangement", "Name & address of pension arrangement"), textField("national_insurance_number", "Your National Insurance Number"), textField("arrangement_reference_number", "Number of pension arrangement or reference number"), textField("scheme_type", "Type of scheme"), dateField("cetv_calculated_date", "Date the CETV was calculated"), textField("payment_drawdown_deferment_status", "Is the pension in payment or drawdown or deferment?"), currencyField("cetv_ceb_valuation", "CETV/CEB/valuation details"), currencyField("total_pension_assets", "Total value of ALL your pension assets", true)] },
      { key: "new_partner_finances", title: "16. Subsequent marriage/civil partnership/cohabitation details", fields: [textField("annual_income_nature", "Annual income - nature"), currencyField("annual_income_value", "Annual income - value"), textField("assets_liabilities_item", "Assets and liabilities - item"), currencyField("assets_liabilities_value", "Assets and liabilities - value"), currencyField("total_income", "Total Income", true), currencyField("total_assets_liabilities", "Total Assets/liabilities", true)] },
    ],
  },
  {
    key: "document_checklist",
    title: "Documents Produced In Mediation - Checklist",
    fields: [
      { key: "matrimonial_home_valuation", label: "Matrimonial home valuation", type: "document_status" },
      { key: "matrimonial_home_mortgage", label: "Matrimonial home mortgage(s)", type: "document_status" },
      { key: "other_property_valuation", label: "Any other property valuation", type: "document_status" },
      { key: "other_property_mortgage", label: "Any other property mortgage", type: "document_status" },
      { key: "personal_bank_building_society_national_savings", label: "Personal bank, building society and National Savings accounts", type: "document_status" },
      { key: "other_investments", label: "Other investments", type: "document_status" },
      { key: "life_insurance_policies", label: "Life insurance (including endowment) policies", type: "document_status" },
      { key: "business_accounts", label: "Business interests - accounts", type: "document_status" },
      { key: "business_valuation", label: "Business interests - valuation evidence", type: "document_status" },
      { key: "pension_rights", label: "Pension rights CETV statement/request letter", type: "document_status" },
      { key: "p60", label: "Employment income - P60", type: "document_status" },
      { key: "payslips", label: "Employment income - last three payslips", type: "document_status" },
      { key: "p11d", label: "Employment income - P11D", type: "document_status" },
      { key: "tax_assessment", label: "Self-employment or partnership income - tax assessment/accountant letter", type: "document_status" },
      { key: "management_accounts", label: "Self-employment or partnership income - management accounts", type: "document_status" },
      textField("other_documents_description", "Description of other documents attached"),
      { key: "application_to_vary_order", label: "Application to vary an order", type: "document_status" },
    ],
  },
];

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function money(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/,/g, "").replace(/[£\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function blankFields(fields: DisclosureBookletField[] | undefined): Record<string, string> {
  return (fields || []).reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = "";
    return acc;
  }, {});
}

function defaultAnswers(): Record<string, any> {
  const answers: Record<string, any> = {};
  for (const section of FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA) {
    if (section.fields) answers[section.key] = blankFields(section.fields);
    if (section.summaryFields) answers[section.key] = { ...(answers[section.key] || {}), summary: blankFields(section.summaryFields) };
    for (const subsection of section.subsections || []) {
      answers[section.key] ||= {};
      if (subsection.repeatable) {
        answers[section.key][subsection.key] = [];
      } else if (subsection.subsections) {
        answers[section.key][subsection.key] = {};
        for (const child of subsection.subsections) {
          answers[section.key][subsection.key][child.key] = blankFields(child.fields);
        }
      } else {
        answers[section.key][subsection.key] = blankFields(subsection.fields || subsection.columns);
      }
    }
  }
  return answers;
}

function defaultProgress(): DisclosureBookletPayload["progress"] {
  return FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA.reduce<DisclosureBookletPayload["progress"]>((acc, section) => {
    acc[section.key] = { status: "not_started", updatedAt: null, submittedAt: null, submittedBy: null };
    return acc;
  }, {});
}

function mergeAnswers(base: Record<string, any>, incoming: unknown): Record<string, any> {
  if (!isObject(incoming)) return base;
  const merged = { ...base };
  for (const [sectionKey, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) merged[sectionKey] = value;
    else if (isObject(value) && isObject(merged[sectionKey])) merged[sectionKey] = mergeAnswers(merged[sectionKey], value);
    else merged[sectionKey] = value;
  }
  return merged;
}

function legacyNotesFrom(payload: Record<string, any>): DisclosureBookletPayload["legacyNotes"] | undefined {
  const clientNotes = typeof payload.clientNotes === "string" && payload.clientNotes.trim() ? payload.clientNotes : undefined;
  const sections = Array.isArray(payload.sections)
    ? payload.sections.reduce<Record<string, string>>((acc, section) => {
      if (typeof section?.key === "string" && typeof section?.notes === "string" && section.notes.trim()) acc[section.key] = section.notes;
      return acc;
    }, {})
    : undefined;
  if (!clientNotes && (!sections || Object.keys(sections).length === 0)) return payload.legacyNotes;
  return { ...(isObject(payload.legacyNotes) ? payload.legacyNotes : {}), clientNotes, sections };
}

export function ensureFieldBasedBookletPayload(payload: Record<string, unknown> | null | undefined): DisclosureBookletPayload {
  const existing = isObject(payload) ? payload as Record<string, any> : {};
  const progress = { ...defaultProgress(), ...(isObject(existing.progress) ? existing.progress : {}) };
  for (const section of FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA) {
    const current = progress[section.key];
    progress[section.key] = {
      status: DISCLOSURE_BOOKLET_PROGRESS_STATUSES.includes(current?.status) ? current.status : "not_started",
      updatedAt: typeof current?.updatedAt === "string" ? current.updatedAt : null,
      submittedAt: typeof current?.submittedAt === "string" ? current.submittedAt : null,
      submittedBy: typeof current?.submittedBy === "string" ? current.submittedBy : null,
    };
  }

  return {
    bookletSchemaVersion: FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA_VERSION,
    answers: mergeAnswers(defaultAnswers(), existing.answers),
    progress,
    staffAnnotations: isObject(existing.staffAnnotations) ? existing.staffAnnotations : {},
    legacyNotes: legacyNotesFrom(existing),
  };
}

function setBlankAnswerValue(source: Record<string, any>, path: string[], value: unknown): Record<string, any> {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return source;
  const [head, ...tail] = path;
  if (!head) return source;
  const current = source[head];
  if (tail.length === 0) {
    return current === null || current === undefined || String(current).trim() === ""
      ? { ...source, [head]: text }
      : source;
  }
  return {
    ...source,
    [head]: setBlankAnswerValue(isObject(current) ? current : {}, tail, text),
  };
}

export function applyDisclosureSourcePrefill(
  payload: DisclosureBookletPayload | Record<string, unknown> | null | undefined,
  source: DisclosureSourcePrefill,
): DisclosureBookletPayload {
  const normalized = ensureFieldBasedBookletPayload(payload as Record<string, unknown>);
  let answers = normalized.answers;
  answers = setBlankAnswerValue(answers, ["c_assets_and_liabilities", "family_home", "address"], source.address);
  answers = setBlankAnswerValue(answers, ["c_assets_and_liabilities", "pensions", "national_insurance_number"], source.nationalInsuranceNumber);
  return { ...normalized, answers };
}

function sumObjectCurrency(section: Record<string, unknown>, exclude: string[] = ["total"]): number {
  return Object.entries(section).reduce((total, [key, value]) => exclude.includes(key) ? total : total + money(value), 0);
}

export function calculateDisclosureBookletTotals(answers: Record<string, any>) {
  const a1 = answers.a1_monthly_income_employment_self_employment || {};
  const a1Gross = money(a1.main_salary_wages_gross) + money(a1.other_earnings) + money(a1.overtime_bonus_commission);
  const totalDeductions = money(a1.less_national_insurance) + money(a1.income_tax) + money(a1.pension_contributions_private_plan) + money(a1.other_deductions);
  const a2 = answers.a2_other_income || {};
  const totalOtherIncome = ["child_benefit", "working_tax_credit", "child_tax_credit", "child_support_previous_partner", "dividends_or_interest_received", "income_from_property", "income_from_trusts_shares_pension", "other_income"].reduce((total, key) => total + money(a2[key]), 0);
  const b = answers.b_monthly_expenditure || {};
  const childrens = b.childrens_expenses || {};
  const childrenSubtotals = {
    childcare: sumObjectCurrency(childrens.childcare || {}),
    recreation: sumObjectCurrency(childrens.recreation || {}),
    education: sumObjectCurrency(childrens.education || {}),
    personal_care: sumObjectCurrency(childrens.personal_care || {}),
  };
  return {
    a1: {
      total_deductions: totalDeductions,
      net_income_from_employment: a1Gross - totalDeductions,
    },
    a2: {
      total_other_income: totalOtherIncome,
      total_net_monthly_income: totalOtherIncome - money(a2.less_likely_tax_liability),
    },
    b: {
      accommodation: sumObjectCurrency(b.accommodation || {}),
      financial_commitments: sumObjectCurrency(b.financial_commitments || {}),
      utilities: sumObjectCurrency(b.utilities || {}),
      transport: sumObjectCurrency(b.transport || {}),
      household_expenses: sumObjectCurrency(b.household_expenses || {}),
      personal_expenses: sumObjectCurrency(b.personal_expenses || {}),
      recreational_expenses: sumObjectCurrency(b.recreational_expenses || {}),
      childrens_expenses: Object.values(childrenSubtotals).reduce((total, value) => total + value, 0),
      childrenSubtotals,
    },
  };
}

type CombinedParty = { partyId: string; clientName: string; payload: DisclosureBookletPayload };

function answerAt(answers: Record<string, any>, path: string[]): unknown {
  return path.reduce<any>((current, key) => current?.[key], answers);
}

export function buildCombinedDisclosureBookletView(input: { clientA?: CombinedParty | null; clientB?: CombinedParty | null }) {
  const sections = FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA.map((section) => {
    const fields = (section.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      clientA: { value: answerAt(input.clientA?.payload.answers || {}, [section.key, field.key]) ?? "" },
      clientB: { value: answerAt(input.clientB?.payload.answers || {}, [section.key, field.key]) ?? "" },
    }));
    return { key: section.key, title: section.title, fields, subsections: section.subsections || [], summaryFields: section.summaryFields || [] };
  });
  return {
    schemaVersion: FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA_VERSION,
    clientA: input.clientA ? { partyId: input.clientA.partyId, clientName: input.clientA.clientName } : null,
    clientB: input.clientB ? { partyId: input.clientB.partyId, clientName: input.clientB.clientName } : null,
    answerPayloads: {
      clientA: input.clientA?.payload.answers || {},
      clientB: input.clientB?.payload.answers || {},
    },
    sections,
    totals: {
      clientA: calculateDisclosureBookletTotals(input.clientA?.payload.answers || {}),
      clientB: calculateDisclosureBookletTotals(input.clientB?.payload.answers || {}),
    },
  };
}

function flattenObject(prefix: string, value: unknown, output: Record<string, string>): void {
  if (Array.isArray(value)) {
    output[prefix] = value.map((row) => isObject(row) ? Object.values(row).join(" | ") : String(row ?? "")).join("\n");
    return;
  }
  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) flattenObject(`${prefix}.${key}`, nested, output);
    return;
  }
  output[prefix] = value == null ? "" : String(value);
}

export function flattenDisclosureBookletTemplateData(combined: ReturnType<typeof buildCombinedDisclosureBookletView>): Record<string, string> {
  const output: Record<string, string> = {
    schemaVersion: String(combined.schemaVersion),
    "clientA.name": combined.clientA?.clientName || "",
    "clientB.name": combined.clientB?.clientName || "",
  };
  for (const side of ["clientA", "clientB"] as const) {
    flattenObject(side, combined.answerPayloads[side], output);
    for (const section of FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA) {
      const fields = section.fields || [];
      for (const field of fields) {
        const value = fields.find((f) => f.key === field.key) && combined.sections.find((s) => s.key === section.key)?.fields.find((f) => f.key === field.key)?.[side].value;
        output[`${side}.${section.key}.${field.key}`] = value == null ? "" : String(value);
      }
    }
    flattenObject(`${side}.totals`, combined.totals[side], output);
  }
  return output;
}

export function flattenSingleDisclosureBookletPdfData(input: {
  partyName: string;
  payload: DisclosureBookletPayload | Record<string, unknown> | null | undefined;
}): Record<string, string> {
  const payload = ensureFieldBasedBookletPayload(input.payload);
  const output: Record<string, string> = {
    "financialDisclosureBooklet.partyName": input.partyName || "",
    "financialDisclosureBooklet.schemaVersion": String(payload.bookletSchemaVersion),
  };
  flattenObject("financialDisclosureBooklet", payload.answers, output);
  flattenObject("financialDisclosureBooklet.totals", calculateDisclosureBookletTotals(payload.answers), output);
  return output;
}

function setNestedValue(source: unknown, path: string[], value: unknown): unknown {
  const [head, ...tail] = path;
  if (!head) return source;
  const isArrayIndex = Number.isInteger(Number(head)) && Number(head) >= 0 && String(Number(head)) === head;
  if (Array.isArray(source) || isArrayIndex) {
    const output = Array.isArray(source) ? source.slice() : [];
    const index = Number(head);
    output[index] = tail.length ? setNestedValue(output[index], tail, value) : value;
    return output;
  }
  const current = isObject(source) ? source : {};
  return {
    ...current,
    [head]: tail.length ? setNestedValue(current[head], tail, value) : value,
  };
}

export function setDisclosureBookletAnswerByPdfSource(
  payload: DisclosureBookletPayload | Record<string, unknown> | null | undefined,
  source: string,
  value: string,
): DisclosureBookletPayload {
  const prefix = "financialDisclosureBooklet.";
  if (!source.startsWith(prefix)) throw new Error("Invalid financial disclosure booklet PDF source");
  const path = source.slice(prefix.length).split(".").filter(Boolean);
  if (path.length < 2 || path[0] === "partyName" || path[0] === "schemaVersion" || path[0] === "totals") {
    throw new Error("This financial disclosure booklet PDF field is read-only");
  }
  const normalized = ensureFieldBasedBookletPayload(payload);
  return ensureFieldBasedBookletPayload({
    ...normalized,
    answers: setNestedValue(normalized.answers, path, value),
  });
}
