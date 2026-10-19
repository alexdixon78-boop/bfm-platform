import {
  FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA,
  type DisclosureBookletField,
  type DisclosureBookletSection,
} from "./financial-disclosure-booklet-schema";

export type FinancialDisclosureBookletMappingEntry = {
  pdfField: string;
  source: string;
  required?: boolean;
  defaultValue?: string | null;
};

export type FinancialDisclosureBookletMappingCandidate = {
  source: string;
  sourceLabel: string;
  score: number;
};

export type FinancialDisclosureBookletMappingAuditStatus = "mapped" | "unmapped" | "stale" | "ambiguous";

export type FinancialDisclosureBookletMappingAuditRow = {
  pdfField: string;
  currentSource: string | null;
  proposedSource: string | null;
  status: FinancialDisclosureBookletMappingAuditStatus;
  candidates: FinancialDisclosureBookletMappingCandidate[];
  sourceLabel: string | null;
};

export type FinancialDisclosureBookletMappingAudit = {
  rows: FinancialDisclosureBookletMappingAuditRow[];
  staleMappings: FinancialDisclosureBookletMappingEntry[];
  summary: {
    fieldCount: number;
    mapped: number;
    unmapped: number;
    stale: number;
    ambiguous: number;
  };
};

export type FinancialDisclosureBookletAutoMapDiagnostics = {
  createdMappings: number;
  preservedMappings: number;
  removedStaleMappings: string[];
  unmappedPdfFields: string[];
};

export type FinancialDisclosureBookletAutoMapResult = {
  fieldMapping: FinancialDisclosureBookletMappingEntry[];
  diagnostics: FinancialDisclosureBookletAutoMapDiagnostics;
  changed: boolean;
};

type SourceDefinition = {
  source: string;
  sourceLabel: string;
  aliases: string[];
};

const PREFIX = "financialDisclosureBooklet.";
const GENERIC_FIELD_RE = /^(text|checkbox|button|radio|field)\d*$/i;
const GENERIC_WORDS = new Set(["", "name", "date", "total", "amount", "value", "other", "description"]);

const BASE_SOURCES: SourceDefinition[] = [
  {
    source: `${PREFIX}partyName`,
    sourceLabel: "Party name",
    aliases: ["party name", "client name", "full name", "your name"],
  },
  {
    source: `${PREFIX}schemaVersion`,
    sourceLabel: "Schema version",
    aliases: ["schema version", "booklet schema version"],
  },
];

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bni\b/g, "national insurance")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function compact(value: string): string {
  return words(value).join("");
}

function readableTitle(value: string): string {
  return value.replace(/^\d+\.\s*/, "").trim();
}

function sourceAllowed(source: string, allowedSources: Set<string>): boolean {
  return source === "static" || source.startsWith("draft.") || allowedSources.has(source);
}

function sectionTotalKey(section: DisclosureBookletSection): string | null {
  if (section.key.startsWith("a1_")) return "a1";
  if (section.key.startsWith("a2_")) return "a2";
  if (section.key === "b_monthly_expenditure") return "b";
  return null;
}

function addDefinition(
  output: SourceDefinition[],
  source: string,
  sourceLabel: string,
  aliases: Array<string | null | undefined>,
): void {
  const uniqueAliases = Array.from(new Set(aliases.filter((alias): alias is string => Boolean(alias?.trim()))));
  output.push({ source, sourceLabel, aliases: uniqueAliases });
}

function fieldAliases(
  section: DisclosureBookletSection,
  field: DisclosureBookletField,
  parents: string[],
  pathKeys: string[],
): string[] {
  return [
    field.key,
    field.label,
    pathKeys.join(" "),
    pathKeys.join("_"),
    `${section.title} ${field.label}`,
    `${section.key} ${field.key}`,
    ...parents.map((parent) => `${parent} ${field.label}`),
    ...parents.map((parent) => `${parent} ${field.key}`),
  ];
}

function addField(
  output: SourceDefinition[],
  sourcePath: string,
  sourceLabelPath: string[],
  section: DisclosureBookletSection,
  field: DisclosureBookletField,
  parents: string[],
  pathKeys: string[],
): void {
  const totalKey = field.calculated ? sectionTotalKey(section) : null;
  const source = totalKey ? `${PREFIX}totals.${totalKey}.${field.key}` : `${PREFIX}${sourcePath}.${field.key}`;
  addDefinition(output, source, [...sourceLabelPath, field.label].join(" / "), fieldAliases(section, field, parents, pathKeys));
}

function repeatableAliases(subsectionKey: string, title: string, rowNumber: number, field: DisclosureBookletField): string[] {
  return [
    `${subsectionKey} ${field.key} ${rowNumber}`,
    `${subsectionKey}_${field.key}_${rowNumber}`,
    `${subsectionKey} ${field.label} ${rowNumber}`,
    `${subsectionKey}_${field.label}_${rowNumber}`,
    `${title} ${field.label} ${rowNumber}`,
    `${title} row ${rowNumber} ${field.label}`,
    `${subsectionKey} accounts ${field.key} ${rowNumber}`,
    `${subsectionKey}_accounts_${field.key}_${rowNumber}`,
    `${subsectionKey} accounts ${field.label} ${rowNumber}`,
  ];
}

export function financialDisclosureBookletSourceDefinitions(): SourceDefinition[] {
  const output = [...BASE_SOURCES];
  for (const section of FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA) {
    const sectionTitle = readableTitle(section.title);
    for (const field of section.fields || []) {
      addField(output, section.key, [sectionTitle], section, field, [sectionTitle], [section.key, field.key]);
    }
    for (const field of section.summaryFields || []) {
      addDefinition(
        output,
        `${PREFIX}totals.b.${field.key}`,
        `${sectionTitle} / ${field.label}`,
        fieldAliases(section, field, [sectionTitle, "total", "totals"], [section.key, field.key]),
      );
    }
    for (const subsection of section.subsections || []) {
      const subsectionTitle = readableTitle(subsection.title);
      if (subsection.repeatable && subsection.fields?.length) {
        for (const field of subsection.fields) {
          addDefinition(
            output,
            `${PREFIX}${section.key}.${subsection.key}.${field.key}`,
            `${sectionTitle} / ${subsectionTitle} / ${field.label}`,
            fieldAliases(section, field, [sectionTitle, subsectionTitle], [subsection.key, field.key]),
          );
        }
        for (let rowNumber = 1; rowNumber <= 10; rowNumber++) {
          const answerIndex = rowNumber - 1;
          for (const field of subsection.fields) {
            addDefinition(
              output,
              `${PREFIX}${section.key}.${subsection.key}.${answerIndex}.${field.key}`,
              `${sectionTitle} / ${subsectionTitle} / Row ${rowNumber} / ${field.label}`,
              [
                ...repeatableAliases(subsection.key, subsectionTitle, rowNumber, field),
                `${section.key} ${subsection.key} ${field.key} ${rowNumber}`,
              ],
            );
          }
        }
        continue;
      }

      for (const field of subsection.fields || []) {
        const totalSource = field.calculated && section.key === "b_monthly_expenditure"
          ? `${PREFIX}totals.b.${subsection.key}`
          : `${PREFIX}${section.key}.${subsection.key}.${field.key}`;
        addDefinition(
          output,
          totalSource,
          `${sectionTitle} / ${subsectionTitle} / ${field.label}`,
          fieldAliases(section, field, [sectionTitle, subsectionTitle], [subsection.key, field.key]),
        );
      }

      for (const column of subsection.columns || []) {
        for (let rowNumber = 1; rowNumber <= 10; rowNumber++) {
          const answerIndex = rowNumber - 1;
          addDefinition(
            output,
            `${PREFIX}${section.key}.${subsection.key}.${answerIndex}.${column.key}`,
            `${sectionTitle} / ${subsectionTitle} / Row ${rowNumber} / ${column.label}`,
            [
              ...repeatableAliases(subsection.key, subsectionTitle, rowNumber, column),
              `${section.key} ${subsection.key} ${column.key} ${rowNumber}`,
            ],
          );
        }
      }

      for (const nested of subsection.subsections || []) {
        const nestedTitle = readableTitle(nested.title);
        for (const field of nested.fields || []) {
          const source = field.calculated
            ? `${PREFIX}totals.b.childrenSubtotals.${nested.key}`
            : `${PREFIX}${section.key}.${subsection.key}.${nested.key}.${field.key}`;
          addDefinition(
            output,
            source,
            `${sectionTitle} / ${subsectionTitle} / ${nestedTitle} / ${field.label}`,
            fieldAliases(section, field, [sectionTitle, subsectionTitle, nestedTitle], [subsection.key, nested.key, field.key]),
          );
        }
      }

      if (subsection.totalField) {
        addDefinition(
          output,
          `${PREFIX}totals.b.${subsection.totalField.key}`,
          `${sectionTitle} / ${subsectionTitle} / ${subsection.totalField.label}`,
          fieldAliases(section, subsection.totalField, [sectionTitle, subsectionTitle, "total", "totals"], [subsection.key, subsection.totalField.key]),
        );
      }
    }
  }
  return output;
}

export function financialDisclosureBookletSourceValues(): string[] {
  return financialDisclosureBookletSourceDefinitions().map((definition) => definition.source);
}

function isGenericPdfField(pdfField: string): boolean {
  const normalized = compact(pdfField);
  if (!normalized || GENERIC_FIELD_RE.test(normalized)) return true;
  const fieldWords = words(pdfField);
  return fieldWords.length <= 1 && GENERIC_WORDS.has(fieldWords[0] || "");
}

function scoreAlias(fieldCompact: string, fieldWords: Set<string>, alias: string): number {
  const aliasCompact = compact(alias);
  if (!aliasCompact) return 0;
  if (fieldCompact === aliasCompact) return 1000 + aliasCompact.length;
  if (fieldCompact.endsWith(aliasCompact)) return 850 + aliasCompact.length;
  if (fieldCompact.includes(aliasCompact)) return 650 + aliasCompact.length;

  const aliasWords = words(alias);
  if (aliasWords.length < 2) return 0;
  const allWordsPresent = aliasWords.every((word) => fieldWords.has(word));
  return allWordsPresent ? 420 + aliasWords.join("").length : 0;
}

function bestProposal(candidates: FinancialDisclosureBookletMappingCandidate[]): FinancialDisclosureBookletMappingCandidate | null {
  const top = candidates[0];
  if (!top || top.score < 800) return null;
  const tied = candidates.find((candidate) => candidate.source !== top.source && candidate.score === top.score);
  return tied ? null : top;
}

export function getFinancialDisclosureBookletMappingCandidates(
  pdfField: string,
  limit = 5,
): FinancialDisclosureBookletMappingCandidate[] {
  if (isGenericPdfField(pdfField)) return [];
  const fieldCompact = compact(pdfField);
  const fieldWords = new Set(words(pdfField));
  const bestBySource = new Map<string, FinancialDisclosureBookletMappingCandidate>();
  for (const definition of financialDisclosureBookletSourceDefinitions()) {
    const score = Math.max(...definition.aliases.map((alias) => scoreAlias(fieldCompact, fieldWords, alias)), 0);
    if (score <= 0) continue;
    const existing = bestBySource.get(definition.source);
    if (!existing || score > existing.score) {
      bestBySource.set(definition.source, {
        source: definition.source,
        sourceLabel: definition.sourceLabel,
        score,
      });
    }
  }
  return Array.from(bestBySource.values())
    .sort((a, b) => b.score - a.score || a.sourceLabel.localeCompare(b.sourceLabel))
    .slice(0, limit);
}

export function inferFinancialDisclosureBookletSource(pdfField: string): string | null {
  return bestProposal(getFinancialDisclosureBookletMappingCandidates(pdfField))?.source || null;
}

export function auditFinancialDisclosureBookletMapping(input: {
  fieldNames: string[];
  existingMapping: FinancialDisclosureBookletMappingEntry[];
}): FinancialDisclosureBookletMappingAudit {
  const fieldSet = new Set(input.fieldNames.map(String));
  const allowedSources = new Set(financialDisclosureBookletSourceValues());
  const sourceLabels = new Map(financialDisclosureBookletSourceDefinitions().map((definition) => [definition.source, definition.sourceLabel]));
  const currentByField = new Map((input.existingMapping || []).map((entry) => [entry.pdfField, entry]));
  const staleMappings = (input.existingMapping || []).filter((entry) => !fieldSet.has(entry.pdfField) || !sourceAllowed(entry.source, allowedSources));
  const rows = input.fieldNames.map<FinancialDisclosureBookletMappingAuditRow>((pdfField) => {
    const current = currentByField.get(pdfField);
    const currentSource = current?.source || null;
    const currentSourceValid = currentSource ? sourceAllowed(currentSource, allowedSources) : false;
    const candidates = getFinancialDisclosureBookletMappingCandidates(pdfField);
    const proposal = bestProposal(candidates);
    const proposedSource = proposal?.source || null;
    const sourceLabel = currentSource && sourceLabels.has(currentSource)
      ? sourceLabels.get(currentSource)!
      : proposal?.sourceLabel || null;

    let status: FinancialDisclosureBookletMappingAuditStatus;
    if (currentSource && !currentSourceValid) status = "stale";
    else if (currentSourceValid && proposedSource && currentSource !== proposedSource) status = "stale";
    else if (currentSourceValid || proposedSource) status = "mapped";
    else if (candidates.length > 0) status = "ambiguous";
    else status = "unmapped";

    return {
      pdfField,
      currentSource,
      proposedSource,
      status,
      candidates,
      sourceLabel,
    };
  });

  const summary = rows.reduce<FinancialDisclosureBookletMappingAudit["summary"]>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, { fieldCount: rows.length, mapped: 0, unmapped: 0, stale: 0, ambiguous: 0 });

  return { rows, staleMappings, summary };
}

export function autoRepairFinancialDisclosureBookletMapping(input: {
  fieldNames: string[];
  existingMapping: FinancialDisclosureBookletMappingEntry[];
}): FinancialDisclosureBookletAutoMapResult {
  const audit = auditFinancialDisclosureBookletMapping(input);
  const currentByField = new Map((input.existingMapping || []).map((entry) => [entry.pdfField, entry]));
  const removedStaleMappings = audit.staleMappings.map((entry) => entry.pdfField);
  const fieldMapping: FinancialDisclosureBookletMappingEntry[] = [];
  let createdMappings = 0;
  let preservedMappings = 0;
  const unmappedPdfFields: string[] = [];

  for (const row of audit.rows) {
    const current = currentByField.get(row.pdfField);
    if (current && row.status === "mapped") {
      fieldMapping.push(current);
      preservedMappings++;
      continue;
    }
    if (current && row.status === "stale") removedStaleMappings.push(row.pdfField);
    if (row.proposedSource) {
      fieldMapping.push({
        pdfField: row.pdfField,
        source: row.proposedSource,
        required: current?.required ?? false,
        defaultValue: current?.defaultValue ?? null,
      });
      createdMappings++;
      continue;
    }
    unmappedPdfFields.push(row.pdfField);
  }

  return {
    fieldMapping,
    diagnostics: {
      createdMappings,
      preservedMappings,
      removedStaleMappings: Array.from(new Set(removedStaleMappings)),
      unmappedPdfFields,
    },
    changed: createdMappings > 0 || removedStaleMappings.length > 0,
  };
}
