import crypto from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../logger";
import { casePrivateNoteAttachments, casePrivateNotes, whatsappOutboundMedia } from "@shared/schema";
import { fileStorageService } from "./file-storage.service";
import { whatsappMetaService } from "./whatsapp-meta.service";
import { whatsappPrivateNoteService } from "./whatsapp-private-note.service";
import { readAndValidateWhatsappMedia, validateWhatsappMediaBuffer, WhatsappMediaValidationError } from "./whatsapp-media-validation";

const MAX_RETRY_COUNT = 6;
const RECOVERABLE_PRIVATE_STATUSES = ["queued", "failed", "downloading", "quarantined", "scanning"];
const RECOVERABLE_OUTBOUND_STATUSES = ["queued", "failed", "quarantined", "scanning"];

function retryAt(attempt: number) { return new Date(Date.now() + Math.min(60, 2 ** attempt) * 60_000); }
function safeFailureCategory(error: unknown, fallback: string) { return error instanceof WhatsappMediaValidationError ? error.code : fallback; }
function safeStoredError(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "Media processing failed"; }
function noteCanOwnAttachment() {
  return sql`exists (
    select 1 from ${casePrivateNotes}
    where ${casePrivateNotes.id} = ${casePrivateNoteAttachments.noteId}
      and ${casePrivateNotes.status} in ('draft', 'completed')
  )`;
}

class WhatsappMediaWorkerService {
  private async processPrivateAttachment(id: string) {
    const [attachment] = await db.select().from(casePrivateNoteAttachments).where(eq(casePrivateNoteAttachments.id, id)).limit(1);
    if (!attachment?.metaMediaId) return;
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
    const [claimed] = await db.update(casePrivateNoteAttachments).set({ status: "downloading", processingLeaseExpiresAt: leaseExpiresAt, updatedAt: new Date() }).where(and(
      eq(casePrivateNoteAttachments.id, id),
      lt(casePrivateNoteAttachments.retryCount, MAX_RETRY_COUNT),
      inArray(casePrivateNoteAttachments.status, RECOVERABLE_PRIVATE_STATUSES),
      isNull(casePrivateNoteAttachments.redactedAt),
      noteCanOwnAttachment(),
      or(isNull(casePrivateNoteAttachments.processingLeaseExpiresAt), lte(casePrivateNoteAttachments.processingLeaseExpiresAt, new Date()))!,
    )).returning();
    if (!claimed) return;
    let storedKey: string | null = null;
    try {
      const downloaded = await whatsappMetaService.downloadMedia(claimed.metaMediaId!);
      const validated = validateWhatsappMediaBuffer(downloaded.buffer);
      const [readyToStore] = await db.update(casePrivateNoteAttachments).set({ status: "quarantined", detectedMimeType: validated.mimeType, sizeBytes: validated.buffer.length, updatedAt: new Date() }).where(and(
        eq(casePrivateNoteAttachments.id, id),
        eq(casePrivateNoteAttachments.status, "downloading"),
        eq(casePrivateNoteAttachments.processingLeaseExpiresAt, leaseExpiresAt),
        isNull(casePrivateNoteAttachments.redactedAt),
        noteCanOwnAttachment(),
      )).returning({ id: casePrivateNoteAttachments.id });
      if (!readyToStore) return;
      const stored = await fileStorageService.savePrivateCaseNoteAttachment({
        fileName: `${id}-${crypto.randomUUID()}-${(claimed.fileName || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_")}`,
        buffer: validated.buffer,
        mimeType: validated.mimeType,
      });
      storedKey = stored.storageKey;
      const [completed] = await db.update(casePrivateNoteAttachments).set({ status: "clean", storageKey: stored.storageKey, lastError: null, processingLeaseExpiresAt: null, updatedAt: new Date() }).where(and(
        eq(casePrivateNoteAttachments.id, id),
        eq(casePrivateNoteAttachments.status, "quarantined"),
        eq(casePrivateNoteAttachments.processingLeaseExpiresAt, leaseExpiresAt),
        isNull(casePrivateNoteAttachments.redactedAt),
        noteCanOwnAttachment(),
      )).returning({ id: casePrivateNoteAttachments.id });
      if (!completed) {
        await fileStorageService.deletePrivateCaseNoteAttachment(stored.storageKey);
        storedKey = null;
      }
    } catch (error) {
      if (storedKey) {
        await fileStorageService.deletePrivateCaseNoteAttachment(storedKey).catch(() => {
          logger.warn("WhatsApp media cleanup failed", { id, mediaKind: "private_note_attachment", failureCategory: "storage_cleanup_failed" }, "whatsapp");
        });
      }
      const validationFailure = error instanceof WhatsappMediaValidationError;
      const retryCount = validationFailure ? claimed.retryCount : claimed.retryCount + 1;
      const nextAttemptAt = validationFailure ? claimed.nextAttemptAt : retryAt(retryCount);
      const [failed] = await db.update(casePrivateNoteAttachments).set({ status: validationFailure ? "blocked" : "failed", retryCount, nextAttemptAt, storageKey: null, processingLeaseExpiresAt: null, lastError: safeStoredError(error), updatedAt: new Date() }).where(and(
        eq(casePrivateNoteAttachments.id, id),
        inArray(casePrivateNoteAttachments.status, ["downloading", "quarantined", "scanning"]),
        eq(casePrivateNoteAttachments.processingLeaseExpiresAt, leaseExpiresAt),
        isNull(casePrivateNoteAttachments.redactedAt),
        noteCanOwnAttachment(),
      )).returning({ id: casePrivateNoteAttachments.id });
      if (failed) logger.warn("WhatsApp media processing failed", { id, mediaKind: "private_note_attachment", failureCategory: safeFailureCategory(error, "download_or_storage_failed"), retryCount, nextAttemptAt: validationFailure ? null : nextAttemptAt.toISOString() }, "whatsapp");
    }
  }

  private async processOutbound(id: string) {
    const [media] = await db.select().from(whatsappOutboundMedia).where(eq(whatsappOutboundMedia.id, id)).limit(1);
    if (!media?.storageKey) return;
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
    const [claimed] = await db.update(whatsappOutboundMedia).set({ status: "quarantined", processingLeaseExpiresAt: leaseExpiresAt, updatedAt: new Date() }).where(and(
      eq(whatsappOutboundMedia.id, id),
      lt(whatsappOutboundMedia.retryCount, MAX_RETRY_COUNT),
      inArray(whatsappOutboundMedia.status, RECOVERABLE_OUTBOUND_STATUSES),
      or(isNull(whatsappOutboundMedia.processingLeaseExpiresAt), lte(whatsappOutboundMedia.processingLeaseExpiresAt, new Date()))!,
    )).returning();
    if (!claimed?.storageKey) return;
    try {
      const opened = claimed.sourceType === "case_document" ? await fileStorageService.openCaseDocumentByStorageKey(claimed.storageKey) : await fileStorageService.openWhatsappOutboundMedia(claimed.storageKey);
      const validated = await readAndValidateWhatsappMedia(opened.body, opened.contentLength);
      const upload = await whatsappMetaService.uploadMedia(validated.buffer, validated.mimeType, claimed.fileName);
      if (!upload.ok) throw new Error(upload.error);
      await db.update(whatsappOutboundMedia).set({ status: "clean", mimeType: validated.mimeType, sizeBytes: validated.buffer.length, metaMediaId: upload.mediaId, lastError: null, processingLeaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(whatsappOutboundMedia.id, id), eq(whatsappOutboundMedia.processingLeaseExpiresAt, leaseExpiresAt)));
    } catch (error) {
      const validationFailure = error instanceof WhatsappMediaValidationError;
      const retryCount = validationFailure ? claimed.retryCount : claimed.retryCount + 1;
      const nextAttemptAt = validationFailure ? claimed.nextAttemptAt : retryAt(retryCount);
      const [failed] = await db.update(whatsappOutboundMedia).set({ status: validationFailure ? "blocked" : "failed", retryCount, nextAttemptAt, processingLeaseExpiresAt: null, lastError: safeStoredError(error), updatedAt: new Date() }).where(and(eq(whatsappOutboundMedia.id, id), eq(whatsappOutboundMedia.processingLeaseExpiresAt, leaseExpiresAt))).returning({ id: whatsappOutboundMedia.id });
      if (failed) logger.warn("WhatsApp media processing failed", { id, mediaKind: "outbound_attachment", failureCategory: safeFailureCategory(error, "read_or_upload_failed"), retryCount, nextAttemptAt: validationFailure ? null : nextAttemptAt.toISOString() }, "whatsapp");
    }
  }

  async processDue(limit = 10) {
    await whatsappPrivateNoteService.cleanupExpiredDrafts(limit);
    const now = new Date();
    const privateRows = await db.select({ id: casePrivateNoteAttachments.id })
      .from(casePrivateNoteAttachments)
      .innerJoin(casePrivateNotes, eq(casePrivateNotes.id, casePrivateNoteAttachments.noteId))
      .where(and(
        inArray(casePrivateNotes.status, ["draft", "completed"]),
        isNull(casePrivateNoteAttachments.redactedAt),
        lt(casePrivateNoteAttachments.retryCount, MAX_RETRY_COUNT),
        inArray(casePrivateNoteAttachments.status, RECOVERABLE_PRIVATE_STATUSES),
        lte(casePrivateNoteAttachments.nextAttemptAt, now),
        or(isNull(casePrivateNoteAttachments.processingLeaseExpiresAt), lte(casePrivateNoteAttachments.processingLeaseExpiresAt, now))!,
      )).limit(limit);
    const remaining = Math.max(0, limit - privateRows.length);
    const outboundRows = remaining ? await db.select({ id: whatsappOutboundMedia.id }).from(whatsappOutboundMedia).where(and(lt(whatsappOutboundMedia.retryCount, MAX_RETRY_COUNT), inArray(whatsappOutboundMedia.status, RECOVERABLE_OUTBOUND_STATUSES), lte(whatsappOutboundMedia.nextAttemptAt, now), or(isNull(whatsappOutboundMedia.processingLeaseExpiresAt), lte(whatsappOutboundMedia.processingLeaseExpiresAt, now))!)).limit(remaining) : [];
    for (const row of privateRows) await this.processPrivateAttachment(row.id);
    for (const row of outboundRows) await this.processOutbound(row.id);
    return { processed: privateRows.length + outboundRows.length };
  }
}

export const whatsappMediaWorkerService = new WhatsappMediaWorkerService();
