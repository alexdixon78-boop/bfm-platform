import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appointmentWallClockDate,
  buildBookingSlot,
  formatAppointmentDateRange,
  formatAppointmentDateTime,
  formatAppointmentTime,
} from "../shared/booking-time";
import { toUkCalendarEventInstant } from "../server/utils/uk-wall-clock";

test("calendar backed MIAM and other service slots keep the exact BST instant", () => {
  for (const service of ["MIAM", "Other approved service"]) {
    const first = buildBookingSlot(new Date("2026-10-02T08:00:00.000Z"), 60, "instant");
    const second = buildBookingSlot(new Date("2026-10-02T09:00:00.000Z"), 60, "instant");
    assert.deepEqual([first.time, first.endTime, second.time, second.endTime], ["09:00", "10:00", "10:00", "11:00"], service);
    assert.equal(first.startAt, "2026-10-02T08:00:00.000Z", service);
    assert.equal(formatAppointmentTime(first.startAt, "instant"), "09:00", service);
  }
});

test("winter calendar slots and legacy wall-clock slots retain their intended labels", () => {
  assert.equal(buildBookingSlot(new Date("2026-12-02T09:00:00.000Z"), 60, "instant").time, "09:00");
  const legacy = buildBookingSlot(new Date("2026-10-02T09:00:00.000Z"), 60, "wall_clock_utc");
  assert.equal(legacy.time, "09:00");
  assert.equal(legacy.startAt, "2026-10-02T09:00:00.000Z");
  assert.equal(formatAppointmentTime(legacy.startAt, "wall_clock_utc"), "09:00");
});

test("appointment calendar positioning and confirmation use the saved basis", () => {
  const bstStart = "2026-10-02T08:00:00.000Z";
  assert.equal(appointmentWallClockDate(bstStart, "instant").toISOString(), "2026-10-02T09:00:00.000Z");
  assert.match(formatAppointmentDateTime(bstStart, "instant"), /09:00/);
  assert.equal(appointmentWallClockDate(bstStart, "wall_clock_utc").toISOString(), bstStart);
  assert.match(formatAppointmentDateTime(bstStart, "wall_clock_utc"), /08:00/);
});

test("calendar invitations preserve instants and convert legacy UK wall-clock appointments through BST", () => {
  const calendarBacked = new Date("2026-08-21T09:00:00.000Z");
  const legacyWallClock = new Date("2026-08-21T10:00:00.000Z");

  assert.equal(toUkCalendarEventInstant(calendarBacked, "instant").toISOString(), "2026-08-21T09:00:00.000Z");
  assert.equal(toUkCalendarEventInstant(legacyWallClock, "wall_clock_utc").toISOString(), "2026-08-21T09:00:00.000Z");
  assert.equal(
    toUkCalendarEventInstant(new Date("2026-12-21T10:00:00.000Z"), "wall_clock_utc").toISOString(),
    "2026-12-21T10:00:00.000Z",
  );
});

test("appointment email ranges render BST instants and legacy wall-clock values correctly", () => {
  assert.deepEqual(
    formatAppointmentDateRange(new Date("2026-10-14T09:00:00.000Z"), 60, "instant"),
    {
      date: "Wednesday, 14 October 2026",
      startTime: "10:00",
      endTime: "11:00",
    },
  );
  assert.deepEqual(
    formatAppointmentDateRange(new Date("2026-12-14T09:00:00.000Z"), 60, "instant"),
    {
      date: "Monday, 14 December 2026",
      startTime: "09:00",
      endTime: "10:00",
    },
  );
  assert.deepEqual(
    formatAppointmentDateRange(new Date("2026-07-14T09:00:00.000Z"), 60, "wall_clock_utc"),
    {
      date: "Tuesday, 14 July 2026",
      startTime: "09:00",
      endTime: "10:00",
    },
  );
});
