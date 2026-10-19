import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { authService } from "../services/auth.service";
import { logAudit } from "../services/audit-log.service";
import { storage } from "../storage";
import type { User } from "@shared/schema";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";

const router = Router();
const requireEmailAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role === "superadmin" || req.user?.role === "subadmin") return next();
  return res.status(403).json({ message: "Only Super Admin and Sub Admin can send email" });
};

router.post("/api/parties/:id/invite", requireAuth, requirePermission("cases", "edit"), requireEmailAdmin, async (req, res) => {
  const result = await authService.generateInviteToken(req.params.id);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "generate_invite", entity: "party", entityId: req.params.id });
  return res.json({ inviteUrl: result.inviteUrl, emailSent: result.emailSent, alreadyActive: result.alreadyActive ?? false });
});

// Update per-case link settings: miamMediatorId, allocatedMediatorId, confidential.
// Personal details (name, DOB, email, etc.) live on clients table — use PATCH /api/clients/:id.
router.patch("/api/parties/:id/link-settings", requireAuth, requirePermission("cases", "edit"), async (req, res) => {
  const actor = (req as any).user as User;
  const party = await storage.getParty(req.params.id);
  if (!party) return res.status(404).json({ message: "Party not found" });

  // Verify the actor has access to the case this party belongs to
  const caseAccess = await classifyCaseAccess(party.caseId, actor);
  if (!hasFullOperationalCaseAccess(caseAccess)) return res.status(403).json({ message: "Access denied to this case" });

  const { miamMediatorId, allocatedMediatorId, confidential } = req.body as {
    miamMediatorId?: string | null;
    allocatedMediatorId?: string | null;
    confidential?: boolean;
  };

  const updateData: Record<string, unknown> = {};
  if (miamMediatorId !== undefined) updateData.miamMediatorId = miamMediatorId || null;
  if (allocatedMediatorId !== undefined) updateData.allocatedMediatorId = allocatedMediatorId || null;
  if (confidential !== undefined) updateData.confidential = confidential;

  const updated = await storage.updateParty(req.params.id, updateData as Parameters<typeof storage.updateParty>[1]);
  if (!updated) return res.status(500).json({ message: "Failed to update party link settings" });

  logAudit({ userId: actor.id, action: "update_party_link_settings", entity: "party", entityId: req.params.id });
  return res.json(updated);
});

export default router;
