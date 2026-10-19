import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/permissions";
import { caseProofingService } from "../services/case-proofing.service";
import type { User } from "@shared/schema";

const router = Router();

const returnSchema = z.object({
  returnComments: z.string().trim().min(1).max(5000),
});

const withdrawSchema = z.object({
  withdrawReason: z.string().trim().min(1).max(5000),
});

function getUser(req: { user?: User }): User {
  return req.user as User;
}

router.get("/api/cases/:id/proofing-items", requirePermission("cases", "view"), async (req, res, next) => {
  try {
    const result = await caseProofingService.listCaseProofingItems(req.params.id, getUser(req as any));
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    return res.json(result.items);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/case-proofing-items/:id/approve", requirePermission("cases", "edit"), async (req, res, next) => {
  try {
    const result = await caseProofingService.approveProofingItem(req.params.id, getUser(req as any), req.ip);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    return res.json(result.item);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/case-proofing-items/:id/return", requirePermission("cases", "edit"), async (req, res, next) => {
  try {
    const input = returnSchema.parse(req.body);
    const result = await caseProofingService.returnProofingItem(req.params.id, getUser(req as any), input, req.ip);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    return res.json(result.item);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/case-proofing-items/:id/withdraw", requirePermission("cases", "edit"), async (req, res, next) => {
  try {
    const input = withdrawSchema.parse(req.body);
    const result = await caseProofingService.withdrawProofingItem(req.params.id, getUser(req as any), input, req.ip);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    return res.json(result.item);
  } catch (err) {
    next(err);
  }
});

export default router;
