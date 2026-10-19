import type { Case, CaseCimConsent, MiamRecord, Party } from "@shared/schema";

export type CimEligibilityBlockerReason =
  | "missing_parent"
  | "missing_miam"
  | "miam_not_approved"
  | "safeguarding_not_clear"
  | "consent_not_granted";

export type CimEligibilityBlocker = {
  reason: CimEligibilityBlockerReason;
  label: string;
  partyId?: string;
  role?: string;
  formType?: "cf10" | "cf12";
};

export type CimEligibilityReadiness = {
  ready: boolean;
  blockers: CimEligibilityBlocker[];
};

export function requiredFormTypeForParty(role: string): "cf10" | "cf12" | null {
  const normalized = role.toUpperCase();
  if (normalized === "A") return "cf10";
  if (normalized === "B") return "cf12";
  return null;
}

export function computeCimEligibilityReadiness(input: {
  caseRecord: Pick<Case, "safeguardingStatus">;
  parties: Pick<Party, "id" | "role">[];
  miamRecords: Pick<MiamRecord, "partyId" | "approvalStatus">[];
  consents: Pick<CaseCimConsent, "partyId" | "formType" | "status">[];
}): CimEligibilityReadiness {
  const blockers: CimEligibilityBlocker[] = [];
  const parentRoles = ["A", "B"] as const;

  if (input.caseRecord.safeguardingStatus !== "clear") {
    blockers.push({
      reason: "safeguarding_not_clear",
      label: "Safeguarding screening must be complete and clear",
    });
  }

  for (const role of parentRoles) {
    const party = input.parties.find((p) => p.role.toUpperCase() === role);
    const formType = requiredFormTypeForParty(role)!;
    if (!party) {
      blockers.push({
        reason: "missing_parent",
        role,
        formType,
        label: `Client ${role} must be added before CIM can be offered`,
      });
      continue;
    }

    const miamRecord = input.miamRecords.find((record) => record.partyId === party.id);
    if (!miamRecord) {
      blockers.push({
        reason: "missing_miam",
        partyId: party.id,
        role,
        label: `Client ${role} MIAM must be complete`,
      });
    } else if (miamRecord.approvalStatus !== "approved") {
      blockers.push({
        reason: "miam_not_approved",
        partyId: party.id,
        role,
        label: `Client ${role} MIAM must be approved`,
      });
    }

    const consent = input.consents.find((row) => row.partyId === party.id && row.formType === formType);
    if (consent?.status !== "granted") {
      blockers.push({
        reason: "consent_not_granted",
        partyId: party.id,
        role,
        formType,
        label: `${formType.toUpperCase()} consent must be granted for Client ${role}`,
      });
    }
  }

  return { ready: blockers.length === 0, blockers };
}
