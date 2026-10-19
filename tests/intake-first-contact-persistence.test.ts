import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../shared/schema";

const servicePath = new URL("../server/services/intake-first-contact.service.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(servicePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Actual service and Drizzle SQL; only the PostgreSQL transport and publication
// boundary are replaced. BEGIN serializes transactions to model the case lock,
// whose presence/order is independently asserted below. This is not a real PG
// concurrency test and never opens a database connection.
function harness(options: { reuse?: boolean; failTable?: string; caseChanges?: Record<string, unknown> } = {}) {
  const now = new Date("2026-09-20T12:00:00Z");
  const queries: string[] = [];
  const events: Array<{ id: string; event: string | undefined }> = [];
  const columns = Object.fromEntries(["cases", "enquiries", "notifications", "auditLogs", "caseActivities"].map((key) => {
    const table = (schema as any)[key];
    return [table[Symbol.for("drizzle:Name")], getTableColumns(table)];
  })) as Record<string, Record<string, { name: string }>>;
  let data: Record<string, Array<Record<string, any>>> = {
    cases: [{ id: "case-1", caseRef: "BFM-TEST", status: "Active", intakeStatus: "Claimed",
      safeguardingStatus: "clear", standardChaseStopped: false, noWhatsappOrVoicemail: false,
      claimedBy: "admin-1", ...options.caseChanges }],
    enquiries: [{ id: "enquiry-1", convertedCaseId: "case-1", status: "Claimed" }],
    notifications: [{ id: "day0", caseId: "case-1", type: "enquiry_follow_up", status: "active", title: "Day 0", message: "First contact", createdAt: now },
      ...(options.reuse ? [{ id: "existing-day5", caseId: "case-1", type: "enquiry_chase", status: "follow_up", title: "Day 5 chase", message: "[day-5]", followUpDate: new Date("2026-09-23T12:00:00Z"), createdAt: now }] : [])],
    audit_logs: [], case_activities: [],
  };
  let snapshot: typeof data;
  let tail = Promise.resolve();
  let release: () => void;
  const keyFor = (table: string, column: string) => Object.keys(columns[table]).find((key) => columns[table][key].name === column)!;
  const row = (table: string, record: Record<string, any>) => Object.keys(columns[table])
    .map((key) => record[key] instanceof Date ? record[key].toISOString().slice(0, -1) : record[key] ?? null);
  const database = drizzle({
    async query(config: string | { text: string }, values: any[] = []) {
      const text = typeof config === "string" ? config : config.text;
      if (text === "begin") {
        const previous = tail;
        tail = new Promise<void>((resolve) => { release = resolve; });
        const unlock = release;
        await previous;
        release = unlock;
        snapshot = structuredClone(data);
      }
      queries.push(text);
      if (text === "rollback") { data = snapshot; release(); return { rows: [] }; }
      if (text === "commit") { release(); return { rows: [] }; }
      if (text === "begin" || /^SELECT 1/.test(text)) return { rows: [] };
      const table = text.match(/(?:from|update|into) "([^"]+)"/)?.[1]!;
      assert.ok(columns[table], `Unexpected SQL: ${text}`);
      if (text.startsWith("insert")) {
        if (table === options.failTable) throw new Error(`${table} failed`);
        const names = text.match(/\((.*?)\) values/)![1].match(/"[^"]+"/g)!.map((name) => name.slice(1, -1));
        const tuples = text.slice(text.indexOf(" values ") + 8).split(" returning ")[0].match(/\([^)]*\)/g)!;
        const inserted = tuples.map((tuple) => {
          const record: Record<string, any> = { id: `${table}-${data[table].length + 1}` };
          tuple.slice(1, -1).split(", ").forEach((value, index) => {
            if (value !== "default") record[keyFor(table, names[index])] = values[Number(value.slice(1)) - 1];
          });
          data[table].push(record);
          return record;
        });
        return { rows: inserted.map((record) => row(table, record)) };
      }
      const where = text.split(" where ")[1] ?? "";
      const predicates = [...where.matchAll(/"[^".]+"\."([^"]+)" (= \$\d+|in \([^)]*\))/g)];
      const selected = data[table].filter((record) => predicates.every((match) => {
        const allowed = [...match[2].matchAll(/\$(\d+)/g)].map((p) => values[Number(p[1]) - 1]);
        return allowed.includes(record[keyFor(table, match[1])]);
      }));
      if (text.startsWith("update")) {
        const assignments = [...text.split(" set ")[1].split(" where ")[0].matchAll(/"([^"]+)" = \$(\d+)/g)];
        for (const record of selected) for (const [, name, parameter] of assignments) record[keyFor(table, name)] = values[Number(parameter) - 1];
      }
      return { rows: selected.map((record) => row(table, record)) };
    },
  } as any, { schema });
  const module = { exports: {} as any };
  const require = createRequire(servicePath);
  runInNewContext(compiled, { exports: module.exports, module, Date,
    require: (name: string) => name === "../db" ? { db: database }
      : name === "@shared/schema" ? schema
        : name === "./notification-realtime.service" ? { notificationRealtimeService: {
          broadcastToNotificationAudience(task: any, event?: string) {
            assert.ok(queries.includes("commit"), "publish must occur after the successful transaction commits");
            events.push({ id: task.id, event });
          },
        } } : require(name),
  });
  const input = { caseId: "case-1", contactMethod: "Direct email", notes: "  First attempt  ",
    actor: { id: "admin-1", name: "Admin", role: "subadmin" }, now };
  return { record: () => module.exports.recordIntakeFirstContact(input), queries, events, state: () => data };
}

test("Day 0 service commits case/enquiry/task/audit/activity writes before publishing", async () => {
  const h = harness();
  const result = await h.record();
  assert.equal(result.ok, true);
  assert.equal(h.queries[0], "begin");
  assert.match(h.queries[1], /SELECT 1 FROM "cases".*FOR UPDATE$/);
  assert.match(h.queries[2], /select.*from "cases"/);
  assert.equal(h.queries.at(-1), "commit");
  assert.equal(h.state().cases[0].firstContactNotes, "First attempt");
  assert.equal(h.state().cases[0].firstContactMethod, "Direct email");
  assert.equal(h.state().enquiries[0].status, "Chasing");
  assert.equal(h.state().notifications[0].status, "completed");
  assert.equal(h.state().notifications[1].followUpDate, "2026-09-25T12:00:00.000Z");
  assert.equal(h.state().audit_logs.length, 2);
  assert.equal(h.state().case_activities.length, 2);
  assert.deepEqual(h.events, [{ id: "day0", event: "notification_updated" }, { id: "notifications-2", event: undefined }]);
});

test("Day 0 service publishes the reused Day 5 update only after commit", async () => {
  const h = harness({ reuse: true });
  const result = await h.record();
  assert.equal(result.ok, true);
  assert.equal(result.createdDay5Task, false);
  assert.equal(h.state().notifications.length, 2);
  assert.equal(h.state().notifications[1].status, "active");
  assert.equal(h.state().notifications[1].followUpDate, "2026-09-25T12:00:00.000Z");
  assert.deepEqual(h.events, [{ id: "day0", event: "notification_updated" }, { id: "existing-day5", event: "notification_updated" }]);
});

test("admin Day 0 during safeguarding preserves restrictions, ownership, status, and actor audit context", async () => {
  const h = harness({ caseChanges: {
    intakeStatus: "Safeguarding",
    safeguardingStatus: "concern",
    standardChaseStopped: true,
    noWhatsappOrVoicemail: true,
    claimedBy: "superadmin-owner",
  } });

  assert.equal((await h.record()).ok, true);
  assert.equal(h.state().cases[0].intakeStatus, "Safeguarding");
  assert.equal(h.state().cases[0].safeguardingStatus, "concern");
  assert.equal(h.state().cases[0].standardChaseStopped, true);
  assert.equal(h.state().cases[0].noWhatsappOrVoicemail, true);
  assert.equal(h.state().cases[0].claimedBy, "superadmin-owner");
  assert.equal(h.state().enquiries[0].status, "Safeguarding");
  assert.deepEqual(JSON.parse(h.state().audit_logs[0].details), {
    contactMethod: "Direct email",
    notes: "First attempt",
    firstContactAttemptedAt: "2026-09-20T12:00:00.000Z",
    safeguardingConcernActive: true,
    claimOwnerId: "superadmin-owner",
    claimBypass: true,
    actorRole: "subadmin",
  });
});

test("serialized concurrent and repeat Day 0 requests conflict without duplicate effects", async () => {
  const h = harness();
  const results = await Promise.all([h.record(), h.record()]);
  assert.deepEqual(results.map((result: any) => result.ok ? 200 : result.status), [200, 409]);
  assert.equal((await h.record()).status, 409);
  assert.equal(h.state().notifications.length, 2);
  assert.equal(h.state().audit_logs.length, 2);
  assert.equal(h.state().case_activities.length, 2);
  assert.equal(h.events.length, 2);
});

for (const failTable of ["audit_logs", "case_activities"]) {
  test(`Day 0 ${failTable} failure rolls back all state and publishes nothing`, async () => {
    const h = harness({ failTable });
    const before = structuredClone(h.state());
    await assert.rejects(h.record(), new RegExp(`${failTable} failed`));
    assert.equal(h.queries.at(-1), "rollback");
    assert.deepEqual(h.state(), before);
    assert.deepEqual(h.events, []);
  });
}
