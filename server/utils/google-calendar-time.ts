const OFFSET_OR_Z_RE = /(?:Z|[+-]\d{2}:?\d{2})$/;
const WALL_CLOCK_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const MICROSOFT_TIME_ZONE_ALIASES: Record<string, string> = {
  "GMT Standard Time": "Europe/London",
  UTC: "UTC",
};

function resolveTimeZone(timeZone: string): string {
  return MICROSOFT_TIME_ZONE_ALIASES[timeZone] ?? timeZone;
}

function partsFromZonedInstant(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

function wallClockInZoneToInstant(wallClockString: string, timeZone: string): Date {
  const match = wallClockString.match(WALL_CLOCK_PARTS_RE);
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute, second] = match;
  const guess = Date.UTC(+year, +month - 1, +day, +hour, +minute, second ? +second : 0);
  const zoned = partsFromZonedInstant(new Date(guess), timeZone);
  const zoneRenderedUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
  return new Date(guess - (zoneRenderedUtc - guess));
}

// Calendar providers normally supply an offset. The timezone hint covers an
// offset-less payload without turning a real instant into a wall-clock-as-UTC
// value during BST.
export function parseCalendarDateTimeInstant(dateTimeString: string, timeZoneHint?: string | null): Date {
  let absoluteInstant: Date;
  if (OFFSET_OR_Z_RE.test(dateTimeString)) {
    absoluteInstant = new Date(dateTimeString);
  } else if (timeZoneHint) {
    absoluteInstant = wallClockInZoneToInstant(dateTimeString, resolveTimeZone(timeZoneHint));
  } else {
    console.warn(
      `[CalendarTime] dateTime "${dateTimeString}" has no offset and no timeZone hint — treating as UTC`,
    );
    absoluteInstant = new Date(dateTimeString + (dateTimeString.endsWith("Z") ? "" : "Z"));
  }
  if (Number.isNaN(absoluteInstant.getTime())) {
    throw new Error(`Invalid calendar event dateTime: "${dateTimeString}"`);
  }
  return absoluteInstant;
}

export const parseGoogleDateTimeInstant = parseCalendarDateTimeInstant;
