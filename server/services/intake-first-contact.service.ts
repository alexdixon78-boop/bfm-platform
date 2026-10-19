import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  caseActivities,
  cases,
  enquiries,
  notifications,
  notificationAssignees,
  users,
  type Case,
  type Notification,
} from "@shared/schema";
import { notificationRealtimeService } from "./notification-realtime.service";
import { supersededIntakeTaskUpdate } from "./intake-task-state";
import { addFiveCalendarDays, hasOpenLaterStageTask, reconcileDay5Tasks, validateLockedFirstContact, type IntakeFirstContactActor } from "./intake-first-contact.transition";
import { isIntakeAdminRole } from "./intake-access-policy";
import { DYNAMIC_INTAKE_FOLLOW_UP_TYPE, buildDynamicFollowUpSchedule, dynamicFollowUpAudience, type DynamicFollowUpTimeWindow } from "./intake-dynamic-follow-up";
import { taskService } from "./task.service";
import { taskCalendarService } from "./task-calendar.service";

const OPEN_TASK_STATUSES = ["active", "in_progress", "follow_up"] as const;
const DAY_0_TASK_TYPE = "enquiry_follow_up";
const DAY_5_TASK_TYPE = "enquiry_chase";

export type { IntakeFirstContactActor } from "./intake-first-contact.transition";

export type IntakeFirstContactResult =
  | { ok: true; caseRecord: Case; day5Task: Notification; createdDay5Task: boolean }
  | { ok: false; status: 400 | 404 | 409; message: string };

function openTaskCondition(caseId: string) {
  return and(
    eq(notifications.caseId, caseId),
    inArray(notifications.status, [...OPEN_TASK_STATUSES]),
  );
}

/**
 * Records the immutable Day 0 contact and advances the intake workflow in one
 * database transaction. Realtime notifications are deliberately published only
 * after that transaction has committed.
 */
export async function recordIntakeFirstContact(input: {
  caseId: string;
  contactMethod: string;
  notes?: string;
  actor: IntakeFirstContactActor;
  now?: Date;
}): Promise<IntakeFirstContactResult> {
  const now = input.now ?? new Date();
  const notes = input.notes?.trim() || null;

  const outcome = await db.transaction(async (tx) => {
    // Lock before reading workflow gates so simultaneous requests cannot both
    // pass the immutable Day 0 check.
    await tx.execute(sql`SELECT 1 FROM ${cases} WHERE ${cases.id} = ${input.caseId} FOR UPDATE`);
    const [existing] = await tx.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
    if (!existing) return { ok: false as const, status: 404 as const, message: "Case not found" };
    const gate = validateLockedFirstContact(existing, input.actor);
    if (!gate.ok) return gate;
    const laterStageTasks = await tx.select().from(notifications).where(and(
      eq(notifications.caseId, input.caseId),
      inArray(notifications.status, [...OPEN_TASK_STATUSES]),
      inArray(notifications.type, [DAY_5_TASK_TYPE, "enquiry_persistent_follow_up"]),
    ));
    if (hasOpenLaterStageTask(laterStageTasks)) {
      return { ok: false as const, status: 409 as const, message: "Later-stage intake follow-up is already open" };
    }

    const safeguardingConcernActive = existing.safeguardingStatus === "concern";
    const claimBypass = isIntakeAdminRole(input.actor.role) && !!existing.claimedBy && existing.claimedBy !== input.actor.id;
    const nextIntakeStatus = safeguardingConcernActive ? "Safeguarding" : "Chasing";

    const [caseRecord] = await tx.update(cases)
      .set({
        firstContactAttemptedAt: now,
        firstContactMethod: input.contactMethod,
        firstContactNotes: notes,
        intakeStatus: nextIntakeStatus,
        lastUpdated: now,
      })
      .where(eq(cases.id, input.caseId))
      .returning();

    await tx.update(enquiries)
      .set({ status: nextIntakeStatus })
      .where(eq(enquiries.convertedCaseId, input.caseId));

    const completedDay0Tasks = await tx.update(notifications)
      .set({
        status: "completed",
        completedBy: input.actor.id,
        completedAt: now,
        completionNotes: "Completed when Day 0 first contact was recorded.",
      })
      .where(and(openTaskCondition(input.caseId), eq(notifications.type, DAY_0_TASK_TYPE)))
      .returning();

    const intakeTasks = await tx.select().from(notifications)
      .where(and(
        eq(notifications.caseId, input.caseId),
        inArray(notifications.type, [DAY_0_TASK_TYPE, DAY_5_TASK_TYPE, "enquiry_persistent_follow_up"]),
      ))
      .orderBy(asc(notifications.createdAt), asc(notifications.id));
    const reconciliation = reconcileDay5Tasks(intakeTasks, now);
    const completedDuplicateTasks: Notification[] = [];
    for (const duplicate of intakeTasks.filter((task) => reconciliation.completeTaskIds.includes(task.id))) {
      const [completed] = await tx.update(notifications)
        .set(supersededIntakeTaskUpdate(duplicate, "day0", input.actor.id, now))
        .where(eq(notifications.id, duplicate.id)).returning();
      completedDuplicateTasks.push(completed);
    }
    let day5Task: Notification;
    let createdDay5Task = false;
    if (reconciliation.reuseTaskId) {
      [day5Task] = await tx.update(notifications)
        .set({ status: "active", followUpDate: reconciliation.dueAt })
        .where(eq(notifications.id, reconciliation.reuseTaskId))
        .returning();
    } else {
      [day5Task] = await tx.insert(notifications).values({
        recipientRole: "admin",
        type: DAY_5_TASK_TYPE,
        urgency: "amber",
        caseId: input.caseId,
        title: `Day 5 chase — ${caseRecord.caseRef}`,
        message: "[day-5] Standard SOP enquiry chase. Completion notes are required before closing this task.",
        status: "active",
        followUpDate: reconciliation.dueAt,
        caseNoteRequired: true,
      }).returning();
      createdDay5Task = true;
    }

    await tx.insert(auditLogs).values({
      userId: input.actor.id,
      action: "case_intake_first_contact",
      entity: "case",
      entityId: input.caseId,
      entityRef: caseRecord.caseRef,
      details: JSON.stringify({
        contactMethod: input.contactMethod,
        notes,
        firstContactAttemptedAt: now.toISOString(),
        safeguardingConcernActive,
        claimOwnerId: existing.claimedBy || null,
        claimBypass,
        actorRole: input.actor.role,
      }),
    });
    if (createdDay5Task) {
      await tx.insert(auditLogs).values({
        userId: input.actor.id,
        action: "case_intake_day5_chase_created",
        entity: "case",
        entityId: input.caseId,
        entityRef: caseRecord.caseRef,
        details: JSON.stringify({ taskId: day5Task.id, followUpDate: day5Task.followUpDate }),
      });
    }
    await tx.insert(caseActivities).values([
      {
        caseId: input.caseId,
        type: "first_contact_attempted",
        title: "First contact attempted",
        description: `${input.contactMethod} attempted${notes ? `: ${notes.slice(0, 500)}` : "."}`,
        metadata: JSON.stringify({ contactMethod: input.contactMethod, notes }),
        performedBy: input.actor.id,
        performedByName: input.actor.name,
        actorType: input.actor.role === "mediator" ? "mediator" : "staff",
        relatedEntityType: "case",
        occurredAt: now,
      },
      ...(createdDay5Task ? [{
        caseId: input.caseId,
        type: "task_created",
        title: "Task created",
        description: `Created task: ${day5Task.title}`,
        metadata: JSON.stringify({ taskId: day5Task.id, urgency: day5Task.urgency }),
        performedBy: input.actor.id,
        performedByName: input.actor.name,
        actorType: input.actor.role === "mediator" ? "mediator" : "staff",
        relatedEntityId: day5Task.id,
        relatedEntityType: "notification",
        occurredAt: now,
      }] : []),
    ]);

    return {
      ok: true as const,
      caseRecord,
      day5Task,
      createdDay5Task,
      completedDay0Tasks: [...completedDay0Tasks, ...completedDuplicateTasks],
    };
  });

  if (!outcome.ok) return outcome;
  for (const task of outcome.completedDay0Tasks) {
    notificationRealtimeService.broadcastToNotificationAudience(task, "notification_updated");
  }
  if (outcome.createdDay5Task) {
    notificationRealtimeService.broadcastToNotificationAudience(outcome.day5Task);
  } else {
    notificationRealtimeService.broadcastToNotificationAudience(outcome.day5Task, "notification_updated");
  }
  return outcome;
}

/** New enquiries opt into the configurable follow-up workflow without touching legacy chains. */
export async function recordDynamicIntakeFirstContact(input: {
  caseId: string; contactMethod: string; notes?: string; actor: IntakeFirstContactActor;
  intervalDays?: number; followUpDate?: string; assignedUserIds: string[]; timeWindow?: DynamicFollowUpTimeWindow | null; now?: Date;
}): Promise<IntakeFirstContactResult> {
  const now = input.now ?? new Date();
  let schedule: ReturnType<typeof buildDynamicFollowUpSchedule>;
  try { schedule = buildDynamicFollowUpSchedule({ from: now, intervalDays: input.intervalDays, followUpDate: input.followUpDate, timeWindow: input.timeWindow }); }
  catch (error) { return { ok: false, status: 400, message: error instanceof Error ? error.message : "Invalid follow-up schedule" }; }
  const audience = dynamicFollowUpAudience(input.assignedUserIds);
  const { assigneeIds } = audience;
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM ${cases} WHERE ${cases.id} = ${input.caseId} FOR UPDATE`);
    const [existing] = await tx.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
    if (!existing) return { ok: false as const, status: 404 as const, message: "Case not found" };
    const gate = validateLockedFirstContact(existing, input.actor);
    if (!gate.ok) return gate;
    const assignees = assigneeIds.length ? await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, assigneeIds), inArray(users.role, ["superadmin", "subadmin", "staff"]), eq(users.status, "active"))) : [];
    if (assignees.length !== assigneeIds.length) return { ok: false as const, status: 400 as const, message: "Assignees must be active staff members" };
    const open = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.caseId, input.caseId), inArray(notifications.status, [...OPEN_TASK_STATUSES]), inArray(notifications.type, [DAY_5_TASK_TYPE, "enquiry_persistent_follow_up", DYNAMIC_INTAKE_FOLLOW_UP_TYPE])));
    if (open.length) return { ok: false as const, status: 409 as const, message: "An intake follow-up is already open" };
    const [caseRecord] = await tx.update(cases).set({ firstContactAttemptedAt: now, firstContactMethod: input.contactMethod, firstContactNotes: input.notes?.trim() || null, intakeStatus: existing.safeguardingStatus === "concern" ? "Safeguarding" : "Chasing", lastUpdated: now }).where(eq(cases.id, input.caseId)).returning();
    await tx.update(enquiries).set({ status: caseRecord.intakeStatus }).where(eq(enquiries.convertedCaseId, input.caseId));
    await tx.update(notifications).set({ status: "completed", completedBy: input.actor.id, completedAt: now, completionNotes: "Completed when first contact was recorded." }).where(and(openTaskCondition(input.caseId), eq(notifications.type, DAY_0_TASK_TYPE)));
    const [task] = await tx.insert(notifications).values({ recipientRole: audience.recipientRole, type: DYNAMIC_INTAKE_FOLLOW_UP_TYPE, urgency: "amber", caseId: input.caseId, title: `Enquiry follow-up — ${caseRecord.caseRef}`, message: "Dynamic intake follow-up. Completion notes are required before closing this task.", status: "active", assignedTo: audience.assignedTo, followUpDate: schedule.dueAt, intakeFollowUpIntervalDays: schedule.intervalDays, intakeFollowUpScheduledBy: input.actor.id, caseNoteRequired: true }).returning();
    if (assigneeIds.length) await tx.insert(notificationAssignees).values(assigneeIds.map((userId) => ({ notificationId: task.id, userId, assignedBy: input.actor.id })));
    await tx.insert(auditLogs).values({ userId: input.actor.id, action: "case_intake_first_contact", entity: "case", entityId: input.caseId, entityRef: caseRecord.caseRef, details: JSON.stringify({ contactMethod: input.contactMethod, intervalDays: schedule.intervalDays, assigneeIds, followUpDate: schedule.followUpDate }) });
    await tx.insert(caseActivities).values({ caseId: input.caseId, type: "task_created", title: "Follow-up scheduled", description: `Created follow-up in ${schedule.intervalDays} day(s).`, metadata: JSON.stringify({ taskId: task.id, intervalDays: schedule.intervalDays, followUpDate: schedule.followUpDate, assigneeIds }), performedBy: input.actor.id, performedByName: input.actor.name, actorType: "staff", relatedEntityId: task.id, relatedEntityType: "task", occurredAt: now });
    return { ok: true as const, caseRecord, day5Task: task, createdDay5Task: true, assigneeIds };
  });
  if (!outcome.ok) return outcome;
  await taskService.mirrorLegacyNotification({ ...outcome.day5Task, assignedUserIds: outcome.assigneeIds }, input.actor.id);
  if (outcome.assigneeIds.length) await taskCalendarService.setSchedule(outcome.day5Task.id, schedule.schedule);
  notificationRealtimeService.broadcastToNotificationAudience({ ...outcome.day5Task, assignedUserIds: outcome.assigneeIds });
  return outcome;
}
