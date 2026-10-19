import { Router } from "express";
import { stripePaymentService } from "../services/stripe-payment.service";
import { logger } from "../logger";

const router = Router();

router.post("/api/public/stripe/webhook", async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn("Stripe webhook secret is not configured", undefined, "stripe");
    return res.status(503).json({ message: "Stripe webhook secret is not configured" });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || Array.isArray(signature)) {
    logger.warn("Stripe webhook signature is missing", undefined, "stripe");
    return res.status(400).json({ message: "Missing Stripe webhook signature" });
  }
  if (!Buffer.isBuffer(req.rawBody)) {
    logger.warn("Stripe webhook raw body is unavailable", undefined, "stripe");
    return res.status(400).json({ message: "Stripe webhook raw body is unavailable" });
  }

  try {
    const event = stripePaymentService.constructWebhookEvent(req.rawBody, signature, webhookSecret);
    logger.info("Stripe webhook verified", {
      eventType: event.type,
      event: typeof event.id === "string" ? event.id.slice(0, 12) : undefined,
    }, "stripe");
    const result = await stripePaymentService.handleWebhookEvent(event);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid Stripe webhook";
    logger.warn("Stripe webhook rejected", { reason: message }, "stripe");
    return res.status(400).json({ message });
  }
});

export default router;
