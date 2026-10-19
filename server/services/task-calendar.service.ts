import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  taskAssignees,
  taskCalendarSyncJobs,
  taskSchedules,
  taskReminderDeliveries,
  tasks,
  users,
  notifications,
  type TaskCalendarSyncJob,
} from "@shared/schema";
import {
  buildInternalCalendarEvent,
  londonDateStartInstant,
  parseTaskSchedule,
  taskCalendarConnectionHealth,
  taskCalendarRetryAt,
} from "@shared/task-domain";
import { db } from "../db";
import { storage } from "../storage";
import { logger } from "../logger";
import { googleCalendarService, hasWriteScope } from "./google-calendar.service";
import { getMediatorCalendarProviderService } from "./mediator-calendar-provider.service";
import { taskDeliveryKind, type TaskDeliveryKind } from "@shared/task-calendar-delivery";
import { notificationRealtimeService } from "./notification-realtime.service";
import { taskService, type TaskFilters } from "./task.service";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;

function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_grant|reauth|unauthori[sz]ed|expired token/i.test(message)) return "needs_reauth";
  if (/scope|permission/i.test(message)) return "needs_scope";
  if (/not configured|not connected/i.test(message)) return "not_configured";
  if (/404|410|not found/i.test(message)) return "event_not_found";
  return "provider_error";
}

function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");
}

export class TaskCalendarService {
  private async deliveryFor(schedule: typeof taskSchedules.$inferSelect): Promise<{ kind: TaskDeliveryKind; userId: string | null }> {
    if (schedule.deliveryKind !== "auto") return { kind: schedule.deliveryKind as TaskDeliveryKind, userId: schedule.deliveryUserId };
    const assignee = schedule.deliveryUserId ? await storage.getUser(schedule.deliveryUserId) : null;
    if (!assignee) throw new Error("Task assignee is unavailable for calendar delivery");
    return { kind: taskDeliveryKind(assignee), userId: assignee.id };
  }

  private async upsertDelivery(kind: TaskDeliveryKind, userId: string | null, eventId: string | null, payload: Record<string, any>, schedule: typeof taskSchedules.$inferSelect): Promise<string> {
    if (kind === "bfm" || kind === "bfm_invite") return googleCalendarService.upsertInternalTaskEvent(eventId, payload);
    if (!userId) throw new Error("Mediator calendar owner is unavailable");
    const provider = getMediatorCalendarProviderService(kind === "mediator_google" ? "google" : "outlook");
    const event = {
      summary: payload.summary as string,
      description: payload.description as string,
      start: schedule.kind === "all_day" ? londonDateStartInstant(schedule.allDayStart!) : schedule.startAt!,
      end: schedule.kind === "all_day" ? londonDateStartInstant(schedule.allDayEndExclusive!) : schedule.endAt!,
      ...(schedule.kind === "all_day" ? { allDayStart: schedule.allDayStart!, allDayEndExclusive: schedule.allDayEndExclusive! } : {}),
    };
    if (eventId) {
      await provider.patchEvent(userId, eventId, event);
      return eventId;
    }
    return provider.createEvent(userId, event);
  }

  private async deleteDelivery(kind: string | null, userId: string | null, eventId: string): Promise<void> {
    if (kind === "mediator_google" || kind === "mediator_outlook") {
      if (!userId) throw new Error("Mediator calendar owner is unavailable");
      await getMediatorCalendarProviderService(kind === "mediator_google" ? "google" : "outlook").deleteEvent(userId, eventId);
    } else {
      await googleCalendarService.deleteInternalTaskEvent(eventId);
    }
  }

  private async eventPayload(taskId: string, schedule: typeof taskSchedules.$inferSelect) {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) throw new Error("Task not found");
    const assignmentRows = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(eq(taskAssignees.taskId, taskId));
    const caseRecord = task.caseId ? await storage.getCase(task.caseId) : null;
    const eventSchedule = schedule.kind === "timed"
      ? { kind: "timed" as const, startAt: schedule.startAt!, endAt: schedule.endAt! }
      : { kind: "all_day" as const, startDate: schedule.allDayStart!, endDateExclusive: schedule.allDayEndExclusive! };
    const payload = buildInternalCalendarEvent({
      taskId,
      scheduleVersion: schedule.version,
      title: task.title,
      caseReference: caseRecord?.caseRef ?? null,
      assigneeNames: assignmentRows.map((row) => row.name),
      crmUrl: `${appBaseUrl()}/tasks?view=calendar&taskId=${encodeURIComponent(taskId)}`,
      schedule: eventSchedule,
    });
    return schedule.deliveryKind === "auto" || schedule.deliveryKind === "bfm_invite"
      ? { ...payload, attendees: assignmentRows.map((row) => ({ email: row.email, displayName: row.name })) }
      : payload;
  }

  private async requeueForReconciliation(
    taskId: string,
    schedule: typeof taskSchedules.$inferSelect,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await db.insert(taskCalendarSyncJobs).values({
      taskId,
      taskScheduleId: schedule.id,
      operation: "upsert",
      scheduleVersion: schedule.version,
      googleEventId: schedule.googleEventId,
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    }).onConflictDoUpdate({
      target: [taskCalendarSyncJobs.taskId, taskCalendarSyncJobs.scheduleVersion, taskCalendarSyncJobs.operation],
      set: {
        taskScheduleId: schedule.id,
        googleEventId: schedule.googleEventId,
        payload,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: new Date(),
        processingLeaseExpiresAt: null,
        completedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      },
    });
  }

  async setSchedule(taskId: string, rawSchedule: unknown): Promise<typeof taskSchedules.$inferSelect> {
    const parsed = parseTaskSchedule(rawSchedule);
    const shape = parsed.kind === "timed"
      ? {
          kind: parsed.kind,
          startAt: parsed.startAt,
          endAt: parsed.endAt,
          allDayStart: null,
          allDayEndExclusive: null,
          reminderMinutes: parsed.reminderMinutes,
        }
      : {
          kind: parsed.kind,
          startAt: null,
          endAt: null,
          allDayStart: parsed.startDate,
          allDayEndExclusive: parsed.endDateExclusive,
          reminderMinutes: parsed.reminderMinutes,
        };
    const schedule = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task) throw Object.assign(new Error("Task not found"), { status: 404 });
      if (task.audience !== "internal" && task.audience !== "mediator") throw Object.assign(new Error("This task cannot be scheduled"), { status: 400 });
      if (task.status === "completed") throw Object.assign(new Error("Completed tasks cannot be scheduled"), { status: 409 });
      const owners = await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, taskId));
      const count = owners.length;
      if (Number(count) < 1) throw Object.assign(new Error("Assign at least one internal owner before scheduling"), { status: 400 });
      const [existing] = await tx.select().from(taskSchedules).where(eq(taskSchedules.taskId, taskId)).limit(1);
      const newOwnerId = task.type === "task" && owners.length === 1 ? owners[0].userId : null;
      const deliveryKind = existing && existing.deliveryUserId === newOwnerId && existing.deliveryKind !== "auto"
        ? existing.deliveryKind : newOwnerId ? "auto" : "bfm";
      const targetChanged = !!existing && (existing.deliveryUserId !== newOwnerId || existing.deliveryKind !== deliveryKind);
      if (targetChanged && existing?.active && existing.googleEventId) {
        await tx.insert(taskCalendarSyncJobs).values({
          taskId, taskScheduleId: existing.id, operation: "delete", scheduleVersion: existing.version,
          googleEventId: existing.googleEventId, deliveryKind: existing.deliveryKind, deliveryUserId: existing.deliveryUserId,
          status: "pending", nextAttemptAt: new Date(),
        }).onConflictDoNothing();
      }
      const nextVersion = (existing?.version ?? 0) + 1;
      const [saved] = await tx.insert(taskSchedules).values({
        taskId,
        ...shape,
        active: true,
        version: nextVersion,
        googleEventId: targetChanged ? null : existing?.googleEventId ?? null,
        deliveryKind,
        deliveryUserId: newOwnerId,
        syncStatus: "pending",
        reminderSentAt: null,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: taskSchedules.taskId,
        set: {
          ...shape,
          active: true,
          version: nextVersion,
          googleEventId: targetChanged ? null : existing?.googleEventId ?? null,
          deliveryKind,
          deliveryUserId: newOwnerId,
          syncStatus: "pending",
          lastSyncErrorCode: null,
          lastSyncErrorMessage: null,
          reminderSentAt: null,
          updatedAt: new Date(),
        },
      }).returning();
      await tx.insert(taskCalendarSyncJobs).values({
        taskId,
        taskScheduleId: saved.id,
        operation: "upsert",
        scheduleVersion: saved.version,
        googleEventId: saved.googleEventId,
        deliveryKind: saved.deliveryKind,
        deliveryUserId: saved.deliveryUserId,
        payload: null,
        status: "pending",
        nextAttemptAt: new Date(),
      }).onConflictDoNothing();
      return saved;
    });
    this.scheduleImmediate(taskId);
    return schedule;
  }

  async removeSchedule(taskId: string): Promise<void> {
    const schedule = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`);
      const [existing] = await tx.select().from(taskSchedules).where(eq(taskSchedules.taskId, taskId)).limit(1);
      if (!existing || !existing.active) return null;
      const [saved] = await tx.update(taskSchedules).set({
        active: false,
        version: existing.version + 1,
        syncStatus: "pending",
        reminderSentAt: null,
        updatedAt: new Date(),
      }).where(eq(taskSchedules.id, existing.id)).returning();
      await tx.insert(taskCalendarSyncJobs).values({
        taskId,
        taskScheduleId: saved.id,
        operation: "delete",
        scheduleVersion: saved.version,
        googleEventId: saved.googleEventId,
        deliveryKind: saved.deliveryKind,
        deliveryUserId: saved.deliveryUserId,
        payload: null,
        status: "pending",
        nextAttemptAt: new Date(),
      }).onConflictDoNothing();
      return saved;
    });
    if (!schedule) return;
    this.scheduleImmediate(taskId);
  }

  async refreshScheduleMetadata(taskId: string): Promise<typeof taskSchedules.$inferSelect | null> {
    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`);
      const [schedule] = await tx.select().from(taskSchedules)
        .where(and(eq(taskSchedules.taskId, taskId), eq(taskSchedules.active, true)))
        .limit(1);
      if (!schedule) return null;
      const [saved] = await tx.update(taskSchedules).set({
        syncStatus: "pending",
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        reminderSentAt: null,
        updatedAt: new Date(),
      }).where(eq(taskSchedules.id, schedule.id)).returning();
      await tx.insert(taskCalendarSyncJobs).values({
        taskId,
        taskScheduleId: saved.id,
        operation: "upsert",
        scheduleVersion: saved.version,
        googleEventId: saved.googleEventId,
        payload: null,
        status: "pending",
        nextAttemptAt: new Date(),
      }).onConflictDoUpdate({
        target: [taskCalendarSyncJobs.taskId, taskCalendarSyncJobs.scheduleVersion, taskCalendarSyncJobs.operation],
        set: {
          taskScheduleId: saved.id,
          googleEventId: saved.googleEventId,
          payload: null,
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: new Date(),
          processingLeaseExpiresAt: null,
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date(),
        },
      });
      return saved;
    });
    if (!updated) return null;
    this.scheduleImmediate(taskId);
    return updated;
  }

  scheduleImmediate(taskId: string): void {
    queueMicrotask(() => {
      void this.processTaskJobs(taskId, true).catch((error) => {
        logger.error("Immediate task calendar sync failed unexpectedly", error, "task-calendar-sync");
      });
    });
  }

  private async processJob(job: TaskCalendarSyncJob, force = false): Promise<void> {
    const now = new Date();
    const eligibility = force
      ? or(inArray(taskCalendarSyncJobs.status, ["pending", "failed"]), and(eq(taskCalendarSyncJobs.status, "processing"), lte(taskCalendarSyncJobs.processingLeaseExpiresAt, now)))
      : or(and(eq(taskCalendarSyncJobs.status, "pending"), lte(taskCalendarSyncJobs.nextAttemptAt, now)), and(eq(taskCalendarSyncJobs.status, "processing"), lte(taskCalendarSyncJobs.processingLeaseExpiresAt, now)));
    const [claimed] = await db.update(taskCalendarSyncJobs).set({
      status: "processing",
      processingLeaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      lastAttemptAt: now,
      updatedAt: now,
    }).where(and(eq(taskCalendarSyncJobs.id, job.id), eligibility!)).returning();
    if (!claimed) return;

    try {
      const [schedule] = claimed.taskScheduleId
        ? await db.select().from(taskSchedules).where(eq(taskSchedules.id, claimed.taskScheduleId)).limit(1)
        : [];
      if (claimed.operation === "upsert") {
        if (!schedule || !schedule.active || schedule.version !== claimed.scheduleVersion) {
          await this.finishJob(claimed.id, "skipped", "stale_version", null);
          return;
        }
        const payload = (claimed.payload ?? await this.eventPayload(claimed.taskId!, schedule)) as Record<string, unknown>;
        const delivery = await this.deliveryFor(schedule);
        const eventId = await this.upsertDelivery(delivery.kind, delivery.userId, schedule.googleEventId, payload, schedule);
        const [updatedSchedule] = await db.update(taskSchedules).set({
          googleEventId: eventId,
          deliveryKind: delivery.kind,
          deliveryUserId: delivery.userId,
          syncStatus: "succeeded",
          lastSyncErrorCode: null,
          lastSyncErrorMessage: null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(eq(taskSchedules.id, schedule.id), eq(taskSchedules.version, claimed.scheduleVersion))).returning();
        if (!updatedSchedule) {
          if (eventId !== schedule.googleEventId) {
            await db.insert(taskCalendarSyncJobs).values({
              taskId: claimed.taskId,
              taskScheduleId: schedule.id,
              operation: "delete",
              scheduleVersion: claimed.scheduleVersion,
              googleEventId: eventId,
              deliveryKind: delivery.kind,
              deliveryUserId: delivery.userId,
              payload: null,
              status: "pending",
              nextAttemptAt: new Date(),
            }).onConflictDoNothing();
          }
          const [current] = await db.select().from(taskSchedules).where(eq(taskSchedules.id, schedule.id)).limit(1);
          if (current?.active) {
            const currentPayload = await this.eventPayload(current.taskId, current) as Record<string, unknown>;
            await this.requeueForReconciliation(current.taskId, current, currentPayload);
            this.scheduleImmediate(current.taskId);
          }
          await this.finishJob(claimed.id, "skipped", "stale_after_provider_write", null);
          return;
        }
      } else {
        const eventId = claimed.googleEventId ?? schedule?.googleEventId;
        if (schedule?.active && schedule.version > claimed.scheduleVersion && schedule.googleEventId === eventId) {
          await this.finishJob(claimed.id, "skipped", "stale_delete", null);
          return;
        }
        if (eventId) await this.deleteDelivery(claimed.deliveryKind ?? schedule?.deliveryKind ?? null, claimed.deliveryUserId ?? schedule?.deliveryUserId ?? null, eventId);
        if (schedule && !schedule.active && schedule.version === claimed.scheduleVersion && schedule.googleEventId === eventId) {
          await db.update(taskSchedules).set({
            googleEventId: null,
            syncStatus: "succeeded",
            lastSyncErrorCode: null,
            lastSyncErrorMessage: null,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(taskSchedules.id, schedule.id));
        }
      }
      await this.finishJob(claimed.id, "succeeded", null, null);
    } catch (error) {
      const attemptCount = claimed.attemptCount + 1;
      const retryAt = taskCalendarRetryAt(attemptCount, new Date());
      const message = error instanceof Error ? error.message : String(error);
      const code = providerErrorCode(error);
      await db.update(taskCalendarSyncJobs).set({
        status: retryAt ? "pending" : "failed",
        attemptCount,
        nextAttemptAt: retryAt ?? new Date(),
        processingLeaseExpiresAt: null,
        completedAt: retryAt ? null : new Date(),
        lastErrorCode: code,
        lastErrorMessage: message.slice(0, 500),
        updatedAt: new Date(),
      }).where(eq(taskCalendarSyncJobs.id, claimed.id));
      if (claimed.taskScheduleId) {
        await db.update(taskSchedules).set({
          syncStatus: retryAt ? "pending" : "failed",
          lastSyncErrorCode: code,
          lastSyncErrorMessage: message.slice(0, 500),
          updatedAt: new Date(),
        }).where(eq(taskSchedules.id, claimed.taskScheduleId));
      }
    }
  }

  private async finishJob(id: string, status: "succeeded" | "skipped", code: string | null, message: string | null) {
    await db.update(taskCalendarSyncJobs).set({
      status,
      processingLeaseExpiresAt: null,
      completedAt: new Date(),
      lastErrorCode: code,
      lastErrorMessage: message,
      updatedAt: new Date(),
    }).where(eq(taskCalendarSyncJobs.id, id));
  }

  async processTaskJobs(taskId: string, force = false): Promise<void> {
    const rows = await db.select().from(taskCalendarSyncJobs)
      .where(eq(taskCalendarSyncJobs.taskId, taskId))
      .orderBy(asc(taskCalendarSyncJobs.createdAt));
    for (const row of rows) await this.processJob(row, force);
  }

  async processDueJobs(limit = 20): Promise<{ processed: number }> {
    const now = new Date();
    const rows = await db.select().from(taskCalendarSyncJobs).where(or(
      and(eq(taskCalendarSyncJobs.status, "pending"), lte(taskCalendarSyncJobs.nextAttemptAt, now)),
      and(eq(taskCalendarSyncJobs.status, "processing"), lte(taskCalendarSyncJobs.processingLeaseExpiresAt, now)),
    )!).orderBy(asc(taskCalendarSyncJobs.nextAttemptAt)).limit(limit);
    for (const row of rows) await this.processJob(row);
    return { processed: rows.length };
  }

  async deactivateCompletedSchedules(limit = 50): Promise<{ deactivated: number }> {
    const rows = await db.select({ taskId: taskSchedules.taskId })
      .from(taskSchedules)
      .innerJoin(tasks, eq(tasks.id, taskSchedules.taskId))
      .where(and(eq(taskSchedules.active, true), eq(tasks.status, "completed")))
      .limit(limit);
    for (const row of rows) await this.removeSchedule(row.taskId);
    return { deactivated: rows.length };
  }

  async retry(taskId: string): Promise<void> {
    await db.update(taskCalendarSyncJobs).set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      processingLeaseExpiresAt: null,
      completedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    }).where(and(eq(taskCalendarSyncJobs.taskId, taskId), inArray(taskCalendarSyncJobs.status, ["failed", "pending"])));
    await db.update(taskSchedules).set({ syncStatus: "pending", updatedAt: new Date() })
      .where(eq(taskSchedules.taskId, taskId));
    this.scheduleImmediate(taskId);
  }

  async sendDueReminders(now = new Date()): Promise<{ reminded: number }> {
    const rows = await db.select().from(taskSchedules).where(and(
      eq(taskSchedules.active, true),
      sql`${taskSchedules.reminderMinutes} IS NOT NULL`,
      sql`${taskSchedules.reminderSentAt} IS NULL`,
    ));
    let reminded = 0;
    for (const schedule of rows) {
      const start = schedule.kind === "timed"
        ? schedule.startAt
        : schedule.allDayStart ? londonDateStartInstant(schedule.allDayStart) : null;
      if (!start || schedule.reminderMinutes === null) continue;
      if (start.getTime() - schedule.reminderMinutes * 60_000 > now.getTime()) continue;
      const createdNotifications = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${schedule.id}))`);
        const [current] = await tx.select().from(taskSchedules).where(eq(taskSchedules.id, schedule.id)).limit(1);
        if (!current?.active || current.reminderSentAt || current.version !== schedule.version) return [];
        const [task] = await tx.select().from(tasks).where(eq(tasks.id, current.taskId)).limit(1);
        if (!task || task.status === "completed") return [];
        const assignments = await tx.select({ userId: taskAssignees.userId, role: users.role })
          .from(taskAssignees)
          .innerJoin(users, eq(users.id, taskAssignees.userId))
          .where(eq(taskAssignees.taskId, task.id));
        const created = [];
        for (const assignee of assignments) {
          const notificationId = randomUUID();
          const [notification] = await tx.insert(notifications).values({
            id: notificationId,
            taskId: task.id,
            recipientId: assignee.userId,
            recipientRole: assignee.role,
            type: "task_calendar_reminder",
            urgency: task.urgency,
            caseId: task.caseId,
            complaintId: task.complaintId,
            appointmentId: task.appointmentId,
            title: `Scheduled task reminder — ${task.title}`,
            message: `Your scheduled task is due to start soon. /tasks?view=calendar&taskId=${task.id}`,
            status: "active",
            caseNoteRequired: false,
          }).returning();
          const [delivery] = await tx.insert(taskReminderDeliveries).values({
            taskScheduleId: current.id,
            taskId: task.id,
            scheduleVersion: current.version,
            userId: assignee.userId,
            notificationId,
            sentAt: now,
          }).onConflictDoNothing().returning();
          if (!delivery) {
            await tx.delete(notifications).where(eq(notifications.id, notificationId));
            continue;
          }
          created.push(notification);
        }
        await tx.update(taskSchedules).set({ reminderSentAt: now, updatedAt: now }).where(eq(taskSchedules.id, current.id));
        return created;
      });
      for (const notification of createdNotifications) {
        notificationRealtimeService.broadcastToNotificationAudience(notification);
      }
      if (createdNotifications.length > 0) reminded += 1;
    }
    return { reminded };
  }

  async reconcileActiveSchedules(limit = 50): Promise<{ checked: number; restored: number }> {
    const connection = await googleCalendarService.getBfmConnection();
    if (!connection?.googleCalendarConnected || !hasWriteScope(connection.googleScopeGranted)) return { checked: 0, restored: 0 };
    const rows = await db.select().from(taskSchedules)
      .where(and(eq(taskSchedules.active, true), inArray(taskSchedules.deliveryKind, ["bfm", "bfm_invite"])))
      .orderBy(asc(taskSchedules.updatedAt))
      .limit(limit);
    let restored = 0;
    for (const schedule of rows) {
      const expected = await this.eventPayload(schedule.taskId, schedule) as Record<string, any>;
      let actual = schedule.googleEventId
        ? await googleCalendarService.getInternalTaskEvent(schedule.googleEventId)
        : null;
      const expectedStart = expected.start ?? {};
      const expectedEnd = expected.end ?? {};
      const drifted = !actual
        || actual.summary !== expected.summary
        || actual.description !== expected.description
        || (actual.start?.dateTime ?? actual.start?.date) !== (expectedStart.dateTime ?? expectedStart.date)
        || (actual.end?.dateTime ?? actual.end?.date) !== (expectedEnd.dateTime ?? expectedEnd.date)
        || actual.extendedProperties?.private?.taskId !== schedule.taskId
        || actual.extendedProperties?.private?.scheduleVersion !== String(schedule.version);
      if (drifted) {
        await this.requeueForReconciliation(schedule.taskId, schedule, expected);
        await this.processTaskJobs(schedule.taskId, true);
        restored += 1;
      }
    }
    return { checked: rows.length, restored };
  }

  async listCalendar(
    actor: { id: string; role: string },
    range: { start: Date; end: Date },
    filters: TaskFilters,
    selectedTaskId?: string,
  ) {
    const audience = actor.role === "mediator" ? "mediator" : "internal";
    const visible = await taskService.list(actor, actor.role === "superadmin" ? { ...filters, includeUpcoming: true } : { ...filters, audience, includeUpcoming: true });
    const events = visible.filter((item) => {
      const schedule = item.schedule;
      if (!schedule?.active || item.status === "completed") return false;
      if (schedule.kind === "timed") return !!schedule.startAt && !!schedule.endAt && schedule.startAt < range.end && schedule.endAt > range.start;
      return !!schedule.allDayStart && !!schedule.allDayEndExclusive
        && schedule.allDayStart < range.end.toISOString().slice(0, 10)
        && schedule.allDayEndExclusive > range.start.toISOString().slice(0, 10);
    });
    const unscheduled = visible.filter((item) => !["completed", "cancelled"].includes(item.status) && !item.schedule?.active);
    const conn = await googleCalendarService.getBfmConnection();
    const selectedTask = selectedTaskId ? await taskService.getVisible(actor, selectedTaskId) : null;
    return {
      events,
      unscheduled,
      selectedTask: selectedTask && (actor.role === "superadmin" || selectedTask.audience === audience) ? selectedTask : null,
      syncHealth: taskCalendarConnectionHealth({
        connected: !!conn?.googleCalendarConnected,
        hasWriteScope: hasWriteScope(conn?.googleScopeGranted),
        accountEmail: conn?.googleCalendarEmail ?? null,
        lastError: conn?.lastHealthCheckError ?? null,
      }),
    };
  }
}

export const taskCalendarService = new TaskCalendarService();
