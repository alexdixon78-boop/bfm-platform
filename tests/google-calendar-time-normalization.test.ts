import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCalendarDateTimeInstant, parseGoogleDateTimeInstant } from "../server/utils/google-calendar-time";

test("Google offset-bearing BST timestamps retain their real instants", () => {
  assert.equal(
    parseGoogleDateTimeInstant("2026-10-02T13:00:00+01:00", "Europe/London").toISOString(),
    "2026-10-02T12:00:00.000Z",
  );
  assert.equal(
    parseGoogleDateTimeInstant("2026-10-02T15:00:00+01:00", "Europe/London").toISOString(),
    "2026-10-02T14:00:00.000Z",
  );
});

test("Google UTC and offset-less timestamps are parsed as real instants", () => {
  assert.equal(
    parseGoogleDateTimeInstant("2026-12-02T13:00:00Z", "Europe/London").toISOString(),
    "2026-12-02T13:00:00.000Z",
  );
  assert.equal(
    parseGoogleDateTimeInstant("2026-10-02T13:00:00", "Europe/London").toISOString(),
    "2026-10-02T12:00:00.000Z",
  );
});

test("Outlook offset-less Graph timestamps use their timezone hints during BST", () => {
  assert.equal(
    parseCalendarDateTimeInstant("2026-10-13T09:00:00", "GMT Standard Time").toISOString(),
    "2026-10-13T08:00:00.000Z",
  );
  assert.equal(
    parseCalendarDateTimeInstant("2026-10-12T13:00:00", "Europe/London").toISOString(),
    "2026-10-12T12:00:00.000Z",
  );
  assert.equal(
    parseCalendarDateTimeInstant("2026-12-12T13:00:00", "GMT Standard Time").toISOString(),
    "2026-12-12T13:00:00.000Z",
  );
  assert.equal(
    parseCalendarDateTimeInstant("2026-10-12T13:00:00+02:00", "GMT Standard Time").toISOString(),
    "2026-10-12T11:00:00.000Z",
  );
});
