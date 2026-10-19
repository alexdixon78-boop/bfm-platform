import { db } from "../db";
import { outlookCalendarEvents, type OutlookCalendarEvent, type InsertOutlookCalendarEvent } from "@shared/schema";
import { eq, and, gte, lte, sql, asc, notInArray } from "drizzle-orm";

export class OutlookCalendarEventsRepository {
  async upsertEvents(events: InsertOutlookCalendarEvent[]): Promise<void> {
    if (events.length === 0) return;
    await db
      .insert(outlookCalendarEvents)
      .values(events)
      .onConflictDoUpdate({
        target: [outlookCalendarEvents.mediatorId, outlookCalendarEvents.outlookEventId],
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
  ): Promise<OutlookCalendarEvent[]> {
    return db
      .select()
      .from(outlookCalendarEvents)
      .where(
        and(
          eq(outlookCalendarEvents.mediatorId, mediatorId),
          eq(outlookCalendarEvents.isAllDay, false),
          lte(outlookCalendarEvents.startAt, end),
          gte(outlookCalendarEvents.endAt, start)
        )
      )
      .orderBy(asc(outlookCalendarEvents.startAt))
      .limit(500);
  }

  async deleteByMediator(mediatorId: string): Promise<void> {
    await db.delete(outlookCalendarEvents).where(eq(outlookCalendarEvents.mediatorId, mediatorId));
  }

  async deleteStaleEventsInRange(
    mediatorId: string,
    keepIds: string[],
    windowStart: Date,
    windowEnd: Date
  ): Promise<void> {
    const rangeFilter = and(
      eq(outlookCalendarEvents.mediatorId, mediatorId),
      gte(outlookCalendarEvents.startAt, windowStart),
      lte(outlookCalendarEvents.startAt, windowEnd)
    )!;
    if (keepIds.length === 0) {
      await db.delete(outlookCalendarEvents).where(rangeFilter);
    } else {
      await db.delete(outlookCalendarEvents).where(
        and(rangeFilter, notInArray(outlookCalendarEvents.outlookEventId, keepIds))
      );
    }
  }
}
