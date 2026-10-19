const DAY_MS = 24 * 60 * 60 * 1000;

// One-off England and Wales bank holidays. Standard and substitute holidays
// are calculated below; add future proclamation holidays here when announced.
const EXCEPTIONAL_BANK_HOLIDAYS = new Set([
  "2022-06-02",
  "2022-06-03",
  "2022-09-19",
  "2023-05-08",
]);

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type LondonParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function londonParts(date: Date): LondonParts {
  const values = Object.fromEntries(londonFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  };
}

function londonWallClockToDate(parts: LondonParts, milliseconds: number): Date {
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, milliseconds);
  let instant = wallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = londonParts(new Date(instant));
    const renderedWallClock = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second, milliseconds);
    const adjustment = wallClock - renderedWallClock;
    if (adjustment === 0) break;
    instant += adjustment;
  }
  return new Date(instant);
}

function civilIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function nthMonday(year: number, month: number, fromEnd = false): Date {
  if (!fromEnd) {
    const first = utcDate(year, month, 1);
    return utcDate(year, month, 1 + ((8 - first.getUTCDay()) % 7));
  }
  const last = utcDate(year, month + 1, 0);
  return utcDate(year, month, last.getUTCDate() - ((last.getUTCDay() + 6) % 7));
}

export function englandWalesBankHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (date: Date) => holidays.add(isoDate(date));

  const newYear = utcDate(year, 0, 1);
  add(newYear.getUTCDay() === 6 ? utcDate(year, 0, 3) : newYear.getUTCDay() === 0 ? utcDate(year, 0, 2) : newYear);

  const easter = easterSunday(year);
  add(new Date(easter.getTime() - 2 * DAY_MS));
  add(new Date(easter.getTime() + DAY_MS));
  add(nthMonday(year, 4));
  // In 2022 the late-May spring bank holiday moved to Thursday 2 June
  // for the Platinum Jubilee; Friday 3 June was the additional holiday.
  if (year !== 2022) add(nthMonday(year, 4, true));
  add(nthMonday(year, 7, true));

  const christmasDay = utcDate(year, 11, 25);
  const christmasWeekday = christmasDay.getUTCDay();
  if (christmasWeekday === 6) {
    add(utcDate(year, 11, 27));
    add(utcDate(year, 11, 28));
  } else if (christmasWeekday === 0) {
    add(utcDate(year, 11, 26));
    add(utcDate(year, 11, 27));
  } else if (christmasWeekday === 5) {
    add(christmasDay);
    add(utcDate(year, 11, 28));
  } else {
    add(christmasDay);
    add(utcDate(year, 11, 26));
  }

  EXCEPTIONAL_BANK_HOLIDAYS.forEach((exceptional) => {
    if (exceptional.startsWith(`${year}-`)) holidays.add(exceptional);
  });
  return holidays;
}

export function isEnglandWalesWorkingDay(date: Date): boolean {
  const parts = londonParts(date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !englandWalesBankHolidays(parts.year).has(civilIsoDate(parts.year, parts.month, parts.day));
}

export function addEnglandWalesWorkingDays(start: Date, workingDays: number): Date {
  if (!Number.isInteger(workingDays) || workingDays < 0) {
    throw new Error("workingDays must be a non-negative integer");
  }
  const startParts = londonParts(start);
  const civilCursor = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day));
  let remaining = workingDays;
  while (remaining > 0) {
    civilCursor.setUTCDate(civilCursor.getUTCDate() + 1);
    const weekday = civilCursor.getUTCDay();
    const dateKey = isoDate(civilCursor);
    if (weekday !== 0 && weekday !== 6 && !englandWalesBankHolidays(civilCursor.getUTCFullYear()).has(dateKey)) remaining -= 1;
  }
  return londonWallClockToDate({
    year: civilCursor.getUTCFullYear(), month: civilCursor.getUTCMonth() + 1, day: civilCursor.getUTCDate(),
    hour: startParts.hour, minute: startParts.minute, second: startParts.second,
  }, start.getUTCMilliseconds());
}
