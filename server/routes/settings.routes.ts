import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import type { User } from "@shared/schema";
import {
  BOOKING_PAYMENT_PROVIDERS,
  paymentSettingsService,
  type BookingPaymentProvider,
} from "../services/payment-settings.service";
import { xeroService } from "../services/xero.service";

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
    res.status(403).json({ message: "Only superadmins can manage payment settings" });
    return null;
  }
  return user;
}

const paymentModeSchema = z.object({
  provider: z.enum(BOOKING_PAYMENT_PROVIDERS),
});

const bankTransferSettingsSchema = z.object({
  accountName: z.string().max(160).default(""),
  sortCode: z.string().max(40).default(""),
  accountNumber: z.string().max(60).default(""),
  iban: z.string().max(80).default(""),
  swift: z.string().max(40).default(""),
  instructions: z.string().max(1000).default(""),
});

router.get("/api/settings/payment-mode", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const provider = await paymentSettingsService.getBookingPaymentProvider();
  const xeroStatus = await xeroService.getConnectionStatus();
  const stripe = paymentSettingsService.getStripeReadiness();
  const xeroWebhookEndpoint = paymentSettingsService.getXeroWebhookEndpoint();
  const bankTransfer = await paymentSettingsService.getBankTransferSettings();

  res.json({
    provider,
    allowedProviders: BOOKING_PAYMENT_PROVIDERS,
    xero: {
      connected: xeroStatus.connected,
      configured: xeroStatus.configured,
      webhookEndpoint: xeroWebhookEndpoint,
    },
    stripe,
    bankTransfer,
  });
});

router.patch("/api/settings/payment-mode", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const parsed = paymentModeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "provider must be xero_invoice or direct_stripe_checkout" });
  }

  const provider = parsed.data.provider as BookingPaymentProvider;
  const stripe = paymentSettingsService.getStripeReadiness();
  if (provider === "direct_stripe_checkout" && !stripe.stripeSecretKeyConfigured) {
    return res.status(400).json({ message: "STRIPE_SECRET_KEY is required before enabling direct Stripe Checkout" });
  }

  const result = await paymentSettingsService.setBookingPaymentProvider(provider, user.id);
  res.json({
    ...result,
    stripe,
  });
});

router.get("/api/settings/bank-transfer", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;
  res.json(await paymentSettingsService.getBankTransferSettings());
});

router.patch("/api/settings/bank-transfer", requireAuth, async (req, res) => {
  const user = await loadSuperadmin(req, res);
  if (!user) return;

  const parsed = bankTransferSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid bank transfer settings" });
  }
  res.json(await paymentSettingsService.setBankTransferSettings(parsed.data, user.id));
});

export default router;
