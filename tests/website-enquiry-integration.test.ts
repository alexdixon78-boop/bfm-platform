/**
 * Regression tests for the website enquiry public API integration.
 *
 * Run with: npx tsx tests/website-enquiry-integration.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schemaSource = read("../shared/schema.ts");
const routeIndexSource = read("../server/routes/index.ts");
const bootstrapSource = read("../server/db-bootstrap.ts");
const emailSource = read("../server/services/email.service.ts");
const sidebarSource = read("../client/src/components/layout/app-sidebar.tsx");
const dashboardLayoutSource = read("../client/src/components/layout/dashboard-layout.tsx");
const apiIntegrationRouteSource = read("../server/routes/api-integration.routes.ts");
const apiIntegrationsPageSource = read("../client/src/pages/api-integrations.tsx");

function apiIntegrationsSchemaBlock() {
  const start = schemaSource.indexOf("export const apiIntegrations = pgTable");
  const end = schemaSource.indexOf("export const xeroConnections", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return schemaSource.slice(start, end);
}

test("website is a canonical enquiry lead source", () => {
  assert.match(schemaSource, /"Website"/);
});

test("api integrations store hashed keys and are bootstrapped", () => {
  assert.match(schemaSource, /apiIntegrations/);
  assert.match(schemaSource, /keyHash/);
  assert.doesNotMatch(schemaSource, /apiKey:\s*text/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS api_integrations/);
});

test("website enquiry public endpoint requires an API key and reuses enquiry creation", () => {
  const routeSource = apiIntegrationRouteSource;
  assert.match(routeSource, /\/api\/public\/integrations\/website-enquiries/);
  assert.match(routeSource, /Authorization/);
  assert.match(routeSource, /X-API-Key/i);
  assert.match(routeSource, /enquiryService\.create/);
  assert.match(routeSource, /leadSource:\s*data\.leadSource/);
  assert.match(routeSource, /source:\s*"Website API"/);
  assert.match(routeSource, /Source:\s*Website API/);
  assert.match(routeSource, /contactMethod:\s*"Website form"/);
  assert.match(routeSource, /enquiryRef/);
  assert.doesNotMatch(routeSource, /newCase/);
});

test("website enquiry public endpoint validates visible form enum fields", () => {
  const routeSource = apiIntegrationRouteSource;
  assert.match(routeSource, /LEAD_SOURCES/);
  assert.match(routeSource, /REFERRAL_TYPES/);
  assert.match(routeSource, /ISSUE_TYPES/);
  assert.match(routeSource, /z\.enum\(LEAD_SOURCES\)/);
  assert.match(routeSource, /z\.enum\(REFERRAL_TYPES\)/);
  assert.match(routeSource, /z\.enum\(ISSUE_TYPES\)/);
});

test("website enquiry acknowledgement email exists and is centralized in shared enquiry creation", () => {
  const routeSource = apiIntegrationRouteSource;
  const serviceSource = read("../server/services/enquiry.service.ts");
  assert.match(emailSource, /sendEnquiryAcknowledgementEmail/);
  assert.match(emailSource, /Your mediation enquiry, Brighter Future Mediation/);
  assert.match(emailSource, /Book MIAM Appointment/);
  assert.match(serviceSource, /sendAutomaticAcknowledgement/);
  assert.match(routeSource, /acknowledgementStatus/);
  assert.doesNotMatch(routeSource, /sendEnquiryAcknowledgementEmail/);
});

test("superadmin API page is wired into navigation and route table", () => {
  const pageSource = apiIntegrationsPageSource;
  assert.match(sidebarSource, /title:\s*"API"/);
  assert.match(sidebarSource, /superadminOnly/);
  assert.match(dashboardLayoutSource, /ApiIntegrationsPage/);
  assert.match(dashboardLayoutSource, /\/api-integrations/);
  assert.match(pageSource, /Website enquiries/);
  assert.match(pageSource, /\/api\/public\/integrations\/website-enquiries/);
  assert.match(pageSource, /Authorization: Bearer/);
});

test("superadmin API page documents all visible enquiry fields and allowed values", () => {
  const pageSource = apiIntegrationsPageSource;
  assert.match(pageSource, /showFieldReference/);
  assert.match(pageSource, /useState\(false\)/);
  assert.match(pageSource, /aria-expanded=\{showFieldReference\}/);
  assert.match(pageSource, /View field reference/);
  assert.match(pageSource, /Hide field reference/);
  assert.match(pageSource, /fieldReference/);
  assert.match(pageSource, /Allowed values/);
  assert.match(pageSource, /First name/);
  assert.match(pageSource, /How did you hear about us/);
  assert.match(pageSource, /Are you referring yourself or a client/);
  assert.match(pageSource, /What kind of mediation would you like to discuss/);
  assert.match(pageSource, /LEAD_SOURCES\.join/);
  assert.match(pageSource, /REFERRAL_TYPES\.join/);
  assert.match(pageSource, /ISSUE_TYPES\.join/);
  assert.match(pageSource, /Website metadata/);
  assert.match(pageSource, /Optional tracking fields/);
});

test("default API example keeps UTM fields out of the core enquiry payload", () => {
  const pageSource = apiIntegrationsPageSource;
  const exampleStart = pageSource.indexOf("const examplePayload");
  const metadataStart = pageSource.indexOf("const metadataPayload");
  assert.notEqual(exampleStart, -1);
  assert.notEqual(metadataStart, -1);
  const coreExample = pageSource.slice(exampleStart, metadataStart);
  assert.match(coreExample, /"leadSource": "Website"/);
  assert.doesNotMatch(coreExample, /utmSource/);
  assert.doesNotMatch(coreExample, /utmMedium/);
  assert.doesNotMatch(coreExample, /utmCampaign/);
  assert.match(pageSource.slice(metadataStart), /utmMedium/);
});

test("website API keys are valid until superadmin revocation with no expiry column", () => {
  const integrationSchema = apiIntegrationsSchemaBlock();
  assert.doesNotMatch(integrationSchema, /expiresAt/);
  assert.doesNotMatch(integrationSchema, /expires_at/);
  assert.match(apiIntegrationRouteSource, /integration\.status !== "active"/);
  assert.match(apiIntegrationRouteSource, /API key has been revoked/);
  assert.doesNotMatch(apiIntegrationRouteSource, /expiresAt|expires_at|expired/i);
});

test("superadmin API page documents valid-until-revoked key lifetime", () => {
  assert.match(apiIntegrationsPageSource, /do not expire automatically/);
  assert.match(apiIntegrationsPageSource, /remain valid until a superadmin revokes them/);
  assert.match(apiIntegrationsPageSource, /Revocation takes effect immediately/);
  assert.match(apiIntegrationsPageSource, /Raw keys are shown only once at creation and cannot be recovered later/);
});
