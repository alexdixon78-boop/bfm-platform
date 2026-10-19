import type { ParsedTaskSchedule } from "./task-domain";

export type TaskFrequency = "daily" | "weekly" | "monthly";

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parts(date: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error("Invalid recurrence date");
  const [year, month, day] = date.split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) throw new Error("Invalid recurrence date");
  return [year, month, day];
}

export function occurrenceDates(startDate: string, frequency: TaskFrequency, throughDate: string, afterDate?: string): string[] {
  const [year, month, day] = parts(startDate);
  parts(throughDate);
  if (afterDate) parts(afterDate);
  const dates: string[] = [];
  const elapsedDays = afterDate ? Math.floor((Date.parse(`${afterDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) : 0;
  const startIndex = frequency === "monthly" && afterDate
    ? Math.max(0, (Number(afterDate.slice(0, 4)) - year) * 12 + Number(afterDate.slice(5, 7)) - month - 1)
    : Math.max(0, Math.floor(elapsedDays / (frequency === "weekly" ? 7 : 1)));
  for (let index = startIndex; index < startIndex + 50_000; index += 1) {
    let value: string;
    if (frequency === "monthly") {
      const targetMonth = month - 1 + index;
      const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
      value = isoDate(year + Math.floor(targetMonth / 12), targetMonth % 12 + 1, Math.min(day, lastDay));
    } else {
      const date = new Date(Date.UTC(year, month - 1, day + index * (frequency === "weekly" ? 7 : 1)));
      value = date.toISOString().slice(0, 10);
    }
    if (value > throughDate) break;
    if (afterDate && value <= afterDate) continue;
    dates.push(value);
  }
  return dates;
}

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function londonParts(date: Date) {
  const values = londonFormatter.formatToParts(date);
  const number = (name: Intl.DateTimeFormatPartTypes) => Number(values.find((part) => part.type === name)?.value);
  return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour"), minute: number("minute"), second: number("second") };
}

function londonInstant(date: string, hour: number, minute: number, second: number): Date {
  const [year, month, day] = parts(date);
  const expected = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = new Date(expected);
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = londonParts(candidate);
    candidate = new Date(candidate.getTime() - (Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second) - expected));
  }
  const actual = londonParts(candidate);
  if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== hour || actual.minute !== minute || actual.second !== second) {
    throw new Error("That recurrence time does not exist in Europe/London because the clocks change");
  }
  return candidate;
}

export function scheduleOnDate(base: ParsedTaskSchedule | { kind: "timed"; startAt: string; endAt: string; reminderMinutes: number | null }, occurrenceDate: string) {
  parts(occurrenceDate);
  if (base.kind === "all_day") {
    const span = Math.round((Date.parse(`${base.endDateExclusive}T00:00:00Z`) - Date.parse(`${base.startDate}T00:00:00Z`)) / 86_400_000);
    const endDateExclusive = new Date(Date.parse(`${occurrenceDate}T00:00:00Z`) + span * 86_400_000).toISOString().slice(0, 10);
    return { kind: "all_day" as const, startDate: occurrenceDate, endDateExclusive, reminderMinutes: base.reminderMinutes };
  }
  const originalStart = new Date(base.startAt);
  const originalEnd = new Date(base.endAt);
  const start = londonParts(originalStart);
  const duration = originalEnd.getTime() - originalStart.getTime();
  let startAt: Date;
  try {
    startAt = londonInstant(occurrenceDate, start.hour, start.minute, start.second);
  } catch (error) {
    if (start.hour !== 1) throw error;
    startAt = londonInstant(occurrenceDate, 2, start.minute, start.second);
  }
  return { kind: "timed" as const, startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + duration).toISOString(), reminderMinutes: base.reminderMinutes };
}
