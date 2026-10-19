import { and, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { auditLogs, users } from "@shared/schema";
import { escapeAuditSearch, parseAuditDateRange } from "@shared/audit-log-utils";

export type AuditLogListFilters = {
  entity?: string;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
};

export function buildAuditLogWhere(params: AuditLogListFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (params.entity) conditions.push(eq(auditLogs.entity, params.entity));
  if (params.action) conditions.push(eq(auditLogs.action, params.action));
  if (params.userId) conditions.push(eq(auditLogs.userId, params.userId));

  const { start, endExclusive } = parseAuditDateRange(params.startDate, params.endDate);
  if (start) conditions.push(gte(auditLogs.timestamp, start));
  if (endExclusive) conditions.push(lt(auditLogs.timestamp, endExclusive));

  const search = escapeAuditSearch(params.search ?? "");
  if (search) {
    const pattern = `%${search}%`;
    const matches = [
      auditLogs.entityRef, auditLogs.action, auditLogs.entity, auditLogs.details, users.name,
    ].map(column => sql`${column} ILIKE ${pattern} ESCAPE ${"\\"}`);
    matches.push(sql`replace(replace(replace(${auditLogs.action}, '_', ' '), '.', ' '), '-', ' ') ILIKE ${pattern} ESCAPE ${"\\"}`);
    matches.push(sql`replace(replace(replace(${auditLogs.entity}, '_', ' '), '.', ' '), '-', ' ') ILIKE ${pattern} ESCAPE ${"\\"}`);
    conditions.push(or(...matches)!);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
