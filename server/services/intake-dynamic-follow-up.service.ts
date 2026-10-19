import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, caseActivities, caseConfidentialNotes, cases, notificationAssignees, notifications, users, type Notification } from "@shared/schema";
import { db } from "../db";
import { isIntakeAdminRole, validateIntakeWorker } from "./intake-access-policy";
import { notificationRealtimeService } from "./notification-realtime.service";
import { taskService } from "./task.service";
import { taskCalendarService } from "./task-calendar.service";
import { DYNAMIC_INTAKE_FOLLOW_UP_TYPE, buildDynamicFollowUpSchedule, dynamicFollowUpAudience, type DynamicFollowUpTimeWindow } from "./intake-dynamic-follow-up";

const OPEN = ["active", "in_progress", "follow_up"] as const;

export async function completeDynamicIntakeFollowUp(input: {
  caseId: string; taskId: string; actor: { id: string; name: string; role: string }; contactMethod: string; notes: string;
  intervalDays?: number; followUpDate?: string; assignedUserIds: string[]; timeWindow?: DynamicFollowUpTimeWindow | null;
}): Promise<{ ok: true; notification: Notification } | { ok: false; status: 400 | 403 | 404 | 409; message: string }> {
  let schedule: ReturnType<typeof buildDynamicFollowUpSchedule>;
  try { schedule = buildDynamicFollowUpSchedule({ from: new Date(), intervalDays: input.intervalDays, followUpDate: input.followUpDate, timeWindow: input.timeWindow }); }
  catch (error) { return { ok: false, status: 400, message: error instanceof Error ? error.message : "Invalid follow-up schedule" }; }
  const audience = dynamicFollowUpAudience(input.assignedUserIds);
  const { assigneeIds } = audience;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${cases} WHERE ${cases.id} = ${input.caseId} FOR UPDATE`);
    const [caseRecord] = await tx.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
    if (!caseRecord) return { ok: false as const, status: 404 as const, message: "Case not found" };
    if (caseRecord.status === "Closed" || caseRecord.status === "Archived" || caseRecord.intakeStatus === "Closed" || caseRecord.standardChaseStopped) return { ok: false as const, status: 409 as const, message: "Intake follow-up is no longer active" };
    const worker = validateIntakeWorker(caseRecord, input.actor);
    if (!worker.ok) return worker;
    const [task] = await tx.select().from(notifications).where(and(eq(notifications.id, input.taskId), eq(notifications.caseId, input.caseId))).for("update");
    if (!task || task.type !== DYNAMIC_INTAKE_FOLLOW_UP_TYPE) return { ok: false as const, status: 404 as const, message: "Dynamic intake follow-up not found" };
    const existingAssignees = await tx.select({ userId: notificationAssignees.userId }).from(notificationAssignees).where(eq(notificationAssignees.notificationId, task.id));
    if (!isIntakeAdminRole(input.actor.role) && !existingAssignees.some((row) => row.userId === input.actor.id)) return { ok: false as const, status: 403 as const, message: "Access denied" };
    if (!(OPEN as readonly string[]).includes(task.status)) return { ok: false as const, status: 409 as const, message: "Follow-up is already completed" };
    const valid = assigneeIds.length ? await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, assigneeIds), inArray(users.role, ["superadmin", "subadmin", "staff"]), eq(users.status, "active"))) : [];
    if (valid.length !== assigneeIds.length) return { ok: false as const, status: 400 as const, message: "Assignees must be active staff members" };
    const completionNotes = `Contact method: ${input.contactMethod}\n\n${input.notes.trim()}`;
    const [completed] = await tx.update(notifications).set({ status: "completed", completedBy: input.actor.id, completedAt: new Date(), completionNotes }).where(eq(notifications.id, task.id)).returning();
    const [next] = await tx.insert(notifications).values({ recipientRole: audience.recipientRole, type: DYNAMIC_INTAKE_FOLLOW_UP_TYPE, urgency: "amber", caseId: input.caseId, title: `Enquiry follow-up — ${caseRecord.caseRef}`, message: "Dynamic intake follow-up. Completion notes are required before closing this task.", status: "active", assignedTo: audience.assignedTo, followUpDate: schedule.dueAt, intakeFollowUpIntervalDays: schedule.intervalDays, intakeFollowUpScheduledBy: input.actor.id, caseNoteRequired: true }).returning();
    if (assigneeIds.length) await tx.insert(notificationAssignees).values(assigneeIds.map((userId) => ({ notificationId: next.id, userId, assignedBy: input.actor.id })));
    await tx.insert(caseConfidentialNotes).values({ caseId: input.caseId, category: "Case Update", content: completionNotes, createdBy: input.actor.id });
    await tx.insert(auditLogs).values({ userId: input.actor.id, action: "case_intake_dynamic_follow_up_completed", entity: "case", entityId: input.caseId, entityRef: caseRecord.caseRef, details: JSON.stringify({ taskId: task.id, nextTaskId: next.id, intervalDays: schedule.intervalDays, followUpDate: schedule.followUpDate, assigneeIds }) });
    await tx.insert(caseActivities).values({ caseId: input.caseId, type: "task_completed", title: "Follow-up completed", description: completionNotes, performedBy: input.actor.id, performedByName: input.actor.name, actorType: "staff", relatedEntityId: task.id, relatedEntityType: "task", occurredAt: new Date() });
    return { ok: true as const, notification: completed, next, assigneeIds };
  });
  if (!result.ok) return result;
  await taskCalendarService.removeSchedule(result.notification.id);
  await taskService.mirrorLegacyNotification({ ...result.notification, assignedUserIds: [] }, input.actor.id);
  await taskService.mirrorLegacyNotification({ ...result.next, assignedUserIds: result.assigneeIds }, input.actor.id);
  if (result.assigneeIds.length) await taskCalendarService.setSchedule(result.next.id, schedule.schedule);
  notificationRealtimeService.broadcastToNotificationAudience({ ...result.notification, assignedUserIds: [] }, "notification_updated");
  notificationRealtimeService.broadcastToNotificationAudience({ ...result.next, assignedUserIds: result.assigneeIds });
  return { ok: true, notification: result.notification };
}
