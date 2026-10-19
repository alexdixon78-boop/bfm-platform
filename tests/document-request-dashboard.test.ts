import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboardService = readFileSync(new URL("../server/services/dashboard.service.ts", import.meta.url), "utf8");
const notificationService = readFileSync(new URL("../server/services/notification.service.ts", import.meta.url), "utf8");

test("client dashboard derives one exact upload action for every outstanding own-party request", () => {
  assert.match(dashboardService, /caseDocumentRequests/);
  assert.match(dashboardService, /eq\(caseDocumentRequests\.status, "outstanding"\)/);
  assert.match(dashboardService, /inArray\(caseDocumentRequests\.partyId, partyIds\)/);
  assert.match(dashboardService, /id: `document-request:\$\{request\.id\}`/);
  assert.match(dashboardService, /kind: "document"/);
  assert.match(dashboardService, /documentRequestId=\$\{encodeURIComponent\(request\.id\)\}/);
});

test("document request bell notifications open the exact request upload", () => {
  assert.match(notificationService, /notification\.documentRequestId && notification\.caseId/);
  assert.match(notificationService, /documentRequestId=\$\{encodeURIComponent\(notification\.documentRequestId\)\}/);
  assert.match(notificationService, /actionLabel: "Upload document"/);
});
