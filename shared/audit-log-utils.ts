const ukParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

function parseCalendarDate(value: string, label: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${label} date`);
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) {
    throw new Error(`Invalid ${label} date`);
  }
  return { year, month, day };
}

function ukMidnight({ year, month, day }: { year: number; month: number; day: number }): Date {
  const utcMidnight = Date.UTC(year, month - 1, day);
  const parts = Object.fromEntries(ukParts.formatToParts(new Date(utcMidnight)).map(part => [part.type, part.value]));
  const ukWallTimeAtUtcMidnight = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return new Date(utcMidnight - (ukWallTimeAtUtcMidnight - utcMidnight));
}

export function parseAuditDateRange(startDate?: string, endDate?: string): {
  start?: Date;
  endExclusive?: Date;
} {
  const startParts = startDate ? parseCalendarDate(startDate, "start") : undefined;
  const endParts = endDate ? parseCalendarDate(endDate, "end") : undefined;
  if (startDate && endDate && startDate > endDate) throw new Error("Start date is after the end date");
  const nextDay = endParts ? new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day + 1)) : undefined;
  return {
    start: startParts ? ukMidnight(startParts) : undefined,
    endExclusive: nextDay ? ukMidnight({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() }) : undefined,
  };
}

export function escapeAuditSearch(value: string): string {
  return value.trim().replace(/[\\%_]/g, "\\$&");
}

function titleize(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, match => match.toUpperCase());
}

export function formatAuditAction(value: string): string {
  return titleize(value);
}

export function formatAuditEntity(value: string): string {
  return titleize(value);
}

export function auditActorName(userId: string | null, name: string | null): string {
  return userId ? (name?.trim() || `Former user (${userId})`) : "System";
}

export function parseAuditDetails(details: string | null): Array<[string, string]> {
  if (!details) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null",
      ]);
    }
    return [["Details", typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2) ?? "null"]];
  } catch {
    return [["Details", details]];
  }
}
