import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { appointmentCalendarSyncJobs, appointments, notifications, type AppointmentCalendarSyncJob } from "@shared/schema";
import { db } from "../db";
import { logger } from "../logger";
import { appointmentService } from "./appointment.service";
import { notificationService } from "./notification.service";
import { getNextCalendarSyncAttemptAt } from "./appointment-calendar-sync-rules";

export type PublicCalendarSyncStatus = "pending" | "processing" | "succeeded" | "failed" | "skipped";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;

function errorCodeFor(message: string): string {
  if (/invalid_grant|needs.?reauth|unauthori[sz]ed|expired token/i.test(message)) return "needs_reauth";
  if (/write scope|Calendars\.ReadWrite|insufficient permission/i.test(message)) return "needs_write_scope";
  if (/not connected/i.test(message)) return "not_connected";
  if (/not found|404|410/i.test(message)) return "event_not_found";
  return "provider_error";
}

function failureStageFor(appointment: {
  parentGoogleEventId: string | null;
  googleBookingEventId: string | null;
  googleClientEventId: string | null;
}): "mediator_calendar" | "bfm_client_calendar" {
  return appointment.parentGoogleEventId && !appointment.googleBookingEventId
    ? "mediator_calendar"
    : "bfm_client_calendar";
}

export class AppointmentCalendarSyncService {
  async getJob(appointmentId: string): Promise<AppointmentCalendarSyncJob | undefined> {
    const [job] = await db.select().from(appointmentCalendarSyncJobs)
      .where(eq(appointmentCalendarSyncJobs.appointmentId, appointmentId))
      .limit(1);
    return job;
  }

  async getPublicStatus(appointmentId: string): Promise<PublicCalendarSyncStatus | null> {
    const job = await this.getJob(appointmentId);
    return (job?.status as PublicCalendarSyncStatus | undefined) ?? null;
  }

  scheduleImmediate(appointmentId: string): void {
    void this.processAppointment(appointmentId, true).catch((error) => {
      logger.error("Immediate appointment calendar sync failed unexpectedly", error, "appointment-calendar-sync");
    });
  }

  async processAppointment(appointmentId: string, force = false): Promise<AppointmentCalendarSyncJob | undefined> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS);
    const eligibility = force
      ? or(
          inArray(appointmentCalendarSyncJobs.status, ["pending", "failed"]),
          and(eq(appointmentCalendarSyncJobs.status, "processing"), lte(appointmentCalendarSyncJobs.processingLeaseExpiresAt, now)),
        )
      : or(
          and(eq(appointmentCalendarSyncJobs.status, "pending"), lte(appointmentCalendarSyncJobs.nextAttemptAt, now)),
          and(eq(appointmentCalendarSyncJobs.status, "processing"), lte(appointmentCalendarSyncJobs.processingLeaseExpiresAt, now)),
        );
    const [claimed] = await db.update(appointmentCalendarSyncJobs).set({
      status: "processing",
      processingLeaseExpiresAt: leaseExpiresAt,
      lastAttemptAt: now,
      updatedAt: now,
    }).where(and(eq(appointmentCalendarSyncJobs.appointmentId, appointmentId), eligibility)).returning();
    if (!claimed) return this.getJob(appointmentId);

    const appointment = await appointmentService.getById(appointmentId);
    if (!appointment || appointment.status !== "confirmed" || appointment.paymentStatus !== "paid") {
      return this.finishSkipped(claimed, "Appointment is no longer an eligible paid confirmation");
    }

    const appointmentEnd = new Date(new Date(appointment.dateTime).getTime() + appointment.duration * 60_000);
    if (appointmentEnd.getTime() <= now.getTime()) {
      return this.finishSkipped(claimed, "Appointment ended before calendar synchronization completed");
    }

    const result = await appointmentService.ensureCalendarArtifactsForConfirmation(appointment, {
      preserveSuccessfulMediatorLeg: true,
    });
    if (result.ok) {
      const [succeeded] = await db.update(appointmentCalendarSyncJobs).set({
        status: "succeeded",
        attemptCount: claimed.attemptCount + 1,
        processingLeaseExpiresAt: null,
        completedAt: new Date(),
        failureStage: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      }).where(eq(appointmentCalendarSyncJobs.id, claimed.id)).returning();
      return succeeded;
    }

    const appointmentAfterAttempt = await appointmentService.getById(appointment.id) || appointment;
    const attemptCount = claimed.attemptCount + 1;
    const nextAttemptAt = getNextCalendarSyncAttemptAt(attemptCount, new Date());
    const failureStage = failureStageFor(appointmentAfterAttempt);
    const lastErrorCode = errorCodeFor(result.error);
    const [failed] = await db.update(appointmentCalendarSyncJobs).set({
      status: nextAttemptAt ? "pending" : "failed",
      attemptCount,
      nextAttemptAt: nextAttemptAt ?? new Date(),
      processingLeaseExpiresAt: null,
      completedAt: nextAttemptAt ? null : new Date(),
      failureStage,
      lastErrorCode,
      lastErrorMessage: result.error,
      updatedAt: new Date(),
    }).where(eq(appointmentCalendarSyncJobs.id, claimed.id)).returning();

    if (!nextAttemptAt) await this.ensureFailureTask(appointment, failureStage, lastErrorCode);
    return failed;
  }

  async processDueJobs(limit = 20): Promise<{ processed: number }> {
    const now = new Date();
    const rows = await db.select({ appointmentId: appointmentCalendarSyncJobs.appointmentId })
      .from(appointmentCalendarSyncJobs)
      .where(or(
        and(eq(appointmentCalendarSyncJobs.status, "pending"), lte(appointmentCalendarSyncJobs.nextAttemptAt, now)),
        and(eq(appointmentCalendarSyncJobs.status, "processing"), lte(appointmentCalendarSyncJobs.processingLeaseExpiresAt, now)),
      ))
      .orderBy(appointmentCalendarSyncJobs.nextAttemptAt)
      .limit(limit);
    for (const row of rows) await this.processAppointment(row.appointmentId);
    return { processed: rows.length };
  }

  async retry(appointmentId: string): Promise<AppointmentCalendarSyncJob | undefined> {
    const [job] = await db.update(appointmentCalendarSyncJobs).set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      processingLeaseExpiresAt: null,
      completedAt: null,
      failureStage: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    }).where(eq(appointmentCalendarSyncJobs.appointmentId, appointmentId)).returning();
    if (!job) return undefined;
    this.scheduleImmediate(appointmentId);
    return job;
  }

  async repairPaidPublicBookingHolds(limit = 20): Promise<{ repaired: number }> {
    const candidates = await db.select({ id: appointments.id }).from(appointments)
      .where(and(
        inArray(appointments.status, ["hold", "held"]),
        eq(appointments.paymentStatus, "paid"),
        inArray(appointments.paymentProvider, ["stripe", "xero_stripe"]),
        sql`${appointments.bookingToken} IS NOT NULL`,
      ))
      .limit(limit);
    let repaired = 0;
    for (const candidate of candidates) {
      const result = await appointmentService.confirmPaidPublicBooking(candidate.id, "paid_public_booking_repair");
      if (result.ok) repaired += 1;
    }
    return { repaired };
  }

  private async finishSkipped(job: AppointmentCalendarSyncJob, reason: string): Promise<AppointmentCalendarSyncJob | undefined> {
    const [skipped] = await db.update(appointmentCalendarSyncJobs).set({
      status: "skipped",
      processingLeaseExpiresAt: null,
      completedAt: new Date(),
      lastErrorCode: "not_required",
      lastErrorMessage: reason,
      updatedAt: new Date(),
    }).where(eq(appointmentCalendarSyncJobs.id, job.id)).returning();
    return skipped;
  }

  private async ensureFailureTask(
    appointment: { id: string; caseId: string },
    failureStage: "mediator_calendar" | "bfm_client_calendar",
    errorCode: string,
  ): Promise<void> {
    const [existing] = await db.select({ id: notifications.id }).from(notifications).where(and(
      eq(notifications.type, "appointment_calendar_sync_failed"),
      eq(notifications.appointmentId, appointment.id),
      sql`${notifications.status} <> 'completed'`,
    )).limit(1);
    if (existing) return;
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "appointment_calendar_sync_failed",
      urgency: "red",
      caseId: appointment.caseId,
      appointmentId: appointment.id,
      title: "Paid appointment calendar sync failed",
      message: `The appointment remains paid and confirmed, but ${failureStage === "mediator_calendar" ? "the mediator calendar" : "the BFM client calendar"} could not be synchronized after automatic retries (${errorCode}). Open the appointment and retry calendar sync after checking the connection.`,
      status: "active",
      caseNoteRequired: false,
    });
  }
}

export const appointmentCalendarSyncService = new AppointmentCalendarSyncService();
