import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema and bootstrap persist booking payment provider with Xero default", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(schemaSource, /appSettings = pgTable\("app_settings"/);
  assert.match(schemaSource, /key: text\("key"\)\.primaryKey\(\)/);
  assert.match(schemaSource, /value: text\("value"\)\.notNull\(\)/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS app_settings/);
  assert.match(bootstrapSource, /bookingPaymentProvider/);
  assert.match(bootstrapSource, /'xero_invoice'/);
  assert.match(bootstrapSource, /ON CONFLICT \(key\) DO NOTHING/);
});

test("payment settings service exposes allowed providers, readiness, and audit logging", () => {
  const serviceSource = read("../server/services/payment-settings.service.ts");

  assert.match(serviceSource, /BOOKING_PAYMENT_PROVIDERS = \["xero_invoice", "direct_stripe_checkout"\]/);
  assert.match(serviceSource, /defaultBookingPaymentProvider\(\): BookingPaymentProvider/);
  assert.match(serviceSource, /return "xero_invoice"/);
  assert.match(serviceSource, /STRIPE_SECRET_KEY/);
  assert.match(serviceSource, /STRIPE_WEBHOOK_SECRET/);
  assert.match(serviceSource, /\/api\/public\/stripe\/webhook/);
  assert.match(serviceSource, /getXeroWebhookEndpoint/);
  assert.match(serviceSource, /\/api\/public\/integrations\/xero\/webhook/);
  assert.match(serviceSource, /booking_payment_provider_changed/);
});

test("payment mode API is superadmin-only and blocks direct Stripe without secret key", () => {
  const routeSource = read("../server/routes/settings.routes.ts");
  const indexSource = read("../server/routes/index.ts");

  assert.match(indexSource, /settingsRoutes/);
  assert.match(routeSource, /\/api\/settings\/payment-mode/);
  assert.match(routeSource, /Only superadmins can manage payment settings/);
  assert.match(routeSource, /provider must be xero_invoice or direct_stripe_checkout/);
  assert.match(routeSource, /direct_stripe_checkout/);
  assert.match(routeSource, /STRIPE_SECRET_KEY is required before enabling direct Stripe Checkout/);
  assert.match(routeSource, /xeroWebhookEndpoint/);
});

test("booking service branches paid bookings between Xero invoice and direct Stripe Checkout", () => {
  const bookingSource = read("../server/services/booking.service.ts");
  const routeSource = read("../server/routes/booking.routes.ts");

  assert.match(bookingSource, /paymentSettingsService\.getBookingPaymentProvider\(\)/);
  assert.match(bookingSource, /bookingPaymentProvider === "direct_stripe_checkout"/);
  assert.match(bookingSource, /stripePaymentService\.createBookingCheckoutSession/);
  assert.match(bookingSource, /xeroService\.createInvoiceForAppointment/);
  assert.match(bookingSource, /paymentProvider:\s*appointmentPaymentProvider/);
  assert.match(bookingSource, /await storage\.deleteAppointment\(appointment\.id\)/);
  assert.match(bookingSource, /checkoutUrl = checkout\.checkoutUrl/);
  assert.match(bookingSource, /xeroInvoiceUrl = invoice\.invoiceUrl/);
  assert.match(routeSource, /paymentProvider:\s*result\.paymentProvider/);
});

test("settings UI exposes a superadmin payment mode card with readiness warnings", () => {
  const settingsPageSource = read("../client/src/pages/settings.tsx");

  assert.match(settingsPageSource, /BookingPaymentModePanel/);
  assert.match(settingsPageSource, /\/api\/settings\/payment-mode/);
  assert.match(settingsPageSource, /card-booking-payment-mode/);
  assert.match(settingsPageSource, /button-payment-mode-xero/);
  assert.match(settingsPageSource, /button-payment-mode-stripe/);
  assert.match(settingsPageSource, /ConfirmDialog/);
  assert.doesNotMatch(settingsPageSource, /confirm\(`Switch new payable bookings and mediation-session invoices/);
  assert.match(settingsPageSource, /Switch to Direct Stripe Checkout\?/);
  assert.match(settingsPageSource, /fallback\/testing mode/);
  assert.match(settingsPageSource, /CRM-owned Stripe Checkout/);
  assert.match(settingsPageSource, /Existing appointments and invoices keep their current payment provider/);
  assert.match(settingsPageSource, /Switch to Stripe/);
  assert.match(settingsPageSource, /Switch to Xero invoices\?/);
  assert.match(settingsPageSource, /Switch to Xero/);
  assert.match(settingsPageSource, /Xero webhook endpoint/);
  assert.match(settingsPageSource, /Required Xero webhook topic/);
  assert.match(settingsPageSource, /Invoices/);
  assert.match(settingsPageSource, /Webhook key/);
  assert.match(settingsPageSource, /AWS Secrets Manager/);
  assert.match(settingsPageSource, /STRIPE_SECRET_KEY is required/);
  assert.match(settingsPageSource, /Stripe webhook endpoint/);
  assert.match(settingsPageSource, /canManagePaymentMode = user\?\.role === "superadmin"/);
});

test("docs explain Xero default and direct Stripe testing mode", () => {
  const docs = read("../replit.md");

  assert.match(docs, /Settings -> Booking Payment Mode/);
  assert.match(docs, /default is `xero_invoice`/);
  assert.match(docs, /direct_stripe_checkout/);
  assert.match(docs, /STRIPE_SECRET_KEY/);
  assert.match(docs, /\/api\/public\/stripe\/webhook/);
});
