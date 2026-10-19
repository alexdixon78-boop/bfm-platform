/**
 * Regression tests for mediator service calendar events:
 * approved services can be saved to Google Calendar and surfaced in the dashboard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaSource = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/mediator-profile.routes.ts", import.meta.url), "utf8");
const serviceTypeRouteSource = readFileSync(new URL("../server/routes/service-type.routes.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../server/services/mediator-service-approval.service.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../server/services/dashboard.service.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../client/src/pages/mediator-detail.tsx", import.meta.url), "utf8");
const applicantServiceSource = readFileSync(new URL("../server/services/mediator-applicant.service.ts", import.meta.url), "utf8");

test("service approvals persist calendar event metadata", () => {
  assert.match(schemaSource, /calendarStartAt: timestamp\("calendar_start_at"\)/);
  assert.match(schemaSource, /calendarEndAt: timestamp\("calendar_end_at"\)/);
  assert.match(schemaSource, /calendarGoogleEventId: text\("calendar_google_event_id"\)/);
});

test("mediator profile exposes save/delete calendar event endpoints", () => {
  assert.match(routeSource, /service-approvals\/:serviceTypeId\/calendar-event/);
  assert.match(routeSource, /serviceCalendarEventSchema/);
  assert.match(routeSource, /delete\("\/api\/mediators\/:id\/service-approvals\/:serviceTypeId\/calendar-event"/);
});

test("service approval service can save and delete calendar events", () => {
  assert.match(serviceSource, /saveCalendarEvent/);
  assert.match(serviceSource, /deleteCalendarEvent/);
  assert.match(serviceSource, /Google Calendar must be connected before saving a service event/);
  assert.match(serviceSource, /This service event is already linked to a client booking and cannot be edited/);
});

test("dashboard merges service events into today's schedule", () => {
  assert.match(dashboardSource, /kind: "service_event"/);
  assert.match(dashboardSource, /calendarGoogleEventId/);
  assert.match(dashboardSource, /Service availability/);
});

test("mediator detail page can edit the calendar event for an approved service", () => {
  assert.match(pageSource, /Calendar event/);
  assert.match(pageSource, /Save to Google Calendar/);
  assert.match(pageSource, /Remove event/);
});

test("applicant conversion links every requested service to the mediator", () => {
  assert.match(applicantServiceSource, /linkApplicantRowsToMediator\(id, mediatorId\)/);
  assert.match(serviceSource, /Keep the mediator's service-offering list aligned with the applicant's/);
  assert.match(serviceSource, /await upsertMediatorServiceType\(mediatorId, updated\.serviceTypeId\)/);
});

test("mediator services endpoint includes requested approval rows too", () => {
  assert.match(serviceTypeRouteSource, /mediatorServiceApprovalService\.listForMediator/);
  assert.match(serviceTypeRouteSource, /new Set<string>\(\[/);
  assert.match(serviceTypeRouteSource, /Array\.from\(serviceTypeIds\)/);
});
