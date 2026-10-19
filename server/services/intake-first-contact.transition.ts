import type { Case, Notification } from "@shared/schema";
import { isIntakeAdminRole, validateIntakeWorker } from "./intake-access-policy";

const OPEN_TASK_STATUSES = ["active", "in_progress", "follow_up"] as const;

export type IntakeFirstContactActor = { id: string; name: string; role: string };

export function addFiveCalendarDays(date: Date): Date {
  const due = new Date(date);
  due.setDate(due.getDate() + 5);
  return due;
}

function isDay5Task(task: Pick<Notification, "type" | "title" | "message">): boolean {
  const text = `${task.title} ${task.message}`.toLowerCase();
  return task.type === "enquiry_chase" && (text.includes("day 5") || text.includes("day-5"));
}

export function validateLockedFirstContact(
  existing: Pick<Case, "status" | "intakeStatus" | "firstContactAttemptedAt" | "safeguardingStatus" | "standardChaseStopped" | "claimedBy">,
  actor: Pick<IntakeFirstContactActor, "id" | "role">,
): { ok: true } | { ok: false; status: 400 | 409; message: string } {
  if (existing.status === "Closed" || existing.status === "Archived" || existing.intakeStatus === "Closed") {
    return { ok: false, status: 400, message: "Closed or archived cases cannot be chased" };
  }
  if (existing.firstContactAttemptedAt) return { ok: false, status: 409, message: "First contact has already been recorded" };
  const adminSafeguardingOverride = existing.safeguardingStatus === "concern" && isIntakeAdminRole(actor.role);
  if ((existing.safeguardingStatus !== "clear" || existing.standardChaseStopped) && !adminSafeguardingOverride) {
    return { ok: false, status: 409, message: existing.safeguardingStatus === "pending"
      ? "Please complete the safeguarding check before recording first contact"
      : "Safeguarding must be clear before recording first contact" };
  }
  return validateIntakeWorker(existing, actor);
}

export function reconcileDay5Tasks(
  tasks: Array<Pick<Notification, "id" | "status" | "type" | "title" | "message" | "followUpDate">>,
  firstContactAt: Date,
): { reuseTaskId: string | null; completeTaskIds: string[]; dueAt: Date } {
  const openTasks = tasks.filter((task) => (OPEN_TASK_STATUSES as readonly string[]).includes(task.status));
  const reusable = openTasks.find(isDay5Task) ?? null;
  return {
    reuseTaskId: reusable?.id ?? null,
    completeTaskIds: openTasks.filter((task) => task.id !== reusable?.id).map((task) => task.id),
    dueAt: addFiveCalendarDays(firstContactAt),
  };
}

export function hasOpenLaterStageTask(
  tasks: Array<Pick<Notification, "status" | "type" | "title" | "message">>,
): boolean {
  return tasks.some((task) => {
    if (!(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) return false;
    const text = `${task.title} ${task.message}`.toLowerCase();
    return task.type === "enquiry_persistent_follow_up"
      || (task.type === "enquiry_chase" && (text.includes("day 10") || text.includes("day-10")));
  });
}
