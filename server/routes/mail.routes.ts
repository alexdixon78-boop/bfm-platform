import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { gmailMailService, type MailStatusFilter, type MailWorkflowAction } from "../services/gmail-mail.service";
import { logAudit } from "../services/audit-log.service";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";

const router = Router();

async function requireMailAdmin(req: any, res: any) {
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    res.status(403).json({ message: "Only admins can access Mail Inbox" });
    return null;
  }
  return user;
}

const recentLimitSchema = z.number().int().min(1).max(50).optional();
const previewSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("recent"),
    recentLimit: recentLimitSchema,
  }),
  z.object({
    mode: z.literal("search"),
    recentLimit: recentLimitSchema,
    searchQuery: z.string().trim().min(1),
  }),
]);

const mailStatusFilters = ["all", "unconverted", "needs_action", "converted", "archived", "deleted"] as const;
const workflowActionSchema = z.enum(["archive", "restore", "delete", "needs_action", "clear_needs_action"]);

function normaliseStatus(value: unknown): MailStatusFilter {
  return mailStatusFilters.includes(value as MailStatusFilter)
    ? value as MailStatusFilter
    : "unconverted";
}

async function auditMailWorkflow(userId: string, action: MailWorkflowAction, ids: string[], extra?: Record<string, unknown>) {
  await logAudit({
    userId,
    action: `gmail.${action}`,
    entity: "gmail_message",
    details: JSON.stringify({ ids, ...extra }),
  });
}

router.post("/api/mail/gmail/preview", requireAuth, async (req, res) => {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const parsed = previewSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid preview request", errors: parsed.error.flatten().fieldErrors });
  }

  try {
    const limit = parsed.data.recentLimit ?? 10;
    const messages = parsed.data.mode === "search"
      ? await gmailMailService.previewSearch(parsed.data.searchQuery, limit)
      : await gmailMailService.previewRecent(limit);
    return res.json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not preview Gmail messages";
    return res.status(400).json({ message });
  }
});

router.post("/api/mail/gmail/import", requireAuth, async (req, res) => {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const parsed = z.object({
    gmailMessageIds: z.array(z.string().min(1)).min(1),
  }).safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Select at least one Gmail message to import" });
  }

  try {
    const messages = await gmailMailService.importMessages(parsed.data.gmailMessageIds, user.id);
    await logAudit({
      userId: user.id,
      action: "gmail.import",
      entity: "gmail_message",
      details: JSON.stringify({ count: messages.length, gmailMessageIds: parsed.data.gmailMessageIds }),
    });
    return res.status(201).json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not import Gmail messages";
    return res.status(400).json({ message });
  }
});

router.get("/api/mail/messages", requireAuth, async (req, res) => {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const status = normaliseStatus(req.query.status || "all");
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const messages = await gmailMailService.listImported(status, search);
  return res.json({ messages });
});

router.get("/api/mail/messages/:id/inline-images/:assetId", requireAuth, async (req, res) => {
  const user = await storage.getUser(req.session.userId!);
  if (!user) return res.status(401).json({ message: "Not authenticated" });
  const message = await gmailMailService.getImported(req.params.id);
  if (!message) return res.status(404).json({ message: "Mail message not found" });
  const isAdmin = user.role === "superadmin" || user.role === "subadmin";
  const hasCaseAccess = !!message.linkedCaseEmailMessageId && !!message.linkedCaseId
    && hasFullOperationalCaseAccess(await classifyCaseAccess(message.linkedCaseId, user));
  if (!isAdmin && !hasCaseAccess) return res.status(403).json({ message: "Access denied" });
  const asset = await gmailMailService.getInlineImageAsset(req.params.id, req.params.assetId);
  if (!asset) return res.status(404).json({ message: "Inline image not found" });
  if (!asset.mimeType.startsWith("image/")) return res.status(415).json({ message: "Unsupported inline image type" });
  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  return res.send(Buffer.from(asset.data, "base64"));
});

router.get("/api/mail/messages/:id", requireAuth, async (req, res) => {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const result = await gmailMailService.getImportedWithBodyRepair(req.params.id);
  if (!result) return res.status(404).json({ message: "Mail message not found" });
  return res.json({
    message: result.message,
    bodyRefreshWarning: result.bodyRefreshWarning,
  });
});

router.post("/api/mail/messages/:id/convert", requireAuth, async (req, res) => {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const parsed = z.object({
    enquiryId: z.string().min(1),
    caseId: z.string().optional().nullable(),
  }).safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "enquiryId is required" });
  }
  const existing = await gmailMailService.getImported(req.params.id);
  if (!existing) return res.status(404).json({ message: "Mail message not found" });
  if (existing.status === "case_linked" || existing.linkedCaseEmailMessageId) {
    return res.status(409).json({ message: "Case-linked replies cannot be converted to enquiries" });
  }
  const message = await gmailMailService.markConverted(req.params.id, {
    enquiryId: parsed.data.enquiryId,
    caseId: parsed.data.caseId ?? null,
    userId: user.id,
  });
  if (!message) {
    const current = await gmailMailService.getImported(req.params.id);
    if (current?.status === "case_linked" || current?.linkedCaseEmailMessageId) {
      return res.status(409).json({ message: "Case-linked replies cannot be converted to enquiries" });
    }
    return res.status(404).json({ message: "Mail message not found" });
  }
  await logAudit({
    userId: user.id,
    action: "gmail.convert_to_enquiry",
    entity: "gmail_message",
    entityId: message.id,
    entityRef: message.subject || message.gmailMessageId,
    details: JSON.stringify({ enquiryId: parsed.data.enquiryId, caseId: parsed.data.caseId ?? null }),
  });
  return res.json({ message });
});

async function handleWorkflowAction(req: any, res: any, action: MailWorkflowAction) {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const message = await gmailMailService.markWorkflowStatus(req.params.id, action, user.id);
  if (!message) return res.status(404).json({ message: "Mail message not found" });
  await auditMailWorkflow(user.id, action, [req.params.id]);
  return res.json({ message });
}

router.post("/api/mail/messages/:id/archive", requireAuth, async (req, res) => {
  return handleWorkflowAction(req, res, "archive");
});

router.post("/api/mail/messages/:id/restore", requireAuth, async (req, res) => {
  return handleWorkflowAction(req, res, "restore");
});

router.post("/api/mail/messages/:id/delete", requireAuth, async (req, res) => {
  return handleWorkflowAction(req, res, "delete");
});

router.post("/api/mail/messages/:id/needs-action", requireAuth, async (req, res) => {
  return handleWorkflowAction(req, res, "needs_action");
});

router.post("/api/mail/messages/:id/clear-needs-action", requireAuth, async (req, res) => {
  return handleWorkflowAction(req, res, "clear_needs_action");
});

router.post("/api/mail/messages/bulk", requireAuth, async (req, res) => {
  const user = await requireMailAdmin(req, res);
  if (!user) return;
  const parsed = z.object({
    action: workflowActionSchema,
    ids: z.array(z.string().min(1)).min(1),
  }).safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Select at least one mail message and action", errors: parsed.error.flatten().fieldErrors });
  }
  const result = await gmailMailService.bulkWorkflowAction(parsed.data.ids, parsed.data.action, user.id);
  await auditMailWorkflow(user.id, parsed.data.action, parsed.data.ids, { failedIds: result.failedIds });
  return res.json(result);
});

export default router;
