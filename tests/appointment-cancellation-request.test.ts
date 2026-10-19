/**
 * Regression checks for mediator/client appointment cancellation requests.
 *
 * Run with: npx tsx tests/appointment-cancellation-request.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const routes = read("../server/routes/appointment.routes.ts");
const service = read("../server/services/appointment.service.ts");
const appointmentsPage = read("../client/src/pages/appointments.tsx");
const schema = read("../shared/schema.ts");
const requestCancellationBody = service.slice(
  service.indexOf("async requestCancellation("),
  service.indexOf("async cancel(", service.indexOf("async requestCancellation(")),
);

test("appointment routes expose a role-safe cancellation request endpoint", () => {
  assert.match(routes, /router\.post\("\/api\/appointments\/:id\/cancellation-request", requirePermission\("appointments", "view"\)/);
  assert.match(routes, /user\.role !== "mediator" && user\.role !== "client"/);
  assert.match(routes, /appointmentService\.requestCancellation\(req\.params\.id, user, req\.body\?\.reason, req\.ip\)/);
});

test("cancellation requests validate requester, reason, state, duplicate task, and do not cancel the appointment", () => {
  assert.match(service, /async requestCancellation\(/);
  assert.match(service, /if \(user\.role !== "mediator" && user\.role !== "client"\)/);
  assert.match(service, /typeof rawReason === "string" \? rawReason\.trim\(\) : ""/);
  assert.match(service, /Cancellation reason is required/);
  assert.match(service, /!\["hold", "held", "confirmed"\]\.includes\(appt\.status\)/);
  assert.match(service, /new Date\(appt\.dateTime\)\.getTime\(\) <= Date\.now\(\)/);
  assert.match(service, /appointment_cancellation_request/);
  assert.match(service, /A cancellation request is already open for this appointment/);
  assert.match(service, /notificationService\.createNotification/);
  assert.match(service, /caseActivityService\.log/);
  assert.match(service, /logAudit/);
  assert.doesNotMatch(requestCancellationBody, /storage\.updateAppointment\(.*status: "cancelled"/);
});

test("appointments UI keeps admin direct cancel and adds mediator/client request cancellation", () => {
  assert.match(appointmentsPage, /const canCancel = isAdmin && \(appointment\.status === "hold" \|\| appointment\.status === "held" \|\| appointment\.status === "confirmed"\)/);
  assert.match(appointmentsPage, /const canRequestCancellation = !isAdmin && \(isMediator \|\| isClient\)/);
  assert.match(appointmentsPage, /\/api\/appointments\/\$\{id\}\/cancellation-request/);
  assert.match(appointmentsPage, /data-testid="button-request-cancellation"/);
  assert.match(appointmentsPage, /data-testid="input-cancellation-reason"/);
  assert.match(appointmentsPage, /Request sent/);
  assert.match(appointmentsPage, /A cancellation request is already open for this appointment/);
});

test("cancellation requests are audit and case activity events, not lifecycle status changes", () => {
  assert.match(schema, /"request_appointment_cancellation"/);
  assert.match(schema, /"appointment_cancellation_requested"/);
  const lifecycleBlock = schema.slice(
    schema.indexOf("export const APPOINTMENT_LIFECYCLE_EVENT_TYPES"),
    schema.indexOf("export type AppointmentLifecycleEventType"),
  );
  assert.doesNotMatch(lifecycleBlock, /appointment_cancellation_requested/);
});
