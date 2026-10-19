import test from "node:test";
import assert from "node:assert/strict";

import {
  canReadIntakeWorkflowTasks,
  listIntakeWorkflowTasks,
  type IntakeWorkflowTaskRow,
} from "../server/services/intake-workflow-query.service";

const day5Completed: IntakeWorkflowTaskRow = {
  id: "day5-completed",
  type: "enquiry_chase",
  status: "completed",
  title: "Day 5 chase — BFM-TEST",
  message: "[day-5] Follow-up",
  followUpDate: new Date("2026-10-05T09:00:00Z"),
  createdAt: new Date("2026-10-01T09:00:00Z"),
  completedAt: new Date("2026-10-06T10:30:00Z"),
  completedBy: "subadmin-1",
  completedByName: "Sub Admin",
  completionNotes: "Contact method: Direct email\n\nClient replied outside BFM.",
};

const day10Open: IntakeWorkflowTaskRow = {
  id: "day10-open",
  type: "enquiry_chase",
  status: "active",
  title: "Day 10 chase — BFM-TEST",
  message: "[day-10] Final chase",
  followUpDate: new Date("2026-10-11T09:00:00Z"),
  createdAt: new Date("2026-10-06T10:30:00Z"),
  completedAt: null,
  completedBy: null,
  completedByName: null,
  completionNotes: null,
};

test("completed Day 5 and open Day 10 are returned together as an allowlisted projection", async () => {
  const result = await listIntakeWorkflowTasks("case-1", {
    listRows: async () => [day10Open, day5Completed],
  });

  assert.deepEqual(result, [
    {
      id: "day5-completed",
      stage: "day5",
      status: "completed",
      title: "Day 5 chase — BFM-TEST",
      dueAt: new Date("2026-10-05T09:00:00Z"),
      createdAt: new Date("2026-10-01T09:00:00Z"),
      completedAt: new Date("2026-10-06T10:30:00Z"),
      completedBy: "subadmin-1",
      completedByName: "Sub Admin",
      contactMethod: "Direct email",
      outcomeNotes: "Client replied outside BFM.",
      superseded: false,
      intervalDays: null,
    },
    {
      id: "day10-open",
      stage: "day10",
      status: "active",
      title: "Day 10 chase — BFM-TEST",
      dueAt: new Date("2026-10-11T09:00:00Z"),
      createdAt: new Date("2026-10-06T10:30:00Z"),
      completedAt: null,
      completedBy: null,
      completedByName: null,
      contactMethod: null,
      outcomeNotes: null,
      superseded: false,
      intervalDays: null,
    },
  ]);
});

test("superseded rows are identified and malformed chase rows are omitted", async () => {
  const result = await listIntakeWorkflowTasks("case-1", {
    listRows: async () => [
      {
        ...day5Completed,
        id: "superseded",
        message: "[day-5] Follow-up\n[intake-superseded]",
        completionNotes: "Superseded by the current intake chase transition.",
      },
      { ...day5Completed, id: "malformed", title: "Follow up", message: "Follow up" },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "superseded");
  assert.equal(result[0].superseded, true);
  assert.equal(result[0].contactMethod, null);
  assert.equal(result[0].outcomeNotes, null);
});

test("admin roles read across claims while Staff remain claim-bound", () => {
  const claimed = { claimedBy: "superadmin-owner" };
  assert.equal(canReadIntakeWorkflowTasks({ id: "superadmin-2", role: "superadmin" }, claimed), true);
  assert.equal(canReadIntakeWorkflowTasks({ id: "subadmin-1", role: "subadmin" }, claimed), true);
  assert.equal(canReadIntakeWorkflowTasks({ id: "staff-owner", role: "staff" }, { claimedBy: "staff-owner" }), true);
  assert.equal(canReadIntakeWorkflowTasks({ id: "staff-2", role: "staff" }, claimed), false);
  assert.equal(canReadIntakeWorkflowTasks({ id: "staff-2", role: "staff" }, { claimedBy: null }), false);
});

test("mediators and clients cannot read internal intake history", () => {
  assert.equal(canReadIntakeWorkflowTasks({ id: "mediator-1", role: "mediator" }, { claimedBy: "mediator-1" }), false);
  assert.equal(canReadIntakeWorkflowTasks({ id: "client-1", role: "client" }, { claimedBy: "client-1" }), false);
});
