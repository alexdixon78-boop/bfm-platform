/**
 * Regression checks for service-approval notification deep links.
 *
 * Run with: npx tsx tests/mediator-service-notification-deeplink.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const notificationSource = read("../server/services/notification.service.ts");
const approvalServiceSource = read("../server/services/mediator-service-approval.service.ts");
const routeSource = read("../server/routes/mediator-profile.routes.ts");
const emailSource = read("../server/services/email.service.ts");
const detailSource = read("../client/src/pages/mediator-detail.tsx");

test("notification actions support mediator service proof deep links", () => {
  assert.match(notificationSource, /\(\?:cases\|enquiries\|mediators\)/);
  assert.match(notificationSource, /service_offering/);
  assert.match(notificationSource, /service-proof/);
  assert.match(notificationSource, /serviceTypeId/);
  assert.match(notificationSource, /Open service proof/);
});

test("service approval notifications include direct mediator proof URLs", () => {
  assert.match(approvalServiceSource, /buildServiceApprovalActionPath/);
  assert.match(approvalServiceSource, /Review it here: \$\{actionPath\}/);
  assert.match(approvalServiceSource, /Open it here: \$\{actionPath\}/);
  assert.match(approvalServiceSource, /createMediatorServiceApprovalDecisionNotification/);
  assert.match(approvalServiceSource, /service_approval_approved/);
  assert.match(approvalServiceSource, /service_approval_rejected/);
  assert.match(approvalServiceSource, /service_approval_revoked/);
});

test("live mediator approval review sends mediator email and returns email status", () => {
  assert.match(emailSource, /sendMediatorServiceApprovalDecisionEmail/);
  assert.match(routeSource, /sendMediatorServiceApprovalDecisionEmail/);
  assert.match(routeSource, /let emailSent = false/);
  assert.match(routeSource, /decisionPath/);
  assert.match(routeSource, /res\.json\(\{ row, emailSent \}\)/);
});

test("mediator detail consumes service proof query params and focuses the section", () => {
  assert.match(detailSource, /useLocation/);
  assert.match(detailSource, /URLSearchParams/);
  assert.match(detailSource, /focusSection/);
  assert.match(detailSource, /focusServiceTypeId/);
  assert.match(detailSource, /serviceProofSectionRef/);
  assert.match(detailSource, /serviceProofCardRefs/);
  assert.match(detailSource, /highlightedServiceTypeId/);
  assert.match(detailSource, /data-testid="section-service-proof-expiry"/);
});
