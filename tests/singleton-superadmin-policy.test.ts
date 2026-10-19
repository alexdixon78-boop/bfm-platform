import assert from "node:assert/strict";
import test from "node:test";
import { validateAdminRoleMutation } from "../server/security/singleton-superadmin-policy";

test("rejects creating or promoting another superadmin", () => {
  assert.equal(validateAdminRoleMutation({ operation: "create", requestedRole: "superadmin" }), "Only the bootstrap superadmin account may have the superadmin role");
  assert.equal(validateAdminRoleMutation({ operation: "update", currentRole: "subadmin", requestedRole: "superadmin" }), "Only the bootstrap superadmin account may have the superadmin role");
});

test("rejects demoting or deleting the bootstrap superadmin", () => {
  assert.equal(validateAdminRoleMutation({ operation: "update", currentRole: "superadmin", requestedRole: "subadmin" }), "The bootstrap superadmin cannot be demoted");
  assert.equal(validateAdminRoleMutation({ operation: "delete", currentRole: "superadmin" }), "The bootstrap superadmin cannot be deleted");
});

test("allows profile updates for the superadmin and normal admin role changes", () => {
  assert.equal(validateAdminRoleMutation({ operation: "update", currentRole: "superadmin" }), null);
  assert.equal(validateAdminRoleMutation({ operation: "create", requestedRole: "staff" }), null);
  assert.equal(validateAdminRoleMutation({ operation: "update", currentRole: "staff", requestedRole: "subadmin" }), null);
});
