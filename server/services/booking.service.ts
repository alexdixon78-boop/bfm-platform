import { storage } from "../storage";
import { availabilityService } from "./availability.service";
import { formatCaseRefWithRole } from "../utils/case-ref";
import { logAudit } from "./audit-log.service";
import { CASE_STAGES } from "@shared/schema";
import {
  calculatePublicBookingHoldDeadline,
} from "./appointment-rules";
import type { Appointment, MiamRecord } from "@shared/schema";
import type { ServiceResult } from "./types";
import type { BookingTimeBasis } from "@shared/booking-time";
import type { Actor } from "./case-activity.service";
import { staffActor, systemActor } from "./case-activity.service";
import { xeroService } from "./xero.service";
import { stripePaymentService } from "./stripe-payment.service";
import { paymentSettingsService, type BookingPaymentProvider } from "./payment-settings.service";
import { hasOnlinePaymentPrice } from "./booking-payment";
import { financialDisclosureService } from "./financial-disclosure.service";
import {
  splitFullName,
  validateBookingOnboardingDetails,
  isPublicNewCaseBookingServiceName,
  normalizeFamilyCaseSubtype,
  stripBookingOnboardingDescriptionMarker,
  buildStableMiamRenewalPrefill,
  type BookingOnboardingDetails,
} from "./booking-onboarding";
import crypto from "crypto";

export type PublicBookingMode = "hold" | "stripe_checkout";
export type MiamAvailabilityPreviewRow = {
  date: string;
  displayDate: string;
  times: string[];
  url: string;
};
export type MiamAvailabilityPreview = {
  serviceTypeId: string | null;
  rows: MiamAvailabilityPreviewRow[];
  mediatorId: string | null;
  source: "lead_mediator" | "general";
};

export const BOOKING_LINK_ALREADY_USED_MESSAGE = "This booking link has already been used to reserve an appointment. Please use your payment link or contact Brighter Future Mediation.";
const ACTIVE_MIAM_BOOKING_HOLD_STATUSES = new Set(["hold", "held"]);
const ACTIVE_MIAM_BOOKING_SERVICE_NAMES = new Set(["MIAM", "Evening/weekend MIAM", "Urgent (Same Day) MIAM"]);

function isActiveMiamBookingBlocker(
  appointment: Pick<Appointment, "status" | "serviceTypeId" | "dateTime">,
  serviceNameById: Map<string, string>,
  now = new Date(),
): boolean {
  const serviceName = appointment.serviceTypeId ? serviceNameById.get(appointment.serviceTypeId) : null;
  if (!ACTIVE_MIAM_BOOKING_SERVICE_NAMES.has(serviceName || "")) return false;
  if (ACTIVE_MIAM_BOOKING_HOLD_STATUSES.has(appointment.status)) return true;
  if (appointment.status !== "confirmed") return false;
  const appointmentTime = new Date(appointment.dateTime).getTime();
  return Number.isFinite(appointmentTime) && appointmentTime >= now.getTime();
}

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.REPL_SLUG) return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  return "http://localhost:5000";
}

function formatPreviewDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export class BookingService {
  async createOrReuseBookingTokenForAcknowledgement(
    partyId: string,
  ): Promise<ServiceResult<{ bookingUrl: string; fullBookingUrl: string; token: string }>> {
    const party = await storage.getParty(partyId);
    if (!party) return { ok: false, error: "Party not found", status: 404 };

    const existingTokenIsValid = Boolean(party.bookingToken);

    const token = existingTokenIsValid ? party.bookingToken! : crypto.randomUUID();
    if (!existingTokenIsValid) {
      await storage.updateParty(party.id, {
        bookingToken: token,
        bookingTokenExpiresAt: null,
      });
    }

    const bookingUrl = `/book/${token}`;
    return {
      ok: true,
      bookingUrl,
      fullBookingUrl: `${getBaseUrl()}${bookingUrl}`,
      token,
    };
  }

  async buildMiamAvailabilityPreviewForAcknowledgement(
    token: string,
    options: { mediatorId?: string } = {},
  ): Promise<MiamAvailabilityPreview> {
    try {
      const serviceTypes = await storage.listServiceTypes();
      const miamServices = serviceTypes
        .filter((service) => service.isActive && service.category === "MIAM" && isPublicNewCaseBookingServiceName(service.name) && hasOnlinePaymentPrice(service))
        .sort((a, b) => {
          if (a.name === "MIAM") return -1;
          if (b.name === "MIAM") return 1;
          return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
        });

      const buildRows = async (mediatorId: string | undefined): Promise<{ serviceTypeId: string | null; rows: MiamAvailabilityPreviewRow[] }> => {
        for (const service of miamServices) {
        const rows: MiamAvailabilityPreviewRow[] = [];
        const now = new Date();
        for (let offset = 0; offset < 6 && rows.length < 3; offset++) {
          const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
          const month = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
          const datesResult = await availabilityService.getAvailableDates(service.id, month, { mediatorIdScope: mediatorId });
          if (datesResult.bookingPaused) continue;
          for (const date of datesResult.dates) {
            if (rows.length >= 3) break;
            const slots = await availabilityService.getAvailableSlots(service.id, date, { mediatorIdScope: mediatorId });
            if (slots.length === 0) continue;
            const query = `serviceTypeId=${encodeURIComponent(service.id)}&date=${encodeURIComponent(date)}`;
            rows.push({
              date,
              displayDate: formatPreviewDate(date),
              times: slots.slice(0, 4).map((slot) => slot.time),
              url: `${getBaseUrl()}/book/${token}?${query}`,
            });
          }
        }
          if (rows.length) return { serviceTypeId: service.id, rows };
        }
        return { serviceTypeId: null, rows: [] };
      };

      if (options.mediatorId) {
        const scoped = await buildRows(options.mediatorId);
        if (scoped.rows.length) return { ...scoped, mediatorId: options.mediatorId, source: "lead_mediator" };
      }
      const general = await buildRows(undefined);
      return { ...general, mediatorId: null, source: "general" };
    } catch (err) {
      console.error("[Booking] MIAM availability preview failed:", err);
    }
    return { serviceTypeId: null, rows: [], mediatorId: null, source: "general" };
  }

  async generateBookingLink(
    partyId: string,
    actor: Actor,
    options: { sendEmail?: boolean } = {},
  ): Promise<ServiceResult<{ bookingUrl: string; token: string; emailSent: boolean }>> {
    const party = await storage.getParty(partyId);
    if (!party) return { ok: false, error: "Party not found", status: 404 };

    const token = crypto.randomUUID();

    await storage.updateParty(party.id, {
      bookingToken: token,
      bookingTokenExpiresAt: null,
    });

    const bookingPath = `/book/${token}`;
    const fullBookingUrl = `${getBaseUrl()}${bookingPath}`;

    const linkedCase = await storage.getCase(party.caseId);
    const caseRefWithRole = linkedCase?.caseRef
      ? formatCaseRefWithRole(linkedCase.caseRef, party.role)
      : undefined;

    let emailSent = false;
    if (options.sendEmail !== false && party.email) {
      const { sendBookingLinkEmail } = await import("./email.service");
      emailSent = await sendBookingLinkEmail(party.email, party.firstName, fullBookingUrl, "Mediation Appointment", caseRefWithRole);
      if (!emailSent) {
        console.error(`[Booking] Booking link email failed to send for ${party.email}`);
      } else {
        const { caseActivityService } = await import("./case-activity.service");
        caseActivityService.logEmailSent(party.caseId, party.email, "Booking Link Sent", party.firstName, actor).catch(() => {});
      }
    }

    return { ok: true, bookingUrl: bookingPath, token, emailSent };
  }

  async generateMiamRenewalBookingLink(
    partyId: string,
    actor: Actor,
    options: { sendEmail?: boolean } = {},
  ): Promise<ServiceResult<{ bookingUrl: string; token: string; emailSent: boolean }>> {
    const party = await storage.getParty(partyId);
    if (!party) return { ok: false, error: "Party not found", status: 404 };

    const { caseService } = await import("./case.service");
    const validity = await caseService.getPartyMiamValidity(party.caseId);
    const partyValidity = validity.find((item) => item.partyId === party.id);
    if (!partyValidity?.renewalBookingAvailable) {
      return { ok: false, error: "A repeat MIAM booking is only available after the current MIAM has expired.", status: 409 };
    }

    return this.generateBookingLink(partyId, actor, options);
  }

  async generateFreshMiamSelfServiceBookingLink(
    partyId: string,
    actor: Actor,
    options: { sendEmail?: boolean } = {},
  ): Promise<ServiceResult<{ bookingUrl: string; token: string; emailSent: boolean }>> {
    const party = await storage.getParty(partyId);
    if (!party) return { ok: false, error: "Party not found", status: 404 };

    const { caseService } = await import("./case.service");
    const validity = await caseService.getPartyMiamValidity(party.caseId);
    const partyValidity = validity.find((item) => item.partyId === party.id);
    if (partyValidity?.valid) {
      return { ok: false, error: "Your MIAM is already valid for court applications.", status: 409 };
    }
    if (partyValidity?.renewalBookingAvailable) {
      return { ok: false, error: "Please use the repeat MIAM booking option for an expired MIAM.", status: 409 };
    }

    const [appointments, serviceTypes] = await Promise.all([
      storage.listAppointmentsByCase(party.caseId),
      storage.listServiceTypes(),
    ]);
    const serviceNameById = new Map(serviceTypes.map((service) => [service.id, service.name]));
    if (appointments.some((appointment) => appointment.partyId === party.id && isActiveMiamBookingBlocker(appointment, serviceNameById))) {
      return { ok: false, error: "You already have an active MIAM booking.", status: 409 };
    }

    return this.generateBookingLink(partyId, actor, { ...options, sendEmail: false });
  }

  async validateBookingToken(token: string): Promise<ServiceResult<{
    partyId: string;
    partyRole: string;
    clientId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    email: string;
    phone: string;
    addressLine1: string;
    postcode: string;
    caseId: string;
    caseRef: string;
    caseType: string;
    caseSubtype: string;
    caseDescription: string;
    howHeard: string;
  }>> {
    const party = await storage.getPartyByBookingToken(token);

    if (!party) {
      return { ok: false, error: "Invalid or expired booking link", status: 404 };
    }

    const caseData = await storage.getCase(party.caseId);
    if (!caseData) {
      return { ok: false, error: "Associated case not found", status: 404 };
    }

    const demographic = await storage.getDemographicDataByParty(party.id);
    const existingMiamRecord = await storage.getCurrentMiamRecord(party.id, party.caseId);
    const stableMiamRenewalPrefill = buildStableMiamRenewalPrefill(existingMiamRecord);

    return {
      ok: true,
      partyId: party.id,
      partyRole: party.role,
      clientId: party.clientId,
      firstName: party.firstName,
      lastName: party.lastName,
      dateOfBirth: party.dateOfBirth || demographic?.dateOfBirth || "",
      email: party.email || "",
      phone: party.phone || "",
      addressLine1: party.addressLine1 || "",
      postcode: party.postcode || "",
      caseId: party.caseId,
      caseRef: caseData.caseRef,
      caseType: caseData.mediationCategory || "",
      caseSubtype: caseData.mediationCategory === "Family"
        ? normalizeFamilyCaseSubtype(caseData.familySubType) || ""
        : caseData.familySubType || caseData.workplaceSubType || caseData.civilSubType || caseData.commercialSubType || "",
      caseDescription: stripBookingOnboardingDescriptionMarker(stableMiamRenewalPrefill.introNotes),
      howHeard: caseData.leadSource || "",
    };
  }

  async getAvailableSlots(token: string, serviceTypeId: string, date: string): Promise<ServiceResult<{ slots: Awaited<ReturnType<typeof availabilityService.getAvailableSlots>> }>> {
    const validation = await this.validateBookingToken(token);
    if (!validation.ok) return validation;

    const serviceType = await storage.getServiceType(serviceTypeId);
    if (!serviceType || !serviceType.isActive || !isPublicNewCaseBookingServiceName(serviceType.name)) {
      return { ok: false, error: "This service is not available for new-case booking links", status: 400 };
    }
    if (!hasOnlinePaymentPrice(serviceType)) {
      return { ok: false, error: "This service is not configured for online payment", status: 400 };
    }

    const slots = await availabilityService.getAvailableSlots(serviceTypeId, date);
    return { ok: true, slots };
  }

  async getActiveBookingLinkAppointment(token: string, partyId: string): Promise<Appointment | undefined> {
    return storage.getActiveAppointmentByPartyAndBookingToken(partyId, token);
  }

  async createBookingAppointment(
    token: string,
    serviceTypeId: string,
    dateTime: string,
    mode: PublicBookingMode = "stripe_checkout",
    onboardingDetails?: unknown,
    timeBasis?: BookingTimeBasis,
  ): Promise<ServiceResult<{ appointmentId: string; dateTime: Date; timeBasis: BookingTimeBasis; duration: number; serviceTypeName: string; status: string; holdExpiresAt: Date; paymentProvider?: string | null; checkoutUrl?: string; xeroInvoiceUrl?: string | null; xeroInvoiceNumber?: string | null; xeroInvoiceEmailSent?: boolean }>> {
    const validDuration = 60;

    const validation = await this.validateBookingToken(token);
    if (!validation.ok) return validation;

    const existingAppointment = await this.getActiveBookingLinkAppointment(token, validation.partyId);
    if (existingAppointment) {
      return {
        ok: false,
        error: BOOKING_LINK_ALREADY_USED_MESSAGE,
        status: 409,
      };
    }

    const onboarding = validateBookingOnboardingDetails(onboardingDetails, validation.partyRole);
    if (!onboarding.ok) {
      return {
        ok: false,
        error: "Missing required booking details",
        status: 400,
      };
    }

    const serviceType = await storage.getServiceType(serviceTypeId);
    if (!serviceType || !serviceType.isActive) {
      return { ok: false, error: "Service type not found or inactive", status: 400 };
    }
    if (!isPublicNewCaseBookingServiceName(serviceType.name)) {
      return { ok: false, error: "This service is not available for new-case booking links", status: 400 };
    }
    if (!hasOnlinePaymentPrice(serviceType)) {
      return { ok: false, error: "This service is not configured for online payment", status: 400 };
    }

    const allMediatorServices = await storage.listAllMediatorServices();
    const qualifiedMediatorIds = allMediatorServices
      .filter(ms => ms.serviceTypeId === serviceTypeId)
      .map(ms => ms.mediatorId);

    if (qualifiedMediatorIds.length === 0) {
      return { ok: false, error: "No qualified mediators available for this service", status: 400 };
    }

    const appointmentDate = new Date(dateTime);
    if (isNaN(appointmentDate.getTime())) {
      return { ok: false, error: "Invalid date/time", status: 400 };
    }

    if (appointmentDate < new Date()) {
      return { ok: false, error: "Cannot book appointments in the past", status: 400 };
    }

    if (
      appointmentDate.getUTCMinutes() % 15 !== 0 ||
      appointmentDate.getUTCSeconds() !== 0 ||
      appointmentDate.getUTCMilliseconds() !== 0
    ) {
      return { ok: false, error: "Appointments must start on a 15-minute boundary (e.g., 09:00, 09:15, 09:30)", status: 400 };
    }

    // Refuse bookings before any writes if the party has no email — we
    // cannot send the Xero payment link or later calendar invite without one.
    const partyForPrecheck = await storage.getParty(validation.partyId);
    if (!partyForPrecheck?.email) {
      return {
        ok: false,
        error: "We need an email address on file before we can issue your payment link. Please contact Brighter Future Mediation to add your email, then book again.",
        status: 400,
      };
    }

    const match = await availabilityService.findMediatorForSlot(serviceTypeId, appointmentDate, { timeBasis });
    if (!match) {
      return { ok: false, error: "This time slot is no longer available. Please choose another time.", status: 409 };
    }
    const selectedMediatorId = match.mediatorId;

    const persisted = await this.persistBookingOnboardingDetails(
      validation.partyId,
      validation.caseId,
      onboarding.data,
    );
    if (!persisted.ok) return persisted;
    await financialDisclosureService.ensureFinancialDisclosureFoldersForCase(validation.caseId, "booking_onboarding");

    const bookingMode = "hold" as const;
    const holdExpiresAt = calculatePublicBookingHoldDeadline(appointmentDate);
    const selectedMediator = await storage.getUser(selectedMediatorId);
    const bookingPaymentProvider: BookingPaymentProvider = mode === "stripe_checkout"
      ? await paymentSettingsService.getBookingPaymentProvider()
      : "xero_invoice";
    const appointmentPaymentProvider = mode === "stripe_checkout"
      ? bookingPaymentProvider === "direct_stripe_checkout" ? "stripe" : "xero_stripe"
      : null;

    const isCalendarBacked = !!match.parentGoogleEventId
      && !!match.parentCalendarProvider
      && !!match.parentEventStart
      && !!match.parentEventEnd;

    let appointment: Awaited<ReturnType<typeof storage.createAppointment>>;
    try {
      appointment = await storage.createAppointment({
        caseId: validation.caseId,
        partyId: validation.partyId,
        serviceTypeId,
        mediatorId: selectedMediatorId,
        dateTime: appointmentDate,
        dateTimeBasis: match.timeBasis,
        duration: validDuration,
        status: bookingMode,
        holdExpiresAt,
        bookingToken: token,
        paymentStatus: "payment_pending",
        paymentProvider: appointmentPaymentProvider,
        paymentAmountPence: serviceType.paymentAmountPence,
        paymentCurrency: serviceType.paymentCurrency || "gbp",
        notes: `Booked by client via booking link (payment hold)`,
        meetingLink: selectedMediator?.zoomLink || null,
        parentGoogleEventId: isCalendarBacked ? match.parentGoogleEventId! : null,
        parentCalendarProvider: isCalendarBacked ? match.parentCalendarProvider! : null,
        parentEventOriginalStart: isCalendarBacked ? match.parentEventStart! : null,
        parentEventOriginalEnd: isCalendarBacked ? match.parentEventEnd! : null,
        parentEventOriginalTitle: isCalendarBacked ? (match.parentEventTitle ?? null) : null,
        availabilitySourceId: match.availabilitySourceId ?? null,
        availabilityReservationMode: match.availabilityReservationMode ?? (isCalendarBacked ? "split_restore" : null),
      });
    } catch (err: unknown) {
      const e = err as { code?: string; constraint?: string; constraint_name?: string; message?: string };
      const constraintName = e?.constraint ?? e?.constraint_name ?? "";
      const isUniqueViolation = e?.code === "23505";
      if (isUniqueViolation && constraintName === "appointments_active_mediator_slot_unique") {
        return { ok: false, error: "This time slot was just taken. Please choose another time.", status: 409 };
      }
      if (isUniqueViolation && constraintName === "appointments_active_party_booking_token_unique") {
        return { ok: false, error: BOOKING_LINK_ALREADY_USED_MESSAGE, status: 409 };
      }
      throw err;
    }

    const party = await storage.getParty(validation.partyId);
    const clientName = party ? `${party.firstName} ${party.lastName}` : "Client";
    let checkoutUrl: string | undefined;
    let xeroInvoiceUrl: string | null | undefined;
    let xeroInvoiceNumber: string | null | undefined;
    let xeroInvoiceEmailSent: boolean | undefined;
    if (mode === "stripe_checkout") {
      if (bookingPaymentProvider === "direct_stripe_checkout") {
        const checkout = await stripePaymentService.createBookingCheckoutSession({
            appointment,
            serviceType,
            caseRef: validation.caseRef,
            partyId: validation.partyId,
            partyEmail: party?.email || validation.email,
            partyName: clientName,
            bookingToken: token,
          })
          .catch((err): ServiceResult<{ checkoutUrl: string; checkoutSessionId: string }> => ({
            ok: false,
            error: err instanceof Error ? err.message : "Could not create the Stripe Checkout Session",
            status: 502,
          }));
        if (!checkout.ok) {
          await storage.deleteAppointment(appointment.id);
          return checkout;
        }
        checkoutUrl = checkout.checkoutUrl;
      } else {
        const invoice = await xeroService.createInvoiceForAppointment({
          appointment,
          serviceType,
          caseRef: validation.caseRef,
          partyId: validation.partyId,
          partyEmail: party?.email || validation.email,
          partyName: clientName,
          })
          .catch((err): ServiceResult<{ record: never; invoiceUrl: string | null; emailSent: boolean }> => ({
            ok: false,
            error: err instanceof Error ? err.message : "Could not create the Xero invoice",
            status: 502,
          }));
        if (!invoice.ok) {
          await storage.deleteAppointment(appointment.id);
          return invoice;
        }
        xeroInvoiceUrl = invoice.invoiceUrl;
        xeroInvoiceNumber = invoice.record.xeroInvoiceNumber;
        xeroInvoiceEmailSent = invoice.emailSent;
      }
    }

    await this.autoProgressCaseStage(validation.caseId, validation.partyId, serviceType.category, appointment.id);
    await this.autoAssignMediator(validation.caseId, validation.caseRef, validation.partyId, selectedMediatorId, serviceType.category, appointment.id);

    return {
      ok: true,
      appointmentId: appointment.id,
      dateTime: appointmentDate,
      timeBasis: match.timeBasis,
      duration: validDuration,
      serviceTypeName: serviceType.name,
      status: bookingMode,
      holdExpiresAt,
      paymentProvider: appointmentPaymentProvider,
      checkoutUrl,
      xeroInvoiceUrl,
      xeroInvoiceNumber,
      xeroInvoiceEmailSent,
    };
  }

  private async persistBookingOnboardingDetails(
    partyId: string,
    caseId: string,
    details: BookingOnboardingDetails,
  ): Promise<ServiceResult<{ saved: true }>> {
    const party = await storage.getParty(partyId);
    if (!party) return { ok: false, error: "Party not found", status: 404 };

    const name = splitFullName(details.fullName);

    try {
      await storage.updateClient(party.clientId, {
        firstName: name.firstName || party.firstName,
        lastName: name.lastName || party.lastName,
        dateOfBirth: details.dateOfBirth,
        email: details.email,
        phone: details.phone,
        addressLine1: details.addressLine1,
        postcode: details.postcode,
      });

      await storage.upsertDemographicData(partyId, caseId, {
        dateOfBirth: details.dateOfBirth,
        familyCaseSubtype: details.caseType === "Family" ? normalizeFamilyCaseSubtype(details.caseSubtype) : null,
        workplaceCaseSubtype: details.caseType === "Workplace" ? details.caseSubtype : null,
        ...(party.role === "A" ? { childrenAges: details.childrenDetails || null } : {}),
        completedBy: `${details.fullName} (booking link)`,
        completedAt: new Date(),
      });

      const existingMiamRecord = await storage.getCurrentMiamRecord(partyId, caseId);
      const { caseService } = await import("./case.service");
      const validity = await caseService.getPartyMiamValidity(caseId);
      const partyValidity = validity.find((item) => item.partyId === partyId);
      const baseMiamData = {
        ...buildStableMiamRenewalPrefill(existingMiamRecord),
        clientName: details.fullName,
        clientFirstName: name.firstName,
        clientLastName: name.lastName,
        clientDob: details.dateOfBirth,
        clientAddress: [details.addressLine1, details.postcode].filter(Boolean).join(", "),
        clientPhone: details.phone,
        ...(party.role === "A" ? {
          howHeardAboutBfm: details.howHeard,
          introNotes: details.caseDescription,
          bgChildrenDetails: details.childrenDetails || null,
        } : {}),
        caseType: details.caseType === "Family"
          ? normalizeFamilyCaseSubtype(details.caseSubtype) || details.caseType
          : details.caseSubtype || details.caseType,
      };

      if (partyValidity?.renewalBookingAvailable) {
        await this.createRenewalMiamRecordFromBooking(partyId, caseId, baseMiamData);
      } else {
        await storage.upsertMiamRecord(partyId, caseId, baseMiamData);
      }

      await caseService.refreshCaseFilterCache(caseId);

      return { ok: true, saved: true };
    } catch (err) {
      console.error("[Booking] Failed to persist onboarding details:", err);
      return {
        ok: false,
        error: "Could not save your booking details. Please check the form and try again.",
        status: 500,
      };
    }
  }

  private async createRenewalMiamRecordFromBooking(
    partyId: string,
    caseId: string,
    data: Partial<MiamRecord>,
  ) {
    return storage.createRenewalMiamRecord(partyId, caseId, data);
  }

  private async autoProgressCaseStage(
    caseId: string,
    partyId: string,
    serviceCategory: string,
    appointmentId: string
  ): Promise<void> {
    if (serviceCategory !== "MIAM") return;

    try {
      const party = await storage.getParty(partyId);
      if (!party) return;

      const caseData = await storage.getCase(caseId);
      if (!caseData) return;

      const currentStageIdx = (CASE_STAGES as readonly string[]).indexOf(caseData.stage);

      if (currentStageIdx < 0) {
        console.warn(`[Booking] Skipping auto-progression for case ${caseData.caseRef}: unknown current stage "${caseData.stage}"`);
        return;
      }

      let targetStage: string | null = null;

      if (party.role === "A") {
        targetStage = "Client A MIAM booked";
      } else if (party.role === "B") {
        targetStage = "Client B MIAM booked";
      }

      if (!targetStage) return;

      const targetIdx = (CASE_STAGES as readonly string[]).indexOf(targetStage);
      if (targetIdx < 0) return;

      if (currentStageIdx >= targetIdx) return;

      await storage.updateCaseStage(caseId, targetStage);

      await logAudit({
        action: "update_stage",
        entity: "case",
        entityId: caseId,
        entityRef: caseData.caseRef,
        details: JSON.stringify({
          previousStage: caseData.stage,
          newStage: targetStage,
          trigger: "miam_booking",
          appointmentId,
          partyRole: party.role,
        }),
      });

      try {
        const { caseActivityService } = await import("./case-activity.service");
        await caseActivityService.logStageChanged(
          caseId,
          caseData.caseRef,
          caseData.stage,
          targetStage,
          systemActor("auto stage advance — MIAM booked")
        );
      } catch (err) {
        console.error("[Booking] Failed to log stage_changed activity:", err);
      }

      console.log(`[Booking] Auto-progressed case ${caseData.caseRef} from "${caseData.stage}" to "${targetStage}" (Client ${party.role} MIAM booked)`);
    } catch (err) {
      console.error("[Booking] Failed to auto-progress case stage:", err);
    }
  }

  private async autoAssignMediator(
    caseId: string,
    caseRef: string,
    partyId: string,
    mediatorId: string,
    serviceCategory: string,
    appointmentId: string
  ): Promise<void> {
    try {
      const caseData = await storage.getCase(caseId);
      if (!caseData) return;

      const mediator = await storage.getUser(mediatorId);
      const mediatorName = mediator?.name || "Unknown";

      if (serviceCategory === "MIAM") {
        const party = await storage.getParty(partyId);
        if (party && !party.miamMediatorId) {
          await storage.updateParty(partyId, { miamMediatorId: mediatorId });
          await logAudit({
            action: "assign_miam_mediator",
            entity: "party",
            entityId: partyId,
            entityRef: `${caseRef}-${party.role}`,
            details: JSON.stringify({
              mediatorId,
              mediatorName,
              partyRole: party.role,
              trigger: "miam_booking",
              appointmentId,
            }),
          });
          console.log(`[Booking] Auto-assigned MIAM mediator ${mediatorName} to party ${party.role} on case ${caseRef}`);
        }
      }
    } catch (err) {
      console.error("[Booking] Failed to auto-assign mediator:", err);
    }
  }

  async autoUnassignMediator(
    appt: Appointment,
    trigger: "miam_booking_cancelled" | "miam_booking_deleted",
  ): Promise<void> {
    try {
      if (!appt.partyId || !appt.mediatorId || !appt.serviceTypeId) return;

      const serviceTypes = await storage.listServiceTypes();
      const serviceType = serviceTypes.find(s => s.id === appt.serviceTypeId);
      if (!serviceType || serviceType.category !== "MIAM") return;

      const party = await storage.getParty(appt.partyId);
      if (!party || party.miamMediatorId !== appt.mediatorId) return;

      const miamServiceIds = new Set(
        serviceTypes.filter(s => s.category === "MIAM").map(s => s.id),
      );
      const partyAppts = await storage.listAppointmentsByPartyIds([appt.partyId]);
      const hasOtherActiveMiam = partyAppts.some(a =>
        a.id !== appt.id &&
        a.mediatorId === appt.mediatorId &&
        !!a.serviceTypeId && miamServiceIds.has(a.serviceTypeId) &&
        (a.status === "hold" || a.status === "held" || a.status === "confirmed"),
      );
      if (hasOtherActiveMiam) return;

      const caseData = await storage.getCase(appt.caseId);
      const caseRef = caseData?.caseRef ?? "unknown";
      const mediator = await storage.getUser(appt.mediatorId);
      const mediatorName = mediator?.name || "Unknown";

      await storage.updateParty(appt.partyId, { miamMediatorId: null });

      await logAudit({
        action: "unassign_miam_mediator",
        entity: "party",
        entityId: appt.partyId,
        entityRef: `${caseRef}-${party.role}`,
        details: JSON.stringify({
          mediatorId: appt.mediatorId,
          mediatorName,
          partyRole: party.role,
          trigger,
          appointmentId: appt.id,
        }),
      });

      const { caseActivityService } = await import("./case-activity.service");
      const verb = trigger === "miam_booking_cancelled" ? "cancelled" : "deleted";
      await caseActivityService.log({
        caseId: appt.caseId,
        type: "miam_mediator_unassigned",
        title: "MIAM mediator unassigned",
        description: `MIAM mediator ${mediatorName} unassigned from ${party.role} after appointment ${verb}`,
        relatedEntityId: appt.id,
        relatedEntityType: "appointment",
        metadata: JSON.stringify({
          mediatorId: appt.mediatorId,
          mediatorName,
          partyRole: party.role,
          trigger,
        }),
        actor: systemActor("MIAM auto-unassign"),
      });

      console.log(`[Booking] Auto-unassigned MIAM mediator ${mediatorName} from party ${party.role} on case ${caseRef} (${trigger})`);
    } catch (err) {
      console.error("[Booking] Failed to auto-unassign mediator:", err);
    }
  }
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export const bookingService = new BookingService();
