import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import type { User } from "@shared/schema";
import { xeroService } from "../services/xero.service";
import { logger } from "../logger";

const router = Router();

async function loadSuperadmin(req: Request, res: Response): Promise<User | null> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  const user = await storage.getUser(userId);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  if (user.role !== "superadmin") {
    res.status(403).json({ message: "Only superadmins can manage Xero" });
    return null;
  }
  return user;
}

router.get("/api/integrations/xero/status", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;
  res.json(await xeroService.getConnectionStatus());
});

router.get("/api/integrations/xero/tax-rates", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;
  const result = await xeroService.getTaxRates();
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.get("/api/integrations/xero/invoice-setup", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;
  const result = await xeroService.validateInvoiceSetup("GBP");
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.post("/api/appointments/:id/xero-sync", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;
  const result = await xeroService.syncAppointmentInvoice(req.params.id);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  res.json(result);
});

router.post("/api/public/integrations/xero/webhook", async (req, res) => {
  const signature = req.header("x-xero-signature");
  if (!signature || !Buffer.isBuffer(req.rawBody)) {
    logger.warn("Xero webhook signature or raw body missing", undefined, "xero");
    return res.status(401).send();
  }
  if (!xeroService.verifyWebhookSignature(req.rawBody, signature)) {
    logger.warn("Xero webhook signature rejected", undefined, "xero");
    return res.status(401).send();
  }

  try {
    const result = await xeroService.handleWebhookPayload(req.body);
    return res.json(result);
  } catch (err) {
    logger.error("Xero webhook processing failed", {
      reason: err instanceof Error ? err.message : String(err),
    }, "xero");
    return res.status(500).json({ message: "Xero webhook processing failed" });
  }
});

export default router;
