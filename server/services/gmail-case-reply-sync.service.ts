import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  caseCommunicationLogs,
  caseDocuments,
  caseEmailMessages,
  clients,
  gmailCaseReplyAttachments,
  gmailCaseReplyNotifications,
  gmailMessages,
  gmailReplySyncState,
  notifications,
  users,
} from "@shared/schema";
import { fileStorageService } from "./file-storage.service";
import { gmailMailService, parseGmailMessageForMailInbox, type GmailMessageAttachment } from "./gmail-mail.service";
import { caseCommunicationLogService } from "./case-communication-log.service";
import { notificationService } from "./notification.service";
import {
  extractCaseReplyToken,
  canLinkCaseReplySender,
  hasSafeReplyAttachmentSignature,
  hashCaseReplyToken,
  MAX_GMAIL_REPLY_ATTACHMENTS_TOTAL_BYTES,
  redactCaseReplyAddress,
  validateReplyAttachment,
} from "./gmail-case-reply-utils";

const SYNC_STATE_ID = "bfm";
const CHECKPOINT_OVERLAP_MS = 10 * 60 * 1000;
const ADVISORY_LOCK_NAME = "bfm-gmail-case-reply-sync";

type ReplyContext = {
  emailMessageId: string;
  gmailThreadId: string | null;
  caseId: string;
  caseRef: string;
  partyId: string | null;
  clientId: string | null;
  clientUserId: string | null;
  recipientType: string;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientUserId: string | null;
  outboundActorId: string | null;
};

export type GmailCaseReplySyncResult = {
  processed: number;
  linked: number;
  unmatched: number;
  failed: number;
  attachmentsSaved: number;
  attachmentsSkipped: number;
  locked: boolean;
};

function safeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned || "attachment.bin";
}

function attachmentKey(attachment: GmailMessageAttachment): string {
  if (attachment.attachmentId) return attachment.attachmentId;
  return `embedded:${createHash("sha256").update(`${attachment.filename}\0${attachment.mimeType}\0${attachment.bodyData || ""}`).digest("hex")}`;
}

class GmailCaseReplySyncService {
  private async findContextByToken(token: string): Promise<ReplyContext | null> {
    return (await this.findContexts(eq(caseEmailMessages.replyTokenHash, hashCaseReplyToken(token)), 1))[0] ?? null;
  }

  private async findContextByThread(threadId: string): Promise<ReplyContext | null> {
    const rows = await this.findContexts(eq(caseEmailMessages.gmailThreadId, threadId), 2);
    return rows.length === 1 ? rows[0] : null;
  }

  private async findContexts(condition: ReturnType<typeof eq>, limit: number): Promise<ReplyContext[]> {
    return db
      .select({
        emailMessageId: caseEmailMessages.id,
        gmailThreadId: caseEmailMessages.gmailThreadId,
        caseId: caseCommunicationLogs.caseId,
        caseRef: caseCommunicationLogs.caseRef,
        partyId: caseCommunicationLogs.partyId,
        clientId: caseCommunicationLogs.clientId,
        clientUserId: clients.userId,
        recipientType: caseCommunicationLogs.recipientType,
        recipientName: caseCommunicationLogs.recipientName,
        recipientEmail: caseCommunicationLogs.recipientEmail,
        recipientUserId: caseEmailMessages.recipientUserId,
        outboundActorId: caseCommunicationLogs.actorId,
      })
      .from(caseEmailMessages)
      .innerJoin(caseCommunicationLogs, eq(caseEmailMessages.communicationLogId, caseCommunicationLogs.id))
      .leftJoin(clients, eq(caseCommunicationLogs.clientId, clients.id))
      .where(condition)
      .limit(limit);
  }

  private async recordAttachmentState(
    gmailMessageId: string,
    context: ReplyContext,
    attachment: GmailMessageAttachment,
    status: string,
    failureReason: string | null,
  ) {
    const [row] = await db.insert(gmailCaseReplyAttachments).values({
      gmailMessageId,
      caseEmailMessageId: context.emailMessageId,
      gmailAttachmentId: attachmentKey(attachment),
      fileName: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
      status,
      failureReason,
      attempts: status === "failed" ? 1 : 0,
    }).onConflictDoUpdate({
      target: [gmailCaseReplyAttachments.gmailMessageId, gmailCaseReplyAttachments.gmailAttachmentId],
      set: { status, failureReason, sizeBytes: attachment.size, updatedAt: new Date() },
    }).returning();
    return row;
  }

  private async saveAttachments(
    gmail: Awaited<ReturnType<typeof gmailMailService.getAuthenticatedGmail>>,
    importedMessageId: string,
    gmailProviderMessageId: string,
    context: ReplyContext,
    attachments: GmailMessageAttachment[],
  ): Promise<{ saved: number; skipped: number; failed: number }> {
    const priorStates = await db.select().from(gmailCaseReplyAttachments)
      .where(eq(gmailCaseReplyAttachments.gmailMessageId, importedMessageId));
    let totalBytes = priorStates
      .filter((row) => row.status === "saved")
      .reduce((sum, row) => sum + row.sizeBytes, 0);
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    const uploaderId = context.recipientUserId || context.clientUserId || context.outboundActorId;

    for (const attachment of attachments) {
      const existing = await db.select().from(gmailCaseReplyAttachments).where(and(
        eq(gmailCaseReplyAttachments.gmailMessageId, importedMessageId),
        eq(gmailCaseReplyAttachments.gmailAttachmentId, attachmentKey(attachment)),
      )).limit(1);
      if (existing[0]?.status === "saved" || existing[0]?.status === "blocked") {
        if (existing[0].status === "saved") {
          saved += 1;
        }
        else skipped += 1;
        continue;
      }

      const validation = validateReplyAttachment(attachment.filename, attachment.mimeType, attachment.size);
      if (!validation.ok) {
        await this.recordAttachmentState(importedMessageId, context, attachment, "blocked", validation.reason);
        skipped += 1;
        continue;
      }
      if (totalBytes + attachment.size > MAX_GMAIL_REPLY_ATTACHMENTS_TOTAL_BYTES) {
        await this.recordAttachmentState(importedMessageId, context, attachment, "blocked", "total_too_large");
        skipped += 1;
        continue;
      }
      if (!uploaderId) {
        await this.recordAttachmentState(importedMessageId, context, attachment, "failed", "missing_ingestion_actor");
        failed += 1;
        continue;
      }

      try {
        const attachmentState = await this.recordAttachmentState(importedMessageId, context, attachment, "pending", null);
        const [recoveredDocument] = await db.select().from(caseDocuments)
          .where(eq(caseDocuments.id, attachmentState.id)).limit(1);
        if (recoveredDocument) {
          await db.update(gmailCaseReplyAttachments).set({
            caseDocumentId: recoveredDocument.id,
            status: "saved",
            failureReason: null,
            sizeBytes: recoveredDocument.fileSizeBytes || attachment.size,
            updatedAt: new Date(),
          }).where(eq(gmailCaseReplyAttachments.id, attachmentState.id));
          totalBytes += recoveredDocument.fileSizeBytes || attachment.size;
          saved += 1;
          continue;
        }
        const encoded = attachment.bodyData || (attachment.attachmentId
          ? (await gmail.users.messages.attachments.get({
            userId: "me",
            messageId: gmailProviderMessageId,
            id: attachment.attachmentId,
          })).data.data
          : null);
        if (!encoded) throw new Error("Gmail attachment body was empty");
        const buffer = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        const actualValidation = validateReplyAttachment(attachment.filename, attachment.mimeType, buffer.byteLength);
        const hasSafeSignature = actualValidation.ok && hasSafeReplyAttachmentSignature(attachment.mimeType, buffer);
        if (!actualValidation.ok || !hasSafeSignature || totalBytes + buffer.byteLength > MAX_GMAIL_REPLY_ATTACHMENTS_TOTAL_BYTES) {
          const reason = !actualValidation.ok
            ? actualValidation.reason
            : !hasSafeSignature ? "unsafe_content" : "total_too_large";
          await this.recordAttachmentState(importedMessageId, context, { ...attachment, size: buffer.byteLength }, "blocked", reason);
          skipped += 1;
          continue;
        }
        const originalName = safeFileName(attachment.filename);
        const stored = await fileStorageService.saveCaseDocumentFile({
          fileName: `${randomUUID()}-${originalName}`,
          buffer,
          mimeType: attachment.mimeType,
        });
        const [createdDocument] = await db.insert(caseDocuments).values({
          id: attachmentState.id,
          caseId: context.caseId,
          partyId: context.partyId,
          documentCategory: "email_attachment",
          title: `Inbound email attachment: ${originalName}`,
          fileName: originalName,
          fileUrl: stored.fileUrl,
          storageKey: stored.storageKey,
          mimeType: attachment.mimeType,
          fileSizeBytes: buffer.byteLength,
          uploadedBy: uploaderId,
          reviewStatus: "draft",
          sharedWithClients: false,
        }).onConflictDoNothing().returning();
        const document = createdDocument || (await db.select().from(caseDocuments)
          .where(eq(caseDocuments.id, attachmentState.id)).limit(1))[0];
        if (!document) throw new Error("Case document could not be recorded");
        await db.update(gmailCaseReplyAttachments).set({
          caseDocumentId: document.id,
          status: "saved",
          failureReason: null,
          sizeBytes: buffer.byteLength,
          attempts: sql`${gmailCaseReplyAttachments.attempts} + 1`,
          updatedAt: new Date(),
        }).where(and(
          eq(gmailCaseReplyAttachments.gmailMessageId, importedMessageId),
          eq(gmailCaseReplyAttachments.gmailAttachmentId, attachmentKey(attachment)),
        ));
        totalBytes += buffer.byteLength;
        saved += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 500) : "attachment_download_failed";
        await db.update(gmailCaseReplyAttachments).set({
          status: "failed",
          failureReason: reason,
          attempts: sql`${gmailCaseReplyAttachments.attempts} + 1`,
          updatedAt: new Date(),
        }).where(and(
          eq(gmailCaseReplyAttachments.gmailMessageId, importedMessageId),
          eq(gmailCaseReplyAttachments.gmailAttachmentId, attachmentKey(attachment)),
        ));
        failed += 1;
      }
    }
    return { saved, skipped, failed };
  }

  private async notifyAdmins(importedMessageId: string, context: ReplyContext, sender: string, subject: string | null) {
    const admins = await db.select({ id: users.id }).from(users).where(and(
      inArray(users.role, ["superadmin", "subadmin"]),
      eq(users.status, "active"),
    ));
    for (const admin of admins) {
      const [reservation] = await db.insert(gmailCaseReplyNotifications).values({
        gmailMessageId: importedMessageId,
        recipientUserId: admin.id,
      }).onConflictDoNothing().returning();
      const row = reservation || (await db.select().from(gmailCaseReplyNotifications).where(and(
        eq(gmailCaseReplyNotifications.gmailMessageId, importedMessageId),
        eq(gmailCaseReplyNotifications.recipientUserId, admin.id),
      )).limit(1))[0];
      if (!row || row.notificationId) continue;
      const [existingNotification] = await db.select({ id: notifications.id }).from(notifications)
        .where(eq(notifications.id, row.id)).limit(1);
      if (existingNotification) {
        await db.update(gmailCaseReplyNotifications).set({ notificationId: existingNotification.id, updatedAt: new Date() })
          .where(eq(gmailCaseReplyNotifications.id, row.id));
        continue;
      }
      const notification = await notificationService.createNotification({
        id: row.id,
        recipientId: admin.id,
        recipientRole: "gmail_case_reply_recipient",
        type: "gmail_case_reply",
        urgency: "blue",
        caseId: context.caseId,
        title: `New email reply — ${context.caseRef}`,
        message: `${sender || "A recipient"} replied${subject ? ` to “${subject}”` : ""}. Open /cases/${context.caseId}?tab=communications`,
        status: "active",
        caseNoteRequired: false,
      });
      await db.update(gmailCaseReplyNotifications).set({ notificationId: notification.id, updatedAt: new Date() })
        .where(eq(gmailCaseReplyNotifications.id, row.id));
    }
  }

  private async initialCheckpoint(): Promise<Date> {
    const [oldest] = await db.select({ value: sql<Date | null>`min(${caseEmailMessages.createdAt})` })
      .from(caseEmailMessages)
      .where(isNotNull(caseEmailMessages.replyTokenHash));
    return oldest?.value ? new Date(oldest.value) : new Date();
  }

  async syncReplies(): Promise<GmailCaseReplySyncResult> {
    const result: GmailCaseReplySyncResult = { processed: 0, linked: 0, unmatched: 0, failed: 0, attachmentsSaved: 0, attachmentsSkipped: 0, locked: false };
    const lockClient = await pool.connect();
    try {
      const lock = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [ADVISORY_LOCK_NAME]);
      if (!lock.rows[0]?.locked) return result;
      result.locked = true;

      const attemptAt = new Date();
      await db.insert(gmailReplySyncState).values({ id: SYNC_STATE_ID, lastAttemptAt: attemptAt })
        .onConflictDoUpdate({ target: gmailReplySyncState.id, set: { lastAttemptAt: attemptAt, updatedAt: attemptAt } });
      const [state] = await db.select().from(gmailReplySyncState).where(eq(gmailReplySyncState.id, SYNC_STATE_ID));
      const checkpoint = state?.checkpointAt ? new Date(state.checkpointAt) : await this.initialCheckpoint();
      const after = new Date(checkpoint.getTime() - CHECKPOINT_OVERLAP_MS);
      const gmail = await gmailMailService.getAuthenticatedGmail();
      let pageToken: string | undefined;
      const ids: string[] = [];
      do {
        const page = await gmail.users.messages.list({
          userId: "me",
          labelIds: ["INBOX"],
          includeSpamTrash: false,
          maxResults: 100,
          pageToken,
          q: `after:${Math.floor(after.getTime() / 1000)}`,
        });
        ids.push(...(page.data.messages || []).map((message) => message.id).filter((id): id is string => !!id));
        pageToken = page.data.nextPageToken || undefined;
      } while (pageToken);

      for (const providerMessageId of ids) {
        result.processed += 1;
        try {
          const full = await gmail.users.messages.get({ userId: "me", id: providerMessageId, format: "full" });
          const preview = parseGmailMessageForMailInbox(full.data);
          const token = extractCaseReplyToken(preview.toEmails) || extractCaseReplyToken(preview.ccEmails);
          const threadContext = preview.gmailThreadId ? await this.findContextByThread(preview.gmailThreadId) : null;
          const tokenContext = !threadContext && token ? await this.findContextByToken(token) : null;
          const context = threadContext || tokenContext;
          if (!context || !canLinkCaseReplySender(!!threadContext, preview.fromEmail, context.recipientEmail)) {
            result.unmatched += 1;
            continue;
          }

          const imported = (await gmailMailService.importMessages(
            [providerMessageId],
            context.outboundActorId || context.recipientUserId || "",
            { redactCaseReplyTokens: true },
          ))[0];
          if (!imported) throw new Error("Gmail reply could not be imported");
          const [linked] = await db.update(gmailMessages).set({
            status: "case_linked",
            linkedCaseId: context.caseId,
            linkedCaseEmailMessageId: context.emailMessageId,
            toEmails: redactCaseReplyAddress(preview.toEmails || "") || null,
            ccEmails: redactCaseReplyAddress(preview.ccEmails || "") || null,
            updatedAt: new Date(),
          }).where(and(
            eq(gmailMessages.id, imported.id),
            ne(gmailMessages.status, "converted"),
            isNull(gmailMessages.linkedEnquiryId),
          )).returning();
          if (!linked) {
            result.unmatched += 1;
            continue;
          }
          if (preview.gmailThreadId && context.gmailThreadId !== preview.gmailThreadId) {
            await db.update(caseEmailMessages).set({ gmailThreadId: preview.gmailThreadId }).where(eq(caseEmailMessages.id, context.emailMessageId));
          }
          const communication = await caseCommunicationLogService.record({
            caseId: context.caseId,
            caseRef: context.caseRef,
            partyId: context.partyId,
            clientId: context.clientId,
            recipientType: context.recipientType,
            recipientName: preview.fromName || context.recipientName,
            recipientEmail: preview.fromEmail,
            channel: "email",
            direction: "inbound",
            trigger: "gmail_case_reply",
            subject: preview.subject,
            sentAt: preview.receivedAt || new Date(),
            deliveryStatus: "received",
            sourceEntityType: "gmail_message",
            sourceEntityId: linked.id,
            providerMessageId,
            actorType: context.recipientType === "staff" ? "staff" : "client",
            actorId: context.recipientUserId,
            actorName: preview.fromName || context.recipientName,
            preview: preview.textBody || preview.snippet,
            metadata: { gmailThreadId: preview.gmailThreadId, caseEmailMessageId: context.emailMessageId },
          });
          if (!communication) throw new Error("Gmail reply communication could not be recorded");
          const attachmentResult = await this.saveAttachments(gmail, linked.id, providerMessageId, context, preview.attachments || []);
          result.attachmentsSaved += attachmentResult.saved;
          result.attachmentsSkipped += attachmentResult.skipped + attachmentResult.failed;
          result.failed += attachmentResult.failed;
          await this.notifyAdmins(linked.id, context, preview.fromName || preview.fromEmail, preview.subject);
          result.linked += 1;
        } catch (error) {
          result.failed += 1;
        }
      }

      if (result.failed > 0) throw new Error(`${result.failed} Gmail case reply message(s) failed to process`);
      const successAt = new Date();
      await db.update(gmailReplySyncState).set({ checkpointAt: attemptAt, lastSuccessAt: successAt, lastError: null, updatedAt: successAt })
        .where(eq(gmailReplySyncState.id, SYNC_STATE_ID));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.insert(gmailReplySyncState).values({ id: SYNC_STATE_ID, lastAttemptAt: new Date(), lastError: message.slice(0, 1000) })
        .onConflictDoUpdate({ target: gmailReplySyncState.id, set: { lastError: message.slice(0, 1000), updatedAt: new Date() } })
        .catch(() => {});
      throw error;
    } finally {
      if (result.locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [ADVISORY_LOCK_NAME]).catch(() => {});
      lockClient.release();
    }
  }
}

export const gmailCaseReplySyncService = new GmailCaseReplySyncService();
