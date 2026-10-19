import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { adminReportService } from "../services/admin-report.service";
import { listCaseClosureExportRows, toCaseClosureCsv } from "../services/case-closure-report.service";

const router = Router();

router.get("/api/reports/admin-summary", requirePermission("reports", "view"), async (req, res) => {
  const user = (req as any).user;
  const summary = await adminReportService.getAdminSummary(user, req.query);
  return res.json(summary);
});

router.get("/api/reports/case-closures/export", requirePermission("reports", "view"), async (req, res) => {
  const format = req.query.format === "csv" ? "csv" : "json";
  const rows = await listCaseClosureExportRows();

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"case-closure-report.csv\"");
    return res.send(toCaseClosureCsv(rows));
  }

  return res.json({ data: rows });
});

export default router;
