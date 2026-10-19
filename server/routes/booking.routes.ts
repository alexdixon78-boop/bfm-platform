import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { bookingService } from "../services/booking.service";
import { appointmentService } from "../services/appointment.service";
import { logAudit } from "../services/audit-log.service";
import { clientActor, staffActor } from "../services/case-activity.service";
import { storage } from "../storage";
import { availabilityService } from "../services/availability.service";
import type { User } from "@shared/schema";
import { isPublicNewCaseBookingServiceName } from "../services/booking-onboarding";
import { formatPaymentAmount, hasOnlinePaymentPrice } from "../services/booking-payment";
import { stripePaymentService } from "../services/stripe-payment.service";
import { notificationService } from "../services/notification.service";
import { paymentSettingsService } from "../services/payment-settings.service";
import { logger } from "../logger";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";
import { appointmentCalendarSyncService } from "../services/appointment-calendar-sync.service";
import { isPaidPublicBookingEligibleForAutoConfirmation } from "../services/appointment-calendar-sync-rules";

const router = Router();
const requireEmailAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role === "superadmin" || req.user?.role === "subadmin") return next();
  return res.status(403).json({ message: "Only Super Admin and Sub Admin can send email" });
};

function normalizeStripeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\?+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

async function canAccessMiamParty(user: User, party: { id: string; caseId: string }): Promise<boolean> {
  const access = await classifyCaseAccess(party.caseId, user);
  return hasFullOperationalCaseAccess(access)
    || (access.tier === "miam_only_mediator" && access.partyIds.includes(party.id));
}

router.post("/api/parties/:id/booking-link", requirePermission("cases", "edit"), requireEmailAdmin, async (req, res) => {
  const user = (req as any).user as User;

  const party = await storage.getParty(req.params.id);
  if (!party) return res.status(404).json({ message: "Party not found" });
  if (!(await canAccessMiamParty(user, party))) {
    return res.status(403).json({ message: "Access denied" });
  }

  const result = await bookingService.generateBookingLink(req.params.id, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  logAudit({
    userId: user.id,
    action: "generate_booking_link",
    entity: "party",
    entityId: req.params.id,
    details: JSON.stringify({ partyId: req.params.id }),
  });

  return res.json({ bookingUrl: result.bookingUrl, emailSent: result.emailSent });
});

router.post("/api/parties/:partyId/miam-renewal-booking-link", requirePermission("cases", "edit"), requireEmailAdmin, async (req, res) => {
  const user = (req as any).user as User;
  const party = await storage.getParty(req.params.partyId);
  if (!party) return res.status(404).json({ message: "Party not found" });
  if (!(await canAccessMiamParty(user, party))) {
    return res.status(403).json({ message: "Access denied" });
  }

  const result = await bookingService.generateMiamRenewalBookingLink(req.params.partyId, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  logAudit({
    userId: user.id,
    action: "generate_miam_renewal_booking_link",
    entity: "party",
    entityId: req.params.partyId,
    details: JSON.stringify({ partyId: req.params.partyId }),
  });

  return res.json({ bookingUrl: result.bookingUrl, emailSent: result.emailSent });
});

router.post("/api/parties/:partyId/miam-renewal-self-service-link", requireAuth, async (req, res) => {
  const user = (req as any).user as User | undefined;
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const party = await storage.getParty(req.params.partyId);
  if (!party) return res.status(404).json({ message: "Party not found" });
  if (user.role !== "client" || party.userId !== user.id) {
    return res.status(403).json({ message: "Clients can only create repeat MIAM links for their own party record" });
  }

  const result = await bookingService.generateMiamRenewalBookingLink(req.params.partyId, clientActor(party, "miam_renewal_self_service"));
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  logAudit({
    userId: user.id,
    action: "generate_miam_renewal_self_service_link",
    entity: "party",
    entityId: req.params.partyId,
    details: JSON.stringify({ partyId: req.params.partyId }),
  });

  return res.json({ bookingUrl: result.bookingUrl, emailSent: result.emailSent });
});

router.post("/api/parties/:partyId/miam-self-service-booking-link", requireAuth, async (req, res) => {
  const user = (req as any).user as User | undefined;
  if (!user) return res.status(401).json({ message: "Not authenticated" });

  const party = await storage.getParty(req.params.partyId);
  if (!party) return res.status(404).json({ message: "Party not found" });
  if (user.role !== "client" || party.userId !== user.id) {
    return res.status(403).json({ message: "Clients can only create MIAM booking links for their own party record" });
  }

  const result = await bookingService.generateFreshMiamSelfServiceBookingLink(req.params.partyId, clientActor(party, "miam_self_service"));
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  logAudit({
    userId: user.id,
    action: "generate_miam_self_service_booking_link",
    entity: "party",
    entityId: req.params.partyId,
    details: JSON.stringify({ partyId: req.params.partyId }),
  });

  return res.json({ bookingUrl: result.bookingUrl, emailSent: result.emailSent });
});

router.get("/api/booking/:token", async (req, res) => {
  const result = await bookingService.validateBookingToken(req.params.token);
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  const existingAppointment = await bookingService.getActiveBookingLinkAppointment(req.params.token, result.partyId);

  // Build the public service catalogue restricted to services that have at
  // least one mediator who is both service-approved and actually bookable.
  const allServiceTypes = await storage.listServiceTypes();
  const existingServiceType = existingAppointment?.serviceTypeId
    ? allServiceTypes.find(st => st.id === existingAppointment.serviceTypeId)
    : null;
  const fulfillableServiceIds = new Set<string>();
  for (const service of allServiceTypes) {
    if (!service.isActive) continue;
    if (await availabilityService.hasBookableAvailabilityForService(service.id)) {
      fulfillableServiceIds.add(service.id);
    }
  }
  const availableServices = allServiceTypes
    .filter(st => st.isActive && fulfillableServiceIds.has(st.id) && isPublicNewCaseBookingServiceName(st.name) && hasOnlinePaymentPrice(st))
    .map(st => ({
      id: st.id,
      name: st.name,
      description: st.description,
      category: st.category,
      priceInfo: st.priceInfo,
      paymentAmountPence: st.paymentAmountPence,
      paymentCurrency: st.paymentCurrency,
      formattedPaymentAmount: formatPaymentAmount(st.paymentAmountPence!, st.paymentCurrency || "gbp"),
    }));

  return res.json({
    firstName: result.firstName,
    lastName: result.lastName,
    partyRole: result.partyRole,
    dateOfBirth: result.dateOfBirth,
    email: result.email,
    phone: result.phone,
    addressLine1: result.addressLine1,
    postcode: result.postcode,
    caseRef: result.caseRef,
    caseType: result.caseType,
    caseSubtype: result.caseSubtype,
    ...(result.partyRole === "A" ? {
      caseDescription: result.caseDescription,
      howHeard: result.howHeard,
    } : {}),
    bookingAlreadyUsed: !!existingAppointment,
    existingAppointment: existingAppointment ? {
      appointmentId: existingAppointment.id,
      dateTime: existingAppointment.dateTime,
      dateTimeBasis: existingAppointment.dateTimeBasis,
      duration: existingAppointment.duration,
      status: existingAppointment.status,
      paymentStatus: existingAppointment.paymentStatus,
      serviceTypeId: existingAppointment.serviceTypeId,
      serviceTypeName: existingServiceType?.name || null,
      holdExpiresAt: existingAppointment.holdExpiresAt,
    } : null,
    availableServices,
  });
});

router.get("/api/booking/:token/available-dates", async (req, res) => {
  const { serviceTypeId, month } = req.query;
  if (!serviceTypeId || !month) {
    return res.status(400).json({ message: "serviceTypeId and month (YYYY-MM) query params are required" });
  }

  const monthStr = month as string;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
    return res.status(400).json({ message: "month must be in YYYY-MM format (e.g. 2026-04)" });
  }

  const validation = await bookingService.validateBookingToken(req.params.token);
  if (!validation.ok) return res.status(validation.status).json({ message: validation.error });

  const serviceType = await storage.getServiceType(serviceTypeId as string);
  if (!serviceType || !serviceType.isActive || !isPublicNewCaseBookingServiceName(serviceType.name) || !hasOnlinePaymentPrice(serviceType)) {
    return res.status(400).json({ message: "This service is not available for new-case booking links" });
  }

  const result = await availabilityService.getAvailableDates(serviceTypeId as string, monthStr);
  return res.json(result);
});

router.get("/api/booking/:token/slots", async (req, res) => {
  const { serviceTypeId, date } = req.query;
  if (!serviceTypeId || !date) {
    return res.status(400).json({ message: "serviceTypeId and date query params are required" });
  }

  const result = await bookingService.getAvailableSlots(
    req.params.token,
    serviceTypeId as string,
    date as string
  );
  if (!result.ok) return res.status(result.status).json({ message: result.error });

  return res.json(result.slots);
});

router.get("/api/booking/:token/payment-status", async (req, res) => {
  const { appointmentId, session_id, payment } = req.query;
  if (!appointmentId || typeof appointmentId !== "string") {
    return res.status(400).json({ message: "appointmentId query param is required" });
  }
  const sessionId = normalizeStripeSessionId(session_id);
  let reconciliationAction = sessionId ? "not_needed" : "not_requested";

  const validation = await bookingService.validateBookingToken(req.params.token);
  if (!validation.ok) return res.status(validation.status).json({ message: validation.error });

  let appointment = await storage.getAppointment(appointmentId);
  if (!appointment || appointment.bookingToken !== req.params.token || appointment.partyId !== validation.partyId) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  if (sessionId) {
    if (appointment.stripeCheckoutSessionId !== sessionId) {
      reconciliationAction = "session_mismatch";
      logger.warn("Stripe return check session mismatch", {
        appointment: appointment.id.slice(0, 8),
        expectedSession: appointment.stripeCheckoutSessionId?.slice(0, 12) || null,
        returnedSession: sessionId.slice(0, 12),
      }, "stripe");
    } else if (payment === "cancelled" && appointment.paymentStatus !== "paid") {
      await stripePaymentService.recordCheckoutCancelledReturn(appointment, sessionId);
      appointment = await storage.getAppointment(appointmentId) || appointment;
      reconciliationAction = "cancelled_return_recorded";
    } else if (appointment.paymentStatus !== "paid") {
      const reconciled = await stripePaymentService.reconcileCheckoutSessionReturn(
        appointment,
        sessionId,
        "return_status_check",
      );
      appointment = reconciled.appointment;
      reconciliationAction = reconciled.action;
    }
  }

  if (isPaidPublicBookingEligibleForAutoConfirmation(appointment) && appointment.status !== "confirmed") {
    const confirmed = await appointmentService.confirmPaidPublicBooking(appointment.id, "paid_public_booking_repair");
    if (confirmed.ok) {
      appointment = confirmed.appointment;
      reconciliationAction = "paid_and_confirmed";
    } else {
      reconciliationAction = "paid_confirmation_failed";
    }
  }

  const calendarSyncStatus = await appointmentCalendarSyncService.getPublicStatus(appointment.id);

  return res.json({
    appointmentId: appointment.id,
    status: appointment.status,
    paymentStatus: appointment.paymentStatus,
    paymentFailureReason: appointment.paymentFailureReason,
    dateTime: appointment.dateTime,
    dateTimeBasis: appointment.dateTimeBasis,
    duration: appointment.duration,
    serviceTypeId: appointment.serviceTypeId,
    reconciliationAction,
    calendarSyncStatus,
  });
});

router.post("/api/booking/:token/appointments/:appointmentId/bank-transfer-in-flight", async (req, res) => {
  const validation = await bookingService.validateBookingToken(req.params.token);
  if (!validation.ok) return res.status(validation.status).json({ message: validation.error });

  const appointment = await storage.getAppointment(req.params.appointmentId);
  if (!appointment || appointment.bookingToken !== req.params.token || appointment.partyId !== validation.partyId) {
    return res.status(404).json({ message: "Appointment not found" });
  }
  if (appointment.paymentStatus === "paid") {
    return res.json({ success: true, alreadyPaid: true });
  }

  const updated = await storage.updateAppointment(appointment.id, {
    holdExpiresAt: null,
    paymentNotes: "Client indicated bank transfer has been sent; auto-release paused pending Xero reconciliation.",
    paymentStatusUpdatedAt: new Date(),
  });
  await notificationService.createNotification({
    type: "bank_transfer_in_flight",
    title: "Bank transfer may be in flight",
    message: `Client indicated they paid by bank transfer for case ${validation.caseRef}. Check Xero/bank reconciliation before releasing the held slot.`,
    urgency: "red",
    recipientRole: "superadmin",
    caseId: appointment.caseId,
    appointmentId: appointment.id,
  });
  await logAudit({
    action: "booking_bank_transfer_in_flight",
    entity: "appointment",
    entityId: appointment.id,
    entityRef: validation.caseRef,
  });
  res.json({ success: true, appointment: updated });
});

router.post("/api/booking/:token/appointment", async (req, res) => {
  const { serviceTypeId, dateTime, preferredTimes, preferredSlots, onboardingDetails, mode } = req.body;
  const bookingMode = (mode === "hold" || mode === "held") ? "hold" : (mode === "stripe_checkout" || mode === "xero_invoice") ? "stripe_checkout" : null;

  const timesToTry: Array<{ startAt: string; timeBasis?: "instant" | "wall_clock_utc" }> = [];
  if (Array.isArray(preferredSlots) && preferredSlots.length > 0) {
    for (const slot of preferredSlots) {
      if (typeof slot?.startAt !== "string" || !["instant", "wall_clock_utc"].includes(slot?.timeBasis)) {
        return res.status(400).json({ message: "Invalid preferred slot" });
      }
      timesToTry.push({ startAt: slot.startAt, timeBasis: slot.timeBasis });
    }
  } else if (Array.isArray(preferredTimes) && preferredTimes.length > 0) {
    timesToTry.push(...preferredTimes.map((startAt: string) => ({ startAt })));
  } else if (dateTime) {
    timesToTry.push({ startAt: dateTime });
  }

  if (!serviceTypeId || timesToTry.length === 0) {
    return res.status(400).json({ message: "serviceTypeId and at least one dateTime or preferredTimes are required" });
  }
  if (!bookingMode) {
    return res.status(400).json({ message: "mode must be hold or stripe_checkout" });
  }

  let lastError = "";
  let lastStatus = 400;
  for (const slot of timesToTry) {
    const result = await bookingService.createBookingAppointment(
      req.params.token,
      serviceTypeId,
      slot.startAt,
      bookingMode,
      onboardingDetails,
      slot.timeBasis,
    );

    if (result.ok) {
      logAudit({
        action: "book_appointment",
        entity: "appointment",
        entityId: result.appointmentId,
        details: JSON.stringify({ serviceTypeId, dateTime: slot.startAt, preferredSlots: timesToTry, mode: bookingMode, bookedVia: "booking_link" }),
      });

      return res.status(201).json({
        appointmentId: result.appointmentId,
        dateTime: result.dateTime,
        timeBasis: result.timeBasis,
        duration: result.duration,
        serviceTypeName: result.serviceTypeName,
        status: result.status,
        holdExpiresAt: result.holdExpiresAt,
        paymentProvider: result.paymentProvider,
        checkoutUrl: result.checkoutUrl,
        xeroInvoiceUrl: result.xeroInvoiceUrl,
        xeroInvoiceNumber: result.xeroInvoiceNumber,
        xeroInvoiceEmailSent: result.xeroInvoiceEmailSent,
        bankTransfer: await paymentSettingsService.getBankTransferSettings(),
      });
    }

    lastError = result.error;
    lastStatus = result.status;

    if (result.status !== 409) {
      return res.status(result.status).json({ message: result.error });
    }
  }

  return res.status(lastStatus).json({ message: lastError || "None of the preferred times are available. Please choose different times." });
});

export default router;
