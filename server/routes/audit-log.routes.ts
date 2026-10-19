import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { listAuditLogs, listAuditLogFilterOptions } from "../services/audit-log.service";
import { parseAuditDateRange } from "@shared/audit-log-utils";

const router = Router();

router.get("/api/audit-logs/options", requirePermission("audit_log", "view"), async (_req, res) => {
  return res.json(await listAuditLogFilterOptions());
});

router.get("/api/audit-logs", requirePermission("audit_log", "view"), async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const page = Math.max(1, parseInt(query.page || "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || "50") || 50));

  try {
    parseAuditDateRange(query.startDate, query.endDate);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid date range" });
  }

  const result = await listAuditLogs({
    page,
    limit,
    entity: query.entity || undefined,
    action: query.action || undefined,
    userId: query.userId || undefined,
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
    search: query.search?.trim() || undefined,
  });
  return res.json(result);
});

export default router;
