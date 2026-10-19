import type { User } from "@shared/schema";
import { googleCalendarService, hasWriteScope } from "./google-calendar.service";
import { outlookCalendarService, hasOutlookWriteScope } from "./outlook-calendar.service";

export type CalendarProvider = "google" | "outlook";
type CalendarEventData = {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  location?: string;
  allDayStart?: string;
  allDayEndExclusive?: string;
};
type CalendarEventPatch = Partial<CalendarEventData>;
type CalendarEventDetails = {
  id: string;
  summary: string | null;
  start: Date;
  end: Date;
  isAllDay: boolean;
  attendees: { email: string; displayName?: string; responseStatus?: string }[];
  organizerEmail: string | null;
  htmlLink: string | null;
};
export type MediatorCalendarProviderService = {
  createEvent(mediatorId: string, data: CalendarEventData): Promise<string>;
  patchEvent(mediatorId: string, eventId: string, patch: CalendarEventPatch): Promise<void>;
  deleteEvent(mediatorId: string, eventId: string): Promise<void>;
  getEventById(mediatorId: string, eventId: string): Promise<CalendarEventDetails | null>;
  splitAvailabilityForBooking(
    mediatorId: string,
    parentGoogleEventId: string,
    parentStart: Date,
    parentEnd: Date,
    parentTitle: string | null,
    booking: CalendarEventData,
    appointmentIdForAudit?: string,
    parentAttendees?: { email: string; displayName?: string }[],
  ): Promise<{ googleBookingEventId: string | null; googleTrailingRemnantEventId: string | null }>;
  restoreParentEventForCancelledBooking(
    mediatorId: string,
    info: {
      parentGoogleEventId: string;
      parentEventOriginalStart: Date;
      parentEventOriginalEnd: Date;
      parentEventOriginalTitle: string | null;
      parentEventOriginalAttendees?: string | null;
      googleBookingEventId: string | null;
      googleTrailingRemnantEventId: string | null;
    },
    appointmentIdForAudit?: string,
    excludeAppointmentId?: string,
  ): Promise<{ restoredParentId: string | null; aborted?: boolean }>;
};

export function isCalendarProvider(value: unknown): value is CalendarProvider {
  return value === "google" || value === "outlook";
}

export function getMediatorCalendarProviderService(provider: CalendarProvider): MediatorCalendarProviderService {
  return provider === "outlook" ? outlookCalendarService : googleCalendarService;
}

export function isMediatorProviderConnected(mediator: User, provider: CalendarProvider): boolean {
  if (provider === "google") {
    return !!mediator.googleCalendarConnected && hasWriteScope(mediator.googleScopeGranted);
  }
  return !!mediator.outlookCalendarConnected && hasOutlookWriteScope(mediator.outlookScopeGranted);
}

export function getConnectedActiveCalendarProvider(mediator: User): CalendarProvider | null {
  const active = mediator.activeCalendarProvider;
  if (!isCalendarProvider(active)) return null;
  return isMediatorProviderConnected(mediator, active) ? active : null;
}

export function assertActiveMediatorCalendarProvider(mediator: User): CalendarProvider {
  const provider = getConnectedActiveCalendarProvider(mediator);
  if (provider) return provider;
  const err = new Error("Choose an active connected calendar provider before saving provider-backed schedule slots.");
  (err as { status?: number }).status = 400;
  throw err;
}

export function getAppointmentCalendarProvider(appt: {
  parentCalendarProvider?: string | null;
  bookingCalendarProvider?: string | null;
  trailingRemnantCalendarProvider?: string | null;
  parentGoogleEventId?: string | null;
}): CalendarProvider | null {
  if (isCalendarProvider(appt.parentCalendarProvider)) return appt.parentCalendarProvider;
  if (isCalendarProvider(appt.bookingCalendarProvider)) return appt.bookingCalendarProvider;
  if (isCalendarProvider(appt.trailingRemnantCalendarProvider)) return appt.trailingRemnantCalendarProvider;
  return appt.parentGoogleEventId ? "google" : null;
}
