import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildAuditLogWhere } from "../server/repositories/audit-log-query";

const dialect = new PgDialect();

function querySql(input: Parameters<typeof buildAuditLogWhere>[0]) {
  const where = buildAuditLogWhere(input);
  assert.ok(where);
  return dialect.sqlToQuery(where);
}

test("audit search uses actor name and escapes literal wildcard text", () => {
  const { sql, params } = querySql({ search: "  Ann%_\\  " });
  assert.match(sql, /users"\."name"/);
  assert.match(sql, /entity_ref/);
  assert.match(sql, /details/);
  assert.match(sql, /ESCAPE/);
  assert.ok(params.includes("%Ann\\%\\_\\\\%"));
});

test("audit search matches human-readable action and entity labels", () => {
  const { sql, params } = querySql({ search: "Invite Sent" });
  assert.match(sql, /replace\(/i);
  assert.ok(params.includes("%Invite Sent%"));
});

test("audit filters combine exact action/entity with a UK half-open date range", () => {
  const { sql, params } = querySql({
    action: "invite_sent", entity: "user", startDate: "2030-03-31", endDate: "2030-03-31",
  });
  assert.match(sql, /"action" =/);
  assert.match(sql, /"entity" =/);
  assert.match(sql, /"timestamp" >=/);
  assert.match(sql, /"timestamp" </);
  assert.ok(params.includes("invite_sent"));
  assert.ok(params.includes("user"));
  assert.ok(params.includes("2030-03-31T00:00:00.000Z"));
  assert.ok(params.includes("2030-03-31T23:00:00.000Z"));
});
