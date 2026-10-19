/**
 * Regression tests for enquiry acknowledgement email routing.
 *
 * Run with: npx tsx tests/enquiry-acknowledgement.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("acknowledgement email eligibility accepts only syntactically valid email addresses", () => {
  const ackSource = read("../server/services/enquiry-acknowledgement.service.ts");

  assert.match(ackSource, /const EMAIL_PATTERN =/);
  assert.match(ackSource, /EMAIL_PATTERN\.test\(\(email \|\| ""\)\.trim\(\)\)/);
  assert.match(ackSource, /acknowledgementStatus:\s*"skipped"/);
  assert.match(ackSource, /Missing or invalid email address/);
});

test("shared enquiry creation owns automatic acknowledgement sending", () => {
  const serviceSource = read("../server/services/enquiry.service.ts");
  const websiteRouteSource = read("../server/routes/api-integration.routes.ts");
  const whatsappRouteSource = read("../server/routes/whatsapp.routes.ts");
  const whatsappServiceSource = read("../server/services/whatsapp-enquiry.service.ts");

  assert.match(serviceSource, /sendAutomaticAcknowledgement/);
  assert.match(whatsappRouteSource, /whatsappEnquiryService\.createFromWhatsapp/);
  assert.match(whatsappServiceSource, /enquiryService\.create/);

  const websiteHandlerStart = websiteRouteSource.indexOf('router.post("/api/public/integrations/website-enquiries"');
  const calendlyHandlerStart = websiteRouteSource.indexOf('router.post("/api/public/integrations/calendly-consultations"');
  assert.notEqual(websiteHandlerStart, -1);
  assert.notEqual(calendlyHandlerStart, -1);
  const websiteHandler = websiteRouteSource.slice(websiteHandlerStart, calendlyHandlerStart);
  const calendlyHandler = websiteRouteSource.slice(calendlyHandlerStart);
  assert.doesNotMatch(websiteHandler, /sendEnquiryAcknowledgementEmail/);
  assert.doesNotMatch(calendlyHandler, /sendEnquiryAcknowledgementEmail/);
});

test("CRM enquiry creation defers acknowledgement work and SendGrid delivery is time-bounded", () => {
  const enquiryRouteSource = read("../server/routes/enquiry.routes.ts");
  const emailSource = read("../server/services/email.service.ts");

  assert.match(
    enquiryRouteSource,
    /enquiryService\.create\(req\.body,\s*\{\s*deferPostCreateSideEffects:\s*true\s*\}\)/,
  );
  assert.match(emailSource, /SENDGRID_REQUEST_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(emailSource, /signal:\s*AbortSignal\.timeout\(SENDGRID_REQUEST_TIMEOUT_MS\)/);
});

test("CRM and mail-inbox enquiry creation routes through the shared acknowledgement flow", () => {
  const enquiryPageSource = read("../client/src/pages/enquiries.tsx");
  const mailInboxSource = read("../client/src/pages/mail-inbox.tsx");

  const createMutationStart = enquiryPageSource.indexOf("const createMutation = useMutation");
  const editFormStart = enquiryPageSource.indexOf("const editForm = useForm");
  assert.notEqual(createMutationStart, -1);
  assert.notEqual(editFormStart, -1);
  const createMutation = enquiryPageSource.slice(createMutationStart, editFormStart);
  assert.match(createMutation, /apiRequest\("POST",\s*"\/api\/enquiries",\s*data\)/);
  assert.doesNotMatch(createMutation, /send-acknowledgement/);
  assert.doesNotMatch(createMutation, /sendEnquiryAcknowledgementEmail/);

  const convertMutationStart = mailInboxSource.indexOf("const convertMutation = useMutation");
  const convertSuccessStart = mailInboxSource.indexOf("onSuccess: async", convertMutationStart);
  assert.notEqual(convertMutationStart, -1);
  assert.notEqual(convertSuccessStart, -1);
  const convertMutation = mailInboxSource.slice(convertMutationStart, convertSuccessStart);
  const enquiryPostIndex = convertMutation.indexOf('apiRequest("POST", "/api/enquiries", payload)');
  const mailConvertIndex = convertMutation.indexOf('apiRequest("POST", `/api/mail/messages/${selectedMessage.id}/convert`');
  assert.notEqual(enquiryPostIndex, -1);
  assert.notEqual(mailConvertIndex, -1);
  assert.ok(enquiryPostIndex < mailConvertIndex, "mail-inbox creates the enquiry before marking the mail message converted");
  assert.doesNotMatch(convertMutation, /send-acknowledgement/);
  assert.doesNotMatch(convertMutation, /sendEnquiryAcknowledgementEmail/);
});

test("enquiry UI tags WhatsApp origin separately from lead source", () => {
  const enquiryPageSource = read("../client/src/pages/enquiries.tsx");
  const enquiryDetailSource = read("../client/src/pages/enquiry-detail.tsx");

  assert.match(enquiryPageSource, /function isWhatsappOrigin/);
  assert.match(enquiryPageSource, /metadata\?\.source === "whatsapp"/);
  assert.match(enquiryPageSource, /badge-enquiry-whatsapp/);
  assert.match(enquiryPageSource, />WhatsApp</);
  assert.match(enquiryDetailSource, /DetailItem label="Contact method"/);
  assert.match(enquiryDetailSource, /enquiry\.contactMethod/);
  assert.match(enquiryDetailSource, /DetailItem label="Lead source"/);
});

test("automatic acknowledgement uses case ref subject and MIAM booking template", () => {
  const emailSource = read("../server/services/email.service.ts");
  const ackSource = read("../server/services/enquiry-acknowledgement.service.ts");
  const enquirySource = read("../server/services/enquiry.service.ts");

  assert.match(emailSource, /Your mediation enquiry, Brighter Future Mediation/);
  assert.match(emailSource, /formatCaseEmailSubject\("Your mediation enquiry, Brighter Future Mediation",\s*caseRef\)/);
  assert.match(emailSource, /Mediation Information and Assessment Meeting \(MIAM\)/);
  assert.match(emailSource, /1tXnvuT4WNlbdtlC2IpwV-mclqx0Arnd4/);
  assert.match(emailSource, /Payment terms/);
  assert.match(emailSource, /https:\/\/www\.brighterfuturemediation\.co\.uk\/fees/);
  assert.match(emailSource, /Book MIAM Appointment/);
  assert.match(emailSource, /invoice\/payment link will be provided after you choose your MIAM slot/i);
  assert.doesNotMatch(emailSource, /Your enquiry reference is <strong>\$\{enquiryRef\}<\/strong>/);
  assert.doesNotMatch(emailSource, /We have received your enquiry and a member of our team will review it shortly/);

  assert.match(ackSource, /bookingUrl/);
  assert.match(ackSource, /caseRef/);
  assert.match(ackSource, /availabilityPreview/);
  assert.match(ackSource, /createOrReuseBookingTokenForAcknowledgement/);
  assert.match(enquirySource, /sendAutomaticAcknowledgement/);
});

test("enquiry acknowledgement tracking, resend route, UI, and docs are wired", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const enquiryRouteSource = read("../server/routes/enquiry.routes.ts");
  const enquiryPageSource = read("../client/src/pages/enquiries.tsx");
  const replitSource = read("../replit.md");

  assert.match(schemaSource, /acknowledgementStatus:\s*text\("acknowledgement_status"\)/);
  assert.match(schemaSource, /acknowledgementLastAttemptedAt:\s*timestamp\("acknowledgement_last_attempted_at"\)/);
  assert.match(schemaSource, /acknowledgementSentAt:\s*timestamp\("acknowledgement_sent_at"\)/);
  assert.match(schemaSource, /acknowledgementLastError:\s*text\("acknowledgement_last_error"\)/);
  assert.match(bootstrapSource, /ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS acknowledgement_status TEXT/);

  assert.match(enquiryRouteSource, /\/api\/enquiries\/:id\/send-acknowledgement/);
  assert.match(enquiryRouteSource, /sendManualAcknowledgement/);
  assert.match(enquiryRouteSource, /enquiry\.acknowledgement_resend/);

  assert.match(enquiryPageSource, /Acknowledgement email/);
  assert.match(enquiryPageSource, /acknowledgementStatus/);
  assert.match(enquiryPageSource, /button-resend-acknowledgement/);

  assert.match(replitSource, /acknowledgement email/i);
  assert.match(replitSource, /manual CRM entry, `\/enquiries` Add New Enquiry, Website API, Calendly, WhatsApp, and Mail Inbox conversion/);
  assert.match(replitSource, /Mail Inbox/i);
  assert.match(replitSource, /POST \/api\/enquiries/);
  assert.match(replitSource, /MIAM-focused acknowledgement/i);
  assert.match(replitSource, /booking link/i);
  assert.match(replitSource, /Google Drive/i);
});
