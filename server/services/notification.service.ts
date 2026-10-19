import { db } from "../db";
import { cases, enquiries, notificationAssignees, notificationReads, notificationTaskLinks, notifications, type Notification, type InsertNotification, type TaskStatus } from "@shared/schema";
import { eq, and, desc, or, ne, isNull, lte, sql, inArray, notInArray, type SQL } from "drizzle-orm";
import { storage } from "../storage";
import { caseActivityService, staffActor, systemActor } from "./case-activity.service";
import { notificationRealtimeService } from "./notification-realtime.service";
import { taskService } from "./task.service";
import { DYNAMIC_INTAKE_FOLLOW_UP_TYPE, dynamicFollowUpAudience } from "./intake-dynamic-follow-up";

export const INTAKE_PERSISTENT_FOLLOW_UP_TYPE = "enquiry_persistent_follow_up";
export const TASK_FOLLOW_UP_DUE_ALERT_TYPE = "task_follow_up_due_alert";
export const PERSISTENT_INTAKE_FOLLOW_UP_INTERVAL_DAYS = 7;
const INTAKE_FOLLOW_UP_TYPES = ["enquiry_follow_up", "enquiry_chase", INTAKE_PERSISTENT_FOLLOW_UP_TYPE] as const;
const OPEN_INTAKE_FOLLOW_UP_STATUSES = ["active", "in_progress", "follow_up"] as const;
const BELL_ONLY_NOTIFICATION_TYPES: string[] = [TASK_FOLLOW_UP_DUE_ALERT_TYPE];
const STANDALONE_TASK_ACTION = { href: "/tasks", label: "Open tasks" } as const;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isDay10ChaseTask(task: Notification): boolean {
  const raw = `${task.title} ${task.message}`.toLowerCase();
  return task.type === "enquiry_chase" && (raw.includes("day 10") || raw.includes("day-10"));
}

function isPersistentIntakeFollowUpTask(task: Notification): boolean {
  return task.type === INTAKE_PERSISTENT_FOLLOW_UP_TYPE;
}

function isOpenIntakeFollowUpStatus(status: string): boolean {
  return (OPEN_INTAKE_FOLLOW_UP_STATUSES as readonly string[]).includes(status);
}

export interface TaskFilters {
  status?: string;
  assignedTo?: string;
  urgency?: string;
  caseId?: string;
}

export type NotificationAction = {
  actionHref: string;
  actionLabel: string;
};

export type ActionableNotification = Notification & NotificationAction & {
  assignedUserIds: string[];
};

export type BellNotification = ActionableNotification & {
  readAt: Date | null;
};

export type BellNotificationPayload = {
  items: BellNotification[];
  unreadCount: number;
};

type NotificationCreateInput = InsertNotification & {
  id?: string;
  assignedUserIds?: string[];
  assignedBy?: string | null;
};

export class NotificationService {
  async listInbox(user: { id: string; role: string }, input: { q?: string; read?: string; status?: string; urgency?: string; type?: string; caseId?: string; createdFrom?: string; createdTo?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, Number(input.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 25));
    const readJoin = and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, user.id));
    const conditions: SQL[] = [this.visibleCondition(user)];
    if (input.read === "read") conditions.push(sql`${notificationReads.readAt} IS NOT NULL`);
    if (input.read === "unread") conditions.push(sql`${notificationReads.readAt} IS NULL`);
    if (input.status === "open") conditions.push(ne(notifications.status, "completed"));
    if (input.status === "history") conditions.push(inArray(notifications.status, ["completed", "archived"]));
    if (input.urgency) conditions.push(eq(notifications.urgency, input.urgency));
    if (input.type) conditions.push(eq(notifications.type, input.type));
    if (input.caseId) conditions.push(eq(notifications.caseId, input.caseId));
    if (input.createdFrom) conditions.push(sql`${notifications.createdAt} >= (${input.createdFrom}::date AT TIME ZONE 'Europe/London')`);
    if (input.createdTo) conditions.push(sql`${notifications.createdAt} < ((${input.createdTo}::date + interval '1 day') AT TIME ZONE 'Europe/London')`);
    if (input.q?.trim()) { const like = `%${input.q.trim().slice(0, 120).replace(/[\\%_]/g, "\\$&")}%`; conditions.push(sql`(${notifications.title} ILIKE ${like} OR ${notifications.message} ILIKE ${like} OR EXISTS (SELECT 1 FROM cases inbox_case WHERE inbox_case.id = ${notifications.caseId} AND inbox_case.case_ref ILIKE ${like}))`); }
    const where = and(...conditions);
    const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(notifications).leftJoin(notificationReads, readJoin).where(where);
    const [unread] = await db.select({ total: sql<number>`count(*)::int` }).from(notifications).leftJoin(notificationReads, readJoin).where(and(this.visibleCondition(user), isNull(notificationReads.readAt)));
    const rows = await db.select({ notification: notifications, readAt: notificationReads.readAt, taskId: notificationTaskLinks.taskId, taskCompletedAt: notificationTaskLinks.completedAt, caseRef: cases.caseRef }).from(notifications).leftJoin(notificationReads, readJoin).leftJoin(notificationTaskLinks, and(eq(notificationTaskLinks.notificationId, notifications.id), eq(notificationTaskLinks.userId, user.id))).leftJoin(cases, eq(cases.id, notifications.caseId)).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(pageSize).offset((page - 1) * pageSize);
    const total = Number(count?.total ?? 0);
    return { items: await Promise.all(rows.map(async (row) => ({ ...(await this.withAction(row.notification)), readAt: row.readAt ?? null, linkedTaskId: row.taskId ?? null, linkedTaskCompletedAt: row.taskCompletedAt ?? null, linkedRecord: row.caseRef ? { label: `Case ${row.caseRef}`, href: `/cases/${row.notification.caseId}` } : row.notification.appointmentId ? { label: "Appointment", href: "/appointments" } : null }))), total, unreadTotal: Number(unread?.total ?? 0), page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async markUnread(id: string, user: { id: string; role: string }) {
    const [existing] = await db.select().from(notifications).where(and(eq(notifications.id, id), this.visibleCondition(user))).limit(1);
    if (!existing) return { error: "not_found" };
    await db.delete(notificationReads).where(and(eq(notificationReads.notificationId, id), eq(notificationReads.userId, user.id)));
    return { notification: { ...(await this.withAction(existing)), readAt: null }, unreadCount: await this.getUnreadBellCount(user) };
  }

  async createTaskFromNotification(id: string, user: { id: string; role: string }) {
    if (!["superadmin", "subadmin", "staff", "mediator"].includes(user.role)) return { error: "access_denied" };
    const [source] = await db.select().from(notifications).where(and(eq(notifications.id, id), this.visibleCondition(user))).limit(1);
    if (!source) return { error: "not_found" };
    const [link] = await db.select().from(notificationTaskLinks).where(and(eq(notificationTaskLinks.notificationId, id), eq(notificationTaskLinks.userId, user.id))).limit(1);
    if (link) return { taskId: link.taskId, existing: true };
    const created = await this.createNotification({ recipientId: user.id, recipientRole: user.role === "mediator" ? "mediator" : "task_assignee", assignedTo: user.id, assignedUserIds: [user.id], assignedBy: user.id, type: "task", urgency: source.urgency, caseId: source.caseId, appointmentId: source.appointmentId, title: source.title, message: source.message, status: "active", caseNoteRequired: false });
    await db.insert(notificationTaskLinks).values({ notificationId: source.id, userId: user.id, taskId: created.id });
    return { taskId: created.id, existing: false };
  }
  private normalizeActionHint(path: string): string | null {
    const [pathname, query = ""] = path.split("?");
    if (!/^\/(?:cases|enquiries|mediators)\/[a-zA-Z0-9-]+$/.test(pathname) && pathname !== "/tasks" && pathname !== "/appointments") {
      return null;
    }

    if (!query) return pathname;

    const params = new URLSearchParams(query);
    const tab = params.get("tab");
    const validTabs = new Set([
      "appointments",
      "mediation-sessions",
      "payments",
      "documents",
      "financial-disclosure",
      "demographic",
      "miam-record",
      "communications",
    ]);

    if (pathname.startsWith("/mediators/") && tab === "service_offering") {
      const safe = new URLSearchParams({ tab });
      if (params.get("section") === "service-proof") safe.set("section", "service-proof");
      const serviceTypeId = params.get("serviceTypeId");
      if (serviceTypeId && /^[a-zA-Z0-9-]+$/.test(serviceTypeId)) safe.set("serviceTypeId", serviceTypeId);
      return `${pathname}?${safe.toString()}`;
    }

    if (pathname.startsWith("/cases/") && tab && validTabs.has(tab)) {
      const safe = new URLSearchParams({ tab });
      const appointmentId = params.get("appointmentId");
      const action = params.get("action");
      if (appointmentId && /^[a-zA-Z0-9-]+$/.test(appointmentId)) safe.set("appointmentId", appointmentId);
      if (action === "resolve-miam") safe.set("action", action);
      return `${pathname}?${safe.toString()}`;
    }

    return pathname;
  }

  private actionLabelForHref(href: string): string {
    if (href.includes("tab=mediation-sessions")) return "Open mediation sessions";
    if (href.includes("tab=appointments") || href === "/appointments") return "Open appointments";
    if (href.includes("tab=payments")) return "Open payments";
    if (href.includes("tab=documents")) return "Open documents";
    if (href.includes("tab=financial-disclosure")) return "Open financial disclosure";
    if (href.includes("tab=demographic")) return "Open demographic data";
    if (href.includes("tab=miam-record")) return "Open MIAM record";
    if (href.startsWith("/mediators/") && href.includes("section=service-proof")) return "Open service proof";
    if (href.startsWith("/mediators/")) return "Open mediator";
    if (href.startsWith("/enquiries/")) return "Open enquiry";
    if (href.startsWith("/cases/")) return "View case";
    return "Open tasks";
  }

  private extractInternalActionHint(notification: Notification): string | null {
    const raw = `${notification.title} ${notification.message}`;
    const match = raw.match(/\/(?:cases|enquiries|mediators)\/[a-zA-Z0-9-]+(?:\?[a-zA-Z0-9_=&-]+)?|\/tasks|\/appointments/);
    if (!match) return null;
    return this.normalizeActionHint(match[0]);
  }

  private async findEnquiryIdForCase(caseId: string): Promise<string | null> {
    const [row] = await db
      .select({ id: enquiries.id })
      .from(enquiries)
      .where(eq(enquiries.convertedCaseId, caseId))
      .limit(1);
    return row?.id ?? null;
  }

  async deriveNotificationAction(notification: Notification): Promise<NotificationAction> {
    if (notification.documentRequestId && notification.caseId) {
      return {
        actionHref: `/cases/${encodeURIComponent(notification.caseId)}?tab=documents&documentRequestId=${encodeURIComponent(notification.documentRequestId)}`,
        actionLabel: "Upload document",
      };
    }
    if (notification.complaintId) {
      return { actionHref: `/complaints/${notification.complaintId}`, actionLabel: "Open complaint" };
    }
    const hintedHref = this.extractInternalActionHint(notification);
    if (hintedHref) {
      return {
        actionHref: hintedHref,
        actionLabel: this.actionLabelForHref(hintedHref),
      };
    }

    const text = `${notification.type} ${notification.title} ${notification.message}`.toLowerCase();
    const caseTab = (tab: string, label: string): NotificationAction => {
      if (!notification.caseId) return { actionHref: STANDALONE_TASK_ACTION.href, actionLabel: STANDALONE_TASK_ACTION.label };
      return { actionHref: `/cases/${notification.caseId}?tab=${tab}`, actionLabel: label };
    };

    if (notification.type === "gmail_case_reply") {
      return caseTab("communications", "Open reply");
    }

    if (
      notification.type.startsWith("mediation_session") ||
      text.includes("mediation session") ||
      text.includes("agreement to mediate") ||
      text.includes("session acknowledgement")
    ) {
      return caseTab("mediation-sessions", "Open mediation sessions");
    }

    if (notification.appointmentId || notification.type.includes("appointment") || text.includes("cancellation request")) {
      return caseTab("appointments", "Open appointments");
    }

    if (notification.type.includes("payment") || notification.type.includes("invoice") || text.includes("payment") || text.includes("invoice")) {
      return caseTab("payments", "Open payments");
    }

    if (notification.type.includes("financial") || text.includes("financial disclosure")) {
      return caseTab("financial-disclosure", "Open financial disclosure");
    }

    if (notification.type.includes("demographic") || text.includes("demographic")) {
      return caseTab("demographic", "Open demographic data");
    }

    if (notification.type.includes("miam") || text.includes("miam")) {
      return caseTab("miam-record", "Open MIAM record");
    }

    if (notification.type.includes("document") || notification.type.includes("form") || text.includes("document") || text.includes("upload") || text.includes("form")) {
      return caseTab("documents", "Open documents");
    }

    if (notification.type.includes("enquiry") || text.includes("enquiry") || text.includes("intake")) {
      if (notification.caseId) {
        const enquiryId = await this.findEnquiryIdForCase(notification.caseId);
        if (enquiryId) return { actionHref: `/enquiries/${enquiryId}`, actionLabel: "Open enquiry" };
        return { actionHref: `/cases/${notification.caseId}`, actionLabel: "View case" };
      }
      return { actionHref: STANDALONE_TASK_ACTION.href, actionLabel: STANDALONE_TASK_ACTION.label };
    }

    if (notification.caseId) return { actionHref: `/cases/${notification.caseId}`, actionLabel: "View case" };
    if (notification.appointmentId) return { actionHref: "/appointments", actionLabel: "Open appointments" };
    return { actionHref: STANDALONE_TASK_ACTION.href, actionLabel: STANDALONE_TASK_ACTION.label };
  }

  private async getNotificationAssigneeIds(notificationId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: notificationAssignees.userId })
      .from(notificationAssignees)
      .where(eq(notificationAssignees.notificationId, notificationId));
    return rows.map((row) => row.userId);
  }

  private async resetFollowUpOwnerReadState(notificationId: string, userIds: string[]): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueUserIds.length === 0) return;

    await db
      .delete(notificationReads)
      .where(and(
        eq(notificationReads.notificationId, notificationId),
        inArray(notificationReads.userId, uniqueUserIds),
      ));
  }

  private async withAction(notification: Notification): Promise<ActionableNotification> {
    return {
      ...notification,
      ...(await this.deriveNotificationAction(notification)),
      assignedUserIds: await this.getNotificationAssigneeIds(notification.id),
    };
  }

  private async withActions(rows: Notification[]): Promise<ActionableNotification[]> {
    return Promise.all(rows.map((notification) => this.withAction(notification)));
  }

  private visibleCondition(user: { id: string; role: string }): SQL {
    const sharedAssigneeCondition = sql`EXISTS (
      SELECT 1 FROM notification_assignees
      WHERE notification_assignees.notification_id = ${notifications.id}
        AND notification_assignees.user_id = ${user.id}
    )`;
    const targetedCondition = or(
      eq(notifications.recipientId, user.id),
      eq(notifications.assignedTo, user.id),
      sharedAssigneeCondition
    )!;

    if (user.role === "superadmin") {
      return or(
        eq(notifications.recipientRole, "admin"),
        eq(notifications.recipientRole, "superadmin"),
        targetedCondition
      )!;
    }

    if (user.role === "subadmin") {
      return or(
        eq(notifications.recipientRole, "admin"),
        targetedCondition
      )!;
    }

    return targetedCondition;
  }

  private async canAccessNotification(user: { id: string; role: string }, notification: Notification): Promise<boolean> {
    if (user.role === "superadmin" && (notification.recipientRole === "admin" || notification.recipientRole === "superadmin")) {
      return true;
    }
    if (user.role === "subadmin" && notification.recipientRole === "admin") {
      return true;
    }
    if (notification.recipientId === user.id || notification.assignedTo === user.id) return true;
    const [assignee] = await db
      .select({ userId: notificationAssignees.userId })
      .from(notificationAssignees)
      .where(and(
        eq(notificationAssignees.notificationId, notification.id),
        eq(notificationAssignees.userId, user.id),
      ))
      .limit(1);
    return !!assignee;
  }

  private openVisibleCondition(user: { id: string; role: string }): SQL {
    return and(
      this.visibleCondition(user),
      ne(notifications.status, "completed"),
      ne(notifications.status, "scheduled")
    )!;
  }

  async listActive(user: { id: string; role: string }): Promise<ActionableNotification[]> {
    const rows = await db.select().from(notifications)
      .where(
        and(
          eq(notifications.status, "active"),
          this.visibleCondition(user)
        )
      )
      .orderBy(desc(notifications.createdAt));
    return this.withActions(rows);
  }

  async listBellNotifications(user: { id: string; role: string }, limit = 20): Promise<BellNotificationPayload> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 20));
    const readJoin = and(
      eq(notificationReads.notificationId, notifications.id),
      eq(notificationReads.userId, user.id),
    );

    const rows = await db
      .select({
        notification: notifications,
        readAt: notificationReads.readAt,
      })
      .from(notifications)
      .leftJoin(notificationReads, readJoin)
      .where(this.openVisibleCondition(user))
      .orderBy(desc(notifications.createdAt))
      .limit(safeLimit);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .leftJoin(notificationReads, readJoin)
      .where(and(
        this.openVisibleCondition(user),
        isNull(notificationReads.readAt),
      ));

    return {
      items: await Promise.all(rows.map(async (row) => ({
        ...(await this.withAction(row.notification)),
        readAt: row.readAt ?? null,
      }))),
      unreadCount: Number(countRow?.count ?? 0),
    };
  }

  async listAllTasks(user: { id: string; role: string }, filters: TaskFilters = {}): Promise<ActionableNotification[]> {
    const conditions: SQL[] = [];
    conditions.push(notInArray(notifications.type, BELL_ONLY_NOTIFICATION_TYPES));

    if (filters.status === "all") {
    } else if (filters.status === "open" || !filters.status) {
      conditions.push(ne(notifications.status, "completed"));
    } else {
      conditions.push(eq(notifications.status, filters.status));
    }

    if (filters.urgency) {
      conditions.push(eq(notifications.urgency, filters.urgency));
    }

    if (filters.caseId) {
      conditions.push(eq(notifications.caseId, filters.caseId));
    }

    if (filters.assignedTo) {
      conditions.push(or(
        eq(notifications.assignedTo, filters.assignedTo),
        sql`EXISTS (
          SELECT 1 FROM notification_assignees
          WHERE notification_assignees.notification_id = ${notifications.id}
            AND notification_assignees.user_id = ${filters.assignedTo}
        )`,
      )!);
    }

    conditions.push(this.visibleCondition(user));

    const rows = await db.select().from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt));
    return this.withActions(rows);
  }

  // Task #212 — Paginated variant used by the dashboard "Your tasks" list so we
  // only ship one page of rows over the wire. Filters + access scoping mirror
  // listAllTasks exactly; only the slice changes.
  async listAllTasksPaged(
    user: { id: string; role: string },
    filters: TaskFilters = {},
    page: number,
    pageSize: number,
  ): Promise<{ items: ActionableNotification[]; total: number; page: number; pageSize: number }> {
    const conditions: SQL[] = [];
    conditions.push(notInArray(notifications.type, BELL_ONLY_NOTIFICATION_TYPES));

    if (filters.status === "all") {
      // no status filter
    } else if (filters.status === "open" || !filters.status) {
      conditions.push(ne(notifications.status, "completed"));
    } else {
      conditions.push(eq(notifications.status, filters.status));
    }

    if (filters.urgency) conditions.push(eq(notifications.urgency, filters.urgency));
    if (filters.caseId) conditions.push(eq(notifications.caseId, filters.caseId));
    if (filters.assignedTo) {
      conditions.push(or(
        eq(notifications.assignedTo, filters.assignedTo),
        sql`EXISTS (
          SELECT 1 FROM notification_assignees
          WHERE notification_assignees.notification_id = ${notifications.id}
            AND notification_assignees.user_id = ${filters.assignedTo}
        )`,
      )!);
    }

    conditions.push(this.visibleCondition(user));

    const whereClause = and(...conditions);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(whereClause);
    const total = Number(countRow?.count ?? 0);

    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 5));
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.max(1, Math.min(totalPages, Math.floor(page) || 1));

    const items = await db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize);

    return { items: await this.withActions(items), total, page: safePage, pageSize: safePageSize };
  }

  async getTaskCounts(user: { id: string; role: string }): Promise<{
    active: number;
    inProgress: number;
    followUp: number;
    overdueFollowUp: number;
    completed: number;
  }> {
    const accessCondition = this.visibleCondition(user);

    const all = await db.select({
      status: notifications.status,
      followUpDate: notifications.followUpDate,
    }).from(notifications)
      .where(and(
        accessCondition,
        notInArray(notifications.type, BELL_ONLY_NOTIFICATION_TYPES),
      ));

    const now = new Date();
    let active = 0, inProgress = 0, followUp = 0, overdueFollowUp = 0, completed = 0;

    for (const row of all) {
      switch (row.status) {
        case "active": active++; break;
        case "in_progress": inProgress++; break;
        case "follow_up":
          followUp++;
          if (row.followUpDate && row.followUpDate <= now) overdueFollowUp++;
          break;
        case "completed": completed++; break;
      }
    }

    return { active, inProgress, followUp, overdueFollowUp, completed };
  }

  async updateTask(
    id: string,
    user: { id: string; role: string; name: string },
    updates: {
      status?: TaskStatus;
      assignedTo?: string | null;
      assignedUserIds?: string[];
      followUpDate?: string | null;
      completionNotes?: string;
      caseNote?: string;
    }
  ): Promise<{ notification?: Notification; error?: string }> {
    const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
    if (!existing) return { error: "not_found" };

    if (user.role === "client") return { error: "access_denied" };

    const domainTask = await taskService.getVisible(user, id);
    const hasAccess = await this.canAccessNotification(user, existing)
      || !!domainTask;
    if (!hasAccess) return { error: "access_denied" };

    if (existing.type === "complaint_review") return { error: "invalid_transition" };

    // Intake progression belongs to the dedicated, atomic intake endpoints.
    // Assignments can still change, but completed contact history is immutable.
    if ((INTAKE_FOLLOW_UP_TYPES as readonly string[]).includes(existing.type)) {
      if (updates.status !== undefined || (existing.status === "completed" && (
        updates.completionNotes !== undefined || updates.caseNote !== undefined || updates.followUpDate !== undefined
      ))) return { error: "invalid_transition" };
    }

    const setData: Record<string, unknown> = {};
    let completionCaseNote: string | undefined;

    let nextAssignedUserIds: string[] | undefined;
    let assigneeNames: string[] = [];
    let removedAssigneeNames: string[] = [];
    if (updates.assignedUserIds !== undefined || updates.assignedTo !== undefined) {
      const requestedIds = updates.assignedUserIds !== undefined
        ? updates.assignedUserIds
        : updates.assignedTo ? [updates.assignedTo] : [];
      const normalizedIds = Array.from(new Set(requestedIds.map((id) => id.trim()).filter(Boolean)));
      const currentIds = await this.getNotificationAssigneeIds(existing.id);
      const currentSet = new Set(currentIds);
      const nextSet = new Set(normalizedIds);
      const usersById = new Map<string, { id: string; name: string }>();

      for (const assigneeId of normalizedIds) {
        const assignee = await storage.getUser(assigneeId);
        const invalidForInternalTask = domainTask?.audience === "internal"
          && !["superadmin", "subadmin", "staff"].includes(assignee?.role ?? "");
        if (!assignee || assignee.status !== "active" || assignee.role === "client" || invalidForInternalTask) {
          return { error: "invalid_assignee" };
        }
        usersById.set(assignee.id, { id: assignee.id, name: assignee.name });
      }

      for (const assigneeId of normalizedIds) {
        if (!currentSet.has(assigneeId)) {
          const assignee = usersById.get(assigneeId);
          if (assignee) assigneeNames.push(assignee.name);
        }
      }

      for (const assigneeId of currentIds) {
        if (!nextSet.has(assigneeId)) {
          const assignee = await storage.getUser(assigneeId);
          removedAssigneeNames.push(assignee?.name || assigneeId);
        }
      }

      nextAssignedUserIds = normalizedIds;
      setData.assignedTo = normalizedIds[0] || null;
    }

    if (updates.followUpDate !== undefined) {
      if (!updates.followUpDate && (existing.status === "follow_up" || updates.status === "follow_up")) {
        return { error: "follow_up_date_required" };
      }
      setData.followUpDate = updates.followUpDate ? new Date(updates.followUpDate) : null;
    }

    if (updates.status) {
      const currentStatus = existing.status as TaskStatus;
      const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
        active: ["in_progress", "follow_up", "completed"],
        in_progress: ["active", "follow_up", "completed"],
        follow_up: ["active", "in_progress", "completed"],
        completed: ["active"],
      };
      const allowed = VALID_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(updates.status)) {
        return { error: "invalid_transition" };
      }

      const newFollowUpDate = updates.followUpDate !== undefined ? updates.followUpDate : existing.followUpDate;
      if (updates.status === "follow_up" && !newFollowUpDate) {
        return { error: "follow_up_date_required" };
      }

      if (updates.status === "completed") {
        setData.status = "completed";
        setData.completedBy = user.id;
        setData.completedAt = new Date();

        if (updates.completionNotes) {
          setData.completionNotes = updates.completionNotes;
        }

        if (existing.caseNoteRequired && existing.caseId) {
          const note = updates.caseNote || updates.completionNotes;
          if (!note || note.trim().length === 0) {
            return { error: "case_note_required" };
          }
          completionCaseNote = note.trim();
        }
      } else {
        setData.status = updates.status;
      }
    }

    if (Object.keys(setData).length === 0) {
      return { notification: existing };
    }

    const [updated] = await db.update(notifications)
      .set(setData)
      .where(and(eq(notifications.id, id), eq(notifications.status, existing.status)))
      .returning();
    if (!updated) return { error: "invalid_transition" };

    if (existing.caseId) {
      if (completionCaseNote) {
        await storage.createConfidentialNote({
          caseId: existing.caseId, category: "Case Update", content: completionCaseNote, createdBy: user.id,
        });
      }
      if (updates.status === "completed") {
        await caseActivityService.logTaskCompleted(
          existing.caseId, existing.title, updates.completionNotes || "Task completed", staffActor(user),
        );
      }
      if (assigneeNames.length > 0) {
        await caseActivityService.logTaskAssigned(
          existing.caseId,
          existing.title,
          assigneeNames.join(", "),
          staffActor(user),
        );
      }

      if (removedAssigneeNames.length > 0) {
        await caseActivityService.logTaskStatusChanged(
          existing.caseId,
          existing.title,
          `assigned to ${removedAssigneeNames.join(", ")}`,
          "unassigned",
          staffActor(user),
        );
      }

      if (updates.status && updates.status !== "completed" && updates.status !== (existing.status as TaskStatus)) {
        await caseActivityService.logTaskStatusChanged(
          existing.caseId,
          existing.title,
          existing.status,
          updates.status,
          staffActor(user),
        );
      }
    }

    if (updated && nextAssignedUserIds !== undefined) {
      await this.syncNotificationAssignees(updated.id, nextAssignedUserIds, user.id);
    }

    if (updated && updates.status === "follow_up" && nextAssignedUserIds !== undefined) {
      await this.resetFollowUpOwnerReadState(updated.id, nextAssignedUserIds);
    }

    if (updated) {
      const [sourceLink] = await db.select().from(notificationTaskLinks).where(eq(notificationTaskLinks.taskId, updated.id)).limit(1);
      if (sourceLink && updates.status) {
        const sourceUser = await storage.getUser(sourceLink.userId);
        if (!sourceUser) return { notification: updated };
        if (updates.status === "completed") {
          await db.update(notificationTaskLinks).set({ completedAt: new Date() }).where(and(eq(notificationTaskLinks.notificationId, sourceLink.notificationId), eq(notificationTaskLinks.userId, sourceLink.userId)));
          await this.markRead(sourceLink.notificationId, sourceUser);
        } else if (existing.status === "completed") {
          await db.update(notificationTaskLinks).set({ completedAt: null, reopenedAt: new Date() }).where(and(eq(notificationTaskLinks.notificationId, sourceLink.notificationId), eq(notificationTaskLinks.userId, sourceLink.userId)));
          await this.markUnread(sourceLink.notificationId, sourceUser);
        }
      }
      const assignedUserIds = await this.getNotificationAssigneeIds(updated.id);
      await taskService.mirrorLegacyNotification({ ...updated, assignedUserIds }, user.id);
      notificationRealtimeService.broadcastToNotificationAudience({
        ...updated,
        assignedUserIds,
      }, "notification_updated");
      if (updated.status === "completed") {
        const { taskCalendarService } = await import("./task-calendar.service");
        await taskCalendarService.removeSchedule(updated.id);
      }
    }

    return { notification: updated };
  }

  async complete(id: string, user: { id: string; role: string; name?: string }, caseNote?: string): Promise<{ notification?: Notification; error?: string }> {
    return this.updateTask(id, { id: user.id, role: user.role, name: user.name || "System" }, {
      status: "completed",
      completionNotes: caseNote,
      caseNote,
    });
  }

  async publishPersistedNotifications(ids: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;
    const rows = await db.select().from(notifications).where(inArray(notifications.id, uniqueIds));
    for (const notification of rows) {
      const assignedUserIds = await this.getNotificationAssigneeIds(notification.id);
      notificationRealtimeService.broadcastToNotificationAudience({
        ...notification,
        assignedUserIds,
      }, notification.status === "completed" ? "notification_updated" : undefined);
    }
  }

  async completeDocumentRequestNotification(documentRequestId: string): Promise<void> {
    const rows = await db.update(notifications)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(notifications.documentRequestId, documentRequestId))
      .returning();
    await this.publishPersistedNotifications(rows.map((row) => row.id));
  }

  async reopenDocumentRequestNotification(documentRequestId: string): Promise<void> {
    const rows = await db.update(notifications)
      .set({ status: "active", completedAt: null, completedBy: null })
      .where(eq(notifications.documentRequestId, documentRequestId))
      .returning();
    if (rows.length > 0) {
      await db.delete(notificationReads).where(inArray(notificationReads.notificationId, rows.map((row) => row.id)));
      await this.publishPersistedNotifications(rows.map((row) => row.id));
    }
  }

  async escalateOverdueFollowUps(): Promise<ActionableNotification[]> {
    const now = new Date();

    const escalated = await db.update(notifications)
      .set({ status: "active", urgency: "red" })
      .where(
        and(
          eq(notifications.status, "follow_up"),
          lte(notifications.followUpDate, now)
        )
      )
      .returning();

    if (escalated.length === 0) return [];

    for (const task of escalated) {
      const assignedUserIds = await this.getNotificationAssigneeIds(task.id);
      if (task.caseId && task.followUpDate) {
        await caseActivityService.logFollowUpEscalated(
          task.caseId,
          task.title,
          task.followUpDate,
        );
      }

      if (assignedUserIds.length > 0) {
        await this.createNotification({
          recipientRole: "task_assignee",
          type: TASK_FOLLOW_UP_DUE_ALERT_TYPE,
          urgency: "red",
          caseId: task.caseId,
          complaintId: task.complaintId,
          appointmentId: task.appointmentId,
          title: `Follow-up due — ${task.title}`,
          message: `A follow-up task is now due: ${task.title}`,
          status: "active",
          assignedUserIds: assignedUserIds,
          followUpDate: task.followUpDate,
          caseNoteRequired: false,
        });
      }
    }

    return this.withActions(escalated);
  }

  async notifyDueDynamicIntakeFollowUps(now = new Date()): Promise<Notification[]> {
    const dueTasks = await db.select().from(notifications).where(and(
      eq(notifications.type, DYNAMIC_INTAKE_FOLLOW_UP_TYPE),
      inArray(notifications.status, [...OPEN_INTAKE_FOLLOW_UP_STATUSES]),
      lte(notifications.followUpDate, now),
    ));
    const createdAlerts: Notification[] = [];

    for (const task of dueTasks) {
      const audience = dynamicFollowUpAudience(await this.getNotificationAssigneeIds(task.id));
      const sourceTaskId = task.taskId ?? task.id;
      const [created] = await db.insert(notifications).values({
        recipientRole: audience.recipientRole,
        type: TASK_FOLLOW_UP_DUE_ALERT_TYPE,
        urgency: "red",
        caseId: task.caseId,
        taskId: sourceTaskId,
        title: `Follow-up due — ${task.title}`,
        message: `An intake follow-up is now due: ${task.title}`,
        status: "active",
        assignedTo: audience.assignedTo,
        followUpDate: task.followUpDate,
        caseNoteRequired: false,
      }).onConflictDoNothing().returning();
      if (!created) continue;
      await this.syncNotificationAssignees(created.id, audience.assigneeIds);
      notificationRealtimeService.broadcastToNotificationAudience({
        ...created,
        assignedUserIds: audience.assigneeIds,
      });
      createdAlerts.push(created);
    }

    return createdAlerts;
  }

  async ensureNextPersistentIntakeFollowUp(
    caseId: string,
    actor: ReturnType<typeof staffActor> | ReturnType<typeof systemActor> = systemActor("persistent intake follow-up"),
    now = new Date(),
  ): Promise<Notification | null> {
    const existingCase = await storage.getCase(caseId);
    if (!existingCase) return null;
    if (existingCase.status === "Closed" || existingCase.status === "Archived") return null;
    if (existingCase.intakeStatus === "Closed") return null;
    if (existingCase.standardChaseStopped || existingCase.safeguardingStatus === "concern") return null;

    const [openTask] = await db.select().from(notifications).where(and(
      eq(notifications.caseId, caseId),
      inArray(notifications.type, [...INTAKE_FOLLOW_UP_TYPES]),
      inArray(notifications.status, [...OPEN_INTAKE_FOLLOW_UP_STATUSES]),
    )).limit(1);
    if (openTask) return null;

    const [triggerTask] = await db.select().from(notifications).where(and(
      eq(notifications.caseId, caseId),
      eq(notifications.status, "completed"),
      or(
        eq(notifications.type, INTAKE_PERSISTENT_FOLLOW_UP_TYPE),
        sql`(${notifications.type} = 'enquiry_chase' AND (${notifications.message} ILIKE '%day-10%' OR ${notifications.title} ILIKE '%Day 10%'))`,
      )!,
    )).orderBy(desc(notifications.completedAt), desc(notifications.createdAt)).limit(1);

    if (!triggerTask || (!isDay10ChaseTask(triggerTask) && !isPersistentIntakeFollowUpTask(triggerTask))) return null;

    const dueAt = addDays(triggerTask.completedAt ? new Date(triggerTask.completedAt) : now, PERSISTENT_INTAKE_FOLLOW_UP_INTERVAL_DAYS);
    const created = await this.createNotification({
      recipientRole: "admin",
      type: INTAKE_PERSISTENT_FOLLOW_UP_TYPE,
      urgency: "amber",
      caseId,
      title: `Ongoing enquiry follow-up — ${existingCase.caseRef}`,
      message: "[persistent] Weekly post-Day-10 enquiry follow-up. Completion notes are required; continue until an intake closure outcome is recorded.",
      status: "active",
      followUpDate: dueAt,
      caseNoteRequired: true,
    });

    if (created) {
      await caseActivityService.logTaskCreated(caseId, created.title, created.urgency, actor);
    }

    return created || null;
  }

  async ensurePersistentIntakeFollowUps(now = new Date()): Promise<Notification[]> {
    const candidateRows = await db
      .select({ id: cases.id })
      .from(cases)
      .where(and(
        sql`${cases.status} NOT IN ('Closed', 'Archived')`,
        sql`COALESCE(${cases.intakeStatus}, '') <> 'Closed'`,
        sql`COALESCE(${cases.standardChaseStopped}, false) = false`,
        sql`COALESCE(${cases.safeguardingStatus}, '') <> 'concern'`,
        sql`EXISTS (
          SELECT 1 FROM notifications completed_intake
          WHERE completed_intake.case_id = ${cases.id}
            AND completed_intake.status = 'completed'
            AND (
              completed_intake.type = ${INTAKE_PERSISTENT_FOLLOW_UP_TYPE}
              OR (
                completed_intake.type = 'enquiry_chase'
                AND (
                  completed_intake.message ILIKE '%day-10%'
                  OR completed_intake.title ILIKE '%Day 10%'
                )
              )
            )
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM notifications open_intake
          WHERE open_intake.case_id = ${cases.id}
            AND open_intake.type IN ('enquiry_follow_up', 'enquiry_chase', ${INTAKE_PERSISTENT_FOLLOW_UP_TYPE})
            AND open_intake.status IN ('active', 'in_progress', 'follow_up')
        )`,
      ));

    const created: Notification[] = [];
    for (const row of candidateRows) {
      const task = await this.ensureNextPersistentIntakeFollowUp(row.id, systemActor("persistent intake follow-up sweep"), now);
      if (task) created.push(task);
    }
    return created;
  }

  async deleteTask(id: string): Promise<Notification | null> {
    const [existing] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    if (existing?.type === "complaint_review") return null;
    const [deleted] = await db.delete(notifications)
      .where(eq(notifications.id, id))
      .returning();
    if (deleted) notificationRealtimeService.broadcastNotificationDeleted(deleted);
    return deleted ?? null;
  }

  async deleteTasks(ids: string[]): Promise<{ deleted: Notification[]; missingIds: string[] }> {
    if (ids.length === 0) return { deleted: [], missingIds: [] };
    return db.transaction(async (tx) => {
      const existing = await tx.select({ id: notifications.id })
        .from(notifications)
        .where(inArray(notifications.id, ids));
      const protectedRows = await tx.select({ id: notifications.id }).from(notifications)
        .where(and(inArray(notifications.id, ids), eq(notifications.type, "complaint_review")));
      if (protectedRows.length > 0) return { deleted: [], missingIds: protectedRows.map((row) => row.id) };
      const foundIds = new Set(existing.map(r => r.id));
      const missingIds = ids.filter(id => !foundIds.has(id));
      if (missingIds.length > 0) {
        return { deleted: [], missingIds };
      }
      const deleted = await tx.delete(notifications)
        .where(inArray(notifications.id, ids))
        .returning();
      for (const task of deleted) {
        notificationRealtimeService.broadcastNotificationDeleted(task);
      }
      return { deleted, missingIds: [] };
    });
  }

  private async syncNotificationAssignees(notificationId: string, assignedUserIds: string[], assignedBy?: string | null): Promise<void> {
    await db.delete(notificationAssignees).where(eq(notificationAssignees.notificationId, notificationId));
    if (assignedUserIds.length === 0) return;
    await db.insert(notificationAssignees).values(
      assignedUserIds.map((userId) => ({
        notificationId,
        userId,
        assignedBy: assignedBy || null,
      })),
    ).onConflictDoNothing();
  }

  async createNotification(data: NotificationCreateInput): Promise<Notification> {
    const { assignedUserIds, assignedBy, ...notificationData } = data;
    const initialAssigneeIds = assignedUserIds !== undefined
      ? Array.from(new Set(assignedUserIds.map((id) => id.trim()).filter(Boolean)))
      : notificationData.assignedTo ? [notificationData.assignedTo] : [];
    const insert = db.insert(notifications).values({
      ...notificationData,
      assignedTo: initialAssigneeIds[0] || notificationData.assignedTo || null,
    });
    const [created] = data.id
      ? await insert.onConflictDoNothing({ target: notifications.id }).returning()
      : await insert.returning();
    if (created) {
      await this.syncNotificationAssignees(created.id, initialAssigneeIds, assignedBy || null);
      await taskService.mirrorLegacyNotification({ ...created, assignedUserIds: initialAssigneeIds }, assignedBy || null);
      notificationRealtimeService.broadcastToNotificationAudience({
        ...created,
        assignedUserIds: initialAssigneeIds,
      });
      return created;
    }
    if (data.id) {
      const [existing] = await db.select().from(notifications).where(eq(notifications.id, data.id)).limit(1);
      if (existing) return existing;
    }
    throw new Error("Failed to create notification");
  }

  async markRead(id: string, user: { id: string; role: string }): Promise<{ notification?: BellNotification; unreadCount?: number; error?: string }> {
    const [existing] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), this.visibleCondition(user)))
      .limit(1);

    if (!existing) return { error: "not_found" };

    await db
      .insert(notificationReads)
      .values({ notificationId: id, userId: user.id })
      .onConflictDoUpdate({
        target: [notificationReads.notificationId, notificationReads.userId],
        set: { readAt: new Date() },
      });

    const unreadCount = await this.getUnreadBellCount(user);
    notificationRealtimeService.broadcastToUser(user.id, { type: "notification_read", notificationId: id, unreadCount });
    return { notification: { ...(await this.withAction(existing)), readAt: new Date() }, unreadCount };
  }

  async markAllVisibleRead(user: { id: string; role: string }): Promise<{ marked: number; unreadCount: number }> {
    const unreadRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .leftJoin(notificationReads, and(
        eq(notificationReads.notificationId, notifications.id),
        eq(notificationReads.userId, user.id),
      ))
      .where(and(
        this.openVisibleCondition(user),
        isNull(notificationReads.readAt),
      ));

    for (const row of unreadRows) {
      await db
        .insert(notificationReads)
        .values({ notificationId: row.id, userId: user.id })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.userId],
          set: { readAt: new Date() },
        });
    }

    notificationRealtimeService.broadcastToUser(user.id, { type: "notification_read", unreadCount: 0 });
    return { marked: unreadRows.length, unreadCount: 0 };
  }

  async getUnreadBellCount(user: { id: string; role: string }): Promise<number> {
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .leftJoin(notificationReads, and(
        eq(notificationReads.notificationId, notifications.id),
        eq(notificationReads.userId, user.id),
      ))
      .where(and(
        this.openVisibleCondition(user),
        isNull(notificationReads.readAt),
      ));

    return Number(countRow?.count ?? 0);
  }

  async createAppointmentNotifications(
    appointmentId: string,
    caseId: string,
    type: "hold" | "held" | "confirmed" | "cancelled" | "expired",
    clientName: string,
    mediatorId: string | null,
    caseRef: string,
    serviceTypeName: string
  ): Promise<void> {
    const urgencyMap: Record<string, string> = {
      hold: "amber",
      held: "amber",
      confirmed: "green",
      cancelled: "red",
      expired: "red",
    };
    const urgency = urgencyMap[type];

    const titleMap: Record<string, string> = {
      hold: `Payment hold — ${clientName}`,
      held: `Payment hold — ${clientName}`,
      confirmed: `Appointment confirmed — ${clientName}`,
      cancelled: `Appointment cancelled — ${clientName}`,
      expired: `Appointment expired — ${clientName}`,
    };
    const title = titleMap[type];

    const messageMap: Record<string, string> = {
      hold: `${clientName} has requested a ${serviceTypeName} appointment for case ${caseRef}. The slot is reserved in the CRM pending payment or voucher acceptance before the hold deadline. No calendar invite has been sent yet.`,
      held: `${clientName} has requested a ${serviceTypeName} appointment for case ${caseRef}. The slot is reserved in the CRM pending payment or voucher acceptance before the hold deadline. No calendar invite has been sent yet.`,
      confirmed: `The ${serviceTypeName} appointment for ${clientName} (case ${caseRef}) has been confirmed.`,
      cancelled: `The ${serviceTypeName} appointment for ${clientName} (case ${caseRef}) has been cancelled.`,
      expired: `The payment hold for ${serviceTypeName} for ${clientName} (case ${caseRef}) has auto-cancelled because payment or voucher acceptance was not recorded before the hold deadline. Please follow up with the client.`,
    };
    const message = messageMap[type];

    const caseNoteRequired = urgency === "red" || urgency === "amber";

    await this.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type,
      urgency,
      caseId,
      appointmentId,
      title,
      message,
      caseNoteRequired,
    });

    await caseActivityService.logTaskCreated(caseId, title, urgency, systemActor("appointment workflow"));

    if (mediatorId) {
      await this.createNotification({
        recipientId: mediatorId,
        recipientRole: "mediator",
        type,
        urgency,
        caseId,
        appointmentId,
        title,
        message,
        caseNoteRequired,
      });
    }

    const parties = await storage.listPartiesByCase(caseId);
    for (const party of parties) {
      if (party.userId) {
        await this.createNotification({
          recipientId: party.userId,
          recipientRole: "client",
          type,
          urgency: "green",
          caseId,
          appointmentId,
          title: type === "confirmed"
            ? "Your appointment has been confirmed"
            : type === "hold" || type === "held"
              ? "Your appointment is pending payment"
              : "Your appointment has been cancelled",
          message: type === "confirmed"
            ? `Your ${serviceTypeName} appointment has been confirmed. You will receive joining details before the appointment.`
            : type === "hold" || type === "held"
              ? `Your ${serviceTypeName} appointment request is pending payment or voucher acceptance before the hold deadline. Calendar details will be sent after confirmation.`
              : `Your ${serviceTypeName} appointment has been cancelled. Please contact us if you would like to rebook.`,
          caseNoteRequired: false,
        });
      }
    }
  }
}

export const notificationService = new NotificationService();
