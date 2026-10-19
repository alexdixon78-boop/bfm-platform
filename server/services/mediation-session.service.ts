import crypto from "crypto";
import PDFDocument from "pdfkit";
import { storage } from "../storage";
import { db } from "../db";
import { caseActivityService, staffActor, systemActor } from "./case-activity.service";
import { notificationService } from "./notification.service";
import { logAudit } from "./audit-log.service";
import { financeService } from "./finance.service";
import { appointmentService } from "./appointment.service";
import { appointmentLifecycleHistoryService } from "./appointment-lifecycle-history.service";
import { stripePaymentService } from "./stripe-payment.service";
import { googleCalendarService } from "./google-calendar.service";
import { getMediatorAvailabilityWindows } from "./availability-windows";
import { courtFormTemplateService } from "./court-form-template.service";
import { courtFormGenerationService } from "./court-form-generation.service";
import type {
  Appointment,
  Case,
  CaseDocument,
  CaseDocumentReviewStatus,
  CaseDraftFinancialSchedule,
  CaseInvoice,
  FinancialDisclosureUploadTarget,
  MediationSessionVoucherClaim,
  MediationSessionAvailabilityWindow,
  MediationSession,
  MediationSessionNote,
  MediationSessionPartyAttendance,
  MediationSessionProposal,
  MediationSessionProposalRecipient,
  MediationSessionOutcome,
  MediationSessionParticipant,
  MediationSessionParticipantInvitationStatus,
  MediationSessionParticipantRole,
  MediationRoleOptionSets,
  Party,
  PartyRequiredForm,
  PartyRequiredFormDeliveryStatus,
  PartyRequiredFormType,
  CourtFormType,
  VoucherClaimStatus,
  User,
} from "@shared/schema";
import {
  appointments as appointmentsTable,
  appointmentStatusHistory,
  CASE_DOCUMENT_REVIEW_STATUSES,
  MEDIATION_SESSION_OUTCOMES,
  MEDIATION_SESSION_PARTICIPANT_ROLES,
  caseInvoices,
  caseDocuments,
  cases as casesTable,
  clients as clientsTable,
  demographicData,
  mediationSessionNotes,
  mediationSessionPartyAttendance,
  mediationSessionParticipants,
  mediationSessionProposals,
  mediationSessionVoucherClaims,
  mediationSessions as mediationSessionsTable,
  mediatorServiceApprovals,
  mediatorServiceTypes,
  notifications,
  partyRequiredForms,
  PARTY_REQUIRED_FORM_TYPES,
  VOUCHER_CLAIM_STATUSES,
  isVoucherClaimEligibleCase,
  buildMediationRoleOptionSets,
  isMediationRoleQualifiedFor,
} from "@shared/schema";
import type { ServiceResult } from "./types";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getEffectiveApprovalStatus } from "./mediator-service-approval.service";
import { fileStorageService } from "./file-storage.service";
import { financialDisclosureService } from "./financial-disclosure.service";
import { caseDocumentDownloadHref, isOrdinaryCaseDocument, withProtectedCaseDocumentUrl } from "../security/document-access";
import { classifyCaseAccess } from "../security/case-access-policy";
import { caseProofingService } from "./case-proofing.service";
import { hasAcceptedSessionParticipantAccess, hasLeadEquivalentSessionAccess } from "../security/session-access";
import { buildSessionJoinAvailability, type SessionJoinAvailability } from "../security/appointment-join-policy";
import { caseWhatsappService, MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME } from "./case-whatsapp.service";

type ActorUser = Pick<User, "id" | "name" | "role">;

type CaseDocumentView = CaseDocument & {
  uploadedByName: string | null;
  partyName: string | null;
  partyRole: string | null;
  proofingItemId: string | null;
  proofingStatus: string | null;
  signatureSource: string | null;
  requiredFormType: string | null;
};

type DocumentBlankFormView = {
  templateId: string | null;
  formType: CourtFormType;
  label: string;
  partyId?: string | null;
  requiredFormId?: string | null;
  downloadUrl: string | null;
  canDownload: boolean;
  canUploadCompletedForm: boolean;
  canUploadAgainstRequiredForm: boolean;
  uploadMode: "required_form" | "case_document" | null;
  status?: string | null;
  completedDocumentId?: string | null;
  completedDocumentTitle?: string | null;
  completedDocumentUrl?: string | null;
  completedDocumentReviewStatus?: string | null;
  completedDocumentProofingStatus?: string | null;
};

type DocumentBlankFormDownload = {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  contentDisposition: "attachment";
};

export type SessionReadinessIssue = {
  partyId: string;
  role: string;
  partyName: string;
  reason: "missing_miam" | "not_approved" | "unsuitable";
  label: string;
};

export type SessionParticipantView = MediationSessionParticipant & {
  userName: string;
  userEmail: string;
};

export type DraftFinancialScheduleReviewSummary = Pick<
  CaseDraftFinancialSchedule,
  "id" | "status" | "confirmedAt" | "confirmedBy" | "confirmedInSessionId" | "updatedAt"
>;

export type MediationSessionView = MediationSession & {
  leadMediatorName: string | null;
  participants: SessionParticipantView[];
  appointment?: (Appointment & { joinAvailability: SessionJoinAvailability }) | null;
  proposal?: (MediationSessionProposal & {
    recipients: Array<MediationSessionProposalRecipient & { publicUrl?: string }>;
  }) | null;
  formRequirements?: Array<{ formType: PartyRequiredFormType; label: string; applicable: boolean; issued: boolean; reason?: string }>;
  requiredForms?: PartyRequiredForm[];
  availabilityWindows?: MediationSessionAvailabilityWindow[];
  partyAttendance?: MediationSessionPartyAttendance[];
  invoices?: CaseInvoice[];
  acknowledgementTasks?: Array<{ id: string; type: string; title: string; message: string; status: string; urgency: string; createdAt: Date }>;
  noteSummary?: { count: number; latestNoteAt: Date | null; latestNoteAuthor: string | null };
  documents?: CaseDocument[];
  draftFinancialSchedule?: DraftFinancialScheduleReviewSummary | null;
  indicator?: SessionIndicator;
};

type VoucherClaimReadiness = {
  ready: boolean;
  missingFields: string[];
  signedCountLabel: string;
  outstandingClientNames: string[];
  claim: any;
};

export type MediationSessionAccess = "none" | "observer" | "co_mediator" | "full";
export type MediationSessionsSummary = {
  numberOfSessions: number;
  totalMediationHours: number;
};
export type SessionAvailabilitySlot = { startAt: Date; endAt: Date; time: string; endTime: string; duration: number };
export type ProposalAcceptancePayment = {
  paymentRequired: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  outstandingPence?: number;
  currency?: string;
  checkoutUrl?: string;
  xeroInvoiceUrl?: string;
  xeroInvoiceNumber?: string;
  paymentReference?: string;
  paymentProvider?: "stripe" | "xero_invoice";
  error?: string;
};

export type AutoConfirmTrigger = "proposal_accepted" | "form_signed" | "invoice_paid" | "manual_payment_status";
export type MediationSessionAutoConfirmation = {
  attempted: true;
  confirmed: boolean;
  reason?: "not_ready" | "already_confirmed" | "calendar_failed" | "not_found" | "no_appointment";
  error?: string;
};

export type SessionIndicator = {
  color: "red" | "amber" | "green";
  label: string;
  reason: string;
};

export type PublicProposalLinkStatus = {
  active: boolean;
  reason?: "expired" | "released" | "cancelled" | "superseded";
  message?: string;
};

type ProposalPublicLink = {
  recipientId: string;
  recipientName: string;
  recipientType: string;
  publicUrl: string;
};

type ProposalLinkOptions = {
  isReschedule?: boolean;
  includeAllParticipants?: boolean;
};

const AGREEMENT_FORM_TYPE = "agreement_to_mediate_confidentiality";
const VOUCHER_SCHEME_CONSENT_FORM_TYPE = "voucher_scheme_client_consent";
const VOUCHER_DIVERSITY_OPT_IN_FORM_TYPE = "voucher_diversity_questionnaire_opt_in";
const VOUCHER_RESEARCH_OPT_IN_FORM_TYPE = "voucher_moj_research_contact_opt_in";
const VOUCHER_PRIVACY_POLICY_CLIENT_CONSENT_FORM_TYPE = VOUCHER_RESEARCH_OPT_IN_FORM_TYPE;
const BLOCKING_FORM_TYPES: PartyRequiredFormType[] = [AGREEMENT_FORM_TYPE, VOUCHER_SCHEME_CONSENT_FORM_TYPE];
const OPTIONAL_VOUCHER_FORM_TYPES: PartyRequiredFormType[] = [
  VOUCHER_PRIVACY_POLICY_CLIENT_CONSENT_FORM_TYPE,
];
const SIGNATURE_ATTESTATION_VERSION = "mediation-session-signature-v1";
const SIGNED_FORM_DOCUMENT_CATEGORY = "signed_mediation_form";
const COURT_FORM_UPLOAD_DOCUMENT_CATEGORIES: Partial<Record<CourtFormType, string>> = {
  FM1: "court_form_fm1",
  C100: "court_form_c100",
  FormE: "court_form_form_e",
};
const POST_SESSION_REVIEW_TASK_TYPE = "mediation_session_post_session_review";
const DRAFT_FINANCIAL_SCHEDULE_DOCUMENT_CATEGORY = "draft_financial_schedule";
const nextSessionRequestAllowedStatuses = new Set(["submitted", "approved"]);
const MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_FINANCIAL_DISCLOSURE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);
const ALLOWED_FINANCIAL_DISCLOSURE_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx", "xls", "xlsx", "csv"]);
const SESSION_AVAILABILITY_PATH = "/session-availability";

function isAdmin(user: Pick<User, "role">): boolean {
  return user.role === "superadmin" || user.role === "subadmin";
}

function isSuitable(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return v === "yes" || v.startsWith("yes");
}

function mojVoucherAppliedStartsYes(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return v === "yes" || v.startsWith("yes");
}

function partyName(party: Party): string {
  return `${party.firstName || ""} ${party.lastName || ""}`.trim() || `Client ${party.role}`;
}

function isParticipantRole(value: string): value is MediationSessionParticipantRole {
  return (MEDIATION_SESSION_PARTICIPANT_ROLES as readonly string[]).includes(value);
}

function isOutcome(value: string): value is MediationSessionOutcome {
  return (MEDIATION_SESSION_OUTCOMES as readonly string[]).includes(value);
}

function hashProposalToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashParticipantInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getBaseUrl(): string {
  return process.env.APP_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
}

function sessionAvailabilityUrl(token: string): string {
  return `${getBaseUrl()}${SESSION_AVAILABILITY_PATH}/${token}`;
}

function extractSessionAvailabilityToken(publicUrl?: string): string | null {
  if (!publicUrl) return null;
  try {
    const parsed = new URL(publicUrl, getBaseUrl());
    if (!parsed.pathname.startsWith(`${SESSION_AVAILABILITY_PATH}/`)) return null;
    return parsed.pathname.split("/").filter(Boolean).pop() || null;
  } catch {
    return null;
  }
}

function formatSessionWhatsappDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseDataUrl(data: string, fallbackMimeType?: string | null): { buffer: Buffer; mimeType: string } {
  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  }
  return { mimeType: fallbackMimeType || "application/octet-stream", buffer: Buffer.from(data, "base64") };
}

function isCaseDocumentReviewStatus(value: string): value is CaseDocumentReviewStatus {
  return (CASE_DOCUMENT_REVIEW_STATUSES as readonly string[]).includes(value);
}

function isAllowedFinancialDisclosureUpload(fileName: string, mimeType: string): boolean {
  const extension = fileName.toLowerCase().split(".").pop() || "";
  return ALLOWED_FINANCIAL_DISCLOSURE_MIME_TYPES.has(mimeType.toLowerCase()) || ALLOWED_FINANCIAL_DISCLOSURE_EXTENSIONS.has(extension);
}

class MediationSessionService {
  async listMediationRoleOptions(): Promise<MediationRoleOptionSets> {
    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType) return { leadMediators: [], coMediators: [], observers: [] };
    const rows = await db
      .select({
        id: mediatorServiceApprovals.id,
        mediatorId: mediatorServiceApprovals.mediatorId,
        status: mediatorServiceApprovals.status,
        expiryDate: mediatorServiceApprovals.expiryDate,
        expiredAt: mediatorServiceApprovals.expiredAt,
      })
      .from(mediatorServiceApprovals)
      .where(eq(mediatorServiceApprovals.serviceTypeId, serviceType.id));
    const approvedMediatorIds = new Set(rows
      .filter((row) => row.mediatorId && !row.expiredAt && getEffectiveApprovalStatus(row) === "approved")
      .map((row) => row.mediatorId as string));
    const users = await storage.listUsers();
    const assignmentRows = await db.select({
      mediatorId: mediatorServiceTypes.mediatorId,
      mediationRoleQualification: mediatorServiceTypes.mediationRoleQualification,
    }).from(mediatorServiceTypes).where(eq(mediatorServiceTypes.serviceTypeId, serviceType.id));
    const qualificationByUserId = new Map(assignmentRows.map((row) => [row.mediatorId, row.mediationRoleQualification]));
    return buildMediationRoleOptionSets(users
      .filter((user) => user.role === "mediator")
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        mediationRoleQualification: (qualificationByUserId.get(user.id) || "unclassified") as any,
        mediationSessionsApproved: approvedMediatorIds.has(user.id),
      })));
  }

  async validateMediatorAssignment(
    userId: string,
    role: MediationSessionParticipantRole,
    label: string,
  ): Promise<ServiceResult<{ user: User }>> {
    if (!userId) return { ok: false, error: `${label} is required`, status: 400 };
    const user = await storage.getUser(userId);
    if (!user || user.role !== "mediator" || user.status !== "active") {
      return { ok: false, error: `${label} must be an active mediator`, status: 400 };
    }
    const approvalState = await this.mediationSessionsApprovalState(userId);
    if (approvalState === "expired") {
      return { ok: false, error: `${label}'s Mediation Sessions service approval has expired`, status: 400 };
    }
    if (approvalState !== "approved") {
      return { ok: false, error: `${label} does not have an approved Mediation Sessions service approval`, status: 400 };
    }
    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType) {
      return { ok: false, error: "Mediation Sessions service type is not configured", status: 400 };
    }
    const assignment = await db.select({
      mediationRoleQualification: mediatorServiceTypes.mediationRoleQualification,
    }).from(mediatorServiceTypes).where(and(
      eq(mediatorServiceTypes.mediatorId, userId),
      eq(mediatorServiceTypes.serviceTypeId, serviceType.id),
    )).limit(1);
    const qualification = assignment[0]?.mediationRoleQualification || "unclassified";
    if (qualification === "unclassified") {
      return { ok: false, error: `${label} has not been assigned a mediation role qualification`, status: 400 };
    }
    if (!isMediationRoleQualifiedFor(qualification, role)) {
      return { ok: false, error: `${label} is not qualified for the ${this.roleLabel(role)} role`, status: 400 };
    }
    return { ok: true, user };
  }

  async getLeadMediatorAvailableDates(
    sessionId: string,
    actor: Pick<User, "id" | "role">,
    month: string,
    durationMinutes = 120,
  ): Promise<ServiceResult<{ dates: string[]; bookingPaused: boolean; message?: string }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!(await this.canReadSession(session, actor))) return { ok: false, error: "Access denied", status: 403 };
    return this.getLeadMediatorAvailableDatesForSession(session, month, durationMinutes);
  }

  async getLeadMediatorAvailableSlots(
    sessionId: string,
    actor: Pick<User, "id" | "role">,
    date: string,
    durationMinutes = 120,
  ): Promise<ServiceResult<{ slots: SessionAvailabilitySlot[]; message?: string }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!(await this.canReadSession(session, actor))) return { ok: false, error: "Access denied", status: 403 };
    return this.getLeadMediatorAvailableSlotsForSession(session, date, durationMinutes);
  }

  async getPublicLeadMediatorAvailableDates(token: string, month: string, durationMinutes?: number): Promise<ServiceResult<{ dates: string[]; bookingPaused: boolean; message?: string }>> {
    const resolved = await this.resolvePublicProposalToken(token, false);
    if (!resolved.ok) return resolved;
    const linkStatus = this.getPublicProposalLinkStatus(resolved.proposal);
    if (!linkStatus.active) return { ok: false, error: linkStatus.message || "This session availability link is no longer active", status: 410 };
    const proposalDuration = Math.max(1, Math.round((new Date(resolved.proposal.proposedEndAt).getTime() - new Date(resolved.proposal.proposedStartAt).getTime()) / 60000));
    return this.getLeadMediatorAvailableDatesForSession(resolved.session, month, durationMinutes || proposalDuration || 120);
  }

  async getPublicLeadMediatorAvailableSlots(token: string, date: string, durationMinutes?: number): Promise<ServiceResult<{ slots: SessionAvailabilitySlot[]; message?: string }>> {
    const resolved = await this.resolvePublicProposalToken(token, false);
    if (!resolved.ok) return resolved;
    const linkStatus = this.getPublicProposalLinkStatus(resolved.proposal);
    if (!linkStatus.active) return { ok: false, error: linkStatus.message || "This session availability link is no longer active", status: 410 };
    const proposalDuration = Math.max(1, Math.round((new Date(resolved.proposal.proposedEndAt).getTime() - new Date(resolved.proposal.proposedStartAt).getTime()) / 60000));
    return this.getLeadMediatorAvailableSlotsForSession(resolved.session, date, durationMinutes || proposalDuration || 120);
  }

  async getReadiness(caseId: string): Promise<{ ready: boolean; issues: SessionReadinessIssue[] }> {
    const parties = await storage.listPartiesByCase(caseId);
    const records = await storage.listMiamRecordsByCase(caseId);
    const issues: SessionReadinessIssue[] = [];

    for (const party of parties) {
      const record = records.find((r) => r.partyId === party.id);
      const base = {
        partyId: party.id,
        role: party.role,
        partyName: partyName(party),
      };
      if (!record) {
        issues.push({ ...base, reason: "missing_miam", label: `Client ${party.role} has no MIAM record` });
        continue;
      }
      if (record.approvalStatus !== "approved") {
        issues.push({ ...base, reason: "not_approved", label: `Client ${party.role} MIAM is not approved` });
        continue;
      }
      if (!isSuitable(record.suitableForMediation)) {
        issues.push({ ...base, reason: "unsuitable", label: `Client ${party.role} MIAM is not suitable` });
      }
    }

    return { ready: parties.length > 0 && issues.length === 0, issues };
  }

  async getCaseAccess(caseId: string, user: Pick<User, "id" | "role">): Promise<MediationSessionAccess> {
    if (isAdmin(user)) return "full";
    if (user.role !== "mediator") return "none";

    const caseAccess = await classifyCaseAccess(caseId, user);
    if (caseAccess.tier === "full_mediator") return "full";
    if (caseAccess.tier === "session_co_mediator") return "co_mediator";
    if (caseAccess.tier === "session_observer") return "observer";
    return "none";
  }

  async verifyCaseAccessForActor(caseId: string, user: Pick<User, "id" | "role">): Promise<ServiceResult<{ access: MediationSessionAccess }>> {
    const c = await storage.getCase(caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    if (user.role === "client") {
      const parties = await storage.listPartiesByUserId(user.id);
      if (!parties.some((party) => party.caseId === caseId)) return { ok: false, error: "Access denied", status: 403 };
      return { ok: true, access: "full" };
    }
    const access = await this.getCaseAccess(caseId, user);
    if (user.role === "mediator" && access === "none") {
      const parties = await storage.listPartiesByCase(caseId);
      const hasMiamOnlyAccess = parties.some((party) => party.miamMediatorId === user.id);
      if (!hasMiamOnlyAccess) return { ok: false, error: "Access denied", status: 403 };
    }
    return { ok: true, access };
  }

  async listForCase(caseId: string, user: Pick<User, "id" | "role">): Promise<ServiceResult<{ sessions: MediationSessionView[]; readiness: { ready: boolean; issues: SessionReadinessIssue[] }; access: MediationSessionAccess; summary: MediationSessionsSummary }>> {
    const c = await storage.getCase(caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };

    const access = await this.getCaseAccess(caseId, user);
    if (user.role === "mediator" && access === "none") {
      const parties = await storage.listPartiesByCase(caseId);
      const hasMiamOnlyAccess = parties.some((party) => party.miamMediatorId === user.id);
      if (!hasMiamOnlyAccess) return { ok: false, error: "Access denied", status: 403 };
      return { ok: true, sessions: [], readiness: { ready: false, issues: [] }, access, summary: this.calculateMediationSessionsSummary([]) };
    }

    if (user.role === "client") {
      const parties = await storage.listPartiesByUserId(user.id);
      if (!parties.some((party) => party.caseId === caseId)) return { ok: false, error: "Access denied", status: 403 };
    }

    const [readiness, sessions] = await Promise.all([
      this.getReadiness(caseId),
      storage.listMediationSessionsByCase(caseId),
    ]);

    const enrichedSessions = await this.enrichSessions(sessions);
    const visibleSessions = user.role === "client"
      ? enrichedSessions.map((session) => this.sanitizeSessionForClient(session))
      : enrichedSessions;
    return {
      ok: true,
      sessions: visibleSessions,
      readiness: access === "observer" || access === "co_mediator" ? { ready: false, issues: [] } : readiness,
      access,
      summary: this.calculateMediationSessionsSummary(visibleSessions),
    };
  }

  private sanitizeSessionForClient(session: MediationSessionView): MediationSessionView {
    if (session.postSessionReviewStatus === "approved") return session;
    return {
      ...session,
      outcome: null,
      outcomeNotes: null,
      nextAction: null,
      documentsRequired: null,
      followUpRequirements: null,
      nextSessionRequired: false,
      postSessionReviewNotes: null,
    };
  }

  private async requireStaffSessionAccess(
    sessionId: string,
    actor: Pick<User, "id" | "role">,
    options: { edit?: boolean } = {},
  ): Promise<ServiceResult<{ session: MediationSession; access: MediationSessionAccess }>> {
    if (actor.role === "client") {
      return { ok: false, error: "Staff-only session records are not available to clients", status: 403 };
    }
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const access = await this.getCaseAccess(session.caseId, actor);
    if (!isAdmin(actor) && access === "none") return { ok: false, error: "Access denied", status: 403 };
    if (!isAdmin(actor) && access === "observer") {
      return { ok: false, error: "Observer access is limited to session scheduling context", status: 403 };
    }
    if (!isAdmin(actor) && access === "co_mediator" && !(await this.hasLeadEquivalentAccess(session, actor))) {
      return { ok: false, error: "Access is limited to the assigned lead mediator and accepted co-mediators", status: 403 };
    }
    return { ok: true, session, access };
  }

  private async hasLeadEquivalentAccess(session: MediationSession, actor: Pick<User, "id" | "role">): Promise<boolean> {
    if (isAdmin(actor)) return true;
    const participants = await storage.listMediationSessionParticipantsBySessionIds([session.id]);
    return hasLeadEquivalentSessionAccess(session, participants, actor);
  }

  private async canReadSession(session: MediationSession, actor: Pick<User, "id" | "role">): Promise<boolean> {
    if (isAdmin(actor)) return true;
    if (actor.role === "client") {
      const parties = await storage.listPartiesByUserId(actor.id);
      return parties.some((party) => party.caseId === session.caseId);
    }
    if (actor.role !== "mediator") return false;
    const access = await this.getCaseAccess(session.caseId, actor);
    if (access === "full") return true;
    const participants = await storage.listMediationSessionParticipantsBySessionIds([session.id]);
    return hasAcceptedSessionParticipantAccess(session.id, participants, actor);
  }

  async listSessionNotes(sessionId: string, actor: ActorUser): Promise<ServiceResult<{ notes: Array<MediationSessionNote & { createdByName: string }> }>> {
    const allowed = await this.requireStaffSessionAccess(sessionId, actor);
    if (!allowed.ok) return allowed;
    const notes = await storage.listMediationSessionNotes(sessionId);
    const users = await Promise.all(Array.from(new Set(notes.map((note) => note.createdBy))).map((id) => storage.getUser(id)));
    const userMap = new Map(users.filter((u): u is User => !!u).map((u) => [u.id, u.name]));
    return {
      ok: true,
      notes: notes.map((note) => ({ ...note, createdByName: userMap.get(note.createdBy) || "Unknown" })),
    };
  }

  async addSessionNote(sessionId: string, actor: ActorUser, input: { content: string }, ipAddress?: string): Promise<ServiceResult<{ note: MediationSessionNote }>> {
    const allowed = await this.requireStaffSessionAccess(sessionId, actor, { edit: true });
    if (!allowed.ok) return allowed;
    const content = input.content.trim();
    if (!content) return { ok: false, error: "Session note is required", status: 400 };
    const note = await storage.createMediationSessionNote({
      caseId: allowed.session.caseId,
      mediationSessionId: sessionId,
      content,
      createdBy: actor.id,
    });
    await this.logSessionActivity(allowed.session.caseId, "mediation_session_note_added", `Session ${allowed.session.sessionNumber} note added`, `${actor.name} added a post-session note.`, sessionId, actor);
    await logAudit({
      userId: actor.id,
      action: "create_mediation_session_note",
      entity: "session",
      entityId: sessionId,
      details: JSON.stringify({ noteId: note.id }),
      ipAddress,
    });
    return { ok: true, note };
  }

  async recordPostSessionSummary(
    sessionId: string,
    actor: ActorUser,
    input: {
      outcome: string;
      outcomeNotes?: string | null;
      nextAction?: string | null;
      documentsRequired?: string | null;
      followUpRequirements?: string | null;
      nextSessionRequired?: boolean;
    },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    const allowed = await this.requireStaffSessionAccess(sessionId, actor, { edit: true });
    if (!allowed.ok) return allowed;
    if (!isOutcome(input.outcome)) return { ok: false, error: "Invalid mediation session outcome", status: 400 };
    const updated = await storage.updateMediationSession(sessionId, {
      outcome: input.outcome,
      outcomeNotes: input.outcomeNotes?.trim() || null,
      nextAction: input.nextAction?.trim() || null,
      documentsRequired: input.documentsRequired?.trim() || null,
      followUpRequirements: input.followUpRequirements?.trim() || null,
      nextSessionRequired: Boolean(input.nextSessionRequired || input.outcome === "next_session_needed"),
      status: "completed",
      completedBy: actor.id,
      completedAt: new Date(),
      summarySubmittedBy: actor.id,
      summarySubmittedAt: new Date(),
      postSessionReviewStatus: "submitted",
      postSessionReviewRequestedBy: actor.id,
      postSessionReviewRequestedAt: new Date(),
      postSessionReviewedBy: null,
      postSessionReviewedAt: null,
      postSessionReviewNotes: null,
    });
    if (!updated) return { ok: false, error: "Failed to record post-session summary", status: 500 };

    await this.ensureAdminTask(
      allowed.session.caseId,
      updated.appointmentId || null,
      POST_SESSION_REVIEW_TASK_TYPE,
      `Review Session ${updated.sessionNumber} post-session summary`,
      `${actor.name} submitted the post-session summary for Session ${updated.sessionNumber} for admin review.`,
      "amber",
    );
    await caseProofingService.ensureProofingItemForSource({
      caseId: allowed.session.caseId,
      sessionId: updated.id,
      itemType: "session_summary",
      sourceEntityType: "mediation_session",
      sourceEntityId: updated.id,
      status: "awaiting_review",
      submittedBy: actor.id,
      submittedAt: updated.summarySubmittedAt || new Date(),
    });

    if (input.followUpRequirements?.trim()) {
      await this.ensureAdminTask(
        allowed.session.caseId,
        updated.appointmentId || null,
        "mediation_session_follow_up_required",
        `Follow-up required after Session ${updated.sessionNumber}`,
        input.followUpRequirements.trim(),
        "amber",
      );
    }
    if (input.documentsRequired?.trim()) {
      await this.ensureAdminTask(
        allowed.session.caseId,
        updated.appointmentId || null,
        "mediation_session_documents_required",
        `Documents required after Session ${updated.sessionNumber}`,
        input.documentsRequired.trim(),
        "amber",
      );
    }

    await this.logSessionActivity(allowed.session.caseId, "mediation_session_summary_recorded", `Session ${updated.sessionNumber} post-session summary recorded`, `${actor.name} recorded the post-session summary.`, sessionId, actor);
    await logAudit({
      userId: actor.id,
      action: "record_post_session_summary",
      entity: "session",
      entityId: sessionId,
      details: JSON.stringify({
        outcome: input.outcome,
        nextSessionRequired: Boolean(input.nextSessionRequired || input.outcome === "next_session_needed"),
      }),
      ipAddress,
    });
    const enriched = (await this.enrichSessions([updated]))[0];
    return { ok: true, session: enriched };
  }

  async reviewPostSessionSummary(
    sessionId: string,
    actor: ActorUser,
    input: { decision: "approved" | "changes_requested"; reviewNotes?: string | null },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can review post-session summaries", status: 403 };
    const existing = await storage.getMediationSession(sessionId);
    if (!existing) return { ok: false, error: "Mediation session not found", status: 404 };
    if (existing.postSessionReviewStatus !== "submitted" && existing.postSessionReviewStatus !== "changes_requested") {
      return { ok: false, error: "Post-session summary is not awaiting review", status: 409 };
    }

    const now = new Date();
    const updated = await storage.updateMediationSession(sessionId, {
      postSessionReviewStatus: input.decision,
      postSessionReviewedBy: actor.id,
      postSessionReviewedAt: now,
      postSessionReviewNotes: input.reviewNotes?.trim() || null,
    });
    if (!updated) return { ok: false, error: "Failed to update post-session review", status: 500 };

    if (input.decision === "approved") {
      const summaryProofingItem = await storage.getCaseProofingItemBySource("mediation_session", updated.id, "session_summary");
      if (summaryProofingItem && summaryProofingItem.status !== "approved") {
        await caseProofingService.approveProofingItem(summaryProofingItem.id, actor, ipAddress);
      }
      const schedule = await storage.getCaseDraftFinancialSchedule(updated.caseId);
      if (schedule?.status === "confirmed") {
        await caseProofingService.ensureProofingItemForSource({
          caseId: updated.caseId,
          sessionId: updated.id,
          itemType: "draft_financial_schedule",
          sourceEntityType: "case_draft_financial_schedule",
          sourceEntityId: schedule.id,
          status: "awaiting_review",
          submittedBy: schedule.confirmedBy || actor.id,
          submittedAt: schedule.confirmedAt || new Date(),
        });
      }
    }
    await this.completePostSessionReviewTask(updated, actor, input.decision);

    await this.logSessionActivity(
      existing.caseId,
      input.decision === "approved" ? "mediation_session_post_session_approved" : "mediation_session_post_session_changes_requested",
      input.decision === "approved" ? `Session ${existing.sessionNumber} post-session review approved` : `Session ${existing.sessionNumber} post-session changes requested`,
      input.decision === "approved"
        ? `${actor.name} approved the post-session summary for Session ${existing.sessionNumber}.`
        : `${actor.name} requested changes to the post-session summary for Session ${existing.sessionNumber}.`,
      sessionId,
      actor,
    );
    await logAudit({
      userId: actor.id,
      action: "review_post_session_summary",
      entity: "session",
      entityId: sessionId,
      details: JSON.stringify({ decision: input.decision, reviewNotes: input.reviewNotes || null }),
      ipAddress,
    });

    const enriched = (await this.enrichSessions([updated]))[0];
    return { ok: true, session: enriched };
  }

  private async completePostSessionReviewTask(session: MediationSession, actor: ActorUser, decision: "approved" | "changes_requested"): Promise<void> {
    const conditions = [
      eq(notifications.caseId, session.caseId),
      eq(notifications.type, POST_SESSION_REVIEW_TASK_TYPE),
      inArray(notifications.status, ["active", "in_progress", "follow_up"]),
    ];
    if (session.appointmentId) conditions.push(eq(notifications.appointmentId, session.appointmentId));
    await db.update(notifications)
      .set({
        status: "completed",
        completedBy: actor.id,
        completedAt: new Date(),
        completionNotes: decision === "approved"
          ? `Post-session review approved by ${actor.name}.`
          : `Post-session changes requested by ${actor.name}.`,
      })
      .where(and(...conditions));
  }

  deriveSessionIndicator(session: MediationSessionView): SessionIndicator {
    if (session.status === "cancelled") return { color: "red", label: "Cancelled", reason: "Session has been cancelled" };
    if (session.appointment?.status === "expired") return { color: "red", label: "Expired", reason: "Session hold expired before completion" };
    if ((session.acknowledgementTasks || []).some((task) => task.urgency === "red" && task.status !== "completed")) {
      return { color: "red", label: "Action required", reason: "Urgent session acknowledgement is open" };
    }
    if ((session.acknowledgementTasks || []).some((task) => task.type === "mediation_session_reschedule_requested" && task.status !== "completed")) {
      return { color: "amber", label: "Reschedule requested", reason: "A mediation-session reschedule request is awaiting admin review" };
    }
    if ((session.acknowledgementTasks || []).some((task) => task.type === "mediation_session_next_session_requested" && task.status !== "completed")) {
      return { color: "amber", label: "Next session requested", reason: "A next-session request is awaiting superadmin review" };
    }
    if ((session.documents || []).some((document) => document.reviewStatus === "ready_for_review")) {
      return { color: "amber", label: "Documents ready", reason: "Documents are ready for review" };
    }
    if (session.postSessionReviewStatus === "submitted") {
      return { color: "amber", label: "Pending review", reason: "Post-session summary is awaiting admin review" };
    }
    if (session.postSessionReviewStatus === "changes_requested") {
      return { color: "amber", label: "Changes requested", reason: "Post-session summary needs mediator changes" };
    }
    if (session.status === "completed") return { color: "green", label: "Completed", reason: "Post-session record completed" };
    if ((session.requiredForms || []).some((form) => BLOCKING_FORM_TYPES.includes(form.formType as PartyRequiredFormType) && form.status !== "signed")) {
      return { color: "amber", label: "Forms pending", reason: "Required client forms are still unsigned" };
    }
    if ((session.invoices || []).some((invoice) => invoice.outstandingPence > 0 && invoice.status !== "paid" && invoice.status !== "void")) {
      return { color: "amber", label: "Payment pending", reason: "One or more session invoices remain unpaid" };
    }
    if (session.appointment?.status === "confirmed" || session.status === "scheduled") {
      return { color: "green", label: "Confirmed", reason: "Session is confirmed or ready" };
    }
    return { color: "amber", label: "Pending", reason: "Session setup is still in progress" };
  }

  private proofingItemTypeForDocument(document: CaseDocument): "case_document" | "financial_disclosure_checklist" {
    return document.financialDisclosureUploadTarget === "financial_disclosure_checklist" ? "financial_disclosure_checklist" : "case_document";
  }

  private async ensureCaseDocumentProofingItem(document: CaseDocument, actor: ActorUser): Promise<void> {
    if (document.documentRequestId || document.documentCategory === "requested_evidence") return;
    if (document.reviewStatus !== "ready_for_review") return;
    await caseProofingService.ensureProofingItemForSource({
      caseId: document.caseId,
      sessionId: document.mediationSessionId || null,
      itemType: this.proofingItemTypeForDocument(document),
      sourceEntityType: "case_document",
      sourceEntityId: document.id,
      status: "awaiting_review",
      submittedBy: document.uploadedBy || actor.id,
      submittedAt: document.readyForReviewAt || document.createdAt || new Date(),
    });
  }

  private async enrichCaseDocuments(documents: CaseDocument[]): Promise<CaseDocumentView[]> {
    if (documents.length === 0) return [];
    const caseId = documents[0].caseId;
    const [proofingItems, requiredForms] = await Promise.all([
      storage.listCaseProofingItems(caseId),
      storage.listPartyRequiredFormsByCase(caseId),
    ]);
    const proofingByDocumentId = new Map(
      proofingItems
        .filter((item) => item.sourceEntityType === "case_document")
        .map((item) => [item.sourceEntityId, item]),
    );
    const requiredFormByDocumentId = new Map<string, PartyRequiredForm>();
    for (const form of requiredForms) {
      if (form.uploadedDocumentId) requiredFormByDocumentId.set(form.uploadedDocumentId, form);
      if (form.generatedDocumentId) requiredFormByDocumentId.set(form.generatedDocumentId, form);
    }

    return Promise.all(documents.map(async (document) => {
      const [uploader, party] = await Promise.all([
        storage.getUser(document.uploadedBy),
        document.partyId ? storage.getParty(document.partyId) : Promise.resolve(undefined),
      ]);
      const client = party ? await storage.getClient(party.clientId) : undefined;
      const clientName = `${client?.firstName || ""} ${client?.lastName || ""}`.trim();
      const proofingItem = proofingByDocumentId.get(document.id);
      const requiredForm = requiredFormByDocumentId.get(document.id);
      return withProtectedCaseDocumentUrl({
        ...document,
        uploadedByName: uploader?.name || null,
        partyName: party ? (clientName ? `${clientName} (Client ${party.role})` : partyName(party)) : null,
        partyRole: party?.role || null,
        proofingItemId: proofingItem?.id || null,
        proofingStatus: proofingItem?.status || null,
        signatureSource: requiredForm?.signatureSource || null,
        requiredFormType: requiredForm?.formType || null,
      });
    }));
  }

  async listCaseDocuments(caseId: string, actor: ActorUser): Promise<ServiceResult<{ documents: CaseDocumentView[] }>> {
    const access = await classifyCaseAccess(caseId, actor);
    if (access.tier === "none" || access.tier === "miam_only_mediator" || access.tier === "session_observer") {
      return { ok: false, error: "Access denied", status: 403 };
    }
    const documents = await storage.listCaseDocumentsByCase(caseId);
    const visibleDocuments = access.tier === "client_party"
      ? documents.filter((document) => document.sharedWithClients
        && document.reviewStatus === "reviewed"
        && (!document.partyId || document.partyId === access.partyId))
      : access.tier === "session_co_mediator"
      ? documents.filter(isOrdinaryCaseDocument)
      : documents;
    return { ok: true, documents: await this.enrichCaseDocuments(visibleDocuments) };
  }

  async listDocumentBlankForms(caseId: string, actor: ActorUser): Promise<ServiceResult<{ forms: DocumentBlankFormView[] }>> {
    const access = await classifyCaseAccess(caseId, actor);
    if (access.tier === "none" || access.tier === "miam_only_mediator" || access.tier === "session_observer") {
      return { ok: false, error: "Access denied", status: 403 };
    }
    const caseForBlankForms = await storage.getCase(caseId);
    if (!caseForBlankForms) return { ok: false, error: "Case not found", status: 404 };
    const parties = access.tier === "client_party"
      ? (await storage.listPartiesByCase(caseId)).filter((party) => party.id === access.partyId)
      : await storage.listPartiesByCase(caseId);
    const caseParties = parties.filter((party) => party.caseId === caseId);
    const partyIds = caseParties.map((party) => party.id);
    const requiredForms = partyIds.length > 0
      ? (await storage.listPartyRequiredFormsByPartyIds(partyIds)).filter((form) => form.caseId === caseId)
      : [];
    const documents = await storage.listCaseDocumentsByCase(caseId);
    const proofingItems = await storage.listCaseProofingItems(caseId);
    const proofingStatusByDocumentId = new Map(
      proofingItems
        .filter((item) => item.sourceEntityType === "case_document")
        .map((item) => [item.sourceEntityId, item.status]),
    );
    const rows: DocumentBlankFormView[] = [];
    const seen = new Set<string>();
    const requiredFormLogicalKeys = new Set<string>();
    const addRow = (row: DocumentBlankFormView) => {
      const key = `${row.formType}:${row.partyId || "case"}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    for (const form of requiredForms) {
      if (form.formType === VOUCHER_DIVERSITY_OPT_IN_FORM_TYPE) continue;
      const courtFormType = this.requiredFormCourtFormType(form.formType);
      if (!courtFormType) continue;
      requiredFormLogicalKeys.add(`${courtFormType}:${form.partyId || "case"}`);
      const template = await courtFormTemplateService.getCurrentCourtFormTemplate(courtFormType);
      const completedDocument = this.bestDocumentForRequiredForm(form, documents);
      addRow({
        templateId: template && !template.deletedAt ? template.id : null,
        formType: courtFormType,
        label: this.formLabel(form.formType),
        partyId: form.partyId,
        requiredFormId: form.id,
        downloadUrl: template && !template.deletedAt ? `/api/cases/${caseId}/document-blank-forms/${template.id}/download` : null,
        canDownload: Boolean(template && !template.deletedAt),
        canUploadCompletedForm: form.status !== "signed" && !form.withdrawnAt,
        canUploadAgainstRequiredForm: form.status !== "signed" && !form.withdrawnAt,
        uploadMode: form.status !== "signed" && !form.withdrawnAt ? "required_form" : null,
        status: form.withdrawnAt ? "withdrawn" : form.status,
        completedDocumentId: completedDocument?.id || null,
        completedDocumentTitle: completedDocument?.title || null,
        completedDocumentUrl: completedDocument ? caseDocumentDownloadHref(completedDocument.id) : null,
        completedDocumentReviewStatus: completedDocument?.reviewStatus || null,
        completedDocumentProofingStatus: completedDocument ? proofingStatusByDocumentId.get(completedDocument.id) || null : null,
      });
    }

    const fallbackPartyId = actor.role === "client" ? caseParties[0]?.id || null : null;
    const addCurrentBlankTemplate = async (formType: CourtFormType, label: string, partyId: string | null = fallbackPartyId, uploadMode: "case_document" | null = null) => {
      if (requiredFormLogicalKeys.has(`${formType}:${partyId || "case"}`)) return;
      const template = await courtFormTemplateService.getCurrentCourtFormTemplate(formType);
      if (!template || template.deletedAt) return;
      const completedDocument = this.bestDocumentForCourtForm(formType, partyId, documents);
      addRow({
        templateId: template.id,
        formType,
        label,
        partyId,
        requiredFormId: null,
        downloadUrl: `/api/cases/${caseId}/document-blank-forms/${template.id}/download`,
        canDownload: true,
        canUploadCompletedForm: uploadMode === "case_document",
        canUploadAgainstRequiredForm: false,
        uploadMode,
        status: completedDocument?.reviewStatus || "outstanding",
        completedDocumentId: completedDocument?.id || null,
        completedDocumentTitle: completedDocument?.title || null,
        completedDocumentUrl: completedDocument ? caseDocumentDownloadHref(completedDocument.id) : null,
        completedDocumentReviewStatus: completedDocument?.reviewStatus || null,
        completedDocumentProofingStatus: completedDocument ? proofingStatusByDocumentId.get(completedDocument.id) || null : null,
      });
    };

    if (this.isFamilyMediationCase(caseForBlankForms)) {
      await addCurrentBlankTemplate("AgreementToMediate", this.formLabel(AGREEMENT_FORM_TYPE));
    }
    if (caseForBlankForms.voucherClaimEligible) {
      await addCurrentBlankTemplate("VoucherSchemeClientConsent", this.formLabel(VOUCHER_SCHEME_CONSENT_FORM_TYPE));
      await addCurrentBlankTemplate("VoucherMojResearchContactOptIn", this.formLabel(VOUCHER_RESEARCH_OPT_IN_FORM_TYPE));
    }

    const genericTypes: CourtFormType[] = ["FM1", "C100", "FormA", "FormE"];
    for (const formType of genericTypes) {
      await addCurrentBlankTemplate(formType, this.courtFormLabel(formType), fallbackPartyId, COURT_FORM_UPLOAD_DOCUMENT_CATEGORIES[formType] ? "case_document" : null);
    }

    return { ok: true, forms: rows };
  }

  async downloadDocumentBlankForm(caseId: string, templateId: string, actor: ActorUser): Promise<ServiceResult<DocumentBlankFormDownload>> {
    const formsResult = await this.listDocumentBlankForms(caseId, actor);
    if (!formsResult.ok) return formsResult;
    if (!this.isDocumentBlankFormRelevant(formsResult.forms, templateId)) {
      return { ok: false, error: "Blank form is not available for this case", status: 404 };
    }
    const template = await storage.getCourtFormTemplate(templateId);
    if (!template || template.deletedAt) return { ok: false, error: "Blank form is not available", status: 404 };
    const buffer = await courtFormTemplateService.getTemplateBuffer(template);
    const label = formsResult.forms.find((form) => form.templateId === templateId)?.label || template.sourceFileName || "blank-form";
    return {
      ok: true,
      buffer,
      fileName: `${sanitizeFileName(label)}.pdf`,
      contentType: "application/pdf",
      contentDisposition: "attachment",
    };
  }

  async uploadDocumentBlankForm(
    caseId: string,
    templateId: string,
    actor: ActorUser,
    input: { fileName: string; fileData: string; mimeType?: string | null; signerName: string; signedAt: Date },
    ipAddress?: string,
  ): Promise<ServiceResult<{ document: CaseDocument }>> {
    if (actor.role !== "client") return { ok: false, error: "Only clients can upload completed court forms from Case documents", status: 403 };
    const formsResult = await this.listDocumentBlankForms(caseId, actor);
    if (!formsResult.ok) return formsResult;
    const row = formsResult.forms.find((form) => form.templateId === templateId && form.uploadMode === "case_document");
    if (!row || !row.templateId || !COURT_FORM_UPLOAD_DOCUMENT_CATEGORIES[row.formType]) {
      return { ok: false, error: "This blank form cannot be uploaded from Case documents", status: 404 };
    }
    const parties = await storage.listPartiesByUserId(actor.id);
    const party = parties.find((candidate) => candidate.caseId === caseId && (!row.partyId || candidate.id === row.partyId));
    if (!party) return { ok: false, error: "Access denied", status: 403 };
    const signerName = input.signerName.trim();
    if (!signerName) return { ok: false, error: "Signer name is required", status: 400 };
    const signedAt = new Date(input.signedAt);
    if (Number.isNaN(signedAt.valueOf())) return { ok: false, error: "Signed date is required", status: 400 };
    if (!input.fileName?.trim() || !input.fileData?.trim()) return { ok: false, error: "Document file is required", status: 400 };

    const parsed = parseDataUrl(input.fileData, input.mimeType);
    const safeName = `${crypto.randomUUID()}-${sanitizeFileName(input.fileName)}`;
    const stored = await fileStorageService.saveCaseDocumentFile({ fileName: safeName, buffer: parsed.buffer, mimeType: parsed.mimeType });
    const document = await storage.createCaseDocument({
      caseId,
      mediationSessionId: null,
      partyId: party.id,
      documentCategory: COURT_FORM_UPLOAD_DOCUMENT_CATEGORIES[row.formType]!,
      title: `${row.label} - signed upload`,
      fileName: safeName,
      fileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType: parsed.mimeType,
      documentDate: signedAt,
      fileSizeBytes: parsed.buffer.byteLength,
      uploadedBy: actor.id,
      reviewStatus: "ready_for_review",
      reviewedBy: null,
      reviewedAt: null,
      readyForReviewAt: new Date(),
      sharedWithClients: true,
    });
    await this.createDocumentsReadyForReviewTask(document, actor);
    await this.ensureCaseDocumentProofingItem(document, actor);
    await this.logSessionActivity(caseId, "case_document_uploaded", "Court form uploaded for review", `${actor.name} uploaded ${row.label}.`, document.id, actor);
    await logAudit({
      userId: actor.id,
      action: "upload_court_form_document",
      entity: "case_document",
      entityId: document.id,
      details: JSON.stringify({ caseId, formType: row.formType, signerName }),
      ipAddress,
    });
    return { ok: true, document: withProtectedCaseDocumentUrl(document) };
  }

  async getMediatorSessionIndicators(actor: ActorUser): Promise<ServiceResult<{ indicators: Array<{
    sessionId: string;
    caseId: string;
    sessionNumber: number;
    caseRef: string;
    appointmentAt: Date | null;
    indicator: SessionIndicator;
  }> }>> {
    if (actor.role !== "mediator") return { ok: false, error: "Mediator session indicators are only available to mediators", status: 403 };
    const sessions = await db
      .select()
      .from(mediationSessionsTable)
      .where(eq(mediationSessionsTable.leadMediatorId, actor.id));
    const enriched = await this.enrichSessions(sessions);
    const active = enriched
      .filter((session) => session.status !== "cancelled")
      .sort((a, b) => {
        const aTime = a.appointment?.dateTime ? new Date(a.appointment.dateTime).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.appointment?.dateTime ? new Date(b.appointment.dateTime).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      })
      .slice(0, 8);
    const caseRows = await Promise.all(Array.from(new Set(active.map((session) => session.caseId))).map((caseId) => storage.getCase(caseId)));
    const caseMap = new Map(caseRows.filter((row): row is Case => !!row).map((row) => [row.id, row.caseRef]));
    return {
      ok: true,
      indicators: active.map((session) => ({
        sessionId: session.id,
        caseId: session.caseId,
        sessionNumber: session.sessionNumber,
        caseRef: caseMap.get(session.caseId) || "Case",
        appointmentAt: session.appointment?.dateTime ? new Date(session.appointment.dateTime) : null,
        indicator: session.indicator || this.deriveSessionIndicator(session),
      })),
    };
  }

  async requestSessionReschedule(
    sessionId: string,
    actor: ActorUser,
    input: { reason: string; windows: Array<{ startAt: Date; endAt: Date; notes?: string | null }> },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView; windows: MediationSessionAvailabilityWindow[] }>> {
    const allowed = await this.requireStaffSessionAccess(sessionId, actor, { edit: true });
    if (!allowed.ok) return allowed;
    const { session } = allowed;
    if (!(await this.hasLeadEquivalentAccess(session, actor))) {
      return { ok: false, error: "Only superadmins, subadmins, the lead mediator, and accepted co-mediators can request mediation session rescheduling", status: 403 };
    }
    if (!["allocated", "scheduled"].includes(session.status)) {
      return { ok: false, error: "Only active or scheduled mediation sessions can be rescheduled", status: 409 };
    }

    const reason = input.reason.trim();
    if (!reason) return { ok: false, error: "Reschedule reason is required", status: 400 };
    const normalized = input.windows.map((window) => ({
      startAt: new Date(window.startAt),
      endAt: new Date(window.endAt),
      notes: window.notes?.trim() || reason,
    }));
    if (normalized.length === 0 || normalized.length > 20) {
      return { ok: false, error: "Submit between 1 and 20 alternative availability windows", status: 400 };
    }
    for (const window of normalized) {
      if (Number.isNaN(window.startAt.valueOf()) || Number.isNaN(window.endAt.valueOf()) || window.endAt <= window.startAt) {
        return { ok: false, error: "Alternative availability windows must have a valid start and end time", status: 400 };
      }
      if (window.startAt <= new Date()) return { ok: false, error: "Alternative availability windows must be in the future", status: 400 };
    }

    const rows = await storage.replaceMediationSessionAvailabilityForRescheduleRequest(
      sessionId,
      actor.id,
      normalized.map((window) => ({
        caseId: session.caseId,
        mediationSessionId: sessionId,
        partyId: null,
        proposalRecipientId: null,
        startAt: window.startAt,
        endAt: window.endAt,
        source: "reschedule_request",
        submittedBy: actor.id,
        notes: window.notes,
      })),
    );

    const c = await storage.getCase(session.caseId);
    const appointment = session.appointmentId ? (await storage.getAppointment(session.appointmentId)) || null : null;
    const appointmentTime = appointment?.dateTime ? new Date(appointment.dateTime) : null;
    const imminent = appointmentTime ? appointmentTime.getTime() - Date.now() <= 72 * 60 * 60 * 1000 : false;
    const urgency = imminent ? "red" : "amber";
    const title = `Mediation Session ${session.sessionNumber} reschedule requested`;
    const message = `${actor.name} requested rescheduling for Mediation Session ${session.sessionNumber}${c?.caseRef ? ` on case ${c.caseRef}` : ""}. Reason: ${reason}`;

    await this.ensureAdminTask(session.caseId, appointment?.id || null, "mediation_session_reschedule_requested", title, message, urgency);
    await this.notifySessionParticipantsOfRescheduleRequest(session, appointment, actor, reason);
    await caseActivityService.log({
      caseId: session.caseId,
      type: "mediation_session_reschedule_requested",
      title,
      description: message,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({
        appointmentId: appointment?.id || null,
        reason,
        windows: rows.map((row) => ({ startAt: row.startAt, endAt: row.endAt })),
      }),
      actor: staffActor(actor),
    });
    await logAudit({
      userId: actor.id,
      action: "request_mediation_session_reschedule",
      entity: "session",
      entityId: session.id,
      entityRef: c?.caseRef || session.caseId,
      details: JSON.stringify({ appointmentId: appointment?.id || null, reason, windowCount: rows.length }),
      ipAddress,
    });

    return { ok: true, session: (await this.enrichSessions([session]))[0], windows: rows };
  }

  async requestNextSession(
    sessionId: string,
    actor: ActorUser,
    input: { reason: string; windows: Array<{ startAt: Date; endAt: Date; notes?: string | null }> },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView; windows: MediationSessionAvailabilityWindow[] }>> {
    const allowed = await this.requireStaffSessionAccess(sessionId, actor, { edit: true });
    if (!allowed.ok) return allowed;
    const { session } = allowed;
    if (!(await this.hasLeadEquivalentAccess(session, actor)) || isAdmin(actor)) {
      return { ok: false, error: "Only the lead mediator or an accepted co-mediator can request the next session", status: 403 };
    }
    if (session.status !== "completed") {
      return { ok: false, error: "Only completed mediation sessions can request a next session", status: 409 };
    }
    if (session.outcome !== "next_session_needed" && !session.nextSessionRequired) {
      return { ok: false, error: "Session outcome must require a next session before requesting one", status: 409 };
    }
    const reviewStatus = session.postSessionReviewStatus || "not_submitted";
    if (!nextSessionRequestAllowedStatuses.has(session.postSessionReviewStatus || "not_submitted")) {
      if (reviewStatus === "changes_requested") {
        return { ok: false, error: "Post-session changes must be resubmitted before requesting the next session", status: 409 };
      }
      return { ok: false, error: "Post-session summary must be submitted before requesting the next session", status: 409 };
    }

    const reason = input.reason.trim();
    if (!reason) return { ok: false, error: "Next-session request reason is required", status: 400 };
    const normalized = input.windows.map((window) => ({
      startAt: new Date(window.startAt),
      endAt: new Date(window.endAt),
      notes: window.notes?.trim() || reason,
    }));
    if (normalized.length === 0 || normalized.length > 20) {
      return { ok: false, error: "Submit between 1 and 20 suggested next-session windows", status: 400 };
    }
    for (const window of normalized) {
      if (Number.isNaN(window.startAt.valueOf()) || Number.isNaN(window.endAt.valueOf()) || window.endAt <= window.startAt) {
        return { ok: false, error: "Suggested next-session windows must have a valid start and end time", status: 400 };
      }
      if (window.startAt <= new Date()) return { ok: false, error: "Suggested next-session windows must be in the future", status: 400 };
    }

    const rows = await storage.replaceMediationSessionAvailabilityForNextSessionRequest(
      sessionId,
      actor.id,
      normalized.map((window) => ({
        caseId: session.caseId,
        mediationSessionId: sessionId,
        partyId: null,
        proposalRecipientId: null,
        startAt: window.startAt,
        endAt: window.endAt,
        source: "next_session_request",
        submittedBy: actor.id,
        notes: window.notes,
      })),
    );

    const c = await storage.getCase(session.caseId);
    const title = `Next session requested for Mediation Session ${session.sessionNumber}`;
    const message = `${actor.name} requested the next mediation session${c?.caseRef ? ` for case ${c.caseRef}` : ""}. Superadmin must review the suggested slot and send the proposal links. Reason: ${reason}`;
    await this.ensureAdminTask(session.caseId, null, "mediation_session_next_session_requested", title, message, "amber");
    await caseActivityService.log({
      caseId: session.caseId,
      type: "mediation_session_next_session_requested",
      title,
      description: message,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({
        reason,
        windows: rows.map((row) => ({ startAt: row.startAt, endAt: row.endAt })),
      }),
      actor: staffActor(actor),
    });
    await logAudit({
      userId: actor.id,
      action: "request_mediation_session_next_session",
      entity: "session",
      entityId: session.id,
      entityRef: c?.caseRef || session.caseId,
      details: JSON.stringify({ reason, windowCount: rows.length }),
      ipAddress,
    });

    return { ok: true, session: (await this.enrichSessions([session]))[0], windows: rows };
  }

  async uploadCaseDocument(
    caseId: string,
    actor: ActorUser,
    input: { title: string; fileName: string; fileData: string; mimeType?: string | null; documentDate?: Date | null; fileSizeBytes?: number | null; mediationSessionId?: string | null; financialDisclosureFolderId?: string | null; financialDisclosureItemId?: string | null; financialDisclosureEvidenceCategoryId?: string | null; financialDisclosureUploadTarget?: FinancialDisclosureUploadTarget | null; readyForReview?: boolean; sharedWithClients?: boolean },
    ipAddress?: string,
  ): Promise<ServiceResult<{ document: CaseDocument }>> {
    const accessResult = await this.verifyCaseAccessForActor(caseId, actor);
    if (!accessResult.ok) return accessResult;
    if (actor.role === "client" && !input.financialDisclosureFolderId) {
      return { ok: false, error: "Client document uploads must be attached to their financial disclosure folder", status: 403 };
    }
    if (actor.role !== "client" && !isAdmin(actor) && accessResult.access !== "full") {
      const error = accessResult.access === "co_mediator"
        ? "Co-mediator Documents access is read-only"
        : "Observer access cannot edit post-session records";
      return { ok: false, error, status: 403 };
    }
    const title = input.title.trim();
    if (!title) return { ok: false, error: "Document title is required", status: 400 };
    if (!input.fileName?.trim() || !input.fileData?.trim()) return { ok: false, error: "Document file is required", status: 400 };
    if (input.mediationSessionId) {
      const session = await storage.getMediationSession(input.mediationSessionId);
      if (!session || session.caseId !== caseId) return { ok: false, error: "Document session must belong to this case", status: 400 };
    }
    let financialDisclosureTag: { folderId: string; itemId: string | null; evidenceCategoryId: string | null; uploadTarget: FinancialDisclosureUploadTarget } | null = null;
    try {
      financialDisclosureTag = await financialDisclosureService.validateFinancialDisclosureUploadMetadata(caseId, actor, input);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid financial disclosure upload metadata", status: 400 };
    }
    const safeName = `${crypto.randomUUID()}-${sanitizeFileName(input.fileName || "document.bin")}`;
    const parsed = parseDataUrl(input.fileData, input.mimeType);
    const mimeType = input.mimeType || parsed.mimeType;
    if (financialDisclosureTag) {
      if (!isAllowedFinancialDisclosureUpload(input.fileName, mimeType)) {
        return { ok: false, error: "Financial disclosure uploads must be PDF, image, Word, Excel, or CSV files", status: 415 };
      }
      if ((input.fileSizeBytes && input.fileSizeBytes > MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES) || parsed.buffer.byteLength > MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES) {
        return { ok: false, error: "Financial disclosure uploads must be 25MB or smaller", status: 413 };
      }
    }
    const stored = await fileStorageService.saveCaseDocumentFile({ fileName: safeName, buffer: parsed.buffer, mimeType });
    const reviewStatus: CaseDocumentReviewStatus = input.readyForReview ? "ready_for_review" : "draft";
    const document = await storage.createCaseDocument({
      caseId,
      mediationSessionId: input.mediationSessionId || null,
      financialDisclosureFolderId: financialDisclosureTag?.folderId || null,
      financialDisclosureItemId: financialDisclosureTag?.itemId || null,
      financialDisclosureEvidenceCategoryId: financialDisclosureTag?.evidenceCategoryId || null,
      financialDisclosureUploadTarget: financialDisclosureTag?.uploadTarget || null,
      title,
      fileName: input.fileName,
      fileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType,
      documentDate: input.documentDate ? new Date(input.documentDate) : null,
      fileSizeBytes: parsed.buffer.byteLength,
      uploadedBy: actor.id,
      reviewStatus,
      readyForReviewAt: reviewStatus === "ready_for_review" ? new Date() : null,
      reviewedBy: null,
      reviewedAt: null,
      sharedWithClients: reviewStatus === "ready_for_review" ? false : Boolean(input.sharedWithClients),
    });
    if (reviewStatus === "ready_for_review") {
      await this.createDocumentsReadyForReviewTask(document, actor);
      await this.ensureCaseDocumentProofingItem(document, actor);
    }
    await this.logSessionActivity(caseId, "case_document_uploaded", "Case document uploaded", `${actor.name} uploaded ${title}.`, input.mediationSessionId || document.id, actor);
    await logAudit({
      userId: actor.id,
      action: "upload_case_document",
      entity: "case_document",
      entityId: document.id,
      details: JSON.stringify({ caseId, mediationSessionId: input.mediationSessionId || null, reviewStatus }),
      ipAddress,
    });
    return { ok: true, document: withProtectedCaseDocumentUrl(document) };
  }

  async updateCaseDocumentReview(
    documentId: string,
    actor: ActorUser,
    input: { reviewStatus: string; sharedWithClients?: boolean },
    ipAddress?: string,
  ): Promise<ServiceResult<{ document: CaseDocument }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can review case documents", status: 403 };
    if (!isCaseDocumentReviewStatus(input.reviewStatus)) return { ok: false, error: "Invalid document review status", status: 400 };
    if (input.reviewStatus === "reviewed" || input.sharedWithClients === true) {
      return { ok: false, error: "Approve this document from Proofing before releasing it to clients", status: 409 };
    }
    const existing = await storage.getCaseDocument(documentId);
    if (!existing) return { ok: false, error: "Case document not found", status: 404 };
    if (existing.documentRequestId || existing.documentCategory === "requested_evidence") {
      return { ok: false, error: "Requested evidence is managed through its document request", status: 409 };
    }
    const document = await storage.updateCaseDocument(documentId, {
      reviewStatus: input.reviewStatus,
      readyForReviewAt: input.reviewStatus === "ready_for_review" ? (existing.readyForReviewAt || new Date()) : existing.readyForReviewAt,
      reviewedBy: input.reviewStatus === "reviewed" ? actor.id : null,
      reviewedAt: input.reviewStatus === "reviewed" ? new Date() : null,
      sharedWithClients: false,
    });
    if (!document) return { ok: false, error: "Failed to update document review", status: 500 };
    if (input.reviewStatus === "ready_for_review") {
      await this.createDocumentsReadyForReviewTask(document, actor);
      await this.ensureCaseDocumentProofingItem(document, actor);
    }
    await logAudit({
      userId: actor.id,
      action: "review_case_document",
      entity: "case_document",
      entityId: documentId,
      details: JSON.stringify({ reviewStatus: input.reviewStatus, sharedWithClients: document.sharedWithClients }),
      ipAddress,
    });
    return { ok: true, document: withProtectedCaseDocumentUrl(document) };
  }

  private async isSafeEmptyNextSessionDraft(session: MediationSession): Promise<boolean> {
    if (session.status !== "allocated") return false;
    if (session.appointmentId) return false;
    if (
      session.outcome ||
      session.outcomeNotes ||
      session.nextAction ||
      session.documentsRequired ||
      session.followUpRequirements ||
      session.nextSessionRequired ||
      session.summarySubmittedAt ||
      session.completedAt
    ) return false;

    const [proposals, forms, notes, documents, attendance, appointmentHistory] = await Promise.all([
      db.select({ id: mediationSessionProposals.id }).from(mediationSessionProposals).where(eq(mediationSessionProposals.mediationSessionId, session.id)).limit(1),
      db.select({ id: partyRequiredForms.id }).from(partyRequiredForms).where(eq(partyRequiredForms.mediationSessionId, session.id)).limit(1),
      db.select({ id: mediationSessionNotes.id }).from(mediationSessionNotes).where(eq(mediationSessionNotes.mediationSessionId, session.id)).limit(1),
      db.select({ id: caseDocuments.id }).from(caseDocuments).where(eq(caseDocuments.mediationSessionId, session.id)).limit(1),
      db.select({ id: mediationSessionPartyAttendance.id }).from(mediationSessionPartyAttendance).where(eq(mediationSessionPartyAttendance.mediationSessionId, session.id)).limit(1),
      db.select({ id: appointmentStatusHistory.id }).from(appointmentStatusHistory).where(eq(appointmentStatusHistory.mediationSessionId, session.id)).limit(1),
    ]);

    if (proposals.length > 0) return false;
    if (forms.length > 0) return false;
    if (notes.length > 0) return false;
    if (documents.length > 0) return false;
    if (attendance.length > 0) return false;
    if (appointmentHistory.length > 0) return false;
    return true;
  }

  private async deleteSafeEmptyMediationSession(session: MediationSession): Promise<boolean> {
    if (!(await this.isSafeEmptyNextSessionDraft(session))) return false;
    await db.delete(mediationSessionParticipants).where(eq(mediationSessionParticipants.sessionId, session.id));
    const deleted = await db.delete(mediationSessionsTable).where(eq(mediationSessionsTable.id, session.id)).returning({ id: mediationSessionsTable.id });
    return deleted.length > 0;
  }

  private async cleanupEmptyDuplicateNextSessions(caseId: string, expectedSessionNumber: number): Promise<void> {
    const sessions = await storage.listMediationSessionsByCase(caseId);
    const laterSessions = sessions
      .filter((session) => session.sessionNumber > expectedSessionNumber)
      .sort((a, b) => b.sessionNumber - a.sessionNumber);
    for (const session of laterSessions) {
      if (await this.isSafeEmptyNextSessionDraft(session)) {
        await this.deleteSafeEmptyMediationSession(session);
      }
    }
  }

  private async findReusableNextSessionDraft(caseId: string, expectedSessionNumber: number): Promise<MediationSession | null> {
    const sessions = await storage.listMediationSessionsByCase(caseId);
    const existingNextSession = sessions.find((session) => session.sessionNumber === expectedSessionNumber);
    if (!existingNextSession) return null;
    if (existingNextSession.appointmentId || !(await this.isSafeEmptyNextSessionDraft(existingNextSession))) {
      return existingNextSession;
    }
    return existingNextSession;
  }

  private async validateNextSessionProposalPreflight(previousSession: MediationSession, input: { dateTime: Date; duration?: number }): Promise<ServiceResult<{}>> {
    if (!previousSession.leadMediatorId) return { ok: false, error: "Lead mediator is required before proposing the next session", status: 409 };
    const start = new Date(input.dateTime);
    if (Number.isNaN(start.valueOf()) || start <= new Date()) return { ok: false, error: "Session hold time must be in the future", status: 400 };
    const readiness = await this.getReadiness(previousSession.caseId);
    if (!readiness.ready) return { ok: false, error: "Mediation session booking is blocked until every party has an approved suitable MIAM", status: 409 };
    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType || !serviceType.onlinePaymentEnabled || !serviceType.paymentAmountPence || serviceType.paymentAmountPence <= 0) {
      return { ok: false, error: "Configure a positive online payment amount for the Mediation Sessions service type before placing a hold", status: 409 };
    }
    const mediator = await storage.getUser(previousSession.leadMediatorId);
    if (!mediator || mediator.role !== "mediator" || mediator.status !== "active") return { ok: false, error: "Lead mediator must be active", status: 400 };
    return { ok: true };
  }

  async proposeNextSession(
    previousSessionId: string,
    actor: ActorUser,
    input: { dateTime: Date; duration?: number; voucherFormRequired?: boolean },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView; proposalLinks: ProposalPublicLink[] }>> {
    const allowed = await this.requireStaffSessionAccess(previousSessionId, actor, { edit: true });
    if (!allowed.ok) return allowed;
    if (actor.role !== "superadmin") {
      return { ok: false, error: "Only superadmins can propose the next session", status: 403 };
    }
    if (allowed.session.postSessionReviewStatus !== "approved") {
      return { ok: false, error: "Post-session review must be approved before proposing the next session", status: 409 };
    }
    const preflight = await this.validateNextSessionProposalPreflight(allowed.session, input);
    if (!preflight.ok) return preflight;
    const participants = await storage.listMediationSessionParticipants(previousSessionId);
    const expectedNextSessionNumber = allowed.session.sessionNumber + 1;
    await this.cleanupEmptyDuplicateNextSessions(allowed.session.caseId, expectedNextSessionNumber);

    const existingNextSession = await this.findReusableNextSessionDraft(allowed.session.caseId, expectedNextSessionNumber);
    if (existingNextSession && (existingNextSession.appointmentId || !(await this.isSafeEmptyNextSessionDraft(existingNextSession)))) {
      return { ok: false, error: "Next mediation session already exists; review the existing session before retrying", status: 409 };
    }

    let createdNextSession = false;
    const nextSession = existingNextSession || await storage.createMediationSession({
      caseId: allowed.session.caseId,
      sessionNumber: expectedNextSessionNumber,
      leadMediatorId: allowed.session.leadMediatorId,
      status: "allocated",
      appointmentId: null,
      outcome: null,
      outcomeNotes: null,
      nextAction: null,
      documentsRequired: null,
      followUpRequirements: null,
      nextSessionRequired: false,
      summarySubmittedBy: null,
      summarySubmittedAt: null,
      createdBy: actor.id,
      allocatedBy: actor.id,
      allocatedAt: new Date(),
      completedBy: null,
      completedAt: null,
    });
    createdNextSession = !existingNextSession;
    if (createdNextSession) {
      await storage.replaceMediationSessionParticipants(nextSession.id, participants.map((participant) => ({
        sessionId: nextSession.id,
        userId: participant.userId,
        role: participant.role as MediationSessionParticipantRole,
        invitationStatus: (participant.role === "lead_mediator" ? "accepted" : participant.invitationStatus) as MediationSessionParticipantInvitationStatus,
        invitationTokenHash: null,
        invitationSentAt: null,
        invitationViewedAt: null,
        invitationRespondedAt: participant.role === "lead_mediator" ? new Date() : null,
        invitationDeclineNotes: null,
        addedBy: actor.id,
      })));
    }
    const proposed = await this.proposeSlot(nextSession.id, actor, input, ipAddress);
    if (!proposed.ok) {
      if (createdNextSession) {
        await this.deleteSafeEmptyMediationSession(nextSession);
      }
      return proposed;
    }
    await this.completeOpenAdminTasks(allowed.session.caseId, "mediation_session_next_session_requested", actor, `Next-session request resolved by ${actor.name}.`);
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "mediation_session_next_session_scheduled",
      urgency: "green",
      caseId: nextSession.caseId,
      appointmentId: proposed.session.appointmentId || null,
      title: `Next mediation session proposed`,
      message: `${actor.name} proposed Mediation Session ${nextSession.sessionNumber} after Session ${allowed.session.sessionNumber}.`,
      status: "active",
      caseNoteRequired: false,
    });
    return proposed;
  }

  private calculateMediationSessionsSummary(sessions: MediationSessionView[]): MediationSessionsSummary {
    const activeSessions = sessions.filter((session) => session.status !== "cancelled");
    const totalMinutes = activeSessions.reduce((sum, session) => {
      const appointment = session.appointment;
      if (!appointment) return sum;
      const countsForHours = ["scheduled", "completed"].includes(session.status)
        || ["confirmed", "completed"].includes(appointment.status);
      return countsForHours ? sum + appointment.duration : sum;
    }, 0);
    return {
      numberOfSessions: activeSessions.length,
      totalMediationHours: Math.round((totalMinutes / 60) * 100) / 100,
    };
  }

  async createSession(
    caseId: string,
    actor: ActorUser,
    input: { leadMediatorId: string; coMediatorIds?: string[]; observerIds?: string[] },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView; readiness: { ready: boolean; issues: SessionReadinessIssue[] } }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can allocate mediation sessions", status: 403 };

    const c = await storage.getCase(caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };

    const readiness = await this.getReadiness(caseId);
    if (!readiness.ready) {
      return {
        ok: false,
        error: "Mediation session allocation is blocked until every party has an approved suitable MIAM",
        status: 409,
        readiness,
      } as ServiceResult<{ session: MediationSessionView; readiness: { ready: boolean; issues: SessionReadinessIssue[] } }>;
    }

    const mediatorCheck = await this.validateMediatorAssignment(input.leadMediatorId, "lead_mediator", "Lead mediator");
    if (!mediatorCheck.ok) return mediatorCheck;

    const roleIds = this.normalizeParticipantIds(input.leadMediatorId, input.coMediatorIds, input.observerIds);
    const participantCheck = await this.validateParticipants(roleIds);
    if (!participantCheck.ok) return participantCheck;

    const latest = await storage.getLatestMediationSessionByCase(caseId);
    if (latest?.status === "completed" && latest.postSessionReviewStatus !== "approved") {
      return {
        ok: false,
        error: "Post-session review must be approved before allocating the next mediation session",
        status: 409,
        readiness,
      } as ServiceResult<{ session: MediationSessionView; readiness: { ready: boolean; issues: SessionReadinessIssue[] } }>;
    }
    const sessionNumber = (latest?.sessionNumber || 0) + 1;
    const now = new Date();
    const session = await storage.createMediationSession({
      caseId,
      sessionNumber,
      leadMediatorId: input.leadMediatorId,
      status: "allocated",
      createdBy: actor.id,
      allocatedBy: actor.id,
      allocatedAt: now,
    });

    const participants = [
      { userId: input.leadMediatorId, role: "lead_mediator" as const, invitationStatus: "accepted" as const },
      ...roleIds.coMediatorIds.map((userId) => ({ userId, role: "co_mediator" as const, invitationStatus: "invited" as const })),
      ...roleIds.observerIds.map((userId) => ({ userId, role: "observer" as const, invitationStatus: "invited" as const })),
    ];
    await storage.replaceMediationSessionParticipants(session.id, participants.map((p) => ({
      sessionId: session.id,
      userId: p.userId,
      role: p.role,
      invitationStatus: p.invitationStatus,
      addedBy: actor.id,
    })));

    await this.logSessionActivity(caseId, "mediation_session_allocated", `Mediation Session ${sessionNumber} allocated`, `${actor.name} allocated Session ${sessionNumber} to ${mediatorCheck.user.name}.`, session.id, actor);
    await logAudit({
      userId: actor.id,
      action: "allocate_mediation_session",
      entity: "session",
      entityId: session.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ caseId, sessionNumber, leadMediatorId: input.leadMediatorId, coMediatorIds: roleIds.coMediatorIds, observerIds: roleIds.observerIds }),
      ipAddress,
    });
    await this.notifyParticipants(c.caseRef, caseId, sessionNumber, participants, actor.name);

    const enriched = (await this.enrichSessions([session]))[0];
    return { ok: true, session: enriched, readiness };
  }

  async updateAllocation(
    sessionId: string,
    actor: ActorUser,
    input: { leadMediatorId: string; coMediatorIds?: string[]; observerIds?: string[] },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can reallocate mediation sessions", status: 403 };

    const existing = await storage.getMediationSession(sessionId);
    if (!existing) return { ok: false, error: "Mediation session not found", status: 404 };
    if (existing.status === "cancelled") {
      return { ok: false, error: "Cancelled mediation sessions cannot be reallocated", status: 409 };
    }
    const appointment = existing.appointmentId ? await storage.getAppointment(existing.appointmentId) : undefined;
    if (appointment && ["cancelled", "expired"].includes(appointment.status)) {
      return { ok: false, error: "Linked appointments that are cancelled or expired cannot be reallocated", status: 409 };
    }
    const c = await storage.getCase(existing.caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };

    const mediatorCheck = await this.validateMediatorAssignment(input.leadMediatorId, "lead_mediator", "Lead mediator");
    if (!mediatorCheck.ok) return mediatorCheck;

    const roleIds = this.normalizeParticipantIds(input.leadMediatorId, input.coMediatorIds, input.observerIds);
    const participantCheck = await this.validateParticipants(roleIds);
    if (!participantCheck.ok) return participantCheck;

    const previousParticipants = await storage.listMediationSessionParticipants(sessionId);
    const previousLeadMediatorId = existing.leadMediatorId;
    const updated = await storage.updateMediationSession(sessionId, {
      leadMediatorId: input.leadMediatorId,
      status: existing.status === "pending" ? "allocated" : existing.status,
      allocatedBy: actor.id,
      allocatedAt: new Date(),
    });
    if (!updated) return { ok: false, error: "Failed to update mediation session", status: 500 };

    const previousStatus = new Map(previousParticipants.map((p) => [`${p.userId}:${p.role}`, p.invitationStatus]));
    const nextParticipants = [
      { userId: input.leadMediatorId, role: "lead_mediator" as const, invitationStatus: "accepted" as const },
      ...roleIds.coMediatorIds.map((userId) => ({
        userId,
        role: "co_mediator" as const,
        invitationStatus: (previousStatus.get(`${userId}:co_mediator`) || "invited") as "invited" | "accepted" | "declined",
      })),
      ...roleIds.observerIds.map((userId) => ({
        userId,
        role: "observer" as const,
        invitationStatus: (previousStatus.get(`${userId}:observer`) || "invited") as "invited" | "accepted" | "declined",
      })),
    ];
    await storage.replaceMediationSessionParticipants(sessionId, nextParticipants.map((p) => ({
      sessionId,
      userId: p.userId,
      role: p.role,
      invitationStatus: p.invitationStatus,
      addedBy: actor.id,
    })));

    await this.logSessionActivity(existing.caseId, "mediation_session_reallocated", `Mediation Session ${existing.sessionNumber} allocation updated`, `${actor.name} updated the allocation for Session ${existing.sessionNumber}.`, sessionId, actor);
    await logAudit({
      userId: actor.id,
      action: previousLeadMediatorId === input.leadMediatorId ? "update" : "reallocate_mediation_session",
      entity: "session",
      entityId: sessionId,
      entityRef: c.caseRef,
      details: JSON.stringify({
        previousLeadMediatorId,
        nextLeadMediatorId: input.leadMediatorId,
        previousParticipants: previousParticipants.map((p) => ({ userId: p.userId, role: p.role })),
        nextParticipants,
      }),
      ipAddress,
    });

    const previousKeys = new Set(previousParticipants.map((p) => `${p.userId}:${p.role}`));
    const nextKeys = new Set(nextParticipants.map((p) => `${p.userId}:${p.role}`));
    const added = nextParticipants.filter((p) => !previousKeys.has(`${p.userId}:${p.role}`));
    const removed = previousParticipants.filter((p) => !nextKeys.has(`${p.userId}:${p.role}`));
    for (const participant of added) {
      await this.logSessionActivity(existing.caseId, "mediation_session_participant_added", `Session ${existing.sessionNumber} participant added`, `${actor.name} added a ${this.roleLabel(participant.role)} to Session ${existing.sessionNumber}.`, sessionId, actor);
      await logAudit({
        userId: actor.id,
        action: "add_session_participant",
        entity: "session",
        entityId: sessionId,
        entityRef: c.caseRef,
        details: JSON.stringify({ userId: participant.userId, role: participant.role }),
        ipAddress,
      });
    }
    for (const participant of removed) {
      await this.logSessionActivity(existing.caseId, "mediation_session_participant_removed", `Session ${existing.sessionNumber} participant removed`, `${actor.name} removed a ${this.roleLabel(participant.role)} from Session ${existing.sessionNumber}.`, sessionId, actor);
      await logAudit({
        userId: actor.id,
        action: "remove_session_participant",
        entity: "session",
        entityId: sessionId,
        entityRef: c.caseRef,
        details: JSON.stringify({ userId: participant.userId, role: participant.role }),
        ipAddress,
      });
      if (participant.invitationStatus === "accepted" && (participant.role === "co_mediator" || participant.role === "observer")) {
        await this.syncRemovedSessionParticipantCalendarAttendee(updated, participant);
      }
    }
    await this.notifyParticipants(c.caseRef, existing.caseId, existing.sessionNumber, added, actor.name);
    const activeProposal = updated.appointmentId ? await storage.getMediationSessionProposalByAppointment(updated.appointmentId) : undefined;
    if (activeProposal) await this.createParticipantInviteLinks(updated, activeProposal, { allowInactiveProposal: true });

    const enriched = (await this.enrichSessions([updated]))[0];
    return { ok: true, session: enriched };
  }

  async recordOutcome(
    sessionId: string,
    actor: ActorUser,
    input: { outcome: string; outcomeNotes?: string | null },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isOutcome(input.outcome)) return { ok: false, error: "Invalid mediation session outcome", status: 400 };

    const existing = await storage.getMediationSession(sessionId);
    if (!existing) return { ok: false, error: "Mediation session not found", status: 404 };
    const canRecordOutcome = await this.hasLeadEquivalentAccess(existing, actor);
    if (!canRecordOutcome) return { ok: false, error: "Only admins, the assigned lead mediator, and accepted co-mediators can record mediation session outcomes", status: 403 };

    const c = await storage.getCase(existing.caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };

    const updated = await storage.updateMediationSession(sessionId, {
      outcome: input.outcome,
      outcomeNotes: input.outcomeNotes || null,
      status: "completed",
      completedBy: actor.id,
      completedAt: new Date(),
    });
    if (!updated) return { ok: false, error: "Failed to record mediation session outcome", status: 500 };

    await this.logSessionActivity(existing.caseId, "mediation_session_outcome_recorded", `Mediation Session ${existing.sessionNumber} outcome recorded`, `${actor.name} recorded the outcome for Session ${existing.sessionNumber}.`, sessionId, actor);
    await logAudit({
      userId: actor.id,
      action: "record_session_outcome",
      entity: "session",
      entityId: sessionId,
      entityRef: c.caseRef,
      details: JSON.stringify({ outcome: input.outcome, outcomeNotes: input.outcomeNotes || null }),
      ipAddress,
    });

    const enriched = (await this.enrichSessions([updated]))[0];
    return { ok: true, session: enriched };
  }

  async recordPartyAttendance(
    sessionId: string,
    actor: ActorUser,
    input: { noShowPartyIds: string[] },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    const existing = await storage.getMediationSession(sessionId);
    if (!existing) return { ok: false, error: "Mediation session not found", status: 404 };

    const access = await this.getCaseAccess(existing.caseId, actor);
    const canUpdateAttendance = isAdmin(actor)
      || access === "full"
      || (access === "co_mediator" && await this.hasLeadEquivalentAccess(existing, actor));
    if (!canUpdateAttendance) {
      return { ok: false, error: "Only assigned session mediators and admins can update attendance", status: 403 };
    }

    const c = await storage.getCase(existing.caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };

    const parties = await storage.listPartiesByCase(existing.caseId);
    const partyIds = Array.from(new Set(input.noShowPartyIds));
    if (!partyIds.every((partyId) => parties.some((party) => party.id === partyId))) {
      return { ok: false, error: "Attendance can only be recorded for clients on this case", status: 400 };
    }

    await storage.replaceMediationSessionPartyAttendance(sessionId, partyIds.map((partyId) => ({
      caseId: existing.caseId,
      mediationSessionId: sessionId,
      partyId,
      status: "no_show",
      markedBy: actor.id,
      markedAt: new Date(),
    })));

    for (const partyId of partyIds) {
      await financeService.markMediationSessionNoShowNoRefund({
        caseId: existing.caseId,
        mediationSessionId: sessionId,
        partyId,
        actor,
        ipAddress,
      });
    }

    const updated = await storage.updateMediationSession(sessionId, {});
    const noShowParties = parties.filter((party) => partyIds.includes(party.id));
    await this.logSessionActivity(
      existing.caseId,
      "mediation_session_attendance_updated",
      `Mediation Session ${existing.sessionNumber} attendance updated`,
      noShowParties.length > 0
        ? `${actor.name} marked ${noShowParties.map((party) => `Client ${party.role}`).join(", ")} as not attending Session ${existing.sessionNumber}.`
        : `${actor.name} cleared no-show attendance for Session ${existing.sessionNumber}.`,
      sessionId,
      actor,
    );
    await logAudit({
      userId: actor.id,
      action: "update_mediation_session_attendance",
      entity: "session",
      entityId: sessionId,
      entityRef: c.caseRef,
      details: JSON.stringify({ noShowPartyIds: partyIds }),
      ipAddress,
    });

    const enriched = (await this.enrichSessions([updated || existing]))[0];
    return { ok: true, session: enriched };
  }

  async cancelSession(
    sessionId: string,
    actor: ActorUser,
    input: { reason: string },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can cancel mediation sessions", status: 403 };
    const reason = input.reason.trim();
    if (!reason) return { ok: false, error: "Cancellation reason is required", status: 400 };

    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (session.status === "cancelled") return { ok: false, error: "Mediation session is already cancelled", status: 400 };
    const c = await storage.getCase(session.caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };

    let appointment: Appointment | undefined;
    if (session.appointmentId) {
      appointment = await storage.getAppointment(session.appointmentId);
      if (!appointment) return { ok: false, error: "Session appointment not found", status: 404 };
      if (appointment.status === "hold" || appointment.status === "held") {
        const released = await this.releaseSessionHold(session.id, actor, ipAddress, { reason });
        if (!released.ok) return released;
      } else if (!["cancelled", "expired", "completed"].includes(appointment.status)) {
        const cancelled = await appointmentService.cancel(appointment.id, staffActor(actor));
        if (!cancelled.ok) return cancelled;
      }
    }

    const updated = await storage.updateMediationSession(session.id, { status: "cancelled" });
    if (!updated) return { ok: false, error: "Failed to cancel mediation session", status: 500 };

    const parties = await storage.listPartiesByCase(session.caseId);
    if (appointment) {
      await this.notifyClients(parties, session, appointment, "Mediation session cancelled", `Session ${session.sessionNumber} has been cancelled. Reason: ${reason}`);
    } else {
      for (const party of parties) {
        const client = await storage.getClient(party.clientId);
        if (!client?.userId) continue;
        await notificationService.createNotification({
          recipientId: client.userId,
          recipientRole: "client",
          type: "mediation_session_cancelled",
          urgency: "amber",
          caseId: session.caseId,
          appointmentId: null,
          title: "Mediation session cancelled",
          message: `Session ${session.sessionNumber} has been cancelled. Reason: ${reason}`,
          status: "active",
          caseNoteRequired: false,
        });
      }
    }
    if (session.leadMediatorId) {
      await notificationService.createNotification({
        recipientId: session.leadMediatorId,
        recipientRole: "mediator",
        type: "mediation_session_cancelled",
        urgency: "amber",
        caseId: session.caseId,
        appointmentId: appointment?.id || null,
        title: `Mediation Session ${session.sessionNumber} cancelled`,
        message: `Mediation Session ${session.sessionNumber} on case ${c.caseRef} was cancelled. Reason: ${reason}`,
        status: "active",
        caseNoteRequired: false,
      });
    }
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "mediation_session_cancelled",
      urgency: "amber",
      caseId: session.caseId,
      appointmentId: appointment?.id || null,
      title: `Mediation Session ${session.sessionNumber} cancelled`,
      message: `${actor.name} cancelled Mediation Session ${session.sessionNumber} on case ${c.caseRef}. Reason: ${reason}`,
      status: "active",
      caseNoteRequired: true,
    });
    await this.logSessionActivity(session.caseId, "mediation_session_cancelled", `Mediation Session ${session.sessionNumber} cancelled`, `${actor.name} cancelled Session ${session.sessionNumber}. Reason: ${reason}`, session.id, actor);
    await logAudit({
      userId: actor.id,
      action: "cancel_mediation_session",
      entity: "session",
      entityId: session.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ appointmentId: appointment?.id || null, reason }),
      ipAddress,
    });

    return { ok: true, session: (await this.enrichSessions([updated]))[0] };
  }

  async submitAvailability(
    sessionId: string,
    actor: ActorUser,
    input: { partyId?: string; windows: Array<{ startAt: Date; endAt: Date; notes?: string | null }> },
  ): Promise<ServiceResult<{ windows: MediationSessionAvailabilityWindow[] }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const partyResult = await this.resolveAvailabilityParty(session.caseId, actor, input.partyId);
    if (!partyResult.ok) return partyResult;

    const now = new Date();
    const normalized = input.windows.map((window) => ({
      startAt: new Date(window.startAt),
      endAt: new Date(window.endAt),
      notes: window.notes || null,
    }));
    if (normalized.length === 0 || normalized.length > 20) {
      return { ok: false, error: "Submit between 1 and 20 availability windows", status: 400 };
    }
    for (const window of normalized) {
      if (Number.isNaN(window.startAt.valueOf()) || Number.isNaN(window.endAt.valueOf()) || window.endAt <= window.startAt) {
        return { ok: false, error: "Availability windows must have a valid start and end time", status: 400 };
      }
      if (window.startAt <= now) return { ok: false, error: "Availability windows must be in the future", status: 400 };
    }

    const rows = await storage.replaceMediationSessionAvailabilityForParty(
      sessionId,
      partyResult.party.id,
      normalized.map((window) => ({
        caseId: session.caseId,
        mediationSessionId: sessionId,
        partyId: partyResult.party.id,
        startAt: window.startAt,
        endAt: window.endAt,
        source: isAdmin(actor) ? "admin" : "client",
        submittedBy: actor.id,
        notes: window.notes,
      })),
    );

    await this.logSessionActivity(session.caseId, "mediation_session_availability_submitted", `Session ${session.sessionNumber} availability submitted`, `${actor.name} submitted availability for Client ${partyResult.party.role}.`, session.id, actor);
    return { ok: true, windows: rows };
  }

  async getAvailabilityOverlap(sessionId: string, actor: Pick<User, "id" | "role">): Promise<ServiceResult<{
    commonSlots: Array<{ startAt: Date; endAt: Date }>;
    hasCommonAvailability: boolean;
    partyWindows: MediationSessionAvailabilityWindow[];
    missingPartyIds: string[];
  }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!(await this.canReadSession(session, actor))) {
      return { ok: false, error: "Access denied", status: 403 };
    }
    if (!session.leadMediatorId) return { ok: false, error: "Lead mediator is required before matching availability", status: 409 };

    const parties = await storage.listPartiesByCase(session.caseId);
    const partyWindows = await storage.listMediationSessionAvailabilityWindows(sessionId);
    const proposals = await storage.listMediationSessionProposalsBySessions([sessionId]);
    const proposal = proposals[0];
    const proposalRecipients = proposal ? await storage.listMediationSessionProposalRecipientsByProposal(proposal.id) : [];
    if (proposal && !proposalRecipients.some((recipient) => recipient.responseStatus === "declined")) {
      return { ok: true, commonSlots: [], hasCommonAvailability: false, partyWindows, missingPartyIds: parties.map((party) => party.id) };
    }

    const windowsByParty = new Map<string, MediationSessionAvailabilityWindow[]>();
    for (const window of partyWindows) {
      if (!window.partyId) continue;
      windowsByParty.set(window.partyId, [...(windowsByParty.get(window.partyId) || []), window]);
    }
    const missingPartyIds = parties.filter((party) => !windowsByParty.has(party.id)).map((party) => party.id);
    const commonPartyWindows = this.intersectPartyWindows(parties.map((party) => windowsByParty.get(party.id) || []));
    const mediatorRecipientIds = new Set(proposalRecipients.filter((recipient) => recipient.recipientType === "mediator").map((recipient) => recipient.id));
    const mediatorAlternativeWindows = partyWindows.filter((window) => window.proposalRecipientId && mediatorRecipientIds.has(window.proposalRecipientId));
    const commonSlots = mediatorAlternativeWindows.length > 0
      ? this.intersectPartyWindows([commonPartyWindows, mediatorAlternativeWindows])
      : await this.filterMediatorSlots(session.leadMediatorId, commonPartyWindows, 120);

    if (isAdmin(actor) && missingPartyIds.length === 0 && commonSlots.length === 0) {
      await this.ensureAdminTask(
        session.caseId,
        null,
        "mediation_session_no_common_availability",
        "No common mediation availability",
        `No common availability was found for Session ${session.sessionNumber}. Offer alternative slots or request fresh availability.`,
        "red",
      );
    }

    return { ok: true, commonSlots, hasCommonAvailability: commonSlots.length > 0, partyWindows, missingPartyIds };
  }

  async placeHold(
    sessionId: string,
    actor: ActorUser,
    input: { dateTime: Date; duration?: number; voucherFormRequired?: boolean; reusableInvoiceAppointmentIds?: string[] },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!(await this.hasLeadEquivalentAccess(session, actor))) {
      return { ok: false, error: "Only superadmins, subadmins, the lead mediator, and accepted co-mediators can place mediation session holds", status: 403 };
    }
    if (!session.leadMediatorId) return { ok: false, error: "Lead mediator is required before placing a hold", status: 409 };
    if (session.appointmentId) return { ok: false, error: "This mediation session already has an appointment", status: 409 };

    const c = await storage.getCase(session.caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    const voucherFormRequired = Boolean(c.voucherClaimEligible);
    const readiness = await this.getReadiness(session.caseId);
    if (!readiness.ready) return { ok: false, error: "Mediation session booking is blocked until every party has an approved suitable MIAM", status: 409 };

    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType || !serviceType.onlinePaymentEnabled || !serviceType.paymentAmountPence || serviceType.paymentAmountPence <= 0) {
      return { ok: false, error: "Configure a positive online payment amount for the Mediation Sessions service type before placing a hold", status: 409 };
    }

    const start = new Date(input.dateTime);
    if (Number.isNaN(start.valueOf()) || start <= new Date()) return { ok: false, error: "Session hold time must be in the future", status: 400 };
    const duration = Number.isInteger(input.duration) && input.duration! > 0 ? input.duration! : 120;
    const mediator = await storage.getUser(session.leadMediatorId);
    if (!mediator || mediator.role !== "mediator" || mediator.status !== "active") return { ok: false, error: "Lead mediator must be active", status: 400 };
    await financialDisclosureService.ensureFinancialDisclosureFoldersForCase(session.caseId, "mediation_session_hold", actor);

    const appointment = await storage.createAppointment({
      caseId: session.caseId,
      partyId: null,
      serviceTypeId: serviceType.id,
      mediatorId: session.leadMediatorId,
      dateTime: start,
      dateTimeBasis: "instant",
      duration,
      status: "hold",
      holdExpiresAt: this.calculateSessionHoldExpiry(start),
      bookingToken: null,
      paymentStatus: "payment_pending",
      paymentAmountPence: serviceType.paymentAmountPence,
      paymentCurrency: serviceType.paymentCurrency || "gbp",
      meetingLink: mediator.zoomLink || null,
      notes: `Mediation Session ${session.sessionNumber} hold`,
    });
    await appointmentLifecycleHistoryService.recordAppointmentCreated(appointment, staffActor(actor), {
      mediationSessionId: session.id,
      sessionNumber: session.sessionNumber,
    });

    const parties = await storage.listPartiesByCase(session.caseId);
    const invoiceResult = await financeService.ensureMediationSessionInvoices({
      appointment,
      serviceType,
      parties,
      actor,
      reusableAppointmentIds: input.reusableInvoiceAppointmentIds,
    });
    if (!invoiceResult.ok) return invoiceResult;

    await this.issueRequiredForms(session, appointment, parties, actor, voucherFormRequired, c);
    const updatedSession = await storage.updateMediationSession(session.id, { appointmentId: appointment.id });
    if (!updatedSession) return { ok: false, error: "Failed to link appointment to mediation session", status: 500 };

    await this.createAppointmentAcknowledgementTask(appointment, "held");
    await this.notifyClients(parties, session, appointment, "Mediation session hold placed", `Session ${session.sessionNumber} has been placed on hold. Please complete payment and required forms before the hold expires.`);
    await this.logSessionActivity(session.caseId, "mediation_session_hold_placed", `Session ${session.sessionNumber} hold placed`, `${actor.name} placed Session ${session.sessionNumber} on hold.`, session.id, actor);
    await logAudit({
      userId: actor.id,
      action: "place_mediation_session_hold",
      entity: "session",
      entityId: session.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ appointmentId: appointment.id, voucherFormRequired: voucherFormRequired }),
      ipAddress,
    });

    const enriched = (await this.enrichSessions([updatedSession]))[0];
    return { ok: true, session: enriched };
  }

  async proposeSlot(
    sessionId: string,
    actor: ActorUser,
    input: { dateTime: Date; duration?: number; voucherFormRequired?: boolean; reusableInvoiceAppointmentIds?: string[] },
    ipAddress?: string,
    options: ProposalLinkOptions = {},
  ): Promise<ServiceResult<{ session: MediationSessionView; proposalLinks: ProposalPublicLink[] }>> {
    const held = await this.placeHold(sessionId, actor, input, ipAddress);
    if (!held.ok) return held;
    const appointmentId = held.session.appointmentId;
    const appointment = appointmentId ? await storage.getAppointment(appointmentId) : undefined;
    if (!appointment) return { ok: false, error: "Held appointment was not created", status: 500 };
    const heldCase = await storage.getCase(held.session.caseId);
    if (!heldCase) return { ok: false, error: "Case not found", status: 404 };
    const endAt = new Date(new Date(appointment.dateTime).getTime() + appointment.duration * 60000);
    const proposal = await storage.createMediationSessionProposal({
      caseId: held.session.caseId,
      mediationSessionId: held.session.id,
      appointmentId: appointment.id,
      proposedStartAt: new Date(appointment.dateTime),
      proposedEndAt: endAt,
      status: "held",
      voucherFormRequired: Boolean(heldCase.voucherClaimEligible),
      createdBy: actor.id,
      expiresAt: appointment.holdExpiresAt || this.calculateSessionHoldExpiry(new Date(appointment.dateTime)),
    });

    const links = await this.createProposalRecipientsAndLinks(held.session, proposal, actor, options);
    await this.logSessionActivity(held.session.caseId, "mediation_session_slot_proposed", `Session ${held.session.sessionNumber} slot proposed`, `${actor.name} proposed Session ${held.session.sessionNumber} and sent response links.`, held.session.id, actor);
    const session = (await this.enrichSessions([await storage.getMediationSession(held.session.id) || held.session]))[0];
    return { ok: true, session, proposalLinks: links };
  }

  async resendProposalLinks(proposalId: string, actor: ActorUser): Promise<ServiceResult<{ proposalLinks: ProposalPublicLink[] }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can resend mediation session response links", status: 403 };
    const proposal = await storage.getMediationSessionProposal(proposalId);
    if (!proposal) return { ok: false, error: "Mediation session proposal not found", status: 404 };
    const session = await storage.getMediationSession(proposal.mediationSessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const recipients = await storage.listMediationSessionProposalRecipientsByProposal(proposalId);
    const resendableRecipients = recipients.filter((recipient) => recipient.responseStatus === "pending" || recipient.responseStatus === "viewed");
    const links: ProposalPublicLink[] = [];
    for (const recipient of resendableRecipients) {
      links.push(await this.rotateProposalRecipientLink(recipient, session, proposal, actor));
    }
    return { ok: true, proposalLinks: links };
  }

  async resendProposalRecipientLink(
    recipientId: string,
    actor: ActorUser,
    options: { regenerateAccepted?: boolean } = {},
  ): Promise<ServiceResult<{ proposalLinks: ProposalPublicLink[] }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can resend mediation session response links", status: 403 };
    const recipient = await storage.getMediationSessionProposalRecipient(recipientId);
    if (!recipient) return { ok: false, error: "Mediation session proposal recipient not found", status: 404 };
    if (recipient.responseStatus === "accepted" && !options.regenerateAccepted) {
      return { ok: false, error: "Accepted recipient links are not regenerated by default", status: 409 };
    }
    const proposal = await storage.getMediationSessionProposal(recipient.proposalId);
    if (!proposal) return { ok: false, error: "Mediation session proposal not found", status: 404 };
    const session = await storage.getMediationSession(proposal.mediationSessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const link = await this.rotateProposalRecipientLink(recipient, session, proposal, actor, options);
    return { ok: true, proposalLinks: [link] };
  }

  async sendProposalRecipientWhatsappTemplate(
    recipientId: string,
    actor: ActorUser,
    options: { previewOnly?: boolean; responseLink?: string } = {},
  ): Promise<ServiceResult<{ proposalLinks: ProposalPublicLink[]; responseLink: string; parameters: Record<string, string>; queued?: unknown[]; templateName: string }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can send mediation session WhatsApp links", status: 403 };
    const recipient = await storage.getMediationSessionProposalRecipient(recipientId);
    if (!recipient) return { ok: false, error: "Mediation session proposal recipient not found", status: 404 };
    if (recipient.recipientType !== "client" || !recipient.partyId) return { ok: false, error: "WhatsApp mediation session links can only be sent to client recipients", status: 400 };
    const proposal = await storage.getMediationSessionProposal(recipient.proposalId);
    if (!proposal) return { ok: false, error: "Mediation session proposal not found", status: 404 };
    const linkStatus = this.getPublicProposalLinkStatus(proposal);
    if (!linkStatus.active) return { ok: false, error: linkStatus.message || "This session availability link is no longer active", status: 410 };
    const session = await storage.getMediationSession(proposal.mediationSessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const caseRecord = await storage.getCase(proposal.caseId);
    if (!caseRecord) return { ok: false, error: "Case not found", status: 404 };
    const party = await storage.getParty(recipient.partyId);
    if (!party || party.caseId !== proposal.caseId) return { ok: false, error: "Recipient party is not available for this case", status: 404 };

    const baseParameters = {
      client_first_name: party.firstName || recipient.recipientName.split(/\s+/)[0] || "there",
      case_ref: caseRecord.caseRef,
      session_label: `Mediation Session ${session.sessionNumber}`,
      date_time: formatSessionWhatsappDateTime(new Date(proposal.proposedStartAt)),
    };
    await caseWhatsappService.validateTemplateSendToParty(proposal.caseId, recipient.partyId, MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME, undefined, { requireParameterValues: false });
    if (options.previewOnly) {
      const link = await this.previewProposalRecipientWhatsappLink(recipient, options.responseLink);
      const parameters = { ...baseParameters, response_link: link.publicUrl };
      await caseWhatsappService.validateTemplateSendToParty(proposal.caseId, recipient.partyId, MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME, parameters);
      return { ok: true, proposalLinks: [link], responseLink: link.publicUrl, parameters, templateName: MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME };
    }
    const link = await this.rotateProposalRecipientWhatsappLink(recipient, session, proposal, actor, options.responseLink);
    const parameters = { ...baseParameters, response_link: link.publicUrl };
    await caseWhatsappService.validateTemplateSendToParty(proposal.caseId, recipient.partyId, MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME, parameters);
    const sent = await caseWhatsappService.sendTemplateToParty(proposal.caseId, recipient.partyId, MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME, parameters, actor as User);
    await logAudit({
      userId: actor.id,
      action: "send_mediation_session_booking_whatsapp_template",
      entity: "proposal_recipient",
      entityId: recipient.id,
      entityRef: proposal.caseId,
      details: JSON.stringify({ proposalId: proposal.id, sessionId: session.id, templateName: MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME }),
    });
    return { ok: true, proposalLinks: [link], responseLink: link.publicUrl, parameters, queued: sent.queued, templateName: MEDIATION_SESSION_BOOKING_WHATSAPP_TEMPLATE_NAME };
  }

  async releaseSessionHold(
    sessionId: string,
    actor: ActorUser,
    ipAddress?: string,
    options: { voidInvoices?: boolean; reason?: string } = {},
  ): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can release mediation session holds", status: 403 };
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!session.appointmentId) return { ok: false, error: "This mediation session has no held appointment", status: 409 };
    const appointment = await storage.getAppointment(session.appointmentId);
    if (!appointment) return { ok: false, error: "Session appointment not found", status: 404 };
    const proposal = await storage.getMediationSessionProposalByAppointment(appointment.id);
    const expiredAppointment = await storage.updateAppointment(appointment.id, { status: "expired", paymentStatus: "failed_or_not_received", paymentStatusUpdatedAt: new Date(), paymentStatusUpdatedBy: actor.id });
    if (expiredAppointment) {
      await appointmentLifecycleHistoryService.recordMediationSessionHoldReleased(expiredAppointment, appointment.status, staffActor(actor), {
        proposalId: proposal?.id || null,
      });
    }
    if (options.voidInvoices !== false) {
      await financeService.voidUnpaidAppointmentInvoices(appointment.id, {
        actor,
        reason: options.reason || "Mediation session hold released before payment was completed.",
      });
    }
    if (proposal) await storage.updateMediationSessionProposal(proposal.id, { status: "released" });
    const updated = await storage.updateMediationSession(session.id, { appointmentId: null, status: "allocated" });
    if (!updated) return { ok: false, error: "Failed to release mediation session hold", status: 500 };
    await this.createAppointmentAcknowledgementTask(appointment, "cancelled");
    await this.logSessionActivity(session.caseId, "mediation_session_hold_released", `Session ${session.sessionNumber} hold released`, `${actor.name} released the held Session ${session.sessionNumber} slot.`, session.id, actor);
    await logAudit({
      userId: actor.id,
      action: "release_mediation_session_hold",
      entity: "session",
      entityId: session.id,
      details: JSON.stringify({ appointmentId: appointment.id, proposalId: proposal?.id || null }),
      ipAddress,
    });
    return { ok: true, session: (await this.enrichSessions([updated]))[0] };
  }

  async replaceProposedSlot(
    sessionId: string,
    actor: ActorUser,
    input: { dateTime: Date; duration?: number; voucherFormRequired?: boolean },
    ipAddress?: string,
  ): Promise<ServiceResult<{ session: MediationSessionView; proposalLinks: Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }> }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const previousAppointmentId = session.appointmentId;
    const released = await this.releaseSessionHold(sessionId, actor, ipAddress, { voidInvoices: false });
    if (!released.ok) return released;
    const proposed = await this.proposeSlot(
      sessionId,
      actor,
      { ...input, reusableInvoiceAppointmentIds: previousAppointmentId ? [previousAppointmentId] : [] },
      ipAddress,
      { isReschedule: true, includeAllParticipants: true },
    );
    if (proposed.ok && proposed.session.appointment) {
      await this.completeOpenAdminTasks(session.caseId, "mediation_session_reschedule_requested", actor, `Reschedule request resolved by ${actor.name}.`);
      await appointmentLifecycleHistoryService.recordMediationSessionReplacementProposed(proposed.session.appointment, staffActor(actor), {
        previousAppointmentId,
        mediationSessionId: sessionId,
      });
    }
    return proposed;
  }

  async getPublicProposal(token: string): Promise<ServiceResult<{ proposal: MediationSessionProposal; recipient: MediationSessionProposalRecipient; caseRef: string; sessionNumber: number; leadMediatorName: string | null; linkStatus: PublicProposalLinkStatus }>> {
    const resolved = await this.resolvePublicProposalToken(token, false);
    if (!resolved.ok) return resolved;
    const { proposal, session, caseRecord: c } = resolved;
    const linkStatus = this.getPublicProposalLinkStatus(proposal, resolved.recipient, session);
    let recipient = resolved.recipient;
    if (linkStatus.active && recipient.responseStatus === "pending") {
      const viewed = await storage.markMediationSessionProposalRecipientViewed(recipient.id);
      recipient = viewed || recipient;
      if (recipient.recipientType === "mediator_participant" && recipient.participantId) {
        await storage.updateMediationSessionParticipant(recipient.participantId, { invitationViewedAt: new Date() });
      }
    }
    return {
      ok: true,
      proposal,
      recipient,
      caseRef: c.caseRef,
      sessionNumber: session.sessionNumber,
      leadMediatorName: session.leadMediatorId ? (await storage.getUser(session.leadMediatorId))?.name || null : null,
      linkStatus,
    };
  }

  async publicProposalInvoiceBelongsToRecipient(
    proposal: MediationSessionProposal,
    recipient: MediationSessionProposalRecipient,
    invoiceId: string,
  ): Promise<boolean> {
    if (recipient.recipientType !== "client" || !recipient.partyId || !proposal.appointmentId) return false;
    const invoices = await financeService.listInvoicesByAppointment(proposal.appointmentId);
    return invoices.some((invoice) =>
      invoice.id === invoiceId
      && invoice.billToPartyId === recipient.partyId
      && invoice.status !== "void"
    );
  }

  async respondToProposal(
    token: string,
    input: { response: "accepted" | "declined"; windows?: Array<{ startAt: Date; endAt: Date; notes?: string | null }>; declineNotes?: string | null },
  ): Promise<ServiceResult<{ recipient: MediationSessionProposalRecipient; payment?: ProposalAcceptancePayment; autoConfirmation?: MediationSessionAutoConfirmation }>> {
    const current = await storage.getMediationSessionProposalRecipientByTokenHash(hashProposalToken(token));
    if (!current) return { ok: false, error: "This session availability link is invalid", status: 404 };
    const proposal = await storage.getMediationSessionProposal(current.proposalId);
    if (!proposal) return { ok: false, error: "This session proposal is no longer available", status: 404 };
    const session = await storage.getMediationSession(proposal.mediationSessionId);
    if (!session) return { ok: false, error: "This session proposal is no longer available", status: 404 };
    const linkStatus = this.getPublicProposalLinkStatus(proposal, current, session);
    if (!linkStatus.active) return { ok: false, error: linkStatus.message || "This session availability link is no longer active", status: 410 };
    if (current.recipientType === "mediator_participant") {
      return this.respondToParticipantInvitation(current, proposal, session, input);
    }
    return this.respondToProposalRecipient(current, proposal, session, input, { token });
  }

  async respondToClientProposalRecipient(
    recipientId: string,
    actor: Pick<User, "id" | "name" | "role">,
    input: { response: "accepted" | "declined"; windows?: Array<{ startAt: Date; endAt: Date; notes?: string | null }>; declineNotes?: string | null },
  ): Promise<ServiceResult<{ recipient: MediationSessionProposalRecipient; payment?: ProposalAcceptancePayment; autoConfirmation?: MediationSessionAutoConfirmation }>> {
    if (actor.role !== "client") return { ok: false, error: "Only clients can respond to mediation session proposals from the portal", status: 403 };
    const recipient = await storage.getMediationSessionProposalRecipient(recipientId);
    if (!recipient) return { ok: false, error: "This session proposal response is no longer available", status: 404 };
    if (recipient.recipientType !== "client" || !recipient.partyId) {
      return { ok: false, error: "This session proposal response is not available in the client portal", status: 403 };
    }
    const proposal = await storage.getMediationSessionProposal(recipient.proposalId);
    if (!proposal) return { ok: false, error: "This session proposal is no longer available", status: 404 };
    const session = await storage.getMediationSession(proposal.mediationSessionId);
    if (!session) return { ok: false, error: "This session proposal is no longer available", status: 404 };
    const clientParties = await storage.listPartiesByUserId(actor.id);
    const ownsRecipientParty = clientParties.some((party) => party.id === recipient.partyId && party.caseId === proposal.caseId);
    if (!ownsRecipientParty) return { ok: false, error: "You cannot respond to this mediation session proposal", status: 403 };
    const linkStatus = this.getPublicProposalLinkStatus(proposal, recipient, session);
    if (!linkStatus.active) return { ok: false, error: linkStatus.message || "This session proposal is no longer active", status: 410 };
    return this.respondToProposalRecipient(recipient, proposal, session, input, { clientUserId: actor.id });
  }

  private async respondToProposalRecipient(
    current: MediationSessionProposalRecipient,
    proposal: MediationSessionProposal,
    session: MediationSession,
    input: { response: "accepted" | "declined"; windows?: Array<{ startAt: Date; endAt: Date; notes?: string | null }>; declineNotes?: string | null },
    options: { token?: string | null; clientUserId?: string } = {},
  ): Promise<ServiceResult<{ recipient: MediationSessionProposalRecipient; payment?: ProposalAcceptancePayment; autoConfirmation?: MediationSessionAutoConfirmation }>> {
    const normalized = (input.windows || []).map((window) => ({
      startAt: new Date(window.startAt),
      endAt: new Date(window.endAt),
      notes: window.notes || null,
    }));
    if (input.response === "declined") {
      if (normalized.length === 0) return { ok: false, error: "Please provide at least one alternative availability window", status: 400 };
      for (const window of normalized) {
        if (Number.isNaN(window.startAt.valueOf()) || Number.isNaN(window.endAt.valueOf()) || window.endAt <= window.startAt) {
          return { ok: false, error: "Alternative availability windows must have a valid start and end time", status: 400 };
        }
        if (window.startAt <= new Date()) return { ok: false, error: "Alternative availability windows must be in the future", status: 400 };
      }
    }

    const recipient = await storage.updateMediationSessionProposalRecipientResponse(current.id, input.response, input.declineNotes || null);
    if (!recipient) return { ok: false, error: "Failed to record response", status: 500 };

    if (input.response === "declined") {
      await storage.updateMediationSessionProposal(proposal.id, { status: "declined" });
      await storage.replaceMediationSessionAvailabilityForProposalRecipient(
        recipient.id,
        normalized.map((window) => ({
          caseId: proposal.caseId,
          mediationSessionId: proposal.mediationSessionId,
          partyId: recipient.partyId || null,
          proposalRecipientId: recipient.id,
          startAt: window.startAt,
          endAt: window.endAt,
          source: recipient.recipientType === "mediator" ? "admin" : "client",
          submittedBy: recipient.userId || null,
          notes: window.notes,
        })),
      );
      await this.ensureAdminTask(
        proposal.caseId,
        proposal.appointmentId,
        "mediation_session_slot_declined",
        "Mediation session slot declined",
        `${recipient.recipientName} cannot attend the proposed mediation session slot and supplied alternatives.`,
        "red",
      );
      await this.logProposalResponseActivity(session, recipient, "declined", normalized.length);
    } else {
      const allRecipients = await storage.listMediationSessionProposalRecipientsByProposal(proposal.id);
      const slotRecipients = allRecipients.filter((row) => row.recipientType !== "mediator_participant");
      if (slotRecipients.every((row) => row.id === recipient.id ? recipient.responseStatus === "accepted" : row.responseStatus === "accepted")) {
        await storage.updateMediationSessionProposal(proposal.id, { status: "accepted" });
        await this.logProposalResponseActivity(session, recipient, "accepted", 0);
        await caseActivityService.log({
          caseId: proposal.caseId,
          type: "mediation_session_proposal_accepted",
          title: `Session ${session.sessionNumber} proposal accepted`,
          description: `Session ${session.sessionNumber} proposal accepted by all recipients.`,
          relatedEntityId: session.id,
          relatedEntityType: "session",
          metadata: JSON.stringify({ proposalId: proposal.id }),
          actor: { name: "System", type: "system", channel: "session-availability-link" },
        });
      } else {
        await this.logProposalResponseActivity(session, recipient, "accepted", 0);
      }
    }
    const actor = options.clientUserId ? { id: options.clientUserId } : null;
    const autoConfirmation = input.response === "accepted"
      ? await this.attemptAutoConfirmSession(session.id, "proposal_accepted")
      : undefined;
    const payment = input.response === "accepted"
      ? actor
        ? await this.buildProposalAcceptancePayment(null, proposal, recipient, { clientUserId: actor.id })
        : await this.buildProposalAcceptancePayment(options.token || null, proposal, recipient)
      : undefined;
    return { ok: true, recipient, payment, autoConfirmation };
  }

  private async buildProposalAcceptancePayment(
    token: string | null,
    proposal: MediationSessionProposal,
    recipient: MediationSessionProposalRecipient,
    options: { clientUserId?: string } = {},
  ): Promise<ProposalAcceptancePayment | undefined> {
    if (recipient.recipientType !== "client" || !proposal.appointmentId || !recipient.partyId) return undefined;
    const invoices = await financeService.listInvoicesByAppointment(proposal.appointmentId);
    const invoice = invoices.find((row) => row.billToPartyId === recipient.partyId && row.status !== "void");
    if (!invoice) return undefined;
    if (invoice.paymentStatus === "paid" || invoice.outstandingPence <= 0) {
      return {
        paymentRequired: false,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        outstandingPence: invoice.outstandingPence,
        currency: invoice.currency,
        paymentProvider: invoice.provider === "xero_invoice" ? "xero_invoice" : undefined,
      };
    }
    if (invoice.provider === "xero_invoice" && invoice.paymentLinkUrl) {
      return {
        paymentRequired: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        outstandingPence: invoice.outstandingPence,
        currency: invoice.currency,
        checkoutUrl: invoice.paymentLinkUrl,
        xeroInvoiceUrl: invoice.paymentLinkUrl,
        xeroInvoiceNumber: invoice.invoiceNumber,
        paymentReference: invoice.invoiceNumber,
        paymentProvider: "xero_invoice",
      };
    }

    const checkout = await stripePaymentService.createMediationSessionInvoiceCheckoutSession(invoice.id, {
      ...(token ? { token } : {}),
      proposalRecipientId: recipient.id,
      clientUserId: options.clientUserId,
    });
    if (!checkout.ok) {
      return {
        paymentRequired: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        outstandingPence: invoice.outstandingPence,
        currency: invoice.currency,
        paymentProvider: "xero_invoice",
        error: checkout.error,
      };
    }
    if (checkout.paymentRequired === false) {
      return {
        paymentRequired: false,
        invoiceId: checkout.invoiceId,
        invoiceNumber: checkout.invoiceNumber,
        outstandingPence: checkout.outstandingPence,
        currency: checkout.currency,
        paymentProvider: checkout.paymentProvider,
      };
    }
    return {
      paymentRequired: true,
      invoiceId: checkout.invoiceId,
      invoiceNumber: checkout.invoiceNumber,
      outstandingPence: checkout.outstandingPence,
      currency: checkout.currency,
      checkoutUrl: checkout.checkoutUrl,
      paymentProvider: checkout.paymentProvider,
    };
  }

  private async respondToParticipantInvitation(
    current: MediationSessionProposalRecipient,
    proposal: MediationSessionProposal,
    session: MediationSession,
    input: { response: "accepted" | "declined"; declineNotes?: string | null },
  ): Promise<ServiceResult<{ recipient: MediationSessionProposalRecipient; autoConfirmation?: MediationSessionAutoConfirmation }>> {
    if (!current.participantId) return { ok: false, error: "This session participant invitation is invalid", status: 404 };
    const recipient = await storage.updateMediationSessionProposalRecipientResponse(current.id, input.response, input.declineNotes || null);
    if (!recipient) return { ok: false, error: "Failed to record response", status: 500 };

    await storage.updateMediationSessionParticipant(current.participantId, {
      invitationStatus: input.response,
      invitationRespondedAt: new Date(),
      invitationViewedAt: new Date(),
      invitationDeclineNotes: input.response === "declined" ? input.declineNotes || null : null,
    });

    await this.logParticipantInvitationResponseActivity(session, recipient, input.response);
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: input.response === "accepted" ? "mediation_session_participant_invitation_accepted" : "mediation_session_participant_invitation_declined",
      urgency: input.response === "accepted" ? "green" : "red",
      caseId: proposal.caseId,
      appointmentId: proposal.appointmentId,
      title: input.response === "accepted" ? "Session participant accepted" : "Session participant declined",
      message: `${recipient.recipientName} ${input.response} the ${this.roleLabel(recipient.participantRole || "")} invitation for Mediation Session ${session.sessionNumber}.`,
      status: "active",
      caseNoteRequired: false,
    });

    if (input.response === "accepted") {
      await this.syncSessionParticipantCalendarAttendee(session, recipient);
    }

    const autoConfirmation = input.response === "accepted"
      ? await this.attemptAutoConfirmSession(session.id, "proposal_accepted")
      : undefined;
    return { ok: true, recipient, autoConfirmation };
  }

  async confirmSession(sessionId: string, actor: ActorUser, ipAddress?: string): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can confirm mediation sessions", status: 403 };
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!session.appointmentId) return { ok: false, error: "Session has no held appointment", status: 409 };
    const appointment = await storage.getAppointment(session.appointmentId);
    if (!appointment) return { ok: false, error: "Session appointment not found", status: 404 };

    const parties = await storage.listPartiesByCase(session.caseId);
    const c = await storage.getCase(session.caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    const forms = await this.listRequiredFormsForSessionGate(session);
    const proposal = await storage.getMediationSessionProposalByAppointment(appointment.id);
    const requirements = this.formRequirementsForCase(c, forms, parties, proposal);
    const requiredFormTypes = requirements.filter((item) => item.applicable && BLOCKING_FORM_TYPES.includes(item.formType)).map((item) => item.formType);
    const missingOrUnsigned = await this.getMissingOrUnacceptedRequiredForms(parties, forms, requiredFormTypes);
    if (missingOrUnsigned.length > 0) return { ok: false, error: "All required forms must be signed before confirming this session", status: 409 };

    if (proposal && new Date(proposal.expiresAt) < new Date()) return { ok: false, error: "The session hold has expired", status: 409 };
    if (proposal) {
      const recipients = await storage.listMediationSessionProposalRecipientsByProposal(proposal.id);
      const notAccepted = recipients.filter((recipient) => recipient.recipientType !== "mediator_participant" && recipient.responseStatus !== "accepted");
      if (notAccepted.length > 0) return { ok: false, error: "All session proposal recipients must accept before confirmation", status: 409 };
    }

    const invoices = await financeService.listInvoicesByAppointment(appointment.id);
    const partyIds = new Set(parties.map((party) => party.id));
    const invoicesByParty = invoices.filter((invoice) => invoice.billToPartyId && partyIds.has(invoice.billToPartyId));
    if (invoicesByParty.length < parties.length) return { ok: false, error: "Every active party must have a session invoice before confirmation", status: 409 };
    const unpaid = invoicesByParty.filter((invoice) => !this.invoiceSatisfied(invoice));
    if (unpaid.length > 0) return { ok: false, error: "All required session invoices must be paid or marked not required before confirmation", status: 409 };

    await storage.updateAppointment(appointment.id, { paymentStatus: "paid", paymentStatusUpdatedAt: new Date(), paymentStatusUpdatedBy: actor.id });
    const confirmResult = await appointmentService.confirm(appointment.id, staffActor(actor));
    if (!confirmResult.ok) return confirmResult;

    const updated = await storage.updateMediationSession(session.id, { status: "scheduled" });
    if (!updated) return { ok: false, error: "Failed to mark mediation session scheduled", status: 500 };
    const scheduleResult = await financialDisclosureService.ensureDraftFinancialScheduleForSession(updated.id, actor);
    if (!scheduleResult.ok) return { ok: false, error: scheduleResult.error, status: scheduleResult.status };
    await this.createAppointmentAcknowledgementTask(confirmResult.appointment, "confirmed");
    await this.notifyClients(parties, session, confirmResult.appointment, "Mediation session confirmed", `Session ${session.sessionNumber} is confirmed.`);
    await logAudit({
      userId: actor.id,
      action: "confirm_mediation_session",
      entity: "session",
      entityId: session.id,
      details: JSON.stringify({ appointmentId: appointment.id }),
      ipAddress,
    });
    return { ok: true, session: (await this.enrichSessions([updated]))[0] };
  }

  async attemptAutoConfirmSession(
    sessionId: string,
    trigger: AutoConfirmTrigger,
    ipAddress?: string,
  ): Promise<MediationSessionAutoConfirmation> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { attempted: true, confirmed: false, reason: "not_found" };
    if (!session.appointmentId) return { attempted: true, confirmed: false, reason: "no_appointment" };

    const appointment = await storage.getAppointment(session.appointmentId);
    if (!appointment) return { attempted: true, confirmed: false, reason: "no_appointment" };
    if (session.status === "scheduled" || appointment.status === "confirmed") {
      return { attempted: true, confirmed: true, reason: "already_confirmed" };
    }
    if (!["hold", "held"].includes(appointment.status) || ["cancelled", "completed"].includes(session.status)) {
      return { attempted: true, confirmed: false, reason: "not_ready" };
    }

    const parties = await storage.listPartiesByCase(session.caseId);
    const c = await storage.getCase(session.caseId);
    if (!c) return { attempted: true, confirmed: false, reason: "not_found" };

    const forms = await this.listRequiredFormsForSessionGate(session);
    const proposal = await storage.getMediationSessionProposalByAppointment(appointment.id);
    const requirements = this.formRequirementsForCase(c, forms, parties, proposal);
    const requiredFormTypes = requirements.filter((item) => item.applicable && BLOCKING_FORM_TYPES.includes(item.formType)).map((item) => item.formType);
    const missingOrUnsigned = await this.getMissingOrUnacceptedRequiredForms(parties, forms, requiredFormTypes);
    if (missingOrUnsigned.length > 0) return { attempted: true, confirmed: false, reason: "not_ready" };

    if (proposal && new Date(proposal.expiresAt) < new Date()) return { attempted: true, confirmed: false, reason: "not_ready" };
    if (proposal) {
      const recipients = await storage.listMediationSessionProposalRecipientsByProposal(proposal.id);
      const notAccepted = recipients.filter((recipient) => recipient.recipientType !== "mediator_participant" && recipient.responseStatus !== "accepted");
      if (notAccepted.length > 0) return { attempted: true, confirmed: false, reason: "not_ready" };
    }

    const invoices = await financeService.listInvoicesByAppointment(appointment.id);
    const partyIds = new Set(parties.map((party) => party.id));
    const invoicesByParty = invoices.filter((invoice) => invoice.billToPartyId && partyIds.has(invoice.billToPartyId));
    if (invoicesByParty.length < parties.length) return { attempted: true, confirmed: false, reason: "not_ready" };
    const unpaid = invoicesByParty.filter((invoice) => !this.invoiceSatisfied(invoice));
    if (unpaid.length > 0) return { attempted: true, confirmed: false, reason: "not_ready" };

    await storage.updateAppointment(appointment.id, {
      paymentStatus: "paid",
      paymentStatusUpdatedAt: new Date(),
      paymentStatusUpdatedBy: null,
      paymentNotes: "Auto-confirmed after all mediation session gates completed.",
    });
    const confirmResult = await appointmentService.confirm(appointment.id, systemActor("mediation_session_auto_confirm"));
    if (!confirmResult.ok) {
      await this.ensureAdminTask(
        session.caseId,
        appointment.id,
        "mediation_session_auto_confirm_failed",
        `Mediation Session ${session.sessionNumber} auto-confirm failed`,
        `Mediation Session ${session.sessionNumber} is ready, but calendar confirmation failed: ${confirmResult.error}`,
        "red",
      );
      return { attempted: true, confirmed: false, reason: "calendar_failed", error: confirmResult.error };
    }

    const updated = await storage.updateMediationSession(session.id, { status: "scheduled" });
    if (!updated) {
      await this.ensureAdminTask(
        session.caseId,
        appointment.id,
        "mediation_session_auto_confirm_failed",
        `Mediation Session ${session.sessionNumber} auto-confirm failed`,
        "Calendar confirmation succeeded, but the mediation session could not be marked scheduled. Please review the case before taking further action.",
        "red",
      );
      return { attempted: true, confirmed: false, reason: "calendar_failed", error: "Failed to mark mediation session scheduled" };
    }

    await this.createAppointmentAcknowledgementTask(confirmResult.appointment, "confirmed");
    await this.notifyClients(parties, session, confirmResult.appointment, "Mediation session confirmed", `Session ${session.sessionNumber} is confirmed.`);
    await caseActivityService.log({
      caseId: session.caseId,
      type: "mediation_session_auto_confirmed",
      title: `Mediation Session ${session.sessionNumber} auto-confirmed`,
      description: `Session ${session.sessionNumber} auto-confirmed after all required acceptance, payment, and form gates were complete.`,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({
        appointmentId: appointment.id,
        trigger,
        orderExamples: ["mediator_accepts_first", "client_accepts_last"],
      }),
      actor: { name: "System", type: "system", channel: "mediation-session-auto-confirm" },
    });
    await logAudit({
      userId: null,
      action: "auto_confirm_mediation_session",
      entity: "session",
      entityId: session.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ appointmentId: appointment.id, trigger }),
      ipAddress,
    });

    return { attempted: true, confirmed: true };
  }

  async markFormViewed(formId: string, actor: Pick<User, "id" | "role">): Promise<ServiceResult<{ form: PartyRequiredForm }>> {
    const access = await this.validateFormClientAccess(formId, actor);
    if (!access.ok) return access;
    const form = access.form.status === "signed"
      ? access.form
      : await storage.updatePartyRequiredFormStatus(formId, "viewed", { viewedAt: access.form.viewedAt || new Date() });
    if (!form) return { ok: false, error: "Failed to update form", status: 500 };
    return { ok: true, form };
  }

  async signForm(formId: string, actor: Pick<User, "id" | "role" | "name">, input: { signerName: string; attestationText?: string | null; confirmationTick?: boolean }, ipAddress?: string): Promise<ServiceResult<{ form: PartyRequiredForm; document?: CaseDocument }>> {
    const access = await this.validateFormClientAccess(formId, actor);
    if (!access.ok) return access;
    if (access.form.withdrawnAt) return { ok: false, error: "Withdrawn optional opt-ins cannot be signed", status: 409 };
    if (!input.confirmationTick) return { ok: false, error: "The confirmation tick is required before signing this form", status: 400 };
    const signerName = input.signerName.trim();
    if (!signerName) return { ok: false, error: "Signer name is required", status: 400 };
    const attestationText = input.attestationText?.trim() || this.defaultAttestationText(access.form.formType);
    const form = await storage.updatePartyRequiredFormStatus(formId, "signed", {
      viewedAt: access.form.viewedAt || new Date(),
      signedAt: new Date(),
      signedBy: actor.id,
      signerName,
      signatureIpAddress: ipAddress || null,
      attestationText,
      attestationVersion: SIGNATURE_ATTESTATION_VERSION,
      confirmationTickedAt: new Date(),
      signatureSource: "platform",
    });
    if (!form) return { ok: false, error: "Failed to sign form", status: 500 };
    let signedDocument: CaseDocument | undefined;
    try {
      signedDocument = await this.createSignedFormSnapshotDocument(form, actor, {
        source: "platform",
        attestationText,
        fileNamePrefix: "signed",
      });
      form.generatedDocumentId = signedDocument.id;
    } catch (error) {
      console.error("[MediationSession] Signed form PDF snapshot generation failed", error);
    }
    try {
      const generated = await courtFormGenerationService.generateRequiredFormTemplateAfterSignature(form.id, actor, ipAddress);
      if (generated) {
        form.courtFormGenerationId = generated.id;
        form.generatedDocumentId = generated.caseDocumentId;
        const generatedDocument = generated.caseDocumentId ? await storage.getCaseDocument(generated.caseDocumentId) : undefined;
        if (generatedDocument) await this.ensureCaseDocumentProofingItem(generatedDocument, actor as ActorUser);
      }
    } catch (error) {
      console.error("[MediationSession] Required form template PDF generation after signature failed", error);
    }
    await this.completeClientRequiredFormTasks(form, actor);
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "mediation_session_form_signed",
      urgency: "green",
      caseId: form.caseId,
      appointmentId: form.appointmentId,
      title: "Required mediation form signed",
      message: `${signerName} signed ${this.formLabel(form.formType)}.`,
      caseNoteRequired: false,
    });
    const sessionId = await this.getSessionIdForRequiredForm(form);
    if (sessionId) await this.attemptAutoConfirmSession(sessionId, "form_signed", ipAddress);
    return { ok: true, form, document: signedDocument };
  }

  async uploadSignedRequiredForm(
    formId: string,
    actor: Pick<User, "id" | "role" | "name">,
    input: { fileName: string; fileData: string; mimeType?: string | null; signerName: string; signedAt: Date; uploadNotes?: string | null },
    ipAddress?: string,
  ): Promise<ServiceResult<{ form: PartyRequiredForm; document: CaseDocument }>> {
    const access = await this.validateFormUploadAccess(formId, actor);
    if (!access.ok) return access;
    if (access.form.withdrawnAt) return { ok: false, error: "Withdrawn optional opt-ins cannot be uploaded as signed", status: 409 };
    if (access.form.status === "signed") return { ok: false, error: "Required form has already been signed", status: 409 };
    const signerName = input.signerName.trim();
    if (!signerName) return { ok: false, error: "Signer name is required", status: 400 };
    const signedAt = new Date(input.signedAt);
    if (Number.isNaN(signedAt.valueOf())) return { ok: false, error: "Signed date is required", status: 400 };

    const parsed = parseDataUrl(input.fileData, input.mimeType);
    const safeFileName = `${Date.now()}-${sanitizeFileName(input.fileName)}`;
    const stored = await fileStorageService.saveCaseDocumentFile({
      fileName: safeFileName,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
    });
    const reviewStatus = actor.role === "client" ? "ready_for_review" : this.isVoucherFormType(access.form.formType) ? "ready_for_review" : "reviewed";
    const document = await storage.createCaseDocument({
      caseId: access.form.caseId,
      mediationSessionId: access.form.mediationSessionId || null,
      partyId: access.form.partyId,
      documentCategory: SIGNED_FORM_DOCUMENT_CATEGORY,
      title: `${this.formLabel(access.form.formType)} - signed upload`,
      fileName: safeFileName,
      fileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType: parsed.mimeType,
      uploadedBy: actor.id,
      reviewStatus,
      reviewedBy: reviewStatus === "reviewed" ? actor.id : null,
      reviewedAt: reviewStatus === "reviewed" ? new Date() : null,
      readyForReviewAt: reviewStatus === "ready_for_review" ? new Date() : null,
      sharedWithClients: true,
    });
    const form = await storage.updatePartyRequiredFormStatus(formId, "signed", {
      viewedAt: access.form.viewedAt || new Date(),
      signedAt,
      signedBy: actor.id,
      signerName,
      signatureIpAddress: ipAddress || null,
      attestationText: this.defaultAttestationText(access.form.formType),
      attestationVersion: SIGNATURE_ATTESTATION_VERSION,
      signatureSource: actor.role === "client" ? "upload" : "admin_offline",
      uploadedDocumentId: document.id,
      generatedDocumentId: document.id,
      uploadNotes: input.uploadNotes?.trim() || null,
    });
    if (!form) return { ok: false, error: "Failed to update form", status: 500 };
    if (reviewStatus === "ready_for_review") {
      await this.createDocumentsReadyForReviewTask(document, actor as ActorUser);
      await this.ensureCaseDocumentProofingItem(document, actor as ActorUser);
    }
    await this.completeClientRequiredFormTasks(form, actor);
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type: "mediation_session_form_signed_upload",
      urgency: "green",
      caseId: form.caseId,
      appointmentId: form.appointmentId,
      title: "Signed mediation form uploaded",
      message: `${signerName} uploaded ${this.formLabel(form.formType)}.`,
      caseNoteRequired: false,
    });
    const sessionId = await this.getSessionIdForRequiredForm(form);
    if (sessionId) await this.attemptAutoConfirmSession(sessionId, "form_signed", ipAddress);
    return { ok: true, form, document };
  }

  async withdrawOptionalRequiredForm(
    formId: string,
    actor: Pick<User, "id" | "role" | "name">,
    ipAddress?: string,
  ): Promise<ServiceResult<{ form: PartyRequiredForm }>> {
    const access = await this.validateFormClientAccess(formId, actor);
    if (!access.ok) return access;
    if (!OPTIONAL_VOUCHER_FORM_TYPES.includes(access.form.formType as PartyRequiredFormType)) {
      return { ok: false, error: "Only optional voucher opt-ins can be withdrawn", status: 409 };
    }
    if (access.form.withdrawnAt) return { ok: true, form: access.form };
    const form = await storage.updatePartyRequiredForm(access.form.id, {
      withdrawnAt: new Date(),
      withdrawnBy: actor.id,
      updatedAt: new Date(),
    });
    if (!form) return { ok: false, error: "Failed to withdraw optional opt-in", status: 500 };
    await caseActivityService.log({
      caseId: form.caseId,
      type: "required_form_withdrawn",
      title: "Optional voucher opt-in withdrawn",
      description: `${actor.name} withdrew ${this.formLabel(form.formType)}.`,
      relatedEntityId: form.id,
      relatedEntityType: "party_required_form",
      metadata: JSON.stringify({ formType: form.formType, partyId: form.partyId }),
      actor: actor.role === "client" ? { name: actor.name, type: "client", channel: "client-portal" } : staffActor(actor),
    });
    await logAudit({
      userId: actor.id,
      action: "withdraw_optional_required_form",
      entity: "party_required_form",
      entityId: form.id,
      details: JSON.stringify({ caseId: form.caseId, partyId: form.partyId, formType: form.formType }),
      ipAddress,
    });
    return { ok: true, form };
  }

  private async createSignedFormSnapshotDocument(
    form: PartyRequiredForm,
    actor: Pick<User, "id" | "role" | "name">,
    options: { source: "platform" | "upload" | "admin_offline"; attestationText: string; fileNamePrefix: string },
  ): Promise<CaseDocument> {
    const [c, parties] = await Promise.all([
      storage.getCase(form.caseId),
      storage.listPartiesByCase(form.caseId),
    ]);
    const party = parties.find((row) => row.id === form.partyId) || null;
    const client = party ? await storage.getClient(party.clientId) : null;
    const caseRef = c?.caseRef || form.caseId;
    const title = `${this.formLabel(form.formType)} - signed snapshot`;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 54, bottom: 54, left: 54, right: 54 },
        info: {
          Title: title,
          Author: "Brighter Future Mediation",
          Subject: "Signed mediation form evidence",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(18).text(title);
      doc.moveDown();
      doc.fontSize(11);
      const rows = [
        ["Case reference", caseRef],
        ["Form block", this.formLabel(form.formType)],
        ["Party", party ? `${partyName(party)} (${party.role})` : form.partyId],
        ["Client email", client?.email || ""],
        ["Signed by user", actor.id],
        ["Signer name", form.signerName || ""],
        ["Signed at", form.signedAt ? new Date(form.signedAt).toISOString() : ""],
        ["Signature IP address", form.signatureIpAddress || ""],
        ["Signature source", options.source],
        ["Attestation version", form.attestationVersion || SIGNATURE_ATTESTATION_VERSION],
      ];
      for (const [label, value] of rows) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(value || "Not recorded");
      }
      doc.moveDown();
      doc.font("Helvetica-Bold").text("Attestation text");
      doc.font("Helvetica").text(options.attestationText);
      doc.end();
    });
    const fileName = `${options.fileNamePrefix}-${sanitizeFileName(caseRef)}-${sanitizeFileName(form.formType)}-${form.partyId}.pdf`;
    const stored = await fileStorageService.saveCaseDocumentFile({
      fileName,
      buffer,
      mimeType: "application/pdf",
    });
    const reviewStatus = this.isVoucherFormType(form.formType) ? "ready_for_review" : "reviewed";
    const document = await storage.createCaseDocument({
      caseId: form.caseId,
      mediationSessionId: form.mediationSessionId || null,
      partyId: form.partyId,
      documentCategory: SIGNED_FORM_DOCUMENT_CATEGORY,
      title,
      fileName,
      fileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType: "application/pdf",
      uploadedBy: actor.id,
      reviewStatus,
      reviewedBy: reviewStatus === "reviewed" ? actor.id : null,
      reviewedAt: reviewStatus === "reviewed" ? new Date() : null,
      readyForReviewAt: reviewStatus === "ready_for_review" ? new Date() : null,
      sharedWithClients: true,
    });
    await storage.updatePartyRequiredFormStatus(form.id, "signed", { generatedDocumentId: document.id });
    if (reviewStatus === "ready_for_review") {
      await this.createDocumentsReadyForReviewTask(document, actor as ActorUser);
      await this.ensureCaseDocumentProofingItem(document, actor as ActorUser);
    }
    return document;
  }

  private async getSessionIdForRequiredForm(form: PartyRequiredForm): Promise<string | null> {
    if (form.mediationSessionId) return form.mediationSessionId;
    if (!form.appointmentId) return null;
    const sessions = await storage.listMediationSessionsByCase(form.caseId);
    return sessions.find((session) => session.appointmentId === form.appointmentId)?.id || null;
  }

  private async completeClientRequiredFormTasks(form: PartyRequiredForm, actor: Pick<User, "id" | "role" | "name">): Promise<void> {
    if (actor.role !== "client" || !form.appointmentId) return;

    const partyForms = await storage.listPartyRequiredFormsByPartyIds([form.partyId]);
    const remainingRequiredForms = partyForms.filter((candidate) => (
      candidate.appointmentId === form.appointmentId
      && BLOCKING_FORM_TYPES.includes(candidate.formType as PartyRequiredFormType)
      && candidate.status !== "signed"
    ));
    if (remainingRequiredForms.length > 0) return;

    await db.update(notifications)
      .set({
        status: "completed",
        completedBy: actor.id,
        completedAt: new Date(),
        completionNotes: "Required mediation forms signed by client.",
      })
      .where(and(
        eq(notifications.recipientId, actor.id),
        eq(notifications.recipientRole, "client"),
        eq(notifications.type, "task"),
        eq(notifications.caseId, form.caseId),
        eq(notifications.appointmentId, form.appointmentId),
        inArray(notifications.status, ["active", "in_progress", "follow_up"]),
      ));
  }

  async resendRequiredForm(formId: string, actor: ActorUser, ipAddress?: string): Promise<ServiceResult<{ form: PartyRequiredForm }>> {
    const form = await storage.getPartyRequiredForm(formId);
    if (!form) return { ok: false, error: "Required form not found", status: 404 };
    if (form.status === "signed" || form.withdrawnAt) {
      return { ok: false, error: "Only pending required forms can be resent", status: 409 };
    }
    const canManage = await this.canManageRequiredFormDelivery(form, actor);
    if (!canManage) {
      return { ok: false, error: "Only admins, the active lead mediator, and accepted co-mediators can resend required forms", status: 403 };
    }
    if (!form.appointmentId) {
      return { ok: false, error: "Required form is not linked to a held mediation session", status: 409 };
    }
    const sessionId = await this.getSessionIdForRequiredForm(form);
    if (!sessionId) return { ok: false, error: "Required form is not linked to a held mediation session", status: 409 };

    const [c, party, appointment, session] = await Promise.all([
      storage.getCase(form.caseId),
      storage.getParty(form.partyId),
      storage.getAppointment(form.appointmentId),
      storage.getMediationSession(sessionId),
    ]);
    if (!c || !party || !appointment || !session) {
      return { ok: false, error: "Required form case, party, appointment, or session was not found", status: 404 };
    }

    const client = await storage.getClient(party.clientId);
    if (!client) return { ok: false, error: "Client not found for required form", status: 404 };

    const actionPath = `/cases/${form.caseId}?tab=mediation-sessions`;
    const actionUrl = `${getBaseUrl()}${actionPath}`;
    const clientName = `${client.firstName} ${client.lastName}`.trim() || `Client ${party.role}`;
    const formName = this.formLabel(form.formType);

    if (client.userId) {
      await notificationService.createNotification({
        recipientId: client.userId,
        recipientRole: "client",
        type: "task",
        urgency: "amber",
        caseId: form.caseId,
        appointmentId: form.appointmentId,
        title: `Sign ${formName}`,
        message: `Please sign ${formName} for Mediation Session ${session.sessionNumber}. ${actionPath}`,
        status: "active",
        caseNoteRequired: false,
      });
      await this.updateRequiredFormDelivery(form.id, {
        deliveryStatus: "in_app_task_created",
        deliveryLastAttemptedAt: new Date(),
        deliveryError: null,
      });
    }

    if (!client.email) {
      await this.updateRequiredFormDelivery(form.id, {
        deliveryStatus: "email_skipped",
        deliveryLastAttemptedAt: new Date(),
        deliveryError: "Client has no email address",
      });
    } else {
      try {
        const { sendMediationSessionRequiredFormEmail } = await import("./email.service");
        await sendMediationSessionRequiredFormEmail(
          client.email,
          clientName,
          c.caseRef,
          session.sessionNumber,
          appointment.dateTime,
          [formName],
          actionUrl,
        );
        await this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "email_sent",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: null,
        });
      } catch (error) {
        console.error("[MediationSession] required form resend email failed", error);
        await this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "email_failed",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: this.deliveryErrorMessage(error),
        });
      }
    }

    const updated = await storage.updatePartyRequiredForm(form.id, {
      issuedBy: actor.id,
      sentAt: new Date(),
    });
    if (!updated) return { ok: false, error: "Failed to update required form resend timestamp", status: 500 };

    await this.logSessionActivity(
      form.caseId,
      "mediation_session_required_form_resent",
      "Required form prompt resent",
      `${actor.name} resent ${formName} to ${clientName}.`,
      session.id,
      actor,
    );
    await logAudit({
      userId: actor.id,
      action: "resend_required_form",
      entity: "party_required_form",
      entityId: form.id,
      entityRef: c.caseRef,
      details: JSON.stringify({ caseId: form.caseId, partyId: form.partyId, mediationSessionId: session.id, formType: form.formType, status: form.status }),
      ipAddress,
    });

    return { ok: true, form: updated };
  }

  async sendUnpaidPaymentReminders(now = new Date()): Promise<{ reminded: number; adminTasks: number }> {
    const rows = await db
      .select({ session: mediationSessionsTable, appointment: appointmentsTable })
      .from(mediationSessionsTable)
      .innerJoin(appointmentsTable, eq(mediationSessionsTable.appointmentId, appointmentsTable.id))
      .where(and(
        inArray(appointmentsTable.status, ["hold", "held"]),
        sql`${appointmentsTable.dateTime} > ${now}`,
      ));

    let reminded = 0;
    let adminTasks = 0;
    for (const row of rows) {
      const invoices = await financeService.listInvoicesByAppointment(row.appointment.id);
      const unpaidInvoices = invoices.filter((invoice) => invoice.billToPartyId && !this.invoiceSatisfied(invoice));
      if (unpaidInvoices.length === 0) continue;

      for (const invoice of unpaidInvoices) {
        const party = invoice.billToPartyId ? await storage.getParty(invoice.billToPartyId) : null;
        const client = party ? await storage.getClient(party.clientId) : null;
        if (!client?.userId) continue;
        const existing = await db.select({ id: notifications.id }).from(notifications).where(and(
          eq(notifications.type, "mediation_session_payment_reminder_sent"),
          eq(notifications.recipientId, client.userId),
          eq(notifications.appointmentId, row.appointment.id),
          eq(notifications.status, "active"),
        )).limit(1);
        if (existing.length > 0) continue;

        await notificationService.createNotification({
          recipientId: client.userId,
          recipientRole: "client",
          type: "mediation_session_payment_reminder_sent",
          urgency: "amber",
          caseId: row.session.caseId,
          appointmentId: row.appointment.id,
          title: `Payment due for Mediation Session ${row.session.sessionNumber}`,
          message: `Payment is required before Mediation Session ${row.session.sessionNumber} can be confirmed. Please pay invoice ${invoice.invoiceNumber} before the hold expires.`,
          status: "active",
          caseNoteRequired: false,
        });
        await this.logSessionActivity(row.session.caseId, "mediation_session_payment_reminder_sent", `Session ${row.session.sessionNumber} payment reminder sent`, `Payment reminder sent for invoice ${invoice.invoiceNumber}.`, row.session.id, { id: "system", name: "System", role: "system" });
        reminded += 1;
      }

      const existingAdminTask = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.type, "mediation_session_payment_due"),
        eq(notifications.appointmentId, row.appointment.id),
        eq(notifications.status, "active"),
      )).limit(1);
      if (existingAdminTask.length === 0) {
        const holdExpiresAt = row.appointment.holdExpiresAt ? new Date(row.appointment.holdExpiresAt) : null;
        const hoursToExpiry = holdExpiresAt ? (holdExpiresAt.getTime() - now.getTime()) / (60 * 60 * 1000) : 999;
        await notificationService.createNotification({
          recipientId: null,
          recipientRole: "admin",
          type: "mediation_session_payment_due",
          urgency: hoursToExpiry <= 24 ? "red" : "amber",
          caseId: row.session.caseId,
          appointmentId: row.appointment.id,
          title: `Mediation Session ${row.session.sessionNumber} payment due`,
          message: `Mediation Session ${row.session.sessionNumber} has ${unpaidInvoices.length} unpaid invoice${unpaidInvoices.length === 1 ? "" : "s"} and cannot be confirmed until payment is complete.`,
          status: "active",
          caseNoteRequired: true,
        });
        adminTasks += 1;
      }
    }

    return { reminded, adminTasks };
  }

  async expireSessionHolds(now = new Date()): Promise<Appointment[]> {
    const candidates = await storage.findExpiredMediationSessionHolds(now);
    const expired: Appointment[] = [];
    for (const appointment of candidates) {
      const updated = await storage.updateAppointment(appointment.id, {
        status: "expired",
        paymentStatus: appointment.paymentStatus === "paid" ? appointment.paymentStatus : "failed_or_not_received",
        paymentStatusUpdatedAt: now,
        paymentNotes: "Mediation session hold expired before all payment/forms were complete.",
      });
      if (!updated) continue;
      expired.push(updated);
      await appointmentLifecycleHistoryService.recordAppointmentStatusChange(updated, appointment.status, "expired", "appointment_expired", { id: "system", name: "System", type: "system" }, "Mediation session hold expired before all payment/forms were complete.", {
        mediationSessionHold: true,
      });
      await financeService.voidUnpaidAppointmentInvoices(updated.id, {
        reason: "Mediation session hold expired before payment/forms were complete.",
      });
      const sessions = await storage.listMediationSessionsByCase(updated.caseId);
      const session = sessions.find((s) => s.appointmentId === updated.id);
      if (session) {
        await storage.getMediationSessionProposalByAppointment(updated.id).then((proposal) =>
          proposal ? storage.updateMediationSessionProposal(proposal.id, { status: "expired" }) : undefined,
        );
        await this.createAppointmentAcknowledgementTask(updated, "expired");
        const parties = await storage.listPartiesByCase(updated.caseId);
        await this.notifyClients(parties, session, updated, "Mediation session hold expired", `Session ${session.sessionNumber} hold expired. Please choose an alternative slot or contact Brighter Future Mediation.`);
        await this.ensureAdminTask(updated.caseId, updated.id, "mediation_session_hold_expired", "Urgent: mediation session hold expired", `Session ${session.sessionNumber} expired before all payments/forms were complete. Offer alternative slots or rebooking.`, "red");
        await this.logSessionActivity(updated.caseId, "mediation_session_hold_expired", `Session ${session.sessionNumber} hold expired`, "The mediation session hold expired automatically.", session.id, { id: "system", name: "System", role: "system" });
      }
    }
    return expired;
  }

  private async resolveAvailabilityParty(caseId: string, actor: ActorUser, partyId?: string): Promise<ServiceResult<{ party: Party }>> {
    const parties = await storage.listPartiesByCase(caseId);
    if (isAdmin(actor)) {
      const party = parties.find((p) => p.id === partyId);
      if (!party) return { ok: false, error: "Selected party does not belong to this case", status: 400 };
      return { ok: true, party };
    }
    if (actor.role !== "client") return { ok: false, error: "Only clients or admins can submit party availability", status: 403 };
    const ownParties = await storage.listPartiesByUserId(actor.id);
    const party = ownParties.find((p) => p.caseId === caseId && (!partyId || p.id === partyId));
    if (!party) return { ok: false, error: "Access denied", status: 403 };
    return { ok: true, party };
  }

  private getPublicProposalLinkStatus(
    proposal: MediationSessionProposal,
    recipient?: Pick<MediationSessionProposalRecipient, "recipientType">,
    session?: Pick<MediationSession, "status">,
  ): PublicProposalLinkStatus {
    if (recipient?.recipientType === "mediator_participant") {
      if (session?.status === "cancelled" || proposal.status === "cancelled") {
        return {
          active: false,
          reason: "cancelled",
          message: "This session invitation is no longer active.",
        };
      }
      return { active: true };
    }
    if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
      return {
        active: false,
        reason: "expired",
        message: "This session availability link has expired.",
      };
    }
    if (proposal.status !== "held" && proposal.status !== "accepted") {
      const reason = ["released", "cancelled", "superseded"].includes(proposal.status)
        ? proposal.status as PublicProposalLinkStatus["reason"]
        : "superseded";
      return {
        active: false,
        reason,
        message: "This session invitation is no longer active.",
      };
    }
    return { active: true };
  }

  private async rotateProposalRecipientLink(
    recipient: MediationSessionProposalRecipient,
    session: MediationSession,
    proposal: MediationSessionProposal,
    actor: ActorUser,
    options: { regenerateAccepted?: boolean } = {},
  ): Promise<ProposalPublicLink> {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashProposalToken(token);
    const updated = await storage.updateMediationSessionProposalRecipient(recipient.id, {
      tokenHash,
      sentAt: new Date(),
    });
    const target = updated || recipient;
    if (target.recipientType === "mediator_participant" && target.participantId) {
      await storage.updateMediationSessionParticipant(target.participantId, {
        invitationTokenHash: hashParticipantInvitationToken(token),
        invitationSentAt: new Date(),
      });
    }
    const publicUrl = `${getBaseUrl()}/session-availability/${token}`;
    if (target.recipientType === "mediator_participant") {
      await this.notifyParticipantInviteRecipient(target, session, proposal, publicUrl);
    } else {
      await this.notifyProposalRecipient(target, session, proposal, publicUrl);
    }
    await caseActivityService.log({
      caseId: session.caseId,
      type: "mediation_session_proposal_link_resent",
      title: `Session ${session.sessionNumber} response link resent`,
      description: `A fresh response link was generated for ${target.recipientName}.`,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({
        proposalId: proposal.id,
        recipientId: target.id,
        recipientType: target.recipientType,
        responseStatus: target.responseStatus,
        regenerateAccepted: !!options.regenerateAccepted,
      }),
      actor: staffActor(actor),
    });
    await logAudit({
      userId: actor.id,
      action: "resend_mediation_session_proposal_recipient_link",
      entity: "proposal_recipient",
      entityId: target.id,
      entityRef: session.caseId,
      details: JSON.stringify({
        proposalId: proposal.id,
        sessionId: session.id,
        recipientId: target.id,
        recipientType: target.recipientType,
        responseStatus: target.responseStatus,
        regenerateAccepted: !!options.regenerateAccepted,
      }),
    });
    return {
      recipientId: target.id,
      recipientName: target.recipientName,
      recipientType: target.recipientType,
      publicUrl,
    };
  }

  private async rotateProposalRecipientWhatsappLink(
    recipient: MediationSessionProposalRecipient,
    session: MediationSession,
    proposal: MediationSessionProposal,
    actor: ActorUser,
    existingPublicUrl?: string,
  ): Promise<ProposalPublicLink> {
    if (existingPublicUrl) {
      const token = extractSessionAvailabilityToken(existingPublicUrl) || "";
      const existing = token ? await storage.getMediationSessionProposalRecipientByTokenHash(hashProposalToken(token)) : undefined;
      if (existing?.id === recipient.id) {
        return {
          recipientId: recipient.id,
          recipientName: recipient.recipientName,
          recipientType: recipient.recipientType,
          publicUrl: sessionAvailabilityUrl(token),
        };
      }
    }
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashProposalToken(token);
    const updated = await storage.updateMediationSessionProposalRecipient(recipient.id, {
      tokenHash,
      sentAt: new Date(),
    });
    const target = updated || recipient;
    const publicUrl = sessionAvailabilityUrl(token);
    await caseActivityService.log({
      caseId: session.caseId,
      type: "mediation_session_proposal_link_resent",
      title: `Session ${session.sessionNumber} WhatsApp response link prepared`,
      description: `A WhatsApp response link was prepared for ${target.recipientName}.`,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({
        proposalId: proposal.id,
        recipientId: target.id,
        recipientType: target.recipientType,
        channel: "whatsapp",
      }),
      actor: staffActor(actor),
    });
    return {
      recipientId: target.id,
      recipientName: target.recipientName,
      recipientType: target.recipientType,
      publicUrl,
    };
  }

  private async previewProposalRecipientWhatsappLink(
    recipient: MediationSessionProposalRecipient,
    existingPublicUrl?: string,
  ): Promise<ProposalPublicLink> {
    const token = extractSessionAvailabilityToken(existingPublicUrl) || "";
    const existing = token ? await storage.getMediationSessionProposalRecipientByTokenHash(hashProposalToken(token)) : undefined;
    const publicUrl = existing?.id === recipient.id
      ? sessionAvailabilityUrl(token)
      : `${getBaseUrl()}${SESSION_AVAILABILITY_PATH}/secure-client-link-generated-on-send`;
    return {
      recipientId: recipient.id,
      recipientName: recipient.recipientName,
      recipientType: recipient.recipientType,
      publicUrl,
    };
  }

  private async resolvePublicProposalToken(
    token: string,
    markViewed: boolean,
  ): Promise<ServiceResult<{ proposal: MediationSessionProposal; recipient: MediationSessionProposalRecipient; session: MediationSession; caseRecord: Case }>> {
    const recipient = await storage.getMediationSessionProposalRecipientByTokenHash(hashProposalToken(token));
    if (!recipient) return { ok: false, error: "This session availability link is invalid", status: 404 };
    const proposal = await storage.getMediationSessionProposal(recipient.proposalId);
    if (!proposal) return { ok: false, error: "This session proposal is no longer available", status: 404 };
    const [session, caseRecord] = await Promise.all([
      storage.getMediationSession(proposal.mediationSessionId),
      storage.getCase(proposal.caseId),
    ]);
    if (!session || !caseRecord) return { ok: false, error: "This session proposal is no longer available", status: 404 };
    const viewed = markViewed ? await storage.markMediationSessionProposalRecipientViewed(recipient.id) : recipient;
    if (markViewed && recipient.recipientType === "mediator_participant" && recipient.participantId) {
      await storage.updateMediationSessionParticipant(recipient.participantId, { invitationViewedAt: new Date() });
    }
    return { ok: true, proposal, recipient: viewed || recipient, session, caseRecord };
  }

  private intersectPartyWindows(groups: Array<Array<{ startAt: Date; endAt: Date }>>): Array<{ startAt: Date; endAt: Date }> {
    if (groups.length === 0 || groups.some((group) => group.length === 0)) return [];
    let intersections = groups[0].map((w) => ({ startAt: new Date(w.startAt), endAt: new Date(w.endAt) }));
    for (const group of groups.slice(1)) {
      const next: Array<{ startAt: Date; endAt: Date }> = [];
      for (const current of intersections) {
        for (const window of group) {
          const startAt = new Date(Math.max(current.startAt.getTime(), new Date(window.startAt).getTime()));
          const endAt = new Date(Math.min(current.endAt.getTime(), new Date(window.endAt).getTime()));
          if (endAt > startAt) next.push({ startAt, endAt });
        }
      }
      intersections = next;
    }
    return intersections.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }

  private async filterMediatorSlots(mediatorId: string, windows: Array<{ startAt: Date; endAt: Date }>, durationMinutes: number): Promise<Array<{ startAt: Date; endAt: Date }>> {
    const availability = await storage.listActiveAvailabilityByMediator(mediatorId);
    const slots: Array<{ startAt: Date; endAt: Date }> = [];
    const durationMs = durationMinutes * 60000;
    for (const window of windows) {
      const conflicts = await storage.listAppointmentsByMediatorAndDateRange(mediatorId, window.startAt, window.endAt);
      for (let startMs = window.startAt.getTime(); startMs + durationMs <= window.endAt.getTime(); startMs += 30 * 60000) {
        const startAt = new Date(startMs);
        const endAt = new Date(startMs + durationMs);
        const day = startAt.getDay();
        const minutes = startAt.getHours() * 60 + startAt.getMinutes();
        const endMinutes = endAt.getHours() * 60 + endAt.getMinutes();
        const fitsAvailability = availability.some((slot) => {
          if (slot.dayOfWeek !== day) return false;
          const [startHour, startMinute] = slot.startTime.split(":").map(Number);
          const [endHour, endMinute] = slot.endTime.split(":").map(Number);
          return minutes >= startHour * 60 + startMinute && endMinutes <= endHour * 60 + endMinute;
        });
        if (!fitsAvailability) continue;
        const overlapsBusy = conflicts.some((appt) => {
          const busyStart = new Date(appt.dateTime).getTime();
          const busyEnd = busyStart + appt.duration * 60000;
          return startAt.getTime() < busyEnd && endAt.getTime() > busyStart;
        });
        if (!overlapsBusy) slots.push({ startAt, endAt });
      }
    }
    return slots.slice(0, 20);
  }

  private async getLeadMediatorAvailabilityContext(session: MediationSession): Promise<ServiceResult<{ mediator: User; serviceTypeId: string }>> {
    if (!session.leadMediatorId) return { ok: false, error: "Lead mediator is required before viewing session availability", status: 409 };
    const mediator = await storage.getUser(session.leadMediatorId);
    if (!mediator || mediator.role !== "mediator" || mediator.status !== "active") {
      return { ok: false, error: "Lead mediator must be active", status: 409 };
    }
    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType) return { ok: false, error: "Mediation Sessions service type is not configured", status: 409 };
    const assignmentCheck = await this.validateMediatorAssignment(mediator.id, "lead_mediator", "Lead mediator");
    if (!assignmentCheck.ok) {
      return {
        ok: false,
        error: assignmentCheck.error,
        status: assignmentCheck.status === 400 ? 409 : assignmentCheck.status,
      };
    }
    return { ok: true, mediator, serviceTypeId: serviceType.id };
  }

  private async getLeadMediatorAvailableDatesForSession(
    session: MediationSession,
    month: string,
    durationMinutes: number,
  ): Promise<ServiceResult<{ dates: string[]; bookingPaused: boolean; message?: string }>> {
    const context = await this.getLeadMediatorAvailabilityContext(session);
    if (!context.ok) return context;
    const [yearStr, monthStr] = month.split("-");
    const year = Number.parseInt(yearStr, 10);
    const mon = Number.parseInt(monthStr, 10) - 1;
    if (Number.isNaN(year) || Number.isNaN(mon)) return { ok: false, error: "month must be YYYY-MM", status: 400 };
    if (context.mediator.lastCalendarSyncError === "needs_write_scope") {
      return { ok: true, dates: [], bookingPaused: true, message: "Lead mediator calendar needs reconnecting before availability can be shown." };
    }
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysInMonth = new Date(year, mon + 1, 0).getDate();
    const dates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(year, mon, day));
      if (date < today) continue;
      const key = `${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const slots = await this.getLeadMediatorAvailableSlotsForSession(session, key, durationMinutes);
      if (slots.ok && slots.slots.length > 0) dates.push(key);
    }
    return { ok: true, dates, bookingPaused: false };
  }

  private async getLeadMediatorAvailableSlotsForSession(
    session: MediationSession,
    date: string,
    durationMinutes: number,
  ): Promise<ServiceResult<{ slots: SessionAvailabilitySlot[]; message?: string }>> {
    const context = await this.getLeadMediatorAvailabilityContext(session);
    if (!context.ok) return context;
    const [yearStr, monthStr, dayStr] = date.split("-");
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10) - 1;
    const day = Number.parseInt(dayStr, 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return { ok: false, error: "date must be YYYY-MM-DD", status: 400 };
    const duration = Number.isInteger(durationMinutes) && durationMinutes > 0 ? Math.min(durationMinutes, 480) : 120;
    const dayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    const windows = await getMediatorAvailabilityWindows(context.mediator, dayStart, dayEnd, context.serviceTypeId);
    const now = new Date();
    const slots: SessionAvailabilitySlot[] = [];
    for (const window of windows) {
      for (const startAt of this.generateSessionSlotsInWindow(window, duration)) {
        if (startAt <= now) continue;
        const endAt = new Date(startAt.getTime() + duration * 60000);
        slots.push({
          startAt,
          endAt,
          time: `${String(startAt.getUTCHours()).padStart(2, "0")}:${String(startAt.getUTCMinutes()).padStart(2, "0")}`,
          endTime: `${String(endAt.getUTCHours()).padStart(2, "0")}:${String(endAt.getUTCMinutes()).padStart(2, "0")}`,
          duration,
        });
      }
    }
    return { ok: true, slots: slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime()) };
  }

  private generateSessionSlotsInWindow(window: { start: Date; end: Date }, durationMinutes: number): Date[] {
    const slots: Date[] = [];
    const durationMs = durationMinutes * 60000;
    const gridMs = 15 * 60000;
    let cursor = new Date(Math.ceil(window.start.getTime() / gridMs) * gridMs);
    while (cursor.getTime() + durationMs <= window.end.getTime()) {
      slots.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + 30 * 60000);
    }
    return slots;
  }

  private calculateSessionHoldExpiry(appointmentStart: Date): Date {
    const deadline = new Date(Date.now() + 72 * 60 * 60 * 1000);
    return deadline.getTime() < appointmentStart.getTime() ? deadline : appointmentStart;
  }

  async issueMissingRequiredForms(sessionId: string, actor: ActorUser): Promise<ServiceResult<{ session: MediationSessionView }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can issue mediation session forms", status: 403 };
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (!session.appointmentId) return { ok: false, error: "Place a hold before issuing mediation session forms", status: 409 };
    const [appointment, c, proposal, parties] = await Promise.all([
      storage.getAppointment(session.appointmentId),
      storage.getCase(session.caseId),
      storage.getMediationSessionProposalByAppointment(session.appointmentId),
      storage.listPartiesByCase(session.caseId),
    ]);
    if (!appointment || !c) return { ok: false, error: "Session appointment or case was not found", status: 404 };
    await this.issueRequiredForms(session, appointment, parties, actor, Boolean(c.voucherClaimEligible), c);
    const updated = await storage.getMediationSession(sessionId);
    return { ok: true, session: (await this.enrichSessions([updated || session]))[0] };
  }

  private async validateVoucherClaimConsentReviewed(caseId: string): Promise<ServiceResult<{}>> {
    const parties = await storage.listPartiesByCase(caseId);
    const forms = await storage.listPartyRequiredFormsByCase(caseId);
    const missingClientLabels: string[] = [];
    for (const party of parties) {
      const mandatoryConsent = forms.find((form) => form.partyId === party.id && form.formType === VOUCHER_SCHEME_CONSENT_FORM_TYPE);
      if (!mandatoryConsent || !(await this.isRequiredFormAccepted(mandatoryConsent))) {
        missingClientLabels.push(`Client ${party.role}`);
      }
    }
    if (missingClientLabels.length > 0) {
      return {
        ok: false,
        error: `Mandatory voucher consent must be reviewed before applying voucher claim eligibility (${missingClientLabels.join(", ")}).`,
        status: 409,
      };
    }
    return { ok: true };
  }

  async setVoucherClaimEligibility(caseId: string, actor: ActorUser, input: { voucherClaimEligible: boolean }, ipAddress?: string): Promise<ServiceResult<{ case: Case; forms: PartyRequiredForm[] }>> {
    const c = await storage.getCase(caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    if (!(await this.canSetVoucherClaimEligibility(c, actor))) {
      return { ok: false, error: "Only superadmins, subadmins, and assigned mediators can set voucher claim eligibility", status: 403 };
    }
    if (input.voucherClaimEligible && !this.voucherEligibilityAllowedForCase(c)) {
      return { ok: false, error: "Voucher claim eligibility is only allowed for Child arrangements and AIM cases; property and finance cases are excluded", status: 400 };
    }
    if (input.voucherClaimEligible) {
      const consentValidation = await this.validateVoucherClaimConsentReviewed(caseId);
      if (!consentValidation.ok) return consentValidation;
    }
    const [updated] = await db.update(casesTable).set({
      voucherClaimEligible: input.voucherClaimEligible,
      voucherClaimEligibleSetAt: new Date(),
      voucherClaimEligibleSetBy: actor.id,
      lastUpdated: new Date(),
    }).where(eq(casesTable.id, caseId)).returning();

    let forms: PartyRequiredForm[] = [];
    if (input.voucherClaimEligible) {
      const sessions = await storage.listMediationSessionsByCase(caseId);
      const session = sessions.find((row) => !!row.appointmentId) || sessions[0];
      const appointment = session?.appointmentId ? await storage.getAppointment(session.appointmentId) : null;
      if (session && appointment) {
        forms = await this.issueRequiredForms(session, appointment, await storage.listPartiesByCase(caseId), actor, true, updated);
      }
    }
    await logAudit({
      userId: actor.id,
      action: "update_voucher_claim_eligibility",
      entity: "case",
      entityId: caseId,
      entityRef: updated.caseRef,
      details: JSON.stringify({ voucherClaimEligible: input.voucherClaimEligible }),
      ipAddress,
    });
    return { ok: true, case: updated, forms };
  }

  async ensureMiamVoucherComplianceForms(caseId: string, actor: ActorUser, ipAddress?: string): Promise<ServiceResult<{ forms: PartyRequiredForm[] }>> {
    const c = await storage.getCase(caseId);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    if (!this.voucherEligibilityAllowedForCase(c)) {
      return { ok: true, forms: [] };
    }
    const miamRecords = await storage.listMiamRecordsByCase(caseId);
    const approvedVoucherMiam = miamRecords.some((record) => record.approvalStatus === "approved" && mojVoucherAppliedStartsYes(record.mojVoucherApplied));
    if (!approvedVoucherMiam) return { ok: true, forms: [] };

    const parties = await storage.listPartiesByCase(caseId);
    const requiredTypes: PartyRequiredFormType[] = [
      VOUCHER_SCHEME_CONSENT_FORM_TYPE,
      VOUCHER_PRIVACY_POLICY_CLIENT_CONSENT_FORM_TYPE,
    ];
    const currentTemplates = new Map<PartyRequiredFormType, Awaited<ReturnType<typeof courtFormTemplateService.getCurrentCourtFormTemplate>>>();
    await Promise.all(requiredTypes.map(async (formType) => {
      currentTemplates.set(formType, await this.templateForRequiredForm(formType));
    }));

    const existingForms = await storage.listPartyRequiredFormsByCase(caseId);
    const existingKeys = new Set(existingForms.map((form) => `${form.partyId}:${form.formType}`));
    const forms: PartyRequiredForm[] = [];
    const newlyIssuedForms: PartyRequiredForm[] = [];
    for (const party of parties) {
      for (const formType of requiredTypes) {
        const template = currentTemplates.get(formType);
        const key = `${party.id}:${formType}`;
        const form = await storage.upsertPartyRequiredForm({
          caseId,
          partyId: party.id,
          appointmentId: null,
          mediationSessionId: null,
          formType,
          status: "outstanding",
          deliveryStatus: "not_sent",
          deliveryLastAttemptedAt: null,
          deliveryError: null,
          issuedBy: actor.id,
          sentAt: new Date(),
          courtFormTemplateId: template?.id || null,
        });
        forms.push(form);
        if (!existingKeys.has(key)) {
          newlyIssuedForms.push(form);
        }
      }
    }

    if (newlyIssuedForms.length === 0) return { ok: true, forms };

    const actionPath = `/cases/${caseId}?tab=documents`;
    for (const party of parties) {
      const partyForms = newlyIssuedForms.filter((form) => form.partyId === party.id);
      if (partyForms.length === 0) continue;
      const formNames = partyForms.map((form) => this.formLabel(form.formType));
      const client = await storage.getClient(party.clientId);
      if (client?.userId) {
        await notificationService.createNotification({
          recipientId: client.userId,
          recipientRole: "client",
          type: "task",
          urgency: "amber",
          caseId,
          appointmentId: null,
          title: "Complete MoJ voucher forms",
          message: `Please complete ${formNames.join(", ")} for your case. ${actionPath}`,
          status: "active",
          caseNoteRequired: false,
        });
        await Promise.all(partyForms.map((form) => this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "in_app_task_created",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: null,
        })));
      } else {
        await Promise.all(partyForms.map((form) => this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "email_skipped",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: "Client has no portal user for case-level voucher form task",
        })));
      }
    }

    await caseActivityService.log({
      caseId,
      type: "note_added",
      title: "MoJ voucher forms issued",
      description: `${actor.name} issued MoJ voucher compliance forms from the approved MIAM voucher decision.`,
      relatedEntityType: "case",
      metadata: JSON.stringify({ formTypes: requiredTypes }),
      actor: staffActor(actor),
    });
    await logAudit({
      userId: actor.id,
      action: "issue_miam_voucher_forms",
      entity: "case",
      entityId: caseId,
      entityRef: c.caseRef,
      details: JSON.stringify({ formTypes: requiredTypes }),
      ipAddress,
    });
    return { ok: true, forms };
  }

  async getVoucherClaimReadiness(sessionId: string, actor: ActorUser): Promise<ServiceResult<VoucherClaimReadiness>> {
    if (!isAdmin(actor)) return { ok: false, error: "Voucher claim status is only available to superadmins and subadmins", status: 403 };
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const [c, appointment, parties, forms, claimRows, demographicRows, clientRows] = await Promise.all([
      storage.getCase(session.caseId),
      session.appointmentId ? storage.getAppointment(session.appointmentId) : Promise.resolve(undefined),
      storage.listPartiesByCase(session.caseId),
      this.listRequiredFormsForSessionGate(session),
      db.select().from(mediationSessionVoucherClaims).where(eq(mediationSessionVoucherClaims.mediationSessionId, session.id)).limit(1),
      db.select().from(demographicData).where(eq(demographicData.caseId, session.caseId)),
      db.select().from(clientsTable),
    ]);
    if (!c) return { ok: false, error: "Case not found", status: 404 };
    const consentForms = forms.filter((form) => form.formType === VOUCHER_SCHEME_CONSENT_FORM_TYPE);
    const signedCount = consentForms.filter((form) => form.status === "signed").length;
    const signedPartyIds = new Set(consentForms.filter((form) => form.status === "signed").map((form) => form.partyId));
    const outstandingClientNames = parties
      .filter((party) => !signedPartyIds.has(party.id))
      .map((party) => partyName(party));
    const partyClientIds = new Set(parties.map((party) => party.clientId));
    const missingFields = this.getVoucherClaimMissingFields(c, appointment || null, session, parties, demographicRows as any[], clientRows.filter((client) => partyClientIds.has(client.id)));
    if (consentForms.length < parties.length || signedCount < parties.length) missingFields.push("voucher scheme client consent for all MIAM-attending clients");
    return {
      ok: true,
      ready: Boolean(c.voucherClaimEligible) && missingFields.length === 0,
      missingFields,
      signedCountLabel: `${signedCount} of ${Math.max(parties.length, consentForms.length)} signed`,
      outstandingClientNames,
      claim: claimRows[0] || null,
    };
  }

  async updateVoucherClaimStatus(
    sessionId: string,
    actor: ActorUser,
    input: { status: VoucherClaimStatus; opiaClaimReference?: string | null; statusDate?: Date | null },
    ipAddress?: string,
  ): Promise<ServiceResult<{ claim: MediationSessionVoucherClaim; readiness: { ready: boolean; missingFields: string[]; signedCountLabel: string; outstandingClientNames: string[] } }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Voucher claim status is only available to superadmins and subadmins", status: 403 };
    if (!(VOUCHER_CLAIM_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: "Invalid voucher claim status", status: 400 };
    const readiness = await this.getVoucherClaimReadiness(sessionId, actor);
    if (!readiness.ok) return readiness as any;
    if (!readiness.ready && input.status === "voucher_claim_submitted") {
      return { ok: false, error: "Voucher claim is missing required fields", status: 409 };
    }
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    const statusDate = input.statusDate ? new Date(input.statusDate) : new Date();
    const opiaClaimReference = input.opiaClaimReference?.trim() || readiness.claim?.opiaClaimReference || null;
    const [existing] = await db.select().from(mediationSessionVoucherClaims).where(eq(mediationSessionVoucherClaims.mediationSessionId, session.id)).limit(1);
    const patch: Record<string, unknown> = {
      status: input.status,
      opiaClaimReference,
      updatedAt: new Date(),
    };
    if (input.status === "voucher_claim_submitted") {
      Object.assign(patch, { submittedAt: statusDate, submittedBy: actor.id, nextChaseDueAt: new Date(statusDate.getTime() + 5 * 24 * 60 * 60 * 1000) });
    } else if (input.status === "claim_accepted") {
      Object.assign(patch, { acceptedAt: statusDate, acceptedBy: actor.id, nextChaseDueAt: new Date(statusDate.getTime() + 7 * 24 * 60 * 60 * 1000) });
    } else {
      Object.assign(patch, { paidAt: statusDate, paidBy: actor.id, nextChaseDueAt: null });
    }
    const [claim] = existing
      ? await db.update(mediationSessionVoucherClaims).set(patch).where(eq(mediationSessionVoucherClaims.id, existing.id)).returning()
      : await db.insert(mediationSessionVoucherClaims).values({
        caseId: session.caseId,
        mediationSessionId: session.id,
        appointmentId: session.appointmentId || null,
        ...patch,
      }).returning();
    await logAudit({
      userId: actor.id,
      action: "update_voucher_claim_status",
      entity: "session",
      entityId: sessionId,
      details: JSON.stringify({ status: input.status, opiaClaimReference }),
      ipAddress,
    });
    return {
      ok: true,
      claim,
      readiness: {
        ready: readiness.ready,
        missingFields: readiness.missingFields,
        signedCountLabel: readiness.signedCountLabel,
        outstandingClientNames: readiness.outstandingClientNames,
      },
    };
  }

  async createVoucherClaimAgeingTasks(now = new Date()): Promise<{ created: number }> {
    const dueClaims = await db.select().from(mediationSessionVoucherClaims).where(and(
      or(eq(mediationSessionVoucherClaims.status, "voucher_claim_submitted"), eq(mediationSessionVoucherClaims.status, "claim_accepted")),
      isNull(mediationSessionVoucherClaims.paidAt),
      lte(mediationSessionVoucherClaims.nextChaseDueAt, now),
    ));
    let created = 0;
    for (const claim of dueClaims) {
      const firstChase = !claim.lastChasedAt;
      await this.ensureAdminTask(
        claim.caseId,
        claim.appointmentId || null,
        "voucher_claim_ageing_chase",
        firstChase ? "Voucher claim 5-day chase" : "Voucher claim rolling 7-day chase",
        `Voucher claim ${claim.opiaClaimReference || claim.id} has been submitted but not yet paid.`,
        firstChase ? "red" : "amber",
      );
      await db.update(mediationSessionVoucherClaims).set({
        lastChasedAt: now,
        nextChaseDueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        updatedAt: now,
      }).where(eq(mediationSessionVoucherClaims.id, claim.id));
      created += 1;
    }
    return { created };
  }

  async previewVoucherRemittanceCsv(actor: ActorUser, input: { csv: string }): Promise<ServiceResult<{ rows: Array<{ caseReference?: string; mojReference?: string; matched: boolean }> }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Voucher remittance import is only available to superadmins and subadmins", status: 403 };
    const lines = input.csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rows = lines.slice(1).map((line) => {
      const columns = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
      const caseReference = columns[0] || undefined;
      const mojReference = columns[1] || undefined;
      return { caseReference, mojReference, matched: Boolean(caseReference || mojReference) };
    });
    return { ok: true, rows };
  }

  private async issueRequiredForms(session: MediationSession, appointment: Appointment, parties: Party[], actor: ActorUser, voucherFormRequired: boolean, c: Case): Promise<PartyRequiredForm[]> {
    const requiredTypes: PartyRequiredFormType[] = [];
    if (this.isFamilyMediationCase(c)) requiredTypes.push(AGREEMENT_FORM_TYPE);
    if (voucherFormRequired) requiredTypes.push(VOUCHER_SCHEME_CONSENT_FORM_TYPE, ...OPTIONAL_VOUCHER_FORM_TYPES);
    if (requiredTypes.length === 0) return [];
    const currentTemplates = new Map<PartyRequiredFormType, Awaited<ReturnType<typeof courtFormTemplateService.getCurrentCourtFormTemplate>>>();
    await Promise.all(requiredTypes.map(async (formType) => {
      const courtFormType = this.requiredFormCourtFormType(formType);
      if (!courtFormType) return;
      currentTemplates.set(formType, await this.templateForRequiredForm(formType));
    }));

    const forms: PartyRequiredForm[] = [];
    for (const party of parties) {
      for (const formType of requiredTypes) {
        const template = currentTemplates.get(formType);
        const form = await storage.upsertPartyRequiredForm({
          caseId: session.caseId,
          partyId: party.id,
          appointmentId: appointment.id,
          mediationSessionId: null,
          formType,
          status: "outstanding",
          deliveryStatus: "not_sent",
          deliveryLastAttemptedAt: null,
          deliveryError: null,
          issuedBy: actor.id,
          sentAt: new Date(),
          courtFormTemplateId: template?.id || null,
        });
        forms.push(form);
      }
    }

    const actionPath = `/cases/${session.caseId}?tab=mediation-sessions`;
    const actionUrl = `${getBaseUrl()}${actionPath}`;
    for (const party of parties) {
      const partyForms = forms.filter((form) => form.partyId === party.id);
      if (partyForms.length === 0) continue;
      const formNames = partyForms.map((form) => this.formLabel(form.formType));
      const title = partyForms.some((form) => form.formType === AGREEMENT_FORM_TYPE)
        ? "Sign Confidentiality + Agreement to Mediate"
        : "Sign required mediation forms";
      const client = await storage.getClient(party.clientId);
      const clientName = client ? `${client.firstName} ${client.lastName}`.trim() : `Client ${party.role}`;
      if (client?.userId) {
        await notificationService.createNotification({
          recipientId: client.userId,
          recipientRole: "client",
          type: "task",
          urgency: "amber",
          caseId: session.caseId,
          appointmentId: appointment.id,
          title,
          message: `Please sign ${formNames.join(", ")} for Mediation Session ${session.sessionNumber}. ${actionPath}`,
          status: "active",
          caseNoteRequired: false,
        });
        await Promise.all(partyForms.map((form) => this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "in_app_task_created",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: null,
        })));
      }
      if (!client?.email) {
        await Promise.all(partyForms.map((form) => this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "email_skipped",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: "Client has no email address",
        })));
        continue;
      }
      try {
        const { sendMediationSessionRequiredFormEmail } = await import("./email.service");
        await sendMediationSessionRequiredFormEmail(
          client.email,
          clientName,
          c.caseRef,
          session.sessionNumber,
          appointment.dateTime,
          formNames,
          actionUrl,
        );
        await Promise.all(partyForms.map((form) => this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "email_sent",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: null,
        })));
      } catch (error) {
        console.error("[MediationSession] required form email failed", error);
        await Promise.all(partyForms.map((form) => this.updateRequiredFormDelivery(form.id, {
          deliveryStatus: "email_failed",
          deliveryLastAttemptedAt: new Date(),
          deliveryError: this.deliveryErrorMessage(error),
        })));
      }
    }
    return forms;
  }

  private invoiceSatisfied(invoice: CaseInvoice): boolean {
    return invoice.status === "paid"
      || invoice.status === "void"
      || invoice.paymentStatus === "paid"
      || invoice.outstandingPence <= 0;
  }

  private async validateFormClientAccess(formId: string, actor: Pick<User, "id" | "role">): Promise<ServiceResult<{ form: PartyRequiredForm; party: Party }>> {
    const form = await storage.getPartyRequiredForm(formId);
    if (!form) return { ok: false, error: "Required form not found", status: 404 };
    if (isAdmin(actor)) {
      const party = await storage.getParty(form.partyId);
      if (!party) return { ok: false, error: "Party not found", status: 404 };
      return { ok: true, form, party };
    }
    if (actor.role !== "client") return { ok: false, error: "Only clients can sign required forms", status: 403 };
    const parties = await storage.listPartiesByUserId(actor.id);
    const party = parties.find((p) => p.id === form.partyId);
    if (!party) return { ok: false, error: "Access denied", status: 403 };
    return { ok: true, form, party };
  }

  private async validateFormUploadAccess(formId: string, actor: Pick<User, "id" | "role">): Promise<ServiceResult<{ form: PartyRequiredForm; party: Party }>> {
    const form = await storage.getPartyRequiredForm(formId);
    if (!form) return { ok: false, error: "Required form not found", status: 404 };
    const party = await storage.getParty(form.partyId);
    if (!party) return { ok: false, error: "Party not found", status: 404 };
    if (isAdmin(actor)) return { ok: true, form, party };
    if (actor.role === "mediator" && await this.canManageRequiredFormDelivery(form, actor)) return { ok: true, form, party };
    if (actor.role !== "client") return { ok: false, error: "Only clients, admins, the active lead mediator, and accepted co-mediators can upload signed required forms", status: 403 };
    const parties = await storage.listPartiesByUserId(actor.id);
    if (!parties.some((p) => p.id === form.partyId)) return { ok: false, error: "Access denied", status: 403 };
    return { ok: true, form, party };
  }

  private async canManageRequiredFormDelivery(form: PartyRequiredForm, actor: Pick<User, "id" | "role">): Promise<boolean> {
    if (isAdmin(actor)) return true;
    if (actor.role !== "mediator") return false;
    const sessionId = await this.getSessionIdForRequiredForm(form);
    if (!sessionId) return false;
    const session = await storage.getMediationSession(sessionId);
    return session ? this.hasLeadEquivalentAccess(session, actor) : false;
  }

  private async updateRequiredFormDelivery(
    formId: string,
    patch: { deliveryStatus: PartyRequiredFormDeliveryStatus; deliveryLastAttemptedAt: Date; deliveryError?: string | null },
  ): Promise<PartyRequiredForm | undefined> {
    return storage.updatePartyRequiredForm(formId, {
      deliveryStatus: patch.deliveryStatus,
      deliveryLastAttemptedAt: patch.deliveryLastAttemptedAt,
      deliveryError: patch.deliveryError || null,
    });
  }

  private deliveryErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "Unknown delivery error");
  }

  async createAppointmentAcknowledgementTask(appointment: Appointment, status: "held" | "confirmed" | "cancelled" | "expired"): Promise<void> {
    await this.ensureAdminTask(
      appointment.caseId,
      appointment.id,
      `mediation_session_${status}_acknowledgement`,
      `Acknowledge mediation session ${status}`,
      `Review and acknowledge the mediation session appointment marked ${status}.`,
      status === "expired" ? "red" : "amber",
    );
  }

  private async ensureAdminTask(caseId: string, appointmentId: string | null, type: string, title: string, message: string, urgency: string): Promise<void> {
    const conditions = [
      eq(notifications.caseId, caseId),
      eq(notifications.type, type),
      eq(notifications.status, "active"),
    ];
    if (appointmentId) conditions.push(eq(notifications.appointmentId, appointmentId));
    const [existing] = await db.select({ id: notifications.id }).from(notifications).where(and(...conditions)).limit(1);
    if (existing) return;
    await notificationService.createNotification({
      recipientId: null,
      recipientRole: "admin",
      type,
      urgency,
      caseId,
      appointmentId,
      title,
      message,
      status: "active",
      caseNoteRequired: true,
    });
  }

  private async completeOpenAdminTasks(caseId: string, type: string, actor: ActorUser, completionNotes: string): Promise<void> {
    await db
      .update(notifications)
      .set({
        status: "completed",
        completedBy: actor.id,
        completedAt: new Date(),
        completionNotes,
      })
      .where(and(
        eq(notifications.caseId, caseId),
        eq(notifications.type, type),
        sql`${notifications.status} <> 'completed'`,
      ));
  }

  private async createDocumentsReadyForReviewTask(document: CaseDocument, actor: ActorUser): Promise<void> {
    await this.ensureAdminTask(
      document.caseId,
      null,
      "documents_ready_for_review",
      "Documents ready for review",
      `${actor.name} marked "${document.title}" as ready for review.`,
      "amber",
    );
    const caseRecord = await storage.getCase(document.caseId);
    const allUsers = await storage.listUsers();
    const admins = allUsers.filter((user) => (user.role === "superadmin" || user.role === "subadmin") && user.status === "active");
    const reviewUrl = `${getBaseUrl()}/cases/${document.caseId}?tab=documents`;
    const { sendDocumentsReadyForReviewEmail } = await import("./email.service");
    for (const admin of admins) {
      const sent = await sendDocumentsReadyForReviewEmail(
        admin.email,
        admin.name,
        document.title || document.fileName || "Case document",
        caseRecord?.caseRef || document.caseId,
        reviewUrl,
      );
      if (sent) {
        caseActivityService.logEmailSent(document.caseId, admin.email, "Documents ready for review", admin.name, staffActor(actor)).catch(() => {});
      }
    }
  }

  private async notifySessionParticipantsOfRescheduleRequest(
    session: MediationSession,
    appointment: Appointment | null,
    actor: ActorUser,
    reason: string,
  ): Promise<void> {
    const message = `${actor.name} requested rescheduling for Mediation Session ${session.sessionNumber}. Admins will review alternatives and send a new confirmation link. Reason: ${reason}`;
    const parties = await storage.listPartiesByCase(session.caseId);
    for (const party of parties) {
      const client = await storage.getClient(party.clientId);
      if (!client?.userId) continue;
      await notificationService.createNotification({
        recipientId: client.userId,
        recipientRole: "client",
        type: "mediation_session_reschedule_requested",
        urgency: "amber",
        caseId: session.caseId,
        appointmentId: appointment?.id || null,
        title: `Mediation Session ${session.sessionNumber} reschedule requested`,
        message,
        status: "active",
        caseNoteRequired: false,
      });
    }

    const participants = await storage.listMediationSessionParticipants(session.id);
    for (const participant of participants) {
      await notificationService.createNotification({
        recipientId: participant.userId,
        recipientRole: "mediator",
        type: "mediation_session_reschedule_requested",
        urgency: "amber",
        caseId: session.caseId,
        appointmentId: appointment?.id || null,
        title: `Mediation Session ${session.sessionNumber} reschedule requested`,
        message,
        status: "active",
        caseNoteRequired: false,
      });
    }
  }

  private async notifyClients(parties: Party[], session: MediationSession, appointment: Appointment, title: string, message: string): Promise<void> {
    for (const party of parties) {
      const client = await storage.getClient(party.clientId);
      if (!client?.userId) continue;
      await notificationService.createNotification({
        recipientId: client.userId,
        recipientRole: "client",
        type: "mediation_session_booking",
        urgency: "green",
        caseId: session.caseId,
        appointmentId: appointment.id,
        title,
        message,
        status: "active",
        caseNoteRequired: false,
      });
    }
  }

  private async createProposalRecipientsAndLinks(
    session: MediationSession,
    proposal: MediationSessionProposal,
    actor: ActorUser,
    options: ProposalLinkOptions = {},
  ): Promise<Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }>> {
    const parties = await storage.listPartiesByCase(session.caseId);
    const recipients: Array<{ partyId?: string | null; userId?: string | null; recipientType: "client" | "mediator"; recipientName: string; recipientEmail?: string | null }> = [];
    for (const party of parties) {
      const client = await storage.getClient(party.clientId);
      recipients.push({
        partyId: party.id,
        userId: client?.userId || null,
        recipientType: "client",
        recipientName: partyName(party),
        recipientEmail: client?.email || null,
      });
    }
    if (session.leadMediatorId) {
      const mediator = await storage.getUser(session.leadMediatorId);
      if (mediator) {
        recipients.push({
          partyId: null,
          userId: mediator.id,
          recipientType: "mediator",
          recipientName: mediator.name,
          recipientEmail: mediator.email,
        });
      }
    }

    const links: Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }> = [];
    const leadMediatorAcceptedAt = new Date();
    for (const recipient of recipients) {
      const token = crypto.randomBytes(32).toString("hex");
      const created = await storage.createMediationSessionProposalRecipient({
        proposalId: proposal.id,
        caseId: proposal.caseId,
        mediationSessionId: proposal.mediationSessionId,
        partyId: recipient.partyId || null,
        userId: recipient.userId || null,
        recipientType: recipient.recipientType,
        recipientName: recipient.recipientName,
        recipientEmail: recipient.recipientEmail || null,
        tokenHash: hashProposalToken(token),
        responseStatus: recipient.recipientType === "mediator" ? "accepted" : "pending",
        sentAt: recipient.recipientType === "mediator" ? null : new Date(),
        respondedAt: recipient.recipientType === "mediator" ? leadMediatorAcceptedAt : null,
      });
      if (recipient.recipientType === "mediator") continue;
      const publicUrl = `${getBaseUrl()}/session-availability/${token}`;
      links.push({ recipientId: created.id, recipientName: created.recipientName, recipientType: created.recipientType, publicUrl });
      await this.notifyProposalRecipient(created, session, proposal, publicUrl, options);
    }

    links.push(...await this.createParticipantInviteLinks(session, proposal, {
      isReschedule: options.isReschedule,
      includeAllParticipants: options.includeAllParticipants,
    }));

    await logAudit({
      userId: actor.id,
      action: "send_mediation_session_proposal_links",
      entity: "session",
      entityId: session.id,
      entityRef: session.caseId,
      details: JSON.stringify({ proposalId: proposal.id, recipients: links.map((link) => ({ recipientId: link.recipientId, recipientType: link.recipientType })) }),
    });
    return links;
  }

  private async createParticipantInviteLinks(
    session: MediationSession,
    proposal: MediationSessionProposal,
    options: { allowInactiveProposal?: boolean; isReschedule?: boolean; includeAllParticipants?: boolean } = {},
  ): Promise<Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }>> {
    if (!options.allowInactiveProposal && proposal.status !== "held") return [];
    const participants = await storage.listMediationSessionParticipants(session.id);
    const existingRecipients = await storage.listMediationSessionProposalRecipientsByProposal(proposal.id);
    const alreadyLinkedParticipantIds = new Set(existingRecipients.map((recipient) => recipient.participantId).filter((id): id is string => !!id));
    const invitees = participants.filter((participant) =>
      (participant.role === "co_mediator" || participant.role === "observer")
      && (options.includeAllParticipants || participant.invitationStatus === "invited")
    );
    const links: Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }> = [];

    for (const participant of invitees) {
      if (alreadyLinkedParticipantIds.has(participant.id)) continue;
      const user = await storage.getUser(participant.userId);
      if (!user) continue;
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashProposalToken(token);
      await storage.updateMediationSessionParticipant(participant.id, {
        invitationStatus: "invited",
        invitationTokenHash: hashParticipantInvitationToken(token),
        invitationSentAt: new Date(),
      });
      const created = await storage.createMediationSessionProposalRecipient({
        proposalId: proposal.id,
        caseId: proposal.caseId,
        mediationSessionId: proposal.mediationSessionId,
        partyId: null,
        userId: user.id,
        participantId: participant.id,
        participantRole: participant.role,
        recipientType: "mediator_participant",
        recipientName: user.name,
        recipientEmail: user.email,
        tokenHash,
        responseStatus: "pending",
        sentAt: new Date(),
      });
      const publicUrl = `${getBaseUrl()}/session-availability/${token}`;
      links.push({ recipientId: created.id, recipientName: created.recipientName, recipientType: created.recipientType, publicUrl });
      await this.notifyParticipantInviteRecipient(created, session, proposal, publicUrl, { isReschedule: options.isReschedule });
    }

    return links;
  }

  private async syncSessionParticipantCalendarAttendee(
    session: MediationSession,
    recipient: MediationSessionProposalRecipient,
  ): Promise<void> {
    if (!session.appointmentId || !recipient.recipientEmail) return;
    if (recipient.participantRole !== "co_mediator" && recipient.participantRole !== "observer") return;
    const appointment = await storage.getAppointment(session.appointmentId);
    if (!appointment || !appointment.mediatorId || !appointment.googleBookingEventId || !["confirmed", "completed"].includes(appointment.status)) return;
    try {
      await googleCalendarService.syncMediatorBookingEventAttendees(appointment.mediatorId, appointment.googleBookingEventId, {
        add: [{
          email: recipient.recipientEmail,
          displayName: recipient.recipientName,
          optional: recipient.participantRole === "observer",
        }],
      });
    } catch (err) {
      await this.handleSessionParticipantCalendarSyncFailure(
        session,
        appointment.id,
        "add",
        recipient.recipientEmail,
        err,
      );
    }
  }

  private async syncRemovedSessionParticipantCalendarAttendee(
    session: MediationSession,
    participant: MediationSessionParticipant,
  ): Promise<void> {
    if (!session.appointmentId) return;
    const [appointment, user] = await Promise.all([
      storage.getAppointment(session.appointmentId),
      storage.getUser(participant.userId),
    ]);
    if (!appointment || !appointment.mediatorId || !user?.email || !appointment.googleBookingEventId || !["confirmed", "completed"].includes(appointment.status)) return;
    try {
      await googleCalendarService.syncMediatorBookingEventAttendees(appointment.mediatorId, appointment.googleBookingEventId, {
        removeEmails: [user.email],
      });
    } catch (err) {
      await this.handleSessionParticipantCalendarSyncFailure(
        session,
        appointment.id,
        "remove",
        user.email,
        err,
      );
    }
  }

  private async handleSessionParticipantCalendarSyncFailure(
    session: Pick<MediationSession, "caseId" | "id" | "sessionNumber">,
    appointmentId: string,
    action: "add" | "remove",
    email: string,
    err: unknown,
  ): Promise<void> {
    const error = (err as Error)?.message ?? String(err);
    await this.ensureAdminTask(
      session.caseId,
      appointmentId,
      "mediation_session_participant_calendar_sync_failed",
      `Mediation Session ${session.sessionNumber} calendar attendee sync failed`,
      `Could not ${action} ${email} on the mediator calendar invite for Mediation Session ${session.sessionNumber}: ${error}`,
      "amber",
    );
    await logAudit({
      action: "mediation_session_participant_calendar_sync_failed",
      entity: "session",
      entityId: session.id,
      entityRef: session.caseId,
      details: JSON.stringify({ appointmentId, action, email, error }),
    });
  }

  private async notifyProposalRecipient(
    recipient: MediationSessionProposalRecipient,
    session: MediationSession,
    proposal: MediationSessionProposal,
    publicUrl: string,
    options: ProposalLinkOptions = {},
  ): Promise<void> {
    const paidInvoice = recipient.recipientType === "client" && recipient.partyId
      ? (await financeService.listInvoicesByAppointment(proposal.appointmentId)).find((invoice) => invoice.billToPartyId === recipient.partyId && this.invoiceSatisfied(invoice))
      : undefined;
    await notificationService.createNotification({
      recipientId: recipient.userId || null,
      recipientRole: recipient.recipientType,
      type: "mediation_session_slot_proposed",
      urgency: "amber",
      caseId: proposal.caseId,
      appointmentId: proposal.appointmentId,
      title: options.isReschedule ? "Confirm rescheduled mediation session" : "Confirm mediation session availability",
      message: options.isReschedule
        ? `Mediation Session ${session.sessionNumber} is being rescheduled. Please confirm whether you can attend the new proposed time at ${proposal.proposedStartAt.toISOString()}. ${paidInvoice ? "Your previous payment is preserved and paid clients will not be charged again. " : ""}This link is only for ${recipient.recipientName}. ${publicUrl}`
        : `Please confirm whether you can attend Mediation Session ${session.sessionNumber} at ${proposal.proposedStartAt.toISOString()}. This link is only for ${recipient.recipientName}. ${publicUrl}`,
      status: "active",
      caseNoteRequired: false,
    });

    if (!recipient.recipientEmail) return;
    try {
      const { sendMediationSessionProposalEmail } = await import("./email.service");
      const caseRef = (await storage.getCase(proposal.caseId))?.caseRef || proposal.caseId;
      await sendMediationSessionProposalEmail(
        recipient.recipientEmail,
        recipient.recipientName,
        caseRef,
        session.sessionNumber,
        new Date(proposal.proposedStartAt),
        publicUrl,
        { isReschedule: options.isReschedule, alreadyPaid: Boolean(paidInvoice) },
      );
    } catch (err) {
      console.error("[MediationSession] proposal email failed", err);
    }
  }

  private async notifyParticipantInviteRecipient(
    recipient: MediationSessionProposalRecipient,
    session: MediationSession,
    proposal: MediationSessionProposal,
    publicUrl: string,
    options: ProposalLinkOptions = {},
  ): Promise<void> {
    const roleLabel = this.roleLabel(recipient.participantRole || "");
    await notificationService.createNotification({
      recipientId: recipient.userId || null,
      recipientRole: "mediator",
      type: "mediation_session_participant_invite",
      urgency: "amber",
      caseId: proposal.caseId,
      appointmentId: proposal.appointmentId,
      title: options.isReschedule ? "Confirm rescheduled mediation session invitation" : "Accept mediation session invitation",
      message: options.isReschedule
        ? `Mediation Session ${session.sessionNumber} is being rescheduled. Please accept or decline your ${roleLabel} invitation for the new proposed time. This link is only for ${recipient.recipientName}. ${publicUrl}`
        : `Please accept or decline your ${roleLabel} invitation for Mediation Session ${session.sessionNumber}. This link is only for ${recipient.recipientName}. ${publicUrl}`,
      status: "active",
      caseNoteRequired: false,
    });

    if (!recipient.recipientEmail) return;
    try {
      const { sendMediationSessionParticipantInviteEmail } = await import("./email.service");
      const caseRef = (await storage.getCase(proposal.caseId))?.caseRef || proposal.caseId;
      await sendMediationSessionParticipantInviteEmail(
        recipient.recipientEmail,
        recipient.recipientName,
        roleLabel,
        caseRef,
        session.sessionNumber,
        new Date(proposal.proposedStartAt),
        publicUrl,
        { isReschedule: options.isReschedule },
      );
    } catch (err) {
      console.error("[MediationSession] participant invite email failed", err);
    }
  }

  private isFamilyMediationCase(c: Case): boolean {
    const values = [c.mediationCategory, c.issueType, c.familySubType].map((value) => String(value || "").toLowerCase());
    return values.some((value) => value.includes("family") || value.includes("child") || value.includes("divorce") || value.includes("separation"));
  }

  private voucherEligibilityAllowedForCase(c: Case): boolean {
    return isVoucherClaimEligibleCase(c);
  }

  private async canSetVoucherClaimEligibility(c: Case, actor: ActorUser): Promise<boolean> {
    if (isAdmin(actor)) return true;
    if (actor.role !== "mediator") return false;
    if (c.mediatorId === actor.id) return true;
    const sessions = await storage.listMediationSessionsByCase(c.id);
    if (sessions.some((session) => session.leadMediatorId === actor.id)) return true;
    const parties = await storage.listPartiesByCase(c.id);
    return parties.some((party) => party.miamMediatorId === actor.id || party.allocatedMediatorId === actor.id);
  }

  private getVoucherClaimMissingFields(
    c: Case,
    appointment: Appointment | null,
    session: MediationSession,
    parties: Party[],
    demographicRows: Array<{ partyId: string; postcode?: string | null; legalAidEligible?: string | null; legalAidApplied?: string | null; mediationType?: string | null; familyCaseSubtype?: string | null; issuesForMediation?: unknown; relationshipToChild?: string | null; courtProceedingsStatus?: string | null; courtReference?: string | null; feePerSession?: string | null }>,
    clientRows: Array<{ id: string; postcode?: string | null }>,
  ): string[] {
    const missing = new Set<string>();
    const add = (label: string, present: boolean) => {
      if (!present) missing.add(label);
    };
    add("postcode", parties.every((party) => {
      const client = clientRows.find((row) => row.id === party.clientId);
      return Boolean(client?.postcode);
    }));
    add("legal aid status", demographicRows.length >= parties.length && demographicRows.every((row) => Boolean(row.legalAidEligible || row.legalAidApplied)));
    add("mediation type", Boolean(c.mediationCategory || demographicRows.some((row) => row.mediationType)));
    add("issue type", Boolean(c.issueType || c.familySubType || demographicRows.some((row) => row.familyCaseSubtype || row.issuesForMediation)));
    add("relationship to child", demographicRows.length >= parties.length && demographicRows.every((row) => Boolean(row.relationshipToChild)));
    add("session length", Boolean(appointment?.duration));
    add("session cost", Boolean((appointment?.paymentAmountPence || 0) > 0 || demographicRows.some((row) => row.feePerSession)));
    add("mediation outcome", Boolean(session.outcome));
    const courtReferenceRequired = demographicRows.some((row) => /yes|court|issued|in court/i.test(row.courtProceedingsStatus || ""));
    if (courtReferenceRequired) add("court reference", demographicRows.some((row) => Boolean(row.courtReference)));
    return Array.from(missing);
  }

  private formRequirementsForCase(
    c: Case,
    forms: PartyRequiredForm[],
    parties: Party[],
    proposal?: MediationSessionProposal,
  ): Array<{ formType: PartyRequiredFormType; label: string; applicable: boolean; issued: boolean; reason?: string }> {
    const family = this.isFamilyMediationCase(c);
    const partyIds = new Set(parties.map((party) => party.id));
    const hasAgreement = forms.some((form) => form.formType === AGREEMENT_FORM_TYPE && partyIds.has(form.partyId));
    const hasVoucherForms = forms.some((form) => this.isVoucherFormType(form.formType) && partyIds.has(form.partyId));
    const voucherEligible = Boolean(c.voucherClaimEligible) || hasVoucherForms;
    const rows: Array<{ formType: PartyRequiredFormType; label: string; applicable: boolean; issued: boolean; reason?: string }> = [
      {
        formType: AGREEMENT_FORM_TYPE,
        label: "Confidentiality + Agreement to Mediate",
        applicable: family,
        issued: hasAgreement,
        reason: family ? (hasAgreement ? undefined : "Will be issued when the held slot is created or by using Issue missing forms.") : "Required for family mediation bookings only.",
      },
      {
        formType: VOUCHER_SCHEME_CONSENT_FORM_TYPE,
        label: "Family Mediation Voucher Scheme client consent",
        applicable: voucherEligible,
        issued: forms.some((form) => form.formType === VOUCHER_SCHEME_CONSENT_FORM_TYPE && partyIds.has(form.partyId)),
        reason: voucherEligible ? undefined : "Voucher consent is issued after an approved MIAM voucher decision.",
      },
    ];
    for (const formType of OPTIONAL_VOUCHER_FORM_TYPES) {
      rows.push({
        formType,
        label: this.formLabel(formType),
        applicable: voucherEligible,
        issued: forms.some((form) => form.formType === formType && partyIds.has(form.partyId)),
        reason: voucherEligible ? "Optional opt-in; does not block booking confirmation or voucher claim submission." : "Voucher opt-ins are issued after an approved MIAM voucher decision.",
      });
    }
    return rows;
  }

  private formLabel(formType: string): string {
    if (formType === AGREEMENT_FORM_TYPE) return "Confidentiality and Agreement to Mediate";
    if (formType === VOUCHER_SCHEME_CONSENT_FORM_TYPE) return "Family Mediation Voucher Scheme client consent";
    if (formType === VOUCHER_DIVERSITY_OPT_IN_FORM_TYPE) return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
    if (formType === VOUCHER_RESEARCH_OPT_IN_FORM_TYPE) return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
    if ((PARTY_REQUIRED_FORM_TYPES as readonly string[]).includes(formType)) return "required mediation form";
    return "required form";
  }

  private courtFormLabel(formType: CourtFormType): string {
    if (formType === "FM1") return "FM1";
    if (formType === "C100") return "C100";
    if (formType === "FormA") return "Form A";
    if (formType === "FormE") return "Form E";
    if (formType === "AgreementToMediate") return "Agreement to Mediate";
    if (formType === "VoucherSchemeClientConsent") return "Family Mediation Voucher Scheme client consent";
    if (formType === "VoucherMojResearchContactOptIn") return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
    if (formType === "VoucherDiversityQuestionnaireOptIn") return "Legacy Diversity questionnaire opt-in";
    if (formType === "DraftFinancialSchedule") return "DRAFT FINANCIAL SCHEDULE";
    if (formType === "FinancialDisclosureBooklet") return "Financial Disclosure Booklet";
    return formType;
  }

  private preferredCaseDocument(current: CaseDocument | null, candidate: CaseDocument): CaseDocument {
    if (!current) return candidate;
    const rank = (document: CaseDocument) => document.reviewStatus === "reviewed" ? 3 : document.reviewStatus === "ready_for_review" ? 2 : 1;
    const candidateRank = rank(candidate);
    const currentRank = rank(current);
    if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;
    const candidateTime = new Date(candidate.reviewedAt || candidate.readyForReviewAt || candidate.createdAt || candidate.updatedAt).getTime();
    const currentTime = new Date(current.reviewedAt || current.readyForReviewAt || current.createdAt || current.updatedAt).getTime();
    return candidateTime > currentTime ? candidate : current;
  }

  private bestDocumentForRequiredForm(form: PartyRequiredForm, documents: CaseDocument[]): CaseDocument | null {
    const linkedIds = new Set([form.uploadedDocumentId, form.generatedDocumentId].filter(Boolean));
    const label = this.formLabel(form.formType);
    let best: CaseDocument | null = null;
    for (const document of documents) {
      const linked = linkedIds.has(document.id);
      const partySnapshot = document.partyId === form.partyId
        && document.documentCategory === SIGNED_FORM_DOCUMENT_CATEGORY
        && (document.fileName.includes(form.formType) || document.title.startsWith(label));
      if (!linked && !partySnapshot) continue;
      best = this.preferredCaseDocument(best, document);
    }
    return best;
  }

  private bestDocumentForCourtForm(formType: CourtFormType, partyId: string | null, documents: CaseDocument[]): CaseDocument | null {
    const category = COURT_FORM_UPLOAD_DOCUMENT_CATEGORIES[formType];
    if (!category) return null;
    let best: CaseDocument | null = null;
    for (const document of documents) {
      if (document.documentCategory !== category) continue;
      if (partyId && document.partyId !== partyId) continue;
      best = this.preferredCaseDocument(best, document);
    }
    return best;
  }

  private isDocumentBlankFormRelevant(forms: DocumentBlankFormView[], templateId: string): boolean {
    return forms.some((form) => form.templateId === templateId);
  }

  private requiredFormCourtFormType(formType: string): CourtFormType | null {
    if (formType === AGREEMENT_FORM_TYPE) return "AgreementToMediate";
    if (formType === VOUCHER_SCHEME_CONSENT_FORM_TYPE) return "VoucherSchemeClientConsent";
    if (formType === VOUCHER_DIVERSITY_OPT_IN_FORM_TYPE) return "VoucherDiversityQuestionnaireOptIn";
    if (formType === VOUCHER_RESEARCH_OPT_IN_FORM_TYPE) return "VoucherMojResearchContactOptIn";
    return null;
  }

  private async templateForRequiredForm(formType: PartyRequiredFormType) {
    const courtFormType = this.requiredFormCourtFormType(formType);
    return courtFormType ? await courtFormTemplateService.getCurrentCourtFormTemplate(courtFormType) : undefined;
  }

  private defaultAttestationText(formType: string): string {
    if (formType === VOUCHER_DIVERSITY_OPT_IN_FORM_TYPE || formType === VOUCHER_RESEARCH_OPT_IN_FORM_TYPE) {
      return "I confirm that I have read and agree to the Family Mediation Voucher Scheme: Privacy Policy and Client Consent.";
    }
    return `I confirm that I have read and agree to the ${this.formLabel(formType)}.`;
  }

  private isVoucherFormType(formType: string): boolean {
    return formType === VOUCHER_SCHEME_CONSENT_FORM_TYPE || OPTIONAL_VOUCHER_FORM_TYPES.includes(formType as PartyRequiredFormType);
  }

  private async isRequiredFormAccepted(form: PartyRequiredForm): Promise<boolean> {
    if (form.status !== "signed") return false;
    const documentId = form.generatedDocumentId || form.uploadedDocumentId;
    if (!documentId) return !this.isVoucherFormType(form.formType);
    const document = await storage.getCaseDocument(documentId);
    return document?.reviewStatus === "reviewed";
  }

  private async getMissingOrUnacceptedRequiredForms(
    parties: Party[],
    forms: PartyRequiredForm[],
    requiredFormTypes: PartyRequiredFormType[],
  ): Promise<Array<{ partyId: string; formType: PartyRequiredFormType }>> {
    const missing: Array<{ partyId: string; formType: PartyRequiredFormType }> = [];
    for (const party of parties) {
      for (const formType of requiredFormTypes) {
        const form = forms.find((candidate) => candidate.partyId === party.id && candidate.formType === formType);
        if (!form || !(await this.isRequiredFormAccepted(form))) {
          missing.push({ partyId: party.id, formType });
        }
      }
    }
    return missing;
  }

  private async listRequiredFormsForSessionGate(session: MediationSession): Promise<PartyRequiredForm[]> {
    const forms = await storage.listPartyRequiredFormsByCase(session.caseId);
    return forms.filter((form) => !form.mediationSessionId || form.mediationSessionId === session.id);
  }

  private normalizeParticipantIds(leadMediatorId: string, coMediatorIds: string[] = [], observerIds: string[] = []) {
    const clean = (ids: string[]) => Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))).filter((id) => id !== leadMediatorId);
    const co = clean(coMediatorIds);
    const observer = clean(observerIds).filter((id) => !co.includes(id));
    return { coMediatorIds: co, observerIds: observer };
  }

  private async mediatorApprovedForMediationSessions(userId: string): Promise<boolean> {
    return (await this.mediationSessionsApprovalState(userId)) === "approved";
  }

  private async mediationSessionsApprovalState(userId: string): Promise<"approved" | "expired" | "unapproved"> {
    const serviceType = (await storage.listServiceTypes()).find((service) => service.name === "Mediation Sessions" && service.isActive);
    if (!serviceType) return "unapproved";
    const rows = await db
      .select({
        status: mediatorServiceApprovals.status,
        expiryDate: mediatorServiceApprovals.expiryDate,
        expiredAt: mediatorServiceApprovals.expiredAt,
      })
      .from(mediatorServiceApprovals)
      .where(and(
        eq(mediatorServiceApprovals.mediatorId, userId),
        eq(mediatorServiceApprovals.serviceTypeId, serviceType.id),
      ));
    if (rows.some((row) => !row.expiredAt && getEffectiveApprovalStatus(row) === "approved")) return "approved";
    if (rows.some((row) => !!row.expiredAt || getEffectiveApprovalStatus(row) === "expired")) return "expired";
    return "unapproved";
  }

  private async validateParticipants(input: { coMediatorIds: string[]; observerIds: string[] }): Promise<ServiceResult<{}>> {
    for (const id of input.coMediatorIds) {
      const participant = await this.validateMediatorAssignment(id, "co_mediator", "Co-mediator");
      if (!participant.ok) return participant;
    }
    for (const id of input.observerIds) {
      const participant = await this.validateMediatorAssignment(id, "observer", "Observer");
      if (!participant.ok) return participant;
    }
    return { ok: true };
  }

  private async enrichSessions(sessions: MediationSession[]): Promise<MediationSessionView[]> {
    const participants = await storage.listMediationSessionParticipantsBySessionIds(sessions.map((s) => s.id));
    const sessionIds = sessions.map((s) => s.id);
    const appointmentIds = sessions.map((s) => s.appointmentId).filter((id): id is string => !!id);
    const caseIds = Array.from(new Set(sessions.map((s) => s.caseId)));
    const [appointments, formsByCase, availabilityWindows, partyAttendance, sessionNotes, caseDocuments, proposals, proposalRecipients, invoices, acknowledgementRows, caseRows, partyRows, draftFinancialSchedules] = await Promise.all([
      Promise.all(appointmentIds.map((id) => storage.getAppointment(id))),
      Promise.all(caseIds.map((id) => storage.listPartyRequiredFormsByCase(id))),
      storage.listMediationSessionAvailabilityWindowsBySessions(sessionIds),
      storage.listMediationSessionPartyAttendanceBySessionIds(sessionIds),
      storage.listMediationSessionNotesBySessionIds(sessionIds),
      storage.listCaseDocumentsBySessionIds(sessionIds),
      storage.listMediationSessionProposalsBySessions(sessionIds),
      storage.listMediationSessionProposalRecipientsBySessions(sessionIds),
      appointmentIds.length
        ? db.select().from(caseInvoices).where(inArray(caseInvoices.appointmentId, appointmentIds))
        : Promise.resolve([]),
      caseIds.length
        ? db.select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          message: notifications.message,
          status: notifications.status,
          urgency: notifications.urgency,
          caseId: notifications.caseId,
          appointmentId: notifications.appointmentId,
          createdAt: notifications.createdAt,
        }).from(notifications).where(and(
          inArray(notifications.type, [
            "mediation_session_held_acknowledgement",
            "mediation_session_confirmed_acknowledgement",
            "mediation_session_cancelled_acknowledgement",
            "mediation_session_expired_acknowledgement",
            "mediation_session_reschedule_requested",
            "mediation_session_next_session_requested",
          ]),
          or(
            appointmentIds.length ? inArray(notifications.appointmentId, appointmentIds) : sql`false`,
            and(
              eq(notifications.type, "mediation_session_next_session_requested"),
              inArray(notifications.caseId, caseIds),
              isNull(notifications.appointmentId),
            ),
          ),
        ))
        : Promise.resolve([]),
      Promise.all(caseIds.map((id) => storage.getCase(id))),
      Promise.all(caseIds.map((id) => storage.listPartiesByCase(id))).then((groups) => groups.flat()),
      Promise.all(sessionIds.map((id) => storage.getMediationSessionDraftFinancialSchedule(id))),
    ]);
    const appointmentMap = new Map(appointments.filter((a): a is Appointment => !!a).map((a) => [a.id, a]));
    const forms = formsByCase.flat();
    const caseMap = new Map(caseRows.filter((row): row is Case => !!row).map((row) => [row.id, row]));
    const draftScheduleMap = new Map(
      draftFinancialSchedules
        .filter((schedule): schedule is CaseDraftFinancialSchedule => !!schedule)
        .map((schedule) => [schedule.mediationSessionId, {
          id: schedule.id,
          status: schedule.status,
          confirmedAt: schedule.confirmedAt,
          confirmedBy: schedule.confirmedBy,
          confirmedInSessionId: schedule.confirmedInSessionId,
          updatedAt: schedule.updatedAt,
        } satisfies DraftFinancialScheduleReviewSummary]),
    );
    const userIds = Array.from(new Set([
      ...sessions.map((s) => s.leadMediatorId).filter((id): id is string => !!id),
      ...participants.map((p) => p.userId),
      ...sessionNotes.map((note) => note.createdBy),
    ]));
    const users = await Promise.all(userIds.map((id) => storage.getUser(id)));
    const userMap = new Map(users.filter((u): u is User => !!u).map((u) => [u.id, u]));

    return sessions.map((session) => {
      const notesForSession = sessionNotes.filter((note) => note.mediationSessionId === session.id);
      const latestNote = notesForSession[0] || null;
      const appointment = session.appointmentId ? appointmentMap.get(session.appointmentId) || null : null;
      const proposal = proposals.find((row) => row.mediationSessionId === session.id) || null;
      const sessionForms = forms.filter((form) => form.caseId === session.caseId && (!form.mediationSessionId || form.mediationSessionId === session.id));
      const caseParties = partyRows.filter((party) => party.caseId === session.caseId);
      const formRequirements = this.formRequirementsForCase(
        caseMap.get(session.caseId) || ({ mediationCategory: null, issueType: null, familySubType: null } as Case),
        sessionForms,
        caseParties,
        proposal || undefined,
      );
      const requiredBlockingFormTypes = formRequirements
        .filter((requirement) => requirement.applicable && BLOCKING_FORM_TYPES.includes(requirement.formType))
        .map((requirement) => requirement.formType);
      const blockingFormsPending = requiredBlockingFormTypes.some((formType) =>
        caseParties.some((party) => !sessionForms.some((form) =>
          form.partyId === party.id && form.formType === formType && form.status === "signed"
        )),
      );
      const proposalResponsesPending = Boolean(proposal && proposalRecipients.some((recipient) =>
        recipient.proposalId === proposal.id
        && recipient.recipientType !== "mediator_participant"
        && recipient.responseStatus !== "accepted"
      ));
      const appointmentWithJoinAvailability = appointment ? {
        ...appointment,
        joinAvailability: buildSessionJoinAvailability({
          appointment,
          sessionStatus: session.status,
          blockingFormsPending,
          proposalResponsesPending,
        }),
      } : null;
      const view: MediationSessionView = {
        ...session,
        leadMediatorName: session.leadMediatorId ? userMap.get(session.leadMediatorId)?.name || null : null,
        participants: participants
          .filter((p) => p.sessionId === session.id)
          .map((p) => {
            const user = userMap.get(p.userId);
            return {
              ...p,
              userName: user?.name || "Unknown mediator",
              userEmail: user?.email || "",
            };
          }),
        appointment: appointmentWithJoinAvailability,
        proposal: (() => {
          if (!proposal) return null;
          return {
            ...proposal,
            recipients: proposalRecipients.filter((recipient) => recipient.proposalId === proposal.id),
          };
        })(),
        formRequirements,
        requiredForms: sessionForms,
        availabilityWindows: availabilityWindows.filter((window) => window.mediationSessionId === session.id),
        partyAttendance: partyAttendance.filter((row) => row.mediationSessionId === session.id),
        invoices: session.appointmentId ? invoices.filter((invoice) => invoice.appointmentId === session.appointmentId) : [],
        acknowledgementTasks: session.appointmentId
          ? acknowledgementRows
            .filter((task) => task.appointmentId === session.appointmentId || (
              task.type === "mediation_session_next_session_requested"
              && task.caseId === session.caseId
              && !task.appointmentId
              && availabilityWindows.some((window) => window.mediationSessionId === session.id && window.source === "next_session_request")
            ))
            .map(({ appointmentId, caseId, ...task }) => task)
          : acknowledgementRows
            .filter((task) => (
              task.type === "mediation_session_next_session_requested"
              && task.caseId === session.caseId
              && !task.appointmentId
              && availabilityWindows.some((window) => window.mediationSessionId === session.id && window.source === "next_session_request")
            ))
            .map(({ appointmentId, caseId, ...task }) => task),
        noteSummary: {
          count: notesForSession.length,
          latestNoteAt: latestNote?.createdAt || null,
          latestNoteAuthor: latestNote ? userMap.get(latestNote.createdBy)?.name || "Unknown" : null,
        },
        documents: caseDocuments
          .filter((document) => document.mediationSessionId === session.id)
          .map(withProtectedCaseDocumentUrl),
        draftFinancialSchedule: draftScheduleMap.get(session.id) || null,
      };
      return { ...view, indicator: this.deriveSessionIndicator(view) };
    });
  }

  private async logSessionActivity(caseId: string, type: string, title: string, description: string, sessionId: string, actor: ActorUser): Promise<void> {
    await caseActivityService.log({
      caseId,
      type,
      title,
      description,
      relatedEntityId: sessionId,
      relatedEntityType: "session",
      actor: staffActor(actor),
    });
  }

  private async logProposalResponseActivity(
    session: MediationSession,
    recipient: MediationSessionProposalRecipient,
    response: "accepted" | "declined",
    alternativeCount: number,
  ): Promise<void> {
    const actorType = recipient.recipientType === "mediator" ? "mediator" : "client";
    await caseActivityService.log({
      caseId: session.caseId,
      type: response === "accepted" ? "mediation_session_slot_accepted" : "mediation_session_slot_declined",
      title: `Session ${session.sessionNumber} slot ${response}`,
      description: response === "accepted"
        ? `${recipient.recipientName} accepted the proposed Session ${session.sessionNumber} slot.`
        : `${recipient.recipientName} declined the proposed Session ${session.sessionNumber} slot and submitted ${alternativeCount} alternative slot${alternativeCount === 1 ? "" : "s"}.`,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({ proposalRecipientId: recipient.id, recipientType: recipient.recipientType, response, alternativeCount }),
      actor: {
        id: recipient.userId || recipient.partyId || null,
        name: recipient.recipientName,
        type: actorType,
        channel: "session-availability-link",
      },
    });
  }

  private async logParticipantInvitationResponseActivity(
    session: MediationSession,
    recipient: MediationSessionProposalRecipient,
    response: "accepted" | "declined",
  ): Promise<void> {
    await caseActivityService.log({
      caseId: session.caseId,
      type: response === "accepted" ? "mediation_session_participant_invitation_accepted" : "mediation_session_participant_invitation_declined",
      title: `Session ${session.sessionNumber} participant invitation ${response}`,
      description: `${recipient.recipientName} ${response} the ${this.roleLabel(recipient.participantRole || "")} invitation for Session ${session.sessionNumber}.`,
      relatedEntityId: session.id,
      relatedEntityType: "session",
      metadata: JSON.stringify({ proposalRecipientId: recipient.id, participantId: recipient.participantId, response }),
      actor: {
        id: recipient.userId || null,
        name: recipient.recipientName,
        type: "mediator",
        channel: "session-availability-link",
      },
    });
  }

  private async notifyParticipants(caseRef: string, caseId: string, sessionNumber: number, participants: Array<{ userId: string; role: string }>, actorName: string): Promise<void> {
    const seen = new Set<string>();
    for (const participant of participants) {
      if (!isParticipantRole(participant.role) || seen.has(`${participant.userId}:${participant.role}`)) continue;
      if (participant.role === "co_mediator" || participant.role === "observer") continue;
      seen.add(`${participant.userId}:${participant.role}`);
      const roleLabel = this.roleLabel(participant.role);
      await notificationService.createNotification({
        recipientId: participant.userId,
        recipientRole: "mediator",
        type: "task_assigned",
        urgency: "green",
        caseId,
        title: `Mediation Session ${sessionNumber} assigned — ${caseRef}`,
        message: `${actorName} added you as ${roleLabel} for Mediation Session ${sessionNumber} on case ${caseRef}.`,
        caseNoteRequired: false,
      });
    }
  }

  private roleLabel(role: string): string {
    return role === "lead_mediator" ? "lead mediator" : role === "co_mediator" ? "co-mediator" : "observer";
  }
}

export const mediationSessionService = new MediationSessionService();
