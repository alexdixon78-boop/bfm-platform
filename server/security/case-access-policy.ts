export type CaseAccessTier =
  | { tier: "admin" }
  | { tier: "operational_staff" }
  | { tier: "full_mediator" }
  | { tier: "session_co_mediator" }
  | { tier: "miam_only_mediator"; partyIds: string[] }
  | { tier: "session_observer" }
  | { tier: "client_party"; partyId: string }
  | { tier: "none" };

export type CaseAccessContext = {
  caseMediatorId?: string | null;
  parties: Array<{
    id: string;
    userId?: string | null;
    miamMediatorId?: string | null;
    allocatedMediatorId?: string | null;
  }>;
  sessions: Array<{ id: string; leadMediatorId?: string | null }>;
  participants: Array<{
    sessionId: string;
    userId: string;
    role: string;
    invitationStatus: string;
  }>;
};

export function classifyCaseAccessFromContext(
  user: { id: string; role: string },
  context: CaseAccessContext,
): CaseAccessTier {
  if (user.role === "superadmin" || user.role === "subadmin") return { tier: "admin" };
  if (user.role === "staff") return { tier: "operational_staff" };

  if (user.role === "client") {
    const ownParty = context.parties.find((party) => party.userId === user.id);
    return ownParty ? { tier: "client_party", partyId: ownParty.id } : { tier: "none" };
  }

  if (user.role !== "mediator") return { tier: "none" };

  const acceptedParticipants = context.participants.filter(
    (participant) => participant.userId === user.id && participant.invitationStatus === "accepted",
  );
  const fullAccess = context.caseMediatorId === user.id
    || context.parties.some((party) => party.allocatedMediatorId === user.id)
    || context.sessions.some((session) => session.leadMediatorId === user.id)
    || acceptedParticipants.some((participant) => participant.role === "lead_mediator");
  if (fullAccess) return { tier: "full_mediator" };

  if (acceptedParticipants.some((participant) => participant.role === "co_mediator")) {
    return { tier: "session_co_mediator" };
  }

  if (acceptedParticipants.some((participant) => participant.role === "observer")) {
    return { tier: "session_observer" };
  }

  const miamPartyIds = context.parties
    .filter((party) => party.miamMediatorId === user.id)
    .map((party) => party.id);
  if (miamPartyIds.length > 0) return { tier: "miam_only_mediator", partyIds: miamPartyIds };

  return { tier: "none" };
}

export async function classifyCaseAccess(
  caseId: string,
  user: { id: string; role: string },
): Promise<CaseAccessTier> {
  const { storage } = await import("../storage");
  const caseRecord = await storage.getCase(caseId);
  if (!caseRecord) return { tier: "none" };
  const [parties, sessions] = await Promise.all([
    storage.listPartiesByCase(caseId),
    storage.listMediationSessionsByCase(caseId),
  ]);
  const participants = await storage.listMediationSessionParticipantsBySessionIds(sessions.map((session) => session.id));
  return classifyCaseAccessFromContext(user, {
    caseMediatorId: caseRecord.mediatorId,
    parties,
    sessions,
    participants,
  });
}

export function hasCaseAccess(access: CaseAccessTier): boolean {
  return access.tier !== "none";
}

export function hasFullOperationalCaseAccess(access: CaseAccessTier): boolean {
  return access.tier === "admin" || access.tier === "operational_staff" || access.tier === "full_mediator";
}

export function hasFinancialCaseAccess(access: CaseAccessTier): boolean {
  return hasFullOperationalCaseAccess(access) || access.tier === "client_party";
}

export type PrivateNoteAccess = "author_only" | "review_all" | null;

export function getPrivateNoteScope(access: CaseAccessTier): PrivateNoteAccess {
  if (access.tier === "admin" || access.tier === "full_mediator") return "review_all";
  if (access.tier === "client_party") return "author_only";
  return null;
}

export function getPrivateNoteAccess(
  user: { id: string; role: string },
  access: CaseAccessTier,
  note: { authorUserId?: string | null; authorPartyId?: string | null },
): PrivateNoteAccess {
  const scope = getPrivateNoteScope(access);
  if (scope === "review_all") return scope;
  if (user.role === "client" && access.tier === "client_party" && note.authorPartyId === access.partyId) {
    return scope;
  }
  return null;
}

export function canUseCaseWhatsappWorkspace(role: string, canViewCases: boolean, canEditWhatsapp: boolean): boolean {
  if (role === "superadmin") return true;
  return role === "subadmin" && canViewCases && canEditWhatsapp;
}
