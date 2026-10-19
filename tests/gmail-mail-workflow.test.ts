/**
 * Source-level regression coverage for Mail Inbox triage workflow.
 *
 * Run with: npx tsx tests/gmail-mail-workflow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema and bootstrap support mail triage workflow fields", () => {
  const schemaSource = read("../shared/schema.ts");
  const indexSource = read("../server/routes/index.ts");

  for (const field of ["archivedAt", "deletedAt", "needsActionAt", "lastActionBy"]) {
    assert.match(schemaSource, new RegExp(`${field}:`), `${field} should exist in gmailMessages`);
  }
  for (const column of ["archived_at", "deleted_at", "needs_action_at", "last_action_by"]) {
    assert.match(indexSource, new RegExp(column), `${column} should be bootstrapped`);
  }
});

test("mail service supports filters, local search, single status actions, bulk actions and imported preview flags", () => {
  const serviceSource = read("../server/services/gmail-mail.service.ts");

  assert.match(serviceSource, /type MailStatusFilter = "all" \| "unconverted" \| "needs_action" \| "converted" \| "archived" \| "deleted"/);
  assert.match(serviceSource, /listImported\(status: MailStatusFilter = "all", search = ""\)/);
  assert.match(serviceSource, /status === "all"\s*\?\s*ne\(gmailMessages\.status, "deleted"\)/);
  assert.match(serviceSource, /ilike\(gmailMessages\.fromEmail/);
  assert.match(serviceSource, /ilike\(gmailMessages\.subject/);
  assert.match(serviceSource, /ilike\(gmailMessages\.snippet/);
  assert.match(serviceSource, /markWorkflowStatus/);
  assert.match(serviceSource, /bulkWorkflowAction/);
  assert.match(serviceSource, /previewWithImportState/);
  assert.match(serviceSource, /alreadyImported/);
  assert.match(serviceSource, /importedMailId/);
});

test("mail routes expose search listing plus single and bulk workflow actions with audit logs", () => {
  const routeSource = read("../server/routes/mail.routes.ts");

  assert.match(routeSource, /req\.query\.search/);
  assert.match(routeSource, /normaliseStatus\(req\.query\.status \|\| "all"\)/);
  for (const route of [
    "archive",
    "restore",
    "delete",
    "needs-action",
  ]) {
    assert.match(routeSource, new RegExp(`router\\.post\\("\\/api\\/mail\\/messages\\/:id\\/${route}"`));
  }
  assert.match(routeSource, /router\.post\("\/api\/mail\/messages\/bulk"/);
  assert.match(routeSource, /bulkWorkflowAction/);
  assert.match(routeSource, /logAudit/);
});

test("mail inbox renders production triage layout and CRUD actions", () => {
  const pageSource = read("../client/src/pages/mail-inbox.tsx");

  assert.match(pageSource, /useState<MailStatusFilter>\("all"\)/);
  assert.match(pageSource, /mailListKey\(statusFilter, importedSearch\)/);
  assert.match(pageSource, /Sheet/);
  assert.match(pageSource, /Open Gmail Pull/);
  assert.match(pageSource, /Search imported mail/);
  assert.match(pageSource, /Needs Action/);
  assert.match(pageSource, /Deleted/);
  assert.match(pageSource, /Archive selected/);
  assert.match(pageSource, /Delete selected/);
  assert.match(pageSource, /Restore selected/);
  assert.match(pageSource, /Import and open/);
  assert.match(pageSource, /Clear preview/);
  assert.match(pageSource, /Already in CRM/);
  assert.match(pageSource, /Imported then deleted/);
  assert.match(pageSource, /DeleteDialog/);
  assert.doesNotMatch(pageSource, /window\.confirm/);
  assert.match(pageSource, /Copy sender email/);
  assert.match(pageSource, /Mark needs action/);
  assert.match(pageSource, /Clear needs action/);
  assert.match(pageSource, /Archive/);
  assert.match(pageSource, /Restore/);
  assert.match(pageSource, /Delete/);
  assert.match(pageSource, /getApiErrorMessage\(error,\s*"mailAction"\)/);
});
