declare module "express-session" {
  interface SessionData {
    userId: string;
    googleOAuthState: string;
    googleOAuthMediatorId: string;
    googleOAuthReturnTo: "settings" | "appointments" | "dashboard" | "onboarding";
    outlookOAuthState: string;
    outlookOAuthMediatorId: string;
    outlookOAuthReturnTo: "settings" | "appointments" | "dashboard" | "onboarding";
    bfmGoogleOAuthState: string;
    bfmGoogleOAuthUserId: string;
  }
}

import { storage } from "../storage";

export async function requireAuth(req: any, res: any, next: any) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user || user.status !== "active") {
    return res.status(401).json({ message: "Not authenticated" });
  }
  req.user = user;
  next();
}
