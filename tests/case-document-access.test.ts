import { test } from "node:test";
import assert from "node:assert/strict";
import { canDownloadCaseDocument, caseDocumentDownloadHref, withProtectedCaseDocumentUrl } from "../server/security/document-access";

const sharedOwnDocument = { id: "doc-1", partyId: "party-a", sharedWithClients: true, reviewStatus: "reviewed" };

test("case document download authorization respects access tier and client sharing", () => {
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "admin" }), true);
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "full_mediator" }), true);
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "session_co_mediator" }), true);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, financialDisclosureFolderId: "folder-1" }, { tier: "session_co_mediator" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, financialDisclosureItemId: "item-1" }, { tier: "session_co_mediator" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, financialDisclosureEvidenceCategoryId: "category-1" }, { tier: "session_co_mediator" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, financialDisclosureUploadTarget: "form_e" }, { tier: "session_co_mediator" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, documentRequestId: "request-1" }, { tier: "session_co_mediator" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, documentCategory: "requested_evidence" }, { tier: "session_co_mediator" }), false);
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "client_party", partyId: "party-a" }), true);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, partyId: null }, { tier: "client_party", partyId: "party-a" }), true);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, partyId: "party-b" }, { tier: "client_party", partyId: "party-a" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, sharedWithClients: false }, { tier: "client_party", partyId: "party-a" }), false);
  assert.equal(canDownloadCaseDocument({ ...sharedOwnDocument, reviewStatus: "pending" }, { tier: "client_party", partyId: "party-a" }), false);
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "miam_only_mediator" }), false);
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "session_observer" }), false);
  assert.equal(canDownloadCaseDocument(sharedOwnDocument, { tier: "none" }), false);
});

test("case document links use the authenticated document-ID endpoint", () => {
  assert.equal(caseDocumentDownloadHref("doc id/1"), "/api/case-documents/doc%20id%2F1/download");
});

test("protected document payloads do not expose storage keys", () => {
  const view = withProtectedCaseDocumentUrl({
    id: "document-id",
    fileUrl: "/uploads/case-documents/legacy.pdf",
    storageKey: "case-documents/private-key.pdf",
    title: "Shared document",
  });

  assert.equal(view.fileUrl, "/api/case-documents/document-id/download");
  assert.equal("storageKey" in view, false);
});
