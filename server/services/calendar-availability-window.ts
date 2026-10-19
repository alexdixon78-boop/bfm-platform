import { getUkDateKey, toUkWallClockDateTime } from "../utils/uk-wall-clock";

export type CalendarAvailabilityWindowState = "active" | "historical" | "out_of_window";

export type CalendarAvailabilityWindow = {
  startAt: Date;
  endAt: Date;
  state: CalendarAvailabilityWindowState;
};

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function getCalendarAvailabilityImportBounds(now = new Date()) {
  const today = getUkDateKey(now);
  return {
    historyStart: toUkWallClockDateTime(addCalendarDays(today, -7), "00:00"),
    futureEnd: toUkWallClockDateTime(addCalendarDays(today, 8), "00:00"),
  };
}

function classifyWindow(startAt: Date, endAt: Date, now: Date): CalendarAvailabilityWindowState {
  const { historyStart, futureEnd } = getCalendarAvailabilityImportBounds(now);
  if (endAt <= historyStart || startAt >= futureEnd) return "out_of_window";
  return endAt <= now ? "historical" : "active";
}

export function buildCalendarAvailabilityWindows(
  event: { startAt: Date; endAt: Date; isAllDay: boolean },
  now = new Date(),
): CalendarAvailabilityWindow[] {
  if (!event.isAllDay) {
    const state = classifyWindow(event.startAt, event.endAt, now);
    const { historyStart, futureEnd } = getCalendarAvailabilityImportBounds(now);
    return [{
      startAt: state === "active" && event.startAt < historyStart ? historyStart : event.startAt,
      endAt: state === "active" && event.endAt > futureEnd ? futureEnd : event.endAt,
      state,
    }];
  }

  const startKey = getUkDateKey(event.startAt);
  const endExclusiveKey = getUkDateKey(event.endAt);
  const { historyStart, futureEnd } = getCalendarAvailabilityImportBounds(now);
  const boundedStartKey = startKey < getUkDateKey(historyStart) ? getUkDateKey(historyStart) : startKey;
  const boundedEndExclusiveKey = endExclusiveKey > getUkDateKey(futureEnd) ? getUkDateKey(futureEnd) : endExclusiveKey;
  if (boundedStartKey >= boundedEndExclusiveKey) {
    return [{ startAt: event.startAt, endAt: event.endAt, state: "out_of_window" }];
  }
  const windows: CalendarAvailabilityWindow[] = [];
  for (let dateKey = boundedStartKey; dateKey < boundedEndExclusiveKey; dateKey = addCalendarDays(dateKey, 1)) {
    const nextKey = addCalendarDays(dateKey, 1);
    const startAt = toUkWallClockDateTime(dateKey, "00:00");
    const endAt = toUkWallClockDateTime(nextKey, "00:00");
    windows.push({ startAt, endAt, state: classifyWindow(startAt, endAt, now) });
  }
  return windows;
}
