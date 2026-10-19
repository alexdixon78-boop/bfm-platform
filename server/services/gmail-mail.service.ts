import { google, gmail_v1 } from "googleapis";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { and, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "../db";
import {
  bfmCalendarConnection,
  gmailMailInlineAssets,
  gmailMessages,
  type GmailMailInlineAsset,
  type GmailMessage,
  type InsertGmailMailInlineAsset,
  type InsertGmailMessage,
} from "@shared/schema";
import { GMAIL_READONLY_SCOPE, hasGmailReadonlyScope } from "./google-calendar.service";
import { caseCommunicationLogService } from "./case-communication-log.service";
import { redactCaseReplyAddress } from "./gmail-case-reply-utils";
import {
  MAX_GMAIL_REPLY_ATTACHMENT_BYTES,
  MAX_GMAIL_REPLY_ATTACHMENTS_TOTAL_BYTES,
} from "./gmail-case-reply-utils";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

type MailPreviewMode = "recent" | "search";
export type MailStatusFilter = "all" | "unconverted" | "needs_action" | "converted" | "archived" | "deleted";
export type MailWorkflowAction = "archive" | "restore" | "delete" | "needs_action" | "clear_needs_action";

export type GmailPreviewMessage = {
  gmailMessageId: string;
  gmailThreadId: string | null;
  fromName: string | null;
  fromEmail: string;
  toEmails: string | null;
  ccEmails: string | null;
  subject: string | null;
  receivedAt: Date | null;
  snippet: string | null;
  textBody: string | null;
  sanitizedHtmlBody: string | null;
  inlineImages?: GmailInlineImage[];
  attachments?: GmailMessageAttachment[];
  alreadyImported?: boolean;
  importedMailId?: string | null;
  importedStatus?: string | null;
};

export type GmailInlineImage = {
  contentId: string;
  attachmentId: string | null;
  mimeType: string;
  filename: string | null;
  bodyData: string | null;
  size: number | null;
};

export type GmailMessageAttachment = {
  attachmentId: string | null;
  bodyData: string | null;
  mimeType: string;
  filename: string;
  size: number;
};

export type GmailMessageDetailResult = {
  message: GmailMessage;
  bodyRefreshWarning?: string;
};

function getBfmRedirectUri(): string {
  if (!GOOGLE_REDIRECT_URI) throw new Error("GOOGLE_REDIRECT_URI not configured");
  return `${GOOGLE_REDIRECT_URI.replace(/\/+$/, "")}/bfm`;
}

function createBfmOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getBfmRedirectUri(),
  );
}

function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64UrlToBase64(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
}

function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sanitizerWindow = new JSDOM("").window;
const htmlPurifier = createDOMPurify(sanitizerWindow);

export function sanitizeHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const sanitized = htmlPurifier.sanitize(value, {
    ALLOWED_TAGS: ["a", "p", "br", "div", "span", "strong", "b", "em", "i", "u", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "hr", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "img"],
    ALLOWED_ATTR: ["href", "title", "src", "alt", "width", "height", "colspan", "rowspan"],
  });
  const document = new JSDOM(`<body>${sanitized}</body>`).window.document;
  document.querySelectorAll("img").forEach((image) => {
    const src = (image.getAttribute("src") || "").trim().toLowerCase();
    if (!src.startsWith("cid:") && !src.startsWith("/api/mail/messages/")) image.removeAttribute("src");
  });
  document.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  return document.body.innerHTML.trim() || null;
}

function getHeader(message: gmail_v1.Schema$Message, name: string): string | null {
  const header = message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

function getPartHeader(part: gmail_v1.Schema$MessagePart, name: string): string | null {
  const header = part.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

function normalizeContentId(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^</, "").replace(/>$/, "");
  return normalized || null;
}

function parseAddress(value: string | null): { name: string | null; email: string } {
  if (!value) return { name: null, email: "" };
  const match = value.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>/);
  if (!match) return { name: null, email: value.trim() };
  const name = match[1]?.trim() || null;
  return { name, email: match[2].trim() };
}

function extractInlineImage(part: gmail_v1.Schema$MessagePart): GmailInlineImage | null {
  const mimeType = (part.mimeType || "").toLowerCase();
  const contentId = normalizeContentId(getPartHeader(part, "Content-ID"));
  if (!contentId || !mimeType.startsWith("image/")) return null;
  return {
    contentId,
    attachmentId: part.body?.attachmentId ?? null,
    mimeType: part.mimeType || "application/octet-stream",
    filename: part.filename || null,
    bodyData: part.body?.data ? base64UrlToBase64(part.body.data) : null,
    size: part.body?.size ?? null,
  };
}

function collectBodyParts(part: gmail_v1.Schema$MessagePart | undefined): { text: string[]; html: string[]; inlineImages: GmailInlineImage[]; attachments: GmailMessageAttachment[] } {
  const result = { text: [] as string[], html: [] as string[], inlineImages: [] as GmailInlineImage[], attachments: [] as GmailMessageAttachment[] };
  if (!part) return result;

  const mimeType = (part.mimeType || "").toLowerCase();
  const isAttachment = !!part.filename || !!part.body?.attachmentId;
  const inlineImage = extractInlineImage(part);
  if (inlineImage) result.inlineImages.push(inlineImage);
  if (!inlineImage && part.filename && (part.body?.attachmentId || part.body?.data)) {
    result.attachments.push({
      attachmentId: part.body.attachmentId || null,
      bodyData: part.body.data || null,
      mimeType: part.mimeType || "application/octet-stream",
      filename: part.filename,
      size: part.body.size || 0,
    });
  }
  const body = decodeBase64Url(part.body?.data);
  if (body && !isAttachment && mimeType.startsWith("text/plain")) result.text.push(body);
  if (body && !isAttachment && mimeType.startsWith("text/html")) result.html.push(body);

  for (const child of part.parts ?? []) {
    const childResult = collectBodyParts(child);
    result.text.push(...childResult.text);
    result.html.push(...childResult.html);
    result.inlineImages.push(...childResult.inlineImages);
    result.attachments.push(...childResult.attachments);
  }
  return result;
}

export function rewriteCidImageSources(html: string | null | undefined, importedMailId: string, assets: Pick<GmailMailInlineAsset, "id" | "contentId">[]): string | null {
  if (!html) return null;
  const byContentId = new Map(assets.map((asset) => [normalizeContentId(asset.contentId)?.toLowerCase(), asset]));
  return html.replace(/\ssrc=(["'])cid:([^"']+)\1/gi, (match, quote: string, contentId: string) => {
    const asset = byContentId.get((normalizeContentId(contentId) || contentId).toLowerCase());
    if (!asset) return match;
    return ` src=${quote}/api/mail/messages/${importedMailId}/inline-images/${asset.id}${quote}`;
  });
}

export function parseGmailMessageForMailInbox(message: gmail_v1.Schema$Message): GmailPreviewMessage {
  const from = parseAddress(getHeader(message, "From"));
  const bodyParts = collectBodyParts(message.payload);
  const htmlParts = bodyParts.html;
  const textParts = bodyParts.text;
  const rootBody = decodeBase64Url(message.payload?.body?.data);
  const rootMimeType = (message.payload?.mimeType || "").toLowerCase();
  if (rootBody && textParts.length === 0 && htmlParts.length === 0) {
    if (rootMimeType.startsWith("text/html")) htmlParts.push(rootBody);
    else textParts.push(rootBody);
  }
  const htmlBody = htmlParts.join("\n\n").trim();
  const textBody = textParts.join("\n\n").trim() || stripHtml(htmlBody) || (message.snippet ?? "").trim();
  const dateHeader = getHeader(message, "Date");
  const receivedAt = dateHeader ? new Date(dateHeader) : null;

  return {
    gmailMessageId: message.id || "",
    gmailThreadId: message.threadId || null,
    fromName: from.name,
    fromEmail: from.email,
    toEmails: getHeader(message, "To"),
    ccEmails: getHeader(message, "Cc"),
    subject: getHeader(message, "Subject"),
    receivedAt: receivedAt && !Number.isNaN(receivedAt.getTime()) ? receivedAt : null,
    snippet: message.snippet ?? null,
    textBody: textBody || null,
    sanitizedHtmlBody: sanitizeHtml(htmlBody),
    inlineImages: bodyParts.inlineImages,
    attachments: bodyParts.attachments,
  };
}

export class GmailMailService {
  async getAuthenticatedGmail() {
    const [conn] = await db
      .select()
      .from(bfmCalendarConnection)
      .where(eq(bfmCalendarConnection.id, "bfm"));
    if (!conn?.googleRefreshToken) {
      throw new Error("BFM Google account is not connected");
    }
    if (!hasGmailReadonlyScope(conn.googleScopeGranted)) {
      throw new Error(`BFM Google account must be reconnected with ${GMAIL_READONLY_SCOPE}`);
    }

    const auth = createBfmOAuthClient();
    auth.setCredentials({
      access_token: conn.googleAccessToken ?? undefined,
      refresh_token: conn.googleRefreshToken,
      expiry_date: conn.googleTokenExpiresAt ? new Date(conn.googleTokenExpiresAt).getTime() : undefined,
    });
    auth.on("tokens", async (tokens) => {
      const update: Record<string, unknown> = { updatedAt: new Date() };
      if (tokens.access_token) update.googleAccessToken = tokens.access_token;
      if (tokens.refresh_token) update.googleRefreshToken = tokens.refresh_token;
      if (tokens.expiry_date) update.googleTokenExpiresAt = new Date(tokens.expiry_date);
      await db.update(bfmCalendarConnection).set(update).where(eq(bfmCalendarConnection.id, "bfm"));
    });

    return google.gmail({ version: "v1", auth });
  }

  async previewRecent(limit: number): Promise<GmailPreviewMessage[]> {
    return this.preview({ mode: "recent", limit });
  }

  async previewSearch(searchQuery: string, limit: number): Promise<GmailPreviewMessage[]> {
    return this.preview({ mode: "search", searchQuery, limit });
  }

  private async previewWithImportState(messages: GmailPreviewMessage[]): Promise<GmailPreviewMessage[]> {
    const ids = messages.map((message) => message.gmailMessageId).filter(Boolean);
    if (ids.length === 0) return messages;
    const existing = await db
      .select({
        id: gmailMessages.id,
        gmailMessageId: gmailMessages.gmailMessageId,
        status: gmailMessages.status,
      })
      .from(gmailMessages)
      .where(inArray(gmailMessages.gmailMessageId, ids));
    const byGmailId = new Map(existing.map((row) => [row.gmailMessageId, row]));
    return messages.map((message) => {
      const row = byGmailId.get(message.gmailMessageId);
      return {
        ...message,
        alreadyImported: !!row,
        importedMailId: row?.id ?? null,
        importedStatus: row?.status ?? null,
      };
    });
  }

  private async preview(input: { mode: MailPreviewMode; searchQuery?: string; limit: number }): Promise<GmailPreviewMessage[]> {
    const gmail = await this.getAuthenticatedGmail();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(input.limit) || 10));
    const q = input.mode === "search" && input.searchQuery
      ? input.searchQuery.trim()
      : undefined;
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: safeLimit,
      labelIds: ["INBOX"],
      includeSpamTrash: false,
      q,
    });

    const ids = list.data.messages?.map((m) => m.id).filter((id): id is string => !!id) ?? [];
    const details = await Promise.all(ids.map((id) => this.fetchGmailMessage(gmail, id)));
    return this.previewWithImportState(details);
  }

  private async fetchGmailMessage(gmail: gmail_v1.Gmail, gmailMessageId: string): Promise<GmailPreviewMessage> {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "full",
    });
    return parseGmailMessageForMailInbox(message.data);
  }

  private needsBodyRepair(row: Pick<GmailMessage, "textBody" | "sanitizedHtmlBody">): boolean {
    return !row.textBody?.trim() && !row.sanitizedHtmlBody?.trim();
  }

  private needsInlineImageRepair(row: Pick<GmailMessage, "sanitizedHtmlBody">): boolean {
    return /\ssrc=["']cid:/i.test(row.sanitizedHtmlBody || "");
  }

  private async fetchInlineImageData(gmail: gmail_v1.Gmail, gmailMessageId: string, image: GmailInlineImage): Promise<string | null> {
    if (image.bodyData) return image.bodyData;
    if (!image.attachmentId) return null;
    const attachment = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId: gmailMessageId,
      id: image.attachmentId,
    });
    return base64UrlToBase64(attachment.data.data);
  }

  private async storeInlineImages(importedMailId: string, parsed: GmailPreviewMessage, gmail: gmail_v1.Gmail): Promise<GmailMailInlineAsset[]> {
    const assets: GmailMailInlineAsset[] = [];
    let totalBytes = 0;
    for (const image of parsed.inlineImages ?? []) {
      if (!["image/png", "image/jpeg"].includes(image.mimeType.toLowerCase())) continue;
      if ((image.size || 0) > MAX_GMAIL_REPLY_ATTACHMENT_BYTES) continue;
      const data = await this.fetchInlineImageData(gmail, parsed.gmailMessageId, image);
      if (!data) continue;
      const actualSize = Buffer.from(data, "base64").byteLength;
      if (actualSize > MAX_GMAIL_REPLY_ATTACHMENT_BYTES || totalBytes + actualSize > MAX_GMAIL_REPLY_ATTACHMENTS_TOTAL_BYTES) continue;
      totalBytes += actualSize;
      const values: InsertGmailMailInlineAsset = {
        importedMailId,
        gmailMessageId: parsed.gmailMessageId,
        contentId: image.contentId,
        attachmentId: image.attachmentId,
        mimeType: image.mimeType,
        filename: image.filename,
        data,
        size: actualSize,
      };
      const [asset] = await db
        .insert(gmailMailInlineAssets)
        .values(values)
        .onConflictDoUpdate({
          target: [gmailMailInlineAssets.importedMailId, gmailMailInlineAssets.contentId],
          set: {
            gmailMessageId: values.gmailMessageId,
            attachmentId: values.attachmentId,
            mimeType: values.mimeType,
            filename: values.filename,
            data: values.data,
            size: values.size,
          },
        })
        .returning();
      if (asset) assets.push(asset);
    }
    return assets;
  }

  private async persistParsedMessageContent(row: GmailMessage, gmail: gmail_v1.Gmail, parsed: GmailPreviewMessage): Promise<GmailMessage> {
    const inlineAssets = await this.storeInlineImages(row.id, parsed, gmail);
    const sanitizedHtmlBody = rewriteCidImageSources(parsed.sanitizedHtmlBody, row.id, inlineAssets);
    const [updated] = await db
      .update(gmailMessages)
      .set({
        textBody: parsed.textBody,
        sanitizedHtmlBody,
        snippet: parsed.snippet ?? row.snippet,
        updatedAt: new Date(),
      })
      .where(eq(gmailMessages.id, row.id))
      .returning();
    return updated ?? row;
  }

  private async repairImportedBody(row: GmailMessage): Promise<GmailMessage> {
    if (!row.gmailMessageId) return row;
    const gmail = await this.getAuthenticatedGmail();
    const repaired = await this.fetchGmailMessage(gmail, row.gmailMessageId);
    return this.persistParsedMessageContent(row, gmail, repaired);
  }

  async importMessages(
    gmailMessageIds: string[],
    importedBy: string,
    options: { redactCaseReplyTokens?: boolean } = { redactCaseReplyTokens: true },
  ): Promise<GmailMessage[]> {
    const uniqueIds = Array.from(new Set(gmailMessageIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const gmail = await this.getAuthenticatedGmail();
    const previews = await Promise.all(uniqueIds.map((id) => this.fetchGmailMessage(gmail, id)));
    const rows: GmailMessage[] = [];
    for (const preview of previews) {
      if (!preview.gmailMessageId || !preview.fromEmail) continue;
      const values: InsertGmailMessage = {
        gmailMessageId: preview.gmailMessageId,
        gmailThreadId: preview.gmailThreadId,
        fromName: preview.fromName,
        fromEmail: preview.fromEmail,
        toEmails: options.redactCaseReplyTokens && preview.toEmails
          ? redactCaseReplyAddress(preview.toEmails)
          : preview.toEmails,
        ccEmails: options.redactCaseReplyTokens && preview.ccEmails
          ? redactCaseReplyAddress(preview.ccEmails)
          : preview.ccEmails,
        subject: preview.subject,
        receivedAt: preview.receivedAt,
        snippet: preview.snippet,
        textBody: preview.textBody,
        sanitizedHtmlBody: preview.sanitizedHtmlBody,
        status: "imported",
        importedBy,
      };
      const [row] = await db
        .insert(gmailMessages)
        .values(values)
        .onConflictDoUpdate({
          target: gmailMessages.gmailMessageId,
          set: {
            gmailThreadId: values.gmailThreadId,
            fromName: values.fromName,
            fromEmail: values.fromEmail,
            toEmails: values.toEmails,
            ccEmails: values.ccEmails,
            subject: values.subject,
            receivedAt: values.receivedAt,
            snippet: values.snippet,
            textBody: values.textBody,
            sanitizedHtmlBody: values.sanitizedHtmlBody,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (row) rows.push(await this.persistParsedMessageContent(row, gmail, preview));
    }
    return rows;
  }

  async listImported(status: MailStatusFilter = "all", search = ""): Promise<GmailMessage[]> {
    const statusCondition = status === "all"
      ? ne(gmailMessages.status, "deleted")
      : status === "converted"
        ? or(eq(gmailMessages.status, "converted"), eq(gmailMessages.status, "case_linked"))
        : status === "archived"
          ? eq(gmailMessages.status, "archived")
          : status === "needs_action"
            ? eq(gmailMessages.status, "needs_action")
            : status === "deleted"
              ? eq(gmailMessages.status, "deleted")
              : and(
                ne(gmailMessages.status, "converted"),
                ne(gmailMessages.status, "case_linked"),
                ne(gmailMessages.status, "archived"),
                ne(gmailMessages.status, "deleted"),
              );
    const trimmedSearch = search.trim();
    const searchCondition = trimmedSearch
      ? or(
        ilike(gmailMessages.fromEmail, `%${trimmedSearch}%`),
        ilike(gmailMessages.fromName, `%${trimmedSearch}%`),
        ilike(gmailMessages.subject, `%${trimmedSearch}%`),
        ilike(gmailMessages.snippet, `%${trimmedSearch}%`),
        ilike(gmailMessages.textBody, `%${trimmedSearch}%`),
      )
      : undefined;
    const conditions = searchCondition ? and(statusCondition, searchCondition) : statusCondition;
    const query = db.select().from(gmailMessages);
    return query.where(conditions).orderBy(desc(gmailMessages.receivedAt), desc(gmailMessages.importedAt));
  }

  async getImported(id: string): Promise<GmailMessage | null> {
    const [row] = await db.select().from(gmailMessages).where(eq(gmailMessages.id, id));
    return row ?? null;
  }

  async getImportedWithBodyRepair(id: string): Promise<GmailMessageDetailResult | null> {
    const row = await this.getImported(id);
    if (!row) return null;
    if (!this.needsBodyRepair(row) && !this.needsInlineImageRepair(row)) return { message: row };
    try {
      return { message: await this.repairImportedBody(row) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not refresh Gmail body";
      return { message: row, bodyRefreshWarning: message };
    }
  }

  async getInlineImageAsset(importedMailId: string, assetId: string): Promise<GmailMailInlineAsset | null> {
    const [asset] = await db
      .select()
      .from(gmailMailInlineAssets)
      .where(and(
        eq(gmailMailInlineAssets.importedMailId, importedMailId),
        eq(gmailMailInlineAssets.id, assetId),
      ));
    return asset ?? null;
  }

  async markConverted(id: string, input: { enquiryId: string; caseId?: string | null; userId: string }): Promise<GmailMessage | null> {
    const [row] = await db
      .update(gmailMessages)
      .set({
        status: "converted",
        linkedEnquiryId: input.enquiryId,
        linkedCaseId: input.caseId ?? null,
        convertedBy: input.userId,
        convertedAt: new Date(),
        archivedAt: null,
        deletedAt: null,
        needsActionAt: null,
        lastActionBy: input.userId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(gmailMessages.id, id),
        ne(gmailMessages.status, "case_linked"),
        isNull(gmailMessages.linkedCaseEmailMessageId),
      ))
      .returning();
    if (row?.linkedCaseId) {
      await caseCommunicationLogService.recordGmailMessage(row);
    }
    return row ?? null;
  }

  async markWorkflowStatus(id: string, action: MailWorkflowAction, userId: string): Promise<GmailMessage | null> {
    const current = await this.getImported(id);
    if (!current) return null;
    const now = new Date();
    const base = { lastActionBy: userId, updatedAt: now };
    const restoreStatus = current.linkedEnquiryId ? "converted" : current.linkedCaseEmailMessageId ? "case_linked" : "imported";
    const updates =
      action === "archive" ? { ...base, status: "archived", archivedAt: now, deletedAt: null } :
      action === "restore" ? { ...base, status: restoreStatus, archivedAt: null, deletedAt: null } :
      action === "delete" ? { ...base, status: "deleted", deletedAt: now } :
      action === "needs_action" ? { ...base, status: "needs_action", needsActionAt: now, archivedAt: null, deletedAt: null } :
      { ...base, status: restoreStatus, needsActionAt: null };
    const [row] = await db
      .update(gmailMessages)
      .set(updates)
      .where(eq(gmailMessages.id, id))
      .returning();
    return row ?? null;
  }

  async bulkWorkflowAction(ids: string[], action: MailWorkflowAction, userId: string): Promise<{ messages: GmailMessage[]; failedIds: string[] }> {
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    const messages: GmailMessage[] = [];
    const failedIds: string[] = [];
    for (const id of uniqueIds) {
      const row = await this.markWorkflowStatus(id, action, userId);
      if (row) messages.push(row);
      else failedIds.push(id);
    }
    return { messages, failedIds };
  }
}

export const gmailMailService = new GmailMailService();
