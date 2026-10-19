export type ContractorApplicantStage =
  | "prospect"
  | "screening"
  | "contract_sent"
  | "active"
  | "off_boarded";

export type ContractorPipelineCard = {
  kind: "applicant" | "contractor";
  id: string;
  stage: ContractorApplicantStage;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  contractorType: string | null;
  source: string | null;
  notes: string | null;
  rejectedReason?: string | null;
  convertedUserId?: string | null;
  updatedAt: string | null;
};

export type ContractorPipelineResponse = {
  columns: Record<ContractorApplicantStage, ContractorPipelineCard[]>;
  rejectedCount: number;
  rejected: ContractorPipelineCard[];
};

export const STAGE_ORDER: ContractorApplicantStage[] = [
  "prospect",
  "screening",
  "contract_sent",
  "active",
  "off_boarded",
];

export const STAGE_LABEL: Record<ContractorApplicantStage, string> = {
  prospect: "Applications",
  screening: "Screening",
  contract_sent: "Contract Sent",
  active: "Active",
  off_boarded: "Off-boarded",
};

export const STAGE_DESCRIPTION: Record<ContractorApplicantStage, string> = {
  prospect: "Inbound contractor applications awaiting review.",
  screening: "Under review — assessing fit and requirements.",
  contract_sent: "Contract issued, awaiting signature.",
  active: "Active contractor with a system account.",
  off_boarded: "No longer engaged with BFM.",
};
