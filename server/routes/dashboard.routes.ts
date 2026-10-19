import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { dashboardService } from "../services/dashboard.service";

const router = Router();

router.get("/api/dashboard/stats", requirePermission("dashboard", "view"), async (req, res) => {
  const user = (req as any).user;
  if (user.role === "client") {
    return res.status(403).json({ message: "Use the client dashboard endpoint" });
  }
  const stats = await dashboardService.getStats(user);
  return res.json(stats);
});

router.get("/api/dashboard/appointments", requirePermission("dashboard", "view"), async (req, res) => {
  const user = (req as any).user;
  if (user.role === "client") {
    return res.status(403).json({ message: "Use the client dashboard endpoint" });
  }
  const appts = await dashboardService.getAppointments(user);
  return res.json(appts);
});

router.get("/api/dashboard/mediator-session-indicators", requirePermission("dashboard", "view"), async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "mediator") {
    return res.status(403).json({ message: "Mediator session indicators are only available to mediators" });
  }
  const result = await dashboardService.getMediatorSessionIndicators(user);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.indicators);
});

router.get("/api/dashboard/client", requirePermission("dashboard", "view"), async (req, res) => {
  const user = (req as any).user;
  if (user.role !== "client") {
    return res.status(403).json({ message: "Client dashboard is only available to client users" });
  }
  const dashboard = await dashboardService.getClientDashboard(user);
  return res.json(dashboard);
});

export default router;
