import { storage } from "../storage";
import { hasWriteScope } from "./google-calendar.service";
import { db } from "../db";
import { mediatorCalendarAvailabilitySources, mediatorServiceApprovals, mediatorServiceScheduleSlots } from "@shared/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { User, GoogleCalendarEvent, MediatorAvailability, Appointment } from "@shared/schema";
import { isCalendarProvider, type CalendarProvider } from "./mediator-calendar-provider.service";
import { getEffectiveApprovalStatus } from "./mediator-service-approval.service";
import { canConfirmAppointmentPayment } from "./appointment-rules";
import type { BookingTimeBasis } from "@shared/booking-time";

export type Window = { start: Date; end: Date };

export type MediatorWindowSource = {
  mediatorId: string;
  source: "google" | "outlook" | "manual";
  parentGoogleEventId?: string;
  parentCalendarProvider?: CalendarProvider;
  parentEventTitle?: string | null;
  parentEventStart?: Date;
  parentEventEnd?: Date;
  availabilitySourceId?: string;
  availabilityReservationMode?: "overlay" | "split_restore";
};

export type WindowWithSource = Window & MediatorWindowSource & { timeBasis: BookingTimeBasis };

const SLOT_DURATION_MIN = 60;
const SLOT_GRID_MIN = 15;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isAppointmentBlockingAvailability(a: Appointment): boolean {
  return a.status !== "cancelled" && a.status !== "expired"
    && (a.status === "confirmed" || canConfirmAppointmentPayment(a.paymentStatus));
}

/**
 * For the given mediator on the given day, return availability windows.
 * If Google-connected with write scope: windows come from BFM-invited Google events.
 * Otherwise: windows come from mediator_availability rows for that day-of-week.
 */
export async function getMediatorAvailabilityWindows(
  mediator: User,
  dayStart: Date,
  dayEnd: Date,
  serviceTypeId?: string,
  cache?: {
    googleEvents?: Map<string, GoogleCalendarEvent[]>;
    manualSlots?: Map<string, MediatorAvailability[]>;
    appointments?: Map<string, Appointment[]>;
  }
): Promise<WindowWithSource[]> {
  const isGoogleConnected = !!mediator.googleCalendarConnected;
  const isGoogleConnectedWithWrite = isGoogleConnected && hasWriteScope(mediator.googleScopeGranted);

  // A mediator is in "scope-incomplete Google state" if lastCalendarSyncError
  // is "needs_write_scope". This covers both cases:
  //   (a) backfilled existing connected accounts: googleCalendarConnected=true
  //   (b) freshly-rejected OAuth callback: googleCalendarConnected=false
  // In either case we must NOT fall back to manual availability — doing so
  // would allow public bookings to proceed without proper Google Calendar
  // integration. Return no windows; the reconnect banner will prompt them.
  const hasScopeIssue = mediator.lastCalendarSyncError === "needs_write_scope";
  if (hasScopeIssue) {
    return [];
  }

  let rawWindows: WindowWithSource[] = [];

  if (serviceTypeId) {
    const scheduleRows = await db
      .select()
      .from(mediatorServiceScheduleSlots)
      .where(and(
        eq(mediatorServiceScheduleSlots.mediatorId, mediator.id),
        eq(mediatorServiceScheduleSlots.serviceTypeId, serviceTypeId),
        eq(mediatorServiceScheduleSlots.lifecycle, "active"),
        gte(mediatorServiceScheduleSlots.startAt, dayStart),
        lte(mediatorServiceScheduleSlots.startAt, dayEnd),
      ))
      .orderBy(mediatorServiceScheduleSlots.startAt);
    if (scheduleRows.length > 0) {
      const sourceIds = Array.from(new Set(scheduleRows.flatMap((row) => row.availabilitySourceId ? [row.availabilitySourceId] : [])));
      const genericSourceIds = sourceIds.length === 0 ? new Set<string>() : new Set((await db
        .select({ id: mediatorCalendarAvailabilitySources.id })
        .from(mediatorCalendarAvailabilitySources)
        .where(and(
          inArray(mediatorCalendarAvailabilitySources.id, sourceIds),
          eq(mediatorCalendarAvailabilitySources.origin, "mediator_invite"),
        ))).map((source) => source.id));
      rawWindows = scheduleRows.map((row) => {
        const provider = isCalendarProvider(row.calendarProvider) ? row.calendarProvider : undefined;
        return {
          start: new Date(row.startAt),
          end: new Date(row.endAt),
          mediatorId: mediator.id,
          source: provider ?? "manual",
          timeBasis: "instant" as const,
          parentGoogleEventId: row.googleEventId ?? undefined,
          parentCalendarProvider: provider,
          parentEventTitle: row.googleEventId ? "Available" : undefined,
          parentEventStart: row.googleEventId ? row.startAt : undefined,
          parentEventEnd: row.googleEventId ? row.endAt : undefined,
          availabilitySourceId: row.availabilitySourceId ?? undefined,
          availabilityReservationMode: row.availabilitySourceId && genericSourceIds.has(row.availabilitySourceId) ? "overlay" as const : "split_restore" as const,
        };
      });
    } else {
      const approvalRows = await db
        .select()
        .from(mediatorServiceApprovals)
        .where(and(
          eq(mediatorServiceApprovals.mediatorId, mediator.id),
          eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
          gte(mediatorServiceApprovals.calendarStartAt, dayStart),
          lte(mediatorServiceApprovals.calendarStartAt, dayEnd),
        ))
        .orderBy(mediatorServiceApprovals.calendarStartAt);
      rawWindows = approvalRows
        .filter((row) => getEffectiveApprovalStatus(row) === "approved")
        .filter((row) => row.calendarStartAt && row.calendarEndAt)
        .map((row) => ({
          start: new Date(row.calendarStartAt!),
          end: new Date(row.calendarEndAt!),
          mediatorId: mediator.id,
          source: "google" as const,
          timeBasis: "instant" as const,
          parentGoogleEventId: row.calendarGoogleEventId ?? undefined,
          parentCalendarProvider: row.calendarGoogleEventId ? "google" as const : undefined,
          parentEventTitle: row.calendarTitle ?? null,
          parentEventStart: row.calendarStartAt ?? undefined,
          parentEventEnd: row.calendarEndAt ?? undefined,
        }))
        .filter(w => w.end.getTime() > w.start.getTime());
    }
  } else if (isGoogleConnectedWithWrite) {
    let events = cache?.googleEvents?.get(mediator.id);
    if (!events) {
      events = await storage.listGoogleCalendarEventsByDateRange(mediator.id, dayStart, dayEnd);
    }
    const bfmInvitedEvents = events.filter(e => {
      if (e.isAllDay) return false;
      // Exclude split-spawned booking events from availability — they are
      // already-reserved time, not bookable windows.
      if (
        e.title?.startsWith("BFM Booking —") ||
        e.title?.startsWith("MIAM - ") ||
        e.title?.startsWith("Session - ")
      ) return false;
      const status = (e.bfmAttendanceStatus ?? "").toLowerCase();
      return status === "organiser" || status === "accepted";
    });
    rawWindows = bfmInvitedEvents.map(e => {
      const start = new Date(Math.max(e.startAt.getTime(), dayStart.getTime()));
      const end = new Date(Math.min(e.endAt.getTime(), dayEnd.getTime()));
      return {
        start,
        end,
        mediatorId: mediator.id,
        source: "google" as const,
        timeBasis: "wall_clock_utc" as const,
        parentGoogleEventId: e.googleEventId,
        parentCalendarProvider: "google" as const,
        parentEventTitle: e.title ?? null,
        parentEventStart: e.startAt,
        parentEventEnd: e.endAt,
      };
    }).filter(w => w.end.getTime() > w.start.getTime());
  } else {
    const dayOfWeek = dayStart.getUTCDay();
    let slots = cache?.manualSlots?.get(mediator.id);
    if (!slots) {
      slots = await storage.listActiveAvailabilityByMediator(mediator.id);
    }
    rawWindows = slots
      .filter(s => s.dayOfWeek === dayOfWeek && s.isActive)
      .map(s => {
        const startMins = timeToMinutes(s.startTime);
        const endMins = timeToMinutes(s.endTime);
        const y = dayStart.getUTCFullYear();
        const mo = dayStart.getUTCMonth();
        const d = dayStart.getUTCDate();
        const start = new Date(Date.UTC(y, mo, d, Math.floor(startMins / 60), startMins % 60));
        const end = new Date(Date.UTC(y, mo, d, Math.floor(endMins / 60), endMins % 60));
        return {
          start,
          end,
          mediatorId: mediator.id,
          source: "manual" as const,
          timeBasis: "wall_clock_utc" as const,
        };
      });
  }

  // Subtract existing non-cancelled BFM appointments
  let appointments = cache?.appointments?.get(mediator.id);
  if (!appointments) {
    appointments = await storage.listAppointmentsByMediatorAndDateRange(mediator.id, dayStart, dayEnd);
  }
  const blockingAppts = appointments.filter(isAppointmentBlockingAvailability);

  const windows: WindowWithSource[] = [];
  for (const w of rawWindows) {
    let pieces: Window[] = [{ start: w.start, end: w.end }];
    for (const a of blockingAppts) {
      const aStart = new Date(a.dateTime);
      const aEnd = new Date(aStart.getTime() + a.duration * 60000);
      const newPieces: Window[] = [];
      for (const p of pieces) {
        if (aEnd <= p.start || aStart >= p.end) {
          newPieces.push(p);
          continue;
        }
        if (aStart > p.start) {
          newPieces.push({ start: p.start, end: new Date(Math.min(aStart.getTime(), p.end.getTime())) });
        }
        if (aEnd < p.end) {
          newPieces.push({ start: new Date(Math.max(aEnd.getTime(), p.start.getTime())), end: p.end });
        }
      }
      pieces = newPieces;
    }
    for (const p of pieces) {
      if (p.end.getTime() - p.start.getTime() >= SLOT_DURATION_MIN * 60000) {
        windows.push({ ...w, start: p.start, end: p.end });
      }
    }
  }

  return windows.sort((a, b) => {
    const strategyOrder = (window: WindowWithSource) => window.availabilityReservationMode === "overlay" ? 0 : 1;
    return strategyOrder(a) - strategyOrder(b) || a.start.getTime() - b.start.getTime();
  });
}

/**
 * Generate non-overlapping 60-min slots inside a window, normalized to a
 * client-friendly 15-minute grid.
 * A window 13:05–15:55 yields 13:15, 14:15.
 * A window 13:30–14:30 yields 13:30.
 * A window 14:15–17:15 yields 14:15, 15:15, 16:15.
 */
export function generateHourSlotsInWindow(window: Window): Date[] {
  const slots: Date[] = [];
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  // Round up to the next 15-minute boundary.
  const startDate = new Date(startMs);
  const startTotalMinutes = startDate.getUTCHours() * 60 + startDate.getUTCMinutes();
  const hasSubMinute = startDate.getUTCSeconds() !== 0 || startDate.getUTCMilliseconds() !== 0;
  const roundedTotalMinutes =
    Math.ceil((startTotalMinutes + (hasSubMinute ? 1 : 0)) / SLOT_GRID_MIN) * SLOT_GRID_MIN;
  let cursor = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
    Math.floor(roundedTotalMinutes / 60),
    roundedTotalMinutes % 60,
    0,
    0
  ));

  while (cursor.getTime() + SLOT_DURATION_MIN * 60000 <= endMs) {
    slots.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + SLOT_DURATION_MIN * 60000);
  }

  return slots;
}

export const SLOT_DURATION_MINUTES = SLOT_DURATION_MIN;
