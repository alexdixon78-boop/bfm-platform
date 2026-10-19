import { db } from "../db";
import { googleCalendarEvents, type GoogleCalendarEvent, type InsertGoogleCalendarEvent } from "@shared/schema";
import { eq, and, gte, lte, sql, asc, notInArray } from "drizzle-orm";

export class GoogleCalendarEventsRepository {
  async upsertEvents(events: InsertGoogleCalendarEvent[]): Promise<void> {
    if (events.length === 0) return;
    await db
      .insert(googleCalendarEvents)
      .values(events)
      .onConflictDoUpdate({
        target: [googleCalendarEvents.mediatorId, googleCalendarEvents.googleEventId],
        set: {
          title: sql`excluded.title`,
          externalSeriesId: sql`excluded.external_series_id`,
          organizerEmail: sql`excluded.organizer_email`,
          startAt: sql`excluded.start_at`,
          endAt: sql`excluded.end_at`,
          isAllDay: sql`excluded.is_all_day`,
          attendees: sql`excluded.attendees`,
          bfmAttendanceStatus: sql`excluded.bfm_attendance_status`,
          isOrganiser: sql`excluded.is_organiser`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  async listByMediatorAndDateRange(
    mediatorId: string,
    start: Date,
    end: Date
  ): Promise<GoogleCalendarEvent[]> {
    return db
      .select()
      .from(googleCalendarEvents)
      .where(
        and(
          eq(googleCalendarEvents.mediatorId, mediatorId),
          eq(googleCalendarEvents.isAllDay, false),
          lte(googleCalendarEvents.startAt, end),
          gte(googleCalendarEvents.endAt, start)
        )
      )
      .orderBy(asc(googleCalendarEvents.startAt))
      .limit(500);
  }

  async deleteByMediator(mediatorId: string): Promise<void> {
    await db.delete(googleCalendarEvents).where(eq(googleCalendarEvents.mediatorId, mediatorId));
  }

  async deleteStaleEventsInRange(
    mediatorId: string,
    keepIds: string[],
    windowStart: Date,
    windowEnd: Date
  ): Promise<void> {
    const rangeFilter = and(
      eq(googleCalendarEvents.mediatorId, mediatorId),
      gte(googleCalendarEvents.startAt, windowStart),
      lte(googleCalendarEvents.startAt, windowEnd)
    )!;
    if (keepIds.length === 0) {
      await db.delete(googleCalendarEvents).where(rangeFilter);
    } else {
      await db.delete(googleCalendarEvents).where(
        and(rangeFilter, notInArray(googleCalendarEvents.googleEventId, keepIds))
      );
    }
  }
}
