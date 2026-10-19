/**
 * Regression tests for live mediator service-proof review tasks.
 *
 * Run with: npx tsx tests/mediator-service-proof-review-notification.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("live mediator service proof submission creates one admin-wide review notification", () => {
  const serviceSource = read("../server/services/mediator-service-approval.service.ts");
  const liveRouteSource = read("../server/routes/mediator-profile.routes.ts");
  const applicantRouteSource = read("../server/routes/mediator-applicant.routes.ts");

  assert.match(liveRouteSource, /router\.put\("\/api\/mediators\/:id\/service-approvals\/:serviceTypeId"/);
  assert.match(liveRouteSource, /mediatorServiceApprovalService\.upsertSubmission\(actor\.actorId/);
  assert.match(liveRouteSource, /mediatorId:\s*req\.params\.id/);

  assert.match(serviceSource, /createAdminServiceProofReviewNotification/);
  assert.match(serviceSource, /service_proof_pending_review/);
  assert.match(serviceSource, /recipientRole:\s*"admin"/);
  assert.match(serviceSource, /recipientId:\s*null/);
  assert.match(serviceSource, /urgency:\s*"amber"/);
  assert.match(serviceSource, /caseNoteRequired:\s*false/);
  assert.match(serviceSource, /Service proof pending review/);
  assert.match(serviceSource, /actor\?\.role === "mediator"/);
  assert.match(serviceSource, /eq\(notifications\.status,\s*"active"\)/);
  assert.match(serviceSource, /Review key:/);

  assert.doesNotMatch(applicantRouteSource, /service_proof_pending_review/);
});

test("live mediator service submission can enter pending review without proof attachments", () => {
  const serviceSource = read("../server/services/mediator-service-approval.service.ts");
  const liveRouteSource = read("../server/routes/mediator-profile.routes.ts");
  const methodStart = serviceSource.indexOf("async upsertSubmission");
  const methodEnd = serviceSource.indexOf("async review", methodStart);
  const method = serviceSource.slice(methodStart, methodEnd);
  const schemaStart = liveRouteSource.indexOf("const serviceApprovalSubmitSchema");
  const schemaEnd = liveRouteSource.indexOf("const serviceApprovalReviewSchema", schemaStart);
  const submitSchema = liveRouteSource.slice(schemaStart, schemaEnd);

  assert.match(submitSchema, /serviceApprovalSubmitSchema/);
  assert.doesNotMatch(submitSchema, /At least one supporting file, URL, or evidence note is required/);
  assert.match(method, /status:\s*"pending_review"/);
  assert.match(method, /hasFile:\s*!!filePayload/);
  assert.match(method, /hasLink:\s*!!input\.proofLink/);
  assert.doesNotMatch(method, /if \(!input\.proofLink && !input\.proofFileData\)/);
});

test("notification access and realtime delivery expose admin-wide tasks to Superadmins and Subadmins", () => {
  const serviceSource = read("../server/services/notification.service.ts");
  const realtimeSource = read("../server/services/notification-realtime.service.ts");

  assert.match(serviceSource, /user\.role === "superadmin"/);
  assert.match(serviceSource, /user\.role === "subadmin"/);
  assert.match(serviceSource, /eq\(notifications\.recipientRole,\s*"superadmin"\)/);
  assert.match(serviceSource, /eq\(notifications\.recipientRole,\s*"admin"\)/);
  assert.match(serviceSource, /eq\(notifications\.recipientId,\s*user\.id\)/);
  assert.match(serviceSource, /where\(\s*and\(\s*eq\(notifications\.status,\s*"active"\),\s*this\.visibleCondition\(user\)/s);
  assert.match(serviceSource, /conditions\.push\(this\.visibleCondition\(user\)\)/);
  assert.match(serviceSource, /const hasAccess = await this\.canAccessNotification\(user,\s*existing\)/);

  assert.match(realtimeSource, /user\.role === "superadmin"/);
  assert.match(realtimeSource, /user\.role === "subadmin"/);
  assert.match(realtimeSource, /notification\.recipientRole === "superadmin"/);
  assert.match(realtimeSource, /notification\.recipientRole === "admin"/);
});
