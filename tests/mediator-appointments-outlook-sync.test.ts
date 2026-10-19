/**
 * Regression checks for provider-aware mediator Appointments calendar status and Outlook sync.
 *
 * Run with: npx tsx tests/mediator-appointments-outlook-sync.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const schemaSource = read("shared/schema.ts");
const storageSource = read("server/storage.ts");
const outlookSource = read("server/services/outlook-calendar.service.ts");
const routesSource = read("server/routes/google-calendar.routes.ts");
const appointmentsSource = read("client/src/pages/appointments.tsx");
const weeklyCalendarSource = read("client/src/components/shared/weekly-calendar.tsx");
const docsSource = read("replit.md");

test("schema and migration persist Outlook calendar events", () => {
  assert.match(schemaSource, /outlookCalendarEvents = pgTable\("outlook_calendar_events"/);
  assert.match(schemaSource, /outlookEventId:\s*text\("outlook_event_id"\)\.notNull\(\)/);
  assert.match(schemaSource, /export type OutlookCalendarEvent/);
  assert.match(schemaSource, /export type InsertOutlookCalendarEvent/);

  const migrationPath = "migrations/0029_outlook_calendar_events.sql";
  assert.ok(existsSync(join(root, migrationPath)), "expected Outlook calendar events migration");
  const migration = read(migrationPath);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS outlook_calendar_events/);
  assert.match(migration, /UNIQUE \(mediator_id, outlook_event_id\)/);
});

test("storage exposes Outlook calendar event cache operations", () => {
  assert.match(storageSource, /type OutlookCalendarEvent, type InsertOutlookCalendarEvent/);
  assert.match(storageSource, /OutlookCalendarEventsRepository/);
  assert.match(storageSource, /upsertOutlookCalendarEvents\(events: InsertOutlookCalendarEvent\[\]\)/);
  assert.match(storageSource, /listOutlookCalendarEventsByDateRange\(mediatorId: string, start: Date, end: Date\)/);
  assert.match(storageSource, /deleteStaleOutlookCalendarEventsInRange/);
});

test("Outlook service syncs Microsoft Graph calendarView into the cache", () => {
  assert.match(outlookSource, /async syncCalendar\(mediatorId: string, reconciliationTrigger/);
  assert.match(outlookSource, /\/me\/calendarView\?/);
  assert.match(outlookSource, /storage\.upsertOutlookCalendarEvents\(toUpsert\)/);
  assert.match(outlookSource, /deleteStaleOutlookCalendarEventsInRange/);
  assert.match(outlookSource, /if \(!isOrganiser && !bfmAttendee\) continue/);
  assert.match(outlookSource, /lastOutlookSyncAt/);
  assert.match(outlookSource, /lastOutlookSyncError/);
  assert.match(outlookSource, /reconciliation/);
  assert.match(outlookSource, /parseCalendarDateTimeInstant/);
  assert.match(outlookSource, /outlookDateTimeToDate\(item\.start\?\.dateTime, item\.start\?\.timeZone\)/);
  assert.match(outlookSource, /outlookDateTimeToDate\(event\?\.start\?\.dateTime, event\?\.start\?\.timeZone\)/);
});

test("appointments calendar routes return events from active provider", () => {
  assert.match(routesSource, /activeCalendarProvider === "google"/);
  assert.match(routesSource, /activeCalendarProvider === "outlook"/);
  assert.match(routesSource, /listGoogleCalendarEventsByDateRange/);
  assert.match(routesSource, /listOutlookCalendarEventsByDateRange/);
  assert.match(routesSource, /outlookCalendarService\.syncCalendar/);
});

test("appointments calendar routes merge CRM service schedule slot cards", () => {
  assert.match(routesSource, /listServiceScheduleEventCards/);
  assert.match(routesSource, /mediatorServiceScheduleSlots/);
  assert.match(routesSource, /sourceKind: "service_schedule"/);
  assert.match(routesSource, /serviceTypeId: row\.serviceTypeId/);
  assert.match(routesSource, /serviceTypeName: row\.serviceTypeName/);
  assert.match(routesSource, /listAppointmentsByMediatorAndDateRange\(target\.id, start, end\)/);
  assert.match(routesSource, /appt\.status !== "cancelled" && appt\.status !== "expired"/);
  assert.match(routesSource, /externalEventIds\.has\(externalId\)/);
});

test("mediator Appointments page shows provider-aware status and sync controls", () => {
  assert.match(appointmentsSource, /outlookCalendarConnected: boolean/);
  assert.match(appointmentsSource, /activeCalendarProvider: "google" \| "outlook" \| null/);
  assert.match(appointmentsSource, /const activeCalendarReady =/);
  assert.match(appointmentsSource, /activeCalendarProvider === "outlook" && !!calStatus\?\.outlookCalendarConnected/);
  assert.match(appointmentsSource, /const activeCalendarEmail =/);
  assert.match(appointmentsSource, /Microsoft Outlook/);
  assert.match(appointmentsSource, /Choose active calendar provider/);
  assert.match(appointmentsSource, /onClick=\{\(\) => navigate\("\/settings"\)\}/);
  assert.match(appointmentsSource, /data-testid="text-active-calendar-provider"/);
  assert.doesNotMatch(appointmentsSource, /calStatus\?\.googleCalendarConnected\)\s*return/);
  assert.match(weeklyCalendarSource, /calendarProvider\?: "google" \| "outlook" \| null/);
  assert.match(weeklyCalendarSource, /sourceKind\?: "service_schedule" \| "calendar_cache"/);
  assert.match(weeklyCalendarSource, /ev\.sourceKind === "service_schedule"/);
  assert.match(weeklyCalendarSource, /ev\.source\.calendarProvider === "outlook" \? "Outlook" : "Google"/);
});

test("replit documents provider-aware Appointments calendar overlays", () => {
  assert.match(docsSource, /Appointments page/i);
  assert.match(docsSource, /active provider/i);
  assert.match(docsSource, /Outlook/i);
  assert.match(docsSource, /outlook_calendar_events/);
  assert.match(docsSource, /mediator_service_schedule_slots/);
  assert.match(docsSource, /split around active appointments/i);
});
