export type TaskDeliveryKind = "bfm" | "bfm_invite" | "mediator_google" | "mediator_outlook";

export function taskDeliveryKind(user: {
  role: string;
  activeCalendarProvider?: string | null;
  googleCalendarConnected?: boolean | null;
  googleScopeGranted?: string | null;
  outlookCalendarConnected?: boolean | null;
  outlookScopeGranted?: string | null;
}): TaskDeliveryKind {
  if (user.role === "mediator" && user.activeCalendarProvider === "google" && user.googleCalendarConnected
    && user.googleScopeGranted?.split(/\s+/).some((scope) => ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"].includes(scope))) return "mediator_google";
  if (user.role === "mediator" && user.activeCalendarProvider === "outlook" && user.outlookCalendarConnected
    && user.outlookScopeGranted?.split(/\s+/).includes("Calendars.ReadWrite")) return "mediator_outlook";
  return "bfm_invite";
}
