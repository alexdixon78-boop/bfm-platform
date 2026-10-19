/**
 * Regression test for service-proof rejection notifications.
 *
 * Run with: npx tsx tests/mediator-service-rejection-notification.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(new URL("../server/routes/mediator-applicant.routes.ts", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../client/src/components/mediator-pipeline/applicant-application-dialog.tsx", import.meta.url), "utf8");

test("rejection resend logs the update link in uppercase and writes an audit entry", () => {
  assert.match(routeSource, /\[APPLICANT UPDATE LINK\] SENDING UPDATED LINK TO MEDIATOR/);
  assert.match(routeSource, /\[APPLICANT UPDATE LINK\] EMAIL SENT TO MEDIATOR/);
  assert.match(routeSource, /service_proof_rejection_notification_sent/);
  assert.match(routeSource, /notificationSentToMediator = result\.emailSent/);
});

test("admin rejection toast tells staff whether the mediator was notified", () => {
  assert.match(drawerSource, /Notification sent to mediator\./);
  assert.match(drawerSource, /Notification could not be sent to mediator\./);
  assert.match(drawerSource, /notificationSentToMediator/);
});
