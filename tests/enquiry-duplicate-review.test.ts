/**
 * Regression tests for duplicate enquiry detection and admin review.
 *
 * Run with: npx tsx tests/enquiry-duplicate-review.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateEnquiryCandidates } from "../server/services/enquiry-duplicate.service";

const now = new Date("2026-08-12T12:00:00.000Z");

function candidate(overrides: Partial<Parameters<typeof findDuplicateEnquiryCandidates>[0]["existing"][number]>) {
  return {
    id: "existing-1",
    enquiryRef: "ENQ-2026-0001",
    dateReceived: new Date("2026-08-10T12:00:00.000Z"),
    email: "person@example.com",
    mobileTelephone: "+44 7700 900123",
    contactMethod: "Website form",
    ...overrides,
  };
}

test("detects same email or phone on a different channel within 30 days", () => {
  const matches = findDuplicateEnquiryCandidates({
    enquiry: {
      id: "new-1",
      enquiryRef: "ENQ-2026-0002",
      dateReceived: now,
      email: " PERSON@example.com ",
      mobileTelephone: "07700 900123",
      contactMethod: "WhatsApp message",
    },
    existing: [candidate({})],
    now,
  });

  assert.deepEqual(matches, [
    {
      matchedEnquiryId: "existing-1",
      matchReasons: ["email", "phone"],
    },
  ]);
});

test("detects either email-only or phone-only matches", () => {
  const matches = findDuplicateEnquiryCandidates({
    enquiry: {
      id: "new-1",
      enquiryRef: "ENQ-2026-0002",
      dateReceived: now,
      email: "person@example.com",
      mobileTelephone: "07700 900123",
      contactMethod: "WhatsApp message",
    },
    existing: [
      candidate({ id: "email-only", mobileTelephone: "07700 900999" }),
      candidate({ id: "phone-only", email: "different@example.com" }),
    ],
    now,
  });

  assert.deepEqual(matches, [
    {
      matchedEnquiryId: "email-only",
      matchReasons: ["email"],
    },
    {
      matchedEnquiryId: "phone-only",
      matchReasons: ["phone"],
    },
  ]);
});

test("does not detect same-channel or older enquiry records", () => {
  const matches = findDuplicateEnquiryCandidates({
    enquiry: {
      id: "new-1",
      enquiryRef: "ENQ-2026-0002",
      dateReceived: now,
      email: "person@example.com",
      mobileTelephone: "07700 900123",
      contactMethod: "Website form",
    },
    existing: [
      candidate({ id: "same-channel", contactMethod: "Website form" }),
      candidate({
        id: "old-channel",
        contactMethod: "Calendly consultation",
        dateReceived: new Date("2026-07-01T12:00:00.000Z"),
      }),
    ],
    now,
  });

  assert.deepEqual(matches, []);
});
