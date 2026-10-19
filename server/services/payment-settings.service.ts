import { eq } from "drizzle-orm";
import { db } from "../db";
import { appSettings } from "@shared/schema";
import { logAudit } from "./audit-log.service";

export const BOOKING_PAYMENT_PROVIDER_SETTING_KEY = "bookingPaymentProvider";
export const BANK_TRANSFER_SETTINGS_KEY = "bankTransferSettings";
export const BOOKING_PAYMENT_PROVIDERS = ["xero_invoice", "direct_stripe_checkout"] as const;
export type BookingPaymentProvider = typeof BOOKING_PAYMENT_PROVIDERS[number];

export type BankTransferSettings = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
  iban: string;
  swift: string;
  instructions: string;
};

export function isBookingPaymentProvider(value: unknown): value is BookingPaymentProvider {
  return typeof value === "string" && (BOOKING_PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

function defaultBookingPaymentProvider(): BookingPaymentProvider {
  return "xero_invoice";
}

export function defaultBankTransferSettings(): BankTransferSettings {
  return {
    accountName: "",
    sortCode: "",
    accountNumber: "",
    iban: "",
    swift: "",
    instructions: "Bank transfer is preferred. Please use the Xero invoice number as your payment reference.",
  };
}

function parseBankTransferSettings(value: string | null | undefined): BankTransferSettings {
  if (!value) return defaultBankTransferSettings();
  try {
    const parsed = JSON.parse(value) as Partial<BankTransferSettings>;
    return {
      ...defaultBankTransferSettings(),
      accountName: String(parsed.accountName || ""),
      sortCode: String(parsed.sortCode || ""),
      accountNumber: String(parsed.accountNumber || ""),
      iban: String(parsed.iban || ""),
      swift: String(parsed.swift || ""),
      instructions: String(parsed.instructions || defaultBankTransferSettings().instructions),
    };
  } catch {
    return defaultBankTransferSettings();
  }
}

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.REPL_SLUG) return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
  return "http://localhost:5000";
}

export class PaymentSettingsService {
  async getBookingPaymentProvider(): Promise<BookingPaymentProvider> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, BOOKING_PAYMENT_PROVIDER_SETTING_KEY))
      .limit(1);
    return isBookingPaymentProvider(row?.value) ? row.value : defaultBookingPaymentProvider();
  }

  async getBankTransferSettings(): Promise<BankTransferSettings> {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, BANK_TRANSFER_SETTINGS_KEY))
      .limit(1);
    return parseBankTransferSettings(row?.value);
  }

  async setBankTransferSettings(settings: BankTransferSettings, userId: string): Promise<BankTransferSettings> {
    const normalized: BankTransferSettings = {
      accountName: settings.accountName.trim(),
      sortCode: settings.sortCode.trim(),
      accountNumber: settings.accountNumber.trim(),
      iban: settings.iban.trim(),
      swift: settings.swift.trim(),
      instructions: settings.instructions.trim() || defaultBankTransferSettings().instructions,
    };
    await db
      .insert(appSettings)
      .values({
        key: BANK_TRANSFER_SETTINGS_KEY,
        value: JSON.stringify(normalized),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: JSON.stringify(normalized),
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });

    await logAudit({
      userId,
      action: "bank_transfer_settings_updated",
      entity: "app_setting",
      entityId: BANK_TRANSFER_SETTINGS_KEY,
    });
    return normalized;
  }

  async setBookingPaymentProvider(provider: BookingPaymentProvider, userId: string): Promise<{
    provider: BookingPaymentProvider;
    previousProvider: BookingPaymentProvider;
  }> {
    const previousProvider = await this.getBookingPaymentProvider();
    await db
      .insert(appSettings)
      .values({
        key: BOOKING_PAYMENT_PROVIDER_SETTING_KEY,
        value: provider,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: provider,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });

    if (previousProvider !== provider) {
      await logAudit({
        userId,
        action: "booking_payment_provider_changed",
        entity: "app_setting",
        entityId: BOOKING_PAYMENT_PROVIDER_SETTING_KEY,
        details: JSON.stringify({ previousProvider, provider }),
      });
    }

    return { provider, previousProvider };
  }

  getStripeReadiness() {
    return {
      stripeSecretKeyConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      stripeWebhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      stripeWebhookEndpoint: `${getBaseUrl()}/api/public/stripe/webhook`,
    };
  }

  getXeroWebhookEndpoint() {
    return `${getBaseUrl()}/api/public/integrations/xero/webhook`;
  }
}

export const paymentSettingsService = new PaymentSettingsService();
