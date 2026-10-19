import type { DemographicData } from "@shared/schema";

export const REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS = [
  "genderIdentity",
  "ethnicity",
  "firstLanguage",
  "interpreterNeeded",
  "employmentStatus",
  "legalAidEligible",
  "voucherSchemeEligible",
  "courtProceedingsStatus",
  "cafcassInvolved",
  "lifeSatisfaction",
  "anxietyScore",
  "emotionalWellbeing",
] as const satisfies readonly (keyof DemographicData)[];

function isMissingRequiredValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));
}

export function getMissingClientDemographicFields(data: Partial<DemographicData> | null | undefined): string[] {
  if (!data?.completedAt) return [...REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS];
  return REQUIRED_CLIENT_DEMOGRAPHIC_FIELDS.filter((field) => isMissingRequiredValue(data[field]));
}

export function isClientDemographicComplete(data: Partial<DemographicData> | null | undefined): boolean {
  return getMissingClientDemographicFields(data).length === 0;
}
