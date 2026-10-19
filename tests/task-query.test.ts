import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultTaskQuery,
  parseTaskQuery,
  taskQueryFromSearchParams,
  taskQueryToSearchParams,
} from "../shared/task-query";

test("task query parses repeated facets and an inclusive London date range", () => {
  const query = parseTaskQuery({
    q: "  Smith  ",
    status: ["active", "follow_up"],
    urgency: "red,amber",
    assignedTo: ["staff-1", "staff-2"],
    scheduledFrom: "2030-04-01",
    scheduledTo: "2030-04-30",
    due: "overdue",
    scheduleState: "scheduled",
  });
  assert.deepEqual(query, {
    ...defaultTaskQuery,
    q: "Smith",
    statuses: ["active", "follow_up"],
    urgencies: ["red", "amber"],
    assignedTo: ["staff-1", "staff-2"],
    scheduledFrom: "2030-04-01",
    scheduledTo: "2030-04-30",
    dueState: "overdue",
    scheduleState: "scheduled",
  });
});

test("task query URL round trip preserves filters but omits defaults", () => {
  const initial = parseTaskQuery({ q: "MIAM", type: ["task", "enquiry_chase"], status: "completed", createdFrom: "2030-01-01" });
  const params = taskQueryToSearchParams(initial);
  assert.equal(params.get("q"), "MIAM");
  assert.deepEqual(params.getAll("type"), ["task", "enquiry_chase"]);
  assert.equal(params.getAll("urgency").length, 0);
  assert.deepEqual(taskQueryFromSearchParams(params), initial);
});

test("task query rejects malformed values instead of widening a search", () => {
  assert.throws(() => parseTaskQuery({ q: "x".repeat(121) }), /120/);
  assert.throws(() => parseTaskQuery({ scheduledFrom: "2030-14-50" }), /date/i);
  assert.throws(() => parseTaskQuery({ due: "later" }), /due/i);
});

test("task query supports an explicit all-status view without confusing it with the default open queue", () => {
  assert.deepEqual(parseTaskQuery({ status: "all" }).statuses, ["all"]);
  assert.deepEqual(parseTaskQuery({}).statuses, ["open"]);
  assert.throws(() => parseTaskQuery({ status: ["all", "completed"] }), /cannot be combined/i);
});
