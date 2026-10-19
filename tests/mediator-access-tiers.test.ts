import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCaseAccessFromContext, hasFinancialCaseAccess } from "../server/security/case-access-policy";
import { buildCoMediatorMediationSessionView, buildObserverMediationSessionView, filterAcceptedParticipantSessions } from "../server/security/session-visibility";
import { buildMiamMediatorPartyView, buildSessionParticipantCaseDetail } from "../server/security/case-visibility";
import { hasAcceptedSessionParticipantAccess, hasLeadEquivalentSessionAccess } from "../server/security/session-access";
import * as appointmentVisibility from "../server/security/appointment-visibility";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const context = {
  caseMediatorId: "lead-case",
  parties: [
    { id: "party-a", userId: "client-a", miamMediatorId: "miam-med", allocatedMediatorId: "allocated-med" },
  ],
  sessions: [{ id: "session-1", leadMediatorId: "session-lead" }],
  participants: [
    { sessionId: "session-1", userId: "co-med", role: "co_mediator", invitationStatus: "accepted" },
    { sessionId: "session-1", userId: "observer", role: "observer", invitationStatus: "accepted" },
    { sessionId: "session-1", userId: "declined", role: "co_mediator", invitationStatus: "declined" },
  ],
};

test("case access classification distinguishes every supported tier", () => {
  assert.deepEqual(classifyCaseAccessFromContext({ id: "admin", role: "superadmin" }, context), { tier: "admin" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "client-a", role: "client" }, context), { tier: "client_party", partyId: "party-a" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "lead-case", role: "mediator" }, context), { tier: "full_mediator" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "allocated-med", role: "mediator" }, context), { tier: "full_mediator" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "session-lead", role: "mediator" }, context), { tier: "full_mediator" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "co-med", role: "mediator" }, context), { tier: "session_co_mediator" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "miam-med", role: "mediator" }, context), { tier: "miam_only_mediator", partyIds: ["party-a"] });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "observer", role: "mediator" }, context), { tier: "session_observer" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "declined", role: "mediator" }, context), { tier: "none" });
  assert.deepEqual(classifyCaseAccessFromContext({ id: "unrelated", role: "mediator" }, context), { tier: "none" });
});

test("an accepted observer assignment takes precedence over MIAM-only access", () => {
  const overlappingContext = {
    ...context,
    parties: [{ ...context.parties[0], miamMediatorId: "observer" }],
  };
  assert.deepEqual(classifyCaseAccessFromContext({ id: "observer", role: "mediator" }, overlappingContext), { tier: "session_observer" });
});

test("MIAM mediator party DTO excludes link tokens, client IDs, and confidentiality fields", () => {
  const view = buildMiamMediatorPartyView({
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
    confidential: true,
    inviteToken: "secret",
    bookingToken: "secret",
    miamMediatorId: "miam-med",
  });
  assert.equal(view.email, "alice@example.test");
  assert.equal("clientId" in view, false);
  assert.equal("userId" in view, false);
  assert.equal("confidential" in view, false);
  assert.equal(JSON.stringify(view).includes("secret"), false);
});

test("session participants see only accepted sessions for their own role", () => {
  const sessions = [{ id: "session-1" }, { id: "session-2" }];
  const participants = [
    { sessionId: "session-1", userId: "observer", role: "observer", invitationStatus: "accepted" },
    { sessionId: "session-2", userId: "observer", role: "observer", invitationStatus: "declined" },
  ];
  assert.deepEqual(filterAcceptedParticipantSessions(sessions, participants, "observer", "observer").map((session) => session.id), ["session-1"]);
  assert.deepEqual(filterAcceptedParticipantSessions(sessions, [
    ...participants,
    { sessionId: "session-2", userId: "co-med", role: "co_mediator", invitationStatus: "accepted" },
  ], "co-med", "co_mediator").map((session) => session.id), ["session-2"]);
});

test("accepted co-mediator gets lead-equivalent access only for their assigned session", () => {
  const participants = [
    { sessionId: "session-1", userId: "co-med", role: "co_mediator", invitationStatus: "accepted" },
    { sessionId: "session-2", userId: "co-med", role: "co_mediator", invitationStatus: "invited" },
    { sessionId: "session-1", userId: "observer", role: "observer", invitationStatus: "accepted" },
  ];
  assert.equal(hasLeadEquivalentSessionAccess({ id: "session-1", leadMediatorId: "lead" }, participants, { id: "lead", role: "mediator" }), true);
  assert.equal(hasLeadEquivalentSessionAccess({ id: "session-1", leadMediatorId: "lead" }, participants, { id: "co-med", role: "mediator" }), true);
  assert.equal(hasLeadEquivalentSessionAccess({ id: "session-2", leadMediatorId: "lead" }, participants, { id: "co-med", role: "mediator" }), false);
  assert.equal(hasLeadEquivalentSessionAccess({ id: "session-1", leadMediatorId: "lead" }, participants, { id: "observer", role: "mediator" }), false);
});

test("participant scheduling reads are scoped to the exact accepted session", () => {
  const participants = [
    { sessionId: "session-1", userId: "observer", role: "observer", invitationStatus: "accepted" },
    { sessionId: "session-2", userId: "observer", role: "observer", invitationStatus: "declined" },
  ];
  assert.equal(hasAcceptedSessionParticipantAccess("session-1", participants, { id: "observer", role: "mediator" }), true);
  assert.equal(hasAcceptedSessionParticipantAccess("session-2", participants, { id: "observer", role: "mediator" }), false);
});

test("observer session DTO contains scheduling context but no operational records", () => {
  const view = buildObserverMediationSessionView({
    id: "session-1",
    caseId: "case-1",
    sessionNumber: 1,
    status: "confirmed",
    leadMediatorName: "Mediator One",
    participants: [{ userEmail: "co@example.test" }],
    outcomeNotes: "private outcome",
    noteSummary: { count: 2 },
    documents: [{ id: "doc-1" }],
    invoices: [{ id: "invoice-1" }],
    appointment: { id: "appt-1", caseId: "case-1", dateTime: new Date(), duration: 90, status: "confirmed", meetingLink: "https://private.test" },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  assert.deepEqual(Object.keys(view).sort(), [
    "appointment", "caseId", "createdAt", "id", "leadMediatorName", "participants", "sessionNumber", "status", "updatedAt",
  ].sort());
  assert.equal(JSON.stringify(view).includes("private outcome"), false);
  assert.equal(JSON.stringify(view).includes("private.test"), false);
});

test("co-mediator session DTO includes collaborative records but excludes finance and financial disclosure", () => {
  const today = new Date();
  const view = buildCoMediatorMediationSessionView({
    id: "session-1",
    caseId: "case-1",
    sessionNumber: 1,
    status: "confirmed",
    leadMediatorName: "Mediator One",
    participants: [{
      id: "participant-1",
      userId: "co-med",
      role: "co_mediator",
      invitationStatus: "accepted",
      userName: "Co Mediator",
      userEmail: "co@example.test",
      invitationTokenHash: "restricted-token",
      invitationDeclineNotes: "restricted-decline-note",
    }],
    outcome: "agreement",
    outcomeNotes: "ordinary outcome",
    noteSummary: { count: 2, latestNoteAuthor: "Internal User" },
    postSessionReviewNotes: "internal review",
    invoices: [{ id: "invoice-1" }],
    draftFinancialSchedule: { id: "financial-1" },
    proposal: {
      id: "proposal-1",
      proposedStartAt: new Date("2026-01-03T10:00:00Z"),
      proposedEndAt: new Date("2026-01-03T11:30:00Z"),
      expiresAt: new Date("2026-01-02T10:00:00Z"),
      status: "held",
      voucherFormRequired: false,
      recipients: [{ id: "recipient-1", recipientName: "Alice", recipientType: "client", responseStatus: "pending", tokenHash: "restricted-proposal-token" }],
    },
    requiredForms: [{ id: "form-1", partyId: "party-a", formType: "agreement_to_mediate_confidentiality", status: "signed", signatureIpAddress: "restricted-ip" }],
    documents: [
      { id: "ordinary-document", storageKey: "restricted-storage-key", fileUrl: "/uploads/restricted" },
      { id: "financial-document", financialDisclosureFolderId: "folder-1" },
    ],
    appointment: {
      id: "appointment-1",
      caseId: "case-1",
      partyId: null,
      dateTime: today,
      duration: 90,
      status: "confirmed",
      meetingLink: "https://meeting.example.test/private",
      paymentStatus: "paid",
    },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  } as any);

  assert.equal(view.outcomeNotes, "ordinary outcome");
  assert.deepEqual(view.documents?.map((document: any) => document.id), ["ordinary-document"]);
  assert.equal(view.noteSummary?.count, 2);
  assert.equal(view.postSessionReviewNotes, "internal review");
  assert.equal("invoices" in view, false);
  assert.equal("draftFinancialSchedule" in view, false);
  assert.equal("paymentStatus" in (view.appointment || {}), false);
  assert.equal("meetingLink" in (view.appointment || {}), false);
  assert.equal(view.appointment?.hasMeetingLink, true);
  assert.equal(view.appointment?.canJoin, true);
  assert.equal(JSON.stringify(view).includes("restricted-token"), false);
  assert.equal(JSON.stringify(view).includes("restricted-decline-note"), false);
  assert.equal(JSON.stringify(view).includes("restricted-proposal-token"), false);
  assert.equal(JSON.stringify(view).includes("restricted-ip"), false);
  assert.equal(JSON.stringify(view).includes("restricted-storage-key"), false);
  assert.equal(view.documents?.[0]?.fileUrl, "/api/case-documents/ordinary-document/download");
});

test("finance access is limited to admins, full mediators, and the client party", () => {
  assert.equal(hasFinancialCaseAccess({ tier: "admin" }), true);
  assert.equal(hasFinancialCaseAccess({ tier: "full_mediator" }), true);
  assert.equal(hasFinancialCaseAccess({ tier: "session_co_mediator" }), false);
  assert.equal(hasFinancialCaseAccess({ tier: "client_party", partyId: "party-a" }), true);
  assert.equal(hasFinancialCaseAccess({ tier: "miam_only_mediator", partyIds: ["party-a"] }), false);
  assert.equal(hasFinancialCaseAccess({ tier: "session_observer" }), false);
  assert.equal(hasFinancialCaseAccess({ tier: "none" }), false);
});

test("session participant case DTO exposes safe contacts and MIAM summaries only", () => {
  const view = buildSessionParticipantCaseDetail({
    caseRecord: {
      id: "case-1",
      caseRef: "BFM-1",
      stage: "Mediation",
      status: "Active",
      issueType: "Family",
      mediationCategory: "Family",
      familySubType: "AIM",
      leadSource: "Website",
      safeguardingStatus: "concern",
      safeguardingNotes: "restricted",
      confidential: true,
      notes: "internal",
      manualRevenuePence: 10000,
      createdAt: new Date("2026-01-01"),
      lastUpdated: new Date("2026-01-02"),
    },
    parties: [{
      id: "party-a",
      caseId: "case-1",
      role: "A",
      firstName: "Alice",
      lastName: "Able",
      email: "alice@example.test",
      phone: "7000000000",
      phoneCode: "+44",
      addressLine1: "restricted address",
      inviteToken: "restricted",
      bookingToken: "restricted",
      confidential: true,
    }],
    mediatorName: "Case Lead",
    access: "co_mediator",
    miamRecords: [{
      id: "miam-1",
      partyId: "party-a",
      approvalStatus: "approved",
      suitableForMediation: "Yes",
      sessionDate: "2026-01-10",
      submittedAt: new Date("2026-01-10"),
      domesticAbuseNotes: "restricted MIAM answer",
    }],
    miamValidity: { parties: [{ partyId: "party-a", valid: true, expired: false, expiresAt: new Date("2027-01-10") }] },
  });

  assert.equal(view.caseRef, "BFM-1");
  assert.equal(view.parties[0].email, "alice@example.test");
  assert.equal(view.isSessionCoMediator, true);
  assert.equal(view.sessionAccess, "co_mediator");
  assert.equal(view.miamSummaries[0].approvalStatus, "approved");
  assert.equal(view.miamSummaries[0].suitableForMediation, "Yes");
  assert.equal("addressLine1" in view.parties[0], false);
  assert.equal("safeguardingStatus" in view, false);
  assert.equal("safeguardingNotes" in view, false);
  assert.equal("confidential" in view, false);
  assert.equal("notes" in view, false);
  assert.equal("manualRevenuePence" in view, false);
  assert.equal(JSON.stringify(view).includes("restricted"), false);
});

test("accepted co-mediator appointment DTO excludes finance and internal fields", () => {
  const buildView = (appointmentVisibility as any).buildCoMediatorAppointmentView;
  assert.equal(typeof buildView, "function");
  const view = buildView({
    id: "appointment-1",
    caseId: "case-1",
    partyId: "party-a",
    dateTime: new Date("2026-01-03T10:00:00Z"),
    duration: 90,
    status: "confirmed",
    serviceName: "Mediation Session",
    mediatorName: "Lead Mediator",
    caseReference: "BFM-1",
    meetingLink: "https://meeting.example.test/private",
    canJoin: true,
    paymentStatus: "paid",
    pricePence: 25000,
    notes: "internal appointment note",
    xeroInvoice: { invoiceNumber: "INV-1" },
  });

  assert.equal(view.partyId, "party-a");
  assert.equal(view.hasMeetingLink, true);
  assert.equal(view.canJoin, true);
  assert.equal("meetingLink" in view, false);
  assert.equal("paymentStatus" in view, false);
  assert.equal("pricePence" in view, false);
  assert.equal("notes" in view, false);
  assert.equal("xeroInvoice" in view, false);
});

test("co-mediator session access is editable while operational case data remains restricted", () => {
  const appointmentRoutes = read("../server/routes/appointment.routes.ts");
  const sessionService = read("../server/services/mediation-session.service.ts");
  const caseDetail = read("../client/src/pages/case-detail.tsx");

  assert.match(appointmentRoutes, /participantAppointmentIds\(caseId, user\.id, "co_mediator"\)/);
  assert.match(appointmentRoutes, /forCoMediator: access\.tier === "session_co_mediator" \|\| access\.tier === "session_observer"/);
  assert.match(appointmentRoutes, /tier === "session_observer"[\s\S]*Calendar event details are not available to observers/);
  const lifecycleRoutes = appointmentRoutes.slice(appointmentRoutes.indexOf('router.patch("/api/appointments/:id/confirm"'));
  assert.equal((lifecycleRoutes.match(/canManageAppointment\(user, req\.params\.id\)/g) || []).length >= 3, true);
  assert.doesNotMatch(sessionService, /Co-mediator access is read-only and excludes internal session records/);
  assert.match(sessionService, /Co-mediator Documents access is read-only/);
  assert.match(sessionService, /access === "co_mediator" && !\(await this\.hasLeadEquivalentAccess\(session, actor\)\)/);
  assert.match(sessionService, /access === "full"[\s\S]*access === "co_mediator" && await this\.hasLeadEquivalentAccess\(existing, actor\)/);
  assert.match(sessionService, /const access = await this\.getCaseAccess\(session\.caseId, actor\)[\s\S]*if \(access === "full"\) return true/);
  const sessionRoutes = read("../server/routes/mediation-session.routes.ts");
  assert.match(sessionRoutes, /sanitizeSessionMutationForActor/);
  assert.match(sessionRoutes, /sanitizeRequiredFormMutationForActor/);
  assert.match(sessionRoutes, /proposalLinks: access === "co_mediator" \? \[\] : result\.proposalLinks/);
  assert.match(caseDetail, /sessionAccess === "co_mediator"/);
  assert.match(caseDetail, /!isSessionCoMediator && isFinancialDisclosureEligibleCaseDetail/);
});
