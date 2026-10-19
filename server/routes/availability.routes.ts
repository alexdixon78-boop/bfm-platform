import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { availabilityService } from "../services/availability.service";
import { logAudit } from "../services/audit-log.service";
import { storage } from "../storage";
import type { User } from "@shared/schema";

const router = Router();

function canManageAvailability(user: User, mediatorId: string): boolean {
  return user.role === "superadmin" || user.role === "subadmin" || user.id === mediatorId;
}

async function loadUser(req: any, res: any): Promise<User | null> {
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return user;
}

router.get("/api/mediators/:id/availability", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (!canManageAvailability(user, req.params.id)) {
    return res.status(403).json({ message: "Access denied" });
  }
  const slots = await availabilityService.getByMediator(req.params.id);
  return res.json(slots);
});

router.put("/api/mediators/:id/availability", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (!canManageAvailability(user, req.params.id)) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await availabilityService.setAvailability(req.params.id, req.body);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  logAudit({ userId: user.id, action: "update", entity: "mediator", entityId: req.params.id, details: JSON.stringify({ field: "availability", slotCount: result.slots.length }) });
  return res.json(result.slots);
});

router.get("/api/availability", async (req, res) => {
  const { serviceTypeId, date } = req.query;
  if (!serviceTypeId || !date) {
    return res.status(400).json({ message: "serviceTypeId and date are required" });
  }
  const slots = await availabilityService.getAvailableSlots(serviceTypeId as string, date as string);
  return res.json(slots);
});

export default router;
