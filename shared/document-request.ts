export const DOCUMENT_REQUEST_CATALOGUE = [
  { id: "identification_document", label: "Identification document" },
  { id: "bank_statement", label: "Bank statement" },
  { id: "payslip", label: "Payslip" },
  { id: "pension_statement", label: "Pension statement" },
  { id: "property_valuation", label: "Property valuation" },
  { id: "court_order", label: "Court order" },
  { id: "other", label: "Other document" },
] as const;

export type DocumentRequestType = typeof DOCUMENT_REQUEST_CATALOGUE[number]["id"];
export const DOCUMENT_REQUEST_TYPES = DOCUMENT_REQUEST_CATALOGUE.map((item) => item.id) as [DocumentRequestType, ...DocumentRequestType[]];

export const DOCUMENT_REQUEST_STATUSES = ["outstanding", "submitted", "completed", "cancelled"] as const;
export type DocumentRequestStatus = typeof DOCUMENT_REQUEST_STATUSES[number];

export const DOCUMENT_REQUEST_DELIVERY_STATUSES = ["not_attempted", "sent", "failed"] as const;
export type DocumentRequestDeliveryStatus = typeof DOCUMENT_REQUEST_DELIVERY_STATUSES[number];

export const MAX_DOCUMENT_REQUEST_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_UPLOADS: Record<string, readonly string[]> = {
  ".pdf": ["application/pdf"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".csv": ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"],
};

export function isDocumentRequestType(value: string): value is DocumentRequestType {
  return DOCUMENT_REQUEST_CATALOGUE.some((item) => item.id === value);
}

export function resolveDocumentRequestName(type: DocumentRequestType, customDocumentName?: string | null): string {
  if (type === "other") {
    const customName = customDocumentName?.trim();
    if (!customName) throw new Error("Custom document name is required for Other document");
    return customName;
  }
  const item = DOCUMENT_REQUEST_CATALOGUE.find((candidate) => candidate.id === type);
  if (!item) throw new Error("Invalid requested document type");
  return item.label;
}

export type DocumentRequestUploadValidation =
  | { ok: true }
  | { ok: false; status: 413 | 415; error: string };

export function validateDocumentRequestUpload(input: {
  fileName: string;
  mimeType?: string | null;
  sizeBytes: number;
}): DocumentRequestUploadValidation {
  if (input.sizeBytes > MAX_DOCUMENT_REQUEST_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: "Requested document uploads must be 25MB or smaller" };
  }
  const extension = input.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
  const allowedMimeTypes = ALLOWED_UPLOADS[extension];
  const mimeType = (input.mimeType || "").toLowerCase();
  const browserDidNotIdentifyType = mimeType === "" || mimeType === "application/octet-stream";
  if (!allowedMimeTypes || (!browserDidNotIdentifyType && !allowedMimeTypes.includes(mimeType))) {
    return { ok: false, status: 415, error: "Requested document uploads must be PDF, JPEG/PNG, Word, Excel, or CSV files" };
  }
  return { ok: true };
}
