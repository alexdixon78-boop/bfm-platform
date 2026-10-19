import { db } from "../db";
import { auditLogs, users, type InsertAuditLog } from "@shared/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { auditActorName } from "@shared/audit-log-utils";
import { buildAuditLogWhere, type AuditLogListFilters } from "./audit-log-query";

export class AuditLogRepository {
  async create(data: InsertAuditLog) {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async list(params: AuditLogListFilters & { page: number; limit: number }) {
    const where = buildAuditLogWhere(params);

    const offset = (params.page - 1) * params.limit;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(where);
    const total = Number(countResult[0]?.count || 0);

    const data = await db
      .select({ log: auditLogs, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
      .limit(params.limit)
      .offset(offset);

    return {
      data: data.map(({ log, actorName }) => ({ ...log, userName: auditActorName(log.userId, actorName) })),
      total,
    };
  }

  async filterOptions(): Promise<{ actions: string[]; entities: string[] }> {
    const [actionRows, entityRows] = await Promise.all([
      db.selectDistinct({ value: auditLogs.action }).from(auditLogs).orderBy(asc(auditLogs.action)),
      db.selectDistinct({ value: auditLogs.entity }).from(auditLogs).orderBy(asc(auditLogs.entity)),
    ]);
    return { actions: actionRows.map(row => row.value), entities: entityRows.map(row => row.value) };
  }
}
