import assert from "node:assert/strict";
import test from "node:test";
import { occurrenceDates, scheduleOnDate } from "../shared/task-recurrence";

test("daily and weekly repeats use calendar dates including weekends", () => {
  assert.deepEqual(occurrenceDates("2026-10-02", "daily", "2026-10-05"), [
    "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
  ]);
  assert.deepEqual(occurrenceDates("2026-10-02", "weekly", "2026-10-20"), [
    "2026-10-02", "2026-10-09", "2026-10-16",
  ]);
});

test("monthly repeats clamp to the last day and return to the anchor day", () => {
  assert.deepEqual(occurrenceDates("2027-01-31", "monthly", "2027-04-30"), [
    "2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30",
  ]);
});

test("timed occurrences preserve London wall time across daylight saving", () => {
  const base = { kind: "timed" as const, startAt: "2027-03-27T09:00:00.000Z", endAt: "2027-03-27T10:00:00.000Z", reminderMinutes: 30 };
  const next = scheduleOnDate(base, "2027-03-29");
  assert.deepEqual(next, { kind: "timed", startAt: "2027-03-29T08:00:00.000Z", endAt: "2027-03-29T09:00:00.000Z", reminderMinutes: 30 });
});

test("spring clock change moves a nonexistent 01:30 occurrence to 02:30 London time", () => {
  const base = { kind: "timed" as const, startAt: "2027-03-27T01:30:00.000Z", endAt: "2027-03-27T02:30:00.000Z", reminderMinutes: null };
  assert.equal(scheduleOnDate(base, "2027-03-28").startAt, "2027-03-28T01:30:00.000Z");
});

test("a long-running daily series generates only dates after its previous horizon", () => {
  assert.deepEqual(occurrenceDates("2026-10-01", "daily", "2031-10-03", "2031-09-30"), ["2031-10-01", "2031-10-02", "2031-10-03"]);
});
