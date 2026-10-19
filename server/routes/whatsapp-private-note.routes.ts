import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { whatsappPrivateNoteService } from "../services/whatsapp-private-note.service";
import type { User } from "@shared/schema";

const router = Router();
const actor = (req: any) => req.user as User;

router.get("/api/cases/:caseId/private-notes/access", requireAuth, async (req, res) => {
  const access = await whatsappPrivateNoteService.accessForActor(req.params.caseId, actor(req));
  return access ? res.json(access) : res.status(404).json({ message: "Not found" });
});

router.get("/api/cases/:caseId/private-notes", requireAuth, async (req, res) => {
  try { res.json(await whatsappPrivateNoteService.listForActor(req.params.caseId, actor(req))); }
  catch (error) { res.status((error as any)?.status || 500).json({ message: (error as Error).message }); }
});

router.get("/api/cases/:caseId/private-notes/:noteId/attachments/:attachmentId/download", requireAuth, async (req, res) => {
  const result = await whatsappPrivateNoteService.openAttachmentForActor(req.params.caseId, req.params.noteId, req.params.attachmentId, actor(req));
  if (!result) return res.status(404).json({ message: "Attachment not found" });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${String(result.attachment.fileName || "attachment").replace(/[\r\n"]/g, "_")}"`);
  if (result.file.contentType) res.setHeader("Content-Type", result.file.contentType);
  result.file.body.pipe(res);
});

router.post("/api/cases/:caseId/private-notes/:noteId/attachments/:attachmentId/retry", requireAuth, async (req, res) => {
  const user = actor(req);
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only administrators can retry private-note attachments" });
  }
  const attachment = await whatsappPrivateNoteService.retryAttachment(req.params.caseId, req.params.noteId, req.params.attachmentId, user.id);
  return attachment ? res.json({ success: true, status: attachment.status }) : res.status(409).json({ message: "Only failed attachments can be retried" });
});

const redactSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
router.post("/api/cases/:caseId/private-notes/:noteId/redact", requireAuth, async (req, res) => {
  const user = actor(req);
  if (user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can redact private notes" });
  const parsed = redactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "A redaction reason is required" });
  const note = await whatsappPrivateNoteService.redactText(req.params.caseId, req.params.noteId, user.id, parsed.data.reason);
  return note ? res.json(note) : res.status(404).json({ message: "Note not found" });
});

router.post("/api/cases/:caseId/private-notes/:noteId/attachments/:attachmentId/redact", requireAuth, async (req, res) => {
  const user = actor(req);
  if (user.role !== "superadmin") return res.status(403).json({ message: "Only superadmins can redact private note attachments" });
  const parsed = redactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "A redaction reason is required" });
  const file = await whatsappPrivateNoteService.redactAttachment(req.params.caseId, req.params.noteId, req.params.attachmentId, user.id, parsed.data.reason);
  return file ? res.json(file) : res.status(404).json({ message: "Attachment not found" });
});

export default router;
