import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSectionC,
  validateSectionD,
  validateSectionF,
  validateServiceOfferingRequirements,
  requiresMediatorProfileCompletion,
  mediatorFieldMandatoryLevel,
  hasPublishableMediatorBio,
  canManageMediatorServiceSlots,
} from "../shared/mediator-rbac";

test("only superadmin may defer mediator profile completion", () => {
  assert.equal(requiresMediatorProfileCompletion("superadmin"), false);
  assert.equal(requiresMediatorProfileCompletion("subadmin"), true);
  assert.equal(requiresMediatorProfileCompletion("mediator"), true);
});

test("superadmin field markers reflect optional profile data but preserve account email", () => {
  assert.equal(mediatorFieldMandatoryLevel("Y", "superadmin", "dateOfBirth"), "N");
  assert.equal(mediatorFieldMandatoryLevel("Y", "superadmin", "email"), "Y");
  assert.equal(mediatorFieldMandatoryLevel("Y", "mediator", "dateOfBirth"), "Y");
  assert.equal(mediatorFieldMandatoryLevel("Rec", "superadmin", "profilePhotoUrl"), "Rec");
});

test("bio submission and approval require both public copy fields", () => {
  assert.equal(hasPublishableMediatorBio("Short", "Long"), true);
  assert.equal(hasPublishableMediatorBio(" ", "Long"), false);
  assert.equal(hasPublishableMediatorBio("Short", null), false);
});

test("only superadmin or the mediator owner can manage service slots", () => {
  assert.equal(canManageMediatorServiceSlots("superadmin", "admin-1", "mediator-1"), true);
  assert.equal(canManageMediatorServiceSlots("mediator", "mediator-1", "mediator-1"), true);
  assert.equal(canManageMediatorServiceSlots("mediator", "mediator-2", "mediator-1"), false);
  assert.equal(canManageMediatorServiceSlots("subadmin", "subadmin-1", "mediator-1"), false);
});

test("superadmin may defer WTA supervisor details, while ordinary validation requires them", () => {
  const patch = { fmcAccreditationStatus: "WTA" };
  assert.ok(validateSectionC(patch).some((error) => error.message.includes("required when accreditation status is WTA")));
  assert.deepEqual(validateSectionC(patch, null, false), []);
});

test("superadmin may defer service qualification and selection", () => {
  const draft = { mediationRoleQualification: "unclassified" };
  assert.ok(validateSectionD(draft).length > 0);
  assert.deepEqual(validateSectionD(draft, false), []);
  assert.ok(validateServiceOfferingRequirements(draft, []).length > 0);
  assert.deepEqual(validateServiceOfferingRequirements(draft, [], false), []);
});

test("superadmin may save incomplete working hours but entered hours remain valid", () => {
  const incomplete = { workingDays: ["Mon"], workingHoursByDay: {} };
  assert.ok(validateSectionF(incomplete).length > 0);
  assert.deepEqual(validateSectionF(incomplete, null, false), []);
  const invalid = { workingDays: ["Mon"], workingHoursByDay: { Mon: { start: "18:00", end: "09:00" } } };
  assert.ok(validateSectionF(invalid, null, false).some((error) => error.message.includes("start must be before end")));
  const lunchWithoutHours = { workingDays: ["Mon"], workingHoursByDay: { Mon: { start: "", end: "", lunchStart: "12:00" } } };
  assert.ok(validateSectionF(lunchWithoutHours, null, false).length > 0);
});
