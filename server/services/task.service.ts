import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import {
  notificationAssignees,
  notifications,
  cases,
  clients,
  enquiries,
  parties,
  taskAssignees,
  taskSchedules,
  taskSeries,
  tasks,
  users,
  type Notification,
  type Task,
  type TaskStatus,
} from "@shared/schema";
import type { TaskQuery } from "@shared/task-query";
import {
  classifyLegacyTaskAudience,
  isActionableTaskType,
  legacyTaskCandidateUserIds,
  legacyTaskVisibility,
  resolveLegacyTaskOwnership,
  toTaskCompatibilityDto,
} from "@shared/task-domain";
import { db } from "../db";

export type TaskFilters = {
  status?: string;
  assignedTo?: string;
  urgency?: string;
  caseId?: string;
  audience?: string;
  includeUpcoming?: boolean;
  query?: TaskQuery;
};

export type TaskCompatibilityDto = ReturnType<typeof toTaskCompatibilityDto> & {
  actionHref: string;
  actionLabel: string;
  caseReference?: string | null;
};

type LegacyMirrorInput = Notification & { assignedUserIds?: string[] };

export class TaskService {
  private accessCondition(actor: { id: string; role: string }): SQL {
    const assignedToActor = sql`EXISTS (
      SELECT 1 FROM task_assignees own_assignment
      WHERE own_assignment.task_id = ${tasks.id}
        AND own_assignment.user_id = ${actor.id}
    )`;

    if (actor.role === "superadmin") return inArray(tasks.audience, ["internal", "mediator"]);
    if (actor.role === "subadmin") {
      const assignedToStaff = sql`EXISTS (
        SELECT 1 FROM task_assignees staff_assignment
        JOIN users staff_user ON staff_user.id = staff_assignment.user_id
        WHERE staff_assignment.task_id = ${tasks.id}
          AND staff_user.role = 'staff'
          AND staff_user.status = 'active'
      )`;
      return and(
        eq(tasks.audience, "internal"),
        ne(tasks.visibility, "superadmin_only"),
        or(eq(tasks.visibility, "admin_wide"), assignedToActor, assignedToStaff)!,
      )!;
    }
    if (actor.role === "staff") {
      return and(eq(tasks.audience, "internal"), assignedToActor)!;
    }
    if (actor.role === "mediator" || actor.role === "client") {
      return and(eq(tasks.audience, actor.role), assignedToActor)!;
    }
    return sql`FALSE`;
  }

  private filterConditions(actor: { id: string; role: string }, filters: TaskFilters): SQL[] {
    const conditions: SQL[] = [this.accessCondition(actor)];
    if (filters.status === "all") {
      // no status condition
    } else if (!filters.status || filters.status === "open") {
      conditions.push(ne(tasks.status, "completed"));
      conditions.push(ne(tasks.status, "cancelled"));
      if (!filters.includeUpcoming) conditions.push(ne(tasks.status, "scheduled"));
    } else {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters.urgency && filters.urgency !== "all") conditions.push(eq(tasks.urgency, filters.urgency));
    if (filters.caseId && filters.caseId !== "all") conditions.push(eq(tasks.caseId, filters.caseId));
    if (filters.audience) conditions.push(eq(tasks.audience, filters.audience));
    if (filters.assignedTo && filters.assignedTo !== "all") {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM task_assignees filtered_assignment
        WHERE filtered_assignment.task_id = ${tasks.id}
          AND filtered_assignment.user_id = ${filters.assignedTo}
      )`);
    }
    const query = filters.query;
    if (query) {
      const statuses = query.statuses;
      if (statuses.includes("all")) {
        // Explicit all-status view, including completed and cancelled tasks.
      } else if (statuses.length && !(statuses.length === 1 && statuses[0] === "open")) {
        const statusConditions = statuses.map((status) => status === "open"
          ? and(ne(tasks.status, "completed"), ne(tasks.status, "cancelled"), filters.includeUpcoming ? undefined : ne(tasks.status, "scheduled"))!
          : eq(tasks.status, status));
        conditions.push(or(...statusConditions)!);
      } else if (statuses[0] === "open") {
        conditions.push(ne(tasks.status, "completed"), ne(tasks.status, "cancelled"));
        if (!filters.includeUpcoming) conditions.push(ne(tasks.status, "scheduled"));
      }
      if (query.urgencies.length) conditions.push(inArray(tasks.urgency, query.urgencies));
      if (query.assignedTo.length) conditions.push(sql`EXISTS (SELECT 1 FROM task_assignees query_assignment WHERE query_assignment.task_id = ${tasks.id} AND query_assignment.user_id IN ${query.assignedTo})`);
      if (query.unassigned) conditions.push(sql`NOT EXISTS (SELECT 1 FROM task_assignees query_assignment WHERE query_assignment.task_id = ${tasks.id})`);
      if (query.caseIds.length) conditions.push(inArray(tasks.caseId, query.caseIds));
      if (query.enquiryIds.length) conditions.push(inArray(tasks.enquiryId, query.enquiryIds));
      if (query.clientIds.length) conditions.push(sql`EXISTS (SELECT 1 FROM parties query_party WHERE query_party.case_id = ${tasks.caseId} AND query_party.client_id IN ${query.clientIds})`);
      if (query.types.length) conditions.push(inArray(tasks.type, query.types));
      if (query.scheduleState === "scheduled") conditions.push(sql`EXISTS (SELECT 1 FROM task_schedules query_schedule WHERE query_schedule.task_id = ${tasks.id} AND query_schedule.active = true)`);
      if (query.scheduleState === "unscheduled") conditions.push(sql`NOT EXISTS (SELECT 1 FROM task_schedules query_schedule WHERE query_schedule.task_id = ${tasks.id} AND query_schedule.active = true)`);
      if (query.dueState === "none") conditions.push(sql`${tasks.dueAt} IS NULL`);
      if (query.dueState === "overdue") conditions.push(sql`${tasks.dueAt} < NOW()`);
      if (query.dueState === "today") conditions.push(sql`${tasks.dueAt} >= date_trunc('day', NOW() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AND ${tasks.dueAt} < (date_trunc('day', NOW() AT TIME ZONE 'Europe/London') + interval '1 day') AT TIME ZONE 'Europe/London'`);
      if (query.dueState === "upcoming") conditions.push(sql`${tasks.dueAt} >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/London') + interval '1 day') AT TIME ZONE 'Europe/London'`);
      const instantRange = (column: any, from: string | null, to: string | null) => {
        if (from) conditions.push(sql`${column} >= (${from}::date AT TIME ZONE 'Europe/London')`);
        if (to) conditions.push(sql`${column} < ((${to}::date + interval '1 day') AT TIME ZONE 'Europe/London')`);
      };
      instantRange(tasks.dueAt, query.dueFrom, query.dueTo);
      instantRange(tasks.createdAt, query.createdFrom, query.createdTo);
      if (query.scheduledFrom || query.scheduledTo) {
        const from = query.scheduledFrom;
        const to = query.scheduledTo;
        conditions.push(sql`EXISTS (SELECT 1 FROM task_schedules query_schedule WHERE query_schedule.task_id = ${tasks.id} AND query_schedule.active = true
          AND (${from}::text IS NULL OR COALESCE(query_schedule.start_at, query_schedule.all_day_start::timestamp) >= (${from}::date AT TIME ZONE 'Europe/London'))
          AND (${to}::text IS NULL OR COALESCE(query_schedule.start_at, query_schedule.all_day_start::timestamp) < ((${to}::date + interval '1 day') AT TIME ZONE 'Europe/London')))`);
      }
      if (query.q) {
        const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
        conditions.push(sql`(${tasks.title} ILIKE ${pattern} OR ${tasks.message} ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM cases query_case WHERE query_case.id = ${tasks.caseId} AND query_case.case_ref ILIKE ${pattern})
          OR EXISTS (SELECT 1 FROM enquiries query_enquiry WHERE query_enquiry.id = ${tasks.enquiryId} AND query_enquiry.enquiry_ref ILIKE ${pattern})
          OR EXISTS (SELECT 1 FROM parties query_party JOIN clients query_client ON query_client.id = query_party.client_id WHERE query_party.case_id = ${tasks.caseId} AND (query_client.first_name ILIKE ${pattern} OR query_client.last_name ILIKE ${pattern} OR (query_client.first_name || ' ' || query_client.last_name) ILIKE ${pattern})))`);
      }
    }
    return conditions;
  }

  private actionLabel(href: string): string {
    if (href.includes("tab=mediation-sessions")) return "Open mediation sessions";
    if (href.includes("tab=appointments") || href === "/appointments") return "Open appointments";
    if (href.includes("tab=payments")) return "Open payments";
    if (href.includes("tab=documents")) return "Open documents";
    if (href.includes("tab=financial-disclosure")) return "Open financial disclosure";
    if (href.includes("tab=demographic")) return "Open demographic data";
    if (href.includes("tab=miam-record")) return "Open MIAM record";
    if (href.startsWith("/mediators/")) return "Open mediator";
    if (href.startsWith("/enquiries/")) return "Open enquiry";
    if (href.startsWith("/complaints/")) return "Open complaint";
    if (href.startsWith("/cases/")) return "View case";
    return "Open tasks";
  }

  private safeActionHint(task: Task): string | null {
    const match = `${task.title} ${task.message}`.match(/\/(?:cases|enquiries|mediators|complaints)\/[a-zA-Z0-9-]+(?:\?[a-zA-Z0-9_=&-]+)?|\/tasks|\/appointments/);
    if (!match) return null;
    const [pathname, query = ""] = match[0].split("?");
    if (!query) return pathname;
    const params = new URLSearchParams(query);
    const tab = params.get("tab");
    const validCaseTabs = new Set(["appointments", "mediation-sessions", "payments", "documents", "financial-disclosure", "demographic", "miam-record"]);
    if (pathname.startsWith("/cases/") && tab && validCaseTabs.has(tab)) {
      const safe = new URLSearchParams({ tab });
      const appointmentId = params.get("appointmentId");
      const action = params.get("action");
      if (appointmentId && /^[a-zA-Z0-9-]+$/.test(appointmentId)) safe.set("appointmentId", appointmentId);
      if (action === "resolve-miam") safe.set("action", action);
      return `${pathname}?${safe.toString()}`;
    }
    if (pathname.startsWith("/mediators/") && tab === "service_offering") {
      const safe = new URLSearchParams({ tab });
      if (params.get("section") === "service-proof") safe.set("section", "service-proof");
      const serviceTypeId = params.get("serviceTypeId");
      if (serviceTypeId && /^[a-zA-Z0-9-]+$/.test(serviceTypeId)) safe.set("serviceTypeId", serviceTypeId);
      return `${pathname}?${safe}`;
    }
    return pathname;
  }

  private async actionFor(task: Task): Promise<{ actionHref: string; actionLabel: string }> {
    if (task.complaintId) return { actionHref: `/complaints/${task.complaintId}`, actionLabel: "Open complaint" };
    const hint = this.safeActionHint(task);
    if (hint) return { actionHref: hint, actionLabel: this.actionLabel(hint) };
    const text = `${task.type} ${task.title} ${task.message}`.toLowerCase();
    const caseTab = (tab: string, actionLabel: string) => task.caseId
      ? { actionHref: `/cases/${task.caseId}?tab=${tab}`, actionLabel }
      : { actionHref: "/tasks", actionLabel: "Open tasks" };
    if (task.type.startsWith("mediation_session") || text.includes("mediation session") || text.includes("agreement to mediate") || text.includes("session acknowledgement")) return caseTab("mediation-sessions", "Open mediation sessions");
    if (task.appointmentId || task.type.includes("appointment") || text.includes("cancellation request")) return caseTab("appointments", "Open appointments");
    if (task.type.includes("payment") || task.type.includes("invoice") || text.includes("payment") || text.includes("invoice")) return caseTab("payments", "Open payments");
    if (task.type.includes("financial") || text.includes("financial disclosure")) return caseTab("financial-disclosure", "Open financial disclosure");
    if (task.type.includes("demographic") || text.includes("demographic")) return caseTab("demographic", "Open demographic data");
    if (task.type.includes("miam") || text.includes("miam")) return caseTab("miam-record", "Open MIAM record");
    if (task.type.includes("document") || task.type.includes("form") || text.includes("document") || text.includes("upload") || text.includes("form")) return caseTab("documents", "Open documents");
    if (task.type.includes("enquiry") || text.includes("enquiry") || text.includes("intake")) {
      if (task.enquiryId) return { actionHref: `/enquiries/${task.enquiryId}`, actionLabel: "Open enquiry" };
      if (task.caseId) {
        const [enquiry] = await db.select({ id: enquiries.id }).from(enquiries).where(eq(enquiries.convertedCaseId, task.caseId)).limit(1);
        if (enquiry) return { actionHref: `/enquiries/${enquiry.id}`, actionLabel: "Open enquiry" };
      }
    }
    if (task.caseId) return { actionHref: `/cases/${task.caseId}`, actionLabel: "View case" };
    if (task.appointmentId) return { actionHref: "/appointments", actionLabel: "Open appointments" };
    return { actionHref: "/tasks", actionLabel: "Open tasks" };
  }

  private async decorate(rows: Task[]): Promise<TaskCompatibilityDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const actorUserIds = rows.flatMap((row) => [row.createdBy, row.completedBy, row.cancelledBy]).filter((id): id is string => !!id);
    const caseIds = Array.from(new Set(rows.map((row) => row.caseId).filter((id): id is string => !!id)));
    const [assigneeRows, scheduleRows, seriesRows, caseRows] = await Promise.all([
      db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, ids)),
      db.select().from(taskSchedules).where(inArray(taskSchedules.taskId, ids)),
      db.select().from(taskSeries).where(inArray(taskSeries.id, rows.map((row) => row.seriesId).filter((id): id is string => !!id).length ? rows.map((row) => row.seriesId).filter((id): id is string => !!id) : ["__none__"])),
      caseIds.length ? db.select({ id: cases.id, caseRef: cases.caseRef }).from(cases).where(inArray(cases.id, caseIds)) : Promise.resolve([]),
    ]);
    const userIds = Array.from(new Set([...actorUserIds, ...assigneeRows.map((row) => row.userId)]));
    const userRows = userIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [];
    const assigneesByTask = new Map<string, string[]>();
    for (const row of assigneeRows) {
      const values = assigneesByTask.get(row.taskId) ?? [];
      values.push(row.userId);
      assigneesByTask.set(row.taskId, values);
    }
    const scheduleByTask = new Map(scheduleRows.map((row) => [row.taskId, row]));
    const seriesById = new Map(seriesRows.map((row) => [row.id, row]));
    const caseReferenceById = new Map(caseRows.map((row) => [row.id, row.caseRef]));
    const userNameById = new Map(userRows.map((row) => [row.id, row.name]));
    return Promise.all(rows.map(async (task) => ({
      ...toTaskCompatibilityDto({
        task,
        assignedUserIds: assigneesByTask.get(task.id) ?? [],
        schedule: scheduleByTask.get(task.id) ?? null,
      }),
      series: task.seriesId ? (() => { const series = seriesById.get(task.seriesId!); return series ? { frequency: series.frequency, endDate: series.endDate, active: series.active } : null; })() : null,
      caseReference: task.caseId ? caseReferenceById.get(task.caseId) ?? null : null,
      assignees: (assigneesByTask.get(task.id) ?? []).map((id) => ({ id, name: userNameById.get(id) ?? "Unknown" })),
      createdByName: task.createdBy ? userNameById.get(task.createdBy) ?? "Unknown" : null,
      completedByName: task.completedBy ? userNameById.get(task.completedBy) ?? "Unknown" : null,
      cancelledByName: task.cancelledBy ? userNameById.get(task.cancelledBy) ?? "Unknown" : null,
      ...(await this.actionFor(task)),
    })));
  }

  async list(actor: { id: string; role: string }, filters: TaskFilters = {}): Promise<TaskCompatibilityDto[]> {
    const rows = await db.select().from(tasks)
      .where(and(...this.filterConditions(actor, filters)))
      .orderBy(desc(tasks.createdAt));
    return this.decorate(rows);
  }

  async listPaged(
    actor: { id: string; role: string },
    filters: TaskFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: TaskCompatibilityDto[]; total: number; page: number; pageSize: number }> {
    const where = and(...this.filterConditions(actor, filters));
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where);
    const total = Number(countRow?.count ?? 0);
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 5));
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.max(1, Math.min(totalPages, Math.floor(page) || 1));
    const rows = await db.select().from(tasks).where(where)
      .orderBy(desc(tasks.createdAt))
      .limit(safePageSize)
      .offset((safePage - 1) * safePageSize);
    return { items: await this.decorate(rows), total, page: safePage, pageSize: safePageSize };
  }

  async getVisible(actor: { id: string; role: string }, id: string): Promise<TaskCompatibilityDto | null> {
    const [row] = await db.select().from(tasks)
      .where(and(eq(tasks.id, id), this.accessCondition(actor)))
      .limit(1);
    return row ? (await this.decorate([row]))[0] : null;
  }

  async getCounts(actor: { id: string; role: string }, filters: TaskFilters = {}) {
    const rows = await db.select({ status: tasks.status, dueAt: tasks.dueAt }).from(tasks)
      .where(and(...this.filterConditions(actor, filters)));
    const now = new Date();
    let active = 0;
    let inProgress = 0;
    let followUp = 0;
    let overdueFollowUp = 0;
    let completed = 0;
    for (const row of rows) {
      if (row.status === "active") active += 1;
      else if (row.status === "in_progress") inProgress += 1;
      else if (row.status === "completed") completed += 1;
      else if (row.status === "follow_up") {
        followUp += 1;
        if (row.dueAt && row.dueAt <= now) overdueFollowUp += 1;
      }
    }
    return { active, inProgress, followUp, overdueFollowUp, completed };
  }

  async mirrorLegacyNotification(input: LegacyMirrorInput, assignedBy?: string | null): Promise<Task | null> {
    if (!isActionableTaskType(input.type)) return null;
    const audience = classifyLegacyTaskAudience(input);
    if (!audience) return null;
    const candidateUserIds = legacyTaskCandidateUserIds(input);
    const existingUsers = candidateUserIds.length > 0
      ? await db.select({ id: users.id }).from(users).where(inArray(users.id, candidateUserIds))
      : [];
    const ownership = resolveLegacyTaskOwnership(
      input.recipientRole,
      candidateUserIds,
      new Set(existingUsers.map((user) => user.id)),
    );
    if (!ownership.shouldMirror) return null;
    const assignedUserIds = ownership.validAssigneeIds;
    const values = {
      id: input.id,
      audience,
      visibility: legacyTaskVisibility(input.recipientRole),
      type: input.type,
      urgency: input.urgency,
      status: input.status,
      title: input.title,
      message: input.message,
      caseId: input.caseId,
      complaintId: input.complaintId,
      appointmentId: input.appointmentId,
      dueAt: input.followUpDate,
      completionNotes: input.completionNotes,
      completedBy: input.completedBy,
      completedAt: input.completedAt,
      caseNoteRequired: input.caseNoteRequired,
      createdBy: assignedBy ?? null,
      legacyNotificationId: input.id,
      createdAt: input.createdAt,
      updatedAt: new Date(),
    };
    const [task] = await db.insert(tasks).values(values).onConflictDoUpdate({
      target: tasks.id,
      set: {
        ...values,
        createdBy: sql`COALESCE(${tasks.createdBy}, ${assignedBy ?? null})`,
      },
    }).returning();
    await db.delete(taskAssignees).where(eq(taskAssignees.taskId, input.id));
    if (assignedUserIds.length > 0) {
      await db.insert(taskAssignees).values(assignedUserIds.map((userId) => ({
        taskId: input.id,
        userId,
        assignedBy: assignedBy ?? null,
      }))).onConflictDoNothing();
    }
    await db.update(notifications).set({ taskId: input.id }).where(eq(notifications.id, input.id));
    return task;
  }

  async syncLegacyAssignees(notificationId: string, assignedBy?: string | null): Promise<void> {
    const [notification] = await db.select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
    if (!notification) return;
    const assignees = await db.select({ userId: notificationAssignees.userId })
      .from(notificationAssignees)
      .where(eq(notificationAssignees.notificationId, notificationId));
    await this.mirrorLegacyNotification({ ...notification, assignedUserIds: assignees.map((row) => row.userId) }, assignedBy);
  }

  async setStatus(id: string, status: TaskStatus): Promise<Task | null> {
    const [updated] = await db.update(tasks).set({
      status,
      completedAt: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(tasks.id, id)).returning();
    return updated ?? null;
  }

  async deleteById(id: string): Promise<Task | null> {
    const [deleted] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
    return deleted ?? null;
  }

  async deleteByIds(ids: string[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    return db.delete(tasks).where(inArray(tasks.id, ids)).returning();
  }
}

export const taskService = new TaskService();
