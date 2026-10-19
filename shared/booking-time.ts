export type BookingTimeBasis = "instant" | "wall_clock_utc";

function formatTime(value: Date | string, basis: BookingTimeBasis): string {
  return new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: basis === "instant" ? "Europe/London" : "UTC",
  });
}

export function formatAppointmentTime(value: Date | string, basis: BookingTimeBasis): string {
  return formatTime(value, basis);
}

export function formatAppointmentDate(value: Date | string, basis: BookingTimeBasis, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...options,
    timeZone: basis === "instant" ? "Europe/London" : "UTC",
  });
}

export function formatAppointmentDateTime(value: Date | string, basis: BookingTimeBasis): string {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
    timeZone: basis === "instant" ? "Europe/London" : "UTC",
  });
}

export function formatAppointmentDateRange(
  value: Date | string,
  durationMinutes: number,
  basis: BookingTimeBasis,
): { date: string; startTime: string; endTime: string } {
  const start = new Date(value);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    date: formatAppointmentDate(start, basis),
    startTime: formatAppointmentTime(start, basis),
    endTime: formatAppointmentTime(end, basis),
  };
}

export function appointmentWallClockDate(value: Date | string, basis: BookingTimeBasis): Date {
  const date = new Date(value);
  if (basis === "wall_clock_utc") return date;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", hour12: false,
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}

export function buildBookingSlot(startAt: Date, duration: number, timeBasis: BookingTimeBasis) {
  const endAt = new Date(startAt.getTime() + duration * 60_000);
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    time: formatTime(startAt, timeBasis),
    endTime: formatTime(endAt, timeBasis),
    duration,
    timeBasis,
  };
}
