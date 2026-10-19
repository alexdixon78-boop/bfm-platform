import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("MIAM booking links are not time-expired before first use", () => {
  const bookingService = read("../server/services/booking.service.ts");

  assert.match(bookingService, /bookingTokenExpiresAt:\s*null/);
  assert.doesNotMatch(bookingService, /This booking link has expired/);
  assert.doesNotMatch(bookingService, /existingExpiry/);
  assert.doesNotMatch(bookingService, /setDate\(expiresAt\.getDate\(\) \+ 7\)/);
});

test("unpaid MIAM holds do not block public slot availability or mediator slot uniqueness", () => {
  const availabilityWindows = read("../server/services/availability-windows.ts");
  const schema = read("../shared/schema.ts");
  const bootstrap = read("../server/db-bootstrap.ts");

  assert.match(availabilityWindows, /isAppointmentBlockingAvailability/);
  assert.match(availabilityWindows, /a\.status === "confirmed"/);
  assert.match(availabilityWindows, /canConfirmAppointmentPayment\(a\.paymentStatus\)/);
  assert.match(schema, /appointments_active_mediator_slot_unique[\s\S]*status = 'confirmed'/);
  assert.match(bootstrap, /DROP INDEX IF EXISTS appointments_active_mediator_slot_unique/);
  assert.match(bootstrap, /WHERE status = 'confirmed'/);
});

test("paid public booking conflicts create admin resolution tasks with deep links", () => {
  const appointmentService = read("../server/services/appointment.service.ts");
  const taskService = read("../server/services/task.service.ts");

  assert.match(appointmentService, /markPaidPublicBookingNeedsMiamArrangement/);
  assert.match(appointmentService, /paid_needs_miam_arrangement/);
  assert.match(appointmentService, /action=resolve-miam/);
  assert.match(appointmentService, /appointmentId=/);
  assert.match(appointmentService, /createMiamArrangementTask/);
  assert.match(taskService, /resolve-miam/);
});

test("manual paid status attempts the same auto-confirm or arrangement path", () => {
  const appointmentService = read("../server/services/appointment.service.ts");

  assert.match(appointmentService, /data\.paymentStatus === "paid"/);
  assert.match(appointmentService, /manual_payment_marked_paid/);
  assert.match(appointmentService, /confirmPaidPublicBooking\(updated\.id/);
});

test("case appointment UI exposes paid-conflict resolve deep link and summary MIAM mediator shortcut", () => {
  const casePage = read("../client/src/pages/case-detail.tsx");

  assert.match(casePage, /resolveMiamAppointmentId/);
  assert.match(casePage, /Paid, needs MIAM arrangement/);
  assert.match(casePage, /Resolve MIAM mediator/);
  assert.match(casePage, /select-summary-miam-mediator/);
});
