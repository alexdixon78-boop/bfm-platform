import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("schema and migration persist active provider and event providers", () => {
  const schema = read("shared/schema.ts");
  assert.match(schema, /activeCalendarProvider:\s*text\("active_calendar_provider"\)/);
  assert.match(schema, /calendarProvider:\s*text\("calendar_provider"\)/);
  assert.match(schema, /parentCalendarProvider:\s*text\("parent_calendar_provider"\)/);
  assert.match(schema, /bookingCalendarProvider:\s*text\("booking_calendar_provider"\)/);
  assert.match(schema, /trailingRemnantCalendarProvider:\s*text\("trailing_remnant_calendar_provider"\)/);

  const migrationPath = "migrations/0028_provider_aware_mediator_calendar.sql";
  assert.ok(existsSync(join(root, migrationPath)), "expected provider-aware migration");
  const migration = read(migrationPath);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS active_calendar_provider/);
  assert.match(migration, /google_calendar_connected.+outlook_calendar_connected/s);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS calendar_provider/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS parent_calendar_provider/);
});

test("mediator calendar provider abstraction routes Google and Outlook", () => {
  const providerPath = "server/services/mediator-calendar-provider.service.ts";
  assert.ok(existsSync(join(root, providerPath)), "expected provider abstraction service");
  const source = read(providerPath);
  assert.match(source, /activeCalendarProvider/);
  assert.match(source, /googleCalendarService/);
  assert.match(source, /outlookCalendarService/);
  assert.match(source, /getMediatorCalendarProviderService/);
  assert.match(source, /assertActiveMediatorCalendarProvider/);
});

test("Outlook service implements Graph event lifecycle", () => {
  const source = read("server/services/outlook-calendar.service.ts");
  assert.match(source, /graph\.microsoft\.com\/v1\.0/);
  assert.match(source, /\/me\/events/);
  assert.match(source, /async createEvent/);
  assert.match(source, /async patchEvent/);
  assert.match(source, /async deleteEvent/);
  assert.match(source, /async getEventById/);
  assert.match(source, /async splitAvailabilityForBooking/);
  assert.match(source, /async restoreParentEventForCancelledBooking/);
});

test("booking and appointment lifecycle use recorded provider while BFM invite remains Google", () => {
  const booking = read("server/services/booking.service.ts");
  assert.match(booking, /parentCalendarProvider:\s*isCalendarBacked/);
  assert.doesNotMatch(booking, /isGoogleBacked/);

  const appointment = read("server/services/appointment.service.ts");
  assert.match(appointment, /getMediatorCalendarProviderService/);
  assert.match(appointment, /parentCalendarProvider/);
  assert.match(appointment, /bookingCalendarProvider/);
  assert.match(appointment, /googleCalendarService\.createBfmEvent/);
});

test("settings expose mediator active-provider selector and docs are current", () => {
  const settings = read("client/src/pages/settings.tsx");
  assert.match(settings, /activeCalendarProvider/);
  assert.match(settings, /\/api\/calendar\/active-provider/);
  assert.match(settings, /data-testid="button-active-calendar-google"/);
  assert.match(settings, /data-testid="button-active-calendar-outlook"/);

  const docs = read("replit.md");
  assert.doesNotMatch(docs, /Booking logic remains Google-driven in this pass/);
  assert.match(docs, /active calendar provider/i);
  assert.match(docs, /BFM info@.+Google-backed/i);
});
