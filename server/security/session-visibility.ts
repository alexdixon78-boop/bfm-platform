import { buildClientAppointmentView, buildCoMediatorAppointmentView, canClientAccessAppointment } from "./appointment-visibility";
import { isOrdinaryCaseDocument, withProtectedCaseDocumentUrl } from "./document-access";
import { getUkDateKey } from "../utils/uk-wall-clock";

type SessionLike = Record<string, any>;

function safeAppointment(appointment: Record<string, any> | null | undefined) {
  if (!appointment) return null;
  return buildClientAppointmentView({
    ...appointment,
    hasMeetingLink: Boolean(appointment.meetingLink),
    canJoin: appointment.joinAvailability?.canJoin ?? (appointment.status === "confirmed"
      && Boolean(appointment.meetingLink)
      && getUkDateKey(new Date(appointment.dateTime)) === getUkDateKey()),
  });
}

export function filterAcceptedParticipantSessions<T extends { id: string }>(
  sessions: T[],
  participants: Array<{ sessionId: string; userId: string; role: string; invitationStatus: string }>,
  userId: string,
  role: "co_mediator" | "observer",
): T[] {
  const acceptedSessionIds = new Set(participants
    .filter((participant) => participant.userId === userId
      && participant.role === role
      && participant.invitationStatus === "accepted")
    .map((participant) => participant.sessionId));
  return sessions.filter((session) => acceptedSessionIds.has(session.id));
}

export function filterObservedSessions<T extends { id: string }>(
  sessions: T[],
  participants: Array<{ sessionId: string; userId: string; role: string; invitationStatus: string }>,
  userId: string,
): T[] {
  return filterAcceptedParticipantSessions(sessions, participants, userId, "observer");
}

export function buildClientMediationSessionView(session: SessionLike, ownPartyIds: ReadonlySet<string>) {
  const approvedOutcome = session.postSessionReviewStatus === "approved";
  const ownRecipientIds = new Set((session.proposal?.recipients || [])
    .filter((recipient: Record<string, any>) => ownPartyIds.has(recipient.partyId || ""))
    .map((recipient: Record<string, any>) => recipient.id));
  const appointment = session.appointment && canClientAccessAppointment(session.appointment, ownPartyIds)
    ? safeAppointment(session.appointment)
    : null;

  return {
    id: session.id,
    caseId: session.caseId,
    sessionNumber: session.sessionNumber,
    status: session.status,
    leadMediatorName: session.leadMediatorName ?? null,
    participants: [],
    appointment,
    proposal: session.proposal ? {
      id: session.proposal.id,
      status: session.proposal.status,
      proposedStartAt: session.proposal.proposedStartAt,
      duration: session.proposal.duration,
      expiresAt: session.proposal.expiresAt,
      recipients: (session.proposal.recipients || [])
        .filter((recipient: Record<string, any>) => ownPartyIds.has(recipient.partyId || ""))
        .map((recipient: Record<string, any>) => ({
          id: recipient.id,
          partyId: recipient.partyId,
          responseStatus: recipient.responseStatus,
          respondedAt: recipient.respondedAt,
        })),
    } : null,
    requiredForms: (session.requiredForms || [])
      .filter((form: Record<string, any>) => ownPartyIds.has(form.partyId))
      .map((form: Record<string, any>) => ({
        id: form.id,
        partyId: form.partyId,
        mediationSessionId: form.mediationSessionId,
        formType: form.formType,
        status: form.status,
        deliveryStatus: form.deliveryStatus,
        sentAt: form.sentAt,
        viewedAt: form.viewedAt,
        signedAt: form.signedAt,
        signerName: form.signerName,
        signatureSource: form.signatureSource,
      })),
    availabilityWindows: (session.availabilityWindows || [])
      .filter((window: Record<string, any>) => ownPartyIds.has(window.partyId || "") || ownRecipientIds.has(window.proposalRecipientId || ""))
      .map((window: Record<string, any>) => ({
        id: window.id,
        partyId: window.partyId,
        proposalRecipientId: window.proposalRecipientId,
        source: window.source,
        startAt: window.startAt,
        endAt: window.endAt,
        status: window.status,
      })),
    partyAttendance: (session.partyAttendance || [])
      .filter((row: Record<string, any>) => ownPartyIds.has(row.partyId || ""))
      .map((row: Record<string, any>) => ({
        id: row.id,
        partyId: row.partyId,
        attendanceStatus: row.attendanceStatus,
      })),
    outcome: approvedOutcome ? session.outcome ?? null : null,
    outcomeNotes: approvedOutcome ? session.outcomeNotes ?? null : null,
    nextAction: approvedOutcome ? session.nextAction ?? null : null,
    documentsRequired: approvedOutcome ? session.documentsRequired ?? null : null,
    followUpRequirements: approvedOutcome ? session.followUpRequirements ?? null : null,
    nextSessionRequired: approvedOutcome ? Boolean(session.nextSessionRequired) : false,
    postSessionReviewStatus: session.postSessionReviewStatus,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function buildObserverMediationSessionView(session: SessionLike) {
  return {
    id: session.id,
    caseId: session.caseId,
    sessionNumber: session.sessionNumber,
    status: session.status,
    leadMediatorName: session.leadMediatorName ?? null,
    participants: [],
    appointment: safeAppointment(session.appointment),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function buildCoMediatorRequiredFormView(form: Record<string, any>) {
  return {
    id: form.id,
    caseId: form.caseId,
    mediationSessionId: form.mediationSessionId ?? null,
    appointmentId: form.appointmentId ?? null,
    partyId: form.partyId,
    formType: form.formType,
    status: form.status,
    deliveryStatus: form.deliveryStatus ?? null,
    deliveryLastAttemptedAt: form.deliveryLastAttemptedAt ?? null,
    deliveryError: form.deliveryError ?? null,
    sentAt: form.sentAt ?? null,
    viewedAt: form.viewedAt ?? null,
    signedAt: form.signedAt ?? null,
    signerName: form.signerName ?? null,
    signatureSource: form.signatureSource ?? null,
    uploadedDocumentId: form.uploadedDocumentId ?? null,
    generatedDocumentId: form.generatedDocumentId ?? null,
    courtFormTemplateId: form.courtFormTemplateId ?? null,
    courtFormGenerationId: form.courtFormGenerationId ?? null,
    withdrawnAt: form.withdrawnAt ?? null,
  };
}

export function buildCoMediatorMediationSessionView(session: SessionLike) {
  const proposal = session.proposal ? {
    id: session.proposal.id,
    proposedStartAt: session.proposal.proposedStartAt,
    proposedEndAt: session.proposal.proposedEndAt,
    expiresAt: session.proposal.expiresAt,
    status: session.proposal.status,
    voucherFormRequired: Boolean(session.proposal.voucherFormRequired),
    recipients: (session.proposal.recipients || []).map((recipient: Record<string, any>) => ({
      id: recipient.id,
      partyId: recipient.partyId ?? null,
      userId: recipient.userId ?? null,
      participantId: recipient.participantId ?? null,
      participantRole: recipient.participantRole ?? null,
      recipientType: recipient.recipientType,
      recipientName: recipient.recipientName,
      recipientEmail: recipient.recipientEmail ?? null,
      responseStatus: recipient.responseStatus,
      sentAt: recipient.sentAt ?? null,
      viewedAt: recipient.viewedAt ?? null,
      respondedAt: recipient.respondedAt ?? null,
      declineNotes: recipient.declineNotes ?? null,
    })),
  } : null;
  const requiredForms = (session.requiredForms || []).map(buildCoMediatorRequiredFormView);
  return {
    id: session.id,
    caseId: session.caseId,
    appointmentId: session.appointmentId ?? null,
    sessionNumber: session.sessionNumber,
    status: session.status,
    leadMediatorId: session.leadMediatorId ?? null,
    leadMediatorName: session.leadMediatorName ?? null,
    participants: (session.participants || []).map((participant: Record<string, any>) => ({
      id: participant.id,
      userId: participant.userId,
      role: participant.role,
      invitationStatus: participant.invitationStatus,
      userName: participant.userName,
      userEmail: participant.userEmail,
    })),
    appointment: session.appointment ? buildCoMediatorAppointmentView({
      ...session.appointment,
      hasMeetingLink: Boolean(session.appointment.hasMeetingLink ?? session.appointment.meetingLink),
      canJoin: session.appointment.joinAvailability?.canJoin ?? (session.appointment.status === "confirmed"
        && Boolean(session.appointment.meetingLink)
        && getUkDateKey(new Date(session.appointment.dateTime)) === getUkDateKey()),
    }) : null,
    proposal,
    formRequirements: session.formRequirements || [],
    requiredForms,
    availabilityWindows: session.availabilityWindows || [],
    partyAttendance: session.partyAttendance || [],
    outcome: session.outcome ?? null,
    outcomeNotes: session.outcomeNotes ?? null,
    nextAction: session.nextAction ?? null,
    documentsRequired: session.documentsRequired ?? null,
    followUpRequirements: session.followUpRequirements ?? null,
    nextSessionRequired: Boolean(session.nextSessionRequired),
    postSessionReviewStatus: session.postSessionReviewStatus ?? null,
    postSessionReviewNotes: session.postSessionReviewNotes ?? null,
    summarySubmittedAt: session.summarySubmittedAt ?? null,
    summarySubmittedBy: session.summarySubmittedBy ?? null,
    noteSummary: session.noteSummary ?? null,
    documents: (session.documents || []).filter(isOrdinaryCaseDocument).map(withProtectedCaseDocumentUrl),
    indicator: session.indicator ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
