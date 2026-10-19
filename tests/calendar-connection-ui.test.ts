/**
 * Regression checks for Google/Outlook calendar connection UI.
 *
 * Run with: npx tsx tests/calendar-connection-ui.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dashboardSource = read("../client/src/pages/dashboard.tsx");
const settingsSource = read("../client/src/pages/settings.tsx");
const modalSource = read("../client/src/components/calendar/calendar-connect-modal.tsx");
const onboardingSource = read("../client/src/pages/onboarding.tsx");
const mediatorsSource = read("../client/src/pages/mediators.tsx");

function sliceFrom(source: string, marker: string, length = 1200): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing marker: ${marker}`);
  return source.slice(start, start + length);
}

test("dashboard calendar prompt requires an active connected Google or Outlook provider", () => {
  assert.match(dashboardSource, /const mediatorCalendarReady = \(user\.activeCalendarProvider === "google" && !!user\.googleCalendarConnected\)/);
  assert.match(dashboardSource, /user\.activeCalendarProvider === "outlook" && !!user\.outlookCalendarConnected/);
  assert.match(dashboardSource, /if \(mediatorCalendarReady\) return/);
});

test("settings calendar panel derives connected display from Google or Outlook", () => {
  assert.match(settingsSource, /outlookCalendarConnected: boolean/);
  assert.match(settingsSource, /outlookCalendarEmail: string \| null/);
  assert.match(settingsSource, /const googleConnected = !!status\?\.googleCalendarConnected/);
  assert.match(settingsSource, /const outlookConnected = !!status\?\.outlookCalendarConnected/);
  assert.match(settingsSource, /const connected = googleConnected \|\| outlookConnected/);
  assert.match(settingsSource, /const connectedProviderLabel = googleConnected \? "Google Calendar" : outlookConnected \? "Microsoft Outlook" : "Calendar"/);
  assert.match(settingsSource, /const connectedEmail = googleConnected \? status\?\.googleCalendarEmail : outlookConnected \? status\?\.outlookCalendarEmail : null/);
});

test("Outlook connect cards do not show the Available badge", () => {
  const modalOutlookCard = sliceFrom(modalSource, 'data-testid="card-calendar-connect-outlook"');
  const onboardingOutlookCard = sliceFrom(onboardingSource, 'data-testid="card-outlook"');

  assert.doesNotMatch(modalOutlookCard, />\s*Available\s*</);
  assert.doesNotMatch(onboardingOutlookCard, />\s*Available\s*</);
});

test("mediators listing derives calendar badges from Google or Outlook provider state", () => {
  assert.match(mediatorsSource, /outlookCalendarConnected\?: boolean/);
  assert.match(mediatorsSource, /outlookCalendarEmail\?: string \| null/);
  assert.match(mediatorsSource, /activeCalendarProvider\?: CalendarProvider \| null/);
  assert.match(mediatorsSource, /function getMediatorCalendarStatus\(mediator: Mediator\)/);
  assert.match(mediatorsSource, /mediator\.activeCalendarProvider === "outlook" && !!mediator\.outlookCalendarConnected/);
  assert.match(mediatorsSource, /const connected = googleConnected \|\| outlookConnected/);
  assert.match(mediatorsSource, /Microsoft Outlook/);
  assert.match(mediatorsSource, /badge-calendar-connected-\$\{m\.id\}/);
  assert.doesNotMatch(mediatorsSource, /\}\s*:\s*m\.googleCalendarConnected\s*\?\s*\(/);
});
