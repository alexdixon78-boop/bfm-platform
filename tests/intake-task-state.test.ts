import { test } from "node:test";
import assert from "node:assert/strict";

import * as state from "../server/services/intake-task-state";

for (const [source, expectedNotes] of [
  ["day0", "Superseded by the Day 0 first-contact transition."],
  ["chase", "Superseded by the current intake chase transition."],
] as const) {
  test(`${source} supersession writes the stable marker while keeping the existing completion notes`, () => {
    assert.equal(typeof state.supersededIntakeTaskUpdate, "function");
    const values = state.supersededIntakeTaskUpdate({ message: "[day-5] Original task text" }, source, "admin-1", new Date("2026-09-20"));
    assert.equal(values.status, "completed");
    assert.equal(values.completedBy, "admin-1");
    assert.equal(values.message, "[day-5] Original task text\n[intake-superseded]");
    assert.equal(values.completionNotes, expectedNotes);
    assert.equal(state.isSupersededIntakeTask({ ...values, completionNotes: "Wording can change" }), true);
    assert.equal(state.isSupersededIntakeTask({ message: "[day-5]", completionNotes: expectedNotes }), true,
      "already-persisted exact legacy values retain compatibility");
  });
}
