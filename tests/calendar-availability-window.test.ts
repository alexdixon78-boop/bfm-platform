import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendarAvailabilityWindows,
  getCalendarAvailabilityImportBounds,
} from "../server/services/calendar-availability-window";

test("builds a seven calendar day London import window", () => {
  const bounds = getCalendarAvailabilityImportBounds(new Date("2030-01-15T12:00:00.000Z"));
  assert.equal(bounds.historyStart.toISOString(), "2030-01-08T00:00:00.000Z");
  assert.equal(bounds.futureEnd.toISOString(), "2030-01-23T00:00:00.000Z");
});

test("keeps timed event times and classifies elapsed events as historical", () => {
  const now = new Date("2030-01-15T12:00:00.000Z");
  assert.deepEqual(buildCalendarAvailabilityWindows({
    startAt: new Date("2030-01-16T09:00:00.000Z"),
    endAt: new Date("2030-01-16T11:00:00.000Z"),
    isAllDay: false,
  }, now), [{
    startAt: new Date("2030-01-16T09:00:00.000Z"),
    endAt: new Date("2030-01-16T11:00:00.000Z"),
    state: "active",
  }]);
  assert.equal(buildCalendarAvailabilityWindows({
    startAt: new Date("2030-01-14T09:00:00.000Z"),
    endAt: new Date("2030-01-14T11:00:00.000Z"),
    isAllDay: false,
  }, now)[0]?.state, "historical");
});

test("expands a multi-day all-day event into London calendar days", () => {
  const windows = buildCalendarAvailabilityWindows({
    startAt: new Date("2030-03-30T00:00:00.000Z"),
    endAt: new Date("2030-04-02T00:00:00.000Z"),
    isAllDay: true,
  }, new Date("2030-03-29T12:00:00.000Z"));
  assert.deepEqual(windows.map((window) => [window.startAt.toISOString(), window.endAt.toISOString()]), [
    ["2030-03-30T00:00:00.000Z", "2030-03-31T00:00:00.000Z"],
    ["2030-03-31T00:00:00.000Z", "2030-03-31T23:00:00.000Z"],
    ["2030-03-31T23:00:00.000Z", "2030-04-01T23:00:00.000Z"],
  ]);
});

test("marks events outside the rolling window as out of window", () => {
  const windows = buildCalendarAvailabilityWindows({
    startAt: new Date("2030-02-01T09:00:00.000Z"),
    endAt: new Date("2030-02-01T10:00:00.000Z"),
    isAllDay: false,
  }, new Date("2030-01-15T12:00:00.000Z"));
  assert.deepEqual(windows, [{
    startAt: new Date("2030-02-01T09:00:00.000Z"),
    endAt: new Date("2030-02-01T10:00:00.000Z"),
    state: "out_of_window",
  }]);
});

test("clips long timed availability to the rolling import window", () => {
  const windows = buildCalendarAvailabilityWindows({
    startAt: new Date("2030-01-15T09:00:00.000Z"),
    endAt: new Date("2030-02-01T10:00:00.000Z"),
    isAllDay: false,
  }, new Date("2030-01-15T12:00:00.000Z"));
  assert.deepEqual(windows, [{
    startAt: new Date("2030-01-15T09:00:00.000Z"),
    endAt: new Date("2030-01-23T00:00:00.000Z"),
    state: "active",
  }]);
});

test("expands long all-day events only inside the rolling import window", () => {
  const windows = buildCalendarAvailabilityWindows({
    startAt: new Date("2030-01-01T00:00:00.000Z"),
    endAt: new Date("2030-02-01T00:00:00.000Z"),
    isAllDay: true,
  }, new Date("2030-01-15T12:00:00.000Z"));

  assert.equal(windows.length, 15);
  assert.equal(windows[0].startAt.toISOString(), "2030-01-08T00:00:00.000Z");
  assert.equal(windows.at(-1)?.endAt.toISOString(), "2030-01-23T00:00:00.000Z");
});
