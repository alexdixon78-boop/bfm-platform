import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import { logAudit } from "./audit-log.service";
import { storage } from "../storage";
import { notificationService } from "./notification.service";
import { caseActivityService, staffActor, systemActor, type Actor } from "./case-activity.service";
import { paymentSettingsService } from "./payment-settings.service";
import {
  appointments,
  caseInvoiceLineItems,
  caseInvoices,
  casePayments,
  cases,
  clients,
  mediationSessionPartyAttendance,
  mediationSessions,
  parties,
  serviceTypes,
  xeroInvoiceRecords,
  type CaseInvoice,
  type CasePayment,
  type Appointment,
  type ServiceType,
  type User,
} from "@shared/schema";
import type { ServiceResult } from "./types";

type InvoiceLineInput = {
  serviceTypeId?: string | null;
  description: string;
  quantity: number;
  unitAmountPence: number;
  vatRate?: number | null;
};

type InvoiceInput = {
  caseId: string;
  billToClientId: string;
  billToPartyId?: string | null;
  serviceTypeId?: string | null;
  appointmentId?: string | null;
  provider?: string;
  providerInvoiceId?: string | null;
  paymentLinkUrl?: string | null;
  paymentStatus?: string;
  failureReason?: string | null;
  status?: string;
  issueDate?: Date;
  dueDate?: Date | null;
  currency?: string;
  notes?: string | null;
  lineItems: InvoiceLineInput[];
};

type PaymentInput = {
  caseId: string;
  clientId: string;
  partyId?: string | null;
  invoiceId?: string | null;
  appointmentId?: string | null;
  amountPence: number;
  currency?: string;
  paymentDate?: Date;
  method?: string;
  provider?: string;
  providerPaymentId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  paymentStatus?: string;
  failureReason?: string | null;
  refundedAmountPence?: number;
  refundedAt?: Date | null;
  receiptNumber?: string | null;
  receiptGeneratedAt?: Date | null;
  reference?: string | null;
  notes?: string | null;
  overrideNoShowNoRefund?: boolean;
  refundOverrideReason?: string | null;
};

type BookingProvider = "stripe" | "xero_stripe";

type BookingInvoiceInput = {
  appointment: Appointment;
  serviceType: ServiceType;
  caseRef: string;
  partyId: string;
  provider: BookingProvider;
  providerInvoiceId?: string | null;
  paymentLinkUrl?: string | null;
  paymentStatus?: string;
  failureReason?: string | null;
};

type BookingPaymentInput = {
  appointment: Appointment;
  provider: BookingProvider;
  providerPaymentId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  paymentDate?: Date;
  amountPence?: number | null;
  currency?: string | null;
  reference?: string | null;
};

type MediationSessionInvoiceCheckoutContext = {
  invoice: CaseInvoice;
  appointment: Appointment;
  serviceType: ServiceType;
  caseRef: string;
  partyId: string;
  partyEmail: string;
  partyName: string;
  mediationSessionId: string | null;
};

type MediationSessionAutoConfirmation = {
  attempted: true;
  confirmed: boolean;
  reason?: string;
  error?: string;
};

type CasePartyClient = {
  partyId: string;
  role: string;
  clientId: string;
  clientName: string;
};

type FinanceEventInput = {
  caseId: string;
  partyId?: string | null;
  appointmentId?: string | null;
  type: string;
  title: string;
  message: string;
  urgency?: "green" | "amber" | "red";
  relatedEntityId?: string | null;
  relatedEntityType?: string;
  metadata?: Record<string, unknown>;
  actor?: Actor;
  notifyClient?: boolean;
};

function money(value: number | null | undefined): number {
  return Math.max(0, Number(value) || 0);
}

function formatPaymentAmountForActivity(amountPence: number, currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: (currency || "gbp").toUpperCase(),
  }).format(money(amountPence) / 100);
}

function computeLine(line: InvoiceLineInput) {
  const quantity = Math.max(1, Math.trunc(line.quantity || 1));
  const unitAmountPence = money(line.unitAmountPence);
  const lineSubtotalPence = quantity * unitAmountPence;
  const vatRate = line.vatRate === null || line.vatRate === undefined ? null : Math.max(0, Math.min(100, Math.trunc(line.vatRate)));
  const vatAmountPence = vatRate === null ? 0 : Math.round(lineSubtotalPence * vatRate / 100);
  return {
    quantity,
    unitAmountPence,
    vatRate,
    vatAmountPence,
    lineSubtotalPence,
    lineTotalPence: lineSubtotalPence + vatAmountPence,
  };
}

function statusFromTotals(invoice: Pick<CaseInvoice, "status" | "totalPence" | "amountPaidPence" | "dueDate">) {
  if (invoice.status === "void" || invoice.status === "draft") return invoice.status;
  const total = money(invoice.totalPence);
  const paid = money(invoice.amountPaidPence);
  if (total > 0 && paid >= total) return "paid";
  if (paid > 0) return "part_paid";
  if (invoice.dueDate && new Date(invoice.dueDate).getTime() < Date.now()) return "overdue";
  return "issued";
}

function normalizeCaseRefForInvoice(caseRef: string): string {
  return caseRef.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

export class FinanceService {
  async markMediationSessionNoShowNoRefund(input: {
    caseId: string;
    mediationSessionId: string;
    partyId: string;
    actor: Pick<User, "id" | "name" | "role">;
    ipAddress?: string;
  }): Promise<void> {
    const sessions = await storage.listMediationSessionsByCase(input.caseId);
    const session = sessions.find((row) => row.id === input.mediationSessionId);
    if (!session?.appointmentId) return;

    const invoices = await this.listInvoicesByAppointment(session.appointmentId);
    const invoice = invoices.find((row) => row.billToPartyId === input.partyId);
    if (!invoice) return;
    const payments = await db.select().from(casePayments).where(eq(casePayments.invoiceId, invoice.id));
    const paidPayments = payments.filter((payment) => payment.paymentStatus === "paid");
    if (paidPayments.length === 0 && invoice.paymentStatus !== "paid") return;

    const marker = "no_show_no_refund";
    for (const payment of paidPayments) {
      if ((payment.notes || "").includes(marker)) continue;
      await db.update(casePayments).set({
        notes: [payment.notes, marker].filter(Boolean).join("\n"),
        updatedAt: new Date(),
      }).where(eq(casePayments.id, payment.id));
    }

    await logAudit({
      userId: input.actor.id,
      action: "mediation_session_no_show_no_refund_recorded",
      entity: "case_invoice",
      entityId: invoice.id,
      entityRef: invoice.invoiceNumber,
      details: JSON.stringify({ caseId: input.caseId, mediationSessionId: input.mediationSessionId, partyId: input.partyId }),
      ipAddress: input.ipAddress,
    });
    await this.emitFinanceEvent({
      caseId: input.caseId,
      partyId: input.partyId,
      appointmentId: session.appointmentId,
      type: "mediation_session_no_show_no_refund_recorded",
      title: "No-show no-refund recorded",
      message: `${invoice.invoiceNumber} is marked non-refundable because the client did not attend the mediation session.`,
      urgency: "amber",
      relatedEntityId: invoice.id,
      relatedEntityType: "case_invoice",
      metadata: { invoiceNumber: invoice.invoiceNumber, mediationSessionId: input.mediationSessionId, partyId: input.partyId, policy: marker },
      actor: staffActor(input.actor),
      notifyClient: false,
    });
  }

  private async hasMediationSessionNoShowNoRefund(input: {
    caseId: string;
    partyId?: string | null;
    appointmentId?: string | null;
    invoiceId?: string | null;
  }): Promise<boolean> {
    const invoice = input.invoiceId ? await this.getInvoice(input.invoiceId) : null;
    const partyId = input.partyId || invoice?.billToPartyId || null;
    const appointmentId = input.appointmentId || invoice?.appointmentId || null;
    if (!partyId || !appointmentId) return false;
    const [session] = await db.select({ id: mediationSessions.id }).from(mediationSessions).where(eq(mediationSessions.appointmentId, appointmentId)).limit(1);
    if (!session) return false;
    const rows = await db.select({ id: mediationSessionPartyAttendance.id }).from(mediationSessionPartyAttendance).where(and(
      eq(mediationSessionPartyAttendance.caseId, input.caseId),
      eq(mediationSessionPartyAttendance.mediationSessionId, session.id),
      eq(mediationSessionPartyAttendance.partyId, partyId),
      eq(mediationSessionPartyAttendance.status, "no_show"),
    )).limit(1);
    return rows.length > 0;
  }

  private async assertRefundAllowed(input: {
    caseId: string;
    partyId?: string | null;
    appointmentId?: string | null;
    invoiceId?: string | null;
    overrideNoShowNoRefund?: boolean;
    refundOverrideReason?: string | null;
    actor: User;
  }): Promise<ServiceResult<{}>> {
    const blockedByNoShow = await this.hasMediationSessionNoShowNoRefund(input);
    if (!blockedByNoShow) return { ok: true };
    if (!input.overrideNoShowNoRefund || !input.refundOverrideReason?.trim()) {
      return { ok: false, error: "No-show no-refund rule requires an admin override reason", status: 409 };
    }
    await logAudit({
      userId: input.actor.id,
      action: "override_no_show_no_refund",
      entity: "case_payment",
      details: JSON.stringify({
        caseId: input.caseId,
        partyId: input.partyId || null,
        appointmentId: input.appointmentId || null,
        invoiceId: input.invoiceId || null,
        reason: input.refundOverrideReason.trim(),
      }),
    });
    return { ok: true };
  }

  private async emitFinanceEvent(input: FinanceEventInput): Promise<void> {
    await caseActivityService.log({
      caseId: input.caseId,
      type: input.type,
      title: input.title,
      description: input.message,
      relatedEntityId: input.relatedEntityId || null,
      relatedEntityType: input.relatedEntityType || "finance",
      metadata: JSON.stringify(input.metadata || {}),
      actor: input.actor || systemActor("finance"),
    });

    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: input.type,
      urgency: input.urgency || "green",
      caseId: input.caseId,
      appointmentId: input.appointmentId || null,
      title: input.title,
      message: input.message,
      caseNoteRequired: false,
    });

    if (input.notifyClient && input.partyId) {
      const party = await storage.getParty(input.partyId);
      if (party?.userId) {
        await notificationService.createNotification({
          recipientId: party.userId,
          recipientRole: "client",
          type: input.type,
          urgency: input.urgency === "red" ? "amber" : "green",
          caseId: input.caseId,
          appointmentId: input.appointmentId || null,
          title: input.title,
          message: input.message,
          caseNoteRequired: false,
        });
      }
    }
  }

  async getCaseFinance(caseId: string): Promise<ServiceResult<Awaited<ReturnType<FinanceService["buildCaseFinance"]>>>> {
    const existingCase = await this.getCase(caseId);
    if (!existingCase) return { ok: false, error: "Case not found", status: 404 };
    return { ok: true, ...(await this.buildCaseFinance(caseId)) };
  }

  async getCaseFinanceForUser(caseId: string, user: Pick<User, "id" | "role">): Promise<ServiceResult<Awaited<ReturnType<FinanceService["buildCaseFinance"]>>>> {
    const existingCase = await this.getCase(caseId);
    if (!existingCase) return { ok: false, error: "Case not found", status: 404 };
    if (user.role === "client") {
      const userParties = await storage.listPartiesByUserId(user.id);
      const caseParty = userParties.find((party) => party.caseId === caseId);
      if (!caseParty) return { ok: false, error: "Access denied", status: 403 };
      return { ok: true, ...(await this.buildCaseFinance(caseId, caseParty.clientId)) };
    }
    return { ok: true, ...(await this.buildCaseFinance(caseId)) };
  }

  async ensureBookingInvoice(input: BookingInvoiceInput): Promise<ServiceResult<{ invoice: CaseInvoice }>> {
    const party = await storage.getParty(input.partyId);
    if (!party?.clientId) return { ok: false, error: "Booking party/client not found", status: 400 };

    const amountPence = money(input.serviceType.paymentAmountPence);
    const currency = (input.serviceType.paymentCurrency || input.appointment.paymentCurrency || "gbp").toLowerCase();
    const invoiceNumber = await this.nextInvoiceNumberForAppointment(input.appointment.caseId, input.appointment.id);
    const existing = await this.getInvoiceByAppointment(input.appointment.id);
    const invoiceValues = {
      caseId: input.appointment.caseId,
      billToClientId: party.clientId,
      billToPartyId: input.partyId,
      serviceTypeId: input.serviceType.id,
      appointmentId: input.appointment.id,
      provider: input.provider,
      providerInvoiceId: input.providerInvoiceId || null,
      paymentLinkUrl: input.paymentLinkUrl || null,
      paymentStatus: input.paymentStatus || (input.appointment.paymentStatus === "paid" ? "paid" : "unpaid"),
      failureReason: input.failureReason || null,
      invoiceNumber,
      status: input.appointment.paymentStatus === "paid" ? "paid" : "issued",
      issueDate: new Date(),
      dueDate: input.appointment.holdExpiresAt || input.appointment.dateTime || null,
      subtotalPence: amountPence,
      vatTotalPence: 0,
      totalPence: amountPence,
      amountPaidPence: input.appointment.paymentStatus === "paid" ? amountPence : 0,
      outstandingPence: input.appointment.paymentStatus === "paid" ? 0 : amountPence,
      currency,
      notes: `Online booking invoice for ${input.serviceType.name}`,
      updatedAt: new Date(),
    };

    let invoice: CaseInvoice;
    if (existing) {
      [invoice] = await db.update(caseInvoices).set({
        billToClientId: invoiceValues.billToClientId,
        billToPartyId: invoiceValues.billToPartyId,
        serviceTypeId: invoiceValues.serviceTypeId,
        provider: invoiceValues.provider,
        providerInvoiceId: invoiceValues.providerInvoiceId,
        paymentLinkUrl: invoiceValues.paymentLinkUrl || existing.paymentLinkUrl,
        paymentStatus: invoiceValues.paymentStatus,
        failureReason: invoiceValues.failureReason,
        dueDate: invoiceValues.dueDate,
        currency: invoiceValues.currency,
        notes: invoiceValues.notes,
        updatedAt: new Date(),
      }).where(eq(caseInvoices.id, existing.id)).returning();
    } else {
      [invoice] = await db.insert(caseInvoices).values(invoiceValues).returning();
      await this.insertLineItems(invoice.id, [{
        serviceTypeId: input.serviceType.id,
        description: `${input.serviceType.name} booking`,
        quantity: 1,
        unitAmountPence: amountPence,
        vatRate: null,
      }]);
    }

    const recalculated = await this.recalculateInvoice(invoice.id);
    await logAudit({
      userId: null,
      action: existing ? "booking_invoice_synced" : "booking_invoice_created",
      entity: "case_invoice",
      entityId: invoice.id,
      entityRef: invoice.invoiceNumber,
      details: JSON.stringify({ appointmentId: input.appointment.id, provider: input.provider, clientId: party.clientId }),
    });
    if (!existing) {
      await this.emitFinanceEvent({
        caseId: input.appointment.caseId,
        partyId: input.partyId,
        appointmentId: input.appointment.id,
        type: "finance_invoice_created",
        title: "Payment invoice created",
        message: `${invoice.invoiceNumber} created for ${input.serviceType.name}.`,
        relatedEntityId: invoice.id,
        relatedEntityType: "case_invoice",
        metadata: { invoiceNumber: invoice.invoiceNumber, provider: input.provider, paymentStatus: invoice.paymentStatus },
        actor: systemActor(input.provider),
        notifyClient: !!input.paymentLinkUrl,
      });
    }
    return { ok: true, invoice: recalculated || invoice };
  }

  async ensureMediationSessionInvoices(input: {
    appointment: Appointment;
    serviceType: ServiceType;
    parties: Array<{ id: string; clientId: string }>;
    actor: Pick<User, "id" | "name" | "role">;
    reusableAppointmentIds?: string[];
  }): Promise<ServiceResult<{ invoices: CaseInvoice[] }>> {
    const amountPence = money(input.serviceType.paymentAmountPence);
    if (!input.serviceType.onlinePaymentEnabled || amountPence <= 0) {
      return { ok: false, error: "Mediation Sessions service type must have online payment enabled and a positive amount", status: 409 };
    }
    const caseRecord = await storage.getCase(input.appointment.caseId);
    const bookingPaymentProvider = await paymentSettingsService.getBookingPaymentProvider();
    const voucherDiscountPence = caseRecord?.voucherClaimEligible ? amountPence : 0;
    const payablePence = Math.max(0, amountPence - voucherDiscountPence);
    const zeroValueVoucherInvoice = caseRecord?.voucherClaimEligible && payablePence === 0;

    const reusableAppointmentIds = input.reusableAppointmentIds || [];
    const invoices: CaseInvoice[] = [];
    for (const party of input.parties) {
      const valid = await this.validateCaseClient(input.appointment.caseId, party.clientId, party.id);
      if (!valid.ok) return valid;

      const existing = await this.getInvoiceByAppointmentParty(input.appointment.id, party.id);
      if (existing) {
        invoices.push(existing);
        continue;
      }

      const reusable = reusableAppointmentIds.length > 0
        ? await this.getReusableMediationSessionInvoice(input.appointment.caseId, input.serviceType.id, party.id, reusableAppointmentIds)
        : undefined;
      if (reusable) {
        const carryForwardNote = `Mediation session invoice carried forward to replacement slot ${input.appointment.id}.`;
        const notes = reusable.notes?.includes(carryForwardNote)
          ? reusable.notes
          : [reusable.notes, carryForwardNote].filter(Boolean).join("\n");
        const [updated] = await db.update(caseInvoices).set({
          appointmentId: input.appointment.id,
          dueDate: input.appointment.holdExpiresAt || null,
          notes,
          updatedBy: input.actor.id,
          updatedAt: new Date(),
        }).where(eq(caseInvoices.id, reusable.id)).returning();
        invoices.push(updated);
        await logAudit({
          userId: input.actor.id,
          action: "mediation_session_invoice_reused",
          entity: "case_invoice",
          entityId: updated.id,
          entityRef: updated.invoiceNumber,
          details: JSON.stringify({ appointmentId: input.appointment.id, previousAppointmentId: reusable.appointmentId, partyId: party.id }),
        });
        await this.emitFinanceEvent({
          caseId: input.appointment.caseId,
          partyId: party.id,
          appointmentId: input.appointment.id,
          type: "finance_invoice_updated",
          title: "Mediation session invoice carried forward",
          message: `${updated.invoiceNumber} was carried forward to the replacement mediation session slot.`,
          urgency: "green",
          relatedEntityId: updated.id,
          relatedEntityType: "case_invoice",
          metadata: { invoiceNumber: updated.invoiceNumber, previousAppointmentId: reusable.appointmentId, appointmentId: input.appointment.id, paymentStatus: updated.paymentStatus },
          actor: staffActor(input.actor),
          notifyClient: false,
        });
        continue;
      }

      const invoiceNumber = await this.nextInvoiceNumber(input.appointment.caseId);
      const [invoice] = await db.insert(caseInvoices).values({
        caseId: input.appointment.caseId,
        billToClientId: party.clientId,
        billToPartyId: party.id,
        serviceTypeId: input.serviceType.id,
        appointmentId: input.appointment.id,
        provider: bookingPaymentProvider === "xero_invoice" && !zeroValueVoucherInvoice ? "xero_invoice" : "manual",
        paymentStatus: zeroValueVoucherInvoice ? "payment_not_required" : "unpaid",
        invoiceNumber,
        status: zeroValueVoucherInvoice ? "paid" : "issued",
        issueDate: new Date(),
        dueDate: input.appointment.holdExpiresAt || null,
        subtotalPence: amountPence,
        vatTotalPence: 0,
        voucherDiscountPence,
        totalPence: payablePence,
        amountPaidPence: 0,
        outstandingPence: payablePence,
        currency: (input.serviceType.paymentCurrency || input.appointment.paymentCurrency || "gbp").toLowerCase(),
        notes: zeroValueVoucherInvoice
          ? `Zero-value voucher invoice for ${input.serviceType.name}`
          : `Mediation session invoice for ${input.serviceType.name}`,
        createdBy: input.actor.id,
        updatedBy: input.actor.id,
        updatedAt: new Date(),
      }).returning();

      await this.insertLineItems(invoice.id, [{
        serviceTypeId: input.serviceType.id,
        description: `${input.serviceType.name} Session booking`,
        quantity: 1,
        unitAmountPence: amountPence,
        vatRate: null,
      }]);
      const recalculated = await this.recalculateInvoice(invoice.id);
      let finalInvoice = recalculated || invoice;
      if (bookingPaymentProvider === "xero_invoice" && !zeroValueVoucherInvoice && caseRecord) {
        const client = await storage.getClient(party.clientId);
        const partyRow = await storage.getParty(party.id);
        const partyName = client
          ? `${client.firstName || ""} ${client.lastName || ""}`.trim()
          : partyRow
          ? `${partyRow.firstName || ""} ${partyRow.lastName || ""}`.trim()
          : "Client";
        const partyEmail = client?.email || partyRow?.email || "";
        const { xeroService } = await import("./xero.service");
        const xeroInvoice = await xeroService.createInvoiceForCaseInvoice({
          invoice: finalInvoice,
          appointment: input.appointment,
          serviceType: input.serviceType,
          caseRef: caseRecord.caseRef,
          partyId: party.id,
          partyEmail,
          partyName: partyName || "Client",
        });
        if (!xeroInvoice.ok) return xeroInvoice;
        const xeroInvoiceNumber = xeroInvoice.xeroInvoiceNumber || xeroInvoice.record.xeroInvoiceId;
        const [xeroOwned] = await db.update(caseInvoices).set({
          provider: "xero_invoice",
          providerInvoiceId: xeroInvoice.record.xeroInvoiceId,
          paymentLinkUrl: xeroInvoice.invoiceUrl,
          invoiceNumber: xeroInvoiceNumber,
          notes: `Xero-owned billing invoice. Payment reference: ${xeroInvoiceNumber}.`,
          updatedBy: input.actor.id,
          updatedAt: new Date(),
        }).where(eq(caseInvoices.id, invoice.id)).returning();
        finalInvoice = xeroOwned;
      }
      invoices.push(finalInvoice);

      await logAudit({
        userId: input.actor.id,
        action: "mediation_session_invoice_created",
        entity: "case_invoice",
        entityId: invoice.id,
        entityRef: finalInvoice.invoiceNumber,
        details: JSON.stringify({ appointmentId: input.appointment.id, partyId: party.id }),
      });
      await this.emitFinanceEvent({
        caseId: input.appointment.caseId,
        partyId: party.id,
        appointmentId: input.appointment.id,
        type: "finance_invoice_created",
        title: "Mediation session invoice created",
        message: `${finalInvoice.invoiceNumber} created for ${input.serviceType.name}.`,
        relatedEntityId: invoice.id,
        relatedEntityType: "case_invoice",
        metadata: { invoiceNumber: finalInvoice.invoiceNumber, provider: finalInvoice.provider, paymentStatus: finalInvoice.paymentStatus },
        actor: staffActor(input.actor),
        notifyClient: true,
      });
    }

    return { ok: true, invoices };
  }

  async voidUnpaidAppointmentInvoices(
    appointmentId: string,
    input: { actor?: Pick<User, "id" | "name" | "role">; reason: string },
  ): Promise<ServiceResult<{ invoices: CaseInvoice[] }>> {
    const existingInvoices = await this.listInvoicesByAppointment(appointmentId);
    const voidableInvoices = existingInvoices.filter((invoice) =>
      invoice.status !== "void"
      && invoice.amountPaidPence === 0
      && invoice.outstandingPence === invoice.totalPence
      && !["paid", "refunded"].includes(invoice.paymentStatus)
    );

    const invoices: CaseInvoice[] = [];
    for (const invoice of voidableInvoices) {
      const notes = [invoice.notes, input.reason].filter(Boolean).join("\n");
      const [updated] = await db.update(caseInvoices).set({
        status: "void",
        paymentStatus: "cancelled",
        outstandingPence: 0,
        failureReason: input.reason,
        notes,
        voidedBy: input.actor?.id || null,
        voidedAt: new Date(),
        updatedBy: input.actor?.id || null,
        updatedAt: new Date(),
      }).where(eq(caseInvoices.id, invoice.id)).returning();
      if (!updated) continue;
      invoices.push(updated);

      await logAudit({
        userId: input.actor?.id || null,
        action: "case_invoice_auto_voided",
        entity: "case_invoice",
        entityId: updated.id,
        entityRef: updated.invoiceNumber,
        details: JSON.stringify({ appointmentId, reason: input.reason }),
      });
      await this.emitFinanceEvent({
        caseId: updated.caseId,
        partyId: updated.billToPartyId,
        appointmentId,
        type: "finance_invoice_voided",
        title: "Mediation session invoice voided",
        message: `${updated.invoiceNumber} was voided because the held mediation session slot is no longer active.`,
        urgency: "amber",
        relatedEntityId: updated.id,
        relatedEntityType: "case_invoice",
        metadata: { invoiceNumber: updated.invoiceNumber, appointmentId, paymentStatus: updated.paymentStatus, reason: input.reason },
        actor: input.actor ? staffActor(input.actor) : systemActor("finance"),
        notifyClient: false,
      });
    }

    return { ok: true, invoices };
  }

  async recordBookingPayment(input: BookingPaymentInput): Promise<ServiceResult<{ payment: CasePayment; invoice: CaseInvoice }>> {
    const serviceType = input.appointment.serviceTypeId ? await storage.getServiceType(input.appointment.serviceTypeId) : undefined;
    const caseRow = await this.getCase(input.appointment.caseId);
    if (!serviceType || !caseRow) return { ok: false, error: "Booking context not found", status: 400 };
    const partyId = input.appointment.partyId;
    if (!partyId) return { ok: false, error: "Appointment has no paying party", status: 400 };
    const invoiceResult = await this.ensureBookingInvoice({
      appointment: input.appointment,
      serviceType,
      caseRef: caseRow.caseRef,
      partyId,
      provider: input.provider,
      providerInvoiceId: input.checkoutSessionId || input.providerPaymentId || null,
      paymentStatus: "paid",
      failureReason: null,
    });
    if (!invoiceResult.ok) return invoiceResult;

    const party = await storage.getParty(partyId);
    if (!party?.clientId) return { ok: false, error: "Booking party/client not found", status: 400 };
    const amountPence = money(input.amountPence ?? input.appointment.paymentAmountPence ?? serviceType.paymentAmountPence);
    const currency = (input.currency || input.appointment.paymentCurrency || serviceType.paymentCurrency || "gbp").toLowerCase();
    const existing = await this.getPaymentByAppointment(input.appointment.id);
    const receiptNumber = existing?.receiptNumber || await this.nextReceiptNumber(input.appointment.caseId);
    const values = {
      caseId: input.appointment.caseId,
      clientId: party.clientId,
      partyId,
      invoiceId: invoiceResult.invoice.id,
      appointmentId: input.appointment.id,
      amountPence,
      currency,
      paymentDate: input.paymentDate || input.appointment.stripePaymentCompletedAt || new Date(),
      method: "card",
      provider: input.provider,
      providerPaymentId: input.providerPaymentId || input.paymentIntentId || null,
      checkoutSessionId: input.checkoutSessionId || input.appointment.stripeCheckoutSessionId || null,
      paymentIntentId: input.paymentIntentId || input.appointment.stripePaymentIntentId || null,
      paymentStatus: "paid",
      failureReason: null,
      refundedAmountPence: existing?.refundedAmountPence || 0,
      refundedAt: existing?.refundedAt || null,
      receiptNumber,
      receiptGeneratedAt: existing?.receiptGeneratedAt || new Date(),
      reference: input.reference || input.providerPaymentId || input.paymentIntentId || input.checkoutSessionId || null,
      notes: `Online booking payment received via ${input.provider}`,
      updatedAt: new Date(),
    };
    const [payment] = existing
      ? await db.update(casePayments).set(values).where(eq(casePayments.id, existing.id)).returning()
      : await db.insert(casePayments).values({ ...values, recordedBy: null, updatedBy: null }).returning();
    const invoice = await this.recalculateInvoice(invoiceResult.invoice.id);
    await db.update(caseInvoices).set({ paymentStatus: "paid", failureReason: null, updatedAt: new Date() }).where(eq(caseInvoices.id, invoiceResult.invoice.id));
    await logAudit({
      userId: null,
      action: existing ? "booking_payment_synced" : "booking_payment_recorded",
      entity: "case_payment",
      entityId: payment.id,
      entityRef: receiptNumber,
      details: JSON.stringify({ appointmentId: input.appointment.id, provider: input.provider, invoiceId: invoiceResult.invoice.id }),
    });
    if (!existing || existing.paymentStatus !== "paid") {
      await this.emitFinanceEvent({
        caseId: input.appointment.caseId,
        partyId,
        appointmentId: input.appointment.id,
        type: "finance_payment_paid",
        title: "Payment received",
        message: `${receiptNumber} recorded for ${invoiceResult.invoice.invoiceNumber}.`,
        relatedEntityId: payment.id,
        relatedEntityType: "case_payment",
        metadata: { invoiceNumber: invoiceResult.invoice.invoiceNumber, receiptNumber, provider: input.provider, amountPence },
        actor: systemActor(input.provider),
        notifyClient: true,
      });
    }
    return { ok: true, payment, invoice: invoice || invoiceResult.invoice };
  }

  async recordXeroOwnedCaseInvoicePayment(input: {
    invoiceId: string;
    providerInvoiceId: string;
    amountPence: number | null;
    currency: string;
    paymentDate: Date;
    reference: string;
  }): Promise<ServiceResult<{ payment: CasePayment; invoice: CaseInvoice }>> {
    const invoice = await this.getInvoice(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found", status: 404 };
    const amountPence = money(input.amountPence ?? invoice.totalPence);
    const receiptNumber = await this.nextReceiptNumber(invoice.caseId);
    const existing = await this.getPaymentByInvoice(invoice.id);
    const values = {
      caseId: invoice.caseId,
      clientId: invoice.billToClientId,
      partyId: invoice.billToPartyId,
      invoiceId: invoice.id,
      appointmentId: invoice.appointmentId,
      amountPence,
      currency: (input.currency || invoice.currency || "gbp").toLowerCase(),
      paymentDate: input.paymentDate,
      method: "bank_transfer",
      provider: "xero_invoice",
      providerPaymentId: input.providerInvoiceId,
      checkoutSessionId: null,
      paymentIntentId: null,
      paymentStatus: "paid",
      failureReason: null,
      refundedAmountPence: existing?.refundedAmountPence || 0,
      refundedAt: existing?.refundedAt || null,
      receiptNumber: existing?.receiptNumber || receiptNumber,
      receiptGeneratedAt: existing?.receiptGeneratedAt || new Date(),
      reference: input.reference,
      notes: `Xero invoice ${input.reference} marked paid`,
      updatedAt: new Date(),
    };
    const [payment] = existing
      ? await db.update(casePayments).set(values).where(eq(casePayments.id, existing.id)).returning()
      : await db.insert(casePayments).values({ ...values, recordedBy: null, updatedBy: null }).returning();
    await db.update(caseInvoices).set({
      paymentStatus: "paid",
      status: "paid",
      amountPaidPence: invoice.totalPence,
      outstandingPence: 0,
      provider: "xero_invoice",
      providerInvoiceId: input.providerInvoiceId,
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoice.id));
    const updated = await this.recalculateInvoice(invoice.id);
    if (invoice.appointmentId) {
      await this.attemptMediationSessionAutoConfirmForPayment(invoice.appointmentId, "invoice_paid");
    }
    return { ok: true, payment, invoice: updated || invoice };
  }

  async recordBookingPaymentStatus(appointment: Appointment, status: "unpaid" | "failed" | "cancelled" | "expired", failureReason?: string | null): Promise<void> {
    const invoice = await this.getInvoiceByAppointment(appointment.id);
    if (!invoice) return;
    const changed = invoice.paymentStatus !== status || invoice.failureReason !== (failureReason || null);
    await db.update(caseInvoices).set({ paymentStatus: status, failureReason: failureReason || null, updatedAt: new Date() }).where(eq(caseInvoices.id, invoice.id));
    const payment = await this.getPaymentByAppointment(appointment.id);
    if (payment && payment.paymentStatus !== "paid") {
      await db.update(casePayments).set({ paymentStatus: status, failureReason: failureReason || null, updatedAt: new Date() }).where(eq(casePayments.id, payment.id));
    }
    if (changed) {
      await logAudit({
        userId: null,
        action: `case_payment_${status}`,
        entity: "case_invoice",
        entityId: invoice.id,
        entityRef: invoice.invoiceNumber,
        details: JSON.stringify({ appointmentId: appointment.id, status, failureReason: failureReason || null }),
      });
      await this.emitFinanceEvent({
        caseId: appointment.caseId,
        partyId: appointment.partyId,
        appointmentId: appointment.id,
        type: `finance_payment_${status}`,
        title: status === "cancelled" ? "Payment cancelled" : status === "expired" ? "Payment link expired" : status === "failed" ? "Payment failed" : "Payment unpaid",
        message: `${invoice.invoiceNumber} marked ${status}${failureReason ? `: ${failureReason}` : ""}.`,
        urgency: status === "failed" || status === "expired" ? "amber" : "green",
        relatedEntityId: invoice.id,
        relatedEntityType: "case_invoice",
        metadata: { invoiceNumber: invoice.invoiceNumber, status, failureReason },
        actor: systemActor(appointment.paymentProvider || "finance"),
        notifyClient: true,
      });
    }
  }

  async recordBookingRefund(
    appointment: Appointment,
    refundedAmountPence: number,
    refundedAt = new Date(),
    options: { overrideNoShowNoRefund?: boolean; refundOverrideReason?: string | null; actor?: User } = {},
  ): Promise<void> {
    const invoice = await this.getInvoiceByAppointment(appointment.id);
    if (invoice) {
      const refundAllowed = await this.assertRefundAllowed({
        caseId: appointment.caseId,
        partyId: appointment.partyId || invoice.billToPartyId || null,
        appointmentId: appointment.id,
        invoiceId: invoice.id,
        overrideNoShowNoRefund: options.overrideNoShowNoRefund,
        refundOverrideReason: options.refundOverrideReason,
        actor: options.actor || ({ id: "system", name: "System", role: "superadmin" } as User),
      });
      if (!refundAllowed.ok) {
        await notificationService.createNotification({
          recipientId: null,
          recipientRole: "admin",
          type: "mediation_session_no_show_no_refund_recorded",
          urgency: "red",
          caseId: appointment.caseId,
          appointmentId: appointment.id,
          title: "Refund requires no-show override",
          message: `${invoice.invoiceNumber} is linked to a no-show mediation session. ${refundAllowed.error}.`,
          status: "active",
          caseNoteRequired: true,
        });
        return;
      }
    }
    if (invoice) {
      await db.update(caseInvoices).set({ paymentStatus: "refunded", updatedAt: new Date() }).where(eq(caseInvoices.id, invoice.id));
    }
    const payment = await this.getPaymentByAppointment(appointment.id);
    if (payment) {
      await db.update(casePayments).set({
        paymentStatus: "refunded",
        refundedAmountPence: money(refundedAmountPence),
        refundedAt,
        failureReason: null,
        notes: "Refund recorded from payment provider",
        updatedAt: new Date(),
      }).where(eq(casePayments.id, payment.id));
      await logAudit({
        userId: null,
        action: "case_payment_refunded",
        entity: "case_payment",
        entityId: payment.id,
        entityRef: payment.receiptNumber,
        details: JSON.stringify({ appointmentId: appointment.id, refundedAmountPence: money(refundedAmountPence) }),
      });
      await this.emitFinanceEvent({
        caseId: appointment.caseId,
        partyId: appointment.partyId,
        appointmentId: appointment.id,
        type: "finance_payment_refunded",
        title: "Payment refunded",
        message: `${payment.receiptNumber || "Payment"} marked refunded.`,
        urgency: "amber",
        relatedEntityId: payment.id,
        relatedEntityType: "case_payment",
        metadata: { receiptNumber: payment.receiptNumber, refundedAmountPence: money(refundedAmountPence) },
        actor: systemActor(appointment.paymentProvider || "finance"),
        notifyClient: true,
      });
    }
  }

  async updateBookingInvoicePaymentLink(appointmentId: string, paymentLinkUrl: string, providerInvoiceId?: string | null): Promise<void> {
    const invoice = await this.getInvoiceByAppointment(appointmentId);
    if (!invoice) return;
    await db.update(caseInvoices).set({
      paymentLinkUrl,
      providerInvoiceId: providerInvoiceId || invoice.providerInvoiceId,
      paymentStatus: "unpaid",
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoice.id));
    await logAudit({
      userId: null,
      action: "case_payment_link_retried",
      entity: "case_invoice",
      entityId: invoice.id,
      entityRef: invoice.invoiceNumber,
      details: JSON.stringify({ appointmentId, providerInvoiceId: providerInvoiceId || invoice.providerInvoiceId }),
    });
    await this.emitFinanceEvent({
      caseId: invoice.caseId,
      partyId: invoice.billToPartyId,
      appointmentId,
      type: "finance_payment_link_retried",
      title: "Payment link refreshed",
      message: `${invoice.invoiceNumber} has a new payment link.`,
      urgency: "green",
      relatedEntityId: invoice.id,
      relatedEntityType: "case_invoice",
      metadata: { invoiceNumber: invoice.invoiceNumber, providerInvoiceId: providerInvoiceId || invoice.providerInvoiceId },
      actor: systemActor("stripe"),
      notifyClient: true,
    });
  }

  async getMediationSessionInvoiceForCheckout(
    invoiceId: string,
    options: { clientUserId?: string; allowPaid?: boolean } = {},
  ): Promise<ServiceResult<MediationSessionInvoiceCheckoutContext>> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found", status: 404 };
    if (invoice.status === "void") return { ok: false, error: "Voided invoices cannot be paid", status: 409 };
    if (!options.allowPaid && (invoice.paymentStatus === "paid" || invoice.outstandingPence <= 0)) {
      return { ok: false, error: "Invoice is already paid", status: 409 };
    }
    if (!invoice.appointmentId) return { ok: false, error: "Invoice is not linked to a mediation session appointment", status: 400 };
    if (!invoice.billToPartyId) return { ok: false, error: "Invoice is not linked to a billed party", status: 400 };

    const appointment = await storage.getAppointment(invoice.appointmentId);
    if (!appointment) return { ok: false, error: "Linked appointment not found", status: 404 };
    if (!["hold", "held", "confirmed"].includes(appointment.status)) {
      return { ok: false, error: "Mediation session is not available for payment", status: 409 };
    }

    const serviceType = invoice.serviceTypeId ? await storage.getServiceType(invoice.serviceTypeId) : undefined;
    if (!serviceType) return { ok: false, error: "Invoice service type not found", status: 404 };
    if (serviceType.name !== "Mediation Sessions") {
      return { ok: false, error: "Invoice is not a mediation session invoice", status: 400 };
    }
    if (!serviceType.onlinePaymentEnabled || !serviceType.paymentAmountPence || serviceType.paymentAmountPence <= 0) {
      return { ok: false, error: "Mediation Sessions service type is not configured for online payment", status: 409 };
    }

    const caseRow = await this.getCase(invoice.caseId);
    if (!caseRow) return { ok: false, error: "Linked case not found", status: 404 };
    const party = await storage.getParty(invoice.billToPartyId);
    if (!party || party.caseId !== invoice.caseId || party.clientId !== invoice.billToClientId) {
      return { ok: false, error: "Invoice billed party does not match this case", status: 400 };
    }
    if (options.clientUserId && party.userId !== options.clientUserId) {
      return { ok: false, error: "Access denied", status: 403 };
    }
    const client = await storage.getClient(party.clientId);
    if (!client?.email) return { ok: false, error: "Paying client has no email address for a payment link", status: 400 };
    const [session] = await db
      .select({ id: mediationSessions.id })
      .from(mediationSessions)
      .where(eq(mediationSessions.appointmentId, appointment.id))
      .limit(1);

    return {
      ok: true,
      invoice,
      appointment,
      serviceType,
      caseRef: caseRow.caseRef,
      partyId: invoice.billToPartyId,
      partyEmail: client.email,
      partyName: `${client.firstName} ${client.lastName}`.trim(),
      mediationSessionId: session?.id || null,
    };
  }

  async updateInvoicePaymentLink(invoiceId: string, paymentLinkUrl: string, providerInvoiceId?: string | null): Promise<void> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return;
    await db.update(caseInvoices).set({
      provider: "stripe",
      providerInvoiceId: providerInvoiceId || invoice.providerInvoiceId,
      paymentLinkUrl,
      paymentStatus: "unpaid",
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoice.id));
  }

  async recordMediationSessionInvoicePayment(input: {
    invoiceId: string;
    checkoutSessionId: string;
    paymentIntentId?: string | null;
    providerPaymentId?: string | null;
    amountPence?: number | null;
    currency?: string | null;
    paymentDate?: Date;
  }): Promise<ServiceResult<{ payment: CasePayment; invoice: CaseInvoice; appointment: Appointment; autoConfirmation?: MediationSessionAutoConfirmation }>> {
    const existingInvoice = await this.getInvoice(input.invoiceId);
    if (existingInvoice && (existingInvoice.paymentStatus === "paid" || existingInvoice.outstandingPence <= 0)) {
      if (!existingInvoice.appointmentId) return { ok: false, error: "Invoice is not linked to a mediation session appointment", status: 400 };
      const appointment = await storage.getAppointment(existingInvoice.appointmentId);
      if (!appointment) return { ok: false, error: "Linked appointment not found", status: 404 };
      const existingPayment = await this.getPaymentByInvoiceAndCheckoutSession(existingInvoice.id, input.checkoutSessionId)
        || await this.getPaymentByInvoice(existingInvoice.id);
      if (existingPayment) {
        const autoConfirmation = await this.attemptMediationSessionAutoConfirmForPayment(appointment.id, "invoice_paid");
        return { ok: true, payment: existingPayment, invoice: existingInvoice, appointment, autoConfirmation };
      }
    }

    const context = await this.getMediationSessionInvoiceForCheckout(input.invoiceId);
    if (!context.ok) return context;
    const { invoice, appointment } = context;
    const amountPence = money(input.amountPence ?? invoice.outstandingPence ?? invoice.totalPence);
    const currency = (input.currency || invoice.currency || "gbp").toLowerCase();
    const existing = await this.getPaymentByInvoiceAndCheckoutSession(invoice.id, input.checkoutSessionId);
    const receiptNumber = existing?.receiptNumber || await this.nextReceiptNumber(invoice.caseId);
    const values = {
      caseId: invoice.caseId,
      clientId: invoice.billToClientId,
      partyId: invoice.billToPartyId,
      invoiceId: invoice.id,
      appointmentId: invoice.appointmentId,
      amountPence,
      currency,
      paymentDate: input.paymentDate || new Date(),
      method: "card",
      provider: "stripe",
      providerPaymentId: input.providerPaymentId || input.paymentIntentId || null,
      checkoutSessionId: input.checkoutSessionId,
      paymentIntentId: input.paymentIntentId || null,
      paymentStatus: "paid",
      failureReason: null,
      refundedAmountPence: existing?.refundedAmountPence || 0,
      refundedAt: existing?.refundedAt || null,
      receiptNumber,
      receiptGeneratedAt: existing?.receiptGeneratedAt || new Date(),
      reference: input.providerPaymentId || input.paymentIntentId || input.checkoutSessionId,
      notes: "Mediation session invoice paid via Stripe",
      updatedAt: new Date(),
    };
    const [payment] = existing
      ? await db.update(casePayments).set(values).where(eq(casePayments.id, existing.id)).returning()
      : await db.insert(casePayments).values({ ...values, recordedBy: null, updatedBy: null }).returning();
    const recalculated = await this.recalculateInvoice(invoice.id);
    await db.update(caseInvoices).set({
      provider: "stripe",
      providerInvoiceId: input.checkoutSessionId,
      paymentStatus: "paid",
      failureReason: null,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoice.id));

    const appointmentInvoices = await this.listInvoicesByAppointment(appointment.id);
    const allPaid = appointmentInvoices.length > 0 && appointmentInvoices.every((row) =>
      row.id === invoice.id
        ? true
        : row.paymentStatus === "paid" || row.outstandingPence <= 0 || row.status === "void"
    );
    if (allPaid && appointment.paymentStatus !== "paid") {
      await storage.updateAppointment(appointment.id, {
        paymentStatus: "paid",
        paymentStatusUpdatedAt: new Date(),
        paymentStatusUpdatedBy: null,
        paymentProvider: "stripe",
        stripeCheckoutSessionId: input.checkoutSessionId,
        stripePaymentIntentId: input.paymentIntentId || null,
        stripePaymentCompletedAt: input.paymentDate || new Date(),
        paymentFailureReason: null,
        paymentNotes: "All mediation session invoices paid via Stripe",
      });
    }

    await logAudit({
      userId: null,
      action: "mediation_session_invoice_paid",
      entity: "case_invoice",
      entityId: invoice.id,
      entityRef: invoice.invoiceNumber,
      details: JSON.stringify({ appointmentId: appointment.id, partyId: invoice.billToPartyId, checkoutSessionId: input.checkoutSessionId }),
    });
    await this.emitFinanceEvent({
      caseId: invoice.caseId,
      partyId: invoice.billToPartyId,
      appointmentId: appointment.id,
      type: "finance_payment_paid",
      title: "Payment received",
      message: `${receiptNumber} recorded for ${invoice.invoiceNumber}.`,
      relatedEntityId: payment.id,
      relatedEntityType: "case_payment",
      metadata: { invoiceNumber: invoice.invoiceNumber, receiptNumber, provider: "stripe", amountPence },
      actor: systemActor("stripe"),
      notifyClient: true,
    });

    const autoConfirmation = await this.attemptMediationSessionAutoConfirmForPayment(appointment.id, "invoice_paid");
    return { ok: true, payment, invoice: recalculated || invoice, appointment, autoConfirmation };
  }

  async backfillPaidBookingFinance(): Promise<{ scanned: number; createdOrUpdated: number }> {
    const rows = await db.select().from(appointments).where(eq(appointments.paymentStatus, "paid"));
    let createdOrUpdated = 0;
    for (const appointment of rows) {
      if (!appointment.partyId || !appointment.serviceTypeId) continue;
      const serviceType = await storage.getServiceType(appointment.serviceTypeId);
      const caseRow = await this.getCase(appointment.caseId);
      if (!serviceType || !caseRow) continue;
      const provider = appointment.paymentProvider === "xero_stripe" ? "xero_stripe" : "stripe";
      const invoiceResult = await this.ensureBookingInvoice({
        appointment,
        serviceType,
        caseRef: caseRow.caseRef,
        partyId: appointment.partyId,
        provider,
        providerInvoiceId: appointment.stripeCheckoutSessionId,
        paymentStatus: "paid",
      });
      if (!invoiceResult.ok) continue;
      const paymentResult = await this.recordBookingPayment({
        appointment,
        provider,
        checkoutSessionId: appointment.stripeCheckoutSessionId,
        paymentIntentId: appointment.stripePaymentIntentId,
        providerPaymentId: appointment.stripePaymentIntentId,
        amountPence: appointment.paymentAmountPence,
        currency: appointment.paymentCurrency,
        paymentDate: appointment.stripePaymentCompletedAt || new Date(),
      });
      if (paymentResult.ok) createdOrUpdated += 1;
    }
    return { scanned: rows.length, createdOrUpdated };
  }

  private async attemptMediationSessionAutoConfirmForPayment(
    appointmentId?: string | null,
    trigger: "invoice_paid" | "manual_payment_status" = "invoice_paid",
  ): Promise<MediationSessionAutoConfirmation | undefined> {
    if (!appointmentId) return undefined;
    const [session] = await db
      .select({ id: mediationSessions.id })
      .from(mediationSessions)
      .where(eq(mediationSessions.appointmentId, appointmentId))
      .limit(1);
    if (!session) return undefined;
    const { mediationSessionService } = await import("./mediation-session.service");
    return mediationSessionService.attemptAutoConfirmSession(session.id, trigger);
  }

  async getPaymentReceipt(paymentId: string, user: Pick<User, "id" | "role">): Promise<ServiceResult<{ payment: CasePayment & { clientName: string; partyRole: string | null; invoiceNumber: string | null; caseRef: string; serviceName: string | null; appointmentDateTime: Date | null } }>> {
    const [row] = await db.select({
      payment: casePayments,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      partyRole: parties.role,
      invoiceNumber: caseInvoices.invoiceNumber,
      caseRef: cases.caseRef,
      serviceName: serviceTypes.name,
      appointmentDateTime: appointments.dateTime,
    })
      .from(casePayments)
      .innerJoin(cases, eq(casePayments.caseId, cases.id))
      .innerJoin(clients, eq(casePayments.clientId, clients.id))
      .leftJoin(parties, eq(casePayments.partyId, parties.id))
      .leftJoin(caseInvoices, eq(casePayments.invoiceId, caseInvoices.id))
      .leftJoin(serviceTypes, eq(caseInvoices.serviceTypeId, serviceTypes.id))
      .leftJoin(appointments, eq(casePayments.appointmentId, appointments.id))
      .where(eq(casePayments.id, paymentId))
      .limit(1);
    if (!row) return { ok: false, error: "Payment not found", status: 404 };
    if (user.role === "client") {
      const userParties = await storage.listPartiesByUserId(user.id);
      if (!userParties.some((party) => party.caseId === row.payment.caseId && party.clientId === row.payment.clientId)) {
        return { ok: false, error: "Access denied", status: 403 };
      }
    }
    if (!row.payment.receiptNumber && (row.payment.paymentStatus === "paid" || row.payment.paymentStatus === "refunded")) {
      const receiptNumber = await this.nextReceiptNumber(row.payment.caseId);
      const [updated] = await db.update(casePayments).set({
        receiptNumber,
        receiptGeneratedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(casePayments.id, paymentId)).returning();
      row.payment = updated;
    }
    return {
      ok: true,
      payment: {
        ...row.payment,
        clientName: `${row.clientFirstName} ${row.clientLastName}`.trim(),
        partyRole: row.partyRole,
        invoiceNumber: row.invoiceNumber,
        caseRef: row.caseRef,
        serviceName: row.serviceName,
        appointmentDateTime: row.appointmentDateTime,
      },
    };
  }

  async getBookingInvoiceForRetry(invoiceId: string): Promise<ServiceResult<{ invoice: CaseInvoice; appointment: Appointment; serviceType: ServiceType; caseRef: string; partyId: string; partyEmail: string; partyName: string }>> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found", status: 404 };
    if (!["unpaid", "failed", "cancelled", "expired"].includes(invoice.paymentStatus)) {
      return { ok: false, error: "Only unpaid, failed, cancelled, or expired payment links can be retried", status: 409 };
    }
    if (!invoice.appointmentId) return { ok: false, error: "Invoice is not linked to a booking appointment", status: 400 };
    const appointment = await storage.getAppointment(invoice.appointmentId);
    if (!appointment) return { ok: false, error: "Linked appointment not found", status: 404 };
    if (appointment.status !== "hold" && appointment.status !== "held" && appointment.status !== "confirmed") {
      return { ok: false, error: "Booking is not available for payment retry", status: 409 };
    }
    if (!appointment.partyId) return { ok: false, error: "Linked appointment has no party", status: 400 };
    const serviceType = appointment.serviceTypeId ? await storage.getServiceType(appointment.serviceTypeId) : undefined;
    if (!serviceType) return { ok: false, error: "Linked appointment service type not found", status: 404 };
    const caseRow = await this.getCase(appointment.caseId);
    if (!caseRow) return { ok: false, error: "Linked case not found", status: 404 };
    const party = await storage.getParty(appointment.partyId);
    if (!party?.clientId) return { ok: false, error: "Linked party/client not found", status: 404 };
    const client = await storage.getClient(party.clientId);
    if (!client?.email) return { ok: false, error: "Paying client has no email address for a payment link", status: 400 };
    return {
      ok: true,
      invoice,
      appointment,
      serviceType,
      caseRef: caseRow.caseRef,
      partyId: appointment.partyId,
      partyEmail: client.email,
      partyName: `${client.firstName} ${client.lastName}`.trim(),
    };
  }

  async listLedger(params: { search?: string; status?: string; paymentStatus?: string; dueFrom?: Date; dueTo?: Date; page?: number; limit?: number }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;
    const conditions = [];
    if (params.status) conditions.push(eq(caseInvoices.status, params.status));
    if (params.paymentStatus) conditions.push(eq(caseInvoices.paymentStatus, params.paymentStatus));
    if (params.dueFrom) conditions.push(sql`${caseInvoices.dueDate} >= ${params.dueFrom}`);
    if (params.dueTo) conditions.push(sql`${caseInvoices.dueDate} <= ${params.dueTo}`);
    if (params.search?.trim()) {
      const q = `%${params.search.trim()}%`;
      conditions.push(or(
        ilike(caseInvoices.invoiceNumber, q),
        ilike(cases.caseRef, q),
        ilike(clients.firstName, q),
        ilike(clients.lastName, q),
        ilike(sql`${clients.firstName} || ' ' || ${clients.lastName}`, q),
      ));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select({
        invoice: caseInvoices,
        caseRef: cases.caseRef,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        serviceName: serviceTypes.name,
      })
      .from(caseInvoices)
      .innerJoin(cases, eq(caseInvoices.caseId, cases.id))
      .innerJoin(clients, eq(caseInvoices.billToClientId, clients.id))
      .leftJoin(serviceTypes, eq(caseInvoices.serviceTypeId, serviceTypes.id))
      .where(where)
      .orderBy(desc(caseInvoices.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(caseInvoices)
      .innerJoin(cases, eq(caseInvoices.caseId, cases.id))
      .innerJoin(clients, eq(caseInvoices.billToClientId, clients.id))
      .where(where);

    return {
      data: rows.map((row) => ({
        ...row.invoice,
        caseRef: row.caseRef,
        billToClientName: `${row.clientFirstName} ${row.clientLastName}`.trim(),
        serviceName: row.serviceName,
      })),
      total: Number(count) || 0,
      page,
      limit,
    };
  }

  async createInvoice(input: InvoiceInput, actor: User): Promise<ServiceResult<{ invoice: CaseInvoice }>> {
    const valid = await this.validateCaseClient(input.caseId, input.billToClientId, input.billToPartyId);
    if (!valid.ok) return valid;

    const totals = this.computeInvoiceTotals(input.lineItems);
    const invoiceNumber = await this.nextInvoiceNumber(input.caseId);
    const [invoice] = await db.insert(caseInvoices).values({
      caseId: input.caseId,
      billToClientId: input.billToClientId,
      billToPartyId: input.billToPartyId || null,
      serviceTypeId: input.serviceTypeId || null,
      appointmentId: input.appointmentId || null,
      provider: input.provider || "manual",
      providerInvoiceId: input.providerInvoiceId || null,
      paymentLinkUrl: input.paymentLinkUrl || null,
      paymentStatus: input.paymentStatus || "unpaid",
      failureReason: input.failureReason || null,
      invoiceNumber,
      status: input.status || "issued",
      issueDate: input.issueDate || new Date(),
      dueDate: input.dueDate || null,
      subtotalPence: totals.subtotalPence,
      vatTotalPence: totals.vatTotalPence,
      totalPence: totals.totalPence,
      outstandingPence: totals.totalPence,
      currency: input.currency || "gbp",
      notes: input.notes || null,
      createdBy: actor.id,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).returning();

    await this.insertLineItems(invoice.id, input.lineItems);
    await this.recalculateInvoice(invoice.id);
    await logAudit({
      userId: actor.id,
      action: "case_invoice_created",
      entity: "case_invoice",
      entityId: invoice.id,
      entityRef: invoice.invoiceNumber,
      details: JSON.stringify({ caseId: input.caseId, billToClientId: input.billToClientId }),
    });
    await this.emitFinanceEvent({
      caseId: input.caseId,
      partyId: input.billToPartyId,
      type: "finance_invoice_created",
      title: "Case invoice created",
      message: `${invoice.invoiceNumber} created for ${totals.totalPence > 0 ? `amount ${totals.totalPence}` : "case payment"}.`,
      relatedEntityId: invoice.id,
      relatedEntityType: "case_invoice",
      metadata: { invoiceNumber: invoice.invoiceNumber, billToClientId: input.billToClientId, totalPence: totals.totalPence },
      actor: staffActor(actor),
      notifyClient: false,
    });
    return { ok: true, invoice: (await this.getInvoice(invoice.id)) || invoice };
  }

  async updateInvoice(invoiceId: string, patch: Partial<InvoiceInput>, actor: User): Promise<ServiceResult<{ invoice: CaseInvoice }>> {
    const existing = await this.getInvoice(invoiceId);
    if (!existing) return { ok: false, error: "Invoice not found", status: 404 };
    if (existing.status === "void") return { ok: false, error: "Voided invoices cannot be edited", status: 409 };

    const caseId = patch.caseId || existing.caseId;
    const clientId = patch.billToClientId || existing.billToClientId;
    const partyId = patch.billToPartyId === undefined ? existing.billToPartyId : patch.billToPartyId;
    const valid = await this.validateCaseClient(caseId, clientId, partyId);
    if (!valid.ok) return valid;

    await db.update(caseInvoices).set({
      billToClientId: clientId,
      billToPartyId: partyId || null,
      serviceTypeId: patch.serviceTypeId === undefined ? existing.serviceTypeId : patch.serviceTypeId,
      appointmentId: patch.appointmentId === undefined ? existing.appointmentId : patch.appointmentId,
      provider: patch.provider || existing.provider,
      providerInvoiceId: patch.providerInvoiceId === undefined ? existing.providerInvoiceId : patch.providerInvoiceId,
      paymentLinkUrl: patch.paymentLinkUrl === undefined ? existing.paymentLinkUrl : patch.paymentLinkUrl,
      paymentStatus: patch.paymentStatus || existing.paymentStatus,
      failureReason: patch.failureReason === undefined ? existing.failureReason : patch.failureReason,
      status: patch.status || existing.status,
      issueDate: patch.issueDate || existing.issueDate,
      dueDate: patch.dueDate === undefined ? existing.dueDate : patch.dueDate,
      currency: patch.currency || existing.currency,
      notes: patch.notes === undefined ? existing.notes : patch.notes,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoiceId));

    if (patch.lineItems) {
      await db.delete(caseInvoiceLineItems).where(eq(caseInvoiceLineItems.invoiceId, invoiceId));
      await this.insertLineItems(invoiceId, patch.lineItems);
    }

    const invoice = await this.recalculateInvoice(invoiceId);
    await logAudit({ userId: actor.id, action: "case_invoice_updated", entity: "case_invoice", entityId: invoiceId, entityRef: invoice?.invoiceNumber });
    await this.emitFinanceEvent({
      caseId,
      partyId,
      type: "finance_invoice_updated",
      title: "Case invoice updated",
      message: `${invoice?.invoiceNumber || existing.invoiceNumber} updated.`,
      relatedEntityId: invoiceId,
      relatedEntityType: "case_invoice",
      metadata: { invoiceNumber: invoice?.invoiceNumber || existing.invoiceNumber, paymentStatus: invoice?.paymentStatus || existing.paymentStatus },
      actor: staffActor(actor),
      notifyClient: false,
    });
    if (invoice && ["paid", "payment_not_required"].includes(invoice.paymentStatus)) {
      await this.attemptMediationSessionAutoConfirmForPayment(invoice.appointmentId, "manual_payment_status");
    }
    return { ok: true, invoice: invoice! };
  }

  async voidInvoice(invoiceId: string, actor: User): Promise<ServiceResult<{ invoice: CaseInvoice }>> {
    const existing = await this.getInvoice(invoiceId);
    if (!existing) return { ok: false, error: "Invoice not found", status: 404 };
    const [invoice] = await db.update(caseInvoices).set({
      status: "void",
      outstandingPence: 0,
      voidedBy: actor.id,
      voidedAt: new Date(),
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoiceId)).returning();
    await logAudit({ userId: actor.id, action: "case_invoice_voided", entity: "case_invoice", entityId: invoiceId, entityRef: invoice.invoiceNumber });
    await this.emitFinanceEvent({
      caseId: invoice.caseId,
      partyId: invoice.billToPartyId,
      type: "finance_invoice_voided",
      title: "Case invoice voided",
      message: `${invoice.invoiceNumber} was voided.`,
      urgency: "amber",
      relatedEntityId: invoiceId,
      relatedEntityType: "case_invoice",
      metadata: { invoiceNumber: invoice.invoiceNumber },
      actor: staffActor(actor),
      notifyClient: false,
    });
    return { ok: true, invoice };
  }

  async createPayment(input: PaymentInput, actor: User): Promise<ServiceResult<{ payment: CasePayment }>> {
    const valid = await this.validateCaseClient(input.caseId, input.clientId, input.partyId);
    if (!valid.ok) return valid;
    if (input.invoiceId) {
      const invoice = await this.getInvoice(input.invoiceId);
      if (!invoice || invoice.caseId !== input.caseId) return { ok: false, error: "Invoice does not belong to this case", status: 400 };
      if (invoice.billToClientId !== input.clientId) return { ok: false, error: "Payment client must match the invoice billed client", status: 400 };
    }
    if (input.paymentStatus === "refunded") {
      const refundAllowed = await this.assertRefundAllowed({
        caseId: input.caseId,
        partyId: input.partyId || null,
        appointmentId: input.appointmentId || null,
        invoiceId: input.invoiceId || null,
        overrideNoShowNoRefund: input.overrideNoShowNoRefund,
        refundOverrideReason: input.refundOverrideReason,
        actor,
      });
      if (!refundAllowed.ok) return refundAllowed;
    }

    const [payment] = await db.insert(casePayments).values({
      caseId: input.caseId,
      clientId: input.clientId,
      partyId: input.partyId || null,
      invoiceId: input.invoiceId || null,
      appointmentId: input.appointmentId || null,
      amountPence: input.amountPence,
      currency: input.currency || "gbp",
      paymentDate: input.paymentDate || new Date(),
      method: input.method || "bank_transfer",
      provider: input.provider || "manual",
      providerPaymentId: input.providerPaymentId || null,
      checkoutSessionId: input.checkoutSessionId || null,
      paymentIntentId: input.paymentIntentId || null,
      paymentStatus: input.paymentStatus || "paid",
      failureReason: input.failureReason || null,
      refundedAmountPence: input.refundedAmountPence || 0,
      refundedAt: input.refundedAt || null,
      receiptNumber: input.receiptNumber || (input.paymentStatus === "paid" || !input.paymentStatus ? await this.nextReceiptNumber(input.caseId) : null),
      receiptGeneratedAt: input.receiptGeneratedAt || (input.paymentStatus === "paid" || !input.paymentStatus ? new Date() : null),
      reference: input.reference || null,
      notes: input.notes || null,
      recordedBy: actor.id,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).returning();

    if (payment.invoiceId) await this.recalculateInvoice(payment.invoiceId);
    await logAudit({
      userId: actor.id,
      action: "case_payment_recorded",
      entity: "case_payment",
      entityId: payment.id,
      details: JSON.stringify({ caseId: input.caseId, clientId: input.clientId, invoiceId: input.invoiceId || null }),
    });
    await this.emitFinanceEvent({
      caseId: input.caseId,
      partyId: input.partyId,
      appointmentId: input.appointmentId,
      type: `finance_payment_${payment.paymentStatus}`,
      title: payment.paymentStatus === "paid" ? "Payment recorded" : "Payment status recorded",
      message: `Payment for ${formatPaymentAmountForActivity(payment.amountPence, payment.currency)} recorded as ${payment.paymentStatus}.`,
      urgency: payment.paymentStatus === "failed" || payment.paymentStatus === "expired" ? "amber" : "green",
      relatedEntityId: payment.id,
      relatedEntityType: "case_payment",
      metadata: { invoiceId: input.invoiceId || null, paymentStatus: payment.paymentStatus, amountPence: payment.amountPence },
      actor: staffActor(actor),
      notifyClient: false,
    });
    if (payment.paymentStatus === "paid" || payment.paymentStatus === "payment_not_required") {
      await this.attemptMediationSessionAutoConfirmForPayment(
        payment.appointmentId || (payment.invoiceId ? (await this.getInvoice(payment.invoiceId))?.appointmentId : null),
        "manual_payment_status",
      );
    }
    return { ok: true, payment };
  }

  async updatePayment(paymentId: string, patch: Partial<PaymentInput>, actor: User): Promise<ServiceResult<{ payment: CasePayment }>> {
    const existing = await this.getPayment(paymentId);
    if (!existing) return { ok: false, error: "Payment not found", status: 404 };
    const caseId = patch.caseId || existing.caseId;
    const clientId = patch.clientId || existing.clientId;
    const partyId = patch.partyId === undefined ? existing.partyId : patch.partyId;
    const invoiceId = patch.invoiceId === undefined ? existing.invoiceId : patch.invoiceId;

    const valid = await this.validateCaseClient(caseId, clientId, partyId);
    if (!valid.ok) return valid;
    if (invoiceId) {
      const invoice = await this.getInvoice(invoiceId);
      if (!invoice || invoice.caseId !== caseId) return { ok: false, error: "Invoice does not belong to this case", status: 400 };
      if (invoice.billToClientId !== clientId) return { ok: false, error: "Payment client must match the invoice billed client", status: 400 };
    }
    if (patch.paymentStatus === "refunded" && existing.paymentStatus !== "refunded") {
      const refundAllowed = await this.assertRefundAllowed({
        caseId,
        partyId: partyId || null,
        appointmentId: patch.appointmentId === undefined ? existing.appointmentId : patch.appointmentId,
        invoiceId: invoiceId || null,
        overrideNoShowNoRefund: patch.overrideNoShowNoRefund,
        refundOverrideReason: patch.refundOverrideReason,
        actor,
      });
      if (!refundAllowed.ok) return refundAllowed;
    }

    const oldInvoiceId = existing.invoiceId;
    const [payment] = await db.update(casePayments).set({
      clientId,
      partyId: partyId || null,
      invoiceId: invoiceId || null,
      appointmentId: patch.appointmentId === undefined ? existing.appointmentId : patch.appointmentId,
      amountPence: patch.amountPence ?? existing.amountPence,
      currency: patch.currency || existing.currency,
      paymentDate: patch.paymentDate || existing.paymentDate,
      method: patch.method || existing.method,
      provider: patch.provider || existing.provider,
      providerPaymentId: patch.providerPaymentId === undefined ? existing.providerPaymentId : patch.providerPaymentId,
      checkoutSessionId: patch.checkoutSessionId === undefined ? existing.checkoutSessionId : patch.checkoutSessionId,
      paymentIntentId: patch.paymentIntentId === undefined ? existing.paymentIntentId : patch.paymentIntentId,
      paymentStatus: patch.paymentStatus || existing.paymentStatus,
      failureReason: patch.failureReason === undefined ? existing.failureReason : patch.failureReason,
      refundedAmountPence: patch.refundedAmountPence ?? existing.refundedAmountPence,
      refundedAt: patch.refundedAt === undefined ? existing.refundedAt : patch.refundedAt,
      receiptNumber: patch.receiptNumber === undefined ? existing.receiptNumber : patch.receiptNumber,
      receiptGeneratedAt: patch.receiptGeneratedAt === undefined ? existing.receiptGeneratedAt : patch.receiptGeneratedAt,
      reference: patch.reference === undefined ? existing.reference : patch.reference,
      notes: patch.notes === undefined ? existing.notes : patch.notes,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(casePayments.id, paymentId)).returning();

    if (oldInvoiceId) await this.recalculateInvoice(oldInvoiceId);
    if (payment.invoiceId && payment.invoiceId !== oldInvoiceId) await this.recalculateInvoice(payment.invoiceId);
    await logAudit({ userId: actor.id, action: "case_payment_updated", entity: "case_payment", entityId: payment.id });
    await this.emitFinanceEvent({
      caseId,
      partyId,
      appointmentId: payment.appointmentId,
      type: `finance_payment_${payment.paymentStatus}`,
      title: existing.paymentStatus === payment.paymentStatus ? "Payment updated" : "Payment status updated",
      message: `Payment marked ${payment.paymentStatus}.`,
      urgency: payment.paymentStatus === "failed" || payment.paymentStatus === "expired" || payment.paymentStatus === "refunded" ? "amber" : "green",
      relatedEntityId: payment.id,
      relatedEntityType: "case_payment",
      metadata: { previousPaymentStatus: existing.paymentStatus, paymentStatus: payment.paymentStatus, amountPence: payment.amountPence },
      actor: staffActor(actor),
      notifyClient: false,
    });
    if (payment.paymentStatus === "paid" || payment.paymentStatus === "payment_not_required") {
      await this.attemptMediationSessionAutoConfirmForPayment(
        payment.appointmentId || (payment.invoiceId ? (await this.getInvoice(payment.invoiceId))?.appointmentId : null),
        "manual_payment_status",
      );
    }
    return { ok: true, payment };
  }

  async deletePayment(paymentId: string, actor: User): Promise<ServiceResult<{ deleted: true }>> {
    const existing = await this.getPayment(paymentId);
    if (!existing) return { ok: false, error: "Payment not found", status: 404 };
    await db.delete(casePayments).where(eq(casePayments.id, paymentId));
    if (existing.invoiceId) await this.recalculateInvoice(existing.invoiceId);
    await logAudit({ userId: actor.id, action: "case_payment_deleted", entity: "case_payment", entityId: paymentId });
    await this.emitFinanceEvent({
      caseId: existing.caseId,
      partyId: existing.partyId,
      appointmentId: existing.appointmentId,
      type: "finance_payment_deleted",
      title: "Payment deleted",
      message: `Payment record ${existing.receiptNumber || paymentId} was deleted.`,
      urgency: "amber",
      relatedEntityId: paymentId,
      relatedEntityType: "case_payment",
      metadata: { receiptNumber: existing.receiptNumber, amountPence: existing.amountPence },
      actor: staffActor(actor),
      notifyClient: false,
    });
    return { ok: true, deleted: true };
  }

  async countOverdueInvoices(): Promise<number> {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(caseInvoices)
      .where(and(
        sql`${caseInvoices.dueDate} IS NOT NULL`,
        sql`${caseInvoices.dueDate} < NOW()`,
        sql`${caseInvoices.outstandingPence} > 0`,
        sql`${caseInvoices.status} <> 'void'`,
      ));
    return Number(count) || 0;
  }

  private async buildCaseFinance(caseId: string, restrictToClientId?: string) {
    const partyClients = await this.getCasePartyClients(caseId);
    const visiblePartyClients = restrictToClientId ? partyClients.filter((pc) => pc.clientId === restrictToClientId) : partyClients;
    const invoices = (await this.getInvoiceRows(caseId)).filter((invoice) => !restrictToClientId || invoice.billToClientId === restrictToClientId);
    const payments = (await this.getPaymentRows(caseId)).filter((payment) => !restrictToClientId || payment.clientId === restrictToClientId);
    const externalInvoices = (await this.getExternalXeroInvoices(caseId)).filter((invoice) => !restrictToClientId || invoice.clientId === restrictToClientId);
    const totalsByClient = visiblePartyClients.map((pc) => {
      const clientInvoices = invoices.filter((invoice) => invoice.billToClientId === pc.clientId && invoice.status !== "void");
      const clientPayments = payments.filter((payment) => payment.clientId === pc.clientId);
      const invoicedPence = clientInvoices.reduce((sum, invoice) => sum + invoice.totalPence, 0);
      const paidPence = clientPayments.reduce((sum, payment) => sum + payment.amountPence, 0);
      const outstandingPence = clientInvoices.reduce((sum, invoice) => sum + invoice.outstandingPence, 0);
      const overduePence = clientInvoices
        .filter((invoice) => invoice.status === "overdue")
        .reduce((sum, invoice) => sum + invoice.outstandingPence, 0);
      return { clientId: pc.clientId, clientName: pc.clientName, partyId: pc.partyId, partyRole: pc.role, invoicedPence, paidPence, outstandingPence, overduePence };
    });
    return { parties: visiblePartyClients, invoices, payments, externalInvoices, totalsByClient };
  }

  private async getInvoiceRows(caseId: string) {
    const rows = await db.select({
      invoice: caseInvoices,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      partyRole: parties.role,
      serviceName: serviceTypes.name,
      appointmentDateTime: appointments.dateTime,
      appointmentStatus: appointments.status,
      mediationSessionId: mediationSessions.id,
      mediationSessionNumber: mediationSessions.sessionNumber,
    })
      .from(caseInvoices)
      .innerJoin(clients, eq(caseInvoices.billToClientId, clients.id))
      .leftJoin(parties, eq(caseInvoices.billToPartyId, parties.id))
      .leftJoin(serviceTypes, eq(caseInvoices.serviceTypeId, serviceTypes.id))
      .leftJoin(appointments, eq(caseInvoices.appointmentId, appointments.id))
      .leftJoin(mediationSessions, eq(caseInvoices.appointmentId, mediationSessions.appointmentId))
      .where(eq(caseInvoices.caseId, caseId))
      .orderBy(desc(caseInvoices.createdAt));

    const invoiceIds = rows.map((row) => row.invoice.id);
    const lineRows = invoiceIds.length === 0 ? [] : await db.select({
      line: caseInvoiceLineItems,
      serviceName: serviceTypes.name,
    }).from(caseInvoiceLineItems)
      .leftJoin(serviceTypes, eq(caseInvoiceLineItems.serviceTypeId, serviceTypes.id))
      .where(sql`${caseInvoiceLineItems.invoiceId} IN (${sql.join(invoiceIds.map((id) => sql`${id}`), sql`, `)})`);

    const linesByInvoice = new Map<string, unknown[]>();
    for (const row of lineRows) {
      const list = linesByInvoice.get(row.line.invoiceId) || [];
      list.push({ ...row.line, serviceName: row.serviceName });
      linesByInvoice.set(row.line.invoiceId, list);
    }

    return rows.map((row) => ({
      ...row.invoice,
      billToClientName: `${row.clientFirstName} ${row.clientLastName}`.trim(),
      partyRole: row.partyRole,
      serviceName: row.serviceName,
      appointmentDateTime: row.appointmentDateTime,
      appointmentStatus: row.appointmentStatus,
      mediationSessionId: row.mediationSessionId,
      mediationSessionNumber: row.mediationSessionNumber,
      lineItems: linesByInvoice.get(row.invoice.id) || [],
    }));
  }

  private async getPaymentRows(caseId: string) {
    const rows = await db.select({
      payment: casePayments,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      partyRole: parties.role,
      invoiceNumber: caseInvoices.invoiceNumber,
      appointmentDateTime: appointments.dateTime,
      appointmentStatus: appointments.status,
    })
      .from(casePayments)
      .innerJoin(clients, eq(casePayments.clientId, clients.id))
      .leftJoin(parties, eq(casePayments.partyId, parties.id))
      .leftJoin(caseInvoices, eq(casePayments.invoiceId, caseInvoices.id))
      .leftJoin(appointments, eq(casePayments.appointmentId, appointments.id))
      .where(eq(casePayments.caseId, caseId))
      .orderBy(desc(casePayments.paymentDate));
    return rows.map((row) => ({
      ...row.payment,
      clientName: `${row.clientFirstName} ${row.clientLastName}`.trim(),
      partyRole: row.partyRole,
      invoiceNumber: row.invoiceNumber,
      appointmentDateTime: row.appointmentDateTime,
      appointmentStatus: row.appointmentStatus,
    }));
  }

  private async getExternalXeroInvoices(caseId: string) {
    return db.select().from(xeroInvoiceRecords).where(eq(xeroInvoiceRecords.caseId, caseId)).orderBy(desc(xeroInvoiceRecords.createdAt));
  }

  private async getCasePartyClients(caseId: string): Promise<CasePartyClient[]> {
    const rows = await db.select({
      partyId: parties.id,
      role: parties.role,
      clientId: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.caseId, caseId));
    return rows.map((row) => ({
      partyId: row.partyId,
      role: row.role,
      clientId: row.clientId,
      clientName: `${row.firstName} ${row.lastName}`.trim(),
    }));
  }

  private async validateCaseClient(caseId: string, clientId: string, partyId?: string | null): Promise<ServiceResult<{ ok: true }>> {
    if (!caseId) return { ok: false, error: "caseId is required", status: 400 };
    if (!clientId) return { ok: false, error: "clientId is required", status: 400 };
    const existingCase = await this.getCase(caseId);
    if (!existingCase) return { ok: false, error: "Case not found", status: 404 };
    const rows = await this.getCasePartyClients(caseId);
    const clientParty = rows.find((row) => row.clientId === clientId);
    if (!clientParty) return { ok: false, error: "Client does not belong to this case", status: 400 };
    if (partyId) {
      const party = rows.find((row) => row.partyId === partyId);
      if (!party) return { ok: false, error: "Party does not belong to this case", status: 400 };
      if (party.clientId !== clientId) return { ok: false, error: "Party does not belong to the selected client", status: 400 };
    }
    return { ok: true };
  }

  private async getCase(caseId: string) {
    const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    return row;
  }

  private async getInvoice(invoiceId: string) {
    const [row] = await db.select().from(caseInvoices).where(eq(caseInvoices.id, invoiceId)).limit(1);
    return row;
  }

  private async getPayment(paymentId: string) {
    const [row] = await db.select().from(casePayments).where(eq(casePayments.id, paymentId)).limit(1);
    return row;
  }

  private computeInvoiceTotals(lines: InvoiceLineInput[]) {
    return lines.reduce((totals, line) => {
      const computed = computeLine(line);
      totals.subtotalPence += computed.lineSubtotalPence;
      totals.vatTotalPence += computed.vatAmountPence;
      totals.totalPence += computed.lineTotalPence;
      return totals;
    }, { subtotalPence: 0, vatTotalPence: 0, totalPence: 0 });
  }

  private async insertLineItems(invoiceId: string, lines: InvoiceLineInput[]) {
    const values = lines.map((line) => {
      const computed = computeLine(line);
      return {
        invoiceId,
        serviceTypeId: line.serviceTypeId || null,
        description: line.description.trim(),
        ...computed,
      };
    });
    if (values.length > 0) await db.insert(caseInvoiceLineItems).values(values);
  }

  private async recalculateInvoice(invoiceId: string): Promise<CaseInvoice | undefined> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return undefined;
    if (invoice.status === "void") return invoice;

    const [lineTotals] = await db.select({
      subtotalPence: sql<number>`COALESCE(SUM(${caseInvoiceLineItems.lineSubtotalPence}), 0)::int`,
      vatTotalPence: sql<number>`COALESCE(SUM(${caseInvoiceLineItems.vatAmountPence}), 0)::int`,
      totalPence: sql<number>`COALESCE(SUM(${caseInvoiceLineItems.lineTotalPence}), 0)::int`,
    }).from(caseInvoiceLineItems).where(eq(caseInvoiceLineItems.invoiceId, invoiceId));

    const [paymentTotals] = await db.select({
      amountPaidPence: sql<number>`COALESCE(SUM(${casePayments.amountPence}), 0)::int`,
    }).from(casePayments).where(and(
      eq(casePayments.invoiceId, invoiceId),
      sql`${casePayments.paymentStatus} IN ('paid', 'refunded')`,
    ));

    const grossTotalPence = money(lineTotals.totalPence);
    const voucherDiscountPence = Math.min(money(invoice.voucherDiscountPence || 0), grossTotalPence);
    const totalPence = Math.max(0, grossTotalPence - voucherDiscountPence);
    const amountPaidPence = money(paymentTotals.amountPaidPence);
    const outstandingPence = Math.max(0, totalPence - amountPaidPence);
    const nextStatus = totalPence === 0 ? "paid" : statusFromTotals({
      status: invoice.status,
      totalPence,
      amountPaidPence,
      dueDate: invoice.dueDate,
    });

    const paymentStatus = invoice.paymentStatus === "refunded"
      ? "refunded"
      : outstandingPence <= 0 && totalPence > 0
      ? "paid"
      : totalPence === 0
      ? "payment_not_required"
      : "unpaid";
    const [updated] = await db.update(caseInvoices).set({
      subtotalPence: money(lineTotals.subtotalPence),
      vatTotalPence: money(lineTotals.vatTotalPence),
      voucherDiscountPence,
      totalPence,
      amountPaidPence,
      outstandingPence,
      status: nextStatus,
      paymentStatus,
      updatedAt: new Date(),
    }).where(eq(caseInvoices.id, invoiceId)).returning();
    return updated;
  }

  private async getInvoiceByAppointment(appointmentId: string): Promise<CaseInvoice | undefined> {
    const [row] = await db.select().from(caseInvoices).where(eq(caseInvoices.appointmentId, appointmentId)).limit(1);
    return row;
  }

  async listInvoicesByAppointment(appointmentId: string): Promise<CaseInvoice[]> {
    return db.select().from(caseInvoices).where(eq(caseInvoices.appointmentId, appointmentId));
  }

  private async getInvoiceByAppointmentParty(appointmentId: string, partyId: string): Promise<CaseInvoice | undefined> {
    const [row] = await db
      .select()
      .from(caseInvoices)
      .where(and(eq(caseInvoices.appointmentId, appointmentId), eq(caseInvoices.billToPartyId, partyId)))
      .limit(1);
    return row;
  }

  private async getReusableMediationSessionInvoice(caseId: string, serviceTypeId: string, partyId: string, reusableAppointmentIds: string[]): Promise<CaseInvoice | undefined> {
    const [row] = await db
      .select()
      .from(caseInvoices)
      .where(and(
        eq(caseInvoices.caseId, caseId),
        eq(caseInvoices.serviceTypeId, serviceTypeId),
        eq(caseInvoices.billToPartyId, partyId),
        inArray(caseInvoices.appointmentId, reusableAppointmentIds),
        sql`${caseInvoices.status} <> 'void'`,
        sql`${caseInvoices.paymentStatus} NOT IN ('cancelled', 'expired', 'refunded')`,
      ))
      .orderBy(desc(caseInvoices.updatedAt))
      .limit(1);
    return row;
  }

  private async getPaymentByAppointment(appointmentId: string): Promise<CasePayment | undefined> {
    const [row] = await db.select().from(casePayments).where(eq(casePayments.appointmentId, appointmentId)).limit(1);
    return row;
  }

  private async getPaymentByInvoiceAndCheckoutSession(invoiceId: string, checkoutSessionId: string): Promise<CasePayment | undefined> {
    const [row] = await db
      .select()
      .from(casePayments)
      .where(and(eq(casePayments.invoiceId, invoiceId), eq(casePayments.checkoutSessionId, checkoutSessionId)))
      .limit(1);
    return row;
  }

  private async getPaymentByInvoice(invoiceId: string): Promise<CasePayment | undefined> {
    const [row] = await db
      .select()
      .from(casePayments)
      .where(eq(casePayments.invoiceId, invoiceId))
      .orderBy(desc(casePayments.createdAt))
      .limit(1);
    return row;
  }

  private async nextInvoiceNumberForAppointment(caseId: string, appointmentId: string): Promise<string> {
    const existing = await this.getInvoiceByAppointment(appointmentId);
    if (existing) return existing.invoiceNumber;
    return this.nextInvoiceNumber(caseId);
  }

  private async nextReceiptNumber(caseId: string): Promise<string> {
    const existingCase = await this.getCase(caseId);
    if (!existingCase) throw new Error("Case not found");
    const prefix = `RCPT-${normalizeCaseRefForInvoice(existingCase.caseRef)}-`;
    const rows = await db.select({ receiptNumber: casePayments.receiptNumber })
      .from(casePayments)
      .where(eq(casePayments.caseId, caseId))
      .orderBy(desc(casePayments.createdAt));
    const used = rows
      .map((row) => row.receiptNumber ? Number.parseInt(row.receiptNumber.replace(prefix, ""), 10) : NaN)
      .filter((n) => Number.isFinite(n));
    const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  }

  private async nextInvoiceNumber(caseId: string): Promise<string> {
    const existingCase = await this.getCase(caseId);
    if (!existingCase) throw new Error("Case not found");
    const prefix = `INV-${normalizeCaseRefForInvoice(existingCase.caseRef)}-`;
    const rows = await db.select({ invoiceNumber: caseInvoices.invoiceNumber })
      .from(caseInvoices)
      .where(eq(caseInvoices.caseId, caseId))
      .orderBy(desc(caseInvoices.createdAt));
    const used = rows
      .map((row) => Number.parseInt(row.invoiceNumber.replace(prefix, ""), 10))
      .filter((n) => Number.isFinite(n));
    const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
    return `${prefix}${String(next).padStart(3, "0")}`;
  }
}

export const financeService = new FinanceService();
