import crypto from "crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { whatsappOtps } from "@shared/schema";
import { sendWhatsAppCaseOtpEmail } from "./email.service";
import { logAudit } from "./audit-log.service";

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_HOUR = 3;
const OTP_RESEND_SECONDS = 60;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  throw new Error("SESSION_SECRET is required for WhatsApp OTP hashing");
}

function hashOtp(code: string): string {
  const secret = getSessionSecret();
  return crypto.createHash("sha256").update(`${code}:${secret}`).digest("hex");
}

class WhatsappOtpService {
  generateCode(): string {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  }

  async issueOtp(data: { conversationId: string; caseId: string; email: string; caseRef: string; clientName?: string | null }) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [recent] = await db.select({ count: sql<number>`count(*)`, latest: sql<Date | null>`max(${whatsappOtps.createdAt})` }).from(whatsappOtps).where(and(
      eq(whatsappOtps.conversationId, data.conversationId), eq(whatsappOtps.caseId, data.caseId), eq(whatsappOtps.email, data.email.toLowerCase()), gte(whatsappOtps.createdAt, oneHourAgo),
    ));
    if (Number(recent.count) >= OTP_MAX_SENDS_PER_HOUR || (recent.latest && Date.now() - new Date(recent.latest).getTime() < OTP_RESEND_SECONDS * 1000)) {
      return { ok: false as const, status: 429, error: "Please wait before requesting another code." };
    }
    await db.update(whatsappOtps).set({ consumedAt: new Date() }).where(and(eq(whatsappOtps.conversationId, data.conversationId), isNull(whatsappOtps.consumedAt)));
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const [row] = await db.insert(whatsappOtps).values({
      conversationId: data.conversationId,
      caseId: data.caseId,
      email: data.email.toLowerCase(),
      codeHash: hashOtp(code),
      expiresAt,
      maxAttempts: OTP_MAX_ATTEMPTS,
    }).returning();

    const sent = await sendWhatsAppCaseOtpEmail(data.email, data.clientName || "there", data.caseRef, code);
    await logAudit({
      action: "whatsapp_otp_issued",
      entity: "whatsapp_conversation",
      entityId: data.conversationId,
      entityRef: data.caseRef,
      details: JSON.stringify({ caseId: data.caseId, sent }),
    });
    if (!sent) {
      await db.update(whatsappOtps).set({ consumedAt: new Date() }).where(eq(whatsappOtps.id, row.id));
      return { ok: false as const, status: 503, error: "We could not send a verification code. Please try again later." };
    }
    return { ok: true as const, otp: row, sent };
  }

  async verifyOtp(conversationId: string, code: string) {
    const cleanCode = String(code || "").replace(/\D/g, "");
    if (cleanCode.length !== 6) {
      return { ok: false as const, status: 400, error: "Enter the 6-digit OTP code." };
    }

    const [otp] = await db.select().from(whatsappOtps)
      .where(and(eq(whatsappOtps.conversationId, conversationId), isNull(whatsappOtps.consumedAt)))
      .orderBy(desc(whatsappOtps.createdAt))
      .limit(1);

    if (!otp) return { ok: false as const, status: 404, error: "No active OTP was found." };
    if (otp.expiresAt.getTime() < Date.now()) {
      return { ok: false as const, status: 400, error: "OTP has expired. Please request a new code." };
    }
    if (otp.attemptCount >= otp.maxAttempts) {
      return { ok: false as const, status: 429, error: "Too many OTP attempts. Please request a new code." };
    }

    if (otp.codeHash !== hashOtp(cleanCode)) {
      await db.update(whatsappOtps).set({ attemptCount: otp.attemptCount + 1 }).where(eq(whatsappOtps.id, otp.id));
      await logAudit({
        action: "whatsapp_otp_failed",
        entity: "whatsapp_conversation",
        entityId: conversationId,
        details: JSON.stringify({ caseId: otp.caseId, attempts: otp.attemptCount + 1 }),
      });
      return { ok: false as const, status: 400, error: "Invalid or expired OTP code." };
    }

    const verifiedAt = new Date();
    const [updated] = await db.update(whatsappOtps).set({
      verifiedAt,
      consumedAt: verifiedAt,
    }).where(eq(whatsappOtps.id, otp.id)).returning();

    await logAudit({
      action: "whatsapp_otp_verified",
      entity: "whatsapp_conversation",
      entityId: conversationId,
      details: JSON.stringify({ caseId: otp.caseId }),
    });

    return { ok: true as const, otp: updated };
  }
}

export const whatsappOtpService = new WhatsappOtpService();
