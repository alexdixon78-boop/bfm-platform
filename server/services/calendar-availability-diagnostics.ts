import {
  recognizeCalendarAvailabilityEvent,
  type CalendarAvailabilityCandidate,
  type CalendarAvailabilityRejectionReason,
} from "./calendar-availability-recognition";
import { buildCalendarAvailabilityWindows } from "./calendar-availability-window";

export type CalendarAvailabilityProjectionDiagnostic = {
  status: "rejected" | "historical" | "out_of_window" | "no_approved_service" | "active";
  rejectionReason: CalendarAvailabilityRejectionReason | null;
  expectedServiceIds: string[];
  activeSlotServiceIds: string[];
  missingServiceIds: string[];
  unexpectedServiceIds: string[];
};

export function buildCalendarAvailabilityProjectionDiagnostic(input: CalendarAvailabilityCandidate & {
  connectedEmail: string | null | undefined;
  approvedServiceIds: string[];
  activeSlotServiceIds: string[];
  now?: Date;
}): CalendarAvailabilityProjectionDiagnostic {
  const recognition = recognizeCalendarAvailabilityEvent(input, {
    connectedEmail: input.connectedEmail,
    now: input.now,
  });
  const expectedServiceIds = Array.from(new Set(input.approvedServiceIds)).sort();
  const activeSlotServiceIds = Array.from(new Set(input.activeSlotServiceIds)).sort();
  const missingServiceIds = expectedServiceIds.filter((id) => !activeSlotServiceIds.includes(id));
  const unexpectedServiceIds = activeSlotServiceIds.filter((id) => !expectedServiceIds.includes(id));

  if (!recognition.qualified) {
    return {
      status: "rejected",
      rejectionReason: recognition.reason,
      expectedServiceIds,
      activeSlotServiceIds,
      missingServiceIds,
      unexpectedServiceIds,
    };
  }

  const windows = buildCalendarAvailabilityWindows(input, input.now);
  const active = windows.some((window) => window.state === "active");
  const status = active
    ? expectedServiceIds.length === 0 ? "no_approved_service" : "active"
    : windows.some((window) => window.state === "historical") ? "historical" : "out_of_window";
  return {
    status,
    rejectionReason: null,
    expectedServiceIds,
    activeSlotServiceIds,
    missingServiceIds,
    unexpectedServiceIds,
  };
}

export function getMediatorBookingEligibilityReasons(input: {
  assignedToService: boolean;
  accountActive: boolean;
  panelActive: boolean;
  serviceActive: boolean;
  approvalApproved: boolean;
  roleQualified: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!input.assignedToService) reasons.push("service_not_assigned");
  if (!input.accountActive) reasons.push("mediator_inactive");
  if (!input.panelActive) reasons.push("panel_inactive");
  if (!input.serviceActive) reasons.push("service_inactive");
  if (!input.approvalApproved) reasons.push("service_not_approved");
  if (!input.roleQualified) reasons.push("mediation_role_not_qualified");
  return reasons;
}
