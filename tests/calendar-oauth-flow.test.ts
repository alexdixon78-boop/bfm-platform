import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendarOAuthRedirectUrl,
  calendarOAuthReturnPath,
  parseCalendarOAuthReturnTarget,
} from "../server/services/calendar-oauth-flow";

test("calendar OAuth accepts only first-party return targets", () => {
  assert.equal(parseCalendarOAuthReturnTarget("settings"), "settings");
  assert.equal(parseCalendarOAuthReturnTarget("appointments"), "appointments");
  assert.equal(parseCalendarOAuthReturnTarget("dashboard"), "dashboard");
  assert.equal(parseCalendarOAuthReturnTarget("onboarding"), "onboarding");
  assert.equal(parseCalendarOAuthReturnTarget("https://evil.example"), null);
  assert.equal(parseCalendarOAuthReturnTarget("//evil.example"), null);
  assert.equal(parseCalendarOAuthReturnTarget("unknown"), null);
});

test("calendar OAuth maps return targets to fixed internal pages", () => {
  assert.equal(calendarOAuthReturnPath("settings"), "/settings");
  assert.equal(calendarOAuthReturnPath("appointments"), "/appointments");
  assert.equal(calendarOAuthReturnPath("dashboard"), "/dashboard");
  assert.equal(calendarOAuthReturnPath("onboarding"), "/onboarding?calendarSetup=true");
});

test("calendar OAuth redirect contains only safe result parameters", () => {
  assert.equal(
    buildCalendarOAuthRedirectUrl("https://crm.example", "settings", "google", {
      connected: true,
      warning: "initial_sync_delayed",
    }),
    "https://crm.example/settings?calendarConnected=true&calendarProvider=google&calendarWarning=initial_sync_delayed",
  );
  assert.equal(
    buildCalendarOAuthRedirectUrl("https://crm.example", "onboarding", "outlook", {
      error: "access_denied",
    }),
    "https://crm.example/onboarding?calendarSetup=true&calendarError=access_denied&calendarProvider=outlook",
  );
});

