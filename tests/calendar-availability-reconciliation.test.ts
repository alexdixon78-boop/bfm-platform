import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAvailabilityFingerprint,
  planServiceSlotReconciliation,
} from "../server/services/calendar-availability-reconciliation";

test("fingerprint is stable across title case, whitespace, and attendee order", () => {
  const first = buildAvailabilityFingerprint({
    title: " BFM availability ",
    startAt: new Date("2030-01-10T09:00:00.000Z"),
    endAt: new Date("2030-01-10T11:00:00.000Z"),
    attendees: [{ email: "B@example.com" }, { email: "a@example.com" }],
  });
  const second = buildAvailabilityFingerprint({
    title: "bfm AVAILABILITY",
    startAt: new Date("2030-01-10T09:00:00.000Z"),
    endAt: new Date("2030-01-10T11:00:00.000Z"),
    attendees: [{ email: "A@example.com" }, { email: "b@example.com" }],
  });
  assert.equal(first, second);
});

test("generic source creates a slot for every approved service", () => {
  assert.deepEqual(
    planServiceSlotReconciliation({
      approvedServiceIds: ["service-b", "service-a", "service-a"],
      activeSlots: [],
      bookedServiceIds: [],
    }),
    {
      createServiceIds: ["service-a", "service-b"],
      retainServiceIds: [],
      deleteServiceIds: [],
      retireServiceIds: [],
    },
  );
});

test("revoked unbooked services are deleted while booked rows are retired", () => {
  assert.deepEqual(
    planServiceSlotReconciliation({
      approvedServiceIds: ["still-approved"],
      activeSlots: [
        { serviceTypeId: "still-approved" },
        { serviceTypeId: "revoked-unbooked" },
        { serviceTypeId: "revoked-booked" },
      ],
      bookedServiceIds: ["revoked-booked"],
    }),
    {
      createServiceIds: [],
      retainServiceIds: ["still-approved"],
      deleteServiceIds: ["revoked-unbooked"],
      retireServiceIds: ["revoked-booked"],
    },
  );
});
