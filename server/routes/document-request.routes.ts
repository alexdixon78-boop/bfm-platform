import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/permissions";
import { documentRequestService } from "../services/document-request.service";
import { DOCUMENT_REQUEST_TYPES } from "@shared/document-request";
import type { User } from "@shared/schema";

const router = Router();

function getUser(req: { user?: User }): User {
  return req.user as User;
}

const createRequestSchema = z.object({
  partyIds: z.array(z.string().trim().min(1)).min(1).max(20),
  documentType: z.enum(DOCUMENT_REQUEST_TYPES),
  customDocumentName: z.string().trim().max(200).optional().nullable(),
  instructions: z.string().trim().max(5000).optional().nullable(),
});

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  fileData: z.string().trim().min(1),
  mimeType: z.string().trim().min(1).max(200),
  fileSizeBytes: z.number().int().nonnegative().optional().nullable(),
});

const returnSchema = z.object({
  reason: z.string().trim().min(1).max(5000),
});

function sendResult(res: any, result: { ok: boolean; status?: number; error?: string }, successStatus = 200) {
  if (!result.ok) return res.status(result.status || 400).json({ message: result.error || "Request failed" });
  return res.status(successStatus).json(result);
}

router.get("/api/cases/:caseId/document-requests", requirePermission("cases", "view"), async (req, res) => {
  return sendResult(res, await documentRequestService.listCaseRequests(req.params.caseId, getUser(req as any)));
});

router.post("/api/cases/:caseId/document-requests", requirePermission("cases", "view"), async (req, res) => {
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid document request", issues: parsed.error.issues });
  return sendResult(res, await documentRequestService.createRequests(req.params.caseId, getUser(req as any), parsed.data, req.ip), 201);
});

router.post("/api/document-requests/:id/submit", requirePermission("cases", "view"), async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid document upload", issues: parsed.error.issues });
  return sendResult(res, await documentRequestService.submitRequest(req.params.id, getUser(req as any), parsed.data, req.ip), 201);
});

router.post("/api/document-requests/:id/resend", requirePermission("cases", "view"), async (req, res) => {
  return sendResult(res, await documentRequestService.resendRequest(req.params.id, getUser(req as any), req.ip));
});

router.post("/api/document-requests/:id/return", requirePermission("cases", "view"), async (req, res) => {
  const parsed = returnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "A return reason is required", issues: parsed.error.issues });
  return sendResult(res, await documentRequestService.returnRequest(req.params.id, getUser(req as any), parsed.data.reason, req.ip));
});

router.post("/api/document-requests/:id/complete", requirePermission("cases", "view"), async (req, res) => {
  return sendResult(res, await documentRequestService.completeRequest(req.params.id, getUser(req as any), req.ip));
});

router.post("/api/document-requests/:id/cancel", requirePermission("cases", "view"), async (req, res) => {
  return sendResult(res, await documentRequestService.cancelRequest(req.params.id, getUser(req as any), req.ip));
});

export default router;
