/**
 * Regression checks for missing non-finance communication emails.
 *
 * Run with: npx tsx tests/missing-communication-emails.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const emailService = read("../server/services/email.service.ts");
const courtFormEmailService = read("../server/services/court-form-email.service.ts");
const appointmentService = read("../server/services/appointment.service.ts");
const mediationSessionService = read("../server/services/mediation-session.service.ts");
const app = read("../server/app.ts");
const caseRoutes = read("../server/routes/case.routes.ts");

test("email service defines non-finance communication senders without touching invoice or court delivery senders", () => {
  assert.match(emailService, /sendBookingHoldCountdownEmail/);
  assert.match(emailService, /sendAppointmentReminderEmail/);
  assert.match(emailService, /sendDocumentsReadyForReviewEmail/);
  assert.match(emailService, /sendCaseClosureThankYouEmail/);

  assert.match(emailService, /sendXeroInvoicePaymentEmail/);
  assert.match(courtFormEmailService, /sendCourtFormPdfEmail/);
});

test("appointment background sweep sends 72-hour hold countdown and confirmed-only 48h, 24h, and 2h reminders", () => {
  assert.match(appointmentService, /sendBookingHoldCountdownEmail/);
  assert.match(appointmentService, /sendScheduledAppointmentReminders/);
  assert.match(appointmentService, /APPOINTMENT_REMINDER_WINDOWS/);
  assert.match(appointmentService, /48 \* 60 \* 60 \* 1000/);
  assert.match(appointmentService, /24 \* 60 \* 60 \* 1000/);
  assert.match(appointmentService, /2 \* 60 \* 60 \* 1000/);
  assert.match(appointmentService, /const type = `appointment_reminder_\$\{window\.key\}_sent`/);
  assert.match(appointmentService, /hasReminderMarker\(appt, recipient, type\)/);
  assert.match(appointmentService, /eq\(notifications\.type, type\)/);
  assert.match(appointmentService, /eq\(notifications\.recipientId, recipient\.id\)/);
  assert.match(appointmentService, /eq\(notifications\.appointmentId, appt\.id\)/);
  assert.match(appointmentService, /if \(appt\.status !== "confirmed"\) continue/);
  assert.match(appointmentService, /caseData\.status === "Closed" \|\| caseData\.status === "Archived"/);
  assert.doesNotMatch(appointmentService, /sendXeroInvoicePaymentEmail/);

  const holdCountdownMethod = appointmentService.slice(
    appointmentService.indexOf("private async sendBookingHoldCountdownEmails"),
    appointmentService.indexOf("private reminderWindowForAppointment"),
  );
  assert.equal(
    (holdCountdownMethod.match(/appt\.dateTimeBasis as "instant" \| "wall_clock_utc"/g) || []).length,
    2,
  );

  const scheduledReminderMethod = appointmentService.slice(
    appointmentService.indexOf("async sendScheduledAppointmentReminders"),
    appointmentService.indexOf("private async createPaymentFollowUpTask"),
  );
  assert.match(
    scheduledReminderMethod,
    /sendAppointmentReminderEmail\([\s\S]*appt\.dateTimeBasis as "instant" \| "wall_clock_utc"/,
  );

  assert.match(app, /appointmentService\.sendScheduledAppointmentReminders/);
});

test("mediation-session document review task emails admins only", () => {
  assert.match(mediationSessionService, /sendDocumentsReadyForReviewEmail/);
  assert.match(mediationSessionService, /user\.role === "superadmin" \|\| user\.role === "subadmin"/);
  assert.match(mediationSessionService, /documents_ready_for_review/);
  assert.doesNotMatch(mediationSessionService, /sendCourtFormPdfEmail/);
});

test("formal case closure sends one combined closure and thank-you email to clients", () => {
  assert.match(caseRoutes, /router\.patch\("\/api\/cases\/:id\/close"/);
  assert.match(caseRoutes, /sendCaseClosureThankYouEmail/);
  assert.match(caseRoutes, /case_closure_thank_you_sent/);
  assert.match(caseRoutes, /closureData/);
  assert.doesNotMatch(caseRoutes, /sendXeroInvoicePaymentEmail/);
  assert.doesNotMatch(caseRoutes, /sendCourtFormPdfEmail/);
});
