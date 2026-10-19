/**
 * Regression checks for shared admin task assignment.
 *
 * Run with: npx tsx --test tests/admin-notification-shared-assignment.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema, migration, journal, and bootstrap define notification_assignees", () => {
  const schema = read("../shared/schema.ts");
  const migration = read("../migrations/0035_notification_shared_assignees.sql");
  const journal = read("../migrations/meta/_journal.json");
  const bootstrap = read("../server/db-bootstrap.ts");

  assert.match(schema, /notificationAssignees = pgTable\("notification_assignees"/);
  assert.match(schema, /notificationId:\s*varchar\("notification_id"\)\.notNull\(\)\.references\(\(\) => notifications\.id/);
  assert.match(schema, /userId:\s*varchar\("user_id"\)\.notNull\(\)\.references\(\(\) => users\.id/);
  assert.match(schema, /assignedBy:\s*varchar\("assigned_by"\)\.references\(\(\) => users\.id/);
  assert.match(schema, /assignedAt:\s*timestamp\("assigned_at"\)\.notNull\(\)\.defaultNow\(\)/);
  assert.match(schema, /primaryKey\(\{ columns: \[table\.notificationId, table\.userId\] \}\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "notification_assignees"/);
  assert.match(migration, /"notification_id" varchar NOT NULL/);
  assert.match(migration, /"user_id" varchar NOT NULL/);
  assert.match(migration, /PRIMARY KEY \("notification_id","user_id"\)/);
  assert.match(journal, /"tag": "0035_notification_shared_assignees"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS notification_assignees/);
  assert.match(bootstrap, /PRIMARY KEY \(notification_id, user_id\)/);
});

test("notification service uses shared assignees for visibility, filtering, validation, and compatibility", () => {
  const service = read("../server/services/notification.service.ts");

  assert.match(service, /notificationAssignees/);
  assert.match(service, /EXISTS[\s\S]*notification_assignees[\s\S]*user_id/);
  assert.match(service, /filters\.assignedTo[\s\S]*notification_assignees/);
  assert.match(service, /assignedUserIds\?: string\[\]/);
  assert.match(service, /syncNotificationAssignees/);
  assert.match(service, /invalid_assignee/);
  assert.match(service, /assignee\.role === "client"/);
  assert.match(service, /updates\.assignedTo[\s\S]*assignedUserIds/);
  assert.match(service, /logTaskAssigned[\s\S]*assigneeNames\.join/);
});

test("follow-up assignment makes selected owners unread without duplicating notifications", () => {
  const service = read("../server/services/notification.service.ts");
  const updateTaskStart = service.indexOf("async updateTask(");
  const updateTaskEnd = service.indexOf("async complete(", updateTaskStart);
  const updateTask = service.slice(updateTaskStart, updateTaskEnd);

  assert.match(service, /resetFollowUpOwnerReadState/);
  assert.match(service, /db[\s\S]*\.delete\(notificationReads\)/);
  assert.match(service, /notificationReads\.notificationId/);
  assert.match(service, /inArray\(notificationReads\.userId, uniqueUserIds\)/);
  assert.match(updateTask, /updates\.status === "follow_up"[\s\S]*nextAssignedUserIds/);
  assert.match(updateTask, /await this\.syncNotificationAssignees[\s\S]*await this\.resetFollowUpOwnerReadState[\s\S]*notificationRealtimeService\.broadcastToNotificationAudience/);
  assert.doesNotMatch(updateTask, /createNotification\(/);
  assert.doesNotMatch(updateTask, /emailService|send.*Email/i);
});

test("due follow-up sweep creates bell-only alerts without duplicating task rows", () => {
  const service = read("../server/services/notification.service.ts");
  const app = read("../server/app.ts");
  const escalationStart = service.indexOf("async escalateOverdueFollowUps(");
  const escalationEnd = service.indexOf("async ensureNextPersistentIntakeFollowUp(", escalationStart);
  const escalation = service.slice(escalationStart, escalationEnd);

  assert.match(service, /TASK_FOLLOW_UP_DUE_ALERT_TYPE = "task_follow_up_due_alert"/);
  assert.match(service, /BELL_ONLY_NOTIFICATION_TYPES/);
  assert.match(service, /notInArray\(notifications\.type, BELL_ONLY_NOTIFICATION_TYPES\)/);
  assert.match(escalation, /createNotification\(\{[\s\S]*type: TASK_FOLLOW_UP_DUE_ALERT_TYPE/);
  assert.match(escalation, /assignedUserIds: assignedUserIds/);
  assert.match(escalation, /notificationRealtimeService\.broadcastToNotificationAudience|createNotification/);
  assert.match(app, /task\.assignedUserIds/);
  assert.match(app, /recipients\.length > 0/);
  assert.match(app, /sendTaskFollowUpReminderEmail/);
});

test("task routes accept assignedUserIds while preserving assignedTo", () => {
  const routes = read("../server/routes/notification.routes.ts");

  assert.match(routes, /assignedUserIds/);
  assert.match(routes, /Array\.isArray\(assignedUserIds\)/);
  assert.match(routes, /assignedUserIds: normalizedAssignedUserIds/);
  assert.match(routes, /assignedTo/);
});

test("Tasks page renders and mutates shared assignees", () => {
  const page = read("../client/src/pages/tasks.tsx");

  assert.match(page, /assignedUserIds/);
  assert.match(page, /selectedAssigneeIds/);
  assert.match(page, /toggleSelectedAssignee/);
  assert.match(page, /getAssignedStaffNames/);
  assert.match(page, /badge-task-assignee/);
  assert.match(page, /assignedUserIds: selectedAssigneeIds/);
  assert.match(page, /checkbox-assignee-/);
  assert.match(page, /checkbox-follow-up-assignee-/);
  assert.match(page, /follow-up owner/i);
  assert.match(page, /selectedAssigneeIds\.length === 0/);
  assert.match(page, /buildTaskFollowUpUpdate\(\{/);
});

test("Dashboard task assignment uses shared assignees", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /assignedUserIds\?: string\[\]/);
  assert.doesNotMatch(page, /selectedAssignee[,)]/);
  assert.match(page, /selectedAssigneeIds/);
  assert.match(page, /toggleSelectedAssignee/);
  assert.match(page, /getAssignedStaffNames/);
  assert.match(page, /badge-dashboard-task-assignee/);
  assert.match(page, /assignedUserIds: selectedAssigneeIds/);
  assert.match(page, /checkbox-dashboard-assignee-/);
  assert.match(page, /checkbox-dashboard-follow-up-assignee-/);
  assert.match(page, /follow-up owner/i);
  assert.match(page, /selectedAssigneeIds\.length === 0/);
  assert.match(page, /status: "follow_up"[\s\S]*followUpDate[\s\S]*assignedUserIds: selectedAssigneeIds/);
  assert.match(page, /Choose one or more team members to assign this task to\./);
});

test("Task mutations update cached task lists before background refetch", () => {
  const tasksPage = read("../client/src/pages/tasks.tsx");
  const dashboardPage = read("../client/src/pages/dashboard.tsx");

  assert.match(tasksPage, /setQueriesData[\s\S]*queryKey: \["\/api\/tasks"\]/);
  assert.match(tasksPage, /Array\.isArray\(old\)[\s\S]*task\.id === updatedTask\.id/);
  assert.match(tasksPage, /invalidateTasks\(\);/);

  assert.match(dashboardPage, /setQueriesData[\s\S]*queryKey: \["\/api\/tasks"\]/);
  assert.match(dashboardPage, /items\.map\(\(task\)[\s\S]*task\.id === updatedTask\.id/);
  assert.match(dashboardPage, /invalidateQueries\(\{ queryKey: \["\/api\/tasks"\] \}\)/);
});
