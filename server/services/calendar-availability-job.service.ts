import { and, asc, eq, inArray, lte, ne, or } from "drizzle-orm";
import { appointments, calendarAvailabilityReconciliationJobs, mediatorCalendarAvailabilitySources, mediatorServiceScheduleSlots } from "@shared/schema";
import { db } from "../db";
import { googleCalendarService } from "./google-calendar.service";
import { outlookCalendarService } from "./outlook-calendar.service";
import { logAudit } from "./audit-log.service";
import { getCalendarReconciliationRetryDelayMs } from "./calendar-availability-webhook";
import { storage } from "../storage";
import { notificationService } from "./notification.service";
import { getMediatorCalendarProviderService, isCalendarProvider } from "./mediator-calendar-provider.service";

type Provider = "google" | "outlook";

async function processPersistedMutation(job: typeof calendarAvailabilityReconciliationJobs.$inferSelect): Promise<boolean> {
  const operation = job.payload?.operation;
  const sourceId = typeof job.payload?.sourceId === "string" ? job.payload.sourceId : null;
  if ((operation !== "patch" && operation !== "delete") || !sourceId) return false;
  const [source] = await db.select().from(mediatorCalendarAvailabilitySources)
    .where(eq(mediatorCalendarAvailabilitySources.id, sourceId)).limit(1);
  if (!source || !isCalendarProvider(source.provider)) return true;
  const calendar = getMediatorCalendarProviderService(source.provider);
  if (operation === "patch") {
    const startAt = new Date(String(job.payload?.startAt));
    const endAt = new Date(String(job.payload?.endAt));
    const expectedFingerprint = typeof job.payload?.expectedFingerprint === "string" ? job.payload.expectedFingerprint : null;
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt || !expectedFingerprint) {
      throw new Error("Persisted calendar availability update is invalid");
    }
    await calendar.patchEvent(source.mediatorId, source.externalEventId, {
      start: startAt,
      end: endAt,
      ...(typeof job.payload?.summary === "string" ? { summary: job.payload.summary } : {}),
      ...(typeof job.payload?.description === "string" ? { description: job.payload.description } : {}),
    });
    await db.transaction(async (tx) => {
      await tx.update(mediatorCalendarAvailabilitySources).set({
        title: typeof job.payload?.summary === "string" ? job.payload.summary : source.title,
        isAllDay: false,
        startAt,
        endAt,
        providerFingerprint: expectedFingerprint,
        expectedProviderFingerprint: null,
        state: "active",
        historicalAt: null,
        outOfWindowAt: null,
        updatedAt: new Date(),
      }).where(eq(mediatorCalendarAvailabilitySources.id, source.id));
      if (!source.isAllDay) {
        await tx.update(mediatorServiceScheduleSlots).set({ startAt, endAt, updatedAt: new Date() }).where(and(eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id), eq(mediatorServiceScheduleSlots.lifecycle, "active")));
        return;
      }
      const now = new Date();
      const slots = await tx.select().from(mediatorServiceScheduleSlots).where(and(
        eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id),
        eq(mediatorServiceScheduleSlots.lifecycle, "active"),
      ));
      const conflicts = await tx.select({ dateTime: appointments.dateTime, duration: appointments.duration }).from(appointments).where(and(
        eq(appointments.availabilitySourceId, source.id),
        ne(appointments.status, "cancelled"),
        ne(appointments.status, "expired"),
      ));
      const bookedIds = slots.filter((slot) => conflicts.some((appointment) => {
        const appointmentStart = new Date(appointment.dateTime);
        const appointmentEnd = new Date(appointmentStart.getTime() + appointment.duration * 60_000);
        return appointmentStart < slot.endAt && slot.startAt < appointmentEnd;
      })).map((slot) => slot.id);
      const deleteIds = slots.filter((slot) => !bookedIds.includes(slot.id)).map((slot) => slot.id);
      if (bookedIds.length) await tx.update(mediatorServiceScheduleSlots).set({ lifecycle: "retired", retiredReason: "bfm_all_day_converted_to_timed", retiredAt: now, updatedAt: now }).where(inArray(mediatorServiceScheduleSlots.id, bookedIds));
      if (deleteIds.length) await tx.delete(mediatorServiceScheduleSlots).where(inArray(mediatorServiceScheduleSlots.id, deleteIds));
      const serviceTypeIds = Array.from(new Set(slots.map((slot) => slot.serviceTypeId)));
      if (serviceTypeIds.length) await tx.insert(mediatorServiceScheduleSlots).values(serviceTypeIds.map((serviceTypeId) => ({
        mediatorId: source.mediatorId,
        serviceTypeId,
        startAt,
        endAt,
        googleEventId: source.externalEventId,
        calendarProvider: source.provider,
        availabilitySourceId: source.id,
        lifecycle: "active",
      }))).onConflictDoNothing();
    });
  } else {
    await calendar.deleteEvent(source.mediatorId, source.externalEventId);
    const conflicts = await db.select({ id: appointments.id, serviceTypeId: appointments.serviceTypeId }).from(appointments).where(and(
      eq(appointments.mediatorId, source.mediatorId),
      or(
        eq(appointments.availabilitySourceId, source.id),
        eq(appointments.parentGoogleEventId, source.externalEventId),
      ),
      ne(appointments.status, "cancelled"),
      ne(appointments.status, "expired"),
    ));
    const linkedSlots = await db.select({ id: mediatorServiceScheduleSlots.id, serviceTypeId: mediatorServiceScheduleSlots.serviceTypeId })
      .from(mediatorServiceScheduleSlots)
      .where(and(
        eq(mediatorServiceScheduleSlots.availabilitySourceId, source.id),
        eq(mediatorServiceScheduleSlots.lifecycle, "active"),
      ));
    const bookedServiceIds = new Set(conflicts.flatMap((appointment) => appointment.serviceTypeId ? [appointment.serviceTypeId] : []));
    const bookedRowIds = conflicts.length > 0 && bookedServiceIds.size === 0
      ? linkedSlots.map((slot) => slot.id)
      : linkedSlots.filter((slot) => bookedServiceIds.has(slot.serviceTypeId)).map((slot) => slot.id);
    const unbookedRowIds = linkedSlots.filter((slot) => !bookedRowIds.includes(slot.id)).map((slot) => slot.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(mediatorCalendarAvailabilitySources).set({ state: "deleted", deletedAt: now, expectedProviderFingerprint: null, updatedAt: now }).where(eq(mediatorCalendarAvailabilitySources.id, source.id));
      if (bookedRowIds.length) await tx.update(mediatorServiceScheduleSlots).set({ lifecycle: "retired", retiredReason: "bfm_deleted", retiredAt: now, updatedAt: now }).where(inArray(mediatorServiceScheduleSlots.id, bookedRowIds));
      if (unbookedRowIds.length) await tx.delete(mediatorServiceScheduleSlots).where(inArray(mediatorServiceScheduleSlots.id, unbookedRowIds));
    });
  }
  await logAudit({ action: operation === "patch" ? "calendar_availability_bfm_originated_update" : "calendar_availability_bfm_originated_deletion", entity: "mediator_calendar_availability_source", entityId: source.id, details: JSON.stringify({ trigger: "mutation_retry", provider: source.provider, operation, correlationId: source.auditCorrelationId }) });
  return true;
}

export async function enqueueCalendarAvailabilityReconciliation(input: {
  mediatorId: string;
  provider: Provider;
  trigger: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
  nextAttemptAt?: Date;
}) {
  const existing = await db.select({ id: calendarAvailabilityReconciliationJobs.id, status: calendarAvailabilityReconciliationJobs.status })
    .from(calendarAvailabilityReconciliationJobs)
    .where(and(
      eq(calendarAvailabilityReconciliationJobs.mediatorId, input.mediatorId),
      eq(calendarAvailabilityReconciliationJobs.provider, input.provider),
      eq(calendarAvailabilityReconciliationJobs.dedupeKey, input.dedupeKey),
      inArray(calendarAvailabilityReconciliationJobs.status, ["pending", "processing"]),
    )).limit(1);
  if (existing[0]) {
    if (input.trigger === "bfm_mutation_retry" && existing[0].status === "pending") {
      const [updated] = await db.update(calendarAvailabilityReconciliationJobs).set({
        payload: input.payload ?? null,
        nextAttemptAt: input.nextAttemptAt ?? new Date(),
        attemptCount: 0,
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(calendarAvailabilityReconciliationJobs.id, existing[0].id)).returning({ id: calendarAvailabilityReconciliationJobs.id });
      return updated ?? existing[0];
    }
    return existing[0];
  }
  const [created] = await db.insert(calendarAvailabilityReconciliationJobs).values({
    mediatorId: input.mediatorId,
    provider: input.provider,
    trigger: input.trigger,
    dedupeKey: input.dedupeKey,
    payload: input.payload ?? null,
    nextAttemptAt: input.nextAttemptAt ?? new Date(),
  }).onConflictDoNothing().returning({ id: calendarAvailabilityReconciliationJobs.id });
  if (created) return created;
  const [raced] = await db.select({ id: calendarAvailabilityReconciliationJobs.id })
    .from(calendarAvailabilityReconciliationJobs)
    .where(and(
      eq(calendarAvailabilityReconciliationJobs.mediatorId, input.mediatorId),
      eq(calendarAvailabilityReconciliationJobs.provider, input.provider),
      eq(calendarAvailabilityReconciliationJobs.dedupeKey, input.dedupeKey),
      inArray(calendarAvailabilityReconciliationJobs.status, ["pending", "processing"]),
    )).limit(1);
  return raced;
}

export async function completeCalendarAvailabilityReconciliationJob(id: string | undefined) {
  if (!id) return;
  await db.update(calendarAvailabilityReconciliationJobs).set({
    status: "completed",
    completedAt: new Date(),
    processingLeaseExpiresAt: null,
    lastError: null,
    updatedAt: new Date(),
  }).where(eq(calendarAvailabilityReconciliationJobs.id, id));
}

export async function processCalendarAvailabilityReconciliationJobs(limit = 5) {
  const now = new Date();
  const due = await db.select().from(calendarAvailabilityReconciliationJobs)
    .where(and(
      inArray(calendarAvailabilityReconciliationJobs.status, ["pending", "processing"]),
      lte(calendarAvailabilityReconciliationJobs.nextAttemptAt, now),
      or(
        eq(calendarAvailabilityReconciliationJobs.status, "pending"),
        lte(calendarAvailabilityReconciliationJobs.processingLeaseExpiresAt, now),
      ),
    ))
    .orderBy(asc(calendarAvailabilityReconciliationJobs.nextAttemptAt))
    .limit(limit);

  for (const candidate of due) {
    const leaseUntil = new Date(Date.now() + 2 * 60_000);
    const [job] = await db.update(calendarAvailabilityReconciliationJobs).set({
      status: "processing",
      processingLeaseExpiresAt: leaseUntil,
      lastAttemptAt: now,
      attemptCount: candidate.attemptCount + 1,
      updatedAt: now,
    }).where(and(
      eq(calendarAvailabilityReconciliationJobs.id, candidate.id),
      or(
        eq(calendarAvailabilityReconciliationJobs.status, "pending"),
        lte(calendarAvailabilityReconciliationJobs.processingLeaseExpiresAt, now),
      ),
    )).returning();
    if (!job) continue;

    try {
      const mutationProcessed = await processPersistedMutation(job);
      if (!mutationProcessed) {
        if (job.provider === "outlook") await outlookCalendarService.syncCalendar(job.mediatorId);
        else await googleCalendarService.syncCalendar(job.mediatorId);
      }
      await db.update(calendarAvailabilityReconciliationJobs).set({
        status: "completed",
        processingLeaseExpiresAt: null,
        completedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(calendarAvailabilityReconciliationJobs.id, job.id));
    } catch (error) {
      const exhausted = job.attemptCount >= 8;
      const message = error instanceof Error ? error.message : String(error);
      await db.update(calendarAvailabilityReconciliationJobs).set({
        status: exhausted ? "failed" : "pending",
        processingLeaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + getCalendarReconciliationRetryDelayMs(job.attemptCount)),
        lastError: message.slice(0, 2000),
        updatedAt: new Date(),
      }).where(eq(calendarAvailabilityReconciliationJobs.id, job.id));
      if (exhausted) {
        await db.update(mediatorCalendarAvailabilitySources).set({ state: "sync_error", updatedAt: new Date() }).where(and(
          eq(mediatorCalendarAvailabilitySources.mediatorId, job.mediatorId),
          eq(mediatorCalendarAvailabilitySources.provider, job.provider),
          eq(mediatorCalendarAvailabilitySources.state, "active"),
        ));
        await logAudit({
          action: "calendar_availability_reconciliation_failure",
          entity: "calendar_availability_reconciliation_job",
          entityId: job.id,
          details: JSON.stringify({ provider: job.provider, mediatorId: job.mediatorId, trigger: job.trigger, attempts: job.attemptCount, error: message }),
        });
        const admins = (await storage.listUsers()).filter((user) =>
          user.status === "active" && (user.role === "superadmin" || user.role === "subadmin"),
        );
        if (admins.length) {
          await notificationService.createNotification({
            recipientId: admins[0].id,
            recipientRole: "task_assignee",
            assignedTo: admins[0].id,
            assignedUserIds: admins.map((admin) => admin.id),
            assignedBy: null,
            type: "calendar_availability_sync_error",
            urgency: "red",
            title: "Calendar availability needs attention",
            message: `BFM could not reconcile ${job.provider} availability after ${job.attemptCount} attempts. Mediator ID: ${job.mediatorId}. Error: ${message}. /mediators/${job.mediatorId}?tab=service_offering`,
            status: "active",
            caseNoteRequired: false,
          }).catch(() => undefined);
        }
      }
    }
  }
  return { processed: due.length };
}
