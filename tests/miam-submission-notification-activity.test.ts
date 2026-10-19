/**
 * Regression checks for MIAM submission review notifications and activity logs.
 *
 * Run with: npx tsx tests/miam-submission-notification-activity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const routeSource = read("../server/routes/miam-record.routes.ts");
const schemaSource = read("../shared/schema.ts");
const timelineSource = read("../client/src/components/case-activity-timeline.tsx");
const tabSource = read("../client/src/components/miam-record-tab.tsx");

test("MIAM submission creates one admin review notification for mediator-submitted records", () => {
  assert.match(routeSource, /async function createMiamReviewRequiredNotification/);
  assert.match(routeSource, /type: "miam_review_required"/);
  assert.match(routeSource, /recipientRole: "admin"/);
  assert.match(routeSource, /MIAM review required/);
  assert.match(routeSource, /openMiamReviewTasks/);
  assert.match(routeSource, /if \(openMiamReviewTasks\.length > 0\) return null/);
  assert.match(routeSource, /await caseActivityService\.logTaskCreated\(party\.caseId, created\.title, created\.urgency, staffActor\(user\)\)/);
  assert.match(routeSource, /if \(approvalStatusChanged && newApprovalStatus === "submitted" && !isAdminUser\)/);
});

test("MIAM lifecycle activity uses first-class activity types with related record metadata", () => {
  assert.match(schemaSource, /"miam_submitted"/);
  assert.match(schemaSource, /"miam_approved"/);
  assert.match(schemaSource, /"miam_rejected"/);
  assert.match(schemaSource, /"miam_flagged"/);
  assert.match(routeSource, /type: `miam_\$\{newApprovalStatus\}`/);
  assert.match(routeSource, /relatedEntityId: record\.id/);
  assert.match(routeSource, /relatedEntityType: "miam_record"/);
  assert.match(routeSource, /JSON\.stringify\(\{[\s\S]*partyId: party\.id[\s\S]*partyRole: party\.role[\s\S]*approvalStatus[\s\S]*submittedBy[\s\S]*timestamp:/);
  assert.match(routeSource, /type: "miam_approved"/);
  assert.match(routeSource, /type: "miam_rejected"/);
  assert.match(routeSource, /type: "miam_flagged"/);
});

test("admin MIAM decisions close stale review-required tasks", () => {
  assert.match(routeSource, /async function completeMiamReviewRequiredNotifications/);
  assert.match(routeSource, /eq\(notifications\.type, "miam_review_required"\)/);
  assert.match(routeSource, /inArray\(notifications\.status, OPEN_MIAM_REVIEW_STATUSES/);
  assert.match(routeSource, /await notificationService\.complete\(task\.id, user, `MIAM record \$\{decision\} by \$\{user\.name\}`\)/);
  assert.match(routeSource, /await completeMiamReviewRequiredNotifications\(record, "approved", user\)/);
  assert.match(routeSource, /await completeMiamReviewRequiredNotifications\(record, "rejected", user\)/);
  assert.match(routeSource, /await completeMiamReviewRequiredNotifications\(record, "flagged", user\)/);
});

test("activity timeline styles MIAM lifecycle events explicitly", () => {
  assert.match(timelineSource, /miam_submitted: \{ icon: FileText/);
  assert.match(timelineSource, /miam_approved: \{ icon: CheckCircle2/);
  assert.match(timelineSource, /miam_rejected: \{ icon: XCircle/);
  assert.match(timelineSource, /miam_flagged: \{ icon: AlertTriangle/);
});

test("MIAM tab refreshes activities and notifications after MIAM mutations", () => {
  assert.match(tabSource, /function invalidateMiamWorkflowQueries/);
  assert.match(tabSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId, "activities"\], exact: false \}\)/);
  assert.match(tabSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/notifications\/bell"\] \}\)/);
  assert.match(tabSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/notifications"\] \}\)/);
  assert.match(tabSource, /invalidateMiamWorkflowQueries\(\)/);
});

test("admin MIAM review panel identifies the active party record", () => {
  assert.match(tabSource, /const activePartyDetails = parties\.find\(\(p: Party\) => p\.id === activeParty\)/);
  assert.match(tabSource, /const activePartyReviewLabel = activePartyDetails \? partyLabel\(activePartyDetails\) : "This client"/);
  assert.match(tabSource, /data-testid="text-active-miam-party"/);
  assert.match(tabSource, /\{approvalStatus === "submitted" && `\$\{activePartyReviewLabel\}’s MIAM record is awaiting your review\.`\}/);
  assert.match(tabSource, /\{approvalStatus === "flagged" && `\$\{activePartyReviewLabel\}’s MIAM record has been flagged\.`\}/);
  assert.match(tabSource, /\{approvalStatus === "rejected" && `\$\{activePartyReviewLabel\}’s MIAM record was rejected and may be revised\.`\}/);
});
