import crypto from "crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, xeroInvoiceRecords, xeroWebhookEvents } from "@shared/schema";
import type { Appointment, CaseInvoice, ServiceType, XeroInvoiceRecord } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import { logAudit } from "./audit-log.service";
import type { ServiceResult } from "./types";
import { financeService } from "./finance.service";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

type XeroTokenResponse = {
  access_token: string;
  expires_in: number;
};

type XeroOrganisationPayload = {
  OrganisationID?: string;
  Name?: string;
  OrganisationType?: string;
};

type XeroInvoicePayload = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Status?: string;
  AmountPaid?: number;
  Total?: number;
  DateString?: string;
  DueDateString?: string;
  FullyPaidOnDate?: string;
  Contact?: { ContactID?: string };
};

type XeroTaxRatePayload = {
  TaxType?: string;
  Name?: string;
  Status?: string;
  DisplayTaxRate?: number | string;
  EffectiveRate?: number | string;
  CanApplyToRevenue?: boolean | string;
  CanApplyToExpenses?: boolean | string;
  ReportTaxType?: string;
};

type XeroCurrencyPayload = {
  Code?: string;
  Description?: string;
};

type XeroAccountPayload = {
  Code?: string;
  Name?: string;
  Status?: string;
  Type?: string;
  Class?: string;
  TaxType?: string;
};

export type XeroTaxRateSummary = {
  taxType: string;
  name: string | null;
  status: string | null;
  displayTaxRate: string | null;
  effectiveRate: string | null;
  canApplyToRevenue: boolean;
  canApplyToExpenses: boolean;
  reportTaxType: string | null;
};

export type XeroCurrencySummary = {
  code: string;
  description: string | null;
};

export type XeroAccountSummary = {
  code: string;
  name: string | null;
  status: string | null;
  type: string | null;
  class: string | null;
  taxType: string | null;
};

export type XeroInvoiceSetupStatus = {
  ready: boolean;
  tenantId: string;
  tenantName: string | null;
  requiredCurrency: string;
  configuredAccountCode: string | null;
  configuredTaxType: string | null;
  currencies: XeroCurrencySummary[];
  account: XeroAccountSummary | null;
  taxRate: XeroTaxRateSummary | null;
  recommendedTaxType: XeroTaxRateSummary | null;
  issues: string[];
};

type XeroWebhookPayload = {
  events?: Array<{
    eventId?: string;
    eventCategory?: string;
    eventType?: string;
    resourceId?: string;
    tenantId?: string;
  }>;
};

function requireXeroClientConfig(): ServiceResult<{ clientId: string; clientSecret: string }> {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Xero Custom Connection credentials are not configured", status: 503 };
  }
  return { ok: true, clientId, clientSecret };
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

function tokenExpiry(expiresInSeconds: number): Date {
  return new Date(Date.now() + Math.max(60, expiresInSeconds - 60) * 1000);
}

function toPounds(amountPence: number): number {
  return Number((amountPence / 100).toFixed(2));
}

function toPence(amount: number | undefined): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function isPaidStatus(status: string | null | undefined): boolean {
  return (status || "").toUpperCase() === "PAID";
}

function boolFromXero(value: boolean | string | undefined): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseXeroValidationMessages(text: string): string[] {
  const parsed = parseJson<{
    Message?: string;
    Elements?: Array<{ ValidationErrors?: Array<{ Message?: string }> }>;
  }>(text);
  const messages = parsed?.Elements
    ?.flatMap((element) => element.ValidationErrors || [])
    .map((error) => error.Message?.trim())
    .filter((message): message is string => Boolean(message)) || [];
  if (messages.length > 0) return Array.from(new Set(messages));
  return parsed?.Message ? [parsed.Message] : [];
}

class XeroApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly safeMessage: string,
    public readonly validationMessages: string[],
  ) {
    super(safeMessage);
  }
}

function xeroErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof XeroApiError) return err.safeMessage;
  return err instanceof Error ? err.message : fallback;
}

async function xeroFetch<T>(
  url: string,
  options: RequestInit & { accessToken: string },
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${options.accessToken}`);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    const validationMessages = parseXeroValidationMessages(text);
    const details = validationMessages.length > 0 ? validationMessages.join("; ") : text.slice(0, 300);
    throw new XeroApiError(res.status, `Xero API returned ${res.status}: ${details}`, validationMessages);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function recommendXeroInvoiceTaxType(taxRates: XeroTaxRateSummary[]): XeroTaxRateSummary | null {
  const activeRevenueRates = taxRates.filter((rate) =>
    (rate.status || "").toUpperCase() === "ACTIVE" && rate.canApplyToRevenue,
  );
  return activeRevenueRates.find((rate) => rate.taxType === "OUTPUT2")
    || activeRevenueRates.find((rate) => rate.taxType === "OUTPUT")
    || activeRevenueRates[0]
    || null;
}

async function xeroTokenFetch(body: URLSearchParams, clientId: string, clientSecret: string): Promise<XeroTokenResponse> {
  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  // Token responses can include provider diagnostics. Never retain or expose their body.
  if (!res.ok) throw new Error(`Xero token endpoint returned ${res.status}`);
  return JSON.parse(text) as XeroTokenResponse;
}

type XeroCustomConnection = {
  accessToken: string;
  tokenExpiresAt: Date;
  tenantId: string;
  tenantName: string | null;
  tenantType: string | null;
};

export class XeroService {
  private customConnection: XeroCustomConnection | null = null;
  private lastConnectionError: string | null = null;

  getConfigStatus() {
    return {
      xeroClientIdConfigured: Boolean(process.env.XERO_CLIENT_ID),
      xeroClientSecretConfigured: Boolean(process.env.XERO_CLIENT_SECRET),
      xeroWebhookKeyConfigured: Boolean(process.env.XERO_WEBHOOK_KEY),
      xeroDefaultAccountCodeConfigured: Boolean(process.env.XERO_DEFAULT_ACCOUNT_CODE),
      xeroDefaultTaxTypeConfigured: Boolean(process.env.XERO_DEFAULT_TAX_TYPE),
      xeroDefaultBrandingThemeIdConfigured: Boolean(process.env.XERO_DEFAULT_BRANDING_THEME_ID),
    };
  }

  async getConnectionStatus() {
    const configured = this.getConfigStatus();
    if (!configured.xeroClientIdConfigured || !configured.xeroClientSecretConfigured) {
      return { configured, connected: false, connection: null, lastError: "Xero Custom Connection credentials are not configured" };
    }
    const result = await this.getCustomConnection();
    return {
      configured,
      connected: result.ok,
      connection: result.ok ? {
        tenantId: result.connection.tenantId,
        tenantName: result.connection.tenantName,
        tenantType: result.connection.tenantType,
        tokenExpiresAt: result.connection.tokenExpiresAt,
      } : null,
      lastError: this.lastConnectionError || (result.ok ? null : result.error),
    };
  }

  async getTaxRates(): Promise<ServiceResult<{
    tenantId: string;
    tenantName: string | null;
    taxRates: XeroTaxRateSummary[];
    recommendedTaxType: XeroTaxRateSummary | null;
  }>> {
    const connection = await this.getCustomConnection();
    if (!connection.ok) return connection;

    try {
      const taxRates = await this.fetchTaxRates(connection.connection);

      const recommendedTaxType = recommendXeroInvoiceTaxType(taxRates);
      return {
        ok: true,
        tenantId: connection.connection.tenantId,
        tenantName: connection.connection.tenantName,
        taxRates,
        recommendedTaxType,
      };
    } catch (err) {
      this.lastConnectionError = "Xero tax-rate lookup failed";
      return { ok: false, error: "Xero tax-rate lookup failed", status: 502 };
    }
  }

  async validateInvoiceSetup(requiredCurrency = "GBP"): Promise<ServiceResult<XeroInvoiceSetupStatus>> {
    const connection = await this.getCustomConnection();
    if (!connection.ok) return connection;

    const configuredAccountCode = process.env.XERO_DEFAULT_ACCOUNT_CODE || null;
    const configuredTaxType = process.env.XERO_DEFAULT_TAX_TYPE || null;
    const normalizedCurrency = requiredCurrency.toUpperCase();
    const issues: string[] = [];
    let currencies: XeroCurrencySummary[] = [];
    let account: XeroAccountSummary | null = null;
    let taxRates: XeroTaxRateSummary[] = [];

    try {
      currencies = await this.fetchCurrencies(connection.connection);
      taxRates = await this.fetchTaxRates(connection.connection);
      if (configuredAccountCode) {
        account = await this.fetchAccount(connection.connection, configuredAccountCode);
      }
    } catch (err) {
      const status = err instanceof XeroApiError ? err.status : undefined;
      logger.warn("Xero setup validation request failed", { status }, "xero");
      this.lastConnectionError = "Xero setup validation failed";
      return { ok: false, error: "Xero setup validation failed", status: 502 };
    }

    if (!configuredAccountCode) issues.push("XERO_DEFAULT_ACCOUNT_CODE is not configured.");
    if (!configuredTaxType) issues.push("XERO_DEFAULT_TAX_TYPE is not configured.");
    if (!currencies.some((currency) => currency.code === normalizedCurrency)) {
      issues.push(`Xero is not ready for ${normalizedCurrency} invoices. Enable ${normalizedCurrency} in Xero or connect the UK BFM organisation.`);
    }

    if (configuredAccountCode) {
      if (!account) {
        issues.push(`Xero account code ${configuredAccountCode} was not found.`);
      } else {
        const accountStatus = (account.status || "").toUpperCase();
        const accountType = (account.type || "").toUpperCase();
        const accountClass = (account.class || "").toUpperCase();
        if (accountStatus !== "ACTIVE") issues.push(`Xero account ${configuredAccountCode} is not active.`);
        if (accountType !== "REVENUE" && accountClass !== "REVENUE") {
          issues.push(`Xero account ${configuredAccountCode} must be a revenue/sales account.`);
        }
      }
    }

    const taxRate = configuredTaxType
      ? taxRates.find((rate) => rate.taxType.toUpperCase() === configuredTaxType.toUpperCase()) || null
      : null;
    if (configuredTaxType) {
      if (!taxRate) {
        issues.push(`Xero tax type ${configuredTaxType} was not found.`);
      } else {
        if ((taxRate.status || "").toUpperCase() !== "ACTIVE") issues.push(`Xero tax type ${configuredTaxType} is not active.`);
        if (!taxRate.canApplyToRevenue) issues.push(`Xero tax type ${configuredTaxType} cannot be applied to revenue invoices.`);
      }
    }
    if (account?.taxType && configuredTaxType && account.taxType.toUpperCase() !== configuredTaxType.toUpperCase()) {
      issues.push(`Xero account ${configuredAccountCode} is configured with tax type ${account.taxType}, but XERO_DEFAULT_TAX_TYPE is ${configuredTaxType}.`);
    }

    const setupStatus: XeroInvoiceSetupStatus = {
      ready: issues.length === 0,
      tenantId: connection.connection.tenantId,
      tenantName: connection.connection.tenantName,
      requiredCurrency: normalizedCurrency,
      configuredAccountCode,
      configuredTaxType,
      currencies,
      account,
      taxRate,
      recommendedTaxType: recommendXeroInvoiceTaxType(taxRates),
      issues,
    };

    return { ok: true, ...setupStatus };
  }

  async createInvoiceForAppointment(input: {
    appointment: Appointment;
    serviceType: ServiceType;
    caseRef: string;
    partyId: string;
    partyEmail: string;
    partyName: string;
  }): Promise<ServiceResult<{ record: XeroInvoiceRecord; invoiceUrl: string | null; emailSent: boolean }>> {
    const existing = await this.getInvoiceByAppointment(input.appointment.id);
    if (existing) {
      return { ok: true, record: existing, invoiceUrl: existing.xeroInvoiceUrl, emailSent: Boolean(existing.sentAt) };
    }

    if (!input.serviceType.paymentAmountPence || input.serviceType.paymentAmountPence <= 0) {
      return { ok: false, error: "This service is not configured for online payment", status: 400 };
    }
    if (!input.partyEmail) {
      return { ok: false, error: "Client email is required before creating a Xero invoice", status: 400 };
    }

    const connection = await this.getCustomConnection();
    if (!connection.ok) return connection;

    const accountCode = process.env.XERO_DEFAULT_ACCOUNT_CODE;
    const taxType = process.env.XERO_DEFAULT_TAX_TYPE;
    if (!accountCode || !taxType) {
      return { ok: false, error: "Xero account code and tax type are not configured", status: 503 };
    }

    const invoiceCurrency = (input.serviceType.paymentCurrency || "gbp").toUpperCase();
    const setup = await this.validateInvoiceSetup(invoiceCurrency);
    if (!setup.ok) return setup;
    if (!setup.ready) {
      logger.warn("Xero invoice setup validation failed", {
        tenantId: setup.tenantId,
        tenantName: setup.tenantName,
        accountCode,
        taxType,
        currency: invoiceCurrency,
        issues: setup.issues,
      }, "xero");
      return { ok: false, error: setup.issues[0] || "Xero invoice setup is not ready", status: 503 };
    }

    let contact: { contactId: string };
    let invoice: { invoiceId: string; invoiceNumber: string | null; status: string };
    let invoiceUrl: string | null;
    try {
      contact = await this.findOrCreateContact(connection.connection, input.partyName, input.partyEmail);
      invoice = await this.createApprovedInvoice(connection.connection, {
        contactId: contact.contactId,
        serviceName: input.serviceType.name,
        caseRef: input.caseRef,
        partyName: input.partyName,
        appointmentId: input.appointment.id,
        amountPence: input.serviceType.paymentAmountPence,
        currency: invoiceCurrency,
        accountCode,
        taxType,
      });
      invoiceUrl = await this.getOnlineInvoiceUrl(connection.connection, invoice.invoiceId);
    } catch (err) {
      const message = xeroErrorMessage(err, "Xero invoice creation failed");
      logger.warn("Xero invoice creation failed", {
        tenantId: connection.connection.tenantId,
        tenantName: connection.connection.tenantName,
        accountCode,
        taxType,
        currency: invoiceCurrency,
        invoiceReference: `${input.caseRef} ${input.appointment.id.slice(0, 8)}`,
        validationMessages: err instanceof XeroApiError ? err.validationMessages : [],
        reason: message,
      }, "xero");
      this.lastConnectionError = "Xero invoice creation failed";
      return { ok: false, error: message, status: err instanceof XeroApiError && err.status < 500 ? 400 : 502 };
    }

    const [record] = await db.insert(xeroInvoiceRecords).values({
      appointmentId: input.appointment.id,
      caseId: input.appointment.caseId,
      partyId: input.partyId,
      clientId: (await storage.getParty(input.partyId))?.clientId || null,
      xeroConnectionId: null,
      xeroTenantId: connection.connection.tenantId,
      xeroContactId: contact.contactId,
      xeroInvoiceId: invoice.invoiceId,
      xeroInvoiceNumber: invoice.invoiceNumber,
      xeroInvoiceUrl: invoiceUrl,
      xeroStatus: invoice.status,
      amountPence: input.serviceType.paymentAmountPence,
      currency: (input.serviceType.paymentCurrency || "gbp").toLowerCase(),
      metadata: JSON.stringify({ caseRef: input.caseRef, partyName: input.partyName, serviceTypeId: input.serviceType.id }),
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    await storage.updateAppointment(input.appointment.id, {
      paymentProvider: "xero_stripe",
      paymentAmountPence: input.serviceType.paymentAmountPence,
      paymentCurrency: (input.serviceType.paymentCurrency || "gbp").toLowerCase(),
      paymentNotes: `Xero invoice ${invoice.invoiceNumber || invoice.invoiceId} created`,
    });
    await financeService.ensureBookingInvoice({
      appointment: { ...input.appointment, paymentProvider: "xero_stripe" },
      serviceType: input.serviceType,
      caseRef: input.caseRef,
      partyId: input.partyId,
      provider: "xero_stripe",
      providerInvoiceId: invoice.invoiceId,
      paymentLinkUrl: invoiceUrl,
      paymentStatus: "unpaid",
    });

    let emailSent = false;
    if (invoiceUrl) {
      const { sendXeroInvoicePaymentEmail } = await import("./email.service");
      emailSent = await sendXeroInvoicePaymentEmail(
        input.partyEmail,
        input.partyName,
        input.serviceType.name,
        input.caseRef,
        invoiceUrl,
        input.serviceType.paymentAmountPence,
        (input.serviceType.paymentCurrency || "gbp").toLowerCase(),
        input.appointment.dateTime,
        input.appointment.dateTimeBasis as "instant" | "wall_clock_utc",
      );
      if (emailSent) {
        const [sentRecord] = await db.update(xeroInvoiceRecords).set({
          sentAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(xeroInvoiceRecords.id, record.id)).returning();
        return { ok: true, record: sentRecord, invoiceUrl, emailSent };
      }
    }

    return { ok: true, record, invoiceUrl, emailSent };
  }

  async createInvoiceForCaseInvoice(input: {
    invoice: CaseInvoice;
    appointment: Appointment;
    serviceType: ServiceType;
    caseRef: string;
    partyId: string;
    partyEmail: string;
    partyName: string;
  }): Promise<ServiceResult<{ record: XeroInvoiceRecord; invoiceUrl: string | null; xeroInvoiceNumber: string | null; paymentReference: string | null }>> {
    const existing = await this.getInvoiceByCaseInvoice(input.invoice.id);
    if (existing) {
      return {
        ok: true,
        record: existing,
        invoiceUrl: existing.xeroInvoiceUrl,
        xeroInvoiceNumber: existing.xeroInvoiceNumber,
        paymentReference: existing.xeroInvoiceNumber,
      };
    }
    if (!input.partyEmail) return { ok: false, error: "Client email is required before creating a Xero invoice", status: 400 };
    if (input.invoice.totalPence <= 0 || input.invoice.paymentStatus === "payment_not_required") {
      return { ok: false, error: "Xero invoice is not required for a zero-value invoice", status: 400 };
    }

    const connection = await this.getCustomConnection();
    if (!connection.ok) return connection;

    const accountCode = process.env.XERO_DEFAULT_ACCOUNT_CODE;
    const taxType = process.env.XERO_DEFAULT_TAX_TYPE;
    if (!accountCode || !taxType) return { ok: false, error: "Xero account code and tax type are not configured", status: 503 };

    const invoiceCurrency = (input.invoice.currency || input.serviceType.paymentCurrency || "gbp").toUpperCase();
    const setup = await this.validateInvoiceSetup(invoiceCurrency);
    if (!setup.ok) return setup;
    if (!setup.ready) return { ok: false, error: setup.issues[0] || "Xero invoice setup is not ready", status: 503 };

    let contact: { contactId: string };
    let invoice: { invoiceId: string; invoiceNumber: string | null; status: string };
    let invoiceUrl: string | null;
    try {
      contact = await this.findOrCreateContact(connection.connection, input.partyName, input.partyEmail);
      invoice = await this.createApprovedInvoice(connection.connection, {
        contactId: contact.contactId,
        serviceName: input.serviceType.name,
        caseRef: input.caseRef,
        partyName: input.partyName,
        appointmentId: input.appointment.id,
        amountPence: input.invoice.totalPence,
        currency: invoiceCurrency,
        accountCode,
        taxType,
      });
      invoiceUrl = await this.getOnlineInvoiceUrl(connection.connection, invoice.invoiceId);
    } catch (err) {
      const message = xeroErrorMessage(err, "Xero invoice creation failed");
      logger.warn("Xero-owned case invoice creation failed", {
        invoiceId: input.invoice.id,
        caseRef: input.caseRef,
        reason: message,
      }, "xero");
      return { ok: false, error: message, status: err instanceof XeroApiError && err.status < 500 ? 400 : 502 };
    }

    const [record] = await db.insert(xeroInvoiceRecords).values({
      appointmentId: input.appointment.id,
      caseId: input.invoice.caseId,
      partyId: input.partyId,
      clientId: input.invoice.billToClientId,
      caseInvoiceId: input.invoice.id,
      xeroConnectionId: null,
      xeroTenantId: connection.connection.tenantId,
      xeroContactId: contact.contactId,
      xeroInvoiceId: invoice.invoiceId,
      xeroInvoiceNumber: invoice.invoiceNumber,
      xeroInvoiceUrl: invoiceUrl,
      xeroStatus: invoice.status,
      amountPence: input.invoice.totalPence,
      currency: input.invoice.currency || "gbp",
      metadata: JSON.stringify({ caseRef: input.caseRef, partyName: input.partyName, serviceTypeId: input.serviceType.id, caseInvoiceId: input.invoice.id }),
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    return {
      ok: true,
      record,
      invoiceUrl,
      xeroInvoiceNumber: invoice.invoiceNumber,
      paymentReference: invoice.invoiceNumber,
    };
  }

  async getInvoiceByAppointment(appointmentId: string): Promise<XeroInvoiceRecord | undefined> {
    const [record] = await db
      .select()
      .from(xeroInvoiceRecords)
      .where(eq(xeroInvoiceRecords.appointmentId, appointmentId))
      .limit(1);
    return record;
  }

  async getInvoiceByCaseInvoice(caseInvoiceId: string): Promise<XeroInvoiceRecord | undefined> {
    const [record] = await db
      .select()
      .from(xeroInvoiceRecords)
      .where(eq(xeroInvoiceRecords.caseInvoiceId, caseInvoiceId))
      .limit(1);
    return record;
  }

  async getInvoicesByAppointmentIds(appointmentIds: string[]): Promise<XeroInvoiceRecord[]> {
    if (appointmentIds.length === 0) return [];
    return db.select().from(xeroInvoiceRecords).where(inArray(xeroInvoiceRecords.appointmentId, appointmentIds));
  }

  async syncAppointmentInvoice(appointmentId: string): Promise<ServiceResult<{ record: XeroInvoiceRecord; action: string }>> {
    const record = await this.getInvoiceByAppointment(appointmentId);
    if (!record) return { ok: false, error: "No Xero invoice is linked to this appointment", status: 404 };
    return this.syncInvoiceRecord(record);
  }

  async syncPendingInvoices(limit = 20): Promise<void> {
    const records = await db
      .select()
      .from(xeroInvoiceRecords)
      .where(and(ne(xeroInvoiceRecords.xeroStatus, "PAID"), sql`${xeroInvoiceRecords.lastError} IS NULL OR ${xeroInvoiceRecords.lastError} != 'sync_in_progress'`))
      .limit(limit);
    for (const record of records) {
      try {
        await this.syncInvoiceRecord(record);
      } catch (err) {
        logger.warn("Xero pending invoice sync failed", {
          invoice: record.xeroInvoiceNumber || record.xeroInvoiceId,
          reason: err instanceof Error ? err.message : String(err),
        }, "xero");
      }
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const key = process.env.XERO_WEBHOOK_KEY;
    if (!key) return false;
    const expected = crypto.createHmac("sha256", key).update(rawBody).digest("base64");
    try {
      const actualBuffer = Buffer.from(signature, "base64");
      const expectedBuffer = Buffer.from(expected, "base64");
      return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  async handleWebhookPayload(payload: XeroWebhookPayload): Promise<{ received: true; processed: number }> {
    let processed = 0;
    for (const event of payload.events || []) {
      const eventId = event.eventId;
      if (!eventId) continue;
      const inserted = await db.insert(xeroWebhookEvents).values({
        xeroEventId: eventId,
        eventCategory: event.eventCategory || null,
        eventType: event.eventType || null,
        resourceId: event.resourceId || null,
        tenantId: event.tenantId || null,
        action: "received",
      }).onConflictDoNothing().returning();
      if (inserted.length === 0) continue;

      let action = "ignored";
      if (event.eventCategory === "INVOICE" && event.resourceId) {
        const record = await this.getInvoiceByXeroId(event.resourceId);
        if (record) {
          const result = await this.syncInvoiceRecord(record);
          action = result.ok ? result.action : "sync_failed";
        } else {
          action = "invoice_record_not_found";
        }
      }
      await db.update(xeroWebhookEvents).set({ action }).where(eq(xeroWebhookEvents.xeroEventId, eventId));
      processed += 1;
    }
    return { received: true, processed };
  }

  private async getCustomConnection(): Promise<ServiceResult<{ connection: XeroCustomConnection }>> {
    if (this.customConnection && this.customConnection.tokenExpiresAt.getTime() - Date.now() > 2 * 60 * 1000) {
      this.lastConnectionError = null;
      return { ok: true, connection: this.customConnection };
    }
    const config = requireXeroClientConfig();
    if (!config.ok) return config;
    try {
      const token = await xeroTokenFetch(new URLSearchParams({ grant_type: "client_credentials" }), config.clientId, config.clientSecret);
      const organisation = await xeroFetch<{ Organisations?: XeroOrganisationPayload[] }>(
        `${XERO_API_BASE}/Organisation`,
        { method: "GET", accessToken: token.access_token },
      );
      const organisationDetails = organisation.Organisations?.[0];
      if (!organisationDetails?.OrganisationID) throw new Error("Xero Custom Connection did not return an organisation id");
      this.customConnection = {
        accessToken: token.access_token,
        tokenExpiresAt: tokenExpiry(token.expires_in),
        tenantId: organisationDetails.OrganisationID,
        tenantName: organisationDetails.Name || null,
        tenantType: organisationDetails.OrganisationType || "ORGANISATION",
      };
      this.lastConnectionError = null;
      return { ok: true, connection: this.customConnection };
    } catch (err) {
      this.customConnection = null;
      const status = err instanceof XeroApiError ? err.status : undefined;
      logger.warn("Xero Custom Connection authentication failed", { status }, "xero");
      this.lastConnectionError = "Xero Custom Connection authentication failed";
      return { ok: false, error: "Xero Custom Connection is unavailable", status: 503 };
    }
  }

  private async fetchCurrencies(connection: XeroCustomConnection): Promise<XeroCurrencySummary[]> {
    const result = await xeroFetch<{ Currencies?: XeroCurrencyPayload[] }>(
      `${XERO_API_BASE}/Currencies`,
      { method: "GET", accessToken: connection.accessToken },
    );
    return (result.Currencies || [])
      .filter((currency) => Boolean(currency.Code))
      .map((currency) => ({
        code: String(currency.Code).toUpperCase(),
        description: currency.Description || null,
      }));
  }

  private async fetchAccount(connection: XeroCustomConnection, accountCode: string): Promise<XeroAccountSummary | null> {
    const result = await xeroFetch<{ Accounts?: XeroAccountPayload[] }>(
      `${XERO_API_BASE}/Accounts/${encodeURIComponent(accountCode)}`,
      { method: "GET", accessToken: connection.accessToken },
    );
    const account = result.Accounts?.[0];
    if (!account?.Code) return null;
    return {
      code: String(account.Code),
      name: account.Name || null,
      status: account.Status || null,
      type: account.Type || null,
      class: account.Class || null,
      taxType: account.TaxType || null,
    };
  }

  private async fetchTaxRates(connection: XeroCustomConnection): Promise<XeroTaxRateSummary[]> {
    const result = await xeroFetch<{ TaxRates?: XeroTaxRatePayload[] }>(
      `${XERO_API_BASE}/TaxRates`,
      { method: "GET", accessToken: connection.accessToken },
    );
    return (result.TaxRates || [])
      .filter((rate) => Boolean(rate.TaxType))
      .map((rate) => ({
        taxType: String(rate.TaxType),
        name: rate.Name || null,
        status: rate.Status || null,
        displayTaxRate: rate.DisplayTaxRate === undefined ? null : String(rate.DisplayTaxRate),
        effectiveRate: rate.EffectiveRate === undefined ? null : String(rate.EffectiveRate),
        canApplyToRevenue: boolFromXero(rate.CanApplyToRevenue),
        canApplyToExpenses: boolFromXero(rate.CanApplyToExpenses),
        reportTaxType: rate.ReportTaxType || null,
      }));
  }

  private async findOrCreateContact(connection: XeroCustomConnection, name: string, email: string): Promise<{ contactId: string }> {
    const where = encodeURIComponent(`EmailAddress=="${email.replace(/"/g, '\\"')}"`);
    const existing = await xeroFetch<{ Contacts?: Array<{ ContactID?: string }> }>(
      `${XERO_API_BASE}/Contacts?where=${where}`,
      { method: "GET", accessToken: connection.accessToken },
    );
    const contactId = existing.Contacts?.[0]?.ContactID;
    if (contactId) return { contactId };

    const created = await xeroFetch<{ Contacts?: Array<{ ContactID?: string }> }>(
      `${XERO_API_BASE}/Contacts`,
      {
        method: "POST",
        accessToken: connection.accessToken,
        body: JSON.stringify({ Contacts: [{ Name: name, EmailAddress: email }] }),
      },
    );
    const createdId = created.Contacts?.[0]?.ContactID;
    if (!createdId) throw new Error("Xero did not return a contact id");
    return { contactId: createdId };
  }

  private async createApprovedInvoice(connection: XeroCustomConnection, input: {
    contactId: string;
    serviceName: string;
    caseRef: string;
    partyName: string;
    appointmentId: string;
    amountPence: number;
    currency: string;
    accountCode: string;
    taxType: string;
  }): Promise<{ invoiceId: string; invoiceNumber: string | null; status: string }> {
    const today = new Date();
    const dueDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const invoiceBody: Record<string, unknown> = {
      Type: "ACCREC",
      Contact: { ContactID: input.contactId },
      Date: today.toISOString().slice(0, 10),
      DueDate: dueDate.toISOString().slice(0, 10),
      Reference: input.caseRef,
      CurrencyCode: input.currency,
      Status: "AUTHORISED",
      LineItems: [{
        Description: `${input.serviceName} - Case ${input.caseRef} - ${input.partyName}`,
        Quantity: 1,
        UnitAmount: toPounds(input.amountPence),
        AccountCode: input.accountCode,
        TaxType: input.taxType,
      }],
    };
    if (process.env.XERO_DEFAULT_BRANDING_THEME_ID) {
      invoiceBody.BrandingThemeID = process.env.XERO_DEFAULT_BRANDING_THEME_ID;
    }

    const created = await xeroFetch<{ Invoices?: XeroInvoicePayload[] }>(
      `${XERO_API_BASE}/Invoices`,
      {
        method: "POST",
        accessToken: connection.accessToken,
        body: JSON.stringify({ Invoices: [invoiceBody] }),
      },
    );
    const invoice = created.Invoices?.[0];
    if (!invoice?.InvoiceID) throw new Error("Xero did not return an invoice id");
    return {
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber || null,
      status: invoice.Status || "AUTHORISED",
    };
  }

  private async getOnlineInvoiceUrl(connection: XeroCustomConnection, invoiceId: string): Promise<string | null> {
    const result = await xeroFetch<{ OnlineInvoices?: Array<{ OnlineInvoiceUrl?: string }> }>(
      `${XERO_API_BASE}/Invoices/${invoiceId}/OnlineInvoice`,
      { method: "GET", accessToken: connection.accessToken },
    );
    return result.OnlineInvoices?.[0]?.OnlineInvoiceUrl || null;
  }

  private async getInvoiceByXeroId(xeroInvoiceId: string): Promise<XeroInvoiceRecord | undefined> {
    const [record] = await db
      .select()
      .from(xeroInvoiceRecords)
      .where(eq(xeroInvoiceRecords.xeroInvoiceId, xeroInvoiceId))
      .limit(1);
    return record;
  }

  private async syncInvoiceRecord(record: XeroInvoiceRecord): Promise<ServiceResult<{ record: XeroInvoiceRecord; action: string }>> {
    const connectionResult = await this.getCustomConnection();
    if (!connectionResult.ok) return connectionResult;
    const connection = connectionResult.connection;

    try {
      const fetched = await xeroFetch<{ Invoices?: XeroInvoicePayload[] }>(
        `${XERO_API_BASE}/Invoices/${record.xeroInvoiceId}`,
        { method: "GET", accessToken: connection.accessToken },
      );
      const invoice = fetched.Invoices?.[0];
      if (!invoice) return { ok: false, error: "Xero invoice not found", status: 404 };

      const xeroStatus = invoice.Status || record.xeroStatus;
      const paidAt = invoice.FullyPaidOnDate ? new Date(invoice.FullyPaidOnDate) : (isPaidStatus(xeroStatus) ? new Date() : record.paidAt);
      const [updatedRecord] = await db.update(xeroInvoiceRecords).set({
        xeroStatus,
        xeroInvoiceNumber: invoice.InvoiceNumber || record.xeroInvoiceNumber,
        xeroContactId: invoice.Contact?.ContactID || record.xeroContactId,
        paidAt,
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      }).where(eq(xeroInvoiceRecords.id, record.id)).returning();

      let action = "invoice_synced";
      if (isPaidStatus(xeroStatus)) {
        const appointment = await storage.getAppointment(record.appointmentId);
        if (appointment && appointment.paymentStatus !== "paid") {
          await storage.updateAppointment(record.appointmentId, {
            paymentStatus: "paid",
            paymentStatusUpdatedAt: new Date(),
            paymentStatusUpdatedBy: null,
            paymentProvider: "xero_stripe",
            paymentAmountPence: toPence(invoice.Total) || record.amountPence,
            paymentCurrency: record.currency,
            paymentFailureReason: null,
            paymentNotes: `Xero invoice ${updatedRecord.xeroInvoiceNumber || updatedRecord.xeroInvoiceId} paid`,
          });
        }
        const latest = await storage.getAppointment(record.appointmentId);
        if (latest) {
          await financeService.recordBookingPayment({
            appointment: latest,
            provider: "xero_stripe",
            providerPaymentId: updatedRecord.xeroInvoiceId,
            amountPence: toPence(invoice.AmountPaid) || toPence(invoice.Total) || record.amountPence,
            currency: record.currency,
            paymentDate: paidAt || new Date(),
            reference: updatedRecord.xeroInvoiceNumber || updatedRecord.xeroInvoiceId,
          });
        }
        if (updatedRecord.caseInvoiceId) {
          await financeService.recordXeroOwnedCaseInvoicePayment({
            invoiceId: updatedRecord.caseInvoiceId,
            providerInvoiceId: updatedRecord.xeroInvoiceId,
            amountPence: toPence(invoice.AmountPaid) || toPence(invoice.Total) || updatedRecord.amountPence,
            currency: updatedRecord.currency,
            paymentDate: paidAt || new Date(),
            reference: updatedRecord.xeroInvoiceNumber || updatedRecord.xeroInvoiceId,
          });
        }
        if (latest?.status === "hold" || latest?.status === "held") {
          const { appointmentService } = await import("./appointment.service");
          const confirmResult = await appointmentService.confirmPaidPublicBooking(latest.id, "xero_invoice_paid");
          action = confirmResult.ok ? "paid_and_confirmed" : "paid_confirmation_failed";
          if (!confirmResult.ok) {
            logger.warn("Xero invoice paid but appointment confirmation failed", {
              appointmentId: latest.id,
              invoiceId: updatedRecord.xeroInvoiceId,
              reason: confirmResult.error,
            }, "xero");
          }
        } else {
          action = latest?.status === "confirmed" ? "paid_already_confirmed" : "paid_not_confirmable";
        }
      }

      await logAudit({
        userId: null,
        action: "xero_invoice_synced",
        entity: "appointment",
        entityId: record.appointmentId,
        entityRef: updatedRecord.xeroInvoiceNumber || updatedRecord.xeroInvoiceId,
        details: JSON.stringify({ xeroStatus, action }),
      });
      return { ok: true, record: updatedRecord, action };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Xero invoice sync failed";
      const [updatedRecord] = await db.update(xeroInvoiceRecords).set({
        lastError: message,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(xeroInvoiceRecords.id, record.id)).returning();
      return { ok: false, error: message, status: 502, record: updatedRecord, action: "sync_failed" } as ServiceResult<{ record: XeroInvoiceRecord; action: string }>;
    }
  }

  getInvoiceMetadata(record: XeroInvoiceRecord): Record<string, unknown> | null {
    return parseJson<Record<string, unknown>>(record.metadata);
  }
}

export const xeroService = new XeroService();
