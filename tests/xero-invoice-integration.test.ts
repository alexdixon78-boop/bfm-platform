/**
 * Regression checks for Xero-led MIAM invoice payments.
 *
 * Run with: npx tsx tests/xero-invoice-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema and bootstrap define Xero connection, invoice, and webhook event records", () => {
  const schema = read("../shared/schema.ts");
  const bootstrap = read("../server/db-bootstrap.ts");
  const routeIndex = read("../server/routes/index.ts");

  assert.match(schema, /xeroConnections = pgTable\("xero_connections"/);
  assert.match(schema, /xeroInvoiceRecords = pgTable\("xero_invoice_records"/);
  assert.match(schema, /appointmentId: varchar\("appointment_id"\).*appointments\.id/);
  assert.match(schema, /xeroInvoiceUrl: text\("xero_invoice_url"\)/);
  assert.match(schema, /xeroWebhookEvents = pgTable\("xero_webhook_events"/);

  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS xero_connections/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS xero_invoice_records/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS xero_webhook_events/);
  assert.match(routeIndex, /xeroRoutes/);
});

test("Xero service uses Custom Connection credentials while preserving approved invoice, webhook, and paid confirmation flows", () => {
  const service = read("../server/services/xero.service.ts");

  assert.match(service, /grant_type: "client_credentials"/);
  assert.match(service, /getCustomConnection/);
  assert.doesNotMatch(service, /grant_type: "authorization_code"/);
  assert.doesNotMatch(service, /grant_type: "refresh_token"/);
  assert.doesNotMatch(service, /redirect_uri/);
  assert.doesNotMatch(service, /xero-tenant-id/);
  assert.match(service, /findOrCreateContact/);
  assert.match(service, /createApprovedInvoice/);
  assert.match(service, /Status: "AUTHORISED"/);
  assert.match(service, /getOnlineInvoiceUrl/);
  assert.match(service, /verifyWebhookSignature/);
  assert.match(service, /x-xero-signature|XERO_WEBHOOK_KEY/);
  assert.match(service, /handleWebhookPayload/);
  assert.match(service, /paymentProvider:\s*"xero_stripe"/);
  assert.match(service, /appointmentService\.confirm/);
  assert.match(service, /latest\?\.status === "hold" \|\| latest\?\.status === "held"/);
  assert.match(service, /xero_invoice_synced/);
});

test("superadmin routes and UI expose Custom Connection readiness and sync controls without OAuth controls", () => {
  const routes = read("../server/routes/xero.routes.ts");
  const apiPage = read("../client/src/pages/api-integrations.tsx");
  const casePage = read("../client/src/pages/case-detail.tsx");
  const appointmentRoutes = read("../server/routes/appointment.routes.ts");

  assert.match(routes, /\/api\/integrations\/xero\/status/);
  assert.doesNotMatch(routes, /\/api\/integrations\/xero\/connect/);
  assert.doesNotMatch(routes, /\/api\/integrations\/xero\/callback/);
  assert.doesNotMatch(routes, /\/api\/integrations\/xero\/disconnect/);
  assert.match(routes, /\/api\/integrations\/xero\/tax-rates/);
  assert.match(routes, /\/api\/integrations\/xero\/invoice-setup/);
  assert.match(routes, /\/api\/public\/integrations\/xero\/webhook/);
  assert.match(routes, /Only superadmins can manage Xero/);

  assert.match(apiPage, /Xero invoices/);
  assert.doesNotMatch(apiPage, /button-connect-xero/);
  assert.doesNotMatch(apiPage, /Reconnect Xero/);
  assert.match(apiPage, /Custom Connection/);
  assert.match(apiPage, /button-check-xero-invoice-setup/);
  assert.match(apiPage, /xero-invoice-setup-warning/);
  assert.match(apiPage, /required Xero currency <code>GBP<\/code>/);
  assert.match(apiPage, /button-load-xero-tax-rates/);
  assert.match(apiPage, /xero-tax-type-recommendation/);
  assert.match(apiPage, /XERO_DEFAULT_TAX_TYPE=/);
  assert.match(apiPage, /xero-setup-steps/);
  assert.match(apiPage, /Xero Demo Company/);

  assert.match(appointmentRoutes, /xeroInvoice/);
  assert.match(routes, /\/api\/appointments\/:id\/xero-sync/);
  assert.match(casePage, /xero-invoice-summary/);
  assert.match(casePage, /button-sync-xero-invoice/);
  assert.match(casePage, /button-open-xero-invoice/);
});

test("Xero tax-rate discovery uses safe fields and recommends a revenue tax type", () => {
  const service = read("../server/services/xero.service.ts");
  const apiPage = read("../client/src/pages/api-integrations.tsx");

  assert.match(service, /XeroTaxRateSummary/);
  assert.match(service, /getTaxRates/);
  assert.match(service, /\$\{XERO_API_BASE\}\/TaxRates/);
  assert.match(service, /getCustomConnection/);
  assert.match(service, /taxType: String\(rate\.TaxType\)/);
  assert.match(service, /canApplyToRevenue: boolFromXero\(rate\.CanApplyToRevenue\)/);
  assert.match(service, /recommendXeroInvoiceTaxType/);
  assert.match(service, /rate\.taxType === "OUTPUT2"/);
  assert.match(service, /rate\.taxType === "OUTPUT"/);
  assert.doesNotMatch(service, /return .*accessToken/);
  assert.doesNotMatch(service, /return .*refreshToken/);

  assert.match(apiPage, /xero-tax-rates-panel/);
  assert.match(apiPage, /activeRevenueTaxRates/);
  assert.match(apiPage, /canApplyToRevenue/);
  assert.match(apiPage, /Load tax rates from Xero/);
});

test("Xero invoice setup preflight validates GBP, revenue account, tax type, and safe validation errors", () => {
  const service = read("../server/services/xero.service.ts");
  const apiPage = read("../client/src/pages/api-integrations.tsx");

  assert.match(service, /XeroInvoiceSetupStatus/);
  assert.match(service, /validateInvoiceSetup/);
  assert.match(service, /\$\{XERO_API_BASE\}\/Currencies/);
  assert.match(service, /\$\{XERO_API_BASE\}\/Accounts\/\$\{encodeURIComponent\(accountCode\)\}/);
  assert.match(service, /Xero is not ready for \$\{normalizedCurrency\} invoices/);
  assert.match(service, /must be a revenue\/sales account/);
  assert.match(service, /cannot be applied to revenue invoices/);
  assert.match(service, /parseXeroValidationMessages/);
  assert.match(service, /ValidationErrors/);
  assert.match(service, /validateInvoiceSetup\(invoiceCurrency\)/);
  assert.match(service, /invoice setup validation failed/);

  assert.match(apiPage, /xero-invoice-setup-panel/);
  assert.match(apiPage, /Xero invoice setup is ready for GBP MIAM invoices/);
  assert.match(apiPage, /Enabled currencies/);
});

test("environment template documents required Xero secrets", () => {
  const env = read("../.env.example");

  assert.match(env, /XERO_CLIENT_ID=/);
  assert.match(env, /XERO_CLIENT_SECRET=/);
  assert.doesNotMatch(env, /XERO_REDIRECT_URI=/);
  assert.match(env, /XERO_WEBHOOK_KEY=/);
  assert.match(env, /XERO_DEFAULT_ACCOUNT_CODE=/);
  assert.match(env, /XERO_DEFAULT_TAX_TYPE=/);
});
