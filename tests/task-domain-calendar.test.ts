import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getTableColumns } from "drizzle-orm";
import {
  tasks,
  taskAssignees,
  taskSchedules,
  taskCalendarSyncJobs,
  taskReminderDeliveries,
} from "../shared/schema";
import {
  buildInternalCalendarEvent,
  canAssignInternalTask,
  canScheduleInternalTask,
  canViewTask,
  classifyLegacyTaskAudience,
  isActionableTaskType,
  legacyTaskCandidateUserIds,
  londonDateStartInstant,
  parseTaskSchedule,
  resolveLegacyTaskOwnership,
  taskCalendarConnectionHealth,
  taskCalendarRetryAt,
  toTaskCompatibilityDto,
} from "../shared/task-domain";

test("task persistence separates workflow, assignees, schedules, and sync jobs", () => {
  const taskColumns = getTableColumns(tasks);
  const assigneeColumns = getTableColumns(taskAssignees);
  const scheduleColumns = getTableColumns(taskSchedules);
  const syncColumns = getTableColumns(taskCalendarSyncJobs);
  const reminderColumns = getTableColumns(taskReminderDeliveries);

  assert.deepEqual(
    ["audience", "type", "status", "urgency", "dueAt", "caseId", "appointmentId", "complaintId"]
      .filter((name) => !(name in taskColumns)),
    [],
  );
  assert.ok("taskId" in assigneeColumns && "userId" in assigneeColumns);
  assert.ok("kind" in scheduleColumns && "startAt" in scheduleColumns && "allDayStart" in scheduleColumns);
  assert.ok("operation" in syncColumns && "scheduleVersion" in syncColumns && "googleEventId" in syncColumns);
  assert.ok("scheduleVersion" in reminderColumns && "notificationId" in reminderColumns && "userId" in reminderColumns);
});

test("release migrations register task separation and internal calendar persistence", async () => {
  const [taskSql, calendarSql, journal] = await Promise.all([
    readFile(new URL("../migrations/0045_task_domain_separation.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0046_internal_task_calendar.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
  ]);
  assert.match(taskSql, /CREATE TABLE IF NOT EXISTS tasks/i);
  assert.match(taskSql, /Unknown open legacy task types/i);
  assert.match(taskSql, /INSERT INTO tasks/i);
  assert.match(calendarSql, /CREATE TABLE IF NOT EXISTS task_schedules/i);
  assert.doesNotMatch(calendarSql, /internal_calendar_id/i);
  assert.match(calendarSql, /CREATE TABLE IF NOT EXISTS task_reminder_deliveries/i);
  assert.match(taskSql, /notifications_task_mirror_trigger/i);
  assert.match(journal, /0045_task_domain_separation/);
  assert.match(journal, /0046_internal_task_calendar/);
});

test("task calendar sync health follows the shared Google connection", () => {
  assert.deepEqual(taskCalendarConnectionHealth({
    connected: true,
    hasWriteScope: true,
    accountEmail: "testingfuture6@gmail.com",
    lastError: null,
  }), {
    status: "ready",
    accountEmail: "testingfuture6@gmail.com",
    lastError: null,
  });
  assert.deepEqual(taskCalendarConnectionHealth({
    connected: false,
    hasWriteScope: true,
    accountEmail: "testingfuture6@gmail.com",
    lastError: "needs_reauth",
  }), {
    status: "needs_reauth",
    accountEmail: "testingfuture6@gmail.com",
    lastError: "needs_reauth",
  });
  assert.deepEqual(taskCalendarConnectionHealth({
    connected: false,
    hasWriteScope: false,
    accountEmail: "testingfuture6@gmail.com",
    lastError: "needs_write_scope",
  }), {
    status: "needs_write_scope",
    accountEmail: "testingfuture6@gmail.com",
    lastError: "needs_write_scope",
  });
});

test("task separation migration keeps actionable and informational catalogues aligned", async () => {
  const [taskSql, taskService] = await Promise.all([
    readFile(new URL("../migrations/0045_task_domain_separation.sql", import.meta.url), "utf8"),
    readFile(new URL("../server/services/task.service.ts", import.meta.url), "utf8"),
  ]);
  const preflight = taskSql.slice(
    taskSql.indexOf("-- Explicit catalogue used by the expand migration"),
    taskSql.indexOf("INSERT INTO tasks"),
  );
  const backfill = taskSql.slice(
    taskSql.indexOf("INSERT INTO tasks"),
    taskSql.indexOf("-- Transitional dual-write safety"),
  );
  const trigger = taskSql.slice(taskSql.indexOf("CREATE OR REPLACE FUNCTION mirror_actionable_notification_to_task"));

  const actionableTypes = [
    "documents_ready_for_review",
    "mediation_session_documents_required",
    "mediation_session_follow_up_required",
    "mediation_session_hold_expired",
    "mediation_session_no_common_availability",
    "mediation_session_slot_declined",
  ];
  const informationalTypes = [
    "mediation_session_participant_invitation_accepted",
    "mediation_session_participant_invitation_declined",
    "service_approval_approved",
    "service_approval_expired",
    "service_approval_rejected",
    "service_approval_revoked",
    "task_assigned",
  ];

  for (const type of actionableTypes) {
    assert.equal(isActionableTaskType(type), true, `${type} must be actionable at runtime`);
    assert.match(preflight, new RegExp(`'${type}'`), `${type} must pass the migration preflight`);
    assert.match(backfill, new RegExp(`'${type}'`), `${type} must be backfilled into tasks`);
    assert.match(trigger, new RegExp(`'${type}'`), `${type} must be mirrored after migration`);
  }

  for (const type of informationalTypes) {
    assert.equal(isActionableTaskType(type), false, `${type} must remain informational at runtime`);
    assert.match(preflight, new RegExp(`'${type}'`), `${type} must pass the migration preflight`);
    assert.doesNotMatch(backfill, new RegExp(`'${type}'`), `${type} must not be backfilled into tasks`);
    assert.doesNotMatch(trigger, new RegExp(`'${type}'`), `${type} must not be mirrored into tasks`);
  }

  assert.match(backfill, /n\.recipient_role IN \('admin', 'superadmin'\)/);
  assert.match(backfill, /JOIN users .* ON .*\.id = n\.assigned_to/s);
  assert.match(backfill, /JOIN users .* ON .*\.id = n\.recipient_id/s);
  assert.match(trigger, /task_visibility = 'assignees'.*RETURN NEW/s);
  assert.match(trigger, /EXISTS \(SELECT 1 FROM users/s);
  assert.match(trigger, /NEW\.assigned_to IS NOT NULL\s+AND EXISTS \(SELECT 1 FROM users WHERE id = NEW\.assigned_to\) THEN/s);
  assert.match(trigger, /EXISTS \([\s\S]*FROM notification_assignees owner_na[\s\S]*owner_na\.notification_id = NEW\.id/);
  assert.match(trigger, /IF NOT EXISTS \(SELECT 1 FROM tasks WHERE id = NEW\.notification_id\)[\s\S]*UPDATE notifications[\s\S]*SET assigned_to = assigned_to/s);
  assert.match(trigger, /pg_trigger_depth\(\) > 2/);
  assert.doesNotMatch(trigger, /pg_trigger_depth\(\) > 1/);
  assert.match(taskService, /resolveLegacyTaskOwnership/);
  assert.match(taskService, /\.from\(users\)/);
  assert.match(taskService, /if \(!ownership\.shouldMirror\) return null/);
});

test("legacy task ownership skips deleted targets without blocking admin-wide work", () => {
  const existingUsers = new Set(["valid-user"]);

  assert.deepEqual(resolveLegacyTaskOwnership("mediator", ["valid-user"], existingUsers), {
    shouldMirror: true,
    validAssigneeIds: ["valid-user"],
  });
  assert.deepEqual(resolveLegacyTaskOwnership("mediator", ["deleted-user"], existingUsers), {
    shouldMirror: false,
    validAssigneeIds: [],
  });
  assert.deepEqual(resolveLegacyTaskOwnership("staff", ["deleted-user"], existingUsers), {
    shouldMirror: false,
    validAssigneeIds: [],
  });
  assert.deepEqual(resolveLegacyTaskOwnership("admin", [], existingUsers), {
    shouldMirror: true,
    validAssigneeIds: [],
  });
  assert.deepEqual(resolveLegacyTaskOwnership("superadmin", [], existingUsers), {
    shouldMirror: true,
    validAssigneeIds: [],
  });
});

test("legacy task owner candidates include every assignee-only targeted role", () => {
  for (const recipientRole of ["mediator", "client", "staff", "subadmin", "task_assignee"]) {
    assert.deepEqual(
      legacyTaskCandidateUserIds({
        recipientRole,
        recipientId: `${recipientRole}-recipient`,
        assignedTo: null,
        assignedUserIds: [],
      }),
      [`${recipientRole}-recipient`],
    );
  }

  assert.deepEqual(legacyTaskCandidateUserIds({
    recipientRole: "admin",
    recipientId: "broadcast-recipient",
    assignedTo: null,
    assignedUserIds: [],
  }), []);
  assert.deepEqual(legacyTaskCandidateUserIds({
    recipientRole: "superadmin",
    recipientId: "broadcast-recipient",
    assignedTo: null,
    assignedUserIds: [],
  }), []);
});

test("legacy task audience classification isolates internal, mediator, and client work", () => {
  assert.equal(classifyLegacyTaskAudience({ recipientRole: "admin", recipientId: null }), "internal");
  assert.equal(classifyLegacyTaskAudience({ recipientRole: "superadmin", recipientId: null }), "internal");
  assert.equal(classifyLegacyTaskAudience({ recipientRole: "task_assignee", recipientId: "staff-1" }), "internal");
  assert.equal(classifyLegacyTaskAudience({ recipientRole: "mediator", recipientId: "med-1" }), "mediator");
  assert.equal(classifyLegacyTaskAudience({ recipientRole: "client", recipientId: "client-1" }), "client");
  assert.equal(classifyLegacyTaskAudience({ recipientRole: "system", recipientId: null }), null);
});

test("task catalogue separates actionable workflow from informational delivery", () => {
  assert.equal(isActionableTaskType("enquiry_follow_up"), true);
  assert.equal(isActionableTaskType("complaint_review"), true);
  assert.equal(isActionableTaskType("mediation_session_reschedule_requested"), true);
  assert.equal(isActionableTaskType("task"), true);
  assert.equal(isActionableTaskType("confirmed"), false);
  assert.equal(isActionableTaskType("bfm_calendar_health"), false);
  assert.equal(isActionableTaskType("task_follow_up_due_alert"), false);
  assert.equal(isActionableTaskType("unknown_future_type"), false);
});

test("internal task visibility gives superadmin oversight and subadmin staff oversight", () => {
  const staffRoles = new Map([
    ["sub-1", "subadmin"],
    ["sub-2", "subadmin"],
    ["staff-1", "staff"],
  ]);
  const internal = { audience: "internal", visibility: "assignees", assigneeIds: ["staff-1"] } as const;

  assert.equal(canViewTask({ id: "super", role: "superadmin" }, internal, staffRoles), true);
  assert.equal(canViewTask({ id: "sub-1", role: "subadmin" }, internal, staffRoles), true);
  assert.equal(canViewTask({ id: "staff-1", role: "staff" }, internal, staffRoles), true);
  assert.equal(canViewTask({ id: "staff-2", role: "staff" }, internal, staffRoles), false);
  assert.equal(canViewTask({ id: "med-1", role: "mediator" }, internal, staffRoles), false);

  const otherSubadmin = { ...internal, assigneeIds: ["sub-2"] };
  assert.equal(canViewTask({ id: "sub-1", role: "subadmin" }, otherSubadmin, staffRoles), false);
  assert.equal(canViewTask({ id: "sub-2", role: "subadmin" }, otherSubadmin, staffRoles), true);

  const adminWide = { ...internal, visibility: "admin_wide" as const, assigneeIds: [] };
  assert.equal(canViewTask({ id: "sub-1", role: "subadmin" }, adminWide, staffRoles), true);
  assert.equal(canViewTask({ id: "staff-1", role: "staff" }, adminWide, staffRoles), false);
});

test("assignment and scheduling permissions keep ownership accountable", () => {
  assert.equal(canAssignInternalTask("superadmin", true), true);
  assert.equal(canAssignInternalTask("subadmin", true), true);
  assert.equal(canAssignInternalTask("staff", true), false);
  assert.equal(canAssignInternalTask("subadmin", false), false);

  assert.equal(canScheduleInternalTask({ role: "staff", canEditCases: true, isAssignee: true }), true);
  assert.equal(canScheduleInternalTask({ role: "staff", canEditCases: true, isAssignee: false }), false);
  assert.equal(canScheduleInternalTask({ role: "mediator", canEditCases: true, isAssignee: true }), false);
});

test("schedule validation supports timed and all-day schedules with safe reminders", () => {
  const timed = parseTaskSchedule({
    kind: "timed",
    startAt: "2030-03-30T10:00:00.000Z",
    endAt: "2030-03-30T11:00:00.000Z",
    reminderMinutes: 30,
  }, new Date("2030-03-01T00:00:00.000Z"));
  assert.equal(timed.kind, "timed");
  assert.equal(timed.reminderMinutes, 30);

  const allDay = parseTaskSchedule({
    kind: "all_day",
    startDate: "2030-03-31",
    endDateExclusive: "2030-04-01",
    reminderMinutes: 1440,
  }, new Date("2030-03-01T00:00:00.000Z"));
  assert.equal(allDay.kind, "all_day");

  assert.throws(() => parseTaskSchedule({
    kind: "timed",
    startAt: "2030-03-30T11:00:00.000Z",
    endAt: "2030-03-30T10:00:00.000Z",
    reminderMinutes: 30,
  }), /end.*after.*start/i);
  assert.throws(() => parseTaskSchedule({
    kind: "all_day",
    startDate: "2030-03-31",
    endDateExclusive: "2030-03-31",
    reminderMinutes: 15,
  }), /end.*after.*start/i);
  assert.throws(() => parseTaskSchedule({
    kind: "timed",
    startAt: "2030-03-30T10:00:00.000Z",
    endAt: "2030-03-30T11:00:00.000Z",
    reminderMinutes: 10,
  }), /reminder/i);
});

test("all-day reminder instants use London midnight across GMT and BST", () => {
  assert.equal(londonDateStartInstant("2030-01-15").toISOString(), "2030-01-15T00:00:00.000Z");
  assert.equal(londonDateStartInstant("2030-07-15").toISOString(), "2030-07-14T23:00:00.000Z");
  assert.throws(() => londonDateStartInstant("2030-02-31"), /invalid/i);
});

test("Google event payload contains minimal internal details and no attendees", () => {
  const payload = buildInternalCalendarEvent({
    taskId: "task-1",
    scheduleVersion: 4,
    title: "Call client about documents",
    caseReference: "BFM-2030-0001",
    assigneeNames: ["Alex Admin", "Sam Staff"],
    crmUrl: "https://crm.example.test/tasks?view=calendar&taskId=task-1",
    message: "Sensitive safeguarding and client phone details",
    schedule: {
      kind: "timed",
      startAt: new Date("2030-03-30T10:00:00.000Z"),
      endAt: new Date("2030-03-30T11:00:00.000Z"),
    },
  });

  assert.equal(payload.summary, "Call client about documents");
  assert.match(payload.description, /BFM-2030-0001/);
  assert.match(payload.description, /Alex Admin, Sam Staff/);
  assert.doesNotMatch(payload.description, /Sensitive safeguarding/);
  assert.equal("attendees" in payload, false);
  assert.deepEqual(payload.extendedProperties.private, { taskId: "task-1", scheduleVersion: "4" });
});

test("calendar retry backoff is bounded and stops after the final attempt", () => {
  const base = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(taskCalendarRetryAt(1, base)?.toISOString(), "2030-01-01T00:01:00.000Z");
  assert.equal(taskCalendarRetryAt(2, base)?.toISOString(), "2030-01-01T00:05:00.000Z");
  assert.equal(taskCalendarRetryAt(3, base)?.toISOString(), "2030-01-01T00:15:00.000Z");
  assert.equal(taskCalendarRetryAt(4, base)?.toISOString(), "2030-01-01T00:30:00.000Z");
  assert.equal(taskCalendarRetryAt(5, base), null);
});

test("task API compatibility keeps followUpDate while exposing dueAt and schedule", () => {
  const dueAt = new Date("2030-04-01T09:00:00.000Z");
  const dto = toTaskCompatibilityDto({
    task: {
      id: "task-1",
      audience: "internal",
      visibility: "admin_wide",
      type: "enquiry_follow_up",
      urgency: "red",
      status: "active",
      title: "First contact required",
      message: "Call within 24 hours",
      caseId: "case-1",
      enquiryId: null,
      complaintId: null,
      appointmentId: null,
      dueAt,
      completionNotes: null,
      completedBy: null,
      completedAt: null,
      caseNoteRequired: false,
      createdBy: null,
      legacyNotificationId: "task-1",
      createdAt: new Date("2030-03-01T09:00:00.000Z"),
      updatedAt: new Date("2030-03-01T09:00:00.000Z"),
    },
    assignedUserIds: ["staff-1"],
    schedule: null,
  });
  assert.equal(dto.followUpDate, dueAt);
  assert.equal(dto.dueAt, dueAt);
  assert.equal(dto.assignedTo, "staff-1");
  assert.deepEqual(dto.assignedUserIds, ["staff-1"]);
  assert.equal(dto.recipientRole, "admin");
});
