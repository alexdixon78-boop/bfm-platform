import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema defines case-wise client-linked invoices, line items, and payments", () => {
  const schema = read("../shared/schema.ts");
  const migration = read("../migrations/0002_case_finance_ledger.sql");
  const bootstrap = read("../server/db-bootstrap.ts");

  assert.match(schema, /caseInvoices = pgTable\("case_invoices"/);
  assert.match(schema, /billToClientId: varchar\("bill_to_client_id"\)\.notNull\(\)\.references\(\(\) => clients\.id/);
  assert.match(schema, /billToPartyId: varchar\("bill_to_party_id"\)\.references\(\(\) => parties\.id/);
  assert.match(schema, /caseInvoiceLineItems = pgTable\("case_invoice_line_items"/);
  assert.match(schema, /vatRate: integer\("vat_rate"\)/);
  assert.match(schema, /casePayments = pgTable\("case_payments"/);
  assert.match(schema, /clientId: varchar\("client_id"\)\.notNull\(\)\.references\(\(\) => clients\.id/);
  assert.match(schema, /invoiceId: varchar\("invoice_id"\)\.references\(\(\) => caseInvoices\.id/);
  assert.match(schema, /CASE_PAYMENT_STATUSES/);
  assert.match(schema, /appointmentId: varchar\("appointment_id"\)\.references\(\(\) => appointments\.id/);
  assert.match(schema, /providerInvoiceId: text\("provider_invoice_id"\)/);
  assert.match(schema, /paymentLinkUrl: text\("payment_link_url"\)/);
  assert.match(schema, /providerPaymentId: text\("provider_payment_id"\)/);
  assert.match(schema, /paymentIntentId: text\("payment_intent_id"\)/);
  assert.match(schema, /receiptNumber: text\("receipt_number"\)/);
  assert.match(schema, /refundedAmountPence: integer\("refunded_amount_pence"\)/);

  assert.match(migration, /CREATE TABLE "case_invoices"/);
  assert.match(migration, /"bill_to_client_id" varchar NOT NULL/);
  assert.match(migration, /CREATE TABLE "case_payments"/);
  assert.match(migration, /"client_id" varchar NOT NULL/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_invoices/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS case_payments/);
  assert.match(bootstrap, /case_invoices_appointment_unique_idx/);
  assert.match(bootstrap, /case_payments_appointment_unique_idx/);
});

test("finance service validates client ownership, case invoice numbering, VAT, allocation, and overdue counts", () => {
  const service = read("../server/services/finance.service.ts");
  const expectedPaymentActivityMessage = `Payment for ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(15000 / 100)} recorded as paid.`;

  assert.match(service, /validateCaseClient/);
  assert.match(service, /Client does not belong to this case/);
  assert.match(service, /Party does not belong to the selected client/);
  assert.match(service, /Payment client must match the invoice billed client/);
  assert.match(service, /nextInvoiceNumber/);
  assert.match(service, /INV-\$\{normalizeCaseRefForInvoice\(existingCase\.caseRef\)\}-/);
  assert.match(service, /vatAmountPence = vatRate === null \? 0 : Math\.round/);
  assert.match(service, /recalculateInvoice/);
  assert.match(service, /statusFromTotals/);
  assert.match(service, /countOverdueInvoices/);
  assert.match(service, /ensureBookingInvoice/);
  assert.match(service, /recordBookingPayment/);
  assert.match(service, /recordBookingPaymentStatus/);
  assert.match(service, /recordBookingRefund/);
  assert.match(service, /backfillPaidBookingFinance/);
  assert.match(service, /getCaseFinanceForUser/);
  assert.match(service, /getReusableMediationSessionInvoice/);
  assert.match(service, /mediation_session_invoice_reused/);
  assert.match(service, /appointmentId: input\.appointment\.id/);
  assert.match(service, /dueDate: input\.appointment\.holdExpiresAt \|\| null/);
  assert.match(service, /paymentStatus: updated\.paymentStatus/);
  assert.match(service, /caseInvoices\.paymentStatus\} NOT IN \('cancelled', 'expired', 'refunded'\)/);
  assert.match(service, /voidUnpaidAppointmentInvoices/);
  assert.match(service, /invoice\.amountPaidPence === 0/);
  assert.match(service, /invoice\.outstandingPence === invoice\.totalPence/);
  assert.match(service, /paymentStatus: "cancelled"/);
  assert.match(service, /mediationSessionNumber: mediationSessions\.sessionNumber/);
  assert.match(service, /getPaymentReceipt/);
  assert.match(service, /emitFinanceEvent/);
  assert.equal(expectedPaymentActivityMessage, "Payment for £150.00 recorded as paid.");
  assert.match(service, /formatPaymentAmountForActivity\(payment\.amountPence, payment\.currency\)/);
  assert.match(service, /style: "currency"/);
  assert.match(service, /format\(money\(amountPence\) \/ 100\)/);
  assert.doesNotMatch(service, /Payment for \$\{payment\.amountPence\} \$\{payment\.currency\.toUpperCase\(\)\} recorded as \$\{payment\.paymentStatus\}\./);
  assert.match(service, /caseActivityService\.log/);
  assert.match(service, /notificationService\.createNotification/);
  assert.match(service, /recipientRole: "admin"/);
  assert.match(service, /recipientRole: "client"/);
  assert.match(service, /case_payment_refunded/);
  assert.match(service, /case_payment_link_retried/);
});

test("finance routes expose case and global ledgers with finance permissions", () => {
  const routes = read("../server/routes/finance.routes.ts");
  const index = read("../server/routes/index.ts");
  const permissions = read("../shared/permissions.ts");

  assert.match(routes, /\/api\/cases\/:caseId\/finance/);
  assert.match(routes, /\/api\/cases\/:caseId\/invoices/);
  assert.match(routes, /\/api\/cases\/:caseId\/payments/);
  assert.match(routes, /\/api\/finance\/ledger/);
  assert.match(routes, /retry-payment-link/);
  assert.match(routes, /\/api\/finance\/payments\/:paymentId\/receipt/);
  assert.match(routes, /\/api\/finance\/backfill-booking-payments/);
  assert.match(routes, /requirePermission\("finance", "view"\)/);
  assert.match(routes, /requirePermission\("finance", "edit"\)/);
  assert.match(routes, /user\.role !== "client"/);
  assert.match(index, /financeRoutes/);
  assert.match(permissions, /\{ role: "subadmin", section: "finance", canView: true, canEdit: true \}/);
});

test("case and global finance UIs display client names on invoice and payment rows", () => {
  const casePage = read("../client/src/pages/case-detail.tsx");
  const financePage = read("../client/src/pages/finance.tsx");
  const layout = read("../client/src/components/layout/dashboard-layout.tsx");

  assert.match(casePage, /function PaymentsTab/);
  assert.match(casePage, /case-finance-client-totals/);
  assert.match(casePage, /case-invoice-row/);
  assert.match(casePage, /case-mediation-session-invoice-group/);
  assert.match(casePage, /case-mediation-session-invoice-rows/);
  assert.match(casePage, /invoiceLedgerEntries/);
  assert.match(casePage, /Mediation Session \$\{primaryInvoice\.mediationSessionNumber\}/);
  assert.match(casePage, /invoice\.billToClientName/);
  assert.match(casePage, /CASE_LEDGER_PAYMENT_STATUS_LABELS/);
  assert.match(casePage, /button-retry-payment-link/);
  assert.match(casePage, /button-mark-invoice-paid/);
  assert.match(casePage, /openPaymentEditorFromInvoice/);
  assert.match(casePage, /appointmentId: invoice\.appointmentId \|\| ""/);
  assert.match(casePage, /appointmentId: paymentForm\.appointmentId \|\| null/);
  assert.match(casePage, /Staff verified payment against Xero\/bank records/);
  assert.match(casePage, /button-payment-receipt/);
  assert.match(casePage, /payment\.paymentIntentId/);
  assert.match(casePage, /payment\.appointmentDateTime/);
  assert.match(casePage, /case-payment-row/);
  assert.match(casePage, /payment\.clientName/);
  assert.doesNotMatch(casePage, /card-payments-placeholder/);

  assert.match(financePage, /export default function FinancePage/);
  assert.match(financePage, /billToClientName/);
  assert.match(financePage, /CASE_PAYMENT_STATUSES/);
  assert.match(financePage, /input-finance-due-from/);
  assert.match(financePage, /paymentStatus/);
  assert.match(financePage, /finance-ledger-row/);
  assert.match(layout, /path="\/finance"/);
});

test("Stripe and Xero booking payment flows sync into the CRM case ledger", () => {
  const stripe = read("../server/services/stripe-payment.service.ts");
  const xero = read("../server/services/xero.service.ts");
  const bookingRoutes = read("../server/routes/booking.routes.ts");
  const bookPage = read("../client/src/pages/book.tsx");

  assert.match(stripe, /financeService\.ensureBookingInvoice/);
  assert.match(stripe, /financeService\.recordBookingPayment/);
  assert.match(stripe, /financeService\.recordBookingPaymentStatus/);
  assert.match(stripe, /financeService\.recordBookingRefund/);
  assert.match(stripe, /createRetryCheckoutSession/);
  assert.match(xero, /financeService\.ensureBookingInvoice/);
  assert.match(xero, /financeService\.recordBookingPayment/);
  assert.match(bookingRoutes, /recordCheckoutCancelledReturn/);
  assert.match(bookPage, /paymentReturn === "success" \|\| \(paymentReturn === "cancelled"/);
});

test("dashboard overdue payments now uses finance invoice data", () => {
  const dashboard = read("../server/services/dashboard.service.ts");

  assert.match(dashboard, /financeService\.countOverdueInvoices\(\)/);
  assert.doesNotMatch(dashboard, /overduePayments:\s*0/);
});
