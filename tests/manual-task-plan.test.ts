import assert from "node:assert/strict";
import test from "node:test";
import { manualTaskPlan, occurrenceTaskStatus } from "../shared/manual-task-plan";

test("each selected person receives a distinct occurrence on every repeat date", () => {
  const rows = manualTaskPlan({
    assigneeIds: ["a", "b", "a"], frequency: "weekly", firstDate: "2026-10-01", throughDate: "2026-10-08",
    schedule: { kind: "all_day", startDate: "2026-10-01", endDateExclusive: "2026-10-02", reminderMinutes: null },
  });
  assert.deepEqual(rows.map((row) => [row.assigneeId, row.occurrenceDate]), [
    ["a", "2026-10-01"], ["b", "2026-10-01"], ["a", "2026-10-08"], ["b", "2026-10-08"],
  ]);
});

test("future occurrences stay scheduled until their London calendar date", () => {
  assert.equal(occurrenceTaskStatus("2026-10-02", "2026-10-01"), "scheduled");
  assert.equal(occurrenceTaskStatus("2026-10-02", "2026-10-02"), "active");
});
