import { test } from "node:test";
import assert from "node:assert/strict";
import * as documentRequestPolicy from "../shared/document-request";
import * as courtFormCatalog from "../shared/court-form-catalog";
import { canDownloadCaseDocument } from "../server/security/document-access";
import * as schema from "../shared/schema";
import { getTableColumns } from "drizzle-orm";

test("document request catalogue resolves fixed labels and requires a custom Other label", () => {
  assert.deepEqual(documentRequestPolicy.DOCUMENT_REQUEST_CATALOGUE, [
    { id: "identification_document", label: "Identification document" },
    { id: "bank_statement", label: "Bank statement" },
    { id: "payslip", label: "Payslip" },
    { id: "pension_statement", label: "Pension statement" },
    { id: "property_valuation", label: "Property valuation" },
    { id: "court_order", label: "Court order" },
    { id: "other", label: "Other document" },
  ]);
  assert.equal(documentRequestPolicy.resolveDocumentRequestName("bank_statement"), "Bank statement");
  assert.equal(documentRequestPolicy.resolveDocumentRequestName("other", "  School report  "), "School report");
  assert.throws(() => documentRequestPolicy.resolveDocumentRequestName("other", "  "), /Custom document name is required/);
});

test("requested document uploads accept common documents up to 25 MB", () => {
  const allowed = [
    ["proof.pdf", "application/pdf"],
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
    ["letter.doc", "application/msword"],
    ["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["figures.xls", "application/vnd.ms-excel"],
    ["figures.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["figures.csv", "text/csv"],
  ] as const;
  for (const [fileName, mimeType] of allowed) {
    assert.deepEqual(documentRequestPolicy.validateDocumentRequestUpload({ fileName, mimeType, sizeBytes: 1024 }), { ok: true });
  }
  assert.deepEqual(documentRequestPolicy.validateDocumentRequestUpload({ fileName: "figures.xlsx", mimeType: "application/octet-stream", sizeBytes: 1024 }), { ok: true });
  assert.deepEqual(documentRequestPolicy.validateDocumentRequestUpload({ fileName: "figures.csv", mimeType: "text/plain", sizeBytes: 1024 }), { ok: true });
  assert.deepEqual(documentRequestPolicy.validateDocumentRequestUpload({ fileName: "archive.zip", mimeType: "application/zip", sizeBytes: 1024 }), {
    ok: false,
    status: 415,
    error: "Requested document uploads must be PDF, JPEG/PNG, Word, Excel, or CSV files",
  });
  assert.deepEqual(documentRequestPolicy.validateDocumentRequestUpload({ fileName: "proof.pdf", mimeType: "application/pdf", sizeBytes: 25 * 1024 * 1024 + 1 }), {
    ok: false,
    status: 413,
    error: "Requested document uploads must be 25MB or smaller",
  });
});

test("case form catalogue shares categories while excluding specialist financial documents from case forms", () => {
  assert.deepEqual(courtFormCatalog.CASE_FORM_CATEGORIES.map((category) => category.id), ["court", "mediation"]);
  assert.equal(courtFormCatalog.formCategoryForType("C100"), "court");
  assert.equal(courtFormCatalog.formCategoryForType("AgreementToMediate"), "mediation");
  assert.equal(courtFormCatalog.CASE_FORM_TYPES.includes("DraftFinancialSchedule"), false);
  assert.equal(courtFormCatalog.CASE_FORM_TYPES.includes("FinancialDisclosureBooklet"), false);
});

test("a client can download only their own requested-document submission", () => {
  const submission = {
    id: "doc-1",
    partyId: "party-a",
    documentRequestId: "request-1",
    sharedWithClients: false,
    reviewStatus: "draft",
  };
  assert.equal(canDownloadCaseDocument(submission, { tier: "client_party", partyId: "party-a" }), true);
  assert.equal(canDownloadCaseDocument(submission, { tier: "client_party", partyId: "party-b" }), false);
  assert.equal(canDownloadCaseDocument({ ...submission, documentRequestId: null }, { tier: "client_party", partyId: "party-a" }), false);
});

test("document requests persist lifecycle, delivery, and submission linkage", () => {
  const requestTable = (schema as typeof schema & { caseDocumentRequests?: unknown }).caseDocumentRequests;
  assert.ok(requestTable, "caseDocumentRequests table must exist");
  const requestColumns = getTableColumns(requestTable as Parameters<typeof getTableColumns>[0]);
  for (const name of [
    "caseId", "partyId", "requestedBy", "documentType", "documentName", "instructions", "status",
    "deliveryStatus", "deliveryLastAttemptedAt", "deliveryError", "submittedAt", "completedAt",
    "completedBy", "returnedAt", "returnedBy", "returnReason", "cancelledAt", "cancelledBy",
  ]) assert.ok(name in requestColumns, `missing request column ${name}`);

  const documentColumns = getTableColumns(schema.caseDocuments);
  assert.ok("documentRequestId" in documentColumns);
  const notificationColumns = getTableColumns(schema.notifications);
  assert.ok("documentRequestId" in notificationColumns);
});
