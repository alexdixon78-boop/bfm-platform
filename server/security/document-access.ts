import { hasFullOperationalCaseAccess, type CaseAccessTier } from "./case-access-policy";

export function caseDocumentDownloadHref(documentId: string): string {
  return `/api/case-documents/${encodeURIComponent(documentId)}/download`;
}

export function withProtectedCaseDocumentUrl<T extends { id: string; fileUrl?: string | null; storageKey?: string | null }>(
  document: T,
): T {
  const { storageKey: _storageKey, ...safeDocument } = document;
  return { ...safeDocument, fileUrl: caseDocumentDownloadHref(document.id) } as T;
}

export function canDownloadCaseDocument(
  document: {
    partyId?: string | null;
    sharedWithClients?: boolean | null;
    reviewStatus?: string | null;
    financialDisclosureFolderId?: string | null;
    financialDisclosureItemId?: string | null;
    financialDisclosureEvidenceCategoryId?: string | null;
    financialDisclosureUploadTarget?: string | null;
    documentCategory?: string | null;
    documentRequestId?: string | null;
  },
  access: CaseAccessTier,
): boolean {
  if (hasFullOperationalCaseAccess(access)) return true;
  if (access.tier === "session_co_mediator") return isOrdinaryCaseDocument(document);
  if (access.tier !== "client_party") return false;
  if (document.documentRequestId) return document.partyId === access.partyId;
  return document.sharedWithClients === true
    && document.reviewStatus === "reviewed"
    && (document.partyId == null || document.partyId === access.partyId);
}

export function isOrdinaryCaseDocument(document: {
  financialDisclosureFolderId?: string | null;
  financialDisclosureItemId?: string | null;
  financialDisclosureEvidenceCategoryId?: string | null;
  financialDisclosureUploadTarget?: string | null;
  documentCategory?: string | null;
  documentRequestId?: string | null;
}): boolean {
  return document.documentCategory !== "email_attachment"
    && document.documentCategory !== "requested_evidence"
    && !document.documentRequestId
    && !document.financialDisclosureFolderId
    && !document.financialDisclosureItemId
    && !document.financialDisclosureEvidenceCategoryId
    && !document.financialDisclosureUploadTarget;
}
