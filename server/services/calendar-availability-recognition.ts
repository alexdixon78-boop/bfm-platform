export type AvailabilityCalendarProvider = "google" | "outlook";

export const CALENDAR_AVAILABILITY_BFM_EMAIL = "info@brighterfuturemediation.co.uk";
export const CALENDAR_AVAILABILITY_TITLE_PREFIXES = ["bfm availability", "bfm available"] as const;

export type CalendarAvailabilityCandidate = {
  provider: AvailabilityCalendarProvider;
  externalEventId: string;
  externalSeriesId: string | null;
  title: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  organizerEmail: string | null;
  attendees: Array<{ email: string }>;
};

export type CalendarAvailabilityRejectionReason =
  | "invalid_window"
  | "title_mismatch"
  | "organizer_mismatch"
  | "bfm_attendee_missing";

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function recognizeCalendarAvailabilityEvent(
  event: CalendarAvailabilityCandidate,
  context: { connectedEmail: string | null | undefined; now?: Date },
): { qualified: true } | { qualified: false; reason: CalendarAvailabilityRejectionReason } {
  if (event.endAt <= event.startAt) return { qualified: false, reason: "invalid_window" };
  const normalizedTitle = (event.title ?? "").trim().toLowerCase();
  if (!CALENDAR_AVAILABILITY_TITLE_PREFIXES.some((prefix) => normalizedTitle.startsWith(prefix))) {
    return { qualified: false, reason: "title_mismatch" };
  }
  if (!context.connectedEmail || normalizeEmail(event.organizerEmail) !== normalizeEmail(context.connectedEmail)) {
    return { qualified: false, reason: "organizer_mismatch" };
  }
  if (!event.attendees.some((attendee) => normalizeEmail(attendee.email) === normalizeEmail(CALENDAR_AVAILABILITY_BFM_EMAIL))) {
    return { qualified: false, reason: "bfm_attendee_missing" };
  }
  return { qualified: true };
}
