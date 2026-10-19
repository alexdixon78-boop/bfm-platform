import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/permissions";
import { caseWhatsappService } from "../services/case-whatsapp.service";
import { whatsappConversationService } from "../services/whatsapp-conversation.service";
import { whatsappTemplateService } from "../services/whatsapp-template.service";

const router = Router();

const requireCaseWhatsappWorkspace = [
  requirePermission("cases", "view"),
  requirePermission("whatsapp", "edit"),
  (req: any, res: any, next: any) => ["superadmin", "subadmin"].includes(req.user?.role) ? next() : res.status(403).json({ message: "Case WhatsApp is restricted to administrators" }),
];

function handleError(res: any, error: unknown) {
  const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
  res.status(status).json({ message: status === 500 ? "Unable to process WhatsApp request" : (error as Error).message });
}

router.get("/api/cases/:caseId/whatsapp/recipients", ...requireCaseWhatsappWorkspace, async (req, res) => {
  try { res.json(await caseWhatsappService.listRecipients(req.params.caseId)); } catch (error) { handleError(res, error); }
});

router.get("/api/cases/:caseId/whatsapp/messages", ...requireCaseWhatsappWorkspace, async (req, res) => {
  const partyId = typeof req.query.partyId === "string" ? req.query.partyId : "";
  if (!partyId) return res.status(400).json({ message: "partyId is required" });
  try { res.json(await caseWhatsappService.listMessages(req.params.caseId, partyId)); } catch (error) { handleError(res, error); }
});

router.post("/api/cases/:caseId/whatsapp/preferences/:partyId", ...requireCaseWhatsappWorkspace, async (req: any, res) => {
  const parsed = z.object({ status: z.enum(["opted_in", "opted_out"]), source: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "A valid preference and source are required" });
  try { res.json(await caseWhatsappService.recordPreference(req.params.caseId, req.params.partyId, parsed.data.status, parsed.data.source, req.user)); } catch (error) { handleError(res, error); }
});

router.post("/api/cases/:caseId/whatsapp/uploads", ...requireCaseWhatsappWorkspace, async (req: any, res) => {
  const parsed = z.object({ partyId: z.string().min(1), fileName: z.string().max(255).optional(), fileData: z.string().optional(), mimeType: z.string().optional(), caseDocumentId: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid upload" });
  try { res.status(202).json(await caseWhatsappService.createUpload(req.params.caseId, parsed.data.partyId, parsed.data, req.user)); } catch (error) { handleError(res, error); }
});

router.get("/api/cases/:caseId/whatsapp/uploads", ...requireCaseWhatsappWorkspace, async (req, res) => {
  const partyId = typeof req.query.partyId === "string" ? req.query.partyId : "";
  const ids = typeof req.query.ids === "string" ? req.query.ids.split(",").filter(Boolean).slice(0, 5) : [];
  if (!partyId) return res.status(400).json({ message: "partyId is required" });
  try { res.json(await caseWhatsappService.listUploads(req.params.caseId, partyId, ids)); } catch (error) { handleError(res, error); }
});

router.post("/api/cases/:caseId/whatsapp/messages", ...requireCaseWhatsappWorkspace, async (req: any, res) => {
  const parsed = z.object({
    partyId: z.string().min(1), body: z.string().max(4096).optional(), mediaIds: z.array(z.string()).max(5).optional(),
    template: z.object({ name: z.string().min(1), language: z.string().min(1), parameters: z.record(z.string()).optional(), headerMediaId: z.string().optional() }).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid WhatsApp message" });
  try { res.status(202).json(await caseWhatsappService.send(req.params.caseId, parsed.data, req.user)); } catch (error) { handleError(res, error); }
});

router.post("/api/cases/:caseId/whatsapp/miam-booking-template", requirePermission("cases", "edit"), requirePermission("whatsapp", "edit"), async (req: any, res) => {
  if (!["superadmin", "subadmin"].includes(req.user?.role)) return res.status(403).json({ message: "Case WhatsApp is restricted to administrators" });
  const parsed = z.object({ partyId: z.string().min(1), previewOnly: z.boolean().optional() }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "partyId is required" });
  try {
    res.status(parsed.data.previewOnly ? 200 : 202).json(await caseWhatsappService.sendMiamBookingTemplate(req.params.caseId, parsed.data.partyId, req.user, { previewOnly: parsed.data.previewOnly }));
  } catch (error) { handleError(res, error); }
});

router.post("/api/whatsapp/messages/:messageId/assign-case", ...requireCaseWhatsappWorkspace, async (req: any, res) => {
  const parsed = z.object({ caseId: z.string().min(1), partyId: z.string().min(1), clientId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Case, party, and client are required" });
  try {
    const recipients = await caseWhatsappService.listRecipients(parsed.data.caseId);
    if (!recipients.some((item) => item.partyId === parsed.data.partyId && item.clientId === parsed.data.clientId)) return res.status(400).json({ message: "Party does not belong to this case" });
    const message = await whatsappConversationService.assignMessageCase(req.params.messageId, parsed.data, req.user.id);
    if (!message) return res.status(404).json({ message: "WhatsApp message not found" });
    res.json(message);
  } catch (error) { handleError(res, error); }
});

router.get("/api/whatsapp/templates", ...requireCaseWhatsappWorkspace, async (_req, res) => {
  try { res.json(await whatsappTemplateService.listApproved()); } catch (error) { handleError(res, error); }
});

router.post("/api/whatsapp/templates/sync", ...requireCaseWhatsappWorkspace, async (_req, res) => {
  try { res.json(await whatsappTemplateService.syncApproved()); } catch (error) { handleError(res, error); }
});

export default router;
