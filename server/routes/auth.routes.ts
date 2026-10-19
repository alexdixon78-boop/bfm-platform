import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service";
import { logAudit } from "../services/audit-log.service";

const router = Router();

function getIp(req: Request): string {
  return req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket?.remoteAddress || "";
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxAttempts: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${getIp(req)}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (entry && now < entry.resetAt) {
      if (entry.count >= maxAttempts) {
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      entry.count++;
    } else {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    }
    next();
  };
}

router.post("/api/auth/login", async (req, res) => {
  const ip = getIp(req);
  const result = await authService.login(req.body);
  if (!result.ok) {
    logAudit({ action: "login_failed", entity: "session", entityRef: req.body?.email || "", details: JSON.stringify({ reason: result.error }), ipAddress: ip });
    return res.status(result.status).json({ message: result.error });
  }
  req.session.userId = result.userId;
  // Persist the session synchronously before responding so the client's next
  // authenticated request can never race ahead of connect-pg-simple's async
  // store write (otherwise an immediate follow-up call sees 401).
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
  logAudit({ userId: result.userId, action: "login", entity: "session", entityRef: result.user.email, ipAddress: ip });
  return res.json(result.user);
});

router.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const user = await authService.getCurrentUser(req.session.userId);
  if (!user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  return res.json(user);
});

router.post("/api/auth/logout", (req, res) => {
  const userId = req.session.userId;
  const ip = getIp(req);
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    if (userId) {
      logAudit({ userId, action: "logout", entity: "session", ipAddress: ip });
    }
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out" });
  });
});

router.post("/api/auth/forgot-password", rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }
  const result = await authService.forgotPassword(email);
  logAudit({ action: "forgot_password", entity: "session", entityRef: email, ipAddress: getIp(req) });
  return res.json({ message: "If an account exists with that email, a password reset link has been sent." });
});

router.get("/api/auth/reset-password/:token", async (req, res) => {
  const result = await authService.validateResetToken(req.params.token);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  return res.json({ valid: true });
});

router.post("/api/auth/reset-password", rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ message: "Token and password are required" });
  }
  const ip = getIp(req);
  const result = await authService.resetPassword(token, password);
  if (!result.ok) {
    logAudit({ action: "reset_password_failed", entity: "session", details: JSON.stringify({ reason: result.error }), ipAddress: ip });
    return res.status(result.status).json({ message: result.error });
  }
  logAudit({ userId: result.userId, action: "reset_password", entity: "session", entityRef: result.email, ipAddress: ip });
  return res.json({ message: "Password has been reset successfully. You can now sign in with your new password." });
});

router.get("/api/auth/invite/:token", async (req, res) => {
  const result = await authService.validateInviteToken(req.params.token);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }
  return res.json({ firstName: result.firstName, lastName: result.lastName, email: result.email });
});

router.post("/api/auth/register-invite", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ message: "Token and password are required" });
  }

  const result = await authService.registerViaInvite(token, password);
  if (!result.ok) {
    return res.status(result.status).json({ message: result.error });
  }

  req.session.userId = result.userId;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
  logAudit({ userId: result.userId, action: "register", entity: "user", entityId: result.userId, entityRef: result.user.email, ipAddress: getIp(req) });
  return res.json(result.user);
});

export default router;
