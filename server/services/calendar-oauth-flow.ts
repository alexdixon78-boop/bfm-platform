export const CALENDAR_OAUTH_RETURN_TARGETS = [
  "settings",
  "appointments",
  "dashboard",
  "onboarding",
] as const;

export type CalendarOAuthReturnTarget = typeof CALENDAR_OAUTH_RETURN_TARGETS[number];
export type CalendarOAuthProvider = "google" | "outlook";
export type CalendarOAuthErrorCode =
  | "not_configured"
  | "session_expired"
  | "mediator_only"
  | "disconnect_existing_provider"
  | "access_denied"
  | "missing_params"
  | "invalid_state"
  | "missing_write_scope"
  | "start_failed"
  | "exchange_failed";
export type CalendarOAuthWarningCode = "initial_sync_delayed";

export function parseCalendarOAuthReturnTarget(value: unknown): CalendarOAuthReturnTarget | null {
  if (typeof value !== "string") return null;
  return (CALENDAR_OAUTH_RETURN_TARGETS as readonly string[]).includes(value)
    ? value as CalendarOAuthReturnTarget
    : null;
}

export function calendarOAuthReturnPath(target: CalendarOAuthReturnTarget): string {
  if (target === "settings") return "/settings";
  if (target === "appointments") return "/appointments";
  if (target === "onboarding") return "/onboarding?calendarSetup=true";
  return "/dashboard";
}

export function buildCalendarOAuthRedirectUrl(
  baseUrl: string,
  target: CalendarOAuthReturnTarget,
  provider: CalendarOAuthProvider,
  result: {
    connected?: boolean;
    error?: CalendarOAuthErrorCode;
    warning?: CalendarOAuthWarningCode;
  },
): string {
  const url = new URL(calendarOAuthReturnPath(target), baseUrl);
  if (result.connected) url.searchParams.set("calendarConnected", "true");
  if (result.error) url.searchParams.set("calendarError", result.error);
  url.searchParams.set("calendarProvider", provider);
  if (result.warning) url.searchParams.set("calendarWarning", result.warning);
  return url.toString();
}

