import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveIntakeAction,
  deriveIntakeTaskLoadState,
  getFollowUpTiming,
  selectCompletedIntakeFollowUps,
  selectIntakeTasks,
  selectLatestCompletedIntakeFollowUp,
  type IntakeActionCase,
  type IntakeActionTask,
} from "../client/src/components/enquiry-intake-workflow-card-state";

const now = new Date("2026-09-18T12:00:00.000Z");

function caseData(overrides: Partial<IntakeActionCase> = {}): IntakeActionCase {
  return {
    intakeStatus: "Chasing",
    safeguardingStatus: "clear",
    claimedBy: "admin-1",
    firstContactAttemptedAt: new Date("2026-09-13T12:00:00.000Z"),
    firstContactMethod: "Phone call",
    firstContactNotes: "No answer; voicemail left.",
    ...overrides,
  };
}

function task(id: string, stage: "day5" | "day10" | "weekly", overrides: Partial<IntakeActionTask> = {}): IntakeActionTask {
  return {
    id,
    type: stage === "weekly" ? "enquiry_persistent_follow_up" : "enquiry_chase",
    title: stage === "day5" ? "Day 5 chase" : stage === "day10" ? "Day 10 chase" : "Ongoing enquiry follow-up",
    message: stage === "day5" ? "[day-5]" : stage === "day10" ? "[day-10]" : "[persistent]",
    status: "active",
    followUpDate: new Date("2026-09-23T12:00:00.000Z"),
    createdAt: new Date("2026-09-18T10:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

test("the dynamic card selects open Day 5, then Day 10, then weekly regardless of task ordering", () => {
  const day5 = task("day5", "day5");
  const day10 = task("day10", "day10");
  const weekly = task("weekly", "weekly");

  assert.equal(deriveIntakeAction(caseData(), [weekly, day10, day5], now).kind, "day5");
  assert.equal(deriveIntakeAction(caseData(), [weekly, day10], now).kind, "day10");
  assert.equal(deriveIntakeAction(caseData(), [weekly], now).kind, "weekly");
});

test("Day 0 is current only before it is recorded, then becomes immutable summary data", () => {
  const pending = deriveIntakeAction(caseData({ firstContactAttemptedAt: null, firstContactMethod: null, firstContactNotes: null }), [], now);
  assert.equal(pending.kind, "day0");

  const day5 = task("day5", "day5");
  const completed = deriveIntakeAction(caseData(), [day5], now);
  assert.equal(completed.kind, "day5");
  assert.deepEqual(completed.firstContact, {
    attemptedAt: new Date("2026-09-13T12:00:00.000Z"),
    method: "Phone call",
    notes: "No answer; voicemail left.",
  });
});

test("future-dated follow-ups are still editable and their timing is explicit", () => {
  const upcoming = task("future", "day5", { followUpDate: new Date("2026-09-23T12:00:00.000Z") });
  const today = task("today", "day5", { followUpDate: new Date("2026-09-18T09:00:00.000Z") });
  const overdue = task("late", "day5", { followUpDate: new Date("2026-09-17T12:00:00.000Z") });

  assert.equal(getFollowUpTiming(upcoming, now), "Upcoming");
  assert.equal(getFollowUpTiming(today, now), "Due today");
  assert.equal(getFollowUpTiming(overdue, now), "Overdue");
  assert.equal(deriveIntakeAction(caseData(), [upcoming], now).task?.id, "future");
});

test("completed tasks never become the current action, while weekly history uses an open task before newest completion", () => {
  const completedDay5 = task("done-day5", "day5", { status: "completed", completedAt: new Date("2026-09-16T12:00:00.000Z") });
  const completedWeekly = task("done-weekly", "weekly", { status: "completed", completedAt: new Date("2026-09-17T12:00:00.000Z") });
  const openWeekly = task("open-weekly", "weekly", { followUpDate: new Date("2026-09-25T12:00:00.000Z") });

  assert.equal(deriveIntakeAction(caseData(), [completedDay5], now).kind, "none");
  assert.equal(selectIntakeTasks([completedWeekly, openWeekly]).weekly?.id, "open-weekly");
  assert.equal(selectIntakeTasks([completedWeekly]).weekly?.id, "done-weekly");
});

test("completed follow-ups remain visible newest-first while Day 10 is the current action", () => {
  const day5 = task("day5-completed", "day5", {
    status: "completed",
    completedAt: new Date("2026-09-16T12:00:00.000Z"),
    completedByName: "Sub Admin",
    contactMethod: "Direct email",
    outcomeNotes: "Client replied outside BFM.",
  });
  const olderWeekly = task("weekly-older", "weekly", {
    status: "completed",
    completedAt: new Date("2026-09-15T12:00:00.000Z"),
  });
  const newerWeekly = task("weekly-newer", "weekly", {
    status: "completed",
    completedAt: new Date("2026-09-17T12:00:00.000Z"),
  });
  const day10 = task("day10-open", "day10");

  assert.deepEqual(
    selectCompletedIntakeFollowUps([day10, day5, olderWeekly, newerWeekly]).map((entry) => entry.id),
    ["weekly-newer", "day5-completed", "weekly-older"],
  );
  assert.equal(selectLatestCompletedIntakeFollowUp([day10, day5, olderWeekly, newerWeekly])?.id, "weekly-newer");
  assert.equal(deriveIntakeAction(caseData(), [day5, day10], now).task?.id, "day10-open");
});

test("completed follow-up history excludes Day 0 and superseded duplicates", () => {
  const day0 = task("day0-completed", "day5", {
    type: "enquiry_follow_up",
    stage: "day0",
    status: "completed",
    completedAt: new Date("2026-09-14T12:00:00.000Z"),
  });
  const superseded = task("day5-superseded", "day5", {
    status: "completed",
    completedAt: new Date("2026-09-17T12:00:00.000Z"),
    superseded: true,
  });
  const valid = task("day5-valid", "day5", {
    status: "completed",
    completedAt: new Date("2026-09-16T12:00:00.000Z"),
  });

  assert.deepEqual(selectCompletedIntakeFollowUps([day0, superseded, valid]).map((entry) => entry.id), ["day5-valid"]);
});

test("completed follow-ups use creation time then stable ID when completion times tie", () => {
  const sameCompletion = new Date("2026-09-17T12:00:00.000Z");
  const earlier = task("z-earlier", "day5", {
    status: "completed",
    completedAt: sameCompletion,
    createdAt: new Date("2026-09-15T12:00:00.000Z"),
  });
  const laterB = task("b-later", "day10", {
    status: "completed",
    completedAt: sameCompletion,
    createdAt: new Date("2026-09-16T12:00:00.000Z"),
  });
  const laterA = task("a-later", "weekly", {
    status: "completed",
    completedAt: sameCompletion,
    createdAt: new Date("2026-09-16T12:00:00.000Z"),
  });

  assert.deepEqual(selectCompletedIntakeFollowUps([earlier, laterB, laterA]).map((entry) => entry.id), ["a-later", "b-later", "z-earlier"]);
  assert.equal(selectLatestCompletedIntakeFollowUp([]), undefined);
});

test("completed non-superseded history skips stale earlier-stage work and advances to the legal current stage", () => {
  const completedDay5 = task("done-day5", "day5", { status: "completed", completedAt: new Date("2026-09-16T12:00:00.000Z") });
  const staleOpenDay5 = task("stale-day5", "day5", { createdAt: new Date("2026-09-15T12:00:00.000Z") });
  const currentDay10 = task("current-day10", "day10", { createdAt: new Date("2026-09-16T13:00:00.000Z") });

  const action = deriveIntakeAction(caseData(), [staleOpenDay5, completedDay5, currentDay10], now);
  assert.equal(action.kind, "day10");
  assert.equal(action.task?.id, "current-day10");
});

test("superseded completion markers do not advance task history", () => {
  const supersededDay5 = task("superseded-day5", "day5", {
    status: "completed",
    message: "[day-5]\n[intake-superseded]",
    completionNotes: "Duplicate removed",
  });
  const activeDay5 = task("current-day5", "day5");

  assert.equal(deriveIntakeAction(caseData(), [supersededDay5, activeDay5], now).task?.id, "current-day5");
  assert.equal(deriveIntakeAction(caseData(), [
    task("legacy-superseded-day5", "day5", {
      status: "completed",
      completionNotes: "Superseded by the current intake chase transition.",
    }),
    activeDay5,
  ], now).task?.id, "current-day5");
});

test("the canonical open task is selected by oldest creation time then stable ID, not due date", () => {
  const laterCreatedEarlierDue = task("z-task", "day5", {
    createdAt: new Date("2026-09-17T10:00:00.000Z"),
    followUpDate: new Date("2026-09-19T12:00:00.000Z"),
  });
  const earlierCreatedLaterDue = task("b-task", "day5", {
    createdAt: new Date("2026-09-16T10:00:00.000Z"),
    followUpDate: new Date("2026-09-25T12:00:00.000Z"),
  });
  const sameCreatedLowerId = task("a-task", "day10", { createdAt: new Date("2026-09-16T10:00:00.000Z") });
  const sameCreatedHigherId = task("b-task", "day10", { createdAt: new Date("2026-09-16T10:00:00.000Z") });

  assert.equal(selectIntakeTasks([laterCreatedEarlierDue, earlierCreatedLaterDue]).day5?.id, "b-task");
  assert.equal(selectIntakeTasks([sameCreatedHigherId, sameCreatedLowerId]).day10?.id, "a-task");
});

test("legacy lower-case day labels are classified like the server transition", () => {
  const legacyDay5 = task("legacy-day5", "day5", { title: "legacy day-5 chase", message: "follow up" });
  const legacyDay10 = task("legacy-day10", "day10", { title: "legacy day 10 chase", message: "follow up" });

  assert.equal(selectIntakeTasks([legacyDay5]).day5?.id, "legacy-day5");
  assert.equal(selectIntakeTasks([legacyDay10]).day10?.id, "legacy-day10");
});

test("an ambiguous combined marker follows the server's Day 10 precedence", () => {
  const ambiguous = task("ambiguous", "day5", {
    title: "Legacy chase",
    message: "[day-5] stale text retained alongside [day-10] current text",
  });

  assert.equal(selectIntakeTasks([ambiguous]).day10?.id, "ambiguous");
  assert.equal(selectIntakeTasks([ambiguous]).day5, undefined);
});

test("terminal, safeguarding, claim, and no-open gates take priority over task selection", () => {
  const openDay5 = task("day5", "day5");
  assert.equal(deriveIntakeAction(caseData({ intakeStatus: "Closed" }), [openDay5], now).kind, "terminal");
  assert.equal(deriveIntakeAction(caseData({ status: "Closed", intakeStatus: "Chasing" }), [openDay5], now).kind, "terminal");
  assert.equal(deriveIntakeAction(caseData({ status: "Archived", intakeStatus: "Chasing" }), [openDay5], now).kind, "terminal");
  assert.equal(deriveIntakeAction(caseData({ safeguardingStatus: null }), [openDay5], now).kind, "safeguarding");
  assert.equal(deriveIntakeAction(caseData({ safeguardingStatus: "concern", standardChaseStopped: true }), [openDay5], now).kind, "terminal");
  assert.equal(deriveIntakeAction(caseData({ claimedBy: null }), [openDay5], now).kind, "claim");
  assert.equal(deriveIntakeAction(caseData(), [], now).kind, "none");
});

test("admin mode keeps active safeguarding in the manual Day 0 and chase workflow", () => {
  const concern = { safeguardingStatus: "concern", standardChaseStopped: true } as const;
  assert.equal(deriveIntakeAction(caseData({ ...concern, firstContactAttemptedAt: null }), [], now, { allowSafeguardingWork: true }).kind, "day0");
  assert.equal(deriveIntakeAction(caseData({ ...concern, claimedBy: null, firstContactAttemptedAt: null }), [], now, { allowSafeguardingWork: true }).kind, "day0");
  assert.equal(deriveIntakeAction(caseData(concern), [task("day5", "day5")], now, { allowSafeguardingWork: true }).kind, "day5");
  assert.equal(deriveIntakeAction(caseData(concern), [task("day5", "day5")], now).kind, "terminal");
});

test("task loading distinguishes initial failure from a failed refresh with retained history", () => {
  assert.equal(deriveIntakeTaskLoadState({ hasData: false, isError: false, isFetching: true }), "loading");
  assert.equal(deriveIntakeTaskLoadState({ hasData: false, isError: true, isFetching: false }), "initial_error");
  assert.equal(deriveIntakeTaskLoadState({ hasData: true, isError: true, isFetching: false }), "stale_error");
  assert.equal(deriveIntakeTaskLoadState({ hasData: true, isError: false, isFetching: false }), "ready");
});
