import { Router } from "express";
import { z } from "zod";
import {
  clarificationReplySchema,
  complaintDeadlineExtensionSchema,
  complaintEscalationSchema,
  complaintNoteSchema,
  complaintRedactionSchema,
  complaintStatusActionSchema,
  complaintSubmissionSchema,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
} from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { caseComplaintService, ComplaintServiceError } from "../services/case-complaint.service";
import { permissionService } from "../services/permission.service";
import { canViewSection } from "@shared/permissions";

const router = Router();
const idParams = z.object({ id: z.string().uuid() }).strict();
const listQuery = z.object({
  status: z.enum(COMPLAINT_STATUSES).optional(), category: z.enum(COMPLAINT_CATEGORIES).optional(), caseRef: z.string().max(100).optional(),
  subject: z.string().max(200).optional(), from: z.string().date().optional(), to: z.string().date().optional(),
  overdueAcknowledgement: z.enum(["true", "false"]).optional(), overdueResponse: z.enum(["true", "false"]).optional(),
}).strict();

function actor(req: any) {
  return { id: req.user.id, role: req.user.role, name: req.user.name, email: req.user.email };
}

function handle(error: unknown, res: any) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.flatten() });
  if (error instanceof ComplaintServiceError) return res.status(error.status).json({ message: error.message });
  console.error("[Complaints] Request failed", error instanceof Error ? error.message : "Unknown error");
  return res.status(500).json({ message: "Complaint request failed" });
}

router.post("/api/complaints", requireAuth, async (req: any, res) => {
  try {
    if (req.user.role === "subadmin") {
      const permissions = await permissionService.getPermissions();
      if (!canViewSection(permissions, req.user.role, "cases")) throw new ComplaintServiceError("Case reference not found or unavailable", 404);
    }
    return res.status(201).json(await caseComplaintService.submit(complaintSubmissionSchema.parse(req.body), actor(req)));
  }
  catch (error) { return handle(error, res); }
});

router.get("/api/complaints", requireAuth, async (req: any, res) => {
  try { return res.json(await caseComplaintService.list(actor(req), listQuery.parse(req.query))); }
  catch (error) { return handle(error, res); }
});

router.get("/api/complaints/mine", requireAuth, async (req: any, res) => {
  try {
    const query = z.object({ caseId: z.string().uuid().optional() }).strict().parse(req.query);
    return res.json(await caseComplaintService.listMine(actor(req), query.caseId));
  } catch (error) { return handle(error, res); }
});

router.get("/api/cases/:caseId/complaints", requireAuth, async (req: any, res) => {
  try { return res.json(await caseComplaintService.listForCase(z.string().uuid().parse(req.params.caseId), actor(req))); }
  catch (error) { return handle(error, res); }
});

router.get("/api/complaints/:id", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.json(await caseComplaintService.get(id, actor(req))); }
  catch (error) { return handle(error, res); }
});

router.patch("/api/complaints/:id/status", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.json(await caseComplaintService.changeStatus(id, actor(req), complaintStatusActionSchema.parse(req.body))); }
  catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/notes", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.status(201).json(await caseComplaintService.addNote(id, actor(req), complaintNoteSchema.parse(req.body))); }
  catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/deadline-extension", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.json(await caseComplaintService.extendDeadline(id, actor(req), complaintDeadlineExtensionSchema.parse(req.body))); }
  catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/escalations", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.status(201).json(await caseComplaintService.escalate(id, actor(req), complaintEscalationSchema.parse(req.body))); }
  catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/clarification-replies", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.status(201).json(await caseComplaintService.reply(id, actor(req), clarificationReplySchema.parse(req.body))); }
  catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/retry-receipt", requireAuth, async (req: any, res) => {
  try { const { id } = idParams.parse(req.params); return res.json(await caseComplaintService.retryReceipt(id, actor(req))); }
  catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/events/:eventId/redact", requireAuth, async (req: any, res) => {
  try {
    const params = z.object({ id: z.string().uuid(), eventId: z.string().uuid() }).strict().parse(req.params);
    return res.json(await caseComplaintService.redactEvent(params.id, params.eventId, actor(req), complaintRedactionSchema.parse(req.body).reason));
  } catch (error) { return handle(error, res); }
});

router.post("/api/complaints/:id/attachments/:attachmentId/redact", requireAuth, async (req: any, res) => {
  try {
    const params = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }).strict().parse(req.params);
    return res.json(await caseComplaintService.redactAttachment(params.id, params.attachmentId, actor(req), complaintRedactionSchema.parse(req.body).reason));
  } catch (error) { return handle(error, res); }
});

router.get("/api/complaint-attachments/:attachmentId/download", requireAuth, async (req: any, res) => {
  try {
    const attachmentId = z.string().uuid().parse(req.params.attachmentId);
    const { attachment, file } = await caseComplaintService.openAttachment(attachmentId, actor(req));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    if (file.contentLength != null) res.setHeader("Content-Length", String(file.contentLength));
    file.body.on("error", (error) => { if (!res.headersSent) handle(error, res); else res.destroy(error); });
    return file.body.pipe(res);
  } catch (error) { return handle(error, res); }
});

export default router;
