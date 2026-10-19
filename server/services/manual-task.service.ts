import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { notificationAssignees, notifications, taskCalendarSyncJobs, taskSchedules, taskSeries, tasks, users } from "@shared/schema";
import { parseTaskSchedule } from "@shared/task-domain";
import { manualTaskPlan, occurrenceTaskStatus } from "@shared/manual-task-plan";
import { type TaskFrequency } from "@shared/task-recurrence";
import { db } from "../db";
import { caseTaskOptions } from "./manual-task-case.service";
import { eligibleCaseTaskAssignees } from "./manual-task-policy";
import { taskCalendarService } from "./task-calendar.service";
import { notificationRealtimeService } from "./notification-realtime.service";

export type ManualTaskInput = {
  title: string;
  message: string;
  urgency: "red" | "amber" | "green";
  caseId?: string | null;
  assignedUserIds: string[];
  schedule: unknown;
};

type SeriesInput = ManualTaskInput & { frequency: TaskFrequency; endDate?: string | null };

function badRequest(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function dateOfSchedule(schedule: ReturnType<typeof parseTaskSchedule>): string {
  return schedule.kind === "all_day" ? schedule.startDate : new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(schedule.startAt);
}

function horizon(now = new Date()): string {
  const year = now.getUTCFullYear() + 1;
  const month = now.getUTCMonth();
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

async function validateInput(actor: { id: string; role: string }, input: ManualTaskInput) {
  if (!input.title?.trim() || !input.message?.trim() || !["red", "amber", "green"].includes(input.urgency)) badRequest("Title, details and urgency are required");
  if (!Array.isArray(input.assignedUserIds) || input.assignedUserIds.length === 0) badRequest("Choose at least one assignee");
  const ids = Array.from(new Set(input.assignedUserIds));
  if (ids.length > 20) badRequest("Choose no more than 20 assignees");
  const assignees = await db.select({ id: users.id, role: users.role, status: users.status, email: users.email })
    .from(users).where(inArray(users.id, ids));
  if (assignees.length !== ids.length || assignees.some((person) => person.status !== "active" || !["superadmin", "subadmin", "staff", "mediator"].includes(person.role))) {
    badRequest("Assignees must be active internal users or mediators");
  }
  if (actor.role !== "superadmin" && (input.caseId || assignees.some((person) => person.role === "mediator"))) badRequest("Only superadmins can link cases or assign mediators", 403);
  if (input.caseId) {
    const options = await caseTaskOptions(input.caseId);
    if (!options) badRequest("Case not found", 404);
    const eligible = new Set(options.mediators.map((person) => person.id));
    const allowed = new Set(eligibleCaseTaskAssignees(assignees, eligible, actor.id, options.hasLeadMediator));
    if (assignees.some((person) => !allowed.has(person.id))) badRequest("One or more mediators do not have access to the selected case");
  }
  const schedule = parseTaskSchedule(input.schedule);
  return { assignees, schedule, ids, firstDate: dateOfSchedule(schedule) };
}

async function insertOccurrences(tx: any, input: ManualTaskInput, actorId: string | null, rows: ReturnType<typeof manualTaskPlan>, roles: Map<string, string>, seriesId?: string) {
  const createdIds: string[] = [];
  for (const row of rows) {
    const id = randomUUID();
    const role = roles.get(row.assigneeId)!;
    const start = row.schedule.kind === "timed" ? new Date(row.schedule.startAt) : new Date(`${row.occurrenceDate}T00:00:00Z`);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await tx.insert(notifications).values({
      id, recipientId: row.assigneeId, recipientRole: role === "mediator" ? "mediator" : "task_assignee",
      type: "task", urgency: input.urgency, caseId: input.caseId || null, title: input.title.trim(), message: input.message.trim(),
      assignedTo: row.assigneeId, followUpDate: start, status: seriesId ? occurrenceTaskStatus(row.occurrenceDate, today) : "active",
    });
    await tx.insert(notificationAssignees).values({ notificationId: id, userId: row.assigneeId, assignedBy: actorId });
    if (seriesId) await tx.update(tasks).set({ seriesId, seriesAssigneeId: row.assigneeId, occurrenceDate: row.occurrenceDate }).where(eq(tasks.id, id));
    const [saved] = await tx.insert(taskSchedules).values({
      taskId: id, kind: row.schedule.kind,
      startAt: row.schedule.kind === "timed" ? new Date(row.schedule.startAt) : null,
      endAt: row.schedule.kind === "timed" ? new Date(row.schedule.endAt) : null,
      allDayStart: row.schedule.kind === "all_day" ? row.schedule.startDate : null,
      allDayEndExclusive: row.schedule.kind === "all_day" ? row.schedule.endDateExclusive : null,
      reminderMinutes: row.schedule.reminderMinutes,
      deliveryKind: "auto", deliveryUserId: row.assigneeId,
    }).returning();
    await tx.insert(taskCalendarSyncJobs).values({ taskId: id, taskScheduleId: saved.id, operation: "upsert", scheduleVersion: 1, status: "pending", nextAttemptAt: new Date() });
    createdIds.push(id);
  }
  return createdIds;
}

export async function createManualTasks(actor: { id: string; role: string }, input: ManualTaskInput) {
  const { assignees, schedule, ids, firstDate } = await validateInput(actor, input);
  const rows = manualTaskPlan({ assigneeIds: ids, schedule, firstDate, throughDate: firstDate });
  const createdIds = await db.transaction((tx) => insertOccurrences(tx, input, actor.id, rows, new Map(assignees.map((person) => [person.id, person.role]))));
  await publishCreated(createdIds);
  return createdIds;
}

export async function createTaskSeries(actor: { id: string; role: string }, input: SeriesInput) {
  if (actor.role !== "superadmin") badRequest("Only superadmins can create recurring tasks", 403);
  if (!["daily", "weekly", "monthly"].includes(input.frequency)) badRequest("Invalid frequency");
  const { assignees, schedule, ids, firstDate } = await validateInput(actor, input);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (firstDate < today) badRequest("A recurring series must start today or later");
  if (input.endDate && (input.endDate < firstDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))) badRequest("End date must be on or after the first date");
  const upper = horizon() < firstDate ? firstDate : horizon();
  const throughDate = input.endDate && input.endDate < upper ? input.endDate : upper;
  const rows = manualTaskPlan({ assigneeIds: ids, schedule, frequency: input.frequency, firstDate, throughDate });
  const { seriesId, createdIds } = await db.transaction(async (tx) => {
    const [series] = await tx.insert(taskSeries).values({
      title: input.title.trim(), message: input.message.trim(), urgency: input.urgency, caseId: input.caseId || null,
      frequency: input.frequency, firstDate, endDate: input.endDate || null, schedule: input.schedule as Record<string, unknown>,
      assigneeIds: ids, generatedThrough: throughDate, createdBy: actor.id,
    }).returning();
    const createdIds = await insertOccurrences(tx, input, actor.id, rows, new Map(assignees.map((person) => [person.id, person.role])), series.id);
    return { seriesId: series.id, createdIds };
  });
  await publishCreated(createdIds);
  return { seriesId, taskIds: createdIds };
}

export async function extendTaskSeries(now = new Date()) {
  const active = await db.select().from(taskSeries).where(eq(taskSeries.active, true));
  const upper = horizon(now);
  let count = 0;
  for (const series of active) {
    const currentAssignees = await db.select({ id: users.id, role: users.role, status: users.status }).from(users).where(inArray(users.id, series.assigneeIds));
    const options = series.caseId ? await caseTaskOptions(series.caseId) : null;
    const eligible = new Set(options?.mediators.map((person) => person.id) || []);
    if (currentAssignees.length !== series.assigneeIds.length || currentAssignees.some((person) => person.status !== "active" || (series.caseId && person.role === "mediator" && !eligible.has(person.id))) || (series.caseId && !options)) {
      await stopTaskSeries({ id: series.createdBy || "", role: "superadmin" }, series.id);
      continue;
    }
    const throughDate = series.endDate && series.endDate < upper ? series.endDate : upper;
    if (series.generatedThrough && series.generatedThrough >= throughDate) continue;
    const schedule = parseTaskSchedule(series.schedule);
    const rows = manualTaskPlan({ assigneeIds: series.assigneeIds, schedule, frequency: series.frequency as TaskFrequency, firstDate: series.firstDate, throughDate, afterDate: series.generatedThrough || undefined });
    const roles = currentAssignees;
    const ids = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${series.id}))`);
      const [fresh] = await tx.select().from(taskSeries).where(eq(taskSeries.id, series.id));
      if (!fresh?.active || (fresh.generatedThrough && fresh.generatedThrough >= throughDate)) return [];
      const pending = rows.filter((row) => !fresh.generatedThrough || row.occurrenceDate > fresh.generatedThrough);
      const created = await insertOccurrences(tx, { title: fresh.title, message: fresh.message, urgency: fresh.urgency as ManualTaskInput["urgency"], caseId: fresh.caseId, assignedUserIds: fresh.assigneeIds, schedule: fresh.schedule }, fresh.createdBy, pending, new Map(roles.map((person) => [person.id, person.role])), series.id);
      await tx.update(taskSeries).set({ generatedThrough: throughDate, updatedAt: new Date() }).where(eq(taskSeries.id, series.id));
      return created;
    });
    await publishCreated(ids);
    count += ids.length;
  }
  return count;
}

async function publishCreated(ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select().from(notifications).where(inArray(notifications.id, ids));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.status !== "scheduled") notificationRealtimeService.broadcastToNotificationAudience(row);
    if (index < 10) taskCalendarService.scheduleImmediate(row.id);
  }
}

export async function activateDueTaskOccurrences(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const due = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.status, "scheduled"), sql`${tasks.occurrenceDate} <= ${today}`)).limit(100);
  if (!due.length) return 0;
  const ids = due.map((row) => row.id);
  const activated = await db.update(notifications).set({ status: "active" }).where(and(inArray(notifications.id, ids), eq(notifications.status, "scheduled"))).returning();
  for (const row of activated) notificationRealtimeService.broadcastToNotificationAudience(row);
  return activated.length;
}

export async function stopTaskSeries(actor: { id: string; role: string }, seriesId: string, fromDate?: string, reason?: string | null) {
  if (!["superadmin", "subadmin"].includes(actor.role)) badRequest("Only administrators can cancel recurring tasks", 403);
  if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) badRequest("Choose a valid occurrence date");
  const [series] = await db.select().from(taskSeries).where(eq(taskSeries.id, seriesId));
  if (!series) badRequest("Series not found", 404);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const cutoff = fromDate && fromDate > today ? fromDate : today;
  const future = await db.select({ id: tasks.id }).from(tasks).where(and(
    eq(tasks.seriesId, seriesId),
    gte(tasks.occurrenceDate, cutoff),
    ne(tasks.status, "completed"),
    ne(tasks.status, "cancelled"),
  ));
  await cancelTaskIds(actor, future.map((task) => task.id), reason);
  await db.transaction(async (tx) => {
    await tx.update(taskSeries).set({ active: false, endDate: cutoff, updatedAt: new Date() }).where(eq(taskSeries.id, seriesId));
  });
  return future.length;
}

export async function cancelTaskIds(actor: { id: string; role: string }, ids: string[], reason?: string | null) {
  if (!["superadmin", "subadmin"].includes(actor.role)) badRequest("Only administrators can cancel tasks", 403);
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return 0;
  const openTasks = await db.select({ id: tasks.id }).from(tasks).where(and(
    inArray(tasks.id, uniqueIds),
    eq(tasks.audience, "internal"),
    ne(tasks.status, "completed"),
    ne(tasks.status, "cancelled"),
  ));
  if (openTasks.length !== uniqueIds.length) badRequest("Only open internal tasks can be cancelled", 409);
  for (const task of openTasks) await taskCalendarService.removeSchedule(task.id);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(tasks).set({
      status: "cancelled", cancelledBy: actor.id, cancelledAt: now,
      cancellationReason: reason?.trim() || null, updatedAt: now,
    }).where(inArray(tasks.id, uniqueIds));
    await tx.update(notifications).set({ status: "cancelled" }).where(inArray(notifications.id, uniqueIds));
  });
  const updatedNotifications = await db.select().from(notifications).where(inArray(notifications.id, uniqueIds));
  for (const notification of updatedNotifications) notificationRealtimeService.broadcastToNotificationAudience(notification, "notification_updated");
  return uniqueIds.length;
}

export async function replaceFutureTaskSeries(actor: { id: string; role: string }, seriesId: string, fromDate: string, input: SeriesInput) {
  if (actor.role !== "superadmin") badRequest("Only superadmins can edit recurring tasks", 403);
  if (typeof fromDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) badRequest("Choose a valid occurrence date");
  const [old] = await db.select().from(taskSeries).where(eq(taskSeries.id, seriesId));
  if (!old?.active) badRequest("Active series not found", 404);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (fromDate < today) badRequest("Choose a current or future occurrence to change the series");
  const parsed = parseTaskSchedule(input.schedule);
  const nextFirstDate = dateOfSchedule(parsed);
  if (nextFirstDate < fromDate) badRequest("The new series must start on or after the selected occurrence date");
  if (!["daily", "weekly", "monthly"].includes(input.frequency)) badRequest("Invalid frequency");
  if (input.endDate && (input.endDate < nextFirstDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))) badRequest("End date must be on or after the first date");
  const { assignees, schedule, ids, firstDate } = await validateInput(actor, input);
  const upper = horizon() < firstDate ? firstDate : horizon();
  const throughDate = input.endDate && input.endDate < upper ? input.endDate : upper;
  const rows = manualTaskPlan({ assigneeIds: ids, schedule, frequency: input.frequency, firstDate, throughDate });
  const { newSeriesId, createdIds, deletedNotifications } = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${seriesId}))`);
    const [current] = await tx.select().from(taskSeries).where(eq(taskSeries.id, seriesId));
    if (!current?.active) badRequest("Active series not found", 404);
    const future = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.seriesId, seriesId), gte(tasks.occurrenceDate, fromDate), ne(tasks.status, "completed")));
    const futureIds = future.map((task) => task.id);
    if (futureIds.length) {
      const schedules = await tx.select().from(taskSchedules).where(inArray(taskSchedules.taskId, futureIds));
      for (const existing of schedules) {
        if (existing.active && existing.googleEventId) {
          await tx.insert(taskCalendarSyncJobs).values({
            taskId: existing.taskId, taskScheduleId: existing.id, operation: "delete", scheduleVersion: existing.version + 1,
            googleEventId: existing.googleEventId, deliveryKind: existing.deliveryKind, deliveryUserId: existing.deliveryUserId,
            status: "pending", nextAttemptAt: new Date(),
          }).onConflictDoNothing();
        }
      }
    }
    await tx.update(taskSeries).set({ active: false, endDate: fromDate, updatedAt: new Date() }).where(eq(taskSeries.id, seriesId));
    const deletedNotifications = futureIds.length ? await tx.delete(notifications).where(inArray(notifications.id, futureIds)).returning() : [];
    if (futureIds.length) await tx.delete(tasks).where(inArray(tasks.id, futureIds));
    const [replacement] = await tx.insert(taskSeries).values({
      title: input.title.trim(), message: input.message.trim(), urgency: input.urgency, caseId: input.caseId || null,
      frequency: input.frequency, firstDate, endDate: input.endDate || null, schedule: input.schedule as Record<string, unknown>,
      assigneeIds: ids, generatedThrough: throughDate, createdBy: actor.id,
    }).returning();
    const createdIds = await insertOccurrences(tx, input, actor.id, rows, new Map(assignees.map((person) => [person.id, person.role])), replacement.id);
    return { newSeriesId: replacement.id, createdIds, deletedNotifications };
  });
  for (const notification of deletedNotifications) notificationRealtimeService.broadcastNotificationDeleted(notification);
  await publishCreated(createdIds);
  return { seriesId: newSeriesId, taskIds: createdIds };
}

export async function editManualTask(actor: { id: string; role: string }, taskId: string, input: ManualTaskInput) {
  if (actor.role !== "superadmin") badRequest("Only superadmins can edit manual tasks", 403);
  if (input.assignedUserIds.length !== 1) badRequest("An individual task must have exactly one assignee");
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.type !== "task") badRequest("Manual task not found", 404);
  if (task.status === "completed") badRequest("Completed task history cannot be edited", 409);
  const { assignees } = await validateInput(actor, input);
  const owner = assignees[0];
  await db.transaction(async (tx) => {
    await tx.update(notifications).set({
      title: input.title.trim(), message: input.message.trim(), urgency: input.urgency, caseId: input.caseId || null,
      assignedTo: owner.id, recipientId: owner.id, recipientRole: owner.role === "mediator" ? "mediator" : "task_assignee",
    }).where(eq(notifications.id, taskId));
    await tx.delete(notificationAssignees).where(eq(notificationAssignees.notificationId, taskId));
    await tx.insert(notificationAssignees).values({ notificationId: taskId, userId: owner.id, assignedBy: actor.id });
    if (task.seriesId) await tx.update(tasks).set({ seriesAssigneeId: owner.id }).where(eq(tasks.id, taskId));
  });
  await taskCalendarService.setSchedule(taskId, input.schedule);
  return taskId;
}
