import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, caseInvoices, serviceTypes } from "@shared/schema";
import type { Appointment, CaseInvoice, ServiceType } from "@shared/schema";
import { storage } from "../storage";
import { appointmentService } from "./appointment.service";
import type { ServiceResult } from "./types";
import { logger } from "../logger";
import { financeService } from "./finance.service";

type StripePaymentFinalizeSource = "webhook" | "return_status_check";

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.REPL_SLUG) return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  return "http://localhost:5000";
}

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
}

function shortStripeId(value: string | null | undefined): string | null {
  return value ? value.slice(0, 12) : null;
}

function invoiceIdFromSession(session: Stripe.Checkout.Session): string | null {
  const value = session.metadata?.invoiceId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function invoiceIdForCheckoutSession(session: Stripe.Checkout.Session, expectedInvoiceId?: string): Promise<string | null> {
  const metadataInvoiceId = invoiceIdFromSession(session);
  if (metadataInvoiceId) return metadataInvoiceId;
  const [invoice] = await db
    .select({ id: caseInvoices.id, serviceName: serviceTypes.name })
    .from(caseInvoices)
    .leftJoin(serviceTypes, eq(caseInvoices.serviceTypeId, serviceTypes.id))
    .where(eq(caseInvoices.providerInvoiceId, session.id))
    .limit(1);
  if (!invoice) return null;
  if (expectedInvoiceId && invoice.id !== expectedInvoiceId) return null;
  if (invoice.serviceName !== "Mediation Sessions") return null;
  return invoice.id;
}

function createCheckoutSessionReturnUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${baseUrl}${path}?${query.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}")}`;
}

export class StripePaymentService {
  constructWebhookEvent(rawBody: Buffer, signature: string, webhookSecret: string): Stripe.Event {
    const stripe = getStripeClient();
    if (!stripe) throw new Error("Stripe is not configured");
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async createBookingCheckoutSession(input: {
    appointment: Appointment;
    serviceType: ServiceType;
    caseRef: string;
    partyId: string;
    partyEmail: string;
    partyName: string;
    bookingToken: string;
  }): Promise<ServiceResult<{ checkoutUrl: string; checkoutSessionId: string }>> {
    const stripe = getStripeClient();
    if (!stripe) {
      return { ok: false, error: "Online payment is temporarily unavailable. Please contact Brighter Future Mediation.", status: 503 };
    }
    if (!input.serviceType.paymentAmountPence || input.serviceType.paymentAmountPence <= 0) {
      return { ok: false, error: "This service is not configured for online payment", status: 400 };
    }

    const baseUrl = getBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: input.partyEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (input.serviceType.paymentCurrency || "gbp").toLowerCase(),
          unit_amount: input.serviceType.paymentAmountPence,
          product_data: {
            name: input.serviceType.name,
            description: `Case ${input.caseRef} — ${input.partyName}`,
          },
        },
      }],
      metadata: {
        appointmentId: input.appointment.id,
        caseId: input.appointment.caseId,
        caseRef: input.caseRef,
        partyId: input.partyId,
        serviceTypeId: input.serviceType.id,
        bookingToken: input.bookingToken,
      },
      payment_intent_data: {
        metadata: {
          appointmentId: input.appointment.id,
          caseId: input.appointment.caseId,
          caseRef: input.caseRef,
          partyId: input.partyId,
          serviceTypeId: input.serviceType.id,
        },
      },
      success_url: `${baseUrl}/book/${input.bookingToken}?payment=success&appointmentId=${input.appointment.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/book/${input.bookingToken}?payment=cancelled&appointmentId=${input.appointment.id}&session_id={CHECKOUT_SESSION_ID}`,
    });

    await storage.updateAppointment(input.appointment.id, {
      paymentProvider: "stripe",
      paymentAmountPence: input.serviceType.paymentAmountPence,
      paymentCurrency: (input.serviceType.paymentCurrency || "gbp").toLowerCase(),
      stripeCheckoutSessionId: session.id,
      paymentNotes: "Stripe Checkout Session created",
    });
    await financeService.ensureBookingInvoice({
      appointment: { ...input.appointment, stripeCheckoutSessionId: session.id, paymentProvider: "stripe" },
      serviceType: input.serviceType,
      caseRef: input.caseRef,
      partyId: input.partyId,
      provider: "stripe",
      providerInvoiceId: session.id,
      paymentLinkUrl: session.url || null,
      paymentStatus: "unpaid",
    });

    logger.info("Stripe Checkout Session created", {
      appointment: shortStripeId(input.appointment.id),
      caseRef: input.caseRef,
      service: input.serviceType.name,
      amountPence: input.serviceType.paymentAmountPence,
      currency: (input.serviceType.paymentCurrency || "gbp").toLowerCase(),
      session: shortStripeId(session.id),
    }, "stripe");

    return { ok: true, checkoutUrl: session.url || "", checkoutSessionId: session.id };
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<{ received: true; action: string }> {
    switch (event.type) {
      case "checkout.session.completed":
        return this.finalizePaidCheckoutSession(event.data.object as Stripe.Checkout.Session, "webhook");
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        return this.recordCheckoutFailure(event.data.object as Stripe.Checkout.Session, event.type);
      case "charge.refunded":
        return this.recordRefund(event.data.object as Stripe.Charge);
      default:
        return { received: true, action: "ignored" };
    }
  }

  async reconcileCheckoutSessionReturn(
    appointment: Appointment,
    sessionId: string,
    source: StripePaymentFinalizeSource = "return_status_check",
  ): Promise<{ appointment: Appointment; action: string }> {
    const stripe = getStripeClient();
    if (!stripe) {
      logger.warn("Stripe return check could not retrieve session", {
        appointment: shortStripeId(appointment.id),
        reason: "Stripe is not configured",
      }, "stripe");
      return { appointment, action: "stripe_not_configured" };
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      logger.warn("Stripe return check could not retrieve session", {
        appointment: shortStripeId(appointment.id),
        session: shortStripeId(sessionId),
        reason: err instanceof Error ? err.message : "Unknown Stripe error",
      }, "stripe");
      return { appointment, action: "session_retrieve_failed" };
    }

    if (session.payment_status === "paid" && session.status === "complete") {
      const result = await this.finalizePaidCheckoutSession(session, source);
      const latest = await storage.getAppointment(appointment.id);
      return { appointment: latest || appointment, action: result.action };
    }

    logger.warn("Stripe return check found unpaid session", {
      appointment: shortStripeId(appointment.id),
      session: shortStripeId(session.id),
      paymentStatus: session.payment_status,
      checkoutStatus: session.status,
    }, "stripe");
    return { appointment, action: "session_not_paid" };
  }

  async reconcileInvoiceCheckoutSessionReturn(
    invoiceId: string,
    sessionId: string,
    source: StripePaymentFinalizeSource = "return_status_check",
  ): Promise<{ action: string }> {
    const stripe = getStripeClient();
    if (!stripe) {
      logger.warn("Stripe invoice return check could not retrieve session", {
        invoice: shortStripeId(invoiceId),
        reason: "Stripe is not configured",
      }, "stripe");
      return { action: "stripe_not_configured" };
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      logger.warn("Stripe invoice return check could not retrieve session", {
        invoice: shortStripeId(invoiceId),
        session: shortStripeId(sessionId),
        reason: err instanceof Error ? err.message : "Unknown Stripe error",
      }, "stripe");
      return { action: "session_retrieve_failed" };
    }
    if (await invoiceIdForCheckoutSession(session, invoiceId) !== invoiceId) return { action: "invoice_mismatch" };
    if (session.payment_status === "paid" && session.status === "complete") {
      const result = await this.finalizePaidCheckoutSession(session, source);
      return { action: result.action };
    }
    return { action: "session_not_paid" };
  }

  async finalizePaidCheckoutSession(
    session: Stripe.Checkout.Session,
    source: StripePaymentFinalizeSource,
  ): Promise<{ received: true; action: string }> {
    const invoiceId = await invoiceIdForCheckoutSession(session);
    if (invoiceId) {
      const expected = await financeService.getMediationSessionInvoiceForCheckout(invoiceId, { allowPaid: true });
      if (!expected.ok) {
        logger.warn("Stripe mediation session invoice lookup failed", {
          source,
          session: shortStripeId(session.id),
          invoice: shortStripeId(invoiceId),
          reason: expected.error,
        }, "stripe");
        return { received: true, action: "mediation_session_invoice_payment_failed" };
      }
      const sessionPartyId = typeof session.metadata?.partyId === "string" ? session.metadata.partyId.trim() : "";
      if (sessionPartyId && sessionPartyId !== expected.invoice.billToPartyId) {
        logger.warn("Stripe mediation session invoice party mismatch", {
          source,
          session: shortStripeId(session.id),
          invoice: shortStripeId(invoiceId),
        }, "stripe");
        return { received: true, action: "mediation_session_invoice_payment_failed" };
      }
      const expectedAmount = expected.invoice.outstandingPence > 0 ? expected.invoice.outstandingPence : expected.invoice.totalPence;
      const sessionAmount = typeof session.amount_total === "number" ? session.amount_total : expectedAmount;
      const expectedCurrency = (expected.invoice.currency || "gbp").toLowerCase();
      const sessionCurrency = (session.currency || expectedCurrency).toLowerCase();
      if (sessionAmount !== expectedAmount || sessionCurrency !== expectedCurrency) {
        logger.warn("Stripe mediation session invoice amount mismatch", {
          source,
          session: shortStripeId(session.id),
          invoice: shortStripeId(invoiceId),
          expectedAmount,
          sessionAmount,
          expectedCurrency,
          sessionCurrency,
        }, "stripe");
        return { received: true, action: "mediation_session_invoice_payment_failed" };
      }
      const stripePaymentIntentId = paymentIntentIdFromSession(session);
      const result = await financeService.recordMediationSessionInvoicePayment({
        invoiceId,
        checkoutSessionId: session.id,
        paymentIntentId: stripePaymentIntentId,
        providerPaymentId: stripePaymentIntentId,
        amountPence: typeof session.amount_total === "number" ? session.amount_total : null,
        currency: session.currency || null,
        paymentDate: new Date(),
      });
      if (!result.ok) {
        logger.warn("Stripe mediation session invoice payment finalization failed", {
          source,
          session: shortStripeId(session.id),
          invoice: shortStripeId(invoiceId),
          reason: result.error,
        }, "stripe");
        return { received: true, action: "mediation_session_invoice_payment_failed" };
      }
      const action = result.autoConfirmation?.confirmed
        ? "mediation_session_auto_confirmed"
        : result.autoConfirmation?.reason === "calendar_failed"
          ? "mediation_session_ready_but_calendar_failed"
          : "mediation_session_invoice_paid";
      logger.info("Stripe payment finalized", {
        invoice: shortStripeId(invoiceId),
        appointment: shortStripeId(result.appointment.id),
        session: shortStripeId(session.id),
        paymentIntent: shortStripeId(stripePaymentIntentId),
        source,
        action,
      }, "stripe");
      return { received: true, action };
    }

    const appointment = await this.getAppointmentBySession(session.id);
    if (!appointment) {
      logger.warn("Stripe payment finalization could not find appointment", {
        source,
        session: shortStripeId(session.id),
      }, "stripe");
      return { received: true, action: "appointment_not_found" };
    }

    const stripePaymentIntentId = paymentIntentIdFromSession(session);
    const paidAt = new Date();
    if (appointment.paymentStatus !== "paid" || appointment.stripePaymentCompletedAt === null) {
      await storage.updateAppointment(appointment.id, {
        paymentStatus: "paid",
        paymentStatusUpdatedAt: paidAt,
        paymentStatusUpdatedBy: null,
        paymentProvider: "stripe",
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId,
        stripePaymentCompletedAt: paidAt,
        paymentFailureReason: null,
        paymentNotes: "Stripe payment received",
      });
    }

    const latest = await storage.getAppointment(appointment.id);
    if (latest) {
      await financeService.recordBookingPayment({
        appointment: latest,
        provider: "stripe",
        checkoutSessionId: session.id,
        paymentIntentId: stripePaymentIntentId,
        providerPaymentId: stripePaymentIntentId,
        amountPence: latest.paymentAmountPence,
        currency: latest.paymentCurrency,
        paymentDate: latest.stripePaymentCompletedAt || paidAt,
      });
    }
    let action = "paid_not_confirmable";
    if (latest?.status === "hold" || latest?.status === "held") {
      const confirmResult = await appointmentService.confirmPaidPublicBooking(latest.id, "stripe_checkout_completed");
      action = confirmResult.ok ? "paid_and_confirmed" : "paid_confirmation_failed";
      if (!confirmResult.ok) {
        logger.warn("Stripe payment received but paid public booking confirmation failed", {
          appointment: shortStripeId(latest.id),
          session: shortStripeId(session.id),
          reason: confirmResult.error,
        }, "stripe");
      }
    } else if (latest?.status === "confirmed") {
      action = "already_confirmed";
    }

    logger.info("Stripe payment finalized", {
      appointment: shortStripeId(appointment.id),
      session: shortStripeId(session.id),
      paymentIntent: shortStripeId(stripePaymentIntentId),
      source,
      action,
    }, "stripe");
    return { received: true, action };
  }

  async recordCheckoutCancelledReturn(appointment: Appointment, sessionId: string): Promise<void> {
    if (appointment.paymentStatus === "paid") return;
    await storage.updateAppointment(appointment.id, {
      paymentStatus: "failed_or_not_received",
      paymentStatusUpdatedAt: new Date(),
      paymentStatusUpdatedBy: null,
      stripeCheckoutSessionId: sessionId,
      paymentFailureReason: "checkout.cancelled_return",
      paymentNotes: "Stripe Checkout was cancelled by the client; booking hold retained for retry.",
    });
    await financeService.recordBookingPaymentStatus(appointment, "cancelled", "checkout.cancelled_return");
  }

  private async recordCheckoutFailure(session: Stripe.Checkout.Session, eventType: string): Promise<{ received: true; action: string }> {
    const appointment = await this.getAppointmentBySession(session.id);
    if (!appointment) return { received: true, action: "appointment_not_found" };

    await storage.updateAppointment(appointment.id, {
      paymentStatus: appointment.paymentStatus === "paid" ? appointment.paymentStatus : "failed_or_not_received",
      paymentStatusUpdatedAt: new Date(),
      paymentStatusUpdatedBy: null,
      paymentFailureReason: eventType,
      paymentNotes: `Stripe payment event recorded: ${eventType}`,
    });
    const ledgerStatus = eventType === "checkout.session.expired" ? "expired" : "failed";
    await financeService.recordBookingPaymentStatus(appointment, ledgerStatus, eventType);
    return { received: true, action: "failure_recorded" };
  }

  private async recordRefund(charge: Stripe.Charge): Promise<{ received: true; action: string }> {
    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentIntentId) return { received: true, action: "payment_intent_not_found" };
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.stripePaymentIntentId, paymentIntentId))
      .limit(1);
    if (!appointment) return { received: true, action: "appointment_not_found" };

    const refundedAmount = typeof charge.amount_refunded === "number" ? charge.amount_refunded : appointment.paymentAmountPence || 0;
    await storage.updateAppointment(appointment.id, {
      paymentFailureReason: "charge.refunded",
      paymentNotes: "Stripe refund recorded. Staff review required for appointment handling.",
    });
    await financeService.recordBookingRefund(appointment, refundedAmount, new Date(), {
      overrideNoShowNoRefund: true,
      refundOverrideReason: "Stripe refund webhook received after provider-side refund was processed.",
    });
    return { received: true, action: "refund_recorded" };
  }

  async createRetryCheckoutSession(invoiceId: string): Promise<ServiceResult<{ checkoutUrl: string; checkoutSessionId: string }>> {
    const stripe = getStripeClient();
    if (!stripe) return { ok: false, error: "Stripe is not configured", status: 503 };

    const invoice = await financeService.getBookingInvoiceForRetry(invoiceId);
    if (!invoice.ok) return invoice;
    const { appointment, serviceType, caseRef, partyId, partyEmail, partyName } = invoice;
    if (!serviceType.paymentAmountPence || serviceType.paymentAmountPence <= 0) {
      return { ok: false, error: "This service is not configured for online payment", status: 400 };
    }

    const baseUrl = getBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: partyEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (serviceType.paymentCurrency || "gbp").toLowerCase(),
          unit_amount: serviceType.paymentAmountPence,
          product_data: {
            name: serviceType.name,
            description: `Case ${caseRef} — ${partyName}`,
          },
        },
      }],
      metadata: {
        appointmentId: appointment.id,
        caseId: appointment.caseId,
        caseRef,
        partyId,
        serviceTypeId: serviceType.id,
        retryForInvoiceId: invoiceId,
      },
      payment_intent_data: {
        metadata: {
          appointmentId: appointment.id,
          caseId: appointment.caseId,
          caseRef,
          partyId,
          serviceTypeId: serviceType.id,
          retryForInvoiceId: invoiceId,
        },
      },
      success_url: `${baseUrl}/book/${appointment.bookingToken || ""}?payment=success&appointmentId=${appointment.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/book/${appointment.bookingToken || ""}?payment=cancelled&appointmentId=${appointment.id}&session_id={CHECKOUT_SESSION_ID}`,
    });

    await storage.updateAppointment(appointment.id, {
      paymentProvider: "stripe",
      paymentAmountPence: serviceType.paymentAmountPence,
      paymentCurrency: (serviceType.paymentCurrency || "gbp").toLowerCase(),
      stripeCheckoutSessionId: session.id,
      paymentFailureReason: null,
      paymentNotes: "Stripe Checkout retry Session created",
    });
    await financeService.updateBookingInvoicePaymentLink(appointment.id, session.url || "", session.id);
    return { ok: true, checkoutUrl: session.url || "", checkoutSessionId: session.id };
  }

  async createMediationSessionInvoiceCheckoutSession(
    invoiceId: string,
    options: { token?: string; proposalRecipientId?: string | null; clientUserId?: string } = {},
  ): Promise<ServiceResult<{ checkoutUrl: string; checkoutSessionId: string; invoiceId: string; invoiceNumber: string; outstandingPence: number; currency: string; paymentProvider: "stripe"; paymentRequired: boolean }>> {
    const context = await financeService.getMediationSessionInvoiceForCheckout(invoiceId, { clientUserId: options.clientUserId });
    if (!context.ok) return context;
    const { invoice, appointment, serviceType, caseRef, partyId, partyEmail, partyName, mediationSessionId } = context;
    if (invoice.outstandingPence <= 0 || invoice.paymentStatus === "payment_not_required") {
      return {
        ok: true,
        checkoutUrl: "",
        checkoutSessionId: invoice.providerInvoiceId || "",
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        outstandingPence: 0,
        currency: invoice.currency,
        paymentProvider: "stripe",
        paymentRequired: false,
      };
    }
    const stripe = getStripeClient();
    if (!stripe) return { ok: false, error: "Stripe is not configured", status: 503 };
    const existing = await this.resolveExistingMediationSessionCheckout(stripe, invoice);
    if (existing.action === "reuse") {
      return {
        ok: true,
        checkoutUrl: invoice.paymentLinkUrl || existing.session.url || "",
        checkoutSessionId: existing.session.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        outstandingPence: invoice.outstandingPence,
        currency: invoice.currency,
        paymentProvider: "stripe",
        paymentRequired: true,
      };
    }
    if (existing.action === "paid") {
      return {
        ok: true,
        checkoutUrl: "",
        checkoutSessionId: existing.session.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        outstandingPence: 0,
        currency: invoice.currency,
        paymentProvider: "stripe",
        paymentRequired: false,
      };
    }

    const baseUrl = getBaseUrl();
    const returnPath = options.token ? `/session-availability/${options.token}` : "/";
    const successUrl = createCheckoutSessionReturnUrl(baseUrl, returnPath, {
      payment: "success",
      invoiceId: invoice.id,
      session_id: "{CHECKOUT_SESSION_ID}",
    });
    const cancelUrl = createCheckoutSessionReturnUrl(baseUrl, returnPath, {
      payment: "cancelled",
      invoiceId: invoice.id,
      session_id: "{CHECKOUT_SESSION_ID}",
    });
    const amountPence = invoice.outstandingPence > 0 ? invoice.outstandingPence : invoice.totalPence;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: partyEmail,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (invoice.currency || serviceType.paymentCurrency || "gbp").toLowerCase(),
          unit_amount: amountPence,
          product_data: {
            name: serviceType.name,
            description: `Case ${caseRef} — ${partyName}`,
          },
        },
      }],
      metadata: {
        appointmentId: appointment.id,
        caseId: invoice.caseId,
        caseRef,
        partyId: invoice.billToPartyId,
        invoiceId: invoice.id,
        mediationSessionId: mediationSessionId || "",
        proposalRecipientId: options.proposalRecipientId || "",
      },
      payment_intent_data: {
        metadata: {
          appointmentId: appointment.id,
          caseId: invoice.caseId,
          caseRef,
          partyId: invoice.billToPartyId,
          invoiceId: invoice.id,
          mediationSessionId: mediationSessionId || "",
          proposalRecipientId: options.proposalRecipientId || "",
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    await financeService.updateInvoicePaymentLink(invoice.id, session.url || "", session.id);
    logger.info("Stripe Checkout Session created", {
      appointment: shortStripeId(appointment.id),
      invoice: shortStripeId(invoice.id),
      caseRef,
      partyId: shortStripeId(partyId),
      amountPence,
      currency: (invoice.currency || serviceType.paymentCurrency || "gbp").toLowerCase(),
      session: shortStripeId(session.id),
    }, "stripe");

    return {
      ok: true,
      checkoutUrl: session.url || "",
      checkoutSessionId: session.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      outstandingPence: invoice.outstandingPence,
      currency: invoice.currency,
      paymentProvider: "stripe",
      paymentRequired: true,
    };
  }

  async reconcileStoredInvoiceCheckoutSession(invoiceId: string): Promise<ServiceResult<{ invoiceId: string; reconciliationAction: string }>> {
    const context = await financeService.getMediationSessionInvoiceForCheckout(invoiceId);
    if (!context.ok) {
      if (context.status === 409 && context.error === "Invoice is already paid") {
        return { ok: true, invoiceId, reconciliationAction: "already_paid" };
      }
      return context;
    }
    const { invoice } = context;
    if (!invoice.providerInvoiceId) return { ok: true, invoiceId, reconciliationAction: "no_checkout_session" };
    const result = await this.reconcileInvoiceCheckoutSessionReturn(invoice.id, invoice.providerInvoiceId, "return_status_check");
    return { ok: true, invoiceId, reconciliationAction: result.action };
  }

  private async resolveExistingMediationSessionCheckout(
    stripe: Stripe,
    invoice: CaseInvoice,
  ): Promise<{ action: "reuse"; session: Stripe.Checkout.Session } | { action: "paid"; session: Stripe.Checkout.Session } | { action: "create_fresh"; reason: string }> {
    if (invoice.provider !== "stripe" || !invoice.providerInvoiceId || !invoice.paymentLinkUrl || !/^https?:\/\//i.test(invoice.paymentLinkUrl)) {
      return { action: "create_fresh", reason: "missing_stored_checkout" };
    }
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(invoice.providerInvoiceId);
    } catch (err) {
      logger.warn("Stored mediation session Checkout could not be retrieved", {
        invoice: shortStripeId(invoice.id),
        session: shortStripeId(invoice.providerInvoiceId),
        reason: err instanceof Error ? err.message : "Unknown Stripe error",
      }, "stripe");
      return { action: "create_fresh", reason: "retrieve_failed" };
    }
    const resolvedInvoiceId = await invoiceIdForCheckoutSession(session, invoice.id);
    if (resolvedInvoiceId !== invoice.id) {
      logger.warn("Stored mediation session Checkout invoice mismatch", {
        invoice: shortStripeId(invoice.id),
        session: shortStripeId(session.id),
      }, "stripe");
      return { action: "create_fresh", reason: "invoice_mismatch" };
    }
    if (session.status === "open" && session.payment_status === "unpaid" && session.url) {
      return { action: "reuse", session };
    }
    if (session.status === "complete" && session.payment_status === "paid") {
      await this.finalizePaidCheckoutSession(session, "return_status_check");
      return { action: "paid", session };
    }
    return { action: "create_fresh", reason: `${session.status || "unknown"}_${session.payment_status || "unknown"}` };
  }

  private async getAppointmentBySession(sessionId: string): Promise<Appointment | undefined> {
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.stripeCheckoutSessionId, sessionId))
      .limit(1);
    return appointment;
  }
}

export const stripePaymentService = new StripePaymentService();
