import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import {
  appointments,
  googleCalendarEvents,
  mediatorCalendarAvailabilitySources,
  mediatorServiceApprovals,
  mediatorServiceScheduleSlots,
  notificationTaskLinks,
  notifications,
  outlookCalendarEvents,
  serviceTypes,
  tasks,
} from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";
import { recognizeCalendarAvailabilityEvent, type CalendarAvailabilityCandidate } from "./calendar-availability-recognition";
import {
  buildAvailabilityFingerprint,
} from "./calendar-availability-reconciliation";
import { buildCalendarAvailabilityWindows } from "./calendar-availability-window";
import { getEffectiveApprovalStatus } from "./mediator-service-approval.service";
import { notificationService } from "./notification.service";
import { notificationRealtimeService } from "./notification-realtime.service";
import { getMediatorCalendarProviderService } from "./mediator-calendar-provider.service";

type Provider = "google" | "outlook";
export type CalendarAvailabilityTrigger = "webhook" | "fallback_sweep" | "manual_sync" | "service_approval" | "retry" | "disconnect" | "timestamp_repair";
export type CalendarAvailabilityReconciliationCounts = { imported: number; updated: number; invalidated: number; deleted: number };

function formatLondon(date: Date) {
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
}

function auditDetails(input: Record<string, unknown>) {
  return JSON.stringify(input);
}

async function maintainAdminTask(input: {
  sourceId: string;
  currentTaskId: string | null;
  mediatorName: string;
  mediatorId: string;
  provider: Provider;
  reason: string;
  before: { startAt: Date; endAt: Date } | null;
  after: { startAt: Date; endAt: Date } | null;
  serviceNames: string[];
  appointmentConflictIds: string[];
  correlationId: string;
  externalSeriesId: string | null;
}) {
  const adminUsers = (await storage.listUsers()).filter(
    (user) => user.status === "active" && (user.role === "superadmin" || user.role === "subadmin"),
  );
  if (adminUsers.length === 0) return null;

  const urgency = input.appointmentConflictIds.length > 0 ? "red" : "amber";
  const title = `Calendar availability changed: ${input.mediatorName}`;
  const time = (value: { startAt: Date; endAt: Date } | null) => value
    ? `${formatLondon(value.startAt)} to ${formatLondon(value.endAt)}`
    : "Not available";
  const message = [
    `Provider: ${input.provider}.`,
    `Change: ${input.reason}.`,
    `Previous time: ${time(input.before)}.`,
    `New time: ${time(input.after)}.`,
    `Services: ${input.serviceNames.join(", ") || "None"}.`,
    input.appointmentConflictIds.length
      ? `Existing appointments were preserved: ${input.appointmentConflictIds.join(", ")}.`
      : "No existing appointment was changed.",
    `Reconciliation status: ${input.appointmentConflictIds.length ? "applied with appointment conflicts" : "applied safely"}.`,
    `Audit reference: ${input.correlationId}.`,
    `/mediators/${input.mediatorId}?tab=service_offering`,
  ].join(" ");

  let currentTaskId = input.currentTaskId;
  if (!currentTaskId && input.externalSeriesId) {
    const [seriesSource] = await db.select({ adminTaskId: mediatorCalendarAvailabilitySources.adminTaskId })
      .from(mediatorCalendarAvailabilitySources)
      .where(and(
        eq(mediatorCalendarAvailabilitySources.mediatorId, input.mediatorId),
        eq(mediatorCalendarAvailabilitySources.provider, input.provider),
        eq(mediatorCalendarAvailabilitySources.externalSeriesId, input.externalSeriesId),
      )).limit(1);
    currentTaskId = seriesSource?.adminTaskId ?? null;
  }
  if (currentTaskId) {
    const [existing] = await db.select().from(notifications).where(eq(notifications.id, currentTaskId)).limit(1);
    if (existing && !["completed", "archived"].includes(existing.status)) {
      const updatedAt = new Date();
      await db.update(notifications).set({ title, message, urgency, createdAt: updatedAt }).where(eq(notifications.id, existing.id));
      const links = await db.select({ taskId: notificationTaskLinks.taskId })
        .from(notificationTaskLinks)
        .where(eq(notificationTaskLinks.notificationId, existing.id));
      if (links.length) {
        await db.update(tasks).set({ title, message, urgency, updatedAt: new Date() })
          .where(inArray(tasks.id, links.map((link) => link.taskId)));
      }
      notificationRealtimeService.broadcastToNotificationAudience({
        ...existing,
        title,
        message,
        urgency,
        createdAt: updatedAt,
        assignedUserIds: adminUsers.map((user) => user.id),
      }, "notification_updated");
      return existing.id;
    }
  }

  const created = await notificationService.createNotification({
    recipientId: adminUsers[0].id,
    recipientRole: "task_assignee",
    assignedTo: adminUsers[0].id,
    assignedUserIds: adminUsers.map((user) => user.id),
    assignedBy: null,
    type: "calendar_availability_change",
    urgency,
    title,
    message,
    status: "active",
    caseNoteRequired: false,
  });
  const sourceFilter = input.externalSeriesId
    ? and(
        eq(mediatorCalendarAvailabilitySources.mediatorId, input.mediatorId),
        eq(mediatorCalendarAvailabilitySources.provider, input.provider),
        eq(mediatorCalendarAvailabilitySources.externalSeriesId, input.externalSeriesId),
      )
    : eq(mediatorCalendarAvailabilitySources.id, input.sourceId);
  await db.update(mediatorCalendarAvailabilitySources)
    .set({ adminTaskId: created.id, updatedAt: new Date() })
    .where(sourceFilter);
  return created.id;
}

async function approvedServicesForMediator(mediatorId: string) {
  const rows = await db.select({
    approval: mediatorServiceApprovals,
    serviceId: serviceTypes.id,
    serviceName: serviceTypes.name,
    serviceActive: serviceTypes.isActive,
  }).from(mediatorServiceApprovals)
    .innerJoin(serviceTypes, eq(serviceTypes.id, mediatorServiceApprovals.serviceTypeId))
    .where(eq(mediatorServiceApprovals.mediatorId, mediatorId));
  return rows.filter((row) => row.serviceActive && getEffectiveApprovalStatus(row.approval) === "approved");
}

function cachedCandidate(provider: Provider, event: typeof googleCalendarEvents.$inferSelect | typeof outlookCalendarEvents.$inferSelect): CalendarAvailabilityCandidate {
  return {
    provider,
    externalEventId: provider === "google"
      ? (event as typeof googleCalendarEvents.$inferSelect).googleEventId
      : (event as typeof outlookCalendarEvents.$inferSelect).outlookEventId,
    externalSeriesId: event.externalSeriesId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    organizerEmail: event.organizerEmail,
    attendees: event.attendees ?? [],
  };
}

export async function reconcileMediatorCalendarAvailability(
  mediatorId: string,
  provider: Provider,
  trigger: CalendarAvailabilityTrigger,
) {
  const mediator = await storage.getUser(mediatorId);
  const connectedEmail = provider === "google" ? mediator?.googleCalendarEmail : mediator?.outlookCalendarEmail;
  const connected = provider === "google" ? mediator?.googleCalendarConnected : mediator?.outlookCalendarConnected;
  if (!mediator || mediator.activeCalendarProvider !== provider || !connected || !connectedEmail) {
    return { imported: 0, updated: 0, invalidated: 0, deleted: 0 };
  }

  const cached = provider === "google"
    ? await db.select().from(googleCalendarEvents).where(eq(googleCalendarEvents.mediatorId, mediatorId))
    : await db.select().from(outlookCalendarEvents).where(eq(outlookCalendarEvents.mediatorId, mediatorId));
  const candidates = cached.map((event) => cachedCandidate(provider, event));
  const existingSources = await db.select().from(mediatorCalendarAvailabilitySources).where(and(
    eq(mediatorCalendarAvailabilitySources.mediatorId, mediatorId),
    eq(mediatorCalendarAvailabilitySources.provider, provider),
    eq(mediatorCalendarAvailabilitySources.origin, "mediator_invite"),
  ));
  const fixedSources = await db.select().from(mediatorCalendarAvailabilitySources).where(and(
    eq(mediatorCalendarAvailabilitySources.mediatorId, mediatorId),
    eq(mediatorCalendarAvailabilitySources.provider, provider),
    eq(mediatorCalendarAvailabilitySources.origin, "bfm_service"),
  ));
  const cachedEventIds = new Set(candidates.map((candidate) => candidate.externalEventId));
  for (const source of existingSources) {
    if (cachedEventIds.has(source.externalEventId)) continue;
    const authoritative = await getMediatorCalendarProviderService(provider)
      .getEventById(mediatorId, source.externalEventId)
      .catch(() => null);
    if (!authoritative) continue;
    candidates.push({
      provider,
      externalEventId: source.externalEventId,
      externalSeriesId: source.externalSeriesId,
      title: authoritative.summary,
      startAt: authoritative.start,
      endAt: authoritative.end,
      isAllDay: authoritative.isAllDay,
      organizerEmail: authoritative.organizerEmail,
      attendees: authoritative.attendees,
    });
  }
  const sourceByEventId = new Map(existingSources.map((source) => [source.externalEventId, source]));
  const candidateIds = new Set(candidates.map((candidate) => candidate.externalEventId));
  const approvedServices = await approvedServicesForMediator(mediatorId);
  const now = new Date();
  const counts: CalendarAvailabilityReconciliationCounts = { imported: 0, updated: 0, invalidated: 0, deleted: 0 };

  for (const candidate of candidates) {
    const recognition = recognizeCalendarAvailabilityEvent(candidate, { connectedEmail, now });
    const previous = sourceByEventId.get(candidate.externalEventId);
    if (!recognition.qualified) {
      if (!previous || !["active", "historical", "out_of_window", "sync_error"].includes(previous.state)) continue;
      counts.invalidated += 1;
      await invalidateSource(previous.id, "invalid", recognition.reason, trigger, mediator.name);
      continue;
    }

    const windows = buildCalendarAvailabilityWindows(candidate, now);
    const activeWindows = windows.filter((window) => window.state === "active");
    const sourceState = activeWindows.length > 0
      ? "active"
      : windows.some((window) => window.state === "historical")
        ? "historical"
        : "out_of_window";
    if (!previous && sourceState === "out_of_window") continue;
    const fingerprint = buildAvailabilityFingerprint(candidate);
    const expectedEcho = !!previous?.expectedProviderFingerprint && previous.expectedProviderFingerprint === fingerprint;
    const providerChanged = !!previous && previous.providerFingerprint !== fingerprint && !expectedEcho;
    const lifecycleChanged = !!previous && previous.state !== sourceState;
    const { source, activeAppointments, slotPlan } = await db.transaction(async (tx) => {
      const [source] = await tx.insert(mediatorCalendarAvailabilitySources).values({
        mediatorId,
        provider,
        externalEventId: candidate.externalEventId,
        externalSeriesId: candidate.externalSeriesId,
        origin: "mediator_invite",
        scopeMode: "all_approved_services",
        title: candidate.title,
        isAllDay: candidate.isAllDay,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        providerFingerprint: fingerprint,
        state: sourceState,
        lastSeenAt: now,
        invalidatedAt: null,
        deletedAt: null,
        historicalAt: sourceState === "historical" ? now : null,
        outOfWindowAt: sourceState === "out_of_window" ? now : null,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [mediatorCalendarAvailabilitySources.mediatorId, mediatorCalendarAvailabilitySources.provider, mediatorCalendarAvailabilitySources.externalEventId],
        set: {
          externalSeriesId: candidate.externalSeriesId,
          title: candidate.title,
          isAllDay: candidate.isAllDay,
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          providerFingerprint: fingerprint,
          expectedProviderFingerprint: null,
          state: sourceState,
          lastSeenAt: now,
          invalidatedAt: null,
          deletedAt: null,
          historicalAt: sourceState === "historical" ? (previous?.historicalAt ?? now) : null,
          outOfWindowAt: sourceState === "out_of_window" ? (previous?.outOfWindowAt ?? now) : null,
          updatedAt: now,
        },
      }).returning();
      const activeSlots = await tx.select().from(mediatorServiceScheduleSlots).where(and(
        eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id),
        eq(mediatorServiceScheduleSlots.lifecycle, "active"),
      ));
      const activeAppointments = await tx.select({
        id: appointments.id,
        serviceTypeId: appointments.serviceTypeId,
        dateTime: appointments.dateTime,
        duration: appointments.duration,
      })
        .from(appointments)
        .where(and(
          eq(appointments.mediatorId, source.mediatorId),
          or(
            eq(appointments.availabilitySourceId, source.id),
            eq(appointments.parentGoogleEventId, source.externalEventId),
          ),
          ne(appointments.status, "cancelled"),
          ne(appointments.status, "expired"),
        ));
      const desired = activeWindows.flatMap((window) => approvedServices.map((service) => ({
        serviceTypeId: service.serviceId,
        startAt: window.startAt,
        endAt: window.endAt,
      })));
      const key = (value: { serviceTypeId: string; startAt: Date; endAt: Date }) =>
        `${value.serviceTypeId}:${value.startAt.toISOString()}:${value.endAt.toISOString()}`;
      const desiredKeys = new Set(desired.map(key));
      const existingKeys = new Set(activeSlots.map(key));
      const obsolete = activeSlots.filter((slot) => !desiredKeys.has(key(slot)));
      const slotIsBooked = (slot: typeof activeSlots[number]) => activeAppointments.some((appointment) => {
        if (appointment.serviceTypeId && appointment.serviceTypeId !== slot.serviceTypeId) return false;
        const appointmentStart = new Date(appointment.dateTime);
        const appointmentEnd = new Date(appointmentStart.getTime() + appointment.duration * 60_000);
        return appointmentStart < slot.endAt && slot.startAt < appointmentEnd;
      });
      const retireIds = obsolete.filter(slotIsBooked).map((slot) => slot.id);
      const deleteIds = obsolete.filter((slot) => !retireIds.includes(slot.id)).map((slot) => slot.id);
      if (retireIds.length) {
        await tx.update(mediatorServiceScheduleSlots).set({
          lifecycle: "retired",
          retiredReason: sourceState === "historical" ? "availability_elapsed" : sourceState === "out_of_window" ? "outside_import_window" : "availability_changed",
          retiredAt: now,
          updatedAt: now,
        }).where(inArray(mediatorServiceScheduleSlots.id, retireIds));
      }
      if (deleteIds.length) await tx.delete(mediatorServiceScheduleSlots).where(inArray(mediatorServiceScheduleSlots.id, deleteIds));
      const missing = desired.filter((window) => !existingKeys.has(key(window)));
      if (missing.length) {
        await tx.insert(mediatorServiceScheduleSlots).values(missing.map((window) => ({
          mediatorId,
          serviceTypeId: window.serviceTypeId,
          startAt: window.startAt,
          endAt: window.endAt,
          googleEventId: candidate.externalEventId,
          calendarProvider: provider,
          availabilitySourceId: source.id,
          lifecycle: "active",
        }))).onConflictDoNothing();
      }
      const plan = {
        createServiceIds: Array.from(new Set(missing.map((item) => item.serviceTypeId))).sort(),
        retainServiceIds: Array.from(new Set(activeSlots.filter((slot) => desiredKeys.has(key(slot))).map((slot) => slot.serviceTypeId))).sort(),
        deleteServiceIds: Array.from(new Set(obsolete.filter((slot) => deleteIds.includes(slot.id)).map((slot) => slot.serviceTypeId))).sort(),
        retireServiceIds: Array.from(new Set(obsolete.filter((slot) => retireIds.includes(slot.id)).map((slot) => slot.serviceTypeId))).sort(),
        changedSlotCount: missing.length + deleteIds.length + retireIds.length,
      };
      return { source, activeAppointments, slotPlan: plan };
    });

    if (!previous) counts.imported += 1;
    if (providerChanged || lifecycleChanged || slotPlan.changedSlotCount > 0) counts.updated += 1;
    const correlationId = source.auditCorrelationId || randomUUID();
    const slotPlanChanged = slotPlan.changedSlotCount > 0;
    const auditAction = !previous
      ? "calendar_availability_initial_import"
      : providerChanged
        ? trigger === "timestamp_repair"
          ? "calendar_availability_timestamp_normalized"
          : "calendar_availability_provider_update"
        : lifecycleChanged
          ? sourceState === "historical" ? "calendar_availability_natural_expiry" : "calendar_availability_window_transition"
        : slotPlanChanged
          ? trigger === "service_approval" ? "calendar_availability_service_approval_reconciliation" : "calendar_availability_slot_reconciled"
          : null;
    if (auditAction) {
      await logAudit({
        action: auditAction,
        entity: "mediator_calendar_availability_source",
        entityId: source.id,
        entityRef: candidate.externalSeriesId ?? candidate.externalEventId,
        details: auditDetails({
          correlationId, trigger, provider, externalEventId: candidate.externalEventId,
          externalSeriesId: candidate.externalSeriesId,
          before: previous ? { startAt: previous.startAt, endAt: previous.endAt, fingerprint: previous.providerFingerprint } : null,
          after: { startAt: candidate.startAt, endAt: candidate.endAt, fingerprint },
          affectedServices: approvedServices.map((service) => service.serviceName),
          slotPlan,
          appointmentConflicts: activeAppointments.map((appointment) => appointment.id),
        }),
      });
    }
    if (providerChanged && trigger !== "timestamp_repair" && (previous?.state === "active" || sourceState === "active")) {
      await maintainAdminTask({
        sourceId: source.id,
        currentTaskId: source.adminTaskId,
        mediatorName: mediator.name,
        mediatorId,
        provider,
        reason: previous?.state !== "active"
          ? "calendar availability became valid again"
          : "time changed in the connected calendar",
        before: previous ? { startAt: previous.startAt, endAt: previous.endAt } : null,
        after: { startAt: candidate.startAt, endAt: candidate.endAt },
        serviceNames: approvedServices.map((service) => service.serviceName),
        appointmentConflictIds: activeAppointments.map((appointment) => appointment.id),
        correlationId,
        externalSeriesId: source.externalSeriesId,
      });
    }
  }

  for (const source of existingSources) {
    if (["deleted", "invalid"].includes(source.state) || candidateIds.has(source.externalEventId)) continue;
    counts.deleted += 1;
    await invalidateSource(source.id, "deleted", "event_deleted", trigger, mediator.name);
  }
  for (const source of fixedSources) {
    if ((source.state === "deleted" || source.state === "invalid") || source.endAt <= now) continue;
    let candidate = candidates.find((item) => item.externalEventId === source.externalEventId) ?? null;
    if (!candidate) {
      const event = await getMediatorCalendarProviderService(provider).getEventById(mediatorId, source.externalEventId).catch(() => null);
      if (event) {
        candidate = {
          provider,
          externalEventId: event.id,
          externalSeriesId: source.externalSeriesId,
          title: event.summary,
          startAt: event.start,
          endAt: event.end,
          isAllDay: false,
          organizerEmail: event.organizerEmail,
          attendees: event.attendees,
        };
      }
    }
    if (!candidate) {
      counts.deleted += 1;
      await invalidateSource(source.id, "deleted", "bfm_event_deleted_externally", trigger, mediator.name);
      continue;
    }
    const fingerprint = buildAvailabilityFingerprint(candidate);
    const expectedEcho = source.expectedProviderFingerprint === fingerprint;
    const backfillBaseline = source.providerFingerprint.startsWith("legacy_backfill:");
    if (fingerprint === source.providerFingerprint) {
      if (source.state === "sync_error") {
        await db.update(mediatorCalendarAvailabilitySources).set({ state: "active", lastSeenAt: now, updatedAt: now })
          .where(eq(mediatorCalendarAvailabilitySources.id, source.id));
        await logAudit({
          action: "calendar_availability_reconciliation_recovered",
          entity: "mediator_calendar_availability_source",
          entityId: source.id,
          details: auditDetails({ correlationId: source.auditCorrelationId, trigger, provider, externalEventId: source.externalEventId }),
        });
      }
      continue;
    }
    const slots = await db.select({
      id: mediatorServiceScheduleSlots.id,
      serviceTypeId: mediatorServiceScheduleSlots.serviceTypeId,
      startAt: mediatorServiceScheduleSlots.startAt,
      endAt: mediatorServiceScheduleSlots.endAt,
      name: serviceTypes.name,
    })
      .from(mediatorServiceScheduleSlots)
      .innerJoin(serviceTypes, eq(serviceTypes.id, mediatorServiceScheduleSlots.serviceTypeId))
      .where(and(eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id), eq(mediatorServiceScheduleSlots.lifecycle, "active")));
    const conflicts = await db.select({
      id: appointments.id,
      serviceTypeId: appointments.serviceTypeId,
      dateTime: appointments.dateTime,
      duration: appointments.duration,
    }).from(appointments).where(and(
      eq(appointments.mediatorId, source.mediatorId),
      or(
        eq(appointments.availabilitySourceId, source.id),
        eq(appointments.parentGoogleEventId, source.externalEventId),
      ),
      ne(appointments.status, "cancelled"),
      ne(appointments.status, "expired"),
    ));
    const timestampRepairBookedSlots = trigger === "timestamp_repair"
      ? slots.filter((slot) => conflicts.some((appointment) => {
        if (appointment.serviceTypeId && appointment.serviceTypeId !== slot.serviceTypeId) return false;
        const appointmentStart = new Date(appointment.dateTime);
        const appointmentEnd = new Date(appointmentStart.getTime() + appointment.duration * 60_000);
        return appointmentStart < slot.endAt && slot.startAt < appointmentEnd;
      }))
      : [];
    const timestampRepairUnbookedSlotIds = slots
      .filter((slot) => !timestampRepairBookedSlots.some((booked) => booked.id === slot.id))
      .map((slot) => slot.id);
    await db.transaction(async (tx) => {
      await tx.update(mediatorCalendarAvailabilitySources).set({ title: candidate!.title, startAt: candidate!.startAt, endAt: candidate!.endAt, providerFingerprint: fingerprint, expectedProviderFingerprint: null, state: "active", lastSeenAt: now, updatedAt: now }).where(eq(mediatorCalendarAvailabilitySources.id, source.id));
      if (trigger !== "timestamp_repair") {
        await tx.update(mediatorServiceScheduleSlots).set({ startAt: candidate!.startAt, endAt: candidate!.endAt, updatedAt: now }).where(and(eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id), eq(mediatorServiceScheduleSlots.lifecycle, "active")));
        return;
      }
      if (timestampRepairUnbookedSlotIds.length) {
        await tx.update(mediatorServiceScheduleSlots).set({ startAt: candidate!.startAt, endAt: candidate!.endAt, updatedAt: now })
          .where(inArray(mediatorServiceScheduleSlots.id, timestampRepairUnbookedSlotIds));
      }
      if (timestampRepairBookedSlots.length) {
        await tx.update(mediatorServiceScheduleSlots).set({
          lifecycle: "retired",
          retiredReason: "timestamp_repair",
          retiredAt: now,
          updatedAt: now,
        }).where(inArray(mediatorServiceScheduleSlots.id, timestampRepairBookedSlots.map((slot) => slot.id)));
        await tx.insert(mediatorServiceScheduleSlots).values(timestampRepairBookedSlots.map((slot) => ({
          mediatorId,
          serviceTypeId: slot.serviceTypeId,
          startAt: candidate!.startAt,
          endAt: candidate!.endAt,
          googleEventId: candidate!.externalEventId,
          calendarProvider: provider,
          availabilitySourceId: source.id,
          lifecycle: "active",
        }))).onConflictDoNothing();
      }
    });
    counts.updated += 1;
    await logAudit({ action: trigger === "timestamp_repair" ? "calendar_availability_timestamp_normalized" : backfillBaseline ? "calendar_availability_backfill_confirmed" : expectedEcho ? "calendar_availability_bfm_originated_update" : "calendar_availability_provider_update", entity: "mediator_calendar_availability_source", entityId: source.id, entityRef: source.externalSeriesId ?? source.externalEventId, details: auditDetails({ correlationId: source.auditCorrelationId, trigger, provider, before: { startAt: source.startAt, endAt: source.endAt }, after: { startAt: candidate.startAt, endAt: candidate.endAt }, affectedServices: slots.map((slot) => slot.name), appointmentConflicts: conflicts.map((row) => row.id) }) });
    if (trigger !== "timestamp_repair" && !expectedEcho && !backfillBaseline) {
      await maintainAdminTask({ sourceId: source.id, currentTaskId: source.adminTaskId, mediatorName: mediator.name, mediatorId, provider, reason: "BFM-created event changed in the connected calendar", before: { startAt: source.startAt, endAt: source.endAt }, after: { startAt: candidate.startAt, endAt: candidate.endAt }, serviceNames: slots.map((slot) => slot.name), appointmentConflictIds: conflicts.map((row) => row.id), correlationId: source.auditCorrelationId, externalSeriesId: source.externalSeriesId });
    }
  }
  return counts;
}

async function invalidateSource(
  sourceId: string,
  state: "invalid" | "deleted",
  reason: string,
  trigger: CalendarAvailabilityTrigger,
  mediatorName: string,
) {
  const [source] = await db.select().from(mediatorCalendarAvailabilitySources).where(eq(mediatorCalendarAvailabilitySources.id, sourceId)).limit(1);
  if (!source) return;
  const now = new Date();
  const serviceRows = await db.select({ id: mediatorServiceScheduleSlots.id, serviceTypeId: mediatorServiceScheduleSlots.serviceTypeId, name: serviceTypes.name })
    .from(mediatorServiceScheduleSlots)
    .innerJoin(serviceTypes, eq(serviceTypes.id, mediatorServiceScheduleSlots.serviceTypeId))
    .where(and(eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id), eq(mediatorServiceScheduleSlots.lifecycle, "active")));
  const activeAppointments = await db.select({ id: appointments.id, serviceTypeId: appointments.serviceTypeId })
    .from(appointments)
    .where(and(
      eq(appointments.mediatorId, source.mediatorId),
      or(
        eq(appointments.availabilitySourceId, source.id),
        eq(appointments.parentGoogleEventId, source.externalEventId),
      ),
      ne(appointments.status, "cancelled"),
      ne(appointments.status, "expired"),
    ));
  const bookedServiceIds = new Set(activeAppointments.flatMap((appointment) => appointment.serviceTypeId ? [appointment.serviceTypeId] : []));
  const bookedRowIds = activeAppointments.length > 0 && bookedServiceIds.size === 0
    ? serviceRows.map((row) => row.id)
    : serviceRows.filter((row) => bookedServiceIds.has(row.serviceTypeId)).map((row) => row.id);
  const unbookedRowIds = serviceRows.filter((row) => !bookedRowIds.includes(row.id)).map((row) => row.id);

  await db.transaction(async (tx) => {
    await tx.update(mediatorCalendarAvailabilitySources).set({
      state,
      invalidatedAt: state === "invalid" ? now : source.invalidatedAt,
      deletedAt: state === "deleted" ? now : source.deletedAt,
      updatedAt: now,
    }).where(eq(mediatorCalendarAvailabilitySources.id, source.id));
    if (bookedRowIds.length) {
      await tx.update(mediatorServiceScheduleSlots).set({ lifecycle: "retired", retiredReason: reason, retiredAt: now, updatedAt: now })
        .where(inArray(mediatorServiceScheduleSlots.id, bookedRowIds));
    }
    if (unbookedRowIds.length) {
      await tx.delete(mediatorServiceScheduleSlots).where(inArray(mediatorServiceScheduleSlots.id, unbookedRowIds));
    }
  });

  await logAudit({
    action: state === "deleted" ? "calendar_availability_provider_deletion" : "calendar_availability_invalidated",
    entity: "mediator_calendar_availability_source",
    entityId: source.id,
    entityRef: source.externalSeriesId ?? source.externalEventId,
    details: auditDetails({ correlationId: source.auditCorrelationId, trigger, provider: source.provider, reason, before: { startAt: source.startAt, endAt: source.endAt }, affectedServices: serviceRows.map((row) => row.name), appointmentConflicts: activeAppointments.map((appointment) => appointment.id) }),
  });
  if (source.state === "active" || source.state === "sync_error" || activeAppointments.length > 0) {
    await maintainAdminTask({
      sourceId: source.id,
      currentTaskId: source.adminTaskId,
      mediatorName,
      mediatorId: source.mediatorId,
      provider: source.provider as Provider,
      reason,
      before: { startAt: source.startAt, endAt: source.endAt },
      after: null,
      serviceNames: serviceRows.map((row) => row.name),
      appointmentConflictIds: activeAppointments.map((appointment) => appointment.id),
      correlationId: source.auditCorrelationId,
      externalSeriesId: source.externalSeriesId,
    });
  }
}

export async function reconcileServiceApprovalsForCalendarAvailability(mediatorId: string) {
  const providers: Provider[] = ["google", "outlook"];
  return Promise.all(providers.map((provider) => reconcileMediatorCalendarAvailability(mediatorId, provider, "service_approval")));
}

export async function deactivateImportedCalendarAvailabilityForDisconnect(mediatorId: string, provider: Provider) {
  const mediator = await storage.getUser(mediatorId);
  if (!mediator) return { invalidated: 0 };
  const sources = await db.select({ id: mediatorCalendarAvailabilitySources.id })
    .from(mediatorCalendarAvailabilitySources)
    .where(and(
      eq(mediatorCalendarAvailabilitySources.mediatorId, mediatorId),
      eq(mediatorCalendarAvailabilitySources.provider, provider),
      eq(mediatorCalendarAvailabilitySources.origin, "mediator_invite"),
      eq(mediatorCalendarAvailabilitySources.state, "active"),
    ));
  for (const source of sources) {
    await invalidateSource(source.id, "invalid", "provider_disconnected", "disconnect", mediator.name);
  }
  return { invalidated: sources.length };
}
