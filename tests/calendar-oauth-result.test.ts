import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarOAuthResultMessage,
  parseCalendarOAuthResult,
  stripCalendarOAuthResultParams,
} from "../client/src/lib/calendar-oauth-result";

test("calendar OAuth result parser recognises success, warning, and provider", () => {
  assert.deepEqual(
    parseCalendarOAuthResult("?calendarConnected=true&calendarProvider=outlook&calendarWarning=initial_sync_delayed"),
    { connected: true, provider: "outlook", warning: "initial_sync_delayed", error: null },
  );
});

test("calendar OAuth messages are friendly and never echo unknown error values", () => {
  assert.deepEqual(calendarOAuthResultMessage({ connected: false, provider: "google", warning: null, error: "missing_write_scope" }), {
    title: "Google Calendar needs permission",
    description: "BFM needs permission to manage calendar events. Try again and allow calendar access.",
    variant: "destructive",
  });
  assert.deepEqual(calendarOAuthResultMessage({ connected: false, provider: "outlook", warning: null, error: "provider said secret-token-123" }), {
    title: "Microsoft Outlook connection failed",
    description: "BFM could not connect to Microsoft Outlook. Please try again. If the problem continues, contact BFM support.",
    variant: "destructive",
  });
});

test("calendar OAuth cleanup preserves unrelated query parameters", () => {
  assert.equal(
    stripCalendarOAuthResultParams("/appointments?mediator=abc&calendarError=access_denied&calendarProvider=google&view=week"),
    "/appointments?mediator=abc&view=week",
  );
  assert.equal(
    stripCalendarOAuthResultParams("/onboarding?calendarSetup=true&calendarConnected=true&calendarProvider=outlook"),
    "/onboarding?calendarSetup=true",
  );
});
