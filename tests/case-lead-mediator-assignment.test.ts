/**
 * Regression checks for superadmin lead mediator assignment.
 *
 * Run with: npx tsx tests/case-lead-mediator-assignment.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const caseRoutesSource = read("../server/routes/case.routes.ts");
const caseServiceSource = read("../server/services/case.service.ts");
const caseDetailSource = read("../client/src/pages/case-detail.tsx");
const storageSource = read("../server/storage.ts");
const caseRepositorySource = read("../server/repositories/case.repository.ts");
const caseAccessPolicySource = read("../server/security/case-access-policy.ts");
const caseLeadMediatorServiceSource = read("../server/services/case-lead-mediator.service.ts");

test("lead mediator update endpoint is admin-only and accepts nullable mediator id", () => {
  assert.match(caseRoutesSource, /router\.patch\("\/api\/cases\/:id\/mediator"/);
  assert.match(caseRoutesSource, /user\.role !== "superadmin" && user\.role !== "subadmin"/);
  assert.match(caseRoutesSource, /mediatorId must be a user id or null/);
  assert.match(caseRoutesSource, /const mediatorId = rawMediatorId === "" \? null : rawMediatorId/);
  assert.match(storageSource, /updateCaseMediator\(id: string, mediatorId: string \| null\)/);
  assert.match(caseRepositorySource, /async updateCaseMediator\(\s*id: string,\s*mediatorId: string \| null/);
});

test("lead mediator update validates case-wide service eligibility or current superadmin", () => {
  assert.match(caseRoutesSource, /const isSelfSuperadmin = mediatorId === user\.id && user\.role === "superadmin"/);
  assert.match(caseRoutesSource, /caseLeadMediatorService\.validateAssignment\(mediatorId\)/);
  assert.match(caseLeadMediatorServiceSource, /serviceApproved: !row\.expiredAt && getEffectiveApprovalStatus\([\s\S]*\) === "approved"/);
  assert.match(caseLeadMediatorServiceSource, /buildCaseLeadMediatorOptions/);
});

test("lead mediator update logs activity, audit, and mediator notification", () => {
  assert.match(caseRoutesSource, /title: "Lead mediator updated"/);
  assert.match(caseRoutesSource, /changed the lead mediator from/);
  assert.match(caseRoutesSource, /entity: "case"/);
  assert.match(caseRoutesSource, /field: "mediatorId"/);
  assert.match(caseRoutesSource, /if \(nextMediator\?\.role === "mediator"\)/);
  assert.match(caseRoutesSource, /recipientRole: "mediator"/);
  assert.match(caseRoutesSource, /type: "task_assigned"/);
  assert.match(caseRoutesSource, /Lead mediator assigned/);
});

test("case detail access grants case and session leads full access while preserving participant tiers", () => {
  assert.match(caseServiceSource, /const access = await classifyCaseAccess\(c\.id, user\)/);
  assert.match(caseServiceSource, /access\.tier === "session_observer" \|\| access\.tier === "session_co_mediator"/);
  assert.match(caseServiceSource, /buildSessionParticipantCaseDetail/);
  assert.match(caseServiceSource, /if \(access\.tier === "miam_only_mediator"\)/);
  assert.match(caseAccessPolicySource, /context\.caseMediatorId === user\.id/);
  assert.match(caseAccessPolicySource, /context\.sessions\.some\(\(session\) => session\.leadMediatorId === user\.id\)/);
  assert.match(caseAccessPolicySource, /return \{ tier: "session_co_mediator" \}/);
});

test("case information renders admin role-filtered dropdown and read-only fallback", () => {
  assert.match(caseDetailSource, /function CaseInformationCard\(\{ caseData, caseId, canViewSensitiveCaseMarkers \}/);
  assert.match(caseDetailSource, /enabled: isAdmin/);
  assert.match(caseDetailSource, /cases\/lead-mediator-options/);
  assert.match(caseDetailSource, /data-testid="select-lead-mediator"/);
  assert.match(caseDetailSource, /<SelectItem value="__unassigned__">Unassigned<\/SelectItem>/);
  assert.match(caseDetailSource, /<SelectItem value=\{user\.id\}>Me: \{user\.name \|\| user\.email\}<\/SelectItem>/);
  assert.match(caseDetailSource, /caseData\.mediatorName\} \(current\)<\/SelectItem>/);
  assert.match(caseDetailSource, /eligibleLeadMediators = caseLeadMediatorOptions \?\? \[\]/);
  assert.match(caseDetailSource, /apiRequest\("PATCH", `\/api\/cases\/\$\{caseId\}\/mediator`, \{ mediatorId \}\)/);
  assert.match(caseDetailSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId\] \}\)/);
  assert.match(caseDetailSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases"\] \}\)/);
  assert.match(caseDetailSource, /data-testid="text-info-mediator"/);
});

test("case lead mediator options endpoint is admin-only and separate from session allocation", () => {
  assert.match(caseRoutesSource, /router\.get\("\/api\/cases\/lead-mediator-options"/);
  assert.match(caseRoutesSource, /Only superadmins and subadmins can list case lead mediators/);
  assert.match(caseRoutesSource, /caseLeadMediatorService\.listOptions\(\)/);
  assert.match(caseDetailSource, /queryKey: \["\/api\/cases\/lead-mediator-options"\]/);
  assert.match(caseDetailSource, /queryKey: \["\/api\/mediation-sessions\/mediator-options"\]/);
});
