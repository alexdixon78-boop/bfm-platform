import { storage } from "../storage";
import { canViewSection, canEditSection } from "@shared/permissions";
import { permissionService } from "../services/permission.service";

export function requirePermission(section: string, action: "view" | "edit") {
  return async (req: any, res: any, next: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    req.user = user;
    const perms = await permissionService.getPermissions();
    const check = action === "edit" ? canEditSection : canViewSection;
    if (!check(perms, user.role, section)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}
