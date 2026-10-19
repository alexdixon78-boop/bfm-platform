import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proofingReleaseNotificationId,
  proofingReleaseDocumentId,
  selectProofingReleaseRecipientIds,
  shouldStartNewProofingCycle,
} from "../server/services/case-proofing-release-policy";

const candidates = [
  { partyId: "party-a", userId: "user-a" },
  { partyId: "party-b", userId: "user-b" },
  { partyId: "party-c", userId: null },
  { partyId: "party-a-duplicate", userId: "user-a" },
];

test("case-level proofing release selects every distinct client portal user", () => {
  assert.deepEqual(selectProofingReleaseRecipientIds(candidates, null), ["user-a", "user-b"]);
});

test("party-specific proofing release selects only the owning portal user", () => {
  assert.deepEqual(selectProofingReleaseRecipientIds(candidates, "party-b"), ["user-b"]);
  assert.deepEqual(selectProofingReleaseRecipientIds(candidates, "party-c"), []);
});

test("proofing release notification identity is stable per cycle and recipient", () => {
  const firstAttempt = proofingReleaseNotificationId("proofing-item", 2, "user-a");
  const retry = proofingReleaseNotificationId("proofing-item", 2, "user-a");

  assert.equal(firstAttempt, retry);
  assert.notEqual(firstAttempt, proofingReleaseNotificationId("proofing-item", 3, "user-a"));
  assert.notEqual(firstAttempt, proofingReleaseNotificationId("proofing-item", 2, "user-b"));
});

test("generated schedule document identity is stable per proofing cycle", () => {
  const firstAttempt = proofingReleaseDocumentId("proofing-item", 2);
  assert.equal(firstAttempt, proofingReleaseDocumentId("proofing-item", 2));
  assert.notEqual(firstAttempt, proofingReleaseDocumentId("proofing-item", 3));
});

test("resubmission after every terminal proofing status starts a new review cycle", () => {
  for (const status of ["approved", "returned", "withdrawn"]) {
    assert.equal(shouldStartNewProofingCycle(status, "awaiting_review", true), true);
  }
  assert.equal(shouldStartNewProofingCycle("awaiting_review", "awaiting_review", true), false);
  assert.equal(shouldStartNewProofingCycle("approved", "approved", true), false);
  assert.equal(shouldStartNewProofingCycle(null, "awaiting_review", false), true);
});
