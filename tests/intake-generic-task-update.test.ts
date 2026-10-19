import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../shared/schema";

const servicePath = new URL("../server/services/notification.service.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(servicePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Run the actual service with only external persistence/publication dependencies
// replaced; real Drizzle emits the SQL and maps notification records.
function harness(type: string, status: string, stale = false) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const effects: string[] = [];
  const existing: Record<string, unknown> = {
    id: "task-1", caseId: "case-1", recipientRole: "admin", type, title: "Day 5 chase", message: "[day-5]",
    status, urgency: "amber", caseNoteRequired: true, createdAt: "2026-09-18 12:00:00",
    completionNotes: status === "completed" ? "Contact method: Direct email\n\nOriginal outcome" : null,
    completedAt: status === "completed" ? "2026-09-20 12:00:00" : null,
    completedBy: status === "completed" ? "admin-1" : null,
  };
  const row = () => Object.keys(getTableColumns(schema.notifications)).map((key) => existing[key] ?? null);
  const db = drizzle({
    async query(config: { text: string }, values: unknown[]) {
      const text = config.text;
      queries.push({ text, values });
      if (text.startsWith('select') && text.includes('from "notifications"')) return { rows: [row()] };
      if (text.startsWith('update "notifications"')) {
        if (stale && /where .*"status" =/.test(text)) return { rows: [] };
        effects.push("update");
        return { rows: [row()] };
      }
      if (!text.startsWith("select")) effects.push("assignee/read write");
      return { rows: [] };
    },
  } as any, { schema });
  const dependencies: Record<string, unknown> = {
    "../db": { db }, "@shared/schema": schema,
    "../storage": { storage: {
      async getUser(id: string) { return { id, role: "subadmin", name: "Colleague", status: "active" }; },
      async createConfidentialNote() { effects.push("case note"); },
    } },
    "./case-activity.service": {
      staffActor: (user: unknown) => user, systemActor: () => ({}),
      caseActivityService: {
        async logTaskCompleted() { effects.push("completion activity"); },
        async logTaskAssigned() { effects.push("assignment activity"); },
        async logTaskStatusChanged() { effects.push("status activity"); },
      },
    },
    "./notification-realtime.service": { notificationRealtimeService: {
      broadcastToNotificationAudience() { effects.push("publish"); },
    } },
  };
  const module = { exports: {} as any };
  const require = createRequire(servicePath);
  runInNewContext(compiled, { exports: module.exports, module,
    require: (name: string) => dependencies[name] ?? require(name) });
  return { queries, effects, service: module.exports.notificationService };
}

const user = { id: "admin-1", name: "Admin One", role: "subadmin" };
for (const type of ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up"]) {
  for (const [status, next] of [["completed", "active"], ["active", "completed"], ["active", "follow_up"]]) {
    test(`generic ${type} ${status} → ${next} is rejected before any effects`, async () => {
      const h = harness(type, status);
      const result = await h.service.updateTask("task-1", user, {
        status: next, completionNotes: "New outcome", caseNote: "New outcome", followUpDate: "2026-10-01",
      });
      assert.equal(result.error, "invalid_transition");
      assert.deepEqual(h.effects, []);
    });
  }
}

test("generic completed intake cannot change completion details or historical due date", async () => {
  for (const updates of [{ completionNotes: "Rewritten" }, { caseNote: "Rewritten" }, { followUpDate: "2026-12-01" }]) {
    const h = harness("enquiry_chase", "completed");
    assert.equal((await h.service.updateTask("task-1", user, updates)).error, "invalid_transition");
    assert.deepEqual(h.effects, []);
  }
});

test("stale generic intake assignment returns invalid_transition without assignment/activity/publication effects", async () => {
  const h = harness("enquiry_chase", "active", true);
  const result = await h.service.updateTask("task-1", user, { assignedUserIds: ["colleague"] });
  assert.equal(result.error, "invalid_transition");
  assert.equal(result.notification, undefined);
  assert.deepEqual(h.effects, []);
  const update = h.queries.find((query) => query.text.startsWith('update "notifications"'))!;
  assert.match(update.text, /where .*"id" = .*and "notifications"\."status" =/);
  assert.equal(update.values.at(-1), "active");
});

test("safe intake assignment remains available and ordinary task status changes remain supported", async () => {
  const intake = harness("enquiry_chase", "active");
  assert.equal((await intake.service.updateTask("task-1", user, { assignedUserIds: ["colleague"] })).error, undefined);
  assert.deepEqual(intake.effects, ["update", "assignment activity", "assignee/read write", "assignee/read write", "publish"]);
  const ordinary = harness("manual", "completed");
  assert.equal((await ordinary.service.updateTask("task-1", user, { status: "active" })).error, undefined);
  assert.ok(ordinary.effects.includes("update"));
});

test("a stale ordinary completion writes no completion note or activity", async () => {
  const h = harness("manual", "active", true);
  assert.equal((await h.service.updateTask("task-1", user, { status: "completed", caseNote: "Attempted outcome" })).error, "invalid_transition");
  assert.deepEqual(h.effects, []);
});
