import { createHash } from "node:crypto";

export const MAX_GMAIL_REPLY_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_GMAIL_REPLY_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

const ALLOWED_ATTACHMENT_EXTENSIONS: Record<string, Set<string>> = {
  "application/pdf": new Set(["pdf"]),
  "application/msword": new Set(["doc"]),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": new Set(["docx"]),
  "application/vnd.ms-excel": new Set(["xls"]),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": new Set(["xlsx"]),
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "text/plain": new Set(["txt"]),
};

export function normalizeEmailAddress(value: string | null | undefined): string {
  if (!value) return "";
  const bracketed = value.match(/<([^>]+)>/);
  return (bracketed?.[1] ?? value).trim().toLowerCase();
}

export function buildCaseReplyAddress(baseEmail: string, token: string): string {
  const normalized = normalizeEmailAddress(baseEmail);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) throw new Error("Connected Gmail address is invalid");
  return `${normalized.slice(0, at)}+bfm-${token}@${normalized.slice(at + 1)}`;
}

export function extractCaseReplyToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[A-Z0-9._%+-]+\+bfm-([A-Z0-9._~-]+)@[A-Z0-9.-]+/i);
  return match?.[1] || null;
}

export function redactCaseReplyAddress(value: string): string {
  return value.replace(/\+bfm-[^@,\s>]+@/gi, "+bfm-[redacted]@");
}

export function hashCaseReplyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function canLinkCaseReplySender(
  matchedByEstablishedThread: boolean,
  sender: string | null | undefined,
  originalRecipient: string | null | undefined,
): boolean {
  return matchedByEstablishedThread
    || (!!normalizeEmailAddress(sender) && normalizeEmailAddress(sender) === normalizeEmailAddress(originalRecipient));
}

export function validateReplyAttachment(
  fileName: string,
  mimeType: string,
  size: number,
): { ok: true } | { ok: false; reason: "unsupported_type" | "too_large" } {
  const normalizedMimeType = mimeType.toLowerCase();
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (!ALLOWED_ATTACHMENT_EXTENSIONS[normalizedMimeType]?.has(extension)) {
    return { ok: false, reason: "unsupported_type" };
  }
  if (size > MAX_GMAIL_REPLY_ATTACHMENT_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}

export function hasSafeReplyAttachmentSignature(mimeType: string, buffer: Buffer): boolean {
  const type = mimeType.toLowerCase();
  if (type === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === "application/msword" || type === "application/vnd.ms-excel") {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (type.includes("openxmlformats-officedocument")) {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
      && ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06) || (buffer[2] === 0x07 && buffer[3] === 0x08));
  }
  if (type === "text/plain") {
    if (buffer.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
