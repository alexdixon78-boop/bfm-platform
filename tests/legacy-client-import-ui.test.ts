import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cn } from "../client/src/lib/utils";

const {
  legacyImportDialogContentClassName,
  legacyImportLoaderClassName,
} = await import(
  "../client/src/components/clients/legacy-client-import-dialog"
);

const page = readFileSync(
  new URL("../client/src/pages/clients.tsx", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL(
    "../client/src/components/clients/legacy-client-import-dialog.tsx",
    import.meta.url,
  ),
  "utf8",
);
const history = readFileSync(
  new URL(
    "../client/src/components/clients/legacy-crm-history-panel.tsx",
    import.meta.url,
  ),
  "utf8",
);
const caseDetail = readFileSync(
  new URL("../client/src/pages/case-detail.tsx", import.meta.url),
  "utf8",
);

test("clients page exposes the legacy import action to administrators", () => {
  assert.match(page, /Import legacy clients/);
  assert.match(page, /LegacyClientImportDialog/);
  assert.match(page, /isAdmin/);
});

test("legacy import dialog provides upload, mapping, review, and confirmation stages", () => {
  for (const label of ["Upload", "Mapping", "Review", "Confirm"])
    assert.match(dialog, new RegExp(label));
  for (const tab of ["Ready", "Possible duplicates", "Errors", "Skipped"])
    assert.match(dialog, new RegExp(tab));
  assert.match(dialog, /Use existing/);
  assert.match(dialog, /Create new/);
  assert.match(dialog, /Skip/);
  assert.match(dialog, /Reading and checking workbook/);
  assert.match(dialog, /Preparing import preview/);
  assert.match(dialog, /Importing clients/);
  assert.match(dialog, /Select all visible/);
  assert.match(dialog, /Skip all previously imported/);
  assert.match(dialog, /CRM field/);
  assert.match(dialog, /Excel column/);
  assert.match(dialog, /Importing records/);
  assert.match(dialog, /25/);
});

test("legacy import review warning is informational and does not disable the confirmation action", () => {
  assert.match(dialog, /This workbook was previously imported as batch/);
  assert.doesNotMatch(dialog, /disabled=\{.*preview\.previousBatch/);
  assert.doesNotMatch(dialog, /!!preview\.previousBatch/);
});

test("legacy import modal preserves fixed viewport positioning with a contained loader", () => {
  const mergedClasses = cn(
    "fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]",
    legacyImportDialogContentClassName,
  );
  assert.match(mergedClasses, /(?:^|\s)fixed(?:\s|$)/);
  assert.doesNotMatch(mergedClasses, /(?:^|\s)relative(?:\s|$)/);
  assert.match(legacyImportLoaderClassName, /(?:^|\s)absolute(?:\s|$)/);
  assert.match(legacyImportLoaderClassName, /(?:^|\s)inset-0(?:\s|$)/);
});

test("client drawer includes a lazy read-only legacy history panel", () => {
  assert.match(page, /LegacyCrmHistoryPanel/);
  assert.match(history, /legacy-history/);
  assert.match(history, /Legacy CRM history/);
  assert.match(history, /Linked BFM case/);
  assert.match(history, /caseRef/);
  assert.match(history, /Original source/);
  assert.match(history, /Reviewed import/);
});

test("legacy import dialog and case detail surface imported legacy cases", () => {
  assert.match(dialog, /legacyCasesToCreate/);
  assert.match(dialog, /Legacy cases/);
  assert.match(dialog, /legacyCasesCreated/);
  assert.match(caseDetail, /badge-case-legacy/);
  assert.match(caseDetail, /Legacy case number/);
  assert.match(caseDetail, /legacyCaseNumber/);
});
