import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routes = readFileSync(new URL("../server/routes/client.routes.ts", import.meta.url), "utf8");
const clientService = readFileSync(new URL("../server/services/client.service.ts", import.meta.url), "utf8");
const importService = readFileSync(new URL("../server/services/legacy-client-import.service.ts", import.meta.url), "utf8");
const openCaseHelpers = readFileSync(new URL("../server/services/legacy-client-import.open-cases.ts", import.meta.url), "utf8");

test("client routes expose inspect, preview, commit, and history endpoints", () => {
  assert.match(routes, /legacy-import\/inspect/);
  assert.match(routes, /legacy-import\/preview/);
  assert.match(routes, /legacy-import\/commit/);
  assert.match(routes, /:id\/legacy-history/);
  assert.match(routes, /\["superadmin", "subadmin"\]\.includes\(actor\.role\)/);
  assert.match(routes, /Only superadmins and subadmins can import legacy clients/);
});

test("orphan deletion refuses clients that retain legacy CRM history", () => {
  assert.match(clientService, /hasLegacyClientHistory/);
  assert.match(clientService, /legacy CRM history/);
});

test("commit is transactional and writes only legacy cases plus client history", () => {
  assert.match(importService, /db\.transaction/);
  assert.match(importService, /\.for\("update"\)/);
  const schemaImport = importService.match(/import \{\n([\s\S]*?)\n\} from "@shared\/schema";/)?.[1] || "";
  assert.match(schemaImport, /\bcases\b/);
  assert.match(schemaImport, /\bparties\b/);
  for (const forbidden of ["enquiries", "users", "notifications", "appointments"]) {
    assert.doesNotMatch(schemaImport, new RegExp(`\\b${forbidden}\\b`));
  }
});

test("legacy import service creates fresh BFM cases for exact open statuses only", () => {
  assert.match(importService, /isLegacyOpenCaseStatus/);
  assert.match(openCaseHelpers, /String\(status \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "open"/);
  assert.match(importService, /getNextCaseRefTx/);
  assert.match(importService, /legacySourceSystem: "owner_old_crm"/);
  assert.match(importService, /legacyCaseNumber: legacyReference/);
  assert.match(importService, /role: person\.sourceRole === "client_1" \? "A" : "B"/);
  assert.match(importService, /legacyCasesCreated/);
});
