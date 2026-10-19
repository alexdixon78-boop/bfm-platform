import "dotenv/config";
import { loadRuntimeEnv } from "../config/runtime-env";
import { auditFinancialDisclosureBookletMapping } from "@shared/financial-disclosure-booklet-auto-map";

async function main() {
  await loadRuntimeEnv();
  const { storage } = await import("../storage");
  const templates = await storage.listCourtFormTemplates();
  const template = templates.find((item: any) => item.formType === "FinancialDisclosureBooklet" && !item.deletedAt);

  if (!template) {
    console.log(JSON.stringify({ found: false, message: "No active FinancialDisclosureBooklet template found" }, null, 2));
    return;
  }

  const fieldNames = Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : [];
  const existingMapping = Array.isArray(template.fieldMapping) ? template.fieldMapping : [];
  const audit = auditFinancialDisclosureBookletMapping({ fieldNames, existingMapping });
  const listLimit = Number(process.env.BOOKLET_MAPPING_AUDIT_LIMIT || 80);

  console.log(JSON.stringify({
    found: true,
    templateId: template.id,
    filename: template.sourceFileName,
    fieldCount: fieldNames.length,
    mappedCount: existingMapping.length,
    summary: audit.summary,
    staleMappingCount: audit.staleMappings.length,
    omittedRowsAreCappedAt: listLimit,
    unmappedFields: audit.rows.filter((row) => row.status === "unmapped").slice(0, listLimit).map((row) => row.pdfField),
    ambiguousFields: audit.rows.filter((row) => row.status === "ambiguous").slice(0, listLimit).map((row) => row.pdfField),
    staleFields: audit.rows
      .filter((row) => row.status === "stale")
      .slice(0, listLimit)
      .map((row) => ({ pdfField: row.pdfField, currentSource: row.currentSource, proposedSource: row.proposedSource })),
    proposedMappings: audit.rows
      .filter((row) => !row.currentSource && row.proposedSource)
      .slice(0, listLimit)
      .map((row) => ({ pdfField: row.pdfField, proposedSource: row.proposedSource, sourceLabel: row.sourceLabel })),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
