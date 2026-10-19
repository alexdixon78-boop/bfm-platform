import { storage } from "../storage";
import type {
  Appointment,
  AppointmentLifecycleEventType,
  AppointmentStatusHistory,
  InsertAppointmentStatusHistory,
} from "@shared/schema";
import type { Actor } from "./case-activity.service";

type Metadata = Record<string, unknown>;

type HistoryInput = {
  appointment: Appointment;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousDateTime?: Date | string | null;
  newDateTime?: Date | string | null;
  previousDuration?: number | null;
  newDuration?: number | null;
  eventType: AppointmentLifecycleEventType;
  reason?: string | null;
  actor?: Actor | null;
  metadata?: Metadata | null;
  mediationSessionId?: string | null;
};

export type AppointmentLifecycleHistoryView = Omit<AppointmentStatusHistory, "metadata"> & {
  metadata?: Metadata | null;
};

function actorId(actor?: Actor | null): string | null {
  return actor?.type === "staff" ? actor.id ?? null : null;
}

function toDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function sanitizeMetadata(metadata: unknown): Metadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const redactedKeys = new Set([
    "googleBookingEventId",
    "googleTrailingRemnantEventId",
    "googleClientEventId",
    "parentGoogleEventId",
    "meetingLink",
    "paymentStatus",
    "paymentNotes",
    "paymentProvider",
    "stripeCheckoutSessionId",
    "stripePaymentIntentId",
  ]);
  return Object.fromEntries(
    Object.entries(metadata as Metadata).filter(([key]) => !redactedKeys.has(key)),
  );
}

class AppointmentLifecycleHistoryService {
  async record(input: HistoryInput): Promise<void> {
    const mediationSessionId = input.mediationSessionId ?? await this.findMediationSessionId(input.appointment);
    const row: InsertAppointmentStatusHistory = {
      appointmentId: input.appointment.id,
      caseId: input.appointment.caseId,
      mediationSessionId,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      previousDateTime: toDate(input.previousDateTime),
      newDateTime: toDate(input.newDateTime),
      previousDuration: input.previousDuration ?? null,
      newDuration: input.newDuration ?? null,
      eventType: input.eventType,
      reason: input.reason ?? null,
      changedBy: actorId(input.actor),
      changedAt: new Date(),
      metadata: input.metadata ?? null,
    };
    await storage.createAppointmentStatusHistory(row);
  }

  recordAppointmentCreated(appointment: Appointment, actor?: Actor | null, metadata?: Metadata | null): Promise<void> {
    return this.record({
      appointment,
      newStatus: appointment.status,
      newDateTime: appointment.dateTime,
      newDuration: appointment.duration,
      eventType: "appointment_created",
      actor,
      metadata,
    });
  }

  recordAppointmentStatusChange(
    appointment: Appointment,
    previousStatus: string | null,
    newStatus: string,
    eventType: AppointmentLifecycleEventType,
    actor?: Actor | null,
    reason?: string | null,
    metadata?: Metadata | null,
  ): Promise<void> {
    return this.record({
      appointment,
      previousStatus,
      newStatus,
      previousDateTime: appointment.dateTime,
      newDateTime: appointment.dateTime,
      previousDuration: appointment.duration,
      newDuration: appointment.duration,
      eventType,
      actor,
      reason,
      metadata,
    });
  }

  recordAppointmentRescheduled(
    previous: Appointment,
    updated: Appointment,
    actor?: Actor | null,
    metadata?: Metadata | null,
  ): Promise<void> {
    return this.record({
      appointment: updated,
      previousStatus: previous.status,
      newStatus: updated.status,
      previousDateTime: previous.dateTime,
      newDateTime: updated.dateTime,
      previousDuration: previous.duration,
      newDuration: updated.duration,
      eventType: "appointment_rescheduled",
      actor,
      metadata,
    });
  }

  recordMediationSessionHoldReleased(
    appointment: Appointment,
    previousStatus: string | null,
    actor?: Actor | null,
    metadata?: Metadata | null,
  ): Promise<void> {
    return this.recordAppointmentStatusChange(
      appointment,
      previousStatus,
      "expired",
      "mediation_session_hold_released",
      actor,
      "Mediation session hold released",
      metadata,
    );
  }

  recordMediationSessionReplacementProposed(appointment: Appointment, actor?: Actor | null, metadata?: Metadata | null): Promise<void> {
    return this.record({
      appointment,
      newStatus: appointment.status,
      newDateTime: appointment.dateTime,
      newDuration: appointment.duration,
      eventType: "mediation_session_replacement_proposed",
      actor,
      metadata,
    });
  }

  async listByAppointment(appointmentId: string, options: { safe?: boolean } = {}): Promise<AppointmentLifecycleHistoryView[]> {
    return this.sanitize(await storage.listAppointmentStatusHistoryByAppointment(appointmentId), options.safe);
  }

  async listByCase(caseId: string, options: { safe?: boolean } = {}): Promise<AppointmentLifecycleHistoryView[]> {
    return this.sanitize(await storage.listAppointmentStatusHistoryByCase(caseId), options.safe);
  }

  sanitize(rows: AppointmentStatusHistory[], safe = false): AppointmentLifecycleHistoryView[] {
    return rows.map((row) => ({
      ...row,
      metadata: safe ? sanitizeMetadata(row.metadata) : (row.metadata as Metadata | null),
    }));
  }

  private async findMediationSessionId(appointment: Appointment): Promise<string | null> {
    const sessions = await storage.listMediationSessionsByCase(appointment.caseId);
    return sessions.find((session) => session.appointmentId === appointment.id)?.id ?? null;
  }
}

export const appointmentLifecycleHistoryService = new AppointmentLifecycleHistoryService();
