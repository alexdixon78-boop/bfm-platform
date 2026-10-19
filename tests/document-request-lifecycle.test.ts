import { test } from "node:test";
import assert from "node:assert/strict";

async function loadService() {
  return import("../server/services/document-request.service").catch(() => null);
}

test("only admins and the exact case lead can manage document requests", async () => {
  const service = await loadService();
  assert.ok(service, "document request service must exist");
  const caseRecord = { mediatorId: "lead-1" };
  assert.equal(service.canManageDocumentRequests(caseRecord, { id: "admin-1", role: "superadmin" }), true);
  assert.equal(service.canManageDocumentRequests(caseRecord, { id: "admin-2", role: "subadmin" }), true);
  assert.equal(service.canManageDocumentRequests(caseRecord, { id: "lead-1", role: "mediator" }), true);
  assert.equal(service.canManageDocumentRequests(caseRecord, { id: "allocated-1", role: "mediator" }), false);
  assert.equal(service.canManageDocumentRequests(caseRecord, { id: "staff-1", role: "staff" }), false);
  assert.equal(service.canManageDocumentRequests(caseRecord, { id: "client-1", role: "client" }), false);
});

test("document request lifecycle permits only the approved state changes", async () => {
  const service = await loadService();
  assert.ok(service, "document request service must exist");
  assert.equal(service.canApplyDocumentRequestAction("outstanding", "submit"), true);
  assert.equal(service.canApplyDocumentRequestAction("submitted", "submit"), false);
  assert.equal(service.canApplyDocumentRequestAction("submitted", "return"), true);
  assert.equal(service.canApplyDocumentRequestAction("outstanding", "return"), false);
  assert.equal(service.canApplyDocumentRequestAction("submitted", "complete"), true);
  assert.equal(service.canApplyDocumentRequestAction("completed", "return"), false);
  assert.equal(service.canApplyDocumentRequestAction("outstanding", "cancel"), true);
  assert.equal(service.canApplyDocumentRequestAction("submitted", "cancel"), true);
  assert.equal(service.canApplyDocumentRequestAction("completed", "cancel"), false);
  assert.equal(service.canApplyDocumentRequestAction("cancelled", "submit"), false);
});

test("document request links target and identify the exact request", async () => {
  const service = await loadService();
  assert.ok(service, "document request service must exist");
  assert.equal(
    service.documentRequestHref("case id", "request/id"),
    "/cases/case%20id?tab=documents&documentRequestId=request%2Fid",
  );
});
