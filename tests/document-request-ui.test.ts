import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const componentPath = new URL("../client/src/components/case-progress/case-document-requests-section.tsx", import.meta.url);
const component = existsSync(componentPath) ? readFileSync(componentPath, "utf8") : "";
const caseDetail = readFileSync(new URL("../client/src/pages/case-detail.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const sessionService = readFileSync(new URL("../server/services/mediation-session.service.ts", import.meta.url), "utf8");

test("case Documents tab renders a dedicated request card for exact managers and clients", () => {
  assert.match(component, /Document Requests/);
  assert.match(component, /DOCUMENT_REQUEST_CATALOGUE\.map/);
  assert.match(component, /documentType === "other"/);
  assert.match(component, /Every selected client receives an independent request/);
  assert.match(caseDetail, /<CaseDocumentRequestsSection/);
  assert.match(caseDetail, /canManage=\{canManageDocumentRequests\}/);
  assert.match(caseDetail, /canView=\{canManageDocumentRequests \|\| isClient\}/);
});

test("client requests upload one file and support exact-request highlighting", () => {
  assert.match(component, /\/api\/document-requests\/\$\{requestId\}\/submit/);
  assert.match(component, /accept="\.pdf,\.jpg,\.jpeg,\.png,\.doc,\.docx,\.xls,\.xlsx,\.csv"/);
  assert.match(component, /25MB or smaller/);
  assert.match(component, /documentRequestId/);
  assert.match(component, /scrollIntoView/);
  assert.match(component, /Previous submissions/);
});

test("staff request rows expose resend, return, complete, and cancel actions", () => {
  assert.match(component, /`\/api\/document-requests\/\$\{requestId\}\/\$\{action\}`/);
  for (const action of ["resend", "return", "complete", "cancel"]) {
    assert.match(component, new RegExp(`action: "${action}"`));
  }
  assert.match(component, /A return reason is required/);
});

test("document-request deep links survive authentication and stay out of the generic document workflow", () => {
  assert.match(app, /returnTo/);
  assert.match(app, /encodeURIComponent\(location\)/);
  assert.match(app, /safeLoginReturnPath/);
  assert.match(caseDetail, /document\.documentRequestId/);
  assert.match(sessionService, /document\.documentRequestId[\s\S]*requested_evidence/);
  assert.match(sessionService, /Requested evidence is managed through its document request/);
});
