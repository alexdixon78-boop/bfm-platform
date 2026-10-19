import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("client dashboard route is client-only and uses the dashboard permission gate", () => {
  const routes = read("../server/routes/dashboard.routes.ts");

  assert.match(routes, /\/api\/dashboard\/client/);
  assert.match(routes, /requirePermission\("dashboard", "view"\)/);
  assert.match(routes, /Use the client dashboard endpoint/);
  assert.match(routes, /user\.role !== "client"/);
  assert.match(routes, /dashboardService\.getClientDashboard\(user\)/);
});

test("client dashboard service scopes data through authenticated client parties", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /async getClientDashboard\(user: DashboardUser\)/);
  assert.match(service, /user\.role !== "client"/);
  assert.match(service, /storage\.listPartiesByUserId\(user\.id\)/);
  assert.match(service, /partiesByCaseId/);
  assert.match(service, /c\.status === "Archived" \|\| c\.status === "Closed"/);
  assert.match(service, /inArray\(appointments\.partyId, partyIds\)/);
  assert.match(service, /inArray\(caseInvoices\.billToClientId, clientIds\)/);
  assert.match(service, /eq\(notifications\.recipientId, user\.id\)/);
  assert.match(service, /eq\(notifications\.recipientRole, "client"\)/);
});

test("client dashboard separates confirmed next appointments from pending holds", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /gte\(appointments\.dateTime, clientDashboardAppointmentStart\)/);
  assert.doesNotMatch(service, /gt\(appointments\.dateTime, now\)/);
  assert.match(service, /inArray\(appointments\.status, ACTIVE_APPT_STATUSES/);
  assert.match(service, /nextConfirmed = caseAppointments\.find\(\(appt\) => appt\.status === "confirmed"\)/);
  assert.match(service, /pending = caseAppointments\.find\(\(appt\) => appt\.status === "hold" \|\| appt\.status === "held"\)/);
  assert.match(service, /nextConfirmedAppointment: nextConfirmed \? clientAppointmentFromRow\(nextConfirmed\) : null/);
  assert.match(service, /pendingAppointment: pending \? clientAppointmentFromRow\(pending\) : null/);
  assert.match(service, /sessionType: row\.serviceTypeName \?\? "Appointment"/);
  assert.match(service, /status: statusLabel\(row\.status, row\.paymentStatus\)/);
});

test("client dashboard keeps same-day confirmed sessions visible after they start", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /const clientDashboardAppointmentStart = startOfToday\(\)/);
  assert.match(service, /gte\(appointments\.dateTime, clientDashboardAppointmentStart\)/);
  assert.match(service, /canClientJoinAppointment\(row\)/);
});

test("dashboard BFM action counts include mediation-session acknowledgement tasks", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /const ADMIN_TASK_TYPES = \["task", "appointment_cancellation_request", "mediation_session_held_acknowledgement", "mediation_session_confirmed_acknowledgement", "mediation_session_cancelled_acknowledgement", "mediation_session_expired_acknowledgement", "mediation_session_reschedule_requested", "mediation_session_next_session_requested"\] as const/);
  assert.match(service, /inArray\(notifications\.type, ADMIN_TASK_TYPES as unknown as string\[\]\)/);
});

test("client dashboard appointment payload hides raw meeting links and exposes join metadata", () => {
  const service = read("../server/services/dashboard.service.ts");
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(service, /hasMeetingLink: Boolean\(row\.meetingLink\)/);
  assert.match(service, /canJoin: canClientJoinAppointment\(row\)/);
  assert.doesNotMatch(service, /meetingLink: row\.meetingLink/);
  assert.match(page, /hasMeetingLink: boolean/);
  assert.match(page, /canJoin: boolean/);
  assert.doesNotMatch(page, /meetingLink: string \| null/);
});

test("client dashboard derives only supported open actions", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /ne\(notifications\.status, "completed"\)/);
  assert.match(service, /eq\(notifications\.type, "task"\)/);
  assert.match(service, /isClientDemographicComplete\(demographic\)/);
  assert.match(service, /title: "Complete demographic information"/);
  assert.match(service, /gt\(caseInvoices\.outstandingPence, 0\)/);
  assert.match(service, /title: "Pay outstanding invoice"/);
  assert.match(service, /SIGNED_FORM_PENDING_STAGES/);
  assert.match(service, /title: "Sign required forms"/);
  assert.doesNotMatch(service, /title: "Upload requested documents"[\s\S]*source: "derived"/);
});

test("client dashboard derives mediation-session form actions to the session tab", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /listPartyRequiredFormsByPartyIds\(partyIds\)/);
  assert.match(service, /const ACTIVE_MEDIATION_SESSION_FORM_STATUSES = \["pending", "allocated", "scheduled"\] as const/);
  assert.match(service, /activeMediationSessionIds/);
  assert.match(service, /caseHasActiveMediationSession/);
  assert.doesNotMatch(service, /if \(!form\.mediationSessionId \|\| form\.status === "signed"\) continue/);
  assert.match(service, /form\.status === "signed"/);
  assert.match(service, /\? "Sign Confidentiality \+ Agreement to Mediate"/);
  assert.match(service, /href: `\/cases\/\$\{row\.case\.id\}\?tab=mediation-sessions`/);
});

test("client dashboard ignores legacy explicit mediation form task notifications", () => {
  const service = read("../server/services/dashboard.service.ts");

  assert.match(service, /function isMediationSessionFormTask/);
  assert.match(service, /taskKindFromTitle\(task\) === "signed_form"/);
  assert.match(service, /text\.includes\("mediation session"\)/);
  assert.match(service, /if \(isMediationSessionFormTask\(task\)\) continue/);
});

test("mediation session form signing completes matching client form tasks", () => {
  const service = read("../server/services/mediation-session.service.ts");

  assert.match(service, /private async completeClientRequiredFormTasks/);
  assert.match(service, /remainingRequiredForms/);
  assert.match(service, /eq\(notifications\.recipientId, actor\.id\)/);
  assert.match(service, /eq\(notifications\.appointmentId, form\.appointmentId\)/);
  assert.match(service, /completedAt: new Date\(\)/);
  assert.match(service, /await this\.completeClientRequiredFormTasks\(form, actor\)/);
});

test("client dashboard UI calls client API and renders required client sections", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /function ClientDashboard/);
  assert.match(page, /queryKey: \["\/api\/dashboard\/client"\]/);
  assert.match(page, /if \(isClient\) \{/);
  assert.match(page, /<ClientDashboard firstName=\{firstName\} \/>/);
  assert.match(page, /Current case stage|badge-client-case-stage/);
  assert.match(page, /No appointment confirmed yet/);
  assert.match(page, /Pending booking/);
  assert.match(page, /Outstanding actions/);
  assert.match(page, /Recent updates/);
  assert.match(page, /enabled: !isClient/);
});

test("client dashboard shows a client-only pending actions modal from dashboard tasks", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /const CLIENT_PENDING_ACTIONS_DISMISSED_KEY = "bfm:clientPendingActionsDismissed"/);
  assert.match(page, /function ClientPendingActionsModal/);
  assert.match(page, /data-testid="dialog-client-pending-actions"/);
  assert.match(page, /caseItem\.tasks\.length > 0/);
  assert.match(page, /sessionStorage\.getItem\(CLIENT_PENDING_ACTIONS_DISMISSED_KEY\)/);
  assert.match(page, /sessionStorage\.setItem\(CLIENT_PENDING_ACTIONS_DISMISSED_KEY, pendingActionsSignature\)/);
  assert.match(page, /<ClientPendingActionsModal/);
  assert.match(page, /open=\{pendingActionsModalOpen && !paymentDueModalInvoice\}/);
});

test("mediator dashboard fetches pending modal tasks through the scoped task API", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /const MEDIATOR_PENDING_TASKS_DISMISSED_KEY = "bfm:mediatorPendingTasksDismissed"/);
  assert.match(page, /const MEDIATOR_PENDING_TASKS_PAGE_SIZE = 25/);
  assert.match(page, /function MediatorPendingTasksModal/);
  assert.match(page, /data-testid="dialog-mediator-pending-tasks"/);
  assert.match(page, /queryKey: \["\/api\/tasks", "mediator-pending-actions", MEDIATOR_PENDING_TASKS_PAGE_SIZE\]/);
  assert.match(page, /\/api\/tasks\?status=open&page=1&pageSize=\$\{MEDIATOR_PENDING_TASKS_PAGE_SIZE\}/);
  assert.match(page, /enabled: !!user && user\.role === "mediator"/);
});

test("staff dashboard fetches pending modal tasks through the scoped task API", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /const STAFF_PENDING_TASKS_DISMISSED_KEY = "bfm:staffPendingTasksDismissed"/);
  assert.match(page, /function StaffPendingTasksModal/);
  assert.match(page, /data-testid="dialog-staff-pending-tasks"/);
  assert.match(page, /queryKey: \["\/api\/tasks", "staff-pending-actions", PENDING_TASKS_PAGE_SIZE\]/);
  assert.match(page, /enabled: isStaff/);
  assert.match(page, /user\?\.role === "superadmin" \|\| user\?\.role === "subadmin"/);
  assert.match(page, /open=\{staffPendingTasksModalOpen\}/);
});

test("mediator pending tasks modal dismissal and priority are scoped to current task IDs", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /function getTaskSignature\(tasks: Notification\[\]\): string/);
  assert.match(page, /tasks\.map\(\(task\) => task\.id\)\.sort\(\)\.join\("\|"\)/);
  assert.match(page, /sessionStorage\.getItem\(MEDIATOR_PENDING_TASKS_DISMISSED_KEY\) === mediatorPendingTasksSignature/);
  assert.match(page, /sessionStorage\.setItem\(MEDIATOR_PENDING_TASKS_DISMISSED_KEY, mediatorPendingTasksSignature\)/);
  assert.match(page, /calendarPromptOpen \|\|\s+approvalPromptOpen \|\|\s+availabilityPromptOpen \|\|\s+!!selectedServiceApproval/);
  assert.match(page, /<MediatorPendingTasksModal/);
  assert.match(page, /open=\{mediatorPendingTasksModalOpen\}/);
});

test("mediator pending tasks modal links case tasks to cases and standalone tasks to tasks page", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /const href = task\.actionHref \|\| "\/tasks"/);
  assert.match(page, /\{task\.actionLabel \|\| "Open"\}/);
  assert.match(page, /data-testid=\{`mediator-pending-task-\$\{task\.id\}`\}/);
  assert.match(page, /data-testid=\{`button-mediator-pending-task-\$\{task\.id\}`\}/);
  assert.match(page, /data-testid="button-mediator-pending-tasks-open-all"/);
  assert.match(page, /data-testid="button-mediator-pending-tasks-later"/);
});

test("staff and dashboard task surfaces use server-derived task action links", () => {
  const page = read("../client/src/pages/dashboard.tsx");
  const tasksPage = read("../client/src/pages/tasks.tsx");
  const service = read("../server/services/notification.service.ts");

  assert.match(service, /actionHref/);
  assert.match(service, /actionLabel/);
  assert.match(service, /deriveNotificationAction/);
  assert.match(page, /Link href=\{task\.actionHref \|\| "\/tasks"\}/);
  assert.match(page, /task\.actionLabel \|\| "Open"/);
  assert.match(tasksPage, /Link href=\{task\.actionHref \|\| "\/tasks"\}/);
  assert.match(tasksPage, /task\.actionLabel \|\| "Open"/);
});

test("client pending actions modal dismissal is scoped to current action IDs", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /function getPendingActionSignature\(cases: ClientPendingActionsCase\[\]\): string/);
  assert.match(page, /caseItem\.tasks\.map\(\(action\) => `\$\{caseItem\.caseId\}:\$\{action\.id\}`\)/);
  assert.match(page, /\.sort\(\)/);
  assert.match(page, /const pendingActionsSignature = getPendingActionSignature\(pendingActionCases\)/);
  assert.match(page, /sessionStorage\.getItem\(CLIENT_PENDING_ACTIONS_DISMISSED_KEY\) === pendingActionsSignature/);
  assert.match(page, /\}, \[pendingActionsSignature\]\)/);
});

test("client pending actions modal groups case tasks and reuses action links", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /type ClientPendingActionsCase = ClientDashboardCase & \{ tasks: ClientDashboardAction\[\] \}/);
  assert.match(page, /cases\.map\(\(caseItem\)/);
  assert.match(page, /data-testid=\{`client-pending-action-\$\{action\.id\}`\}/);
  assert.match(page, /<ActionButton action=\{action\} onOpen=\{onDismiss\} \/>/);
  assert.match(page, /You have \{actionCount\} pending/);
});

test("client pending action rows use urgency as background and border, not a badge", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /const style = urgencyStyles\[action\.urgency\] \|\| urgencyStyles\.green/);
  assert.match(page, /className=\{`flex items-start gap-3 rounded-md border \$\{style\.border\} \$\{style\.bg\} p-3`\} data-testid=\{`client-pending-action-\$\{action\.id\}`\}/);
  assert.match(page, /className=\{`flex items-start gap-3 rounded-md border \$\{style\.border\} \$\{style\.bg\} p-3`\} data-testid=\{`client-action-\$\{action\.id\}`\}/);
  assert.match(page, /<div className=\{`w-3 h-3 rounded-full \$\{style\.dot\}/);
  assert.match(page, /className=\{`text-sm font-medium \$\{style\.text\}`\}/);
  assert.doesNotMatch(page, /getUrgencyBadgeVariant\(action\.urgency\)/);
});

test("client dashboard refresh helper updates pending actions after client-side completions", () => {
  const queryClientSource = read("../client/src/lib/queryClient.ts");
  const dashboardPage = read("../client/src/pages/dashboard.tsx");
  const caseDetail = read("../client/src/pages/case-detail.tsx");

  assert.match(queryClientSource, /export async function refreshClientDashboardActions\(\)/);
  assert.match(queryClientSource, /queryKey: \["\/api\/dashboard\/client"\]/);
  assert.match(queryClientSource, /queryKey: \["\/api\/client\/cases\/missing-demographics"\]/);
  assert.match(queryClientSource, /refetchQueries/);
  assert.match(dashboardPage, /refreshClientDashboardActions\(\)/);
  assert.match(caseDetail, /refreshClientDashboardActions\(\)/);
});

test("client case details exposes mediation sessions tab for signing", () => {
  const caseDetail = read("../client/src/pages/case-detail.tsx");

  assert.match(caseDetail, /const canViewMediationSessionsTab = isAdmin \|\| isClient \|\| caseData\?\.sessionAccess === "full" \|\| caseData\?\.sessionAccess === "observer"/);
  assert.match(caseDetail, /canViewMediationSessionsTab && <TabsTrigger[\s\S]*value="mediation-sessions"/);
  assert.match(caseDetail, /canViewMediationSessionsTab && \([\s\S]*<TabsContent value="mediation-sessions"/);
  assert.match(caseDetail, /const canSignRequiredForm = isClient && form\.status !== "signed" && !form\.withdrawnAt/);
  assert.match(caseDetail, /openRequiredFormSignatureDialog\(form\)/);
  assert.match(caseDetail, /data-testid="dialog-required-form-signature"/);
  assert.doesNotMatch(caseDetail, /signerName: "Client"/);
});

test("client dashboard pending appointment explains paid holds without promoting them", () => {
  const page = read("../client/src/pages/dashboard.tsx");

  assert.match(page, /No appointment confirmed yet/);
  assert.match(page, /Pending booking/);
  assert.match(page, /appointment\.paymentStatus === "paid"/);
  assert.match(page, /Payment complete/);
  assert.match(page, /Awaiting forms or confirmation/);
});

test("client dashboard UI gets join links through the appointment join endpoint", () => {
  const page = read("../client/src/pages/dashboard.tsx");
  const helper = read("../client/src/lib/appointment-join.ts");

  assert.match(page, /useAuditedAppointmentJoin/);
  assert.match(page, /AppointmentJoinFallbackDialog/);
  assert.match(helper, /\/api\/appointments\/\$\{appointmentId\}\/join/);
  assert.match(helper, /openFn\("about:blank", "_blank"\)/);
  assert.match(helper, /joinWindow\.opener = null/);
  assert.doesNotMatch(helper, /window\.location\.assign/);
  assert.match(page, /appointment\.canJoin && !pending/);
  assert.doesNotMatch(page, /window\.open\(data\.meetingLink/);
  assert.doesNotMatch(page, /href=\{appointment\.meetingLink\}/);
});

test("client appointment and mediation routes use explicit safe response builders", () => {
  const routes = read("../server/routes/appointment.routes.ts");
  const sessionRoutes = read("../server/routes/mediation-session.routes.ts");
  const appointmentVisibility = read("../server/security/appointment-visibility.ts");
  const sessionVisibility = read("../server/security/session-visibility.ts");

  assert.match(routes, /buildClientAppointmentView/);
  assert.match(routes, /forClient: user\.role === "client"/);
  assert.match(sessionRoutes, /buildClientMediationSessionView/);
  assert.match(sessionRoutes, /sanitizeSessionsForClient\(roleScopedSessions, user\.id\)/);
  assert.match(sessionRoutes, /buildClientMediationSessionView\(session, clientPartyIds\)/);
  assert.match(appointmentVisibility, /export function buildClientAppointmentView/);
  assert.doesNotMatch(appointmentVisibility, /meetingLink:/);
  assert.match(sessionVisibility, /ownPartyIds\.has\(form\.partyId\)/);
  assert.match(sessionVisibility, /ownPartyIds\.has\(recipient\.partyId \|\| ""\)/);
  assert.match(sessionVisibility, /participants: \[\]/);
  assert.doesNotMatch(sessionVisibility, /invoices:/);
});

test("client appointment UI surfaces avoid raw client meeting-link bypasses", () => {
  const appointmentsPage = read("../client/src/pages/appointments.tsx");
  const caseDetail = read("../client/src/pages/case-detail.tsx");
  const weeklyCalendar = read("../client/src/components/shared/weekly-calendar.tsx");

  assert.match(appointmentsPage, /useAuditedAppointmentJoin/);
  assert.match(appointmentsPage, /AppointmentJoinFallbackDialog/);
  assert.match(appointmentsPage, /isClient && appt\.canJoin/);
  assert.match(appointmentsPage, /onJoin=\{\(id\) => void joinAppointment\(id\)\}/);
  assert.doesNotMatch(appointmentsPage, /window\.open\(data\.meetingLink/);
  assert.doesNotMatch(appointmentsPage, /window\.open\(appt\.meetingLink!/);
  assert.doesNotMatch(appointmentsPage, /href=\{appointment\.meetingLink\}/);
  assert.match(caseDetail, /useAuditedAppointmentJoin/);
  assert.match(caseDetail, /AppointmentJoinFallbackDialog/);
  assert.match(caseDetail, /isClient && appt\.canJoin/);
  assert.doesNotMatch(caseDetail, /window\.open\(data\.meetingLink/);
  assert.doesNotMatch(caseDetail, /window\.open\(appt\.meetingLink!/);
  assert.match(weeklyCalendar, /!isClient && appt\.meetingLink/);
});
