import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { cases, clients, parties, whatsappContacts, whatsappConversations } from "@shared/schema";
import { whatsappOtpService } from "./whatsapp-otp.service";
import { whatsappConversationService } from "./whatsapp-conversation.service";

function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

class WhatsappCaseVerificationService {
  async startVerification(data: { conversationId: string; caseRef: string; email: string }) {
    const email = normalizeEmail(data.email);
    const caseRef = String(data.caseRef || "").trim();
    if (!caseRef || !email) {
      return { ok: false as const, status: 400, error: "Case reference and registered email are required." };
    }

    const [match] = await db
      .select({
        caseId: cases.id,
        caseRef: cases.caseRef,
        clientId: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        email: clients.email,
      })
      .from(cases)
      .innerJoin(parties, eq(parties.caseId, cases.id))
      .innerJoin(clients, eq(clients.id, parties.clientId))
      .where(and(
        sql`lower(${cases.caseRef}) = ${caseRef.toLowerCase()}`,
        sql`lower(${clients.email}) = ${email}`,
      ))
      .limit(1);

    if (!match) {
      return { ok: false as const, status: 404, error: "No case matched that case reference and registered email." };
    }

    await whatsappConversationService.updateState(data.conversationId, {
      flowType: "existing_case",
      automationState: "awaiting_otp",
    });

    const [conversation] = await db.select({ contactId: whatsappConversations.contactId })
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, data.conversationId))
      .limit(1);
    if (conversation?.contactId) {
      await db.update(whatsappContacts).set({
        clientId: match.clientId,
        verificationStatus: "otp_pending",
        updatedAt: new Date(),
      }).where(eq(whatsappContacts.id, conversation.contactId));
    }

    const clientName = `${match.firstName || ""} ${match.lastName || ""}`.trim();
    const issued = await whatsappOtpService.issueOtp({
      conversationId: data.conversationId,
      caseId: match.caseId,
      email,
      caseRef: match.caseRef,
      clientName,
    });
    if (!issued.ok) return issued;

    return { ok: true as const, caseId: match.caseId, caseRef: match.caseRef, email };
  }

  async verifyOtp(conversationId: string, code: string) {
    const result = await whatsappOtpService.verifyOtp(conversationId, code);
    if (!result.ok) return result;

    await whatsappConversationService.updateState(conversationId, {
      flowType: "existing_case",
      automationState: "verified_case_note",
    });
    const [conversation] = await db.select({ contactId: whatsappConversations.contactId })
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);
    if (conversation?.contactId) {
      await db.update(whatsappContacts).set({
        verificationStatus: "verified",
        updatedAt: new Date(),
      }).where(eq(whatsappContacts.id, conversation.contactId));
    }
    return { ok: true as const, caseId: result.otp.caseId };
  }
}

export const whatsappCaseVerificationService = new WhatsappCaseVerificationService();
