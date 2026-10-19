import { ilike, inArray, or, sql } from "drizzle-orm";
import { cases, clients, users } from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { classifyCaseAccess } from "../security/case-access-policy";

export async function caseTaskOptions(caseId: string) {
  const caseRecord = await storage.getCase(caseId);
  if (!caseRecord) return null;
  const caseParties = await storage.listPartiesByCase(caseId);
  const clientIds = caseParties.map((party) => party.clientId).filter((id): id is string => !!id);
  const clientRows = clientIds.length ? await db.select({ firstName: clients.firstName, lastName: clients.lastName, email: clients.email })
    .from(clients).where(inArray(clients.id, clientIds)) : [];
  const candidateIds = new Set<string>();
  if (caseRecord.mediatorId) candidateIds.add(caseRecord.mediatorId);
  for (const party of caseParties) {
    if (party.allocatedMediatorId) candidateIds.add(party.allocatedMediatorId);
    if (party.miamMediatorId) candidateIds.add(party.miamMediatorId);
  }
  const sessions = await storage.listMediationSessionsByCase(caseId);
  for (const session of sessions) if (session.leadMediatorId) candidateIds.add(session.leadMediatorId);
  const participants = await storage.listMediationSessionParticipantsBySessionIds(sessions.map((session) => session.id));
  for (const participant of participants) if (participant.invitationStatus === "accepted") candidateIds.add(participant.userId);
  const candidates = candidateIds.size ? await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status })
    .from(users).where(inArray(users.id, Array.from(candidateIds))) : [];
  const mediatorOptions = await Promise.all(candidates.filter((person) => person.role === "mediator" && person.status === "active")
    .map(async (person) => ({ ...person, access: await classifyCaseAccess(caseId, person) })));
  return {
    id: caseRecord.id,
    caseRef: caseRecord.caseRef,
    hasLeadMediator: !!caseRecord.mediatorId || sessions.some((session) => !!session.leadMediatorId),
    clients: clientRows.map((client) => ({ name: `${client.firstName} ${client.lastName}`.trim(), email: client.email })),
    mediators: mediatorOptions.filter((person) => person.access.tier !== "none").map((person) => ({
      id: person.id, name: person.name, email: person.email, caseRole: person.access.tier,
    })),
  };
}

export async function searchTaskCases(query: string) {
  const term = query.trim();
  if (!term) return [];
  const match = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.select({ id: cases.id }).from(cases).where(or(
    ilike(cases.caseRef, match),
    sql`EXISTS (SELECT 1 FROM parties p JOIN clients cl ON cl.id = p.client_id WHERE p.case_id = ${cases.id} AND (cl.first_name ILIKE ${match} OR cl.last_name ILIKE ${match} OR (cl.first_name || ' ' || cl.last_name) ILIKE ${match} OR cl.email ILIKE ${match}))`,
    sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${cases.mediatorId} AND u.email ILIKE ${match})`,
    sql`EXISTS (SELECT 1 FROM parties p JOIN users u ON u.id IN (p.miam_mediator_id, p.allocated_mediator_id) WHERE p.case_id = ${cases.id} AND u.email ILIKE ${match})`,
    sql`EXISTS (SELECT 1 FROM mediation_sessions ms JOIN users u ON u.id = ms.lead_mediator_id WHERE ms.case_id = ${cases.id} AND u.email ILIKE ${match})`,
    sql`EXISTS (SELECT 1 FROM mediation_sessions ms JOIN mediation_session_participants msp ON msp.session_id = ms.id JOIN users u ON u.id = msp.user_id WHERE ms.case_id = ${cases.id} AND msp.invitation_status = 'accepted' AND u.email ILIKE ${match})`,
  )).limit(20);
  return (await Promise.all(rows.map((row) => caseTaskOptions(row.id)))).filter((row) => row !== null);
}
