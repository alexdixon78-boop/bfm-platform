/**
 * Regression checks for the booking/session wall-clock-as-UTC display helpers.
 *
 * Run with: npx tsx tests/uk-wall-clock-format.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Asia/Kolkata";

test("UK wall-clock helpers do not shift booking times into the browser timezone", async () => {
  const {
    formatUkWallClockDateTime,
    formatUkWallClockDate,
    formatUkWallClockTime,
    getUkWallClockDateTimeParts,
  } = await import("../client/src/lib/date-time");

  const value = "2026-08-26T10:00:00.000Z";

  assert.equal(formatUkWallClockTime(value), "10:00");
  assert.match(
    formatUkWallClockDate(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    /Wednesday, 26 August 2026/,
  );

  const formatted = formatUkWallClockDateTime(value, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  assert.match(formatted, /10:00/);
  assert.doesNotMatch(formatted, /15:30/);
  assert.deepEqual(getUkWallClockDateTimeParts("2026-08-26T17:00:00.000Z"), { date: "2026-08-26", time: "18:00" });
  assert.deepEqual(getUkWallClockDateTimeParts("2026-01-26T09:00:00.000Z"), { date: "2026-01-26", time: "09:00" });
});

test("server UK wall-clock parser stores London local slots as absolute instants", async () => {
  const {
    getUkDateKey,
    startOfTodayInUk,
    toUkWallClockDateTime,
  } = await import("../server/utils/uk-wall-clock");

  assert.equal(toUkWallClockDateTime("2026-08-21", "09:00").toISOString(), "2026-08-21T08:00:00.000Z");
  assert.equal(toUkWallClockDateTime("2026-01-21", "09:00").toISOString(), "2026-01-21T09:00:00.000Z");
  assert.equal(getUkDateKey(new Date("2026-08-27T23:30:00.000Z")), "2026-08-28");
  assert.equal(startOfTodayInUk(new Date("2026-08-27T12:00:00.000Z")).toISOString(), "2026-08-26T23:00:00.000Z");
});

test("appointment join route compares appointment day in UK time and logs client joins as clients", async () => {
  const { readFileSync } = await import("node:fs");
  const routes = readFileSync(new URL("../server/routes/appointment.routes.ts", import.meta.url), "utf8");
  const policy = readFileSync(new URL("../server/security/appointment-join-policy.ts", import.meta.url), "utf8");

  assert.match(routes, /buildSessionJoinAvailability/);
  assert.match(policy, /getUkDateKey/);
  assert.match(policy, /appointmentDay > today/);
  assert.match(policy, /appointmentDay < today/);
  assert.doesNotMatch(routes, /function isSameLocalDate/);
  assert.match(routes, /clientActor/);
  assert.match(routes, /buildAppointmentJoinActor/);
  assert.match(routes, /role: user\.role/);
  assert.match(routes, /joinedAt: new Date\(\)\.toISOString\(\)/);
});
