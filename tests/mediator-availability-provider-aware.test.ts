/**
 * Regression checks for provider-aware calendar state in mediator Availability.
 *
 * Run with: npx tsx tests/mediator-availability-provider-aware.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const detailSource = read("../client/src/pages/mediator-detail.tsx");
const profileServiceSource = read("../server/services/mediator-profile.service.ts");
const docsSource = read("../replit.md");

test("profile bundle includes Outlook and active provider calendar state", () => {
  assert.match(profileServiceSource, /outlookCalendarConnected/);
  assert.match(profileServiceSource, /outlookCalendarEmail/);
  assert.match(profileServiceSource, /lastOutlookSyncAt/);
  assert.match(profileServiceSource, /lastOutlookSyncError/);
  assert.match(profileServiceSource, /activeCalendarProvider/);
});

test("AvailabilityTab derives calendar readiness from active Google or active Outlook", () => {
  assert.match(detailSource, /activeCalendarProvider === "google" && !!calendarProfile\.googleCalendarConnected/);
  assert.match(detailSource, /activeCalendarProvider === "outlook" && !!calendarProfile\.outlookCalendarConnected/);
  assert.match(detailSource, /calendarConnected: calendarReady/);
  assert.match(detailSource, /Calendar sync is required — connect your calendar to continue\./);
});

test("CalendarSyncCard renders provider-aware connected and choose-provider states", () => {
  assert.match(detailSource, /activeProviderLabel/);
  assert.match(detailSource, /Microsoft Outlook/);
  assert.match(detailSource, /Choose active calendar/);
  assert.match(detailSource, /Only the mediator can connect or choose their own calendar from their Settings page\./);
});

test("backend Section F save gate checks active connected provider, not Google only", () => {
  assert.match(profileServiceSource, /activeCalendarReady/);
  assert.match(profileServiceSource, /target\.activeCalendarProvider === "google" && !!target\.googleCalendarConnected/);
  assert.match(profileServiceSource, /target\.activeCalendarProvider === "outlook" && !!target\.outlookCalendarConnected/);
  assert.doesNotMatch(profileServiceSource, /touchesSectionF && !target\.googleCalendarConnected/);
});

test("replit documents provider-aware Availability tab behavior", () => {
  assert.match(docsSource, /Availability tab/i);
  assert.match(docsSource, /active connected provider/i);
  assert.match(docsSource, /Outlook-connected mediators/i);
});
