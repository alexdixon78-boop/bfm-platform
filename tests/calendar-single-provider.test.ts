import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const routes = read("server/routes/google-calendar.routes.ts");
const modal = read("client/src/components/calendar/calendar-connect-modal.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");

test("OAuth initiation and callbacks refuse a second calendar provider", () => {
  assert.match(routes, /already has Microsoft Outlook connected/);
  assert.match(routes, /already has Google Calendar connected/);
  assert.match(routes, /sendCalendarOAuthStartError[\s\S]*"disconnect_existing_provider"/);
});

test("calendar modal disables connecting the other provider", () => {
  assert.match(modal, /connectedProvider/);
  assert.match(modal, /Disconnect your current calendar before connecting another/);
  assert.match(modal, /disabled=\{connectedProvider === "outlook"\}/);
  assert.match(modal, /disabled=\{connectedProvider === "google"\}/);
  assert.match(dashboard, /connectedProvider=\{user\?\.activeCalendarProvider === "google"/);
});
