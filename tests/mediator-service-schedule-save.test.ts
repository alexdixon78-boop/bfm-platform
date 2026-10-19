/**
 * Regression coverage for service schedule replacement around existing bookings.
 * These are static contract tests because the live path touches DB state and
 * Google Calendar side effects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync(new URL("../server/services/mediator-service-approval.service.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/mediator-profile.routes.ts", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../client/src/components/mediator-service-schedule-modal.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../client/src/components/mediator/service-approval-drawer.tsx", import.meta.url), "utf8");
const mediatorDetailSource = readFileSync(new URL("../client/src/pages/mediator-detail.tsx", import.meta.url), "utf8");
const scheduleSaveHelperSource = readFileSync(new URL("../client/src/lib/mediator-service-schedule-save.ts", import.meta.url), "utf8");
const ukWallClockSource = readFileSync(new URL("../server/utils/uk-wall-clock.ts", import.meta.url), "utf8");
const availabilityWindowsSource = readFileSync(new URL("../server/services/availability-windows.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const replitSource = readFileSync(new URL("../replit.md", import.meta.url), "utf8");

test("expired appointments are ignored before schedule conflict checks", () => {
  assert.match(serviceSource, /appt\.status !== "cancelled" && appt\.status !== "expired"/);
  assert.doesNotMatch(serviceSource, /This slot overlaps an existing appointment\./);
});

test("existing slots with confirmed bookings can be saved when the booking remains contained", () => {
  assert.match(serviceSource, /function rangeContains/);
  assert.match(serviceSource, /wasInsideExistingSlot/);
  assert.match(serviceSource, /remainsInsideSubmittedSlot/);
  assert.match(serviceSource, /wasInsideExistingSlot && !remainsInsideSubmittedSlot/);
});

test("moving or shortening a booked slot returns a clear appointment conflict", () => {
  assert.match(serviceSource, /describeAppointmentConflict/);
  assert.match(serviceSource, /client \$\{name\}/);
  assert.match(serviceSource, /case \$\{caseRow\.caseRef\}/);
  assert.match(serviceSource, /cannot be moved or shortened past that appointment/);
});

test("removing a slot with an active booking preserves it and reports preservedCount", () => {
  assert.match(serviceSource, /preservedRows\.push\(row\)/);
  assert.match(serviceSource, /preservedCount: preservedRows\.length/);
  assert.doesNotMatch(serviceSource, /This service slot already has a booking and cannot be removed/);
});

test("historical existing slots are preserved before edit and booking checks", () => {
  assert.match(serviceSource, /startOfTodayInUk/);
  assert.match(serviceSource, /isHistoricalExistingSlot/);
  assert.match(serviceSource, /historicalExistingById/);
  assert.match(serviceSource, /editableNormalized/);
  assert.match(serviceSource, /Array\.from\(historicalExistingById\.values\(\)\)/);
  assert.match(serviceSource, /preservedRows\.push\(row\)/);
  assert.match(serviceSource, /const rangeSource = \[\.\.\.editableNormalized, \.\.\.editableExistingSameService\]/);
  assert.doesNotMatch(serviceSource, /const rangeSource = \[\.\.\.normalized, \.\.\.existingSameService\]/);
});

test("new past service slots are rejected clearly", () => {
  assert.match(serviceSource, /New service slots cannot be scheduled in the past\./);
  assert.match(serviceSource, /!slot\.id && slot\.startAt < todayStart/);
});

test("same-service overlapping slots still fail", () => {
  assert.match(serviceSource, /Slots for the same service cannot overlap\./);
  assert.match(serviceSource, /rangesOverlap\(ordered\[i - 1\]\.startAt, ordered\[i - 1\]\.endAt, ordered\[i\]\.startAt, ordered\[i\]\.endAt\)/);
});

test("cross-service overlapping schedule windows are allowed at save time", () => {
  assert.doesNotMatch(serviceSource, /This slot overlaps another approved service\./);
  assert.doesNotMatch(serviceSource, /existingOtherServices/);
});

test("booking availability subtracts mediator appointments across services", () => {
  assert.match(availabilityWindowsSource, /Subtract existing non-cancelled BFM appointments/);
  assert.match(availabilityWindowsSource, /storage\.listAppointmentsByMediatorAndDateRange\(mediator\.id, dayStart, dayEnd\)/);
  assert.match(availabilityWindowsSource, /a\.status !== "cancelled" && a\.status !== "expired"/);
  assert.match(availabilityWindowsSource, /pieces = newPieces/);
});

test("appointment unique index remains the final mediator slot race guard", () => {
  assert.match(schemaSource, /appointments_active_mediator_slot_unique/);
  assert.match(schemaSource, /\.on\(table\.mediatorId, table\.dateTime\)/);
  assert.match(schemaSource, /status NOT IN \('cancelled', 'expired'\)/);
});

test("schedule route parses submitted times as Europe London wall-clock values", () => {
  assert.match(routeSource, /toUkWallClockDateTime/);
  assert.match(routeSource, /startAt: toUkWallClockDateTime\(slot\.date, slot\.startTime\)/);
  assert.match(routeSource, /endAt: toUkWallClockDateTime\(slot\.date, slot\.endTime\)/);
  assert.doesNotMatch(routeSource, /new Date\(`\$\{slot\.date\}T\$\{slot\.startTime\}:00`\)/);
});

test("UK wall-clock helper is explicit about the London timezone", () => {
  assert.match(ukWallClockSource, /Europe\/London/);
  assert.match(ukWallClockSource, /toUkWallClockDateTime/);
  assert.match(ukWallClockSource, /startOfTodayInUk/);
});

test("schedule modal marks historical saved slots as kept history", () => {
  assert.match(modalSource, /function isHistoricalSlot/);
  assert.match(modalSource, /Historical booked slot kept for case, payment, and booking history\./);
  assert.match(modalSource, /disabled=\{isHistoricalSlot\(row\) \|\| row\.preserveOnly\}/);
  assert.match(modalSource, /Historical booked slots are kept in place\./);
});

test("schedule modal reads saved slot date and time with UK wall-clock helpers", () => {
  assert.match(modalSource, /getUkWallClockDateTimeParts/);
  assert.match(modalSource, /const start = getUkWallClockDateTimeParts\(slot\.startAt\)/);
  assert.match(modalSource, /const end = getUkWallClockDateTimeParts\(slot\.endAt\)/);
  assert.doesNotMatch(modalSource, /getTimezoneOffset/);
});

test("schedule modal puts add-slot controls above newest-first editable slots", () => {
  assert.match(modalSource, /const editableRowsNewestFirst = rows\.map\(\(row, index\) => \(\{ row, index \}\)\)\.reverse\(\)/);
  assert.match(modalSource, /editableRowsNewestFirst\.map\(\(\{ row, index \}\)/);
  assert.match(modalSource, /Slot \{index \+ 1\}/);
  assert.match(modalSource, /data-testid="button-add-service-schedule-slot"/);
  assert.match(modalSource, /data-testid="service-schedule-editable-slots"/);
  assert.match(modalSource, /data-testid="service-schedule-sticky-footer"/);
  assert.match(modalSource, /sticky bottom-0/);
  assert.ok(
    modalSource.indexOf('data-testid="button-add-service-schedule-slot"') <
      modalSource.indexOf('data-testid="service-schedule-editable-slots"'),
    "Add slot button should render before editable slots",
  );
  assert.ok(
    modalSource.indexOf('data-testid="service-schedule-editable-slots"') <
      modalSource.indexOf('data-testid="service-schedule-sticky-footer"'),
    "Editable slots should render before sticky save footer",
  );
});

test("mediator-facing service schedule copy is provider-neutral", () => {
  assert.doesNotMatch(modalSource, /Google Calendar event/);
  assert.doesNotMatch(modalSource, /unbooked Google Calendar events/);
  assert.match(modalSource, /connected calendar event/);
  assert.match(modalSource, /unbooked calendar events/);

  assert.doesNotMatch(drawerSource, /Google Calendar event/);
  assert.match(drawerSource, /connected calendar event/);
});

test("service approval drawer renders saved slots with UK wall-clock parts", () => {
  assert.match(drawerSource, /getUkWallClockDateTimeParts/);
  assert.match(drawerSource, /const start = getUkWallClockDateTimeParts\(slot\.startAt\)/);
  assert.match(drawerSource, /const end = getUkWallClockDateTimeParts\(slot\.endAt\)/);
  assert.doesNotMatch(drawerSource, /new Date\(slot\.startAt\)\.toLocaleDateString/);
  assert.doesNotMatch(drawerSource, /new Date\(slot\.startAt\)\.toLocaleTimeString/);
  assert.doesNotMatch(drawerSource, /new Date\(slot\.endAt\)\.toLocaleTimeString/);
});

test("docs describe service schedule slots as active-provider backed", () => {
  assert.match(replitSource, /service schedule slots use the mediator's active calendar provider/i);
});

test("schedule save triggers provider-aware background sync", () => {
  assert.match(serviceSource, /outlookCalendarService/);
  assert.match(serviceSource, /const syncProviderCalendar = \(provider: CalendarProvider\)/);
  assert.match(serviceSource, /provider === "outlook" \? outlookCalendarService : googleCalendarService/);
  assert.match(serviceSource, /syncProviderCalendar\(provider\)/);
  assert.match(serviceSource, /syncProviderCalendar\(activeProvider\)/);
  assert.doesNotMatch(serviceSource, /syncIfGoogle/);
});

test("schedule modal preserves unsupported overnight saved slots without blocking valid edits", () => {
  assert.match(modalSource, /unsupportedReason/);
  assert.match(modalSource, /Overnight availability is not supported in this editor/);
  assert.match(modalSource, /row\.unsupportedReason/);
  assert.match(modalSource, /const editableRows = rows\.filter\(\(row\) => !row\.unsupportedReason\)/);
  assert.match(drawerSource, /saveMediatorServiceSchedule/);
  assert.match(mediatorDetailSource, /saveMediatorServiceSchedule/);
  assert.match(scheduleSaveHelperSource, /preserveOnly: row\.preserveOnly \?\? false/);
  assert.match(routeSource, /preserveOnly: z\.boolean\(\)\.optional\(\)/);
  assert.match(routeSource, /preserveOnly: slot\.preserveOnly \?\? false/);
});

test("schedule service rejects submitted slot ids outside the selected mediator service", () => {
  assert.match(serviceSource, /Service slot was not found for this mediator and service\./);
  assert.match(serviceSource, /submittedIds/);
  assert.match(serviceSource, /!existingById\.has\(id\)/);
});
