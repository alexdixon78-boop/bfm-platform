import { test } from "node:test";
import assert from "node:assert/strict";
import type { Case, Notification } from "../shared/schema";

import * as transition from "../server/services/intake-chase.transition";
const actor = { id: "admin-1", name: "Admin One", role: "subadmin" };
const now = new Date("2026-09-20T12:00:00Z");

function task(id: string, stage: "day5" | "day10" | "weekly", extra: Partial<Notification> = {}): Notification {
  return {
    id, caseId: "case-1", recipientRole: "admin", recipientId: null,
    type: stage === "weekly" ? "enquiry_persistent_follow_up" : "enquiry_chase",
    title: stage === "weekly" ? "Ongoing enquiry follow-up" : stage === "day5" ? "Day 5 chase" : "Day 10 chase",
    message: stage === "weekly" ? "[persistent]" : stage === "day5" ? "[day-5]" : "[day-10]",
    status: "active", urgency: "amber", appointmentId: null, assignedTo: null,
    followUpDate: new Date("2026-10-01T12:00:00Z"), completedAt: null, completedBy: null,
    completionNotes: null, caseNoteRequired: true, createdAt: new Date("2026-09-18T12:00:00Z"),
    ...extra,
  };
}

// The fake replaces only persistence. The production coordinator performs all
// validation, sequencing, writes and publication, against a transactional copy.
function harness(tasks = [task("day5", "day5")], caseChanges = {}) {
  let state = {
    caseRecord: { id: "case-1", caseRef: "BFM-TEST", status: "Active", intakeStatus: "Chasing",
      safeguardingStatus: "clear", standardChaseStopped: false, claimedBy: actor.id,
      firstContactAttemptedAt: new Date("2026-09-18T12:00:00Z"), ...caseChanges } as Case,
    tasks, audits: [] as any[], activities: [] as any[], notes: [] as any[],
  };
  let failAt: string | undefined;
  let queue = Promise.resolve();
  const publications: any[] = [];
  const deps = {
    async transaction(work: (tx: any) => Promise<any>) {
      const preceding = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await preceding;
      const draft = structuredClone(state);
      const check = (operation: string) => { if (failAt === operation) throw new Error(`Failed ${operation}`); };
      try {
        const result = await work({
          async lockCaseAndTasks(caseId: string) {
            assert.equal(caseId, "case-1");
            return { caseRecord: draft.caseRecord, tasks: draft.tasks.map((row) => ({ ...row, assignedUserIds: ["colleague"] })) };
          },
          async updateTask(id: string, values: Partial<Notification>) {
            check("update");
            const row = draft.tasks.find((item) => item.id === id)!;
            Object.assign(row, values);
            return structuredClone(row);
          },
          async createTask(values: Partial<Notification>) {
            check("create");
            const row = { ...task(`new-${draft.tasks.length}`, "day10"), ...values };
            draft.tasks.push(row);
            return row;
          },
          async insertAudit(value: any) { check("audit"); draft.audits.push(value); },
          async insertActivity(value: any) { check("activity"); draft.activities.push(value); },
          async insertNote(value: any) { check("note"); draft.notes.push(value); },
        });
        check("commit");
        state = draft;
        return result;
      } finally { release(); }
    },
    publish(notification: any, event: string) {
      assert.equal(state.tasks.find((row) => row.id === notification.id)?.status, notification.status,
        "publication must observe committed state");
      publications.push({ notification, event });
    },
  };
  return {
    get state() { return state; }, publications,
    fail(operation: string) { failAt = operation; },
    async complete(taskId = tasks[0].id, changes = {}) {
      assert.equal(typeof transition.completeIntakeChaseTransition, "function", "atomic chase transition must exist");
      return transition.completeIntakeChaseTransition({ caseId: "case-1", taskId, actor,
        contactMethod: "Direct email", notes: "  No response; sent reminder.  ", now, ...changes }, deps);
    },
  };
}

test("Day 5 can complete early and schedules Day 10 from canonical Day 0, with atomic note/audit/activity", async () => {
  const h = harness();
  const result = await h.complete();
  assert.equal(result.ok, true);
  assert.equal(result.notification.status, "completed");
  assert.equal(result.notification.completionNotes, "Contact method: Direct email\n\nNo response; sent reminder.");
  const open = h.state.tasks.filter((row) => row.status !== "completed");
  assert.equal(open.length, 1);
  assert.equal(open[0].title, "Day 10 chase — BFM-TEST");
  assert.equal(open[0].followUpDate?.toISOString(), "2026-09-28T12:00:00.000Z");
  assert.deepEqual(h.state.audits.map((row) => row.action), ["case_intake_chase_completed", "case_intake_day10_chase_created"]);
  assert.deepEqual(h.state.activities.map((row) => row.type), ["task_completed", "task_created"]);
  assert.equal(h.state.notes[0].content, result.notification.completionNotes);
  assert.deepEqual(h.publications.map((row) => row.event), ["notification_updated", "notification_created"]);
  assert.deepEqual(h.publications[0].notification.assignedUserIds, ["colleague"]);
});

for (const stage of ["day10", "weekly"] as const) {
  test(`${stage} completion schedules exactly one weekly task seven calendar days after completion`, async () => {
    const h = harness([task("current", stage)]);
    const result = await h.complete();
    assert.equal(result.ok, true);
    const open = h.state.tasks.filter((row) => row.status !== "completed");
    assert.equal(open.length, 1);
    assert.equal(open[0].type, "enquiry_persistent_follow_up");
    assert.equal(open[0].followUpDate?.toISOString(), "2026-09-27T12:00:00.000Z");
    assert.equal(h.state.audits[1].action, "case_intake_persistent_follow_up_created");
    assert.equal(JSON.parse(h.state.audits[1].details).intervalDays, 7);
  });
  test(`${stage} on a legacy case still advances without an unused Day 0 timestamp`, async () => {
    const h = harness([task("current", stage)], { firstContactAttemptedAt: null });
    assert.equal((await h.complete()).ok, true);
    assert.equal(h.state.tasks[1].followUpDate?.toISOString(), "2026-09-27T12:00:00.000Z");
  });
}

test("repeat and concurrent completion return 409 with no additional effects", async () => {
  const h = harness();
  const results = await Promise.all([h.complete(), h.complete()]);
  assert.deepEqual(results.map((result) => result.ok ? 200 : result.status).sort(), [200, 409]);
  const state = structuredClone(h.state);
  const publications = structuredClone(h.publications);
  assert.equal((await h.complete()).status, 409);
  assert.deepEqual(h.state, state);
  assert.deepEqual(h.publications, publications);
});

for (const [name, tasks, taskId] of [
  ["Day 10 before the open Day 5", [task("day5", "day5"), task("day10", "day10")], "day10"],
  ["duplicate Day 5 after a completed Day 5", [task("history", "day5", { status: "completed" }), task("stale", "day5"), task("current", "day10")], "stale"],
  ["Day 10 after weekly work has started", [task("history", "day10", { status: "completed" }), task("stale", "day10"), task("current", "weekly")], "stale"],
  ["a newer duplicate weekly task", [task("current", "weekly"), task("stale", "weekly", { createdAt: new Date("2026-09-19") })], "stale"],
] as const) {
  test(`stale ${name} returns 409 without writes or publication`, async () => {
    const h = harness([...tasks]);
    const before = structuredClone(h.state);
    const result = await h.complete(taskId);
    assert.equal(result.status, 409);
    assert.deepEqual(h.state, before);
    assert.deepEqual(h.publications, []);
  });
}

test("reuses the next task, reconciles other open intake tasks, and preserves completed history", async () => {
  const history = task("history", "day5", { type: "enquiry_follow_up", status: "completed", completionNotes: "Original immutable Day 0" });
  const h = harness([history, task("current", "day5"), task("duplicate", "day5"),
    task("next", "day10", { assignedTo: "colleague", status: "follow_up" }), task("next-duplicate", "day10")]);
  assert.equal((await h.complete("current")).ok, true);
  const open = h.state.tasks.filter((row) => row.status !== "completed");
  assert.deepEqual(open.map((row) => row.id), ["next"]);
  assert.equal(open[0].followUpDate?.toISOString(), "2026-09-28T12:00:00.000Z");
  assert.equal(open[0].assignedTo, "colleague");
  assert.deepEqual(h.state.tasks[0], history);
  assert.equal(h.state.tasks.length, 5);
  assert.deepEqual(h.state.audits.map((row) => row.action), ["case_intake_chase_completed"]);
  assert.deepEqual(h.state.activities.map((row) => row.type), ["task_completed"]);
  assert.equal(h.publications.length, 4);
  assert.ok(h.publications.every((row) => row.event === "notification_updated"));
  assert.ok(h.state.tasks.find((row) => row.id === "duplicate")!.message.includes("[intake-superseded]"));
  assert.equal((await h.complete("next")).ok, true, "superseded duplicate Day 10 history must not skip the real Day 10 action");
  assert.deepEqual(h.state.tasks.filter((row) => row.status !== "completed").map((row) => row.type), ["enquiry_persistent_follow_up"]);
});

test("Day 0 duplicate reconciliation does not make the remaining Day 5 stale", async () => {
  const h = harness([task("completed-duplicate", "day5", {
    status: "completed", completionNotes: "Superseded by the Day 0 first-contact transition.",
  }), task("current", "day5")]);
  assert.equal((await h.complete("current")).ok, true);
});

test("supersession marker preserves progression independently of completion-note wording", async () => {
  const h = harness([task("superseded", "day10", {
    status: "completed", message: "[day-10]\n[intake-superseded]", completionNotes: "Duplicate task removed from active work.",
  }), task("current", "day10")]);
  assert.equal((await h.complete("current")).ok, true);
});

test("arbitrary completion prose is not treated as a supersession marker", async () => {
  const h = harness([task("history", "day5", {
    status: "completed", completionNotes: "Superseded by the telephone conversation; contact was completed.",
  }), task("stale", "day5")]);
  assert.equal((await h.complete("stale")).status, 409);
});

for (const operation of ["update", "create", "note", "audit", "activity", "commit"]) {
  test(`${operation} failure rolls back all transition writes and publishes nothing`, async () => {
    const h = harness();
    const before = structuredClone(h.state);
    h.fail(operation);
    await assert.rejects(h.complete(), new RegExp(`Failed ${operation}`));
    assert.deepEqual(h.state, before);
    assert.deepEqual(h.publications, []);
  });
}

for (const [name, caseChanges, changes, status] of [
  ["closed case", { status: "Closed" }, {}, 400],
  ["archived case", { status: "Archived" }, {}, 400],
  ["closed intake", { intakeStatus: "Closed" }, {}, 400],
  ["stopped standard chase", { standardChaseStopped: true }, {}, 400],
  ["pending safeguarding", { safeguardingStatus: "pending" }, {}, 409],
  ["safeguarding concern for Staff", { safeguardingStatus: "concern" }, { actor: { ...actor, role: "staff" } }, 409],
  ["no claim for Staff", { claimedBy: null }, { actor: { ...actor, role: "staff" } }, 409],
  ["another claimant for Staff", { claimedBy: "other-admin" }, { actor: { ...actor, role: "staff" } }, 409],
  ["no canonical first contact", { firstContactAttemptedAt: null }, {}, 409],
  ["client role", {}, { actor: { ...actor, role: "client" } }, 403],
  ["mediator role", {}, { actor: { ...actor, role: "mediator" } }, 403],
  ["missing method", {}, { contactMethod: "" }, 400],
  ["invalid method", {}, { contactMethod: "Invalid" }, 400],
  ["empty notes", {}, { notes: "  " }, 400],
  ["non-string notes", {}, { notes: 42 }, 400],
] as const) {
  test(`${name} blocks completion before any writes`, async () => {
    const h = harness(undefined, caseChanges);
    const before = structuredClone(h.state);
    assert.equal((await h.complete("day5", changes)).status, status);
    assert.deepEqual(h.state, before);
    assert.deepEqual(h.publications, []);
  });
}

test("admins can complete another claimant's admin task while non-admin audiences remain restricted", async () => {
  const h = harness([task("current", "day5", { recipientRole: "superadmin" })], { claimedBy: "other-admin" });
  assert.equal((await h.complete()).status, 403);
  assert.equal((await h.complete("current", { actor: { ...actor, role: "superadmin" } })).ok, true);
  const restricted = harness([task("current", "day5", { recipientRole: "client", recipientId: "client-1" })]);
  const before = structuredClone(restricted.state);
  assert.equal((await restricted.complete()).status, 403);
  assert.deepEqual(restricted.state, before);
});

test("subadmins can manually advance safeguarding follow-up across claims with actor context audited", async () => {
  const h = harness([task("current", "day5")], {
    intakeStatus: "Safeguarding",
    safeguardingStatus: "concern",
    standardChaseStopped: true,
    claimedBy: "superadmin-owner",
  });

  const result = await h.complete();
  assert.equal(result.ok, true);
  assert.equal(h.state.caseRecord.intakeStatus, "Safeguarding");
  assert.equal(h.state.caseRecord.safeguardingStatus, "concern");
  assert.equal(h.state.caseRecord.standardChaseStopped, true);
  assert.equal(h.state.caseRecord.claimedBy, "superadmin-owner");
  assert.deepEqual(JSON.parse(h.state.audits[0].details), {
    taskId: "current",
    contactMethod: "Direct email",
    notes: "No response; sent reminder.",
    safeguardingConcernActive: true,
    claimOwnerId: "superadmin-owner",
    claimBypass: true,
    actorRole: "subadmin",
  });
});

test("calendar-day due dates preserve local time across the daylight-saving boundary", async () => {
  const oldTimezone = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    const day5 = harness(undefined, { firstContactAttemptedAt: new Date("2026-10-20T11:00:00Z") });
    await day5.complete();
    assert.equal(day5.state.tasks[1].followUpDate?.toISOString(), "2026-10-30T12:00:00.000Z");
    const weekly = harness([task("current", "weekly")]);
    await weekly.complete("current", { now: new Date("2026-10-20T11:00:00Z") });
    assert.equal(weekly.state.tasks[1].followUpDate?.toISOString(), "2026-10-27T12:00:00.000Z");
  } finally {
    if (oldTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = oldTimezone;
  }
});
