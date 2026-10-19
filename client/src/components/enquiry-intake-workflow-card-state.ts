export type IntakeActionTask = {
  id: string;
  type: string;
  stage?: "day0" | "day5" | "day10" | "weekly" | "dynamic";
  intervalDays?: number | null;
  title: string;
  message?: string | null;
  status: string;
  followUpDate?: string | Date | null;
  createdAt?: string | Date | null;
  completedAt?: string | Date | null;
  completionNotes?: string | null;
  completedByName?: string | null;
  contactMethod?: string | null;
  outcomeNotes?: string | null;
  superseded?: boolean;
};

export type IntakeActionCase = {
  status?: string | null;
  intakeStatus?: string | null;
  safeguardingStatus?: string | null;
  standardChaseStopped?: boolean | null;
  claimedBy?: string | null;
  firstContactAttemptedAt?: string | Date | null;
  firstContactMethod?: string | null;
  firstContactNotes?: string | null;
  closureReason?: string | null;
};

export type IntakeActionKind = "terminal" | "safeguarding" | "claim" | "day0" | "day5" | "day10" | "weekly" | "dynamic" | "none";

export type IntakeAction = {
  kind: IntakeActionKind;
  task?: IntakeActionTask;
  firstContact?: {
    attemptedAt: string | Date;
    method: string | null;
    notes: string | null;
  };
};

export type IntakeTaskLoadState = "loading" | "initial_error" | "stale_error" | "ready";

export function deriveIntakeTaskLoadState(input: {
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
}): IntakeTaskLoadState {
  if (input.isError) return input.hasData ? "stale_error" : "initial_error";
  if (!input.hasData || input.isFetching) return input.hasData ? "ready" : "loading";
  return "ready";
}

export type IntakeTaskSelection = {
  day5?: IntakeActionTask;
  day10?: IntakeActionTask;
  weekly?: IntakeActionTask;
  dynamic?: IntakeActionTask;
};

const OPEN_TASK_STATUSES = new Set(["active", "in_progress", "follow_up"]);
const SUPERSEDED_MARKER = "[intake-superseded]";
const LEGACY_SUPERSEDED_NOTES = new Set([
  "Superseded by the Day 0 first-contact transition.",
  "Superseded by the current intake chase transition.",
]);

export function isOpenIntakeTask(task: IntakeActionTask): boolean {
  return OPEN_TASK_STATUSES.has(task.status);
}

function dateValue(value?: string | Date | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function taskStage(task: IntakeActionTask): "day5" | "day10" | "weekly" | "dynamic" | undefined {
  if (task.stage && task.stage !== "day0") return task.stage;
  if (task.stage === "day0") return undefined;
  if (task.type === "enquiry_persistent_follow_up") return "weekly";
  if (task.type === "enquiry_dynamic_follow_up") return "dynamic";
  if (task.type !== "enquiry_chase") return undefined;
  const text = `${task.title} ${task.message || ""}`.toLowerCase();
  if (text.includes("day 10") || text.includes("day-10")) return "day10";
  if (text.includes("day 5") || text.includes("day-5")) return "day5";
  return undefined;
}

function stageOrder(stage: "day5" | "day10" | "weekly" | "dynamic"): number {
  if (stage === "dynamic") return 4;
  return stage === "day5" ? 1 : stage === "day10" ? 2 : 3;
}

function isSupersededIntakeTask(task: IntakeActionTask): boolean {
  return task.superseded === true || task.message?.includes(SUPERSEDED_MARKER) === true || LEGACY_SUPERSEDED_NOTES.has(task.completionNotes || "");
}

export function selectCompletedIntakeFollowUps(tasks: IntakeActionTask[]): IntakeActionTask[] {
  return tasks
    .filter((task) => task.status === "completed" && !!taskStage(task) && !isSupersededIntakeTask(task))
    .sort((a, b) => (
      dateValue(b.completedAt || b.createdAt) - dateValue(a.completedAt || a.createdAt)
      || dateValue(b.createdAt) - dateValue(a.createdAt)
      || a.id.localeCompare(b.id)
    ));
}

export function selectLatestCompletedIntakeFollowUp(tasks: IntakeActionTask[]): IntakeActionTask | undefined {
  return selectCompletedIntakeFollowUps(tasks)[0];
}

function canonicalOpenTask(tasks: IntakeActionTask[]): IntakeActionTask | undefined {
  const open = tasks.filter(isOpenIntakeTask);
  return [...open].sort((a, b) => dateValue(a.createdAt) - dateValue(b.createdAt) || a.id.localeCompare(b.id))[0];
}

function canonicalHistoryTask(tasks: IntakeActionTask[]): IntakeActionTask | undefined {
  return [...tasks.filter((task) => task.status === "completed")]
    .sort((a, b) => dateValue(b.completedAt || b.createdAt) - dateValue(a.completedAt || a.createdAt) || a.id.localeCompare(b.id))[0];
}

function canonicalTask(tasks: IntakeActionTask[]): IntakeActionTask | undefined {
  return canonicalOpenTask(tasks) || canonicalHistoryTask(tasks);
}

export function selectIntakeTasks(tasks: IntakeActionTask[]): IntakeTaskSelection {
  const grouped = { day5: [] as IntakeActionTask[], day10: [] as IntakeActionTask[], weekly: [] as IntakeActionTask[], dynamic: [] as IntakeActionTask[] };
  for (const task of tasks) {
    const stage = taskStage(task);
    if (stage) grouped[stage].push(task);
  }
  return {
    day5: canonicalTask(grouped.day5),
    day10: canonicalTask(grouped.day10),
    weekly: canonicalTask(grouped.weekly),
    dynamic: canonicalTask(grouped.dynamic),
  };
}

export type FollowUpTiming = "Upcoming" | "Due today" | "Overdue" | "Completed" | "Not created yet";

export function getFollowUpTiming(task: IntakeActionTask | undefined, now = new Date()): FollowUpTiming {
  if (!task) return "Not created yet";
  if (task.status === "completed") return "Completed";
  if (!task.followUpDate) return "Upcoming";
  const due = new Date(task.followUpDate);
  if (due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate()) return "Due today";
  return due < now ? "Overdue" : "Upcoming";
}

export function deriveIntakeAction(
  caseData: IntakeActionCase,
  tasks: IntakeActionTask[],
  now = new Date(),
  options: { allowSafeguardingWork?: boolean } = {},
): IntakeAction {
  const firstContact = caseData.firstContactAttemptedAt ? {
    attemptedAt: caseData.firstContactAttemptedAt,
    method: caseData.firstContactMethod || null,
    notes: caseData.firstContactNotes || null,
  } : undefined;

  if (["Closed", "Archived"].includes(caseData.status || "") || caseData.intakeStatus === "Closed") return { kind: "terminal", firstContact };
  const activeConcern = caseData.safeguardingStatus === "concern";
  if ((caseData.standardChaseStopped || activeConcern) && !(activeConcern && options.allowSafeguardingWork)) return { kind: "terminal", firstContact };
  if (caseData.safeguardingStatus !== "clear" && !activeConcern) return { kind: "safeguarding", firstContact };
  if (!caseData.claimedBy && !(activeConcern && options.allowSafeguardingWork)) return { kind: "claim", firstContact };
  if (!caseData.firstContactAttemptedAt) return { kind: "day0" };

  const dynamicTask = canonicalOpenTask(tasks.filter((task) => taskStage(task) === "dynamic"));
  if (dynamicTask) return { kind: "dynamic", task: dynamicTask, firstContact };

  const selection = selectIntakeTasks(tasks);
  const minimumStage = tasks.reduce((minimum, historyTask) => {
    const historyStage = taskStage(historyTask);
    return historyTask.status === "completed" && historyStage && !isSupersededIntakeTask(historyTask)
      ? Math.max(minimum, Math.min(stageOrder(historyStage) + 1, 3))
      : minimum;
  }, 1);
  for (const kind of ["day5", "day10", "weekly"] as const) {
    const task = selection[kind];
    if (stageOrder(kind) >= minimumStage && task && isOpenIntakeTask(task)) return { kind, task, firstContact };
  }
  return { kind: "none", firstContact };
}
