import { londonDateStartInstant, type ParsedTaskSchedule } from "@shared/task-domain";

export const DYNAMIC_INTAKE_FOLLOW_UP_TYPE = "enquiry_dynamic_follow_up";

export type DynamicFollowUpTimeWindow = {
  startTime: string;
  endTime: string;
};

export function londonDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function parseCalendarDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Follow-up date must use YYYY-MM-DD");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Follow-up date must use a valid YYYY-MM-DD date");
  }
  return parsed;
}

function addCalendarDays(date: string, days: number): string {
  const result = parseCalendarDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function followUpDateFromInterval(from: Date, intervalDays: number): string {
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new Error("Follow-up days must be a positive whole number");
  }
  return addCalendarDays(londonDate(from), intervalDays);
}

export function followUpIntervalFromDate(from: Date, followUpDate: string): number {
  const fromDate = parseCalendarDate(londonDate(from));
  const targetDate = parseCalendarDate(followUpDate);
  const intervalDays = Math.round((targetDate.getTime() - fromDate.getTime()) / 86_400_000);
  if (intervalDays < 1) throw new Error("Follow-up date must be a future date");
  return intervalDays;
}

export function dynamicFollowUpAudience(assignedUserIds: string[]): {
  recipientRole: "admin" | "task_assignee";
  assignedTo: string | null;
  assigneeIds: string[];
} {
  const assigneeIds = Array.from(new Set(assignedUserIds.map((id) => id.trim()).filter(Boolean)));
  return {
    recipientRole: assigneeIds.length ? "task_assignee" : "admin",
    assignedTo: assigneeIds[0] ?? null,
    assigneeIds,
  };
}

function londonTimeInstant(date: string, time: string): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error("Time must use HH:MM");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Time must use HH:MM");
  const [year, month, day] = date.split("-").map(Number);
  const initial = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(initial);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const displayedAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return new Date(initial.getTime() - (displayedAsUtc - initial.getTime()));
}

export function buildDynamicFollowUpSchedule(input: {
  from: Date;
  intervalDays?: number;
  followUpDate?: string;
  timeWindow?: DynamicFollowUpTimeWindow | null;
}): { dueAt: Date; followUpDate: string; intervalDays: number; schedule: ParsedTaskSchedule } {
  let intervalDays: number;
  let startDate: string;
  if (input.followUpDate !== undefined) {
    intervalDays = followUpIntervalFromDate(input.from, input.followUpDate);
    startDate = input.followUpDate;
    if (input.intervalDays !== undefined && input.intervalDays !== intervalDays) {
      throw new Error("Follow-up date does not match the selected number of days");
    }
  } else {
    if (input.intervalDays === undefined) throw new Error("Choose a follow-up date or number of days");
    intervalDays = input.intervalDays;
    startDate = followUpDateFromInterval(input.from, intervalDays);
  }
  if (!input.timeWindow) {
    return {
      dueAt: londonDateStartInstant(startDate),
      followUpDate: startDate,
      intervalDays,
      schedule: {
        kind: "all_day",
        startDate,
        endDateExclusive: addCalendarDays(startDate, 1),
        reminderMinutes: 1440,
      },
    };
  }
  if (!input.timeWindow.startTime || !input.timeWindow.endTime) {
    throw new Error("Follow-up time requires both a start and end time");
  }
  const startAt = londonTimeInstant(startDate, input.timeWindow.startTime);
  const endAt = londonTimeInstant(startDate, input.timeWindow.endTime);
  if (endAt <= startAt) throw new Error("Follow-up end time must be after the start time");
  return { dueAt: startAt, followUpDate: startDate, intervalDays, schedule: { kind: "timed", startAt, endAt, reminderMinutes: 30 } };
}
