import { canActorChangeTaskStatus, isWorkflowManagedTaskType } from "@shared/task-domain";

const LONDON_TIME_ZONE = "Europe/London";

type CalendarTask = {
  id: string;
  title: string;
  urgency: string;
  status: string;
  schedule?: {
    active?: boolean;
    kind: string;
    startAt?: string | Date | null;
    endAt?: string | Date | null;
    allDayStart?: string | null;
    allDayEndExclusive?: string | null;
    syncStatus?: string | null;
  } | null;
};

type TaskScheduleUpdate<TSchedule> = {
  schedule: TSchedule;
  assignedUserIds?: string[];
};

type TaskFollowUpUpdate<TSchedule> = {
  status?: "follow_up";
  followUpDate: string;
  assignedUserIds?: string[];
  schedule?: TSchedule | undefined;
};

export type TaskStatusValue = "active" | "in_progress" | "follow_up" | "completed";

export function canCancelTask(input: {
  userRole: string;
  canEditCases: boolean;
  audience?: string;
  status: string;
}): boolean {
  return input.canEditCases
    && (input.userRole === "superadmin" || input.userRole === "subadmin")
    && input.audience === "internal"
    && !["completed", "cancelled"].includes(input.status);
}

const taskStatusTransitions: Record<TaskStatusValue, TaskStatusValue[]> = {
  active: ["in_progress", "follow_up", "completed"],
  in_progress: ["active", "follow_up", "completed"],
  follow_up: ["active", "in_progress", "completed"],
  completed: ["active"],
};

const urgencyPresentations: Record<string, { accentClass: string; borderColor: string }> = {
  red: { accentClass: "task-calendar-event--red", borderColor: "#dc2626" },
  amber: { accentClass: "task-calendar-event--amber", borderColor: "#d97706" },
  green: { accentClass: "task-calendar-event--green", borderColor: "#16a34a" },
};

const urgencyLabels: Record<string, string> = {
  red: "High",
  amber: "Medium",
  green: "Low",
};

export function taskUrgencyLabel(urgency: string): string {
  return urgencyLabels[urgency] ?? "Normal";
}

export function taskUrgencyPresentation(urgency: string): { accentClass: string; borderColor: string } {
  return urgencyPresentations[urgency] ?? { accentClass: "task-calendar-event--normal", borderColor: "#64748b" };
}

export function taskUrgencyAccentClass(urgency: string): string {
  return taskUrgencyPresentation(urgency).accentClass;
}

export function isWorkflowManagedTask(taskType: string): boolean {
  return isWorkflowManagedTaskType(taskType);
}

export function canChangeTaskStatus({
  canViewCases,
  canEditCases,
  userRole,
  userId,
  assignedUserIds,
  taskType,
}: {
  canViewCases: boolean;
  canEditCases: boolean;
  userRole: string;
  userId: string;
  assignedUserIds: string[];
  taskType: string;
}): boolean {
  if (isWorkflowManagedTask(taskType)) return false;
  if (userRole === "mediator" && taskType === "task" && assignedUserIds.includes(userId)) return true;
  return canActorChangeTaskStatus({
    userRole,
    userId,
    assignedUserIds,
    canViewCases,
    canEditCases,
  });
}

export function getTaskStatusTransitions(status: string): TaskStatusValue[] {
  return taskStatusTransitions[status as TaskStatusValue] ?? [];
}

export function buildTaskFollowUpUpdate<TSchedule>({
  currentStatus,
  followUpDate,
  assignedUserIds,
  schedule,
  canAssign,
  canSchedule,
}: {
  currentStatus: string;
  followUpDate: string;
  assignedUserIds: string[];
  schedule: TSchedule | undefined;
  canAssign: boolean;
  canSchedule: boolean;
}): TaskFollowUpUpdate<TSchedule> {
  return {
    ...(currentStatus === "follow_up" ? {} : { status: "follow_up" as const }),
    followUpDate,
    ...(canAssign ? { assignedUserIds } : {}),
    ...(canSchedule ? { schedule } : {}),
  };
}

export function canOpenTaskSchedule({
  canEdit,
  userRole,
  assigneeCount,
}: {
  canEdit: boolean;
  userRole: string;
  assigneeCount: number;
}): boolean {
  if (!canEdit) return false;
  return assigneeCount > 0 || userRole === "superadmin" || userRole === "subadmin";
}

export function buildCalendarTaskScheduleUpdate<TSchedule>({
  schedule,
  canAssign,
  assignedUserIds,
}: {
  schedule: TSchedule;
  canAssign: boolean;
  assignedUserIds: string[];
}): TaskScheduleUpdate<TSchedule> {
  return canAssign ? { schedule, assignedUserIds } : { schedule };
}

export function selectActiveTaskAssigneeIds({
  assignedUserIds,
  activeUsers,
}: {
  assignedUserIds: string[];
  activeUsers: Array<{ id: string }>;
}): string[] {
  const activeUserIds = new Set(activeUsers.map((user) => user.id));
  return assignedUserIds.filter((id) => activeUserIds.has(id));
}

function londonParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function londonWallTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("Enter a valid London date and time");
  const requested = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0),
  };
  const wallClockAsUtc = Date.UTC(requested.year, requested.month - 1, requested.day, requested.hour, requested.minute, requested.second);
  let candidate = new Date(wallClockAsUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const displayed = londonParts(candidate);
    const displayedAsUtc = Date.UTC(displayed.year, displayed.month - 1, displayed.day, displayed.hour, displayed.minute, displayed.second);
    candidate = new Date(candidate.getTime() - (displayedAsUtc - wallClockAsUtc));
  }
  const roundTrip = londonParts(candidate);
  if (Object.keys(requested).some((key) => roundTrip[key as keyof typeof requested] !== requested[key as keyof typeof requested])) {
    throw new Error("That time does not exist in Europe/London because the clocks change");
  }
  return candidate.toISOString();
}

export function scheduleFromCalendarSelection(selection: { allDay: boolean; startStr: string; endStr: string }) {
  if (selection.allDay) {
    return {
      kind: "all_day" as const,
      startDate: selection.startStr.slice(0, 10),
      endDateExclusive: selection.endStr.slice(0, 10),
      reminderMinutes: 1440,
    };
  }
  return {
    kind: "timed" as const,
    startAt: new Date(selection.startStr).toISOString(),
    endAt: new Date(selection.endStr).toISOString(),
    reminderMinutes: 30,
  };
}

export function calendarEventFromTask(task: CalendarTask) {
  const schedule = task.schedule;
  if (["completed", "cancelled"].includes(task.status) || !schedule?.active) return null;
  const priority = taskUrgencyPresentation(task.urgency);
  return {
    id: task.id,
    title: task.title,
    start: schedule.kind === "all_day" ? schedule.allDayStart! : new Date(schedule.startAt!).toISOString(),
    end: schedule.kind === "all_day" ? schedule.allDayEndExclusive! : new Date(schedule.endAt!).toISOString(),
    allDay: schedule.kind === "all_day",
    borderColor: priority.borderColor,
    extendedProps: { task, syncStatus: schedule.syncStatus ?? "pending" },
  };
}
