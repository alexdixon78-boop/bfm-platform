import { and, eq } from "drizzle-orm";
import { appointmentClientCalendarEvents, type Appointment } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { googleCalendarService } from "./google-calendar.service";
import { notificationService } from "./notification.service";
import { cancelPrivateMediationInvites, prepareMediationInviteRecipients, privateMediationEventId, reschedulePrivateMediationInvites, syncPrivateMediationInvites } from "./mediation-client-calendar";
import { toUkCalendarEventInstant } from "../utils/uk-wall-clock";

const UK_TIME_ZONE_NOTICE = "\n\nAll times are UK time (Europe/London).";

function clientEventTitle(caseRef: string): string {
  return `Mediation session — ${caseRef}`;
}

async function recipientsFor(appt: Appointment) {
  const parties = await storage.listPartiesByCase(appt.caseId);
  const resolved = await Promise.all(parties.map(async (party) => {
    const client = await storage.getClient(party.clientId);
    return {
      partyId: party.id,
      role: party.role,
      name: client ? `${client.firstName} ${client.lastName}`.trim() : `Client ${party.role}`,
      email: client?.email || "",
    };
  }));
  return prepareMediationInviteRecipients(resolved);
}

export const mediationClientCalendarService = {
  async validate(appt: Appointment) {
    return recipientsFor(appt);
  },

  async list(apptId: string) {
    return db.select().from(appointmentClientCalendarEvents)
      .where(eq(appointmentClientCalendarEvents.appointmentId, apptId));
  },

  async ensure(appt: Appointment, caseRef: string): Promise<void> {
    const prepared = await recipientsFor(appt);
    if (!prepared.ok) throw new Error(prepared.error);
    const start = toUkCalendarEventInstant(appt.dateTime, appt.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc");
    const end = new Date(start.getTime() + appt.duration * 60_000);
    await syncPrivateMediationInvites(prepared.recipients, {
      get: async (partyId) => {
        const [row] = await db.select().from(appointmentClientCalendarEvents)
          .where(and(eq(appointmentClientCalendarEvents.appointmentId, appt.id), eq(appointmentClientCalendarEvents.partyId, partyId))).limit(1);
        return row ? { eventId: row.googleEventId, icalUid: row.icalUid } : undefined;
      },
      create: (recipient) => googleCalendarService.createBfmEventWithUid({
        eventId: privateMediationEventId(appt.id, recipient.partyId),
        summary: clientEventTitle(caseRef),
        description: `Your mediation session with Brighter Future Mediation is confirmed. Sign in to the client portal on the day of your session to join.${UK_TIME_ZONE_NOTICE}`,
        start,
        end,
        clientEmail: recipient.email,
        clientName: recipient.name,
      }),
      save: async (partyId, event) => {
        const recipient = prepared.recipients.find((item) => item.partyId === partyId)!;
        await db.insert(appointmentClientCalendarEvents).values({
          appointmentId: appt.id,
          partyId,
          googleEventId: event.eventId,
          icalUid: event.icalUid,
          recipientEmail: recipient.email,
        }).onConflictDoNothing();
      },
    });
  },

  async reschedule(appt: Appointment, start: Date, duration: number): Promise<void> {
    const rows = await this.list(appt.id);
    const timeBasis = appt.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc";
    const calendarStart = toUkCalendarEventInstant(start, timeBasis);
    const end = new Date(calendarStart.getTime() + duration * 60_000);
    const oldStart = toUkCalendarEventInstant(appt.dateTime, timeBasis);
    const oldEnd = new Date(oldStart.getTime() + appt.duration * 60_000);
    await reschedulePrivateMediationInvites(
      rows.map((row) => row.googleEventId), calendarStart, end, oldStart, oldEnd,
      (eventId, eventStart, eventEnd) => googleCalendarService.patchBfmEvent(eventId, { start: eventStart, end: eventEnd }),
      async (eventId, rollbackError) => {
        console.error(`[MediationClientCalendar] Could not restore event ${eventId} after reschedule failure:`, rollbackError);
        await notificationService.createNotification({
          recipientId: null,
          recipientRole: "admin",
          type: "mediation_client_calendar_reschedule_failed",
          urgency: "red",
          caseId: appt.caseId,
          appointmentId: appt.id,
          title: "Mediation calendar reschedule needs attention",
          message: "Client calendar events may show different times after a failed reschedule. Compare all client invitations with the CRM appointment and correct them.",
          status: "active",
          caseNoteRequired: false,
        }).catch((notificationError) => console.error("[MediationClientCalendar] Could not create reschedule alert:", notificationError));
      },
    );
  },

  async cancel(appt: Appointment): Promise<void> {
    const rows = await this.list(appt.id);
    await cancelPrivateMediationInvites(
      rows.map((row) => row.googleEventId),
      (eventId) => googleCalendarService.deleteBfmEvent(eventId),
      async (eventId) => {
        const row = rows.find((item) => item.googleEventId === eventId);
        if (row) await db.delete(appointmentClientCalendarEvents).where(eq(appointmentClientCalendarEvents.id, row.id));
      },
    );
  },
};
