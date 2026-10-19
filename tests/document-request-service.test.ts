import { test } from "node:test";
import assert from "node:assert/strict";
import { DocumentRequestService, type DocumentRequestServiceDependencies } from "../server/services/document-request.service";

function buildHarness(options: { failedEmail?: string; thrownEmail?: string; linkedSecondParty?: boolean; deferredSave?: boolean } = {}) {
  const caseRecord = { id: "case-1", caseRef: "BFM-1", mediatorId: "lead-1" };
  const parties = [
    { id: "party-1", caseId: "case-1", userId: "client-user-1", email: "one@example.com", firstName: "One", lastName: "Client" },
    { id: "party-2", caseId: "case-1", userId: options.linkedSecondParty === false ? null : "client-user-2", email: "two@example.com", firstName: "Two", lastName: "Client" },
  ];
  const requests: any[] = [];
  const documents: any[] = [];
  const notifications: any[] = [];
  const lifecycleEvents: any[] = [];
  let idSequence = 0;
  let releaseSave: (() => void) | undefined;
  let signalSaveStarted: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve; });
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });

  const dependencies: DocumentRequestServiceDependencies = {
    async getCase(id) { return id === caseRecord.id ? caseRecord as any : undefined; },
    async listPartiesByCase() { return parties as any; },
    async listPartiesByUserId(userId) { return parties.filter((party) => party.userId === userId) as any; },
    async createRequest(data, event) {
      const row = { id: `request-${++idSequence}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      requests.push(row);
      if (event) lifecycleEvents.push(event);
      return row as any;
    },
    async getRequest(id) { return requests.find((request) => request.id === id); },
    async listRequestsByCase(caseId) { return requests.filter((request) => request.caseId === caseId); },
    async listRequestsByPartyIds(partyIds) { return requests.filter((request) => partyIds.includes(request.partyId)); },
    async updateRequest(id, updates, event) {
      const row = requests.find((request) => request.id === id);
      if (!row) return undefined;
      Object.assign(row, updates, { updatedAt: new Date() });
      if (event) lifecycleEvents.push(event);
      return row;
    },
    async transitionRequest(id, expectedStatuses, updates, event) {
      const row = requests.find((request) => request.id === id && expectedStatuses.includes(request.status));
      if (!row) return undefined;
      Object.assign(row, updates, { updatedAt: new Date() });
      if (event) lifecycleEvents.push(event);
      return row;
    },
    async listDocumentsByRequestId(requestId) { return documents.filter((document) => document.documentRequestId === requestId); },
    async commitSubmission(id, updates, data, event) {
      const request = requests.find((candidate) => candidate.id === id && candidate.status === "outstanding");
      if (!request) return undefined;
      Object.assign(request, updates, { updatedAt: new Date() });
      const document = { id: `document-${documents.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      documents.push(document);
      lifecycleEvents.push(event);
      return { request, document } as any;
    },
    async saveFile(input) {
      signalSaveStarted?.();
      if (options.deferredSave) await saveGate;
      return { fileUrl: `/private/${input.fileName}`, storageKey: `case-documents/${input.fileName}` };
    },
    async deleteFile() {},
    async sendRequestEmail(input) {
      if (input.to === options.thrownEmail) throw new Error("provider unavailable");
      return input.to !== options.failedEmail;
    },
    async createNotification(input) { notifications.push(input); },
    async setNotificationCompleted() {},
    async setNotificationOutstanding() {},
  };

  return { service: new DocumentRequestService(dependencies), caseRecord, parties, requests, documents, notifications, lifecycleEvents, saveStarted, releaseSave: () => releaseSave?.() };
}

test("creating for multiple clients keeps independent requests when one email fails", async () => {
  const harness = buildHarness({ failedEmail: "two@example.com" });
  const result = await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1", "party-2"],
    documentType: "bank_statement",
    instructions: "Most recent statement",
  });

  assert.equal(result.ok, true);
  assert.equal(harness.requests.length, 2);
  assert.deepEqual(harness.requests.map((request) => request.documentName), ["Bank statement", "Bank statement"]);
  assert.deepEqual(harness.requests.map((request) => request.deliveryStatus), ["sent", "failed"]);
  assert.equal(harness.notifications.length, 2);
  assert.match(harness.notifications[0].message, /documentRequestId=request-1/);
  assert.equal(harness.lifecycleEvents.filter((event) => event.audit.action === "create_document_request").length, 2);
});

test("creation rejects an unlinked party before writing any requests", async () => {
  const harness = buildHarness({ linkedSecondParty: false });
  const result = await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1", "party-2"],
    documentType: "court_order",
  });

  assert.deepEqual(result, { ok: false, status: 400, error: "Every selected client must have a linked portal account and email address" });
  assert.equal(harness.requests.length, 0);
});

test("an email-provider error leaves the request available for staff resend", async () => {
  const harness = buildHarness({ thrownEmail: "one@example.com" });
  const result = await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1"],
    documentType: "pension_statement",
  });

  assert.equal(result.ok, true);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].deliveryStatus, "failed");
  assert.equal(harness.requests[0].deliveryError, "Email send failed");
});

test("the owning client submits one private document and cannot replace it while submitted", async () => {
  const harness = buildHarness();
  await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1"],
    documentType: "identification_document",
  });
  const request = harness.requests[0];

  const first = await harness.service.submitRequest(request.id, { id: "client-user-1", role: "client", name: "One" }, {
    fileName: "passport.pdf",
    mimeType: "application/pdf",
    fileData: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nproof").toString("base64")}`,
    fileSizeBytes: 14,
  });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error(first.error);
  assert.equal(request.status, "submitted");
  assert.equal(harness.documents.length, 1);
  assert.equal(harness.documents[0].partyId, "party-1");
  assert.equal(harness.documents[0].documentRequestId, request.id);
  assert.equal(harness.documents[0].sharedWithClients, false);
  assert.equal("storageKey" in first.request.submissions[0], false);
  assert.equal("uploadedBy" in first.request.submissions[0], false);
  assert.equal("partyId" in first.request.submissions[0], false);
  assert.equal(first.request.submissions[0].fileUrl, "/api/case-documents/document-1/download");
  assert.equal("storageKey" in first.document, false);
  assert.equal("uploadedBy" in first.document, false);
  assert.equal("partyId" in first.document, false);
  assert.equal(first.document.fileUrl, "/api/case-documents/document-1/download");
  assert.ok(harness.lifecycleEvents.some((event) => event.audit.action === "submit_document_request"));
  assert.ok(harness.lifecycleEvents.some((event) => event.activity.type === "document_request_submitted"));
  assert.equal("deliveryStatus" in first.request, false);
  assert.equal("deliveryError" in first.request, false);
  assert.equal("requestedBy" in first.request, false);

  const clientList = await harness.service.listCaseRequests("case-1", { id: "client-user-1", role: "client" });
  assert.equal(clientList.ok, true);
  if (!clientList.ok) throw new Error(clientList.error);
  assert.equal(clientList.requests.length, 1);
  assert.equal("returnedBy" in clientList.requests[0], false);
  assert.equal("completedBy" in clientList.requests[0], false);

  const replacement = await harness.service.submitRequest(request.id, { id: "client-user-1", role: "client", name: "One" }, {
    fileName: "passport.pdf",
    mimeType: "application/pdf",
    fileData: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nreplacement").toString("base64")}`,
    fileSizeBytes: 20,
  });
  assert.deepEqual(replacement, { ok: false, status: 409, error: "This document request is not awaiting an upload" });
  assert.equal(harness.documents.length, 1);
});

test("concurrent client submissions atomically claim one outstanding attempt", async () => {
  const harness = buildHarness();
  await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1"],
    documentType: "bank_statement",
  });
  const request = harness.requests[0];
  const upload = {
    fileName: "statement.pdf",
    mimeType: "application/pdf",
    fileData: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nstatement").toString("base64")}`,
    fileSizeBytes: 18,
  };

  const results = await Promise.all([
    harness.service.submitRequest(request.id, { id: "client-user-1", role: "client" }, upload),
    harness.service.submitRequest(request.id, { id: "client-user-1", role: "client" }, upload),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.status === 409).length, 1);
  assert.equal(harness.documents.length, 1);
});

test("a request stays outstanding until its uploaded file and submission row commit together", async () => {
  const harness = buildHarness({ deferredSave: true });
  await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1"],
    documentType: "bank_statement",
  });
  const request = harness.requests[0];
  const submission = harness.service.submitRequest(request.id, { id: "client-user-1", role: "client" }, {
    fileName: "statement.pdf",
    mimeType: "application/pdf",
    fileData: `data:application/pdf;base64,${Buffer.from("%PDF-1.4\nstatement").toString("base64")}`,
  });

  await harness.saveStarted;
  assert.equal(request.status, "outstanding");
  const prematureReturn = await harness.service.returnRequest(request.id, { id: "lead-1", role: "mediator" }, "Try again");
  assert.deepEqual(prematureReturn, { ok: false, status: 409, error: "Only a submitted document request can be returned" });
  harness.releaseSave();
  assert.equal((await submission).ok, true);
  assert.equal(request.status, "submitted");
  assert.equal(harness.documents.length, 1);
});

test("returning requires a reason and reopens the same request for another attempt", async () => {
  const harness = buildHarness();
  await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1"],
    documentType: "payslip",
  });
  const request = harness.requests[0];
  request.status = "submitted";

  const missingReason = await harness.service.returnRequest(request.id, { id: "lead-1", role: "mediator", name: "Lead" }, "  ");
  assert.deepEqual(missingReason, { ok: false, status: 400, error: "A return reason is required" });

  const returned = await harness.service.returnRequest(request.id, { id: "lead-1", role: "mediator", name: "Lead" }, "Please include every page");
  assert.equal(returned.ok, true);
  assert.equal(request.status, "outstanding");
  assert.equal(request.returnReason, "Please include every page");
});

test("staff can complete submitted requests, cancel open requests, and resend failed email", async () => {
  const harness = buildHarness({ failedEmail: "two@example.com" });
  await harness.service.createRequests("case-1", { id: "lead-1", role: "mediator", name: "Lead" }, {
    partyIds: ["party-1", "party-2"],
    documentType: "property_valuation",
  });
  const submitted = harness.requests[0];
  submitted.status = "submitted";
  const completed = await harness.service.completeRequest(submitted.id, { id: "lead-1", role: "mediator", name: "Lead" });
  assert.equal(completed.ok, true);
  assert.equal(submitted.status, "completed");
  assert.equal(submitted.completedBy, "lead-1");

  const failedDelivery = harness.requests[1];
  assert.equal(failedDelivery.deliveryStatus, "failed");
  const resent = await harness.service.resendRequest(failedDelivery.id, { id: "admin-1", role: "superadmin", name: "Admin" });
  assert.equal(resent.ok, true);
  assert.equal(failedDelivery.deliveryStatus, "failed");
  assert.ok(harness.lifecycleEvents.some((event) => event.audit.action === "resend_document_request"));

  const cancelled = await harness.service.cancelRequest(failedDelivery.id, { id: "lead-1", role: "mediator", name: "Lead" });
  assert.equal(cancelled.ok, true);
  assert.equal(failedDelivery.status, "cancelled");
  assert.equal(failedDelivery.cancelledBy, "lead-1");
});
