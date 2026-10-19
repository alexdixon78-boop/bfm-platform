import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALENDAR_SYNC_MAX_ATTEMPTS,
  getNextCalendarSyncAttemptAt,
  isPaidPublicBookingEligibleForAutoConfirmation,
} from "../server/services/appointment-calendar-sync-rules";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("calendar sync retries after 1, 5, 15, and 30 minutes", () => {
  const now = new Date("2026-09-23T05:00:00.000Z");

  assert.equal(CALENDAR_SYNC_MAX_ATTEMPTS, 5);
  assert.equal(getNextCalendarSyncAttemptAt(1, now)?.toISOString(), "2026-09-23T05:01:00.000Z");
  assert.equal(getNextCalendarSyncAttemptAt(2, now)?.toISOString(), "2026-09-23T05:05:00.000Z");
  assert.equal(getNextCalendarSyncAttemptAt(3, now)?.toISOString(), "2026-09-23T05:15:00.000Z");
  assert.equal(getNextCalendarSyncAttemptAt(4, now)?.toISOString(), "2026-09-23T05:30:00.000Z");
  assert.equal(getNextCalendarSyncAttemptAt(5, now), null);
});

test("only paid booking-token Stripe or Xero appointments auto-confirm", () => {
  const eligible = {
    bookingToken: "public-token",
    paymentStatus: "paid",
    paymentProvider: "stripe",
    status: "hold",
  };

  assert.equal(isPaidPublicBookingEligibleForAutoConfirmation(eligible), true);
  assert.equal(isPaidPublicBookingEligibleForAutoConfirmation({ ...eligible, paymentProvider: "xero_stripe" }), true);
  assert.equal(isPaidPublicBookingEligibleForAutoConfirmation({ ...eligible, bookingToken: null }), false);
  assert.equal(isPaidPublicBookingEligibleForAutoConfirmation({ ...eligible, paymentStatus: "payment_pending" }), false);
  assert.equal(isPaidPublicBookingEligibleForAutoConfirmation({ ...eligible, paymentProvider: "manual" }), false);
  assert.equal(isPaidPublicBookingEligibleForAutoConfirmation({ ...eligible, status: "cancelled" }), false);
});

test("calendar sync jobs are durable and uniquely keyed by appointment", () => {
  const schema = read("../shared/schema.ts");
  const migration = read("../migrations/0044_appointment_calendar_sync_jobs.sql");

  assert.match(schema, /appointmentCalendarSyncJobs = pgTable\("appointment_calendar_sync_jobs"/);
  assert.match(schema, /appointmentId: varchar\("appointment_id"\).*\.unique\(\)/);
  assert.match(schema, /status: text\("status"\).*default\("pending"\)/);
  assert.match(schema, /failureStage: text\("failure_stage"\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS appointment_calendar_sync_jobs/);
  assert.match(migration, /UNIQUE REFERENCES appointments\(id\) ON DELETE CASCADE/);
});

test("paid public booking confirmation and calendar retry are separate paths", () => {
  const appointmentService = read("../server/services/appointment.service.ts");
  const syncService = read("../server/services/appointment-calendar-sync.service.ts");
  const stripeService = read("../server/services/stripe-payment.service.ts");
  const xeroService = read("../server/services/xero.service.ts");

  assert.match(appointmentService, /confirmPaidPublicBooking/);
  assert.match(appointmentService, /appointmentCalendarSyncJobs/);
  assert.match(appointmentService, /splitResultForRollback && appt\.mediatorId && !options\.preserveSuccessfulMediatorLeg/);
  assert.match(appointmentService, /Keeping an untracked external event would[\s\S]{0,180}if \(splitResultForRollback && appt\.mediatorId\)/);
  assert.match(syncService, /processDueJobs/);
  assert.match(syncService, /appointment_calendar_sync_failed/);
  assert.match(stripeService, /confirmPaidPublicBooking/);
  assert.match(xeroService, /confirmPaidPublicBooking/);
});

test("public return UI treats paid confirmed calendar work as a successful booking", () => {
  const page = read("../client/src/pages/book.tsx");

  assert.match(page, /calendarSyncStatus/);
  assert.match(page, /Your calendar invitation is being prepared/);
  assert.match(page, /BFM has been notified about the calendar invitation/);
  assert.doesNotMatch(page, /returnPaymentStatus\.reconciliationAction \?/);
});

test("admins can inspect and retry calendar synchronization without reconfirming", () => {
  const routes = read("../server/routes/appointment.routes.ts");
  const page = read("../client/src/pages/appointments.tsx");

  assert.match(routes, /\/api\/appointments\/:id\/calendar-sync\/retry/);
  assert.match(routes, /Only administrators can retry calendar synchronization/);
  assert.doesNotMatch(routes, /calendar-sync\/retry[\s\S]{0,1200}appointmentService\.confirm\(/);
  assert.match(page, /button-retry-calendar-sync/);
  assert.match(page, /Calendar synchronization/);
});
