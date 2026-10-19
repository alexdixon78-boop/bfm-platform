/**
 * Regression checks for mediation session booking, holds, forms, and availability.
 *
 * Run with: npx tsx tests/mediation-session-booking.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientProposalRecipientStatusList } from "../client/src/components/mediation-session/client-proposal-recipient-status";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const schema = read("../shared/schema.ts");
const bootstrap = read("../server/db-bootstrap.ts");
const migration = read("../migrations/0004_mediation_session_booking.sql");
const proposalMigration = read("../migrations/0005_mediation_session_proposals.sql");
const storage = read("../server/storage.ts");
const sessionService = read("../server/services/mediation-session.service.ts");
const caseService = read("../server/services/case.service.ts");
const sessionRoutes = read("../server/routes/mediation-session.routes.ts");
const appointmentRoutes = read("../server/routes/appointment.routes.ts");
const appointmentJoinPolicy = read("../server/security/appointment-join-policy.ts");
const appointmentRepo = read("../server/repositories/appointment.repository.ts");
const financeService = read("../server/services/finance.service.ts");
const emailService = read("../server/services/email.service.ts");
const caseDetail = read("../client/src/pages/case-detail.tsx");
const app = read("../client/src/App.tsx");
const publicAvailabilityPage = read("../client/src/pages/session-availability.tsx");
const docs = read("../replit.md");
const dateTimeHelpers = read("../client/src/lib/date-time.ts");
const repairScriptPath = new URL("../scripts/repair-mediation-session-invoices.ts", import.meta.url);
const repairScript = existsSync(repairScriptPath) ? read("../scripts/repair-mediation-session-invoices.ts") : "";

test("client proposal recipient cards render only the signed-in client's safe response state", () => {
  const markup = renderToStaticMarkup(
    createElement(ClientProposalRecipientStatusList, {
      recipients: [{
        id: "recipient-a",
        partyId: "party-a",
        responseStatus: "accepted",
        respondedAt: "2026-01-08T10:00:00.000Z",
      }],
    }),
  );

  assert.match(markup, /Your response/);
  assert.match(markup, /accepted/);
  assert.match(markup, /Responded/);
  assert.doesNotMatch(markup, /recipientType/);
  assert.doesNotMatch(markup, /recipientName/);
  assert.doesNotMatch(markup, /recipientEmail/);
  assert.doesNotMatch(markup, /Copy fresh link/);
  assert.doesNotMatch(markup, /Resend link/);
});

test("schema, bootstrap, and migration define party-scoped required forms and session availability windows", () => {
  assert.match(schema, /partyRequiredForms = pgTable\("party_required_forms"/);
  assert.match(schema, /PARTY_REQUIRED_FORM_TYPES[\s\S]*agreement_to_mediate_confidentiality[\s\S]*voucher_scheme_client_consent/);
  assert.match(schema, /PARTY_REQUIRED_FORM_STATUSES[\s\S]*outstanding[\s\S]*sent[\s\S]*viewed[\s\S]*signed/);
  assert.match(schema, /PARTY_REQUIRED_FORM_DELIVERY_STATUSES[\s\S]*not_sent[\s\S]*in_app_task_created[\s\S]*email_sent[\s\S]*email_skipped[\s\S]*email_failed/);
  assert.match(schema, /deliveryStatus: text\("delivery_status"\)\.notNull\(\)\.default\("not_sent"\)/);
  assert.match(schema, /deliveryLastAttemptedAt: timestamp\("delivery_last_attempted_at"\)/);
  assert.match(schema, /deliveryError: text\("delivery_error"\)/);
  assert.match(schema, /partyId: varchar\("party_id"\)\.notNull\(\)\.references\(\(\) => parties\.id/);
  assert.match(schema, /mediationSessionAvailabilityWindows = pgTable\("mediation_session_availability_windows"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS party_required_forms/);
  assert.match(bootstrap, /ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_sent'/);
  assert.match(bootstrap, /ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS delivery_last_attempted_at TIMESTAMP/);
  assert.match(bootstrap, /ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS delivery_error TEXT/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS mediation_session_availability_windows/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "party_required_forms"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "mediation_session_availability_windows"/);
  assert.match(proposalMigration, /CREATE TABLE IF NOT EXISTS "mediation_session_proposals"/);
  assert.match(proposalMigration, /CREATE TABLE IF NOT EXISTS "mediation_session_proposal_recipients"/);
  assert.match(proposalMigration, /ALTER COLUMN "party_id" DROP NOT NULL/);
});

test("finance uniqueness supports one invoice and payment per party on one joint appointment", () => {
  assert.match(schema, /case_invoices_appointment_unique_idx"\)\.on\(table\.appointmentId, table\.billToPartyId\)/);
  assert.match(schema, /case_payments_appointment_unique_idx"\)\.on\(table\.appointmentId, table\.partyId\)/);
  assert.match(bootstrap, /DROP INDEX IF EXISTS case_invoices_appointment_unique_idx/);
  assert.match(bootstrap, /ON case_invoices\(appointment_id, bill_to_party_id\)/);
  assert.match(migration, /ON "case_invoices" \("appointment_id", "bill_to_party_id"\)/);
  assert.match(financeService, /ensureMediationSessionInvoices/);
  assert.match(financeService, /Mediation Sessions service type must have online payment enabled and a positive amount/);
  assert.match(financeService, /for \(const party of input\.parties\)/);
  assert.match(financeService, /getInvoiceByAppointmentParty\(input\.appointment\.id, party\.id\)/);
  assert.match(financeService, /getReusableMediationSessionInvoice/);
  assert.match(financeService, /mediation_session_invoice_reused/);
  assert.match(financeService, /appointmentId: input\.appointment\.id/);
  assert.match(financeService, /dueDate: input\.appointment\.holdExpiresAt \|\| null/);
  assert.match(financeService, /entityRef: updated\.invoiceNumber/);
  assert.match(financeService, /paymentStatus: updated\.paymentStatus/);
  assert.match(financeService, /caseInvoices\.paymentStatus\} NOT IN \('cancelled', 'expired', 'refunded'\)/);
  assert.match(financeService, /voidUnpaidAppointmentInvoices/);
  assert.match(financeService, /invoice\.amountPaidPence === 0/);
  assert.match(financeService, /invoice\.outstandingPence === invoice\.totalPence/);
  assert.match(financeService, /!\["paid", "refunded"\]\.includes\(invoice\.paymentStatus\)/);
  assert.match(financeService, /status: "void"/);
  assert.match(financeService, /paymentStatus: "cancelled"/);
  assert.match(financeService, /outstandingPence: 0/);
});

test("mediation session invoice reuse is limited to same-session replacement appointments", () => {
  assert.match(financeService, /reusableAppointmentIds\?: string\[\]/);
  assert.match(financeService, /const reusableAppointmentIds = input\.reusableAppointmentIds \|\| \[\]/);
  assert.doesNotMatch(financeService, /if \(reusableAppointmentIds\.length === 0\) continue/);
  assert.match(financeService, /const reusable = reusableAppointmentIds\.length > 0[\s\S]*getReusableMediationSessionInvoice\(input\.appointment\.caseId, input\.serviceType\.id, party\.id, reusableAppointmentIds\)[\s\S]*: undefined/);
  assert.match(financeService, /inArray\(caseInvoices\.appointmentId, reusableAppointmentIds\)/);
  assert.match(sessionService, /reusableInvoiceAppointmentIds\?: string\[\]/);
  assert.match(sessionService, /reusableAppointmentIds: input\.reusableInvoiceAppointmentIds/);
  assert.match(sessionService, /const previousAppointmentId = session\.appointmentId/);
  assert.match(sessionService, /reusableInvoiceAppointmentIds: previousAppointmentId \? \[previousAppointmentId\] : \[\]/);
  assert.match(sessionService, /const proposed = await this\.proposeSlot\(\s*sessionId,\s*actor,\s*\{ \.\.\.input, reusableInvoiceAppointmentIds: previousAppointmentId \? \[previousAppointmentId\] : \[\] \},\s*ipAddress,\s*\{ isReschedule: true, includeAllParticipants: true \},\s*\)/);
  assert.match(sessionService, /return proposed/);
});

test("repair script creates missing invoices for one existing mediation session without cross-session reuse", () => {
  assert.ok(existsSync(repairScriptPath), "repair script should exist");
  assert.match(repairScript, /--case-id/);
  assert.match(repairScript, /--session-number/);
  assert.match(repairScript, /--dry-run/);
  assert.match(repairScript, /import "dotenv\/config";/);
  assert.match(repairScript, /import \{ loadRuntimeEnv \} from "\.\.\/server\/config\/runtime-env";/);
  assert.equal(repairScript.match(/^import .*$/m)?.[0], 'import "dotenv/config";');
  assert.ok(
    repairScript.indexOf("await loadRuntimeEnv()") < repairScript.indexOf('await import("../server/services/finance.service")'),
    "repair script should load runtime env before importing DB-backed services",
  );
  assert.doesNotMatch(repairScript, /import \{ financeService \} from "\.\.\/server\/services\/finance\.service"/);
  assert.doesNotMatch(repairScript, /import \{ storage \} from "\.\.\/server\/storage"/);
  assert.doesNotMatch(repairScript, /import \{ pool \} from "\.\.\/server\/db"/);
  assert.match(repairScript, /await import\("\.\.\/server\/services\/finance\.service"\)/);
  assert.match(repairScript, /await import\("\.\.\/server\/storage"\)/);
  assert.match(repairScript, /await import\("\.\.\/server\/db"\)/);
  assert.match(repairScript, /storage\.listMediationSessionsByCase\(caseId\)/);
  assert.match(repairScript, /session\.sessionNumber === sessionNumber/);
  assert.match(repairScript, /if \(!session\.appointmentId\)/);
  assert.match(repairScript, /financeService\.ensureMediationSessionInvoices\(\{[\s\S]*reusableAppointmentIds: \[\]/);
  assert.match(repairScript, /existingInvoices/);
  assert.match(repairScript, /createdInvoices/);
  assert.match(repairScript, /Accepted proposal responses are unchanged/);
});

test("storage exposes repositories and expiry lookup for mediation session booking resources", () => {
  assert.match(storage, /PartyRequiredFormRepository/);
  assert.match(storage, /MediationSessionAvailabilityRepository/);
  assert.match(storage, /MediationSessionProposalRepository/);
  assert.match(storage, /createMediationSessionProposal/);
  assert.match(storage, /getMediationSessionProposalRecipientByTokenHash/);
  assert.match(storage, /listPartyRequiredFormsBySession/);
  assert.match(storage, /replaceMediationSessionAvailabilityForParty/);
  assert.match(storage, /replaceMediationSessionAvailabilityForProposalRecipient/);
  assert.match(storage, /findExpiredMediationSessionHolds/);
  assert.match(appointmentRepo, /innerJoin\(mediationSessions, eq\(mediationSessions\.appointmentId, appointments\.id\)\)/);
  assert.match(appointmentRepo, /NOT EXISTS \(SELECT 1 FROM mediation_sessions ms WHERE ms\.appointment_id/);
});

test("routes expose session availability, hold, confirm, form signing, and appointment join endpoints", () => {
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/propose-slot"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/replace-proposed-slot"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/lead-mediator-available-dates"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/lead-mediator-available-slots"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/release-hold"/);
  assert.match(sessionRoutes, /\/api\/mediation-session-proposals\/:id\/resend-links"/);
  assert.match(sessionRoutes, /\/api\/mediation-session-proposal-recipients\/:id\/resend-link"/);
  assert.match(sessionRoutes, /\/api\/session-availability\/:token"/);
  assert.match(sessionRoutes, /\/api\/session-availability\/:token\/respond"/);
  assert.match(sessionRoutes, /\/api\/session-availability\/:token\/available-dates"/);
  assert.match(sessionRoutes, /\/api\/session-availability\/:token\/available-slots"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/required-forms\/issue"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/availability"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/availability\/admin"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/availability\/overlap"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/hold"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/confirm"/);
  assert.match(sessionRoutes, /\/api\/mediation-sessions\/:id\/cancel"/);
  assert.match(sessionRoutes, /cancelSessionSchema/);
  assert.match(sessionRoutes, /\/api\/party-required-forms\/:id\/viewed"/);
  assert.match(sessionRoutes, /\/api\/party-required-forms\/:id\/sign"/);
  assert.match(sessionRoutes, /\/api\/party-required-forms\/:id\/resend"/);
  assert.match(appointmentRoutes, /\/api\/appointments\/:id\/join"/);
  assert.match(appointmentRoutes, /buildSessionJoinAvailability/);
  assert.match(appointmentJoinPolicy, /Join will be available on the appointment day/);
});

test("mediation session cycle adds unpaid reminder sweep, admin escalation, cancellation, and no-show no-refund handling", () => {
  assert.match(sessionService, /sendUnpaidPaymentReminders/);
  assert.match(sessionService, /mediation_session_payment_reminder_sent/);
  assert.match(sessionService, /mediation_session_payment_due/);
  assert.match(sessionService, /caseNoteRequired: true/);
  assert.match(sessionService, /cancelSession/);
  assert.match(sessionService, /cancel_mediation_session/);
  assert.match(sessionService, /mediation_session_cancelled/);
  assert.match(sessionService, /appointmentService\.cancel/);
  assert.match(sessionService, /markMediationSessionNoShowNoRefund/);
  assert.match(financeService, /markMediationSessionNoShowNoRefund/);
  assert.match(financeService, /assertRefundAllowed/);
  assert.match(financeService, /overrideNoShowNoRefund/);
  assert.match(financeService, /No-show no-refund rule requires an admin override reason/);
  assert.match(financeService, /mediation_session_no_show_no_refund_recorded/);
  assert.match(financeService, /no_show_no_refund/);
});

test("mediation sessions auto-confirm after the final acceptance, payment, or form gate completes", () => {
  assert.match(sessionService, /attemptAutoConfirmSession/);
  assert.match(sessionService, /AutoConfirmTrigger/);
  assert.match(sessionService, /confirmed: false, reason: "not_ready"/);
  assert.match(sessionService, /reason: "already_confirmed"/);
  assert.match(sessionService, /appointmentService\.confirm\(appointment\.id, systemActor\("mediation_session_auto_confirm/);
  assert.match(sessionService, /mediation_session_auto_confirmed/);
  assert.match(sessionService, /auto_confirm_mediation_session/);
  assert.match(sessionService, /mediation_session_auto_confirm_failed/);
  assert.match(sessionService, /caseNoteRequired: true/);
  assert.match(sessionService, /await this\.attemptAutoConfirmSession\(session\.id, "proposal_accepted"/);
  assert.match(sessionService, /getSessionIdForRequiredForm/);
  assert.match(sessionService, /await this\.attemptAutoConfirmSession\(sessionId, "form_signed"/);
  assert.match(sessionService, /client_accepts_last/);
  assert.match(sessionService, /mediator_accepts_first/);
  assert.match(sessionRoutes, /autoConfirmation: result\.autoConfirmation/);
  assert.match(financeService, /attemptMediationSessionAutoConfirmForPayment/);
  assert.match(financeService, /paymentStatus: patch\.paymentStatus \|\| existing\.paymentStatus/);
  assert.match(financeService, /payment_not_required/);
  assert.match(financeService, /mediationSessionService\.attemptAutoConfirmSession/);
});

test("required form resend supports admins and active lead mediators without reopening signed forms", () => {
  assert.match(sessionService, /resendRequiredForm/);
  assert.match(sessionService, /canManageRequiredFormDelivery/);
  assert.match(sessionService, /session\.leadMediatorId === actor\.id/);
  assert.match(sessionService, /form\.status === "signed" \|\| form\.withdrawnAt/);
  assert.match(sessionService, /Only pending required forms can be resent/);
  assert.match(sessionService, /sendMediationSessionRequiredFormEmail/);
  assert.match(sessionService, /action: "resend_required_form"/);
  assert.match(sessionService, /mediation_session_required_form_resent/);
  assert.match(caseDetail, /resendRequiredFormMutation/);
  assert.match(caseDetail, /canManageRequiredFormDelivery/);
  assert.match(caseDetail, /button-resend-required-form/);
  assert.match(caseDetail, /user\?\.id === session\.leadMediatorId/);
  assert.match(caseDetail, /Signed form prompt resent/);
});

test("required form delivery badge distinguishes email delivery from signing status", () => {
  assert.match(sessionService, /updateRequiredFormDelivery/);
  assert.match(sessionService, /deliveryStatus: "in_app_task_created"/);
  assert.match(sessionService, /deliveryStatus: "email_skipped"/);
  assert.match(sessionService, /deliveryStatus: "email_sent"/);
  assert.match(sessionService, /deliveryStatus: "email_failed"/);
  assert.match(sessionService, /deliveryLastAttemptedAt: new Date\(\)/);
  assert.match(caseDetail, /deliveryBadgeLabel/);
  assert.match(caseDetail, /Email skipped/);
  assert.match(caseDetail, /Email failed/);
  assert.doesNotMatch(caseDetail, /<Badge[^>]*>\{form\.withdrawnAt \? "withdrawn" : form\.status\}<\/Badge>/);
});

test("session proposal links are recipient-specific and resend does not rotate accepted links by default", () => {
  assert.match(sessionService, /resendProposalRecipientLink/);
  assert.match(sessionService, /regenerateAccepted/);
  assert.match(sessionService, /recipient\.responseStatus === "accepted" && !options\.regenerateAccepted/);
  assert.match(sessionService, /recipients\.filter\(\(recipient\) => recipient\.responseStatus === "pending" \|\| recipient\.responseStatus === "viewed"\)/);
  assert.match(sessionService, /this\.rotateProposalRecipientLink\(recipient, session, proposal/);
  assert.match(sessionService, /action: "resend_mediation_session_proposal_recipient_link"/);
  assert.match(sessionService, /This link is only for/);
  assert.match(caseDetail, /button-resend-session-recipient-link/);
  assert.match(caseDetail, /button-copy-session-recipient-link/);
  assert.match(caseDetail, /This link is only for/);
  assert.match(caseDetail, /recipient\.recipientEmail/);
  assert.match(caseDetail, /formatSessionDateTime\(recipient\.sentAt/);
  assert.match(caseDetail, /formatSessionDateTime\(recipient\.viewedAt/);
  assert.match(caseDetail, /formatSessionDateTime\(recipient\.respondedAt/);
});

test("proposed mediation session slots auto-accept the lead mediator and notify clients only", () => {
  assert.match(emailService, /export async function sendMediationSessionProposalEmail/);
  assert.match(emailService, /sessionNumber: number/);
  assert.match(emailService, /responseUrl: string/);
  assert.match(emailService, /Respond to proposed slot/);
  assert.match(emailService, /Mediation Session \$\{sessionNumber\} proposed/);
  assert.match(emailService, /Mediation Session \$\{sessionNumber\} rescheduled/);
  assert.match(sessionService, /recipientType: "client"/);
  assert.match(sessionService, /recipientType: "mediator"/);
  assert.match(sessionService, /const leadMediatorAcceptedAt = new Date\(\)/);
  assert.match(sessionService, /responseStatus: recipient\.recipientType === "mediator" \? "accepted" : "pending"/);
  assert.match(sessionService, /respondedAt: recipient\.recipientType === "mediator" \? leadMediatorAcceptedAt : null/);
  assert.match(sessionService, /if \(recipient\.recipientType === "mediator"\) continue/);
  assert.match(sessionService, /private async notifyProposalRecipient/);
  assert.match(sessionService, /sendMediationSessionProposalEmail/);
  assert.match(sessionService, /recipient\.recipientEmail/);
  assert.match(sessionService, /new Date\(proposal\.proposedStartAt\)/);
  assert.match(sessionService, /publicUrl/);
  assert.match(sessionService, /proposal email failed/);
  assert.doesNotMatch(sessionService, /recipientType: "mediator"[\s\S]{0,900}notifyProposalRecipient\(created, session, proposal, publicUrl, options\)/);
  assert.match(sessionService, /private async notifyParticipantInviteRecipient/);
  assert.match(sessionService, /sendMediationSessionParticipantInviteEmail/);
  assert.match(sessionService, /rotateProposalRecipientLink[\s\S]*notifyProposalRecipient\(target, session, proposal, publicUrl\)/);
  assert.doesNotMatch(sessionService, /session\.sessionNumber === 1/);
});

test("service enforces scoped availability, 72-hour internal holds, form gates, payment gates, and fixed Zoom links", () => {
  assert.match(sessionService, /proposeSlot/);
  assert.match(sessionService, /replaceProposedSlot/);
  assert.match(sessionService, /releaseSessionHold/);
  assert.match(sessionService, /options: \{ voidInvoices\?: boolean; reason\?: string \} = \{\}/);
  assert.match(sessionService, /financeService\.voidUnpaidAppointmentInvoices\(appointment\.id/);
  assert.match(sessionService, /if \(options\.voidInvoices !== false\)/);
  assert.match(sessionService, /releaseSessionHold\(sessionId, actor, ipAddress, \{ voidInvoices: false \}\)/);
  assert.match(sessionService, /createProposalRecipientsAndLinks/);
  assert.match(sessionService, /createParticipantInviteLinks/);
  assert.match(sessionService, /hashProposalToken/);
  assert.match(sessionService, /hashParticipantInvitationToken/);
  assert.match(sessionService, /respondToProposal/);
  assert.match(sessionService, /respondToParticipantInvitation/);
  assert.match(sessionService, /logProposalResponseActivity/);
  assert.match(sessionService, /logParticipantInvitationResponseActivity/);
  assert.match(sessionService, /mediation_session_slot_accepted/);
  assert.match(sessionService, /mediation_session_slot_declined/);
  assert.match(sessionService, /if \(current\.recipientType === "mediator_participant"\)[\s\S]*return this\.respondToParticipantInvitation/);
  assert.match(sessionService, /alternativeCount/);
  assert.match(sessionService, /mediation_session_proposal_accepted/);
  assert.match(sessionService, /channel: "session-availability-link"/);
  assert.match(sessionService, /All session proposal recipients must accept before confirmation/);
  assert.doesNotMatch(sessionService, /All session participants must accept before confirmation/);
  assert.match(sessionService, /resolveAvailabilityParty/);
  assert.match(sessionService, /storage\.listPartiesByUserId\(actor\.id\)/);
  assert.match(sessionService, /intersectPartyWindows/);
  assert.match(sessionService, /filterMediatorSlots/);
  assert.match(sessionService, /getLeadMediatorAvailableDates/);
  assert.match(sessionService, /getLeadMediatorAvailableSlots/);
  assert.match(sessionService, /getMediatorAvailabilityWindows/);
  assert.match(sessionService, /generateSessionSlotsInWindow/);
  assert.match(sessionService, /\$\{label\} does not have an approved Mediation Sessions service approval/);
  assert.match(sessionService, /holdExpiresAt: this\.calculateSessionHoldExpiry\(start\)/);
  assert.match(sessionService, /Date\.now\(\) \+ 72 \* 60 \* 60 \* 1000/);
  assert.match(sessionService, /meetingLink: mediator\.zoomLink \|\| null/);
  assert.match(sessionService, /voucherFormRequired/);
  assert.match(sessionService, /status: "outstanding"/);
  assert.match(sessionService, /deliveryStatus: "not_sent"/);
  assert.match(sessionService, /All required forms must be signed before confirming this session/);
  assert.match(sessionService, /All required session invoices must be paid or marked not required before confirmation/);
  assert.match(sessionService, /appointmentService\.confirm/);
  assert.match(sessionService, /expireSessionHolds/);
  assert.match(sessionService, /financeService\.voidUnpaidAppointmentInvoices\(updated\.id/);
  assert.match(sessionService, /mediation_session_hold_expired/);
  assert.match(sessionService, /mediation_session_held_acknowledgement/);
  assert.match(sessionService, /mediation_session_confirmed_acknowledgement/);
});

test("case detail UI renders proposed slot links, forms, payment, alternative availability, and same-day join controls", () => {
  const joinHelper = read("../client/src/lib/appointment-join.ts");

  assert.match(caseDetail, /session-booking-panel/);
  assert.match(caseDetail, /session-summary-section/);
  assert.match(caseDetail, /session-booking-status-section/);
  assert.match(caseDetail, /session-availability-section/);
  assert.match(caseDetail, /session-propose-slot-controls/);
  assert.match(caseDetail, /Clients confirm the proposed time by public link; the lead mediator is auto-approved from their calendar availability\./);
  assert.match(caseDetail, /ClientProposalResponsePanel/);
  assert.match(caseDetail, /button-client-accept-session-proposal/);
  assert.match(caseDetail, /button-client-decline-session-proposal/);
  assert.match(caseDetail, /\/api\/mediation-session-proposal-recipients\/\$\{recipient\.id\}\/client-response/);
  assert.match(caseDetail, /client-proposal-alternative-slot-picker/);
  assert.match(caseDetail, /SessionLeadMediatorSlotPicker/);
  assert.match(caseDetail, /session-lead-mediator-slot-picker/);
  assert.match(caseDetail, /session-availability-calendar/);
  assert.match(caseDetail, /refetchOnWindowFocus: true/);
  assert.match(caseDetail, /refetchOnMount: "always"/);
  assert.match(caseDetail, /session-loading-dates/);
  assert.match(caseDetail, /Loading availability\.\.\./);
  assert.match(caseDetail, /bottom-0\.5 left-1\/2 h-1\.5 w-1\.5 -translate-x-1\/2 rounded-full/);
  assert.match(caseDetail, /h-auto min-h-9 max-w-full whitespace-normal text-center leading-snug/);
  assert.match(caseDetail, /formatUkWallClockDateTime/);
  assert.match(caseDetail, /formatSessionDateTime/);
  assert.doesNotMatch(caseDetail, /toISOString\(\)\.slice\(0, 16\)/);
  assert.match(caseDetail, /\/lead-mediator-available-dates\?month=/);
  assert.match(caseDetail, /\/lead-mediator-available-slots\?date=/);
  assert.match(caseDetail, /session-proposal-response-links/);
  assert.match(caseDetail, /session-alternative-availability-section/);
  assert.match(caseDetail, /session-alternative-recipient-groups/);
  assert.match(caseDetail, /declinedRecipients\.map/);
  assert.match(caseDetail, /recipientWindows\.map/);
  assert.match(caseDetail, /button-refresh-session-alternatives/);
  assert.match(caseDetail, /button-use-alternative-slot/);
  assert.match(caseDetail, /dateTime: new Date\(window\.startAt\)\.toISOString\(\)/);
  assert.match(caseDetail, /durationFromWindow\(window\)/);
  assert.match(caseDetail, /No alternatives submitted by this recipient yet/);
  assert.match(caseDetail, /session-completion-checklist-section/);
  assert.match(caseDetail, /Proposed session slot/);
  assert.match(caseDetail, /Alternative availability/);
  assert.match(caseDetail, /Completion checklist/);
  assert.match(caseDetail, /Payments and admin acknowledgement/);
  assert.match(caseDetail, /Find overlap/);
  assert.doesNotMatch(caseDetail, /Voucher form required/);
  assert.match(sessionService, /const voucherFormRequired = Boolean\(c\.voucherClaimEligible\)/);
  assert.match(caseDetail, /Propose and hold/);
  assert.match(caseDetail, /Proposing\.\.\./);
  assert.match(caseDetail, /Creating hold and sending response links\.\.\./);
  assert.match(caseDetail, /disabled=\{proposeSlotMutation\.isPending\}/);
  assert.match(caseDetail, /Issue missing forms/);
  assert.match(caseDetail, /Regenerate all pending links/);
  assert.match(caseDetail, /Release hold/);
  assert.match(caseDetail, /Propose replacement/);
  assert.match(caseDetail, /Sending replacement\.\.\./);
  assert.match(caseDetail, /Replacing hold and sending fresh response links\.\.\./);
  assert.match(caseDetail, /disabled=\{replaceSlotMutation\.isPending\}/);
  assert.match(caseDetail, /queryKey: \["\/api\/cases", caseId, "activities"\], exact: false/);
  assert.match(caseDetail, /Confirm when ready/);
  assert.match(caseDetail, /confirmBlockers/);
  assert.match(caseDetail, /canConfirmSession/);
  assert.match(caseDetail, /button-join-session/);
  assert.match(caseDetail, /session\.appointment\?\.joinAvailability/);
  assert.match(caseDetail, /useAuditedAppointmentJoin/);
  assert.match(caseDetail, /AppointmentJoinFallbackDialog/);
  assert.match(caseDetail, /joinAppointment\(session\.appointment!\.id\)/);
  assert.match(joinHelper, /\/api\/appointments\/\$\{appointmentId\}\/join/);
  assert.match(joinHelper, /openFn\("about:blank", "_blank"\)/);
  assert.match(joinHelper, /joinWindow\.opener = null/);
  assert.doesNotMatch(joinHelper, /window\.location\.assign/);
  assert.doesNotMatch(caseDetail, /window\.open\(data\.meetingLink/);
});

test("completion checklist required-form rows keep visible actions inside the card", () => {
  assert.match(caseDetail, /data-testid=\{`session-required-form-row-\$\{form\.id\}`\}/);
  assert.match(caseDetail, /className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"/);
  assert.match(caseDetail, /className="flex max-w-full flex-wrap items-center gap-2"/);
  assert.match(caseDetail, /data-testid=\{`session-required-form-actions-\$\{form\.id\}`\}/);
  assert.match(caseDetail, /className="flex max-w-full flex-wrap items-center justify-start gap-2 sm:justify-end"/);
  assert.doesNotMatch(caseDetail, /<div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">/);
  assert.match(caseDetail, /data-testid="button-resend-required-form"/);
  assert.match(caseDetail, /data-testid="button-upload-signed-required-form"/);
  assert.match(caseDetail, /data-testid="button-withdraw-optional-required-form"/);
});

test("mediators use the audited appointment join endpoint from mediation sessions tab", () => {
  assert.match(caseDetail, /const canSeeJoinSession = isAdmin \|\| isClient \|\| canLeadEquivalentSessionAction \|\| sessionAccess === "observer"/);
  assert.match(caseDetail, /canSeeJoinSession && session\.appointment/);
  assert.match(caseDetail, /disabled=\{!joinAvailability\.canJoin \|\| joiningAppointmentId === session\.appointment!\.id\}/);
  assert.match(caseDetail, /joinAvailability\.message/);
  assert.match(caseDetail, /data-testid=\{`button-join-session-\$\{session\.id\}`\}/);
  assert.match(caseDetail, /joinAppointment\(session\.appointment!\.id\)/);
});

test("case detail mediation session visibility is participant-scoped for clients and mediators", () => {
  const sessionVisibility = read("../server/security/session-visibility.ts");

  assert.match(sessionRoutes, /sanitizeSessionsForClient\(roleScopedSessions, user\.id\)/);
  assert.match(sessionRoutes, /buildClientMediationSessionView\(session, clientPartyIds\)/);
  assert.match(sessionRoutes, /sanitizeSessionsForMediator\(roleScopedSessions, result\.access\)/);
  assert.match(sessionRoutes, /buildClientMediationSessionView/);
  assert.match(sessionRoutes, /buildObserverMediationSessionView/);
  assert.match(sessionRoutes, /filterAcceptedParticipantSessions/);
  assert.match(sessionVisibility, /requiredForms: \(session\.requiredForms \|\| \[\]\)/);
  assert.match(sessionVisibility, /ownPartyIds\.has\(form\.partyId\)/);
  assert.match(sessionVisibility, /partyAttendance: \(session\.partyAttendance \|\| \[\]\)/);
  assert.match(sessionVisibility, /participants: \[\]/);
  assert.doesNotMatch(sessionVisibility, /invoices:/);
  assert.match(sessionService, /if \(user\.role === "client"\)/);
  assert.match(sessionService, /storage\.listPartiesByUserId\(user\.id\)/);
  assert.match(sessionService, /sessions: \[\]/);
  assert.match(caseService, /const access = await classifyCaseAccess\(c\.id, user\)/);
  assert.match(caseService, /sessionAccess,/);
  assert.match(caseDetail, /const canViewMediationSessionsTab = isAdmin \|\| isClient \|\| caseData\?\.sessionAccess === "full" \|\| caseData\?\.sessionAccess === "observer"/);
  assert.match(caseDetail, /const showSessionPaymentDetails = isAdmin/);
  assert.match(caseDetail, /showSessionPaymentDetails && \(/);
  assert.match(caseDetail, /showSessionPaymentDetails && session\.appointment && \(/);
  assert.doesNotMatch(caseDetail, /const canViewMediationSessionsTab = isStaff \|\| isClient/);
});

test("client mediation session checklist hides admin form summaries and party prefixes", () => {
  assert.match(caseDetail, /const formRequirements = session\.formRequirements \|\| \[\]/);
  assert.match(caseDetail, /const visibleMissingFormRequirements = isClient \? \[\] : formRequirements\.filter\(\(req\) => req\.applicable && !req\.issued\)/);
  assert.match(caseDetail, /const showVoucherConsentProgress = isAdmin/);
  assert.match(caseDetail, /showVoucherConsentProgress && \(\(\) =>/);
  assert.match(caseDetail, /visibleMissingFormRequirements\.map\(\(req\) =>/);
  assert.match(caseDetail, /isClient \? formLabel\(form\.formType\) : `Client \$\{partyById\.get\(form\.partyId\)\?\.role \|\| "\?"\} · \$\{formLabel\(form\.formType\)\}`/);
  assert.match(docs, /Client Mediation Sessions checklists render only party-scoped required-form rows/);
});

test("staff mediation session checklist renders only missing requirement summaries", () => {
  assert.match(caseDetail, /visibleMissingFormRequirements\.length > 0 \|\| forms\.length > 0/);
  assert.match(caseDetail, /isAdmin && session\.appointment && formRequirements\.some\(\(req\) => req\.applicable && !req\.issued\)/);
  assert.match(caseDetail, /visibleMissingFormRequirements\.map\(\(req\) =>/);
  assert.doesNotMatch(caseDetail, /visibleFormRequirements\.map\(\(req\) =>/);
  assert.match(docs, /Staff Mediation Sessions checklists consolidate issued party forms/);
});

test("case finance groups mediation session invoices and voids stale hold invoices", () => {
  assert.match(financeService, /mediationSessions/);
  assert.match(financeService, /mediationSessionId: mediationSessions\.id/);
  assert.match(financeService, /mediationSessionNumber: mediationSessions\.sessionNumber/);
  assert.match(financeService, /\.leftJoin\(mediationSessions, eq\(caseInvoices\.appointmentId, mediationSessions\.appointmentId\)\)/);
  assert.match(caseDetail, /mediationSessionId\?: string \| null/);
  assert.match(caseDetail, /mediationSessionNumber\?: number \| null/);
  assert.match(caseDetail, /case-mediation-session-invoice-group/);
  assert.match(caseDetail, /case-mediation-session-invoice-rows/);
  assert.match(caseDetail, /invoiceLedgerEntries/);
  assert.match(caseDetail, /Mediation Session \$\{primaryInvoice\.mediationSessionNumber\}/);
  assert.match(caseDetail, /entry\.invoices\.map\(\(invoice\) => renderInvoiceRow\(invoice, true\)\)/);
  assert.match(caseDetail, /appointmentCanTakePayment/);
  assert.match(caseDetail, /invoice\.status !== "void" && appointmentCanTakePayment && invoice\.paymentLinkUrl/);
  assert.match(caseDetail, /invoice\.status !== "void" && appointmentCanTakePayment && invoice\.appointmentId/);
  assert.match(caseDetail, /Historical hold/);
  assert.match(caseDetail, /Current session invoices/);
});

test("public session availability page is routed and supports accept/decline alternatives", () => {
  assert.match(app, /SessionAvailabilityPage/);
  assert.match(app, /\/session-availability\/:token/);
  assert.match(publicAvailabilityPage, /\/api\/session-availability\/\$\{token\}/);
  assert.match(publicAvailabilityPage, /\/api\/session-availability\/\$\{token\}\/respond/);
  assert.match(publicAvailabilityPage, /\/api\/session-availability\/\$\{token\}\/available-dates/);
  assert.match(publicAvailabilityPage, /\/api\/session-availability\/\$\{token\}\/available-slots/);
  assert.match(publicAvailabilityPage, /formatUkWallClockDateTime/);
  assert.match(publicAvailabilityPage, /isLoadingDates \? \(/);
  assert.match(publicAvailabilityPage, /session-public-loading-dates/);
  assert.match(publicAvailabilityPage, /Loading availability\.\.\./);
  assert.match(publicAvailabilityPage, /isAvailable && !isPast/);
  assert.match(publicAvailabilityPage, /rounded-full/);
  assert.match(publicAvailabilityPage, /bg-white/);
  assert.match(publicAvailabilityPage, /bg-\[\#5a7d58\]/);
  assert.match(publicAvailabilityPage, /selectedAlternativeSlots/);
  assert.match(publicAvailabilityPage, /isParticipantInvite/);
  assert.match(publicAvailabilityPage, /linkStatus/);
  assert.match(publicAvailabilityPage, /This invitation is for/);
  assert.match(publicAvailabilityPage, /Link no longer active/);
  assert.match(sessionRoutes, /linkStatus: result\.linkStatus/);
  assert.match(sessionService, /getPublicProposalLinkStatus/);
  assert.match(sessionService, /proposal\.status !== "held"/);
  assert.match(publicAvailabilityPage, /session-public-slot-picker/);
  assert.match(publicAvailabilityPage, /selectedAlternativeSlots\.length > 0/);
  assert.match(publicAvailabilityPage, /response === "declined" && !isParticipantInvite/);
  assert.match(publicAvailabilityPage, /Accept session/);
  assert.match(publicAvailabilityPage, /Decline session/);
  assert.match(publicAvailabilityPage, /I can attend/);
  assert.match(publicAvailabilityPage, /I cannot attend/);
  assert.match(publicAvailabilityPage, /autoConfirmation\?: \{ confirmed: boolean; reason\?: string \}/);
  assert.match(publicAvailabilityPage, /Your mediation session is confirmed\. Calendar invitations will be sent\./);
  assert.match(publicAvailabilityPage, /data-testid="session-auto-confirmed"/);
  assert.doesNotMatch(publicAvailabilityPage, /Add another window/);
});

test("shared client formatter preserves UK wall-clock booking/session displays", () => {
  assert.match(dateTimeHelpers, /timeZone: UK_WALL_CLOCK_TIME_ZONE/);
  assert.match(dateTimeHelpers, /formatUkWallClockDateTime/);
  assert.match(dateTimeHelpers, /formatUkWallClockDate/);
  assert.match(dateTimeHelpers, /formatUkWallClockTime/);
});

test("case detail layout keeps tabs full-width and activity below the tab row", () => {
  assert.match(caseDetail, /data-testid="case-detail-tabs-scroll"/);
  assert.match(caseDetail, /overflow-x-auto/);
  assert.match(caseDetail, /inline-flex min-w-max whitespace-nowrap/);
  assert.match(caseDetail, /data-testid="case-detail-content-grid"/);
  assert.match(caseDetail, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(caseDetail, /<div className="min-w-0 space-y-6">/);
  assert.match(caseDetail, /PersistentRecentActivityCard/);
});

test("required mediation-session forms notify clients by app task and email", () => {
  assert.match(emailService, /sendMediationSessionRequiredFormEmail/);
  assert.match(sessionService, /sendMediationSessionRequiredFormEmail/);
  assert.match(sessionService, /issueRequiredForms/);
  assert.match(sessionService, /agreement_to_mediate_confidentiality/);
  assert.match(sessionService, /recipientRole: "client"/);
  assert.match(sessionService, /\? "Sign Confidentiality \+ Agreement to Mediate"/);
  assert.match(sessionService, /`\/cases\/\$\{session\.caseId\}\?tab=mediation-sessions`/);
  assert.match(sessionService, /catch \(error\)/);
});

test("mediation session client notifications use canonical client portal user links", () => {
  assert.match(sessionService, /const client = await storage\.getClient\(party\.clientId\)/);
  assert.match(sessionService, /if \(!client\?\.userId\) continue/);
  assert.match(sessionService, /recipientId: client\.userId/);
  assert.doesNotMatch(sessionService, /if \(!party\.userId\) continue[\s\S]*recipientId: party\.userId/);
});

test("replit documentation describes the new mediation session booking lifecycle", () => {
  assert.match(docs, /Mediation Sessions Allocation & Booking/);
  assert.match(docs, /party_required_forms/);
  assert.match(docs, /starts the 72-hour hold window/);
  assert.match(docs, /mediation_session_proposals/);
  assert.match(docs, /\/session-availability\/:token/);
  assert.match(docs, /lead mediator's approved, non-expired `Mediation Sessions` service calendar/);
  assert.match(docs, /New mediation session numbers create fresh party invoices; only replacement slots for the same mediation session carry those invoices forward/);
  assert.match(docs, /120-minute default/);
  assert.match(docs, /client-facing appointment\/session payloads expose only `hasMeetingLink`, `canJoin`, and role-safe `joinAvailability` metadata/);
  assert.match(docs, /Client case and mediation-session views are party-scoped/);
  assert.match(docs, /Mediator Mediation Sessions tab access requires lead, accepted co-mediator, or accepted observer involvement/);
  assert.match(docs, /Mediators do not receive session invoice or payment-status details/);
  assert.match(docs, /Confidentiality \+ Agreement to Mediate emails and in-app tasks link clients to the Mediation Sessions tab/);
  assert.match(docs, /mediation-session unpaid payment reminders/i);
  assert.match(docs, /mediation-session-specific admin payment-due tasks/i);
  assert.match(docs, /cancellation remains separate from no-show attendance/i);
  assert.match(docs, /no-show attendance records the no-refund marker/i);
  assert.match(docs, /number of active sessions and total mediation hours/i);
  assert.match(docs, /auto-confirm once all required clients have accepted/i);
  assert.match(docs, /lead mediator proposal recipient is created as already accepted/i);
  assert.match(docs, /clients can respond from the Mediation Sessions tab/i);
  assert.doesNotMatch(docs, /auto-confirm once all required clients and the lead mediator have accepted/i);
  assert.match(docs, /payment and form completion can each trigger the same auto-confirm readiness check/i);
  assert.match(docs, /UK business-day checks pass/);
});
