export type CredentialStatus = "verified" | "pending" | "failed" | "none";
export type InsuranceStatus = "valid" | "expiring" | "expired" | "none";

export type MediatorLifecycleStage =
  | "recruitment_approach"
  | "interview"
  | "reference_credential_check"
  | "contract_issued"
  | "onboarding_portal_access"
  | "active_on_panel"
  | "annual_review"
  | "off_boarded";

export type PipelineCard = {
  kind: "applicant" | "mediator";
  id: string;
  stage: MediatorLifecycleStage;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  accreditationStatus: string | null;
  areaOfPractice: string[];
  credentialStatus: CredentialStatus;
  insuranceStatus: InsuranceStatus;
  convertedUserId?: string | null;
  panelStatus?: string | null;
  reviewDueSoon?: boolean;
  contractReady?: boolean;
  updatedAt: string | null;
};

export type PipelineResponse = {
  columns: Record<MediatorLifecycleStage, PipelineCard[]>;
  rejectedCount: number;
  rejected: PipelineCard[];
};

export const STAGE_ORDER: MediatorLifecycleStage[] = [
  "recruitment_approach",
  "interview",
  "reference_credential_check",
  "contract_issued",
  "onboarding_portal_access",
  "active_on_panel",
  "annual_review",
  "off_boarded",
];

export const STAGE_LABEL: Record<MediatorLifecycleStage, string> = {
  recruitment_approach: "Applications",
  interview: "Interview",
  reference_credential_check: "Reference & Credential Check",
  contract_issued: "Contract Issued",
  onboarding_portal_access: "Onboarding Portal Access",
  active_on_panel: "Active on Panel",
  annual_review: "Annual Review",
  off_boarded: "Off-boarded",
};

export const STAGE_DESCRIPTION: Record<MediatorLifecycleStage, string> = {
  recruitment_approach: "Self-serve applications and initial outreach.",
  interview: "Shortlisted applicants undergoing interview before compliance checks.",
  reference_credential_check: "FMC / CMC verification, PI, DBS, references.",
  contract_issued: "Contract sent / signed, ICO + time-banking agreed.",
  onboarding_portal_access: "Invite sent — profile / bio not yet complete.",
  active_on_panel: "Live mediators taking cases.",
  annual_review: "Renewals and re-checks in flight.",
  off_boarded: "No longer active on the panel.",
};
