import type { ParsedTaskSchedule } from "./task-domain";
import { occurrenceDates, scheduleOnDate, type TaskFrequency } from "./task-recurrence";

export function occurrenceTaskStatus(occurrenceDate: string, londonToday: string): "scheduled" | "active" {
  return occurrenceDate > londonToday ? "scheduled" : "active";
}

export function manualTaskPlan(input: {
  assigneeIds: string[];
  schedule: ParsedTaskSchedule | { kind: "timed"; startAt: string; endAt: string; reminderMinutes: number | null };
  frequency?: TaskFrequency;
  firstDate: string;
  throughDate: string;
  afterDate?: string;
}) {
  const ids = Array.from(new Set(input.assigneeIds));
  const dates = input.frequency ? occurrenceDates(input.firstDate, input.frequency, input.throughDate, input.afterDate) : [input.firstDate];
  return dates.flatMap((occurrenceDate) => ids.map((assigneeId) => ({
    assigneeId,
    occurrenceDate,
    schedule: scheduleOnDate(input.schedule, occurrenceDate),
  })));
}
