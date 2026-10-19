/**
 * Regression tests for case closure data capture.
 *
 * Run with: npx tsx tests/case-closure-data-capture.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASE_FOLLOW_UP_CONSENT_STATUSES,
  caseClosurePayloadSchema,
} from "../shared/schema";

test("case closure payload requires explicit follow-up consent", () => {
  const result = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues.some(issue => issue.path.join(".") === "followUpConsentStatus"), true);
  }
});

test("case closure payload accepts granted or declined follow-up consent only for new closures", () => {
  assert.deepEqual([...CASE_FOLLOW_UP_CONSENT_STATUSES], ["granted", "declined"]);

  const granted = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    followUpConsentStatus: "granted",
  });
  const declined = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    followUpConsentStatus: "declined",
  });
  const unknown = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    followUpConsentStatus: "unknown",
  });

  assert.equal(granted.success, true);
  assert.equal(declined.success, true);
  assert.equal(unknown.success, false);
});

test("case closure payload validates optional score ranges and preserves missing metrics", () => {
  const valid = caseClosurePayloadSchema.parse({
    closureReason: "Agreement reached",
    closureDetails: "Outcome captured with partial survey response.",
    followUpConsentStatus: "declined",
    lifeSatisfaction: 0,
    anxietyScore: 10,
    serviceRating: null,
    netPromoterScore: undefined,
  });
  const invalid = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    followUpConsentStatus: "granted",
    serviceRating: 11,
  });

  assert.equal(valid.lifeSatisfaction, 0);
  assert.equal(valid.anxietyScore, 10);
  assert.equal(valid.serviceRating, null);
  assert.equal(valid.netPromoterScore, null);
  assert.equal(invalid.success, false);
});

test("case closure payload requires a follow-up consent decision for every active party", () => {
  const missingPartyDecision = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    partyFollowUpConsents: [
      { partyId: "party-a", consentStatus: "granted" },
      { partyId: "party-b", consentStatus: "not_captured" },
    ],
  });
  const excludedWithoutReason = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    partyFollowUpConsents: [
      { partyId: "party-a", consentStatus: "granted" },
      { partyId: "party-b", consentStatus: "excluded" },
    ],
  });
  const valid = caseClosurePayloadSchema.safeParse({
    closureReason: "Agreement reached",
    partyFollowUpConsents: [
      { partyId: "party-a", consentStatus: "granted", source: "enquiry_carry_forward" },
      { partyId: "party-b", consentStatus: "excluded", exclusionReason: "Client B did not participate in closure call" },
    ],
  });

  assert.equal(missingPartyDecision.success, false);
  assert.equal(excludedWithoutReason.success, false);
  assert.equal(valid.success, true);
});
