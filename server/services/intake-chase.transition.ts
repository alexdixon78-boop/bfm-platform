import type { Case, Notification, auditLogs, caseActivities, caseConfidentialNotes } from "@shared/schema";
import type { IntakeFirstContactActor } from "./intake-first-contact.transition";
import { ENQUIRY_CONTACT_METHODS } from "@shared/schema";
import { isSupersededIntakeTask, supersededIntakeTaskUpdate } from "./intake-task-state";
import { isIntakeAdminRole, validateIntakeWorker } from "./intake-access-policy";

const OPEN_STATUSES = ["active", "in_progress", "follow_up"];
const INTAKE_TYPES = ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up"];

function stage(task: Notification): number {
  if (task.type === "enquiry_persistent_follow_up") return 3;
  if (task.type !== "enquiry_chase") return 0;
  const text = `${task.title} ${task.message}`.toLowerCase();
  if (text.includes("day 10") || text.includes("day-10")) return 2;
  if (text.includes("day 5") || text.includes("day-5")) return 1;
  return 0;
}

export type IntakeChaseTask = Notification & { assignedUserIds: string[] };
export type IntakeChaseInput = {
  caseId: string;
  taskId: string;
  actor: IntakeFirstContactActor;
  contactMethod: string;
  notes: string;
  now?: Date;
};
export type IntakeChaseResult =
  | { ok: true; notification: Notification }
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

export interface IntakeChaseTransaction {
  lockCaseAndTasks(caseId: string): Promise<{ caseRecord: Case | undefined; tasks: IntakeChaseTask[] }>;
  updateTask(id: string, values: Partial<Notification>): Promise<Notification>;
  createTask(values: typeof import("@shared/schema").notifications.$inferInsert): Promise<Notification>;
  insertAudit(values: typeof auditLogs.$inferInsert): Promise<void>;
  insertActivity(values: typeof caseActivities.$inferInsert): Promise<void>;
  insertNote(values: typeof caseConfidentialNotes.$inferInsert): Promise<void>;
}

export interface IntakeChaseDependencies {
  transaction<T>(work: (tx: IntakeChaseTransaction) => Promise<T>): Promise<T>;
  publish(task: IntakeChaseTask, event: "notification_created" | "notification_updated"): void;
}

/** Owns the transaction boundary so every durable effect precedes publication. */
export async function completeIntakeChaseTransition(
  input: IntakeChaseInput,
  deps: IntakeChaseDependencies,
): Promise<IntakeChaseResult> {
  if (!["superadmin", "subadmin", "staff"].includes(input.actor.role)) {
    return { ok: false, status: 403, message: "Only authorised staff can record intake chase contacts" };
  }
  if (!(ENQUIRY_CONTACT_METHODS as readonly string[]).includes(input.contactMethod)) {
    return { ok: false, status: 400, message: "Valid contact method is required" };
  }
  if (typeof input.notes !== "string" || !input.notes.trim()) {
    return { ok: false, status: 400, message: "Notes are required" };
  }
  const now = input.now ?? new Date();
  const outcome = await deps.transaction(async (tx) => {
    const { caseRecord, tasks } = await tx.lockCaseAndTasks(input.caseId);
    if (!caseRecord) return { ok: false as const, status: 404 as const, message: "Case not found" };
    if (caseRecord.status === "Closed" || caseRecord.status === "Archived" || caseRecord.intakeStatus === "Closed") {
      return { ok: false as const, status: 400 as const, message: "Closed or archived cases cannot be chased" };
    }
    const adminSafeguardingOverride = caseRecord.safeguardingStatus === "concern" && isIntakeAdminRole(input.actor.role);
    if (caseRecord.standardChaseStopped && !adminSafeguardingOverride) {
      return { ok: false as const, status: 400 as const, message: "Standard chase stopped due to safeguarding" };
    }
    if (caseRecord.safeguardingStatus !== "clear" && !adminSafeguardingOverride) {
      return { ok: false as const, status: 409 as const, message: caseRecord.safeguardingStatus === "concern"
        ? "Safeguarding must be clear before recording chase contact"
        : "Please complete the safeguarding check before recording chase contact" };
    }
    const worker = validateIntakeWorker(caseRecord, input.actor);
    if (!worker.ok) return worker;
    const task = tasks.find((row) => row.id === input.taskId);
    if (!task) return { ok: false as const, status: 404 as const, message: "Chase task not found" };
    if (!stage(task)) return { ok: false as const, status: 400 as const, message: "Task is not an intake chase task" };
    const canAccess = task.recipientRole === "admin"
      || (input.actor.role === "superadmin" && task.recipientRole === "superadmin")
      || task.recipientId === input.actor.id || task.assignedTo === input.actor.id
      || task.assignedUserIds.includes(input.actor.id);
    if (!canAccess) return { ok: false as const, status: 403 as const, message: "Access denied" };

    // Completed history determines the minimum legal stage. Within a stage the
    // oldest open task is canonical; duplicate task IDs must not advance again.
    const minimumStage = tasks.reduce((minimum, row) => row.status === "completed"
      && !isSupersededIntakeTask(row)
      ? Math.max(minimum, Math.min(stage(row) + 1, 3)) : minimum, 1);
    const open = tasks.filter((row) => INTAKE_TYPES.includes(row.type) && OPEN_STATUSES.includes(row.status))
      .sort((a, b) => stage(a) - stage(b) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const current = open.find((row) => stage(row) >= minimumStage);
    if (!OPEN_STATUSES.includes(task.status) || current?.id !== task.id) {
      return { ok: false as const, status: 409 as const, message: "Chase task is already completed or no longer current" };
    }
    if (stage(task) === 1 && !caseRecord.firstContactAttemptedAt) {
      return { ok: false as const, status: 409 as const, message: "First contact must be recorded before completing Day 5" };
    }
    const completionNotes = `Contact method: ${input.contactMethod}\n\n${input.notes.trim()}`;
    const notification = await tx.updateTask(task.id, {
      status: "completed", completedBy: input.actor.id, completedAt: now, completionNotes,
    });
    const nextStage = stage(task) === 1 ? 2 : 3;
    const dueAt = new Date(nextStage === 2 ? caseRecord.firstContactAttemptedAt! : now);
    dueAt.setDate(dueAt.getDate() + (nextStage === 2 ? 10 : 7));
    const reusable = open.find((row) => row.id !== task.id && stage(row) === nextStage);
    const changedTasks: IntakeChaseTask[] = [{ ...notification, assignedUserIds: task.assignedUserIds }];
    for (const duplicate of open.filter((row) => row.id !== task.id && row.id !== reusable?.id)) {
      const updated = await tx.updateTask(duplicate.id, supersededIntakeTaskUpdate(duplicate, "chase", input.actor.id, now));
      changedTasks.push({ ...updated, assignedUserIds: duplicate.assignedUserIds });
    }
    const nextTask = reusable
      ? await tx.updateTask(reusable.id, { followUpDate: dueAt, caseNoteRequired: true })
      : await tx.createTask({
      caseId: input.caseId, recipientRole: "admin", type: nextStage === 2 ? "enquiry_chase" : "enquiry_persistent_follow_up", urgency: "amber",
      title: nextStage === 2 ? `Day 10 chase — ${caseRecord.caseRef}` : `Ongoing enquiry follow-up — ${caseRecord.caseRef}`,
      message: nextStage === 2
        ? "[day-10] Final SOP enquiry chase. Completion notes are required before closing this task."
        : "[persistent] Weekly post-Day-10 enquiry follow-up. Completion notes are required; continue until an intake closure outcome is recorded.",
      status: "active", followUpDate: dueAt, caseNoteRequired: true,
    });
    if (task.caseNoteRequired) await tx.insertNote({
      caseId: input.caseId, category: "Case Update", content: completionNotes, createdBy: input.actor.id,
    });
    const auditBase = { userId: input.actor.id, entity: "case", entityId: input.caseId, entityRef: caseRecord.caseRef };
    const claimBypass = isIntakeAdminRole(input.actor.role) && !!caseRecord.claimedBy && caseRecord.claimedBy !== input.actor.id;
    await tx.insertAudit({ ...auditBase, action: "case_intake_chase_completed",
      details: JSON.stringify({
        taskId: task.id,
        contactMethod: input.contactMethod,
        notes: input.notes.trim().slice(0, 500),
        safeguardingConcernActive: caseRecord.safeguardingStatus === "concern",
        claimOwnerId: caseRecord.claimedBy || null,
        claimBypass,
        actorRole: input.actor.role,
      }) });
    if (!reusable) await tx.insertAudit({ ...auditBase,
      action: nextStage === 2 ? "case_intake_day10_chase_created" : "case_intake_persistent_follow_up_created",
      details: JSON.stringify({ taskId: nextTask.id, followUpDate: nextTask.followUpDate, ...(nextStage === 3 ? { intervalDays: 7 } : {}) }) });
    const activityBase = {
      caseId: input.caseId, performedBy: input.actor.id, performedByName: input.actor.name,
      actorType: "staff", relatedEntityType: "task", occurredAt: now,
    };
    await tx.insertActivity({ ...activityBase, type: "task_completed", title: "Task completed",
      description: `Task "${task.title}" completed: ${completionNotes}`, relatedEntityId: task.id,
      metadata: JSON.stringify({ taskTitle: task.title, outcome: completionNotes }) });
    if (!reusable) await tx.insertActivity({ ...activityBase, type: "task_created", title: "Task created",
      description: `Task "${nextTask.title}" created with ${nextTask.urgency} urgency`, relatedEntityId: nextTask.id,
      metadata: JSON.stringify({ taskTitle: nextTask.title, urgency: nextTask.urgency }) });
    return { ok: true as const, notification, nextTask: { ...nextTask, assignedUserIds: reusable?.assignedUserIds ?? [] },
      createdNextTask: !reusable, changedTasks };
  });
  if (!outcome.ok) return outcome;
  for (const changed of outcome.changedTasks) deps.publish(changed, "notification_updated");
  deps.publish(outcome.nextTask, outcome.createdNextTask ? "notification_created" : "notification_updated");
  return { ok: true, notification: outcome.notification };
}
