type SessionRef = { id: string; leadMediatorId?: string | null };
type ParticipantRef = {
  sessionId: string;
  userId: string;
  role: string;
  invitationStatus: string;
};

export function hasAcceptedSessionParticipantAccess(
  sessionId: string,
  participants: ParticipantRef[],
  actor: { id: string; role: string },
): boolean {
  if (actor.role === "superadmin" || actor.role === "subadmin") return true;
  if (actor.role !== "mediator") return false;
  return participants.some((participant) => participant.sessionId === sessionId
    && participant.userId === actor.id
    && (participant.role === "lead_mediator" || participant.role === "co_mediator" || participant.role === "observer")
    && participant.invitationStatus === "accepted");
}

export function hasLeadEquivalentSessionAccess(
  session: SessionRef,
  participants: ParticipantRef[],
  actor: { id: string; role: string },
): boolean {
  if (actor.role === "superadmin" || actor.role === "subadmin") return true;
  if (actor.role !== "mediator") return false;
  if (session.leadMediatorId === actor.id) return true;
  return participants.some((participant) => participant.sessionId === session.id
    && participant.userId === actor.id
    && participant.role === "co_mediator"
    && participant.invitationStatus === "accepted");
}
