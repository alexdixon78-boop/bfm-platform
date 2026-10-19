/**
 * Regression checks for the Cases list type/subtype display.
 *
 * Run with: npx tsx tests/cases-listing.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const casesPage = readFileSync(new URL("../client/src/pages/cases.tsx", import.meta.url), "utf8");

test("cases list derives case subtype from the category-specific subtype field", () => {
  assert.match(casesPage, /function caseSubtype\(c: CaseWithParties\): string/);
  assert.match(casesPage, /case "Family":[\s\S]*return c\.familySubType \|\| ""/);
  assert.match(casesPage, /case "Workplace":[\s\S]*return c\.workplaceSubType \|\| ""/);
  assert.match(casesPage, /case "Civil":[\s\S]*return c\.civilSubType \|\| ""/);
  assert.match(casesPage, /case "Commercial":[\s\S]*return c\.commercialSubType \|\| ""/);
  assert.match(casesPage, /case "Other":[\s\S]*return c\.otherSubType \|\| ""/);
});

test("cases list renders case type and subtype in the table row", () => {
  assert.match(casesPage, /SortableTableHead label="Case type" sortKey="issueType"/);
  assert.match(casesPage, /const typeLabel = caseType\(c\)/);
  assert.match(casesPage, /const subtypeLabel = caseSubtype\(c\)/);
  assert.match(casesPage, /data-testid=\{`text-case-type-\$\{c\.id\}`\}/);
  assert.match(casesPage, /data-testid=\{`text-case-subtype-\$\{c\.id\}`\}/);
  assert.match(casesPage, /subtypeLabel \|\| "No subtype"/);
});

test("About Cases provides expandable operational guidance for financial disclosure, draft schedules, and CIM", () => {
  assert.match(casesPage, /Accordion, AccordionContent, AccordionItem, AccordionTrigger/);
  assert.match(casesPage, /Financial Disclosure/);
  assert.match(casesPage, /Property &amp; finance \(PF\)/);
  assert.match(casesPage, /All issues mediation \(AIM\)/);
  assert.match(casesPage, /Draft Financial Schedule/);
  assert.match(casesPage, /eligible confirmed Family PF\/AIM mediation session/);
  assert.match(casesPage, /Mediation Sessions tab/);
  assert.match(casesPage, /accepted co-mediators/);
  assert.match(casesPage, /both parties are present/i);
  assert.match(casesPage, /Only the session lead can submit/);
  assert.match(casesPage, /post-session summary/);
  assert.match(casesPage, /cancelled or replaced session is archived/);
  assert.doesNotMatch(casesPage, /From <span className="font-medium text-foreground">Financial Disclosure<\/span>, open <span className="font-medium text-foreground">Combined booklet<\/span>/);
  assert.match(casesPage, /CIM eligibility/);
  assert.match(casesPage, /CF10/);
  assert.match(casesPage, /CF12/);
  assert.match(casesPage, /Only superadmins and subadmins can record consent and mark a case CIM eligible/);
});
