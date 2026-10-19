import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../client/src/pages/audit-log.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../server/routes/audit-log.routes.ts", import.meta.url), "utf8");
const repository = readFileSync(new URL("../server/repositories/audit-log.repository.ts", import.meta.url), "utf8");

test("audit page loads distinct searchable options with protected API", () => {
  assert.match(page, /\/api\/audit-logs\/options/);
  assert.match(page, /CommandInput/);
  assert.match(page, /options\?\.actions/);
  assert.match(page, /options\?\.entities/);
  assert.match(route, /\/api\/audit-logs\/options", requirePermission\("audit_log", "view"\)/);
  assert.match(repository, /selectDistinct/);
});

test("audit page includes date range, full details, and distinct error and empty states", () => {
  assert.match(page, /startDate/);
  assert.match(page, /endDate/);
  assert.match(page, /type="date"/);
  assert.match(page, /View details/);
  assert.match(page, /parseAuditDetails/);
  assert.match(page, /isError/);
  assert.match(page, /refetch/);
  assert.match(page, /No matching audit entries/);
});

test("audit repository uses deterministic paging and one WHERE for count and rows", () => {
  assert.match(repository, /const where = buildAuditLogWhere\(params\)/);
  assert.match(repository, /orderBy\(desc\(auditLogs\.timestamp\), desc\(auditLogs\.id\)\)/);
  assert.equal(repository.match(/\.where\(where\)/g)?.length, 2);
});
