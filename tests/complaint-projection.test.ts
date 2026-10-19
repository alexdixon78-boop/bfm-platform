import assert from "node:assert/strict";
import test from "node:test";
import { toSubmitterComplaintStatus } from "../server/security/complaint-projection";

test("submitter projection omits complaint content, subjects, internals, and storage keys", () => {
  const result = toSubmitterComplaintStatus({
    complaint: {
      id: "complaint-1", complaintRef: "CMP-000001", caseRef: "BFM-100", status: "under_review",
      receivedAt: new Date("2026-01-01T10:00:00Z"), acknowledgementDueAt: new Date("2026-01-15T10:00:00Z"), acknowledgedAt: null,
      responseDueAt: new Date("2026-02-12T10:00:00Z"), nextUpdateAt: null, finalResponseAt: null, closedAt: null,
      outcome: null, resolutionSummary: null, fmcRelevantDate: null, fmcWithinThreeMonths: null,
      details: "private details", targetName: "Named mediator", supportingNotes: "private notes", storageKey: "/secret/path",
    },
    events: [
      { id: "public", type: "released_update", visibility: "submitter", message: "Visible update", relatedEventId: null, createdAt: new Date(), redactedAt: null, actorName: "Admin" },
      { id: "private", type: "internal_note", visibility: "internal", message: "Investigation detail", relatedEventId: null, createdAt: new Date(), redactedAt: null, actorName: "Admin" },
    ],
  });
  assert.equal((result as any).details, undefined);
  assert.equal((result as any).targetName, undefined);
  assert.equal((result as any).storageKey, undefined);
  assert.deepEqual(result.events.map((event) => event.id), ["public"]);
  assert.equal((result.events[0] as any).actorName, undefined);
});

test("redacting a resolution event also redacts the projected resolution summary", () => {
  const result = toSubmitterComplaintStatus({
    complaint: {
      id: "complaint-1", complaintRef: "CMP-000001", caseRef: "BFM-100", status: "closed",
      receivedAt: new Date(), acknowledgementDueAt: new Date(), acknowledgedAt: new Date(), responseDueAt: new Date(),
      nextUpdateAt: null, finalResponseAt: new Date(), closedAt: new Date(), outcome: "upheld",
      resolutionSummary: "Sensitive resolution", fmcRelevantDate: null, fmcWithinThreeMonths: null,
    },
    events: [{ id: "closed", type: "closed", visibility: "submitter", message: "Sensitive resolution", relatedEventId: null, createdAt: new Date(), redactedAt: new Date() }],
  });
  assert.equal(result.resolutionSummary, "[Redacted]");
});
