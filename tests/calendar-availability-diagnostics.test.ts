import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendarAvailabilityProjectionDiagnostic,
  getMediatorBookingEligibilityReasons,
} from "../server/services/calendar-availability-diagnostics";

const now = new Date("2026-10-09T09:00:00.000Z");
const event = {
  externalEventId: "provider-event-1",
  externalSeriesId: null,
  title: "BFM availability - October",
  startAt: new Date("2026-10-12T12:00:00.000Z"),
  endAt: new Date("2026-10-12T14:00:00.000Z"),
  isAllDay: false,
  organizerEmail: "outlookcalendar@yopmail.com",
  attendees: [{ email: "info@brighterfuturemediation.co.uk" }],
};

test("projects equivalent Google and Outlook availability events identically", () => {
  const input = {
    ...event,
    connectedEmail: "outlookcalendar@yopmail.com",
    approvedServiceIds: ["service-a", "service-b"],
    activeSlotServiceIds: ["service-a"],
    now,
  };

  const google = buildCalendarAvailabilityProjectionDiagnostic({ ...input, provider: "google" });
  const outlook = buildCalendarAvailabilityProjectionDiagnostic({ ...input, provider: "outlook" });

  assert.deepEqual(google, outlook);
  assert.equal(outlook.status, "active");
  assert.deepEqual(outlook.expectedServiceIds, ["service-a", "service-b"]);
  assert.deepEqual(outlook.missingServiceIds, ["service-b"]);
});

test("explains rejected and unprojectable cached availability events", () => {
  const rejected = buildCalendarAvailabilityProjectionDiagnostic({
    ...event,
    provider: "outlook",
    title: "Availability",
    connectedEmail: "outlookcalendar@yopmail.com",
    approvedServiceIds: ["service-a"],
    activeSlotServiceIds: [],
    now,
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, "title_mismatch");

  const noServices = buildCalendarAvailabilityProjectionDiagnostic({
    ...event,
    provider: "outlook",
    connectedEmail: "outlookcalendar@yopmail.com",
    approvedServiceIds: [],
    activeSlotServiceIds: [],
    now,
  });
  assert.equal(noServices.status, "no_approved_service");
  assert.deepEqual(noServices.expectedServiceIds, []);
});

test("reports each mediator eligibility prerequisite that keeps a projected slot out of booking", () => {
  assert.deepEqual(getMediatorBookingEligibilityReasons({
    assignedToService: false,
    accountActive: false,
    panelActive: false,
    serviceActive: false,
    approvalApproved: false,
    roleQualified: false,
  }), [
    "service_not_assigned",
    "mediator_inactive",
    "panel_inactive",
    "service_inactive",
    "service_not_approved",
    "mediation_role_not_qualified",
  ]);
});
