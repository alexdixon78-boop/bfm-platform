/**
 * Regression checks for the case Mediation Sessions allocation workflow.
 *
 * Run with: npx tsx tests/mediation-session-allocation.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schemaSource = read("../shared/schema.ts");
const bootstrapSource = read("../server/db-bootstrap.ts");
const routeSource = read("../server/routes/mediation-session.routes.ts");
const serviceSource = read("../server/services/mediation-session.service.ts");
const caseServiceSource = read("../server/services/case.service.ts");
const caseRepositorySource = read("../server/repositories/case.repository.ts");
const caseDetailSource = read("../client/src/pages/case-detail.tsx");

function readBuiltClientBundle(): string | null {
  const assetsDir = new URL("../dist/public/assets/", import.meta.url);
  if (!existsSync(assetsDir)) return null;
  const jsAsset = readdirSync(assetsDir).find((file) => /^index-.*\.js$/.test(file));
  return jsAsset ? readFileSync(new URL(jsAsset, assetsDir), "utf8") : null;
}

test("schema and bootstrap define first-class mediation session tables", () => {
  assert.match(schemaSource, /export const mediationSessions = pgTable\("mediation_sessions"/);
  assert.match(schemaSource, /export const mediationSessionParticipants = pgTable\("mediation_session_participants"/);
  assert.match(schemaSource, /MEDIATION_SESSION_OUTCOMES[\s\S]*next_session_needed[\s\S]*unsuitable/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS mediation_sessions/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS mediation_session_participants/);
});

test("routes expose allocation, reallocation, outcome, and mediator options endpoints", () => {
  assert.match(routeSource, /router\.get\("\/api\/cases\/:id\/mediation-sessions"/);
  assert.match(routeSource, /router\.post\("\/api\/cases\/:id\/mediation-sessions"/);
  assert.match(routeSource, /router\.patch\("\/api\/mediation-sessions\/:id\/allocation"/);
  assert.match(routeSource, /router\.patch\("\/api\/mediation-sessions\/:id\/outcome"/);
  assert.match(routeSource, /router\.patch\("\/api\/mediation-sessions\/:id\/outcome", requirePermission\("cases", "view"\)/);
  assert.match(routeSource, /router\.patch\("\/api\/mediation-sessions\/:id\/attendance"/);
  assert.match(routeSource, /router\.get\("\/api\/mediation-sessions\/mediator-options"/);
  assert.match(routeSource, /listMediationRoleOptions/);
});

test("allocation is admin-gated and requires approved suitable MIAMs plus per-service qualified mediation-session mediators", () => {
  assert.match(serviceSource, /user\.role === "superadmin" \|\| user\.role === "subadmin"/);
  assert.match(serviceSource, /record\.approvalStatus !== "approved"/);
  assert.match(serviceSource, /!isSuitable\(record\.suitableForMediation\)/);
  assert.match(serviceSource, /Mediation session allocation is blocked until every party has an approved suitable MIAM/);
  assert.match(serviceSource, /listMediationRoleOptions/);
  assert.match(serviceSource, /validateMediatorAssignment\(input\.leadMediatorId, "lead_mediator", "Lead mediator"\)/);
  assert.match(serviceSource, /validateMediatorAssignment\(id, "co_mediator", "Co-mediator"\)/);
  assert.match(serviceSource, /validateMediatorAssignment\(id, "observer", "Observer"\)/);
  assert.match(serviceSource, /mediatorServiceApprovals/);
  assert.match(serviceSource, /mediatorServiceTypes/);
  assert.match(serviceSource, /mediatorServiceTypes\.mediationRoleQualification/);
  assert.doesNotMatch(serviceSource, /mediatorProfiles\.mediationRoleQualification/);
  assert.match(serviceSource, /getEffectiveApprovalStatus\(row\) === "approved"/);
  assert.match(serviceSource, /getLeadMediatorAvailabilityContext[\s\S]*validateMediatorAssignment\(mediator\.id, "lead_mediator", "Lead mediator"\)/);
  assert.match(serviceSource, /approved Mediation Sessions service approval/);
  assert.match(serviceSource, /action: "add_session_participant"/);
  assert.match(serviceSource, /action: "remove_session_participant"/);
});

test("leads and accepted co-mediators get session access, and observers are redacted", () => {
  const accessPolicySource = read("../server/security/case-access-policy.ts");

  assert.match(caseRepositorySource, /msp\.role IN \('lead_mediator', 'co_mediator', 'observer'\)[\s\S]*msp\.invitation_status = 'accepted'/);
  assert.match(caseServiceSource, /classifyCaseAccess\(c\.id, user\)/);
  assert.match(caseServiceSource, /access\.tier === "session_observer"/);
  assert.match(caseServiceSource, /sessionAccess = access\.tier === "session_co_mediator" \? "co_mediator" : "observer"/);
  assert.match(accessPolicySource, /participant\.role === "co_mediator"[\s\S]*session_co_mediator/);
  assert.match(accessPolicySource, /participant\.role === "observer"/);
  assert.match(serviceSource, /const caseAccess = await classifyCaseAccess\(caseId, user\)/);
  assert.match(serviceSource, /caseAccess\.tier === "full_mediator"[\s\S]*return "full"/);
  assert.match(serviceSource, /caseAccess\.tier === "session_co_mediator"[\s\S]*return "co_mediator"/);
  assert.match(serviceSource, /caseAccess\.tier === "session_observer"[\s\S]*return "observer"/);
});

test("admins, assigned leads, and accepted assigned co-mediators can record outcomes", () => {
  assert.match(serviceSource, /hasLeadEquivalentAccess\(existing, actor\)/);
  assert.match(serviceSource, /Only admins, the assigned lead mediator, and accepted co-mediators can record mediation session outcomes/);
  assert.doesNotMatch(serviceSource, /if \(!isAdmin\(actor\)\) return \{ ok: false, error: "Only superadmins and subadmins can record mediation session outcomes"/);
  assert.match(serviceSource, /status: "completed"/);
  assert.match(serviceSource, /completedBy: actor\.id/);
});

test("co-mediators and observers are invited before receiving case access", () => {
  assert.match(schemaSource, /MEDIATION_SESSION_PARTICIPANT_INVITATION_STATUSES[\s\S]*invited[\s\S]*accepted[\s\S]*declined/);
  assert.match(schemaSource, /invitationStatus: text\("invitation_status"\)\.notNull\(\)\.default\("accepted"\)/);
  assert.match(schemaSource, /invitationTokenHash: text\("invitation_token_hash"\)\.unique\(\)/);
  assert.match(bootstrapSource, /ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_status TEXT NOT NULL DEFAULT 'accepted'/);
  assert.match(serviceSource, /role: "co_mediator" as const,[\s\S]*invitationStatus: "invited"/);
  assert.match(serviceSource, /role: "observer" as const,[\s\S]*invitationStatus: "invited"/);
  assert.match(serviceSource, /sendMediationSessionParticipantInviteEmail/);
  assert.match(serviceSource, /mediation_session_participant_invitation_accepted/);
  assert.match(serviceSource, /mediation_session_participant_invitation_declined/);
});

test("allocation updates are allowed for non-cancelled sessions and blocked for cancelled sessions", () => {
  assert.match(serviceSource, /existing\.status === "cancelled"/);
  assert.match(serviceSource, /Cancelled mediation sessions cannot be reallocated/);
  assert.match(serviceSource, /cancelled|expired/);
  assert.match(serviceSource, /Linked appointments that are cancelled or expired cannot be reallocated/);
  assert.doesNotMatch(serviceSource, /if \(activeProposal && activeProposal\.status === "held"\) await this\.createParticipantInviteLinks/);
});

test("participant invitation links stay usable after the slot proposal is accepted or scheduled", () => {
  assert.match(serviceSource, /createParticipantInviteLinks\(updated, activeProposal, \{ allowInactiveProposal: true \}\)/);
  assert.match(serviceSource, /recipient\.recipientType === "mediator_participant"[\s\S]*return \{ active: true \}/);
  assert.match(serviceSource, /proposal\.status !== "held" && proposal\.status !== "accepted"/);
});

test("participant acceptance and removal synchronize mediator calendar attendees without touching the BFM client event", () => {
  const calendarSource = read("../server/services/google-calendar.service.ts");
  assert.match(calendarSource, /syncMediatorBookingEventAttendees/);
  assert.match(calendarSource, /calendar\.events\.get/);
  assert.match(calendarSource, /calendar\.events\.patch/);
  assert.match(calendarSource, /sendUpdates: "all"/);
  assert.match(serviceSource, /syncSessionParticipantCalendarAttendee/);
  assert.match(serviceSource, /syncRemovedSessionParticipantCalendarAttendee/);
  assert.match(serviceSource, /mediation_session_participant_calendar_sync_failed/);
  assert.doesNotMatch(serviceSource, /patchBfmEvent\([^)]*participant/);
});

test("case detail renders MIAM-style tabs plus sessions for observers", () => {
  assert.match(caseDetailSource, /data-testid="tab-mediation-sessions"/);
  assert.match(caseDetailSource, /function MediationSessionsTab/);
  assert.match(caseDetailSource, /caseData\?\.sessionAccess === "full"/);
  assert.match(caseDetailSource, /caseData\?\.sessionAccess === "observer"/);
  assert.match(caseDetailSource, /isSessionObserverOnly/);
  assert.doesNotMatch(caseDetailSource, /renderedActiveTab = isSessionObserverOnly \? "mediation-sessions" : activeTab/);
  assert.match(caseDetailSource, /isSessionParticipant/);
  assert.match(caseDetailSource, /SessionParticipantMiamSummary/);
  assert.match(caseDetailSource, /card-mediation-readiness/);
  assert.match(caseDetailSource, /button-save-session-allocation/);
  assert.match(caseDetailSource, /const canRecordOutcome = isAdmin \|\| user\?\.id === session\.leadMediatorId/);
  assert.match(caseDetailSource, /button-record-session-outcome/);
  assert.match(caseDetailSource, /\{canRecordOutcome && \(/);
  assert.doesNotMatch(caseDetailSource, /\{isAdmin && \(\s*<div className="rounded-md border bg-muted\/20 p-3 space-y-3">[\s\S]*button-record-session-outcome/);
});

test("case detail lets admins manage existing session teams without MIAM readiness gating", () => {
  assert.match(caseDetailSource, /const isEditingAllocation = Boolean\(editingSessionId\)/);
  assert.match(caseDetailSource, /const allocationFormBlocked = !isEditingAllocation && !readiness\?\.ready/);
  assert.match(caseDetailSource, /disabled=\{allocationFormBlocked \|\| allocationMutation\.isPending\}/);
  assert.match(caseDetailSource, /Manage team/);
  assert.match(caseDetailSource, /onClick=\{\(\) => loadAllocation\(session\)\}/);
  assert.match(caseDetailSource, /allocationFormRef\.current\?\.scrollIntoView/);
  assert.match(caseDetailSource, /allocationFormRef\.current\?\.focus/);
  assert.match(caseDetailSource, /editingSession \? `Manage team for Session \$\{editingSession\.sessionNumber\}`/);
  assert.match(caseDetailSource, /data-testid="notice-editing-session-allocation"/);
  assert.match(caseDetailSource, /selectedLeadIsApproved/);
  assert.match(caseDetailSource, /currentLeadIsStale/);
  assert.match(caseDetailSource, /staleSelectedCoMediatorIds/);
  assert.match(caseDetailSource, /staleSelectedObserverIds/);
  assert.match(caseDetailSource, /data-testid="warning-stale-session-team"/);
  assert.match(caseDetailSource, /hasStaleSelectedParticipants/);
  assert.match(caseDetailSource, /SelectItem value=\{leadMediatorId\} disabled/);
  assert.match(caseDetailSource, /session\.status !== "cancelled"[\s\S]*button-edit-session/);
  assert.doesNotMatch(caseDetailSource, /disabled=\{!readiness\?\.ready \|\| allocationMutation\.isPending\}/);
  assert.doesNotMatch(caseDetailSource, /disabled=\{!readiness\?\.ready \|\| !leadMediatorId \|\| allocationMutation\.isPending\}/);
});

test("mediation sessions support party-level no-show attendance with scoped visibility", () => {
  assert.match(schemaSource, /export const mediationSessionPartyAttendance = pgTable\("mediation_session_party_attendance"/);
  assert.match(schemaSource, /MEDIATION_SESSION_PARTY_ATTENDANCE_STATUSES[\s\S]*no_show/);
  assert.match(schemaSource, /mediation_session_party_attendance_session_party_unique/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS mediation_session_party_attendance/);
  assert.match(serviceSource, /recordPartyAttendance/);
  assert.match(serviceSource, /Only assigned session mediators and admins can update attendance/);
  assert.match(serviceSource, /partyIds\.every\(\(partyId\) => parties\.some\(\(party\) => party\.id === partyId\)\)/);
  assert.match(serviceSource, /mediation_session_attendance_updated/);
  assert.match(routeSource, /attendanceSchema/);
  assert.match(routeSource, /noShowPartyIds: z\.array\(z\.string\(\)\.min\(1\)\)/);
  assert.match(caseDetailSource, /partyAttendance/);
  assert.match(caseDetailSource, /Client attendance/);
  assert.match(caseDetailSource, /Did not attend/);
  assert.match(caseDetailSource, /You were marked as not attending this session\./);
});

test("built client bundle includes session access tab visibility", { skip: readBuiltClientBundle() === null }, () => {
  const builtClientBundle = readBuiltClientBundle();
  assert.ok(builtClientBundle);
  assert.match(builtClientBundle, /sessionAccess/);
  assert.match(builtClientBundle, /tab-mediation-sessions/);
});

test("case progress derives mediation readiness and sessions from live records", () => {
  assert.match(caseDetailSource, /\/api\/miam-records\/case\/\$\{caseId\}/);
  assert.match(caseDetailSource, /\/api\/cases\/\$\{caseId\}\/mediation-sessions/);
  assert.match(caseDetailSource, /deriveMiamCellStateFromRecord/);
  assert.match(caseDetailSource, /Case suitable for mediation/);
  assert.match(caseDetailSource, /case-progress-mediation-readiness-blockers/);
  assert.doesNotMatch(caseDetailSource, /MAIN_WORKFLOW_STAGES\.slice\(14, 25\)/);
  assert.match(caseDetailSource, /displayLabel = `S\$\{item\.session\.sessionNumber\}`/);
  assert.match(caseDetailSource, /item\.session\.status === "completed"/);
  assert.match(caseDetailSource, /Ready to allocate S\$\{sessions\.length \+ 1\}/);
  assert.match(caseDetailSource, /Recording an outcome marks this mediation session as completed\./);
});

test("mediation session responses include summary totals and the tab displays them", () => {
  assert.match(serviceSource, /MediationSessionsSummary/);
  assert.match(serviceSource, /numberOfSessions/);
  assert.match(serviceSource, /totalMediationHours/);
  assert.match(serviceSource, /calculateMediationSessionsSummary/);
  assert.match(routeSource, /summary: result\.summary/);
  assert.match(caseDetailSource, /summary\?: \{ numberOfSessions: number; totalMediationHours: number \}/);
  assert.match(caseDetailSource, /data-testid="mediation-session-summary-count"/);
  assert.match(caseDetailSource, /data-testid="mediation-session-summary-hours"/);
  assert.match(caseDetailSource, /Total mediation hours/);
});

test("case detail keeps session cancellation separate from no-show attendance", () => {
  assert.match(caseDetailSource, /cancelSessionMutation/);
  assert.match(caseDetailSource, /\/api\/mediation-sessions\/\$\{sessionId\}\/cancel/);
  assert.match(caseDetailSource, /button-cancel-mediation-session/);
  assert.match(caseDetailSource, /dialog-cancel-mediation-session/);
  assert.match(caseDetailSource, /textarea-cancel-mediation-session-reason/);
  assert.match(caseDetailSource, /No-show clients are not automatically refunded/);
  assert.match(caseDetailSource, /This records attendance only; it does not cancel the session\./);
});

test("mediation sessions tab renders newest sessions first in a multi-open accordion", () => {
  assert.match(caseDetailSource, /import \{ Accordion, AccordionContent, AccordionItem, AccordionTrigger \} from "@\/components\/ui\/accordion";/);
  assert.match(caseDetailSource, /sessionsNewestFirst = \[\.\.\.sessions\]\.sort\(\(a, b\) => b\.sessionNumber - a\.sessionNumber\)/);
  assert.match(caseDetailSource, /latestSessionAccordionValue = sessionsNewestFirst\[0\] \? `session-\$\{sessionsNewestFirst\[0\]\.id\}` : undefined/);
  assert.match(caseDetailSource, /<Accordion\s+type="multiple"[\s\S]*data-testid="mediation-session-accordion"/);
  assert.match(caseDetailSource, /defaultValue=\{latestSessionAccordionValue \? \[latestSessionAccordionValue\] : \[\]\}/);
  assert.match(caseDetailSource, /sessionsNewestFirst\.map\(\(session\) =>/);
  assert.match(caseDetailSource, /data-testid=\{`mediation-session-trigger-\$\{session\.id\}`\}/);
  assert.match(caseDetailSource, /data-testid=\{`mediation-session-content-\$\{session\.id\}`\}/);
  assert.match(caseDetailSource, /session\.appointment \? formatSessionDateTime\(session\.appointment\.dateTime\) : session\.proposal \? formatSessionDateTime\(session\.proposal\.proposedStartAt\) : "No time proposed"/);
  assert.match(caseDetailSource, /const sessions = \[\.\.\.\(mediationSessionsProgress\?\.sessions \?\? \[\]\)\]\.sort\(\(a, b\) => a\.sessionNumber - b\.sessionNumber\)/);
});

test("allocation success immediately upserts returned mediation session into case-detail query cache", () => {
  assert.match(caseDetailSource, /upsertMediationSessionCache/);
  assert.match(caseDetailSource, /queryClient\.setQueryData<MediationSessionsResponse \| undefined>\(\s*\["\/api\/cases", caseId, "mediation-sessions"\]/);
  assert.match(caseDetailSource, /current\.sessions\.some\(\(session\) => session\.id === updatedSession\.id\)/);
  assert.match(caseDetailSource, /session\.id === updatedSession\.id \? updatedSession : session/);
  assert.match(caseDetailSource, /\[\.\.\.current\.sessions, updatedSession\]/);
  assert.match(caseDetailSource, /onSuccess: \(data: MediationSessionView\) =>/);
  assert.match(caseDetailSource, /upsertMediationSessionCache\(data\)/);
  assert.match(caseDetailSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId, "mediation-sessions"\] \}\)/);
  assert.match(caseDetailSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId\] \}\)/);
  assert.match(caseDetailSource, /queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases"\] \}\)/);
});
