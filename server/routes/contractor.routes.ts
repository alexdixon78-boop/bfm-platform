import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { userService } from "../services/user.service";
import { logAudit } from "../services/audit-log.service";
import { storage } from "../storage";
import crypto from "crypto";
import type { User } from "@shared/schema";
import { getPublicAppUrl } from "../utils/app-url";

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

router.get("/api/contractors", requirePermission("contractors", "view"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || undefined;
  const sortBy = (req.query.sortBy as string) || undefined;
  const sortOrder = (req.query.sortOrder as string) === "asc" ? "asc" : req.query.sortOrder === "desc" ? "desc" : undefined;
  const result = await userService.listContractors({ page, limit, search, sortBy, sortOrder });
  return res.json(result);
});

router.post("/api/contractors", requirePermission("contractors", "edit"), async (req, res) => {
  const result = await userService.createContractor(req.body);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.error });
  }
  const actor = (req as any).user as User;
  logAudit({
    userId: actor.id,
    action: "create",
    entity: "contractor",
    entityId: result.user.id,
    entityRef: result.user.email,
    details: JSON.stringify({ name: result.user.name, contractorType: result.user.contractorType ?? null }),
  });
  return res.status(201).json(result.user);
});

router.patch("/api/contractors/:id", requirePermission("contractors", "edit"), async (req, res) => {
  const result = await userService.updateContractor(req.params.id, req.body);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.error });
  }
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "update", entity: "contractor", entityId: req.params.id, entityRef: result.user.email });
  return res.json(result.user);
});

router.delete("/api/contractors/:id", requirePermission("contractors", "edit"), async (req, res) => {
  try {
    const actor = (req as any).user as User;
    if (actor.role !== "superadmin" && actor.role !== "subadmin") {
      return res.status(403).json({ success: false, message: "Only administrators can permanently delete contractors" });
    }
    const result = await userService.deleteContractor(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.error });
    }
    logAudit({ userId: actor.id, action: "delete", entity: "contractor", entityId: req.params.id });
    return res.json({ success: true, deleted: true, message: "Contractor permanently deleted." });
  } catch (err) {
    console.error("[Contractor] delete failed", err);
    return res.status(500).json({ success: false, message: "Could not remove this contractor. Please try again or contact support." });
  }
});

router.post("/api/contractors/:id/send-invite", requirePermission("contractors", "edit"), async (req, res) => {
  const contractor = await storage.getUser(req.params.id);
  if (!contractor || contractor.role !== "contractor") {
    return res.status(404).json({ success: false, message: "Contractor not found" });
  }

  const rawToken = crypto.randomUUID();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await storage.updateUser(contractor.id, {
    onboardingToken: tokenHash,
    onboardingTokenExpiresAt: expiresAt,
  });

  const inviteUrl = `${getPublicAppUrl()}/onboarding?token=${rawToken}`;

  const { sendContractorInviteEmail } = await import("../services/email.service");
  const emailSent = await sendContractorInviteEmail(contractor.email, contractor.name, inviteUrl);

  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "invite_sent", entity: "contractor", entityId: contractor.id, entityRef: contractor.email });

  if (!emailSent) {
    console.error(`[Contractor] Invite email failed for ${contractor.email}`);
    return res.status(500).json({ success: false, message: "The invite link was created but the email failed to send. Please check the email configuration or share the invite link with the contractor directly." });
  }

  return res.json({ success: true });
});

export default router;
