import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { verifyPassword, hashPassword } from "../utils/helpers";
import { authService } from "../services/auth.service";
import { logAudit } from "../services/audit-log.service";
import { saveProfileImage } from "../services/profile-image.service";
import { mediatorProfileChangeRequests, mediatorProfiles } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import type { User } from "@shared/schema";

const router = Router();

router.patch("/api/account", requireAuth, async (req, res) => {
  const actor = (req as any).user as User;
  const parsed = z.object({ name: z.string().trim().min(1).max(200) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Enter a name of up to 200 characters" });
  const name = parsed.data.name.replace(/\s+/g, " ");
  if (name !== (actor.role === "mediator" ? actor.accountDisplayName || actor.name : actor.name)) {
    await storage.updateUser(actor.id, actor.role === "mediator" ? { accountDisplayName: name } : { name });
    if (actor.role === "mediator") {
      const [profile] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, actor.id));
      const firstName = name.split(" ")[0];
      const lastName = name.split(" ").slice(1).join(" ");
      const rows = [
        { field: "firstName", proposedValue: firstName },
        { field: "lastName", proposedValue: lastName },
      ].filter((item) => item.proposedValue !== (profile?.[item.field as "firstName" | "lastName"] ?? ""));
      if (rows.length) await db.insert(mediatorProfileChangeRequests).values(rows.map((item) => ({ mediatorId: actor.id, ...item })));
    }
    await logAudit({ userId: actor.id, action: "update", entity: "user", entityId: actor.id, details: JSON.stringify({ field: "name" }) });
  }
  return res.json(await authService.getCurrentUser(actor.id));
});

router.post("/api/account/password", requireAuth, async (req, res) => {
  const actor = (req as any).user as User;
  const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(256) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Current password and a new password of at least 6 characters are required" });
  if (!verifyPassword(parsed.data.currentPassword, actor.password)) return res.status(403).json({ message: "Current password is incorrect" });
  if (parsed.data.currentPassword === parsed.data.newPassword) return res.status(400).json({ message: "Choose a different password" });
  await storage.updateUser(actor.id, { password: hashPassword(parsed.data.newPassword), resetToken: null, resetExpiresAt: null });
  await logAudit({ userId: actor.id, action: "change_password", entity: "user", entityId: actor.id });
  return res.json({ message: "Password updated" });
});

router.post("/api/account/photo", requireAuth, async (req, res) => {
  const actor = (req as any).user as User;
  const parsed = z.object({ imageData: z.string().min(1).max(8_000_000) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Choose an image up to 5 MB" });
  try {
    const stored = await saveProfileImage(parsed.data.imageData);
    await storage.updateUser(actor.id, { avatarUrl: stored.fileUrl });
    if (actor.role === "mediator") {
      await db.insert(mediatorProfileChangeRequests).values({ mediatorId: actor.id, field: "profilePhotoUrl", proposedValue: stored.fileUrl });
    }
    await logAudit({ userId: actor.id, action: "update", entity: "user", entityId: actor.id, details: JSON.stringify({ field: "avatarUrl" }) });
    return res.json(await authService.getCurrentUser(actor.id));
  } catch (error) {
    if (error instanceof Error && /image|Image/.test(error.message)) return res.status(400).json({ message: error.message });
    throw error;
  }
});

export default router;
