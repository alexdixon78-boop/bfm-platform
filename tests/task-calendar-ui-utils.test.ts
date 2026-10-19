import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarTaskScheduleUpdate,
  buildTaskFollowUpUpdate,
  canChangeTaskStatus,
  canCancelTask,
  canOpenTaskSchedule,
  calendarEventFromTask,
  getTaskStatusTransitions,
  isWorkflowManagedTask,
  londonWallTimeToIso,
  scheduleFromCalendarSelection,
  selectActiveTaskAssigneeIds,
  taskUrgencyAccentClass,
  taskUrgencyLabel,
  taskUrgencyPresentation,
} from "../client/src/components/tasks/task-calendar-utils";
import { canApplyTaskUpdate } from "../shared/task-domain";

test("London wall times preserve GMT and BST meaning", () => {
  assert.equal(londonWallTimeToIso("2030-01-15T09:30"), "2030-01-15T09:30:00.000Z");
  assert.equal(londonWallTimeToIso("2030-07-15T09:30"), "2030-07-15T08:30:00.000Z");
  assert.throws(() => londonWallTimeToIso("2030-03-31T01:30"), /does not exist/i);
});

test("calendar selections produce discriminated timed and all-day schedules", () => {
  assert.deepEqual(scheduleFromCalendarSelection({
    allDay: true,
    startStr: "2030-04-02",
    endStr: "2030-04-04",
  }), {
    kind: "all_day",
    startDate: "2030-04-02",
    endDateExclusive: "2030-04-04",
    reminderMinutes: 1440,
  });
  assert.deepEqual(scheduleFromCalendarSelection({
    allDay: false,
    startStr: "2030-04-02T09:00:00+01:00",
    endStr: "2030-04-02T10:00:00+01:00",
  }), {
    kind: "timed",
    startAt: "2030-04-02T08:00:00.000Z",
    endAt: "2030-04-02T09:00:00.000Z",
    reminderMinutes: 30,
  });
});

test("task calendar events use priority accent classes and omit completed tasks", () => {
  assert.equal(calendarEventFromTask({ id: "done", title: "Done", urgency: "red", status: "completed", schedule: null }), null);
  const event = calendarEventFromTask({
    id: "one",
    title: "Phone follow-up",
    urgency: "amber",
    status: "active",
    schedule: {
      active: true,
      kind: "all_day",
      allDayStart: "2030-05-01",
      allDayEndExclusive: "2030-05-02",
      syncStatus: "pending",
    },
  });
  assert.equal(event?.allDay, true);
  assert.equal(event?.start, "2030-05-01");
  assert.equal(event?.borderColor, "#d97706");
  assert.equal("backgroundColor" in (event ?? {}), false);
  assert.equal(event?.extendedProps.syncStatus, "pending");
});

test("task urgency codes use friendly priority labels", () => {
  assert.equal(taskUrgencyLabel("red"), "High");
  assert.equal(taskUrgencyLabel("amber"), "Medium");
  assert.equal(taskUrgencyLabel("green"), "Low");
  assert.equal(taskUrgencyLabel("blue"), "Normal");
  assert.equal(taskUrgencyLabel("unexpected"), "Normal");
});

test("task urgency accent classes distinguish known and legacy priorities", () => {
  assert.equal(taskUrgencyAccentClass("red"), "task-calendar-event--red");
  assert.equal(taskUrgencyAccentClass("amber"), "task-calendar-event--amber");
  assert.equal(taskUrgencyAccentClass("green"), "task-calendar-event--green");
  assert.equal(taskUrgencyAccentClass("unexpected"), "task-calendar-event--normal");
});

test("task urgency presentation provides FullCalendar border colours", () => {
  assert.deepEqual(taskUrgencyPresentation("red"), { accentClass: "task-calendar-event--red", borderColor: "#dc2626" });
  assert.deepEqual(taskUrgencyPresentation("amber"), { accentClass: "task-calendar-event--amber", borderColor: "#d97706" });
  assert.deepEqual(taskUrgencyPresentation("green"), { accentClass: "task-calendar-event--green", borderColor: "#16a34a" });
  assert.deepEqual(taskUrgencyPresentation("unexpected"), { accentClass: "task-calendar-event--normal", borderColor: "#64748b" });
});

test("task calendar events omit cancelled tasks", () => {
  assert.equal(calendarEventFromTask({ id: "cancelled", title: "Cancelled", urgency: "green", status: "cancelled", schedule: null }), null);
});

test("only case-editing internal administrators can cancel open internal tasks", () => {
  assert.equal(canCancelTask({ userRole: "superadmin", canEditCases: true, audience: "internal", status: "active" }), true);
  assert.equal(canCancelTask({ userRole: "subadmin", canEditCases: true, audience: "internal", status: "scheduled" }), true);
  assert.equal(canCancelTask({ userRole: "staff", canEditCases: true, audience: "internal", status: "active" }), false);
  assert.equal(canCancelTask({ userRole: "subadmin", canEditCases: false, audience: "internal", status: "active" }), false);
  assert.equal(canCancelTask({ userRole: "superadmin", canEditCases: true, audience: "mediator", status: "active" }), false);
  assert.equal(canCancelTask({ userRole: "superadmin", canEditCases: true, audience: "internal", status: "completed" }), false);
  assert.equal(canCancelTask({ userRole: "superadmin", canEditCases: true, audience: "internal", status: "cancelled" }), false);
});

test("administrators can schedule unassigned tasks while staff cannot", () => {
  assert.equal(canOpenTaskSchedule({ canEdit: true, userRole: "superadmin", assigneeCount: 0 }), true);
  assert.equal(canOpenTaskSchedule({ canEdit: true, userRole: "subadmin", assigneeCount: 0 }), true);
  assert.equal(canOpenTaskSchedule({ canEdit: true, userRole: "staff", assigneeCount: 0 }), false);
  assert.equal(canOpenTaskSchedule({ canEdit: true, userRole: "staff", assigneeCount: 1 }), true);
  assert.equal(canOpenTaskSchedule({ canEdit: false, userRole: "superadmin", assigneeCount: 0 }), false);
});

test("administrator schedule updates include assignees while staff updates do not", () => {
  const schedule = {
    kind: "timed" as const,
    startAt: "2030-04-02T08:00:00.000Z",
    endAt: "2030-04-02T09:00:00.000Z",
    reminderMinutes: 30,
  };

  assert.deepEqual(buildCalendarTaskScheduleUpdate({
    schedule,
    canAssign: true,
    assignedUserIds: ["staff-1", "subadmin-1"],
  }), {
    schedule,
    assignedUserIds: ["staff-1", "subadmin-1"],
  });
  assert.deepEqual(buildCalendarTaskScheduleUpdate({
    schedule,
    canAssign: false,
    assignedUserIds: ["staff-1"],
  }), { schedule });
});

test("administrator schedule updates exclude inactive owners from the selectable assignment", () => {
  assert.deepEqual(selectActiveTaskAssigneeIds({
    assignedUserIds: ["active-staff", "inactive-staff"],
    activeUsers: [{ id: "active-staff" }, { id: "active-subadmin" }],
  }), ["active-staff"]);
});

test("status controls follow editor role and staff assignment", () => {
  const common = { canViewCases: true, canEditCases: true, userId: "staff-1", taskType: "manual_task" };
  assert.equal(canChangeTaskStatus({ ...common, userRole: "superadmin", assignedUserIds: [] }), true);
  assert.equal(canChangeTaskStatus({ ...common, userRole: "subadmin", assignedUserIds: [] }), true);
  assert.equal(canChangeTaskStatus({ ...common, canEditCases: false, userRole: "staff", assignedUserIds: ["staff-1"] }), true);
  assert.equal(canChangeTaskStatus({ ...common, canEditCases: false, userRole: "staff", assignedUserIds: ["staff-2"] }), false);
  assert.equal(canChangeTaskStatus({ ...common, canEditCases: false, userRole: "staff", assignedUserIds: [] }), false);
  assert.equal(canChangeTaskStatus({ ...common, canViewCases: false, canEditCases: false, userRole: "staff", assignedUserIds: ["staff-1"] }), false);
  assert.equal(canChangeTaskStatus({ ...common, canEditCases: false, userRole: "superadmin", assignedUserIds: [] }), false);
  assert.equal(canChangeTaskStatus({ ...common, userRole: "mediator", assignedUserIds: ["staff-1"] }), true);
  assert.equal(canChangeTaskStatus({ ...common, userRole: "mediator", assignedUserIds: ["mediator-2"] }), false);
  assert.equal(canChangeTaskStatus({ ...common, userRole: "client", assignedUserIds: ["staff-1"] }), false);
});

test("view-only staff may submit progress updates but cannot mix in schedule or assignment changes", () => {
  const common = {
    taskType: "task",
    userRole: "staff",
    userId: "staff-1",
    assignedUserIds: ["staff-1"],
    canViewCases: true,
    canEditCases: false,
  };
  assert.equal(canApplyTaskUpdate({
    ...common,
    hasProgressChanges: true,
    hasAssignmentChanges: false,
    hasScheduleChanges: false,
  }), true);
  assert.equal(canApplyTaskUpdate({
    ...common,
    hasProgressChanges: true,
    hasAssignmentChanges: true,
    hasScheduleChanges: false,
  }), false);
  assert.equal(canApplyTaskUpdate({
    ...common,
    hasProgressChanges: true,
    hasAssignmentChanges: false,
    hasScheduleChanges: true,
  }), false);
  assert.equal(canApplyTaskUpdate({
    ...common,
    hasProgressChanges: false,
    hasAssignmentChanges: false,
    hasScheduleChanges: false,
  }), false);
});

test("workflow-owned tasks reject generic status controls", () => {
  assert.equal(isWorkflowManagedTask("complaint_review"), true);
  assert.equal(isWorkflowManagedTask("enquiry_follow_up"), true);
  assert.equal(isWorkflowManagedTask("enquiry_chase"), true);
  assert.equal(isWorkflowManagedTask("enquiry_persistent_follow_up"), true);
  assert.equal(isWorkflowManagedTask("manual_task"), false);
  assert.equal(canChangeTaskStatus({
    canViewCases: true,
    canEditCases: true,
    userRole: "superadmin",
    userId: "admin-1",
    assignedUserIds: [],
    taskType: "complaint_review",
  }), false);
});

test("an assigned mediator can complete a manual task without case edit permission", () => {
  assert.equal(canChangeTaskStatus({ canViewCases: false, canEditCases: false, userRole: "mediator", userId: "mediator-1", assignedUserIds: ["mediator-1"], taskType: "task" }), true);
});

test("visible status actions mirror backend transition rules", () => {
  assert.deepEqual(getTaskStatusTransitions("active"), ["in_progress", "follow_up", "completed"]);
  assert.deepEqual(getTaskStatusTransitions("in_progress"), ["active", "follow_up", "completed"]);
  assert.deepEqual(getTaskStatusTransitions("follow_up"), ["active", "in_progress", "completed"]);
  assert.deepEqual(getTaskStatusTransitions("completed"), ["active"]);
  assert.deepEqual(getTaskStatusTransitions("unknown"), []);
});

test("follow-up updates change owners only for administrators", () => {
  const schedule = { kind: "all_day" as const, startDate: "2030-05-01", endDateExclusive: "2030-05-02", reminderMinutes: 1440 };
  assert.deepEqual(buildTaskFollowUpUpdate({
    currentStatus: "active",
    followUpDate: "2030-05-01T00:00:00.000Z",
    assignedUserIds: ["staff-1"],
    schedule,
    canAssign: true,
    canSchedule: true,
  }), {
    status: "follow_up",
    followUpDate: "2030-05-01T00:00:00.000Z",
    assignedUserIds: ["staff-1"],
    schedule,
  });
  assert.deepEqual(buildTaskFollowUpUpdate({
    currentStatus: "active",
    followUpDate: "2030-05-01T00:00:00.000Z",
    assignedUserIds: ["staff-1"],
    schedule: undefined,
    canAssign: false,
    canSchedule: true,
  }), {
    status: "follow_up",
    followUpDate: "2030-05-01T00:00:00.000Z",
    schedule: undefined,
  });
  assert.deepEqual(buildTaskFollowUpUpdate({
    currentStatus: "follow_up",
    followUpDate: "2030-05-02T00:00:00.000Z",
    assignedUserIds: ["staff-1"],
    schedule: undefined,
    canAssign: false,
    canSchedule: true,
  }), {
    followUpDate: "2030-05-02T00:00:00.000Z",
    schedule: undefined,
  });
});

test("view-only staff follow-up updates omit calendar schedule changes", () => {
  const schedule = { kind: "all_day" as const, startDate: "2030-05-01", endDateExclusive: "2030-05-02", reminderMinutes: 1440 };
  assert.deepEqual(buildTaskFollowUpUpdate({
    currentStatus: "active",
    followUpDate: "2030-05-01T00:00:00.000Z",
    assignedUserIds: ["staff-1"],
    schedule,
    canAssign: false,
    canSchedule: false,
  }), {
    status: "follow_up",
    followUpDate: "2030-05-01T00:00:00.000Z",
  });
});
