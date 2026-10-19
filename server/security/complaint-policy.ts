import type { CaseAccessTier } from "./case-access-policy";

export type ComplaintLookupMode = "case_id" | "case_ref";

export const COMPLAINT_STATUSES = [
  "received",
  "acknowledged",
  "under_review",
  "awaiting_information",
  "response_issued",
  "closed",
  "withdrawn",
  "duplicate",
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

const TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  received: ["acknowledged", "withdrawn", "duplicate"],
  acknowledged: ["under_review", "withdrawn", "duplicate"],
  under_review: ["awaiting_information", "response_issued", "withdrawn", "duplicate"],
  awaiting_information: ["under_review", "response_issued", "withdrawn", "duplicate"],
  response_issued: ["closed", "under_review"],
  closed: [],
  withdrawn: [],
  duplicate: [],
};

export function canSubmitCaseComplaint(
  role: string,
  accessTier: CaseAccessTier["tier"],
  lookupMode: ComplaintLookupMode,
): boolean {
  if (role === "superadmin" || role === "subadmin") return accessTier === "admin";
  if (role === "client") return lookupMode === "case_id" && accessTier === "client_party";
  if (role === "mediator") return lookupMode === "case_id" && accessTier === "full_mediator";
  if (role === "staff") return lookupMode === "case_ref";
  return false;
}

export function canViewFullComplaint(role: string): boolean {
  return role === "superadmin";
}

export function canTransitionComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

