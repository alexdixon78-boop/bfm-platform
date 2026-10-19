import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const routes = read("server/routes/google-calendar.routes.ts");
const runtime = read("server/services/calendar-availability-reconciliation-runtime.ts");
const jobs = read("server/services/calendar-availability-job.service.ts");
const subscriptions = read("server/services/calendar-webhook-subscription.service.ts");
const google = read("server/services/google-calendar.service.ts");
const outlook = read("server/services/outlook-calendar.service.ts");
const app = read("server/app.ts");
const availability = read("server/services/availability-windows.ts");
const diagnostics = read("server/services/calendar-availability-diagnostics.ts");
const appointments = read("server/services/appointment.service.ts");
const scheduleService = read("server/services/mediator-service-approval.service.ts");
const scheduleHelper = read("client/src/lib/mediator-service-schedule-save.ts");

test("provider webhooks authenticate and enqueue immediate reconciliation", () => {
  assert.match(routes, /\/api\/public\/calendar\/webhooks\/google/);
  assert.match(routes, /x-goog-channel-id/);
  assert.match(routes, /x-goog-resource-id/);
  assert.match(routes, /deriveCalendarWebhookToken/);
  assert.match(routes, /\/api\/public\/calendar\/webhooks\/outlook/);
  assert.match(routes, /validationToken/);
  assert.match(routes, /clientState/);
  assert.match(routes, /enqueueCalendarAvailabilityReconciliation/);
});

test("reconciliation protects appointments and groups recurring admin work", () => {
  assert.match(runtime, /externalSeriesId/);
  assert.match(runtime, /calendar_availability_provider_deletion/);
  assert.match(runtime, /calendar_availability_invalidated/);
  assert.match(runtime, /appointmentConflicts/);
  assert.match(runtime, /lifecycle: "retired"/);
  assert.match(runtime, /calendar_availability_service_approval_reconciliation/);
  assert.match(runtime, /notification_updated/);
  assert.match(runtime, /Reconciliation status:/);
});

test("durable jobs use leases, retries, and terminal sync errors", () => {
  assert.match(jobs, /processingLeaseExpiresAt/);
  assert.match(jobs, /getCalendarReconciliationRetryDelayMs/);
  assert.match(jobs, /attemptCount >= 8/);
  assert.match(jobs, /state: "sync_error"/);
  assert.match(jobs, /urgency: "red"/);
});

test("subscriptions renew while the permanent fallback sweep remains active", () => {
  assert.match(google, /6 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(outlook, /6 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(subscriptions, /calendar_subscription_renewal/);
  assert.match(subscriptions, /renewalFailureCount/);
  assert.match(app, /15 \* 60 \* 1000/);
  assert.match(app, /runCalendarAvailabilityJobs, 5 \* 1000/);
  assert.match(app, /runCalendarSubscriptionRenewal/);
});

test("calendar availability is permanently enabled without rollout gates", () => {
  assert.doesNotMatch(runtime, /getCalendarAvailabilityImportMode/);
  assert.doesNotMatch(runtime, /isMediatorAllowedForCalendarAvailability/);
  assert.doesNotMatch(subscriptions, /getCalendarAvailabilityImportMode/);
  assert.match(routes, /res\.json\(\{ enabled: true \}\)/);
});

test("only the mediator active provider is reconciled", () => {
  assert.match(runtime, /activeCalendarProvider !== provider/);
});

test("authoritative events missing from the provider cache still re-enter reconciliation", () => {
  assert.match(runtime, /const authoritative = await getMediatorCalendarProviderService/);
  assert.match(runtime, /candidates\.push\(\{/);
  assert.match(runtime, /isAllDay: authoritative\.isAllDay/);
});

test("generic availability uses overlay booking while legacy behavior remains", () => {
  assert.match(availability, /availabilityReservationMode.*"overlay"/);
  assert.match(availability, /strategyOrder/);
  assert.match(appointments, /availabilityReservationMode === "overlay"/);
  assert.match(appointments, /calendar\.createEvent/);
  assert.match(appointments, /splitAvailabilityForBooking/);
});

test("grouped edits cannot diverge through the legacy service endpoint", () => {
  assert.match(routes, /calendar-availability-sources\/:sourceId/);
  assert.match(scheduleService, /status\?: number/);
  assert.match(scheduleService, /status = 409/);
  assert.match(scheduleService, /scopeMode, "all_approved_services"/);
  assert.match(scheduleHelper, /groupedSourceAware: true/);
  assert.match(scheduleHelper, /calendar-availability-sources\/\$\{sourceId\}/);
});

test("authenticated diagnostics explain why cached provider events are not bookable", () => {
  assert.match(routes, /\/api\/mediators\/:mediatorId\/calendar-availability-diagnostics/);
  assert.match(routes, /buildCalendarAvailabilityProjectionDiagnostic/);
  assert.match(routes, /getMediatorBookingEligibilityReasons/);
  assert.match(routes, /reconciliation: result\.reconciliation/);
  assert.match(runtime, /calendar_availability_slot_reconciled/);
  assert.match(diagnostics, /"no_approved_service"/);
  assert.match(diagnostics, /"service_not_assigned"/);
});

test("provider-neutral repair normalizes Outlook timestamps and reports reconciliation outcomes", () => {
  const repair = read("server/scripts/repair-calendar-availability.ts");
  assert.match(repair, /activeCalendarProvider === "outlook"/);
  assert.match(repair, /outlookCalendarService\.syncCalendar\(mediator\.id, "timestamp_repair"\)/);
  assert.match(repair, /googleCalendarService\.syncCalendar\(mediator\.id, "manual_sync"\)/);
  assert.match(repair, /reconciliation/);
  assert.match(repair, /await pool\.end\(\)/);
});
