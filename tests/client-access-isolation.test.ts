import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientCaseDetail, buildClientCaseSummary } from "../server/security/case-visibility";
import { buildClientMediationSessionView } from "../server/security/session-visibility";

const ownParty = {
  id: "party-a",
  caseId: "case-1",
  clientId: "client-a",
  userId: "user-a",
  role: "A",
  firstName: "Alice",
  lastName: "Able",
  email: "alice@example.test",
  phone: "7000000000",
  phoneCode: "+44",
  dateOfBirth: "1990-01-01",
  addressLine1: "1 Test Street",
  addressLine2: null,
  city: "London",
  postcode: "SW1A 1AA",
  country: "United Kingdom",
  gender: "Female",
  ethnicOrigin: "Test",
  nationalInsuranceNumber: "QQ123456C",
  disabilityOrHealthCondition: "None",
  additionalNeeds: "None",
  miamMediatorId: "mediator-1",
  allocatedMediatorId: "mediator-1",
  portalStatus: "active",
  inviteToken: "must-not-leak",
  confidential: true,
};

const otherParty = { ...ownParty, id: "party-b", clientId: "client-b", userId: "user-b", role: "B", firstName: "Bob", email: "bob@example.test" };

const caseRecord = {
  id: "case-1",
  caseRef: "BFM-2026-0001",
  stage: "MIAM",
  status: "Active",
  issueType: "Child arrangements",
  mediationCategory: "Family",
  familySubType: "Child arrangements",
  workplaceSubType: null,
  civilSubType: null,
  commercialSubType: null,
  otherSubType: null,
  mediatorId: "mediator-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastUpdated: new Date("2026-01-02T00:00:00Z"),
  notes: "internal case note",
  intakeStatus: "Safeguarding",
  safeguardingNotes: "restricted safeguarding disclosure",
  safeguardingStatus: "concern",
  safeguardingConfidential: true,
  standardChaseStopped: true,
  rebeccaNotifiedAt: new Date("2026-01-03T00:00:00Z"),
  claimedBy: "admin-1",
  confidential: true,
  referralPartnerName: "Restricted referral",
  closureDetails: "Restricted closure detail",
  manualRevenuePence: 99999,
};

test("client case summary contains only allowlisted case and own-party fields", () => {
  const summary = buildClientCaseSummary(caseRecord as any, ownParty as any, "Mediator One");

  assert.deepEqual(Object.keys(summary).sort(), [
    "caseRef", "createdAt", "familySubType", "id", "issueType", "lastUpdated",
    "mediationCategory", "mediatorName", "ownParty", "stage", "status", "userPartyRole",
  ].sort());
  assert.equal(summary.ownParty.email, "alice@example.test");
  assert.equal("inviteToken" in summary.ownParty, false);
  assert.equal("confidential" in summary.ownParty, false);
  assert.equal("userId" in summary.ownParty, false);
  assert.equal("miamMediatorId" in summary.ownParty, false);
  assert.equal("allocatedMediatorId" in summary.ownParty, false);
  assert.equal("confidential" in summary, false);
  assert.equal("safeguardingStatus" in summary, false);
  assert.equal("intakeStatus" in summary, false);
  assert.equal("safeguardingConfidential" in summary, false);
  assert.equal("standardChaseStopped" in summary, false);
  assert.equal("rebeccaNotifiedAt" in summary, false);
  assert.equal("notes" in summary, false);
  assert.equal("safeguardingNotes" in summary, false);
  assert.equal(JSON.stringify(summary).includes("bob@example.test"), false);
});

test("client mediation session DTO excludes participants, notes, documents, finance, and internal actor IDs", () => {
  const view = buildClientMediationSessionView({
    id: "session-1",
    caseId: "case-1",
    sessionNumber: 1,
    status: "confirmed",
    leadMediatorName: "Mediator One",
    leadMediatorId: "staff-1",
    postSessionReviewStatus: "approved",
    outcome: "agreement",
    outcomeNotes: "Shared outcome",
    participants: [{ userEmail: "staff@example.test" }],
    noteSummary: { count: 2, latestNoteAuthor: "Admin" },
    documents: [{ fileUrl: "/private" }],
    invoices: [{ amountPence: 10000 }],
    draftFinancialSchedule: { status: "draft" },
    appointment: { id: "appt-1", caseId: "case-1", dateTime: new Date(), duration: 90, status: "confirmed", meetingLink: "https://private.test", notes: "private" },
    proposal: {
      id: "proposal-1",
      status: "pending",
      proposedStartAt: new Date("2026-01-10T10:00:00Z"),
      duration: 120,
      expiresAt: new Date("2026-01-09T10:00:00Z"),
      recipients: [
        {
          id: "recipient-a",
          partyId: "party-a",
          recipientType: "client",
          recipientName: "Alice Able",
          recipientEmail: "alice@example.test",
          responseStatus: "accepted",
          respondedAt: new Date("2026-01-08T10:00:00Z"),
          tokenHash: "own-secret-token-hash",
        },
        {
          id: "recipient-b",
          partyId: "party-b",
          recipientType: "client",
          recipientName: "Bob Baker",
          recipientEmail: "bob@example.test",
          responseStatus: "pending",
          respondedAt: null,
          tokenHash: "other-secret-token-hash",
        },
      ],
    },
    requiredForms: [],
    availabilityWindows: [],
    partyAttendance: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any, new Set(["party-a"]));

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("staff@example.test"), false);
  assert.equal(serialized.includes("latestNoteAuthor"), false);
  assert.equal(serialized.includes("amountPence"), false);
  assert.equal(serialized.includes("draftFinancialSchedule"), false);
  assert.equal(serialized.includes("private.test"), false);
  assert.equal("leadMediatorId" in view, false);
  assert.deepEqual(view.participants, []);
  assert.deepEqual(view.proposal?.recipients, [{
    id: "recipient-a",
    partyId: "party-a",
    responseStatus: "accepted",
    respondedAt: new Date("2026-01-08T10:00:00Z"),
  }]);
  assert.deepEqual(Object.keys(view.proposal?.recipients[0] || {}).sort(), [
    "id", "partyId", "respondedAt", "responseStatus",
  ]);
  assert.equal(serialized.includes("recipientType"), false);
  assert.equal(serialized.includes("recipientName"), false);
  assert.equal(serialized.includes("recipientEmail"), false);
  assert.equal(serialized.includes("tokenHash"), false);
  assert.equal(serialized.includes("Bob Baker"), false);
});

test("client case detail filters MIAM validity to the authenticated party", () => {
  const detail = buildClientCaseDetail({
    caseRecord: caseRecord as any,
    ownParty: ownParty as any,
    mediatorName: "Mediator One",
    miamValidity: {
      valid: false,
      sourceDate: null,
      expiresAt: null,
      miamCompletedDate: null,
      latestMediationSessionDate: null,
      renewalBookingAvailable: true,
      parties: [
        { partyId: "party-a", valid: true, privateAnswer: "must-not-leak" },
        { partyId: "party-b", valid: false, privateAnswer: "restricted" },
      ],
    } as any,
  });

  assert.deepEqual(detail.parties.map((party) => party.id), ["party-a"]);
  assert.deepEqual(detail.miamValidity?.parties.map((party) => party.partyId), ["party-a"]);
  assert.equal("notes" in detail, false);
  assert.equal("confidential" in detail, false);
  assert.equal("safeguardingStatus" in detail, false);
  assert.equal("intakeStatus" in detail, false);
  assert.equal("safeguardingConfidential" in detail, false);
  assert.equal("standardChaseStopped" in detail, false);
  assert.equal("rebeccaNotifiedAt" in detail, false);
  assert.equal(JSON.stringify(detail).includes("restricted"), false);
  assert.equal(JSON.stringify(detail).includes("must-not-leak"), false);
});
