/**
 * Regression tests for mediation session client accept-to-pay flow.
 *
 * Run with: npx tsx tests/mediation-session-accept-to-pay.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const mediationService = read("../server/services/mediation-session.service.ts");
const mediationRoutes = read("../server/routes/mediation-session.routes.ts");
const financeRoutes = read("../server/routes/finance.routes.ts");
const financeService = read("../server/services/finance.service.ts");
const stripeService = read("../server/services/stripe-payment.service.ts");
const publicPage = read("../client/src/pages/session-availability.tsx");
const dashboardPage = read("../client/src/pages/dashboard.tsx");
const appLayout = read("../client/src/components/layout/dashboard-layout.tsx");
const dashboardService = read("../server/services/dashboard.service.ts");
const docs = read("../replit.md");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("public session accept response can return client payment metadata", () => {
  assert.match(mediationService, /buildProposalAcceptancePayment/);
  assert.match(mediationService, /paymentRequired/);
  assert.match(mediationService, /createMediationSessionInvoiceCheckoutSession/);
  assert.match(mediationRoutes, /checkoutUrl:\s*result\.payment\?\.checkoutUrl/);
  assert.match(mediationRoutes, /invoiceId:\s*result\.payment\?\.invoiceId/);
  assert.match(mediationRoutes, /paymentProvider:\s*result\.payment\?\.paymentProvider/);
});

test("logged-in clients can respond to their own mediation session proposal recipient", () => {
  assert.match(mediationRoutes, /\/api\/mediation-session-proposal-recipients\/:id\/client-response/);
  assert.match(mediationRoutes, /user\.role !== "client"/);
  assert.match(mediationRoutes, /respondToClientProposalRecipient\(req\.params\.id, actor, parsed\.data/);
  assert.match(mediationService, /respondToClientProposalRecipient/);
  assert.match(mediationService, /storage\.listPartiesByUserId\(actor\.id\)/);
  assert.match(mediationService, /recipient\.partyId/);
  assert.match(mediationService, /party\.caseId === proposal\.caseId/);
  assert.match(mediationService, /return this\.respondToProposalRecipient\(recipient, proposal, session, input/);
  assert.match(mediationService, /buildProposalAcceptancePayment\(null, proposal, recipient, \{ clientUserId: actor\.id/);
});

test("mediation-session checkout uses invoice billed party instead of appointment party", () => {
  assert.match(financeService, /getMediationSessionInvoiceForCheckout/);
  assert.match(financeService, /billToPartyId/);
  assert.match(stripeService, /createMediationSessionInvoiceCheckoutSession/);
  assert.match(stripeService, /partyId:\s*invoice\.billToPartyId/);
  assert.doesNotMatch(stripeService, /if \(!appointment\.partyId\) return \{ ok: false, error: "Linked appointment has no party"/);
});

test("logged-in clients have a client-safe pay endpoint for their own invoices", () => {
  assert.match(financeRoutes, /\/api\/client\/invoices\/:invoiceId\/pay/);
  assert.match(financeRoutes, /\/api\/client\/invoices\/:invoiceId\/payment-status/);
  assert.match(financeRoutes, /user\.role !== "client"/);
  assert.match(financeRoutes, /createMediationSessionInvoiceCheckoutSession\(req\.params\.invoiceId,\s*\{\s*clientUserId: user\.id/);
  assert.match(financeRoutes, /getMediationSessionInvoiceForCheckout\(req\.params\.invoiceId,\s*\{\s*clientUserId: user\.id,\s*allowPaid: true/);
  assert.match(financeRoutes, /reconcileInvoiceCheckoutSessionReturn\(req\.params\.invoiceId,\s*sessionId/);
});

test("Stripe return and webhook can finalize invoice-scoped mediation-session payments", () => {
  assert.match(stripeService, /invoiceIdFromSession/);
  assert.match(stripeService, /invoiceIdForCheckoutSession/);
  assert.match(stripeService, /const metadataInvoiceId = invoiceIdFromSession\(session\);[\s\S]*if \(metadataInvoiceId\) return metadataInvoiceId;/);
  assert.match(stripeService, /serviceTypes\.name/);
  assert.match(stripeService, /serviceName:\s*serviceTypes\.name/);
  assert.match(stripeService, /invoice\.serviceName !== "Mediation Sessions"/);
  assert.match(stripeService, /recordMediationSessionInvoicePayment/);
  assert.match(stripeService, /mediation_session_invoice_paid/);
  assert.match(stripeService, /createCheckoutSessionReturnUrl/);
});

test("direct booking Stripe sessions are not misclassified as mediation-session invoice payments", () => {
  const bookingCheckoutSource = sourceBetween(
    stripeService,
    "async createBookingCheckoutSession",
    "async handleWebhookEvent",
  );
  assert.match(bookingCheckoutSource, /metadata:\s*\{[\s\S]*bookingToken:\s*input\.bookingToken,[\s\S]*\}/);
  assert.doesNotMatch(bookingCheckoutSource, /invoiceId:/);
  assert.match(stripeService, /if \(invoice\.serviceName !== "Mediation Sessions"\) return null;/);
});

test("mediation-session appointment payment status updates only after all party invoices are paid", () => {
  assert.match(financeService, /const appointmentInvoices = await this\.listInvoicesByAppointment\(appointment\.id\)/);
  assert.match(financeService, /const allPaid = appointmentInvoices\.length > 0 && appointmentInvoices\.every/);
  assert.match(financeService, /row\.paymentStatus === "paid" \|\| row\.outstandingPence <= 0 \|\| row\.status === "void"/);
  assert.match(financeService, /paymentStatus: "paid"[\s\S]*paymentNotes: "All mediation session invoices paid via Stripe"/);
  assert.match(dashboardPage, /refreshClientDashboardActions\(\)/);
});

test("stale mediation-session Checkout URLs are inspected before reuse", () => {
  assert.match(stripeService, /resolveExistingMediationSessionCheckout/);
  assert.match(stripeService, /stripe\.checkout\.sessions\.retrieve\(invoice\.providerInvoiceId\)/);
  assert.match(stripeService, /existing\.action === "reuse"/);
  assert.match(stripeService, /existing\.action === "paid"/);
  assert.doesNotMatch(stripeService, /if \(invoice\.provider === "stripe" && invoice\.paymentLinkUrl && \/\^https\?:/);
});

test("logged-in Pay Now always asks the backend for a fresh or verified payment link", () => {
  assert.doesNotMatch(dashboardPage, /if \(invoice\.paymentLinkUrl\) return \{ checkoutUrl: invoice\.paymentLinkUrl \}/);
  assert.match(dashboardPage, /apiRequest\("POST", `\/api\/client\/invoices\/\$\{invoice\.invoiceId\}\/pay`, \{\}\)/);
});

test("logged-in Stripe return lands on a routed dashboard alias and reconciles there", () => {
  assert.match(appLayout, /<Route path="\/dashboard" component=\{ClientRedirect\} \/>/);
  assert.match(stripeService, /const returnPath = options\.token \? `\/session-availability\/\$\{options\.token\}` : "\/"/);
  assert.match(dashboardPage, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(dashboardPage, /paymentReturn === "success"/);
  assert.match(dashboardPage, /\/api\/client\/invoices\/\$\{encodeURIComponent\(returnInvoiceId\)\}\/payment-status\?session_id=/);
  assert.match(dashboardPage, /data-testid="dashboard-payment-return"/);
});

test("admin can repair unreconciled mediation-session invoice payments", () => {
  assert.match(financeRoutes, /\/api\/finance\/invoices\/:invoiceId\/stripe\/reconcile/);
  assert.match(financeRoutes, /requirePermission\("finance", "edit"\)/);
  assert.match(financeRoutes, /reconcileStoredInvoiceCheckoutSession/);
});

test("Replit docs describe stored Checkout URLs as non-permanent links", () => {
  assert.match(docs, /stored Stripe Checkout URLs are session URLs/i);
  assert.match(docs, /validates the stored Checkout Session status before reuse/i);
  assert.match(docs, /\/dashboard is a supported authenticated dashboard alias/i);
  assert.match(docs, /logged-in client Stripe returns reconcile via the dashboard payment-status endpoint/i);
});

test("public session availability page redirects accepted clients to payment", () => {
  assert.match(publicPage, /checkoutUrl/);
  assert.match(publicPage, /window\.location\.assign\(paymentUrl\)/);
  assert.match(publicPage, /payment=success/);
  assert.match(publicPage, /payment=cancelled/);
  assert.match(publicPage, /payment-unavailable/);
});

test("client dashboard shows payment due modal and pay-now action", () => {
  assert.match(dashboardService, /invoiceId/);
  assert.match(dashboardService, /outstandingPence/);
  assert.match(dashboardService, /isMediationSessionInvoice:\s*invoice\.serviceName === "Mediation Sessions"/);
  assert.match(dashboardPage, /paymentDueModalInvoice/);
  assert.match(dashboardPage, /action\.isMediationSessionInvoice/);
  assert.match(dashboardPage, /\/api\/client\/invoices\/\$\{invoice\.invoiceId\}\/pay/);
  assert.match(dashboardPage, /data-testid="dialog-client-payment-due"/);
  assert.match(dashboardPage, /data-testid="button-client-pay-now"/);
});

test("Replit docs describe mediation session accept-to-pay behavior", () => {
  assert.match(docs, /client accepts a proposed mediation-session slot/);
  assert.match(docs, /Stripe Checkout URL/);
  assert.match(docs, /joint session invoice is still billed per party/);
  assert.match(docs, /logged-in clients see an invoice payment due prompt/i);
});
