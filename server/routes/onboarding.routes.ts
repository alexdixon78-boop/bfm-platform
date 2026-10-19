import { Router } from "express";
import { storage } from "../storage";
import { hashPassword } from "../utils/helpers";
import { logAudit } from "../services/audit-log.service";
import crypto from "crypto";

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt) < new Date();
}

router.get("/api/onboarding/validate", async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ valid: false, reason: "not_found" });
  }

  const tokenHash = hashToken(token);
  const user = await storage.getUserByOnboardingToken(tokenHash);

  if (!user) {
    return res.json({ valid: false, reason: "not_found" });
  }

  if (isExpired(user.onboardingTokenExpiresAt)) {
    return res.json({ valid: false, reason: "expired" });
  }

  return res.json({ valid: true, name: user.name, email: user.email });
});

router.post("/api/onboarding/set-password", async (req, res) => {
  const { token, password, confirmPassword } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ success: false, message: "Invalid token" });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: "Passwords do not match" });
  }

  const tokenHash = hashToken(token);
  const user = await storage.getUserByOnboardingToken(tokenHash);

  if (!user) {
    return res.status(404).json({ success: false, message: "Invalid invitation link." });
  }

  if (isExpired(user.onboardingTokenExpiresAt)) {
    return res.status(410).json({ success: false, message: "This invitation link has expired. Please ask your administrator to resend the invite." });
  }

  const hashedPassword = hashPassword(password);
  const updated = await storage.updateUser(user.id, {
    password: hashedPassword,
    status: "active",
    onboardingToken: null,
    onboardingTokenExpiresAt: null,
    lastLoginAt: new Date(),
  });

  if (!updated) {
    return res.status(500).json({ success: false, message: "Failed to activate account" });
  }

  const auditEntity = user.role === "contractor" ? "contractor" : user.role === "mediator" ? "mediator" : "user";
  logAudit({
    userId: user.id,
    action: "register",
    entity: auditEntity,
    entityId: user.id,
    entityRef: user.email,
    details: JSON.stringify({ via: "onboarding_set_password" }),
  });

  req.session.userId = user.id;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  return res.json({ success: true, userId: user.id, name: user.name, role: user.role });
});

export default router;
