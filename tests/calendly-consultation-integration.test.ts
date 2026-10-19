/**
 * Regression tests for the Calendly consultation webhook integration.
 *
 * Run with: npx tsx tests/calendly-consultation-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Calendly consultation endpoint verifies signed webhooks and creates enquiries", () => {
  const routeSource = read("../server/routes/api-integration.routes.ts");
  const serviceSource = read("../server/services/enquiry.service.ts");

  assert.match(routeSource, /\/api\/public\/integrations\/calendly-consultations/);
  assert.match(routeSource, /CALENDLY_WEBHOOK_SIGNING_KEY/);
  assert.match(routeSource, /Calendly-Webhook-Signature/i);
  assert.match(routeSource, /timingSafeEqual/);
  assert.match(routeSource, /invitee\.created/);
  assert.match(routeSource, /invitee\.canceled/);
  assert.match(routeSource, /ignored:\s*true/);
  assert.match(routeSource, /enquiryService\.create/);
  assert.match(routeSource, /contactMethod:\s*"Calendly consultation"/);
  assert.match(routeSource, /source:\s*"Calendly"/);
  assert.match(serviceSource, /sendAutomaticAcknowledgement/);
  assert.match(routeSource, /acknowledgementStatus/);
  assert.doesNotMatch(routeSource, /sendEnquiryAcknowledgementEmail/);
});

test("Calendly required CRM fields and enum values are validated", () => {
  const routeSource = read("../server/routes/api-integration.routes.ts");
  const serviceSource = read("../server/services/calendly-intake.service.ts");

  assert.match(routeSource, /getCalendlyValidationDiagnostics/);
  assert.match(routeSource, /LEAD_SOURCES/);
  assert.match(routeSource, /REFERRAL_TYPES/);
  assert.match(routeSource, /ISSUE_TYPES/);
  assert.match(serviceSource, /LEAD_SOURCE_ALIASES/);
  assert.match(serviceSource, /REFERRAL_TYPE_ALIASES/);
  assert.match(serviceSource, /ISSUE_TYPE_ALIASES/);
  assert.match(routeSource, /Invalid Calendly consultation data/);
});

test("Calendly details are stored as structured enquiry metadata", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const routeSource = read("../server/routes/api-integration.routes.ts");
  const serviceSource = read("../server/services/calendly-intake.service.ts");

  assert.match(schemaSource, /metadata:\s*text\("metadata"\)/);
  assert.match(schemaSource, /metadata:\s*true/);
  assert.match(bootstrapSource, /ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS metadata TEXT/);
  assert.match(routeSource, /metadata:\s*JSON\.stringify/);
  assert.match(serviceSource, /questionsAndAnswers/);
  assert.match(serviceSource, /eventUri/);
  assert.match(serviceSource, /inviteeUri/);
  assert.match(serviceSource, /startTime/);
});

test("Calendly consultation metadata renders in enquiry details", () => {
  const enquiryPageSource = read("../client/src/pages/enquiries.tsx");

  assert.match(enquiryPageSource, /parseCalendlyMetadata/);
  assert.match(enquiryPageSource, /Calendly consultation/);
  assert.match(enquiryPageSource, /calendlyMetadata/);
  assert.match(enquiryPageSource, /Event type/);
  assert.match(enquiryPageSource, /formatCalendlyDateTime/);
  assert.match(enquiryPageSource, /hour:\s*"2-digit"/);
  assert.match(enquiryPageSource, /minute:\s*"2-digit"/);
  assert.match(enquiryPageSource, /calendlyMetadata\.timezone/);
  assert.match(enquiryPageSource, /Selected start/);
  assert.match(enquiryPageSource, /Invitee URI/);
  assert.doesNotMatch(enquiryPageSource, /fmtDate\(calendlyMetadata\.startTime\)/);
  assert.doesNotMatch(enquiryPageSource, /fmtDate\(calendlyMetadata\.endTime\)/);
});

test("API page and replit docs document the Calendly consultation webhook", () => {
  const apiPageSource = read("../client/src/pages/api-integrations.tsx");
  const replitSource = read("../replit.md");
  const envExampleSource = read("../.env.example");

  assert.match(apiPageSource, /Calendly consultations/);
  assert.match(apiPageSource, /calendly-consultations/);
  assert.match(apiPageSource, /CALENDLY_WEBHOOK_SIGNING_KEY/);
  assert.match(apiPageSource, /calendlyWebhookSigningKeyConfigured/);
  assert.match(apiPageSource, /Configured/);
  assert.match(apiPageSource, /Not configured/);
  assert.doesNotMatch(apiPageSource, /input-calendly-webhook-signing-key/);
  assert.match(apiPageSource, /invitee\.created/);
  assert.match(apiPageSource, /Calendly-Webhook-Signature/i);
  assert.match(apiPageSource, /Invalid Calendly consultation data/);
  assert.match(replitSource, /calendly-consultations/);
  assert.match(replitSource, /CALENDLY_WEBHOOK_SIGNING_KEY/);
  assert.match(replitSource, /status only/);
  assert.match(envExampleSource, /CALENDLY_WEBHOOK_SIGNING_KEY=/);
});

test("API page documents the manual Calendly PAT webhook setup steps", () => {
  const apiPageSource = read("../client/src/pages/api-integrations.tsx");

  assert.match(apiPageSource, /Calendly setup steps/);
  assert.match(apiPageSource, /Personal Access Token/);
  assert.match(apiPageSource, /No Calendly Developer OAuth app is required/);
  assert.match(apiPageSource, /Integrations/);
  assert.match(apiPageSource, /API & Webhooks/);
  assert.match(apiPageSource, /webhooks:write/);
  assert.match(apiPageSource, /webhooks:read/);
  assert.match(apiPageSource, /scheduled events\/invitees/i);
  assert.match(apiPageSource, /scope.*organization/i);
  assert.match(apiPageSource, /scope.*user/i);
  assert.match(apiPageSource, /localhost/);
  assert.match(apiPageSource, /HTTPS tunnel/);
  assert.match(apiPageSource, /curl --request POST/);
  assert.match(apiPageSource, /https:\/\/api\.calendly\.com\/webhook_subscriptions/);
  assert.match(apiPageSource, /YOUR_CALENDLY_PERSONAL_ACCESS_TOKEN/);
  assert.match(apiPageSource, /CALENDLY_ORGANIZATION_URI/);
});

test("Calendly configuration status endpoint returns only safe booleans", () => {
  const routeSource = read("../server/routes/api-integration.routes.ts");
  const pageSource = read("../client/src/pages/api-integrations.tsx");

  assert.match(routeSource, /\/api\/integrations\/status/);
  assert.match(routeSource, /calendlyWebhookSigningKeyConfigured/);
  assert.match(routeSource, /calendlyPatConfigured/);
  assert.match(routeSource, /calendlyOrganizationUriConfigured/);
  assert.match(routeSource, /getCalendlySubscriptionConfigStatus/);
  assert.match(pageSource, /calendlyPatConfigured/);
  assert.match(pageSource, /calendlyOrganizationUriConfigured/);
  assert.doesNotMatch(routeSource, /CALENDLY_WEBHOOK_SIGNING_KEY.*json/);
});

test("API page exposes a safe superadmin Calendly subscription update control", () => {
  const routeSource = read("../server/routes/api-integration.routes.ts");
  const pageSource = read("../client/src/pages/api-integrations.tsx");
  const envExampleSource = read("../.env.example");

  assert.match(routeSource, /\/api\/integrations\/calendly\/webhook-subscription/);
  assert.match(routeSource, /createCalendlyWebhookSubscription/);
  assert.match(routeSource, /calendly_webhook_subscription_updated/);
  assert.match(routeSource, /calendly_webhook_subscription_failed/);
  assert.match(pageSource, /Update Calendly webhook/);
  assert.match(pageSource, /input-calendly-callback-url/);
  assert.match(pageSource, /button-update-calendly-webhook/);
  assert.match(pageSource, /calendly-update-status/);
  assert.match(pageSource, /Tunnel is not reachable/);
  assert.match(pageSource, /Restart Cloudflare tunnel to/);
  assert.doesNotMatch(pageSource, /setCalendlyUpdateStatus\(`Update failed: \$\{err\.message\}`\)/);
  assert.match(pageSource, /\/api\/integrations\/calendly\/webhook-subscription/);
  assert.match(pageSource, /CALENDLY_PAT/);
  assert.match(pageSource, /CALENDLY_ORGANIZATION_URI/);
  assert.match(envExampleSource, /CALENDLY_PAT=/);
  assert.match(envExampleSource, /CALENDLY_ORGANIZATION_URI=/);
});
