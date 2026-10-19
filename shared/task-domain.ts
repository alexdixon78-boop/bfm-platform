import { z } from "zod";
import { TASK_REMINDER_MINUTES, type Task, type TaskAudience, type TaskSchedule } from "./schema";

export const ACTIONABLE_TASK_TYPES = new Set([
  "task",
  "enquiry_follow_up",
  "enquiry_chase",
  "enquiry_persistent_follow_up",
  "enquiry_dynamic_follow_up",
  "duplicate_enquiry_review",
  "returning_client_match_review",
  "complaint_review",
  "safeguarding_rebecca_notification",
  "appointment_cancellation_request",
  "appointment_calendar_sync_failed",
  "calendar_reauth_required",
  "payment_hold_cancel_follow_up",
  "case_closure_follow_up",
  "demographic_data_completed",
  "miam_review_required",
  "miam_revision_required",
  "miam_flagged",
  "miam_submitted",
  "service_proof_pending_review",
  "service_proof_requested",
  "service_approval_expiry_reminder",
  "mediation_session_payment_due",
  "mediation_session_post_session_review",
  "mediation_session_reschedule_requested",
  "mediation_session_next_session_requested",
  "mediation_session_held_acknowledgement",
  "mediation_session_confirmed_acknowledgement",
  "mediation_session_cancelled_acknowledgement",
  "mediation_session_expired_acknowledgement",
  "documents_ready_for_review",
  "mediation_session_documents_required",
  "mediation_session_follow_up_required",
  "mediation_session_hold_expired",
  "mediation_session_no_common_availability",
  "mediation_session_slot_declined",
  "proofing_returned_to_mediator",
  "required_form_withdrawn",
]);

export function isActionableTaskType(type: string): boolean {
  return ACTIONABLE_TASK_TYPES.has(type);
}

const WORKFLOW_MANAGED_TASK_TYPES = new Set([
  "complaint_review",
  "enquiry_follow_up",
  "enquiry_chase",
  "enquiry_persistent_follow_up",
  "enquiry_dynamic_follow_up",
]);

export function isWorkflowManagedTaskType(type: string): boolean {
  return WORKFLOW_MANAGED_TASK_TYPES.has(type);
}

export type TaskActor = { id: string; role: string };
export type TaskAccessRecord = {
  audience: TaskAudience;
  visibility: "assignees" | "admin_wide" | "superadmin_only";
  assigneeIds: readonly string[];
};

export function classifyLegacyTaskAudience(input: {
  recipientRole: string;
  recipientId?: string | null;
}): TaskAudience | null {
  if (["admin", "superadmin", "task_assignee", "staff", "subadmin"].includes(input.recipientRole)) {
    return "internal";
  }
  if (input.recipientRole === "mediator") return "mediator";
  if (input.recipientRole === "client") return "client";
  return null;
}

export function legacyTaskVisibility(recipientRole: string): TaskAccessRecord["visibility"] {
  if (recipientRole === "superadmin") return "superadmin_only";
  if (recipientRole === "admin") return "admin_wide";
  return "assignees";
}

export function legacyTaskCandidateUserIds(input: {
  recipientRole: string;
  recipientId?: string | null;
  assignedTo?: string | null;
  assignedUserIds?: readonly string[];
}): string[] {
  return Array.from(new Set([
    ...(input.assignedUserIds ?? []),
    ...(input.assignedTo ? [input.assignedTo] : []),
    ...(legacyTaskVisibility(input.recipientRole) === "assignees" && input.recipientId
      ? [input.recipientId]
      : []),
  ]));
}

export function resolveLegacyTaskOwnership(
  recipientRole: string,
  candidateUserIds: readonly string[],
  existingUserIds: ReadonlySet<string>,
): { shouldMirror: boolean; validAssigneeIds: string[] } {
  const validAssigneeIds = Array.from(new Set(candidateUserIds.filter((id) => existingUserIds.has(id))));
  return {
    shouldMirror: recipientRole === "admin" || recipientRole === "superadmin" || validAssigneeIds.length > 0,
    validAssigneeIds,
  };
}

export function taskCalendarConnectionHealth(input: {
  connected: boolean;
  hasWriteScope: boolean;
  accountEmail: string | null;
  lastError: string | null;
}): { status: "ready" | "needs_reauth" | "needs_write_scope" | "not_connected"; accountEmail: string | null; lastError: string | null } {
  if (input.connected && input.hasWriteScope) {
    return { status: "ready", accountEmail: input.accountEmail, lastError: input.lastError };
  }
  if (input.lastError === "needs_reauth") {
    return { status: "needs_reauth", accountEmail: input.accountEmail, lastError: input.lastError };
  }
  if (input.lastError === "needs_write_scope" || (input.connected && !input.hasWriteScope)) {
    return { status: "needs_write_scope", accountEmail: input.accountEmail, lastError: "needs_write_scope" };
  }
  return { status: "not_connected", accountEmail: input.accountEmail, lastError: input.lastError };
}

export function canViewTask(
  actor: TaskActor,
  task: TaskAccessRecord,
  assigneeRoles: ReadonlyMap<string, string> = new Map(),
): boolean {
  const isAssignee = task.assigneeIds.includes(actor.id);
  if (task.audience === "client") return actor.role === "client" && isAssignee;
  if (task.audience === "mediator") return actor.role === "mediator" && isAssignee;
  if (actor.role === "superadmin") return true;
  if (actor.role === "subadmin") {
    if (task.visibility === "superadmin_only") return false;
    if (task.visibility === "admin_wide" || isAssignee) return true;
    return task.assigneeIds.some((id) => assigneeRoles.get(id) === "staff");
  }
  if (actor.role === "staff") return isAssignee;
  return false;
}

export function canAssignInternalTask(role: string, canEditCases: boolean): boolean {
  return canEditCases && (role === "superadmin" || role === "subadmin");
}

export function canScheduleInternalTask(input: {
  role: string;
  canEditCases: boolean;
  isAssignee: boolean;
}): boolean {
  if (!input.canEditCases) return false;
  if (input.role === "superadmin" || input.role === "subadmin") return true;
  return input.role === "staff" && input.isAssignee;
}

export function canActorChangeTaskStatus(input: {
  userRole: string;
  userId: string;
  assignedUserIds: readonly string[];
  canViewCases: boolean;
  canEditCases: boolean;
}): boolean {
  if (input.userRole === "superadmin" || input.userRole === "subadmin") {
    return input.canEditCases;
  }
  const isAssignee = input.assignedUserIds.includes(input.userId);
  if (input.userRole === "staff") return input.canViewCases && isAssignee;
  if (input.userRole === "mediator") return input.canEditCases && isAssignee;
  return false;
}

export function canApplyTaskUpdate(input: {
  taskType: string;
  userRole: string;
  userId: string;
  assignedUserIds: readonly string[];
  canViewCases: boolean;
  canEditCases: boolean;
  hasProgressChanges: boolean;
  hasAssignmentChanges: boolean;
  hasScheduleChanges: boolean;
}): boolean {
  if (input.canEditCases) return true;
  if (isWorkflowManagedTaskType(input.taskType)) return false;
  if (!input.hasProgressChanges || input.hasAssignmentChanges || input.hasScheduleChanges) return false;
  return canActorChangeTaskStatus(input);
}

const reminderSchema = z.union([
  z.null(),
  z.number().int().refine((value) => (TASK_REMINDER_MINUTES as readonly number[]).includes(value), "Unsupported reminder lead time"),
]).optional();

const timedScheduleSchema = z.object({
  kind: z.literal("timed"),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reminderMinutes: reminderSchema,
}).strict();

const allDayScheduleSchema = z.object({
  kind: z.literal("all_day"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDateExclusive: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reminderMinutes: reminderSchema,
}).strict();

export type ParsedTaskSchedule =
  | { kind: "timed"; startAt: Date; endAt: Date; reminderMinutes: number | null }
  | { kind: "all_day"; startDate: string; endDateExclusive: string; reminderMinutes: number | null };

export function londonDateStartInstant(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid all-day date");
  const [year, month, day] = date.split("-").map(Number);
  const initial = new Date(Date.UTC(year, month - 1, day));
  if (initial.toISOString().slice(0, 10) !== date) throw new Error("Invalid all-day date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(initial);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const displayedAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return new Date(initial.getTime() - (displayedAsUtc - initial.getTime()));
}

export function parseTaskSchedule(value: unknown, _now = new Date()): ParsedTaskSchedule {
  const parsed = z.discriminatedUnion("kind", [timedScheduleSchema, allDayScheduleSchema]).parse(value);
  if (parsed.kind === "timed") {
    const startAt = new Date(parsed.startAt);
    const endAt = new Date(parsed.endAt);
    if (endAt <= startAt) throw new Error("Schedule end must be after start");
    const reminderMinutes = parsed.reminderMinutes === undefined ? 30 : parsed.reminderMinutes;
    return { kind: "timed", startAt, endAt, reminderMinutes };
  }

  const start = londonDateStartInstant(parsed.startDate);
  const end = londonDateStartInstant(parsed.endDateExclusive);
  if (end <= start) throw new Error("Schedule end date must be after start date");
  const reminderMinutes = parsed.reminderMinutes === undefined ? 1440 : parsed.reminderMinutes;
  return {
    kind: "all_day",
    startDate: parsed.startDate,
    endDateExclusive: parsed.endDateExclusive,
    reminderMinutes,
  };
}

type EventSchedule =
  | { kind: "timed"; startAt: Date; endAt: Date }
  | { kind: "all_day"; startDate: string; endDateExclusive: string };

export function buildInternalCalendarEvent(input: {
  taskId: string;
  scheduleVersion: number;
  title: string;
  caseReference?: string | null;
  assigneeNames: string[];
  crmUrl: string;
  message?: string;
  schedule: EventSchedule;
}) {
  const description = [
    input.caseReference ? `Case: ${input.caseReference}` : null,
    input.assigneeNames.length ? `Assigned to: ${input.assigneeNames.join(", ")}` : null,
    `Open in CRM: ${input.crmUrl}`,
  ].filter(Boolean).join("\n");
  const time = input.schedule.kind === "timed"
    ? {
        start: { dateTime: input.schedule.startAt.toISOString(), timeZone: "Europe/London" },
        end: { dateTime: input.schedule.endAt.toISOString(), timeZone: "Europe/London" },
      }
    : {
        start: { date: input.schedule.startDate },
        end: { date: input.schedule.endDateExclusive },
      };
  return {
    summary: input.title,
    description,
    ...time,
    extendedProperties: {
      private: {
        taskId: input.taskId,
        scheduleVersion: String(input.scheduleVersion),
      },
    },
  };
}

const RETRY_DELAYS_MINUTES = [1, 5, 15, 30] as const;

export function taskCalendarRetryAt(attemptCount: number, from = new Date()): Date | null {
  const delay = RETRY_DELAYS_MINUTES[attemptCount - 1];
  return delay === undefined ? null : new Date(from.getTime() + delay * 60_000);
}

export function toTaskCompatibilityDto(input: {
  task: Task;
  assignedUserIds: string[];
  schedule: TaskSchedule | null;
}) {
  const assignedTo = input.assignedUserIds[0] ?? null;
  const recipientRole = input.task.audience === "internal"
    ? input.task.visibility === "superadmin_only"
      ? "superadmin"
      : input.task.visibility === "admin_wide"
        ? "admin"
        : "task_assignee"
    : input.task.audience;
  return {
    ...input.task,
    recipientRole,
    recipientId: input.task.audience === "internal" ? null : assignedTo,
    assignedTo,
    assignedUserIds: input.assignedUserIds,
    followUpDate: input.task.dueAt,
    schedule: input.schedule,
  };
}
