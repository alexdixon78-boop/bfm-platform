import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeAuditSearch,
  parseAuditDateRange,
  formatAuditAction,
  formatAuditEntity,
  auditActorName,
  parseAuditDetails,
} from "../shared/audit-log-utils";

test("audit date filters use inclusive UK calendar days across GMT and BST", () => {
  assert.deepEqual(parseAuditDateRange("2030-01-15", "2030-01-15"), {
    start: new Date("2030-01-15T00:00:00.000Z"),
    endExclusive: new Date("2030-01-16T00:00:00.000Z"),
  });
  assert.deepEqual(parseAuditDateRange("2030-07-15", "2030-07-15"), {
    start: new Date("2030-07-14T23:00:00.000Z"),
    endExclusive: new Date("2030-07-15T23:00:00.000Z"),
  });
  assert.deepEqual(parseAuditDateRange("2030-03-31", "2030-03-31"), {
    start: new Date("2030-03-31T00:00:00.000Z"),
    endExclusive: new Date("2030-03-31T23:00:00.000Z"),
  });
  assert.deepEqual(parseAuditDateRange("2030-10-27", "2030-10-27"), {
    start: new Date("2030-10-26T23:00:00.000Z"),
    endExclusive: new Date("2030-10-28T00:00:00.000Z"),
  });
});

test("audit dates reject invalid and reversed ranges", () => {
  assert.throws(() => parseAuditDateRange("2030-02-30", undefined), /Invalid start date/);
  assert.throws(() => parseAuditDateRange(undefined, "yesterday"), /Invalid end date/);
  assert.throws(() => parseAuditDateRange("2030-04-03", "2030-04-02"), /after the end date/);
});

test("audit text search treats SQL wildcard characters literally", () => {
  assert.equal(escapeAuditSearch("  50%_done\\  "), "50\\%\\_done\\\\");
  assert.equal(escapeAuditSearch("   "), "");
});

test("audit presentation keeps unknown events readable and full details accessible", () => {
  assert.equal(formatAuditAction("invite_sent"), "Invite Sent");
  assert.equal(formatAuditAction("case.follow_up_consent_recorded"), "Case Follow Up Consent Recorded");
  assert.equal(formatAuditEntity("contractor_applicant"), "Contractor Applicant");
  assert.equal(auditActorName("deleted-id", null), "Former user (deleted-id)");
  assert.equal(auditActorName(null, null), "System");
  assert.deepEqual(parseAuditDetails('{"a":1,"b":{"c":"long"},"d":false}'), [
    ["a", "1"], ["b", '{\n  "c": "long"\n}'], ["d", "false"],
  ]);
  assert.deepEqual(parseAuditDetails("plain text"), [["Details", "plain text"]]);
});
