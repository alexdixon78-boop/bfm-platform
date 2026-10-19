/**
 * Behavioral checks for the case-level Draft Financial Schedule schema.
 *
 * Run with: npx tsx tests/draft-financial-schedule-schema.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDraftFinancialSchedulePrefill,
  buildDraftFinancialSchedulePdfTemplateData,
  buildDefaultDraftFinancialSchedulePayload,
  DRAFT_FINANCIAL_SCHEDULE_PRIVILEGE_NOTICE,
  flattenDraftFinancialScheduleTemplateData,
  normalizeDraftFinancialSchedulePayload,
  type DraftFinancialScheduleSource,
} from "../shared/draft-financial-schedule-schema";

const source: DraftFinancialScheduleSource = {
  caseRef: "BFM-2026-0001",
  clientAName: "Henzy Alpha",
  clientBName: "Richard Beta",
  currentDate: "2026-09-09",
  clientAAnswers: {
    a1_monthly_income_employment_self_employment: {
      main_salary_wages_gross: "3000",
      less_national_insurance: "200",
      income_tax: "300",
    },
    b_monthly_expenditure: {
      accommodation: { mortgage_rent_service_charge: "900" },
      utilities: { council_tax: "150", electricity: "80" },
    },
    c_assets_and_liabilities: {
      family_home: {
        current_value: "300000",
        less_mortgage_1: "100000",
        less_penalties_if_sold_now: "5000",
        estimated_sales_costs: "4500",
        net_equity: "190500",
      },
      pensions: [{ cetv_ceb_valuation: "50000", payment_drawdown_deferment_status: "deferment" }],
      liabilities_apart_from_mortgages: [
        { nature_of_debt: "Bank loan", outstanding_amount: "10000" },
        { nature_of_debt: "Family loan", outstanding_amount: "2000" },
      ],
    },
  },
  clientBAnswers: {
    a1_monthly_income_employment_self_employment: {
      main_salary_wages_gross: "2500",
      income_tax: "250",
    },
    c_assets_and_liabilities: {
      bank_building_society_national_savings: [
        { name: "Everyday Bank", type_of_account: "Current", balance: "1200" },
        { name: "Bills Bank", type_of_account: "Current", balance: "500" },
      ],
      vehicles_over_500: [
        { description: "Car", market_value: "8000" },
        { description: "Motorbike", market_value: "2500" },
      ],
    },
  },
};

test("draft schedule prefill creates header from case reference, clients, and current date", () => {
  const payload = applyDraftFinancialSchedulePrefill(buildDefaultDraftFinancialSchedulePayload(), source);

  assert.equal(payload.header.ref, "BFM-2026-0001");
  assert.equal(payload.header.clientNames, "Henzy Alpha and Richard Beta");
  assert.equal(payload.header.clientAName, "Henzy Alpha");
  assert.equal(payload.header.clientBName, "Richard Beta");
  assert.equal(payload.header.date, "2026-09-09");
  assert.equal(payload.privilegeNotice, DRAFT_FINANCIAL_SCHEDULE_PRIVILEGE_NOTICE);
});

test("draft schedule normalization upgrades legacy payloads and preserves PDF field overrides", () => {
  const payload = normalizeDraftFinancialSchedulePayload({
    schemaVersion: 1,
    header: { ref: "Legacy", clientNames: "One and Two", date: "2026-01-01" },
    __pdfFieldOverrides: { vehicle_1_joint: "true", custom_field: "Manual" },
  });

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.header.clientNames, "One and Two");
  assert.equal(payload.header.clientAName, "");
  assert.equal(payload.header.clientBName, "");
  assert.deepEqual((payload as unknown as Record<string, unknown>).__pdfFieldOverrides, {
    vehicle_1_joint: "true",
    custom_field: "Manual",
  });
});

test("preview-only Joint asset overrides survive normalization and win during PDF filling", async () => {
  const payload = normalizeDraftFinancialSchedulePayload({
    __pdfFieldOverrides: { vehicle_1_joint: true },
  });
  const { applyPdfFieldOverrides } = await import("../server/services/court-form-pdf-fill.service");

  const values = applyPdfFieldOverrides(
    { vehicle_1_joint: "" },
    payload as unknown as Record<string, unknown>,
    { fieldMetadata: [{ name: "vehicle_1_joint" }] },
  );

  assert.equal(values.vehicle_1_joint, "true");
});

test("draft schedule prefill fills blanks but preserves mediator edits", () => {
  const payload = applyDraftFinancialSchedulePrefill({
    ...buildDefaultDraftFinancialSchedulePayload(),
    header: { ref: "Manual ref", clientNames: "", date: "2026-09-10" },
    realisableAssets: {
      ...buildDefaultDraftFinancialSchedulePayload().realisableAssets,
      property: {
        ...buildDefaultDraftFinancialSchedulePayload().realisableAssets.property,
        value: { clientA: "Mediator value", clientB: "", notes: "" },
      },
    },
  }, source);

  assert.equal(payload.header.ref, "Manual ref");
  assert.equal(payload.header.clientNames, "Henzy Alpha and Richard Beta");
  assert.equal(payload.header.date, "2026-09-10");
  assert.equal(payload.realisableAssets.property.value.clientA, "Mediator value");
});

test("draft schedule prefill maps booklet answers into summary schedule rows", () => {
  const payload = applyDraftFinancialSchedulePrefill(buildDefaultDraftFinancialSchedulePayload(), source);

  assert.equal(payload.realisableAssets.property.lessMortgage.clientA, "100000");
  assert.equal(payload.realisableAssets.property.equity.clientA, "190500");
  assert.equal(payload.realisableAssets.currentAccounts[0].description, "Everyday Bank Current");
  assert.equal(payload.realisableAssets.currentAccounts[0].clientB, "1200");
  assert.equal(payload.realisableAssets.currentAccounts[1].description, "Bills Bank Current");
  assert.equal(payload.realisableAssets.vehicles[0].description, "Car");
  assert.equal(payload.realisableAssets.vehicles[0].clientB, "8000");
  assert.equal(payload.realisableAssets.vehicles[1].description, "Motorbike");
  assert.equal(payload.unrealisableAssets.pensions.clientA.annual, "50000");
  assert.equal(payload.liabilities.loans[0].description, "Bank loan");
  assert.equal(payload.liabilities.loans[0].clientA, "10000");
  assert.equal(payload.liabilities.loans[1].description, "Family loan");
  assert.equal(payload.monthlyIncome.salaryGross.clientA, "3000");
  assert.equal(payload.monthlyIncome.salaryNet.clientA, "2500");
  assert.equal(payload.monthlyExpenditure.accommodation.clientA, "900");
  assert.equal(payload.monthlyExpenditure.utilities.clientA, "230");
});

test("draft schedule normalizes legacy single-row repeatable categories into arrays", () => {
  const payload = normalizeDraftFinancialSchedulePayload({
    realisableAssets: {
      currentAccounts: { joint: "100", clientA: "200", clientB: "300", notes: "Legacy current account" },
    },
    liabilities: {
      creditCards: { joint: "", clientA: "400", clientB: "", notes: "Legacy card" },
    },
  });

  assert.deepEqual(payload.realisableAssets.currentAccounts, [
    { description: "", clientA: "200", clientB: "300", notes: "Legacy current account" },
  ]);
  assert.deepEqual(payload.liabilities.creditCards, [
    { description: "", joint: "", clientA: "400", clientB: "", notes: "Legacy card" },
  ]);
  assert.deepEqual(payload.realisableAssets.savingsAccounts, []);
});

test("draft schedule repeatable prefill preserves manually edited categories", () => {
  const payload = applyDraftFinancialSchedulePrefill({
    ...buildDefaultDraftFinancialSchedulePayload(),
    realisableAssets: {
      ...buildDefaultDraftFinancialSchedulePayload().realisableAssets,
      vehicles: [{ description: "Manual vehicle", clientA: "1", clientB: "", notes: "Keep" }],
    },
  }, source);

  assert.deepEqual(payload.realisableAssets.vehicles, [
    { description: "Manual vehicle", clientA: "1", clientB: "", notes: "Keep" },
  ]);
});

test("draft schedule template data flattens saved values for template export", () => {
  const payload = applyDraftFinancialSchedulePrefill(buildDefaultDraftFinancialSchedulePayload(), source);
  const flat = flattenDraftFinancialScheduleTemplateData(payload);

  assert.equal(flat["header.ref"], "BFM-2026-0001");
  assert.equal(flat["header.clientNames"], "Henzy Alpha and Richard Beta");
  assert.equal(flat["realisableAssets.property.equity.clientA"], "190500");
  assert.equal(flat["realisableAssets.currentAccounts"], "Everyday Bank Current |  | 1200 | \nBills Bank Current |  | 500 | ");
  assert.equal(flat["monthlyExpenditure.utilities.clientA"], "230");
});

test("draft schedule PDF template data exposes prefixed scalar fields and numbered repeatable rows", () => {
  const payload = applyDraftFinancialSchedulePrefill(buildDefaultDraftFinancialSchedulePayload(), source);
  const values = buildDraftFinancialSchedulePdfTemplateData(payload);

  assert.equal(values["draftFinancialSchedule.header.ref"], "BFM-2026-0001");
  assert.equal(values["draftFinancialSchedule.header.clientNames"], "Henzy Alpha and Richard Beta");
  assert.equal(values["draftFinancialSchedule.header.clientAName"], "Henzy Alpha");
  assert.equal(values["draftFinancialSchedule.header.clientBName"], "Richard Beta");
  assert.equal(values["draftFinancialSchedule.realisableAssets.property.value.clientA"], "300000");
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.1.description"], "Everyday Bank Current");
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.1.clientB"], "1200");
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.1.joint"], undefined);
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.2.description"], "Bills Bank Current");
  assert.equal(values["draftFinancialSchedule.realisableAssets.vehicles.2.description"], "Motorbike");
  assert.equal(values["draftFinancialSchedule.realisableAssets.currentAccounts.21.description"], undefined);
});
