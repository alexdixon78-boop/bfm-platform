import { db } from "../db";
import { appointments, mediationSessions, type Appointment, type InsertAppointment } from "@shared/schema";
import { eq, and, gte, lte, lt, inArray, isNull, notInArray, sql } from "drizzle-orm";

export class AppointmentRepository {
  async getById(id: string): Promise<Appointment | undefined> {
    const [appt] = await db.select().from(appointments).where(eq(appointments.id, id));
    return appt;
  }

  async listByCase(caseId: string): Promise<Appointment[]> {
    return db.select().from(appointments).where(eq(appointments.caseId, caseId));
  }

  async listByMediator(mediatorId: string): Promise<Appointment[]> {
    return db.select().from(appointments).where(eq(appointments.mediatorId, mediatorId));
  }

  async listByDateRange(start: Date, end: Date): Promise<Appointment[]> {
    return db.select().from(appointments).where(
      and(gte(appointments.dateTime, start), lte(appointments.dateTime, end))
    );
  }

  async listByMediatorAndDateRange(mediatorId: string, start: Date, end: Date): Promise<Appointment[]> {
    return db.select().from(appointments).where(
      and(
        eq(appointments.mediatorId, mediatorId),
        gte(appointments.dateTime, start),
        lte(appointments.dateTime, end),
        inArray(appointments.status, ["hold", "held", "confirmed"])
      )
    );
  }

  async listByPartyIds(partyIds: string[]): Promise<Appointment[]> {
    if (partyIds.length === 0) return [];
    return db.select().from(appointments).where(inArray(appointments.partyId, partyIds));
  }

  async listByMediatorDateRange(mediatorId: string, start: Date, end: Date): Promise<Appointment[]> {
    return db.select().from(appointments).where(
      and(
        eq(appointments.mediatorId, mediatorId),
        gte(appointments.dateTime, start),
        lte(appointments.dateTime, end)
      )
    );
  }

  async listByPartyIdsDateRange(partyIds: string[], start: Date, end: Date): Promise<Appointment[]> {
    if (partyIds.length === 0) return [];
    return db.select().from(appointments).where(
      and(
        inArray(appointments.partyId, partyIds),
        gte(appointments.dateTime, start),
        lte(appointments.dateTime, end)
      )
    );
  }

  async listByCaseIdsDateRange(caseIds: string[], start: Date, end: Date): Promise<Appointment[]> {
    if (caseIds.length === 0) return [];
    return db.select().from(appointments).where(
      and(
        inArray(appointments.caseId, caseIds),
        gte(appointments.dateTime, start),
        lte(appointments.dateTime, end)
      )
    );
  }

  async getByBookingToken(token: string): Promise<Appointment | undefined> {
    const [appt] = await db.select().from(appointments).where(eq(appointments.bookingToken, token));
    return appt;
  }

  async getActiveByPartyAndBookingToken(partyId: string, token: string): Promise<Appointment | undefined> {
    const [appt] = await db.select().from(appointments).where(
      and(
        eq(appointments.partyId, partyId),
        eq(appointments.bookingToken, token),
        notInArray(appointments.status, ["cancelled", "expired"]),
      )
    );
    return appt;
  }

  async create(data: InsertAppointment): Promise<Appointment> {
    const [appt] = await db.insert(appointments).values(data).returning();
    return appt;
  }

  async update(id: string, data: Partial<Omit<Appointment, "id" | "createdAt">>): Promise<Appointment | undefined> {
    const [updated] = await db.update(appointments).set(data).where(eq(appointments.id, id)).returning();
    return updated;
  }

  async expireHeldAppointments(): Promise<Appointment[]> {
    const now = new Date();
    return db.update(appointments)
      .set({ status: "expired" })
      .where(
        and(
          inArray(appointments.status, ["hold", "held"]),
          lt(appointments.holdExpiresAt, now),
          notInArray(appointments.paymentStatus, ["paid", "voucher_accepted_by_opia", "payment_not_required"]),
          sql`NOT EXISTS (SELECT 1 FROM mediation_sessions ms WHERE ms.appointment_id = ${appointments.id})`,
        )
      )
      .returning();
  }

  async findHeldAppointmentsToExpire(): Promise<Appointment[]> {
    const now = new Date();
    return db.select().from(appointments).where(
      and(
        inArray(appointments.status, ["hold", "held"]),
        lt(appointments.holdExpiresAt, now),
        notInArray(appointments.paymentStatus, ["paid", "voucher_accepted_by_opia", "payment_not_required"]),
        sql`NOT EXISTS (SELECT 1 FROM mediation_sessions ms WHERE ms.appointment_id = ${appointments.id})`,
      )
    );
  }

  async findHeldAppointmentsNeedingPaymentAlert(now: Date): Promise<Appointment[]> {
    return db.select().from(appointments).where(
      and(
        inArray(appointments.status, ["hold", "held"]),
        isNull(appointments.holdAlertSentAt),
        lte(appointments.dateTime, new Date(now.getTime() + 72 * 60 * 60 * 1000)),
        notInArray(appointments.paymentStatus, ["paid", "voucher_accepted_by_opia", "payment_not_required"]),
      )
    );
  }

  async findExpiredMediationSessionHolds(now: Date): Promise<Appointment[]> {
    return db
      .select({
        id: appointments.id,
        caseId: appointments.caseId,
        partyId: appointments.partyId,
        serviceTypeId: appointments.serviceTypeId,
        mediatorId: appointments.mediatorId,
        dateTime: appointments.dateTime,
        dateTimeBasis: appointments.dateTimeBasis,
        duration: appointments.duration,
        status: appointments.status,
        holdExpiresAt: appointments.holdExpiresAt,
        holdAlertSentAt: appointments.holdAlertSentAt,
        bookingToken: appointments.bookingToken,
        paymentStatus: appointments.paymentStatus,
        paymentStatusUpdatedAt: appointments.paymentStatusUpdatedAt,
        paymentStatusUpdatedBy: appointments.paymentStatusUpdatedBy,
        paymentNotes: appointments.paymentNotes,
        paymentProvider: appointments.paymentProvider,
        paymentAmountPence: appointments.paymentAmountPence,
        paymentCurrency: appointments.paymentCurrency,
        stripeCheckoutSessionId: appointments.stripeCheckoutSessionId,
        stripePaymentIntentId: appointments.stripePaymentIntentId,
        stripePaymentCompletedAt: appointments.stripePaymentCompletedAt,
        paymentFailureReason: appointments.paymentFailureReason,
        notes: appointments.notes,
        meetingLink: appointments.meetingLink,
        parentGoogleEventId: appointments.parentGoogleEventId,
        parentCalendarProvider: appointments.parentCalendarProvider,
        parentEventOriginalStart: appointments.parentEventOriginalStart,
        parentEventOriginalEnd: appointments.parentEventOriginalEnd,
        parentEventOriginalTitle: appointments.parentEventOriginalTitle,
        parentEventOriginalAttendees: appointments.parentEventOriginalAttendees,
        googleBookingEventId: appointments.googleBookingEventId,
        bookingCalendarProvider: appointments.bookingCalendarProvider,
        googleTrailingRemnantEventId: appointments.googleTrailingRemnantEventId,
        trailingRemnantCalendarProvider: appointments.trailingRemnantCalendarProvider,
        availabilitySourceId: appointments.availabilitySourceId,
        availabilityReservationMode: appointments.availabilityReservationMode,
        googleClientEventId: appointments.googleClientEventId,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .innerJoin(mediationSessions, eq(mediationSessions.appointmentId, appointments.id))
      .where(and(
        inArray(appointments.status, ["hold", "held"]),
        lt(appointments.holdExpiresAt, now),
      ));
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(appointments).where(eq(appointments.id, id)).returning();
    return result.length > 0;
  }
}
