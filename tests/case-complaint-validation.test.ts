import test from "node:test";
import assert from "node:assert/strict";
import {
  complaintSubmissionSchema,
  complaintStatusActionSchema,
  clarificationReplySchema,
} from "../shared/schema";

const validSubmission = {
  caseId: "case-1",
  category: "service_process",
  targetType: "service",
  details: "The promised follow-up was not provided.",
  attachments: [],
};

test("complaint submission requires exactly one case selector and meaningful details", () => {
  assert.equal(complaintSubmissionSchema.safeParse(validSubmission).success, true);
  assert.equal(complaintSubmissionSchema.safeParse({ ...validSubmission, caseRef: "BFM-1" }).success, false);
  assert.equal(complaintSubmissionSchema.safeParse({ ...validSubmission, caseId: undefined }).success, false);
  assert.equal(complaintSubmissionSchema.safeParse({ ...validSubmission, details: "short" }).success, false);
});

test("complaint submission restricts attachment count, size, and MIME type", () => {
  const pdf = {
    fileName: "evidence.pdf",
    mimeType: "application/pdf",
    fileData: `data:application/pdf;base64,${Buffer.from("%PDF-1.7\n").toString("base64")}`,
  };
  assert.equal(complaintSubmissionSchema.safeParse({ ...validSubmission, attachments: [pdf] }).success, true);
  assert.equal(complaintSubmissionSchema.safeParse({ ...validSubmission, attachments: Array(6).fill(pdf) }).success, false);
  assert.equal(complaintSubmissionSchema.safeParse({ ...validSubmission, attachments: [{ ...pdf, mimeType: "application/zip" }] }).success, false);
});

test("status actions require the fields that make the transition accountable", () => {
  assert.equal(complaintStatusActionSchema.safeParse({ status: "acknowledged" }).success, true);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "awaiting_information" }).success, false);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "response_issued", releasedResponse: "We investigated the matter." }).success, true);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "closed", outcome: "partially_upheld" }).success, false);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "closed", outcome: "partially_upheld", resolutionSummary: "Corrective action was completed." }).success, true);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "withdrawn" }).success, false);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "withdrawn", resolutionSummary: "Withdrawn at the complainant's request." }).success, true);
  assert.equal(complaintStatusActionSchema.safeParse({ status: "duplicate" }).success, false);
});

test("clarification replies require a response to an open request", () => {
  assert.equal(clarificationReplySchema.safeParse({ requestEventId: "event-1", response: "Here are the dates requested.", attachments: [] }).success, true);
  assert.equal(clarificationReplySchema.safeParse({ requestEventId: "", response: "Here are the dates requested.", attachments: [] }).success, false);
  assert.equal(clarificationReplySchema.safeParse({ requestEventId: "event-1", response: "", attachments: [] }).success, false);
});
