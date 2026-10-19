import assert from "node:assert/strict";
import test from "node:test";
import { taskDeliveryKind } from "../shared/task-calendar-delivery";

test("mediators use an active connected provider and otherwise receive BFM invitation", () => {
  assert.equal(taskDeliveryKind({ role: "mediator", activeCalendarProvider: "google", googleCalendarConnected: true, googleScopeGranted: "https://www.googleapis.com/auth/calendar.events" }), "mediator_google");
  assert.equal(taskDeliveryKind({ role: "mediator", activeCalendarProvider: "outlook", outlookCalendarConnected: true, outlookScopeGranted: "Calendars.ReadWrite" }), "mediator_outlook");
  assert.equal(taskDeliveryKind({ role: "mediator", activeCalendarProvider: null }), "bfm_invite");
  assert.equal(taskDeliveryKind({ role: "staff", activeCalendarProvider: null }), "bfm_invite");
});
