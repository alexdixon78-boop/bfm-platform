import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../shared/schema";
import { completeIntakeChaseTransition } from "../server/services/intake-chase.transition";

import * as service from "../server/services/intake-chase.service";

// Exercise actual Drizzle query generation and transaction control with an
// in-memory PostgreSQL transport. No pool, connection string or network is used.
function persistence(failOnActivity = false) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const now = new Date("2026-09-20T12:00:00Z");
  const caseRecord = { id: "case-1", caseRef: "BFM-TEST", status: "Active", intakeStatus: "Chasing",
    safeguardingStatus: "clear", standardChaseStopped: false, claimedBy: "admin-1", firstContactAttemptedAt: now };
  const current = { id: "day5", caseId: "case-1", recipientRole: "admin", type: "enquiry_chase", title: "Day 5 chase",
    message: "[day-5]", status: "active", urgency: "amber", caseNoteRequired: true, createdAt: now };
  const row = (table: any, record: Record<string, unknown>) => Object.keys(getTableColumns(table))
    .map((key) => record[key] instanceof Date ? (record[key] as Date).toISOString().slice(0, -1) : record[key] ?? null);
  const database = drizzle({
    async query(config: string | { text: string }, values: unknown[]) {
      const text = typeof config === "string" ? config : config.text;
      queries.push({ text, values });
      if (text.startsWith('select') && text.includes('from "cases"')) return { rows: [row(schema.cases, caseRecord)] };
      if (text.startsWith('select') && text.includes('from "notifications"')) return { rows: [row(schema.notifications, current)] };
      if (text.startsWith('select') && text.includes('from "notification_assignees"')) return { rows: [] };
      if (text.startsWith('update "notifications"')) return { rows: [row(schema.notifications, { ...current, status: "completed", completedAt: now })] };
      if (text.startsWith('insert into "notifications"')) return { rows: [row(schema.notifications, { ...current, id: "day10", title: "Day 10 chase", message: "[day-10]" })] };
      if (failOnActivity && text.startsWith('insert into "case_activities"')) throw new Error("Activity insert failed");
      return { rows: [] };
    },
  } as any, { schema });
  return { database, queries, input: { caseId: "case-1", taskId: "day5", contactMethod: "Direct email",
    notes: "No reply", actor: { id: "admin-1", name: "Admin One", role: "subadmin" }, now } };
}

test("production persistence locks before reading and commits task/note/audit/activity SQL before publishing", async () => {
  assert.equal(typeof service.createIntakeChaseDependencies, "function", "transactional persistence adapter must exist");
  const h = persistence();
  const events: string[] = [];
  const deps = service.createIntakeChaseDependencies(h.database, (_task: unknown, event: string) => {
    assert.equal(h.queries.at(-1)?.text, "commit");
    events.push(event);
  });
  assert.equal((await completeIntakeChaseTransition(h.input, deps)).ok, true);
  const sql = h.queries.map((query) => query.text);
  assert.equal(sql[0], "begin");
  assert.match(sql[1], /from "cases".*for update$/i);
  assert.match(sql[2], /from "notifications".*for update$/i);
  const completion = h.queries.find((query) => query.text.startsWith('update "notifications"'))!;
  assert.match(completion.text, /"status" in /);
  assert.ok(completion.values.includes("day5"));
  assert.ok(completion.values.includes("active"));
  for (const table of ["notifications", "case_confidential_notes", "audit_logs", "case_activities"]) {
    assert.ok(sql.some((text) => text.startsWith(`insert into "${table}"`)), `${table} must be written inside the transaction`);
  }
  assert.equal(sql.at(-1), "commit");
  assert.deepEqual(events, ["notification_updated", "notification_created"]);
});

test("production persistence emits rollback and no publication when a later SQL write fails", async () => {
  assert.equal(typeof service.createIntakeChaseDependencies, "function", "transactional persistence adapter must exist");
  const h = persistence(true);
  const events: unknown[] = [];
  const deps = service.createIntakeChaseDependencies(h.database, (task: unknown) => events.push(task));
  await assert.rejects(completeIntakeChaseTransition(h.input, deps), /Activity insert failed/);
  assert.equal(h.queries.at(-1)?.text, "rollback");
  assert.equal(h.queries.some((query) => query.text === "commit"), false);
  assert.deepEqual(events, []);
});
