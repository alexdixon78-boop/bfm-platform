export type InboundActiveParty = { caseId: string; partyId: string; noWhatsapp: boolean };
export type InboundCaseContextSelection = {
  clientId: string;
  caseId: string | null;
  partyId: string | null;
  shouldRecordOptIn: boolean;
  caseAssignmentSource: string | null;
};

export function selectInboundCaseContext(input: {
  clientId: string;
  activeParties: InboundActiveParty[];
  recentCaseIds: string[];
}): InboundCaseContextSelection {
  const unassigned = {
    clientId: input.clientId,
    caseId: null,
    partyId: null,
    shouldRecordOptIn: false,
    caseAssignmentSource: input.activeParties.length > 1 ? "multiple_active_cases_unassigned" : null,
  };
  if (input.activeParties.length === 0) return unassigned;

  let selected: InboundActiveParty | undefined;
  let source: string | null = null;
  if (input.activeParties.length === 1) {
    selected = input.activeParties[0];
    source = "single_active_case";
  } else {
    const activeCaseIds = new Set(input.activeParties.map((party) => party.caseId));
    const recentActiveCaseIds = Array.from(new Set(input.recentCaseIds.filter((caseId) => activeCaseIds.has(caseId))));
    if (recentActiveCaseIds.length === 1) {
      selected = input.activeParties.find((party) => party.caseId === recentActiveCaseIds[0]);
      source = "recent_context";
    }
  }

  if (!selected) return unassigned;
  return {
    clientId: input.clientId,
    caseId: selected.caseId,
    partyId: selected.partyId,
    shouldRecordOptIn: !selected.noWhatsapp,
    caseAssignmentSource: source,
  };
}
