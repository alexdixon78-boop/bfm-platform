import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateHourSlotsInWindow,
  SLOT_DURATION_MINUTES,
} from "../server/services/availability-windows";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function at(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 7, 6, hour, minute, 0, 0));
}

function slotRanges(startHour: number, startMinute: number, endHour: number, endMinute: number): string[] {
  return generateHourSlotsInWindow({ start: at(startHour, startMinute), end: at(endHour, endMinute) })
    .map((slot) => {
      const end = new Date(slot.getTime() + SLOT_DURATION_MINUTES * 60000);
      return `${String(slot.getUTCHours()).padStart(2, "0")}:${String(slot.getUTCMinutes()).padStart(2, "0")}`
        + `-${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}`;
    });
}

test("flexible slots include exact half-hour one-hour windows", () => {
  assert.deepEqual(slotRanges(13, 30, 14, 30), ["13:30-14:30"]);
});

test("flexible slots normalize arbitrary starts up to the next 15-minute boundary and step by duration", () => {
  assert.deepEqual(slotRanges(13, 5, 15, 55), ["13:15-14:15", "14:15-15:15"]);
});

test("flexible slots preserve aligned quarter-hour windows", () => {
  assert.deepEqual(slotRanges(14, 15, 17, 15), [
    "14:15-15:15",
    "15:15-16:15",
    "16:15-17:15",
  ]);
});

test("flexible slots omit windows that cannot fit a full service duration", () => {
  assert.deepEqual(slotRanges(13, 5, 14, 0), []);
});

test("booking validation accepts quarter-hour starts instead of hour-only starts", () => {
  const source = read("../server/services/booking.service.ts");
  assert.match(source, /getUTCMinutes\(\)\s*%\s*15\s*!==\s*0/);
  assert.match(source, /Appointments must start on a 15-minute boundary/);
  assert.doesNotMatch(source, /Appointments must start on the hour/);
});

test("public booking slot API and UI expose full time ranges", () => {
  const availabilitySource = read("../server/services/availability.service.ts");
  const bookPageSource = read("../client/src/pages/book.tsx");
  assert.match(availabilitySource, /endTime/);
  assert.match(bookPageSource, /slot\.endTime/);
});

test("MIAM booking availability requires lead-qualified mediator service assignment", () => {
  const availabilitySource = read("../server/services/availability.service.ts");
  assert.match(availabilitySource, /requiresLeadQualifiedService/);
  assert.match(availabilitySource, /mediatorServiceTypes\.mediationRoleQualification/);
  assert.match(availabilitySource, /isMediationRoleQualifiedFor\(.*"lead_mediator"\)/s);
});
