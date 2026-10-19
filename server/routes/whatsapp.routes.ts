import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { storage } from "../storage";
import { whatsappCaseVerificationService } from "../services/whatsapp-case-verification.service";
import { whatsappConversationService } from "../services/whatsapp-conversation.service";
import { whatsappEnquiryService } from "../services/whatsapp-enquiry.service";
import { whatsappMetaService, WHATSAPP_SIGNATURE_HEADER } from "../services/whatsapp-meta.service";
import { whatsappOutboxService } from "../services/whatsapp-outbox.service";
import { whatsappTemplateService } from "../services/whatsapp-template.service";
import { whatsappWebhookService } from "../services/whatsapp-webhook.service";
import { whatsappWindowService } from "../services/whatsapp-window.service";
import { logAudit } from "../services/audit-log.service";
import { logger } from "../logger";
import { summarizeWhatsappWebhookPayload } from "../services/whatsapp-webhook-summary";

const router = Router();

async function requireSuperadmin(req: any, res: any) {
  if (!req.session.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  if (user.role !== "superadmin") {
    res.status(403).json({ message: "Only superadmins can manage WhatsApp settings" });
    return null;
  }
  return user;
}

router.get("/api/public/whatsapp/webhook", (req, res) => {
  const challenge = whatsappMetaService.verifyChallenge(
    req.query["hub.mode"],
    req.query["hub.verify_token"],
    req.query["hub.challenge"],
  );
  if (!challenge) return res.status(403).send("Forbidden");
  return res.status(200).send(challenge);
});

router.post("/api/public/whatsapp/webhook", async (req, res) => {
  logger.info("Webhook received", {
    hasSignature: Boolean(req.header(WHATSAPP_SIGNATURE_HEADER)),
  }, "whatsapp");
  const signature = req.header(WHATSAPP_SIGNATURE_HEADER);
  if (!whatsappMetaService.verifySignature(req.rawBody, signature || undefined)) {
    logger.warn("Webhook signature rejected", undefined, "whatsapp");
    return res.status(401).json({ message: "Invalid WhatsApp webhook signature" });
  }

  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const payloadSummary = summarizeWhatsappWebhookPayload(payload);
  const result = await whatsappWebhookService.processInboundWebhook(payload);
  const summary = {
    ...payloadSummary,
    duplicateCount: result.processed.filter((item) => item.duplicate).length,
    processedMessageCount: result.processed.filter((item) => !item.duplicate).length,
  };
  await logAudit({
    action: "whatsapp_webhook_received",
    entity: "whatsapp_webhook",
    details: JSON.stringify(summary),
  });
  logger.info("Webhook processed", summary, "whatsapp");
  res.json({ ok: true, ...result, summary });
});

router.get("/api/whatsapp/settings", requireAuth, async (req, res) => {
  const user = await requireSuperadmin(req, res);
  if (!user) return;
  res.json(whatsappMetaService.getSettingsStatus());
});

router.patch("/api/whatsapp/settings", requireAuth, async (req, res) => {
  const user = await requireSuperadmin(req, res);
  if (!user) return;
  await logAudit({
    userId: user.id,
    action: "whatsapp_settings_checked",
    entity: "whatsapp_settings",
    details: JSON.stringify({ note: "Secrets are environment-managed only." }),
  });
  res.json({ message: "WhatsApp secrets are managed through environment variables.", ...whatsappMetaService.getSettingsStatus() });
});

router.get("/api/whatsapp/conversations", requirePermission("whatsapp", "view"), async (req, res) => {
  const filters = {
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    caseId: typeof req.query.caseId === "string" ? req.query.caseId : undefined,
    enquiryId: typeof req.query.enquiryId === "string" ? req.query.enquiryId : undefined,
  };
  res.json(await whatsappConversationService.listConversations(filters));
});

router.get("/api/whatsapp/conversations/:id", requirePermission("whatsapp", "view"), async (req, res) => {
  const detail = await whatsappConversationService.getConversationDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "WhatsApp conversation not found" });
  res.json(detail);
});

router.get("/api/whatsapp/templates", requirePermission("whatsapp", "view"), async (_req, res) => {
  res.json(await whatsappTemplateService.listApproved());
});

router.get("/api/whatsapp/templates/status", requirePermission("whatsapp", "view"), async (_req, res) => {
  res.json(await whatsappTemplateService.getApprovedStatus());
});

router.post("/api/whatsapp/templates/sync", requirePermission("whatsapp", "edit"), async (_req, res) => {
  res.json(await whatsappTemplateService.syncApproved());
});

const manualMessageSchema = z.object({
  body: z.string().trim().max(4096).optional(),
  template: z.object({
    name: z.string().trim().min(1),
    language: z.string().trim().min(1),
    parameters: z.record(z.string()).optional(),
  }).optional(),
});

router.post("/api/whatsapp/conversations/:id/messages", requirePermission("whatsapp", "edit"), async (req: any, res) => {
  const parsed = manualMessageSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Message body is required" });

  const detail = await whatsappConversationService.getConversationDetail(req.params.id);
  if (!detail) return res.status(404).json({ message: "WhatsApp conversation not found" });
  const to = detail.contact?.phoneNumber;
  if (!to) return res.status(400).json({ message: "Conversation has no WhatsApp phone number" });

  if (!parsed.data.body?.trim() && !parsed.data.template) {
    return res.status(400).json({ message: "Message text or approved template is required" });
  }

  if (!whatsappWindowService.isWindowOpen(detail) && !parsed.data.template) {
    return res.status(400).json({ message: "The 24-hour WhatsApp window is closed. Send an approved template first." });
  }

  let result;
  if (parsed.data.template) {
    const template = await whatsappTemplateService.getApprovedTemplate(parsed.data.template.name, parsed.data.template.language);
    if (!template) return res.status(400).json({ message: "Approved WhatsApp template not found" });
    const requiredKeys = (template.parameterDefinitions as Array<{ key?: string }>).map((item) => String(item.key || "")).filter(Boolean);
    if (requiredKeys.some((key) => !parsed.data.template?.parameters?.[key]?.trim())) {
      return res.status(400).json({ message: "All template variables are required" });
    }
    if (template.headerMediaType) return res.status(400).json({ message: "This template requires a case-scoped header attachment" });
    result = await whatsappOutboxService.enqueueParameterizedTemplate(req.params.id, to, { templateName: template.name, languageCode: template.language, parameters: parsed.data.template.parameters || {} }, req.user?.id);
  } else {
    result = await whatsappOutboxService.enqueueText(req.params.id, to, parsed.data.body!.trim(), req.user?.id);
  }

  await logAudit({
    userId: req.user?.id,
    action: parsed.data.template ? "whatsapp_template_send_requested" : "whatsapp_manual_message_send_requested",
    entity: "whatsapp_conversation",
    entityId: req.params.id,
    details: JSON.stringify({ templateName: parsed.data.template?.name || null, language: parsed.data.template?.language || null }),
  });
  res.status(202).json(result);
});

router.patch("/api/whatsapp/conversations/:id/automation", requirePermission("whatsapp", "edit"), async (req: any, res) => {
  const parsed = z.object({
    paused: z.boolean(),
    note: z.string().trim().max(500).optional(),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid automation request" });

  const updated = await whatsappConversationService.setAutomationPaused(req.params.id, parsed.data.paused, req.user, parsed.data.note);
  if (!updated) return res.status(404).json({ message: "WhatsApp conversation not found" });
  res.json(updated);
});

router.post("/api/whatsapp/conversations/:id/templates", requirePermission("whatsapp", "edit"), async (req: any, res) => {
  const parsed = z.object({
    templateName: z.string().trim().min(1).default(process.env.META_WHATSAPP_DEFAULT_TEMPLATE || "bfm_case_update"),
    languageCode: z.string().trim().min(2).default("en_GB"),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid template request" });

  const detail = await whatsappConversationService.getConversationDetail(req.params.id);
  if (!detail?.contact?.phoneNumber) return res.status(404).json({ message: "WhatsApp conversation not found" });
  const result = await whatsappOutboxService.enqueueTemplate(req.params.id, detail.contact.phoneNumber, parsed.data.templateName, parsed.data.languageCode, req.user?.id);
  res.status(202).json(result);
});

router.post("/api/whatsapp/existing-case/start", requirePermission("whatsapp", "edit"), async (req, res) => {
  const parsed = z.object({
    conversationId: z.string().min(1),
    caseRef: z.string().min(1),
    email: z.string().email(),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid existing case verification request" });
  const result = await whatsappCaseVerificationService.startVerification(parsed.data);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { message: result.error });
});

router.post("/api/whatsapp/existing-case/verify-otp", requirePermission("whatsapp", "edit"), async (req, res) => {
  const parsed = z.object({
    conversationId: z.string().min(1),
    code: z.string().min(4).max(12),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid OTP verification request" });
  const result = await whatsappCaseVerificationService.verifyOtp(parsed.data.conversationId, parsed.data.code);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { message: result.error });
});

router.post("/api/whatsapp/enquiries", requirePermission("whatsapp", "edit"), async (req, res) => {
  const parsed = z.object({
    conversationId: z.string().min(1),
    enquiry: z.record(z.unknown()),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid WhatsApp enquiry request" });
  const result = await whatsappEnquiryService.createFromWhatsapp(parsed.data.conversationId, parsed.data.enquiry);
  res.status(result.ok ? 201 : result.status).json(result.ok ? result : { message: result.error });
});

export default router;
