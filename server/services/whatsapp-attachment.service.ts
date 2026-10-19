import { db } from "../db";
import { whatsappAttachments } from "@shared/schema";

const ALLOWED_MIME_PREFIXES = ["image/", "application/pdf"];
const ALLOWED_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

class WhatsappAttachmentService {
  validate(mimeType?: string | null, sizeBytes?: number | null) {
    const type = mimeType || "application/octet-stream";
    const typeOk = ALLOWED_MIME_PREFIXES.some((prefix) => type.startsWith(prefix)) || ALLOWED_MIME_TYPES.has(type);
    if (!typeOk) return { ok: false as const, error: "Unsupported WhatsApp attachment type." };
    if (sizeBytes && sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false as const, error: "WhatsApp attachment is too large." };
    return { ok: true as const };
  }

  async recordMetadata(data: {
    messageId: string;
    caseId?: string | null;
    metaMediaId: string;
    fileName?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
  }) {
    const validation = this.validate(data.mimeType, data.sizeBytes);
    const [row] = await db.insert(whatsappAttachments).values({
      messageId: data.messageId,
      caseId: data.caseId || null,
      metaMediaId: data.metaMediaId,
      fileName: data.fileName || null,
      mimeType: data.mimeType || null,
      sizeBytes: data.sizeBytes || null,
      status: validation.ok ? "metadata_only" : "blocked",
    }).returning();
    return row;
  }
}

export const whatsappAttachmentService = new WhatsappAttachmentService();
