import { storage } from "../storage";
import { db } from "../db";
import { appointmentCalendarSyncJobs, appointments, notifications, type Appointment, type InsertAppointment, type User } from "@shared/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { ServiceResult } from "./types";
import { randomBytes } from "crypto";
import { generateIcsContent } from "../utils/ics";
import { compareRoleLetters, formatCaseRefWithRole } from "../utils/case-ref";
import { formatMiamCalendarTitle, formatSessionCalendarTitle } from "../utils/case-communication-format";
import { googleCalendarService } from "./google-calendar.service";
import {
  getAppointmentCalendarProvider,
  getMediatorCalendarProviderService,
  isMediatorProviderConnected,
  type CalendarProvider,
} from "./mediator-calendar-provider.service";
import { logAudit } from "./audit-log.service";
import type { Actor } from "./case-activity.service";
import { caseActivityService, clientActor, staffActor, systemActor } from "./case-activity.service";
import { notificationService } from "./notification.service";
import { appointmentLifecycleHistoryService } from "./appointment-lifecycle-history.service";
import {
  calculateFollowUpDueAt,
  calculateHoldAlertAt,
  calculateHoldDeadline,
  canConfirmAppointmentPayment,
  isAppointmentPaymentStatus,
  type AppointmentPaymentStatus,
} from "./appointment-rules";
import { isPaidPublicBookingEligibleForAutoConfirmation } from "./appointment-calendar-sync-rules";
import { emailTemplateService } from "./email-template.service";
import { calendarTemplateCode } from "./email-calendar-template";
import { mediationClientCalendarService } from "./mediation-client-calendar.service";
import { formatAppointmentDateTime } from "@shared/booking-time";
import { toUkCalendarEventInstant } from "../utils/uk-wall-clock";

const BFM_EMAIL = process.env.BFM_CALENDAR_EMAIL ?? "info@brighterfuturemediation.co.uk";
const HOLD_STATUSES = ["hold", "held"] as const;
const APPOINTMENT_REMINDER_WINDOWS = [
  { key: "48h", label: "48-hour", ms: 48 * 60 * 60 * 1000 },
  { key: "24h", label: "24-hour", ms: 24 * 60 * 60 * 1000 },
  { key: "2h", label: "2-hour", ms: 2 * 60 * 60 * 1000 },
] as const;
const UK_TIME_ZONE_NOTICE = "All times are UK time (Europe/London).";

function withUkTimeZoneNotice(description: string): string {
  return description.includes(UK_TIME_ZONE_NOTICE) ? description : `${description}\n\n${UK_TIME_ZONE_NOTICE}`;
}

function isHoldStatus(status: string): boolean {
  return (HOLD_STATUSES as readonly string[]).includes(status);
}

function hasMediatorCalendarReservation(appt: Appointment): boolean {
  return !!(appt.parentGoogleEventId && (appt.googleBookingEventId || appt.googleTrailingRemnantEventId));
}

function isMiamService(serviceType?: { name?: string | null; category?: string | null } | null): boolean {
  return serviceType?.category === "MIAM" || /\bMIAM\b/i.test(serviceType?.name || "");
}

function isMediationSessionService(serviceType?: { name?: string | null; category?: string | null } | null): boolean {
  return serviceType?.name === "Mediation Sessions";
}

function isUniqueConstraintError(err: unknown, constraintName: string): boolean {
  const e = err as { code?: string; constraint?: string; constraint_name?: string; message?: string };
  return e?.code === "23505"
    && ((e.constraint ?? e.constraint_name) === constraintName || (e.message ?? "").includes(constraintName));
}

async function buildCalendarTitleForAppointment(appt: Appointment): Promise<string> {
  const [caseData, mediator, serviceTypes, appointmentParty, parties] = await Promise.all([
    storage.getCase(appt.caseId),
    appt.mediatorId ? storage.getUser(appt.mediatorId) : Promise.resolve(null),
    storage.listServiceTypes(),
    appt.partyId ? storage.getParty(appt.partyId) : Promise.resolve(null),
    storage.listPartiesByCase(appt.caseId),
  ]);
  const serviceType = appt.serviceTypeId ? serviceTypes.find(s => s.id === appt.serviceTypeId) : null;
  if (isMiamService(serviceType)) {
    return formatMiamCalendarTitle({
      mediatorName: mediator?.name,
      clientFirstName: appointmentParty?.firstName,
      caseRef: caseData?.caseRef,
    });
  }
  if (isMediationSessionService(serviceType) && !appt.partyId) {
    const sorted = [...parties].sort((a, b) => compareRoleLetters(a.role, b.role));
    const clientA = sorted.find((party) => (party.role || "").toUpperCase() === "A") || sorted[0];
    const clientB = sorted.find((party) => (party.role || "").toUpperCase() === "B") || sorted.find((party) => party.id !== clientA?.id);
    return formatSessionCalendarTitle({
      mediatorName: mediator?.name,
      clientAFirstName: clientA?.firstName,
      clientBFirstName: clientB?.firstName,
      caseRef: caseData?.caseRef,
    });
  }
  return `${serviceType?.name || "Appointment"} — Brighter Future Mediation`;
}

/**
 * Delete the "client-side" event on the BFM info@ calendar so Google emails
 * the cancellation invite to the client from info@. Soft-fails: a BFM-side
 * failure does not block cancel/delete/expire. The DB pointer is only cleared
 * on success or a 404/410 (already gone), so other failures stay surfaced
 * for the daily health check / orphan retry.
 */
async function deleteBfmEventForAppointment(appt: Appointment): Promise<void> {
  try {
    await mediationClientCalendarService.cancel(appt);
  } catch (err) {
    console.error(`[Appointment] Mediation client calendar cancellation failed for ${appt.id}:`, err);
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "mediation_client_calendar_cancel_failed",
      urgency: "red",
      caseId: appt.caseId,
      appointmentId: appt.id,
      title: "Client calendar cancellation needs attention",
      message: "A mediation client calendar invitation could not be cancelled. Retry the cancellation from the BFM calendar and verify each client's invite.",
      status: "active",
      caseNoteRequired: false,
    }).catch((notifyErr) => console.error("[Appointment] Could not create calendar cancellation alert:", notifyErr));
  }
  if (!appt.googleClientEventId) return;
  let successOrAlreadyGone = false;
  try {
    await googleCalendarService.deleteBfmEvent(appt.googleClientEventId);
    successOrAlreadyGone = true;
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.code
      ?? (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 410) {
      successOrAlreadyGone = true;
    } else {
      console.error(
        `[Appointment] BFM event delete failed for appt ${appt.id} (event ${appt.googleClientEventId}); KEEPING DB pointer for retry:`,
        err,
      );
    }
  }
  if (successOrAlreadyGone) {
    try {
      await storage.updateAppointment(appt.id, { googleClientEventId: null });
    } catch (err) {
      console.error(`[Appointment] Failed to clear googleClientEventId for ${appt.id}:`, err);
    }
  }
}

async function restoreMediatorParentForAppointment(
  appt: Appointment,
): Promise<{ aborted: boolean }> {
  if (appt.availabilityReservationMode === "overlay") {
    if (!appt.mediatorId || !appt.googleBookingEventId) return { aborted: false };
    const provider = getAppointmentCalendarProvider(appt);
    if (!provider) return { aborted: true };
    try {
      await getMediatorCalendarProviderService(provider).deleteEvent(appt.mediatorId, appt.googleBookingEventId);
      return { aborted: false };
    } catch (err) {
      console.error(`[Appointment] Failed to remove ${provider} overlay booking event:`, err);
      return { aborted: true };
    }
  }
  if (!appt.parentGoogleEventId || !appt.parentEventOriginalStart || !appt.parentEventOriginalEnd) {
    return { aborted: false };
  }
  if (!appt.mediatorId) return { aborted: false };
  const provider = getAppointmentCalendarProvider(appt);
  if (!provider) return { aborted: false };
  const calendar = getMediatorCalendarProviderService(provider);
  try {
    const result = await calendar.restoreParentEventForCancelledBooking(
      appt.mediatorId,
      {
        parentGoogleEventId: appt.parentGoogleEventId,
        parentEventOriginalStart: appt.parentEventOriginalStart,
        parentEventOriginalEnd: appt.parentEventOriginalEnd,
        parentEventOriginalTitle: appt.parentEventOriginalTitle ?? null,
        parentEventOriginalAttendees: appt.parentEventOriginalAttendees ?? null,
        googleBookingEventId: appt.googleBookingEventId ?? null,
        googleTrailingRemnantEventId: appt.googleTrailingRemnantEventId ?? null,
      },
      appt.id,
      appt.id, // exclude self from live-blocker scan
    );
    if (provider === "google") {
      googleCalendarService.syncCalendar(appt.mediatorId).catch(err => {
        console.error("[Appointment] Post-restore Google sync failed:", err);
      });
    }
    return { aborted: !!result.aborted };
  } catch (err) {
    console.error(`[Appointment] Failed to restore ${provider} parent event:`, err);
    return { aborted: true };
  }
}

/**
 * Re-create the OLD mediator-side booking by splitting the original parent
 * directly. Bypasses findMediatorForSlot, which would block on the (still
 * unchanged) DB row and refuse to give us back the slot during rollback.
 */
async function restoreOldMediatorBookingDirectly(appt: Appointment): Promise<{
  ok: boolean;
  newBookingEventId: string | null;
  newTrailingRemnantEventId: string | null;
}> {
  if (!appt.mediatorId
    || !appt.parentGoogleEventId
    || !appt.parentEventOriginalStart
    || !appt.parentEventOriginalEnd
    || !appt.serviceTypeId) {
    return { ok: false, newBookingEventId: null, newTrailingRemnantEventId: null };
  }
  try {
    const mediator = await storage.getUser(appt.mediatorId);
    const provider = getAppointmentCalendarProvider(appt);
    if (!mediator || !provider || !isMediatorProviderConnected(mediator, provider)) {
      return { ok: false, newBookingEventId: null, newTrailingRemnantEventId: null };
    }
    const calendar = getMediatorCalendarProviderService(provider);
    const party = appt.partyId ? await storage.getParty(appt.partyId) : null;
    const caseData = await storage.getCase(appt.caseId);
    const clientName = party ? `${party.firstName} ${party.lastName}` : "Client";
    const caseRef = caseData?.caseRef ?? "";
    const calendarTitle = await buildCalendarTitleForAppointment(appt);
    const oldStart = new Date(appt.dateTime);
    const oldEnd = new Date(oldStart.getTime() + appt.duration * 60000);

    const attendees: { email: string; displayName?: string; responseStatus?: string }[] = [
      { email: BFM_EMAIL, displayName: "Brighter Future Mediation", responseStatus: "accepted" },
    ];
    if (mediator.email) attendees.push({ email: mediator.email, displayName: mediator.name });

    let parentAttendees: { email: string; displayName?: string }[] | undefined;
    if (appt.parentEventOriginalAttendees) {
      try {
        const parsed = JSON.parse(appt.parentEventOriginalAttendees);
        if (Array.isArray(parsed)) parentAttendees = parsed;
      } catch {
        // ignore — fall through to default BFM-only remnant
      }
    }

    const bookingData = {
      start: oldStart,
      end: oldEnd,
      summary: calendarTitle,
      description: `Case ${formatCaseRefWithRole(caseRef, party?.role)}\nClient: ${clientName}\nMediator: ${mediator.name}\nStatus: ${appt.status} (rolled back from failed reschedule)`,
      attendees,
      location: mediator.zoomLink ?? undefined,
    };
    if (appt.availabilityReservationMode === "overlay" && appt.availabilitySourceId) {
      const bookingEventId = await calendar.createEvent(appt.mediatorId, bookingData);
      return { ok: true, newBookingEventId: bookingEventId, newTrailingRemnantEventId: null };
    }
    const splitResult = await calendar.splitAvailabilityForBooking(
      appt.mediatorId,
      appt.parentGoogleEventId,
      appt.parentEventOriginalStart,
      appt.parentEventOriginalEnd,
      appt.parentEventOriginalTitle ?? null,
      bookingData,
      appt.id,
      parentAttendees,
    );
    if (provider === "google") {
      googleCalendarService.syncCalendar(appt.mediatorId).catch(err => {
        console.error("[Appointment] Post-rollback Google sync failed:", err);
      });
    }
    return {
      ok: true,
      newBookingEventId: splitResult.googleBookingEventId,
      newTrailingRemnantEventId: splitResult.googleTrailingRemnantEventId,
    };
  } catch (err) {
    console.error("[Appointment] Direct old-time rollback split failed:", err);
    return { ok: false, newBookingEventId: null, newTrailingRemnantEventId: null };
  }
}

/**
 * Attempt to re-split a Google availability event around a new booked slot
 * after a reschedule. Returns the new tracking IDs to persist on the
 * appointment (or nulls if no Google event covers the new time).
 */
async function reSplitGoogleParentForReschedule(
  appt: Appointment,
  newDateTime: Date,
): Promise<{
  parentGoogleEventId: string | null;
  parentCalendarProvider: CalendarProvider | null;
  parentEventOriginalStart: Date | null;
  parentEventOriginalEnd: Date | null;
  parentEventOriginalTitle: string | null;
  parentEventOriginalAttendees: string | null;
  googleBookingEventId: string | null;
  bookingCalendarProvider: CalendarProvider | null;
  googleTrailingRemnantEventId: string | null;
  trailingRemnantCalendarProvider: CalendarProvider | null;
  availabilitySourceId: string | null;
  availabilityReservationMode: string | null;
}> {
  const empty = {
    parentGoogleEventId: null,
    parentCalendarProvider: null,
    parentEventOriginalStart: null,
    parentEventOriginalEnd: null,
    parentEventOriginalTitle: null,
    parentEventOriginalAttendees: null,
    googleBookingEventId: null,
    bookingCalendarProvider: null,
    googleTrailingRemnantEventId: null,
    trailingRemnantCalendarProvider: null,
    availabilitySourceId: null,
    availabilityReservationMode: null,
  };
  if (!appt.mediatorId || !appt.serviceTypeId) return empty;
  try {
    // Refresh Google cache so post-restore parent state is visible to findMediatorForSlot.
    try {
      if (appt.parentCalendarProvider === "google" || !appt.parentCalendarProvider) {
        await googleCalendarService.syncCalendar(appt.mediatorId);
      }
    } catch (syncErr) {
      console.warn("[Appointment] Pre-resplit sync failed:", syncErr);
    }
    const { availabilityService } = await import("./availability.service");
    const match = await availabilityService.findMediatorForSlot(
      appt.serviceTypeId,
      newDateTime,
      { mediatorIdScope: appt.mediatorId },
    );
    if (!match || !match.parentGoogleEventId
      || !match.parentEventStart || !match.parentEventEnd) {
      return empty;
    }
    const mediator = await storage.getUser(appt.mediatorId);
    const provider = match.parentCalendarProvider ?? "google";
    if (!mediator || !isMediatorProviderConnected(mediator, provider)) return empty;
    const calendar = getMediatorCalendarProviderService(provider);

    const party = appt.partyId ? await storage.getParty(appt.partyId) : null;
    const caseData = await storage.getCase(appt.caseId);
    const clientName = party ? `${party.firstName} ${party.lastName}` : "Client";
    const caseRef = caseData?.caseRef ?? "";
    const calendarTitle = await buildCalendarTitleForAppointment(appt);
    const slotEnd = new Date(newDateTime.getTime() + appt.duration * 60000);

    // Mediator-side event: mediator + info@ only. The client invite lives
    // on the separate info@ event.
    const attendees: { email: string; displayName?: string; responseStatus?: string }[] = [
      { email: BFM_EMAIL, displayName: "Brighter Future Mediation", responseStatus: "accepted" },
    ];
    if (mediator.email) attendees.push({ email: mediator.email, displayName: mediator.name });

    let parentAttendees: { email: string; displayName?: string }[] | undefined;
    try {
      const parentDetails = await calendar.getEventById(
        appt.mediatorId,
        match.parentGoogleEventId,
      );
      if (parentDetails?.attendees?.length) {
        parentAttendees = parentDetails.attendees
          .filter(a => a.email)
          .map(a => ({ email: a.email, displayName: a.displayName }));
      }
    } catch (err) {
      console.warn("[Appointment] Could not fetch parent attendees during re-split:", err);
    }

    const bookingData = {
      start: newDateTime,
      end: slotEnd,
      summary: calendarTitle,
      description: `Case ${formatCaseRefWithRole(caseRef, party?.role)}\nClient: ${clientName}\nMediator: ${mediator.name}\nStatus: ${appt.status} (rescheduled)`,
      attendees,
      location: mediator.zoomLink ?? undefined,
    };
    if (match.availabilityReservationMode === "overlay" && match.availabilitySourceId) {
      const bookingEventId = await calendar.createEvent(appt.mediatorId, bookingData);
      return {
        parentGoogleEventId: match.parentGoogleEventId,
        parentCalendarProvider: provider,
        parentEventOriginalStart: match.parentEventStart,
        parentEventOriginalEnd: match.parentEventEnd,
        parentEventOriginalTitle: match.parentEventTitle ?? null,
        parentEventOriginalAttendees: parentAttendees?.length ? JSON.stringify(parentAttendees) : null,
        googleBookingEventId: bookingEventId,
        bookingCalendarProvider: provider,
        googleTrailingRemnantEventId: null,
        trailingRemnantCalendarProvider: null,
        availabilitySourceId: match.availabilitySourceId,
        availabilityReservationMode: "overlay",
      };
    }
    const splitResult = await calendar.splitAvailabilityForBooking(
      appt.mediatorId,
      match.parentGoogleEventId,
      match.parentEventStart,
      match.parentEventEnd,
      match.parentEventTitle ?? null,
      bookingData,
      appt.id,
      parentAttendees,
    );

    if (provider === "google") {
      googleCalendarService.syncCalendar(appt.mediatorId).catch(err => {
        console.error("[Appointment] Post-resplit Google sync failed:", err);
      });
    }

    return {
      parentGoogleEventId: match.parentGoogleEventId,
      parentCalendarProvider: provider,
      parentEventOriginalStart: match.parentEventStart,
      parentEventOriginalEnd: match.parentEventEnd,
      parentEventOriginalTitle: match.parentEventTitle ?? null,
      // Snapshot the parent's attendees so a future restore that has to
      // RECREATE the parent preserves the original invite list rather than
      // dropping back to BFM-only.
      parentEventOriginalAttendees: parentAttendees && parentAttendees.length > 0
        ? JSON.stringify(parentAttendees)
        : null,
      googleBookingEventId: splitResult.googleBookingEventId,
      bookingCalendarProvider: provider,
      googleTrailingRemnantEventId: splitResult.googleTrailingRemnantEventId,
      trailingRemnantCalendarProvider: splitResult.googleTrailingRemnantEventId ? provider : null,
      availabilitySourceId: match.availabilitySourceId ?? null,
      availabilityReservationMode: match.availabilityReservationMode ?? "split_restore",
    };
  } catch (err) {
    console.error("[Appointment] Re-split after reschedule failed:", err);
    return empty;
  }
}

export class AppointmentService {
  async getById(id: string): Promise<Appointment | undefined> {
    return storage.getAppointment(id);
  }

  async listByCase(caseId: string): Promise<Appointment[]> {
    return storage.listAppointmentsByCase(caseId);
  }

  async listByMediator(mediatorId: string): Promise<Appointment[]> {
    return storage.listAppointmentsByMediator(mediatorId);
  }

  async listByDateRange(start: Date, end: Date): Promise<Appointment[]> {
    return storage.listAppointmentsByDateRange(start, end);
  }

  async listByMediatorDateRange(mediatorId: string, start: Date, end: Date): Promise<Appointment[]> {
    return storage.listAppointmentsByMediatorDateRange(mediatorId, start, end);
  }

  async listByPartyIds(partyIds: string[]): Promise<Appointment[]> {
    return storage.listAppointmentsByPartyIds(partyIds);
  }

  async listByPartyIdsDateRange(partyIds: string[], start: Date, end: Date): Promise<Appointment[]> {
    return storage.listAppointmentsByPartyIdsDateRange(partyIds, start, end);
  }

  async create(data: {
    caseId: string;
    partyId: string;
    serviceTypeId: string;
    mediatorId: string;
    dateTime: Date;
    duration?: number;
    notes?: string;
  }, actor: Actor): Promise<ServiceResult<{ appointment: Appointment }>> {
    const holdExpiresAt = calculateHoldDeadline(data.dateTime);
    const bookingToken = randomBytes(32).toString("hex");
    const mediator = await storage.getUser(data.mediatorId);
    const appointment = await storage.createAppointment({
      caseId: data.caseId,
      partyId: data.partyId,
      serviceTypeId: data.serviceTypeId,
      mediatorId: data.mediatorId,
      dateTime: data.dateTime,
      duration: data.duration ?? 60,
      status: "hold",
      holdExpiresAt,
      bookingToken,
      paymentStatus: "payment_pending",
      notes: data.notes ?? null,
      meetingLink: mediator?.zoomLink || null,
    });

    try {
      await appointmentLifecycleHistoryService.recordAppointmentCreated(appointment, actor);
      await this.logActivity(appointment, "appointment_hold", actor);
      await this.createNotifications(appointment, "hold");
    } catch (err) {
      console.error("[Appointment] Failed to log hold activity:", err);
    }

    return { ok: true, appointment };
  }

  async update(id: string, data: Partial<Pick<Appointment, "dateTime" | "duration" | "notes" | "meetingLink">>, actor?: Actor): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (appt.status === "completed" || appt.status === "cancelled") {
      return { ok: false, error: `Cannot update appointment with status "${appt.status}"`, status: 400 };
    }

    const newDateTime = data.dateTime !== undefined ? new Date(data.dateTime) : null;
    const isReschedule = newDateTime !== null
      && newDateTime.getTime() !== new Date(appt.dateTime).getTime();

    let resplitTracking: Awaited<ReturnType<typeof reSplitGoogleParentForReschedule>> | null = null;
    let restoreAborted = false;
    if (isReschedule && hasMediatorCalendarReservation(appt)) {
      // 1. Restore the original mediator calendar parent at the OLD time.
      const restoreResult = await restoreMediatorParentForAppointment(appt);
      restoreAborted = restoreResult.aborted;

      if (restoreAborted) {
        // Old mediator-side booking event could not be safely cleaned up. Refuse to
        // re-split at the new time — that would create double-booked calendar
        // events. The user must retry; the original appointment row is left
        // unchanged and an audit entry has been recorded by the restore call.
        return {
          ok: false,
          error: "Could not safely release the original calendar slot. Please try again in a moment.",
          status: 409,
        };
      }

      // 2. Re-split a provider-backed event around the NEW time. The original booking
      //    was calendar-tracked, so the reschedule MUST land inside another
      //    BFM-invited event for the same mediator and re-establish the
      //    carved-out booking. If we can't, refuse the reschedule so we never
      //    leave a previously calendar-tracked appointment with empty tracking.
      if (newDateTime) {
        resplitTracking = await reSplitGoogleParentForReschedule(appt, newDateTime);
        if (!resplitTracking.parentGoogleEventId) {
          // Best-effort: undo the restore by re-splitting back at the OLD time
          // so the original Google booking is reinstated. We continue even if
          // this rollback fails — the audit trail captures the orphan.
          await reSplitGoogleParentForReschedule(appt, new Date(appt.dateTime)).catch(err => {
            console.error("[Appointment] Failed to roll back restore after re-split refusal:", err);
          });
          return {
            ok: false,
            error: "The new time isn't covered by an available calendar slot for this mediator. Pick a time inside the mediator's availability and try again.",
            status: 409,
          };
        }
      }
    }

    const patch: Partial<Omit<Appointment, "id" | "createdAt">> = { ...data };
    const oldHoldExpiresAt = appt.holdExpiresAt;
    if (isReschedule && hasMediatorCalendarReservation(appt)) {
      patch.parentGoogleEventId = resplitTracking?.parentGoogleEventId ?? null;
      patch.parentCalendarProvider = resplitTracking?.parentCalendarProvider ?? null;
      patch.parentEventOriginalStart = resplitTracking?.parentEventOriginalStart ?? null;
      patch.parentEventOriginalEnd = resplitTracking?.parentEventOriginalEnd ?? null;
      patch.parentEventOriginalTitle = resplitTracking?.parentEventOriginalTitle ?? null;
      patch.parentEventOriginalAttendees = resplitTracking?.parentEventOriginalAttendees ?? null;
      patch.googleBookingEventId = resplitTracking?.googleBookingEventId ?? null;
      patch.bookingCalendarProvider = resplitTracking?.bookingCalendarProvider ?? null;
      patch.googleTrailingRemnantEventId = resplitTracking?.googleTrailingRemnantEventId ?? null;
      patch.trailingRemnantCalendarProvider = resplitTracking?.trailingRemnantCalendarProvider ?? null;
      patch.availabilitySourceId = resplitTracking?.availabilitySourceId ?? null;
      patch.availabilityReservationMode = resplitTracking?.availabilityReservationMode ?? null;
    }

    // Patch the BFM event BEFORE the DB commit so a failure here can roll
    // back the mediator-side resplit and refuse the reschedule.
    if (isReschedule && newDateTime && (appt.googleClientEventId || (await mediationClientCalendarService.list(appt.id)).length > 0)) {
      const timeBasis = appt.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc";
      const calendarStart = toUkCalendarEventInstant(newDateTime, timeBasis);
      const newEnd = new Date(calendarStart.getTime() + (data.duration ?? appt.duration) * 60000);
      try {
        if (appt.googleClientEventId) {
          await googleCalendarService.patchBfmEvent(appt.googleClientEventId, {
            summary: await buildCalendarTitleForAppointment(appt),
            start: calendarStart,
            end: newEnd,
          });
        }
        await mediationClientCalendarService.reschedule(appt, newDateTime, data.duration ?? appt.duration);
      } catch (bfmErr) {
        console.error(
          "[Appointment] BFM patch failed during reschedule; rolling back mediator-side resplit:",
          bfmErr,
        );
        // Rollback: (a) recombine the new-time mediator events back into
        // their parent — `restoreParentEventForCancelledBooking` can return
        // `{aborted:true}` for transient failures without throwing, so we
        // check the flag explicitly; (b) re-create the OLD mediator booking
        // via the direct-split helper so it survives the same-parent and
        // exactFill/atStart cases where naive deletes would lose the parent.
        let newRestoreOk = false;
        if (
          appt.mediatorId
          && resplitTracking?.parentGoogleEventId
          && resplitTracking.parentEventOriginalStart
          && resplitTracking.parentEventOriginalEnd
        ) {
          try {
            const newProvider = resplitTracking.parentCalendarProvider ?? "google";
            if (resplitTracking.availabilityReservationMode === "overlay" && resplitTracking.googleBookingEventId) {
              await getMediatorCalendarProviderService(newProvider).deleteEvent(appt.mediatorId, resplitTracking.googleBookingEventId);
              newRestoreOk = true;
            } else {
              const newRestoreResult = await getMediatorCalendarProviderService(newProvider).restoreParentEventForCancelledBooking(
              appt.mediatorId,
              {
                parentGoogleEventId: resplitTracking.parentGoogleEventId,
                parentEventOriginalStart: resplitTracking.parentEventOriginalStart,
                parentEventOriginalEnd: resplitTracking.parentEventOriginalEnd,
                parentEventOriginalTitle: resplitTracking.parentEventOriginalTitle,
                parentEventOriginalAttendees: resplitTracking.parentEventOriginalAttendees,
                googleBookingEventId: resplitTracking.googleBookingEventId,
                googleTrailingRemnantEventId: resplitTracking.googleTrailingRemnantEventId,
              },
              appt.id,
              appt.id,
              );
              newRestoreOk = !newRestoreResult.aborted;
            }
            if (!newRestoreOk) {
              console.error(
              `[Appointment] CRITICAL: rollback NEW-parent restore aborted (transient) for appt ${appt.id}; new-time mediator events may persist.`,
              );
            }
          } catch (restoreErr) {
            console.error(
              "[Appointment] Failed to restore new-time parent during reschedule rollback:",
              restoreErr,
            );
          }
        } else {
          // No new tracking → no NEW-time mediator artifacts to clean up.
          newRestoreOk = true;
        }

        const oldRestore = await restoreOldMediatorBookingDirectly(appt);
        const oldRestoredOk = oldRestore.ok;
        const oldProvider = getAppointmentCalendarProvider(appt);

        // Persist the freshly-allocated mediator booking + remnant IDs so the
        // DB tracking stays in sync with reality. We do NOT touch dateTime,
        // duration, mediatorId, parent metadata or any other field — only
        // the two volatile event-ID pointers that the new split produced.
        // This is critical: future cancel / re-restore flows look up these
        // IDs and would otherwise target stale events that no longer exist.
        let dbRetagOk = true;
        if (oldRestoredOk
          && (oldRestore.newBookingEventId !== appt.googleBookingEventId
            || oldRestore.newTrailingRemnantEventId !== appt.googleTrailingRemnantEventId)) {
          try {
            await storage.updateAppointment(appt.id, {
              googleBookingEventId: oldRestore.newBookingEventId,
              bookingCalendarProvider: oldProvider,
              googleTrailingRemnantEventId: oldRestore.newTrailingRemnantEventId,
              trailingRemnantCalendarProvider: oldRestore.newTrailingRemnantEventId ? oldProvider : null,
            });
          } catch (retagErr) {
            dbRetagOk = false;
            console.error(
              `[Appointment] Failed to retag DB with restored Google IDs for appt ${appt.id}:`,
              retagErr,
            );
          }
        }

        if (!newRestoreOk || !oldRestoredOk || !dbRetagOk) {
          console.error(
            `[Appointment] CRITICAL: reschedule rollback incomplete for appt ${appt.id} (newRestoreOk=${newRestoreOk}, oldRestoredOk=${oldRestoredOk}, dbRetagOk=${dbRetagOk}); manual review required.`,
          );
          try {
            await logAudit({
              userId: null,
              action: "update",
              entity: "appointment",
              entityId: appt.id,
              details: JSON.stringify({
                op: "reschedule_rollback_incomplete",
                reason: "BFM patch failed and mediator-side rollback was not fully completed; manual review required",
                newRestoreOk,
                oldRestoredOk,
                dbRetagOk,
                appointmentId: appt.id,
                mediatorId: appt.mediatorId,
                oldDateTime: appt.dateTime,
                attemptedNewDateTime: newDateTime?.toISOString(),
                newTimeBookingEventId: resplitTracking?.googleBookingEventId,
                newTimeTrailingRemnantEventId: resplitTracking?.googleTrailingRemnantEventId,
                restoredOldBookingEventId: oldRestore.newBookingEventId,
                restoredOldTrailingRemnantEventId: oldRestore.newTrailingRemnantEventId,
              }),
            });
          } catch (auditErr) {
            console.error("[Appointment] Failed to log incomplete-rollback audit:", auditErr);
          }
        }
        return {
          ok: false,
          error: "Could not update the client's calendar invite from info@. The reschedule was not applied. Please try again or contact a superadmin.",
          status: 502,
        };
      }
    }

    if (isReschedule && newDateTime && isHoldStatus(appt.status)) {
      patch.holdExpiresAt = calculateHoldDeadline(newDateTime);
      patch.holdAlertSentAt = null;
    }

    const updated = await storage.updateAppointment(id, patch);
    if (!updated) return { ok: false, error: "Failed to update appointment", status: 500 };
    if (isReschedule) {
      await appointmentLifecycleHistoryService.recordAppointmentRescheduled(appt, updated, actor ?? null, {
        oldHoldExpiresAt: oldHoldExpiresAt ? oldHoldExpiresAt.toISOString() : null,
        newHoldExpiresAt: updated.holdExpiresAt ? updated.holdExpiresAt.toISOString() : null,
        reminderReset: isHoldStatus(appt.status),
        calendarUpdated: Boolean(appt.googleClientEventId || hasMediatorCalendarReservation(appt)),
      });
    }
    return { ok: true, appointment: updated };
  }

  async delete(id: string, actor?: Actor): Promise<ServiceResult<{}>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (appt.status === "confirmed" || appt.status === "completed") {
      return { ok: false, error: `Cannot delete appointment with status "${appt.status}"`, status: 400 };
    }
    // Restore Google availability BEFORE removing the DB row. If we deleted
    // the row first, we'd lose the parent-event tracking needed for restore
    // and could leave orphan Google events (e.g. an extra "BFM Booking"
    // event sitting on the mediator's calendar with no DB record). Refuse
    // the delete if restore can't complete cleanly so the user can retry
    // (e.g. after Google API recovers).
    if (hasMediatorCalendarReservation(appt) && appt.status !== "cancelled" && appt.status !== "expired") {
      const restoreResult = await restoreMediatorParentForAppointment(appt);
      if (restoreResult.aborted) {
        return {
          ok: false,
          error: "Could not restore the mediator's Google calendar availability for this booking. The appointment was not deleted. Please try again in a moment.",
          status: 502,
        };
      }
    }

    // Tear down the client-side BFM event so the client gets a Google
    // cancellation invite from info@. Soft-fails to avoid blocking the
    // user-visible delete on a transient Google error.
    await deleteBfmEventForAppointment(appt);

    // Clear party.miamMediatorId BEFORE deleting the row so we can still
    // read the appointment's mediator/party/serviceType for the unassign
    // check. Best-effort — never block the delete on a logging failure.
    try {
      const { bookingService } = await import("./booking.service");
      await bookingService.autoUnassignMediator(appt, "miam_booking_deleted");
    } catch (err) {
      console.error("[Appointment] Failed to auto-unassign MIAM mediator on delete:", err);
    }

    await appointmentLifecycleHistoryService.recordAppointmentStatusChange(
      appt,
      appt.status,
      "deleted",
      "appointment_deleted",
      actor,
    );
    await storage.deleteAppointment(id);
    return { ok: true };
  }

  async confirm(id: string, actor: Actor): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (!isHoldStatus(appt.status)) {
      return { ok: false, error: `Cannot confirm appointment with status "${appt.status}"`, status: 400 };
    }
    if (!canConfirmAppointmentPayment(appt.paymentStatus)) {
      return {
        ok: false,
        error: "Payment or voucher acceptance is required before confirming this appointment",
        status: 400,
      };
    }
    const calendarReady = await this.ensureCalendarArtifactsForConfirmation(appt);
    if (!calendarReady.ok) {
      const detail = calendarReady.error || "Calendar confirmation failed";
      return {
        ok: false,
        error: `Payment is recorded, but calendar confirmation failed. Please retry confirmation after checking calendar connectivity. ${detail}`,
        status: calendarReady.status,
      };
    }

    const latestBeforeConfirm = await storage.getAppointment(id);
    const updated = await storage.updateAppointment(id, {
      status: "confirmed",
      holdExpiresAt: null,
      paymentFailureReason: null,
      paymentNotes: latestBeforeConfirm?.paymentNotes?.startsWith("Payment received; calendar confirmation pending")
        ? null
        : latestBeforeConfirm?.paymentNotes ?? null,
    });
    if (!updated) return { ok: false, error: "Failed to update appointment", status: 500 };
    await appointmentLifecycleHistoryService.recordAppointmentStatusChange(updated, appt.status, "confirmed", "appointment_confirmed", actor);

    this.sendConfirmEmails(updated, actor).catch(err => console.error("[Appointment] confirm email error:", err));
    this.createNotifications(updated, "confirmed").catch(err => console.error("[Appointment] confirm notification error:", err));
    this.logActivity(updated, "appointment_confirmed", actor).catch(err => console.error("[Appointment] activity log error:", err));
    this.refreshCaseFilterCache(updated).catch(err => console.error("[Appointment] cache refresh error:", err));

    return { ok: true, appointment: updated };
  }

  async confirmPaidPublicBooking(
    id: string,
    channel: "stripe_checkout_completed" | "xero_invoice_paid" | "paid_public_booking_repair" | "manual_payment_marked_paid",
  ): Promise<ServiceResult<{ appointment: Appointment; alreadyConfirmed: boolean }>> {
    const current = await storage.getAppointment(id);
    if (!current) return { ok: false, error: "Appointment not found", status: 404 };
    const manualPaid = channel === "manual_payment_marked_paid"
      && !!current.bookingToken
      && current.paymentStatus === "paid"
      && (current.status === "hold" || current.status === "held" || current.status === "confirmed");
    if (!manualPaid && !isPaidPublicBookingEligibleForAutoConfirmation(current)) {
      return { ok: false, error: "Appointment is not an eligible paid public booking", status: 409 };
    }

    if (current.status === "confirmed") {
      await db.insert(appointmentCalendarSyncJobs).values({ appointmentId: id }).onConflictDoNothing();
      const { appointmentCalendarSyncService } = await import("./appointment-calendar-sync.service");
      appointmentCalendarSyncService.scheduleImmediate(id);
      return { ok: true, appointment: current, alreadyConfirmed: true };
    }

    let confirmed: Appointment | null = null;
    try {
      confirmed = await db.transaction(async (tx) => {
        const [updated] = await tx.update(appointments).set({
          status: "confirmed",
          holdExpiresAt: null,
          paymentFailureReason: null,
        }).where(and(
          eq(appointments.id, id),
          inArray(appointments.status, ["hold", "held"]),
          eq(appointments.paymentStatus, "paid"),
        )).returning();
        if (!updated) return null;
        await tx.insert(appointmentCalendarSyncJobs).values({ appointmentId: id }).onConflictDoNothing();
        return updated;
      });
    } catch (err) {
      if (isUniqueConstraintError(err, "appointments_active_mediator_slot_unique")) {
        const arranged = await this.markPaidPublicBookingNeedsMiamArrangement(id, channel);
        return arranged.ok ? { ok: false, error: "Paid booking needs MIAM mediator arrangement", status: 409 } : arranged;
      }
      throw err;
    }

    if (!confirmed) {
      const latest = await storage.getAppointment(id);
      if (latest?.status === "confirmed" && latest.paymentStatus === "paid") {
        return { ok: true, appointment: latest, alreadyConfirmed: true };
      }
      if (latest?.paymentStatus === "paid" && (latest.status === "hold" || latest.status === "held")) {
        await this.markPaidPublicBookingNeedsMiamArrangement(id, channel);
      }
      return { ok: false, error: "Could not confirm paid public booking", status: 409 };
    }

    const actor = systemActor(channel);
    await appointmentLifecycleHistoryService.recordAppointmentStatusChange(confirmed, current.status, "confirmed", "appointment_confirmed", actor);
    this.sendConfirmEmails(confirmed, actor).catch(err => console.error("[Appointment] paid public booking confirm email error:", err));
    this.createNotifications(confirmed, "confirmed").catch(err => console.error("[Appointment] paid public booking confirm notification error:", err));
    this.logActivity(confirmed, "appointment_confirmed", actor).catch(err => console.error("[Appointment] paid public booking activity log error:", err));
    this.refreshCaseFilterCache(confirmed).catch(err => console.error("[Appointment] paid public booking cache refresh error:", err));
    const { appointmentCalendarSyncService } = await import("./appointment-calendar-sync.service");
    appointmentCalendarSyncService.scheduleImmediate(id);
    return { ok: true, appointment: confirmed, alreadyConfirmed: false };
  }

  async markPaidPublicBookingNeedsMiamArrangement(
    id: string,
    reason: string,
  ): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    const updated = await storage.updateAppointment(id, {
      paymentFailureReason: "paid_needs_miam_arrangement",
      paymentNotes: "Payment received but the original MIAM slot has already been confirmed for another client. Admin must arrange a MIAM mediator.",
    });
    if (!updated) return { ok: false, error: "Failed to mark MIAM arrangement needed", status: 500 };
    await this.createMiamArrangementTask(updated, reason);
    return { ok: true, appointment: updated };
  }

  async updatePaymentStatus(
    id: string,
    data: { paymentStatus: string; paymentNotes?: string | null },
    actor: Actor,
  ): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (!isAppointmentPaymentStatus(data.paymentStatus)) {
      return { ok: false, error: "Invalid appointment payment status", status: 400 };
    }

    const updated = await storage.updateAppointment(id, {
      paymentStatus: data.paymentStatus as AppointmentPaymentStatus,
      paymentStatusUpdatedAt: new Date(),
      paymentStatusUpdatedBy: actor.type === "staff" ? actor.id : null,
      paymentNotes: data.paymentNotes?.trim() || null,
    });
    if (!updated) return { ok: false, error: "Failed to update appointment payment status", status: 500 };

    let responseAppointment = updated;
    if (data.paymentStatus === "paid" && (updated.status === "hold" || updated.status === "held") && updated.bookingToken) {
      const confirmation = await this.confirmPaidPublicBooking(updated.id, "manual_payment_marked_paid");
      const latest = await storage.getAppointment(updated.id);
      responseAppointment = confirmation.ok ? (latest || confirmation.appointment) : (latest || updated);
    }

    await logAudit({
      userId: actor.type === "staff" ? actor.id : null,
      action: "update",
      entity: "appointment",
      entityId: id,
      details: JSON.stringify({ paymentStatus: data.paymentStatus }),
    });

    return { ok: true, appointment: responseAppointment };
  }

  async resolvePaidMiamArrangement(
    id: string,
    data: { mediatorId: string; dateTime?: Date | null },
    actor: Actor,
  ): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (appt.paymentStatus !== "paid" || appt.paymentFailureReason !== "paid_needs_miam_arrangement") {
      return { ok: false, error: "This appointment does not need MIAM mediator arrangement", status: 409 };
    }
    if (!appt.serviceTypeId || !appt.partyId) {
      return { ok: false, error: "Appointment is missing service or party context", status: 400 };
    }
    const serviceType = await storage.getServiceType(appt.serviceTypeId);
    if (!isMiamService(serviceType)) {
      return { ok: false, error: "Only MIAM appointments can use this resolver", status: 400 };
    }
    const proposedDateTime = data.dateTime ?? new Date(appt.dateTime);
    if (Number.isNaN(proposedDateTime.getTime())) {
      return { ok: false, error: "Choose a valid MIAM appointment time", status: 400 };
    }
    const { availabilityService } = await import("./availability.service");
    const match = await availabilityService.findMediatorForSlot(appt.serviceTypeId, proposedDateTime, {
      mediatorIdScope: data.mediatorId,
      timeBasis: appt.dateTimeBasis as any,
    });
    if (!match) {
      return { ok: false, error: "The selected mediator is not available for this MIAM slot", status: 409 };
    }
    const mediator = await storage.getUser(data.mediatorId);
    if (!mediator || mediator.role !== "mediator" || mediator.status !== "active") {
      return { ok: false, error: "Choose an active mediator", status: 400 };
    }
    const isCalendarBacked = !!match.parentGoogleEventId
      && !!match.parentCalendarProvider
      && !!match.parentEventStart
      && !!match.parentEventEnd;
    const updated = await storage.updateAppointment(id, {
      mediatorId: data.mediatorId,
      dateTime: proposedDateTime,
      dateTimeBasis: match.timeBasis,
      meetingLink: mediator.zoomLink || null,
      parentGoogleEventId: isCalendarBacked ? match.parentGoogleEventId! : null,
      parentCalendarProvider: isCalendarBacked ? match.parentCalendarProvider! : null,
      parentEventOriginalStart: isCalendarBacked ? match.parentEventStart! : null,
      parentEventOriginalEnd: isCalendarBacked ? match.parentEventEnd! : null,
      parentEventOriginalTitle: isCalendarBacked ? (match.parentEventTitle ?? null) : null,
      availabilitySourceId: match.availabilitySourceId ?? null,
      availabilityReservationMode: match.availabilityReservationMode ?? (isCalendarBacked ? "split_restore" : null),
      googleBookingEventId: null,
      bookingCalendarProvider: null,
      googleTrailingRemnantEventId: null,
      trailingRemnantCalendarProvider: null,
      paymentFailureReason: null,
      paymentNotes: "Paid MIAM arrangement resolved by admin; confirmation attempted.",
    });
    if (!updated) return { ok: false, error: "Failed to update MIAM arrangement", status: 500 };
    await storage.updateParty(appt.partyId, { miamMediatorId: data.mediatorId });

    const confirmed = await this.confirmPaidPublicBooking(id, "manual_payment_marked_paid");
    if (!confirmed.ok) return { ok: false, error: confirmed.error, status: confirmed.status };
    await this.completeMiamArrangementTasks(id, actor);
    return { ok: true, appointment: confirmed.appointment };
  }

  /** Refresh the cases.* filter-cache so MIAM date / status reflect the new
   * appointment status. Best-effort; never blocks the primary mutation. */
  private async refreshCaseFilterCache(appt: Appointment): Promise<void> {
    if (!appt.caseId) return;
    const { caseService } = await import("./case.service");
    await caseService.refreshCaseFilterCache(appt.caseId);
  }

  async requestCancellation(
    id: string,
    user: Pick<User, "id" | "name" | "role">,
    rawReason: unknown,
    ipAddress?: string,
  ): Promise<ServiceResult<{ requested: true }>> {
    if (user.role !== "mediator" && user.role !== "client") {
      return { ok: false, error: "Only mediators and clients can request appointment cancellation", status: 403 };
    }

    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (!reason) {
      return { ok: false, error: "Cancellation reason is required", status: 400 };
    }

    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (!["hold", "held", "confirmed"].includes(appt.status)) {
      return { ok: false, error: "Cancellation can be requested only for active appointments", status: 409 };
    }
    if (new Date(appt.dateTime).getTime() <= Date.now()) {
      return { ok: false, error: "Cancellation can be requested only before the appointment start time", status: 409 };
    }

    let actor: Actor;
    if (user.role === "mediator") {
      if (appt.mediatorId !== user.id) return { ok: false, error: "Access denied", status: 403 };
      actor = staffActor(user);
    } else {
      const parties = await storage.listPartiesByUserId(user.id);
      const partyIdSet = new Set(parties.map((party) => party.id));
      const caseIdSet = new Set(parties.map((party) => party.caseId));
      if (appt.partyId ? !partyIdSet.has(appt.partyId) : !caseIdSet.has(appt.caseId)) {
        return { ok: false, error: "Access denied", status: 403 };
      }
      const party = appt.partyId
        ? parties.find((row) => row.id === appt.partyId)
        : parties.find((row) => row.caseId === appt.caseId);
      actor = party ? clientActor(party, "appointment-cancellation-request") : { id: user.id, name: user.name || "Client", type: "client", channel: "appointment-cancellation-request" };
    }

    const requesterTag = `Requester ID: ${user.id}`;
    const [existing] = await db.select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.type, "appointment_cancellation_request"),
        eq(notifications.appointmentId, appt.id),
        ne(notifications.status, "completed"),
        sql`${notifications.message} LIKE ${`%${requesterTag}%`}`,
      ))
      .limit(1);
    if (existing) {
      return { ok: false, error: "A cancellation request is already open for this appointment", status: 409 };
    }

    const serviceTypes = await storage.listServiceTypes();
    const serviceTypeName = appt.serviceTypeId
      ? serviceTypes.find((serviceType) => serviceType.id === appt.serviceTypeId)?.name || "Appointment"
      : "Appointment";
    const caseData = await storage.getCase(appt.caseId);
    const caseRef = caseData?.caseRef || "unknown";
    const appointmentAt = formatAppointmentDateTime(appt.dateTime, appt.dateTimeBasis as "instant" | "wall_clock_utc");
    const requesterRole = user.role === "mediator" ? "Mediator" : "Client";
    const requesterName = user.name || requesterRole;

    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "appointment_cancellation_request",
      urgency: "amber",
      caseId: appt.caseId,
      appointmentId: appt.id,
      title: "Appointment cancellation requested",
      message: `${requesterRole} ${requesterName} requested cancellation for ${serviceTypeName} on case ${caseRef} at ${appointmentAt}.\n${requesterTag}\nRequester role: ${user.role}\nReason: ${reason}`,
      status: "active",
      caseNoteRequired: true,
    });

    await caseActivityService.log({
      caseId: appt.caseId,
      type: "appointment_cancellation_requested",
      title: "Appointment cancellation requested",
      description: `${requesterRole} ${requesterName} requested cancellation for ${serviceTypeName} on ${appointmentAt}: ${reason}`,
      relatedEntityId: appt.id,
      relatedEntityType: "appointment",
      metadata: JSON.stringify({
        appointmentId: appt.id,
        requesterId: user.id,
        requesterRole: user.role,
        requesterName,
        serviceTypeName,
        appointmentDateTime: new Date(appt.dateTime).toISOString(),
        reason,
      }),
      actor,
    });

    await logAudit({
      userId: user.id,
      action: "request_appointment_cancellation",
      entity: "appointment",
      entityId: appt.id,
      details: JSON.stringify({ caseId: appt.caseId, requesterRole: user.role, reason }),
      ipAddress,
    });

    return { ok: true, requested: true };
  }

  async cancel(id: string, actor: Actor): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (appt.status === "completed" || appt.status === "cancelled") {
      return { ok: false, error: `Cannot cancel appointment with status "${appt.status}"`, status: 400 };
    }

    // Restore Google availability BEFORE flipping status to cancelled. If we
    // flipped first and the Google restore failed, the slot would appear
    // free in our DB while a stale "BFM Booking" event sat on the mediator's
    // calendar — leading to mismatched availability and duplicate visible
    // bookings on next sync.
    if (hasMediatorCalendarReservation(appt)) {
      const restoreResult = await restoreMediatorParentForAppointment(appt);
      if (restoreResult.aborted) {
        return {
          ok: false,
          error: "Could not restore the mediator's Google calendar availability for this booking. The cancellation was not applied. Please try again in a moment.",
          status: 502,
        };
      }
    }

    // Tear down the client-side BFM event so the client gets a Google
    // cancellation invite from info@. Soft-fails to avoid blocking the
    // cancellation on a transient Google error.
    await deleteBfmEventForAppointment(appt);

    const updated = await storage.updateAppointment(id, { status: "cancelled" });
    if (!updated) return { ok: false, error: "Failed to update appointment", status: 500 };
    await appointmentLifecycleHistoryService.recordAppointmentStatusChange(updated, appt.status, "cancelled", "appointment_cancelled", actor);

    // Clear party.miamMediatorId synchronously (before responding) so the UI
    // sees the cleared state immediately on its post-cancel refetch. Wrapped
    // so a logging/audit failure never breaks the cancellation response.
    try {
      const { bookingService } = await import("./booking.service");
      await bookingService.autoUnassignMediator(updated, "miam_booking_cancelled");
    } catch (err) {
      console.error("[Appointment] Failed to auto-unassign MIAM mediator on cancel:", err);
    }

    this.sendCancelEmails(updated, "cancelled", actor).catch(err => console.error("[Appointment] cancel email error:", err));
    this.createNotifications(updated, "cancelled").catch(err => console.error("[Appointment] cancel notification error:", err));
    this.logActivity(updated, "appointment_cancelled", actor).catch(err => console.error("[Appointment] activity log error:", err));
    this.refreshCaseFilterCache(updated).catch(err => console.error("[Appointment] cache refresh error:", err));

    return { ok: true, appointment: updated };
  }

  async complete(id: string, actor: Actor): Promise<ServiceResult<{ appointment: Appointment }>> {
    const appt = await storage.getAppointment(id);
    if (!appt) return { ok: false, error: "Appointment not found", status: 404 };
    if (appt.status !== "confirmed") {
      return { ok: false, error: `Cannot complete appointment with status "${appt.status}"`, status: 400 };
    }
    const appointmentTime = new Date(appt.dateTime).getTime();
    if (!Number.isFinite(appointmentTime)) {
      return { ok: false, error: "Cannot complete appointment with an invalid date", status: 400 };
    }
    if (new Date(appt.dateTime).getTime() >= Date.now()) {
      return { ok: false, error: "Cannot complete a future appointment", status: 400 };
    }
    const updated = await storage.updateAppointment(id, { status: "completed" });
    if (!updated) return { ok: false, error: "Failed to update appointment", status: 500 };
    await appointmentLifecycleHistoryService.recordAppointmentStatusChange(updated, appt.status, "completed", "appointment_completed", actor);
    this.logActivity(updated, "appointment_completed", actor).catch(err => console.error("[Appointment] activity log error:", err));
    this.refreshCaseFilterCache(updated).catch(err => console.error("[Appointment] cache refresh error:", err));
    return { ok: true, appointment: updated };
  }

  async expireHeld(): Promise<Appointment[]> {
    // Look up candidates first so we can attempt Google restore BEFORE the
    // status flips to "expired". For each appt that restores cleanly we then
    // mark it expired; if restore aborts we leave the appt in "hold" state so
    // the next expireHeld run will retry. This avoids leaving orphan
    // "BFM Booking" events on the mediator's calendar pointing at slots that
    // our DB now shows as free.
    const candidates = await storage.findHeldAppointmentsToExpire();
    const expired: Appointment[] = [];

    for (const appt of candidates) {
      if (hasMediatorCalendarReservation(appt)) {
        const restoreResult = await restoreMediatorParentForAppointment(appt);
        if (restoreResult.aborted) {
          console.warn(
            `[Appointment] expireHeld: Google restore aborted for ${appt.id}; leaving as hold for retry`,
          );
          continue;
        }
      }
      // Tear down the client-side BFM event so the client gets a Google
      // cancellation invite from info@ for the expired hold.
      await deleteBfmEventForAppointment(appt);
      const updated = await storage.updateAppointment(appt.id, { status: "expired" });
      if (!updated) continue;
      expired.push(updated);

      const expireActor = systemActor("auto-expiry sweep");
      await appointmentLifecycleHistoryService.recordAppointmentStatusChange(updated, appt.status, "expired", "appointment_expired", expireActor);
      this.sendCancelEmails(updated, "expired", expireActor).catch(err => console.error("[Appointment] expire email error:", err));
      this.createNotifications(updated, "expired").catch(err => console.error("[Appointment] expire notification error:", err));
      this.createPaymentFollowUpTask(updated).catch(err => console.error("[Appointment] payment follow-up task error:", err));
      this.logActivity(updated, "appointment_expired", expireActor).catch(err => console.error("[Appointment] activity log error:", err));
      this.refreshCaseFilterCache(updated).catch(err => console.error("[Appointment] cache refresh error:", err));
    }

    return expired;
  }

  async createHeldPaymentAlerts(): Promise<Appointment[]> {
    const now = new Date();
    const candidates = await storage.findHeldAppointmentsNeedingPaymentAlert(now);
    const alerted: Appointment[] = [];

    for (const appt of candidates) {
      const alertAt = calculateHoldAlertAt(new Date(appt.dateTime));
      if (alertAt > now) continue;

      const updated = await storage.updateAppointment(appt.id, { holdAlertSentAt: now });
      if (!updated) continue;
      alerted.push(updated);

      const { notificationService } = await import("./notification.service");
      const { party, caseData, serviceType, clientName } = await this.getAppointmentContext(updated);
      const caseRef = caseData?.caseRef ? formatCaseRefWithRole(caseData.caseRef, party?.role) : "unknown case";

      await notificationService.createNotification({
        recipientId: null,
        recipientRole: "admin",
        type: "payment_hold_72h_alert",
        urgency: "red",
        caseId: updated.caseId,
        appointmentId: updated.id,
        title: `Payment due today — ${clientName}`,
        message: `${serviceType?.name || "Appointment"} for ${caseRef} is still on hold 72 hours before the appointment. Call the client and take payment the same working day.`,
        status: "active",
        caseNoteRequired: true,
      });

      await this.sendBookingHoldCountdownEmails(updated, caseRef, serviceType?.name || "Appointment");
    }

    return alerted;
  }

  private async sendBookingHoldCountdownEmails(appt: Appointment, caseRef: string, serviceName: string): Promise<void> {
    const { party, mediator } = await this.getAppointmentContext(appt);
    const { sendBookingHoldCountdownEmail } = await import("./email.service");
    if (party?.email) {
      const sent = await sendBookingHoldCountdownEmail(
        party.email,
        party.firstName,
        serviceName,
        new Date(appt.dateTime),
        appt.duration,
        caseRef,
        appt.dateTimeBasis as "instant" | "wall_clock_utc",
      );
      if (sent) {
        caseActivityService.logEmailSent(appt.caseId, party.email, `${serviceName} — Hold countdown`, party.firstName, systemActor("hold countdown reminder")).catch(() => {});
      }
    }
    if (mediator?.email) {
      const sent = await sendBookingHoldCountdownEmail(
        mediator.email,
        mediator.name,
        serviceName,
        new Date(appt.dateTime),
        appt.duration,
        caseRef,
        appt.dateTimeBasis as "instant" | "wall_clock_utc",
      );
      if (sent) {
        caseActivityService.logEmailSent(appt.caseId, mediator.email, `${serviceName} — Hold countdown (Mediator)`, mediator.name, systemActor("hold countdown reminder")).catch(() => {});
      }
    }
  }

  private reminderWindowForAppointment(appt: Appointment, now: Date): typeof APPOINTMENT_REMINDER_WINDOWS[number] | null {
    const startsIn = new Date(appt.dateTime).getTime() - now.getTime();
    if (startsIn <= 0) return null;
    for (let index = 0; index < APPOINTMENT_REMINDER_WINDOWS.length; index++) {
      const window = APPOINTMENT_REMINDER_WINDOWS[index];
      const nextWindow = APPOINTMENT_REMINDER_WINDOWS[index + 1];
      const lowerBound = nextWindow?.ms ?? 0;
      if (startsIn <= window.ms && startsIn > lowerBound) return window;
    }
    return null;
  }

  private async buildAppointmentReminderRecipients(appt: Appointment): Promise<Array<{ id: string; role: "client" | "mediator"; email: string; name: string }>> {
    const { mediator } = await this.getAppointmentContext(appt);
    const parties = appt.partyId
      ? [await storage.getParty(appt.partyId)].filter(Boolean)
      : await storage.listPartiesByCase(appt.caseId);
    const recipients: Array<{ id: string; role: "client" | "mediator"; email: string; name: string }> = [];
    const seenEmails = new Set<string>();
    for (const party of parties) {
      if (!party?.email) continue;
      const email = party.email.trim().toLowerCase();
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      recipients.push({
        id: party.userId || party.id,
        role: "client",
        email: party.email,
        name: party.firstName || "Client",
      });
    }
    if (mediator?.email) {
      const email = mediator.email.trim().toLowerCase();
      if (!seenEmails.has(email)) {
        recipients.push({ id: mediator.id, role: "mediator", email: mediator.email, name: mediator.name });
      }
    }
    return recipients;
  }

  private async hasReminderMarker(appt: Appointment, recipient: { id: string }, type: string): Promise<boolean> {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.type, type),
        eq(notifications.recipientId, recipient.id),
        eq(notifications.appointmentId, appt.id),
      ))
      .limit(1);
    return existing.length > 0;
  }

  async sendScheduledAppointmentReminders(now = new Date()): Promise<{ reminded: number }> {
    const horizon = new Date(now.getTime() + APPOINTMENT_REMINDER_WINDOWS[0].ms);
    const appointments = await storage.listAppointmentsByDateRange(now, horizon);
    let reminded = 0;
    for (const appt of appointments) {
      if (appt.status !== "confirmed") continue;
      const window = this.reminderWindowForAppointment(appt, now);
      if (!window) continue;
      const { caseData, serviceType } = await this.getAppointmentContext(appt);
      if (!caseData || caseData.status === "Closed" || caseData.status === "Archived") continue;
      const serviceName = serviceType?.name || "Appointment";
      const caseRef = caseData.caseRef || appt.caseId;
      const recipients = await this.buildAppointmentReminderRecipients(appt);
      const { sendAppointmentReminderEmail } = await import("./email.service");
      for (const recipient of recipients) {
        const type = `appointment_reminder_${window.key}_sent`;
        if (await this.hasReminderMarker(appt, recipient, type)) continue;
        const sent = await sendAppointmentReminderEmail(
          recipient.email,
          recipient.name,
          serviceName,
          new Date(appt.dateTime),
          appt.duration,
          window.label,
          caseRef,
          appt.dateTimeBasis as "instant" | "wall_clock_utc",
        );
        if (sent) {
          await notificationService.createNotification({
            recipientId: recipient.id,
            recipientRole: recipient.role,
            type,
            urgency: "green",
            caseId: appt.caseId,
            appointmentId: appt.id,
            title: `${window.label} appointment reminder sent`,
            message: `${window.label} reminder sent for ${serviceName}.`,
            status: "completed",
            caseNoteRequired: false,
          });
          caseActivityService.logEmailSent(appt.caseId, recipient.email, `${serviceName} — ${window.label} reminder`, recipient.name, systemActor("appointment reminder")).catch(() => {});
          reminded += 1;
        }
      }
    }
    return { reminded };
  }

  private async createPaymentFollowUpTask(appt: Appointment): Promise<void> {
    const { notificationService } = await import("./notification.service");
    const { party, clientName, caseData, serviceType } = await this.getAppointmentContext(appt);
    const caseRef = caseData?.caseRef ? formatCaseRefWithRole(caseData.caseRef, party?.role) : "unknown case";

    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "payment_hold_cancel_follow_up",
      urgency: "red",
      caseId: appt.caseId,
      appointmentId: appt.id,
      title: `Follow up cancelled payment hold — ${clientName}`,
      message: `${serviceType?.name || "Appointment"} for ${caseRef} was auto-cancelled because payment/voucher acceptance was not recorded 55 hours before the appointment. Offer alternative dates and options.`,
      status: "follow_up",
      followUpDate: calculateFollowUpDueAt(new Date()),
      caseNoteRequired: true,
    });
  }

  private async createMiamArrangementTask(appt: Appointment, reason: string): Promise<void> {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.type, "paid_needs_miam_arrangement"),
        eq(notifications.appointmentId, appt.id),
        ne(notifications.status, "completed"),
        ne(notifications.status, "cancelled"),
      ))
      .limit(1);
    if (existing.length > 0) return;

    const { party, clientName, caseData, serviceType } = await this.getAppointmentContext(appt);
    const caseRef = caseData?.caseRef ? formatCaseRefWithRole(caseData.caseRef, party?.role) : "unknown case";
    const actionPath = `/cases/${appt.caseId}?tab=appointments&appointmentId=${appt.id}&action=resolve-miam`;
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "paid_needs_miam_arrangement",
      urgency: "red",
      caseId: appt.caseId,
      appointmentId: appt.id,
      title: `Arrange MIAM mediator — ${clientName}`,
      message: `${serviceType?.name || "MIAM"} payment has been received for ${caseRef}, but the chosen slot is already confirmed. Open ${actionPath} to resolve the MIAM mediator arrangement. Trigger: ${reason}.`,
      status: "active",
      caseNoteRequired: true,
    });
  }

  private async completeMiamArrangementTasks(appointmentId: string, actor: Actor): Promise<void> {
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.type, "paid_needs_miam_arrangement"),
        eq(notifications.appointmentId, appointmentId),
        ne(notifications.status, "completed"),
        ne(notifications.status, "cancelled"),
      ));
    if (rows.length === 0) return;
    const now = new Date();
    await db.update(notifications).set({
      status: "completed",
      completedAt: now,
      completedBy: actor.type === "staff" ? actor.id : null,
      completionNotes: "MIAM mediator arrangement resolved.",
    }).where(inArray(notifications.id, rows.map((row) => row.id)));
  }

  private async getAppointmentContext(appt: Appointment) {
    const party = appt.partyId ? await storage.getParty(appt.partyId) : null;
    const mediator = appt.mediatorId ? await storage.getUser(appt.mediatorId) : null;
    const caseData = await storage.getCase(appt.caseId);
    const serviceTypes = await storage.listServiceTypes();
    const serviceType = appt.serviceTypeId ? serviceTypes.find(s => s.id === appt.serviceTypeId) : null;
    const clientName = party ? `${party.firstName} ${party.lastName}` : "Client";
    return { party, mediator, caseData, serviceType, clientName };
  }

  private async sendConfirmEmails(appt: Appointment, actor: Actor): Promise<void> {
    const { party, mediator, caseData, serviceType, clientName } = await this.getAppointmentContext(appt);
    if (!serviceType) return;

    const calendarTitle = await buildCalendarTitleForAppointment(appt);
    const calendarCode = calendarTemplateCode(serviceType.name, mediator?.name);
    const publishedDescription = calendarCode ? await emailTemplateService.calendarDescription(calendarCode, { duration: String(appt.duration) }) : null;
    const calendarStart = toUkCalendarEventInstant(appt.dateTime, appt.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc");
    const icsContent = generateIcsContent({
      summary: calendarTitle,
      description: withUkTimeZoneNotice(publishedDescription || `Your confirmed ${serviceType.name} appointment with Brighter Future Mediation. This session will be conducted online via video call.`),
      startTime: calendarStart,
      durationMinutes: appt.duration,
      organizer: "info@brighterfuturemediation.co.uk",
      status: "CONFIRMED",
    });

    const { sendAppointmentConfirmedUpdateEmail, sendMediatorAppointmentConfirmedEmail } = await import("./email.service");

    if (party?.email) {
      await sendAppointmentConfirmedUpdateEmail(
        party.email, party.firstName, serviceType.name,
        new Date(appt.dateTime), appt.duration, icsContent, formatCaseRefWithRole(caseData?.caseRef, party?.role), appt.dateTimeBasis as "instant" | "wall_clock_utc"
      );
      if (caseData) {
        const { caseActivityService } = await import("./case-activity.service");
        caseActivityService.logEmailSent(appt.caseId, party.email, `${serviceType.name} — Appointment Confirmed`, party.firstName, actor).catch(() => {});
      }
    }

    if (isMediationSessionService(serviceType) && !appt.partyId) {
      const events = await mediationClientCalendarService.list(appt.id);
      for (const event of events) {
        const clientParty = await storage.getParty(event.partyId);
        const client = clientParty ? await storage.getClient(clientParty.clientId) : null;
        if (!client) continue;
        const clientIcs = generateIcsContent({
          summary: `Mediation session — ${caseData?.caseRef || "Brighter Future Mediation"}`,
          description: withUkTimeZoneNotice("Your mediation session with Brighter Future Mediation is confirmed. Sign in to the client portal on the day of your session to join."),
          startTime: calendarStart,
          durationMinutes: appt.duration,
          organizer: BFM_EMAIL,
          attendee: event.recipientEmail,
          uid: event.icalUid,
        });
        let sent = false;
        try {
          sent = await sendAppointmentConfirmedUpdateEmail(
            event.recipientEmail, client.firstName, serviceType.name,
            new Date(appt.dateTime), appt.duration, clientIcs,
            caseData?.caseRef, appt.dateTimeBasis as "instant" | "wall_clock_utc",
          );
        } catch (sendError) {
          console.error(`[Appointment] Mediation session email provider error for ${appt.id}, party ${event.partyId}:`, sendError);
        }
        if (!sent) {
          console.error(`[Appointment] Mediation session confirmation email failed for appointment ${appt.id}, party ${event.partyId}`);
          await notificationService.createNotification({
            recipientId: null,
            recipientRole: "admin",
            type: "mediation_client_confirmation_email_failed",
            urgency: "red",
            caseId: appt.caseId,
            appointmentId: appt.id,
            title: "Mediation confirmation email needs attention",
            message: `The confirmation email for Client ${clientParty?.role || ""} did not send. Check the appointment and contact the client.`,
            status: "active",
            caseNoteRequired: false,
          });
        }
      }
    }

    if (mediator?.email) {
      await sendMediatorAppointmentConfirmedEmail(
        mediator.email, mediator.name, clientName, serviceType.name,
        new Date(appt.dateTime), appt.duration, formatCaseRefWithRole(caseData?.caseRef, party?.role) || "", icsContent, appt.dateTimeBasis as "instant" | "wall_clock_utc"
      );
      if (caseData) {
        const { caseActivityService } = await import("./case-activity.service");
        caseActivityService.logEmailSent(appt.caseId, mediator.email, `${serviceType.name} — Appointment Confirmed (Mediator)`, mediator.name, actor).catch(() => {});
      }
    }
  }

  private async sendCancelEmails(appt: Appointment, reason: "cancelled" | "expired", actor: Actor): Promise<void> {
    const { party, mediator, caseData, serviceType, clientName } = await this.getAppointmentContext(appt);
    if (!serviceType) return;

    const calendarTitle = await buildCalendarTitleForAppointment(appt);
    const calendarStart = toUkCalendarEventInstant(appt.dateTime, appt.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc");
    const icsContent = generateIcsContent({
      summary: calendarTitle,
      description: `This ${serviceType.name} appointment has been ${reason}.`,
      startTime: calendarStart,
      durationMinutes: appt.duration,
      organizer: "info@brighterfuturemediation.co.uk",
      status: "CANCELLED",
    });

    const { sendAppointmentCancelledEmail, sendMediatorAppointmentCancelledEmail } = await import("./email.service");

    if (party?.email) {
      await sendAppointmentCancelledEmail(
        party.email, party.firstName, serviceType.name,
        new Date(appt.dateTime), appt.duration, reason, formatCaseRefWithRole(caseData?.caseRef, party?.role), icsContent, appt.dateTimeBasis as "instant" | "wall_clock_utc"
      );
      if (caseData) {
        const { caseActivityService } = await import("./case-activity.service");
        const reasonLabel = reason === "expired" ? "Expired" : "Cancelled";
        caseActivityService.logEmailSent(appt.caseId, party.email, `${serviceType.name} — Appointment ${reasonLabel}`, party.firstName, actor).catch(() => {});
      }
    }

    if (mediator?.email) {
      await sendMediatorAppointmentCancelledEmail(
        mediator.email, mediator.name, clientName, serviceType.name,
        new Date(appt.dateTime), appt.duration, formatCaseRefWithRole(caseData?.caseRef, party?.role) || "", reason, icsContent, appt.dateTimeBasis as "instant" | "wall_clock_utc"
      );
      if (caseData) {
        const { caseActivityService } = await import("./case-activity.service");
        const reasonLabel = reason === "expired" ? "Expired" : "Cancelled";
        caseActivityService.logEmailSent(appt.caseId, mediator.email, `${serviceType.name} — Appointment ${reasonLabel} (Mediator)`, mediator.name, actor).catch(() => {});
      }
    }
  }

  private async createNotifications(appt: Appointment, type: "hold" | "held" | "confirmed" | "cancelled" | "expired"): Promise<void> {
    const { party, clientName, caseData, serviceType } = await this.getAppointmentContext(appt);
    if (!serviceType || !caseData) return;

    const { notificationService } = await import("./notification.service");
    await notificationService.createAppointmentNotifications(
      appt.id, appt.caseId, type, clientName,
      appt.mediatorId, formatCaseRefWithRole(caseData.caseRef, party?.role), serviceType.name
    );
  }

  async ensureCalendarArtifactsForConfirmation(
    appt: Appointment,
    options: { preserveSuccessfulMediatorLeg?: boolean } = {},
  ): Promise<ServiceResult<{ ready: true }>> {
    const { party, mediator, caseData, serviceType, clientName } = await this.getAppointmentContext(appt);
    if (!serviceType || !caseData) {
      return { ok: false, error: "Missing case or service details for calendar confirmation", status: 500 };
    }
    const isJointSession = isMediationSessionService(serviceType) && !appt.partyId;
    if (isJointSession) {
      const validation = await mediationClientCalendarService.validate(appt);
      if (!validation.ok) return { ok: false, error: validation.error, status: 400 };
    }

    const start = toUkCalendarEventInstant(appt.dateTime, appt.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc");
    const end = new Date(start.getTime() + appt.duration * 60000);
    const caseRef = formatCaseRefWithRole(caseData.caseRef, party?.role);
    const calendarTitle = await buildCalendarTitleForAppointment(appt);

    let splitResultForRollback: {
      parentGoogleEventId: string;
      parentCalendarProvider: CalendarProvider;
      parentEventOriginalStart: Date;
      parentEventOriginalEnd: Date;
      parentEventOriginalTitle: string | null;
      parentEventOriginalAttendees: string | null;
      googleBookingEventId: string | null;
      bookingCalendarProvider: CalendarProvider | null;
      googleTrailingRemnantEventId: string | null;
      trailingRemnantCalendarProvider: CalendarProvider | null;
    } | null = null;
    let overlayResultForRollback: { provider: CalendarProvider; eventId: string } | null = null;

    if (appt.parentGoogleEventId && !appt.googleBookingEventId) {
      const provider = getAppointmentCalendarProvider(appt);
      if (!appt.mediatorId || !mediator || !provider || !isMediatorProviderConnected(mediator, provider)) {
        return { ok: false, error: "Mediator calendar is not connected", status: 502 };
      }
      const calendar = getMediatorCalendarProviderService(provider);
      if (!appt.parentEventOriginalStart || !appt.parentEventOriginalEnd) {
        return { ok: false, error: "Original calendar availability details are missing", status: 500 };
      }

      let parentAttendees: { email: string; displayName?: string }[] | undefined;
      try {
        const parentDetails = await calendar.getEventById(appt.mediatorId, appt.parentGoogleEventId);
        if (parentDetails?.attendees?.length) {
          parentAttendees = parentDetails.attendees
            .filter(a => a.email)
            .map(a => ({ email: a.email, displayName: a.displayName }));
        }
      } catch (lookupErr) {
        console.warn("[Appointment] Could not fetch parent event attendees before confirmation split:", lookupErr);
      }

      const attendees: { email: string; displayName?: string; responseStatus?: string }[] = [
        { email: BFM_EMAIL, displayName: "Brighter Future Mediation", responseStatus: "accepted" },
      ];
      if (mediator.email) attendees.push({ email: mediator.email, displayName: mediator.name });
      const attendeesSnapshot = parentAttendees && parentAttendees.length > 0 ? JSON.stringify(parentAttendees) : null;

      try {
        const bookingEvent = {
          start,
          end,
          summary: calendarTitle,
          description: withUkTimeZoneNotice((await emailTemplateService.calendarDescription(calendarTemplateCode(serviceType.name, mediator.name) || "", { duration: String(appt.duration) })) || `Case ${caseRef}\nClient: ${clientName}\nMediator: ${mediator.name}\nStatus: confirmed`),
          attendees,
          location: mediator.zoomLink ?? undefined,
        };
        if (appt.availabilityReservationMode === "overlay" && appt.availabilitySourceId) {
          const bookingEventId = await calendar.createEvent(appt.mediatorId, bookingEvent);
          overlayResultForRollback = { provider, eventId: bookingEventId };
          const persisted = await storage.updateAppointment(appt.id, {
            googleBookingEventId: bookingEventId,
            bookingCalendarProvider: provider,
            googleTrailingRemnantEventId: null,
            trailingRemnantCalendarProvider: null,
            parentEventOriginalAttendees: attendeesSnapshot,
          });
          if (!persisted) throw new Error("Could not persist mediator calendar event ID");
        } else {
          const split = await calendar.splitAvailabilityForBooking(
          appt.mediatorId,
          appt.parentGoogleEventId,
          appt.parentEventOriginalStart,
          appt.parentEventOriginalEnd,
          appt.parentEventOriginalTitle ?? null,
          bookingEvent,
          appt.id,
          parentAttendees,
        );

        splitResultForRollback = {
          parentGoogleEventId: appt.parentGoogleEventId,
          parentCalendarProvider: provider,
          parentEventOriginalStart: appt.parentEventOriginalStart,
          parentEventOriginalEnd: appt.parentEventOriginalEnd,
          parentEventOriginalTitle: appt.parentEventOriginalTitle ?? null,
          parentEventOriginalAttendees: attendeesSnapshot,
          googleBookingEventId: split.googleBookingEventId,
          bookingCalendarProvider: provider,
          googleTrailingRemnantEventId: split.googleTrailingRemnantEventId,
          trailingRemnantCalendarProvider: split.googleTrailingRemnantEventId ? provider : null,
        };

        const persisted = await storage.updateAppointment(appt.id, {
          googleBookingEventId: split.googleBookingEventId,
          bookingCalendarProvider: provider,
          googleTrailingRemnantEventId: split.googleTrailingRemnantEventId,
          trailingRemnantCalendarProvider: split.googleTrailingRemnantEventId ? provider : null,
          parentEventOriginalAttendees: attendeesSnapshot,
        });
        if (!persisted) {
          throw new Error("Could not persist mediator calendar event IDs");
        }
        }
      } catch (err) {
        // If the provider split succeeded but persisting its event IDs failed,
        // always restore the parent. Keeping an untracked external event would
        // make the next attempt create a duplicate booking.
        if (splitResultForRollback && appt.mediatorId) {
          await getMediatorCalendarProviderService(splitResultForRollback.parentCalendarProvider).restoreParentEventForCancelledBooking(
            appt.mediatorId,
            splitResultForRollback,
            appt.id,
            appt.id,
          ).catch((restoreErr) => {
            console.error("[Appointment] Failed to restore mediator calendar after confirmation failure:", restoreErr);
          });
          await storage.updateAppointment(appt.id, {
            googleBookingEventId: null,
            bookingCalendarProvider: null,
            googleTrailingRemnantEventId: null,
            trailingRemnantCalendarProvider: null,
            parentEventOriginalAttendees: null,
          }).catch(() => undefined);
        }
        if (overlayResultForRollback && appt.mediatorId) {
          await getMediatorCalendarProviderService(overlayResultForRollback.provider)
            .deleteEvent(appt.mediatorId, overlayResultForRollback.eventId)
            .catch((deleteErr) => console.error("[Appointment] Failed to delete overlay booking after confirmation failure:", deleteErr));
          await storage.updateAppointment(appt.id, {
            googleBookingEventId: null,
            bookingCalendarProvider: null,
          }).catch(() => undefined);
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not create mediator calendar event",
          status: 502,
        };
      }
    }

    if (isJointSession) {
      try {
        await mediationClientCalendarService.ensure(appt, caseData.caseRef);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not create client calendar invitations", status: 502 };
      }
    }

    if (!isJointSession && !appt.googleClientEventId) {
      if (!party?.email) {
        return { ok: true, ready: true };
      }
      let bfmEventId: string | null = null;
      try {
        bfmEventId = await googleCalendarService.createBfmEvent({
          summary: calendarTitle,
          description: withUkTimeZoneNotice((await emailTemplateService.calendarDescription(calendarTemplateCode(serviceType.name, mediator?.name) || "", { duration: String(appt.duration) })) || `Your ${serviceType.name} appointment with Brighter Future Mediation is confirmed. This session will be conducted online via video call.`),
          start,
          end,
          clientEmail: party.email,
          clientName,
          location: mediator?.zoomLink ?? undefined,
        });
        const persisted = await storage.updateAppointment(appt.id, {
          googleClientEventId: bfmEventId,
        });
        if (!persisted) {
          throw new Error("Could not persist client calendar event ID");
        }
      } catch (err) {
        if (bfmEventId) {
          await googleCalendarService.deleteBfmEvent(bfmEventId).catch((deleteErr) => {
            console.error("[Appointment] Could not delete BFM event after confirmation failure:", deleteErr);
          });
        }
        if (splitResultForRollback && appt.mediatorId && !options.preserveSuccessfulMediatorLeg) {
          await getMediatorCalendarProviderService(splitResultForRollback.parentCalendarProvider).restoreParentEventForCancelledBooking(
            appt.mediatorId,
            splitResultForRollback,
            appt.id,
            appt.id,
          ).catch((restoreErr) => {
            console.error("[Appointment] Failed to restore mediator calendar after BFM event failure:", restoreErr);
          });
          await storage.updateAppointment(appt.id, {
            googleBookingEventId: null,
            bookingCalendarProvider: null,
            googleTrailingRemnantEventId: null,
            trailingRemnantCalendarProvider: null,
            parentEventOriginalAttendees: null,
          }).catch(() => undefined);
        }
        if (overlayResultForRollback && appt.mediatorId && !options.preserveSuccessfulMediatorLeg) {
          await getMediatorCalendarProviderService(overlayResultForRollback.provider)
            .deleteEvent(appt.mediatorId, overlayResultForRollback.eventId)
            .catch((deleteErr) => console.error("[Appointment] Failed to delete overlay booking after client calendar failure:", deleteErr));
          await storage.updateAppointment(appt.id, {
            googleBookingEventId: null,
            bookingCalendarProvider: null,
          }).catch(() => undefined);
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not create client calendar invite",
          status: 502,
        };
      }
    }

    return { ok: true, ready: true };
  }

  private async logActivity(
    appt: Appointment,
    type: "appointment_hold" | "appointment_held" | "appointment_confirmed" | "appointment_cancelled" | "appointment_expired" | "appointment_completed",
    actor: Actor,
  ): Promise<void> {
    const { clientName, caseData, serviceType, mediator } = await this.getAppointmentContext(appt);
    if (!serviceType || !caseData) return;

    const { caseActivityService } = await import("./case-activity.service");
    await caseActivityService.logAppointmentEvent(
      appt.caseId, appt.id, type, serviceType.name, clientName,
      new Date(appt.dateTime), mediator?.name, actor,
    );
  }
}

export const appointmentService = new AppointmentService();
