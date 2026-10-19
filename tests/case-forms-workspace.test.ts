import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CASE_FORM_CATEGORIES, CASE_FORM_TYPES, FORM_CATEGORY_BY_TYPE } from "../shared/court-form-catalog";

const caseForms = readFileSync(new URL("../client/src/components/case-progress/documents-court-forms-section.tsx", import.meta.url), "utf8");
const formsPage = readFileSync(new URL("../client/src/pages/court-forms.tsx", import.meta.url), "utf8");
const generationService = readFileSync(new URL("../server/services/court-form-generation.service.ts", import.meta.url), "utf8");

test("case Forms workspace uses the shared Court Forms and Mediation Documents categories", () => {
  assert.deepEqual(CASE_FORM_CATEGORIES.map((category) => category.label), ["Court Forms", "Mediation Documents"]);
  assert.deepEqual(CASE_FORM_TYPES.filter((type) => FORM_CATEGORY_BY_TYPE[type] === "court"), ["FM1", "C100", "FormA", "FormE"]);
  assert.match(caseForms, />\s*Forms\s*</);
  assert.match(caseForms, /CASE_FORM_CATEGORIES\.map/);
  assert.match(caseForms, /FORM_CATEGORY_BY_TYPE\[form\.id\] === activeFormCategory/);
  assert.match(formsPage, /FORM_CATALOGUE/);
  assert.match(formsPage, /FORM_CATEGORIES/);
});

test("case form mutations require an admin or the exact case lead", () => {
  const mutationGuard = generationService.slice(
    generationService.indexOf("async function assertCaseEditAccess"),
    generationService.indexOf("type CourtFormReadiness"),
  );
  assert.match(caseForms, /const canManageCaseForms = user\?\.role === "superadmin" \|\| user\?\.role === "subadmin" \|\| \(user\?\.role === "mediator" && caseLeadMediatorId === user\.id\)/);
  assert.doesNotMatch(caseForms, /const canManage = canEdit\("court_forms"\)/);
  assert.match(caseForms, /disabled=\{!canManageCaseForms \|\| !selectedReadiness\?\.canGenerate/);
  assert.match(mutationGuard, /caseRecord\.mediatorId === actor\.id/);
  assert.doesNotMatch(mutationGuard, /hasFullOperationalCaseAccess/);
});
