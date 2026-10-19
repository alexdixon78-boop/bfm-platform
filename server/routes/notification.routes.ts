import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { storage } from "../storage";
import { notificationService } from "../services/notification.service";
import { taskService } from "../services/task.service";
import { TASK_STATUSES, taskSavedViews, taskSeries, type TaskStatus, type User } from "@shared/schema";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { parseTaskQuery } from "@shared/task-query";
import { canEditSection, canViewSection } from "@shared/permissions";
import { logAudit } from "../services/audit-log.service";
import { permissionService } from "../services/permission.service";
import { taskCalendarService } from "../services/task-calendar.service";
import { canApplyTaskUpdate, parseTaskSchedule } from "@shared/task-domain";
import { caseTaskOptions, searchTaskCases } from "../services/manual-task-case.service";
import { cancelTaskIds, createManualTasks, createTaskSeries, editManualTask, replaceFutureTaskSeries, stopTaskSeries } from "../services/manual-task.service";

const router = Router();

function taskQueryFromRequest(req: any) {
  try {
    return parseTaskQuery(req.query as Record<string, string | string[] | undefined>);
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("Invalid task filters"), { status: 400 });
  }
}

router.get("/api/tasks/case-search", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (user?.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can search cases for tasks" });
  const query = String(req.query.q || "").trim().slice(0, 120);
  return res.json(await searchTaskCases(query));
});

router.get("/api/tasks/case-options/:id", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (user?.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can view case task options" });
  const options = await caseTaskOptions(req.params.id);
  return options ? res.json(options) : res.status(404).json({ message: "Case not found" });
});

router.get("/api/tasks/assignees", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user || !["superadmin", "subadmin"].includes(user.role)) return res.status(403).json({ message: "Access denied" });
  const allUsers = await storage.listUsers();
  return res.json(allUsers.filter((person) => person.status === "active" && (
    ["superadmin", "subadmin", "staff"].includes(person.role) || (user.role === "superadmin" && person.role === "mediator")
  )).map((person) => ({ id: person.id, name: person.name, email: person.email, role: person.role })));
});

router.post("/api/tasks/batch", requirePermission("cases", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (!["superadmin", "subadmin"].includes(user.role)) return res.status(403).json({ message: "Access denied" });
  try {
    const ids = await createManualTasks(user, req.body);
    await logAudit({ userId: user.id, action: "create", entity: "task", entityId: ids[0], details: JSON.stringify({ taskIds: ids, caseId: req.body?.caseId || null, assigneeCount: ids.length }) });
    return res.status(201).json({ taskIds: ids });
  } catch (error) {
    return res.status((error as { status?: number }).status || 400).json({ message: (error as Error).message });
  }
});

router.post("/api/task-series", requirePermission("cases", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can create recurring tasks" });
  try {
    const result = await createTaskSeries(user, req.body);
    await logAudit({ userId: user.id, action: "create", entity: "task_series", entityId: result.seriesId, details: JSON.stringify({ frequency: req.body?.frequency, caseId: req.body?.caseId || null, assigneeCount: req.body?.assignedUserIds?.length || 0 }) });
    return res.status(201).json(result);
  } catch (error) {
    return res.status((error as { status?: number }).status || 400).json({ message: (error as Error).message });
  }
});

router.get("/api/task-series/:id", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user || user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can view task series" });
  const [series] = await db.select().from(taskSeries).where(eq(taskSeries.id, req.params.id));
  return series ? res.json(series) : res.status(404).json({ message: "Series not found" });
});

router.post("/api/task-series/:id/stop", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user || user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can stop recurring tasks" });
  try {
    const cancelled = await stopTaskSeries(user, req.params.id, typeof req.body?.fromDate === "string" ? req.body.fromDate : undefined);
    await logAudit({ userId: user.id, action: "update", entity: "task_series", entityId: req.params.id, details: JSON.stringify({ stoppedFrom: req.body?.fromDate || null, cancelled }) });
    return res.json({ cancelled });
  } catch (error) {
    return res.status((error as { status?: number }).status || 400).json({ message: (error as Error).message });
  }
});

router.patch("/api/task-series/:id/future", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user || user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can edit recurring tasks" });
  try {
    const result = await replaceFutureTaskSeries(user, req.params.id, req.body.fromDate, req.body);
    await logAudit({ userId: user.id, action: "update", entity: "task_series", entityId: req.params.id, details: JSON.stringify({ replacedBy: result.seriesId, fromDate: req.body.fromDate }) });
    return res.json(result);
  } catch (error) {
    return res.status((error as { status?: number }).status || 400).json({ message: (error as Error).message });
  }
});

router.patch("/api/tasks/:id/manual", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user || user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can edit manual tasks" });
  try {
    const taskId = await editManualTask(user, req.params.id, req.body);
    await logAudit({ userId: user.id, action: "update", entity: "task", entityId: taskId, details: JSON.stringify({ caseId: req.body?.caseId || null }) });
    return res.json({ taskId });
  } catch (error) {
    return res.status((error as { status?: number }).status || 400).json({ message: (error as Error).message });
  }
});

function normalizeAssignedUserIds(value: unknown, fallback?: string | null): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)));
  }
  return fallback ? [fallback] : [];
}

async function validateStaffAssignees(userIds: string[]): Promise<boolean> {
  for (const userId of userIds) {
    const assignee = await storage.getUser(userId);
    if (!assignee || assignee.status !== "active" || !["superadmin", "subadmin", "staff"].includes(assignee.role)) {
      return false;
    }
  }
  return true;
}

router.get("/api/notifications", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const active = await notificationService.listActive(user);
  return res.json(active);
});

router.get("/api/notifications/bell", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const payload = await notificationService.listBellNotifications(user, limit);
  return res.json(payload);
});

router.get("/api/notifications/inbox", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  const page = Number(req.query.page ?? 1); const pageSize = Number(req.query.pageSize ?? 25);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return res.status(400).json({ message: "Invalid pagination" });
  const value = (key: string, limit = 120) => typeof req.query[key] === "string" ? String(req.query[key]).trim().slice(0, limit) : undefined;
  const read = value("read", 16); const status = value("status", 16); const urgency = value("urgency", 16);
  const createdFrom = value("createdFrom", 10); const createdTo = value("createdTo", 10);
  if (read && !["all", "read", "unread"].includes(read)) return res.status(400).json({ message: "Invalid read filter" });
  if (status && !["all", "open", "history"].includes(status)) return res.status(400).json({ message: "Invalid status filter" });
  if (urgency && !["all", "red", "amber", "green"].includes(urgency)) return res.status(400).json({ message: "Invalid priority filter" });
  if ([createdFrom, createdTo].some((date) => date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return res.status(400).json({ message: "Invalid created date" });
  if (createdFrom && createdTo && createdFrom > createdTo) return res.status(400).json({ message: "Created-from must be before created-to" });
  return res.json(await notificationService.listInbox(user, { q: value("q"), read, status, urgency, type: value("type", 80), caseId: value("caseId", 64), createdFrom, createdTo, page, pageSize }));
});

router.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const result = await notificationService.markRead(req.params.id, user);
  if (result.error === "not_found") return res.status(404).json({ message: "Notification not found" });
  return res.json({ notification: result.notification, unreadCount: result.unreadCount });
});

router.post("/api/notifications/:id/unread", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!); if (!user) return res.status(401).json({ message: "Not authenticated" });
  const result = await notificationService.markUnread(req.params.id, user);
  if (result.error) return res.status(404).json({ message: "Notification not found" });
  return res.json(result);
});

router.post("/api/notifications/:id/create-task", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!); if (!user) return res.status(401).json({ message: "Not authenticated" });
  const result = await notificationService.createTaskFromNotification(req.params.id, user);
  if (result.error === "access_denied") return res.status(403).json({ message: "This notification cannot be converted to a task" });
  if (result.error) return res.status(404).json({ message: "Notification not found" });
  return res.status(result.existing ? 200 : 201).json(result);
});

router.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const result = await notificationService.markAllVisibleRead(user);
  return res.json(result);
});

router.get("/api/tasks", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!["superadmin", "subadmin", "staff", "mediator", "client"].includes(user.role)) {
    return res.status(403).json({ message: "Access denied" });
  }
  if (["superadmin", "subadmin", "staff"].includes(user.role)) {
    const permissions = await permissionService.getPermissions();
    if (!canViewSection(permissions, user.role as any, "cases")) return res.status(403).json({ message: "Access denied" });
  }

  const { page, pageSize } = req.query;
  let query;
  try { query = taskQueryFromRequest(req); } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
  const filters = { query };

  // Task #212 — When the caller asks for pagination (either param present)
  // return a `{ items, total, page, pageSize }` envelope. Otherwise keep the
  // legacy array shape so the existing /tasks page (which filters/sorts
  // client-side) isn't disturbed.
  if (page !== undefined || pageSize !== undefined) {
    const parsedPage = Number.parseInt(String(page ?? "1"), 10);
    const parsedSize = Number.parseInt(String(pageSize ?? "5"), 10);
    if (!Number.isFinite(parsedPage) || parsedPage < 1) {
      return res.status(400).json({ message: "page must be a positive integer" });
    }
    if (!Number.isFinite(parsedSize) || parsedSize < 1 || parsedSize > 100) {
      return res.status(400).json({ message: "pageSize must be between 1 and 100" });
    }
    const result = await taskService.listPaged(user, filters, parsedPage, parsedSize);
    return res.json(result);
  }

  const tasks = await taskService.list(user, filters);
  return res.json(tasks);
});

router.get("/api/tasks/calendar", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!["superadmin", "subadmin", "staff", "mediator"].includes(user.role)) {
    return res.status(403).json({ message: "Task calendar is unavailable" });
  }
  if (user.role !== "mediator") {
    const permissions = await permissionService.getPermissions();
    if (!canViewSection(permissions, user.role as any, "cases")) return res.status(403).json({ message: "Access denied" });
  }
  const start = new Date(String(req.query.start ?? ""));
  const end = new Date(String(req.query.end ?? ""));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return res.status(400).json({ message: "A valid start/end calendar range is required" });
  }
  let query;
  try { query = taskQueryFromRequest(req); } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
  const payload = await taskCalendarService.listCalendar(user, { start, end }, { query }, typeof req.query.taskId === "string" ? req.query.taskId : undefined);
  return res.json(payload);
});

router.get("/api/tasks/filter-options", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user || !["superadmin", "subadmin", "staff", "mediator", "client"].includes(user.role)) return res.status(403).json({ message: "Access denied" });
  try {
    const query = taskQueryFromRequest(req);
    const visible = await taskService.list(user, { query });
    const matching = visible.slice(0, 100);
    const assigneeIds = Array.from(new Set(matching.flatMap((task) => task.assignedUserIds)));
    const assignees = assigneeIds.length ? (await storage.listUsers()).filter((person) => assigneeIds.includes(person.id)).map((person) => ({ id: person.id, name: person.name })) : [];
    return res.json({
      taskTypes: Array.from(new Set(matching.map((task) => task.type))).sort(),
      assignees,
      cases: Array.from(new Map(matching.filter((task) => task.caseId).map((task) => [task.caseId!, { id: task.caseId!, caseReference: task.caseReference ?? task.caseId! }])).values()),
    });
  } catch (error) { return res.status((error as { status?: number }).status ?? 400).json({ message: (error as Error).message }); }
});

router.get("/api/task-saved-views", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  return res.json(await db.select().from(taskSavedViews).where(eq(taskSavedViews.userId, user.id)).orderBy(desc(taskSavedViews.updatedAt)));
});

router.post("/api/task-saved-views", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!name || name.length > 80) return res.status(400).json({ message: "View name must be 1-80 characters" });
  try {
    const query = parseTaskQuery(req.body?.query ?? {});
    const [view] = await db.insert(taskSavedViews).values({ userId: user.id, name, query }).returning();
    return res.status(201).json(view);
  } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
});

router.patch("/api/task-saved-views/:id", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  const name = req.body?.name === undefined ? undefined : typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (name !== undefined && (!name || name.length > 80)) return res.status(400).json({ message: "View name must be 1-80 characters" });
  try {
    const query = req.body?.query === undefined ? undefined : parseTaskQuery(req.body.query);
    const [view] = await db.update(taskSavedViews).set({ ...(name === undefined ? {} : { name }), ...(query === undefined ? {} : { query }), updatedAt: new Date() }).where(and(eq(taskSavedViews.id, req.params.id), eq(taskSavedViews.userId, user.id))).returning();
    if (!view) return res.status(404).json({ message: "Saved view not found" });
    return res.json(view);
  } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
});

router.delete("/api/task-saved-views/:id", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  const [view] = await db.delete(taskSavedViews).where(and(eq(taskSavedViews.id, req.params.id), eq(taskSavedViews.userId, user.id))).returning();
  if (!view) return res.status(404).json({ message: "Saved view not found" });
  return res.status(204).end();
});

router.post("/api/tasks/:id/cancel", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!["superadmin", "subadmin"].includes(user.role)) return res.status(403).json({ message: "Only administrators can cancel tasks" });
  const permissions = await permissionService.getPermissions();
  if (!canEditSection(permissions, user.role as any, "cases")) return res.status(403).json({ message: "Case Management Edit permission is required" });
  const task = await taskService.getVisible(user, req.params.id);
  if (!task || task.audience !== "internal") return res.status(404).json({ message: "Task not found" });
  if (["completed", "cancelled"].includes(task.status)) return res.status(409).json({ message: "Completed or cancelled tasks cannot be cancelled" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 2_000) : null;
  const scope = req.body?.scope === "future" ? "future" : "occurrence";
  try {
    const cancelled = scope === "future" && task.seriesId && task.occurrenceDate
      ? await stopTaskSeries(user, task.seriesId, task.occurrenceDate, reason)
      : await cancelTaskIds(user, [task.id], reason);
    await logAudit({ userId: user.id, action: "update", entity: task.seriesId && scope === "future" ? "task_series" : "task", entityId: task.seriesId && scope === "future" ? task.seriesId : task.id, details: JSON.stringify({ action: "cancelled", scope, reason, cancelled }) });
    return res.json({ cancelled, task: await taskService.getVisible(user, task.id) });
  } catch (error) {
    return res.status((error as { status?: number }).status || 400).json({ message: (error as Error).message });
  }
});

router.post("/api/tasks", requirePermission("cases", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (!["superadmin", "subadmin"].includes(user.role)) {
    return res.status(403).json({ message: "Only superadmins and subadmins can create internal tasks" });
  }

  const { title, message, urgency, caseId, assignedTo, assignedUserIds, followUpDate, schedule } = req.body || {};
  if (!title || !message || !urgency) {
    return res.status(400).json({ message: "title, message and urgency are required" });
  }
  if (assignedUserIds !== undefined && !Array.isArray(assignedUserIds)) {
    return res.status(400).json({ message: "assignedUserIds must be an array" });
  }
  const normalizedAssignedUserIds = normalizeAssignedUserIds(assignedUserIds, assignedTo || null);
  if (!(await validateStaffAssignees(normalizedAssignedUserIds))) {
    return res.status(400).json({ message: "Invalid assignee: user must be an active staff member" });
  }
  if (schedule !== undefined && schedule !== null) {
    if (normalizedAssignedUserIds.length === 0) {
      return res.status(400).json({ message: "Assign at least one internal owner before scheduling" });
    }
    try {
      parseTaskSchedule(schedule);
    } catch (error) {
      return res.status(400).json({ message: (error as Error).message });
    }
  }

  const task = await notificationService.createNotification({
    title,
    message,
    urgency: urgency || "green",
    type: "task",
    recipientId: null,
    recipientRole: normalizedAssignedUserIds.length > 0 ? "task_assignee" : "admin",
    caseId: caseId || null,
    assignedTo: normalizedAssignedUserIds[0] || assignedTo || null,
    assignedUserIds: normalizedAssignedUserIds,
    assignedBy: user.id,
    followUpDate: followUpDate ? new Date(followUpDate) : null,
    status: "active",
  });

  let taskSchedule = null;
  if (schedule !== undefined && schedule !== null) {
    try {
      taskSchedule = await taskCalendarService.setSchedule(task.id, schedule);
    } catch (error) {
      return res.status((error as { status?: number }).status ?? 400).json({ message: (error as Error).message });
    }
  }

  const createdTask = await taskService.getVisible(user, task.id);
  return res.status(201).json(createdTask ?? { ...task, schedule: taskSchedule });
});

router.get("/api/tasks/counts", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!["superadmin", "subadmin", "staff", "mediator", "client"].includes(user.role)) {
    return res.status(403).json({ message: "Access denied" });
  }
  if (["superadmin", "subadmin", "staff"].includes(user.role)) {
    const permissions = await permissionService.getPermissions();
    if (!canViewSection(permissions, user.role as any, "cases")) return res.status(403).json({ message: "Access denied" });
  }

  let query;
  try { query = taskQueryFromRequest(req); } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
  const counts = await taskService.getCounts(user, { query });
  return res.json(counts);
});

router.get("/api/tasks/staff", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  if (user.role === "mediator") return res.json([]);
  if (!["superadmin", "subadmin", "staff"].includes(user.role)) {
    return res.status(403).json({ message: "Access denied" });
  }

  const allUsers = await storage.listUsers();
  const staffUsers = allUsers
    .filter(u => ["superadmin", "subadmin", "staff"].includes(u.role) && u.status === "active")
    .map(u => ({ id: u.id, name: u.name, role: u.role }));

  return res.json(staffUsers);
});

router.patch("/api/notifications/:id/complete", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const { caseNote } = req.body || {};
  const result = await notificationService.complete(req.params.id, user, caseNote);

  if (result.error === "not_found") return res.status(404).json({ message: "Notification not found" });
  if (result.error === "access_denied") return res.status(403).json({ message: "Access denied" });
  if (result.error === "case_note_required") return res.status(400).json({ message: "A case note is required to complete this notification" });
  if (result.error === "invalid_transition") return res.status(409).json({ message: "This task must be completed through its workflow" });

  return res.json(result.notification);
});

router.patch("/api/tasks/:id", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  if (user.role === "client") {
    return res.status(403).json({ message: "Access denied" });
  }

  const { status, assignedTo, assignedUserIds, followUpDate, completionNotes, caseNote, schedule } = req.body || {};
  if (assignedUserIds !== undefined && !Array.isArray(assignedUserIds)) {
    return res.status(400).json({ message: "assignedUserIds must be an array" });
  }
  const normalizedAssignedUserIds = assignedUserIds !== undefined || assignedTo !== undefined
    ? normalizeAssignedUserIds(assignedUserIds, assignedTo || null)
    : undefined;

  if (normalizedAssignedUserIds && !(await validateStaffAssignees(normalizedAssignedUserIds))) {
    return res.status(400).json({ message: "Invalid assignee: user must be an active internal staff member" });
  }

  const existingTask = await taskService.getVisible(user, req.params.id);
  if (!existingTask) return res.status(404).json({ message: "Task not found" });
  if (existingTask.type === "complaint_review") {
    return res.status(409).json({ message: "Complaint review tasks must be completed through the complaint workflow" });
  }
  const isInternalTask = existingTask.audience === "internal";
  const permissions = await permissionService.getPermissions();
  const canViewCases = canViewSection(permissions, user.role as any, "cases");
  const canEditCases = canEditSection(permissions, user.role as any, "cases");
  const hasProgressChanges = status !== undefined
    || followUpDate !== undefined
    || completionNotes !== undefined
    || caseNote !== undefined;
  const hasAssignmentChanges = assignedUserIds !== undefined || assignedTo !== undefined;
  const hasScheduleChanges = schedule !== undefined;
  if (!isInternalTask && hasScheduleChanges && user.role !== "superadmin") {
    return res.status(403).json({ message: "Only superadmins can reschedule mediator tasks" });
  }
  if (isInternalTask && !canApplyTaskUpdate({
    taskType: existingTask.type,
    userRole: user.role,
    userId: user.id,
    assignedUserIds: existingTask.assignedUserIds,
    canViewCases,
    canEditCases,
    hasProgressChanges,
    hasAssignmentChanges,
    hasScheduleChanges,
  })) {
    return res.status(403).json({ message: "Case Management Edit permission is required unless Staff update only an assigned task's progress" });
  }
  if ((assignedUserIds !== undefined || assignedTo !== undefined) && !["superadmin", "subadmin"].includes(user.role)) {
    return res.status(403).json({ message: "Only superadmins and subadmins can assign internal tasks" });
  }
  if (normalizedAssignedUserIds?.length === 0 && existingTask.schedule?.active && schedule !== null) {
    return res.status(400).json({ message: "Remove the calendar schedule before unassigning every owner" });
  }
  if (schedule !== undefined && isInternalTask) {
    const isAssignee = existingTask.assignedUserIds.includes(user.id);
    if (user.role === "staff" && !isAssignee) return res.status(403).json({ message: "Staff can schedule only their assigned tasks" });
    if (!["superadmin", "subadmin", "staff"].includes(user.role)) return res.status(403).json({ message: "Access denied" });
    if (schedule !== null) {
      const prospectiveAssignees = normalizedAssignedUserIds ?? existingTask.assignedUserIds;
      if (prospectiveAssignees.length === 0) {
        return res.status(400).json({ message: "Assign at least one internal owner before scheduling" });
      }
      try {
        parseTaskSchedule(schedule);
      } catch (error) {
        return res.status(400).json({ message: (error as Error).message });
      }
    }
  }

  if (status && (status === "scheduled" || !TASK_STATUSES.includes(status as TaskStatus))) {
    return res.status(400).json({ message: `Invalid status. Must be one of: ${TASK_STATUSES.join(", ")}` });
  }

  const result = await notificationService.updateTask(
    req.params.id,
    { id: user.id, role: user.role, name: user.name },
    { status, assignedTo, assignedUserIds: normalizedAssignedUserIds, followUpDate, completionNotes, caseNote }
  );

  if (result.error === "not_found") return res.status(404).json({ message: "Task not found" });
  if (result.error === "access_denied") return res.status(403).json({ message: "Access denied" });
  if (result.error === "invalid_assignee") return res.status(400).json({ message: "Invalid assignee: user must be an active staff member" });
  if (result.error === "invalid_transition") return res.status(400).json({ message: "Invalid status transition" });
  if (result.error === "follow_up_date_required") return res.status(400).json({ message: "A follow-up date is required when setting status to follow-up" });
  if (result.error === "case_note_required") return res.status(400).json({ message: "A case note is required to complete this task" });

  if (!result.notification) return res.status(500).json({ message: "Task update failed" });
  let updatedSchedule = existingTask.schedule;
  if (schedule === null) {
    await taskCalendarService.removeSchedule(req.params.id);
    updatedSchedule = null;
  } else if (schedule !== undefined) {
    try {
      updatedSchedule = await taskCalendarService.setSchedule(req.params.id, schedule);
    } catch (error) {
      return res.status((error as { status?: number }).status ?? 400).json({ message: (error as Error).message });
    }
  } else if (normalizedAssignedUserIds !== undefined && existingTask.schedule?.active) {
    updatedSchedule = await taskCalendarService.refreshScheduleMetadata(req.params.id);
  }
  const updatedTask = await taskService.getVisible(user, req.params.id);
  return res.json(updatedTask ?? { ...result.notification, schedule: updatedSchedule });
});

router.post("/api/tasks/:id/calendar-sync/retry", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (!["superadmin", "subadmin", "staff"].includes(user.role)) return res.status(403).json({ message: "Access denied" });
  const permissions = await permissionService.getPermissions();
  if (!canEditSection(permissions, user.role as any, "cases")) return res.status(403).json({ message: "Access denied" });
  const task = await taskService.getVisible(user, req.params.id);
  if (!task || task.audience !== "internal") return res.status(404).json({ message: "Task not found" });
  if (user.role === "staff" && !task.assignedUserIds.includes(user.id)) return res.status(403).json({ message: "Access denied" });
  await taskCalendarService.retry(task.id);
  return res.json({ success: true });
});

router.delete("/api/tasks/:id", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can delete tasks" });

  const existingTask = await taskService.getVisible(user, req.params.id);
  if (!existingTask) return res.status(404).json({ message: "Task not found" });
  if (existingTask.type === "complaint_review") {
    return res.status(409).json({ message: "Complaint review tasks must be completed through the complaint workflow" });
  }
  await taskCalendarService.removeSchedule(req.params.id);
  const deleted = await notificationService.deleteTask(req.params.id);
  if (!deleted) return res.status(404).json({ message: "Task not found" });
  await taskService.deleteById(req.params.id);

  const ip = (req.headers["x-forwarded-for"] as string | undefined) || req.socket.remoteAddress || "";
  await logAudit({
    userId: user.id,
    action: "delete_task",
    entity: "task",
    entityId: deleted.id,
    entityRef: deleted.title,
    details: JSON.stringify({
      title: deleted.title,
      status: deleted.status,
      caseId: deleted.caseId,
      recipientId: deleted.recipientId,
      recipientRole: deleted.recipientRole,
      assignedTo: deleted.assignedTo,
    }),
    ipAddress: ip,
  });

  return res.json({ deleted: true, id: deleted.id });
});

router.post("/api/tasks/bulk-delete", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  if (user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can delete tasks" });

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids must be a non-empty array" });
  }

  const uniqueIds = Array.from(new Set((ids as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)));
  if (uniqueIds.length !== ids.length) {
    return res.status(400).json({ message: "Every task ID must be a non-empty string" });
  }
  const selectedTasks = await Promise.all(uniqueIds.map((id) => taskService.getVisible(user, id)));
  const invalidIds = uniqueIds.filter((_, index) => !selectedTasks[index] || selectedTasks[index]?.type === "complaint_review");
  if (invalidIds.length > 0) {
    return res.status(400).json({ message: `Some task IDs cannot be deleted: ${invalidIds.join(", ")}`, missingIds: invalidIds });
  }
  await Promise.all(uniqueIds.map((id) => taskCalendarService.removeSchedule(id)));
  const result = await notificationService.deleteTasks(uniqueIds);

  if (result.missingIds.length > 0) {
    return res.status(400).json({
      message: `Some task IDs were not found: ${result.missingIds.join(", ")}`,
      missingIds: result.missingIds,
    });
  }
  await taskService.deleteByIds(uniqueIds);

  const ip = (req.headers["x-forwarded-for"] as string | undefined) || req.socket.remoteAddress || "";
  for (const task of result.deleted) {
    await logAudit({
      userId: user.id,
      action: "delete_task",
      entity: "task",
      entityId: task.id,
      entityRef: task.title,
      details: JSON.stringify({
        title: task.title,
        status: task.status,
        caseId: task.caseId,
        recipientId: task.recipientId,
        recipientRole: task.recipientRole,
        assignedTo: task.assignedTo,
      }),
      ipAddress: ip,
    });
  }

  return res.json({ deleted: result.deleted.length, ids: result.deleted.map(t => t.id) });
});

export default router;
