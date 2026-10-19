import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDynamicFollowUpSchedule,
  dynamicFollowUpAudience,
  followUpDateFromInterval,
  followUpIntervalFromDate,
} from "../server/services/intake-dynamic-follow-up";

test("buildDynamicFollowUpSchedule creates an all-day London schedule after the chosen number of days", () => {
  const result = buildDynamicFollowUpSchedule({
    from: new Date("2026-10-09T14:30:00.000Z"),
    intervalDays: 3,
  });

  assert.deepEqual(result, {
    dueAt: new Date("2026-10-11T23:00:00.000Z"),
    followUpDate: "2026-10-12",
    intervalDays: 3,
    schedule: {
      kind: "all_day",
      startDate: "2026-10-12",
      endDateExclusive: "2026-10-13",
      reminderMinutes: 1440,
    },
  });
});

test("date and interval stay synchronized using Europe/London calendar dates", () => {
  const from = new Date("2026-03-29T22:30:00.000Z");

  assert.equal(followUpDateFromInterval(from, 1), "2026-03-30");
  assert.equal(followUpIntervalFromDate(from, "2026-03-30"), 1);

  const result = buildDynamicFollowUpSchedule({
    from,
    intervalDays: 1,
    followUpDate: "2026-03-30",
  });
  assert.equal(result.followUpDate, "2026-03-30");
  assert.equal(result.intervalDays, 1);
  assert.equal(result.dueAt.toISOString(), "2026-03-29T23:00:00.000Z");
});

test("the supplied date is canonical and mismatched or non-future values are rejected", () => {
  const from = new Date("2026-10-09T14:30:00.000Z");

  assert.throws(() => buildDynamicFollowUpSchedule({
    from,
    intervalDays: 2,
    followUpDate: "2026-10-12",
  }), /does not match/i);
  assert.throws(() => buildDynamicFollowUpSchedule({ from, followUpDate: "2026-10-09" }), /future date/i);
  assert.throws(() => buildDynamicFollowUpSchedule({ from, followUpDate: "not-a-date" }), /YYYY-MM-DD/);
});

test("buildDynamicFollowUpSchedule preserves a valid timed window", () => {
  const result = buildDynamicFollowUpSchedule({
    from: new Date("2026-10-09T14:30:00.000Z"),
    intervalDays: 2,
    timeWindow: { startTime: "09:30", endTime: "10:15" },
  });

  assert.equal(result.schedule.kind, "timed");
  assert.equal(result.schedule.startAt.toISOString(), "2026-10-11T08:30:00.000Z");
  assert.equal(result.schedule.endAt.toISOString(), "2026-10-11T09:15:00.000Z");
  assert.equal(result.dueAt.toISOString(), "2026-10-11T08:30:00.000Z");
});

test("buildDynamicFollowUpSchedule rejects zero intervals and invalid time windows", () => {
  assert.throws(() => buildDynamicFollowUpSchedule({ from: new Date("2026-10-09T12:00:00.000Z"), intervalDays: 0 }), /positive whole number/);
  assert.throws(() => buildDynamicFollowUpSchedule({
    from: new Date("2026-10-09T12:00:00.000Z"),
    intervalDays: 1,
    timeWindow: { startTime: "10:00", endTime: "09:00" },
  }), /after the start time/);
  assert.throws(() => buildDynamicFollowUpSchedule({
    from: new Date("2026-10-09T12:00:00.000Z"),
    intervalDays: 1,
    timeWindow: { startTime: "10:00", endTime: "" },
  }), /both a start and end time/i);
});

test("dynamic follow-up audience falls back to admins when no staff are selected", () => {
  assert.deepEqual(dynamicFollowUpAudience([]), {
    recipientRole: "admin",
    assignedTo: null,
    assigneeIds: [],
  });
  assert.deepEqual(dynamicFollowUpAudience([" user-1 ", "user-1", "user-2"]), {
    recipientRole: "task_assignee",
    assignedTo: "user-1",
    assigneeIds: ["user-1", "user-2"],
  });
});

test("due alerts are linked to the source task and protected by a unique idempotency index", () => {
  const service = readFileSync(new URL("../server/services/notification.service.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../migrations/0067_dynamic_intake_due_alert_idempotency.sql", import.meta.url), "utf8");

  assert.match(service, /taskId: sourceTaskId/);
  assert.match(service, /onConflictDoNothing\(\)/);
  assert.match(migration, /UNIQUE INDEX[\s\S]*\("type", "task_id"\)[\s\S]*task_follow_up_due_alert/);
});
