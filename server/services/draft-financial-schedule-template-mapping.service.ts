import {
  autoRepairDraftFinancialScheduleMapping,
  type DraftFinancialScheduleAutoMapDiagnostics,
  type DraftFinancialScheduleMappingEntry,
} from "@shared/draft-financial-schedule-auto-map";

type DraftScheduleTemplateMappingRecord = {
  id: string;
  fieldMapping: unknown;
};

type ReconciliationDependencies<T extends DraftScheduleTemplateMappingRecord> = {
  updateIfUnchanged: (
    id: string,
    expected: DraftFinancialScheduleMappingEntry[],
    next: DraftFinancialScheduleMappingEntry[],
  ) => Promise<T | undefined>;
  reload: (id: string) => Promise<T | undefined>;
};

function normalizeMapping(value: unknown): DraftFinancialScheduleMappingEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is DraftFinancialScheduleMappingEntry => Boolean(
    entry
    && typeof entry === "object"
    && typeof (entry as DraftFinancialScheduleMappingEntry).pdfField === "string"
    && typeof (entry as DraftFinancialScheduleMappingEntry).source === "string",
  ));
}

export async function reconcileDraftFinancialScheduleTemplateMapping<T extends DraftScheduleTemplateMappingRecord>(
  initialTemplate: T,
  fieldNames: string[],
  dependencies: ReconciliationDependencies<T>,
): Promise<{ template: T; diagnostics: DraftFinancialScheduleAutoMapDiagnostics; changed: boolean }> {
  let template = initialTemplate;
  let changed = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const currentMapping = normalizeMapping(template.fieldMapping);
    const repaired = autoRepairDraftFinancialScheduleMapping({ fieldNames, existingMapping: currentMapping });
    if (!repaired.changed) return { template, diagnostics: repaired.diagnostics, changed };
    changed = true;
    const updated = await dependencies.updateIfUnchanged(template.id, currentMapping, repaired.fieldMapping);
    if (updated) return { template: updated, diagnostics: repaired.diagnostics, changed };
    const latest = await dependencies.reload(template.id);
    if (!latest) return { template: { ...template, fieldMapping: repaired.fieldMapping }, diagnostics: repaired.diagnostics, changed };
    template = latest;
  }

  const finalRepair = autoRepairDraftFinancialScheduleMapping({
    fieldNames,
    existingMapping: normalizeMapping(template.fieldMapping),
  });
  return {
    template: finalRepair.changed ? { ...template, fieldMapping: finalRepair.fieldMapping } : template,
    diagnostics: finalRepair.diagnostics,
    changed,
  };
}
