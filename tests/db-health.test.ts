import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDatabaseHealth } from "../server/db-health";

test("database health check reports connected on successful query", async () => {
  const result = await checkDatabaseHealth({
    query: async (sql: string) => {
      assert.equal(sql, "select 1");
      return { rows: [{ "?column?": 1 }] };
    },
  });

  assert.deepEqual(result, { ok: true });
});

test("database health check reports short safe failure reason", async () => {
  const result = await checkDatabaseHealth({
    query: async () => {
      throw new Error(
        "password authentication failed for user admin@example.com with token abcdefghijklmnopqrstuvwxyz",
      );
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /password authentication failed/);
    assert.doesNotMatch(result.reason, /admin@example.com/);
    assert.ok(result.reason.length <= 140);
  }
});
