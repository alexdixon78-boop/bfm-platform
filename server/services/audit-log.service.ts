import { AuditLogRepository } from "../repositories/audit-log.repository";
import type { InsertAuditLog } from "@shared/schema";
import type { AuditLogListFilters } from "../repositories/audit-log-query";

const auditLogRepo = new AuditLogRepository();

export async function logAudit(data: InsertAuditLog): Promise<void> {
  try {
    await auditLogRepo.create(data);
  } catch (err) {
    console.error("[AuditLog] Failed to write audit log:", err);
  }
}

export async function listAuditLogs(params: AuditLogListFilters & { page: number; limit: number }) {
  const result = await auditLogRepo.list(params);
  return {
    ...result,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(result.total / params.limit) || 1,
  };
}

export async function listAuditLogFilterOptions() {
  return auditLogRepo.filterOptions();
}
