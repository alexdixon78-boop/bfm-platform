/**
 * Regression tests for SOP 1.1 enquiry capture workflow.
 *
 * Run with: npx tsx tests/enquiry-sop-workflow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function readCaseClosureReasonsSource(schemaSource: string) {
  const match = schemaSource.match(/export const CASE_CLOSURE_REASONS = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "CASE_CLOSURE_REASONS array should be defined");
  return match[1];
}

test("schema defines SOP intake constants and case shell fields", () => {
  const schemaSource = read("../shared/schema.ts");
  const closureReasonsSource = readCaseClosureReasonsSource(schemaSource);

  assert.match(schemaSource, /ENQUIRY_CONTACT_METHODS/);
  assert.match(schemaSource, /Landline \/ Air Landline/);
  assert.match(schemaSource, /Calendly consultation/);
  assert.match(schemaSource, /CASE_CLOSURE_REASONS/);
  [
    "LA (legal aid)",
    "ELSE (going elsewhere)",
    "COST",
    "DA (domestic abuse)",
    "Unsuitable – mediator decision",
    "Unsuitable – C1 refused",
    "Unsuitable – C2 refused",
    "Enquiry only – non-mediation",
    "Enquiry only – mediation",
    "Agreement reached",
    "Partial agreement reached",
    "Mediation became unsuitable",
    "Other",
  ].forEach(reason => assert.match(closureReasonsSource, new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.doesNotMatch(schemaSource, /Unsuitable- mediator decision/);
  assert.doesNotMatch(schemaSource, /Enquiry only-non-mediation/);
  assert.doesNotMatch(schemaSource, /"agreement reached"/);
  assert.doesNotMatch(schemaSource, /"partial agreement reached"/);
  assert.doesNotMatch(schemaSource, /"mediation became unsuitable"/);
  assert.match(schemaSource, /CASE_INTAKE_STATUSES/);
  assert.match(schemaSource, /ENQUIRY_STATUSES = \["New", "Claimed", "Chasing", "Safeguarding", "Closed", "Archived"\]/);
  assert.doesNotMatch(schemaSource, /ENQUIRY_STATUSES = \["New", "Reviewed", "Converted", "Rejected", "Archived"\]/);
  assert.match(schemaSource, /shuttleMediation:\s*boolean\("shuttle_mediation"\)\.notNull\(\)\.default\(false\)/);
  assert.match(schemaSource, /intakeStatus:\s*text\("intake_status"\)/);
  assert.match(schemaSource, /firstContactDueAt:\s*timestamp\("first_contact_due_at"\)/);
  assert.match(schemaSource, /safeguardingConfidential:\s*boolean\("safeguarding_confidential"\)/);
  assert.match(schemaSource, /noWhatsappOrVoicemail:\s*boolean\("no_whatsapp_or_voicemail"\)/);
  assert.match(schemaSource, /closureReason:\s*text\("closure_reason"\)/);
});

test("enquiry creation requires first address line and contact method", () => {
  const schemaSource = read("../shared/schema.ts");
  const enquiriesPageSource = read("../client/src/pages/enquiries.tsx");
  const apiRouteSource = read("../server/routes/api-integration.routes.ts");
  const calendlyServiceSource = read("../server/services/calendly-intake.service.ts");

  assert.match(schemaSource, /addressLine1:\s*z\.string\(\)\.min\(1, "First line of address is required"\)/);
  assert.match(schemaSource, /contactMethod:\s*z\.enum\(ENQUIRY_CONTACT_METHODS\)/);
  assert.match(enquiriesPageSource, /input-enquiry-addressLine1/);
  assert.match(enquiriesPageSource, /Address line 1 \*/);
  assert.match(enquiriesPageSource, /select-contact-method/);
  assert.match(enquiriesPageSource, /ENQUIRY_CONTACT_METHODS\.map/);
  assert.match(apiRouteSource, /addressLine1:\s*z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(apiRouteSource, /contactMethod:\s*z\.enum\(ENQUIRY_CONTACT_METHODS\)/);
  assert.match(calendlyServiceSource, /findCalendlyAnswer\(answers, \[/);
  assert.match(calendlyServiceSource, /"First line of address"/);
  assert.match(calendlyServiceSource, /"Address line 1"/);
});

test("enquiry conversion creates a 24-hour case-shell first-contact task", () => {
  const serviceSource = read("../server/services/enquiry.service.ts");

  assert.match(serviceSource, /firstContactDueAt/);
  assert.match(serviceSource, /24 \* 60 \* 60 \* 1000/);
  assert.match(serviceSource, /Please follow up with a phone call within 24 hours/);
  assert.match(serviceSource, /tx\.update\(enquiries\)/);
  assert.match(serviceSource, /convertedCaseId: newCase\.id/);
  assert.doesNotMatch(serviceSource, /updateEnquiryStatus\(enquiry\.id, "Converted", newCase\.id\)/);
  assert.doesNotMatch(serviceSource, /48-hour follow-up/);
  assert.doesNotMatch(serviceSource, /within 48 hours/);
});

test("enquiry conversion reuses existing clients by unique email before creating a client", () => {
  const serviceSource = read("../server/services/enquiry.service.ts");
  const conversionStart = serviceSource.indexOf("private async convertEnquiryToCaseTx");
  const createClientAt = serviceSource.indexOf("tx.insert(clients)", conversionStart);
  const emailLookupAt = serviceSource.indexOf("findClientByEmailTx", conversionStart);
  const matchReviewAt = serviceSource.indexOf("createReturningClientMatchReviewTx", conversionStart);

  assert.ok(conversionStart >= 0, "transactional conversion helper should be defined");
  assert.ok(emailLookupAt > conversionStart, "transactional conversion should look up an existing client by email");
  assert.ok(createClientAt > emailLookupAt, "email lookup should happen before createClient");
  assert.match(serviceSource.slice(emailLookupAt, createClientAt), /client\s*=\s*emailMatchedClient/);
  assert.ok(matchReviewAt > emailLookupAt, "email-only reuse should still create a returning-client review task");
});

test("enquiry creation keeps required intake records inside one transaction", () => {
  const serviceSource = read("../server/services/enquiry.service.ts");
  const createStart = serviceSource.indexOf("async create");
  const createEnd = serviceSource.indexOf("async update", createStart);
  const createBody = serviceSource.slice(createStart, createEnd);
  const transactionAt = serviceSource.indexOf("db.transaction", createStart);
  const duplicateDetectionAt = serviceSource.indexOf("detectForNewEnquiry", createStart);
  const acknowledgementAt = serviceSource.indexOf("sendAutomaticAcknowledgement", createStart);

  assert.ok(transactionAt > createStart, "create should wrap required intake writes in a db transaction");
  assert.match(createBody, /try\s*\{/);
  assert.match(createBody, /Could not create enquiry/);
  assert.match(serviceSource, /private async createEnquiryCaseBundle/);
  assert.match(serviceSource, /tx\.insert\(enquiries\)/);
  assert.match(serviceSource, /tx\.insert\(cases\)/);
  assert.match(serviceSource, /tx\.insert\(parties\)/);
  assert.match(serviceSource, /tx\.update\(enquiries\)/);
  assert.match(serviceSource, /tx\.insert\(notifications\)/);
  assert.ok(duplicateDetectionAt > transactionAt, "duplicate detection should run after the transaction commits");
  assert.ok(acknowledgementAt > transactionAt, "acknowledgement email should run after the transaction commits");
});

test("case routes expose SOP claim, contact, safeguarding and closure actions", () => {
  const routeSource = read("../server/routes/case.routes.ts");
  const caseServiceSource = read("../server/services/case.service.ts");
  const firstContactServiceSource = read("../server/services/intake-first-contact.service.ts");
  const firstContactTransitionSource = read("../server/services/intake-first-contact.transition.ts");

  assert.match(routeSource, /\/api\/cases\/:id\/intake\/claim/);
  assert.match(routeSource, /\/api\/cases\/:id\/intake\/revoke-claim/);
  assert.match(routeSource, /syncLinkedEnquiryStatus/);
  assert.match(routeSource, /validateIntakeWorker/);
  assert.match(routeSource, /\/api\/cases\/:id\/intake\/first-contact/);
  assert.match(routeSource, /\/api\/cases\/:id\/intake\/safeguarding/);
  assert.match(routeSource, /\/api\/cases\/:id\/intake\/notify-rebecca/);
  assert.match(routeSource, /\/api\/cases\/:id\/intake\/close/);
  assert.match(routeSource, /closureReason === "Other"/);
  assert.match(routeSource, /Other closure reason requires an explanation/);
  assert.match(routeSource, /intakeStatus:\s*"Closed"/);
  assert.doesNotMatch(routeSource, /status:\s*"Closed",\s*\n\s*intakeStatus:\s*"Closed"/);
  assert.match(routeSource, /Intake closed from enquiry workflow/);
  assert.doesNotMatch(routeSource, /Case closed from intake workflow/);
  assert.match(routeSource, /completeOpenIntakeFollowUpTasks/);
  assert.match(routeSource, /Intake closed: \$\{closureReason\}/);
  assert.match(routeSource, /enquiry_follow_up/);
  assert.match(routeSource, /enquiry_persistent_follow_up/);
  assert.match(caseServiceSource, /c\.status === "Closed" \|\| c\.status === "Archived" \|\| c\.intakeStatus === "Closed"/);
  assert.match(routeSource, /\/api\/cases\/:caseId\/intake\/chase-tasks\/:taskId\/complete/);
  assert.match(routeSource, /!\["superadmin", "subadmin", "staff"\]\.includes\(user\.role\)/);
  assert.doesNotMatch(routeSource, /Only superadmins can record intake chase contacts/);
  assert.match(routeSource, /isValidContactMethod\(contactMethod\)/);
  assert.match(routeSource, /notes\.trim\(\)/);
  assert.match(routeSource, /function isSafeguardingDecided/);
  assert.match(routeSource, /function isSafeguardingClear/);
  assert.match(routeSource, /complete the safeguarding check before claiming/);
  assert.match(routeSource, /recordIntakeFirstContact/);
  assert.match(firstContactTransitionSource, /complete the safeguarding check before recording first contact/);
  assert.match(routeSource, /complete the safeguarding check before closing intake/);
  assert.match(routeSource, /shouldAutoClaimFromSafeguarding = !existing\.claimedBy/);
  assert.match(routeSource, /claimedBy: user\.id/);
  assert.match(routeSource, /claimedAt: new Date\(\)/);
  assert.match(routeSource, /intakeStatus: "Safeguarding"/);
  assert.match(routeSource, /intakeStatusAfterSafeguardingClear/);
  assert.match(routeSource, /source: "safeguarding_gate"/);
  assert.match(routeSource, /automatically assigned when recording the safeguarding decision/);
  assert.doesNotMatch(routeSource, /Promise\.all\(\[\s*notificationService\.createNotification\([\s\S]*Day 5 chase[\s\S]*notificationService\.createNotification\([\s\S]*Day 10 chase/);
  assert.match(routeSource, /INTAKE_PERSISTENT_FOLLOW_UP_TYPE/);
  assert.match(routeSource, /standardChaseStopped:\s*true/);
  assert.match(routeSource, /noWhatsappOrVoicemail:\s*true/);
  assert.match(routeSource, /No email or WhatsApp follow-up/);
  assert.match(routeSource, /nationalDaHelplineSignposted:\s*true/);
  assert.match(routeSource, /syncLinkedEnquiryShuttle/);
  const safeguardingConcernUpdates = routeSource.match(/const updates: Partial<Case> = status === "concern"\s*\? \{([\s\S]*?)\}\s*: \{/);
  assert.ok(safeguardingConcernUpdates, "safeguarding concern updates should be defined");
  assert.doesNotMatch(safeguardingConcernUpdates[1], /shuttleMediation/);
  const safeguardingConcernSync = routeSource.match(/if \(status === "concern"\) \{([\s\S]*?)\}\s*await clearInvalidCimEligibility/);
  assert.doesNotMatch(safeguardingConcernSync?.[1] || "", /syncLinkedEnquiryShuttle/);
  assert.doesNotMatch(routeSource, /shuttle mediation enabled/);
});

test("safeguarding concern creates sensitive audience alerts only on new concern", () => {
  const routeSource = read("../server/routes/case.routes.ts");

  const safeguardingRoute = routeSource.match(/router\.patch\("\/api\/cases\/:id\/intake\/safeguarding"[\s\S]*?return res\.json\(updated\);\n}\);/);
  assert.ok(safeguardingRoute, "safeguarding route should exist");
  assert.match(safeguardingRoute[0], /const isNewSafeguardingConcern = status === "concern" && existing\.safeguardingStatus !== "concern"/);
  assert.match(safeguardingRoute[0], /if \(isNewSafeguardingConcern\)/);
  assert.match(safeguardingRoute[0], /notifySensitiveCaseAudience\({[\s\S]*type: "safeguarding_concern_raised"[\s\S]*urgency: "red"[\s\S]*title: `Safeguarding concern raised/);
  assert.match(routeSource, /recipientRole: "admin"/);
  assert.match(routeSource, /recipientRole: "mediator"/);
  assert.doesNotMatch(safeguardingRoute[0], /notes[\s\S]*notifySensitiveCaseAudience\({[\s\S]*safeguarding_concern_raised[\s\S]*notes/);
});

test("case detail safeguarding concern badge is hidden from client-only views", () => {
  const caseDetailSource = read("../client/src/pages/case-detail.tsx");

  assert.match(caseDetailSource, /function SourceEnquirySummaryCard\(\{ caseData, canViewSensitiveCaseMarkers \}/);
  assert.match(caseDetailSource, /canViewSensitiveCaseMarkers && caseHasSafeguardingConcern && \(/);
  assert.match(caseDetailSource, /<SourceEnquirySummaryCard caseData=\{caseData\} canViewSensitiveCaseMarkers=\{canViewOperationalStaffData\} \/>/);
});

test("notify Rebecca keeps the admin task and sends a best-effort Rebecca email", () => {
  const routeSource = read("../server/routes/case.routes.ts");
  const emailSource = read("../server/services/email.service.ts");

  assert.match(routeSource, /sendSafeguardingRebeccaNotificationEmail/);
  const notifyRebeccaRoute = routeSource.match(/router\.patch\("\/api\/cases\/:id\/intake\/notify-rebecca"[\s\S]*?return res\.json\(updated\);\n}\);/);
  assert.ok(notifyRebeccaRoute, "notify Rebecca route should exist");
  assert.match(notifyRebeccaRoute[0], /type: "safeguarding_rebecca_notification"/);
  assert.match(notifyRebeccaRoute[0], /rebecca@brighterfuturemediation\.co\.uk/);
  assert.match(notifyRebeccaRoute[0], /storage\.getUserByEmail\("rebecca@brighterfuturemediation\.co\.uk"\)/);
  assert.match(notifyRebeccaRoute[0], /rebeccaUser\?\.role === "superadmin"/);
  assert.match(notifyRebeccaRoute[0], /sendSafeguardingRebeccaNotificationEmail\(/);
  assert.match(notifyRebeccaRoute[0], /catch \(emailErr\)/);
  assert.match(notifyRebeccaRoute[0], /console\.error\("\[Safeguarding\] Notify Rebecca email failed"/);
  assert.match(emailSource, /export async function sendSafeguardingRebeccaNotificationEmail/);
  assert.match(emailSource, /formatCaseEmailSubject\("Safeguarding pathway action", caseRef\)/);
  assert.doesNotMatch(emailSource, /safeguardingNotes|notes:/);
});

test("Day 0 creates the initial Day 5 chase task", () => {
  const routeSource = read("../server/routes/case.routes.ts");
  const firstContactServiceSource = read("../server/services/intake-first-contact.service.ts");
  const firstContactRoute = routeSource.match(/router\.patch\("\/api\/cases\/:id\/intake\/first-contact"[\s\S]*?return res\.json\(result\.caseRecord\);\n}\);/);

  assert.ok(firstContactRoute, "first-contact route should exist");
  assert.match(firstContactRoute[0], /recordIntakeFirstContact\(/);
  assert.match(firstContactServiceSource, /title: `Day 5 chase — \$\{caseRecord\.caseRef\}`/);
  assert.doesNotMatch(firstContactRoute[0], /Day 10 chase/);
  // Later-stage sequencing and safeguarding gates are exercised behaviorally
  // in intake-chase-transition.test.ts and intake-chase-persistence.test.ts.
});

test("enquiry shuttle flag syncs with linked case and is exposed from enquiry routes", () => {
  const schemaSource = read("../shared/schema.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const enquiryRouteSource = read("../server/routes/enquiry.routes.ts");
  const caseRouteSource = read("../server/routes/case.routes.ts");
  const storageSource = read("../server/storage.ts");
  const enquiryRepositorySource = read("../server/repositories/enquiry.repository.ts");

  assert.match(schemaSource, /shuttleMediation:\s*boolean\("shuttle_mediation"\)\.notNull\(\)\.default\(false\)/);
  assert.match(schemaSource, /shuttleMediation:\s*true/);
  assert.match(bootstrapSource, /ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS shuttle_mediation BOOLEAN NOT NULL DEFAULT false/);
  assert.match(bootstrapSource, /UPDATE enquiries e\s+SET shuttle_mediation = c\.shuttle_mediation/);
  assert.match(enquiryRouteSource, /\/api\/enquiries\/:id\/shuttle/);
  assert.match(enquiryRouteSource, /shuttleMediation must be true or false/);
  assert.match(enquiryRouteSource, /updateEnquiryShuttle/);
  assert.match(caseRouteSource, /syncLinkedEnquiryShuttle/);
  assert.match(caseRouteSource, /syncLinkedEnquiryShuttle\(req\.params\.id, shuttleMediation\)/);
  assert.match(storageSource, /updateEnquiryShuttle/);
  assert.match(enquiryRepositorySource, /updateEnquiryShuttle/);
});

test("enquiry detail page owns the SOP intake workflow panel", () => {
  const pageSource = read("../client/src/pages/case-detail.tsx");
  const enquiryDetailSource = read("../client/src/pages/enquiry-detail.tsx");
  const intakeWorkflowSource = read("../client/src/components/enquiry-intake-workflow-card.tsx");
  const intakeWorkflowStateSource = read("../client/src/components/enquiry-intake-workflow-card-state.ts");
  const layoutSource = read("../client/src/components/layout/dashboard-layout.tsx");
  const enquiriesPageSource = read("../client/src/pages/enquiries.tsx");
  const serviceSource = read("../server/services/case.service.ts");

  assert.match(layoutSource, /EnquiryDetailPage/);
  assert.match(layoutSource, /path="\/enquiries\/:id"/);
  assert.match(enquiriesPageSource, /Open enquiry/);
  assert.match(enquiriesPageSource, /Work enquiry/);
  assert.match(enquiriesPageSource, /sheet-enquiry-detail/);
  assert.match(enquiryDetailSource, /data-testid="enquiry-detail-page"/);
  assert.match(enquiryDetailSource, /\/api\/enquiries/);
  assert.match(enquiryDetailSource, /\/api\/cases/);
  assert.match(enquiryDetailSource, /Contact Details/);
  assert.match(enquiryDetailSource, /Linked case/);
  assert.match(enquiryDetailSource, /duplicate-review-panel/);
  assert.match(enquiryDetailSource, /acknowledgement-email-panel/);
  assert.match(enquiryDetailSource, /privacy-consent-panel/);
  assert.match(enquiryDetailSource, /card-enquiry-shuttle/);
  assert.match(enquiryDetailSource, /switch-enquiry-shuttle/);
  assert.match(enquiryDetailSource, /\/api\/enquiries\/\$\{enquiryId\}\/shuttle/);
  assert.match(enquiryDetailSource, /Shuttle mediation/);
  assert.match(enquiryDetailSource, /ActivityTimeline caseId=\{linkedCaseId\} isStaff=\{isStaff\} compact maxItems=\{5\}/);
  assert.match(enquiryDetailSource, /data-testid="enquiry-detail-right-rail"/);
  assert.match(enquiryDetailSource, /linkedCaseHasSafeguardingConcern/);
  assert.match(enquiryDetailSource, /data-testid="badge-linked-case-safeguarding-concern"/);
  assert.match(enquiryDetailSource, /Safeguarding concern raised/);
  assert.doesNotMatch(enquiryDetailSource, /lg:sticky lg:top-6/);
  assert.match(enquiryDetailSource, /href=\{`\/cases\/\$\{linkedCaseId\}\?tab=communications`\}/);
  assert.ok(
    enquiryDetailSource.indexOf('data-testid="card-linked-case-summary"') <
    enquiryDetailSource.indexOf('data-testid="card-linked-case-activity"'),
  );
  assert.ok(
    enquiryDetailSource.indexOf('data-testid="card-linked-case-activity"') <
    enquiryDetailSource.indexOf('data-testid="duplicate-review-panel"'),
  );
  assert.ok(
    enquiryDetailSource.indexOf('data-testid="duplicate-review-panel"') <
    enquiryDetailSource.indexOf('data-testid="acknowledgement-email-panel"'),
  );
  assert.ok(
    enquiryDetailSource.indexOf('data-testid="acknowledgement-email-panel"') <
    enquiryDetailSource.indexOf('data-testid="privacy-consent-panel"'),
  );
  assert.ok(
    enquiryDetailSource.indexOf('data-testid="card-calendly-metadata"') <
    enquiryDetailSource.indexOf('data-testid="enquiry-detail-right-rail"'),
  );
  assert.match(enquiryDetailSource, /IntakeWorkflowCard/);
  assert.match(enquiryDetailSource, /Missing linked case/);
  assert.match(intakeWorkflowSource, /INTAKE_PROGRESS_STAGES/);
  assert.match(intakeWorkflowSource, /function FunctionalIntakeProgress/);
  assert.match(intakeWorkflowSource, /data-testid="functional-intake-progress"/);
  assert.match(intakeWorkflowSource, /data-testid=\{`intake-progress-step-\$\{stage\}`\}/);
  assert.match(intakeWorkflowSource, /button-intake-progress-claimed/);
  assert.match(intakeWorkflowSource, /button-intake-progress-chasing/);
  assert.match(intakeWorkflowSource, /button-intake-progress-safeguarding/);
  assert.match(intakeWorkflowSource, /button-intake-progress-closed/);
  assert.match(intakeWorkflowSource, /section-intake-claim-first-contact/);
  assert.match(intakeWorkflowSource, /section-intake-chase-status/);
  assert.match(intakeWorkflowSource, /section-intake-safeguarding/);
  assert.match(intakeWorkflowSource, /const INTAKE_PROGRESS_STAGES = \["New", "Safeguarding", "Claimed", "Chasing", "Closed"\]/);
  assert.ok(
    intakeWorkflowSource.indexOf('data-testid="section-intake-safeguarding"') <
    intakeWorkflowSource.indexOf('data-testid="section-intake-claim-first-contact"'),
  );
  assert.ok(
    intakeWorkflowSource.indexOf('data-testid="section-intake-claim-first-contact"') <
    intakeWorkflowSource.indexOf('data-testid="section-intake-chase-status"'),
  );
  assert.match(intakeWorkflowSource, /section-intake-closure/);
  assert.match(intakeWorkflowSource, /isOtherClosureReason/);
  assert.match(intakeWorkflowSource, /otherClosureExplanationMissing/);
  assert.match(intakeWorkflowSource, /Other closure reason explanation/);
  assert.match(intakeWorkflowSource, /Please explain the other closure reason/);
  assert.match(intakeWorkflowSource, /otherClosureExplanationMissing \|\|/);
  assert.match(intakeWorkflowSource, /openChaseWorkloadCount/);
  assert.match(intakeWorkflowSource, /data-testid="badge-open-chase-workload"/);
  assert.match(intakeWorkflowSource, /scrollIntoView/);
  assert.match(intakeWorkflowSource, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(intakeWorkflowSource, /function IntakeProgressStrip/);
  assert.doesNotMatch(intakeWorkflowSource, /data-testid="intake-progress-strip"/);
  assert.match(intakeWorkflowSource, /deriveIntakeProgress/);
  assert.match(intakeWorkflowSource, /deriveNextIntakeAction/);
  assert.match(intakeWorkflowSource, /caseData\.status === "Closed" \|\| caseData\.status === "Archived" \|\| status === "Closed"/);
  assert.match(intakeWorkflowSource, /data-testid="intake-next-action-summary"/);
  assert.match(intakeWorkflowSource, /Complete safeguarding check/);
  assert.match(intakeWorkflowSource, /No safeguarding concern/);
  assert.match(intakeWorkflowSource, /Raise concern/);
  assert.match(intakeWorkflowSource, /safeguarding-clear-confirmation/);
  assert.doesNotMatch(intakeWorkflowSource, /Recording a decision assigns unclaimed intake work to you/);
  assert.doesNotMatch(intakeWorkflowSource, /Record the safeguarding decision before claiming/);
  assert.match(intakeWorkflowSource, /safeguardingDecided/);
  assert.match(intakeWorkflowSource, /safeguardingCleared/);
  assert.match(intakeWorkflowSource, /disabled=\{claimMutation\.isPending \|\| !safeguardingCleared/);
  assert.match(intakeWorkflowSource, /currentActionKind === "day0"/);
  assert.match(intakeWorkflowSource, /disabled=\{firstContactMutation\.isPending \|\| !canWorkIntake/);
  assert.match(intakeWorkflowSource, /canRecordChase = \(safeguardingCleared \|\| \(isAdmin && activeSafeguardingConcern\)\)/);
  assert.match(intakeWorkflowSource, /allowSafeguardingWork: isAdmin/);
  assert.match(intakeWorkflowSource, /BFM will not send an email or WhatsApp message\. Do not leave a voicemail\./);
  assert.match(intakeWorkflowSource, /disabled=\{closeMutation\.isPending \|\| !safeguardingDecided/);
  ["New", "Claimed", "Chasing", "Safeguarding", "Closed"].forEach(status => assert.match(intakeWorkflowSource, new RegExp(status)));
  assert.match(intakeWorkflowSource, /Claim enquiry/);
  assert.match(intakeWorkflowSource, /Record first contact/);
  assert.match(intakeWorkflowSource, /Complete next chase task/);
  assert.match(intakeWorkflowSource, /Review safeguarding/);
  assert.match(intakeWorkflowSource, /Intake closed/);
  assert.match(intakeWorkflowSource, /First contact method \*/);
  assert.match(intakeWorkflowSource, /Channel used for the first attempt\./);
  assert.match(intakeWorkflowSource, /Intake chase status/);
  assert.match(intakeWorkflowSource, /intakeClosed/);
  assert.match(intakeWorkflowSource, /No further chase required/);
  assert.match(intakeWorkflowSource, /data-testid="intake-chase-closed-summary"/);
  assert.match(intakeWorkflowSource, /const intakeAction = deriveIntakeAction\(caseData, intakeTasks, new Date\(\), \{ allowSafeguardingWork: isAdmin \}\)/);
  assert.match(intakeWorkflowSource, /const intakeClosed = normaliseIntakeStatus\(caseData\.intakeStatus\) === "Closed" \|\| caseData\.status === "Closed" \|\| caseData\.status === "Archived"/);
  assert.match(intakeWorkflowSource, /function TerminalIntakeReadOnly/);
  assert.match(intakeWorkflowSource, /!safeguardingOnly && !canEditCase && intakeClosed/);
  assert.match(intakeWorkflowSource, /const currentChaseTask = intakeAction\.task/);
  assert.match(intakeWorkflowSource, /openChaseWorkloadCount = intakeClosed \? 0/);
  assert.match(intakeWorkflowSource, /parseChaseCompletionNotes/);
  assert.match(intakeWorkflowSource, /Contact method/);
  assert.match(intakeWorkflowSource, /Reason\/outcome/);
  assert.match(intakeWorkflowSource, /Day 0 - First contact/);
  assert.match(intakeWorkflowSource, /Day 5 - Follow-up chase/);
  assert.match(intakeWorkflowSource, /Day 10 - Final chase/);
  assert.match(intakeWorkflowStateSource, /Upcoming/);
  assert.match(intakeWorkflowStateSource, /Due today/);
  assert.match(intakeWorkflowStateSource, /Overdue/);
  assert.match(intakeWorkflowSource, /getChaseTiming/);
  assert.match(intakeWorkflowSource, /currentChaseTaskId/);
  assert.match(intakeWorkflowSource, /\/api\/cases\/\$\{caseId\}\/intake\/tasks/);
  assert.match(intakeWorkflowSource, /Standard chase stopped due to safeguarding/);
  assert.match(intakeWorkflowSource, /Record \{currentActionKind/);
  assert.match(intakeWorkflowSource, /Contact method \*/);
  assert.match(intakeWorkflowSource, /Notes \*/);
  assert.match(intakeWorkflowSource, /\/api\/cases\/\$\{caseId\}\/intake\/chase-tasks\/\$\{task\.id\}\/complete/);
  assert.match(intakeWorkflowSource, /intake-first-contact-summary/);
  assert.match(intakeWorkflowSource, /Claim and next intake action/);
  assert.match(intakeWorkflowSource, /Scheduled due \$\{formatDate\(currentChaseTask\.followUpDate\)\}/);
  assert.match(intakeWorkflowSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/notifications"\] \}\)/);
  assert.doesNotMatch(intakeWorkflowSource, /selectedChaseTask|chaseDialogOpen|<Dialog/);
  assert.match(intakeWorkflowSource, /\["superadmin", "subadmin", "staff"\]\.includes\(user\?\.role \|\| ""\)/);
  assert.match(intakeWorkflowSource, /Claimed by/);
  assert.match(intakeWorkflowSource, /claimedByName/);
  assert.match(serviceSource, /claimedByName/);
  assert.match(serviceSource, /storage\.getUser\(c\.claimedBy\)/);
  assert.match(intakeWorkflowSource, /National Domestic Abuse Helpline/);
  assert.match(intakeWorkflowSource, /0808 2000 247/);
  assert.match(intakeWorkflowSource, /getSafeguardingStatusMeta/);
  assert.match(intakeWorkflowSource, /data-testid="badge-safeguarding-status"/);
  assert.match(intakeWorkflowSource, /data-testid="safeguarding-status-help"/);
  assert.match(intakeWorkflowSource, /Safeguarding concern is active\. Standard chase and client follow-up messaging are stopped\./);
  assert.doesNotMatch(intakeWorkflowSource, /Record the safeguarding decision before contact, chase, or closure actions/);
  assert.match(intakeWorkflowSource, /queryClient\.setQueryData<IntakeCaseDetail \| undefined>\(\["\/api\/cases", caseId\]/);
  assert.match(intakeWorkflowSource, /onWorkflowUpdated\?\.\(\)/);
  assert.match(intakeWorkflowSource, /queryKey: \["\/api\/cases", caseId, "intake", "tasks"\]/);
  assert.match(intakeWorkflowSource, /button-intake-claim/);
  assert.match(intakeWorkflowSource, /button-intake-revoke-claim/);
  assert.match(intakeWorkflowSource, /claimed by another staff member/);
  assert.match(intakeWorkflowSource, /canWorkIntake/);
  assert.doesNotMatch(intakeWorkflowSource, /data-testid="intake-action-grid"/);
  assert.doesNotMatch(intakeWorkflowSource, /lg:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(320px,0\.65fr\)\]/);
  assert.doesNotMatch(intakeWorkflowSource, /lg:grid-cols-3/);
  assert.match(intakeWorkflowSource, /data-testid="panel-claim-first-contact"/);
  assert.match(intakeWorkflowSource, /data-testid="panel-safeguarding-gate"/);
  assert.match(intakeWorkflowSource, /data-testid="panel-closure"/);
  assert.match(intakeWorkflowSource, /Close enquiry intake with a reason and supporting note\./);
  assert.match(intakeWorkflowSource, /button-intake-first-contact/);
  assert.match(intakeWorkflowSource, /button-safeguarding-concern/);
  assert.match(intakeWorkflowSource, /select-closure-reason/);
  assert.match(intakeWorkflowSource, /CASE_CLOSURE_REASONS\.map/);
  assert.doesNotMatch(intakeWorkflowSource, /Use one of the approved RW 06\.08\.26 closure reasons\./);
  assert.match(pageSource, /data-testid="card-source-enquiry-summary"/);
  assert.match(enquiryDetailSource, /onWorkflowUpdated=\{refreshEnquiry\}/);
  assert.match(pageSource, /caseHasSafeguardingConcern/);
  assert.match(pageSource, /data-testid="badge-case-safeguarding-concern"/);
  assert.match(pageSource, /Safeguarding concern raised/);
  assert.match(pageSource, /href=\{`\/enquiries\/\$\{source\.id\}`\}/);
  assert.match(pageSource, /import \{ IntakeWorkflowCard/);
  assert.match(pageSource, /<IntakeWorkflowCard\s+mode="safeguarding-only"\s+caseData=\{caseData\}\s+caseId=\{caseId!\}\s+onWorkflowUpdated=\{refreshCaseDetailIntakeWorkflow\}/);
  assert.match(enquiryDetailSource, /<IntakeWorkflowCard caseData=\{caseQuery\.data\} caseId=\{linkedCaseId!\} onWorkflowUpdated=\{refreshEnquiry\} \/>/);
  assert.match(intakeWorkflowSource, /"card-case-safeguarding-gate" : "card-intake-workflow"/);
  assert.match(intakeWorkflowSource, /data-testid="panel-safeguarding-gate"/);
  assert.match(intakeWorkflowSource, /button-safeguarding-clear/);
  assert.match(intakeWorkflowSource, /button-safeguarding-concern/);
  assert.match(intakeWorkflowSource, /button-notify-rebecca/);
  assert.doesNotMatch(pageSource, /function IntakeWorkflowCard/);
});

test("case detail page shows a persistent recent activity sidebar for superadmins", () => {
  const pageSource = read("../client/src/pages/case-detail.tsx");

  assert.match(pageSource, /showPersistentActivityCard/);
  assert.match(pageSource, /data-testid="card-persistent-recent-activity"/);
  assert.match(pageSource, /ActivityTimeline caseId=\{caseId\} isStaff=\{isStaff\} compact maxItems=\{5\}/);
  assert.match(pageSource, /setActiveTab\("communications"\)/);
  assert.match(pageSource, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(pageSource, /user\?\.role === "superadmin"/);
});

test("startup bootstrap creates SOP intake columns", () => {
  const bootstrapSource = read("../server/db-bootstrap.ts");

  assert.match(bootstrapSource, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS intake_status TEXT/);
  assert.match(bootstrapSource, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS claimed_by VARCHAR/);
  assert.match(bootstrapSource, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS first_contact_due_at TIMESTAMP/);
  assert.match(bootstrapSource, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS safeguarding_confidential BOOLEAN/);
  assert.match(bootstrapSource, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS closure_reason TEXT/);
  assert.match(bootstrapSource, /Backfill legacy enquiry statuses/);
  assert.match(bootstrapSource, /UPDATE enquiries e/);
  assert.match(bootstrapSource, /Converted', 'Reviewed', 'Rejected/);
});

test("enquiries page uses intake lifecycle statuses instead of converted workflow", () => {
  const enquiriesPageSource = read("../client/src/pages/enquiries.tsx");
  const badgeSource = read("../client/src/components/shared/status-badge.tsx");

  assert.match(badgeSource, /Claimed/);
  assert.match(badgeSource, /Chasing/);
  assert.match(badgeSource, /Safeguarding/);
  assert.match(badgeSource, /Closed/);
  assert.doesNotMatch(enquiriesPageSource, /Reviewed/);
  assert.doesNotMatch(enquiriesPageSource, /Converted/);
  assert.doesNotMatch(enquiriesPageSource, /Rejected/);
});

test("enquiries queue exposes computed follow-up visibility and triage filters", () => {
  const repositorySource = read("../server/repositories/enquiry.repository.ts");
  const enquiriesPageSource = read("../client/src/pages/enquiries.tsx");

  assert.match(repositorySource, /nextFollowUpLabel/);
  assert.match(repositorySource, /nextFollowUpDueAt/);
  assert.match(repositorySource, /nextFollowUpState/);
  assert.match(repositorySource, /enquiry_follow_up/);
  assert.match(repositorySource, /enquiry_chase/);
  assert.match(repositorySource, /enquiry_persistent_follow_up/);
  assert.match(repositorySource, /return "Ongoing"/);
  assert.match(repositorySource, /due_today/);
  assert.match(repositorySource, /overdue/);
  assert.match(repositorySource, /notifications\.status, "completed"/);
  assert.match(enquiriesPageSource, /followUpFilter/);
  assert.match(enquiriesPageSource, /due_today/);
  assert.match(enquiriesPageSource, /overdue/);
  assert.match(enquiriesPageSource, /unclaimed/);
  assert.match(enquiriesPageSource, /safeguarding/);
  assert.match(enquiriesPageSource, /Follow-up/);
  assert.match(enquiriesPageSource, /formatFollowUpBadge/);
  assert.match(enquiriesPageSource, /badge-enquiry-follow-up/);
  assert.match(enquiriesPageSource, /w-\[120px\]/);
  assert.match(enquiriesPageSource, /whitespace-nowrap/);
  assert.match(enquiriesPageSource, /followUpBadge\.title/);
  assert.match(enquiriesPageSource, /Ongoing/);
  const followUpBadgeLine = enquiriesPageSource
    .split("\n")
    .find((line) => line.includes("badge-enquiry-follow-up")) || "";
  assert.match(followUpBadgeLine, /whitespace-nowrap/);
  assert.doesNotMatch(followUpBadgeLine, /flex-col/);
});

test("post-day-10 intake chase creates persistent weekly follow-up tasks until closure", () => {
  const routeSource = read("../server/routes/case.routes.ts");
  const notificationSource = read("../server/services/notification.service.ts");
  const appSource = read("../server/app.ts");
  const intakeWorkflowSource = read("../client/src/components/enquiry-intake-workflow-card.tsx");
  const replitSource = read("../replit.md");

  assert.match(routeSource, /const INTAKE_PERSISTENT_FOLLOW_UP_TYPE = "enquiry_persistent_follow_up"/);
  assert.match(notificationSource, /Ongoing enquiry follow-up/);
  assert.match(routeSource, /standardChaseStopped/);
  assert.match(routeSource, /safeguardingStatus === "concern"/);

  assert.match(notificationSource, /ensurePersistentIntakeFollowUps/);
  assert.match(appSource, /ensurePersistentIntakeFollowUps/);

  assert.match(intakeWorkflowSource, /persistentChaseTask/);
  assert.match(intakeWorkflowSource, /Ongoing - Weekly follow-up/);
  assert.match(intakeWorkflowSource, /"chase-step-persistent-follow-up"/);

  assert.match(replitSource, /weekly persistent follow-up/i);
  assert.match(replitSource, /one open intake follow-up/i);
  assert.match(replitSource, /closure/i);
});
