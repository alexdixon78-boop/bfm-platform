type CaseLike = Record<string, any>;
type PartyLike = Record<string, any>;

export type ClientPartyView = {
  id: string;
  caseId: string;
  clientId: string;
  role: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneCode: string | null;
  dateOfBirth: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  gender: string | null;
  ethnicOrigin: string | null;
  nationalInsuranceNumber: string | null;
  disabilityOrHealthCondition: string | null;
  additionalNeeds: string | null;
  miamMediatorName: string | null;
  allocatedMediatorName: string | null;
  portalStatus: string | null;
};

export function buildClientPartyView(party: PartyLike): ClientPartyView {
  return {
    id: party.id,
    caseId: party.caseId,
    clientId: party.clientId,
    role: party.role,
    firstName: party.firstName,
    lastName: party.lastName,
    email: party.email ?? null,
    phone: party.phone ?? null,
    phoneCode: party.phoneCode ?? null,
    dateOfBirth: party.dateOfBirth ?? null,
    addressLine1: party.addressLine1 ?? null,
    addressLine2: party.addressLine2 ?? null,
    city: party.city ?? null,
    postcode: party.postcode ?? null,
    country: party.country ?? null,
    gender: party.gender ?? null,
    ethnicOrigin: party.ethnicOrigin ?? null,
    nationalInsuranceNumber: party.nationalInsuranceNumber ?? null,
    disabilityOrHealthCondition: party.disabilityOrHealthCondition ?? null,
    additionalNeeds: party.additionalNeeds ?? null,
    miamMediatorName: party.miamMediatorName ?? null,
    allocatedMediatorName: party.allocatedMediatorName ?? null,
    portalStatus: party.portalStatus ?? null,
  };
}

export function buildMiamMediatorPartyView(party: PartyLike) {
  return {
    id: party.id,
    caseId: party.caseId,
    role: party.role,
    firstName: party.firstName,
    lastName: party.lastName,
    email: party.email ?? null,
    phone: party.phone ?? null,
    phoneCode: party.phoneCode ?? null,
    dateOfBirth: party.dateOfBirth ?? null,
    addressLine1: party.addressLine1 ?? null,
    addressLine2: party.addressLine2 ?? null,
    city: party.city ?? null,
    postcode: party.postcode ?? null,
    country: party.country ?? null,
    disabilityOrHealthCondition: party.disabilityOrHealthCondition ?? null,
    additionalNeeds: party.additionalNeeds ?? null,
    miamMediatorName: party.miamMediatorName ?? null,
    allocatedMediatorName: party.allocatedMediatorName ?? null,
    portalStatus: party.portalStatus ?? null,
  };
}

export function buildSessionParticipantPartyView(party: PartyLike) {
  return {
    id: party.id,
    caseId: party.caseId,
    role: party.role,
    firstName: party.firstName,
    lastName: party.lastName,
    email: party.email ?? null,
    phone: party.phone ?? null,
    phoneCode: party.phoneCode ?? null,
  };
}

export const buildCoMediatorPartyView = buildSessionParticipantPartyView;

export function buildSessionParticipantCaseDetail(input: {
  caseRecord: CaseLike;
  parties: PartyLike[];
  mediatorName: string;
  access: "co_mediator" | "observer";
  miamRecords?: Array<Record<string, any>>;
  miamValidity?: { parties?: Array<Record<string, any>> } | null;
}) {
  const parties = input.parties.map(buildSessionParticipantPartyView);
  const validityByParty = new Map((input.miamValidity?.parties || []).map((row) => [row.partyId, row]));
  const miamByParty = new Map((input.miamRecords || []).map((row) => [row.partyId, row]));
  return {
    id: input.caseRecord.id,
    caseRef: input.caseRecord.caseRef,
    mediatorId: input.caseRecord.mediatorId ?? null,
    mediatorName: input.mediatorName,
    stage: input.caseRecord.stage,
    status: input.caseRecord.status,
    issueType: input.caseRecord.issueType ?? null,
    mediationCategory: input.caseRecord.mediationCategory ?? null,
    familySubType: input.caseRecord.familySubType ?? null,
    workplaceSubType: input.caseRecord.workplaceSubType ?? null,
    civilSubType: input.caseRecord.civilSubType ?? null,
    commercialSubType: input.caseRecord.commercialSubType ?? null,
    otherSubType: input.caseRecord.otherSubType ?? null,
    createdAt: input.caseRecord.createdAt,
    lastUpdated: input.caseRecord.lastUpdated,
    partyA: parties.find((party) => String(party.role).toUpperCase() === "A"),
    partyB: parties.find((party) => String(party.role).toUpperCase() === "B"),
    parties,
    isMiamOnlyMediator: false,
    isSessionObserverOnly: input.access === "observer",
    isSessionCoMediator: input.access === "co_mediator",
    sessionAccess: input.access,
    miamSummaries: parties.map((party) => {
      const record = miamByParty.get(party.id);
      const validity = validityByParty.get(party.id);
      return {
        partyId: party.id,
        role: party.role,
        partyName: `${party.firstName || ""} ${party.lastName || ""}`.trim() || `Client ${party.role}`,
        recordStatus: record ? "recorded" : "not_started",
        approvalStatus: record?.approvalStatus ?? "not_started",
        suitableForMediation: record?.suitableForMediation ?? null,
        completedAt: record?.sessionDate ?? record?.reviewedAt ?? record?.submittedAt ?? null,
        valid: Boolean(validity?.valid),
        expired: Boolean(validity?.expired),
        expiresAt: validity?.expiresAt ?? null,
      };
    }),
    nextRoleLetter: null,
    miamValidity: null,
    cimReadiness: null,
  };
}

export function buildCoMediatorCaseDetail(input: Omit<Parameters<typeof buildSessionParticipantCaseDetail>[0], "access">) {
  return buildSessionParticipantCaseDetail({ ...input, access: "co_mediator" });
}

function clientCaseBase(caseRecord: CaseLike, ownParty: PartyLike, mediatorName: string) {
  return {
    id: caseRecord.id,
    caseRef: caseRecord.caseRef,
    stage: caseRecord.stage,
    status: caseRecord.status,
    issueType: caseRecord.issueType ?? null,
    mediationCategory: caseRecord.mediationCategory ?? null,
    ...(caseRecord.familySubType ? { familySubType: caseRecord.familySubType } : {}),
    ...(caseRecord.workplaceSubType ? { workplaceSubType: caseRecord.workplaceSubType } : {}),
    ...(caseRecord.civilSubType ? { civilSubType: caseRecord.civilSubType } : {}),
    ...(caseRecord.commercialSubType ? { commercialSubType: caseRecord.commercialSubType } : {}),
    ...(caseRecord.otherSubType ? { otherSubType: caseRecord.otherSubType } : {}),
    createdAt: caseRecord.createdAt,
    lastUpdated: caseRecord.lastUpdated,
    mediatorName,
    userPartyRole: ownParty.role,
    ownParty: buildClientPartyView(ownParty),
  };
}

export function buildClientCaseSummary(caseRecord: CaseLike, ownParty: PartyLike, mediatorName: string) {
  return clientCaseBase(caseRecord, ownParty, mediatorName);
}

export function buildClientCaseDetail(input: {
  caseRecord: CaseLike;
  ownParty: PartyLike;
  mediatorName: string;
  miamValidity?: (Record<string, any> & { parties?: Array<Record<string, any>> }) | null;
}) {
  const ownPartyView = buildClientPartyView(input.ownParty);
  const role = String(input.ownParty.role || "").toUpperCase();
  const miamValidity = input.miamValidity
    ? {
        valid: Boolean(input.miamValidity.valid),
        sourceDate: input.miamValidity.sourceDate ?? null,
        expiresAt: input.miamValidity.expiresAt ?? null,
        miamCompletedDate: input.miamValidity.miamCompletedDate ?? null,
        latestMediationSessionDate: input.miamValidity.latestMediationSessionDate ?? null,
        renewalBookingAvailable: Boolean(input.miamValidity.renewalBookingAvailable),
        parties: (input.miamValidity.parties || [])
          .filter((party) => party.partyId === input.ownParty.id)
          .map((party) => ({
            partyId: party.partyId,
            role: party.role,
            partyName: party.partyName,
            valid: Boolean(party.valid),
            expired: Boolean(party.expired),
            sourceDate: party.sourceDate ?? null,
            expiresAt: party.expiresAt ?? null,
            miamCompletedDate: party.miamCompletedDate ?? null,
            latestMediationSessionDate: party.latestMediationSessionDate ?? null,
            renewalBookingAvailable: Boolean(party.renewalBookingAvailable),
          })),
      }
    : null;
  return {
    ...clientCaseBase(input.caseRecord, input.ownParty, input.mediatorName),
    partyA: role === "A" ? ownPartyView : undefined,
    partyB: role === "B" ? ownPartyView : undefined,
    parties: [ownPartyView],
    miamValidity,
  };
}
