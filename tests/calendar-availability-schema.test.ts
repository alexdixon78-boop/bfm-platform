import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("schema persists canonical availability sources, subscriptions, and reconciliation jobs", () => {
  const schema = read("shared/schema.ts");
  assert.match(schema, /mediatorCalendarAvailabilitySources = pgTable\("mediator_calendar_availability_sources"/);
  assert.match(schema, /calendarWebhookSubscriptions = pgTable\("calendar_webhook_subscriptions"/);
  assert.match(schema, /calendarAvailabilityReconciliationJobs = pgTable\("calendar_availability_reconciliation_jobs"/);
  assert.match(schema, /availabilitySourceId: varchar\("availability_source_id"\)/);
  assert.match(schema, /lifecycle: text\("lifecycle"\).*default\("active"\)/);
  assert.match(schema, /availabilityReservationMode: text\("availability_reservation_mode"\)/);
  assert.match(schema, /organizerEmail: text\("organizer_email"\)/);
  assert.match(schema, /externalSeriesId: text\("external_series_id"\)/);
  assert.match(schema, /isAllDay: boolean\("is_all_day"\).*default\(false\)/);
  assert.match(schema, /historicalAt: timestamp\("historical_at"\)/);
});

test("migration 0064 is additive and backfills provider-backed slots", () => {
  const path = "migrations/0064_calendar_availability_reconciliation.sql";
  assert.equal(existsSync(join(root, path)), true);
  const migration = read(path);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mediator_calendar_availability_sources/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_webhook_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_availability_reconciliation_jobs/);
  assert.match(migration, /INSERT INTO mediator_calendar_availability_sources/i);
  assert.match(migration, /UPDATE mediator_service_schedule_slots/i);
  assert.match(migration, /WHERE google_event_id IS NOT NULL/i);
  assert.match(migration, /ALTER TABLE google_calendar_events[\s\S]*organizer_email/i);
  assert.match(migration, /ALTER TABLE outlook_calendar_events[\s\S]*external_series_id/i);
});

test("migration 0065 supports all-day windows and lifecycle states", () => {
  const path = "migrations/0065_calendar_availability_window_states.sql";
  assert.equal(existsSync(join(root, path)), true);
  const migration = read(path);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS historical_at TIMESTAMP/i);
  assert.match(migration, /DROP INDEX IF EXISTS mediator_service_schedule_slots_source_service_unique/i);
  assert.match(migration, /availability_source_id, service_type_id, start_at, end_at/i);
  const journal = read("migrations/meta/_journal.json");
  assert.match(journal, /0065_calendar_availability_window_states/);
});
