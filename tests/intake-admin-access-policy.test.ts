import test from "node:test";
import assert from "node:assert/strict";

import * as policy from "../server/services/intake-access-policy";

test("superadmins and subadmins can work across intake claims without changing ownership", () => {
  const claimed = { claimedBy: "superadmin-owner" };

  assert.deepEqual(policy.validateIntakeWorker(claimed, { id: "superadmin-2", role: "superadmin" }), { ok: true });
  assert.deepEqual(policy.validateIntakeWorker(claimed, { id: "subadmin-1", role: "subadmin" }), { ok: true });
  assert.equal(claimed.claimedBy, "superadmin-owner");
});

test("ordinary Staff remain restricted to their own claimed intake", () => {
  assert.deepEqual(
    policy.validateIntakeWorker({ claimedBy: "staff-owner" }, { id: "staff-2", role: "staff" }),
    { ok: false, status: 409, message: "This enquiry is claimed by another staff member" },
  );
  assert.deepEqual(
    policy.validateIntakeWorker({ claimedBy: null }, { id: "staff-2", role: "staff" }),
    { ok: false, status: 409, message: "Please claim this enquiry before working on it" },
  );
});

test("both admin roles can work safeguarding across claims while Staff cannot", () => {
  const claimed = { claimedBy: "superadmin-owner" };
  assert.deepEqual(policy.validateSafeguardingWorker(claimed, { id: "subadmin-1", role: "subadmin" }), { ok: true });
  assert.deepEqual(
    policy.validateSafeguardingWorker(claimed, { id: "staff-2", role: "staff" }),
    { ok: false, status: 409, message: "This enquiry is claimed by another staff member" },
  );
});

test("clearing safeguarding restores chasing after first contact and otherwise preserves claim state", () => {
  assert.equal(policy.intakeStatusAfterSafeguardingClear({ firstContactAttemptedAt: new Date(), claimedBy: "admin-1" }), "Chasing");
  assert.equal(policy.intakeStatusAfterSafeguardingClear({ firstContactAttemptedAt: null, claimedBy: "admin-1" }), "Claimed");
  assert.equal(policy.intakeStatusAfterSafeguardingClear({ firstContactAttemptedAt: null, claimedBy: null }), "New");
});
