import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { userService } from "../services/user.service";
import { logAudit } from "../services/audit-log.service";
import type { User } from "@shared/schema";

const router = Router();

router.get("/api/users", requirePermission("users", "view"), async (req, res) => {
  const users = await userService.listAdminUsers();
  return res.json(users);
});

router.post("/api/users", requirePermission("users", "edit"), async (req, res) => {
  const actor = (req as any).user as User;
  const result = await userService.createAdminUser(req.body, actor);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  logAudit({ userId: actor.id, action: "create", entity: "user", entityId: result.user.id, entityRef: result.user.email, details: JSON.stringify({ name: result.user.name, role: result.user.role }) });
  logAudit({ userId: actor.id, action: "invite_sent", entity: "user", entityId: result.user.id, entityRef: result.user.email });
  return res.status(201).json({ ...result.user, emailSent: result.emailSent });
});

router.post("/api/users/:id/send-invite", requirePermission("users", "edit"), async (req, res) => {
  const actor = (req as any).user as User;
  const result = await userService.resendAdminUserInvite(req.params.id, actor);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  logAudit({ userId: actor.id, action: "invite_sent", entity: "user", entityId: result.user.id, entityRef: result.user.email });
  return res.json({ ...result.user, emailSent: result.emailSent });
});

router.patch("/api/users/:id", requirePermission("users", "edit"), async (req, res) => {
  const actor = (req as any).user as User;
  const result = await userService.updateAdminUser(req.params.id, req.body, actor);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  const { password, ...safeBody } = req.body;
  logAudit({ userId: actor.id, action: "update", entity: "user", entityId: req.params.id, entityRef: result.user.email, details: JSON.stringify(safeBody) });
  return res.json(result.user);
});

router.delete("/api/users/:id", requirePermission("users", "edit"), async (req, res) => {
  const currentUser = (req as any).user as User;
  const actor = currentUser;
  const result = await userService.deleteAdminUser(req.params.id, actor);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  logAudit({ userId: currentUser.id, action: "delete", entity: "user", entityId: req.params.id });
  return res.json({ message: "User deleted" });
});

export default router;
