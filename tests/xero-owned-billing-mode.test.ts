/**
 * Regression checks for Xero-owned billing mode across MIAM and mediation-session invoices.
 *
 * Run with: npx tsx --test tests/xero-owned-billing-mode.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("settings expose bank transfer details and Xero-owned billing copy", () => {
  const settingsPage = read("../client/src/pages/settings.tsx");
  const settingsRoutes = read("../server/routes/settings.routes.ts");
  const paymentSettings = read("../server/services/payment-settings.service.ts");

  assert.match(paymentSettings, /BANK_TRANSFER_SETTINGS_KEY/);
  assert.match(paymentSettings, /getBankTransferSettings/);
  assert.match(paymentSettings, /setBankTransferSettings/);
  assert.match(settingsRoutes, /\/api\/settings\/bank-transfer/);
  assert.match(settingsPage, /BankTransferSettingsPanel/);
  assert.match(settingsPage, /new payable bookings and mediation-session invoices/);
  assert.match(settingsPage, /Bank transfer is preferred/);
  assert.match(settingsPage, /Xero invoice number is the payment reference/);
  assert.match(settingsPage, /card payment, if available, happens through Xero/);
});

test("Xero invoice records support party-scoped finance invoice links", () => {
  const schema = read("../shared/schema.ts");
  const xeroInvoiceRecordBlock = schema.split("export const xeroInvoiceRecords")[1]?.split("export type XeroInvoiceRecord")[0] || "";
  const bootstrap = read("../server/db-bootstrap.ts");
  const migration = read("../migrations/0036_xero_owned_billing.sql");

  assert.match(schema, /caseInvoiceId:\s*varchar\("case_invoice_id"\)/);
  assert.doesNotMatch(xeroInvoiceRecordBlock, /appointmentId: varchar\("appointment_id"\)\.notNull\(\).*\.unique\(\)/);
  assert.match(schema, /uniqueIndex\("xero_invoice_records_case_invoice_unique_idx"\)/);
  assert.match(bootstrap, /ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS case_invoice_id/);
  assert.match(bootstrap, /DROP INDEX IF EXISTS xero_invoice_records_appointment_unique_idx/);
  assert.match(migration, /DROP INDEX IF EXISTS xero_invoice_records_appointment_unique_idx/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS case_invoice_id/);
});

test("Xero service can create Xero-owned case invoices and reconcile them", () => {
  const service = read("../server/services/xero.service.ts");
  const finance = read("../server/services/finance.service.ts");
  const mediationSession = read("../server/services/mediation-session.service.ts");

  assert.match(service, /createInvoiceForCaseInvoice/);
  assert.match(service, /caseInvoiceId/);
  assert.match(service, /Reference:\s*input\.caseRef/);
  assert.match(service, /paymentReference:\s*invoice\.invoiceNumber/);
  assert.match(service, /recordXeroOwnedCaseInvoicePayment/);
  assert.match(finance, /paymentSettingsService\.getBookingPaymentProvider/);
  assert.match(finance, /xeroService\.createInvoiceForCaseInvoice/);
  assert.match(finance, /provider:\s*"xero_invoice"/);
  assert.match(finance, /invoiceNumber:\s*xeroInvoiceNumber/);
  assert.match(mediationSession, /paymentProvider:\s*"xero_invoice"/);
  assert.doesNotMatch(mediationSession, /paymentProvider:\s*"stripe"[\s\S]*error: checkout\.error/);
});

test("client payment screens show Xero invoice, bank details, and bank-transfer in-flight action", () => {
  const bookingPage = read("../client/src/pages/book.tsx");
  const sessionPage = read("../client/src/pages/session-availability.tsx");
  const bookingRoutes = read("../server/routes/booking.routes.ts");
  const mediationRoutes = read("../server/routes/mediation-session.routes.ts");

  assert.match(bookingPage, /button-pay-xero-invoice/);
  assert.match(bookingPage, /Card payment is available only if enabled on the Xero invoice page/);
  assert.match(bookingPage, /Use the payment reference shown here when paying by bank transfer/);
  assert.match(bookingPage, /This alerts our team but does not confirm your appointment until the payment is reconciled/);
  assert.match(bookingPage, /button-bank-transfer-in-flight/);
  assert.match(bookingPage, /Copy reference/);
  assert.match(bookingPage, /bankTransfer/);
  assert.match(sessionPage, /button-session-pay-xero-invoice/);
  assert.match(sessionPage, /Card payment is available only if enabled on the Xero invoice page/);
  assert.match(sessionPage, /Use the payment reference shown here when paying by bank transfer/);
  assert.match(sessionPage, /This alerts our team but does not confirm the session until the payment is reconciled/);
  assert.match(sessionPage, /button-session-bank-transfer-in-flight/);
  assert.match(sessionPage, /xeroInvoiceUrl/);
  assert.match(bookingRoutes, /bank-transfer-in-flight/);
  assert.match(mediationRoutes, /bank-transfer-in-flight/);
});

test("docs describe Xero-owned billing and appinfo exists", () => {
  const docs = read("../replit.md");
  const appInfoUrl = new URL("../appinfo.md", import.meta.url);
  assert.equal(existsSync(appInfoUrl), true);
  const appInfo = read("../appinfo.md");

  for (const source of [docs, appInfo]) {
    assert.match(source, /Xero-owned billing/);
    assert.match(source, /Invoices/);
    assert.match(source, /bank transfer is preferred/i);
    assert.match(source, /Xero invoice number/);
    assert.match(source, /Direct Stripe/);
  }
});
