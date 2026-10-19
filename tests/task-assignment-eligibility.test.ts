import assert from "node:assert/strict";
import test from "node:test";
import { eligibleCaseTaskAssignees } from "../server/services/manual-task-policy";

const people = [
  { id: "admin", role: "superadmin", status: "active" },
  { id: "staff", role: "staff", status: "active" },
  { id: "lead", role: "mediator", status: "active" },
  { id: "outside", role: "mediator", status: "active" },
  { id: "inactive", role: "mediator", status: "inactive" },
];

test("case-linked tasks only allow mediators with access, plus superadmin when no lead", () => {
  assert.deepEqual(eligibleCaseTaskAssignees(people, new Set(["lead"]), "admin", true), ["lead"]);
  assert.deepEqual(eligibleCaseTaskAssignees(people, new Set(["lead"]), "admin", false), ["admin", "lead"]);
});
