import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { permissionService } from "../services/permission.service";
import { logAudit } from "../services/audit-log.service";
import { notificationRealtimeService } from "../services/notification-realtime.service";
import { validatePermissionUpdates } from "@shared/permissions";
import type { User } from "@shared/schema";

const router = Router();

router.get("/api/permissions", requireAuth, async (req, res) => {
  const perms = await permissionService.getPermissions();
  return res.json(perms);
});

router.put("/api/permissions", requireAuth, async (req, res) => {
  const actor = (req as any).user as User;
  if (actor.role !== "superadmin") {
    return res.status(403).json({ message: "Only superadmins can update role permissions" });
  }

  let updates;
  try {
    updates = validatePermissionUpdates(req.body?.permissions);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid permissions" });
  }

  const { permissions, changes, affectedRoles } = await permissionService.updatePermissions(updates);
  if (changes.length > 0) {
    await logAudit({
      userId: actor.id,
      action: "update",
      entity: "permissions",
      details: JSON.stringify({ changes }),
    });
    notificationRealtimeService.broadcastPermissionsUpdated(affectedRoles);
  }
  return res.json(permissions);
});

export default router;
