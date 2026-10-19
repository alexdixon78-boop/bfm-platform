export function isLegacyOpenCaseStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "open";
}

export function legacyDateToDate(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
