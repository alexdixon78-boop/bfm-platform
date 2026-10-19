import { storage } from "../storage";
import type { MediatorAvailability } from "@shared/schema";
import type { ServiceResult } from "./types";
import { z } from "zod";
import { getMediatorAvailabilityWindows, generateHourSlotsInWindow, SLOT_DURATION_MINUTES } from "./availability-windows";
import { db } from "../db";
import { isMediationRoleQualifiedFor, mediatorServiceApprovals, mediatorServiceScheduleSlots, mediatorServiceTypes } from "@shared/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { getEffectiveApprovalStatus } from "./mediator-service-approval.service";
import { buildBookingSlot, type BookingTimeBasis } from "@shared/booking-time";

export type AvailableBookingSlot = {
  startAt: string;
  endAt: string;
  time: string;
  endTime: string;
  duration: number;
  timeBasis: BookingTimeBasis;
};

const slotSchema = z.object({
  dayOfWeek: z.number().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  isActive: z.boolean().optional().default(true),
});

const bulkSlotsSchema = z.object({
  slots: z.array(slotSchema),
});

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function slotsOverlap(
  a: { dayOfWeek: number; startTime: string; endTime: string },
  b: { dayOfWeek: number; startTime: string; endTime: string }
): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export class AvailabilityService {
  async getByMediator(mediatorId: string): Promise<MediatorAvailability[]> {
    const user = await storage.getUser(mediatorId);
    if (!user || user.role !== "mediator") return [];
    return storage.listAvailabilityByMediator(mediatorId);
  }

  async setAvailability(mediatorId: string, body: unknown): Promise<ServiceResult<{ slots: MediatorAvailability[] }>> {
    const user = await storage.getUser(mediatorId);
    if (!user || user.role !== "mediator") {
      return { ok: false, error: "Mediator not found", status: 404 };
    }

    const parsed = bulkSlotsSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, error: "Invalid availability data", status: 400 };
    }

    const { slots } = parsed.data;

    for (const slot of slots) {
      if (timeToMinutes(slot.startTime) >= timeToMinutes(slot.endTime)) {
        return { ok: false, error: `Start time ${slot.startTime} must be before end time ${slot.endTime}`, status: 400 };
      }
    }

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slotsOverlap(slots[i], slots[j])) {
          return { ok: false, error: `Overlapping time slots detected on day ${slots[i].dayOfWeek}`, status: 400 };
        }
      }
    }

    const created = await storage.bulkReplaceAvailability(mediatorId, slots);
    return { ok: true, slots: created };
  }

  async getQualifiedMediatorsForService(serviceTypeId: string) {
    const serviceType = await storage.getServiceType(serviceTypeId);
    const requiresLeadQualifiedService = !!serviceType && (
      serviceType.category === "MIAM" || serviceType.name.toLowerCase().includes("miam")
    );
    const allMediatorServices = await db
      .select({
        mediatorId: mediatorServiceTypes.mediatorId,
        serviceTypeId: mediatorServiceTypes.serviceTypeId,
        mediationRoleQualification: mediatorServiceTypes.mediationRoleQualification,
      })
      .from(mediatorServiceTypes);
    const qualifiedIds = new Set(
      allMediatorServices
        .filter(ms => ms.serviceTypeId === serviceTypeId)
        .filter(ms => !requiresLeadQualifiedService || isMediationRoleQualifiedFor(ms.mediationRoleQualification, "lead_mediator"))
        .map(ms => ms.mediatorId)
    );
    if (qualifiedIds.size === 0) return [];
    const allUsers = await storage.listUsers();
    const baseEligible = allUsers.filter(u => qualifiedIds.has(u.id) && u.role === "mediator" && u.status === "active");

    // Compliance/panel-status filter (Task #171): exclude any mediator whose
    // panel status is not Active. This includes the auto-set "Paused — PI lapsed"
    // status that the profile service applies when PI insurance has expired.
    if (baseEligible.length === 0) return [];
    const approvals = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(
        eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
      );
    const approvedIds = new Set(
      approvals
        .filter((row) => row.mediatorId && getEffectiveApprovalStatus(row) === "approved")
        .map((row) => row.mediatorId as string),
    );
    if (approvedIds.size === 0) return [];

    const { mediatorProfileRepository } = await import("../repositories/mediator-profile.repository");
    const filtered: typeof baseEligible = [];
    for (const u of baseEligible) {
      if (!approvedIds.has(u.id)) continue;
      const profile = await mediatorProfileRepository.getProfile(u.id);
      if (!profile) { filtered.push(u); continue; } // no profile yet → don't block legacy mediators
      const panel = (profile.panelStatus ?? "Active") as string;
      if (panel === "Active") filtered.push(u);
    }
    return filtered;
  }

  async hasBookableAvailabilityForService(serviceTypeId: string): Promise<boolean> {
    const qualifiedMediators = await this.getQualifiedMediatorsForService(serviceTypeId);
    if (qualifiedMediators.length === 0) return false;
    const now = new Date();
    const futureEnd = new Date(now);
    futureEnd.setDate(futureEnd.getDate() + 365);
    for (const mediator of qualifiedMediators) {
      const scheduleRows = await db
        .select({ id: mediatorServiceScheduleSlots.id })
        .from(mediatorServiceScheduleSlots)
        .where(and(
          eq(mediatorServiceScheduleSlots.mediatorId, mediator.id),
          eq(mediatorServiceScheduleSlots.serviceTypeId, serviceTypeId),
          eq(mediatorServiceScheduleSlots.lifecycle, "active"),
          gte(mediatorServiceScheduleSlots.startAt, now),
          lte(mediatorServiceScheduleSlots.startAt, futureEnd),
        ))
        .limit(1);
      if (scheduleRows.length > 0) return true;
      const approvalRows = await db
        .select()
        .from(mediatorServiceApprovals)
        .where(and(
          eq(mediatorServiceApprovals.mediatorId, mediator.id),
          eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
        ))
        .limit(1);
      if (approvalRows.some((row) => getEffectiveApprovalStatus(row) === "approved")) return true;
    }
    return false;
  }

  async getAvailableDates(serviceTypeId: string, month: string, options: { mediatorIdScope?: string } = {}): Promise<{ dates: string[]; bookingPaused: boolean }> {
    const serviceType = await storage.getServiceType(serviceTypeId);
    if (!serviceType || !serviceType.isActive) return { dates: [], bookingPaused: false };

    const qualifiedMediators = (await this.getQualifiedMediatorsForService(serviceTypeId)).filter(mediator => !options.mediatorIdScope || mediator.id === options.mediatorIdScope);
    if (qualifiedMediators.length === 0) return { dates: [], bookingPaused: false };

    // If every qualified mediator is in "scope-incomplete Google state"
    // (lastCalendarSyncError="needs_write_scope"), booking is paused until at
    // least one reconnects with write scope. This covers both cases:
    //   (a) backfilled existing connected accounts (googleCalendarConnected=true)
    //   (b) freshly-rejected OAuth callbacks (googleCalendarConnected=false)
    const bookingPaused =
      qualifiedMediators.length > 0 &&
      qualifiedMediators.every(m => m.lastCalendarSyncError === "needs_write_scope");
    if (bookingPaused) return { dates: [], bookingPaused: true };

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monthStr, 10) - 1;
    if (isNaN(year) || isNaN(mon)) return { dates: [], bookingPaused: false };

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysInMonth = new Date(year, mon + 1, 0).getDate();
    const availableDates: string[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, mon, day));
      if (date < today) continue;

      const dayStart = new Date(Date.UTC(year, mon, day, 0, 0, 0, 0));
      const dayEnd = new Date(Date.UTC(year, mon, day, 23, 59, 59, 999));

      let hasAnySlot = false;
      for (const mediator of qualifiedMediators) {
        if (hasAnySlot) break;
        const windows = await getMediatorAvailabilityWindows(mediator, dayStart, dayEnd, serviceTypeId);
        for (const w of windows) {
          const slots = generateHourSlotsInWindow(w);
          if (slots.length > 0) {
            const futureSlots = slots.filter(s => s.getTime() > now.getTime());
            if (futureSlots.length > 0) {
              hasAnySlot = true;
              break;
            }
          }
        }
      }

      if (hasAnySlot) {
        const dateStr = `${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        availableDates.push(dateStr);
      }
    }

    return { dates: availableDates, bookingPaused: false };
  }

  async getAvailableSlots(serviceTypeId: string, date: string, options: { mediatorIdScope?: string } = {}): Promise<AvailableBookingSlot[]> {
    const serviceType = await storage.getServiceType(serviceTypeId);
    if (!serviceType || !serviceType.isActive) return [];

    const qualifiedMediators = (await this.getQualifiedMediatorsForService(serviceTypeId)).filter(mediator => !options.mediatorIdScope || mediator.id === options.mediatorIdScope);
    if (qualifiedMediators.length === 0) return [];

    const [yStr, mStr, dStr] = date.split("-");
    const dateYear = parseInt(yStr, 10);
    const dateMonth = parseInt(mStr, 10) - 1;
    const dateDay = parseInt(dStr, 10);
    if (isNaN(dateYear) || isNaN(dateMonth) || isNaN(dateDay)) return [];

    const dayStart = new Date(Date.UTC(dateYear, dateMonth, dateDay, 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(dateYear, dateMonth, dateDay, 23, 59, 59, 999));

    const now = new Date();
    const availableSlots = new Map<string, AvailableBookingSlot>();

    for (const mediator of qualifiedMediators) {
      const windows = await getMediatorAvailabilityWindows(mediator, dayStart, dayEnd, serviceTypeId);
      for (const w of windows) {
        const slots = generateHourSlotsInWindow(w);
        for (const slot of slots) {
          if (slot.getTime() <= now.getTime()) continue;
          const candidate = buildBookingSlot(slot, SLOT_DURATION_MINUTES, w.timeBasis);
          availableSlots.set(`${candidate.startAt}|${candidate.timeBasis}`, candidate);
        }
      }
    }

    return Array.from(availableSlots.values()).sort((a, b) => a.time.localeCompare(b.time) || a.startAt.localeCompare(b.startAt));
  }

  /**
   * For booking confirmation: find a qualified mediator who has the requested
   * slot available, and identify the parent Google event (if any) that should
   * be split. Returns the chosen mediator and source.
   */
  async findMediatorForSlot(
    serviceTypeId: string,
    slotStart: Date,
    options?: { mediatorIdScope?: string; timeBasis?: BookingTimeBasis }
  ): Promise<{
    mediatorId: string;
    timeBasis: BookingTimeBasis;
    parentGoogleEventId?: string;
    parentCalendarProvider?: "google" | "outlook";
    parentEventTitle?: string | null;
    parentEventStart?: Date;
    parentEventEnd?: Date;
    availabilitySourceId?: string;
    availabilityReservationMode?: "overlay" | "split_restore";
  } | null> {
    const qualifiedMediators = await this.getQualifiedMediatorsForService(serviceTypeId);
    const scoped = options?.mediatorIdScope
      ? qualifiedMediators.filter(m => m.id === options.mediatorIdScope)
      : qualifiedMediators;
    if (scoped.length === 0) return null;

    const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MINUTES * 60000);
    const dayStart = new Date(Date.UTC(slotStart.getUTCFullYear(), slotStart.getUTCMonth(), slotStart.getUTCDate(), 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(slotStart.getUTCFullYear(), slotStart.getUTCMonth(), slotStart.getUTCDate(), 23, 59, 59, 999));

    for (const mediator of scoped) {
      const windows = await getMediatorAvailabilityWindows(mediator, dayStart, dayEnd, serviceTypeId);
      for (const w of windows) {
        if (options?.timeBasis && w.timeBasis !== options.timeBasis) continue;
        if (slotStart >= w.start && slotEnd <= w.end) {
          return {
            mediatorId: mediator.id,
            timeBasis: w.timeBasis,
            parentGoogleEventId: w.parentGoogleEventId,
            parentCalendarProvider: w.parentCalendarProvider,
            parentEventTitle: w.parentEventTitle,
            parentEventStart: w.parentEventStart,
            parentEventEnd: w.parentEventEnd,
            availabilitySourceId: w.availabilitySourceId,
            availabilityReservationMode: w.availabilityReservationMode,
          };
        }
      }
    }

    return null;
  }
}

export const availabilityService = new AvailabilityService();
