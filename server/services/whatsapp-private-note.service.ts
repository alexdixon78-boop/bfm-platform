import crypto from "crypto";
import { and, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  casePrivateNoteAttachments,
  casePrivateNotes,
  cases,
  clients,
  parties,
  users,
  whatsappAttachments,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
  whatsappPrivateNoteSessions,
  partyWhatsappPreferences,
  type User,
} from "@shared/schema";
import { classifyCaseAccess, getPrivateNoteAccess, getPrivateNoteScope } from "../security/case-access-policy";
import { whatsappOtpService } from "./whatsapp-otp.service";
import { caseActivityService, type Actor } from "./case-activity.service";
import { caseCommunicationLogService } from "./case-communication-log.service";
import { logAudit } from "./audit-log.service";
import { fileStorageService } from "./file-storage.service";
import { whatsappNotificationService } from "./whatsapp-notification.service";
import { filterPartyMatchesByReferenceRole, parseCaseReferenceInput } from "../utils/case-ref";

const SESSION_MINUTES = 30;
const GENERIC_NO_MATCH = "No case matched those details. Please check them or contact our team.";

function expiresIn(minutes: number) { return new Date(Date.now() + minutes * 60_000); }
function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
function emailHash(value: string) { return crypto.createHash("sha256").update(normalizeEmail(value)).digest("hex"); }
function normalizePhoneDigits(value: string) { return String(value || "").replace(/\D/g, ""); }
function privateNoteActivityActor(note: typeof casePrivateNotes.$inferSelect): Actor {
  if (note.authorKind === "party") return { id: note.authorPartyId, name: note.authorNameSnapshot || "Client", type: "client", channel: "whatsapp" };
  if (note.authorUserId) return { id: note.authorUserId, name: note.authorNameSnapshot || "User", type: note.authorRoleSnapshot === "mediator" ? "mediator" : "staff", channel: "whatsapp" };
  return { name: note.authorNameSnapshot || "System", type: "system", channel: "whatsapp" };
}

class WhatsappPrivateNoteService {
  async accessForActor(caseId: string, actor: User) {
    const access = await classifyCaseAccess(caseId, actor);
    const scope = getPrivateNoteScope(access);
    return scope ? { allowed: true, scope } : null;
  }
  private async activeSession(conversationId: string) {
    const [session] = await db.select().from(whatsappPrivateNoteSessions).where(and(
      eq(whatsappPrivateNoteSessions.conversationId, conversationId),
      isNull(whatsappPrivateNoteSessions.completedAt),
      isNull(whatsappPrivateNoteSessions.cancelledAt),
      gte(whatsappPrivateNoteSessions.expiresAt, new Date()),
    )).orderBy(desc(whatsappPrivateNoteSessions.createdAt)).limit(1);
    return session || null;
  }

  private async openSession(conversationId: string) {
    const [session] = await db.select().from(whatsappPrivateNoteSessions).where(and(
      eq(whatsappPrivateNoteSessions.conversationId, conversationId),
      isNull(whatsappPrivateNoteSessions.completedAt),
      isNull(whatsappPrivateNoteSessions.cancelledAt),
    )).orderBy(desc(whatsappPrivateNoteSessions.createdAt)).limit(1);
    return session || null;
  }

  private async findUniquePhoneCaseContext(conversationId: string, phoneNumber: string) {
    const digits = normalizePhoneDigits(phoneNumber);
    if (!digits) return null;

    const [conversation] = await db.select({
      contactId: whatsappConversations.contactId,
      contactClientId: whatsappContacts.clientId,
      contactPartyId: whatsappContacts.partyId,
      contactCaseId: whatsappContacts.caseId,
      verificationStatus: whatsappContacts.verificationStatus,
    }).from(whatsappConversations)
      .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);
    if (!conversation) return null;

    const clientMatches = await db.select({
      clientId: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
    }).from(clients)
      .where(sql`regexp_replace(coalesce(${clients.phone}, ''), '[^0-9]', '', 'g') = ${digits}`)
      .limit(2);
    if (clientMatches.length !== 1) return null;

    const client = clientMatches[0];
    const activeParties = await db.select({
      partyId: parties.id,
      caseId: parties.caseId,
      caseRef: cases.caseRef,
      noWhatsappOrVoicemail: cases.noWhatsappOrVoicemail,
    }).from(parties)
      .innerJoin(cases, eq(cases.id, parties.caseId))
      .where(and(
        eq(parties.clientId, client.clientId),
        ne(cases.status, "Closed"),
        ne(cases.status, "Archived"),
      ))
      .limit(2);
    if (activeParties.length !== 1 || activeParties[0].noWhatsappOrVoicemail) return null;

    const activeParty = activeParties[0];
    return {
      contactId: conversation.contactId,
      clientId: client.clientId,
      partyId: activeParty.partyId,
      caseId: activeParty.caseId,
      caseRef: activeParty.caseRef,
      clientName: `${client.firstName || ""} ${client.lastName || ""}`.trim(),
      alreadyVerified:
        conversation.verificationStatus === "verified"
        && conversation.contactClientId === client.clientId
        && conversation.contactPartyId === activeParty.partyId
        && conversation.contactCaseId === activeParty.caseId,
    };
  }

  async startPhoneMatchedSession(conversationId: string, phoneNumber: string) {
    const context = await this.findUniquePhoneCaseContext(conversationId, phoneNumber);
    if (!context) return { ok: false as const, status: 404, error: GENERIC_NO_MATCH };

    const existingSessions = await db.select().from(whatsappPrivateNoteSessions).where(and(
      eq(whatsappPrivateNoteSessions.conversationId, conversationId),
      isNull(whatsappPrivateNoteSessions.completedAt),
      isNull(whatsappPrivateNoteSessions.cancelledAt),
    ));
    for (const existing of existingSessions) await this.cancelExpiredSession(existing.id, existing.noteId);

    const now = new Date();
    await db.insert(whatsappPrivateNoteSessions).values({
      conversationId,
      caseId: context.caseId,
      partyId: context.partyId,
      state: context.alreadyVerified ? "awaiting_private_note_content" : "awaiting_identity_email",
      caseReferenceInput: context.caseRef,
      verifiedAt: context.alreadyVerified ? now : null,
      expiresAt: expiresIn(SESSION_MINUTES),
    }).returning();
    await db.update(whatsappConversations).set({
      flowType: "existing_case",
      automationState: context.alreadyVerified ? "awaiting_private_note_content" : "awaiting_identity_email",
      updatedAt: now,
    }).where(eq(whatsappConversations.id, conversationId));

    return {
      ok: true as const,
      mode: context.alreadyVerified ? "verified" as const : "identity_required" as const,
      caseId: context.caseId,
    };
  }

  async startSession(conversationId: string) {
    const existingSessions = await db.select().from(whatsappPrivateNoteSessions).where(and(
      eq(whatsappPrivateNoteSessions.conversationId, conversationId),
      isNull(whatsappPrivateNoteSessions.completedAt),
      isNull(whatsappPrivateNoteSessions.cancelledAt),
    ));
    for (const existing of existingSessions) await this.cancelExpiredSession(existing.id, existing.noteId);
    const [session] = await db.insert(whatsappPrivateNoteSessions).values({
      conversationId,
      state: "awaiting_case_reference",
      expiresAt: expiresIn(SESSION_MINUTES),
    }).returning();
    await db.update(whatsappConversations).set({ flowType: "existing_case", automationState: "awaiting_case_reference", updatedAt: new Date() }).where(eq(whatsappConversations.id, conversationId));
    return session;
  }

  async setCaseReference(conversationId: string, caseReference: string, messageId?: string | null) {
    const session = await this.activeSession(conversationId);
    if (!session) return { ok: false as const, status: 400, error: "This session has expired. Please start again." };
    const value = caseReference.trim().slice(0, 100);
    if (!value) return { ok: false as const, status: 400, error: "Please enter your case reference." };
    await db.update(whatsappPrivateNoteSessions).set({ caseReferenceInput: value, state: "awaiting_identity_email", updatedAt: new Date() }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    await db.update(whatsappConversations).set({ automationState: "awaiting_identity_email", updatedAt: new Date() }).where(eq(whatsappConversations.id, conversationId));
    if (messageId) await db.update(whatsappMessages).set({ contentClassification: "verification", updatedAt: new Date() }).where(eq(whatsappMessages.id, messageId));
    return { ok: true as const };
  }

  async submitIdentity(conversationId: string, rawEmail: string, messageId?: string | null) {
    const session = await this.activeSession(conversationId);
    const email = normalizeEmail(rawEmail);
    if (!session?.caseReferenceInput || !/^\S+@\S+\.\S+$/.test(email)) return { ok: false as const, status: 404, error: GENERIC_NO_MATCH };
    const hash = emailHash(email);
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    const [lookupUsage] = await db.select({ count: sql<number>`coalesce(sum(${whatsappPrivateNoteSessions.lookupAttemptCount}), 0)` }).from(whatsappPrivateNoteSessions).where(and(
      eq(whatsappPrivateNoteSessions.conversationId, conversationId), gte(whatsappPrivateNoteSessions.createdAt, oneHourAgo),
    ));
    if (Number(lookupUsage.count) >= 10) return { ok: false as const, status: 429, error: "Too many attempts. Please try again later." };
    if (messageId) await db.update(whatsappMessages).set({ contentClassification: "verification", updatedAt: new Date() }).where(eq(whatsappMessages.id, messageId));
    await db.update(whatsappPrivateNoteSessions).set({
      identityEmailHash: hash,
      lookupAttemptCount: session.lookupAttemptCount + 1,
      updatedAt: new Date(),
    }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    if (session.lookupAttemptCount >= 9) return { ok: false as const, status: 429, error: "Too many attempts. Please try again later." };

    const parsedCaseReference = parseCaseReferenceInput(session.caseReferenceInput);
    const [caseRecord] = await db.select().from(cases).where(and(
      sql`lower(${cases.caseRef}) = ${parsedCaseReference.baseCaseRef.toLowerCase()}`,
      ne(cases.status, "Closed"),
      ne(cases.status, "Archived"),
    )).limit(1);
    if (!caseRecord || caseRecord.noWhatsappOrVoicemail) return { ok: false as const, status: 404, error: GENERIC_NO_MATCH };

    let clientEmailMatches = await db.select({
      partyId: parties.id, clientId: clients.id, role: parties.role, name: sql<string>`trim(coalesce(${clients.firstName}, '') || ' ' || coalesce(${clients.lastName}, ''))`, email: clients.email,
    }).from(parties).innerJoin(clients, eq(clients.id, parties.clientId)).where(and(eq(parties.caseId, caseRecord.id), sql`lower(${clients.email}) = ${email}`));
    if (session.partyId) clientEmailMatches = clientEmailMatches.filter((match) => match.partyId === session.partyId);
    const clientMatches = filterPartyMatchesByReferenceRole(clientEmailMatches, parsedCaseReference.partyRole);
    const accountMatches = session.partyId ? [] : await db.select().from(users).where(and(sql`lower(${users.email}) = ${email}`, eq(users.status, "active")));
    const eligibleAccounts: User[] = [];
    for (const account of accountMatches) {
      if (account.role === "superadmin" || account.role === "subadmin") eligibleAccounts.push(account);
      else if (account.role === "mediator" && (await classifyCaseAccess(caseRecord.id, account)).tier === "full_mediator") eligibleAccounts.push(account);
    }
    if (clientMatches.length + eligibleAccounts.length !== 1) return { ok: false as const, status: 404, error: GENERIC_NO_MATCH };

    const client = clientMatches[0];
    const account = eligibleAccounts[0];
    const displayName = client?.name || account?.name || "there";
    const issued = await whatsappOtpService.issueOtp({ conversationId, caseId: caseRecord.id, email, caseRef: caseRecord.caseRef, clientName: displayName });
    if (!issued.ok) return issued;
    await db.update(whatsappPrivateNoteSessions).set({
      caseId: caseRecord.id,
      partyId: client?.partyId || null,
      authorUserId: account?.id || null,
      otpId: issued.otp.id,
      state: "awaiting_otp",
      expiresAt: expiresIn(SESSION_MINUTES),
      updatedAt: new Date(),
    }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    await db.update(whatsappConversations).set({ automationState: "awaiting_otp", updatedAt: new Date() }).where(eq(whatsappConversations.id, conversationId));
    return { ok: true as const, caseId: caseRecord.id };
  }

  async verifyOtp(conversationId: string, code: string, messageId?: string | null) {
    if (messageId) await db.update(whatsappMessages).set({ contentClassification: "verification", updatedAt: new Date() }).where(eq(whatsappMessages.id, messageId));
    const result = await whatsappOtpService.verifyOtp(conversationId, code);
    if (!result.ok) return result;
    const session = await this.activeSession(conversationId);
    if (!session?.caseId || session.otpId !== result.otp.id) return { ok: false as const, status: 400, error: "This verification session has expired." };
    const now = new Date();
    if (session.partyId) await db.insert(partyWhatsappPreferences).values({ partyId: session.partyId, status: "opted_in", source: "verified_private_note_inbound", recordedAt: now, updatedAt: now }).onConflictDoUpdate({ target: partyWhatsappPreferences.partyId, set: { status: "opted_in", source: "verified_private_note_inbound", recordedAt: now, updatedAt: now } });
    const [conversation] = await db.select({ contactId: whatsappConversations.contactId })
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);
    if (conversation?.contactId && session.partyId) {
      const [party] = await db.select({ clientId: parties.clientId }).from(parties).where(eq(parties.id, session.partyId)).limit(1);
      await db.update(whatsappContacts).set({
        clientId: party?.clientId || null,
        partyId: session.partyId,
        caseId: session.caseId,
        verificationStatus: "verified",
        updatedAt: now,
      }).where(eq(whatsappContacts.id, conversation.contactId));
    }
    await db.update(whatsappPrivateNoteSessions).set({ state: "awaiting_private_note_content", verifiedAt: now, expiresAt: expiresIn(SESSION_MINUTES), updatedAt: now }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    await db.update(whatsappConversations).set({ automationState: "awaiting_private_note_content", updatedAt: now }).where(eq(whatsappConversations.id, conversationId));
    return { ok: true as const, caseId: session.caseId };
  }

  private async ensureDraft(session: NonNullable<Awaited<ReturnType<WhatsappPrivateNoteService["activeSession"]>>>) {
    if (session.noteId) {
      const [existing] = await db.select().from(casePrivateNotes).where(eq(casePrivateNotes.id, session.noteId)).limit(1);
      if (existing) return existing;
    }
    const [author] = session.authorUserId ? await db.select().from(users).where(eq(users.id, session.authorUserId)).limit(1) : [];
    const [party] = session.partyId ? await db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(parties).innerJoin(clients, eq(clients.id, parties.clientId)).where(eq(parties.id, session.partyId)).limit(1) : [];
    const [note] = await db.insert(casePrivateNotes).values({
      caseId: session.caseId!, sourceConversationId: session.conversationId,
      authorKind: session.partyId ? "party" : "user", authorPartyId: session.partyId, authorUserId: session.authorUserId,
      authorRoleSnapshot: session.partyId ? "client" : author?.role || "unknown",
      authorNameSnapshot: party ? `${party.firstName || ""} ${party.lastName || ""}`.trim() : author?.name || "Unknown",
    }).returning();
    await db.update(whatsappPrivateNoteSessions).set({ noteId: note.id, updatedAt: new Date() }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    return note;
  }

  async appendText(conversationId: string, text: string, messageId?: string | null) {
    const session = await this.activeSession(conversationId);
    if (!session?.verifiedAt || session.state !== "awaiting_private_note_content") return { ok: false as const, status: 400, error: "Please verify again." };
    const clean = text.trim().slice(0, 10000);
    if (!clean) return { ok: false as const, status: 400, error: "Send note text or an attachment." };
    const note = await this.ensureDraft(session);
    await db.update(casePrivateNotes).set({ body: note.body ? `${note.body}\n${clean}` : clean, updatedAt: new Date() }).where(eq(casePrivateNotes.id, note.id));
    if (messageId) await db.update(whatsappMessages).set({ caseId: session.caseId, partyId: session.partyId, contentClassification: "private_note_draft", caseAssignmentSource: "private_note_session", updatedAt: new Date() }).where(eq(whatsappMessages.id, messageId));
    return { ok: true as const, noteId: note.id };
  }

  async attachInboundMedia(conversationId: string, sourceWhatsappAttachmentId: string, messageId: string) {
    const session = await this.activeSession(conversationId);
    if (!session?.verifiedAt || session.state !== "awaiting_private_note_content") return { ok: false as const, status: 400, error: "Please verify again." };
    const note = await this.ensureDraft(session);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(casePrivateNoteAttachments).where(eq(casePrivateNoteAttachments.noteId, note.id));
    if (Number(count) >= 5) return { ok: false as const, status: 400, error: "A note can contain up to 5 attachments." };
    const [source] = await db.select().from(whatsappAttachments).where(eq(whatsappAttachments.id, sourceWhatsappAttachmentId)).limit(1);
    if (!source) return { ok: false as const, status: 404, error: "Attachment not found." };
    const [attachment] = await db.insert(casePrivateNoteAttachments).values({ noteId: note.id, sourceWhatsappAttachmentId, sourceMessageId: messageId, metaMediaId: source.metaMediaId, fileName: source.fileName, declaredMimeType: source.mimeType }).returning();
    await db.update(whatsappMessages).set({ caseId: session.caseId, partyId: session.partyId, contentClassification: "private_note_draft", caseAssignmentSource: "private_note_session", updatedAt: new Date() }).where(eq(whatsappMessages.id, messageId));
    return { ok: true as const, noteId: note.id, attachment };
  }

  async complete(conversationId: string) {
    const session = await this.activeSession(conversationId);
    if (!session?.verifiedAt || !session.noteId || !session.caseId) return { ok: false as const, status: 400, error: "Add note text or an attachment before finishing." };
    const [note] = await db.select().from(casePrivateNotes).where(eq(casePrivateNotes.id, session.noteId)).limit(1);
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(casePrivateNoteAttachments).where(eq(casePrivateNoteAttachments.noteId, session.noteId));
    if (!note?.body?.trim() && Number(count) === 0) return { ok: false as const, status: 400, error: "Add note text or an attachment before finishing." };
    const now = new Date();
    await db.update(casePrivateNotes).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(casePrivateNotes.id, note.id));
    await db.update(whatsappPrivateNoteSessions).set({ state: "completed", completedAt: now, updatedAt: now }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    await db.update(whatsappConversations).set({ automationState: "awaiting_menu", updatedAt: now }).where(eq(whatsappConversations.id, conversationId));
    await caseCommunicationLogService.record({ caseId: session.caseId, partyId: session.partyId, channel: "whatsapp", direction: "inbound", trigger: "private_whatsapp_note_received", deliveryStatus: "received", sourceEntityType: "case_private_note", sourceEntityId: note.id, actorType: note.authorRoleSnapshot, actorId: note.authorUserId, actorName: note.authorNameSnapshot, preview: "Private WhatsApp note received", metadata: { private: true } });
    await caseActivityService.log({
      caseId: session.caseId,
      type: "private_whatsapp_note_received",
      title: "Private WhatsApp note received",
      description: `Private WhatsApp note received from ${note.authorNameSnapshot || "the verified sender"}`,
      direction: "inbound",
      relatedEntityType: "case_private_note",
      relatedEntityId: note.id,
      metadata: JSON.stringify({ private: true, source: "whatsapp" }),
      actor: privateNoteActivityActor(note),
    });
    await whatsappNotificationService.notifyPrivateNoteAudience(session.caseId);
    await logAudit({ action: "private_whatsapp_note_completed", entity: "case_private_note", entityId: note.id, entityRef: session.caseId, details: JSON.stringify({ authorRole: note.authorRoleSnapshot }) });
    return { ok: true as const, noteId: note.id, caseId: session.caseId };
  }

  async cancel(conversationId: string) {
    const session = await this.openSession(conversationId);
    if (!session) return { ok: true as const };
    const now = new Date();
    if (session.noteId) {
      await db.update(casePrivateNotes).set({ status: "cancelled", body: null, cancelledAt: now, updatedAt: now }).where(eq(casePrivateNotes.id, session.noteId));
      const attachments = await db.update(casePrivateNoteAttachments).set({ status: "failed", processingLeaseExpiresAt: null, lastError: "Draft cancelled", updatedAt: now }).where(eq(casePrivateNoteAttachments.noteId, session.noteId)).returning();
      for (const attachment of attachments) if (attachment.storageKey) await fileStorageService.deletePrivateCaseNoteAttachment(attachment.storageKey);
      await db.update(casePrivateNoteAttachments).set({ storageKey: null, updatedAt: new Date() }).where(and(eq(casePrivateNoteAttachments.noteId, session.noteId), eq(casePrivateNoteAttachments.status, "failed")));
    }
    await db.update(whatsappPrivateNoteSessions).set({ state: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(whatsappPrivateNoteSessions.id, session.id));
    await db.update(whatsappConversations).set({ automationState: "awaiting_menu", updatedAt: now }).where(eq(whatsappConversations.id, conversationId));
    return { ok: true as const };
  }

  async cleanupExpiredDrafts(limit = 50) {
    const sessions = await db.select().from(whatsappPrivateNoteSessions).where(and(
      isNull(whatsappPrivateNoteSessions.completedAt), isNull(whatsappPrivateNoteSessions.cancelledAt),
      sql`${whatsappPrivateNoteSessions.expiresAt} < now()`,
    )).limit(limit);
    for (const session of sessions) await this.cancelExpiredSession(session.id, session.noteId);
    return sessions.length;
  }

  private async cancelExpiredSession(sessionId: string, noteId: string | null) {
    const now = new Date();
    if (noteId) {
      await db.update(casePrivateNotes).set({ status: "cancelled", body: null, cancelledAt: now, updatedAt: now }).where(eq(casePrivateNotes.id, noteId));
      const attachments = await db.update(casePrivateNoteAttachments).set({ status: "failed", processingLeaseExpiresAt: null, lastError: "Draft expired", updatedAt: now }).where(eq(casePrivateNoteAttachments.noteId, noteId)).returning();
      for (const attachment of attachments) if (attachment.storageKey) await fileStorageService.deletePrivateCaseNoteAttachment(attachment.storageKey);
      await db.update(casePrivateNoteAttachments).set({ storageKey: null, updatedAt: new Date() }).where(and(eq(casePrivateNoteAttachments.noteId, noteId), eq(casePrivateNoteAttachments.status, "failed")));
    }
    await db.update(whatsappPrivateNoteSessions).set({ state: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(whatsappPrivateNoteSessions.id, sessionId));
  }

  async listForActor(caseId: string, actor: User) {
    const access = await classifyCaseAccess(caseId, actor);
    if (!await this.accessForActor(caseId, actor)) throw Object.assign(new Error("Not found"), { status: 404 });
    const rows = await db.select().from(casePrivateNotes).where(and(eq(casePrivateNotes.caseId, caseId), eq(casePrivateNotes.status, "completed"))).orderBy(desc(casePrivateNotes.createdAt));
    const visible = rows.filter((note) => getPrivateNoteAccess(actor, access, note));
    return Promise.all(visible.map(async (note) => {
      const attachments = await db.select().from(casePrivateNoteAttachments).where(eq(casePrivateNoteAttachments.noteId, note.id));
      return { ...note, attachments: attachments.map(({ storageKey: _storageKey, lastError: _lastError, ...file }) => file) };
    }));
  }

  async openAttachmentForActor(caseId: string, noteId: string, attachmentId: string, actor: User) {
    const [note] = await db.select().from(casePrivateNotes).where(and(eq(casePrivateNotes.id, noteId), eq(casePrivateNotes.caseId, caseId), eq(casePrivateNotes.status, "completed"))).limit(1);
    if (!note || !getPrivateNoteAccess(actor, await classifyCaseAccess(caseId, actor), note)) return null;
    const [attachment] = await db.select().from(casePrivateNoteAttachments).where(and(eq(casePrivateNoteAttachments.id, attachmentId), eq(casePrivateNoteAttachments.noteId, noteId), eq(casePrivateNoteAttachments.status, "clean"), isNull(casePrivateNoteAttachments.redactedAt))).limit(1);
    if (!attachment?.storageKey) return null;
    return { attachment, file: await fileStorageService.openPrivateCaseNoteAttachment(attachment.storageKey) };
  }

  async retryAttachment(caseId: string, noteId: string, attachmentId: string, actorId: string) {
    const [note] = await db.select({ id: casePrivateNotes.id }).from(casePrivateNotes).where(and(
      eq(casePrivateNotes.id, noteId),
      eq(casePrivateNotes.caseId, caseId),
      eq(casePrivateNotes.status, "completed"),
    )).limit(1);
    if (!note) return null;
    const now = new Date();
    const [attachment] = await db.update(casePrivateNoteAttachments).set({
      status: "queued",
      retryCount: 0,
      nextAttemptAt: now,
      processingLeaseExpiresAt: null,
      lastError: null,
      updatedAt: now,
    }).where(and(
      eq(casePrivateNoteAttachments.id, attachmentId),
      eq(casePrivateNoteAttachments.noteId, noteId),
      eq(casePrivateNoteAttachments.status, "failed"),
      gte(casePrivateNoteAttachments.retryCount, 6),
    )).returning();
    if (!attachment) return null;
    await logAudit({ userId: actorId, action: "private_note_attachment_retry", entity: "case_private_note_attachment", entityId: attachmentId, entityRef: caseId });
    return attachment;
  }

  async redactText(caseId: string, noteId: string, actorId: string, reason: string) {
    const now = new Date();
    const [note] = await db.update(casePrivateNotes).set({ body: null, textRedactedAt: now, textRedactedBy: actorId, textRedactionReason: reason, updatedAt: now }).where(and(eq(casePrivateNotes.id, noteId), eq(casePrivateNotes.caseId, caseId), eq(casePrivateNotes.status, "completed"))).returning();
    if (note) await logAudit({ userId: actorId, action: "private_note_text_redacted", entity: "case_private_note", entityId: noteId, entityRef: caseId, details: JSON.stringify({ reason }) });
    return note || null;
  }

  async redactAttachment(caseId: string, noteId: string, attachmentId: string, actorId: string, reason: string) {
    const [note] = await db.select().from(casePrivateNotes).where(and(eq(casePrivateNotes.id, noteId), eq(casePrivateNotes.caseId, caseId), eq(casePrivateNotes.status, "completed"))).limit(1);
    if (!note) return null;
    const now = new Date();
    const [updated] = await db.update(casePrivateNoteAttachments).set({ status: "redacted", processingLeaseExpiresAt: null, redactedAt: now, redactedBy: actorId, redactionReason: reason, updatedAt: now }).where(and(eq(casePrivateNoteAttachments.id, attachmentId), eq(casePrivateNoteAttachments.noteId, noteId))).returning();
    if (!updated) return null;
    if (updated.storageKey) await fileStorageService.deletePrivateCaseNoteAttachment(updated.storageKey);
    await db.update(casePrivateNoteAttachments).set({ storageKey: null, updatedAt: new Date() }).where(and(eq(casePrivateNoteAttachments.id, attachmentId), eq(casePrivateNoteAttachments.status, "redacted")));
    await logAudit({ userId: actorId, action: "private_note_attachment_redacted", entity: "case_private_note_attachment", entityId: attachmentId, entityRef: caseId, details: JSON.stringify({ reason }) });
    return { ...updated, storageKey: null };
  }
}

export const whatsappPrivateNoteService = new WhatsappPrivateNoteService();
export { GENERIC_NO_MATCH };
