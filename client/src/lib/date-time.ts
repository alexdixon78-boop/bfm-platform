type DateInput = string | Date;

const UK_WALL_CLOCK_LOCALE = "en-GB";
const UK_WALL_CLOCK_TIME_ZONE = "UTC";
const UK_REAL_TIME_ZONE = "Europe/London";
const DATE_TIME_COMPONENT_KEYS: Array<keyof Intl.DateTimeFormatOptions> = [
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
];

function toDate(value: DateInput): Date {
  return typeof value === "string" ? new Date(value) : value;
}

function hasDateTimeComponents(options: Intl.DateTimeFormatOptions): boolean {
  return DATE_TIME_COMPONENT_KEYS.some((key) => options[key] !== undefined);
}

// Booking/session timestamps use the repo's wall-clock-as-UTC convention:
// render with UTC so a browser outside the UK does not shift the visible slot.
export function formatUkWallClockDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const defaults: Intl.DateTimeFormatOptions = hasDateTimeComponents(options)
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
    : { dateStyle: "medium", timeStyle: "short", hour12: false };
  return toDate(value).toLocaleString(UK_WALL_CLOCK_LOCALE, {
    ...defaults,
    ...options,
    timeZone: UK_WALL_CLOCK_TIME_ZONE,
  });
}

export function formatUkWallClockDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const defaults: Intl.DateTimeFormatOptions = hasDateTimeComponents(options)
    ? { year: "numeric", month: "short", day: "numeric" }
    : { dateStyle: "medium" };
  return toDate(value).toLocaleDateString(UK_WALL_CLOCK_LOCALE, {
    ...defaults,
    ...options,
    timeZone: UK_WALL_CLOCK_TIME_ZONE,
  });
}

export function formatUkWallClockTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return toDate(value).toLocaleTimeString(UK_WALL_CLOCK_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
    timeZone: UK_WALL_CLOCK_TIME_ZONE,
  });
}

// Connected Google and Outlook events are real instants. Calendar overlays
// always show those instants in BFM's product timezone, Europe/London.
export function getLondonInstantDateTimeParts(value: DateInput): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: UK_REAL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    })
      .formatToParts(toDate(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// Kept for existing callers whose values are already real instants.
export const getUkWallClockDateTimeParts = getLondonInstantDateTimeParts;
