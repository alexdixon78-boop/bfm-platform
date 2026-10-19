import test from "node:test";
import assert from "node:assert/strict";
import {
  addEnglandWalesWorkingDays,
  isEnglandWalesWorkingDay,
} from "../server/utils/uk-business-days";
import {
  canSubmitCaseComplaint,
  canViewFullComplaint,
  canTransitionComplaint,
} from "../server/security/complaint-policy";

test("complaint submission authorization follows role and case relationship", () => {
  assert.equal(canSubmitCaseComplaint("client", "client_party", "case_id"), true);
  assert.equal(canSubmitCaseComplaint("client", "none", "case_id"), false);
  assert.equal(canSubmitCaseComplaint("mediator", "full_mediator", "case_id"), true);
  assert.equal(canSubmitCaseComplaint("mediator", "miam_only_mediator", "case_id"), false);
  assert.equal(canSubmitCaseComplaint("mediator", "session_observer", "case_id"), false);
  assert.equal(canSubmitCaseComplaint("subadmin", "admin", "case_id"), true);
  assert.equal(canSubmitCaseComplaint("superadmin", "admin", "case_id"), true);
  assert.equal(canSubmitCaseComplaint("staff", "none", "case_ref"), true);
  assert.equal(canSubmitCaseComplaint("staff", "none", "case_id"), false);
  assert.equal(canSubmitCaseComplaint("contractor", "none", "case_ref"), false);
});

test("only a superadmin can view a full complaint record", () => {
  assert.equal(canViewFullComplaint("superadmin"), true);
  for (const role of ["subadmin", "staff", "mediator", "client", "contractor"]) {
    assert.equal(canViewFullComplaint(role), false, role);
  }
});

test("complaint lifecycle rejects skipped and terminal transitions", () => {
  assert.equal(canTransitionComplaint("received", "acknowledged"), true);
  assert.equal(canTransitionComplaint("received", "under_review"), false);
  assert.equal(canTransitionComplaint("acknowledged", "under_review"), true);
  assert.equal(canTransitionComplaint("under_review", "awaiting_information"), true);
  assert.equal(canTransitionComplaint("awaiting_information", "under_review"), true);
  assert.equal(canTransitionComplaint("under_review", "response_issued"), true);
  assert.equal(canTransitionComplaint("response_issued", "closed"), true);
  assert.equal(canTransitionComplaint("closed", "under_review"), false);
  assert.equal(canTransitionComplaint("withdrawn", "under_review"), false);
  assert.equal(canTransitionComplaint("duplicate", "under_review"), false);
});

test("working-day calculation skips weekends and England/Wales bank holidays", () => {
  assert.equal(isEnglandWalesWorkingDay(new Date("2026-04-03T12:00:00Z")), false); // Good Friday
  assert.equal(isEnglandWalesWorkingDay(new Date("2026-04-06T12:00:00Z")), false); // Easter Monday
  assert.equal(isEnglandWalesWorkingDay(new Date("2026-05-04T12:00:00Z")), false); // Early May
  assert.equal(isEnglandWalesWorkingDay(new Date("2026-12-28T12:00:00Z")), false); // Boxing Day substitute
  assert.equal(isEnglandWalesWorkingDay(new Date("2026-12-29T12:00:00Z")), true);
  assert.equal(isEnglandWalesWorkingDay(new Date("2022-09-19T12:00:00Z")), false); // State funeral exceptional holiday
  assert.equal(isEnglandWalesWorkingDay(new Date("2022-05-30T12:00:00Z")), true); // Spring bank holiday moved for Jubilee
  assert.equal(isEnglandWalesWorkingDay(new Date("2023-05-08T12:00:00Z")), false); // Coronation exceptional holiday

  assert.equal(
    addEnglandWalesWorkingDays(new Date("2026-04-02T09:30:00Z"), 1).toISOString(),
    "2026-04-07T09:30:00.000Z",
  );
  assert.equal(
    addEnglandWalesWorkingDays(new Date("2026-12-24T09:30:00Z"), 2).toISOString(),
    "2026-12-30T09:30:00.000Z",
  );
  assert.equal(
    addEnglandWalesWorkingDays(new Date("2026-06-07T23:30:00Z"), 10).toISOString(),
    "2026-06-21T23:30:00.000Z",
  );
});
