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

router.get("/api/mediators", requirePermission("mediators", "view"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const search = (req.query.search as string) || undefined;
  const sortBy = (req.query.sortBy as string) || undefined;
  const sortOrder = (req.query.sortOrder as string) === "asc" ? "asc" : req.query.sortOrder === "desc" ? "desc" : undefined;
  const result = await userService.listMediators({ page, limit, search, sortBy, sortOrder });
  return res.json(result);
});

router.post("/api/mediators", requirePermission("mediators", "edit"), async (req, res) => {
  const result = await userService.createMediator(req.body);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.error });
  }
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "create", entity: "mediator", entityId: result.user.id, entityRef: result.user.email, details: JSON.stringify({ name: result.user.name }) });
  return res.status(201).json(result.user);
});

router.patch("/api/mediators/:id", requirePermission("mediators", "edit"), async (req, res) => {
  const result = await userService.updateMediator(req.params.id, req.body);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.error });
  }
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "update", entity: "mediator", entityId: req.params.id, entityRef: result.user.email });
  return res.json(result.user);
});

router.post("/api/mediators/:id/password", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = (req as any).user as User;
  if (actor.role !== "superadmin" && actor.role !== "subadmin") {
    return res.status(403).json({ success: false, message: "Only administrators can change mediator passwords" });
  }
  const result = await userService.changeMediatorPassword(req.params.id, req.body);
  if (!result.ok) {
    return res.status(result.status).json({ success: false, message: result.error });
  }
  logAudit({ userId: actor.id, action: "password_changed", entity: "mediator", entityId: req.params.id });
  return res.json({ success: true });
});

router.delete("/api/mediators/:id", requirePermission("mediators", "edit"), async (req, res) => {
  try {
    const actor = (req as any).user as User;
    if (actor.role !== "superadmin" && actor.role !== "subadmin") {
      return res.status(403).json({ success: false, message: "Only administrators can remove mediators" });
    }
    const result = await userService.deleteMediator(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.error });
    }
    logAudit({
      userId: actor.id,
      action: result.archived ? "update" : "delete",
      entity: "mediator",
      entityId: req.params.id,
      details: result.archived
        ? JSON.stringify({ action: "archive", references: result.references })
        : undefined,
    });
    return res.json({
      success: true,
      archived: result.archived,
      deleted: result.deleted,
      references: result.references,
      message: result.archived
        ? "Mediator archived. Their historical appointments and cases were preserved."
        : "Mediator permanently deleted.",
    });
  } catch (err) {
    console.error("[Mediator] delete failed", err);
    return res.status(500).json({
      success: false,
      message: "Could not remove this mediator. Please try again or contact support.",
    });
  }
});

router.post("/api/mediators/:id/send-invite", requirePermission("mediators", "edit"), async (req, res) => {
  const mediator = await storage.getUser(req.params.id);
  if (!mediator || mediator.role !== "mediator") {
    return res.status(404).json({ success: false, message: "Mediator not found" });
  }

  const rawToken = crypto.randomUUID();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await storage.updateUser(mediator.id, {
    onboardingToken: tokenHash,
    onboardingTokenExpiresAt: expiresAt,
  });

  const inviteUrl = `${getPublicAppUrl()}/onboarding?token=${rawToken}`;
  console.info(`[Mediator] Sending invite link to ${mediator.email}: ${inviteUrl}`);

  const { sendMediatorInviteEmail } = await import("../services/email.service");
  const emailSent = await sendMediatorInviteEmail(mediator.email, mediator.name, inviteUrl);

  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "invite_sent", entity: "mediator", entityId: mediator.id, entityRef: mediator.email });

  if (!emailSent) {
    console.error(`[Mediator] Invite email failed for ${mediator.email}: ${inviteUrl}`);
    return res.status(500).json({ success: false, message: "The invite link was created but the email failed to send. Please check the email configuration or share the invite link with the mediator directly." });
  }

  return res.json({ success: true });
});

export default router;
