const UK_TIME_ZONE = "Europe/London";
export { UK_TIME_ZONE };

const ukDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function getUkParts(value: Date) {
  const parts = Object.fromEntries(
    ukDateTimeFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getTimeZoneOffsetMs(value: Date): number {
  const parts = getUkParts(value);
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallClockAsUtc - value.getTime();
}

export function toUkWallClockDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = new Date(wallClockAsUtc - getTimeZoneOffsetMs(new Date(wallClockAsUtc)));
  return new Date(wallClockAsUtc - getTimeZoneOffsetMs(firstPass));
}

/**
 * Convert an appointment into the real instant that represents its intended
 * UK appointment time. Legacy rows stored their UK wall-clock label as UTC;
 * calendar-backed rows already contain a real instant.
 */
export function toUkCalendarEventInstant(
  value: Date | string,
  basis: "instant" | "wall_clock_utc",
): Date {
  const date = new Date(value);
  if (basis === "instant") return date;
  const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return toUkWallClockDateTime(dateKey, time);
}

export function getUkDateKey(value = new Date()): string {
  const parts = getUkParts(value);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function startOfTodayInUk(value = new Date()): Date {
  return toUkWallClockDateTime(getUkDateKey(value), "00:00");
}
