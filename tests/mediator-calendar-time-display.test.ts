import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { getLondonInstantDateTimeParts } from "../client/src/lib/date-time";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("mediator personal calendar events use London time rather than UTC storage fields", () => {
  const weeklyCalendar = read("client/src/components/shared/weekly-calendar.tsx");
  const appointments = read("client/src/pages/appointments.tsx");

  assert.match(weeklyCalendar, /getLondonInstantDateTimeParts\(new Date\(ev\.startAt\)\)/);
  assert.match(appointments, /getLondonInstantDateTimeParts\(iso\)/);
  assert.match(weeklyCalendar, /Times shown in UK time \(Europe\/London\)/);
  assert.match(appointments, /Times shown in UK time \(Europe\/London\)/);
  assert.doesNotMatch(appointments, /function formatUtcDateTime/);
});

test("Google and Outlook personal calendar instants render in London time", () => {
  const expected = { date: "2026-10-12", time: "05:30" };

  assert.deepEqual(getLondonInstantDateTimeParts("2026-10-12T04:30:00.000Z"), expected);
  assert.deepEqual(getLondonInstantDateTimeParts("2026-12-12T04:30:00.000Z"), {
    date: "2026-12-12",
    time: "04:30",
  });
});

test("an Outlook 09:00 London event stays aligned to the appointments time rail", () => {
  assert.deepEqual(getLondonInstantDateTimeParts("2026-10-13T08:00:00.000Z"), {
    date: "2026-10-13",
    time: "09:00",
  });
});

test("an Outlook winter event does not gain a daylight-saving offset", () => {
  assert.deepEqual(getLondonInstantDateTimeParts("2026-12-13T09:00:00.000Z"), {
    date: "2026-12-13",
    time: "09:00",
  });
});

test("Appointments personal-event surfaces use the explicit London formatter", () => {
  const weeklyCalendar = read("client/src/components/shared/weekly-calendar.tsx");
  const appointments = read("client/src/pages/appointments.tsx");

  assert.match(weeklyCalendar, /getLondonInstantDateTimeParts\(new Date\(ev\.startAt\)\)/);
  assert.match(appointments, /getLondonInstantDateTimeParts\(iso\)/);
});
