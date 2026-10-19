import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://localhost/bfm_test";

async function loadDependencies() {
  const [{ storage }, { mediationSessionService }] = await Promise.all([
    import("../server/storage"),
    import("../server/services/mediation-session.service"),
  ]);
  return { storage, mediationSessionService };
}

test("mediation session access follows the shared case access tiers", async (t) => {
  const { storage, mediationSessionService } = await loadDependencies();
  const caseId = "case-1";

  t.mock.method(storage, "getCase", async () => ({ id: caseId, mediatorId: "case-lead" }) as any);
  t.mock.method(storage, "listPartiesByCase", async () => ([
    {
      id: "party-a",
      caseId,
      userId: "client-a",
      miamMediatorId: "miam-only",
      allocatedMediatorId: "allocated-mediator",
    },
  ]) as any);
  t.mock.method(storage, "listMediationSessionsByCase", async () => ([
    { id: "session-1", caseId, leadMediatorId: "session-lead" },
  ]) as any);
  t.mock.method(storage, "listMediationSessionParticipantsBySessionIds", async () => ([
    { sessionId: "session-1", userId: "co-mediator", role: "co_mediator", invitationStatus: "accepted" },
    { sessionId: "session-1", userId: "observer", role: "observer", invitationStatus: "accepted" },
    { sessionId: "session-1", userId: "declined", role: "co_mediator", invitationStatus: "declined" },
  ]) as any);

  const accessByUser = Object.fromEntries(await Promise.all([
    "case-lead",
    "allocated-mediator",
    "session-lead",
    "co-mediator",
    "observer",
    "miam-only",
    "declined",
    "unrelated",
  ].map(async (id) => [id, await mediationSessionService.getCaseAccess(caseId, { id, role: "mediator" })])));

  assert.deepEqual(accessByUser, {
    "case-lead": "full",
    "allocated-mediator": "full",
    "session-lead": "full",
    "co-mediator": "co_mediator",
    observer: "observer",
    "miam-only": "none",
    declined: "none",
    unrelated: "none",
  });
});

test("case lead receives live ready MIAM state before the first mediation session", async (t) => {
  const { storage, mediationSessionService } = await loadDependencies();
  const caseId = "case-with-approved-miam";
  const partyId = "party-a";

  t.mock.method(storage, "getCase", async () => ({ id: caseId, mediatorId: "case-lead" }) as any);
  t.mock.method(storage, "listPartiesByCase", async () => ([
    {
      id: partyId,
      caseId,
      role: "A",
      firstName: "Alex",
      lastName: "Example",
      userId: "client-a",
      miamMediatorId: "miam-mediator",
      allocatedMediatorId: null,
    },
  ]) as any);
  t.mock.method(storage, "listMiamRecordsByCase", async () => ([
    {
      id: "miam-1",
      caseId,
      partyId,
      approvalStatus: "approved",
      suitableForMediation: "yes",
      supersededAt: null,
    },
  ]) as any);
  t.mock.method(storage, "listMediationSessionsByCase", async () => []);
  t.mock.method(storage, "listMediationSessionParticipantsBySessionIds", async () => []);

  const result = await mediationSessionService.listForCase(caseId, { id: "case-lead", role: "mediator" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.access, "full");
  assert.deepEqual(result.readiness, { ready: true, issues: [] });
  assert.deepEqual(result.sessions, []);
  assert.deepEqual(result.summary, { numberOfSessions: 0, totalMediationHours: 0 });
});
