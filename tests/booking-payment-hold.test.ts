import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPOINTMENT_PAYMENT_STATUSES,
  canConfirmAppointmentPayment,
  calculatePublicBookingHoldDeadline,
  calculateHoldDeadline,
  calculateHoldAlertAt,
  calculateFollowUpDueAt,
  isMiamValidForCourtAction,
  calculateMiamExpiry,
} from "../server/services/appointment-rules";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("payment statuses expose manual paid and voucher gates", () => {
  assert.deepEqual(APPOINTMENT_PAYMENT_STATUSES, [
    "payment_pending",
    "paid",
    "voucher_pending",
    "voucher_accepted_by_opia",
    "payment_not_required",
    "failed_or_not_received",
  ]);
  assert.equal(canConfirmAppointmentPayment("payment_pending"), false);
  assert.equal(canConfirmAppointmentPayment("voucher_pending"), false);
  assert.equal(canConfirmAppointmentPayment("failed_or_not_received"), false);
  assert.equal(canConfirmAppointmentPayment("paid"), true);
  assert.equal(canConfirmAppointmentPayment("voucher_accepted_by_opia"), true);
  assert.equal(canConfirmAppointmentPayment("payment_not_required"), true);
});

test("hold deadline is appointment-time anchored at 55 hours before the appointment", () => {
  const appointmentStart = new Date("2026-08-10T15:00:00.000Z");
  assert.equal(calculateHoldDeadline(appointmentStart).toISOString(), "2026-08-08T08:00:00.000Z");
});

test("public booking hold deadline falls back to appointment start for near-term bookings", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");

  assert.equal(
    calculatePublicBookingHoldDeadline(new Date("2026-08-12T19:01:00.000Z"), now).toISOString(),
    "2026-08-10T12:01:00.000Z",
  );
  assert.equal(
    calculatePublicBookingHoldDeadline(new Date("2026-08-12T19:00:00.000Z"), now).toISOString(),
    "2026-08-12T19:00:00.000Z",
  );
  assert.equal(
    calculatePublicBookingHoldDeadline(new Date("2026-08-12T18:59:00.000Z"), now).toISOString(),
    "2026-08-12T18:59:00.000Z",
  );
});

test("72 hour alert moves weekend/out-of-hours points to the preceding working day", () => {
  assert.equal(
    calculateHoldAlertAt(new Date("2026-08-10T15:00:00.000Z")).toISOString(),
    "2026-08-07T15:00:00.000Z",
  );
  assert.equal(
    calculateHoldAlertAt(new Date("2026-08-12T15:00:00.000Z")).toISOString(),
    "2026-08-07T17:00:00.000Z",
  );
});

test("follow-up task is due within three working days after hold auto-cancel", () => {
  assert.equal(
    calculateFollowUpDueAt(new Date("2026-08-07T09:00:00.000Z")).toISOString(),
    "2026-08-12T09:00:00.000Z",
  );
});

test("MIAM validity allows court action for four months from latest MIAM or mediation date", () => {
  const asOf = new Date("2026-08-10T12:00:00.000Z");
  assert.equal(isMiamValidForCourtAction(new Date("2026-04-10T00:00:00.000Z"), null, asOf), true);
  assert.equal(isMiamValidForCourtAction(new Date("2026-04-09T23:59:59.000Z"), null, asOf), false);
  assert.equal(isMiamValidForCourtAction(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"), asOf), true);
});

test("MIAM expiry is exposed as the end of the four-month validity day", () => {
  assert.equal(
    calculateMiamExpiry(new Date("2026-04-10T09:30:00.000Z")).toISOString(),
    "2026-08-10T23:59:59.999Z",
  );
});

test("schema and bootstrap define appointment payment tracking fields", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(schemaSource, /APPOINTMENT_PAYMENT_STATUSES/);
  assert.match(schemaSource, /"hold", "confirmed", "cancelled", "completed", "expired"/);
  assert.match(schemaSource, /paymentStatus:\s*text\("payment_status"\)/);
  assert.match(schemaSource, /paymentStatusUpdatedAt:\s*timestamp\("payment_status_updated_at"\)/);
  assert.match(schemaSource, /paymentStatusUpdatedBy:\s*varchar\("payment_status_updated_by"\)/);
  assert.match(schemaSource, /paymentNotes:\s*text\("payment_notes"\)/);
  assert.match(schemaSource, /holdAlertSentAt:\s*timestamp\("hold_alert_sent_at"\)/);
  assert.match(schemaSource, /appointments_active_party_booking_token_unique/);
  assert.match(schemaSource, /party_id IS NOT NULL AND booking_token IS NOT NULL AND status NOT IN \('cancelled', 'expired'\)/);
  assert.match(bootstrapSource, /ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status TEXT/);
  assert.match(bootstrapSource, /ALTER TABLE appointments ADD COLUMN IF NOT EXISTS hold_alert_sent_at TIMESTAMP/);
  assert.match(bootstrapSource, /UPDATE appointments SET status = 'hold' WHERE status = 'held'/);
  assert.match(bootstrapSource, /appointments_active_party_booking_token_unique/);
  assert.match(bootstrapSource, /duplicate_active_booking_links/);
  assert.match(bootstrapSource, /Skipping appointments_active_party_booking_token_unique because duplicate active party booking-token appointments exist/);
});

test("routes and services expose manual payment update and payment-gated confirmation", () => {
  const routeSource = read("../server/routes/appointment.routes.ts");
  const serviceSource = read("../server/services/appointment.service.ts");

  assert.match(routeSource, /\/api\/appointments\/:id\/payment-status/);
  assert.match(routeSource, /updatePaymentStatus/);
  assert.match(serviceSource, /canConfirmAppointmentPayment/);
  assert.match(serviceSource, /Payment or voucher acceptance is required before confirming this appointment/);
  assert.match(serviceSource, /ensureCalendarArtifactsForConfirmation/);
  assert.doesNotMatch(serviceSource, /paymentFailureReason:\s*"calendar_confirmation_failed"/);
  assert.match(serviceSource, /createBfmEvent/);
  assert.match(serviceSource, /splitAvailabilityForBooking/);
  assert.match(serviceSource, /createHeldPaymentAlerts/);
  assert.match(serviceSource, /calculateHoldAlertAt/);
  assert.match(serviceSource, /calculateHoldDeadline/);
  assert.match(serviceSource, /findHeldAppointmentsToExpire/);
  assert.match(serviceSource, /status:\s*"expired"/);
  assert.match(serviceSource, /createPaymentFollowUpTask/);
});

test("public availability keeps near-term future slots and booking creation adjusts hold deadline", () => {
  const availabilitySource = read("../server/services/availability.service.ts");
  const bookingSource = read("../server/services/booking.service.ts");
  const bookPageSource = read("../client/src/pages/book.tsx");

  assert.match(availabilitySource, /slots\.filter\(s => s\.getTime\(\) > now\.getTime\(\)\)/);
  assert.match(availabilitySource, /if \(slot\.getTime\(\) <= now\.getTime\(\)\) continue/);
  assert.doesNotMatch(availabilitySource, /canHoldAppointmentOnline/);
  assert.match(bookingSource, /calculatePublicBookingHoldDeadline\(appointmentDate\)/);
  assert.doesNotMatch(bookingSource, /PUBLIC_BOOKING_HOLD_CUTOFF_ERROR/);
  assert.doesNotMatch(bookingSource, /if \(!canHoldAppointmentOnline\(appointmentDate\)\)/);
  assert.match(bookPageSource, /parseApiError\(bookMutation\.error\)\.userMessage/);
  assert.match(bookPageSource, /invalidateQueries\(\{ queryKey: \["\/api\/booking", token, "slots"\] \}\)/);
  assert.match(bookPageSource, /invalidateQueries\(\{ queryKey: \["\/api\/booking", token, "available-dates"\] \}\)/);
});

test("enquiry conversion uses strong client matching and duplicate warning task", () => {
  const serviceSource = read("../server/services/enquiry.service.ts");
  const repoSource = read("../server/repositories/client.repository.ts");

  assert.match(repoSource, /findStrongMatch/);
  assert.match(repoSource, /findPotentialMatches/);
  assert.match(serviceSource, /findStrongClientMatchForEnquiry/);
  assert.match(serviceSource, /returning_client_match_review/);
});

test("case service and UI expose expired MIAM court-form blocking", () => {
  const serviceSource = read("../server/services/case.service.ts");
  const caseRouteSource = read("../server/routes/case.routes.ts");
  const casePageSource = read("../client/src/pages/case-detail.tsx");
  const courtFormsSource = read("../client/src/components/case-progress/documents-court-forms-section.tsx");

  assert.match(serviceSource, /getMiamValidityForCourtAction/);
  assert.match(serviceSource, /getCaseMiamValidity/);
  assert.match(serviceSource, /expiresAt/);
  assert.match(serviceSource, /parties:/);
  assert.match(serviceSource, /renewalBookingAvailable/);
  assert.match(caseRouteSource, /miamValidity/);
  assert.match(casePageSource, /expiresAt/);
  assert.match(casePageSource, /MIAM expiry/);
  assert.match(casePageSource, /miamValidForCourtAction/);
  assert.match(courtFormsSource, /MIAM has expired for court applications/);
  assert.match(courtFormsSource, /MIAM expiry/);
  assert.match(courtFormsSource, /Send MIAM Booking Link/);
});

test("MIAM records keep renewal history with one current row per party and case", () => {
  const schemaSource = read("../shared/schema.ts");
  const migrationSource = read("../migrations/0016_miam_validity_renewals.sql");
  const repoSource = read("../server/repositories/miam-record.repository.ts");

  assert.match(schemaSource, /supersededAt:\s*timestamp\("superseded_at"\)/);
  assert.match(schemaSource, /supersededBy:\s*varchar\("superseded_by"\)/);
  assert.match(schemaSource, /renewalOfMiamRecordId:\s*varchar\("renewal_of_miam_record_id"\)/);
  assert.match(schemaSource, /renewalSequence:\s*integer\("renewal_sequence"\)/);
  assert.match(schemaSource, /miam_records_current_party_case_unique/);
  assert.doesNotMatch(schemaSource, /miam_records_party_case_unique/);
  assert.match(migrationSource, /DROP CONSTRAINT IF EXISTS "miam_records_party_case_unique"/);
  assert.match(migrationSource, /WHERE "superseded_at" IS NULL/);
  assert.match(repoSource, /listHistoryByPartyAndCase/);
  assert.match(repoSource, /supersedeCurrentForPartyAndCase/);
  assert.match(repoSource, /async createRenewal\([\s\S]*return db\.transaction/);
});

test("case and appointments UI expose manual payment state controls", () => {
  const casePageSource = read("../client/src/pages/case-detail.tsx");
  const appointmentsPageSource = read("../client/src/pages/appointments.tsx");

  assert.match(casePageSource, /select-appointment-payment-status/);
  assert.match(casePageSource, /Voucher accepted by OPIA/);
  assert.match(casePageSource, /Payment or voucher acceptance required before confirmation/);
  assert.match(appointmentsPageSource, /Payment status/);
  assert.match(appointmentsPageSource, /Voucher accepted by OPIA/);
});
