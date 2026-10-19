import { storage } from "../storage";
import { loginSchema } from "@shared/schema";
import { verifyPassword, hashPassword } from "../utils/helpers";
import type { ServiceResult } from "./types";
import crypto from "crypto";
import { getPublicAppUrl } from "../utils/app-url";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class AuthService {
  async forgotPassword(email: string): Promise<ServiceResult<{ sent: boolean }>> {
    const user = await storage.getUserByEmail(email);
    if (!user || user.status === "inactive") {
      return { ok: true, sent: true };
    }

    const rawToken = crypto.randomUUID();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await storage.updateUser(user.id, {
      resetToken: tokenHash,
      resetExpiresAt: expiresAt,
    });

    const { sendPasswordResetEmail } = await import("./email.service");
    const resetUrl = `${getPublicAppUrl()}/reset-password/${rawToken}`;
    const emailSent = await sendPasswordResetEmail(user.email, user.name, resetUrl);
    if (!emailSent) {
      console.error(`[Auth] Password reset email failed to send for ${user.email}`);
    }

    return { ok: true, sent: true };
  }

  async validateResetToken(token: string): Promise<ServiceResult<{ valid: boolean }>> {
    const user = await storage.getUserByResetToken(hashToken(token));
    if (!user) {
      return { ok: false, error: "Invalid or expired reset link", status: 404 };
    }
    return { ok: true, valid: true };
  }

  async resetPassword(token: string, newPassword: string): Promise<ServiceResult<{ userId: string; email: string }>> {
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters", status: 400 };
    }

    const user = await storage.getUserByResetToken(hashToken(token));
    if (!user) {
      return { ok: false, error: "Invalid or expired reset link. Please request a new one.", status: 404 };
    }

    const hashedPw = hashPassword(newPassword);
    const completesPendingAccount = user.status === "pending"
      && (user.role === "mediator" || user.role === "staff" || user.role === "subadmin" || user.role === "contractor");
    await storage.updateUser(user.id, {
      password: hashedPw,
      resetToken: null,
      resetExpiresAt: null,
      ...(completesPendingAccount ? {
        status: "active" as const,
        onboardingToken: null,
        onboardingTokenExpiresAt: null,
      } : {}),
    });

    return { ok: true, userId: user.id, email: user.email };
  }

  async login(body: unknown): Promise<ServiceResult<{ user: any; userId: string }>> {
    const result = loginSchema.safeParse(body);
    if (!result.success) {
      return { ok: false, error: "Invalid email or password", status: 400 };
    }

    const user = await storage.getUserByEmail(result.data.email);
    if (!user) {
      return { ok: false, error: "Invalid email or password", status: 401 };
    }

    if (user.status === "inactive") {
      return { ok: false, error: "Your account is not active. Please contact your administrator.", status: 403 };
    }

    if (user.status === "pending") {
      return { ok: false, error: "Your account setup is not complete. Please check your email for an invitation link.", status: 403 };
    }

    if (!verifyPassword(result.data.password, user.password)) {
      return { ok: false, error: "Invalid email or password", status: 401 };
    }

    await storage.updateUser(user.id, { lastLoginAt: new Date() });

    const {
      password,
      resetToken,
      resetExpiresAt,
      onboardingToken,
      onboardingTokenExpiresAt,
      googleAccessToken,
      googleRefreshToken,
      googleTokenExpiresAt,
      outlookAccessToken,
      outlookRefreshToken,
      outlookTokenExpiresAt,
      ...safeUser
    } = user;
    return { ok: true, user: { ...safeUser, name: user.role === "mediator" ? user.accountDisplayName || user.name : user.name }, userId: user.id };
  }

  async getCurrentUser(userId: string) {
    const user = await storage.getUser(userId);
    if (!user) return null;
    const {
      password,
      resetToken,
      resetExpiresAt,
      onboardingToken,
      onboardingTokenExpiresAt,
      googleAccessToken,
      googleRefreshToken,
      googleTokenExpiresAt,
      outlookAccessToken,
      outlookRefreshToken,
      outlookTokenExpiresAt,
      ...safeUser
    } = user;
    return { ...safeUser, name: user.role === "mediator" ? user.accountDisplayName || user.name : user.name };
  }

  async validateInviteToken(token: string): Promise<ServiceResult<{ firstName: string; lastName: string; email: string }>> {
    const party = await storage.getPartyByInviteToken(token);
    if (!party) {
      return { ok: false, error: "Invalid or expired invitation link", status: 404 };
    }

    if (party.inviteExpiresAt && new Date(party.inviteExpiresAt) < new Date()) {
      return { ok: false, error: "This invitation link has expired. Please ask your mediator to resend the invite.", status: 410 };
    }

    return {
      ok: true,
      firstName: party.firstName,
      lastName: party.lastName,
      email: party.email || "",
    };
  }

  async registerViaInvite(token: string, password: string): Promise<ServiceResult<{ user: any; userId: string }>> {
    const party = await storage.getPartyByInviteToken(token);
    if (!party) {
      return { ok: false, error: "Invalid or expired invitation link", status: 404 };
    }

    if (party.inviteExpiresAt && new Date(party.inviteExpiresAt) < new Date()) {
      return { ok: false, error: "This invitation link has expired. Please ask your mediator to resend the invite.", status: 410 };
    }

    if (!party.userId) {
      return { ok: false, error: "No user account linked to this invitation", status: 400 };
    }

    const linkedUser = await storage.getUser(party.userId);
    if (!linkedUser || linkedUser.role !== "client") {
      return { ok: false, error: "Invalid account configuration", status: 400 };
    }

    if (password.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters", status: 400 };
    }

    const hashedPassword = hashPassword(password);
    const updatedUser = await storage.updateUser(party.userId, {
      password: hashedPassword,
      status: "active",
    });

    if (!updatedUser) {
      return { ok: false, error: "Failed to activate account", status: 500 };
    }

    // Activate the specific party used for this invite
    await storage.updateParty(party.id, {
      portalStatus: "active",
      inviteToken: null,
      inviteExpiresAt: null,
    });

    // Activate all other party links for the same client so the client has
    // portal access to every case they are part of (clients.userId is shared)
    if (party.clientId) {
      const siblingParties = await storage.listPartiesByClientId(party.clientId);
      for (const sibling of siblingParties) {
        if (sibling.id !== party.id && sibling.portalStatus !== "active") {
          await storage.updateParty(sibling.id, {
            portalStatus: "active",
            inviteToken: null,
            inviteExpiresAt: null,
          });
        }
      }
    }

    const {
      password: _,
      resetToken: _rt,
      resetExpiresAt: _re,
      onboardingToken: _ot,
      onboardingTokenExpiresAt: _ote,
      googleAccessToken: _gat,
      googleRefreshToken: _grt,
      googleTokenExpiresAt: _gte,
      outlookAccessToken: _oat,
      outlookRefreshToken: _ort,
      outlookTokenExpiresAt: _ote2,
      ...safeUser
    } = updatedUser;
    return { ok: true, user: safeUser, userId: updatedUser.id };
  }

  async generateInviteToken(partyId: string, options: { sendEmail?: boolean } = {}): Promise<ServiceResult<{ inviteUrl: string; token: string; emailSent: boolean; alreadyActive?: boolean }> > {
    const party = await storage.getParty(partyId);
    if (!party) {
      return { ok: false, error: "Party not found", status: 404 };
    }

    if (party.portalStatus === "active") {
      return { ok: false, error: "Client already has portal access", status: 400 };
    }

    if (!party.userId) {
      return { ok: false, error: "No user account linked to this client", status: 400 };
    }

    const linkedUser = await storage.getUser(party.userId);
    if (!linkedUser || linkedUser.role !== "client") {
      return { ok: false, error: "Linked account is not a client account", status: 400 };
    }

    // If the client already completed registration (active user), skip the invite
    // and activate ALL party links for this client — they share clients.userId
    if (linkedUser.status === "active") {
      if (party.clientId) {
        const allClientParties = await storage.listPartiesByClientId(party.clientId);
        for (const p of allClientParties) {
          if (p.portalStatus !== "active") {
            await storage.updateParty(p.id, {
              portalStatus: "active",
              inviteToken: null,
              inviteExpiresAt: null,
            });
          }
        }
      } else {
        await storage.updateParty(party.id, {
          portalStatus: "active",
          inviteToken: null,
          inviteExpiresAt: null,
        });
      }
      return { ok: true, inviteUrl: "", token: "", emailSent: false, alreadyActive: true };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await storage.updateParty(party.id, {
      inviteToken: token,
      inviteExpiresAt: expiresAt,
      portalStatus: "invited",
    });

    const inviteUrl = `/register/${token}`;

    let emailSent = false;
    if (options.sendEmail !== false && party.email) {
      const { sendPortalInviteEmail } = await import("./email.service");
      const fullInviteUrl = `${getPublicAppUrl()}${inviteUrl}`;
      emailSent = await sendPortalInviteEmail(party.email, party.firstName, fullInviteUrl);
      if (!emailSent) {
        console.error(`[Auth] Portal invite email failed to send for ${party.email}`);
      }
    }

    return { ok: true, inviteUrl, token, emailSent };
  }
}

export const authService = new AuthService();
