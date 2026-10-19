/**
 * Regression checks for revoking live mediator service approvals.
 *
 * Run with: npx tsx tests/mediator-service-approval-revocation.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schemaSource = read("../shared/schema.ts");
const routeSource = read("../server/routes/mediator-profile.routes.ts");
const serviceSource = read("../server/services/mediator-service-approval.service.ts");
const availabilitySource = read("../server/services/availability.service.ts");
const availabilityWindowsSource = read("../server/services/availability-windows.ts");
const detailSource = read("../client/src/pages/mediator-detail.tsx");

test("schema recognizes revoked service approvals as a first-class status", () => {
  assert.match(schemaSource, /"revoked"/);
});

test("mediator profile exposes staff-only revoke endpoint with required reason validation", () => {
  assert.match(routeSource, /\/api\/mediators\/:id\/service-approvals\/:serviceTypeId\/revoke/);
  assert.match(routeSource, /serviceApprovalRevokeSchema/);
  assert.match(routeSource, /reviewReason: z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(routeSource, /actor\.actorRole !== "superadmin" && actor\.actorRole !== "subadmin"/);
  assert.match(routeSource, /mediatorServiceApprovalService\.revoke/);
  assert.match(routeSource, /sendMediatorServiceProofRequestEmail/);
});

test("service revoke moves approved mediator rows into proof-request state without deleting history", () => {
  const revokeMethod = serviceSource.slice(
    serviceSource.indexOf("async revoke"),
    serviceSource.indexOf("async saveCalendarEvent"),
  );
  assert.match(serviceSource, /async revoke/);
  assert.match(revokeMethod, /getEffectiveApprovalStatus\(row\) !== "approved"/);
  assert.match(revokeMethod, /status:\s*"revoked"/);
  assert.match(revokeMethod, /requestedAt:\s*new Date\(\)/);
  assert.match(revokeMethod, /requestedBy:\s*actorId/);
  assert.match(revokeMethod, /reviewReason:\s*reviewReason\.trim\(\)/);
  assert.match(revokeMethod, /createMediatorServiceProofRequestTask\(\{ actorId, mediatorId: updated\.mediatorId, serviceTypeId \}\)/);
  assert.match(revokeMethod, /action:\s*"service_approval_revoked"/);
  assert.doesNotMatch(revokeMethod, /removeMediatorServiceType/);
});

test("revoked approvals are excluded anywhere booking availability needs approved rows", () => {
  assert.match(availabilitySource, /getEffectiveApprovalStatus\(row\) === "approved"/);
  assert.doesNotMatch(availabilitySource, /eq\(mediatorServiceApprovals\.status,\s*"approved"\)/);
  assert.match(availabilityWindowsSource, /getEffectiveApprovalStatus/);
  assert.match(availabilityWindowsSource, /filter\(\(row\) => getEffectiveApprovalStatus\(row\) === "approved"\)/);
});

test("mediator detail renders a required-reason revoke action for approved services", () => {
  assert.match(detailSource, /revokeServiceApproval/);
  assert.match(detailSource, /button-revoke-service-approval-\$\{service\.id\}/);
  assert.match(detailSource, /revokeReasonByServiceId/);
  assert.match(detailSource, /disabled=\{revokeServiceApproval\.isPending \|\| !revokeReason\.trim\(\)\}/);
  assert.match(detailSource, /\/api\/mediators\/\$\{id\}\/service-approvals\/\$\{input\.serviceTypeId\}\/revoke/);
  assert.match(detailSource, /displayStatus === "revoked"/);
  assert.match(detailSource, /queryKey: \["\/api\/mediators", id, "service-schedule-slots"\]/);
  assert.match(detailSource, /queryKey: \["\/api\/dashboard\/appointments"\]/);
});
