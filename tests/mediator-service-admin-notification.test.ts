/**
 * Regression coverage for notifying every approval-capable admin about
 * live-mediator service proof submissions.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("live mediator proof submissions create one shared admin review notification", () => {
  const source = read("../server/services/mediator-service-approval.service.ts");

  assert.match(source, /createAdminServiceProofReviewNotification/);
  assert.match(source, /recipientRole:\s*"admin"/);
  assert.match(source, /service_proof_pending_review/);
  assert.match(source, /mediator\?\.role !== "mediator" \|\| mediator\.status !== "active"/);
  assert.match(source, /Review key:/);
  assert.doesNotMatch(source, /createSuperadminServiceProofReviewTasks/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /Superseded by the shared admin service-proof review notification/);
  assert.match(source, /retiredNotificationIds/);
  assert.match(source, /publishPersistedNotifications\(retiredNotificationIds\)/);
  assert.match(source, /completeServiceProofReviewNotification/);

  const authMiddleware = read("../server/middleware/auth.ts");
  assert.match(authMiddleware, /!user \|\| user\.status !== "active"/);
});

test("an idempotent command backfills admin notifications for pending live-mediator approvals", () => {
  const path = new URL("../server/scripts/backfill-mediator-service-review-notifications.ts", import.meta.url);

  assert.equal(existsSync(path), true);
  const source = read("../server/scripts/backfill-mediator-service-review-notifications.ts");
  assert.match(source, /backfillPendingMediatorServiceReviewNotifications/);
  assert.match(source, /pool\.end\(\)/);

  const approvalService = read("../server/services/mediator-service-approval.service.ts");
  assert.match(approvalService, /backfillPendingMediatorServiceReviewNotifications/);
  assert.match(approvalService, /pending_review/);
  assert.match(approvalService, /mediatorId/);

  const packageJson = read("../package.json");
  assert.match(packageJson, /"mediator-services:backfill-review-notifications"/);
});
