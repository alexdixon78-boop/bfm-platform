/**
 * Behavioral checks for deterministic Draft Financial Schedule PDF auto-mapping.
 *
 * Run with: npx tsx tests/draft-financial-schedule-auto-map.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditDraftFinancialScheduleMapping,
  autoRepairDraftFinancialScheduleMapping,
} from "../shared/draft-financial-schedule-auto-map";
import {
  DRAFT_FINANCIAL_SCHEDULE_CURRENTLY_MISSING_FIELDS,
  DRAFT_FINANCIAL_SCHEDULE_PRODUCTION_FIELD_NAMES,
} from "./fixtures/draft-financial-schedule-field-names";

function mappingFor(fieldMapping: Array<{ pdfField: string; source: string }>, pdfField: string): string | undefined {
  return fieldMapping.find((entry) => entry.pdfField === pdfField)?.source;
}

test("auto mapper maps header aliases and party-specific asset fields", () => {
  const result = autoRepairDraftFinancialScheduleMapping({
    fieldNames: ["caseRef", "client_names", "property_value_client_a", "property_value_client_b"],
    existingMapping: [],
  });

  assert.equal(mappingFor(result.fieldMapping, "caseRef"), "draftFinancialSchedule.header.ref");
  assert.equal(mappingFor(result.fieldMapping, "client_names"), "draftFinancialSchedule.header.clientNames");
  assert.equal(mappingFor(result.fieldMapping, "property_value_client_a"), "draftFinancialSchedule.realisableAssets.property.value.clientA");
  assert.equal(mappingFor(result.fieldMapping, "property_value_client_b"), "draftFinancialSchedule.realisableAssets.property.value.clientB");
  assert.equal(result.diagnostics.createdMappings, 4);
});

test("auto mapper maps numbered repeatable asset rows without asset joint fields", () => {
  const result = autoRepairDraftFinancialScheduleMapping({
    fieldNames: ["current_account_1_description", "current_account_1_client_b", "current_account_1_joint", "loan_2_joint"],
    existingMapping: [],
  });

  assert.equal(mappingFor(result.fieldMapping, "current_account_1_description"), "draftFinancialSchedule.realisableAssets.currentAccounts.1.description");
  assert.equal(mappingFor(result.fieldMapping, "current_account_1_client_b"), "draftFinancialSchedule.realisableAssets.currentAccounts.1.clientB");
  assert.equal(mappingFor(result.fieldMapping, "current_account_1_joint"), undefined);
  assert.equal(mappingFor(result.fieldMapping, "loan_2_joint"), "draftFinancialSchedule.liabilities.loans.2.joint");
  assert.deepEqual(result.diagnostics.ignoredPdfFields, ["current_account_1_joint"]);
  assert.deepEqual(result.diagnostics.unmappedPdfFields, []);
});

test("auto mapper corrects canonical mappings, removes stale asset joint mappings, and leaves ambiguous fields unmapped", () => {
  const result = autoRepairDraftFinancialScheduleMapping({
    fieldNames: ["property_value_client_a", "old_joint", "Text1"],
    existingMapping: [
      { pdfField: "property_value_client_a", source: "static", defaultValue: "Manual value" },
      { pdfField: "old_joint", source: "draftFinancialSchedule.realisableAssets.property.value.joint" },
      { pdfField: "missing_field", source: "draftFinancialSchedule.header.ref" },
    ],
  });

  assert.equal(mappingFor(result.fieldMapping, "property_value_client_a"), "draftFinancialSchedule.realisableAssets.property.value.clientA");
  assert.equal(mappingFor(result.fieldMapping, "old_joint"), undefined);
  assert.equal(mappingFor(result.fieldMapping, "Text1"), undefined);
  assert.deepEqual(result.diagnostics.removedStaleMappings, [
    "old_joint",
    "missing_field",
  ]);
  assert.deepEqual(result.diagnostics.unmappedPdfFields, ["old_joint", "Text1"]);
  assert.equal(result.diagnostics.correctedMappings.length, 1);
});

test("production template maps every supported field and ignores only asset joint preview fields", () => {
  assert.equal(DRAFT_FINANCIAL_SCHEDULE_PRODUCTION_FIELD_NAMES.length, 304);

  const result = autoRepairDraftFinancialScheduleMapping({
    fieldNames: DRAFT_FINANCIAL_SCHEDULE_PRODUCTION_FIELD_NAMES,
    existingMapping: [],
  });

  assert.equal(result.fieldMapping.length, 265);
  assert.equal(result.diagnostics.ignoredPdfFields.length, 39);
  assert.deepEqual(result.diagnostics.unmappedPdfFields, []);
  assert.equal(mappingFor(result.fieldMapping, "ref_number"), "draftFinancialSchedule.header.ref");
  assert.equal(mappingFor(result.fieldMapping, "client_a_name"), "draftFinancialSchedule.header.clientAName");
  assert.equal(mappingFor(result.fieldMapping, "client_b_name"), "draftFinancialSchedule.header.clientBName");
  assert.equal(mappingFor(result.fieldMapping, "pension_notes"), "draftFinancialSchedule.unrealisableAssets.pensions.notes");
  assert.equal(mappingFor(result.fieldMapping, "self_assessment_a"), "draftFinancialSchedule.monthlyIncome.selfAssessmentTaxReturn.clientA");
  assert.equal(mappingFor(result.fieldMapping, "exp_children_notes"), "draftFinancialSchedule.monthlyExpenditure.childrensExpenses.notes");
  assert.equal(mappingFor(result.fieldMapping, "debt_mgmt_4_b"), "draftFinancialSchedule.liabilities.debtManagement.4.clientB");
  const creditCardFields = { name: "description", a: "clientA", b: "clientB", notes: "notes" } as const;
  for (let row = 1; row <= 3; row++) {
    for (const [pdfField, sourceField] of Object.entries(creditCardFields)) {
      const source = mappingFor(result.fieldMapping, `credit_card_${row}_${pdfField}`);
      assert.equal(source, `draftFinancialSchedule.liabilities.creditCards.${row}.${sourceField}`);
      assert.doesNotMatch(source || "", /vehicles/);
    }
  }
});

test("all 52 previously missing supported fields map to their exact schedule sources", () => {
  assert.equal(DRAFT_FINANCIAL_SCHEDULE_CURRENTLY_MISSING_FIELDS.length, 52);
  const result = autoRepairDraftFinancialScheduleMapping({
    fieldNames: [...DRAFT_FINANCIAL_SCHEDULE_CURRENTLY_MISSING_FIELDS],
    existingMapping: [],
  });

  assert.equal(result.fieldMapping.length, 52);
  assert.deepEqual(result.diagnostics.unmappedPdfFields, []);
  assert.equal(mappingFor(result.fieldMapping, "pension_joint"), "draftFinancialSchedule.unrealisableAssets.pensions.joint");
  assert.equal(mappingFor(result.fieldMapping, "pension_notes"), "draftFinancialSchedule.unrealisableAssets.pensions.notes");
  for (let row = 1; row <= 3; row++) {
    assert.equal(mappingFor(result.fieldMapping, `credit_card_${row}_joint`), `draftFinancialSchedule.liabilities.creditCards.${row}.joint`);
  }
  const repeatableFields = { name: "description", joint: "joint", a: "clientA", b: "clientB", notes: "notes" } as const;
  for (let row = 1; row <= 4; row++) {
    for (const [pdfField, sourceField] of Object.entries(repeatableFields)) {
      assert.equal(
        mappingFor(result.fieldMapping, `debt_mgmt_${row}_${pdfField}`),
        `draftFinancialSchedule.liabilities.debtManagement.${row}.${sourceField}`,
      );
    }
  }
  assert.equal(mappingFor(result.fieldMapping, "salary_notes"), "draftFinancialSchedule.monthlyIncome.salaryGross.notes");
  assert.equal(mappingFor(result.fieldMapping, "self_assessment_a"), "draftFinancialSchedule.monthlyIncome.selfAssessmentTaxReturn.clientA");
  assert.equal(mappingFor(result.fieldMapping, "self_assessment_b"), "draftFinancialSchedule.monthlyIncome.selfAssessmentTaxReturn.clientB");
  assert.equal(mappingFor(result.fieldMapping, "self_assessment_notes"), "draftFinancialSchedule.monthlyIncome.selfAssessmentTaxReturn.notes");
  const expenditureRows = {
    accommodation: "accommodation",
    commitments: "financialCommitments",
    utilities: "utilities",
    transport: "transport",
    household: "householdExpenses",
    personal: "personalExpenses",
    recreation: "recreationalExpenses",
    children: "childrensExpenses",
  } as const;
  const missingFields = new Set<string>(DRAFT_FINANCIAL_SCHEDULE_CURRENTLY_MISSING_FIELDS);
  for (const [pdfRow, sourceRow] of Object.entries(expenditureRows)) {
    for (const [pdfField, sourceField] of Object.entries({ a: "clientA", b: "clientB", notes: "notes" })) {
      const field = `exp_${pdfRow}_${pdfField}`;
      if (!missingFields.has(field)) continue;
      assert.equal(mappingFor(result.fieldMapping, field), `draftFinancialSchedule.monthlyExpenditure.${sourceRow}.${sourceField}`);
    }
  }
});

test("canonical reconciliation corrects corrupt mappings and preserves valid unknown manual mappings", () => {
  const result = autoRepairDraftFinancialScheduleMapping({
    fieldNames: ["credit_card_1_a", "ref_number", "custom_field", "unknown_field"],
    existingMapping: [
      { pdfField: "credit_card_1_a", source: "draftFinancialSchedule.realisableAssets.vehicles.1.clientA" },
      { pdfField: "ref_number", source: "case.caseRef" },
      { pdfField: "custom_field", source: "draftFinancialSchedule.monthlyIncome.salaryNet.clientA" },
      { pdfField: "unknown_field", source: "client.fullName" },
    ],
  });

  assert.equal(mappingFor(result.fieldMapping, "credit_card_1_a"), "draftFinancialSchedule.liabilities.creditCards.1.clientA");
  assert.equal(mappingFor(result.fieldMapping, "ref_number"), "draftFinancialSchedule.header.ref");
  assert.equal(mappingFor(result.fieldMapping, "custom_field"), "draftFinancialSchedule.monthlyIncome.salaryNet.clientA");
  assert.equal(mappingFor(result.fieldMapping, "unknown_field"), undefined);
  assert.equal(result.diagnostics.correctedMappings.length, 2);
  assert.deepEqual(result.diagnostics.removedStaleMappings, ["unknown_field"]);
  assert.deepEqual(result.diagnostics.unmappedPdfFields, ["unknown_field"]);

  const second = autoRepairDraftFinancialScheduleMapping({
    fieldNames: ["credit_card_1_a", "ref_number", "custom_field", "unknown_field"],
    existingMapping: result.fieldMapping,
  });
  assert.equal(second.changed, false);
  assert.equal(second.diagnostics.correctedMappings.length, 0);
});

test("mapping audit distinguishes corrected, ignored, stale, and unmapped fields", () => {
  const audit = auditDraftFinancialScheduleMapping({
    fieldNames: ["credit_card_1_a", "vehicle_1_joint", "custom_field", "unknown_field"],
    existingMapping: [
      { pdfField: "credit_card_1_a", source: "draftFinancialSchedule.realisableAssets.vehicles.1.clientA" },
      { pdfField: "custom_field", source: "client.fullName" },
    ],
  });

  assert.equal(audit.rows.find((row) => row.pdfField === "credit_card_1_a")?.status, "corrected");
  assert.equal(audit.rows.find((row) => row.pdfField === "vehicle_1_joint")?.status, "ignored");
  assert.equal(audit.rows.find((row) => row.pdfField === "custom_field")?.status, "stale");
  assert.equal(audit.rows.find((row) => row.pdfField === "unknown_field")?.status, "unmapped");
  assert.deepEqual(audit.summary, { fieldCount: 4, mapped: 0, corrected: 1, ignored: 1, unmapped: 1, stale: 1 });
});
