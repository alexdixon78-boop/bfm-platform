/**
 * Behavioral checks for the field-based Financial Disclosure booklet schema.
 *
 * Run with: npx tsx tests/financial-disclosure-booklet-schema.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA_VERSION,
  applyDisclosureSourcePrefill,
  buildCombinedDisclosureBookletView,
  calculateDisclosureBookletTotals,
  ensureFieldBasedBookletPayload,
  flattenDisclosureBookletTemplateData,
  flattenSingleDisclosureBookletPdfData,
  setDisclosureBookletAnswerByPdfSource,
} from "../shared/financial-disclosure-booklet-schema";
import {
  auditFinancialDisclosureBookletMapping,
  autoRepairFinancialDisclosureBookletMapping,
  getFinancialDisclosureBookletMappingCandidates,
  inferFinancialDisclosureBookletSource,
} from "../shared/financial-disclosure-booklet-auto-map";

test("field-based booklet payload preserves legacy broad-section notes while creating answer sections", () => {
  const payload = ensureFieldBasedBookletPayload({
    clientNotes: "Earlier broad notes",
    sections: [
      { key: "income", notes: "Income rough notes" },
      { key: "monthly_expenditure", notes: "Rent notes" },
    ],
  });

  assert.equal(payload.bookletSchemaVersion, FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA_VERSION);
  assert.equal(payload.legacyNotes?.clientNotes, "Earlier broad notes");
  assert.equal(payload.legacyNotes?.sections?.income, "Income rough notes");
  assert.equal(payload.answers.a1_monthly_income_employment_self_employment.main_salary_wages_gross, "");
  assert.equal(payload.progress.a1_monthly_income_employment_self_employment.status, "not_started");
  assert.ok(Array.isArray(payload.answers.c_assets_and_liabilities.bank_building_society_national_savings));
});

test("server-side totals are recalculated from field answers, not trusted from client input", () => {
  const payload = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: {
        main_salary_wages_gross: "3000",
        other_earnings: "200",
        overtime_bonus_commission: "100",
        less_national_insurance: "300",
        income_tax: "400",
        pension_contributions_private_plan: "150",
        other_deductions: "50",
        total_deductions: "99999",
      },
      a2_other_income: {
        child_benefit: "100",
        dividends_or_interest_received: "25",
        less_likely_tax_liability: "10",
      },
      b_monthly_expenditure: {
        accommodation: { mortgage_rent_service_charge: "1000", repairs_decorating_maintenance: "50" },
        utilities: { council_tax: "150", electricity: "75" },
      },
    },
  });

  const totals = calculateDisclosureBookletTotals(payload.answers);

  assert.equal(totals.a1.total_deductions, 900);
  assert.equal(totals.a1.net_income_from_employment, 2400);
  assert.equal(totals.a2.total_other_income, 125);
  assert.equal(totals.a2.total_net_monthly_income, 115);
  assert.equal(totals.b.accommodation, 1050);
  assert.equal(totals.b.utilities, 225);
});

test("manual booklet total fields are preserved as authoritative answer values", () => {
  const payload = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: {
        less_national_insurance: "300",
        income_tax: "400",
        total_deductions: "850",
      },
      b_monthly_expenditure: {
        summary: {
          accommodation: "1100",
          childrens_expenses: "575",
        },
        accommodation: {
          mortgage_rent_service_charge: "1000",
          repairs_decorating_maintenance: "50",
          total: "1100",
        },
        childrens_expenses: {
          childcare: {
            child_care: "500",
            babysitting: "20",
            total: "575",
          },
        },
      },
    },
  });

  assert.equal(payload.answers.a1_monthly_income_employment_self_employment.total_deductions, "850");
  assert.equal(payload.answers.b_monthly_expenditure.summary.accommodation, "1100");
  assert.equal(payload.answers.b_monthly_expenditure.summary.childrens_expenses, "575");
  assert.equal(payload.answers.b_monthly_expenditure.accommodation.total, "1100");
  assert.equal(payload.answers.b_monthly_expenditure.childrens_expenses.childcare.total, "575");
  assert.equal(calculateDisclosureBookletTotals(payload.answers).a1.total_deductions, 700);
});

test("combined view and template data expose client A and client B side by side", () => {
  const clientA = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: { main_salary_wages_gross: "3100" },
    },
  });
  const clientB = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: { main_salary_wages_gross: "2800" },
    },
  });

  const combined = buildCombinedDisclosureBookletView({
    clientA: { partyId: "party-a", clientName: "Client A", payload: clientA },
    clientB: { partyId: "party-b", clientName: "Client B", payload: clientB },
  });
  const templateData = flattenDisclosureBookletTemplateData(combined);

  assert.equal(combined.sections[0].fields[0].clientA.value, "3100");
  assert.equal(combined.sections[0].fields[0].clientB.value, "2800");
  assert.equal(templateData["clientA.a1_monthly_income_employment_self_employment.main_salary_wages_gross"], "3100");
  assert.equal(templateData["clientB.a1_monthly_income_employment_self_employment.main_salary_wages_gross"], "2800");
});

test("template and PDF data use saved manual total field answers", () => {
  const clientA = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: { total_deductions: "850" },
      b_monthly_expenditure: {
        summary: { accommodation: "1100" },
        accommodation: { total: "1100" },
      },
    },
  });
  const clientB = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: { total_deductions: "920" },
      b_monthly_expenditure: {
        summary: { accommodation: "1250" },
        accommodation: { total: "1250" },
      },
    },
  });

  const single = flattenSingleDisclosureBookletPdfData({ partyName: "Client A", payload: clientA });
  const combined = buildCombinedDisclosureBookletView({
    clientA: { partyId: "party-a", clientName: "Client A", payload: clientA },
    clientB: { partyId: "party-b", clientName: "Client B", payload: clientB },
  });
  const template = flattenDisclosureBookletTemplateData(combined);

  assert.equal(single["financialDisclosureBooklet.a1_monthly_income_employment_self_employment.total_deductions"], "850");
  assert.equal(single["financialDisclosureBooklet.b_monthly_expenditure.summary.accommodation"], "1100");
  assert.equal(single["financialDisclosureBooklet.b_monthly_expenditure.accommodation.total"], "1100");
  assert.equal(template["clientA.a1_monthly_income_employment_self_employment.total_deductions"], "850");
  assert.equal(template["clientB.a1_monthly_income_employment_self_employment.total_deductions"], "920");
  assert.equal(template["clientA.b_monthly_expenditure.summary.accommodation"], "1100");
  assert.equal(template["clientB.b_monthly_expenditure.summary.accommodation"], "1250");
  assert.equal(template["clientA.b_monthly_expenditure.accommodation.total"], "1100");
  assert.equal(template["clientB.b_monthly_expenditure.accommodation.total"], "1250");
});

test("source prefill populates only matching blank financial disclosure booklet fields", () => {
  const payload = applyDisclosureSourcePrefill(ensureFieldBasedBookletPayload({}), {
    address: "10 Example Street, London, SW1A 1AA",
    nationalInsuranceNumber: "QQ123456C",
  });

  assert.equal(payload.answers.c_assets_and_liabilities.family_home.address, "10 Example Street, London, SW1A 1AA");
  assert.equal(payload.answers.c_assets_and_liabilities.pensions.national_insurance_number, "QQ123456C");
});

test("source prefill never overwrites client-entered booklet answers", () => {
  const payload = applyDisclosureSourcePrefill(ensureFieldBasedBookletPayload({
    answers: {
      c_assets_and_liabilities: {
        family_home: {
          address: "Client entered home",
        },
        pensions: {
          national_insurance_number: "Client entered NI",
        },
      },
    },
  }), {
    address: "10 Example Street, London, SW1A 1AA",
    nationalInsuranceNumber: "QQ123456C",
  });

  assert.equal(payload.answers.c_assets_and_liabilities.family_home.address, "Client entered home");
  assert.equal(payload.answers.c_assets_and_liabilities.pensions.national_insurance_number, "Client entered NI");
});

test("single-party PDF data exposes financial disclosure booklet sources", () => {
  const payload = ensureFieldBasedBookletPayload({
    answers: {
      a1_monthly_income_employment_self_employment: { main_salary_wages_gross: "3100" },
      c_assets_and_liabilities: { family_home: { address: "10 Example Street" } },
    },
  });

  const data = flattenSingleDisclosureBookletPdfData({ partyName: "Client A", payload });

  assert.equal(data["financialDisclosureBooklet.partyName"], "Client A");
  assert.equal(data["financialDisclosureBooklet.a1_monthly_income_employment_self_employment.main_salary_wages_gross"], "3100");
  assert.equal(data["financialDisclosureBooklet.c_assets_and_liabilities.family_home.address"], "10 Example Street");
  assert.equal(data["financialDisclosureBooklet.totals.a1.net_income_from_employment"], "3100");
});

test("PDF field edits can write back to the source booklet answers", () => {
  const payload = setDisclosureBookletAnswerByPdfSource(
    ensureFieldBasedBookletPayload({}),
    "financialDisclosureBooklet.a1_monthly_income_employment_self_employment.main_salary_wages_gross",
    "3200",
  );

  assert.equal(payload.answers.a1_monthly_income_employment_self_employment.main_salary_wages_gross, "3200");
});

test("financial disclosure booklet auto-map infers safe mappings from PDF fields", () => {
  assert.equal(
    inferFinancialDisclosureBookletSource("Main salary wages gross"),
    "financialDisclosureBooklet.a1_monthly_income_employment_self_employment.main_salary_wages_gross",
  );
  assert.equal(
    inferFinancialDisclosureBookletSource("Family home address"),
    "financialDisclosureBooklet.c_assets_and_liabilities.family_home.address",
  );

  const repaired = autoRepairFinancialDisclosureBookletMapping({
    fieldNames: ["Client name", "Main salary wages gross", "Old removed field"],
    existingMapping: [
      { pdfField: "Old removed field", source: "financialDisclosureBooklet.unknown", required: false },
    ],
  });

  assert.equal(repaired.diagnostics.createdMappings, 2);
  assert.deepEqual(repaired.diagnostics.removedStaleMappings, ["Old removed field"]);
  assert.ok(repaired.fieldMapping.some((entry) => entry.pdfField === "Client name" && entry.source === "financialDisclosureBooklet.partyName"));
});

test("financial disclosure booklet auto-map follows actual booklet PDF field naming patterns", () => {
  assert.equal(
    inferFinancialDisclosureBookletSource("utilities_telephone"),
    "financialDisclosureBooklet.b_monthly_expenditure.utilities.telephone",
  );
  assert.equal(
    inferFinancialDisclosureBookletSource("financial_commitments_hp_and_finance_houses"),
    "financialDisclosureBooklet.b_monthly_expenditure.financial_commitments.hp_finance_houses",
  );
  assert.equal(
    inferFinancialDisclosureBookletSource("stocks_shares_and_quoted_securities_current_value_2"),
    "financialDisclosureBooklet.c_assets_and_liabilities.stocks_shares_quoted_securities.1.current_value",
  );
  assert.equal(
    inferFinancialDisclosureBookletSource("bank_building_society_national_savings_accounts_in_joint_sole_names_4"),
    "financialDisclosureBooklet.c_assets_and_liabilities.bank_building_society_national_savings.3.joint_sole_names",
  );
  assert.equal(
    inferFinancialDisclosureBookletSource("matrimonial_home_valuation"),
    "financialDisclosureBooklet.document_checklist.matrimonial_home_valuation",
  );
  assert.equal(inferFinancialDisclosureBookletSource("Text1"), null);
  assert.equal(inferFinancialDisclosureBookletSource("Total"), null);
});

test("financial disclosure booklet mapping audit reports stale and ambiguous fields without unsafe guesses", () => {
  const audit = auditFinancialDisclosureBookletMapping({
    fieldNames: [
      "stocks_shares_and_quoted_securities_current_value_2",
      "personal_expenses_other_please_specify",
      "Text1",
    ],
    existingMapping: [
      {
        pdfField: "stocks_shares_and_quoted_securities_current_value_2",
        source: "financialDisclosureBooklet.c_assets_and_liabilities.family_home.current_value",
      },
      {
        pdfField: "removed_pdf_field",
        source: "financialDisclosureBooklet.a1_monthly_income_employment_self_employment.main_salary_wages_gross",
      },
    ],
  });

  const stockValue = audit.rows.find((row) => row.pdfField === "stocks_shares_and_quoted_securities_current_value_2");
  assert.equal(stockValue?.status, "stale");
  assert.equal(stockValue?.proposedSource, "financialDisclosureBooklet.c_assets_and_liabilities.stocks_shares_quoted_securities.1.current_value");

  const otherPersonal = audit.rows.find((row) => row.pdfField === "personal_expenses_other_please_specify");
  assert.equal(otherPersonal?.status, "mapped");
  assert.equal(otherPersonal?.proposedSource, "financialDisclosureBooklet.b_monthly_expenditure.personal_expenses.other");

  const generic = audit.rows.find((row) => row.pdfField === "Text1");
  assert.equal(generic?.status, "unmapped");
  assert.equal(generic?.proposedSource, null);

  const removed = audit.staleMappings.find((entry) => entry.pdfField === "removed_pdf_field");
  assert.equal(removed?.source, "financialDisclosureBooklet.a1_monthly_income_employment_self_employment.main_salary_wages_gross");
});

test("financial disclosure booklet mapping candidates expose labels for manual review", () => {
  const candidates = getFinancialDisclosureBookletMappingCandidates("bank_building_society_national_savings_accounts_balance_3");

  assert.equal(candidates[0]?.source, "financialDisclosureBooklet.c_assets_and_liabilities.bank_building_society_national_savings.2.balance");
  assert.equal(candidates[0]?.sourceLabel, "C Assets and Liabilities / Bank, Building Society, National Savings accounts / Row 3 / Balance");
});
