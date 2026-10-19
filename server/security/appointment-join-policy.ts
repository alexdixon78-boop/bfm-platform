import { getUkDateKey } from "../utils/uk-wall-clock";

export type SessionJoinAvailabilityReasonCode =
  | "available"
  | "session_cancelled"
  | "session_expired"
  | "forms_pending"
  | "responses_pending"
  | "confirmation_pending"
  | "meeting_link_missing"
  | "appointment_day_pending"
  | "appointment_day_passed";

export type SessionJoinAvailability = {
  canJoin: boolean;
  reasonCode: SessionJoinAvailabilityReasonCode;
  message: string;
};

type SessionJoinAppointment = {
  status: string;
  dateTime: Date | string;
  meetingLink?: string | null;
};

type SessionJoinContext = {
  appointment: SessionJoinAppointment;
  sessionStatus?: string | null;
  blockingFormsPending?: boolean;
  proposalResponsesPending?: boolean;
};

export function buildSessionJoinAvailability(
  context: SessionJoinContext,
  now = new Date(),
): SessionJoinAvailability {
  const { appointment } = context;
  if (context.sessionStatus === "cancelled" || appointment.status === "cancelled") {
    return { canJoin: false, reasonCode: "session_cancelled", message: "This session has been cancelled." };
  }
  if (appointment.status === "expired") {
    return {
      canJoin: false,
      reasonCode: "session_expired",
      message: "This session hold has expired. Contact Brighter Future Mediation to arrange another time.",
    };
  }
  if (appointment.status !== "confirmed") {
    if (context.blockingFormsPending) {
      return {
        canJoin: false,
        reasonCode: "forms_pending",
        message: "Join will be available after all required client forms are signed and the session is confirmed.",
      };
    }
    if (context.proposalResponsesPending) {
      return {
        canJoin: false,
        reasonCode: "responses_pending",
        message: "Join will be available after all required participants accept and the session is confirmed.",
      };
    }
    return {
      canJoin: false,
      reasonCode: "confirmation_pending",
      message: "Join will be available after the session is confirmed.",
    };
  }
  if (!appointment.meetingLink?.trim()) {
    return {
      canJoin: false,
      reasonCode: "meeting_link_missing",
      message: "The meeting link has not been configured. Please contact Brighter Future Mediation.",
    };
  }

  const appointmentDay = getUkDateKey(new Date(appointment.dateTime));
  const today = getUkDateKey(now);
  if (appointmentDay > today) {
    return {
      canJoin: false,
      reasonCode: "appointment_day_pending",
      message: "Join will be available on the appointment day.",
    };
  }
  if (appointmentDay < today) {
    return {
      canJoin: false,
      reasonCode: "appointment_day_passed",
      message: "The appointment date has passed.",
    };
  }
  return { canJoin: true, reasonCode: "available", message: "Join Session is available." };
}
