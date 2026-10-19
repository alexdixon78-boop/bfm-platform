import type { SessionJoinAvailability } from "./appointment-join-policy";

export function canClientAccessAppointment(
  appointment: { partyId?: string | null },
  ownPartyIds: ReadonlySet<string>,
): boolean {
  return appointment.partyId == null || ownPartyIds.has(appointment.partyId);
}

export type ClientAppointmentView = {
  id: string;
  caseId: string;
  dateTime: Date | string;
  dateTimeBasis: "instant" | "wall_clock_utc";
  duration: number;
  status: string;
  serviceName: string | null;
  mediatorName: string | null;
  caseReference: string | null;
  hasMeetingLink: boolean;
  canJoin: boolean;
  joinAvailability?: SessionJoinAvailability;
};

export function buildClientAppointmentView(appointment: Record<string, any>): ClientAppointmentView {
  return {
    id: appointment.id,
    caseId: appointment.caseId,
    dateTime: appointment.dateTime,
    dateTimeBasis: appointment.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc",
    duration: appointment.duration,
    status: appointment.status,
    serviceName: appointment.serviceName ?? null,
    mediatorName: appointment.mediatorName ?? null,
    caseReference: appointment.caseReference ?? null,
    hasMeetingLink: Boolean(appointment.hasMeetingLink ?? appointment.meetingLink),
    canJoin: Boolean(appointment.joinAvailability?.canJoin ?? appointment.canJoin),
    ...(appointment.joinAvailability ? { joinAvailability: appointment.joinAvailability } : {}),
  };
}

export type CoMediatorAppointmentView = ClientAppointmentView & {
  partyId: string | null;
};

export function buildCoMediatorAppointmentView(appointment: Record<string, any>): CoMediatorAppointmentView {
  return {
    ...buildClientAppointmentView(appointment),
    partyId: appointment.partyId ?? null,
  };
}
