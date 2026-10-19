type ProjectionComplaint = {
  id: string; complaintRef: string; caseRef: string; status: string;
  receivedAt: Date; acknowledgementDueAt: Date; acknowledgedAt: Date | null;
  responseDueAt: Date; nextUpdateAt: Date | null; finalResponseAt: Date | null;
  closedAt: Date | null; outcome: string | null; resolutionSummary: string | null;
  fmcRelevantDate: Date | null; fmcWithinThreeMonths: boolean | null;
  [key: string]: unknown;
};

type ProjectionEvent = {
  id: string; type: string; visibility: string; message: string | null;
  relatedEventId: string | null; createdAt: Date; redactedAt: Date | null;
  [key: string]: unknown;
};

export function toSubmitterComplaintStatus(input: { complaint: ProjectionComplaint; events: ProjectionEvent[] }) {
  const complaint = input.complaint;
  const resolutionRedacted = input.events.some((event) => event.redactedAt && ["closed", "withdrawn", "duplicate_marked"].includes(event.type));
  return {
    id: complaint.id, complaintRef: complaint.complaintRef, caseRef: complaint.caseRef, status: complaint.status,
    receivedAt: complaint.receivedAt, acknowledgementDueAt: complaint.acknowledgementDueAt,
    acknowledgedAt: complaint.acknowledgedAt, responseDueAt: complaint.responseDueAt,
    nextUpdateAt: complaint.nextUpdateAt, finalResponseAt: complaint.finalResponseAt, closedAt: complaint.closedAt,
    outcome: complaint.outcome, resolutionSummary: resolutionRedacted ? "[Redacted]" : complaint.resolutionSummary,
    fmcRelevantDate: complaint.fmcRelevantDate, fmcWithinThreeMonths: complaint.fmcWithinThreeMonths,
    events: input.events.filter((event) => event.visibility === "submitter").map((event) => ({
      id: event.id, type: event.type, message: event.redactedAt ? "[Redacted]" : event.message,
      relatedEventId: event.relatedEventId, createdAt: event.createdAt, redactedAt: event.redactedAt,
    })),
  };
}
