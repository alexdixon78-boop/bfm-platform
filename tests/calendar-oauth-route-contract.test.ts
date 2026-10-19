import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("mediator OAuth routes preserve validated first-party return targets", () => {
  const routes = read("server/routes/google-calendar.routes.ts");
  const session = read("server/middleware/auth.ts");
  assert.match(routes, /parseCalendarOAuthReturnTarget/);
  assert.match(routes, /googleOAuthReturnTo/);
  assert.match(routes, /outlookOAuthReturnTo/);
  assert.match(routes, /buildCalendarOAuthRedirectUrl/);
  assert.match(session, /googleOAuthReturnTo/);
  assert.match(session, /outlookOAuthReturnTo/);
});

test("first-party OAuth initiation redirects expected failures instead of rendering JSON", () => {
  const routes = read("server/routes/google-calendar.routes.ts");
  assert.match(routes, /not_configured/);
  assert.match(routes, /session_expired/);
  assert.match(routes, /mediator_only/);
  assert.match(routes, /start_failed/);
  assert.match(routes, /disconnect_existing_provider/);
});

test("successful Google and Outlook authorization performs initial setup without rolling back valid connections", () => {
  const routes = read("server/routes/google-calendar.routes.ts");
  const subscriptions = read("server/services/calendar-webhook-subscription.service.ts");
  assert.match(routes, /outlookCalendarService\.syncCalendar\(mediatorId\)/);
  assert.match(routes, /ensureCalendarAvailabilitySubscription\(mediatorId, provider\)/);
  assert.match(routes, /initial_sync_delayed/);
  assert.match(subscriptions, /export async function ensureCalendarAvailabilitySubscription/);
});

test("all mediator calendar entry points identify their return page", () => {
  const modal = read("client/src/components/calendar/calendar-connect-modal.tsx");
  const settings = read("client/src/pages/settings.tsx");
  const appointments = read("client/src/pages/appointments.tsx");
  const dashboard = read("client/src/pages/dashboard.tsx");
  const onboarding = read("client/src/pages/onboarding.tsx");
  assert.match(modal, /returnTo/);
  assert.match(modal, /\/api\/auth\/google\?returnTo=/);
  assert.match(modal, /\/api\/auth\/outlook\?returnTo=/);
  assert.match(settings, /returnTo="settings"/);
  assert.match(appointments, /returnTo="appointments"/);
  assert.match(dashboard, /returnTo="dashboard"/);
  assert.match(onboarding, /returnTo=onboarding/);
});

test("Settings exposes confirmed provider-specific mediator disconnection", () => {
  const settings = read("client/src/pages/settings.tsx");
  assert.match(settings, /provider=\$\{disconnectProvider\}/);
  assert.match(settings, /Existing appointments will not be cancelled/);
  assert.match(settings, /button-mediator-disconnect-calendar/);
  assert.match(settings, /ConfirmDialog/);
});
