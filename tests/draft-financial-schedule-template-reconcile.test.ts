import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileDraftFinancialScheduleTemplateMapping } from "../server/services/draft-financial-schedule-template-mapping.service";

type Template = {
  id: string;
  fieldNames: string[];
  fieldMapping: Array<{ pdfField: string; source: string }>;
};

test("mapping reconciliation retries after a concurrent edit and preserves the latest manual mapping", async () => {
  const initial: Template = {
    id: "template-1",
    fieldNames: ["credit_card_1_a", "custom_field"],
    fieldMapping: [{ pdfField: "credit_card_1_a", source: "draftFinancialSchedule.realisableAssets.vehicles.1.clientA" }],
  };
  const concurrent: Template = {
    ...initial,
    fieldMapping: [
      ...initial.fieldMapping,
      { pdfField: "custom_field", source: "draftFinancialSchedule.monthlyIncome.salaryNet.clientA" },
    ],
  };
  let compareAttempts = 0;

  const result = await reconcileDraftFinancialScheduleTemplateMapping(initial, initial.fieldNames, {
    updateIfUnchanged: async (_id, expected, next) => {
      compareAttempts++;
      if (compareAttempts === 1) return undefined;
      assert.deepEqual(expected, concurrent.fieldMapping);
      return { ...concurrent, fieldMapping: next };
    },
    reload: async () => concurrent,
  });

  assert.equal(compareAttempts, 2);
  assert.equal(result.template.fieldMapping.find((entry) => entry.pdfField === "credit_card_1_a")?.source, "draftFinancialSchedule.liabilities.creditCards.1.clientA");
  assert.equal(result.template.fieldMapping.find((entry) => entry.pdfField === "custom_field")?.source, "draftFinancialSchedule.monthlyIncome.salaryNet.clientA");
});

test("mapping reconciliation does not write when the mapping is already canonical", async () => {
  const template: Template = {
    id: "template-1",
    fieldNames: ["credit_card_1_a"],
    fieldMapping: [{ pdfField: "credit_card_1_a", source: "draftFinancialSchedule.liabilities.creditCards.1.clientA" }],
  };
  let writes = 0;

  const result = await reconcileDraftFinancialScheduleTemplateMapping(template, template.fieldNames, {
    updateIfUnchanged: async () => {
      writes++;
      return template;
    },
    reload: async () => template,
  });

  assert.equal(writes, 0);
  assert.equal(result.diagnostics.correctedMappings.length, 0);
  assert.equal(result.changed, false);
});
