import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, refreshClientDashboardActions } from "@/lib/queryClient";
import { AppointmentJoinFallbackDialog } from "@/components/appointments/appointment-join-fallback-dialog";
import { useAuditedAppointmentJoin } from "@/hooks/use-audited-appointment-join";
import { Link, useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import MiamRecordTab from "@/components/miam-record-tab";
import {
  ArrowLeft, Shield, ShieldAlert, Phone, Mail, MapPin, UserCog, Shuffle, User,
  Send, Copy, Check, RefreshCw, Link2, Plus, Trash2, X, Pencil, Save,
  CheckCircle2, Circle, Clock, Briefcase, Users as UsersIcon, CalendarDays, FileText,
  Calendar, FolderOpen, CreditCard, MessageSquare, StickyNote, ExternalLink, Video, List,
  Search, Loader2, MoreHorizontal, Archive, ArchiveRestore, Info, Receipt, Wallet, Upload,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaseComplaintsPanel } from "@/components/complaints/case-complaints-panel";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { ConfidentialBadge } from "@/components/shared/confidential-badge";
import {
  CASE_CLOSURE_REASONS, CASE_STAGES, CONFIDENTIAL_NOTE_CATEGORIES,
  GENDERS, ETHNIC_GROUPS, DISABILITY_OPTIONS, EMPLOYMENT_STATUSES,
  COURT_PROCEEDINGS_STATUSES, COMMON_LANGUAGES, COUNTRIES_OF_BIRTH,
  INTERPRETER_SUPPORT_OPTIONS, LEGAL_AID_OPTIONS, VOUCHER_SCHEME_OPTIONS,
  CAFCASS_OPTIONS, SOLICITOR_OPTIONS, FAMILY_CASE_SUBTYPES, WORKPLACE_CASE_SUBTYPES,
  MEDIATION_CATEGORIES, CIVIL_CASE_SUBTYPES, COMMERCIAL_CASE_SUBTYPES, OTHER_CASE_SUBTYPES,
  EMOTIONAL_WELLBEING_LABELS, APPOINTMENT_PAYMENT_STATUSES, CASE_INVOICE_STATUSES, CASE_PAYMENT_METHODS, CASE_PAYMENT_STATUSES,
  FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES, FINANCIAL_DISCLOSURE_ITEM_STATUSES,
} from "@shared/schema";
import {
  FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA,
  buildCombinedDisclosureBookletView,
  calculateDisclosureBookletTotals,
  ensureFieldBasedBookletPayload,
  type DisclosureBookletPayload,
  type DisclosureBookletSection,
} from "@shared/financial-disclosure-booklet-schema";
import {
  buildDefaultDraftFinancialSchedulePayload,
  normalizeDraftFinancialSchedulePayload,
  type DraftFinancialSchedulePayload,
  type DraftScheduleAssetMoneyRow,
  type DraftScheduleAssetRepeatableRow,
  type DraftScheduleClientRow,
  type DraftScheduleRepeatableRow,
} from "@shared/draft-financial-schedule-schema";
import { PDF_FIELD_OVERRIDES_KEY } from "@shared/court-form-pdf-overrides";
import { Checkbox } from "@/components/ui/checkbox";
import { WeeklyCalendar as SharedWeeklyCalendar, APPT_STATUS_STYLES, type AppointmentData } from "@/components/shared/weekly-calendar";
import type { Case, Party, ConfidentialNote } from "@shared/schema";
import { usePermissions } from "@/hooks/use-permissions";
import { getCaseDetailCapabilities, shouldRedirectFromNotesTab } from "@/lib/case-detail-access";
import { formatUkWallClockDateTime } from "@/lib/date-time";
import { appointmentWallClockDate } from "@shared/booking-time";
import { ActivityTimeline } from "@/components/case-activity-timeline";
import { AddPartyCard } from "@/components/add-party-card";
import { RepresentativesSection, MediatorRepVisibilityToggle } from "@/components/representatives-section";
import { CourtFormsStatusCard } from "@/components/case-progress/court-forms-status-card";
import { DocumentsCourtFormsSection } from "@/components/case-progress/documents-court-forms-section";
import { CaseDocumentRequestsSection } from "@/components/case-progress/case-document-requests-section";
import { CourtFormPdfEditorDialog, type CourtFormFieldMetadata } from "@/components/case-progress/court-form-pdf-editor-dialog";
import { deriveMiamCellStateForParty, MIAM_MILESTONES, type AppointmentLike, type CellState, type MiamMilestone } from "@/components/case-progress/derivation";
import { IntakeWorkflowCard } from "@/components/enquiry-intake-workflow-card";
import { CaseEmailComposer } from "@/components/cases/case-email-composer";
import { CaseWhatsappPanel } from "@/components/cases/case-whatsapp-panel";
import { PrivateCaseNotesPanel } from "@/components/cases/private-case-notes-panel";
import {
  ClientProposalRecipientStatusList,
  type ClientProposalRecipientView,
} from "@/components/mediation-session/client-proposal-recipient-status";

type ConfidentialNoteWithAuthor = ConfidentialNote & { createdByName: string };

function fileToDataUrl(file: File): Promise<{ fileName: string; fileData: string; fileMimeType: string; fileSizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      fileData: String(reader.result ?? ""),
      fileMimeType: file.type || "application/octet-stream",
      fileSizeBytes: file.size,
    });
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

type PartyWithMediators = Party & {
  miamMediatorName?: string;
  allocatedMediatorName?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  userId?: string | null;
};

type StaffProposalRecipientView = ClientProposalRecipientView & {
  userId?: string | null;
  recipientType: string;
  recipientName: string;
  recipientEmail?: string | null;
  participantRole?: string | null;
  sentAt?: string | Date | null;
  viewedAt?: string | Date | null;
  declineNotes?: string | null;
};

type ProposalRecipientView = ClientProposalRecipientView | StaffProposalRecipientView;

function isStaffProposalRecipient(recipient: ProposalRecipientView): recipient is StaffProposalRecipientView {
  return "recipientType" in recipient && typeof recipient.recipientType === "string";
}

type CaseWhatsappRecipient = {
  partyId: string;
  clientId: string;
  name: string;
  role: string;
  phone: string;
  optInStatus: string;
  noWhatsappOrVoicemail: boolean;
  conversationId: string | null;
  conversationStatus: string;
  automationState: string | null;
  customerServiceWindowExpiresAt: string | null;
};

type CaseWhatsappTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  parameterDefinitions: Array<{ key?: string; component?: string }>;
};

type CaseWhatsappTemplatePreview = {
  parameters: Record<string, string>;
  bookingLink?: string;
  responseLink?: string;
  templateName?: string;
};

const ACTIVE_BOOKING_STATUSES = new Set(["confirmed", "hold", "held"]);
const ACTIVE_MIAM_BOOKING_HOLD_STATUSES = new Set(["hold", "held"]);
const ACTIVE_MIAM_BOOKING_SERVICE_NAMES = new Set(["MIAM", "Evening/weekend MIAM", "Urgent (Same Day) MIAM"]);

type MiamBookingAppointmentLike = {
  status: string;
  serviceName?: string | null;
  dateTime?: string | Date | null;
};

function isActiveMiamBookingBlocker(appt: MiamBookingAppointmentLike, now = Date.now()): boolean {
  if (!ACTIVE_MIAM_BOOKING_SERVICE_NAMES.has(appt.serviceName || "")) return false;
  if (ACTIVE_MIAM_BOOKING_HOLD_STATUSES.has(appt.status)) return true;
  if (appt.status !== "confirmed" || !appt.dateTime) return false;
  const appointmentTime = new Date(appt.dateTime).getTime();
  return Number.isFinite(appointmentTime) && appointmentTime >= now;
}

function isPastAppointment(appt: Pick<MiamBookingAppointmentLike, "dateTime">, now = Date.now()): boolean {
  if (!appt.dateTime) return false;
  const appointmentTime = new Date(appt.dateTime).getTime();
  return Number.isFinite(appointmentTime) && appointmentTime < now;
}

type CaseDetail = Case & {
  legacySourceSystem?: string | null;
  legacyCaseNumber?: string | null;
  partyA?: PartyWithMediators;
  partyB?: PartyWithMediators;
  parties?: PartyWithMediators[];
  mediatorName: string;
  userPartyRole?: string;
  nextRoleLetter?: string | null;
  mediatorCanSeeReps?: boolean | null;
  claimedByName?: string | null;
  voucherClaimEligibleSetByName?: string | null;
  sourceEnquiry?: {
    id: string;
    enquiryRef: string | null;
    contactMethod: string | null;
    addressLine1: string | null;
    postcode: string | null;
    dateReceived: string | Date | null;
    status: string | null;
    consentFollowUp?: boolean | null;
    consentFollowUpDate?: string | Date | null;
  } | null;
  partyFollowUpConsents?: Array<{
    partyId: string;
    clientId: string;
    role: string;
    clientName: string;
    consentStatus: "granted" | "declined" | "excluded" | "pending" | "not_captured";
    source: "enquiry_carry_forward" | "closure_admin" | "legacy_case" | "system_exclusion" | "email_request" | "public_link" | null;
    exclusionReason: string | null;
    followUpTasksScheduled: number;
    consentRecordedAt: string | Date | null;
    followUpConsentRequestSentAt?: string | Date | null;
    followUpConsentEmailStatus?: string | null;
  }>;
  miamValidity?: {
    valid: boolean;
    sourceDate: string | null;
    expiresAt: string | null;
    miamCompletedDate: string | null;
    latestMediationSessionDate: string | null;
    renewalBookingAvailable: boolean;
    parties: Array<{
      partyId: string;
      role: string;
      partyName: string;
      miamRecordId: string | null;
      valid: boolean;
      expired: boolean;
      sourceDate: string | null;
      expiresAt: string | null;
      miamCompletedDate: string | null;
      latestMediationSessionDate: string | null;
      renewalBookingAvailable: boolean;
    }>;
  } | null;
  cimReadiness?: CimEligibilityPayload | null;
  closureRecord?: {
    followUpConsentStatus: string | null;
    outreachExcluded: boolean | null;
    lifeSatisfaction: number | null;
    anxietyScore: number | null;
    serviceRating: number | null;
    netPromoterScore: number | null;
    closedAt: string | Date | null;
    closedByName?: string | null;
  } | null;
  isSessionObserverOnly?: boolean;
  isSessionCoMediator?: boolean;
  sessionAccess?: "none" | "observer" | "co_mediator" | "full";
  privateNotesAccess?: "author_only" | "review_all" | null;
  miamSummaries?: SessionParticipantMiamSummary[];
};

type SessionParticipantMiamSummary = {
  partyId: string;
  role: string;
  partyName: string;
  recordStatus: "recorded" | "not_started";
  approvalStatus: string;
  suitableForMediation: string | null;
  completedAt: string | Date | null;
  valid: boolean;
  expired: boolean;
  expiresAt: string | Date | null;
};

type CimConsentRow = {
  id: string;
  caseId: string;
  partyId: string;
  formType: "cf10" | "cf12";
  status: "pending" | "granted" | "refused";
  recordedBy?: string | null;
  recordedAt?: string | Date | null;
  notes?: string | null;
};

type CimReadinessBlocker = {
  reason: string;
  label: string;
  partyId?: string;
  role?: string;
  formType?: "cf10" | "cf12";
};

type CimEligibilityPayload = {
  ready: boolean;
  blockers: CimReadinessBlocker[];
  consents: CimConsentRow[];
  cimEligible: boolean;
};

type MediatorOption = {
  id: string;
  name: string;
  email?: string;
  status?: string | null;
  mediationRoleQualification?: "lead" | "co_mediator" | "observer" | "unclassified";
};

type MediationRoleOptions = {
  leadMediators: MediatorOption[];
  coMediators: MediatorOption[];
  observers: MediatorOption[];
};

type CaseLeadMediatorOption = Pick<MediatorOption, "id" | "name">;

type MediationCategoryValue = (typeof MEDIATION_CATEGORIES)[number];

function caseSubtypeOptions(category?: string | null): readonly string[] {
  switch (category) {
    case "Family":
      return FAMILY_CASE_SUBTYPES;
    case "Workplace":
      return WORKPLACE_CASE_SUBTYPES;
    case "Civil":
      return CIVIL_CASE_SUBTYPES;
    case "Commercial":
      return COMMERCIAL_CASE_SUBTYPES;
    case "Other":
      return OTHER_CASE_SUBTYPES;
    default:
      return [];
  }
}

function selectedCaseSubtype(caseData: CaseDetail): string {
  switch (caseData.mediationCategory) {
    case "Family":
      return caseData.familySubType || "";
    case "Workplace":
      return caseData.workplaceSubType || "";
    case "Civil":
      return caseData.civilSubType || "";
    case "Commercial":
      return caseData.commercialSubType || "";
    case "Other":
      return caseData.otherSubType || "";
    default:
      return "";
  }
}

function isFinancialDisclosureEligibleCaseDetail(caseData: CaseDetail | null | undefined): boolean {
  if (!caseData) return false;
  return caseData.mediationCategory === "Family"
    && (FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES as readonly string[]).includes(caseData.familySubType || "");
}

type SessionReadinessIssue = {
  partyId: string;
  role: string;
  partyName: string;
  reason: "missing_miam" | "not_approved" | "unsuitable";
  label: string;
};

type MiamProgressRecord = {
  id: string;
  partyId: string;
  approvalStatus: string | null;
  suitableForMediation: string | null;
  submittedAt?: string | Date | null;
  reviewedAt?: string | Date | null;
};

type MediationSessionParticipantView = {
  id: string;
  sessionId: string;
  userId: string;
  role: "lead_mediator" | "co_mediator" | "observer";
  userName: string;
  userEmail: string;
  invitationStatus?: "invited" | "accepted" | "declined";
  addedAt: string | Date;
};

type MediationSessionPartyAttendanceView = {
  id: string;
  caseId: string;
  mediationSessionId: string;
  partyId: string;
  status: "no_show";
  markedBy?: string | null;
  markedAt: string | Date;
  updatedAt: string | Date;
};

type RequiredFormView = {
  id: string;
  partyId: string;
  formType: string;
  status: string;
  deliveryStatus?: string | null;
  deliveryLastAttemptedAt?: string | Date | null;
  deliveryError?: string | null;
  sentAt?: string | Date | null;
  viewedAt?: string | Date | null;
  signedAt?: string | Date | null;
  signerName?: string | null;
  signatureSource?: string | null;
  uploadedDocumentId?: string | null;
  generatedDocumentId?: string | null;
  courtFormTemplateId?: string | null;
  courtFormGenerationId?: string | null;
  withdrawnAt?: string | Date | null;
};

type MediationSessionView = {
  id: string;
  caseId: string;
  sessionNumber: number;
  leadMediatorId: string | null;
  leadMediatorName: string | null;
  status: string;
  appointmentId?: string | null;
  outcome: string | null;
  outcomeNotes: string | null;
  nextAction?: string | null;
  documentsRequired?: string | null;
  followUpRequirements?: string | null;
  nextSessionRequired?: boolean;
  summarySubmittedBy?: string | null;
  summarySubmittedAt?: string | Date | null;
  postSessionReviewStatus?: "not_submitted" | "submitted" | "changes_requested" | "approved";
  postSessionReviewRequestedBy?: string | null;
  postSessionReviewRequestedAt?: string | Date | null;
  postSessionReviewedBy?: string | null;
  postSessionReviewedAt?: string | Date | null;
  postSessionReviewNotes?: string | null;
  draftFinancialSchedule?: {
    id: string;
    status: string;
    confirmedAt?: string | Date | null;
    confirmedBy?: string | null;
    confirmedInSessionId?: string | null;
    updatedAt?: string | Date | null;
  } | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  participants: MediationSessionParticipantView[];
  noteSummary?: {
    count: number;
    latestNoteAt: string | Date | null;
    latestNoteAuthor: string | null;
  };
  indicator?: {
    color: "red" | "amber" | "green";
    label: string;
    reason: string;
  };
  documents?: CaseDocumentView[];
  partyAttendance?: MediationSessionPartyAttendanceView[];
  appointment?: {
    id: string;
    dateTime: string | Date;
    duration: number;
    status: string;
    holdExpiresAt?: string | Date | null;
    paymentStatus?: string | null;
    meetingLink?: string | null;
    hasMeetingLink?: boolean;
    canJoin?: boolean;
    joinAvailability?: {
      canJoin: boolean;
      reasonCode: string;
      message: string;
    };
  } | null;
  proposal?: {
    id: string;
    proposedStartAt: string | Date;
    proposedEndAt: string | Date;
    duration?: number;
    expiresAt: string | Date;
    status: string;
    voucherFormRequired: boolean;
    recipients: ProposalRecipientView[];
  } | null;
  formRequirements?: Array<{
    formType: string;
    label: string;
    applicable: boolean;
    issued: boolean;
    reason?: string;
  }>;
  requiredForms?: RequiredFormView[];
  availabilityWindows?: Array<{
    id: string;
    partyId?: string | null;
    proposalRecipientId?: string | null;
    startAt: string | Date;
    endAt: string | Date;
    source: string;
    notes?: string | null;
  }>;
  invoices?: Array<{
    id: string;
    billToPartyId?: string | null;
    invoiceNumber: string;
    status: string;
    paymentStatus: string;
    outstandingPence: number;
    subtotalPence?: number;
    voucherDiscountPence?: number;
    totalPence: number;
    currency?: string;
  }>;
  acknowledgementTasks?: Array<{ id: string; type: string; title: string; message: string; status: string; urgency: string; createdAt: string | Date }>;
};

type MediationSessionNoteView = {
  id: string;
  mediationSessionId: string;
  content: string;
  createdBy: string;
  createdByName: string;
  createdAt: string | Date;
};

type CaseDocumentView = {
  id: string;
  caseId: string;
  mediationSessionId?: string | null;
  partyId?: string | null;
  documentCategory?: string | null;
  financialDisclosureFolderId?: string | null;
  financialDisclosureItemId?: string | null;
  financialDisclosureEvidenceCategoryId?: string | null;
  financialDisclosureUploadTarget?: "online_disclosure_booklet" | "form_e" | "ofs" | "financial_disclosure_checklist" | "evidence_category" | null;
  documentRequestId?: string | null;
  title: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
  documentDate?: string | Date | null;
  fileSizeBytes?: number | null;
  uploadedBy: string;
  reviewStatus: "draft" | "ready_for_review" | "reviewed";
  readyForReviewAt?: string | Date | null;
  reviewedAt?: string | Date | null;
  sharedWithClients: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  uploadedByName?: string | null;
  partyName?: string | null;
  partyRole?: string | null;
  proofingItemId?: string | null;
  proofingStatus?: "awaiting_review" | "approved" | "returned" | "withdrawn" | null;
  signatureSource?: "platform" | "upload" | "admin_offline" | string | null;
  requiredFormType?: string | null;
};

type CaseProofingItemView = {
  id: string;
  caseId: string;
  sessionId?: string | null;
  itemType: "session_summary" | "draft_financial_schedule" | "financial_disclosure_checklist" | "court_form" | "case_document";
  sourceEntityType: string;
  sourceEntityId: string;
  status: "awaiting_review" | "approved" | "returned" | "withdrawn";
  submittedBy?: string | null;
  submittedAt: string | Date;
  reviewedBy?: string | null;
  reviewedAt?: string | Date | null;
  returnComments?: string | null;
  withdrawnAt?: string | Date | null;
  withdrawReason?: string | null;
  ageingStatus: "green" | "amber" | "red";
  ageingDays: number;
  displayTitle: string;
  displaySubtitle?: string | null;
  partyName?: string | null;
  sessionLabel?: string | null;
  submittedByName?: string | null;
  reviewedByName?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  documentDate?: string | Date | null;
  uploadDate?: string | Date | null;
  fileUrl?: string | null;
  previewKind: "document" | "draft_financial_schedule_pdf" | "metadata_only" | "unavailable";
  releaseEffect: string;
  currentCycleNumber: number;
  reviewCycleLabel: string;
  versionNumber?: number | null;
  versionLabel?: string | null;
  signatureSource?: string | null;
  requiredFormType?: string | null;
  cycles: Array<{
    id: string;
    cycleNumber: number;
    status: string;
    submittedAt: string | Date;
    submittedByName?: string | null;
    reviewedAt?: string | Date | null;
    reviewedByName?: string | null;
    returnedAt?: string | Date | null;
    returnedByName?: string | null;
    returnComments?: string | null;
    withdrawnAt?: string | Date | null;
    withdrawnByName?: string | null;
    withdrawReason?: string | null;
    fileName?: string | null;
    documentDate?: string | Date | null;
    uploadDate?: string | Date | null;
  }>;
};

type DocumentBlankFormView = {
  templateId: string | null;
  formType: string;
  label: string;
  partyId?: string | null;
  requiredFormId?: string | null;
  downloadUrl: string | null;
  canDownload?: boolean;
  canUploadCompletedForm?: boolean;
  canUploadAgainstRequiredForm: boolean;
  uploadMode?: "required_form" | "case_document" | null;
  status?: string | null;
  completedDocumentId?: string | null;
  completedDocumentTitle?: string | null;
  completedDocumentUrl?: string | null;
  completedDocumentReviewStatus?: string | null;
  completedDocumentProofingStatus?: "awaiting_review" | "approved" | "returned" | "withdrawn" | string | null;
};

const MOJ_PRIVACY_CONSENT_DOCUMENT_LABEL = "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
const MOJ_PRIVACY_CONSENT_ACTIVE_FORM_TYPE = "voucher_moj_research_contact_opt_in";
const MOJ_PRIVACY_CONSENT_LEGACY_FORM_TYPE = "voucher_diversity_questionnaire_opt_in";

function dateValue(value?: string | Date | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isMoJPrivacyConsentDocument(document: CaseDocumentView): boolean {
  return document.title.startsWith(MOJ_PRIVACY_CONSENT_DOCUMENT_LABEL)
    || isActiveMoJPrivacyConsentDocument(document)
    || isLegacyMoJPrivacyConsentDocument(document);
}

function isActiveMoJPrivacyConsentDocument(document: CaseDocumentView): boolean {
  return document.fileName.includes(MOJ_PRIVACY_CONSENT_ACTIVE_FORM_TYPE);
}

function isLegacyMoJPrivacyConsentDocument(document: CaseDocumentView): boolean {
  return document.fileName.includes(MOJ_PRIVACY_CONSENT_LEGACY_FORM_TYPE);
}

function preferredMoJPrivacyConsentDocument(current: CaseDocumentView, candidate: CaseDocumentView): CaseDocumentView {
  const currentIsActive = isActiveMoJPrivacyConsentDocument(current);
  const candidateIsActive = isActiveMoJPrivacyConsentDocument(candidate);
  if (candidateIsActive !== currentIsActive) return candidateIsActive ? candidate : current;

  const reviewRank = (document: CaseDocumentView) =>
    document.reviewStatus === "reviewed" ? 3 : document.reviewStatus === "ready_for_review" ? 2 : 1;
  const currentRank = reviewRank(current);
  const candidateRank = reviewRank(candidate);
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;

  const currentTime = Math.max(dateValue(current.reviewedAt), dateValue(current.readyForReviewAt), dateValue(current.createdAt), dateValue(current.updatedAt));
  const candidateTime = Math.max(dateValue(candidate.reviewedAt), dateValue(candidate.readyForReviewAt), dateValue(candidate.createdAt), dateValue(candidate.updatedAt));
  return candidateTime > currentTime ? candidate : current;
}

function dedupeMoJPrivacyConsentDocuments(documents: CaseDocumentView[]): CaseDocumentView[] {
  const byKey = new Map<string, CaseDocumentView>();
  const duplicateIds = new Set<string>();

  for (const document of documents) {
    if (!isMoJPrivacyConsentDocument(document)) continue;
    const key = [
      document.caseId,
      document.mediationSessionId || "case",
      document.partyId || "unknown-party",
      document.documentCategory || "unknown-category",
      MOJ_PRIVACY_CONSENT_DOCUMENT_LABEL,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, document);
      continue;
    }
    const preferred = preferredMoJPrivacyConsentDocument(existing, document);
    duplicateIds.add(preferred.id === existing.id ? document.id : existing.id);
    byKey.set(key, preferred);
  }

  return documents.filter((document) => !duplicateIds.has(document.id));
}

function isRequiredFormEvidenceDocument(document: CaseDocumentView): boolean {
  return Boolean(document.requiredFormType || document.signatureSource);
}

type FinancialDisclosureItemView = {
  id: string;
  folderId: string;
  itemType: "online_disclosure_booklet" | "financial_disclosure_checklist";
  title: string;
  description?: string | null;
  status: "outstanding" | "in_progress" | "completed" | "waived";
  payload: Record<string, unknown>;
  updatedAt: string | Date;
};

type FinancialDisclosureEvidenceCategoryView = {
  id: string;
  folderId: string;
  categoryKey: string;
  label: string;
  description?: string | null;
  sortOrder: number;
  documents: CaseDocumentView[];
};

type FinancialDisclosureFolderView = {
  id: string;
  caseId: string;
  partyId: string;
  party: {
    id: string;
    role?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    userId?: string | null;
  };
  status: string;
  triggerSource: string;
  ofsRequired?: string | null;
  sourceSummary?: {
    clientName: string;
    dateOfBirth?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    nationalInsuranceNumber?: string | null;
    employmentStatus?: string | null;
    legalAidEligible?: string | null;
    voucherSchemeEligible?: string | null;
    courtProceedingsStatus?: string | null;
    courtReference?: string | null;
    courtName?: string | null;
    cafcassInvolved?: string | null;
    solicitorInvolved?: string | null;
    solicitorName?: string | null;
    childrenAges?: string | null;
    additionalNeeds?: string | null;
  };
  items: FinancialDisclosureItemView[];
  evidenceCategories: FinancialDisclosureEvidenceCategoryView[];
  documents: CaseDocumentView[];
};

type MediationSessionsResponse = {
  sessions: MediationSessionView[];
  readiness: { ready: boolean; issues: SessionReadinessIssue[] };
  access: "none" | "observer" | "co_mediator" | "full";
  summary?: { numberOfSessions: number; totalMediationHours: number };
};

type AppointmentHistoryRow = {
  id: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousDateTime?: string | Date | null;
  newDateTime?: string | Date | null;
  eventType: string;
  reason?: string | null;
  changedAt: string | Date;
};

function formatLifecycleLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatLifecycleDate(value?: string | Date | null): string {
  return value ? formatUkWallClockDateTime(value) : "";
}

function SessionAppointmentHistoryList({ appointmentId }: { appointmentId: string }) {
  const { data: history = [], isLoading } = useQuery<AppointmentHistoryRow[]>({
    queryKey: ["/api/appointments", appointmentId, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/${appointmentId}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load appointment history");
      return res.json();
    },
  });

  return (
    <div className="rounded-md border bg-background p-3 min-w-0" data-testid={`session-appointment-history-${appointmentId}`}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">History</p>
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lifecycle history recorded yet.</p>
      ) : (
        <div className="grid gap-2">
          {history.slice(0, 6).map((row) => (
            <div key={row.id} className="rounded border bg-muted/10 px-2 py-1.5 text-xs min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium break-words">{formatLifecycleLabel(row.eventType)}</span>
                <span className="text-muted-foreground shrink-0">{formatLifecycleDate(row.changedAt)}</span>
              </div>
              {(row.previousStatus || row.newStatus) && (
                <p className="text-muted-foreground mt-0.5 break-words">{[row.previousStatus, row.newStatus].filter(Boolean).join(" to ")}</p>
              )}
              {(row.previousDateTime || row.newDateTime) && row.previousDateTime !== row.newDateTime && (
                <p className="text-muted-foreground mt-0.5 break-words">{formatLifecycleDate(row.previousDateTime)} to {formatLifecycleDate(row.newDateTime)}</p>
              )}
              {row.reason && <p className="text-muted-foreground mt-0.5 break-words">{row.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiamReadinessCard({
  readiness,
  isLoading = false,
  dataTestId,
  onGoToMediationSessions,
}: {
  readiness?: MediationSessionsResponse["readiness"];
  isLoading?: boolean;
  dataTestId: string;
  onGoToMediationSessions?: () => void;
}) {
  return (
    <Card data-testid={dataTestId}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-heading flex items-center gap-2 min-w-0">
            {readiness?.ready ? <CheckCircle2 className="w-4 h-4 text-[#5a7d58]" /> : <Info className="w-4 h-4 text-amber-600" />}
            MIAM readiness
          </CardTitle>
          {onGoToMediationSessions && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs shrink-0"
              onClick={onGoToMediationSessions}
              data-testid="button-go-mediation-sessions"
            >
              <Calendar className="w-3 h-3 mr-1" /> Mediation Sessions
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" data-testid="skeleton-miam-readiness">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : readiness?.ready ? (
          <p className="text-sm text-[#5a7d58]" data-testid="text-session-ready">All parties have approved suitable MIAM records. Mediation session allocation is available.</p>
        ) : (
          <div className="space-y-2" data-testid="list-session-readiness-blockers">
            <p className="text-sm text-amber-700">Allocation is blocked until every party has an approved suitable MIAM.</p>
            {(readiness?.issues || []).map((issue) => (
              <div key={`${issue.partyId}-${issue.reason}`} className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="font-medium">Client {issue.role}:</span> {issue.label}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CimEligibilityCard({
  caseId,
  caseData,
  parties,
}: {
  caseId: string;
  caseData: CaseDetail;
  parties: PartyWithMediators[];
}) {
  const { toast } = useToast();
  const [notesByParty, setNotesByParty] = useState<Record<string, string>>({});
  const initialReadiness = caseData.cimReadiness ?? null;
  const { data: readiness, isLoading } = useQuery<CimEligibilityPayload>({
    queryKey: ["/api/cases", caseId, "cim-eligibility"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/cim-eligibility`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load CIM eligibility");
      return res.json();
    },
    enabled: !!caseId,
    initialData: initialReadiness || undefined,
  });

  const consentMutation = useMutation({
    mutationFn: ({ partyId, status, notes }: { partyId: string; status: CimConsentRow["status"]; notes?: string }) =>
      apiRequest("PATCH", `/api/cases/${caseId}/cim-consents/${partyId}`, { status, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "cim-eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "CIM consent updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update CIM consent", description: err.message, variant: "destructive" });
    },
  });

  const eligibilityMutation = useMutation({
    mutationFn: (cimEligible: boolean) =>
      apiRequest("PATCH", `/api/cases/${caseId}/cim-eligibility`, { cimEligible }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "cim-eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "CIM eligibility updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update CIM eligibility", description: err.message, variant: "destructive" });
    },
  });

  const parentParties = parties
    .filter((party) => ["A", "B"].includes((party.role || "").toUpperCase()))
    .sort((a, b) => a.role.localeCompare(b.role));
  const consentForParty = (partyId: string) => readiness?.consents.find((row) => row.partyId === partyId) || null;

  return (
    <Card data-testid="card-cim-eligibility">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            {readiness?.cimEligible ? <CheckCircle2 className="w-4 h-4 text-[#5a7d58]" /> : <UsersIcon className="w-4 h-4 text-[#b8825a]" />}
            CIM eligibility
          </CardTitle>
          <Badge
            variant={readiness?.cimEligible ? "default" : readiness?.ready ? "outline" : "secondary"}
            className={readiness?.ready && !readiness?.cimEligible ? "text-[#5a7d58] border-[#a7baa4] bg-[#a7baa4]/10" : ""}
            data-testid="badge-cim-eligibility"
          >
            {readiness?.cimEligible ? "Eligible" : readiness?.ready ? "Ready to mark" : "Not ready"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            {readiness?.blockers?.length ? (
              <div className="space-y-2" data-testid="list-cim-readiness-blockers">
                {readiness.blockers.map((blocker, idx) => (
                  <div key={`${blocker.reason}-${blocker.partyId || blocker.role || idx}`} className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                    {blocker.label}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#5a7d58]" data-testid="text-cim-ready">Both MIAMs, safeguarding, and parent consents are complete.</p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {parentParties.map((party) => {
                const consent = consentForParty(party.id);
                const formType = (party.role || "").toUpperCase() === "A" ? "cf10" : "cf12";
                const noteValue = notesByParty[party.id] ?? consent?.notes ?? "";
                return (
                  <div key={party.id} className="rounded-md border p-3 space-y-2" data-testid={`cim-consent-${party.role}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">Client {party.role}</p>
                        <p className="text-xs text-muted-foreground">{formType.toUpperCase()}</p>
                      </div>
                      <Badge variant={consent?.status === "granted" ? "default" : consent?.status === "refused" ? "destructive" : "secondary"}>
                        {consent?.status || "pending"}
                      </Badge>
                    </div>
                    <Select
                      value={consent?.status || "pending"}
                      onValueChange={(status) => consentMutation.mutate({ partyId: party.id, status: status as CimConsentRow["status"], notes: noteValue })}
                      disabled={consentMutation.isPending}
                    >
                      <SelectTrigger className="h-9" data-testid={`select-cim-consent-${party.role}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="granted">Granted</SelectItem>
                        <SelectItem value="refused">Refused</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea
                      rows={2}
                      value={noteValue}
                      onChange={(e) => setNotesByParty((prev) => ({ ...prev, [party.id]: e.target.value }))}
                      onBlur={() => {
                        if (consent) consentMutation.mutate({ partyId: party.id, status: consent.status, notes: noteValue });
                      }}
                      placeholder="Evidence notes"
                      data-testid={`textarea-cim-consent-notes-${party.role}`}
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => eligibilityMutation.mutate(!readiness?.cimEligible)}
                disabled={eligibilityMutation.isPending || (!readiness?.ready && !readiness?.cimEligible)}
                data-testid="button-mark-cim-eligible"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                {readiness?.cimEligible ? "Clear CIM eligibility" : "Mark CIM eligible"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type SessionCalendarSlot = {
  startAt: string | Date;
  endAt: string | Date;
  time: string;
  endTime: string;
  duration: number;
};

type FinanceParty = {
  partyId: string;
  role: string;
  clientId: string;
  clientName: string;
};

type FinanceInvoice = {
  id: string;
  caseId: string;
  billToClientId: string;
  billToPartyId: string | null;
  serviceTypeId: string | null;
  appointmentId: string | null;
  provider: string;
  providerInvoiceId: string | null;
  paymentLinkUrl: string | null;
  paymentStatus: string;
  failureReason: string | null;
  invoiceNumber: string;
  status: string;
  issueDate: string | Date;
  dueDate: string | Date | null;
  subtotalPence: number;
  vatTotalPence: number;
  voucherDiscountPence: number;
  totalPence: number;
  amountPaidPence: number;
  outstandingPence: number;
  currency: string;
  notes: string | null;
  billToClientName: string;
  partyRole: string | null;
  serviceName: string | null;
  appointmentDateTime?: string | Date | null;
  appointmentStatus?: string | null;
  mediationSessionId?: string | null;
  mediationSessionNumber?: number | null;
  lineItems: Array<{
    id: string;
    description: string;
    quantity: number;
    unitAmountPence: number;
    vatRate: number | null;
    vatAmountPence: number;
    lineTotalPence: number;
    serviceName?: string | null;
  }>;
};

type FinancePayment = {
  id: string;
  caseId: string;
  clientId: string;
  partyId: string | null;
  invoiceId: string | null;
  appointmentId: string | null;
  amountPence: number;
  currency: string;
  paymentDate: string | Date;
  method: string;
  provider: string;
  providerPaymentId: string | null;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  paymentStatus: string;
  failureReason: string | null;
  refundedAmountPence: number;
  refundedAt: string | Date | null;
  receiptNumber: string | null;
  receiptGeneratedAt: string | Date | null;
  reference: string | null;
  notes: string | null;
  clientName: string;
  partyRole: string | null;
  invoiceNumber: string | null;
  appointmentDateTime?: string | Date | null;
  appointmentStatus?: string | null;
};

type CaseFinanceResponse = {
  parties: FinanceParty[];
  invoices: FinanceInvoice[];
  payments: FinancePayment[];
  externalInvoices: Array<{
    id: string;
    appointmentId: string;
    clientId: string | null;
    partyId: string | null;
    xeroInvoiceNumber: string | null;
    xeroInvoiceId: string;
    xeroInvoiceUrl: string | null;
    xeroStatus: string;
    amountPence: number;
    currency: string;
    paidAt: string | Date | null;
  }>;
  totalsByClient: Array<{
    clientId: string;
    clientName: string;
    partyId: string;
    partyRole: string;
    invoicedPence: number;
    paidPence: number;
    outstandingPence: number;
    overduePence: number;
  }>;
};

const MEDIATION_OUTCOME_OPTIONS = [
  { value: "next_session_needed", label: "Next session needed" },
  { value: "full_agreement", label: "Full agreement" },
  { value: "partial_agreement", label: "Partial agreement" },
  { value: "no_agreement_closed", label: "No agreement / closed" },
  { value: "unsuitable", label: "Unsuitable" },
];

const POST_SESSION_REVIEW_LABELS: Record<string, string> = {
  not_submitted: "Not submitted",
  submitted: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  payment_pending: "Payment pending",
  paid: "Paid",
  voucher_pending: "Voucher claim pending",
  voucher_accepted_by_opia: "Voucher accepted by OPIA",
  payment_not_required: "Payment not required",
  failed_or_not_received: "Failed / not received",
};

function canConfirmFromPaymentStatus(status?: string | null): boolean {
  return status === "paid" || status === "voucher_accepted_by_opia" || status === "payment_not_required";
}

const CASE_INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  part_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

const CASE_PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  voucher: "Voucher",
  other: "Other",
};

const CASE_LEDGER_PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
  refunded: "Refunded",
};

function formatPence(amountPence?: number | null, currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: (currency || "gbp").toUpperCase(),
  }).format((amountPence || 0) / 100);
}

function dateInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function getPartyColors(role: string): { color: string; bg: string; border: string } {
  const r = (role || "").toUpperCase();
  if (r === "A") {
    return { color: "text-[#5a7d58]", bg: "bg-[#a7baa4]/15", border: "border-[#a7baa4]/40" };
  }
  if (r === "B") {
    return { color: "text-[#b8825a]", bg: "bg-[#dcae96]/15", border: "border-[#dcae96]/40" };
  }
  return { color: "text-slate-600", bg: "bg-slate-100", border: "border-slate-300" };
}

const MAIN_WORKFLOW_STAGES = [
  "Enquiry",
  "Client A MIAM pending",
  "Client A MIAM booked",
  "Client A MIAM complete - suitable",
  "Client B invited to MIAM",
  "Client B MIAM pending",
  "Client B MIAM booked",
  "Client B MIAM completed",
  "C100 signed form pending",
  "C100 signed form completed",
  "Form A signed form pending",
  "Form A signed form completed",
  "FM1 signed form pending",
  "FM1 signed form completed",
  "Case suitable for mediation",
  "Session 1 pending",
  "Session 1 confirmed",
  "Session 2 pending",
  "Session 2 confirmed",
  "Session 3 pending",
  "Session 3 confirmed",
  "Session 4 pending",
  "Session 4 confirmed",
  "Session 5 pending",
  "Session 5 confirmed",
];

const REFERRAL_STAGES = [
  "Case unsuitable - referral to recommended partner",
  "Mediation concluded - full agreement reached - referral to recommended provider",
  "Mediation concluded - partial agreement reached - referral to recommended provider",
];

const CLOSURE_STAGES = [
  "Case unsuitable - case closed",
  "Mediation concluded - full agreement reached - no further action",
  "Mediation concluded - partial agreement reached - no further action",
];

// Task #200 — The stepper is built dynamically per case as:
//   Enquiry → MIAM A → MIAM B → MIAM C/D/… (one per extra party) → Mediation Sessions
// Court Forms stages (indices 8-13) are intentionally omitted from the
// stepper because court-form progress is tracked per-party in the standalone
// CourtFormsStatusCard on Overview. When the case sits on a Court Forms
// stage, the auxiliary banner above the stepper names the current stage so
// it remains visible.
type StepItem =
  | { kind: "canonical"; label: string; stage: string }
  | { kind: "derivedMiam"; label: string; partyId: string; milestone: MiamMilestone }
  | { kind: "mediationReady"; label: string }
  | { kind: "session"; session: MediationSessionView }
  | { kind: "sessionPlaceholder"; label: string };

const STEPPER_CANONICAL_STAGES: ReadonlySet<string> = new Set([
  MAIN_WORKFLOW_STAGES[0],
  ...MAIN_WORKFLOW_STAGES.slice(1, 8),
]);

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function isMiamSuitable(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return v === "yes" || v.startsWith("yes");
}

function deriveMiamCellStateFromRecord(
  milestone: MiamMilestone,
  partyId: string,
  records: MiamProgressRecord[] | undefined,
  appointments: AppointmentLike[] | undefined,
): CellState {
  const record = Array.isArray(records) ? records.find((r) => r.partyId === partyId) : undefined;
  if (!record) return deriveMiamCellStateForParty(milestone, partyId, appointments);

  const approved = record.approvalStatus === "approved";
  if (approved && isMiamSuitable(record.suitableForMediation)) return "Done";
  if (approved && !isMiamSuitable(record.suitableForMediation)) {
    return milestone === "Completed" ? "In progress" : "Done";
  }
  if (record.submittedAt || record.reviewedAt) {
    const milestoneIdx = MIAM_MILESTONES.indexOf(milestone);
    if (milestoneIdx < 1) return "Done";
    return milestoneIdx === 1 ? "In progress" : "Not reached";
  }
  return deriveMiamCellStateForParty(milestone, partyId, appointments);
}

function sessionStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}


function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm mt-0.5">{value}</p>
    </div>
  );
}

function relativeTime(dateStr: string | Date): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function formatDateTime(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type CaseCommunicationLedgerRow = {
  id: string;
  caseId: string;
  caseRef: string;
  partyId: string | null;
  clientId: string | null;
  recipientType: string;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  channel: string;
  direction: string;
  trigger: string;
  templateName: string | null;
  subject: string | null;
  sentAt: string | Date | null;
  deliveryStatus: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  providerMessageId: string | null;
  actorType: string;
  actorName: string | null;
  preview: string | null;
  backfillConfidence: "exact" | "inferred" | "partial";
  hasEmailDetail: boolean;
  attachmentCount: number;
};

type CaseCommunicationEmailDetail = {
  fromName: string | null;
  fromEmail: string;
  toEmails: string | null;
  ccEmails: string | null;
  receivedAt: string | null;
  textBody: string | null;
  sanitizedHtmlBody: string | null;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    failureReason: string | null;
    downloadUrl: string | null;
  }>;
};

function CommunicationEmailDetail({ caseId, communicationId }: { caseId: string; communicationId: string }) {
  const detailQuery = useQuery<CaseCommunicationEmailDetail>({
    queryKey: ["/api/cases", caseId, "communications", communicationId, "email"],
    queryFn: async () => {
      const response = await fetch(`/api/cases/${caseId}/communications/${communicationId}/email`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load email reply");
      return response.json();
    },
  });
  if (detailQuery.isLoading) return <Skeleton className="mt-3 h-28 w-full" />;
  if (!detailQuery.data || detailQuery.isError) return <p className="mt-3 text-sm text-red-700">Unable to load the complete email reply.</p>;
  const detail = detailQuery.data;
  return (
    <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-4" data-testid="communication-email-detail">
      <div className="text-xs text-muted-foreground">
        <p>From: {detail.fromName ? `${detail.fromName} <${detail.fromEmail}>` : detail.fromEmail}</p>
        <p>To: {detail.toEmails || "Unknown"}</p>
        {detail.ccEmails && <p>Cc: {detail.ccEmails}</p>}
      </div>
      {detail.sanitizedHtmlBody ? (
        <div className="prose prose-sm max-w-none overflow-auto rounded bg-background p-3" dangerouslySetInnerHTML={{ __html: detail.sanitizedHtmlBody }} />
      ) : (
        <p className="whitespace-pre-wrap rounded bg-background p-3 text-sm">{detail.textBody || "No email body was available."}</p>
      )}
      {detail.attachments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Attachments</p>
          {detail.attachments.map((attachment) => (
            <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-2 text-sm">
              <span>{attachment.fileName}</span>
              {attachment.downloadUrl && attachment.status === "saved" ? (
                <Button asChild size="sm" variant="outline"><a href={attachment.downloadUrl}>Download</a></Button>
              ) : (
                <Badge variant="outline">{attachment.status === "blocked" ? "Not saved — unsupported or too large" : "Save failed — will retry"}</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CaseCommunicationsLedger({ caseId, parties }: { caseId: string; parties: PartyWithMediators[] }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isEmailAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const [channel, setChannel] = useState("all");
  const [deliveryStatus, setDeliveryStatus] = useState("all");
  const [recipientId, setRecipientId] = useState("all");
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualType, setManualType] = useState("call_logged");
  const [manualDirection, setManualDirection] = useState("outbound");
  const [manualContactName, setManualContactName] = useState("");
  const [manualRecipientEmail, setManualRecipientEmail] = useState("");
  const [manualRecipientPhone, setManualRecipientPhone] = useState("");
  const [manualOccurredAt, setManualOccurredAt] = useState("");
  const [manualSummary, setManualSummary] = useState("");
  const [expandedCommunicationId, setExpandedCommunicationId] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (channel !== "all") queryParams.set("channel", channel);
  if (deliveryStatus !== "all") queryParams.set("deliveryStatus", deliveryStatus);
  if (recipientId !== "all") queryParams.set("recipientId", recipientId);
  queryParams.set("limit", "100");

  const communicationsQuery = useQuery<{ data: CaseCommunicationLedgerRow[]; total: number }>({
    queryKey: ["/api/cases", caseId, "communications", { channel, deliveryStatus, recipientId }],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/communications?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch communications");
      return res.json();
    },
  });

  const manualMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/cases/${caseId}/communications/manual`, {
        type: manualType,
        direction: manualDirection,
        contactName: manualContactName || undefined,
        recipientEmail: manualRecipientEmail || undefined,
        recipientPhone: manualRecipientPhone || undefined,
        occurredAt: manualOccurredAt || undefined,
        summary: manualSummary,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "communications"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      setShowManualForm(false);
      setManualSummary("");
      setManualContactName("");
      setManualRecipientEmail("");
      setManualRecipientPhone("");
      setManualOccurredAt("");
      toast({ title: "Communication logged" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to log communication", description: error.message, variant: "destructive" });
    },
  });

  const rows = communicationsQuery.data?.data || [];
  const statusTone = (status: string) => status === "failed"
    ? "destructive"
    : status === "delivered" || status === "read" || status === "sent" || status === "received"
      ? "default"
      : "outline";

  return (
    <div className="space-y-4" data-testid="case-communications-ledger">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger data-testid="select-communication-channel">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deliveryStatus} onValueChange={setDeliveryStatus}>
            <SelectTrigger data-testid="select-communication-delivery-status">
              <SelectValue placeholder="Delivery status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["queued", "sent", "delivered", "read", "failed", "received", "skipped", "manual", "unknown"].map((status) => (
                <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={recipientId} onValueChange={setRecipientId}>
            <SelectTrigger data-testid="select-communication-recipient">
              <SelectValue placeholder="Recipient" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All recipients</SelectItem>
              {parties.map((party) => (
                <SelectItem key={party.id} value={party.id}>
                  Client {party.role}: {[party.firstName, party.lastName].filter(Boolean).join(" ") || party.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">{isEmailAdmin && <CaseEmailComposer caseId={caseId} label="New email" />}<Button type="button" variant="outline" onClick={() => setShowManualForm((value) => !value)} data-testid="button-add-manual-communication"><Plus className="w-4 h-4 mr-2" />Log</Button></div>
      </div>

      {showManualForm && (
        <Card className="border-dashed" data-testid="form-case-communication-manual">
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={manualType} onValueChange={setManualType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="call_logged">Phone</SelectItem>
                  <SelectItem value="email_sent">Email</SelectItem>
                  <SelectItem value="whatsapp_logged">WhatsApp</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
              <Select value={manualDirection} onValueChange={setManualDirection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                </SelectContent>
              </Select>
              <Input type="datetime-local" value={manualOccurredAt} onChange={(e) => setManualOccurredAt(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input placeholder="Recipient/contact name" value={manualContactName} onChange={(e) => setManualContactName(e.target.value)} />
              <Input placeholder="Email" value={manualRecipientEmail} onChange={(e) => setManualRecipientEmail(e.target.value)} />
              <Input placeholder="Phone" value={manualRecipientPhone} onChange={(e) => setManualRecipientPhone(e.target.value)} />
            </div>
            <Textarea placeholder="Communication summary" value={manualSummary} onChange={(e) => setManualSummary(e.target.value)} rows={3} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowManualForm(false)}>Cancel</Button>
              <Button type="button" onClick={() => manualMutation.mutate()} disabled={!manualSummary.trim() || manualMutation.isPending}>
                {manualMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {communicationsQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : communicationsQuery.isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load communications.</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No communications recorded for these filters.</div>
      ) : (
        <div className="rounded-md border divide-y">
          {rows.map((row) => (
            <div key={row.id} className="p-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] bg-background" data-testid="case-communication-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="capitalize">{row.channel}</Badge>
                  <Badge variant={statusTone(row.deliveryStatus) as any} className="capitalize">{row.deliveryStatus.replace(/_/g, " ")}</Badge>
                  {row.backfillConfidence !== "exact" && <Badge variant="outline" className="capitalize">{row.backfillConfidence} history</Badge>}
                  <span className="text-xs text-muted-foreground capitalize">{row.direction}</span>
                </div>
                <p className="mt-2 text-sm font-medium truncate">
                  {row.subject || row.templateName || row.trigger.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {[row.recipientName, row.recipientEmail, row.recipientPhone].filter(Boolean).join(" | ") || row.recipientType}
                </p>
                {row.preview && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{row.preview}</p>}
                {row.hasEmailDetail && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto px-0 pt-2 text-primary hover:bg-transparent hover:underline"
                      onClick={() => setExpandedCommunicationId((current) => current === row.id ? null : row.id)}
                    >
                      {expandedCommunicationId === row.id ? "Hide reply" : `View full reply${row.attachmentCount ? ` (${row.attachmentCount} attachment${row.attachmentCount === 1 ? "" : "s"})` : ""}`}
                    </Button>
                    {expandedCommunicationId === row.id && <CommunicationEmailDetail caseId={caseId} communicationId={row.id} />}
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground lg:text-right whitespace-nowrap">
                <p>{row.sentAt ? formatDateTime(row.sentAt) : "Time unknown"}</p>
                <p className="mt-1">{row.caseRef}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceEnquirySummaryCard({ caseData, canViewSensitiveCaseMarkers }: { caseData: CaseDetail; canViewSensitiveCaseMarkers: boolean }) {
  const source = caseData.sourceEnquiry;
  const sourceAddress = [source?.addressLine1, source?.postcode].filter(Boolean).join(", ");
  const caseHasSafeguardingConcern = caseData.safeguardingStatus === "concern" || caseData.intakeStatus === "Safeguarding";

  return (
    <Card data-testid="card-source-enquiry-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base font-heading">Source enquiry</CardTitle>
          {source?.id && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/enquiries/${source.id}`} data-testid="link-source-enquiry-workspace">
                <ExternalLink className="w-4 h-4 mr-2" />
                Work enquiry
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <DetailRow label="Enquiry ref" value={source?.enquiryRef || "Enquiry case shell"} />
          <DetailRow label="Intake status" value={caseData.intakeStatus || source?.status || "New"} />
          <DetailRow label="Claimed by" value={caseData.claimedByName || "Not claimed"} />
          <DetailRow label="Received" value={source?.dateReceived ? formatDate(source.dateReceived) : caseData.enquiryDate ? formatDate(caseData.enquiryDate) : "Not recorded"} />
          <DetailRow label="Channel" value={source?.contactMethod || "Not recorded"} />
          <DetailRow label="First contact due" value={caseData.firstContactDueAt ? formatDate(caseData.firstContactDueAt) : "Not set"} />
          <DetailRow label="Safeguarding" value={caseData.safeguardingStatus || "pending"} />
          <DetailRow label="Address" value={sourceAddress || "Not recorded"} />
        </div>
        {canViewSensitiveCaseMarkers && caseHasSafeguardingConcern && (
          <div className="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700" data-testid="badge-case-safeguarding-concern">
            <ShieldAlert className="w-3.5 h-3.5 mr-1.5" />
            Safeguarding concern raised
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Intake claim, chase, safeguarding, and closure actions can be worked from this case overview or the enquiry workspace.
        </p>
      </CardContent>
    </Card>
  );
}

type PartyMiamValidityView = NonNullable<CaseDetail["miamValidity"]>["parties"][number];

function CaseWhatsappTemplateDialog({
  caseId,
  partyId,
  templateName,
  endpoint,
  label,
  description,
  disabled = false,
  payload = {},
  testId,
}: {
  caseId: string;
  partyId: string;
  templateName: string;
  endpoint: string;
  label: string;
  description: string;
  disabled?: boolean;
  payload?: Record<string, unknown>;
  testId: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CaseWhatsappTemplatePreview | null>(null);
  const recipientsQuery = useQuery<CaseWhatsappRecipient[]>({
    queryKey: ["/api/cases", caseId, "whatsapp", "recipients"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/whatsapp/recipients`, { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load WhatsApp recipient");
      return res.json();
    },
    enabled: open,
  });
  const templatesQuery = useQuery<CaseWhatsappTemplate[]>({
    queryKey: ["/api/whatsapp/templates"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/templates", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load WhatsApp templates");
      return res.json();
    },
    enabled: open,
  });
  const previewMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", endpoint, { ...payload, partyId, previewOnly: true });
      return response.json() as Promise<CaseWhatsappTemplatePreview>;
    },
    onSuccess: setPreview,
    onError: (error: Error) => toast({ title: "Unable to prepare WhatsApp preview", description: error.message, variant: "destructive" }),
  });
  const sendMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", endpoint, { ...payload, partyId, previewOnly: false, responseLink: preview?.responseLink });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "communications"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "whatsapp"], exact: false });
      toast({ title: "WhatsApp template queued" });
      setOpen(false);
    },
    onError: (error: Error) => toast({ title: "Unable to send WhatsApp template", description: error.message, variant: "destructive" }),
  });

  const recipient = recipientsQuery.data?.find((item) => item.partyId === partyId) || null;
  const template = templatesQuery.data?.find((item) => item.name === templateName && item.language === "en_GB") || null;
  const disabledReason = disabled
    ? "This action is not currently available for this client."
    : templatesQuery.isLoading || recipientsQuery.isLoading
      ? "Loading WhatsApp template details..."
      : templatesQuery.isError
        ? "Unable to load approved WhatsApp templates."
        : recipientsQuery.isError
          ? "Unable to load WhatsApp recipient details."
          : !template
            ? "Approved WhatsApp template not found. Sync templates after Meta approval."
            : !recipient
              ? "No WhatsApp recipient is available for this party."
              : recipient.noWhatsappOrVoicemail
                ? "WhatsApp is disabled for this case."
                : !recipient.phone
                  ? "This client does not have a valid WhatsApp mobile number."
                  : recipient.optInStatus !== "opted_in"
                    ? "Recorded WhatsApp opt-in is required before sending."
                    : null;
  const canSend = open && !disabledReason && !!preview?.parameters && !previewMutation.isPending && !sendMutation.isPending;

  const openDialog = () => {
    setOpen(true);
    setPreview(null);
    previewMutation.mutate();
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="w-full" disabled={disabled} onClick={openDialog} data-testid={testId}>
        <MessageSquare className="w-3.5 h-3.5 mr-2" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Template</p>
              <p className="text-sm font-medium">{templateName}</p>
            </div>
            {disabledReason && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="whatsapp-template-disabled-reason">
                {disabledReason}
              </div>
            )}
            {previewMutation.isPending && <p className="text-sm text-muted-foreground">Preparing preview...</p>}
            {preview?.parameters && (
              <div className="space-y-2" data-testid="whatsapp-template-variable-preview">
                <p className="text-sm font-medium">Variables to send</p>
                {Object.entries(preview.parameters).map(([key, value]) => (
                  <div key={key} className="grid gap-1 rounded-md border bg-background p-2 text-xs sm:grid-cols-[150px_minmax(0,1fr)]">
                    <span className="font-medium text-muted-foreground">{key}</span>
                    <span className="break-words">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!canSend} onClick={() => sendMutation.mutate()}>
              <Send className="w-4 h-4 mr-2" />
              {sendMutation.isPending ? "Sending..." : "Send WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PartySummaryCard({ party, role, caseRef, isShuttle, caseId, isAdmin, partyHasActiveAppointment, partyHasActiveMiamBooking, partyMiamValidity }: { party?: PartyWithMediators; role: string; caseRef: string; isShuttle: boolean; caseId: string; isAdmin: boolean; partyHasActiveAppointment: boolean; partyHasActiveMiamBooking: boolean; partyMiamValidity?: PartyMiamValidityView }) {
  const suffix = isShuttle ? `-${role}-SHUTTLE` : `-${role}`;
  const clientRef = `${caseRef}${suffix}`;
  const label = `Client ${role} — Summary`;
  const { color: privacyColor, bg: privacyBg, border: privacyBorder } = getPartyColors(role);
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const { user } = useAuth();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bookingLinkResult, setBookingLinkResult] = useState<string | null>(null);
  const [copiedBooking, setCopiedBooking] = useState(false);
  const [showBookingDialog, setShowBookingDialog] = useState(false);

  const { data: summaryMediatorsData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/mediators", "summary-miam"],
    queryFn: async () => {
      const res = await fetch("/api/mediators?limit=100", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: isAdmin && canEdit("cases"),
  });

  const summaryMiamMediatorMutation = useMutation({
    mutationFn: (miamMediatorId: string | null) =>
      apiRequest("PATCH", `/api/parties/${party!.id}/link-settings`, {
        miamMediatorId,
        allocatedMediatorId: party?.allocatedMediatorId ?? null,
        confidential: party?.confidential ?? false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({ title: "MIAM mediator updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update MIAM mediator", description: err.message, variant: "destructive" }),
  });

  const bookingLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/parties/${party!.id}/booking-link`, {});
      return res.json();
    },
    onSuccess: (data: { bookingUrl: string; emailSent: boolean }) => {
      const fullUrl = `${window.location.origin}${data.bookingUrl}`;
      setBookingLinkResult(fullUrl);
      setShowBookingDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({
        title: "Booking link generated",
        description: data.emailSent
          ? `Booking link emailed to ${party?.email || "client"}. Also shown below.`
          : "Booking link generated. Email could not be sent — please share the link manually.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate booking link", description: err.message, variant: "destructive" });
    },
  });

  const repeatMiamLinkMutation = useMutation({
    mutationFn: async () => {
      const endpoint = isAdmin
        ? `/api/parties/${party!.id}/miam-renewal-booking-link`
        : `/api/parties/${party!.id}/miam-renewal-self-service-link`;
      const res = await apiRequest("POST", endpoint, {});
      return res.json();
    },
    onSuccess: (data: { bookingUrl: string; emailSent: boolean }) => {
      if (!isAdmin) {
        window.location.assign(data.bookingUrl);
        return;
      }
      const fullUrl = `${window.location.origin}${data.bookingUrl}`;
      setBookingLinkResult(fullUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({
        title: "Repeat MIAM booking link generated",
        description: data.emailSent
          ? `Repeat MIAM link emailed to ${party?.email || "client"}. Also shown below.`
          : "Repeat MIAM link generated. Email could not be sent, so please share the link manually.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create repeat MIAM link", description: err.message, variant: "destructive" });
    },
  });

  const freshMiamSelfServiceLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/parties/${party!.id}/miam-self-service-booking-link`, {});
      return res.json();
    },
    onSuccess: (data: { bookingUrl: string; emailSent: boolean }) => {
      window.location.assign(data.bookingUrl);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start MIAM booking", description: err.message, variant: "destructive" });
    },
  });

  const handleCopyBooking = async () => {
    if (bookingLinkResult) {
      await navigator.clipboard.writeText(bookingLinkResult);
      setCopiedBooking(true);
      setTimeout(() => setCopiedBooking(false), 2000);
    }
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/parties/${party!.id}/invite`);
      return res.json();
    },
    onSuccess: (data: { inviteUrl: string; emailSent: boolean; alreadyActive?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      if (data.alreadyActive) {
        toast({ title: "Portal access activated", description: "Client already completed registration. Portal access has been activated for this case." });
        return;
      }
      const fullUrl = `${window.location.origin}${data.inviteUrl}`;
      setInviteLink(fullUrl);
      toast({
        title: "Invitation generated",
        description: data.emailSent
          ? `Invitation email sent to ${party?.email || "client"}. The link is also shown below.`
          : "Invite link generated. Email could not be sent — please share the link manually.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send invite", description: err.message, variant: "destructive" });
    },
  });

  const handleCopy = async () => {
    if (inviteLink) {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!party) {
    return (
      <Card className={`border ${privacyBorder}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{role === "A" ? "Not available." : "Not yet added."}</p>
        </CardContent>
      </Card>
    );
  }

  const showInviteButton = isAdmin && canEdit("cases") && party && party.userId && party.portalStatus !== "active";
  const isInvited = party?.portalStatus === "invited";
  const showRepeatMiamBookingButton = Boolean(partyMiamValidity?.renewalBookingAvailable && party && (isAdmin || user?.role === "client"));
  const showFreshMiamBookingButton = Boolean(isAdmin && canEdit("cases") && party && party.email && !showRepeatMiamBookingButton);
  const showClientFreshMiamBookingButton = Boolean(
    user?.role === "client"
    && party
    && !showRepeatMiamBookingButton
    && !partyMiamValidity?.valid
    && !partyMiamValidity?.renewalBookingAvailable
    && !partyHasActiveMiamBooking,
  );

  return (
    <Card className={`border ${privacyBorder}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-heading">{label}</CardTitle>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Client Case Reference</span>
            <Badge variant="outline" className="font-mono text-[10px]">{clientRef}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {party ? (
          <>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#5a7d58]" />
              <span className="text-sm font-medium">{party.firstName} {party.lastName}</span>
              {party.portalStatus && (
                <Badge
                  variant={party.portalStatus === "active" ? "default" : "secondary"}
                  className={`text-[10px] ml-auto ${party.portalStatus === "invited" ? "bg-amber-100 text-amber-700 border-amber-200" : ""}`}
                >
                  {party.portalStatus}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#5a7d58]" />
              <span className="text-sm">{party.email || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-[#5a7d58]" />
              <span className="text-sm">{party.phoneCode || "+44"} {party.phone || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-[#5a7d58]" />
              <span className="text-xs text-muted-foreground">MIAM Mediator:</span>
              <span className="text-sm">{party.miamMediatorName || "Unassigned"}</span>
            </div>
            {isAdmin && canEdit("cases") && (
              <div className="grid gap-1">
                <Label className="text-xs">MIAM mediator</Label>
                <Select
                  value={party.miamMediatorId ?? "__none__"}
                  onValueChange={(value) => summaryMiamMediatorMutation.mutate(value === "__none__" ? null : value)}
                  disabled={summaryMiamMediatorMutation.isPending}
                >
                  <SelectTrigger className="h-8 text-sm" data-testid={`select-summary-miam-mediator-${role.toLowerCase()}`}>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {(summaryMediatorsData?.data ?? []).map((mediator) => (
                      <SelectItem key={mediator.id} value={mediator.id}>{mediator.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-[#5a7d58]" />
              <span className="text-xs text-muted-foreground">Allocated Mediator:</span>
              <span className="text-sm">{party.allocatedMediatorName || "Unassigned"}</span>
            </div>
            {party.confidential && (
              <Badge variant="destructive" className="text-[10px]">Confidential</Badge>
            )}
            <div className={`flex items-center gap-2 p-2 rounded-md ${privacyBg}`} data-testid={`privacy-indicator-${role.toLowerCase()}`}>
              <Shield className={`w-3.5 h-3.5 ${privacyColor}`} />
              <span className={`text-[10px] ${privacyColor} font-medium`}>
                Other parties cannot see Client {role}'s private documents
              </span>
            </div>

            {partyMiamValidity?.expiresAt && (
              <div className={`rounded-md border p-3 text-sm ${partyMiamValidity.expired ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[#a7baa4]/40 bg-[#a7baa4]/10 text-[#3f5f3d]"}`} data-testid={`miam-expiry-${role.toLowerCase()}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">MIAM expiry</span>
                  <Badge variant={partyMiamValidity.expired ? "outline" : "default"}>
                    {partyMiamValidity.expired ? "Expired" : "Valid"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs">{formatUkWallClockDateTime(partyMiamValidity.expiresAt)}</p>
              </div>
            )}

            {showRepeatMiamBookingButton && (
              <Button
                size="sm"
                variant="outline"
                className="w-full border-amber-300 text-amber-800 hover:bg-amber-50"
                onClick={() => repeatMiamLinkMutation.mutate()}
                disabled={repeatMiamLinkMutation.isPending || partyHasActiveMiamBooking}
                data-testid={isAdmin ? "button-send-repeat-miam-link" : "button-client-repeat-miam"}
              >
                {repeatMiamLinkMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                ) : (
                  <Calendar className="w-3.5 h-3.5 mr-2" />
                )}
                {isAdmin ? "Send Repeat MIAM Link" : "Book Repeat MIAM"}
              </Button>
            )}

            {showClientFreshMiamBookingButton && (
              <Button
                size="sm"
                variant="outline"
                className="w-full border-[#a7baa4] text-[#3f5f3d] hover:bg-[#a7baa4]/10"
                onClick={() => freshMiamSelfServiceLinkMutation.mutate()}
                disabled={freshMiamSelfServiceLinkMutation.isPending || partyHasActiveMiamBooking}
                data-testid="button-client-book-miam"
              >
                {freshMiamSelfServiceLinkMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                ) : (
                  <Calendar className="w-3.5 h-3.5 mr-2" />
                )}
                Book MIAM
              </Button>
            )}

            {showInviteButton && (
              <>
                <Separator />
                <div className="w-full"><CaseEmailComposer caseId={caseId} initialPartyId={party.id} purpose="portal_invite" label={isInvited ? "Preview portal invite" : "Invite to Portal"} variant={isInvited ? "outline" : "default"} /></div>
              </>
            )}

            {showFreshMiamBookingButton && (
              <>
                <div className="w-full"><CaseEmailComposer caseId={caseId} initialPartyId={party.id} purpose="miam_booking" label={partyHasActiveAppointment ? "Active Appointment Exists" : "Send MIAM Booking Link"} variant="outline" disabled={partyHasActiveAppointment} /></div>
                <div className="w-full">
                  <CaseWhatsappTemplateDialog
                    caseId={caseId}
                    partyId={party.id}
                    templateName="bfm_miam_booking"
                    endpoint={`/api/cases/${caseId}/whatsapp/miam-booking-template`}
                    label="Send MIAM WhatsApp"
                    description="Preview the secure MIAM booking WhatsApp template before sending it to this client."
                    disabled={partyHasActiveAppointment}
                    testId="button-send-miam-whatsapp"
                  />
                </div>
              </>
            )}

            {inviteLink && (
              <div className="rounded-md border bg-muted/50 p-3 space-y-2" data-testid={`invite-link-${role.toLowerCase()}`}>
                <div className="flex items-center gap-2">
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Invitation Link</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-foreground bg-background rounded px-2 py-1 flex-1 break-all border">
                    {inviteLink}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={handleCopy}
                    data-testid={`button-copy-invite-${role.toLowerCase()}`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#5a7d58]" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            )}

            {bookingLinkResult && (
              <div className="rounded-md border bg-muted/50 p-3 space-y-2" data-testid={`booking-link-${role.toLowerCase()}`}>
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Booking Link</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] text-foreground bg-background rounded px-2 py-1 flex-1 break-all border">
                    {bookingLinkResult}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={handleCopyBooking}
                    data-testid={`button-copy-booking-${role.toLowerCase()}`}
                  >
                    {copiedBooking ? <Check className="w-3.5 h-3.5 text-[#5a7d58]" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No details available.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PartyFullRecord({ party, role, caseRef, isShuttle, isStaff, caseId }: {
  party?: PartyWithMediators;
  role: string;
  caseRef: string;
  isShuttle: boolean;
  isStaff?: boolean;
  caseId?: string;
}) {
  const { toast } = useToast();
  const suffix = isShuttle ? `-${role}-SHUTTLE` : `-${role}`;
  const clientRef = `${caseRef}${suffix}`;
  const label = `Client ${role} — Full Record`;
  const { border: privacyBorder } = getPartyColors(role);

  // Personal details edit state
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [personalForm, setPersonalForm] = useState({
    firstName: party?.firstName ?? "",
    lastName: party?.lastName ?? "",
    dateOfBirth: party?.dateOfBirth ?? "",
    email: party?.email ?? "",
    phone: party?.phone ?? "",
    phoneCode: party?.phoneCode ?? "+44",
    gender: party?.gender ?? "",
    ethnicOrigin: party?.ethnicOrigin ?? "",
    nationalInsuranceNumber: party?.nationalInsuranceNumber ?? "",
    disabilityOrHealthCondition: party?.disabilityOrHealthCondition ?? "",
    additionalNeeds: party?.additionalNeeds ?? "",
    addressLine1: party?.addressLine1 ?? "",
    addressLine2: party?.addressLine2 ?? "",
    city: party?.city ?? "",
    postcode: party?.postcode ?? "",
    country: party?.country ?? "United Kingdom",
  });

  const personalMutation = useMutation({
    mutationFn: (data: typeof personalForm) =>
      apiRequest("PATCH", `/api/clients/${party!.clientId}`, data),
    onSuccess: () => {
      if (caseId) queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      if (caseId) queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      setEditingPersonal(false);
      toast({ title: "Personal details updated" });
    },
    onError: () => toast({ title: "Failed to save personal details", variant: "destructive" }),
  });

  // Case link settings edit state
  const [editingLink, setEditingLink] = useState(false);
  const [linkForm, setLinkForm] = useState({
    miamMediatorId: party?.miamMediatorId ?? null as string | null,
    allocatedMediatorId: party?.allocatedMediatorId ?? null as string | null,
    confidential: party?.confidential ?? false,
  });

  const { data: mediatorsData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/mediators"],
    queryFn: async () => {
      const res = await fetch("/api/mediators?limit=100", { credentials: "include" });
      return res.json();
    },
    enabled: !!isStaff && editingLink,
  });
  const mediatorList = mediatorsData?.data ?? [];

  const linkMutation = useMutation({
    mutationFn: (data: { miamMediatorId: string | null; allocatedMediatorId: string | null; confidential: boolean }) =>
      apiRequest("PATCH", `/api/parties/${party!.id}/link-settings`, data),
    onSuccess: () => {
      if (caseId) queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      setEditingLink(false);
      toast({ title: "Case link settings updated" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  if (!party) {
    return (
      <Card className={`border ${privacyBorder}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {role === "A" ? "No details available." : `Client ${role} not yet added.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border ${privacyBorder}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-heading">{label}</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px]">{clientRef}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Personal Details</span>
          {isStaff && !editingPersonal && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
              setPersonalForm({
                firstName: party.firstName ?? "",
                lastName: party.lastName ?? "",
                dateOfBirth: party.dateOfBirth ?? "",
                email: party.email ?? "",
                phone: party.phone ?? "",
                phoneCode: party.phoneCode ?? "+44",
                gender: party.gender ?? "",
                ethnicOrigin: party.ethnicOrigin ?? "",
                nationalInsuranceNumber: party.nationalInsuranceNumber ?? "",
                disabilityOrHealthCondition: party.disabilityOrHealthCondition ?? "",
                additionalNeeds: party.additionalNeeds ?? "",
                addressLine1: party.addressLine1 ?? "",
                addressLine2: party.addressLine2 ?? "",
                city: party.city ?? "",
                postcode: party.postcode ?? "",
                country: party.country ?? "United Kingdom",
              });
              setEditingPersonal(true);
            }} data-testid={`button-edit-personal-${role.toLowerCase()}`}>
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </Button>
          )}
        </div>

        {editingPersonal ? (
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-snug">
                <strong>Shared record.</strong> These changes will apply to this client across all cases.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">First name</Label>
                <Input className="h-8 text-sm" value={personalForm.firstName} onChange={e => setPersonalForm(f => ({ ...f, firstName: e.target.value }))} data-testid={`input-first-name-${role.toLowerCase()}`} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Last name</Label>
                <Input className="h-8 text-sm" value={personalForm.lastName} onChange={e => setPersonalForm(f => ({ ...f, lastName: e.target.value }))} data-testid={`input-last-name-${role.toLowerCase()}`} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date of birth</Label>
              <Input className="h-8 text-sm" type="date" value={personalForm.dateOfBirth} onChange={e => setPersonalForm(f => ({ ...f, dateOfBirth: e.target.value }))} data-testid={`input-dob-${role.toLowerCase()}`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input className="h-8 text-sm" value={personalForm.email} onChange={e => setPersonalForm(f => ({ ...f, email: e.target.value }))} data-testid={`input-email-${role.toLowerCase()}`} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input className="h-8 text-sm" value={personalForm.phone} onChange={e => setPersonalForm(f => ({ ...f, phone: e.target.value }))} data-testid={`input-phone-${role.toLowerCase()}`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Gender</Label>
                <Select value={personalForm.gender || "__none__"} onValueChange={v => setPersonalForm(f => ({ ...f, gender: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not specified</SelectItem>
                    {GENDERS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ethnic origin</Label>
                <Select value={personalForm.ethnicOrigin || "__none__"} onValueChange={v => setPersonalForm(f => ({ ...f, ethnicOrigin: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not specified</SelectItem>
                    {Object.entries(ETHNIC_GROUPS).flatMap(([, opts]) => Array.from(opts)).map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">National Insurance number</Label>
              <Input className="h-8 text-sm" value={personalForm.nationalInsuranceNumber} onChange={e => setPersonalForm(f => ({ ...f, nationalInsuranceNumber: e.target.value }))} data-testid={`input-ni-${role.toLowerCase()}`} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Address line 1</Label>
              <Input className="h-8 text-sm" value={personalForm.addressLine1} onChange={e => setPersonalForm(f => ({ ...f, addressLine1: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Input className="h-8 text-sm" value={personalForm.city} onChange={e => setPersonalForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Postcode</Label>
                <Input className="h-8 text-sm" value={personalForm.postcode} onChange={e => setPersonalForm(f => ({ ...f, postcode: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs" onClick={() => personalMutation.mutate(personalForm)} disabled={personalMutation.isPending} data-testid={`button-save-personal-${role.toLowerCase()}`}>
                <Save className="w-3 h-3 mr-1" /> {personalMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingPersonal(false)} data-testid={`button-cancel-personal-${role.toLowerCase()}`}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="First name" value={party.firstName} />
              <DetailRow label="Last name" value={party.lastName} />
            </div>
            <DetailRow label="Date of birth" value={party.dateOfBirth ? new Date(party.dateOfBirth).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null} />
            <Separator />
            <DetailRow label="Email" value={party.email} />
            <DetailRow label="Phone" value={party.phone ? `${party.phoneCode || "+44"} ${party.phone}` : null} />
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Gender" value={party.gender} />
              <DetailRow label="Ethnic origin" value={party.ethnicOrigin} />
            </div>
            <DetailRow label="National Insurance number" value={party.nationalInsuranceNumber} />
            <DetailRow label="Disability or health condition" value={party.disabilityOrHealthCondition && party.disabilityOrHealthCondition !== "None" ? party.disabilityOrHealthCondition : null} />
            <DetailRow label="Additional needs" value={party.additionalNeeds} />
            {(party.addressLine1 || party.city || party.postcode) && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Address</span>
                  </div>
                  <div className="text-sm space-y-0.5 ml-6">
                    {party.addressLine1 && <p>{party.addressLine1}</p>}
                    {party.addressLine2 && <p>{party.addressLine2}</p>}
                    {party.city && <p>{party.city}</p>}
                    {party.postcode && <p>{party.postcode}</p>}
                    {party.country && <p>{party.country}</p>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Case Link Settings</span>
          {isStaff && !editingLink && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
              setLinkForm({
                miamMediatorId: party.miamMediatorId ?? null,
                allocatedMediatorId: party.allocatedMediatorId ?? null,
                confidential: party.confidential ?? false,
              });
              setEditingLink(true);
            }} data-testid={`button-edit-link-settings-${role.toLowerCase()}`}>
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </Button>
          )}
        </div>

        {editingLink ? (
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <div className="space-y-1">
              <Label className="text-xs">MIAM Mediator</Label>
              <Select
                value={linkForm.miamMediatorId ?? "__none__"}
                onValueChange={v => setLinkForm(f => ({ ...f, miamMediatorId: v === "__none__" ? null : v }))}
              >
                <SelectTrigger className="h-8 text-sm" data-testid={`select-miam-mediator-${role.toLowerCase()}`}>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {mediatorList.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Allocated Mediator</Label>
              <Select
                value={linkForm.allocatedMediatorId ?? "__none__"}
                onValueChange={v => setLinkForm(f => ({ ...f, allocatedMediatorId: v === "__none__" ? null : v }))}
              >
                <SelectTrigger className="h-8 text-sm" data-testid={`select-allocated-mediator-${role.toLowerCase()}`}>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {mediatorList.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`confidential-${role}`}
                checked={linkForm.confidential}
                onCheckedChange={v => setLinkForm(f => ({ ...f, confidential: !!v }))}
                data-testid={`checkbox-confidential-${role.toLowerCase()}`}
              />
              <Label htmlFor={`confidential-${role}`} className="text-xs cursor-pointer">Mark as confidential</Label>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs" onClick={() => linkMutation.mutate(linkForm)} disabled={linkMutation.isPending} data-testid={`button-save-link-settings-${role.toLowerCase()}`}>
                <Save className="w-3 h-3 mr-1" /> {linkMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingLink(false)} data-testid={`button-cancel-link-settings-${role.toLowerCase()}`}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">MIAM Mediator</span>
            </div>
            <p className="text-sm ml-6">{party.miamMediatorName || "Unassigned"}</p>
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Allocated Mediator</span>
            </div>
            <p className="text-sm ml-6">{party.allocatedMediatorName || "Unassigned"}</p>
            <DetailRow label="Portal status" value={party.portalStatus} />
            {party.confidential && (
              <Badge variant="destructive" className="text-[10px]">Confidential</Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  "Safety Concern": { bg: "bg-red-100", text: "text-red-800", dot: "bg-red-500" },
  "Risk Flag": { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  "Case Update": { bg: "bg-blue-100", text: "text-blue-800", dot: "bg-blue-500" },
  "Important Note": { bg: "bg-gray-100", text: "text-gray-800", dot: "bg-gray-500" },
};

function ConfidentialCategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES["Important Note"];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`} data-testid={`badge-category-${category.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {category}
    </span>
  );
}

function CaseInformationCard({ caseData, caseId, canViewSensitiveCaseMarkers }: { caseData: CaseDetail; caseId: string; canViewSensitiveCaseMarkers: boolean }) {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const canManageOrdinaryCase = canEdit("cases") && (isAdmin || user?.role === "staff");
  const selectedLeadMediator = caseData.mediatorId || "__unassigned__";
  const selectedCategory = caseData.mediationCategory || "";
  const selectedSubtype = selectedCaseSubtype(caseData);
  const subtypeOptions = caseSubtypeOptions(selectedCategory);
  const canCloseCase = canManageOrdinaryCase && caseData.status !== "Closed" && caseData.status !== "Archived";
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeDetails, setCloseDetails] = useState("");
  const [partyFollowUpConsents, setPartyFollowUpConsents] = useState<Record<string, { consentStatus: "granted" | "declined" | "excluded" | "pending" | ""; source: string; exclusionReason: string }>>({});
  const [sendingFollowUpConsentPartyId, setSendingFollowUpConsentPartyId] = useState<string | null>(null);
  const [manualFollowUpConsentLink, setManualFollowUpConsentLink] = useState<{ partyId: string; url: string } | null>(null);
  const [lifeSatisfaction, setLifeSatisfaction] = useState("");
  const [anxietyScore, setAnxietyScore] = useState("");
  const [serviceRating, setServiceRating] = useState("");
  const [netPromoterScore, setNetPromoterScore] = useState("");
  const [caseTypePendingField, setCaseTypePendingField] = useState<"category" | "subtype" | null>(null);
  const [manualRevenueValue, setManualRevenueValue] = useState(
    caseData.manualRevenuePence == null ? "" : String((caseData.manualRevenuePence / 100).toFixed(2)),
  );

  useEffect(() => {
    setManualRevenueValue(caseData.manualRevenuePence == null ? "" : String((caseData.manualRevenuePence / 100).toFixed(2)));
  }, [caseData.manualRevenuePence]);

  const optionalScore = (value: string) => {
    const trimmed = value.trim();
    return trimmed === "" ? null : Number(trimmed);
  };
  const partyConsentRows = caseData.partyFollowUpConsents ?? [];
  const updatePartyFollowUpConsent = (partyId: string, patch: Partial<{ consentStatus: "granted" | "declined" | "excluded" | "pending" | ""; source: string; exclusionReason: string }>) => {
    setPartyFollowUpConsents((prev) => ({
      ...prev,
      [partyId]: {
        consentStatus: prev[partyId]?.consentStatus || "",
        source: prev[partyId]?.source || "closure_admin",
        exclusionReason: prev[partyId]?.exclusionReason || "",
        ...patch,
      },
    }));
  };
  const partyFollowUpPayload = partyConsentRows.map((row) => {
    const draft = partyFollowUpConsents[row.partyId] ?? {
      consentStatus: row.consentStatus === "not_captured" ? "" : row.consentStatus,
      source: row.source || "closure_admin",
      exclusionReason: row.exclusionReason || "",
    };
    return {
      partyId: row.partyId,
      consentStatus: draft.consentStatus,
      source: draft.source || "closure_admin",
      exclusionReason: draft.exclusionReason?.trim() || null,
    };
  });
  const partyFollowUpMissingDecision = partyFollowUpPayload.some((row) => !row.consentStatus);
  const partyFollowUpMissingExclusionReason = partyFollowUpPayload.some((row) => row.consentStatus === "excluded" && !row.exclusionReason);
  const sendFollowUpConsentMutation = useMutation({
    mutationFn: async (partyId: string) => {
      setSendingFollowUpConsentPartyId(partyId);
      const res = await apiRequest("POST", `/api/cases/${caseId}/parties/${partyId}/follow-up-consent/send`, {});
      return { partyId, data: await res.json() as { emailSent: boolean; consentUrl?: string } };
    },
    onSuccess: ({ partyId, data }) => {
      updatePartyFollowUpConsent(partyId, { consentStatus: "pending", source: "email_request", exclusionReason: "" });
      setManualFollowUpConsentLink(data.emailSent === false && data.consentUrl ? { partyId, url: data.consentUrl } : null);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({ title: data.emailSent === false ? "Consent link created" : "Consent request sent" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send consent request", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSendingFollowUpConsentPartyId(null),
  });
  const copyFollowUpConsentLink = async () => {
    if (!manualFollowUpConsentLink) return;
    await navigator.clipboard.writeText(manualFollowUpConsentLink.url);
    toast({ title: "Consent link copied" });
  };

  const { data: caseLeadMediatorOptions } = useQuery<CaseLeadMediatorOption[]>({
    queryKey: ["/api/cases/lead-mediator-options"],
    queryFn: async () => {
      const res = await fetch("/api/cases/lead-mediator-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch mediators");
      return res.json();
    },
    enabled: isAdmin,
  });

  const leadMediatorMutation = useMutation({
    mutationFn: (mediatorId: string | null) =>
      apiRequest("PATCH", `/api/cases/${caseId}/mediator`, { mediatorId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Lead mediator updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update lead mediator",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const caseTypeMutation = useMutation({
    mutationFn: ({ mediationCategory, subType }: { mediationCategory: MediationCategoryValue; subType: string }) =>
      apiRequest("PATCH", `/api/cases/${caseId}/type`, { mediationCategory, subType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Case type updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update case type",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setCaseTypePendingField(null),
  });

  const voucherClaimEligibilityMutation = useMutation({
    mutationFn: async (voucherClaimEligible: boolean) => {
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/voucher-claim-eligibility`, { voucherClaimEligible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      toast({ title: "Voucher claim status updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update voucher claim status",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const manualRevenueMutation = useMutation({
    mutationFn: async () => {
      const trimmed = manualRevenueValue.trim();
      const manualRevenuePence = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
      if (manualRevenuePence !== null && (!Number.isFinite(manualRevenuePence) || manualRevenuePence < 0)) {
        throw new Error("Enter a valid non-negative revenue amount");
      }
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/manual-revenue`, { manualRevenuePence });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/admin-summary"] });
      toast({ title: "Manual revenue updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update manual revenue",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const caseConfidentialMutation = useMutation({
    mutationFn: async (confidential: boolean) => {
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/confidential`, { confidential });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"] });
      toast({ title: caseData.confidential ? "Confidential marker removed" : "Case marked confidential" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to update confidentiality",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const closeCaseMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/cases/${caseId}/close`, {
        closureReason: closeReason,
        closureDetails: closeDetails,
        partyFollowUpConsents: partyFollowUpPayload.map((row) => ({
          partyId: row.partyId,
          consentStatus: row.consentStatus,
          source: row.source,
          exclusionReason: row.exclusionReason,
        })),
        lifeSatisfaction: optionalScore(lifeSatisfaction),
        anxietyScore: optionalScore(anxietyScore),
        serviceRating: optionalScore(serviceRating),
        netPromoterScore: optionalScore(netPromoterScore),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setCloseDialogOpen(false);
      toast({ title: "Case closed" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to close case",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const openCloseDialog = () => {
    setCloseReason(caseData.closureReason || "");
    setCloseDetails(caseData.closureDetails || "");
    setManualFollowUpConsentLink(null);
    setPartyFollowUpConsents(Object.fromEntries((caseData.partyFollowUpConsents ?? []).map((row) => [
      row.partyId,
      {
        consentStatus: row.consentStatus === "not_captured" ? "" : row.consentStatus,
        source: row.source || "closure_admin",
        exclusionReason: row.exclusionReason || "",
      },
    ])));
    setLifeSatisfaction(caseData.closureRecord?.lifeSatisfaction == null ? "" : String(caseData.closureRecord.lifeSatisfaction));
    setAnxietyScore(caseData.closureRecord?.anxietyScore == null ? "" : String(caseData.closureRecord.anxietyScore));
    setServiceRating(caseData.closureRecord?.serviceRating == null ? "" : String(caseData.closureRecord.serviceRating));
    setNetPromoterScore(caseData.closureRecord?.netPromoterScore == null ? "" : String(caseData.closureRecord.netPromoterScore));
    setCloseDialogOpen(true);
  };

  const updateCaseCategory = (category: MediationCategoryValue) => {
    const nextSubtype = caseSubtypeOptions(category)[0];
    if (!nextSubtype) return;
    setCaseTypePendingField("category");
    caseTypeMutation.mutate({ mediationCategory: category, subType: nextSubtype });
  };

  const updateCaseSubtype = (subType: string) => {
    if (!selectedCategory) return;
    setCaseTypePendingField("subtype");
    caseTypeMutation.mutate({ mediationCategory: selectedCategory as MediationCategoryValue, subType });
  };

  const eligibleLeadMediators = caseLeadMediatorOptions ?? [];
  const hasCurrentInOptions = caseData.mediatorId
    ? eligibleLeadMediators.some(m => m.id === caseData.mediatorId) || caseData.mediatorId === user?.id
    : true;

  return (
    <>
    <Card data-testid="card-case-information">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-[#5a7d58]" />
            Case Information
            {canViewSensitiveCaseMarkers && caseData.confidential && (
              <span data-testid="badge-case-confidential">
                <ConfidentialBadge />
              </span>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isAdmin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => caseConfidentialMutation.mutate(!caseData.confidential)}
                disabled={caseConfidentialMutation.isPending}
                data-testid="button-toggle-case-confidential"
              >
                {caseConfidentialMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Shield className="w-3.5 h-3.5 mr-1.5" />}
                {caseData.confidential ? "Remove confidential" : "Mark confidential"}
              </Button>
            )}
            {canCloseCase && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-red-300 text-red-700 hover:bg-red-50"
                onClick={openCloseDialog}
                data-testid="button-open-close-case"
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Close case
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-muted/30 border p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Case Reference</p>
              <p className="text-sm font-medium mt-0.5" data-testid="text-info-case-ref">{caseData.caseRef}</p>
            </div>
            {caseData.legacyCaseNumber && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Legacy case number</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-slate-700 border-slate-300 bg-slate-50" data-testid="badge-case-legacy-info">
                    Legacy
                  </Badge>
                  <p className="text-sm font-medium" data-testid="text-info-legacy-case-number">{caseData.legacyCaseNumber}</p>
                </div>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Status</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant={caseData.status === "Active" ? "default" : "secondary"} className="text-xs" data-testid="text-info-status">
                  {caseData.status}
                </Badge>
                {canViewSensitiveCaseMarkers && caseData.confidential && (
                  <span data-testid="badge-case-confidential-status">
                    <ConfidentialBadge />
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Issue Type</p>
              <p className="text-sm mt-0.5" data-testid="text-info-issue-type">{caseData.issueType || "—"}</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <span>Case Type</span>
                {caseTypePendingField === "category" && (
                  <span className="inline-flex items-center gap-1 text-xs normal-case tracking-normal text-muted-foreground" data-testid="text-case-type-updating">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating...
                  </span>
                )}
              </p>
              {canManageOrdinaryCase ? (
                <Select
                  value={selectedCategory}
                  onValueChange={(value) => updateCaseCategory(value as MediationCategoryValue)}
                  disabled={caseTypeMutation.isPending}
                >
                  <SelectTrigger className="mt-1 h-9" data-testid="select-case-type">
                    <SelectValue placeholder="Select case type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {MEDIATION_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-0.5" data-testid="text-info-case-type">{selectedCategory || "—"}</p>
              )}
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <span>Subtype</span>
                {caseTypePendingField === "subtype" && (
                  <span className="inline-flex items-center gap-1 text-xs normal-case tracking-normal text-muted-foreground" data-testid="text-case-subtype-updating">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating...
                  </span>
                )}
              </p>
              {canManageOrdinaryCase ? (
                <Select
                  value={selectedSubtype}
                  onValueChange={updateCaseSubtype}
                  disabled={caseTypeMutation.isPending || !selectedCategory}
                >
                  <SelectTrigger className="mt-1 h-9" data-testid="select-case-subtype">
                    <SelectValue placeholder={selectedCategory ? "Select subtype..." : "Select case type first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {subtypeOptions.map((subtype) => (
                      <SelectItem key={subtype} value={subtype}>{subtype}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-0.5" data-testid="text-info-case-subtype">{selectedSubtype || "—"}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">MoJ Voucher Eligible</p>
              <div className="mt-1">
                <Badge
                  variant={caseData.mojVoucherEligible ? "default" : "secondary"}
                  className={caseData.mojVoucherEligible ? "bg-[#5a7d58] text-white" : "text-xs"}
                  data-testid="text-info-moj-voucher-eligible"
                >
                  {caseData.mojVoucherEligible ? "Eligible" : "Not eligible"}
                </Badge>
              </div>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Voucher applied to session invoices</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  variant={caseData.voucherClaimEligible ? "default" : "outline"}
                  className={caseData.voucherClaimEligible ? "bg-[#5a7d58] text-white" : "text-xs"}
                  data-testid="text-info-voucher-claim-applied"
                >
                  {caseData.voucherClaimEligible ? "Applied" : "Not applied"}
                </Badge>
                {isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => voucherClaimEligibilityMutation.mutate(!caseData.voucherClaimEligible)}
                    disabled={voucherClaimEligibilityMutation.isPending || (!caseData.mojVoucherEligible && !caseData.voucherClaimEligible)}
                    data-testid="button-toggle-voucher-claim-eligibility"
                  >
                    {voucherClaimEligibilityMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Receipt className="w-3.5 h-3.5 mr-1" />}
                    {caseData.voucherClaimEligible ? "Remove" : "Apply"}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {caseData.voucherClaimEligible
                  ? `Applied ${caseData.voucherClaimEligibleSetAt ? new Date(caseData.voucherClaimEligibleSetAt).toLocaleString("en-GB") : ""}${caseData.voucherClaimEligibleSetByName ? ` by ${caseData.voucherClaimEligibleSetByName}` : ""}`.trim()
                  : caseData.mojVoucherEligible
                    ? "Voucher forms are issued from an approved MIAM voucher decision. Apply after the mandatory voucher consent is reviewed."
                    : "Available only for Child arrangements and AIM family cases."}
              </p>
            </div>
          </div>
          <Separator />
          {isSuperadmin && (
            <>
              <Card className="border-[#a7baa4]/50 bg-[#a7baa4]/10" data-testid="card-manual-case-revenue">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Manual case revenue</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Current value: {formatPence(caseData.manualRevenuePence, "gbp")}
                      </p>
                    </div>
                    <div className="flex w-full gap-2 md:w-auto">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={manualRevenueValue}
                        onChange={(event) => setManualRevenueValue(event.target.value)}
                        placeholder="0.00"
                        className="md:w-36"
                        data-testid="input-manual-case-revenue"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => manualRevenueMutation.mutate()}
                        disabled={manualRevenueMutation.isPending}
                        data-testid="button-save-manual-case-revenue"
                      >
                        {manualRevenueMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                  {caseData.manualRevenueUpdatedAt && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated {formatDate(caseData.manualRevenueUpdatedAt)}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Separator />
            </>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                <span>Lead Mediator</span>
                {leadMediatorMutation.isPending && (
                  <span className="inline-flex items-center gap-1 text-xs normal-case tracking-normal text-muted-foreground" data-testid="text-lead-mediator-updating">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating...
                  </span>
                )}
              </p>
              {isAdmin ? (
                <Select
                  value={selectedLeadMediator}
                  onValueChange={(value) => leadMediatorMutation.mutate(value === "__unassigned__" ? null : value)}
                  disabled={leadMediatorMutation.isPending}
                >
                  <SelectTrigger className="mt-1 h-9" data-testid="select-lead-mediator">
                    <SelectValue placeholder="Select lead mediator..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {isSuperadmin && user?.id && (
                      <SelectItem value={user.id}>Me: {user.name || user.email}</SelectItem>
                    )}
                    {!hasCurrentInOptions && caseData.mediatorId && (
                      <SelectItem value={caseData.mediatorId}>{caseData.mediatorName} (current)</SelectItem>
                    )}
                    {eligibleLeadMediators.map(mediator => (
                      <SelectItem key={mediator.id} value={mediator.id}>{mediator.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-0.5" data-testid="text-info-mediator">{caseData.mediatorName}</p>
              )}
              {isAdmin && eligibleLeadMediators.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1" data-testid="text-no-eligible-case-leads">
                  No active mediator has an approved service marked Lead mediator.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Lead Source</p>
              <p className="text-sm mt-0.5" data-testid="text-info-lead-source">{caseData.leadSource || "—"}</p>
            </div>
            {caseData.status === "Closed" && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Closure reason</p>
                  <p className="text-sm mt-0.5" data-testid="text-info-closure-reason">{caseData.closureReason || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Closed</p>
                  <p className="text-sm mt-0.5" data-testid="text-info-closure-date">{caseData.closureDate ? formatDate(caseData.closureDate) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Closed by</p>
                  <p className="text-sm mt-0.5" data-testid="text-info-closed-by">{caseData.closureRecord?.closedByName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Follow-up consent</p>
                  <p className="text-sm mt-0.5" data-testid="text-info-follow-up-consent">
                    {caseData.closureRecord?.followUpConsentStatus === "granted"
                      ? "Granted"
                      : caseData.closureRecord?.followUpConsentStatus === "declined"
                      ? "Declined - outreach excluded"
                      : "Legacy / unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Closure scores</p>
                  <p className="text-sm mt-0.5" data-testid="text-info-closure-scores">
                    LS {caseData.closureRecord?.lifeSatisfaction ?? "—"} / Anxiety {caseData.closureRecord?.anxietyScore ?? "—"} / Rating {caseData.closureRecord?.serviceRating ?? "—"} / NPS {caseData.closureRecord?.netPromoterScore ?? "—"}
                  </p>
                </div>
              </>
            )}
            {caseData.shuttleMediation && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Mode</p>
                <div className="mt-1">
                  <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">
                    <Shuffle className="w-3 h-3 mr-1" /> Shuttle
                  </Badge>
                </div>
              </div>
            )}
            {canViewSensitiveCaseMarkers && caseData.confidential && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Confidentiality</p>
                <div className="mt-1" data-testid="badge-case-confidential-mode">
                  <ConfidentialBadge />
                </div>
              </div>
            )}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Created</p>
              <p className="text-sm mt-0.5" data-testid="text-info-created">{formatDate(caseData.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Last Updated</p>
              <p className="text-sm mt-0.5" data-testid="text-info-updated">{relativeTime(caseData.lastUpdated)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
    <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6" data-testid="dialog-close-case">
        <DialogHeader>
          <DialogTitle>Close case?</DialogTitle>
          <DialogDescription>
            This will mark the case as Closed and save the closure reason and supporting note.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Closure reason</Label>
            <Select value={closeReason} onValueChange={setCloseReason}>
              <SelectTrigger data-testid="select-case-closure-reason">
                <SelectValue placeholder="Select closure reason..." />
              </SelectTrigger>
              <SelectContent>
                {CASE_CLOSURE_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Supporting note</Label>
            <Textarea
              value={closeDetails}
              onChange={(event) => setCloseDetails(event.target.value)}
              className="min-h-[96px]"
              placeholder="Add closure notes for the case record..."
              data-testid="textarea-case-closure-details"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Follow-up consent by client</Label>
            <div className="space-y-2">
              {partyConsentRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active clients found for follow-up consent.</p>
              ) : partyConsentRows.map((row) => {
                const draft = partyFollowUpConsents[row.partyId] ?? {
                  consentStatus: row.consentStatus === "not_captured" ? "" : row.consentStatus,
                  source: row.source || "closure_admin",
                  exclusionReason: row.exclusionReason || "",
                };
                const carriedForward = row.source === "enquiry_carry_forward" && row.consentStatus === "granted";
                const requestSent = draft.consentStatus === "pending" || row.consentStatus === "pending";
                const canSendRequest = draft.consentStatus === "" || draft.consentStatus === "pending";
                return (
                  <div key={row.partyId} className="rounded-md border bg-muted/20 p-3 space-y-2 min-w-0" data-testid={`case-close-party-follow-up-${row.partyId}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-words">Client {row.role}: {row.clientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {carriedForward
                            ? "Consent already granted from enquiry"
                            : requestSent
                            ? "Consent request sent"
                            : row.consentStatus === "not_captured"
                            ? "Not captured yet"
                            : row.consentStatus === "declined"
                            ? "Consent declined"
                            : row.consentStatus === "excluded"
                            ? "Excluded from follow-up"
                            : "Consent already granted"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {carriedForward && <Badge variant="outline">Consent already granted</Badge>}
                        {requestSent && <Badge variant="outline">Consent request sent</Badge>}
                      </div>
                    </div>
                    <Select
                      value={draft.consentStatus}
                      onValueChange={(value) => updatePartyFollowUpConsent(row.partyId, {
                        consentStatus: value as "granted" | "declined" | "excluded" | "pending",
                        source: value === "pending" ? "email_request" : "closure_admin",
                        exclusionReason: value === "excluded" ? draft.exclusionReason : "",
                      })}
                    >
                      <SelectTrigger data-testid={`select-case-follow-up-consent-${row.partyId}`}>
                        <SelectValue placeholder="Record follow-up consent..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending" disabled>Consent request sent</SelectItem>
                        <SelectItem value="granted">Granted - schedule follow-up</SelectItem>
                        <SelectItem value="declined">Declined - no outreach</SelectItem>
                        <SelectItem value="excluded">Exclude - unreachable / not participating</SelectItem>
                      </SelectContent>
                    </Select>
                    {canSendRequest && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={sendFollowUpConsentMutation.isPending && sendingFollowUpConsentPartyId === row.partyId}
                        onClick={() => sendFollowUpConsentMutation.mutate(row.partyId)}
                        data-testid={`button-send-follow-up-consent-${row.partyId}`}
                      >
                        <Mail className="w-4 h-4 mr-2" />
                        {sendingFollowUpConsentPartyId === row.partyId ? "Sending..." : requestSent ? "Resend consent request" : "Send consent request"}
                      </Button>
                    )}
                    {manualFollowUpConsentLink?.partyId === row.partyId && (
                      <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 space-y-2 min-w-0" data-testid={`manual-follow-up-consent-link-${row.partyId}`}>
                        <p className="text-sm font-medium text-foreground">Copy consent link</p>
                        <Input value={manualFollowUpConsentLink.url} readOnly className="text-xs" data-testid={`input-follow-up-consent-link-${row.partyId}`} />
                        <Button type="button" size="sm" className="w-full" onClick={copyFollowUpConsentLink} data-testid={`button-copy-follow-up-consent-link-${row.partyId}`}>
                          Copy consent link
                        </Button>
                      </div>
                    )}
                    {draft.consentStatus === "excluded" && (
                      <Textarea
                        value={draft.exclusionReason}
                        onChange={(event) => updatePartyFollowUpConsent(row.partyId, { exclusionReason: event.target.value })}
                        className="min-h-[72px]"
                        placeholder="Add the audit reason for excluding this client from follow-up..."
                        data-testid={`textarea-case-follow-up-exclusion-${row.partyId}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="case-close-life-satisfaction" className="text-xs font-medium">Life satisfaction</Label>
              <Input
                id="case-close-life-satisfaction"
                type="number"
                min={0}
                max={10}
                value={lifeSatisfaction}
                onChange={(event) => setLifeSatisfaction(event.target.value)}
                placeholder="0-10"
                data-testid="input-case-close-life-satisfaction"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-close-anxiety" className="text-xs font-medium">Anxiety score</Label>
              <Input
                id="case-close-anxiety"
                type="number"
                min={0}
                max={10}
                value={anxietyScore}
                onChange={(event) => setAnxietyScore(event.target.value)}
                placeholder="0-10"
                data-testid="input-case-close-anxiety"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-close-service-rating" className="text-xs font-medium">Service rating</Label>
              <Input
                id="case-close-service-rating"
                type="number"
                min={0}
                max={10}
                value={serviceRating}
                onChange={(event) => setServiceRating(event.target.value)}
                placeholder="0-10"
                data-testid="input-case-close-service-rating"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-close-nps" className="text-xs font-medium">Net Promoter Score</Label>
              <Input
                id="case-close-nps"
                type="number"
                min={0}
                max={10}
                value={netPromoterScore}
                onChange={(event) => setNetPromoterScore(event.target.value)}
                placeholder="0-10"
                data-testid="input-case-close-nps"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setCloseDialogOpen(false)} disabled={closeCaseMutation.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => closeCaseMutation.mutate()}
            disabled={closeCaseMutation.isPending || !closeReason || partyConsentRows.length === 0 || partyFollowUpMissingDecision || partyFollowUpMissingExclusionReason || (closeReason === "Other" && !closeDetails.trim())}
            data-testid="button-confirm-close-case"
          >
            {closeCaseMutation.isPending ? "Closing..." : "Close case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function StageProgressCard({ caseData, caseId }: { caseData: CaseDetail; caseId: string }) {
  const { canEdit } = usePermissions();
  const { toast } = useToast();
  const [stageTarget, setStageTarget] = useState<string | null>(null);
  const [referralName, setReferralName] = useState(caseData.referralPartnerName || "");
  const [referralCode, setReferralCode] = useState(caseData.referralPartnerCode || "");
  const [closureText, setClosureText] = useState(caseData.closureDetails || "");

  const stageMutation = useMutation({
    mutationFn: async (stage: string) => {
      await apiRequest("PATCH", `/api/cases/${caseId}/stage`, { stage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setStageTarget(null);
      toast({ title: "Case stage updated" });
    },
    onError: () => {
      toast({ title: "Failed to update stage", variant: "destructive" });
    },
  });

  const referralMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/referral`, { referralPartnerName: referralName, referralPartnerCode: referralCode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({ title: "Referral details saved" });
    },
    onError: () => {
      toast({ title: "Failed to save referral details", variant: "destructive" });
    },
  });

  const closureMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/closure-details`, { closureDetails: closureText });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({ title: "Closure details saved" });
    },
    onError: () => {
      toast({ title: "Failed to save closure details", variant: "destructive" });
    },
  });

  // Task #195: courtFormMutation + courtFormType removed alongside the
  // "Download placeholder court form" mini-button. Court-form actions now
  // live exclusively under the Documents tab → DocumentsCourtFormsSection.

  // Task #198 fix — fetch case appointments so additional-party (C/D+) MIAM
  // rows can show real Booked/Attended/Completed status derived from the
  // party's actual appointments rather than the case-stage-only A/B helper.
  const { data: stageAppointments } = useQuery<AppointmentLike[]>({
    queryKey: ["/api/appointments/case", caseId, "stage-progress"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/case/${caseId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: miamProgressRecords } = useQuery<MiamProgressRecord[]>({
    queryKey: ["/api/miam-records/case", caseId, "stage-progress"],
    queryFn: async () => {
      const res = await fetch(`/api/miam-records/case/${caseId}`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data)) return data;
      return Array.isArray(data?.records) ? data.records : [];
    },
    enabled: !!caseId,
  });

  const { data: mediationSessionsProgress } = useQuery<MediationSessionsResponse>({
    queryKey: ["/api/cases", caseId, "mediation-sessions"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/mediation-sessions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load mediation sessions");
      return res.json();
    },
    enabled: !!caseId,
  });

  const currentIdx = MAIN_WORKFLOW_STAGES.indexOf(caseData.stage);
  const isLegacySessionStage = currentIdx >= 14 && currentIdx <= 24;
  const isAuxiliaryStage = !STEPPER_CANONICAL_STAGES.has(caseData.stage) && !isLegacySessionStage;
  const isCourtFormStage = currentIdx >= 8 && currentIdx <= 13;
  const auxiliaryStages = (CASE_STAGES as readonly string[]).filter(s => !MAIN_WORKFLOW_STAGES.includes(s));
  const fallbackParties = [caseData.partyA, caseData.partyB].filter((p): p is PartyWithMediators => !!p);
  const miamParties = [...(caseData.parties ?? fallbackParties)]
    .sort((a, b) => (a.role || "").localeCompare(b.role || ""));
  const readiness = mediationSessionsProgress?.readiness;
  const sessions = [...(mediationSessionsProgress?.sessions ?? [])].sort((a, b) => a.sessionNumber - b.sessionNumber);
  const hasOpenSession = sessions.some((session) => session.status !== "completed" && session.status !== "cancelled");
  const sessionItems: StepItem[] = [
    ...sessions.map((session) => ({ kind: "session" as const, session })),
    ...(readiness?.ready && !hasOpenSession ? [{ kind: "sessionPlaceholder" as const, label: `Ready to allocate S${sessions.length + 1}` }] : []),
  ];

  // Build dynamic stepper groups: Enquiry → MIAM A → MIAM B → MIAM C/D… → Mediation Sessions
  const stepperGroups: { label: string; items: StepItem[] }[] = [
    {
      label: "Enquiry",
      items: [{ kind: "canonical", label: "Enquiry", stage: MAIN_WORKFLOW_STAGES[0] }],
    },
    ...miamParties.map((p) => ({
      label: `MIAM ${(p.role || "").toUpperCase()}`,
      items: MIAM_MILESTONES.map((m) => ({
        kind: "derivedMiam" as const,
        label: m,
        partyId: p.id,
        milestone: m,
      })),
    })),
    {
      label: "Mediation readiness",
      items: [{ kind: "mediationReady" as const, label: "Case suitable for mediation" }],
    },
    ...(sessionItems.length > 0 ? [{ label: "Mediation Sessions", items: sessionItems }] : []),
  ];

  const isReferralStage = REFERRAL_STAGES.includes(caseData.stage);
  const isClosureStage = CLOSURE_STAGES.includes(caseData.stage);

  return (
    <>
      <Card data-testid="card-stage-progress">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#5a7d58]" />
              Case Progress
            </CardTitle>
            {canEdit("cases") && (
              <Select
                value={caseData.stage}
                onValueChange={(val) => setStageTarget(val)}
              >
                <SelectTrigger className="w-[320px] h-8 text-xs" data-testid="select-stage">
                  <SelectValue placeholder="Change stage..." />
                </SelectTrigger>
                <SelectContent className="max-h-[400px]">
                  <SelectGroup>
                    <SelectLabel>Main Workflow</SelectLabel>
                    {MAIN_WORKFLOW_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectGroup>
                  {auxiliaryStages.length > 0 && (
                    <SelectGroup>
                      <SelectSeparator />
                      <SelectLabel>Alternative Outcomes</SelectLabel>
                      {auxiliaryStages.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isAuxiliaryStage && (
            <div className="rounded-lg bg-[#dcae96]/10 border border-[#dcae96]/30 p-3 mb-4" data-testid="auxiliary-stage-indicator">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-full border-2 border-[#b8825a] bg-[#b8825a] text-white shrink-0">
                  <span className="text-xs font-bold">!</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#b8825a]">{caseData.stage}</p>
                  <p className="text-xs text-[#b8825a]/70">{isCourtFormStage ? "Current stage — tracked per party in the Court Forms card below" : "Current stage (alternative pathway)"}</p>
                </div>
              </div>
            </div>
          )}
          <div className="overflow-x-auto pb-2">
            <div className="space-y-3 min-w-max">
              {stepperGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 ml-1">{group.label}</p>
                  <div className="flex items-start">
                    {group.items.map((item, idx) => {
                      const isLast = idx === group.items.length - 1;
                      let isCompleted = false;
                      let isCurrent = false;
                      let isMuted = false;
                      let testId = "";
                      let displayLabel = "";
                      let statusText: string | null = null;
                      if (item.kind === "canonical") {
                        const globalIdx = MAIN_WORKFLOW_STAGES.indexOf(item.stage);
                        isCompleted = currentIdx >= 0 && globalIdx < currentIdx;
                        isCurrent = globalIdx === currentIdx;
                        testId = `stage-step-${globalIdx}`;
                        displayLabel = capitalize(item.label);
                      } else if (item.kind === "derivedMiam") {
                        const state = deriveMiamCellStateFromRecord(item.milestone, item.partyId, miamProgressRecords, stageAppointments);
                        isCompleted = state === "Done";
                        isCurrent = state === "In progress";
                        testId = `stage-step-miam-${item.partyId}-${item.milestone.toLowerCase()}`;
                        displayLabel = item.label;
                      } else if (item.kind === "mediationReady") {
                        isCompleted = !!readiness?.ready && sessions.length > 0;
                        isCurrent = !!readiness?.ready && sessions.length === 0;
                        testId = "stage-step-mediation-ready";
                        displayLabel = item.label;
                        statusText = readiness ? (readiness.ready ? "Ready" : "Blocked") : "Checking";
                      } else if (item.kind === "session") {
                        isCompleted = item.session.status === "completed";
                        isCurrent = item.session.status === "allocated" || item.session.status === "scheduled";
                        isMuted = item.session.status === "cancelled";
                        testId = `stage-step-session-${item.session.sessionNumber}`;
                        displayLabel = `S${item.session.sessionNumber}`;
                        statusText = sessionStatusLabel(item.session.status);
                      } else {
                        isCurrent = true;
                        testId = "stage-step-session-ready-to-allocate";
                        displayLabel = item.label;
                        statusText = "Ready";
                      }
                      return (
                        <div key={`${group.label}-${idx}`} className="flex items-start" data-testid={testId}>
                          <div className="flex flex-col items-center" style={{ width: "68px" }}>
                            <div className={`flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 ${
                              isCurrent
                                ? "border-[#5a7d58] bg-[#5a7d58] text-white"
                                : isCompleted
                                  ? "border-[#a7baa4] bg-[#a7baa4]/20 text-[#5a7d58]"
                                  : isMuted
                                    ? "border-muted-foreground/20 bg-muted text-muted-foreground/50"
                                    : "border-muted-foreground/30 bg-background text-muted-foreground/40"
                            }`}>
                              {isCompleted ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : isMuted ? (
                                <X className="w-3.5 h-3.5" />
                              ) : (
                                <Circle className="w-3 h-3" />
                              )}
                            </div>
                            <p className={`text-[9px] leading-tight text-center mt-1 px-0.5 ${
                              isCurrent
                                ? "font-semibold text-[#5a7d58]"
                                : isCompleted
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                            }`}>
                              {displayLabel}
                            </p>
                            {statusText && (
                              <p className="text-[8px] leading-tight text-center mt-0.5 text-muted-foreground" data-testid={`${testId}-status`}>
                                {statusText}
                              </p>
                            )}
                          </div>
                          {!isLast && (
                            <div className="flex items-center" style={{ marginTop: "10px" }}>
                              <div className={`h-0.5 w-4 ${
                                isCompleted ? "bg-[#a7baa4]" : "bg-muted-foreground/15"
                              }`} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {readiness && !readiness.ready && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2" data-testid="case-progress-mediation-readiness-blockers">
              <p className="text-xs font-semibold text-amber-800">Mediation sessions are blocked until every party has an approved suitable MIAM.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {readiness.issues.map((issue) => (
                  <Badge key={`${issue.partyId}-${issue.reason}`} variant="outline" className="border-amber-300 bg-white text-amber-800 text-[10px]">
                    Client {issue.role}: {issue.label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground italic" data-testid="text-stepper-caption">
            Court Forms progress is tracked per party in the card below. Mediation sessions are derived from live session records.
          </p>

          {isReferralStage && canEdit("cases") && (
            <div className="mt-4 p-3 rounded-lg border border-[#dcae96]/40 bg-[#dcae96]/5 space-y-3" data-testid="referral-details-section">
              <p className="text-xs font-semibold text-[#b8825a]">Referral Partner Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Partner Name</Label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    value={referralName}
                    onChange={(e) => setReferralName(e.target.value)}
                    placeholder="Partner organisation name"
                    data-testid="input-referral-partner-name"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Referrer Code</Label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value)}
                    placeholder="Referrer code for fee tracking"
                    data-testid="input-referral-partner-code"
                  />
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-[#dcae96] text-[#b8825a] hover:bg-[#dcae96]/10"
                onClick={() => referralMutation.mutate()}
                disabled={referralMutation.isPending}
                data-testid="button-save-referral"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {referralMutation.isPending ? "Saving..." : "Save Referral Details"}
              </Button>
            </div>
          )}

          {isClosureStage && canEdit("cases") && (
            <div className="mt-4 p-3 rounded-lg border border-muted-foreground/20 bg-muted/30 space-y-3" data-testid="closure-details-section">
              <p className="text-xs font-semibold">Closure Details</p>
              <Textarea
                value={closureText}
                onChange={(e) => setClosureText(e.target.value)}
                placeholder="Enter closure details, reasons, and any relevant notes..."
                className="min-h-[80px] text-sm"
                data-testid="textarea-closure-details"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => closureMutation.mutate()}
                disabled={closureMutation.isPending}
                data-testid="button-save-closure"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {closureMutation.isPending ? "Saving..." : "Save Closure Details"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!stageTarget && stageTarget !== caseData.stage} onOpenChange={(open) => { if (!open) setStageTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change case stage?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the case from "{caseData.stage}" to "{stageTarget}". This change will be reflected across all views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-stage-change">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
              onClick={() => stageTarget && stageMutation.mutate(stageTarget)}
              data-testid="button-confirm-stage-change"
            >
              {stageMutation.isPending ? "Updating..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CaseNotesCard({ caseData, caseId }: { caseData: CaseDetail; caseId: string }) {
  const { canEdit } = usePermissions();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editedNotes, setEditedNotes] = useState(caseData.notes || "");

  const notesMutation = useMutation({
    mutationFn: async (notes: string) => {
      await apiRequest("PATCH", `/api/cases/${caseId}/notes`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setEditing(false);
      toast({ title: "Case notes updated" });
    },
    onError: () => {
      toast({ title: "Failed to update notes", variant: "destructive" });
    },
  });

  const handleStartEdit = () => {
    setEditedNotes(caseData.notes || "");
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditedNotes(caseData.notes || "");
  };

  return (
    <Card data-testid="card-case-notes">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#5a7d58]" />
            Case Notes
          </CardTitle>
          {canEdit("cases") && !editing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleStartEdit}
              data-testid="button-edit-case-notes"
            >
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3" data-testid="form-edit-case-notes">
            <Textarea
              value={editedNotes}
              onChange={(e) => setEditedNotes(e.target.value)}
              placeholder="Add case notes, observations, or general information..."
              className="min-h-[120px] text-sm"
              data-testid="textarea-case-notes"
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={notesMutation.isPending}
                data-testid="button-cancel-notes"
              >
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                onClick={() => notesMutation.mutate(editedNotes)}
                disabled={notesMutation.isPending}
                data-testid="button-save-notes"
              >
                {notesMutation.isPending ? "Saving..." : <><Save className="w-3 h-3 mr-1" /> Save</>}
              </Button>
            </div>
          </div>
        ) : caseData.notes ? (
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap" data-testid="text-case-notes">{caseData.notes}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic" data-testid="text-case-notes-empty">No case notes recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PersistentRecentActivityCard({
  caseId,
  isStaff,
  onViewAll,
}: {
  caseId: string;
  isStaff: boolean;
  onViewAll: () => void;
}) {
  return (
    <Card className="lg:sticky lg:top-6" data-testid="card-persistent-recent-activity">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#b8825a]" />
            Recent Activity
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onViewAll}
            data-testid="button-view-all-activity"
          >
            View all
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ActivityTimeline caseId={caseId} isStaff={isStaff} compact maxItems={5} />
      </CardContent>
    </Card>
  );
}


function DemographicDataTab({ caseId, caseData, isStaff }: { caseId: string; caseData: CaseDetail; isStaff: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const isClient = user?.role === "client";

  const { data: demographicRecords, isLoading } = useQuery<any[]>({
    queryKey: ["/api/demographic-data/case", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/demographic-data/case/${caseId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load demographic data");
      return res.json();
    },
    enabled: !!caseId,
  });

  const sendFormMutation = useMutation({
    mutationFn: async (partyId: string) => {
      await apiRequest("POST", `/api/demographic-data/send-form/${partyId}`);
    },
    onSuccess: () => {
      toast({ title: "Demographic form sent", description: "The client will receive an email with a link to complete their demographic information." });
    },
    onError: () => {
      toast({ title: "Failed to send form", variant: "destructive" });
    },
  });

  const allParties = caseData.parties ?? [
    ...(caseData.partyA ? [caseData.partyA] : []),
    ...(caseData.partyB ? [caseData.partyB] : []),
  ];
  // For client portal, the server already returns only their own party in parties[],
  // but apply a fail-CLOSED defence-in-depth filter on the client too: if the
  // server hasn't told us which party belongs to this client (`userPartyRole`
  // missing), show NOTHING rather than every party.
  const visibleParties = isClient
    ? allParties.filter((p) => !!caseData.userPartyRole && p.role === caseData.userPartyRole)
    : allParties;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {visibleParties.map((party) => {
        const data = demographicRecords?.find((d: any) => d.partyId === party.id);
        return (
          <DemographicPartyCard
            key={party.id}
            party={party}
            data={data}
            role={party.role}
            caseId={caseId}
            issueType={caseData.issueType || ""}
            isStaff={isStaff}
            isAdmin={isAdmin}
            isClient={!!isClient}
            canEditCases={canEdit("cases")}
            onSendForm={() => sendFormMutation.mutate(party.id)}
            sendingForm={sendFormMutation.isPending}
          />
        );
      })}
      {/* Demographic tab is the "add another party" entry point — only show
          the card when at least one party already exists, so we never offer
          to add Party A from this card (Party A is created automatically
          from the originating enquiry). */}
      {isStaff && canEdit("cases") && caseData.nextRoleLetter && allParties.length > 0 && (
        <AddPartyCard caseId={caseId} nextRoleLetter={caseData.nextRoleLetter} />
      )}
    </div>
  );
}

function DemographicFieldRow({ label, value }: { label: string; value?: string | boolean | number | null }) {
  let display: string;
  if (value === null || value === undefined || value === "") display = "—";
  else if (typeof value === "boolean") display = value ? "Yes" : "No";
  else display = String(value);

  return (
    <div className="grid grid-cols-2 gap-2 py-1.5 border-b border-muted/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm ${display === "—" ? "text-muted-foreground italic" : ""}`}>{display}</span>
    </div>
  );
}

function DemographicPartyCard({ party, data, role, caseId, issueType, isStaff, isAdmin, isClient, canEditCases, onSendForm, sendingForm }: {
  party: PartyWithMediators;
  data: any;
  role: string;
  caseId: string;
  issueType: string;
  isStaff: boolean;
  isAdmin: boolean;
  isClient: boolean;
  canEditCases: boolean;
  onSendForm: () => void;
  sendingForm: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});

  const saveMutation = useMutation({
    mutationFn: async (formData: Record<string, any>) => {
      await apiRequest("PUT", `/api/demographic-data/party/${party.id}`, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/demographic-data/case", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      void refreshClientDashboardActions();
      setEditing(false);
      toast({ title: "Demographic data saved" });
    },
    onError: () => {
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const startEditing = () => {
    setEditData({
      dateOfBirth: data?.dateOfBirth || party.dateOfBirth || "",
      genderIdentity: data?.genderIdentity || party.gender || "",
      genderSelfDescription: data?.genderSelfDescription || "",
      ethnicity: data?.ethnicity || party.ethnicOrigin || "",
      ethnicSelfDisclose: data?.ethnicSelfDisclose || "",
      countryOfBirth: data?.countryOfBirth || "",
      countryOfBirthOther: data?.countryOfBirthOther || "",
      firstLanguage: data?.firstLanguage || "",
      firstLanguageOther: data?.firstLanguageOther || "",
      interpreterNeeded: data?.interpreterNeeded || "",
      interpreterLanguage: data?.interpreterLanguage || "",
      disabilityOrHealthConditions: data?.disabilityOrHealthConditions || party.disabilityOrHealthCondition || "",
      additionalNeeds: data?.additionalNeeds || party.additionalNeeds || "",
      employmentStatus: data?.employmentStatus || "",
      legalAidEligible: data?.legalAidEligible || "",
      voucherSchemeEligible: data?.voucherSchemeEligible || "",
      familyCaseSubtype: data?.familyCaseSubtype || "",
      workplaceCaseSubtype: data?.workplaceCaseSubtype || "",
      courtProceedingsStatus: data?.courtProceedingsStatus || "",
      courtReference: data?.courtReference || "",
      courtName: data?.courtName || "",
      cafcassInvolved: data?.cafcassInvolved || "",
      solicitorInvolved: data?.solicitorInvolved || "",
      solicitorName: data?.solicitorName || "",
      childrenAges: data?.childrenAges || "",
      lifeSatisfaction: data?.lifeSatisfaction ?? "",
      anxietyScore: data?.anxietyScore ?? "",
      emotionalWellbeing: data?.emotionalWellbeing ?? "",
    });
    setEditing(true);
  };

  const isCompleted = !!data?.completedAt;

  return (
    <Card data-testid={`card-demographic-party-${role.toLowerCase()}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-heading">
              Client {role}: {party.firstName} {party.lastName}
            </CardTitle>
            {isCompleted ? (
              <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Completed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">
                <Clock className="w-3 h-3 mr-1" /> Pending
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {isStaff && canEditCases && party.email && !editing && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onSendForm}
                disabled={sendingForm}
                data-testid={`button-send-demographic-form-${role.toLowerCase()}`}
              >
                <Send className="w-3 h-3 mr-1" />
                {sendingForm ? "Sending..." : "Send Demographic Data Form"}
              </Button>
            )}
            {(isStaff && canEditCases || isClient) && !editing && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={startEditing}
                data-testid={`button-edit-demographic-${role.toLowerCase()}`}
              >
                <Pencil className="w-3 h-3 mr-1" /> Edit
              </Button>
            )}
          </div>
        </div>
        {isCompleted && (
          <p className="text-xs text-muted-foreground mt-1">
            Completed by {data.completedBy} on {new Date(data.completedAt).toLocaleDateString("en-GB", {
              day: "numeric", month: "short", year: "numeric"
            })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <DemographicEditForm
            data={editData}
            onChange={setEditData}
            onSave={(payload) => saveMutation.mutate(payload)}
            onCancel={() => setEditing(false)}
            saving={saveMutation.isPending}
            isStaff={isStaff}
            issueType={issueType}
          />
        ) : (
          <DemographicReadView data={data} party={party} isStaff={isStaff} />
        )}
      </CardContent>
    </Card>
  );
}

function formatMultiSelect(val: any): string {
  if (!val) return "—";
  const arr = parseMultiSelectValue(val);
  return arr.length > 0 ? arr.join(", ") : "—";
}

function DemographicReadView({ data, party, isStaff }: { data: any; party: PartyWithMediators; isStaff: boolean }) {
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground italic" data-testid="text-demographic-empty">
        No demographic data has been submitted yet. Use "Send Demographic Data Form" to invite the client to complete the form, or click "Edit" to enter the data manually.
      </p>
    );
  }

  const countryDisplay = (data.countryOfBirth === "EU country (specify)" || data.countryOfBirth === "Other country (specify)")
    ? `${data.countryOfBirth}: ${data.countryOfBirthOther || "not specified"}`
    : data.countryOfBirth;

  const langDisplay = data.firstLanguage === "Other (specify below)"
    ? `Other: ${data.firstLanguageOther || "not specified"}`
    : data.firstLanguage;

  const wellbeingDisplay = data.emotionalWellbeing != null
    ? `${data.emotionalWellbeing} - ${EMOTIONAL_WELLBEING_LABELS[data.emotionalWellbeing as number] || ""}`
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Personal Information</h4>
        <DemographicFieldRow label="Date of Birth" value={data.dateOfBirth} />
        <DemographicFieldRow label="Gender Identity" value={data.genderIdentity} />
        {data.genderSelfDescription && <DemographicFieldRow label="Gender Description" value={data.genderSelfDescription} />}
        <DemographicFieldRow label="Ethnicity" value={data.ethnicity} />
        {data.ethnicSelfDisclose && <DemographicFieldRow label="Ethnicity (self-disclosed)" value={data.ethnicSelfDisclose} />}
        <DemographicFieldRow label="Country of Birth" value={countryDisplay} />
        <DemographicFieldRow label="First Language" value={langDisplay} />
        <DemographicFieldRow label="Interpreter Support" value={data.interpreterNeeded} />
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Health & Needs</h4>
        <DemographicFieldRow label="Disability/Health Conditions" value={formatMultiSelect(data.disabilityOrHealthConditions)} />
        <DemographicFieldRow label="Additional Needs" value={data.additionalNeeds} />

        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4">Employment & Financial</h4>
        <DemographicFieldRow label="Employment Status" value={data.employmentStatus} />
        <DemographicFieldRow label="Legal Aid Eligible" value={data.legalAidEligible} />
        <DemographicFieldRow label="Voucher Scheme Eligible" value={data.voucherSchemeEligible} />
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Legal & Court</h4>
        <DemographicFieldRow label="Court Proceedings" value={data.courtProceedingsStatus} />
        {data.courtReference && <DemographicFieldRow label="Court Reference" value={data.courtReference} />}
        {data.courtName && <DemographicFieldRow label="Court Name" value={data.courtName} />}
        <DemographicFieldRow label="CAFCASS Involved" value={data.cafcassInvolved} />
        <DemographicFieldRow label="Solicitor Acting" value={data.solicitorInvolved} />
        {data.solicitorName && <DemographicFieldRow label="Solicitor Name" value={data.solicitorName} />}
        <DemographicFieldRow label="Children Ages" value={data.childrenAges} />
        {isStaff && data.familyCaseSubtype && <DemographicFieldRow label="Family Case Subtype" value={formatMultiSelect(data.familyCaseSubtype)} />}
        {isStaff && data.workplaceCaseSubtype && <DemographicFieldRow label="Workplace Case Subtype" value={formatMultiSelect(data.workplaceCaseSubtype)} />}
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Baseline Wellbeing</h4>
        <DemographicFieldRow label="Life Satisfaction (0-10)" value={data.lifeSatisfaction} />
        <DemographicFieldRow label="Anxiety Score (0-10)" value={data.anxietyScore} />
        <DemographicFieldRow label="Emotional Wellbeing (1-5)" value={wellbeingDisplay} />
      </div>
    </div>
  );
}

function parseMultiSelectValue(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return val ? [val] : []; }
}

function DemographicMultiCheckbox({ options, selected, onChange, testId }: {
  options: readonly string[];
  selected: string[];
  onChange: (v: string[]) => void;
  testId: string;
}) {
  const handleToggle = (opt: string) => {
    if (opt === "None") {
      onChange(selected.includes("None") ? [] : ["None"]);
      return;
    }
    let next = selected.filter(s => s !== "None");
    if (next.includes(opt)) {
      next = next.filter(s => s !== opt);
    } else {
      next.push(opt);
    }
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" data-testid={testId}>
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
          <Checkbox
            checked={selected.includes(opt)}
            onCheckedChange={() => handleToggle(opt)}
          />
          <span className="leading-tight">{opt}</span>
        </label>
      ))}
    </div>
  );
}

function DemographicEditForm({ data, onChange, onSave, onCancel, saving, isStaff, issueType }: {
  data: Record<string, any>;
  onChange: (d: Record<string, any>) => void;
  onSave: (payload: Record<string, any>) => void;
  onCancel: () => void;
  saving: boolean;
  isStaff: boolean;
  issueType: string;
}) {
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = (key: string, value: any) => {
    onChange({ ...data, [key]: value });
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };
  const disabilityArr = parseMultiSelectValue(data.disabilityOrHealthConditions);
  const familySubArr = parseMultiSelectValue(data.familyCaseSubtype);
  const workplaceSubArr = parseMultiSelectValue(data.workplaceCaseSubtype);

  const isWorkplaceCase = /workplace|employment|grievance/i.test(issueType || "");

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!data.genderIdentity) newErrors.genderIdentity = "Gender identity is required";
    if (!data.ethnicity) newErrors.ethnicity = "Ethnicity is required";
    if (!data.firstLanguage) newErrors.firstLanguage = "First language is required";
    if (!data.interpreterNeeded) newErrors.interpreterNeeded = "Interpreter support selection is required";
    if (!data.employmentStatus) newErrors.employmentStatus = "Employment status is required";
    if (!data.legalAidEligible) newErrors.legalAidEligible = "Legal aid selection is required";
    if (!data.voucherSchemeEligible) newErrors.voucherSchemeEligible = "Voucher scheme selection is required";
    if (!data.courtProceedingsStatus) newErrors.courtProceedingsStatus = "Court proceedings status is required";
    if (!data.cafcassInvolved) newErrors.cafcassInvolved = "CAFCASS involvement is required";
    if (data.lifeSatisfaction === "" || data.lifeSatisfaction == null) newErrors.lifeSatisfaction = "Life satisfaction score is required";
    if (data.anxietyScore === "" || data.anxietyScore == null) newErrors.anxietyScore = "Anxiety score is required";
    if (data.emotionalWellbeing === "" || data.emotionalWellbeing == null) newErrors.emotionalWellbeing = "Emotional wellbeing score is required";
    if (isStaff && !isWorkplaceCase && familySubArr.length === 0) newErrors.familyCaseSubtype = "At least one family subtype is required";
    if (isStaff && isWorkplaceCase && workplaceSubArr.length === 0) newErrors.workplaceCaseSubtype = "At least one workplace subtype is required";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast({ title: "Please complete all required fields", variant: "destructive" });
      return;
    }

    const payload = {
      ...data,
      disabilityOrHealthConditions: disabilityArr.length ? JSON.stringify(disabilityArr) : null,
      familyCaseSubtype: familySubArr.length ? JSON.stringify(familySubArr) : null,
      workplaceCaseSubtype: workplaceSubArr.length ? JSON.stringify(workplaceSubArr) : null,
    };
    onSave(payload);
  };

  const FieldError = ({ field }: { field: string }) => errors[field] ? <p className="text-xs text-red-500 mt-0.5">{errors[field]}</p> : null;

  return (
    <div className="space-y-6" data-testid="form-edit-demographic">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Date of Birth</Label>
          <Input type="date" value={data.dateOfBirth || ""} onChange={(e) => update("dateOfBirth", e.target.value)} data-testid="input-edit-dob" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Gender Identity <span className="text-red-500">*</span></Label>
          <Select value={data.genderIdentity || ""} onValueChange={(v) => update("genderIdentity", v)}>
            <SelectTrigger data-testid="select-edit-gender" className={errors.genderIdentity ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {GENDERS.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError field="genderIdentity" />
        </div>
        {data.genderIdentity === "Self-describe" && (
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs">Gender Self-Description</Label>
            <Input value={data.genderSelfDescription || ""} onChange={(e) => update("genderSelfDescription", e.target.value)} data-testid="input-edit-gender-desc" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Ethnicity <span className="text-red-500">*</span></Label>
          <Select value={data.ethnicity || ""} onValueChange={(v) => update("ethnicity", v)}>
            <SelectTrigger data-testid="select-edit-ethnicity" className={errors.ethnicity ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {Object.entries(ETHNIC_GROUPS).map(([group, options]) => (
                <SelectGroup key={group}>
                  <SelectLabel className="text-xs font-semibold text-muted-foreground">{group}</SelectLabel>
                  {options.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt.replace(/^(White|Mixed|Asian|Black|Other) - /, "")}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <FieldError field="ethnicity" />
        </div>
        {data.ethnicity === "Self-disclose" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Please describe your ethnicity</Label>
            <Input value={data.ethnicSelfDisclose || ""} onChange={(e) => update("ethnicSelfDisclose", e.target.value)} data-testid="input-edit-ethnic-self" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Country of Birth</Label>
          <Select value={data.countryOfBirth || ""} onValueChange={(v) => update("countryOfBirth", v)}>
            <SelectTrigger data-testid="select-edit-country"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {COUNTRIES_OF_BIRTH.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(data.countryOfBirth === "EU country (specify)" || data.countryOfBirth === "Other country (specify)") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Specify Country</Label>
            <Input value={data.countryOfBirthOther || ""} onChange={(e) => update("countryOfBirthOther", e.target.value)} data-testid="input-edit-country-other" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">First Language <span className="text-red-500">*</span></Label>
          <Select value={data.firstLanguage || ""} onValueChange={(v) => update("firstLanguage", v)}>
            <SelectTrigger data-testid="select-edit-language" className={errors.firstLanguage ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {COMMON_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError field="firstLanguage" />
        </div>
        {data.firstLanguage === "Other (specify below)" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Specify Language</Label>
            <Input value={data.firstLanguageOther || ""} onChange={(e) => update("firstLanguageOther", e.target.value)} data-testid="input-edit-language-other" />
          </div>
        )}
      </div>

      <div className="space-y-4 border-t pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Health & Needs</h4>
        <div className="space-y-1.5">
          <Label className="text-xs">Disability / health condition(s) <span className="text-muted-foreground">(tick all that apply)</span></Label>
          <DemographicMultiCheckbox
            options={DISABILITY_OPTIONS}
            selected={disabilityArr}
            onChange={(v) => update("disabilityOrHealthConditions", v)}
            testId="checkbox-edit-disability"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Additional needs / reasonable adjustments</Label>
          <Textarea value={data.additionalNeeds || ""} onChange={(e) => update("additionalNeeds", e.target.value.slice(0, 500))} className="min-h-[50px] text-sm" maxLength={500} data-testid="textarea-edit-additional-needs" />
        </div>
      </div>

      <div className="space-y-4 border-t pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Employment & Financial</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Employment Status <span className="text-red-500">*</span></Label>
            <Select value={data.employmentStatus || ""} onValueChange={(v) => update("employmentStatus", v)}>
              <SelectTrigger data-testid="select-edit-employment" className={errors.employmentStatus ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="employmentStatus" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Interpreter or language support needed? <span className="text-red-500">*</span></Label>
            <Select value={data.interpreterNeeded || ""} onValueChange={(v) => update("interpreterNeeded", v)}>
              <SelectTrigger data-testid="select-edit-interpreter" className={errors.interpreterNeeded ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {INTERPRETER_SUPPORT_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="interpreterNeeded" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Legal aid eligible? <span className="text-red-500">*</span></Label>
            <Select value={data.legalAidEligible || ""} onValueChange={(v) => update("legalAidEligible", v)}>
              <SelectTrigger data-testid="select-edit-legal-aid" className={errors.legalAidEligible ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {LEGAL_AID_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="legalAidEligible" />
            {data.legalAidEligible === "Yes" && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
                Note: BFM does not offer legal aid funding. Check eligibility at{" "}
                <a href="https://www.gov.uk/check-legal-aid" target="_blank" rel="noopener noreferrer" className="underline font-medium">www.gov.uk/check-legal-aid</a>
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Voucher scheme eligible? <span className="text-red-500">*</span></Label>
            <Select value={data.voucherSchemeEligible || ""} onValueChange={(v) => update("voucherSchemeEligible", v)}>
              <SelectTrigger data-testid="select-edit-voucher" className={errors.voucherSchemeEligible ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {VOUCHER_SCHEME_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="voucherSchemeEligible" />
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Legal & Court</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Currently in court proceedings? <span className="text-red-500">*</span></Label>
            <Select value={data.courtProceedingsStatus || ""} onValueChange={(v) => update("courtProceedingsStatus", v)}>
              <SelectTrigger data-testid="select-edit-court" className={errors.courtProceedingsStatus ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {COURT_PROCEEDINGS_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="courtProceedingsStatus" />
          </div>
          {(data.courtProceedingsStatus === "Yes - active proceedings" || data.courtProceedingsStatus === "Yes - proceedings threatened or imminent") && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Court Reference Number</Label>
                <Input value={data.courtReference || ""} onChange={(e) => update("courtReference", e.target.value)} data-testid="input-edit-court-ref" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Court Name and Location</Label>
                <Input value={data.courtName || ""} onChange={(e) => update("courtName", e.target.value)} placeholder="e.g. Bromley Family Court" data-testid="input-edit-court-name" />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">CAFCASS involvement? <span className="text-red-500">*</span></Label>
            <Select value={data.cafcassInvolved || ""} onValueChange={(v) => update("cafcassInvolved", v)}>
              <SelectTrigger data-testid="select-edit-cafcass" className={errors.cafcassInvolved ? "border-red-500" : ""}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {CAFCASS_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="cafcassInvolved" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Solicitor acting for client?</Label>
            <Select value={data.solicitorInvolved || ""} onValueChange={(v) => update("solicitorInvolved", v)}>
              <SelectTrigger data-testid="select-edit-solicitor"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {SOLICITOR_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data.solicitorInvolved === "Yes" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Solicitor Name/Firm</Label>
              <Input value={data.solicitorName || ""} onChange={(e) => update("solicitorName", e.target.value)} data-testid="input-edit-solicitor" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Ages of Children</Label>
            <Input value={data.childrenAges || ""} onChange={(e) => update("childrenAges", e.target.value)} placeholder="e.g. 4, 7, 12" data-testid="input-edit-children-ages" />
          </div>
        </div>
      </div>

      {isStaff && (
        <div className="space-y-4 border-t pt-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Case Subtypes (Staff Only)</h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {!isWorkplaceCase && (
              <div className="space-y-1.5">
                <Label className="text-xs">Family Case Subtype <span className="text-red-500">*</span> <span className="text-muted-foreground">(tick all that apply)</span></Label>
                <DemographicMultiCheckbox
                  options={FAMILY_CASE_SUBTYPES}
                  selected={familySubArr}
                  onChange={(v) => update("familyCaseSubtype", v)}
                  testId="checkbox-edit-family-subtype"
                />
                <FieldError field="familyCaseSubtype" />
              </div>
            )}
            {isWorkplaceCase && (
              <div className="space-y-1.5">
                <Label className="text-xs">Workplace Case Subtype <span className="text-red-500">*</span> <span className="text-muted-foreground">(tick all that apply)</span></Label>
                <DemographicMultiCheckbox
                  options={WORKPLACE_CASE_SUBTYPES}
                  selected={workplaceSubArr}
                  onChange={(v) => update("workplaceCaseSubtype", v)}
                  testId="checkbox-edit-workplace-subtype"
                />
                <FieldError field="workplaceCaseSubtype" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4 border-t pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Baseline Wellbeing Scores</h4>
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium">Life Satisfaction <span className="text-red-500">*</span></Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Overall, how satisfied are you with your life nowadays? (0 = not at all, 10 = completely)</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-4">0</span>
              <Slider
                value={[data.lifeSatisfaction ?? 5]}
                onValueChange={([v]) => update("lifeSatisfaction", v)}
                min={0}
                max={10}
                step={1}
                className="flex-1"
                data-testid="slider-edit-life-satisfaction"
              />
              <span className="text-xs text-muted-foreground w-4">10</span>
              <span className="text-sm font-semibold w-8 text-center bg-muted rounded px-1 py-0.5">{data.lifeSatisfaction ?? "—"}</span>
            </div>
            <FieldError field="lifeSatisfaction" />
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium">Anxiety <span className="text-red-500">*</span></Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Overall, how anxious did you feel yesterday? (0 = not at all, 10 = completely)</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-4">0</span>
              <Slider
                value={[data.anxietyScore ?? 5]}
                onValueChange={([v]) => update("anxietyScore", v)}
                min={0}
                max={10}
                step={1}
                className="flex-1"
                data-testid="slider-edit-anxiety"
              />
              <span className="text-xs text-muted-foreground w-4">10</span>
              <span className="text-sm font-semibold w-8 text-center bg-muted rounded px-1 py-0.5">{data.anxietyScore ?? "—"}</span>
            </div>
            <FieldError field="anxietyScore" />
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium">Emotional Wellbeing <span className="text-red-500">*</span></Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">How would you rate your emotional wellbeing right now? (1 = very poor, 5 = very good)</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-12">1 Very poor</span>
              <Slider
                value={[data.emotionalWellbeing ?? 3]}
                onValueChange={([v]) => update("emotionalWellbeing", v)}
                min={1}
                max={5}
                step={1}
                className="flex-1"
                data-testid="slider-edit-emotional-wellbeing"
              />
              <span className="text-xs text-muted-foreground w-12 text-right">5 Very good</span>
              <span className="text-sm font-semibold w-20 text-center bg-muted rounded px-1 py-0.5">
                {data.emotionalWellbeing ? `${data.emotionalWellbeing} - ${EMOTIONAL_WELLBEING_LABELS[data.emotionalWellbeing as number]}` : "—"}
              </span>
            </div>
            <FieldError field="emotionalWellbeing" />
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end border-t pt-4">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving} data-testid="button-cancel-demographic">
          <X className="w-3 h-3 mr-1" /> Cancel
        </Button>
        <Button size="sm" className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white" onClick={handleSave} disabled={saving} data-testid="button-save-demographic">
          {saving ? "Saving..." : <><Save className="w-3 h-3 mr-1" /> Save</>}
        </Button>
      </div>
    </div>
  );
}


function PaymentsTab({ caseId }: { caseId: string }) {
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canManageFinance = canEdit("finance");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<FinanceInvoice | null>(null);
  const [editingPayment, setEditingPayment] = useState<FinancePayment | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    billToClientId: "",
    billToPartyId: "",
    serviceTypeId: "",
    status: "issued",
    dueDate: "",
    description: "",
    amount: "",
    vatRate: "",
    notes: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    clientId: "",
    partyId: "",
    invoiceId: "",
    appointmentId: "",
    amount: "",
    paymentDate: dateInputValue(new Date()),
    method: "bank_transfer",
    paymentStatus: "paid",
    reference: "",
    notes: "",
  });

  const { data, isLoading } = useQuery<CaseFinanceResponse>({
    queryKey: ["/api/cases", caseId, "finance"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/finance`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load case finance records");
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: serviceTypes } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/service-types"],
  });

  const resetInvoiceForm = () => {
    const firstParty = data?.parties?.[0];
    setEditingInvoice(null);
    setInvoiceForm({
      billToClientId: firstParty?.clientId || "",
      billToPartyId: firstParty?.partyId || "",
      serviceTypeId: "",
      status: "issued",
      dueDate: "",
      description: "",
      amount: "",
      vatRate: "",
      notes: "",
    });
  };

  const resetPaymentForm = () => {
    const firstParty = data?.parties?.[0];
    setEditingPayment(null);
    setPaymentForm({
      clientId: firstParty?.clientId || "",
      partyId: firstParty?.partyId || "",
      invoiceId: "",
      appointmentId: "",
      amount: "",
      paymentDate: dateInputValue(new Date()),
      method: "bank_transfer",
      paymentStatus: "paid",
      reference: "",
      notes: "",
    });
  };

  const openInvoiceEditor = (invoice?: FinanceInvoice) => {
    if (invoice) {
      const firstLine = invoice.lineItems[0];
      setEditingInvoice(invoice);
      setInvoiceForm({
        billToClientId: invoice.billToClientId,
        billToPartyId: invoice.billToPartyId || "",
        serviceTypeId: invoice.serviceTypeId || "",
        status: invoice.status,
        dueDate: dateInputValue(invoice.dueDate),
        description: firstLine?.description || "",
        amount: firstLine ? String((firstLine.unitAmountPence || 0) / 100) : "",
        vatRate: firstLine?.vatRate === null || firstLine?.vatRate === undefined ? "" : String(firstLine.vatRate),
        notes: invoice.notes || "",
      });
    } else {
      resetInvoiceForm();
    }
    setInvoiceOpen(true);
  };

  const openPaymentEditor = (payment?: FinancePayment) => {
    if (payment) {
      setEditingPayment(payment);
      setPaymentForm({
        clientId: payment.clientId,
        partyId: payment.partyId || "",
        invoiceId: payment.invoiceId || "",
        appointmentId: payment.appointmentId || "",
        amount: String((payment.amountPence || 0) / 100),
        paymentDate: dateInputValue(payment.paymentDate),
        method: payment.method,
        paymentStatus: payment.paymentStatus || "paid",
        reference: payment.reference || "",
        notes: payment.notes || "",
      });
    } else {
      resetPaymentForm();
    }
    setPaymentOpen(true);
  };

  const openPaymentEditorFromInvoice = (invoice: FinanceInvoice) => {
    setEditingPayment(null);
    setPaymentForm({
      clientId: invoice.billToClientId,
      partyId: invoice.billToPartyId || "",
      invoiceId: invoice.id,
      appointmentId: invoice.appointmentId || "",
      amount: String((invoice.outstandingPence || invoice.totalPence || 0) / 100),
      paymentDate: dateInputValue(new Date()),
      method: "bank_transfer",
      paymentStatus: "paid",
      reference: invoice.invoiceNumber,
      notes: "Staff verified payment against Xero/bank records before marking this invoice paid.",
    });
    setPaymentOpen(true);
  };

  const saveInvoiceMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        billToClientId: invoiceForm.billToClientId,
        billToPartyId: invoiceForm.billToPartyId || null,
        serviceTypeId: invoiceForm.serviceTypeId || null,
        status: invoiceForm.status,
        dueDate: invoiceForm.dueDate ? new Date(invoiceForm.dueDate).toISOString() : null,
        notes: invoiceForm.notes || null,
        lineItems: [{
          serviceTypeId: invoiceForm.serviceTypeId || null,
          description: invoiceForm.description,
          quantity: 1,
          unitAmountPence: Math.round(Number(invoiceForm.amount || "0") * 100),
          vatRate: invoiceForm.vatRate === "" ? null : Number(invoiceForm.vatRate),
        }],
      };
      await apiRequest(
        editingInvoice ? "PATCH" : "POST",
        editingInvoice ? `/api/cases/${caseId}/invoices/${editingInvoice.id}` : `/api/cases/${caseId}/invoices`,
        payload,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "finance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setInvoiceOpen(false);
      toast({ title: editingInvoice ? "Invoice updated" : "Invoice created" });
    },
    onError: (err: Error) => toast({ title: "Invoice save failed", description: err.message, variant: "destructive" }),
  });

  const savePaymentMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        clientId: paymentForm.clientId,
        partyId: paymentForm.partyId || null,
        invoiceId: paymentForm.invoiceId || null,
        appointmentId: paymentForm.appointmentId || null,
        amountPence: Math.round(Number(paymentForm.amount || "0") * 100),
        paymentDate: paymentForm.paymentDate ? new Date(paymentForm.paymentDate).toISOString() : undefined,
        method: paymentForm.method,
        paymentStatus: paymentForm.paymentStatus,
        reference: paymentForm.reference || null,
        notes: paymentForm.notes || null,
      };
      await apiRequest(
        editingPayment ? "PATCH" : "POST",
        editingPayment ? `/api/cases/${caseId}/payments/${editingPayment.id}` : `/api/cases/${caseId}/payments`,
        payload,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "finance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setPaymentOpen(false);
      toast({ title: editingPayment ? "Payment updated" : "Payment recorded" });
    },
    onError: (err: Error) => toast({ title: "Payment save failed", description: err.message, variant: "destructive" }),
  });

  const voidInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => apiRequest("DELETE", `/api/cases/${caseId}/invoices/${invoiceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "finance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Invoice voided" });
    },
    onError: (err: Error) => toast({ title: "Could not void invoice", description: err.message, variant: "destructive" }),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => apiRequest("DELETE", `/api/cases/${caseId}/payments/${paymentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "finance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Payment deleted" });
    },
    onError: (err: Error) => toast({ title: "Could not delete payment", description: err.message, variant: "destructive" }),
  });

  const retryPaymentMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/cases/${caseId}/invoices/${invoiceId}/retry-payment-link`);
      return res.json() as Promise<{ checkoutUrl: string; checkoutSessionId: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "finance"] });
      toast({ title: "Payment link refreshed" });
    },
    onError: (err: Error) => toast({ title: "Could not refresh payment link", description: err.message, variant: "destructive" }),
  });

  const selectedPaymentClientInvoices = data?.invoices.filter((invoice) =>
    invoice.billToClientId === paymentForm.clientId && invoice.status !== "void",
  ) || [];

  useEffect(() => {
    const party = data?.parties.find((p) => p.clientId === invoiceForm.billToClientId);
    if (party && invoiceForm.billToPartyId !== party.partyId) {
      setInvoiceForm((current) => ({ ...current, billToPartyId: party.partyId }));
    }
  }, [data?.parties, invoiceForm.billToClientId, invoiceForm.billToPartyId]);

  useEffect(() => {
    const party = data?.parties.find((p) => p.clientId === paymentForm.clientId);
    if (party && paymentForm.partyId !== party.partyId) {
      setPaymentForm((current) => ({ ...current, partyId: party.partyId }));
    }
  }, [data?.parties, paymentForm.clientId, paymentForm.partyId]);

  const renderInvoiceRow = (invoice: FinanceInvoice, compact = false) => {
    const appointmentCanTakePayment = !invoice.appointmentId || ["hold", "held", "confirmed"].includes(invoice.appointmentStatus || "");

    return (
      <div
        key={invoice.id}
        className={`${compact ? "rounded-md border bg-background p-3" : "border rounded-md p-3"} space-y-2`}
        data-testid="case-invoice-row"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold">{invoice.billToClientName}</p>
            <p className="text-xs text-muted-foreground">
              {invoice.invoiceNumber} {invoice.partyRole ? `· Party ${invoice.partyRole}` : ""} {invoice.serviceName ? `· ${invoice.serviceName}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {invoice.provider !== "manual" ? `${invoice.provider} · ` : ""}{invoice.providerInvoiceId ? `Invoice ref ${invoice.providerInvoiceId}` : "CRM invoice"}
              {invoice.appointmentDateTime ? ` · Booking ${formatUkWallClockDateTime(invoice.appointmentDateTime)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={invoice.status === "overdue" ? "destructive" : "outline"}>{CASE_INVOICE_STATUS_LABELS[invoice.status] || invoice.status}</Badge>
            <Badge variant={invoice.paymentStatus === "paid" ? "default" : invoice.paymentStatus === "failed" || invoice.paymentStatus === "expired" ? "destructive" : "outline"}>
              {CASE_LEDGER_PAYMENT_STATUS_LABELS[invoice.paymentStatus] || invoice.paymentStatus}
            </Badge>
            {invoice.status !== "void" && appointmentCanTakePayment && invoice.paymentLinkUrl && invoice.paymentStatus !== "paid" && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => window.open(invoice.paymentLinkUrl!, "_blank", "noopener,noreferrer")} data-testid="button-open-payment-link">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            )}
            {canManageFinance && invoice.status !== "void" && appointmentCanTakePayment && invoice.appointmentId && ["unpaid", "failed", "cancelled", "expired"].includes(invoice.paymentStatus) && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => retryPaymentMutation.mutate(invoice.id)} disabled={retryPaymentMutation.isPending} data-testid="button-retry-payment-link">
                Retry
              </Button>
            )}
            {canManageFinance && invoice.status !== "void" && invoice.outstandingPence > 0 && invoice.paymentStatus !== "paid" && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => openPaymentEditorFromInvoice(invoice)} data-testid="button-mark-invoice-paid">
                Mark paid
              </Button>
            )}
            {canManageFinance && invoice.status !== "void" && (
              <>
                <Button size="sm" variant="outline" className="h-7" onClick={() => openInvoiceEditor(invoice)} data-testid="button-edit-case-invoice">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-red-700" onClick={() => voidInvoiceMutation.mutate(invoice.id)} data-testid="button-void-case-invoice">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
          <div><p className="text-muted-foreground">Due</p><p>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-GB") : "No due date"}</p></div>
          <div><p className="text-muted-foreground">Subtotal</p><p>{formatPence(invoice.subtotalPence, invoice.currency)}</p></div>
          <div><p className="text-muted-foreground">VAT</p><p>{formatPence(invoice.vatTotalPence, invoice.currency)}</p></div>
          <div><p className="text-muted-foreground">Voucher discount</p><p>{invoice.voucherDiscountPence > 0 ? `-${formatPence(invoice.voucherDiscountPence, invoice.currency)}` : formatPence(0, invoice.currency)}</p></div>
          <div><p className="text-muted-foreground">Total payable</p><p>{formatPence(invoice.totalPence, invoice.currency)}</p></div>
          <div><p className="text-muted-foreground">Outstanding</p><p>{formatPence(invoice.outstandingPence, invoice.currency)}</p></div>
        </div>
        {invoice.failureReason && <p className="text-xs text-red-700">Last payment issue: {invoice.failureReason}</p>}
        <p className="text-xs text-muted-foreground">{invoice.lineItems.map((line) => line.description).join(", ")}</p>
      </div>
    );
  };

  const invoiceLedgerEntries = (() => {
    const entries: Array<{ type: "invoice"; invoice: FinanceInvoice } | { type: "session"; key: string; invoices: FinanceInvoice[] }> = [];
    const groups = new Map<string, { type: "session"; key: string; invoices: FinanceInvoice[] }>();

    for (const invoice of data?.invoices || []) {
      const isMediationSessionInvoice = !!invoice.mediationSessionId || ((invoice.serviceName || "").toLowerCase() === "mediation sessions" && !!invoice.appointmentId);
      if (!isMediationSessionInvoice || !invoice.appointmentId) {
        entries.push({ type: "invoice", invoice });
        continue;
      }

      const key = invoice.mediationSessionId || invoice.appointmentId;
      let group = groups.get(key);
      if (!group) {
        group = { type: "session", key, invoices: [] };
        groups.set(key, group);
        entries.push(group);
      }
      group.invoices.push(invoice);
    }

    return entries;
  })();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="case-finance-client-totals">
        {(data?.totalsByClient || []).map((total) => (
          <Card key={total.clientId}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{total.clientName}</p>
                  <p className="text-xs text-muted-foreground">Party {total.partyRole}</p>
                </div>
                <Wallet className="w-4 h-4 text-[#5a7d58]" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-muted-foreground">Invoiced</p><p className="font-medium">{formatPence(total.invoicedPence)}</p></div>
                <div><p className="text-muted-foreground">Paid</p><p className="font-medium">{formatPence(total.paidPence)}</p></div>
                <div><p className="text-muted-foreground">Outstanding</p><p className="font-medium">{formatPence(total.outstandingPence)}</p></div>
                <div><p className="text-muted-foreground">Overdue</p><p className="font-medium text-red-700">{formatPence(total.overduePence)}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card data-testid="case-invoices-ledger">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#5a7d58]" />
              Case invoices
            </CardTitle>
            {canManageFinance && (
              <Button size="sm" onClick={() => openInvoiceEditor()} data-testid="button-add-case-invoice">
                <Plus className="w-4 h-4 mr-1" /> Invoice
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.invoices.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No internal invoices have been created for this case.</div>
          ) : invoiceLedgerEntries.map((entry) => {
            if (entry.type === "invoice") return renderInvoiceRow(entry.invoice);

            const primaryInvoice = entry.invoices[0];
            const sessionLabel = primaryInvoice.mediationSessionNumber
              ? `Mediation Session ${primaryInvoice.mediationSessionNumber}`
              : "Mediation session hold";
            const totalPence = entry.invoices.reduce((sum, invoice) => sum + invoice.totalPence, 0);
            const outstandingPence = entry.invoices.reduce((sum, invoice) => sum + invoice.outstandingPence, 0);
            const allVoided = entry.invoices.every((invoice) => invoice.status === "void");

            return (
              <div key={entry.key} className="border rounded-md p-3 space-y-3" data-testid="case-mediation-session-invoice-group">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold">{sessionLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      {primaryInvoice.appointmentDateTime ? `Booking ${formatUkWallClockDateTime(primaryInvoice.appointmentDateTime)}` : "No booking time"}
                      {primaryInvoice.appointmentStatus ? ` · Appointment ${primaryInvoice.appointmentStatus}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.invoices.length} client invoice{entry.invoices.length === 1 ? "" : "s"} · Total {formatPence(totalPence, primaryInvoice.currency)} · Outstanding {formatPence(outstandingPence, primaryInvoice.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={allVoided ? "outline" : "default"}>{allVoided ? "Historical hold" : "Current session invoices"}</Badge>
                  </div>
                </div>
                <div className="space-y-2" data-testid="case-mediation-session-invoice-rows">
                  {entry.invoices.map((invoice) => renderInvoiceRow(invoice, true))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card data-testid="case-payments-ledger">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#b8825a]" />
              Payments received
            </CardTitle>
            {canManageFinance && (
              <Button size="sm" variant="outline" onClick={() => openPaymentEditor()} data-testid="button-add-case-payment">
                <Plus className="w-4 h-4 mr-1" /> Payment
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.payments.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No payments have been recorded for this case.</div>
          ) : data?.payments.map((payment) => (
            <div key={payment.id} className="border rounded-md p-3 flex items-start justify-between gap-3 flex-wrap" data-testid="case-payment-row">
              <div>
                <p className="text-sm font-semibold">{payment.clientName}</p>
                <p className="text-xs text-muted-foreground">
                  Paid {formatPence(payment.amountPence, payment.currency)} on {new Date(payment.paymentDate).toLocaleDateString("en-GB")}
                  {payment.partyRole ? ` · Party ${payment.partyRole}` : ""} {payment.invoiceNumber ? `· ${payment.invoiceNumber}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {CASE_PAYMENT_METHOD_LABELS[payment.method] || payment.method} · {CASE_LEDGER_PAYMENT_STATUS_LABELS[payment.paymentStatus] || payment.paymentStatus}
                  {payment.provider !== "manual" ? ` · ${payment.provider}` : ""}{payment.reference ? ` · Ref ${payment.reference}` : ""}
                </p>
                {(payment.checkoutSessionId || payment.paymentIntentId || payment.providerPaymentId || payment.appointmentDateTime) && (
                  <p className="text-xs text-muted-foreground">
                    {payment.paymentIntentId ? `Stripe PI ${payment.paymentIntentId}` : payment.providerPaymentId ? `Provider ref ${payment.providerPaymentId}` : ""}
                    {payment.checkoutSessionId ? ` · Checkout ${payment.checkoutSessionId}` : ""}
                    {payment.appointmentDateTime ? ` · Booking ${new Date(payment.appointmentDateTime).toLocaleString("en-GB")}` : ""}
                  </p>
                )}
                {payment.paymentStatus === "refunded" && (
                  <p className="text-xs text-red-700">Refunded {formatPence(payment.refundedAmountPence, payment.currency)}{payment.refundedAt ? ` on ${new Date(payment.refundedAt).toLocaleDateString("en-GB")}` : ""}</p>
                )}
              </div>
              {canManageFinance && (
                <div className="flex items-center gap-2">
                  {(payment.paymentStatus === "paid" || payment.paymentStatus === "refunded") && (
                    <Button size="sm" variant="outline" className="h-7" onClick={() => window.open(`/api/finance/payments/${payment.id}/receipt`, "_blank", "noopener,noreferrer")} data-testid="button-payment-receipt">
                      <Receipt className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-7" onClick={() => openPaymentEditor(payment)} data-testid="button-edit-case-payment">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-red-700" onClick={() => deletePaymentMutation.mutate(payment.id)} data-testid="button-delete-case-payment">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
              {!canManageFinance && (payment.paymentStatus === "paid" || payment.paymentStatus === "refunded") && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => window.open(`/api/finance/payments/${payment.id}/receipt`, "_blank", "noopener,noreferrer")} data-testid="button-client-payment-receipt">
                  <Receipt className="w-3.5 h-3.5 mr-1" /> Receipt
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {(data?.externalInvoices.length || 0) > 0 && (
        <Card data-testid="case-external-xero-invoices">
          <CardHeader>
            <CardTitle className="text-base font-heading">Existing Xero booking invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.externalInvoices.map((invoice) => (
              <div key={invoice.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{invoice.xeroInvoiceNumber || invoice.xeroInvoiceId}</p>
                  <p className="text-xs text-muted-foreground">{formatPence(invoice.amountPence, invoice.currency)} · {invoice.xeroStatus}</p>
                </div>
                {invoice.xeroInvoiceUrl && (
                  <Button size="sm" variant="outline" onClick={() => window.open(invoice.xeroInvoiceUrl!, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingInvoice ? "Edit invoice" : "Create invoice"}</DialogTitle>
            <DialogDescription>Internal CRM invoice linked to a case client.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Billed client</Label>
              <Select value={invoiceForm.billToClientId} onValueChange={(value) => setInvoiceForm((f) => ({ ...f, billToClientId: value }))}>
                <SelectTrigger data-testid="select-invoice-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {data?.parties.map((party) => <SelectItem key={party.clientId} value={party.clientId}>{party.clientName} · Party {party.role}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Service</Label>
              <Select value={invoiceForm.serviceTypeId || "__none"} onValueChange={(value) => setInvoiceForm((f) => ({ ...f, serviceTypeId: value === "__none" ? "" : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No service selected</SelectItem>
                  {serviceTypes?.map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Description</Label>
              <Input value={invoiceForm.description} onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))} data-testid="input-invoice-description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={invoiceForm.amount} onChange={(e) => setInvoiceForm((f) => ({ ...f, amount: e.target.value }))} data-testid="input-invoice-amount" />
              </div>
              <div className="grid gap-1">
                <Label>VAT %</Label>
                <Input type="number" min="0" max="100" value={invoiceForm.vatRate} onChange={(e) => setInvoiceForm((f) => ({ ...f, vatRate: e.target.value }))} data-testid="input-invoice-vat" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Due date</Label>
                <Input type="date" value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={invoiceForm.status} onValueChange={(value) => setInvoiceForm((f) => ({ ...f, status: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CASE_INVOICE_STATUSES.filter((status) => status === "draft" || status === "issued").map((status) => (
                      <SelectItem key={status} value={status}>{CASE_INVOICE_STATUS_LABELS[status]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Notes</Label>
              <Textarea value={invoiceForm.notes} onChange={(e) => setInvoiceForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button onClick={() => saveInvoiceMutation.mutate()} disabled={saveInvoiceMutation.isPending || !invoiceForm.billToClientId || !invoiceForm.description || Number(invoiceForm.amount) <= 0} data-testid="button-save-case-invoice">
              {saveInvoiceMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPayment ? "Edit payment" : "Record payment"}</DialogTitle>
            <DialogDescription>Record which case client made the payment.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Paying client</Label>
              <Select value={paymentForm.clientId} onValueChange={(value) => setPaymentForm((f) => ({ ...f, clientId: value, invoiceId: "", appointmentId: "" }))}>
                <SelectTrigger data-testid="select-payment-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {data?.parties.map((party) => <SelectItem key={party.clientId} value={party.clientId}>{party.clientName} · Party {party.role}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Allocate to invoice</Label>
              <Select value={paymentForm.invoiceId || "__none"} onValueChange={(value) => setPaymentForm((f) => ({ ...f, invoiceId: value === "__none" ? "" : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unallocated payment</SelectItem>
                  {selectedPaymentClientInvoices.map((invoice) => (
                    <SelectItem key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {formatPence(invoice.outstandingPence, invoice.currency)} outstanding</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} data-testid="input-payment-amount" />
              </div>
              <div className="grid gap-1">
                <Label>Payment date</Label>
                <Input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Method</Label>
                <Select value={paymentForm.method} onValueChange={(value) => setPaymentForm((f) => ({ ...f, method: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CASE_PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{CASE_PAYMENT_METHOD_LABELS[method]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>Payment status</Label>
                <Select value={paymentForm.paymentStatus} onValueChange={(value) => setPaymentForm((f) => ({ ...f, paymentStatus: value }))}>
                  <SelectTrigger data-testid="select-payment-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CASE_PAYMENT_STATUSES.map((status) => <SelectItem key={status} value={status}>{CASE_LEDGER_PAYMENT_STATUS_LABELS[status]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Reference</Label>
              <Input value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Notes</Label>
              <Textarea value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={() => savePaymentMutation.mutate()} disabled={savePaymentMutation.isPending || !paymentForm.clientId || (paymentForm.paymentStatus === "paid" && Number(paymentForm.amount) <= 0)} data-testid="button-save-case-payment">
              {savePaymentMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function AppointmentsTab({ caseId, caseData, isStaff }: { caseId: string; caseData: CaseDetail; isStaff: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const [location] = useLocation();
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [calDate, setCalDate] = useState(new Date());
  const [resolveMiamAppointmentId, setResolveMiamAppointmentId] = useState<string | null>(null);
  const [resolveMediatorId, setResolveMediatorId] = useState("");

  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const isClient = user?.role === "client";

  const { data: appointments, isLoading } = useQuery<AppointmentData[]>({
    queryKey: ["/api/appointments/case", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/case/${caseId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load appointments");
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: serviceTypes } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/service-types"],
  });

  const { data: mediators } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/mediators"],
    queryFn: async () => {
      const res = await fetch("/api/mediators?limit=100", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: isStaff,
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/appointments/${id}/confirm`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      toast({ title: "Appointment confirmed" });
    },
    onError: (err: Error) => toast({ title: "Failed to confirm", description: err.message, variant: "destructive" }),
  });

  const paymentStatusMutation = useMutation({
    mutationFn: async ({ id, paymentStatus }: { id: string; paymentStatus: string }) => {
      await apiRequest("PATCH", `/api/appointments/${id}/payment-status`, { paymentStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      toast({ title: "Payment status updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update payment status", description: err.message, variant: "destructive" }),
  });

  const resolveMiamMutation = useMutation({
    mutationFn: async ({ id, mediatorId }: { id: string; mediatorId: string }) => {
      await apiRequest("PATCH", `/api/appointments/${id}/miam-arrangement`, { mediatorId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      setResolveMiamAppointmentId(null);
      setResolveMediatorId("");
      toast({ title: "MIAM mediator arrangement resolved" });
    },
    onError: (err: Error) => toast({ title: "Failed to resolve MIAM mediator", description: err.message, variant: "destructive" }),
  });

  const xeroSyncMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/appointments/${id}/xero-sync`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      toast({ title: "Xero invoice synced" });
    },
    onError: (err: Error) => toast({ title: "Failed to sync Xero invoice", description: err.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/appointments/${id}/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId, "overview"] });
      toast({ title: "Appointment completed" });
    },
    onError: (err: Error) => toast({ title: "Failed to mark completed", description: err.message, variant: "destructive" }),
  });

  const {
    fallbackMeetingLink,
    joiningAppointmentId,
    joinAppointment,
    clearFallbackMeetingLink,
  } = useAuditedAppointmentJoin();


  const getServiceName = (appt: AppointmentData) => {
    if (appt.serviceName) return appt.serviceName;
    if (!appt.serviceTypeId || !serviceTypes) return "Unknown service";
    return serviceTypes.find(s => s.id === appt.serviceTypeId)?.name || "Unknown service";
  };

  const getMediatorName = (appt: AppointmentData) => {
    if (appt.mediatorName) return appt.mediatorName;
    if (!appt.mediatorId) return "Unassigned";
    if (mediators?.data) {
      const m = mediators.data.find((med: { id: string; name: string }) => med.id === appt.mediatorId);
      if (m) return m.name;
    }
    return "Mediator";
  };

  const getPartyName = (appt: AppointmentData) => {
    if (appt.partyName) return appt.partyName;
    const partyId = appt.partyId;
    if (!partyId) return null;
    const allParties = caseData.parties ?? [
      ...(caseData.partyA ? [caseData.partyA] : []),
      ...(caseData.partyB ? [caseData.partyB] : []),
    ];
    const match = allParties.find((p) => p.id === partyId);
    return match ? `${match.firstName} ${match.lastName}` : null;
  };

  const canCompleteAppointment = (appt: AppointmentData): boolean => {
    return canEdit("cases") && isStaff && !isClient && appt.status === "confirmed" && isPastAppointment(appt);
  };

  const queryParams = new URLSearchParams(location.split("?")[1] || "");
  const deepLinkedResolveId = queryParams.get("action") === "resolve-miam" ? queryParams.get("appointmentId") : null;

  useEffect(() => {
    if (!deepLinkedResolveId || !appointments?.some((appt) => appt.id === deepLinkedResolveId)) return;
    setViewMode("list");
    setResolveMiamAppointmentId(deepLinkedResolveId);
    setTimeout(() => {
      document.getElementById(`appointment-${deepLinkedResolveId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }, [deepLinkedResolveId, appointments]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!appointments || appointments.length === 0) {
    return (
      <Card data-testid="card-no-appointments">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Calendar className="w-12 h-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-heading font-semibold mb-1">No Appointments</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            No appointments have been scheduled for this case yet. Use the "Send MIAM Booking Link" button on a client's summary card to invite them to book.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...appointments].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

  const enrichedAppointments: AppointmentData[] = appointments.map(a => ({
    ...a,
    serviceName: getServiceName(a),
    mediatorName: getMediatorName(a),
    partyName: getPartyName(a),
  }));
  const resolveTarget = enrichedAppointments.find((appt) => appt.id === resolveMiamAppointmentId) || null;

  return (
    <Card data-testid="card-appointments">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#5a7d58]" />
            Appointments ({appointments.length})
          </CardTitle>
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("list")}
              data-testid="button-list-view"
            >
              <List className="w-3.5 h-3.5 mr-1" /> List
            </Button>
            <Button
              variant={viewMode === "calendar" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("calendar")}
              data-testid="button-calendar-view"
            >
              <CalendarDays className="w-3.5 h-3.5 mr-1" /> Calendar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {viewMode === "calendar" && (
          <SharedWeeklyCalendar
            appointments={enrichedAppointments}
            currentDate={calDate}
            onDateChange={setCalDate}
            onAppointmentClick={() => {}}
            isClient={isClient}
          />
        )}

        {viewMode === "list" && sorted.map(appt => {
          const dt = appointmentWallClockDate(appt.dateTime, appt.dateTimeBasis ?? "wall_clock_utc");
          const endDt = new Date(dt.getTime() + appt.duration * 60000);
          const statusStyle = APPT_STATUS_STYLES[appt.status] || APPT_STATUS_STYLES.hold;
          const partyName = getPartyName(appt);
          const paymentStatus = appt.paymentStatus || "payment_pending";
          const canConfirmPayment = canConfirmFromPaymentStatus(paymentStatus);
          const needsMiamArrangement = appt.paymentFailureReason === "paid_needs_miam_arrangement";

          return (
            <div
              id={`appointment-${appt.id}`}
              key={appt.id}
              className="border rounded-lg p-4 space-y-2"
              data-testid={`appointment-${appt.id}`}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{getServiceName(appt)}</p>
                    {(appt.meetingLink || appt.hasMeetingLink) && <Video className="w-3.5 h-3.5 text-blue-600" />}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span>{dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</span>
                    <Clock className="w-3.5 h-3.5 ml-1" />
                    <span>
                      {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
                      {" – "}
                      {endDt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {partyName && <span>Client: {partyName}</span>}
                    {isStaff && <span>&middot; Mediator: {getMediatorName(appt)}</span>}
                  </div>
                </div>
                <Badge className={`${statusStyle.bg} ${statusStyle.text} border-none text-xs`} data-testid={`badge-status-${appt.id}`}>
                  {statusStyle.label}
                </Badge>
              </div>
              {needsMiamArrangement && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid={`paid-needs-miam-arrangement-${appt.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium">Paid, needs MIAM arrangement</span>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-red-300 text-red-800 hover:bg-red-100"
                        onClick={() => {
                          setResolveMiamAppointmentId(appt.id);
                          setResolveMediatorId("");
                        }}
                        data-testid={`button-resolve-miam-${appt.id}`}
                      >
                        <UserCog className="w-3 h-3 mr-1" />
                        Resolve MIAM mediator
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {appt.notes && (
                <p className="text-xs text-muted-foreground italic">{appt.notes}</p>
              )}

              {isAdmin && appt.xeroInvoice && (
                <div className="rounded-md border border-[#a7baa4]/40 bg-[#a7baa4]/10 p-3 space-y-2" data-testid="xero-invoice-summary">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Xero invoice</p>
                      <p className="text-sm font-medium">
                        {appt.xeroInvoice.invoiceNumber || appt.xeroInvoice.invoiceId}
                        <Badge variant="outline" className="ml-2 text-xs">{appt.xeroInvoice.status}</Badge>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {appt.xeroInvoice.invoiceUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => window.open(appt.xeroInvoice!.invoiceUrl!, "_blank", "noopener,noreferrer")}
                          data-testid="button-open-xero-invoice"
                        >
                          <ExternalLink className="w-3.5 h-3.5 mr-1" />
                          Open
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => xeroSyncMutation.mutate(appt.id)}
                        disabled={xeroSyncMutation.isPending}
                        data-testid="button-sync-xero-invoice"
                      >
                        {xeroSyncMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                        Sync
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last synced: {appt.xeroInvoice.lastSyncedAt ? new Date(appt.xeroInvoice.lastSyncedAt).toLocaleString("en-GB") : "Never"}
                    {appt.xeroInvoice.paidAt ? ` · Paid: ${new Date(appt.xeroInvoice.paidAt).toLocaleString("en-GB")}` : ""}
                  </p>
                  {appt.xeroInvoice.lastError && <p className="text-xs text-red-700">{appt.xeroInvoice.lastError}</p>}
                </div>
              )}

              {isAdmin && (
                <div className="grid gap-1 max-w-sm">
                  <Label className="text-xs">Payment status</Label>
                  <Select
                    value={paymentStatus}
                    onValueChange={(value) => paymentStatusMutation.mutate({ id: appt.id, paymentStatus: value })}
                    disabled={paymentStatusMutation.isPending}
                  >
                    <SelectTrigger className="h-8" data-testid="select-appointment-payment-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APPOINTMENT_PAYMENT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>{PAYMENT_STATUS_LABELS[status]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(appt.status === "hold" || appt.status === "held") && !canConfirmPayment && (
                    <p className="text-xs text-amber-700" data-testid="text-payment-confirmation-blocked">
                      Payment or voucher acceptance required before confirmation.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                {isClient && appt.canJoin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void joinAppointment(appt.id)}
                    disabled={joiningAppointmentId === appt.id}
                    data-testid={`button-join-meeting-${appt.id}`}
                  >
                    {joiningAppointmentId === appt.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                    Join Meeting
                  </Button>
                )}
                {!isClient && appt.meetingLink && appt.status === "confirmed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void joinAppointment(appt.id)}
                    disabled={joiningAppointmentId === appt.id}
                    data-testid={`button-join-meeting-${appt.id}`}
                  >
                    {joiningAppointmentId === appt.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                    Open Link
                  </Button>
                )}


                {canEdit("cases") && isStaff && (appt.status === "hold" || appt.status === "held") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-[#5a7d58] border-[#a7baa4] hover:bg-[#a7baa4]/20"
                    onClick={() => confirmMutation.mutate(appt.id)}
                    disabled={confirmMutation.isPending || !canConfirmPayment}
                    data-testid={`button-confirm-${appt.id}`}
                  >
                    <Check className="w-3 h-3 mr-1" /> Confirm
                  </Button>
                )}
                {isStaff && canCompleteAppointment(appt) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-[#5a7d58] border-[#a7baa4] hover:bg-[#a7baa4]/20"
                    onClick={() => completeMutation.mutate(appt.id)}
                    disabled={completeMutation.isPending}
                    data-testid={`button-complete-appointment-${appt.id}`}
                  >
                    {completeMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                    Mark completed
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
      <Dialog open={!!resolveTarget} onOpenChange={(open) => {
        if (!open) {
          setResolveMiamAppointmentId(null);
          setResolveMediatorId("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve MIAM mediator</DialogTitle>
            <DialogDescription>
              Choose another qualified mediator for the same paid MIAM slot. If the time needs to change, send a client confirmation link from the follow-up workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <p className="font-medium">{resolveTarget ? getServiceName(resolveTarget) : "MIAM"}</p>
              {resolveTarget && (
                <p className="text-xs text-muted-foreground">
                  {appointmentWallClockDate(resolveTarget.dateTime, resolveTarget.dateTimeBasis ?? "wall_clock_utc").toLocaleString("en-GB", { timeZone: "UTC" })}
                </p>
              )}
            </div>
            <div className="grid gap-1">
              <Label>Replacement MIAM mediator</Label>
              <Select value={resolveMediatorId} onValueChange={setResolveMediatorId}>
                <SelectTrigger data-testid="select-resolve-miam-mediator">
                  <SelectValue placeholder="Choose mediator" />
                </SelectTrigger>
                <SelectContent>
                  {(mediators?.data ?? []).map((mediator) => (
                    <SelectItem key={mediator.id} value={mediator.id}>{mediator.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveMiamAppointmentId(null)}>Cancel</Button>
            <Button
              onClick={() => resolveTarget && resolveMediatorId && resolveMiamMutation.mutate({ id: resolveTarget.id, mediatorId: resolveMediatorId })}
              disabled={!resolveTarget || !resolveMediatorId || resolveMiamMutation.isPending}
              data-testid="button-confirm-resolve-miam"
            >
              {resolveMiamMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
              Confirm same-time mediator
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AppointmentJoinFallbackDialog meetingLink={fallbackMeetingLink} onClose={clearFallbackMeetingLink} />

    </Card>
  );
}

const SESSION_CALENDAR_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SESSION_CALENDAR_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDateKeyUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function SessionAvailabilityMiniCalendar({
  selectedDate,
  availableDates,
  isLoadingDates,
  onDateSelect,
  onMonthChange,
}: {
  selectedDate: Date | null;
  availableDates?: Set<string>;
  isLoadingDates?: boolean;
  onDateSelect: (date: Date) => void;
  onMonthChange: (month: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  const changeMonth = (next: Date) => {
    setViewMonth(next);
    onMonthChange(formatMonthKey(next));
  };

  return (
    <div className="rounded-md border bg-muted/10 p-3" data-testid="session-availability-calendar">
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(new Date(year, month - 1, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium">{SESSION_CALENDAR_MONTHS[month]} {year}</span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(new Date(year, month + 1, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 min-h-[286px] content-start">
        {SESSION_CALENDAR_DAYS.map((day) => <div key={day} className="text-center text-[11px] text-muted-foreground py-1">{day}</div>)}
        {isLoadingDates ? (
          <div className="col-span-7 flex min-h-[238px] items-center justify-center" data-testid="session-loading-dates">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#5a7d58] border-t-transparent" />
              <span>Loading availability...</span>
            </div>
          </div>
        ) : (
          cells.map((day, index) => {
            if (day === null) return <div key={`blank-${index}`} />;
            const cellDate = new Date(Date.UTC(year, month, day));
            const key = formatDateKeyUtc(cellDate);
            const isPast = cellDate < today;
            const isAvailable = availableDates ? availableDates.has(key) : false;
            const disabled = isPast || !isAvailable;
            const selected = selectedDate ? formatDateKeyUtc(selectedDate) === key : false;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => onDateSelect(cellDate)}
                className={`relative h-9 rounded-md text-sm transition-colors ${disabled ? "text-muted-foreground/30 cursor-not-allowed" : "hover:bg-[#a7baa4]/20"} ${selected ? "bg-[#5a7d58] text-white hover:bg-[#5a7d58]" : ""}`}
              >
                {day}
                {isAvailable && !isPast && (
                  <span className={`absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${selected ? "bg-white" : "bg-[#5a7d58]"}`} />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function SessionLeadMediatorSlotPicker({
  sessionId,
  duration,
  selectedDateTime,
  onSelectSlot,
}: {
  sessionId: string;
  duration: number;
  selectedDateTime?: string;
  onSelectSlot: (slot: SessionCalendarSlot) => void;
}) {
  const [month, setMonth] = useState(() => formatMonthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const dateKey = selectedDate ? formatDateKeyUtc(selectedDate) : "";
  const datesQuery = useQuery<{ dates: string[]; bookingPaused: boolean; message?: string }>({
    queryKey: ["/api/mediation-sessions", sessionId, "lead-mediator-available-dates", { month, duration }],
    queryFn: async () => {
      const res = await fetch(`/api/mediation-sessions/${sessionId}/lead-mediator-available-dates?month=${month}&duration=${duration}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to load lead mediator availability");
      return body;
    },
    enabled: !!sessionId,
  });
  const slotsQuery = useQuery<{ slots: SessionCalendarSlot[]; message?: string }>({
    queryKey: ["/api/mediation-sessions", sessionId, "lead-mediator-available-slots", { date: dateKey, duration }],
    queryFn: async () => {
      const res = await fetch(`/api/mediation-sessions/${sessionId}/lead-mediator-available-slots?date=${dateKey}&duration=${duration}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to load lead mediator slots");
      return body;
    },
    enabled: !!sessionId && !!dateKey,
  });
  const availableDates = datesQuery.data?.dates ? new Set(datesQuery.data.dates) : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]" data-testid="session-lead-mediator-slot-picker">
      <SessionAvailabilityMiniCalendar
        selectedDate={selectedDate}
        availableDates={availableDates}
        isLoadingDates={datesQuery.isLoading}
        onDateSelect={setSelectedDate}
        onMonthChange={(next) => {
          setMonth(next);
          setSelectedDate(null);
        }}
      />
      <div className="rounded-md border p-3 min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Available times</p>
        {datesQuery.data?.bookingPaused ? (
          <p className="text-sm text-amber-700 mt-2">{datesQuery.data.message || "Lead mediator calendar needs reconnecting."}</p>
        ) : datesQuery.error ? (
          <p className="text-sm text-amber-700 mt-2">{datesQuery.error.message}</p>
        ) : !selectedDate ? (
          <p className="text-sm text-muted-foreground mt-2">Select an available date.</p>
        ) : slotsQuery.isLoading ? (
          <div className="space-y-2 mt-2">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-9 w-full" />)}
          </div>
        ) : !slotsQuery.data?.slots?.length ? (
          <p className="text-sm text-muted-foreground mt-2">No {duration}-minute slots on this date.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {slotsQuery.data.slots.map((slot) => {
              const selected = selectedDateTime === new Date(slot.startAt).toISOString();
              return (
                <Button
                  key={`${slot.startAt}`}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  className={`h-auto min-h-9 max-w-full whitespace-normal text-center leading-snug ${selected ? "bg-[#5a7d58] hover:bg-[#4a6c49] text-white" : ""}`}
                  onClick={() => onSelectSlot(slot)}
                  data-testid={`button-session-slot-${slot.time}`}
                >
                  {slot.time}-{slot.endTime}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type ClientProposalPaymentResponse = {
  paymentRequired?: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  outstandingPence?: number;
  currency?: string;
  checkoutUrl?: string;
  xeroInvoiceUrl?: string;
  paymentReference?: string;
  bankTransfer?: {
    accountName?: string | null;
    sortCode?: string | null;
    accountNumber?: string | null;
    iban?: string | null;
    swift?: string | null;
    instructions?: string | null;
  } | null;
  paymentError?: string;
};

function ClientProposalAlternativeSlotPicker({
  sessionId,
  duration,
  selectedSlots,
  onToggleSlot,
}: {
  sessionId: string;
  duration: number;
  selectedSlots: SessionCalendarSlot[];
  onToggleSlot: (slot: SessionCalendarSlot) => void;
}) {
  const [month, setMonth] = useState(() => formatMonthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const dateKey = selectedDate ? formatDateKeyUtc(selectedDate) : "";
  const selectedStartTimes = new Set(selectedSlots.map((slot) => new Date(slot.startAt).toISOString()));
  const datesQuery = useQuery<{ dates: string[]; bookingPaused: boolean; message?: string }>({
    queryKey: ["/api/mediation-sessions", sessionId, "lead-mediator-available-dates", "client-proposal", { month, duration }],
    queryFn: async () => {
      const res = await fetch(`/api/mediation-sessions/${sessionId}/lead-mediator-available-dates?month=${month}&duration=${duration}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to load lead mediator availability");
      return body;
    },
    enabled: !!sessionId,
  });
  const slotsQuery = useQuery<{ slots: SessionCalendarSlot[]; message?: string }>({
    queryKey: ["/api/mediation-sessions", sessionId, "lead-mediator-available-slots", "client-proposal", { date: dateKey, duration }],
    queryFn: async () => {
      const res = await fetch(`/api/mediation-sessions/${sessionId}/lead-mediator-available-slots?date=${dateKey}&duration=${duration}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Failed to load lead mediator slots");
      return body;
    },
    enabled: !!sessionId && !!dateKey,
  });
  const availableDates = datesQuery.data?.dates ? new Set(datesQuery.data.dates) : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]" data-testid="client-proposal-alternative-slot-picker">
      <SessionAvailabilityMiniCalendar
        selectedDate={selectedDate}
        availableDates={availableDates}
        isLoadingDates={datesQuery.isLoading}
        onDateSelect={setSelectedDate}
        onMonthChange={(next) => {
          setMonth(next);
          setSelectedDate(null);
        }}
      />
      <div className="rounded-md border p-3 min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Alternative times</p>
        {datesQuery.data?.bookingPaused ? (
          <p className="text-sm text-amber-700 mt-2">{datesQuery.data.message || "Lead mediator calendar needs reconnecting."}</p>
        ) : datesQuery.error ? (
          <p className="text-sm text-amber-700 mt-2">{datesQuery.error.message}</p>
        ) : !selectedDate ? (
          <p className="text-sm text-muted-foreground mt-2">Select an available date.</p>
        ) : slotsQuery.isLoading ? (
          <div className="space-y-2 mt-2">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-9 w-full" />)}
          </div>
        ) : !slotsQuery.data?.slots?.length ? (
          <p className="text-sm text-muted-foreground mt-2">No {duration}-minute slots on this date.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {slotsQuery.data.slots.map((slot) => {
              const selected = selectedStartTimes.has(new Date(slot.startAt).toISOString());
              return (
                <Button
                  key={`${slot.startAt}`}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  className={`h-auto min-h-9 max-w-full whitespace-normal text-center leading-snug ${selected ? "bg-[#5a7d58] hover:bg-[#4a6c49] text-white" : ""}`}
                  onClick={() => onToggleSlot(slot)}
                  data-testid={`button-client-alternative-slot-${slot.time}`}
                >
                  {slot.time}-{slot.endTime}
                </Button>
              );
            })}
          </div>
        )}
        {selectedSlots.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Selected</p>
            {selectedSlots.map((slot) => (
              <p key={new Date(slot.startAt).toISOString()} className="text-xs text-muted-foreground">
                {formatUkWallClockDateTime(slot.startAt)} to {formatUkWallClockDateTime(slot.endAt)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientProposalResponsePanel({
  caseId,
  sessionId,
  proposal,
  recipients,
}: {
  caseId: string;
  sessionId: string;
  proposal: NonNullable<MediationSessionView["proposal"]>;
  recipients: ClientProposalRecipientView[];
}) {
  const { toast } = useToast();
  const [declineRecipientId, setDeclineRecipientId] = useState<string | null>(null);
  const [declineNotes, setDeclineNotes] = useState("");
  const [selectedSlots, setSelectedSlots] = useState<SessionCalendarSlot[]>([]);
  const [payment, setPayment] = useState<ClientProposalPaymentResponse | null>(null);
  const proposedStart = new Date(proposal.proposedStartAt);
  const proposedEnd = new Date(proposal.proposedEndAt);
  const duration = proposal.duration || Math.max(30, Math.round((proposedEnd.getTime() - proposedStart.getTime()) / 60000) || 120);
  const sortedSlots = [...selectedSlots].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const responseMutation = useMutation({
    mutationFn: async ({ recipient, response }: { recipient: ClientProposalRecipientView; response: "accepted" | "declined" }) => {
      const payload = response === "accepted"
        ? { response }
        : {
            response,
            declineNotes,
            windows: sortedSlots.map((slot) => ({
              startAt: new Date(slot.startAt).toISOString(),
              endAt: new Date(slot.endAt).toISOString(),
            })),
          };
      const res = await apiRequest("POST", `/api/mediation-session-proposal-recipients/${recipient.id}/client-response`, payload);
      return await res.json() as ClientProposalPaymentResponse;
    },
    onSuccess: async (body, variables) => {
      setPayment(variables.response === "accepted" ? body : null);
      setDeclineRecipientId(null);
      setDeclineNotes("");
      setSelectedSlots([]);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      await refreshClientDashboardActions();
      toast({ title: "Session response recorded" });
      if (body.checkoutUrl) window.location.assign(body.checkoutUrl);
    },
    onError: (error: Error) => {
      toast({ title: "Could not record response", description: error.message, variant: "destructive" });
    },
  });

  const toggleSlot = (slot: SessionCalendarSlot) => {
    const key = new Date(slot.startAt).toISOString();
    setSelectedSlots((current) => current.some((existing) => new Date(existing.startAt).toISOString() === key)
      ? current.filter((existing) => new Date(existing.startAt).toISOString() !== key)
      : [...current, slot]);
  };

  if (recipients.length === 0) return <ClientProposalRecipientStatusList recipients={recipients} />;

  return (
    <div className="grid gap-3" data-testid="client-proposal-response-panel">
      {recipients.map((recipient) => {
        const pending = recipient.responseStatus === "pending" || recipient.responseStatus === "viewed";
        const isDeclining = declineRecipientId === recipient.id;
        return (
          <div key={recipient.id} className="rounded-md border bg-muted/10 p-3 text-xs min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="font-medium">Your response</p>
                <p className="mt-1 text-muted-foreground">
                  Proposed {formatUkWallClockDateTime(proposal.proposedStartAt)} · hold expires {formatUkWallClockDateTime(proposal.expiresAt)}
                </p>
              </div>
              <Badge variant={recipient.responseStatus === "accepted" ? "default" : recipient.responseStatus === "declined" ? "destructive" : "outline"} className="capitalize">
                {recipient.responseStatus.replace(/_/g, " ")}
              </Badge>
            </div>
            {recipient.respondedAt && (
              <p className="mt-2 text-muted-foreground">Responded {formatUkWallClockDateTime(recipient.respondedAt)}</p>
            )}
            {pending && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                    onClick={() => responseMutation.mutate({ recipient, response: "accepted" })}
                    disabled={responseMutation.isPending}
                    data-testid="button-client-accept-session-proposal"
                  >
                    {responseMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                    I can attend
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDeclineRecipientId(isDeclining ? null : recipient.id);
                      setSelectedSlots([]);
                    }}
                    disabled={responseMutation.isPending}
                    data-testid="button-client-decline-session-proposal"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    I cannot attend
                  </Button>
                </div>
                {isDeclining && (
                  <div className="space-y-3">
                    <ClientProposalAlternativeSlotPicker
                      sessionId={sessionId}
                      duration={duration}
                      selectedSlots={sortedSlots}
                      onToggleSlot={toggleSlot}
                    />
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes</Label>
                      <Textarea
                        value={declineNotes}
                        onChange={(event) => setDeclineNotes(event.target.value)}
                        className="min-h-[80px]"
                        placeholder="Optional note for the mediation team"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => responseMutation.mutate({ recipient, response: "declined" })}
                      disabled={responseMutation.isPending || sortedSlots.length === 0}
                      data-testid="button-client-submit-decline-session-proposal"
                    >
                      {responseMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                      Send alternatives
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {payment && !payment.checkoutUrl && (
        <div className="rounded-md border p-3 text-xs" data-testid="client-proposal-payment-state">
          <p className="font-medium">{payment.paymentRequired ? "Payment is required" : "No payment is required"}</p>
          {payment.invoiceNumber && <p className="mt-1 text-muted-foreground">Invoice {payment.invoiceNumber} · {formatPence(payment.outstandingPence, payment.currency)}</p>}
          {payment.xeroInvoiceUrl && (
            <Button asChild size="sm" variant="outline" className="mt-2">
              <a href={payment.xeroInvoiceUrl} target="_blank" rel="noreferrer">Open invoice</a>
            </Button>
          )}
          {payment.bankTransfer?.accountName && (
            <p className="mt-2 text-muted-foreground">
              Bank transfer: {payment.bankTransfer.accountName}
              {payment.bankTransfer.sortCode ? ` · ${payment.bankTransfer.sortCode}` : ""}
              {payment.bankTransfer.accountNumber ? ` · ${payment.bankTransfer.accountNumber}` : ""}
              {payment.paymentReference ? ` · reference ${payment.paymentReference}` : ""}
            </p>
          )}
          {payment.paymentError && <p className="mt-2 text-red-700">{payment.paymentError}</p>}
        </div>
      )}
    </div>
  );
}

function MediationSessionRequestDialog({
  open,
  onClose,
  dialogTestId,
  title,
  description,
  reason,
  onReasonChange,
  reasonTestId,
  slotLabel,
  sessionId,
  duration,
  selectedDateTime,
  onSelectSlot,
  durationValue,
  onDurationChange,
  selectedLabel,
  selectedFallback,
  isPending,
  sendDisabled,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  dialogTestId: string;
  title: string;
  description: string;
  reason: string;
  onReasonChange: (value: string) => void;
  reasonTestId: string;
  slotLabel: string;
  sessionId?: string;
  duration: number;
  selectedDateTime: string;
  onSelectSlot: (slot: SessionCalendarSlot) => void;
  durationValue: string;
  onDurationChange: (value: string) => void;
  selectedLabel: string;
  selectedFallback: string;
  isPending: boolean;
  sendDisabled: boolean;
  onSend: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[90vh] overflow-y-auto" data-testid={dialogTestId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {sessionId && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Reason</Label>
              <Textarea
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                className="min-h-[90px]"
                data-testid={reasonTestId}
              />
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px] items-start">
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs">{slotLabel}</Label>
                <SessionLeadMediatorSlotPicker
                  sessionId={sessionId}
                  duration={duration}
                  selectedDateTime={selectedDateTime}
                  onSelectSlot={onSelectSlot}
                />
              </div>
              <div className="space-y-3 min-w-0">
                <div className="space-y-1.5">
                  <Label className="text-xs">Minutes</Label>
                  <Input
                    value={durationValue}
                    onChange={(e) => onDurationChange(e.target.value)}
                    disabled={isPending}
                  />
                </div>
                <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{selectedLabel}</p>
                  <p className="text-sm font-medium break-words mt-1">
                    {selectedDateTime ? formatUkWallClockDateTime(selectedDateTime) : selectedFallback}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={sendDisabled}
            onClick={onSend}
          >
            {isPending ? "Sending..." : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediationSessionsTab({
  caseId,
  isAdmin,
  isSuperadmin,
  isClient,
  sessionAccess,
  parties = [],
}: {
  caseId: string;
  isAdmin: boolean;
  isSuperadmin: boolean;
  isClient: boolean;
  sessionAccess?: "none" | "observer" | "co_mediator" | "full";
  parties?: PartyWithMediators[];
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [leadMediatorId, setLeadMediatorId] = useState("");
  const [coMediatorIds, setCoMediatorIds] = useState<string[]>([]);
  const [observerIds, setObserverIds] = useState<string[]>([]);
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, { outcome: string; outcomeNotes: string }>>({});
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, { nextAction: string; documentsRequired: string; followUpRequirements: string; nextSessionRequired: boolean }>>({});
  const [sessionNoteDrafts, setSessionNoteDrafts] = useState<Record<string, string>>({});
  const [postSessionReviewNotes, setPostSessionReviewNotes] = useState<Record<string, string>>({});
  const [proposalDrafts, setProposalDrafts] = useState<Record<string, { dateTime: string; duration: string }>>({});
  const [proposalLinks, setProposalLinks] = useState<Record<string, Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }>>>({});
  const [overlapSessionId, setOverlapSessionId] = useState<string | null>(null);
  const [cancelSessionTarget, setCancelSessionTarget] = useState<MediationSessionView | null>(null);
  const [cancelSessionReason, setCancelSessionReason] = useState("");
  const [rescheduleSessionTarget, setRescheduleSessionTarget] = useState<MediationSessionView | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleDraft, setRescheduleDraft] = useState<{ dateTime: string; duration: string }>({ dateTime: "", duration: "120" });
  const [nextSessionRequestTarget, setNextSessionRequestTarget] = useState<MediationSessionView | null>(null);
  const [nextSessionRequestReason, setNextSessionRequestReason] = useState("");
  const [nextSessionRequestDraft, setNextSessionRequestDraft] = useState<{ dateTime: string; duration: string }>({ dateTime: "", duration: "120" });
  const [signingForm, setSigningForm] = useState<RequiredFormView | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [uploadingForm, setUploadingForm] = useState<RequiredFormView | null>(null);
  const [signedUploadFile, setSignedUploadFile] = useState<File | null>(null);
  const [signedUploadSignerName, setSignedUploadSignerName] = useState("");
  const [signedUploadDate, setSignedUploadDate] = useState("");
  const [signedUploadNotes, setSignedUploadNotes] = useState("");
  const allocationFormRef = useRef<HTMLDivElement | null>(null);

  const mergeProposalLinks = (
    proposalId: string,
    links: Array<{ recipientId: string; recipientName: string; recipientType: string; publicUrl: string }>,
  ) => {
    setProposalLinks((prev) => {
      const existing = prev[proposalId] || [];
      const byRecipient = new Map(existing.map((link) => [link.recipientId, link]));
      for (const link of links) byRecipient.set(link.recipientId, link);
      return { ...prev, [proposalId]: Array.from(byRecipient.values()) };
    });
  };

  const copyFreshLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Could not copy link", description: url, variant: "destructive" });
    }
  };

  const sessionsQuery = useQuery<MediationSessionsResponse>({
    queryKey: ["/api/cases", caseId, "mediation-sessions"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/mediation-sessions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load mediation sessions");
      return res.json();
    },
    enabled: !!caseId,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });

  const upsertMediationSessionCache = (updatedSession: MediationSessionView) => {
    queryClient.setQueryData<MediationSessionsResponse | undefined>(
      ["/api/cases", caseId, "mediation-sessions"],
      (current) => {
        if (!current) {
          return {
            sessions: [updatedSession],
            readiness: { ready: false, issues: [] },
            access: isAdmin ? "full" : "none",
          };
        }

        const hasSession = current.sessions.some((session) => session.id === updatedSession.id);
        return {
          ...current,
          sessions: hasSession
            ? current.sessions.map((session) => session.id === updatedSession.id ? updatedSession : session)
            : [...current.sessions, updatedSession],
        };
      },
    );
  };

  const mediatorsQuery = useQuery<MediationRoleOptions>({
    queryKey: ["/api/mediation-sessions/mediator-options"],
    queryFn: async () => {
      const res = await fetch("/api/mediation-sessions/mediator-options", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin,
  });

  const resetAllocationForm = () => {
    setEditingSessionId(null);
    setLeadMediatorId("");
    setCoMediatorIds([]);
    setObserverIds([]);
  };

  const allocationMutation = useMutation({
    mutationFn: async () => {
      const payload = { leadMediatorId, coMediatorIds, observerIds };
      const res = editingSessionId
        ? await apiRequest("PATCH", `/api/mediation-sessions/${editingSessionId}/allocation`, payload)
        : await apiRequest("POST", `/api/cases/${caseId}/mediation-sessions`, payload);
      return res.json();
    },
    onSuccess: (data: MediationSessionView) => {
      upsertMediationSessionCache(data);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: editingSessionId ? "Session allocation updated" : "Mediation session allocated" });
      resetAllocationForm();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save allocation", description: err.message, variant: "destructive" });
    },
  });

  const outcomeMutation = useMutation({
    mutationFn: async ({ sessionId, outcome, outcomeNotes }: { sessionId: string; outcome: string; outcomeNotes: string }) => {
      const res = await apiRequest("PATCH", `/api/mediation-sessions/${sessionId}/outcome`, { outcome, outcomeNotes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      toast({ title: "Session outcome recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to record outcome", description: err.message, variant: "destructive" });
    },
  });

  const summaryMutation = useMutation({
    mutationFn: async ({ sessionId, outcome, outcomeNotes, nextAction, documentsRequired, followUpRequirements, nextSessionRequired }: {
      sessionId: string;
      outcome: string;
      outcomeNotes: string;
      nextAction: string;
      documentsRequired: string;
      followUpRequirements: string;
      nextSessionRequired: boolean;
    }) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/summary`, {
        outcome,
        outcomeNotes,
        nextAction,
        documentsRequired,
        followUpRequirements,
        nextSessionRequired,
      });
      return res.json();
    },
    onSuccess: (data: MediationSessionView) => {
      upsertMediationSessionCache(data);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Submitted for admin review" });
    },
    onError: (err: Error) => toast({ title: "Failed to save summary", description: err.message, variant: "destructive" }),
  });

  const postSessionReviewMutation = useMutation({
    mutationFn: async ({ sessionId, decision, reviewNotes }: { sessionId: string; decision: "approved" | "changes_requested"; reviewNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/mediation-sessions/${sessionId}/post-session-review`, { decision, reviewNotes });
      return res.json();
    },
    onSuccess: (data: MediationSessionView) => {
      upsertMediationSessionCache(data);
      setPostSessionReviewNotes((prev) => ({ ...prev, [data.id]: "" }));
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: data.postSessionReviewStatus === "approved" ? "Post-session review approved" : "Changes requested" });
    },
    onError: (err: Error) => toast({ title: "Failed to update review", description: err.message, variant: "destructive" }),
  });

  const addSessionNoteMutation = useMutation({
    mutationFn: async ({ sessionId, content }: { sessionId: string; content: string }) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/notes`, { content });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setSessionNoteDrafts((prev) => ({ ...prev, [variables.sessionId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Session note added" });
    },
    onError: (err: Error) => toast({ title: "Failed to add note", description: err.message, variant: "destructive" }),
  });

  const attendanceMutation = useMutation({
    mutationFn: async ({ sessionId, noShowPartyIds }: { sessionId: string; noShowPartyIds: string[] }) => {
      const res = await apiRequest("PATCH", `/api/mediation-sessions/${sessionId}/attendance`, { noShowPartyIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Client attendance updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update attendance", description: err.message, variant: "destructive" });
    },
  });

  const overlapQuery = useQuery<{ commonSlots: Array<{ startAt: string | Date; endAt: string | Date }>; hasCommonAvailability: boolean; missingPartyIds: string[] }>({
    queryKey: ["/api/mediation-sessions", overlapSessionId, "availability", "overlap"],
    queryFn: async () => {
      const res = await fetch(`/api/mediation-sessions/${overlapSessionId}/availability/overlap`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to calculate overlap");
      return res.json();
    },
    enabled: !!overlapSessionId,
  });

  const proposeSlotMutation = useMutation({
    mutationFn: async ({ sessionId, draft }: { sessionId: string; draft: { dateTime: string; duration: string } }) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/propose-slot`, {
        dateTime: draft.dateTime,
        duration: Number.parseInt(draft.duration || "120", 10),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      if (data.session?.proposal?.id && data.proposalLinks) {
        setProposalLinks((prev) => ({ ...prev, [data.session.proposal.id]: data.proposalLinks }));
      }
      toast({ title: "Session slot proposed" });
    },
    onError: (err: Error) => toast({ title: "Failed to propose slot", description: err.message, variant: "destructive" }),
  });

  const proposeNextSessionMutation = useMutation({
    mutationFn: async ({ sessionId, draft }: { sessionId: string; draft: { dateTime: string; duration: string } }) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/propose-next-session`, {
        dateTime: draft.dateTime,
        duration: Number.parseInt(draft.duration || "120", 10),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      if (data.session?.proposal?.id && data.proposalLinks) {
        setProposalLinks((prev) => ({ ...prev, [data.session.proposal.id]: data.proposalLinks }));
      }
      toast({ title: "Next session proposed" });
    },
    onError: (err: Error) => toast({ title: "Failed to propose next session", description: err.message, variant: "destructive" }),
  });

  const replaceSlotMutation = useMutation({
    mutationFn: async ({ sessionId, draft }: { sessionId: string; draft: { dateTime: string; duration: string } }) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/replace-proposed-slot`, {
        dateTime: draft.dateTime,
        duration: Number.parseInt(draft.duration || "120", 10),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      if (data.session?.proposal?.id && data.proposalLinks) {
        setProposalLinks((prev) => ({ ...prev, [data.session.proposal.id]: data.proposalLinks }));
      }
      toast({ title: "Replacement slot proposed" });
    },
    onError: (err: Error) => toast({ title: "Failed to replace slot", description: err.message, variant: "destructive" }),
  });

  const releaseHoldMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/release-hold`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      toast({ title: "Session hold released" });
    },
    onError: (err: Error) => toast({ title: "Failed to release hold", description: err.message, variant: "destructive" }),
  });

  const cancelSessionMutation = useMutation({
    mutationFn: async ({ sessionId, reason }: { sessionId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/cancel`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      setCancelSessionTarget(null);
      setCancelSessionReason("");
      toast({ title: "Mediation session cancelled" });
    },
    onError: (err: Error) => toast({ title: "Failed to cancel mediation session", description: err.message, variant: "destructive" }),
  });

  const requestRescheduleMutation = useMutation({
    mutationFn: async ({ sessionId, reason, draft }: { sessionId: string; reason: string; draft: { dateTime: string; duration: string } }) => {
      const startAt = new Date(draft.dateTime);
      const duration = Number.parseInt(draft.duration || "120", 10) || 120;
      const endAt = new Date(startAt.getTime() + duration * 60000);
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/reschedule-request`, {
        reason,
        windows: [{ startAt: startAt.toISOString(), endAt: endAt.toISOString(), notes: reason }],
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
      setRescheduleSessionTarget(null);
      setRescheduleReason("");
      setRescheduleDraft({ dateTime: "", duration: "120" });
      toast({ title: "Reschedule request sent" });
    },
    onError: (err: Error) => toast({ title: "Failed to request reschedule", description: err.message, variant: "destructive" }),
  });

  const requestNextSessionMutation = useMutation({
    mutationFn: async ({ sessionId, reason, draft }: { sessionId: string; reason: string; draft: { dateTime: string; duration: string } }) => {
      const startAt = new Date(draft.dateTime);
      const duration = Number.parseInt(draft.duration || "120", 10) || 120;
      const endAt = new Date(startAt.getTime() + duration * 60000);
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/next-session-request`, {
        reason,
        windows: [{ startAt: startAt.toISOString(), endAt: endAt.toISOString(), notes: reason }],
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
      setNextSessionRequestTarget(null);
      setNextSessionRequestReason("");
      setNextSessionRequestDraft({ dateTime: "", duration: "120" });
      toast({ title: "Next-session request sent" });
    },
    onError: (err: Error) => toast({ title: "Failed to request next session", description: err.message, variant: "destructive" }),
  });

  const resendLinksMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      const res = await apiRequest("POST", `/api/mediation-session-proposals/${proposalId}/resend-links`, {});
      return res.json();
    },
    onSuccess: (data, proposalId) => {
      mergeProposalLinks(proposalId, data.proposalLinks || []);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Pending response links regenerated", description: "Old links for regenerated recipients are no longer valid." });
    },
    onError: (err: Error) => toast({ title: "Failed to resend links", description: err.message, variant: "destructive" }),
  });

  const resendRecipientLinkMutation = useMutation({
    mutationFn: async ({ proposalId, recipientId, regenerateAccepted }: { proposalId: string; recipientId: string; regenerateAccepted?: boolean }) => {
      const res = await apiRequest("POST", `/api/mediation-session-proposal-recipients/${recipientId}/resend-link`, { regenerateAccepted });
      const data = await res.json();
      return { proposalId, data };
    },
    onSuccess: ({ proposalId, data }) => {
      mergeProposalLinks(proposalId, data.proposalLinks || []);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Fresh recipient link generated", description: "The previous link for that recipient is no longer valid." });
    },
    onError: (err: Error) => toast({ title: "Failed to resend recipient link", description: err.message, variant: "destructive" }),
  });

  const issueFormsMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest("POST", `/api/mediation-sessions/${sessionId}/required-forms/issue`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      toast({ title: "Required forms issued" });
    },
    onError: (err: Error) => toast({ title: "Failed to issue forms", description: err.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiRequest("PATCH", `/api/mediation-sessions/${sessionId}/confirm`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/appointments/case", caseId] });
      toast({ title: "Session confirmed" });
    },
    onError: (err: Error) => toast({ title: "Session not ready to confirm", description: err.message, variant: "destructive" }),
  });

  const signFormMutation = useMutation({
    mutationFn: async ({ formId, signerName, confirmationTick }: { formId: string; signerName: string; confirmationTick: boolean }) => {
      await apiRequest("POST", `/api/party-required-forms/${formId}/viewed`, {});
      const res = await apiRequest("POST", `/api/party-required-forms/${formId}/sign`, {
        signerName,
        confirmationTick,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      void refreshClientDashboardActions();
      toast({ title: "Form signed" });
      setSigningForm(null);
      setSignatureName("");
      setSignatureConfirmed(false);
    },
    onError: (err: Error) => toast({ title: "Failed to sign form", description: err.message, variant: "destructive" }),
  });

  const uploadSignedFormMutation = useMutation({
    mutationFn: async ({ formId, file, signerName, signedAt, uploadNotes }: { formId: string; file: File; signerName: string; signedAt: string; uploadNotes: string }) => {
      const payload = await fileToDataUrl(file);
      const res = await apiRequest("POST", `/api/party-required-forms/${formId}/upload-signed`, {
        fileName: payload.fileName,
        fileData: payload.fileData,
        mimeType: payload.fileMimeType,
        signerName,
        signedAt,
        uploadNotes: uploadNotes.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      void refreshClientDashboardActions();
      toast({ title: "Signed form uploaded" });
      setUploadingForm(null);
      setSignedUploadFile(null);
      setSignedUploadSignerName("");
      setSignedUploadDate("");
      setSignedUploadNotes("");
    },
    onError: (err: Error) => toast({ title: "Failed to upload signed form", description: err.message, variant: "destructive" }),
  });

  const withdrawOptionalFormMutation = useMutation({
    mutationFn: async (formId: string) => {
      const res = await apiRequest("POST", `/api/party-required-forms/${formId}/withdraw`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      void refreshClientDashboardActions();
      toast({ title: "Optional opt-in withdrawn" });
    },
    onError: (err: Error) => toast({ title: "Failed to withdraw opt-in", description: err.message, variant: "destructive" }),
  });

  const resendRequiredFormMutation = useMutation({
    mutationFn: async (formId: string) => {
      const res = await apiRequest("POST", `/api/party-required-forms/${formId}/resend`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
      toast({ title: "Signed form prompt resent" });
    },
    onError: (err: Error) => toast({ title: "Failed to resend form", description: err.message, variant: "destructive" }),
  });

  const {
    fallbackMeetingLink,
    joiningAppointmentId,
    joinAppointment,
    clearFallbackMeetingLink,
  } = useAuditedAppointmentJoin();

  const leadMediatorOptions = mediatorsQuery.data?.leadMediators ?? [];
  const coMediatorOptions = mediatorsQuery.data?.coMediators ?? [];
  const observerOptions = mediatorsQuery.data?.observers ?? [];
  const sessions = sessionsQuery.data?.sessions || [];
  const sessionSummary = sessionsQuery.data?.summary || { numberOfSessions: sessions.filter((session) => session.status !== "cancelled").length, totalMediationHours: 0 };
  const sessionsNewestFirst = [...sessions].sort((a, b) => b.sessionNumber - a.sessionNumber);
  const latestSessionAccordionValue = sessionsNewestFirst[0] ? `session-${sessionsNewestFirst[0].id}` : undefined;
  const readiness = sessionsQuery.data?.readiness;
  const isEditingAllocation = Boolean(editingSessionId);
  const editingSession = sessions.find((session) => session.id === editingSessionId) || null;
  const allocationFormBlocked = !isEditingAllocation && !readiness?.ready;
  const approvedMediatorIds = new Set(leadMediatorOptions.map((m) => m.id));
  const eligibleCoMediatorIds = new Set(coMediatorOptions.map((m) => m.id));
  const eligibleObserverIds = new Set(observerOptions.map((m) => m.id));
  const selectedLeadIsApproved = approvedMediatorIds.has(leadMediatorId);
  const currentLeadIsStale = Boolean(isEditingAllocation && leadMediatorId && !selectedLeadIsApproved);
  const editingParticipantNameById = new Map((editingSession?.participants || []).map((participant) => [participant.userId, participant.userName]));
  const staleSelectedCoMediatorIds = coMediatorIds.filter((id) => !eligibleCoMediatorIds.has(id));
  const staleSelectedObserverIds = observerIds.filter((id) => !eligibleObserverIds.has(id));
  const hasStaleSelectedParticipants = staleSelectedCoMediatorIds.length > 0 || staleSelectedObserverIds.length > 0;
  const mediatorNameById = new Map(
    [...leadMediatorOptions, ...coMediatorOptions, ...observerOptions].map((m) => [m.id, m.name]),
  );
  const selectedLeadMediatorName = leadMediatorId
    ? mediatorNameById.get(leadMediatorId) || (editingSession?.leadMediatorId === leadMediatorId ? editingSession.leadMediatorName : null) || "Unknown mediator"
    : "None";
  const selectedCoMediatorNames = coMediatorIds.map((id) => mediatorNameById.get(id) || editingParticipantNameById.get(id) || "Unknown mediator");
  const selectedObserverNames = observerIds.map((id) => mediatorNameById.get(id) || editingParticipantNameById.get(id) || "Unknown mediator");
  const currentCoMediatorNames = editingSession?.participants.filter((p) => p.role === "co_mediator").map((p) => p.userName) || [];
  const currentObserverNames = editingSession?.participants.filter((p) => p.role === "observer").map((p) => p.userName) || [];
  const showSessionPaymentDetails = isAdmin;
  const partyById = new Map(parties.map((party) => [party.id, party]));
  const formatSessionDateTime = (value?: string | Date | null) => value ? formatUkWallClockDateTime(value) : "Not set";
  const optionalRequiredFormTypes = new Set(["voucher_diversity_questionnaire_opt_in", "voucher_moj_research_contact_opt_in"]);
  const canManageRequiredFormDelivery = (session: MediationSessionView) => isAdmin || user?.id === session.leadMediatorId || sessionAccess === "co_mediator";
  const signingStatusLabel = (form: RequiredFormView) => form.withdrawnAt ? "withdrawn" : form.status === "sent" ? "outstanding" : form.status;
  const deliveryBadgeLabel = (form: RequiredFormView) => {
    if (form.deliveryStatus === "email_sent") return "Email sent";
    if (form.deliveryStatus === "email_failed") return "Email failed";
    if (form.deliveryStatus === "email_skipped") return "Email skipped";
    if (form.deliveryStatus === "in_app_task_created") return "In-app task";
    return "Not sent";
  };
  const deliveryBadgeVariant = (form: RequiredFormView) => {
    if (form.deliveryStatus === "email_sent" || form.deliveryStatus === "in_app_task_created") return "default";
    if (form.deliveryStatus === "email_failed") return "destructive";
    return "outline";
  };
  const prefillRequiredFormSignerName = (form: RequiredFormView) => {
    const party = partyById.get(form.partyId);
    return `${party?.firstName || ""} ${party?.lastName || ""}`.trim() || user?.name || "";
  };
  const openRequiredFormSignatureDialog = (form: RequiredFormView) => {
    setSigningForm(form);
    setSignatureName(form.signerName || prefillRequiredFormSignerName(form));
    setSignatureConfirmed(false);
  };
  const openSignedRequiredFormUploadDialog = (form: RequiredFormView) => {
    setUploadingForm(form);
    setSignedUploadSignerName(form.signerName || prefillRequiredFormSignerName(form));
    setSignedUploadDate(new Date().toISOString().slice(0, 10));
    setSignedUploadFile(null);
    setSignedUploadNotes("");
  };
  const formLabel = (type: string) => {
    if (type === "agreement_to_mediate_confidentiality") return "Confidentiality + Agreement to Mediate";
    if (type === "voucher_scheme_client_consent") return "Family Mediation Voucher Scheme client consent";
    if (type === "voucher_diversity_questionnaire_opt_in") return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
    if (type === "voucher_moj_research_contact_opt_in") return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
    return "required mediation form";
  };
  const voucherClaimStatusLabels = {
    voucher_claim_submitted: "Voucher claim submitted",
    claim_accepted: "Claim accepted",
    claim_paid: "Claim paid",
  } as const;
  const defaultRequiredFormAttestation = (formType: string) => {
    if (formType === "voucher_diversity_questionnaire_opt_in" || formType === "voucher_moj_research_contact_opt_in") {
      return "I confirm that I have read and agree to the Family Mediation Voucher Scheme: Privacy Policy and Client Consent.";
    }
    return `I confirm that I have read and agree to the ${formLabel(formType)}.`;
  };
  const durationFromWindow = (window: { startAt: string | Date; endAt: string | Date }) => {
    const duration = Math.round((new Date(window.endAt).getTime() - new Date(window.startAt).getTime()) / 60000);
    return Number.isFinite(duration) && duration > 0 ? duration : 120;
  };

  const pendingNextSessionRequest = sessionsNewestFirst
    .map((session) => {
      const task = (session.acknowledgementTasks || []).find((row) => row.type === "mediation_session_next_session_requested" && row.status !== "completed");
      const windows = (session.availabilityWindows || []).filter((window) => window.source === "next_session_request");
      return task && windows.length > 0 ? { session, task, windows } : null;
    })
    .find((request): request is { session: MediationSessionView; task: NonNullable<MediationSessionView["acknowledgementTasks"]>[number]; windows: NonNullable<MediationSessionView["availabilityWindows"]> } => Boolean(request)) || null;
  const pendingNextSessionNumber = pendingNextSessionRequest ? pendingNextSessionRequest.session.sessionNumber + 1 : sessions.length + 1;
  const pendingNextSessionReviewApproved = pendingNextSessionRequest?.session.postSessionReviewStatus === "approved";
  const pendingNextSessionDraft = pendingNextSessionRequest ? proposalDrafts[pendingNextSessionRequest.session.id] || { dateTime: "", duration: "120" } : { dateTime: "", duration: "120" };

  const toggleId = (list: string[], id: string, setter: (ids: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const loadAllocation = (session: MediationSessionView) => {
    setEditingSessionId(session.id);
    setLeadMediatorId(session.leadMediatorId || "");
    setCoMediatorIds(session.participants.filter((p) => p.role === "co_mediator").map((p) => p.userId));
    setObserverIds(session.participants.filter((p) => p.role === "observer").map((p) => p.userId));
    window.requestAnimationFrame(() => {
      allocationFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      allocationFormRef.current?.focus({ preventScroll: true });
    });
  };

  if (sessionsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="tab-mediation-sessions-content">
      {isAdmin && (
        <MiamReadinessCard readiness={readiness} dataTestId="card-mediation-readiness" />
      )}

      {isAdmin && (
        <Card
          ref={allocationFormRef}
          tabIndex={-1}
          className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="card-mediation-allocation-form"
        >
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-heading flex items-center gap-2">
              <UserCog className="w-4 h-4 text-[#b8825a]" />
              {editingSession ? `Manage team for Session ${editingSession.sessionNumber}` : `Allocate Session ${sessions.length + 1}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingSession && (
              <div className="rounded-md border border-[#a7baa4]/40 bg-[#a7baa4]/10 px-3 py-2 text-sm" data-testid="notice-editing-session-allocation">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground">Editing Session {editingSession.sessionNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      Current: lead {editingSession.leadMediatorName || "Unassigned"}; co-mediators {currentCoMediatorNames.join(", ") || "none"}; observers {currentObserverNames.join(", ") || "none"}.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Selected: lead {selectedLeadMediatorName}; co-mediators {selectedCoMediatorNames.join(", ") || "none"}; observers {selectedObserverNames.join(", ") || "none"}.
                    </p>
                    {(currentLeadIsStale || hasStaleSelectedParticipants) && (
                      <p className="text-xs font-medium text-amber-700" data-testid="warning-stale-session-team">
                        One or more current assignments are no longer eligible. Replace the lead and remove or replace each flagged participant before saving.
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={resetAllocationForm} disabled={allocationMutation.isPending} data-testid="button-clear-session-edit">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {isSuperadmin && !editingSession && pendingNextSessionRequest && (
              <section className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-3 min-w-0" data-testid="allocation-next-session-request-panel">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Lead mediator request</p>
                    <p className="text-sm font-medium break-words">Session {pendingNextSessionNumber} requested</p>
                    <p className="text-sm text-muted-foreground break-words">{pendingNextSessionRequest.task.message}</p>
                    {!pendingNextSessionReviewApproved && (
                      <p className="mt-2 rounded-md border border-amber-200 bg-background px-3 py-2 text-xs text-amber-800">
                        Post-session review must be approved before Session {pendingNextSessionNumber} can be proposed.
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="capitalize text-[10px] shrink-0">
                    {pendingNextSessionReviewApproved ? "ready to propose" : "review locked"}
                  </Badge>
                </div>
                <div className="grid gap-2">
                  {pendingNextSessionRequest.windows.map((window) => {
                    const duration = durationFromWindow(window);
                    return (
                      <div key={window.id} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs min-w-0">
                        <span className="min-w-0 break-words">{formatSessionDateTime(window.startAt)} to {formatSessionDateTime(window.endAt)}{window.notes ? ` · ${window.notes}` : ""}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-xs"
                          disabled={!pendingNextSessionReviewApproved}
                          onClick={() => setProposalDrafts((prev) => ({
                            ...prev,
                            [pendingNextSessionRequest.session.id]: {
                              dateTime: new Date(window.startAt).toISOString(),
                              duration: String(duration),
                            },
                          }))}
                          data-testid={`button-use-next-session-request-slot-${window.id}`}
                        >
                          Use slot
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px] items-start">
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-xs">Lead mediator slot</Label>
                    <SessionLeadMediatorSlotPicker
                      sessionId={pendingNextSessionRequest.session.id}
                      duration={Number.parseInt(pendingNextSessionDraft.duration || "120", 10) || 120}
                      selectedDateTime={pendingNextSessionDraft.dateTime}
                      onSelectSlot={(slot) => setProposalDrafts((prev) => ({
                        ...prev,
                        [pendingNextSessionRequest.session.id]: {
                          dateTime: new Date(slot.startAt).toISOString(),
                          duration: String(slot.duration || Number.parseInt(prev[pendingNextSessionRequest.session.id]?.duration || "120", 10) || 120),
                        },
                      }))}
                    />
                  </div>
                  <div className="space-y-3 min-w-0">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Minutes</Label>
                      <Input
                        value={pendingNextSessionDraft.duration}
                        onChange={(e) => setProposalDrafts((prev) => ({ ...prev, [pendingNextSessionRequest.session.id]: { dateTime: "", duration: e.target.value } }))}
                        disabled={proposeNextSessionMutation.isPending || !pendingNextSessionReviewApproved}
                      />
                    </div>
                    <div className="rounded-md border bg-background p-3 min-w-0">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Selected next session</p>
                      <p className="text-sm font-medium break-words mt-1">
                        {pendingNextSessionDraft.dateTime ? formatSessionDateTime(pendingNextSessionDraft.dateTime) : "Choose a mediator slot"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={!pendingNextSessionReviewApproved || proposeNextSessionMutation.isPending || !pendingNextSessionDraft.dateTime}
                      onClick={() => proposeNextSessionMutation.mutate({ sessionId: pendingNextSessionRequest.session.id, draft: pendingNextSessionDraft })}
                      data-testid="button-send-next-session-request-invites"
                    >
                      {proposeNextSessionMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                      {proposeNextSessionMutation.isPending ? "Sending invites..." : "Send next-session invites"}
                    </Button>
                  </div>
                </div>
              </section>
            )}
            <div className="grid gap-1.5 max-w-md">
              <Label className="text-xs">Lead mediator</Label>
              <Select value={leadMediatorId} onValueChange={setLeadMediatorId} disabled={allocationFormBlocked || allocationMutation.isPending}>
                <SelectTrigger data-testid="select-session-lead-mediator">
                  <SelectValue placeholder="Select lead mediator" />
                </SelectTrigger>
                <SelectContent>
                  {currentLeadIsStale && (
                    <SelectItem value={leadMediatorId} disabled>
                      {editingSession?.leadMediatorName || "Current lead mediator"} (current, no longer approved)
                    </SelectItem>
                  )}
                  {leadMediatorOptions.length === 0 ? (
                    <SelectItem value="__none" disabled>No eligible lead mediators</SelectItem>
                  ) : leadMediatorOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentLeadIsStale && (
                <p className="text-xs text-amber-700">Choose an approved Mediation Sessions mediator before saving this team.</p>
              )}
              {leadMediatorOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">A session lead must be active, Lead-qualified, and hold an approved, non-expired Mediation Sessions service approval.</p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs">Co-mediators</Label>
                <div className="rounded-md border divide-y max-h-52 overflow-y-auto" data-testid="list-session-co-mediators">
                  {staleSelectedCoMediatorIds.map((id) => (
                    <label key={`stale-co-${id}`} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer bg-amber-50 text-amber-800">
                      <Checkbox
                        checked
                        disabled={allocationMutation.isPending}
                        onCheckedChange={() => setCoMediatorIds(coMediatorIds.filter((mediatorId) => mediatorId !== id))}
                      />
                      {editingParticipantNameById.get(id) || "Current co-mediator"} (no longer eligible; remove to save)
                    </label>
                  ))}
                  {coMediatorOptions.filter((m) => m.id !== leadMediatorId).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No eligible co-mediators available.</p>
                  )}
                  {coMediatorOptions.filter((m) => m.id !== leadMediatorId).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={coMediatorIds.includes(m.id)}
                        disabled={allocationFormBlocked || allocationMutation.isPending}
                        onCheckedChange={() => toggleId(coMediatorIds, m.id, (ids) => {
                          setCoMediatorIds(ids);
                          setObserverIds(observerIds.filter((observerId) => observerId !== m.id));
                        })}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Observers</Label>
                <div className="rounded-md border divide-y max-h-52 overflow-y-auto" data-testid="list-session-observers">
                  {staleSelectedObserverIds.map((id) => (
                    <label key={`stale-observer-${id}`} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer bg-amber-50 text-amber-800">
                      <Checkbox
                        checked
                        disabled={allocationMutation.isPending}
                        onCheckedChange={() => setObserverIds(observerIds.filter((observerId) => observerId !== id))}
                      />
                      {editingParticipantNameById.get(id) || "Current observer"} (no longer eligible; remove to save)
                    </label>
                  ))}
                  {observerOptions.filter((m) => m.id !== leadMediatorId && !coMediatorIds.includes(m.id)).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No eligible observers available.</p>
                  )}
                  {observerOptions.filter((m) => m.id !== leadMediatorId && !coMediatorIds.includes(m.id)).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={observerIds.includes(m.id)}
                        disabled={allocationFormBlocked || allocationMutation.isPending}
                        onCheckedChange={() => toggleId(observerIds, m.id, setObserverIds)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 justify-end">
              {editingSessionId && (
                <Button variant="outline" onClick={resetAllocationForm} disabled={allocationMutation.isPending} data-testid="button-cancel-session-edit">
                  Cancel
                </Button>
              )}
              <Button
                className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                disabled={allocationFormBlocked || !leadMediatorId || !selectedLeadIsApproved || hasStaleSelectedParticipants || allocationMutation.isPending}
                onClick={() => allocationMutation.mutate()}
                data-testid="button-save-session-allocation"
              >
                {allocationMutation.isPending ? "Saving..." : editingSessionId ? "Save team" : "Allocate session"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-mediation-sessions-list">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <UsersIcon className="w-4 h-4 text-[#5a7d58]" />
            Mediation Sessions ({sessions.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border bg-muted/10 px-3 py-2" data-testid="mediation-session-summary-count">
              <p className="text-xs text-muted-foreground">Number of sessions</p>
              <p className="text-lg font-semibold">{sessionSummary.numberOfSessions}</p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2" data-testid="mediation-session-summary-hours">
              <p className="text-xs text-muted-foreground">Total mediation hours</p>
              <p className="text-lg font-semibold">{sessionSummary.totalMediationHours}</p>
            </div>
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-mediation-sessions">No mediation sessions allocated yet.</p>
          ) : (
            <Accordion
              type="multiple"
              key={latestSessionAccordionValue || "no-sessions"}
              defaultValue={latestSessionAccordionValue ? [latestSessionAccordionValue] : []}
              className="space-y-3"
              data-testid="mediation-session-accordion"
            >
              {sessionsNewestFirst.map((session) => {
            const draft = outcomeDrafts[session.id] || { outcome: session.outcome || "", outcomeNotes: session.outcomeNotes || "" };
            const summaryDraft = summaryDrafts[session.id] || {
              nextAction: session.nextAction || "",
              documentsRequired: session.documentsRequired || "",
              followUpRequirements: session.followUpRequirements || "",
              nextSessionRequired: Boolean(session.nextSessionRequired || session.outcome === "next_session_needed"),
            };
            const nextSessionNeeded = draft.outcome === "next_session_needed" || Boolean(session.nextSessionRequired);
            const coMediators = session.participants.filter((p) => p.role === "co_mediator");
            const observers = session.participants.filter((p) => p.role === "observer");
            const outcomeLabel = MEDIATION_OUTCOME_OPTIONS.find((o) => o.value === session.outcome)?.label;
            const sessionHeaderTime = session.appointment ? formatSessionDateTime(session.appointment.dateTime) : session.proposal ? formatSessionDateTime(session.proposal.proposedStartAt) : "No time proposed";
            const forms = session.requiredForms || [];
            const formRequirements = session.formRequirements || [];
            const visibleMissingFormRequirements = isClient ? [] : formRequirements.filter((req) => req.applicable && !req.issued);
            const showVoucherConsentProgress = isAdmin;
            const invoices = session.invoices || [];
            const availabilityWindows = session.availabilityWindows || [];
            const attendanceRows = session.partyAttendance || [];
            const noShowPartyIds = attendanceRows.filter((row) => row.status === "no_show").map((row) => row.partyId);
            const canLeadEquivalentSessionAction = sessionAccess === "full" || sessionAccess === "co_mediator";
            const canSeeJoinSession = isAdmin || isClient || canLeadEquivalentSessionAction || sessionAccess === "observer";
            const joinAvailability = session.appointment?.joinAvailability || {
              canJoin: Boolean(session.appointment?.canJoin),
              reasonCode: "confirmation_pending",
              message: "Join will be available when this session is ready.",
            };
            const canEditAttendance = !isClient && (isAdmin || canLeadEquivalentSessionAction);
            const canRecordOutcome = isAdmin || user?.id === session.leadMediatorId || sessionAccess === "co_mediator";
            const canEditPostSession = canRecordOutcome || (canLeadEquivalentSessionAction && !isClient);
            const postSessionReviewStatus = session.postSessionReviewStatus || (session.status === "completed" ? "approved" : "not_submitted");
            const postSessionReviewLabel = POST_SESSION_REVIEW_LABELS[postSessionReviewStatus] || "Not submitted";
            const postSessionReviewApproved = postSessionReviewStatus === "approved";
            const postSessionReviewPending = postSessionReviewStatus === "submitted" || postSessionReviewStatus === "changes_requested";
            const hasPostSessionSummary = Boolean(
              session.summarySubmittedAt ||
              session.outcome ||
              session.outcomeNotes ||
              session.nextAction ||
              session.documentsRequired ||
              session.followUpRequirements
            );
            const canAuthorPostSessionSummary = Boolean(
              canEditPostSession &&
              canLeadEquivalentSessionAction &&
              (postSessionReviewStatus === "not_submitted" || postSessionReviewStatus === "changes_requested")
            );
            const canRequestNextSession = nextSessionNeeded
              && session.status === "completed"
              && canLeadEquivalentSessionAction
              && (postSessionReviewStatus === "submitted" || postSessionReviewStatus === "approved");
            const reviewNotesDraft = postSessionReviewNotes[session.id] ?? session.postSessionReviewNotes ?? "";
            const draftScheduleSummary = session.draftFinancialSchedule || null;
            const hasConfirmedDraftSchedule = draftScheduleSummary?.status === "confirmed";
            const draftScheduleConfirmedLabel = draftScheduleSummary?.confirmedAt
              ? `Confirmed ${new Date(draftScheduleSummary.confirmedAt).toLocaleString()}`
              : "Confirmed";
            const draftScheduleSessionLabel = draftScheduleSummary?.confirmedInSessionId === session.id
              ? `Session ${session.sessionNumber}`
              : draftScheduleSummary?.confirmedInSessionId
                ? "another session"
                : "admin";
            const leadMediatorScheduleReviewMessage = hasConfirmedDraftSchedule
              ? "Confirmed Draft Financial Schedule will be sent for admin review with this summary."
              : draftScheduleSummary
                ? "Draft Financial Schedule is saved but not confirmed; confirm it before saving summary if it should be reviewed/shared."
                : "No confirmed Draft Financial Schedule will be sent.";
            const indicatorClass = session.indicator?.color === "red"
              ? "border-red-200 bg-red-50 text-red-700"
              : session.indicator?.color === "amber"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-green-200 bg-green-50 text-green-700";
            const ownNoShow = isClient && parties.some((party) => noShowPartyIds.includes(party.id));
            const proposalRecipients = session.proposal?.recipients || [];
            const staffProposalRecipients = proposalRecipients.filter(isStaffProposalRecipient);
            const proposalAccepted = proposalRecipients.length > 0 && proposalRecipients.every((recipient) => recipient.responseStatus === "accepted");
            const proposalDeclined = proposalRecipients.some((recipient) => recipient.responseStatus === "declined");
            const declinedRecipients = staffProposalRecipients.filter((recipient) => recipient.responseStatus === "declined");
            const rescheduleWindows = availabilityWindows.filter((window) => window.source === "reschedule_request");
            const acknowledgementTasks = session.acknowledgementTasks || [];
            const freshLinks = session.proposal ? proposalLinks[session.proposal.id] || [] : [];
            const unsignedForms = forms.filter((form) => form.status !== "signed");
            const unpaidInvoices = showSessionPaymentDetails ? invoices.filter((invoice) => invoice.outstandingPence > 0 && invoice.status !== "paid" && invoice.status !== "void") : [];
            const canConfirmSession = showSessionPaymentDetails && !!session.appointment && (!session.proposal || proposalAccepted) && unsignedForms.length === 0 && invoices.length > 0 && unpaidInvoices.length === 0;
            const confirmBlockers = [
              !session.appointment ? "No held appointment" : null,
              session.proposal && !proposalAccepted ? "Waiting for proposal responses" : null,
              unsignedForms.length > 0 ? `${unsignedForms.length} unsigned form${unsignedForms.length === 1 ? "" : "s"}` : null,
              showSessionPaymentDetails && invoices.length === 0 ? "No session invoices" : null,
              unpaidInvoices.length > 0 ? `${unpaidInvoices.length} unpaid invoice${unpaidInvoices.length === 1 ? "" : "s"}` : null,
            ].filter(Boolean);
            const canRequestReschedule = !isClient
              && ["allocated", "scheduled"].includes(session.status)
              && (isAdmin || canLeadEquivalentSessionAction);
            const renderParticipants = (rows: MediationSessionParticipantView[]) => rows.length ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {rows.map((participant) => (
                  <Badge
                    key={participant.id}
                    variant={participant.invitationStatus === "declined" ? "destructive" : participant.invitationStatus === "accepted" ? "default" : "outline"}
                    className="max-w-full justify-start text-xs"
                  >
                    <span className="truncate">{participant.userName}</span>
                    {participant.invitationStatus && <span className="ml-1 opacity-80">({participant.invitationStatus})</span>}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm mt-1 break-words">None</p>
            );

            return (
              <AccordionItem key={session.id} value={`session-${session.id}`} className="rounded-lg border bg-background px-4 sm:px-5" data-testid={`mediation-session-${session.id}`}>
                <AccordionTrigger className="gap-3 py-4 text-left hover:no-underline" data-testid={`mediation-session-trigger-${session.id}`}>
                  <span className="flex flex-1 items-start justify-between gap-3 pr-2">
                    <span className="min-w-0 space-y-1">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">Session {session.sessionNumber}</span>
                        <Badge variant="outline" className="text-xs capitalize">{session.status.replace(/_/g, " ")}</Badge>
                        {session.indicator && (
                          <Badge variant="outline" className={`text-xs ${indicatorClass}`} data-testid={`session-indicator-${session.id}`}>
                            {session.indicator.label}
                          </Badge>
                        )}
                        {!isClient && (
                          <Badge
                            variant={postSessionReviewApproved ? "default" : "outline"}
                            className="text-xs"
                            data-testid={`session-post-session-review-badge-${session.id}`}
                          >
                            {postSessionReviewLabel}
                          </Badge>
                        )}
                        {outcomeLabel && <Badge className="text-xs bg-[#a7baa4]/20 text-[#5a7d58] border-none">{outcomeLabel}</Badge>}
                      </span>
                      <span className="block text-sm text-muted-foreground break-words">Lead mediator: {session.leadMediatorName || "Unassigned"}</span>
                    </span>
                    <span className="block max-w-[260px] shrink-0 text-right text-xs text-muted-foreground break-words">{sessionHeaderTime}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-5" data-testid={`mediation-session-content-${session.id}`}>
              <div className="space-y-5 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap" data-testid={`session-summary-section-${session.id}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">Session {session.sessionNumber}</h3>
                      <Badge variant="outline" className="text-xs capitalize">{session.status.replace(/_/g, " ")}</Badge>
                      {session.indicator && (
                        <Badge variant="outline" className={`text-xs ${indicatorClass}`} data-testid={`session-indicator-${session.id}`}>
                          {session.indicator.label}
                        </Badge>
                      )}
                      {!isClient && (
                        <Badge
                          variant={postSessionReviewApproved ? "default" : "outline"}
                          className="text-xs"
                          data-testid={`session-post-session-review-badge-expanded-${session.id}`}
                        >
                          {postSessionReviewLabel}
                        </Badge>
                      )}
                      {outcomeLabel && <Badge className="text-xs bg-[#a7baa4]/20 text-[#5a7d58] border-none">{outcomeLabel}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Lead mediator: {session.leadMediatorName || "Unassigned"}</p>
                  </div>
                  {(isAdmin || canRequestReschedule) && (
                    <div className="flex items-center gap-2">
                      {isAdmin && session.status !== "cancelled" && (
                        <Button variant="outline" size="sm" onClick={() => loadAllocation(session)} data-testid={`button-edit-session-${session.id}`}>
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          Manage team
                        </Button>
                      )}
                      {isAdmin && session.status !== "cancelled" && (
                        <Button variant="outline" size="sm" onClick={() => setCancelSessionTarget(session)} data-testid={`button-cancel-mediation-session-${session.id}`}>
                          <X className="w-3.5 h-3.5 mr-1" />
                          Cancel session
                        </Button>
                      )}
                      {canRequestReschedule && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRescheduleSessionTarget(session);
                            setRescheduleDraft({ dateTime: "", duration: String(session.appointment?.duration || 120) });
                          }}
                          data-testid={`button-request-session-reschedule-${session.id}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />
                          Request reschedule
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 xl:grid-cols-2" data-testid={`session-participants-section-${session.id}`}>
                  <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Co-mediators</p>
                    {renderParticipants(coMediators)}
                  </div>
                  <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Observers</p>
                    {renderParticipants(observers)}
                  </div>
                </div>

                {(canEditAttendance || isClient) && (
                  <section className="rounded-md border p-3 space-y-3 min-w-0" data-testid={`session-client-attendance-section-${session.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Client attendance</p>
                      {noShowPartyIds.length > 0 && !isClient && (
                        <Badge variant="destructive" className="text-[10px]">
                          {noShowPartyIds.length} did not attend
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">This records attendance only; it does not cancel the session. No-show clients are not automatically refunded.</p>

                    {canEditAttendance ? (
                      <div className="grid gap-2 md:grid-cols-2" data-testid={`session-client-attendance-controls-${session.id}`}>
                        {parties.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No clients linked to this case.</p>
                        ) : parties.map((party) => {
                          const checked = noShowPartyIds.includes(party.id);
                          const nextNoShowPartyIds = checked
                            ? noShowPartyIds.filter((partyId) => partyId !== party.id)
                            : [...noShowPartyIds, party.id];
                          return (
                            <label key={party.id} className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2 text-sm">
                              <span className="min-w-0 break-words">
                                Client {party.role} - {`${party.firstName || ""} ${party.lastName || ""}`.trim() || "Unnamed client"}
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="text-xs text-muted-foreground">Did not attend</span>
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => attendanceMutation.mutate({ sessionId: session.id, noShowPartyIds: nextNoShowPartyIds })}
                                  disabled={attendanceMutation.isPending}
                                  data-testid={`checkbox-session-no-show-${session.id}-${party.id}`}
                                />
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : ownNoShow ? (
                      <p className="text-sm text-destructive" data-testid={`text-client-session-no-show-${session.id}`}>
                        You were marked as not attending this session.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground" data-testid={`text-client-session-attendance-${session.id}`}>
                        No no-show has been recorded for you.
                      </p>
                    )}
                  </section>
                )}

                <div className="space-y-4 min-w-0" data-testid={`session-booking-panel-${session.id}`}>
                  <section className="rounded-md border bg-muted/15 p-3 min-w-0" data-testid={`session-booking-status-section-${session.id}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Booking status</p>
                      {session.appointment ? (
                        <div className="mt-1 space-y-1">
                          <p className="text-sm font-medium break-words">{formatSessionDateTime(session.appointment.dateTime)} · {session.appointment.duration} minutes</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="capitalize">{session.appointment.status}</Badge>
                            {showSessionPaymentDetails && session.appointment && (
                              <Badge variant="outline" className="capitalize">{(session.appointment.paymentStatus || "payment_pending").replace(/_/g, " ")}</Badge>
                            )}
                            {session.appointment.holdExpiresAt && <span className="text-xs text-muted-foreground">Hold expires {formatSessionDateTime(session.appointment.holdExpiresAt)}</span>}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1">No appointment held yet.</p>
                      )}
                    </div>
                    {canSeeJoinSession && session.appointment && (
                      <div className="max-w-sm space-y-1 text-right">
                        <Button
                          size="sm"
                          className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                          onClick={() => void joinAppointment(session.appointment!.id)}
                          disabled={!joinAvailability.canJoin || joiningAppointmentId === session.appointment!.id}
                          aria-describedby={!joinAvailability.canJoin ? `join-session-reason-${session.id}` : undefined}
                          data-testid={`button-join-session-${session.id}`}
                        >
                          <Video className="w-3.5 h-3.5 mr-1" />
                          Join Session
                        </Button>
                        {!joinAvailability.canJoin && (
                          <p
                            id={`join-session-reason-${session.id}`}
                            className="text-xs text-muted-foreground"
                            data-testid={`text-join-session-reason-${session.id}`}
                          >
                            {joinAvailability.message}
                          </p>
                        )}
                      </div>
                    )}
	                  </div>
	                  </section>
	                  {session.appointment && (
	                    <SessionAppointmentHistoryList appointmentId={session.appointment.id} />
	                  )}

	                  <section className="rounded-md border p-3 space-y-3 min-w-0" data-testid={`session-availability-section-${session.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Proposed session slot</p>
                        <p className="text-sm text-muted-foreground">Clients confirm the proposed time by public link; the lead mediator is auto-approved from their calendar availability.</p>
                      </div>
                      {session.proposal && <Badge variant="outline" className="capitalize">{session.proposal.status}</Badge>}
                    </div>

                    {session.proposal ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 lg:grid-cols-3">
                          <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Proposed time</p>
                            <p className="text-sm font-medium break-words">{formatSessionDateTime(session.proposal.proposedStartAt)}</p>
                          </div>
                          <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Hold expiry</p>
                            <p className="text-sm font-medium break-words">{formatSessionDateTime(session.proposal.expiresAt)}</p>
                          </div>
                          <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Responses</p>
                            <p className="text-sm font-medium">{proposalRecipients.filter((r) => r.responseStatus === "accepted").length}/{proposalRecipients.length} accepted</p>
                          </div>
                        </div>

                        {isClient ? (
                          <ClientProposalResponsePanel
                            caseId={caseId}
                            sessionId={session.id}
                            proposal={session.proposal}
                            recipients={proposalRecipients}
                          />
                        ) : (
                        <div className="grid gap-2" data-testid={`session-proposal-response-links-${session.id}`}>
                          {staffProposalRecipients.map((recipient) => {
                            const freshLink = freshLinks.find((link) => link.recipientId === recipient.id);
                            const recipientTypeLabel = recipient.recipientType === "mediator_participant"
                              ? (recipient.participantRole || "mediator participant").replace(/_/g, " ")
                              : recipient.recipientType.replace(/_/g, " ");
                            return (
                              <div key={recipient.id} className="rounded-md border bg-muted/10 p-3 text-xs min-w-0">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div className="min-w-0">
                                    <p className="font-medium break-words">{recipient.recipientName}</p>
                                    <p className="text-muted-foreground break-words">{recipient.recipientEmail || "No email recorded"}</p>
                                    <p className="text-muted-foreground capitalize">{recipientTypeLabel}</p>
                                  </div>
                                  <Badge variant={recipient.responseStatus === "accepted" ? "default" : recipient.responseStatus === "declined" ? "destructive" : "outline"} className="capitalize text-[10px] shrink-0">{recipient.responseStatus}</Badge>
                                </div>
                                <p className="mt-2 font-medium text-[#5a7d58]">This link is only for {recipient.recipientName}.</p>
                                <div className="mt-2 grid gap-1 sm:grid-cols-3 text-muted-foreground">
                                  <span>Sent: {formatSessionDateTime(recipient.sentAt)}</span>
                                  <span>Viewed: {formatSessionDateTime(recipient.viewedAt)}</span>
                                  <span>Responded: {formatSessionDateTime(recipient.respondedAt)}</span>
                                </div>
                                {recipient.declineNotes && <p className="mt-2 break-words text-muted-foreground">{recipient.declineNotes}</p>}
                                {freshLink && (
                                  <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                                    <code className="rounded bg-white border px-2 py-1 overflow-x-auto whitespace-nowrap">{freshLink.publicUrl}</code>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      onClick={() => copyFreshLink(freshLink.publicUrl)}
                                      data-testid="button-copy-session-recipient-link"
                                    >
                                      <Copy className="w-3.5 h-3.5 mr-1" />
                                      Copy fresh link
                                    </Button>
                                  </div>
                                )}
                                {isAdmin && (
                                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => resendRecipientLinkMutation.mutate({
                                        proposalId: session.proposal!.id,
                                        recipientId: recipient.id,
                                        regenerateAccepted: recipient.responseStatus === "accepted",
                                      })}
                                      disabled={resendRecipientLinkMutation.isPending}
                                      data-testid="button-resend-session-recipient-link"
                                    >
                                      <Send className="w-3.5 h-3.5 mr-1" />
                                      {recipient.responseStatus === "accepted" ? "Regenerate accepted link" : "Resend link"}
                                    </Button>
                                    {recipient.recipientType === "client" && recipient.partyId && (
                                      <div className="w-full sm:w-auto">
                                        <CaseWhatsappTemplateDialog
                                          caseId={caseId}
                                          partyId={recipient.partyId}
                                          templateName="bfm_mediation_session_booking"
                                          endpoint={`/api/mediation-session-proposal-recipients/${recipient.id}/whatsapp-template`}
                                          label="Send WhatsApp link"
                                          description="Preview the mediation session response link WhatsApp template before sending it to this client."
                                          payload={{ responseLink: freshLink?.publicUrl }}
                                          testId="button-send-session-whatsapp-link"
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        )}

                        {freshLinks.length > 0 && (
                          <div className="rounded-md border bg-[#5a7d58]/5 p-3 space-y-2" data-testid={`session-generated-links-${session.id}`}>
                            <p className="text-xs font-medium text-[#5a7d58]">Fresh response links</p>
                            {freshLinks.map((link) => (
                              <div key={link.recipientId} className="grid gap-2 lg:grid-cols-[160px_minmax(0,1fr)] text-xs">
                                <span className="font-medium truncate">{link.recipientName}</span>
                                <code className="rounded bg-white border px-2 py-1 overflow-x-auto whitespace-nowrap">{link.publicUrl}</code>
                              </div>
                            ))}
                          </div>
                        )}

                        {isAdmin && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button variant="outline" size="sm" onClick={() => resendLinksMutation.mutate(session.proposal!.id)} disabled={resendLinksMutation.isPending}>
                              <Send className="w-3.5 h-3.5 mr-1" />
                              Regenerate all pending links
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => releaseHoldMutation.mutate(session.id)} disabled={releaseHoldMutation.isPending}>
                              <X className="w-3.5 h-3.5 mr-1" />
                              Release hold
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : isAdmin ? (
                      <div className="space-y-4" data-testid={`session-propose-slot-controls-${session.id}`}>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
                          <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs">Lead mediator availability</Label>
                            <SessionLeadMediatorSlotPicker
                              sessionId={session.id}
                              duration={Number.parseInt(proposalDrafts[session.id]?.duration || "120", 10) || 120}
                              selectedDateTime={proposalDrafts[session.id]?.dateTime}
                              onSelectSlot={(slot) => setProposalDrafts((prev) => ({
                                ...prev,
                                [session.id]: {
                                  dateTime: new Date(slot.startAt).toISOString(),
                                  duration: String(slot.duration || Number.parseInt(prev[session.id]?.duration || "120", 10) || 120),
                                },
                              }))}
                            />
                          </div>
                          <div className="space-y-3 min-w-0">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Minutes</Label>
                              <Input
                                value={proposalDrafts[session.id]?.duration || "120"}
                                onChange={(e) => setProposalDrafts((prev) => ({ ...prev, [session.id]: { dateTime: "", duration: e.target.value } }))}
                                disabled={proposeSlotMutation.isPending}
                              />
                            </div>
                            <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                              <p className="text-xs text-muted-foreground uppercase tracking-wide">Selected slot</p>
                              <p className="text-sm font-medium break-words mt-1">
                                {proposalDrafts[session.id]?.dateTime ? formatSessionDateTime(proposalDrafts[session.id].dateTime) : "Choose a mediator slot"}
                              </p>
                            </div>
                            <Button
                              className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white w-full"
                              disabled={proposeSlotMutation.isPending || !proposalDrafts[session.id]?.dateTime}
                              onClick={() => proposeSlotMutation.mutate({ sessionId: session.id, draft: proposalDrafts[session.id] || { dateTime: "", duration: "120" } })}
                            >
                              {proposeSlotMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CalendarDays className="w-3.5 h-3.5 mr-1" />}
                              {proposeSlotMutation.isPending ? "Proposing..." : "Propose and hold"}
                            </Button>
                            {proposeSlotMutation.isPending && (
                              <p className="text-xs text-muted-foreground" data-testid={`text-propose-slot-pending-${session.id}`}>
                                Creating hold and sending response links...
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No session time has been proposed yet.</p>
                    )}
                  </section>

                  {isAdmin && (proposalDeclined || rescheduleWindows.length > 0) && (
                    <section className="rounded-md border p-3 space-y-3 min-w-0" data-testid={`session-alternative-availability-section-${session.id}`}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Alternative availability</p>
                          <p className="text-sm text-muted-foreground">Shown after a recipient declines the proposed slot or a reschedule request is raised.</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => sessionsQuery.refetch()}
                            disabled={sessionsQuery.isFetching}
                            data-testid={`button-refresh-session-alternatives-${session.id}`}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${sessionsQuery.isFetching ? "animate-spin" : ""}`} />
                            Refresh
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setOverlapSessionId(session.id)}>
                            <Search className="w-3.5 h-3.5 mr-1" />
                            Find overlap
                          </Button>
                        </div>
                      </div>
                      {declinedRecipients.length === 0 && rescheduleWindows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No declined responses or reschedule alternatives yet.</p>
                      ) : (
                        <div className="grid gap-3" data-testid={`session-alternative-recipient-groups-${session.id}`}>
                          {rescheduleWindows.length > 0 && (
                            <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 min-w-0" data-testid={`session-reschedule-request-windows-${session.id}`}>
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium break-words">Reschedule request</p>
                                  <p className="text-xs text-muted-foreground">Use one of these requested alternatives or choose another mediator slot.</p>
                                </div>
                                <Badge variant="outline" className="capitalize text-[10px] shrink-0">admin review</Badge>
                              </div>
                              <div className="mt-3 grid gap-2">
                                {rescheduleWindows.map((window) => {
                                  const duration = durationFromWindow(window);
                                  return (
                                    <div key={window.id} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs min-w-0">
                                      <span className="min-w-0 break-words">{formatSessionDateTime(window.startAt)} to {formatSessionDateTime(window.endAt)}{window.notes ? ` · ${window.notes}` : ""}</span>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 shrink-0 px-2 text-xs"
                                        onClick={() => setProposalDrafts((prev) => ({
                                          ...prev,
                                          [session.id]: {
                                            dateTime: new Date(window.startAt).toISOString(),
                                            duration: String(duration),
                                          },
                                        }))}
                                        data-testid={`button-use-reschedule-slot-${window.id}`}
                                      >
                                        Use slot
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {declinedRecipients.map((recipient) => {
                            const recipientWindows = availabilityWindows.filter((window) => window.proposalRecipientId === recipient.id);
                            return (
                              <div key={recipient.id} className="rounded-md border bg-muted/10 p-3 min-w-0" data-testid={`session-alternative-recipient-${recipient.id}`}>
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium break-words">{recipient.recipientName}</p>
                                    <p className="text-xs text-muted-foreground capitalize">{recipient.recipientType}</p>
                                  </div>
                                  <Badge variant="destructive" className="capitalize text-[10px] shrink-0">{recipient.responseStatus}</Badge>
                                </div>
                                {recipient.declineNotes && <p className="mt-2 text-xs text-muted-foreground break-words">{recipient.declineNotes}</p>}
                                {recipientWindows.length === 0 ? (
                                  <p className="mt-3 text-sm text-muted-foreground">No alternatives submitted by this recipient yet.</p>
                                ) : (
                                  <div className="mt-3 grid gap-2">
                                    {recipientWindows.map((window) => {
                                      const duration = durationFromWindow(window);
                                      return (
                                        <div key={window.id} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs min-w-0">
                                          <span className="min-w-0 break-words">{formatSessionDateTime(window.startAt)} to {formatSessionDateTime(window.endAt)}</span>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 shrink-0 px-2 text-xs"
                                            onClick={() => setProposalDrafts((prev) => ({
                                              ...prev,
                                              [session.id]: {
                                                dateTime: new Date(window.startAt).toISOString(),
                                                duration: String(duration),
                                              },
                                            }))}
                                            data-testid={`button-use-alternative-slot-${window.id}`}
                                          >
                                            Use slot
                                          </Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {overlapSessionId === session.id && overlapQuery.data && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            {overlapQuery.data.hasCommonAvailability ? `${overlapQuery.data.commonSlots.length} matching slot(s)` : "No common availability found"}
                            {overlapQuery.data.missingPartyIds.length > 0 ? ` · ${overlapQuery.data.missingPartyIds.length} client(s) missing` : ""}
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            {(overlapQuery.data.commonSlots || []).slice(0, 6).map((slot) => (
                              <Button
                                key={`${slot.startAt}`}
                                variant="outline"
                                size="sm"
                                className="h-auto min-h-8 max-w-full whitespace-normal text-left"
                                onClick={() => setProposalDrafts((prev) => ({ ...prev, [session.id]: { dateTime: new Date(slot.startAt).toISOString(), duration: "120" } }))}
                              >
                                {formatSessionDateTime(slot.startAt)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px] items-start">
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs">Replacement mediator slot</Label>
                          <SessionLeadMediatorSlotPicker
                            sessionId={session.id}
                            duration={Number.parseInt(proposalDrafts[session.id]?.duration || "120", 10) || 120}
                            selectedDateTime={proposalDrafts[session.id]?.dateTime}
                            onSelectSlot={(slot) => setProposalDrafts((prev) => ({
                              ...prev,
                              [session.id]: {
                                dateTime: new Date(slot.startAt).toISOString(),
                                duration: String(slot.duration || Number.parseInt(prev[session.id]?.duration || "120", 10) || 120),
                              },
                            }))}
                          />
                        </div>
                        <div className="space-y-3 min-w-0">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Minutes</Label>
                            <Input
                              value={proposalDrafts[session.id]?.duration || "120"}
                              onChange={(e) => setProposalDrafts((prev) => ({ ...prev, [session.id]: { dateTime: "", duration: e.target.value } }))}
                              disabled={replaceSlotMutation.isPending}
                            />
                          </div>
                          <div className="rounded-md border bg-muted/10 p-3 min-w-0">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Selected replacement</p>
                            <p className="text-sm font-medium break-words mt-1">
                              {proposalDrafts[session.id]?.dateTime ? formatSessionDateTime(proposalDrafts[session.id].dateTime) : "Choose a mediator slot"}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            className="w-full"
                            disabled={replaceSlotMutation.isPending || !proposalDrafts[session.id]?.dateTime}
                            onClick={() => replaceSlotMutation.mutate({ sessionId: session.id, draft: proposalDrafts[session.id] || { dateTime: "", duration: "120" } })}
                          >
                            {replaceSlotMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            {replaceSlotMutation.isPending ? "Sending replacement..." : "Propose replacement"}
                          </Button>
                          {replaceSlotMutation.isPending && (
                            <p className="text-xs text-muted-foreground" data-testid={`text-replace-slot-pending-${session.id}`}>
                              Replacing hold and sending fresh response links...
                            </p>
                          )}
                        </div>
                      </div>
                    </section>
                  )}

                  {(visibleMissingFormRequirements.length > 0 || forms.length > 0 || invoices.length > 0 || acknowledgementTasks.length > 0 || session.appointment) && (
                    <section className="rounded-md border p-3 space-y-3 min-w-0" data-testid={`session-completion-checklist-section-${session.id}`}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Completion checklist</p>
                        {isAdmin && session.appointment && session.appointment.status !== "confirmed" && (
                          <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">
                            {confirmBlockers.length > 0 && <span className="text-xs text-muted-foreground break-words">{confirmBlockers.join(" · ")}</span>}
                            <Button variant="outline" className="shrink-0" disabled={confirmMutation.isPending || !canConfirmSession} onClick={() => confirmMutation.mutate(session.id)}>
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              Confirm when ready
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 xl:grid-cols-2">
                        <div className="space-y-2 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-muted-foreground">Forms</p>
                            {isAdmin && session.appointment && formRequirements.some((req) => req.applicable && !req.issued) && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => issueFormsMutation.mutate(session.id)} disabled={issueFormsMutation.isPending}>
                                <FileText className="w-3.5 h-3.5 mr-1" />
                                Issue missing forms
                              </Button>
                            )}
                          </div>
                          {visibleMissingFormRequirements.map((req) => (
                            <div key={req.formType} className={`text-xs rounded border px-2 py-1.5 min-w-0 ${req.applicable ? "bg-muted/10" : "bg-muted/5 opacity-75"}`} data-testid={`session-form-requirement-${req.formType}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">{req.label}</span>
                                <Badge variant={req.applicable ? req.issued ? "default" : "outline" : "secondary"} className="text-[10px] shrink-0">
                                  {req.applicable ? req.issued ? "Issued" : "Required" : "Not applicable"}
                                </Badge>
                              </div>
                              {req.reason && <p className="text-muted-foreground mt-1 break-words">{req.reason}</p>}
                            </div>
                          ))}
                          {forms.some((form) => form.formType.startsWith("voucher_")) && (
                            <div className="rounded-md border border-[#a7baa4]/50 bg-[#a7baa4]/10 px-2 py-1.5 text-xs text-[#355033]" data-testid="session-moj-voucher-forms-heading">
                              <span className="font-medium">MoJ Voucher Forms</span>
                              {isAdmin && <span> · Review signed voucher documents from the Proofing tab.</span>}
                            </div>
                          )}
                          {forms.map((form) => {
                            const canResendRequiredForm = canManageRequiredFormDelivery(session) && form.status !== "signed" && !form.withdrawnAt;
                            const canSignRequiredForm = isClient && form.status !== "signed" && !form.withdrawnAt;
                            const canUploadSignedRequiredForm = (isClient || canManageRequiredFormDelivery(session)) && form.status !== "signed" && !form.withdrawnAt;
                            const canWithdrawOptionalRequiredForm = optionalRequiredFormTypes.has(form.formType) && !form.withdrawnAt && (isClient || isAdmin);
                            const isVoucherRequiredForm = form.formType.startsWith("voucher_");
                            const isOptionalVoucherForm = optionalRequiredFormTypes.has(form.formType);
                            const requiredFormDisplayLabel = isClient ? formLabel(form.formType) : `Client ${partyById.get(form.partyId)?.role || "?"} · ${formLabel(form.formType)}`;
                            return (
                              <div key={form.id} className="text-xs rounded border bg-muted/10 px-2 py-1.5 min-w-0 overflow-hidden" data-testid={`session-required-form-row-${form.id}`}>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <span className="flex max-w-full flex-wrap items-center gap-1.5">
                                      <span className="truncate">{requiredFormDisplayLabel}</span>
                                      {isVoucherRequiredForm && (
                                        <Badge variant={isOptionalVoucherForm ? "outline" : "default"} className="text-[10px] shrink-0">
                                          {isOptionalVoucherForm ? "Optional" : "Mandatory"}
                                        </Badge>
                                      )}
                                    </span>
                                    {(form.generatedDocumentId || form.uploadedDocumentId || form.courtFormGenerationId || form.withdrawnAt) && (
                                      <span className="block text-[11px] text-muted-foreground truncate">
                                        {form.withdrawnAt
                                          ? "Optional opt-in withdrawn"
                                          : form.uploadedDocumentId
                                            ? "Signed upload stored"
                                            : form.courtFormGenerationId
                                              ? "Locked signed PDF generated"
                                              : "Signature evidence snapshot stored"}
                                      </span>
                                    )}
                                    <div className="flex max-w-full flex-wrap items-center gap-2">
                                      <Badge variant={form.status === "signed" ? "default" : "outline"} className="capitalize text-[10px]">{signingStatusLabel(form)}</Badge>
                                      {form.status !== "signed" && !form.withdrawnAt && (
                                        <Badge variant={deliveryBadgeVariant(form) as any} className="text-[10px]" title={form.deliveryError || undefined}>{deliveryBadgeLabel(form)}</Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex max-w-full flex-wrap items-center justify-start gap-2 sm:justify-end" data-testid={`session-required-form-actions-${form.id}`}>
                                    {canResendRequiredForm && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs shrink-0"
                                        onClick={() => resendRequiredFormMutation.mutate(form.id)}
                                        disabled={resendRequiredFormMutation.isPending}
                                        data-testid="button-resend-required-form"
                                      >
                                        <Send className="w-3.5 h-3.5 mr-1" />
                                        Resend
                                      </Button>
                                    )}
                                    {canUploadSignedRequiredForm && (
                                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={() => openSignedRequiredFormUploadDialog(form)} disabled={uploadSignedFormMutation.isPending} data-testid="button-upload-signed-required-form">
                                        <Upload className="w-3.5 h-3.5 mr-1" />
                                        Upload
                                      </Button>
                                    )}
                                    {canWithdrawOptionalRequiredForm && (
                                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={() => withdrawOptionalFormMutation.mutate(form.id)} disabled={withdrawOptionalFormMutation.isPending} data-testid="button-withdraw-optional-required-form">
                                        Withdraw
                                      </Button>
                                    )}
                                    {canSignRequiredForm && (
                                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={() => openRequiredFormSignatureDialog(form)} disabled={signFormMutation.isPending}>
                                        Sign
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {showVoucherConsentProgress && (() => {
                            const voucherConsentForms = forms.filter((form) => form.formType === "voucher_scheme_client_consent");
                            if (voucherConsentForms.length === 0) return null;
                            const signedCount = voucherConsentForms.filter((form) => form.status === "signed").length;
                            const signedCountLabel = `${signedCount} of ${voucherConsentForms.length} signed`;
                            const outstandingClientNames = voucherConsentForms
                              .filter((form) => form.status !== "signed")
                              .map((form) => {
                                const party = partyById.get(form.partyId);
                                return `${party?.firstName || ""} ${party?.lastName || ""}`.trim() || `Client ${party?.role || "?"}`;
                              });
                            return (
                              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="voucher-consent-signed-progress">
                                <span className="font-medium">Family Mediation Voucher Scheme client consent:</span>{" "}
                                <span>{signedCountLabel}</span>
                                {outstandingClientNames.length > 0 && (
                                  <span> · Outstanding: {outstandingClientNames.join(", ")}</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {showSessionPaymentDetails && (
                        <div className="space-y-2 min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">Payments and admin acknowledgement</p>
                          {invoices.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No session invoices yet.</p>
                          ) : invoices.map((invoice) => (
                            <div key={invoice.id} className="text-xs rounded border bg-muted/10 px-2 py-1.5 min-w-0 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">{invoice.invoiceNumber} · Client {partyById.get(invoice.billToPartyId || "")?.role || "?"}</span>
                                <Badge variant={invoice.outstandingPence <= 0 || invoice.status === "paid" ? "default" : "outline"} className="capitalize text-[10px] shrink-0">{invoice.status}</Badge>
                              </div>
                              {(invoice.voucherDiscountPence || 0) > 0 && (
                                <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                                  <span>Subtotal {formatPence(invoice.subtotalPence || invoice.totalPence + (invoice.voucherDiscountPence || 0), invoice.currency || "gbp")}</span>
                                  <span>Voucher discount -{formatPence(invoice.voucherDiscountPence || 0, invoice.currency || "gbp")}</span>
                                  <span>Total payable {formatPence(invoice.totalPence, invoice.currency || "gbp")}</span>
                                </div>
                              )}
                            </div>
                          ))}
                          {acknowledgementTasks.map((task) => (
                            <div key={task.id} className="text-xs rounded border bg-muted/10 px-2 py-1.5 break-words">{task.title} · {task.status}</div>
                          ))}
                        </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>

                {session.outcomeNotes && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Outcome notes</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{session.outcomeNotes}</p>
                  </div>
                )}

                {!isClient && (
                  <section className="rounded-md border p-3 space-y-3 min-w-0" data-testid={`session-notes-section-${session.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Session notes</p>
                        <p className="text-xs text-muted-foreground">
                          {session.noteSummary?.count || 0} note{session.noteSummary?.count === 1 ? "" : "s"}
                          {session.noteSummary?.latestNoteAuthor ? ` · latest by ${session.noteSummary.latestNoteAuthor}` : ""}
                        </p>
                      </div>
                    </div>
                    {canEditPostSession && (
                      <div className="grid gap-2">
                        <Textarea
                          value={sessionNoteDrafts[session.id] || ""}
                          onChange={(e) => setSessionNoteDrafts((prev) => ({ ...prev, [session.id]: e.target.value }))}
                          className="min-h-[70px]"
                          placeholder="Add a staff-only note for this mediation session"
                          data-testid={`textarea-session-note-${session.id}`}
                        />
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={addSessionNoteMutation.isPending || !(sessionNoteDrafts[session.id] || "").trim()}
                            onClick={() => addSessionNoteMutation.mutate({ sessionId: session.id, content: sessionNoteDrafts[session.id] || "" })}
                            data-testid={`button-add-session-note-${session.id}`}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            Add note
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {!isClient && hasPostSessionSummary && !canAuthorPostSessionSummary && (
                  <section className="rounded-md border bg-muted/20 p-3 space-y-3" data-testid={`session-post-summary-readonly-${session.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Submitted summary</p>
                        <p className="text-sm font-medium">{postSessionReviewLabel}</p>
                      </div>
                      {session.summarySubmittedAt && (
                        <p className="text-xs text-muted-foreground">Submitted {new Date(session.summarySubmittedAt).toLocaleString()}</p>
                      )}
                    </div>
                    {postSessionReviewStatus === "submitted" && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Submitted for admin review</p>
                    )}
                    {postSessionReviewStatus === "approved" && (
                      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Approved post-session summary</p>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border bg-background p-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Outcome</p>
                        <p className="mt-1 text-sm font-medium">{outcomeLabel || "Not recorded"}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Outcome notes</p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{session.outcomeNotes || "No outcome notes recorded."}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Next action</p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{session.nextAction || "No next action recorded."}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Documents required</p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{session.documentsRequired || "No documents required."}</p>
                      </div>
                      <div className="rounded-md border bg-background p-2 md:col-span-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Follow-up requirements</p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{session.followUpRequirements || "No follow-up requirements recorded."}</p>
                      </div>
                    </div>
                  </section>
                )}

                {isAdmin && postSessionReviewPending && (
                  <section className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-3" data-testid={`session-post-session-review-panel-${session.id}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Post-session review</p>
                        <p className="text-sm font-medium">{postSessionReviewLabel}</p>
                      </div>
                      {session.summarySubmittedAt && (
                        <p className="text-xs text-muted-foreground">Submitted {new Date(session.summarySubmittedAt).toLocaleString()}</p>
                      )}
                    </div>
                    {session.postSessionReviewNotes && (
                      <div className="rounded-md border bg-background p-2 text-sm">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Previous review notes</p>
                        <p className="mt-1 whitespace-pre-wrap">{session.postSessionReviewNotes}</p>
                      </div>
                    )}
                    <div className="rounded-md border bg-background p-2 text-sm" data-testid={`session-post-session-review-schedule-status-${session.id}`}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Draft Financial Schedule</p>
                      {hasConfirmedDraftSchedule ? (
                        <div className="mt-1 space-y-2">
                          <p>
                            {draftScheduleConfirmedLabel} via {draftScheduleSessionLabel}. Approving this review will share the confirmed Draft Financial Schedule PDF with clients.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => window.open(`/api/cases/${caseId}/draft-financial-schedule/export.pdf`, "_blank")}
                            data-testid={`button-export-review-draft-financial-schedule-${session.id}`}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Export PDF
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-1">Approving this review will not create or share a Draft Financial Schedule PDF.</p>
                      )}
                    </div>
                    <Textarea
                      value={reviewNotesDraft}
                      onChange={(e) => setPostSessionReviewNotes((prev) => ({ ...prev, [session.id]: e.target.value }))}
                      placeholder="Reviewer notes"
                      className="min-h-[70px]"
                      data-testid={`textarea-post-session-review-notes-${session.id}`}
                    />
                    <div className="flex justify-end gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={postSessionReviewMutation.isPending}
                        onClick={() => postSessionReviewMutation.mutate({ sessionId: session.id, decision: "changes_requested", reviewNotes: reviewNotesDraft })}
                        data-testid={`button-request-post-session-review-changes-${session.id}`}
                      >
                        Request changes
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={postSessionReviewMutation.isPending}
                        onClick={() => postSessionReviewMutation.mutate({ sessionId: session.id, decision: "approved", reviewNotes: reviewNotesDraft })}
                        data-testid={`button-approve-post-session-review-${session.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Approve
                      </Button>
                    </div>
                  </section>
                )}

	                {canAuthorPostSessionSummary && (
	                  <div className="rounded-md border bg-muted/20 p-3 space-y-3" data-testid={`session-post-summary-section-${session.id}`}>
	                    {canRecordOutcome && (
	                      <span className="sr-only">Lead mediators and admins can record session outcomes.</span>
	                    )}
	                    <p className="text-xs text-muted-foreground" data-testid={`text-session-outcome-completes-${session.id}`}>
	                      Recording an outcome marks this mediation session as completed. Saving the summary submits it for admin review.
	                    </p>
                    {canLeadEquivalentSessionAction && (
                      <p className={`rounded-md border px-3 py-2 text-xs ${hasConfirmedDraftSchedule ? "border-emerald-200 bg-emerald-50 text-emerald-800" : draftScheduleSummary ? "border-amber-200 bg-amber-50 text-amber-800" : "border-muted bg-background text-muted-foreground"}`} data-testid={`session-post-summary-schedule-status-${session.id}`}>
                        {leadMediatorScheduleReviewMessage}
                      </p>
                    )}
                    {postSessionReviewStatus === "submitted" && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Submitted for admin review</p>
                    )}
                    {postSessionReviewStatus === "changes_requested" && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Changes requested. Update the summary and save again to resubmit.
                      </p>
                    )}
                    <div className="grid gap-3 md:grid-cols-[minmax(180px,260px)_1fr]">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Outcome</Label>
                        <Select
                          value={draft.outcome}
                          onValueChange={(value) => {
                            setOutcomeDrafts((prev) => ({ ...prev, [session.id]: { ...draft, outcome: value } }));
                            setSummaryDrafts((prev) => ({
                              ...prev,
                              [session.id]: {
                                ...(prev[session.id] || summaryDraft),
                                nextSessionRequired: value === "next_session_needed",
                              },
                            }));
                          }}
                        >
                          <SelectTrigger data-testid={`select-session-outcome-${session.id}`}>
                            <SelectValue placeholder="Select outcome" />
                          </SelectTrigger>
                          <SelectContent>
                            {MEDIATION_OUTCOME_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Outcome notes</Label>
                        <Textarea
                          value={draft.outcomeNotes}
                          onChange={(e) => setOutcomeDrafts((prev) => ({ ...prev, [session.id]: { ...draft, outcomeNotes: e.target.value } }))}
                          className="min-h-[70px]"
                          data-testid={`textarea-session-outcome-notes-${session.id}`}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Next action</Label>
                        <Textarea
                          value={summaryDraft.nextAction}
                          onChange={(e) => setSummaryDrafts((prev) => ({ ...prev, [session.id]: { ...summaryDraft, nextAction: e.target.value } }))}
                          className="min-h-[70px]"
                          data-testid={`textarea-session-next-action-${session.id}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Documents required</Label>
                        <Textarea
                          value={summaryDraft.documentsRequired}
                          onChange={(e) => setSummaryDrafts((prev) => ({ ...prev, [session.id]: { ...summaryDraft, documentsRequired: e.target.value } }))}
                          className="min-h-[70px]"
                          data-testid={`textarea-session-documents-required-${session.id}`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Follow-up requirements</Label>
                        <Textarea
                          value={summaryDraft.followUpRequirements}
                          onChange={(e) => setSummaryDrafts((prev) => ({ ...prev, [session.id]: { ...summaryDraft, followUpRequirements: e.target.value } }))}
                          className="min-h-[70px]"
                          data-testid={`textarea-session-follow-up-requirements-${session.id}`}
                        />
                      </div>
                    </div>
                    {nextSessionNeeded && canLeadEquivalentSessionAction && postSessionReviewStatus === "not_submitted" && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Save and submit this summary before requesting a next session.
                      </p>
                    )}
                    {nextSessionNeeded && canLeadEquivalentSessionAction && postSessionReviewStatus === "changes_requested" && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Update and resubmit this summary before requesting a next session.
                      </p>
                    )}
                    {canRequestNextSession && (
                      <div className="rounded-md border bg-background p-3 space-y-3" data-testid={`session-next-request-section-${session.id}`}>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Request next session</p>
                          <p className="text-sm text-muted-foreground">Suggest a date for superadmin review. Superadmin sends the client invites.</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setNextSessionRequestTarget(session);
                            setNextSessionRequestDraft({ dateTime: "", duration: String(session.appointment?.duration || 120) });
                          }}
                          data-testid={`button-request-next-session-${session.id}`}
                        >
                          <CalendarDays className="w-3.5 h-3.5 mr-1" />
                          Request next session
                        </Button>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!draft.outcome || summaryMutation.isPending}
                        onClick={() => summaryMutation.mutate({
                          sessionId: session.id,
                          outcome: draft.outcome,
                          outcomeNotes: draft.outcomeNotes,
                          nextAction: summaryDraft.nextAction,
                          documentsRequired: summaryDraft.documentsRequired,
                          followUpRequirements: summaryDraft.followUpRequirements,
                          nextSessionRequired: draft.outcome === "next_session_needed",
                        })}
                        data-testid={`button-record-session-outcome-${session.id}`}
                      >
                        <Save className="w-3.5 h-3.5 mr-1" />
                        {postSessionReviewStatus === "changes_requested" ? "Resubmit summary" : "Save summary"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
                </AccordionContent>
              </AccordionItem>
            );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!signingForm} onOpenChange={(open) => { if (!open) { setSigningForm(null); setSignatureName(""); setSignatureConfirmed(false); } }}>
        <DialogContent data-testid="dialog-required-form-signature">
          <DialogHeader>
            <DialogTitle>Sign {signingForm ? formLabel(signingForm.formType) : "required form"}</DialogTitle>
            <DialogDescription>
              Your typed name and confirmation will be stored with the timestamp and connection details for this case record.
            </DialogDescription>
          </DialogHeader>
          {signingForm && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/10 p-3 text-sm">
                {defaultRequiredFormAttestation(signingForm.formType)}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="required-form-signer-name">Signer name</Label>
                <Input
                  id="required-form-signer-name"
                  value={signatureName}
                  onChange={(event) => setSignatureName(event.target.value)}
                  data-testid="input-required-form-signer-name"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={signatureConfirmed}
                  onCheckedChange={(checked) => setSignatureConfirmed(checked === true)}
                  data-testid="checkbox-required-form-confirmation"
                />
                <span>I confirm that this typed name is my signature for this form.</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSigningForm(null); setSignatureName(""); setSignatureConfirmed(false); }} disabled={signFormMutation.isPending}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!signingForm || !signatureName.trim() || !signatureConfirmed || signFormMutation.isPending}
              onClick={() => signingForm && signFormMutation.mutate({ formId: signingForm.id, signerName: signatureName.trim(), confirmationTick: signatureConfirmed })}
            >
              {signFormMutation.isPending ? "Signing..." : "Sign form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!uploadingForm} onOpenChange={(open) => { if (!open) { setUploadingForm(null); setSignedUploadFile(null); setSignedUploadSignerName(""); setSignedUploadDate(""); setSignedUploadNotes(""); } }}>
        <DialogContent data-testid="dialog-required-form-upload">
          <DialogHeader>
            <DialogTitle>Upload signed {uploadingForm ? formLabel(uploadingForm.formType) : "required form"}</DialogTitle>
            <DialogDescription>
              Use this for signed evidence completed outside the client portal.
            </DialogDescription>
          </DialogHeader>
          {uploadingForm && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="signed-required-form-file">Signed file</Label>
                <Input
                  id="signed-required-form-file"
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(event) => setSignedUploadFile(event.target.files?.[0] || null)}
                  data-testid="input-signed-required-form-file"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signed-required-form-name">Signer name</Label>
                <Input
                  id="signed-required-form-name"
                  value={signedUploadSignerName}
                  onChange={(event) => setSignedUploadSignerName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signed-required-form-date">Signed date</Label>
                <Input
                  id="signed-required-form-date"
                  type="date"
                  value={signedUploadDate}
                  onChange={(event) => setSignedUploadDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signed-required-form-notes">Notes</Label>
                <Textarea
                  id="signed-required-form-notes"
                  value={signedUploadNotes}
                  onChange={(event) => setSignedUploadNotes(event.target.value)}
                  className="min-h-[80px]"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadingForm(null); setSignedUploadFile(null); setSignedUploadSignerName(""); setSignedUploadDate(""); setSignedUploadNotes(""); }} disabled={uploadSignedFormMutation.isPending}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!uploadingForm || !signedUploadFile || !signedUploadSignerName.trim() || !signedUploadDate || uploadSignedFormMutation.isPending}
              onClick={() => uploadingForm && signedUploadFile && uploadSignedFormMutation.mutate({
                formId: uploadingForm.id,
                file: signedUploadFile,
                signerName: signedUploadSignerName.trim(),
                signedAt: signedUploadDate,
                uploadNotes: signedUploadNotes,
              })}
            >
              {uploadSignedFormMutation.isPending ? "Uploading..." : "Upload signed form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MediationSessionRequestDialog
        open={!!rescheduleSessionTarget}
        onClose={() => { setRescheduleSessionTarget(null); setRescheduleReason(""); setRescheduleDraft({ dateTime: "", duration: "120" }); }}
        dialogTestId="dialog-request-session-reschedule"
        title="Request reschedule"
        description="Send a reschedule request for admin review. Admins can use the requested time to send fresh acceptance links."
        reason={rescheduleReason}
        onReasonChange={setRescheduleReason}
        reasonTestId="textarea-session-reschedule-reason"
        slotLabel="Suggested replacement time"
        sessionId={rescheduleSessionTarget?.id}
        duration={Number.parseInt(rescheduleDraft.duration || "120", 10) || 120}
        selectedDateTime={rescheduleDraft.dateTime}
        onSelectSlot={(slot) => setRescheduleDraft({
          dateTime: new Date(slot.startAt).toISOString(),
          duration: String(slot.duration || Number.parseInt(rescheduleDraft.duration || "120", 10) || 120),
        })}
        durationValue={rescheduleDraft.duration}
        onDurationChange={(value) => setRescheduleDraft({ dateTime: "", duration: value })}
        selectedLabel="Selected replacement"
        selectedFallback="Choose a mediator slot"
        isPending={requestRescheduleMutation.isPending}
        sendDisabled={!rescheduleReason.trim() || !rescheduleDraft.dateTime || requestRescheduleMutation.isPending || !rescheduleSessionTarget}
        onSend={() => rescheduleSessionTarget && requestRescheduleMutation.mutate({ sessionId: rescheduleSessionTarget.id, reason: rescheduleReason, draft: rescheduleDraft })}
      />
      <MediationSessionRequestDialog
        open={!!nextSessionRequestTarget}
        onClose={() => { setNextSessionRequestTarget(null); setNextSessionRequestReason(""); setNextSessionRequestDraft({ dateTime: "", duration: "120" }); }}
        dialogTestId="dialog-request-next-session"
        title="Request next session"
        description="Send a next-session request for superadmin review. Superadmin can use this time or choose a different slot before inviting clients."
        reason={nextSessionRequestReason}
        onReasonChange={setNextSessionRequestReason}
        reasonTestId="textarea-next-session-request-reason"
        slotLabel="Suggested next-session time"
        sessionId={nextSessionRequestTarget?.id}
        duration={Number.parseInt(nextSessionRequestDraft.duration || "120", 10) || 120}
        selectedDateTime={nextSessionRequestDraft.dateTime}
        onSelectSlot={(slot) => setNextSessionRequestDraft({
          dateTime: new Date(slot.startAt).toISOString(),
          duration: String(slot.duration || Number.parseInt(nextSessionRequestDraft.duration || "120", 10) || 120),
        })}
        durationValue={nextSessionRequestDraft.duration}
        onDurationChange={(value) => setNextSessionRequestDraft({ dateTime: "", duration: value })}
        selectedLabel="Selected next session"
        selectedFallback="Choose a mediator slot"
        isPending={requestNextSessionMutation.isPending}
        sendDisabled={!nextSessionRequestReason.trim() || !nextSessionRequestDraft.dateTime || requestNextSessionMutation.isPending || !nextSessionRequestTarget}
        onSend={() => nextSessionRequestTarget && requestNextSessionMutation.mutate({ sessionId: nextSessionRequestTarget.id, reason: nextSessionRequestReason, draft: nextSessionRequestDraft })}
      />
      <Dialog open={!!cancelSessionTarget} onOpenChange={(open) => { if (!open) { setCancelSessionTarget(null); setCancelSessionReason(""); } }}>
        <DialogContent data-testid="dialog-cancel-mediation-session">
          <DialogHeader>
            <DialogTitle>Cancel mediation session</DialogTitle>
            <DialogDescription>
              This cancels the mediation session separately from no-show attendance and records the reason for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-mediation-session-reason">Reason</Label>
            <Textarea
              id="cancel-mediation-session-reason"
              value={cancelSessionReason}
              onChange={(e) => setCancelSessionReason(e.target.value)}
              className="min-h-[100px]"
              data-testid="textarea-cancel-mediation-session-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelSessionTarget(null); setCancelSessionReason(""); }} disabled={cancelSessionMutation.isPending}>
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelSessionReason.trim() || cancelSessionMutation.isPending || !cancelSessionTarget}
              onClick={() => cancelSessionTarget && cancelSessionMutation.mutate({ sessionId: cancelSessionTarget.id, reason: cancelSessionReason })}
            >
              {cancelSessionMutation.isPending ? "Cancelling..." : "Cancel session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AppointmentJoinFallbackDialog meetingLink={fallbackMeetingLink} onClose={clearFallbackMeetingLink} />
    </div>
  );
}

function CaseDocumentsPanel({ caseId, canView, canUpload, isAdmin, onReviewInProofing }: { caseId: string; canView: boolean; canUpload: boolean; isAdmin: boolean; onReviewInProofing?: (proofingItemId: string) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [sessionId, setSessionId] = useState<string>("none");
  const [readyForReview, setReadyForReview] = useState(true);
  const [fileDraft, setFileDraft] = useState<{ fileName: string; fileData: string; fileMimeType: string } | null>(null);
  const [uploadingBlankForm, setUploadingBlankForm] = useState<DocumentBlankFormView | null>(null);
  const [blankFormSignerName, setBlankFormSignerName] = useState("");
  const [blankFormSignedDate, setBlankFormSignedDate] = useState("");
  const [blankFormFile, setBlankFormFile] = useState<File | null>(null);
  const [previewDocument, setPreviewDocument] = useState<CaseDocumentView | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [showFormEvidence, setShowFormEvidence] = useState(false);

  const documentsQuery = useQuery<CaseDocumentView[]>({
    queryKey: ["/api/cases", caseId, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/documents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load case documents");
      return res.json();
    },
    enabled: !!caseId && canView,
  });

  const sessionsQuery = useQuery<MediationSessionsResponse>({
    queryKey: ["/api/cases", caseId, "mediation-sessions"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/mediation-sessions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load mediation sessions");
      return res.json();
    },
    enabled: !!caseId && canView,
  });

  const blankFormsQuery = useQuery<DocumentBlankFormView[]>({
    queryKey: ["/api/cases", caseId, "document-blank-forms"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/document-blank-forms`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load blank forms");
      return res.json();
    },
    enabled: !!caseId && canView,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!fileDraft) throw new Error("Select a document to upload");
      const res = await apiRequest("POST", `/api/cases/${caseId}/documents`, {
        title: title.trim() || fileDraft.fileName,
        fileName: fileDraft.fileName,
        fileData: fileDraft.fileData,
        mimeType: fileDraft.fileMimeType,
        mediationSessionId: sessionId === "none" ? null : sessionId,
        readyForReview,
      });
      return res.json();
    },
    onSuccess: () => {
      setTitle("");
      setSessionId("none");
      setReadyForReview(true);
      setFileDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "proofing-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      toast({ title: "Document uploaded" });
    },
    onError: (err: Error) => toast({ title: "Failed to upload document", description: err.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, reviewStatus, sharedWithClients }: { id: string; reviewStatus: string; sharedWithClients?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/case-documents/${id}/review`, { reviewStatus, sharedWithClients });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "proofing-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      toast({ title: "Document review updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update document", description: err.message, variant: "destructive" }),
  });

  const uploadCompletedBlankFormMutation = useMutation({
    mutationFn: async () => {
      if (!uploadingBlankForm) throw new Error("Choose a form to upload against");
      if (!blankFormFile) throw new Error("Select a completed form file");
      const payload = await fileToDataUrl(blankFormFile);
      const body = {
        fileName: payload.fileName,
        fileData: payload.fileData,
        mimeType: payload.fileMimeType,
        signerName: blankFormSignerName.trim(),
        signedAt: blankFormSignedDate,
      };
      if (uploadingBlankForm.uploadMode === "required_form") {
        if (!uploadingBlankForm.requiredFormId) throw new Error("Choose an issued form to upload against");
        const res = await apiRequest("POST", `/api/party-required-forms/${uploadingBlankForm.requiredFormId}/upload-signed`, {
          ...body,
          uploadNotes: "Uploaded from Documents tab",
        });
        return res.json();
      }
      if (uploadingBlankForm.uploadMode === "case_document") {
        if (!uploadingBlankForm.templateId) throw new Error("Blank form template is required");
        const res = await apiRequest("POST", `/api/cases/${caseId}/document-blank-forms/${uploadingBlankForm.templateId}/upload`, body);
        return res.json();
      }
      throw new Error("This form cannot be uploaded");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "proofing-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "document-blank-forms"] });
      void refreshClientDashboardActions();
      toast({ title: "Completed form uploaded for review" });
      setUploadingBlankForm(null);
      setBlankFormSignerName("");
      setBlankFormSignedDate("");
      setBlankFormFile(null);
    },
    onError: (err: Error) => toast({ title: "Failed to upload completed form", description: err.message, variant: "destructive" }),
  });

  const documents = documentsQuery.data || [];
  const displayDocuments = dedupeMoJPrivacyConsentDocuments(documents);
  const genericDocuments = displayDocuments.filter((document) => !document.documentRequestId && document.documentCategory !== "requested_evidence");
  const libraryDocuments = genericDocuments.filter((document) => showFormEvidence || !isRequiredFormEvidenceDocument(document));
  const hiddenFormEvidenceCount = genericDocuments.length - libraryDocuments.length;
  const blankForms = blankFormsQuery.data || [];
  const sessions = sessionsQuery.data?.sessions || [];
  const sessionLabel = (id?: string | null) => {
    const session = sessions.find((row) => row.id === id);
    return session ? `Session ${session.sessionNumber}` : "Case document";
  };
  const openDocumentPreview = (document: CaseDocumentView) => {
    setPreviewDocument(document);
    setPreviewLoaded(false);
    setPreviewError(false);
  };
  const openCompletedFormUpload = (form: DocumentBlankFormView) => {
    setUploadingBlankForm(form);
    setBlankFormSignerName(user?.name || "");
    setBlankFormSignedDate(new Date().toISOString().slice(0, 10));
    setBlankFormFile(null);
  };
  const formStatusLabel = (form: DocumentBlankFormView) => {
    if (form.completedDocumentProofingStatus === "returned") return "Returned";
    if (form.completedDocumentProofingStatus === "withdrawn") return "Withdrawn";
    if (form.completedDocumentProofingStatus === "awaiting_review") return "Awaiting admin review";
    if (form.status === "signed" || form.completedDocumentReviewStatus === "reviewed") return "Completed";
    if (form.completedDocumentReviewStatus === "ready_for_review" || form.status === "ready_for_review") return "Awaiting admin review";
    return "Outstanding";
  };
  const formStatusVariant = (form: DocumentBlankFormView) => {
    const label = formStatusLabel(form);
    return label === "Completed" ? "default" : label === "Awaiting admin review" || label === "Returned" ? "outline" : "secondary";
  };
  const documentStatusLabel = (document: CaseDocumentView) => {
    if (document.proofingStatus === "awaiting_review") return "Awaiting admin review";
    if (document.proofingStatus === "returned") return "Returned";
    if (document.proofingStatus === "withdrawn") return "Withdrawn";
    if (document.reviewStatus === "reviewed" || document.proofingStatus === "approved") return "Completed";
    if (document.reviewStatus === "ready_for_review") return "Awaiting admin review";
    return "Draft";
  };
  const signatureSourceLabel = (source?: string | null) => {
    if (source === "platform") return "Portal signature";
    if (source === "upload") return "Client upload";
    if (source === "admin_offline") return "Admin offline upload";
    return null;
  };
  const openCompletedDocumentPreview = (form: DocumentBlankFormView) => {
    if (!form.completedDocumentId || !form.completedDocumentUrl) return;
    openDocumentPreview({
      id: form.completedDocumentId,
      caseId,
      title: form.completedDocumentTitle || form.label,
      fileName: form.completedDocumentTitle || form.label,
      fileUrl: form.completedDocumentUrl,
      uploadedBy: "",
      reviewStatus: (form.completedDocumentReviewStatus as CaseDocumentView["reviewStatus"]) || "reviewed",
      sharedWithClients: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  if (!canView) return null;

  return (
    <Card data-testid="card-case-documents">
      <CardHeader>
        <CardTitle className="text-base font-heading flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-[#5a7d58]" />
          Case documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/10 p-3 space-y-3" data-testid="section-required-forms">
          <div>
            <h3 className="text-sm font-medium">Forms to complete</h3>
            <p className="text-xs text-muted-foreground">Download, sign, upload, and track required case forms from one place.</p>
          </div>
          {blankFormsQuery.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : blankForms.length === 0 ? (
            <p className="text-sm text-muted-foreground">No required forms are currently available for this case.</p>
          ) : (
            <div className="space-y-2">
              {blankForms.map((form) => (
                <div key={`${form.formType}-${form.partyId || "case"}`} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-2 py-1.5" data-testid={`row-document-blank-form-${form.formType}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium truncate">{form.label}</p>
                      <Badge variant={formStatusVariant(form)} className="text-[10px]">
                        {formStatusLabel(form)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {form.partyId ? "Client-specific form" : "Case form"}
                      {!form.canDownload && " · Blank form not available"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {form.canDownload && form.downloadUrl && formStatusLabel(form) !== "Completed" && (
                      <Button size="sm" variant="outline" asChild data-testid="button-download-blank-form">
                        <a href={form.downloadUrl}>Download blank form</a>
                      </Button>
                    )}
                    {form.canUploadCompletedForm && (
                      <Button size="sm" variant="outline" onClick={() => openCompletedFormUpload(form)} data-testid="button-upload-completed-form">
                        Upload completed form
                      </Button>
                    )}
                    {form.completedDocumentUrl && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => openCompletedDocumentPreview(form)} data-testid="button-preview-completed-form-document">
                          Preview
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <a href={form.completedDocumentUrl} target="_blank" rel="noreferrer" download>
                            Download
                          </a>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {canUpload && (
        <div className="rounded-md border bg-muted/10 p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" data-testid="input-case-document-title" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Session</Label>
              <Select value={sessionId} onValueChange={setSessionId}>
                <SelectTrigger data-testid="select-case-document-session">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Case document</SelectItem>
                  {sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>Session {session.sessionNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              type="file"
              className="max-w-sm"
              data-testid="input-case-document-file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileDraft(await fileToDataUrl(file));
              }}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={readyForReview} onCheckedChange={(checked) => setReadyForReview(Boolean(checked))} />
              Ready for review
            </label>
            <Button
              variant="outline"
              disabled={uploadMutation.isPending || !fileDraft}
              onClick={() => uploadMutation.mutate()}
              data-testid="button-upload-case-document"
            >
              <Upload className="w-3.5 h-3.5 mr-1" />
              Upload
            </Button>
          </div>
          {fileDraft && <p className="text-xs text-muted-foreground">Selected: {fileDraft.fileName}</p>}
        </div>
        )}

        <div className="space-y-3" data-testid="section-document-library">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Document library</h3>
              <p className="text-xs text-muted-foreground">Uploaded case files and shared documents. Form evidence is tracked above.</p>
            </div>
            {canUpload && hiddenFormEvidenceCount > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={showFormEvidence} onCheckedChange={setShowFormEvidence} data-testid="switch-show-form-evidence" />
                Show form evidence
              </label>
            )}
          </div>
          {documentsQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : libraryDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {displayDocuments.length > 0 && hiddenFormEvidenceCount > 0
                ? "Only form evidence has been uploaded so far."
                : canUpload ? "No case documents uploaded yet." : "No shared case documents yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {libraryDocuments.map((document) => (
                <div key={document.id} className="rounded-md border p-3 flex items-start justify-between gap-3 flex-wrap" data-testid={`case-document-${document.id}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">{document.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {sessionLabel(document.mediationSessionId)} · {document.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {document.partyName || "Case-level document"}
                      {" · "}
                      Uploaded by {document.uploadedByName || "Unknown"}
                      {" · "}
                      {formatDate(document.createdAt)}
                      {signatureSourceLabel(document.signatureSource) ? ` · ${signatureSourceLabel(document.signatureSource)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => openDocumentPreview(document)} data-testid="button-preview-case-document">
                      Preview
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={document.fileUrl} target="_blank" rel="noreferrer" download>
                        Download
                      </a>
                    </Button>
                    <Badge variant={documentStatusLabel(document) === "Completed" ? "default" : documentStatusLabel(document) === "Awaiting admin review" ? "outline" : "secondary"}>
                      {documentStatusLabel(document)}
                    </Badge>
                    {isAdmin && document.proofingItemId && (document.proofingStatus === "awaiting_review" || document.proofingStatus === "returned") && onReviewInProofing && (
                      <Button size="sm" variant="outline" onClick={() => onReviewInProofing(document.proofingItemId!)}>
                        Review in Proofing
                      </Button>
                    )}
                    {isAdmin && !document.proofingItemId && document.reviewStatus !== "ready_for_review" && (
                      <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ id: document.id, reviewStatus: "ready_for_review" })}>
                        Ready for review
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <Dialog open={!!uploadingBlankForm} onOpenChange={(open) => { if (!open) { setUploadingBlankForm(null); setBlankFormFile(null); } }}>
        <DialogContent data-testid="dialog-upload-completed-document-form">
          <DialogHeader>
            <DialogTitle>Upload completed form</DialogTitle>
            <DialogDescription>
              {uploadingBlankForm ? uploadingBlankForm.label : "Upload a completed form"} for admin review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Signer name</Label>
              <Input value={blankFormSignerName} onChange={(e) => setBlankFormSignerName(e.target.value)} data-testid="input-document-form-signer-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Signed date</Label>
              <Input type="date" value={blankFormSignedDate} onChange={(e) => setBlankFormSignedDate(e.target.value)} data-testid="input-document-form-signed-date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Completed form file</Label>
              <Input type="file" onChange={(e) => setBlankFormFile(e.target.files?.[0] || null)} data-testid="input-document-form-file" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadingBlankForm(null); setBlankFormFile(null); }} disabled={uploadCompletedBlankFormMutation.isPending}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!uploadingBlankForm || !blankFormFile || !blankFormSignerName.trim() || !blankFormSignedDate || uploadCompletedBlankFormMutation.isPending}
              onClick={() => uploadCompletedBlankFormMutation.mutate()}
            >
              {uploadCompletedBlankFormMutation.isPending ? "Uploading..." : "Upload for review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!previewDocument} onOpenChange={(open) => { if (!open) setPreviewDocument(null); }}>
        <DialogContent className="sm:max-w-6xl max-h-[92vh] overflow-hidden flex flex-col" data-testid="dialog-case-document-preview">
          <DialogHeader>
            <DialogTitle>{previewDocument ? `${previewDocument.title} preview` : "Document preview"}</DialogTitle>
            <DialogDescription>
              Preview uploaded documents in the browser. Use Download if the file cannot be previewed.
            </DialogDescription>
          </DialogHeader>
          <div className="relative rounded-md border bg-muted/30 overflow-hidden">
            {!previewLoaded && !previewError && (
              <div className="absolute inset-0 z-10 flex h-[70vh] items-center justify-center bg-background/80 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading document...
              </div>
            )}
            {previewError ? (
              <div className="flex h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-destructive">This document could not be previewed in the browser.</p>
                {previewDocument && (
                  <Button variant="outline" asChild>
                    <a href={previewDocument.fileUrl} target="_blank" rel="noreferrer" download>
                      Download
                    </a>
                  </Button>
                )}
              </div>
            ) : previewDocument ? (
              <iframe
                title={`${previewDocument.title} preview`}
                src={previewDocument.fileUrl}
                className="h-[70vh] w-full border-0 bg-white"
                onLoad={() => setPreviewLoaded(true)}
                onError={() => setPreviewError(true)}
                data-testid="iframe-case-document-preview"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type FinancialDisclosureUploadTargetView = "online_disclosure_booklet" | "form_e" | "ofs" | "financial_disclosure_checklist" | "evidence_category";
type FinancialDisclosureProgressStatus = "not_started" | "in_progress" | "completed" | "submitted";
type BookletSectionView = DisclosureBookletSection & { status: FinancialDisclosureProgressStatus; updatedAt?: string | null };
type ChecklistRowView = { key: string; label: string; status: FinancialDisclosureProgressStatus; received?: boolean; documentDate?: string | null; receivedAt?: string | null; notes?: string };

const MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_FINANCIAL_DISCLOSURE_FILE_TYPES = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv";
const CHECKLIST_ROWS: Array<{ key: string; label: string }> = [
  { key: "matrimonial_home_valuation", label: "Matrimonial home valuation" },
  { key: "matrimonial_home_mortgage", label: "Matrimonial home mortgage statement" },
  { key: "other_property_valuation", label: "Other property valuation" },
  { key: "other_property_mortgage", label: "Other property mortgage statement" },
  { key: "personal_bank_building_society_national_savings", label: "Personal bank, building society and National Savings statements" },
  { key: "other_investments", label: "Other investment statements" },
  { key: "life_insurance_policies", label: "Life insurance or endowment policy surrender valuations" },
  { key: "business_accounts", label: "Business accounts for the last two financial years" },
  { key: "business_valuation", label: "Business valuation evidence" },
  { key: "pension_cetv_statements", label: "Pension CETV statements" },
  { key: "p60", label: "P60 for the last financial year" },
  { key: "payslips", label: "Last three payslips" },
  { key: "p11d", label: "P11D work-related expenses form" },
  { key: "tax_assessment", label: "Tax assessment" },
  { key: "management_accounts", label: "Management accounts for changed self-employment income" },
  { key: "other_documents", label: "Description of other documents attached" },
  { key: "application_to_vary_order", label: "Application to vary an order" },
];

function normalizedBookletSections(payload: Record<string, unknown>): BookletSectionView[] {
  const normalized = ensureFieldBasedBookletPayload(payload);
  return FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA.map((definition) => {
    const row = normalized.progress[definition.key] || {};
    return {
      ...definition,
      status: row.status === "submitted" || row.status === "completed" || row.status === "in_progress" ? row.status : "not_started",
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    };
  });
}

function normalizedChecklistRows(payload: Record<string, unknown>): ChecklistRowView[] {
  const rows = Array.isArray((payload as any).rows) ? (payload as any).rows : [];
  return CHECKLIST_ROWS.map((definition) => {
    const row = rows.find((item: any) => item?.key === definition.key) || {};
    return {
      key: definition.key,
      label: definition.label,
      status: row.status === "completed" || row.status === "in_progress" ? row.status : "not_started",
      received: Boolean(row.received),
      documentDate: typeof row.documentDate === "string" ? row.documentDate : null,
      receivedAt: typeof row.receivedAt === "string" ? row.receivedAt : null,
      notes: typeof row.notes === "string" ? row.notes : "",
    };
  });
}

function answerValue(source: Record<string, any>, path: string[]): string {
  const value = path.reduce<any>((current, key) => current?.[key], source);
  return value == null ? "" : String(value);
}

function setAnswerValue(source: Record<string, any>, path: string[], value: unknown): Record<string, any> {
  const [head, ...tail] = path;
  if (!head) return source;
  if (tail.length === 0) return { ...source, [head]: value };
  return { ...source, [head]: setAnswerValue(source[head] && typeof source[head] === "object" ? source[head] : {}, tail, value) };
}

function FinancialDisclosureBookletWizard({
  item,
  updateBookletSection,
  submitBooklet,
  submitBookletPending,
}: {
  item: FinancialDisclosureItemView;
  updateBookletSection: (item: FinancialDisclosureItemView, sectionKey: string, status: FinancialDisclosureProgressStatus, answers: Record<string, unknown>) => Promise<FinancialDisclosureItemView>;
  submitBooklet: (item: FinancialDisclosureItemView, sectionKey: string, answers: Record<string, unknown>, status: FinancialDisclosureProgressStatus) => Promise<void>;
  submitBookletPending: boolean;
}) {
  const { toast } = useToast();
  const payload = ensureFieldBasedBookletPayload(item.payload || {}) as DisclosureBookletPayload;
  const [activeSectionKey, setActiveSectionKey] = useState(FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA[0]?.key || "");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, any>>(payload.answers);
  const [saveStates, setSaveStates] = useState<Record<string, { status: "idle" | "saving" | "saved" | "error"; message?: string; savedAt?: string }>>({});
  const sections = normalizedBookletSections(item.payload || {});
  const activeSection = FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA.find((section) => section.key === activeSectionKey) || FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA[0];
  const section = activeSection;
  const totals = calculateDisclosureBookletTotals(answerDrafts);

  useEffect(() => {
    setAnswerDrafts(ensureFieldBasedBookletPayload(item.payload || {}).answers);
  }, [item.id, item.payload, item.updatedAt]);

  const saveSection = async (sectionKey: string, status?: FinancialDisclosureProgressStatus) => {
    const answers = answerDrafts[sectionKey] || {};
    const hasContent = JSON.stringify(answers).replace(/[{}\[\]",:]/g, "").trim().length > 0;
    setSaveStates((prev) => ({ ...prev, [sectionKey]: { status: "saving" } }));
    try {
      const updated = await updateBookletSection(item, sectionKey, status || (hasContent ? "in_progress" : "not_started"), answers);
      const normalized = ensureFieldBasedBookletPayload(updated.payload || {});
      setAnswerDrafts(normalized.answers);
      setSaveStates((prev) => ({
        ...prev,
        [sectionKey]: { status: "saved", savedAt: new Date().toISOString() },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save this booklet section";
      setSaveStates((prev) => ({ ...prev, [sectionKey]: { status: "error", message } }));
      toast({ title: "Failed to save booklet section", description: message, variant: "destructive" });
    }
  };

  const submitCurrentBooklet = async () => {
    if (!activeSectionKey) return;
    try {
      await submitBooklet(item, activeSectionKey, answerDrafts[activeSectionKey] || {}, "submitted");
    } catch {
      // The mutation owns the user-facing error toast.
    }
  };

  const renderField = (section: { key: string }, path: string[], field: { key: string; label: string; type: string; calculated?: boolean }) => {
    const fullPath = [section.key, ...path, field.key];
    const value = answerValue(answerDrafts, fullPath);
    const inputType = field.type === "currency" || field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    return (
      <div key={fullPath.join(".")} className="space-y-1.5">
        <Label className="text-xs">{field.label}</Label>
        <Input
          type={inputType}
          value={value}
          onChange={(e) => setAnswerDrafts((prev) => setAnswerValue(prev, fullPath, e.target.value))}
          data-testid={`input-booklet-field-${section.key}-${field.key}`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="financial-disclosure-booklet-wizard">
      <div className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <Button
            key={section.key}
            type="button"
            size="sm"
            variant={section.key === activeSectionKey ? "default" : "outline"}
            onClick={() => setActiveSectionKey(section.key)}
            data-testid={`booklet-section-${section.key}`}
          >
            {section.title}
          </Button>
        ))}
      </div>
      {section && (
        <div className="space-y-4 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{section.title}</p>
              <p className="text-xs text-muted-foreground">{payload.progress[section.key]?.status?.replace(/_/g, " ") || "not started"}</p>
              {saveStates[section.key]?.status === "saved" && (
                <p className="text-xs text-[#5a7d58]" data-testid={`text-booklet-section-save-status-${section.key}`}>
                  Last saved {new Date(saveStates[section.key].savedAt || Date.now()).toLocaleTimeString()}
                </p>
              )}
              {saveStates[section.key]?.status === "error" && (
                <p className="text-xs text-red-600" data-testid={`text-booklet-section-save-status-${section.key}`}>
                  {saveStates[section.key].message}
                </p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void saveSection(section.key)}
              disabled={submitBookletPending || saveStates[section.key]?.status === "saving"}
              data-testid={`button-save-booklet-section-${section.key}`}
            >
              {saveStates[section.key]?.status === "saving" ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-1" />
              )}
              {saveStates[section.key]?.status === "saving" ? "Saving..." : "Save"}
            </Button>
          </div>
          {section.fields && (
            <div className="grid gap-3 md:grid-cols-2">
              {section.fields.map((field) => renderField(section, [], field))}
            </div>
          )}
          {section.summaryFields && (
            <div className="grid gap-3 md:grid-cols-2">
              {section.summaryFields.map((field) => renderField(section, ["summary"], field))}
            </div>
          )}
          {(section.subsections || []).map((subsection) => (
            <div key={subsection.key} className="space-y-3 border-t pt-3">
              <p className="text-sm font-medium">{subsection.title}</p>
              {subsection.fields && !subsection.repeatable && (
                <div className="grid gap-3 md:grid-cols-2">
                  {subsection.fields.map((field) => renderField(section, [subsection.key], field))}
                </div>
              )}
              {subsection.columns && subsection.repeatable && (
                <Textarea
                  rows={4}
                  value={JSON.stringify(answerDrafts[section.key]?.[subsection.key] || [], null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value || "[]");
                      setAnswerDrafts((prev) => setAnswerValue(prev, [section.key, subsection.key], parsed as any));
                    } catch {
                      setAnswerDrafts((prev) => setAnswerValue(prev, [section.key, subsection.key], e.target.value));
                    }
                  }}
                  data-testid={`input-booklet-field-${section.key}-${subsection.key}`}
                />
              )}
              {(subsection.subsections || []).map((child) => (
                <div key={child.key} className="space-y-2 rounded-md bg-muted/30 p-3">
                  <p className="text-xs font-medium">{child.title}</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {child.fields.map((field) => renderField(section, [subsection.key, child.key], field))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {section.key === "a1_monthly_income_employment_self_employment" && (
            <div className="grid gap-3 rounded-md bg-muted/30 p-3 text-sm md:grid-cols-2">
              <span>Total deductions: £{totals.a1.total_deductions}</span>
              <span>Net income from employment: £{totals.a1.net_income_from_employment}</span>
            </div>
          )}
          {section.key === "a2_other_income" && (
            <div className="grid gap-3 rounded-md bg-muted/30 p-3 text-sm md:grid-cols-2">
              <span>Total other income: £{totals.a2.total_other_income}</span>
              <span>Total net monthly income: £{totals.a2.total_net_monthly_income}</span>
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void submitCurrentBooklet()}
          disabled={submitBookletPending}
          data-testid="button-submit-financial-disclosure-booklet"
        >
          {submitBookletPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
          {submitBookletPending ? "Submitting..." : "Submit booklet"}
        </Button>
      </div>
    </div>
  );
}

function FinancialDisclosureCombinedBookletView({ folders }: { folders: FinancialDisclosureFolderView[] }) {
  const partyPayload = (role: string) => {
    const folder = folders.find((candidate) => (candidate.party.role || "").toUpperCase() === role);
    const item = folder?.items.find((candidate) => candidate.itemType === "online_disclosure_booklet");
    return folder && item ? {
      partyId: folder.partyId,
      clientName: [folder.party.firstName, folder.party.lastName].filter(Boolean).join(" ") || `Client ${folder.party.role}`,
      payload: ensureFieldBasedBookletPayload(item.payload || {}),
    } : null;
  };
  const combined = buildCombinedDisclosureBookletView({ clientA: partyPayload("A"), clientB: partyPayload("B") });
  const renderCombinedField = (sectionKey: string, path: string[], field: { key: string; label: string }) => {
    const fullPath = [sectionKey, ...path, field.key];
    return (
      <div key={fullPath.join(".")} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,180px)_minmax(100px,180px)] gap-2 text-sm">
        <span>{field.label}</span>
        <span>{answerValue(combined.answerPayloads.clientA, fullPath)}</span>
        <span>{answerValue(combined.answerPayloads.clientB, fullPath)}</span>
      </div>
    );
  };
  const repeatableSummary = (answers: Record<string, any>, sectionKey: string, subsectionKey: string) => {
    const rows = answers?.[sectionKey]?.[subsectionKey];
    if (!Array.isArray(rows) || rows.length === 0) return "";
    return rows.map((row) => row && typeof row === "object" ? Object.values(row).filter(Boolean).join(" | ") : String(row || "")).filter(Boolean).join("\n");
  };
  return (
    <div className="space-y-3 p-3" data-testid="financial-disclosure-combined-booklet-view">
      <div className="sticky top-0 z-10 -mx-3 -mt-3 grid grid-cols-[minmax(0,1fr)_minmax(100px,180px)_minmax(100px,180px)] gap-2 border-b bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>Field</span>
        <span>{combined.clientA?.clientName || "Client A"}</span>
        <span>{combined.clientB?.clientName || "Client B"}</span>
      </div>
      {combined.sections.map((section) => (
        <div key={section.key} className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">{section.title}</p>
          {section.fields.map((field) => renderCombinedField(section.key, [], field))}
          {section.summaryFields.map((field) => renderCombinedField(section.key, ["summary"], field))}
          {section.subsections.map((subsection) => (
            <div key={subsection.key} className="space-y-2 pl-3">
              <p className="text-xs font-medium text-muted-foreground">{subsection.title}</p>
              {subsection.repeatable ? (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(100px,180px)_minmax(100px,180px)] gap-2 whitespace-pre-wrap text-sm">
                  <span>{subsection.title}</span>
                  <span>{repeatableSummary(combined.answerPayloads.clientA, section.key, subsection.key)}</span>
                  <span>{repeatableSummary(combined.answerPayloads.clientB, section.key, subsection.key)}</span>
                </div>
              ) : (
                (subsection.fields || subsection.columns || []).map((field) => renderCombinedField(section.key, [subsection.key], field))
              )}
              {(subsection.subsections || []).map((child) => (
                <div key={child.key} className="space-y-2 pl-3">
                  <p className="text-xs font-medium text-muted-foreground">{child.title}</p>
                  {child.fields.map((field) => renderCombinedField(section.key, [subsection.key, child.key], field))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type DraftFinancialScheduleResponse = {
  schedule: {
    id: string;
    status: string;
    payload: Record<string, unknown>;
    confirmedAt?: string | null;
    confirmedBy?: string | null;
    confirmedInSessionId?: string | null;
  } | null;
  payload: DraftFinancialSchedulePayload;
  latestVersion?: {
    id: string;
    versionNumber: number;
    status: string;
    editedBy?: string | null;
    editedByName: string;
    editedAt: string;
    source: string;
    confirmedInSessionId?: string | null;
  } | null;
  versions?: Array<{
    id: string;
    versionNumber: number;
    status: string;
    editedBy?: string | null;
    editedByName: string;
    editedAt: string;
    source: string;
    confirmedInSessionId?: string | null;
  }>;
  editability?: {
    canEdit: boolean;
    canConfirm: boolean;
    reason?: string | null;
    activeSessionId?: string | null;
  };
  pdfPreview?: {
    template: {
      id: string;
      fieldNames?: string[] | null;
      fieldMetadata?: CourtFormFieldMetadata[] | null;
      fieldMapping?: Array<{ pdfField: string; source: string; required?: boolean; defaultValue?: string | null }> | null;
    } | null;
    resolvedFields: Array<{ pdfField: string; source: string; value: string; required: boolean }>;
    mappingDiagnostics?: {
      createdMappings: number;
      correctedMappings: Array<{ pdfField: string; previousSource: string; source: string }>;
      preservedMappings: number;
      removedStaleMappings: string[];
      ignoredPdfFields: string[];
      unmappedPdfFields: string[];
    } | null;
  };
  reviewContext?: {
    willSubmitWithPostSessionReview: boolean;
    activeSessionId: string | null;
    activeSessionPostSessionReviewStatus: string | null;
  };
};

type FinancialDisclosureBookletPdfState = {
  template: {
    id: string;
    fieldNames?: string[] | null;
    fieldMetadata?: CourtFormFieldMetadata[] | null;
    fieldMapping?: Array<{ pdfField: string; source: string; required?: boolean; defaultValue?: string | null }> | null;
  } | null;
  resolvedFields: Array<{ pdfField: string; source: string; value: string; required: boolean }>;
  mappingDiagnostics?: {
    createdMappings: number;
    preservedMappings: number;
    removedStaleMappings: string[];
    unmappedPdfFields: string[];
  } | null;
  canEdit: boolean;
};

function setDraftScheduleValue(source: DraftFinancialSchedulePayload, path: string[], value: string): DraftFinancialSchedulePayload {
  return normalizeDraftFinancialSchedulePayload(setDraftScheduleNestedValue(source, path, value));
}

function setDraftSchedulePath(source: DraftFinancialSchedulePayload, path: string[], value: unknown): DraftFinancialSchedulePayload {
  return normalizeDraftFinancialSchedulePayload(setDraftScheduleNestedValue(source, path, value));
}

function getDraftScheduleNestedValue(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function setDraftScheduleNestedValue(source: unknown, path: string[], value: unknown): unknown {
  const [head, ...tail] = path;
  if (!head) return source;

  const isArrayIndex = Number.isInteger(Number(head)) && Number(head) >= 0 && String(Number(head)) === head;
  if (Array.isArray(source) || isArrayIndex) {
    const current = source;
    const output = Array.isArray(current) ? current.slice() : [];
    const index = Number(head);
    output[index] = tail.length ? setDraftScheduleNestedValue(output[index], tail, value) : value;
    return output;
  }

  const current = source && typeof source === "object" ? source as Record<string, unknown> : {};
  return {
    ...current,
    [head]: tail.length ? setDraftScheduleNestedValue(current[head], tail, value) : value,
  };
}

function emptyDraftScheduleRepeatableRow(): DraftScheduleRepeatableRow {
  return { description: "", joint: "", clientA: "", clientB: "", notes: "" };
}

function fileNameFromContentDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function DraftFinancialScheduleDialog({ caseId, open, onOpenChange }: { caseId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<DraftFinancialSchedulePayload>(buildDefaultDraftFinancialSchedulePayload());
  const [exportingSchedule, setExportingSchedule] = useState(false);
  const [bothPartiesPresent, setBothPartiesPresent] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStale, setPreviewStale] = useState(false);

  const scheduleQuery = useQuery<DraftFinancialScheduleResponse>({
    queryKey: ["/api/cases", caseId, "draft-financial-schedule"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/draft-financial-schedule`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load draft financial schedule");
      return res.json();
    },
    enabled: open && !!caseId,
  });

  useEffect(() => {
    if (scheduleQuery.data?.payload) setDraft(normalizeDraftFinancialSchedulePayload(scheduleQuery.data.payload));
  }, [scheduleQuery.data]);

  useEffect(() => {
    if (!open) setBothPartiesPresent(false);
  }, [open]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const editability = scheduleQuery.data?.editability;
  const canEdit = editability?.canEdit === true;
  const canConfirm = editability?.canConfirm === true;
  const activeSessionId = editability?.activeSessionId || null;
  const requiresPresenceAttestation = canEdit && Boolean(activeSessionId);
  const latestVersion = scheduleQuery.data?.latestVersion || null;

  const saveMutation = useMutation({
    mutationFn: async (status: "draft" | "confirmed" = "draft") => {
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/draft-financial-schedule`, {
        status,
        payload: normalizeDraftFinancialSchedulePayload(draft),
        presenceAttestation: activeSessionId ? { sessionId: activeSessionId, bothPartiesPresent } : undefined,
      });
      return res.json() as Promise<DraftFinancialScheduleResponse>;
    },
    onSuccess: (data) => {
      setDraft(normalizeDraftFinancialSchedulePayload(data.payload));
      queryClient.setQueryData(["/api/cases", caseId, "draft-financial-schedule"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "mediation-sessions"] });
      setPreviewStale(true);
      toast({
        title: data.schedule?.status === "confirmed" ? "Draft financial schedule confirmed" : "Draft financial schedule saved",
        description: data.schedule?.status === "confirmed"
          ? "This confirmed schedule will be included in admin review after the post-session summary is submitted."
          : "Saved as a draft.",
      });
    },
    onError: (err: Error) => toast({ title: "Failed to save draft schedule", description: err.message, variant: "destructive" }),
  });

  const canSaveDraftSchedule = canEdit && (!requiresPresenceAttestation || bothPartiesPresent);
  const fieldDisabled = !canEdit || saveMutation.isPending || scheduleQuery.isLoading;

  const update = (path: string[], value: string) => {
    setPreviewStale(true);
    setDraft((prev) => setDraftScheduleValue(prev, path, value));
  };
  const updatePath = (path: string[], value: unknown) => {
    setPreviewStale(true);
    setDraft((prev) => setDraftSchedulePath(prev, path, value));
  };

  const updatePdfFieldOverride = (fieldName: string, value: string | boolean) => {
    setPreviewStale(true);
    setDraft((prev) => {
      const current = (prev as unknown as Record<string, unknown>)[PDF_FIELD_OVERRIDES_KEY];
      const overrides = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
      return setDraftSchedulePath(prev, [PDF_FIELD_OVERRIDES_KEY], { ...overrides, [fieldName]: value });
    });
  };

  const updateDraftAnswer = (path: string, value: string) => {
    setPreviewStale(true);
    setDraft((prev) => setDraftScheduleValue(prev, path.split("."), value));
  };

  const loadPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/draft-financial-schedule/preview.pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: normalizeDraftFinancialSchedulePayload(draft) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to preview draft financial schedule" }));
        throw new Error(body.message || "Failed to preview draft financial schedule");
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setPreviewStale(false);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to preview draft financial schedule");
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderAssetMoneyRow = (label: string, path: string[], row: DraftScheduleAssetMoneyRow) => (
    <div key={path.join(".")} className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(140px,1fr)_repeat(3,minmax(0,1fr))]">
      <Label className="text-sm font-medium md:pt-2">{label}</Label>
      {(["clientA", "clientB", "notes"] as const).map((key) => (
        <div key={key} className="space-y-1">
          <Label className="text-xs">{key === "clientA" ? "Client A" : key === "clientB" ? "Client B" : "Notes"}</Label>
          <Input value={row[key]} onChange={(e) => update([...path, key], e.target.value)} disabled={fieldDisabled} />
        </div>
      ))}
    </div>
  );

  const renderClientRow = (label: string, path: string[], row: DraftScheduleClientRow) => (
    <div key={path.join(".")} className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(140px,1fr)_repeat(3,minmax(0,1fr))]">
      <Label className="text-sm font-medium md:pt-2">{label}</Label>
      {(["clientA", "clientB", "notes"] as const).map((key) => (
        <div key={key} className="space-y-1">
          <Label className="text-xs">{key === "clientA" ? "Client A" : key === "clientB" ? "Client B" : "Notes"}</Label>
          <Input value={row[key]} onChange={(e) => update([...path, key], e.target.value)} disabled={fieldDisabled} />
        </div>
      ))}
    </div>
  );

  const renderRepeatableRows = (label: string, path: string[], rows: DraftScheduleRepeatableRow[] | DraftScheduleAssetRepeatableRow[], includeJoint = true) => {
    const pathKey = path.join("-");
    const safeRows = Array.isArray(rows) ? rows : [];
    const updateRow = (index: number, key: keyof DraftScheduleRepeatableRow | keyof DraftScheduleAssetRepeatableRow, value: string) => update([...path, String(index), key], value);
    const valueFields: Array<keyof DraftScheduleRepeatableRow | keyof DraftScheduleAssetRepeatableRow> = includeJoint
      ? ["joint", "clientA", "clientB"]
      : ["clientA", "clientB"];
    return (
      <div key={path.join(".")} className="space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`button-add-draft-schedule-row-${pathKey}`}
            disabled={fieldDisabled}
            onClick={() => updatePath(path, [...safeRows, emptyDraftScheduleRepeatableRow()])}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add row
          </Button>
        </div>
        {safeRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows added.</p>
        ) : (
          <div className="space-y-2">
            {safeRows.map((row, index) => (
              <div key={`${pathKey}-${index}`} className={`grid gap-2 rounded-md border bg-muted/20 p-2 ${includeJoint ? "md:grid-cols-[minmax(150px,1.3fr)_repeat(3,minmax(0,1fr))_minmax(150px,1.3fr)_auto]" : "md:grid-cols-[minmax(150px,1.3fr)_repeat(2,minmax(0,1fr))_minmax(150px,1.3fr)_auto]"}`}>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={row.description}
                    data-testid={`input-draft-schedule-row-description-${pathKey}-${index}`}
                    disabled={fieldDisabled}
                    onChange={(e) => updateRow(index, "description", e.target.value)}
                  />
                </div>
                {valueFields.map((key) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{key === "clientA" ? "Client A" : key === "clientB" ? "Client B" : "Joint"}</Label>
                    <Input value={String((row as Record<string, unknown>)[key] ?? "")} onChange={(e) => updateRow(index, key, e.target.value)} disabled={fieldDisabled} />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-xs">Notes</Label>
                  <Input value={row.notes} onChange={(e) => updateRow(index, "notes", e.target.value)} disabled={fieldDisabled} />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${label} row ${index + 1}`}
                    data-testid={`button-remove-draft-schedule-row-${pathKey}-${index}`}
                    disabled={fieldDisabled}
                    onClick={() => updatePath(path, safeRows.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const exportSchedule = async () => {
    setExportingSchedule(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/draft-financial-schedule/export.pdf`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to export draft financial schedule" }));
        throw new Error(body.message || "Failed to export draft financial schedule");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFromContentDisposition(res.headers.get("Content-Disposition"), "Draft_Financial_Schedule.pdf");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export draft financial schedule";
      toast({ title: "Draft financial schedule PDF unavailable", description: message, variant: "destructive" });
    } finally {
      setExportingSchedule(false);
    }
  };

  const pdfTemplate = scheduleQuery.data?.pdfPreview?.template || null;
  const pdfMapping = Array.isArray(pdfTemplate?.fieldMapping) ? pdfTemplate.fieldMapping : [];
  const pdfFieldNames = Array.isArray(pdfTemplate?.fieldNames) ? pdfTemplate.fieldNames.map(String) : [];
  const pdfFieldMetadata = Array.isArray(pdfTemplate?.fieldMetadata) ? pdfTemplate.fieldMetadata : [];
  const mappingDiagnostics = scheduleQuery.data?.pdfPreview?.mappingDiagnostics || null;
  const pdfResolvedFields = (scheduleQuery.data?.pdfPreview?.resolvedFields || []).map((field) => ({
    ...field,
    value: String(getDraftScheduleNestedValue(draft, field.source.replace(/^draftFinancialSchedule\./, "")) ?? field.value ?? ""),
    required: Boolean(field.required),
  }));

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto" data-testid="draft-financial-schedule-dialog">
        <DialogHeader>
          <DialogTitle>Draft Financial Schedule</DialogTitle>
          <DialogDescription>{draft.privilegeNotice}</DialogDescription>
        </DialogHeader>

        {scheduleQuery.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <div className="space-y-4">
            {latestVersion && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="draft-financial-schedule-latest-version">
                <p className="font-medium">Version {latestVersion.versionNumber}</p>
                <p className="text-muted-foreground">
                  Last edited {new Date(latestVersion.editedAt).toLocaleString()} by {latestVersion.editedByName} · {latestVersion.status}
                </p>
              </div>
            )}
            {!canEdit && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Draft financial schedule is read-only</p>
                <p>{editability?.reason || "It can only be amended by admins or by the lead mediator during a live mediation session."}</p>
              </div>
            )}
            {scheduleQuery.data?.schedule?.status === "confirmed" && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-medium">Confirmed</p>
                <p>
                  {scheduleQuery.data.schedule.confirmedAt
                    ? `Confirmed ${new Date(scheduleQuery.data.schedule.confirmedAt).toLocaleString()}`
                    : "This draft financial schedule has been confirmed."}
                </p>
                {scheduleQuery.data.reviewContext?.willSubmitWithPostSessionReview && (
                  <p className="mt-1 text-xs">Complete and save the post-session summary to submit this confirmed schedule for admin review.</p>
                )}
              </div>
            )}
            {mappingDiagnostics && (mappingDiagnostics.createdMappings > 0 || mappingDiagnostics.correctedMappings.length > 0 || mappingDiagnostics.removedStaleMappings.length > 0 || mappingDiagnostics.unmappedPdfFields.length > 0) && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" data-testid="draft-financial-schedule-mapping-status">
                <p className="font-medium">PDF mapping checked</p>
                <p>
                  {mappingDiagnostics.createdMappings > 0 && `${mappingDiagnostics.createdMappings} fields were auto-mapped. `}
                  {mappingDiagnostics.correctedMappings.length > 0 && `${mappingDiagnostics.correctedMappings.length} incorrect mappings were corrected. `}
                  {mappingDiagnostics.removedStaleMappings.length > 0 && `${mappingDiagnostics.removedStaleMappings.length} stale mappings were removed. `}
                  {mappingDiagnostics.ignoredPdfFields.length > 0 && `${mappingDiagnostics.ignoredPdfFields.length} Joint asset fields remain editable in PDF preview only. `}
                  {mappingDiagnostics.unmappedPdfFields.length > 0 && `${mappingDiagnostics.unmappedPdfFields.length} PDF fields still need manual mapping.`}
                </p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Ref</Label>
                <Input value={draft.header.ref} onChange={(e) => update(["header", "ref"], e.target.value)} disabled={fieldDisabled} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Client names</Label>
                <Input value={draft.header.clientNames} onChange={(e) => update(["header", "clientNames"], e.target.value)} disabled={fieldDisabled} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={draft.header.date} onChange={(e) => update(["header", "date"], e.target.value)} disabled={fieldDisabled} />
              </div>
            </div>

            <Tabs defaultValue="assets">
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="assets" data-testid="tab-draft-financial-schedule-assets">Assets</TabsTrigger>
                <TabsTrigger value="pensions" data-testid="tab-draft-financial-schedule-pensions">Pensions</TabsTrigger>
                <TabsTrigger value="liabilities" data-testid="tab-draft-financial-schedule-liabilities">Liabilities</TabsTrigger>
                <TabsTrigger value="income" data-testid="tab-draft-financial-schedule-income">Income</TabsTrigger>
                <TabsTrigger value="expenditure" data-testid="tab-draft-financial-schedule-expenditure">Expenditure</TabsTrigger>
              </TabsList>

              <TabsContent value="assets" className="space-y-3">
                {renderAssetMoneyRow("Property value", ["realisableAssets", "property", "value"], draft.realisableAssets.property.value)}
                {renderAssetMoneyRow("Less Mortgage", ["realisableAssets", "property", "lessMortgage"], draft.realisableAssets.property.lessMortgage)}
                {renderAssetMoneyRow("Less penalties", ["realisableAssets", "property", "lessPenalties"], draft.realisableAssets.property.lessPenalties)}
                {renderAssetMoneyRow("Selling fees estimate", ["realisableAssets", "property", "sellingFeesEstimate"], draft.realisableAssets.property.sellingFeesEstimate)}
                {renderAssetMoneyRow("Solicitor fees estimate", ["realisableAssets", "property", "solicitorFeesEstimate"], draft.realisableAssets.property.solicitorFeesEstimate)}
                {renderAssetMoneyRow("Equity", ["realisableAssets", "property", "equity"], draft.realisableAssets.property.equity)}
                {renderRepeatableRows("Current Accounts", ["realisableAssets", "currentAccounts"], draft.realisableAssets.currentAccounts, false)}
                {renderRepeatableRows("Savings Accounts", ["realisableAssets", "savingsAccounts"], draft.realisableAssets.savingsAccounts, false)}
                {renderRepeatableRows("Insurance Policies/ Other Investments", ["realisableAssets", "insurancePoliciesOtherInvestments"], draft.realisableAssets.insurancePoliciesOtherInvestments, false)}
                {renderRepeatableRows("Vehicles", ["realisableAssets", "vehicles"], draft.realisableAssets.vehicles, false)}
                {renderRepeatableRows("Personal Belongings", ["realisableAssets", "personalBelongings"], draft.realisableAssets.personalBelongings, false)}
              </TabsContent>

              <TabsContent value="pensions" className="space-y-3">
                <div className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
                  {(["clientA", "clientB"] as const).map((side) => (
                    <div key={side} className="space-y-3">
                      <p className="text-sm font-medium">{side === "clientA" ? "Client A" : "Client B"}</p>
                      {(["weeklyEstimate", "monthly", "annual", "startDate", "pensionPerWeek"] as const).map((key) => (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">{key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}</Label>
                          <Input value={draft.unrealisableAssets.pensions[side][key]} onChange={(e) => update(["unrealisableAssets", "pensions", side, key], e.target.value)} disabled={fieldDisabled} />
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={draft.unrealisableAssets.pensions.notes} onChange={(e) => update(["unrealisableAssets", "pensions", "notes"], e.target.value)} disabled={fieldDisabled} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="liabilities" className="space-y-3">
                {renderRepeatableRows("Credit Cards", ["liabilities", "creditCards"], draft.liabilities.creditCards)}
                {renderRepeatableRows("Loans", ["liabilities", "loans"], draft.liabilities.loans)}
                {renderRepeatableRows("Debt Management", ["liabilities", "debtManagement"], draft.liabilities.debtManagement)}
              </TabsContent>

              <TabsContent value="income" className="space-y-3">
                {renderClientRow("Salary gross", ["monthlyIncome", "salaryGross"], draft.monthlyIncome.salaryGross)}
                {renderClientRow("Salary net", ["monthlyIncome", "salaryNet"], draft.monthlyIncome.salaryNet)}
                {renderClientRow("TOTAL GROSS (p/a)", ["monthlyIncome", "totalGrossPerAnnum"], draft.monthlyIncome.totalGrossPerAnnum)}
                {renderClientRow("TOTAL NET (p/a)", ["monthlyIncome", "totalNetPerAnnum"], draft.monthlyIncome.totalNetPerAnnum)}
                {renderClientRow("Self Assessment Tax Return", ["monthlyIncome", "selfAssessmentTaxReturn"], draft.monthlyIncome.selfAssessmentTaxReturn)}
              </TabsContent>

              <TabsContent value="expenditure" className="space-y-3">
                {renderClientRow("Accommodation", ["monthlyExpenditure", "accommodation"], draft.monthlyExpenditure.accommodation)}
                {renderClientRow("Financial commitments", ["monthlyExpenditure", "financialCommitments"], draft.monthlyExpenditure.financialCommitments)}
                {renderClientRow("Utilities", ["monthlyExpenditure", "utilities"], draft.monthlyExpenditure.utilities)}
                {renderClientRow("Transport", ["monthlyExpenditure", "transport"], draft.monthlyExpenditure.transport)}
                {renderClientRow("Household expenses", ["monthlyExpenditure", "householdExpenses"], draft.monthlyExpenditure.householdExpenses)}
                {renderClientRow("Personal expenses", ["monthlyExpenditure", "personalExpenses"], draft.monthlyExpenditure.personalExpenses)}
                {renderClientRow("Recreational expenses", ["monthlyExpenditure", "recreationalExpenses"], draft.monthlyExpenditure.recreationalExpenses)}
                {renderClientRow("Children's expenses", ["monthlyExpenditure", "childrensExpenses"], draft.monthlyExpenditure.childrensExpenses)}
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={loadPreview} disabled={previewLoading || !pdfTemplate} data-testid="button-preview-draft-financial-schedule">
              {previewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
              {previewLoading ? "Previewing..." : "Preview PDF"}
            </Button>
            <Button type="button" variant="outline" onClick={exportSchedule} disabled={exportingSchedule} data-testid="button-export-draft-financial-schedule">
              {exportingSchedule ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
              {exportingSchedule ? "Exporting..." : "Export PDF"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {requiresPresenceAttestation && (
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={bothPartiesPresent} onCheckedChange={(checked) => setBothPartiesPresent(checked === true)} />
                Both parties are present
              </label>
            )}
            <Button type="button" onClick={() => saveMutation.mutate("draft")} disabled={!canSaveDraftSchedule || saveMutation.isPending || scheduleQuery.isLoading} data-testid="button-save-draft-financial-schedule">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
              {saveMutation.isPending ? "Saving..." : "Save schedule"}
            </Button>
            <Button type="button" onClick={() => saveMutation.mutate("confirmed")} disabled={!canSaveDraftSchedule || !canConfirm || saveMutation.isPending || scheduleQuery.isLoading} data-testid="button-confirm-draft-financial-schedule">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              Confirm schedule
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <CourtFormPdfEditorDialog
      open={previewOpen}
      onOpenChange={setPreviewOpen}
      title="Draft Financial Schedule Preview"
      previewUrl={previewUrl}
      isLoading={previewLoading}
      error={previewError}
      onRetry={loadPreview}
      mapping={pdfMapping}
      resolvedFields={pdfResolvedFields}
      draftAnswers={draft as unknown as Record<string, unknown>}
      previewStale={previewStale}
      fieldNames={pdfFieldNames}
      fieldMetadata={pdfFieldMetadata}
      onDraftAnswerChange={updateDraftAnswer}
      onPdfFieldOverrideChange={updatePdfFieldOverride}
      onSaveDraft={() => saveMutation.mutate("draft")}
      canSaveDraft={canSaveDraftSchedule}
      isSavingDraft={saveMutation.isPending}
    />
    </>
  );
}

function FinancialDisclosureBookletPdfDialog({
  caseId,
  partyId,
  partyName,
  open,
  onOpenChange,
}: {
  caseId: string;
  partyId: string;
  partyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStale, setPreviewStale] = useState(false);

  const previewStateQuery = useQuery<FinancialDisclosureBookletPdfState>({
    queryKey: ["/api/cases", caseId, "financial-disclosure-booklet", partyId, "pdf-preview-state"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/financial-disclosure-booklet/${partyId}/pdf-preview-state`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load financial disclosure booklet PDF state");
      return res.json();
    },
    enabled: open && !!caseId && !!partyId,
  });

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/financial-disclosure-booklet/${partyId}/preview.pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to preview financial disclosure booklet PDF" }));
        throw new Error(body.message || "Failed to preview financial disclosure booklet PDF");
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setPreviewStale(false);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to preview financial disclosure booklet PDF");
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (open && !previewUrl && !previewLoading) void loadPreview();
    if (!open) setPreviewStale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partyId]);

  const updatePdfFieldMutation = useMutation({
    mutationFn: async ({ source, value }: { source: string; value: string }) => {
      const res = await apiRequest("PATCH", `/api/cases/${caseId}/financial-disclosure-booklet/${partyId}/pdf-field`, { source, value });
      return res.json();
    },
    onSuccess: async () => {
      setPreviewStale(true);
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-booklet", partyId, "pdf-preview-state"] });
    },
    onError: (err: Error) => toast({ title: "Failed to update booklet PDF field", description: err.message, variant: "destructive" }),
  });

  const pdfTemplate = previewStateQuery.data?.template || null;
  const pdfMapping = Array.isArray(pdfTemplate?.fieldMapping) ? pdfTemplate.fieldMapping : [];
  const pdfFieldNames = Array.isArray(pdfTemplate?.fieldNames) ? pdfTemplate.fieldNames.map(String) : [];
  const pdfFieldMetadata = Array.isArray(pdfTemplate?.fieldMetadata) ? pdfTemplate.fieldMetadata : [];
  const pdfResolvedFields = previewStateQuery.data?.resolvedFields || [];
  const mappingDiagnostics = previewStateQuery.data?.mappingDiagnostics || null;
  const hasMappingDiagnostics = Boolean(
    mappingDiagnostics
    && (mappingDiagnostics.createdMappings > 0
      || mappingDiagnostics.removedStaleMappings.length > 0
      || mappingDiagnostics.unmappedPdfFields.length > 0),
  );
  const mappingByField = new Map(pdfMapping.map((entry) => [entry.pdfField, entry]));
  const canEdit = previewStateQuery.data?.canEdit === true;

  const updateMappedPdfField = (fieldName: string, value: string | boolean) => {
    const mapping = mappingByField.get(fieldName);
    if (!mapping?.source?.startsWith("financialDisclosureBooklet.")) {
      toast({ title: "PDF field is not mapped", description: "Map this field to a Financial Disclosure Booklet source before editing it.", variant: "destructive" });
      return;
    }
    updatePdfFieldMutation.mutate({ source: mapping.source, value: typeof value === "boolean" ? String(value) : value });
  };

  return (
    <CourtFormPdfEditorDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Financial Disclosure Booklet Preview - ${partyName}`}
      previewUrl={previewUrl}
      isLoading={previewLoading || previewStateQuery.isLoading}
      error={previewError || (previewStateQuery.error instanceof Error ? previewStateQuery.error.message : null)}
      onRetry={loadPreview}
      mapping={pdfMapping}
      resolvedFields={pdfResolvedFields}
      draftAnswers={{}}
      previewStale={previewStale}
      diagnosticNotice={hasMappingDiagnostics ? (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          data-testid="financial-disclosure-booklet-mapping-status"
        >
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {mappingDiagnostics?.createdMappings ? `${mappingDiagnostics.createdMappings} fields were auto-mapped. ` : ""}
              {mappingDiagnostics?.removedStaleMappings.length ? `${mappingDiagnostics.removedStaleMappings.length} stale mappings were removed. ` : ""}
              {mappingDiagnostics?.unmappedPdfFields.length ? `${mappingDiagnostics.unmappedPdfFields.length} PDF fields still need manual mapping.` : ""}
            </p>
          </div>
        </div>
      ) : null}
      fieldNames={pdfFieldNames}
      fieldMetadata={pdfFieldMetadata}
      onDraftAnswerChange={() => undefined}
      onPdfFieldOverrideChange={updateMappedPdfField}
      onSaveDraft={loadPreview}
      canSaveDraft={canEdit}
      isSavingDraft={updatePdfFieldMutation.isPending}
    />
  );
}

function FinancialDisclosureSectionUpload({
  caseId,
  folderId,
  uploadTarget,
  itemId,
  evidenceCategoryId,
  disabled = false,
  fileTestId,
  buttonTestId,
}: {
  caseId: string;
  folderId: string;
  uploadTarget: FinancialDisclosureUploadTargetView;
  itemId?: string | null;
  evidenceCategoryId?: string | null;
  disabled?: boolean;
  fileTestId: string;
  buttonTestId: string;
}) {
  const { toast } = useToast();
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [fileDraft, setFileDraft] = useState<{ fileName: string; fileData: string; fileMimeType: string; fileSizeBytes: number } | null>(null);
  const [isPreparingFile, setIsPreparingFile] = useState(false);
  const [preparingFileName, setPreparingFileName] = useState("");

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!fileDraft) throw new Error("Select a document");
      if (fileDraft.fileSizeBytes > MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES) throw new Error("Financial disclosure uploads must be 25MB or smaller");
      if ((uploadTarget === "online_disclosure_booklet" || uploadTarget === "financial_disclosure_checklist") && !itemId) {
        throw new Error("Financial disclosure item is not available");
      }
      if (uploadTarget === "evidence_category" && !evidenceCategoryId) {
        throw new Error("Select an evidence category");
      }
      const res = await apiRequest("POST", `/api/cases/${caseId}/documents`, {
        title: documentTitle.trim() || fileDraft.fileName,
        fileName: fileDraft.fileName,
        fileData: fileDraft.fileData,
        mimeType: fileDraft.fileMimeType,
        documentDate: documentDate || null,
        fileSizeBytes: fileDraft.fileSizeBytes,
        financialDisclosureFolderId: folderId,
        financialDisclosureItemId: uploadTarget === "online_disclosure_booklet" || uploadTarget === "financial_disclosure_checklist" ? itemId : null,
        financialDisclosureEvidenceCategoryId: uploadTarget === "evidence_category" ? evidenceCategoryId : null,
        financialDisclosureUploadTarget: uploadTarget,
        readyForReview: true,
      });
      return res.json();
    },
    onSuccess: () => {
      setDocumentTitle("");
      setDocumentDate("");
      setFileDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/client"] });
      toast({ title: "Disclosure document uploaded" });
    },
    onError: (err: Error) => toast({ title: "Failed to upload disclosure document", description: err.message, variant: "destructive" }),
  });
  const uploadBusy = isPreparingFile || uploadMutation.isPending;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <p className="text-sm font-medium">Document</p>
      <div className="space-y-1.5">
        <Label className="text-xs">Title</Label>
        <Input className="min-w-0" value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} placeholder="Document title" disabled={uploadBusy} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Document date</Label>
        <Input
          type="date"
          className="min-w-0"
          value={documentDate}
          onChange={(e) => setDocumentDate(e.target.value)}
          disabled={uploadBusy}
          data-testid="input-financial-disclosure-document-date"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">File</Label>
          <Input
            type="file"
            accept={ACCEPTED_FINANCIAL_DISCLOSURE_FILE_TYPES}
            className="min-w-0"
            data-testid={fileTestId}
            disabled={uploadBusy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPreparingFileName(file.name);
              const extension = file.name.toLowerCase().split(".").pop() || "";
              const allowedExtensions = ACCEPTED_FINANCIAL_DISCLOSURE_FILE_TYPES.split(",").map((entry) => entry.replace(".", ""));
              if (!allowedExtensions.includes(extension)) {
                toast({ title: "Unsupported file type", description: "Use PDF, image, Word, Excel, or CSV files.", variant: "destructive" });
                e.currentTarget.value = "";
                setFileDraft(null);
                setPreparingFileName("");
                return;
              }
              if (file.size > MAX_FINANCIAL_DISCLOSURE_UPLOAD_BYTES) {
                toast({ title: "File too large", description: "Financial disclosure uploads must be 25MB or smaller.", variant: "destructive" });
                e.currentTarget.value = "";
                setFileDraft(null);
                setPreparingFileName("");
                return;
              }
              setFileDraft(null);
              setIsPreparingFile(true);
              try {
                setFileDraft(await fileToDataUrl(file));
              } finally {
                setIsPreparingFile(false);
                setPreparingFileName("");
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full shrink-0 sm:w-28"
          disabled={disabled || uploadBusy || !fileDraft}
          onClick={() => uploadMutation.mutate()}
          data-testid={buttonTestId}
        >
          {uploadBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
          {isPreparingFile ? "Preparing..." : uploadMutation.isPending ? "Uploading..." : "Upload"}
        </Button>
      </div>
      {isPreparingFile && preparingFileName ? (
        <p className="text-xs text-muted-foreground" data-testid="text-financial-disclosure-upload-status">Preparing {preparingFileName}...</p>
      ) : uploadMutation.isPending && fileDraft ? (
        <p className="text-xs text-muted-foreground" data-testid="text-financial-disclosure-upload-status">Uploading {fileDraft.fileName}...</p>
      ) : fileDraft ? (
        <p className="text-xs text-muted-foreground">Selected: {fileDraft.fileName}</p>
      ) : null}
    </div>
  );
}

function CaseProofingPanel({ caseId, canView, isAdmin }: { caseId: string; canView: boolean; isAdmin: boolean }) {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [ageingFilter, setAgeingFilter] = useState("all");
  const [selectedProofingItemId, setSelectedProofingItemId] = useState<string | null>(null);
  const [approveDialogItem, setApproveDialogItem] = useState<CaseProofingItemView | null>(null);
  const [returnDialogItem, setReturnDialogItem] = useState<CaseProofingItemView | null>(null);
  const [withdrawDialogItem, setWithdrawDialogItem] = useState<CaseProofingItemView | null>(null);
  const [returnComments, setReturnComments] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [draftPreviewUrl, setDraftPreviewUrl] = useState<string | null>(null);
  const [draftPreviewLoading, setDraftPreviewLoading] = useState(false);
  const [draftPreviewError, setDraftPreviewError] = useState<string | null>(null);

  const proofingQuery = useQuery<CaseProofingItemView[]>({
    queryKey: ["/api/cases", caseId, "proofing-items"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/proofing-items`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load proofing items");
      return res.json();
    },
    enabled: !!caseId && canView,
  });

  const refreshProofing = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "proofing-items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("PATCH", `/api/case-proofing-items/${id}/approve`, {})).json(),
    onSuccess: () => {
      setApproveDialogItem(null);
      refreshProofing();
      toast({ title: "Proofing item approved" });
    },
    onError: (err: Error) => toast({ title: "Failed to approve proofing item", description: err.message, variant: "destructive" }),
  });

  const returnMutation = useMutation({
    mutationFn: async ({ id, returnComments }: { id: string; returnComments: string }) => (await apiRequest("PATCH", `/api/case-proofing-items/${id}/return`, { returnComments })).json(),
    onSuccess: () => {
      setReturnDialogItem(null);
      setReturnComments("");
      refreshProofing();
      toast({ title: "Proofing item returned" });
    },
    onError: (err: Error) => toast({ title: "Failed to return proofing item", description: err.message, variant: "destructive" }),
  });

  const withdrawMutation = useMutation({
    mutationFn: async ({ id, withdrawReason }: { id: string; withdrawReason: string }) => (await apiRequest("PATCH", `/api/case-proofing-items/${id}/withdraw`, { withdrawReason })).json(),
    onSuccess: () => {
      setWithdrawDialogItem(null);
      setWithdrawReason("");
      refreshProofing();
      toast({ title: "Proofing item withdrawn" });
    },
    onError: (err: Error) => toast({ title: "Failed to withdraw proofing item", description: err.message, variant: "destructive" }),
  });

  const typeLabel = (type: string) => type.split("_").map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`).join(" ");
  const statusMatches = (item: CaseProofingItemView) => {
    if (statusFilter === "active") return item.status === "awaiting_review" || item.status === "returned";
    return statusFilter === "all" || item.status === statusFilter;
  };
  const statusRank = (status: CaseProofingItemView["status"]) => ({
    awaiting_review: 0,
    returned: 1,
    approved: 2,
    withdrawn: 3,
  }[status]);
  const filteredItems = (proofingQuery.data || [])
    .filter((item) => (
      (typeFilter === "all" || item.itemType === typeFilter)
      && statusMatches(item)
      && (ageingFilter === "all" || item.ageingStatus === ageingFilter)
    ))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  const selectedProofingItem = filteredItems.find((item) => item.id === selectedProofingItemId) || filteredItems[0] || null;

  useEffect(() => {
    if (selectedProofingItem?.previewKind !== "draft_financial_schedule_pdf") {
      setDraftPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setDraftPreviewError(null);
      setDraftPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setDraftPreviewLoading(true);
    setDraftPreviewError(null);
    fetch(`/api/cases/${caseId}/draft-financial-schedule/preview.pdf`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ message: "Failed to preview Draft Financial Schedule" }));
          throw new Error(body.message || "Failed to preview Draft Financial Schedule");
        }
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(blob);
        setDraftPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return nextUrl;
        });
      })
      .catch((err) => {
        if (!cancelled) setDraftPreviewError(err instanceof Error ? err.message : "Failed to preview Draft Financial Schedule");
      })
      .finally(() => {
        if (!cancelled) setDraftPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, selectedProofingItem?.id, selectedProofingItem?.previewKind]);

  useEffect(() => () => {
    if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
  }, [draftPreviewUrl]);

  if (!canView) return null;

  const statusBadge = (item: CaseProofingItemView) => (
    <Badge variant={item.status === "approved" ? "default" : item.status === "returned" ? "outline" : item.status === "withdrawn" ? "secondary" : "destructive"}>
      {item.status.replaceAll("_", " ")}
    </Badge>
  );

  const ageingBadge = (item: CaseProofingItemView) => (
    <Badge variant={item.ageingStatus === "red" ? "destructive" : item.ageingStatus === "amber" ? "outline" : "secondary"} data-testid="badge-proofing-ageing">
      {item.ageingStatus}
    </Badge>
  );

  const openReturnDialog = (item: CaseProofingItemView) => {
    setReturnDialogItem(item);
    setReturnComments("");
  };
  const openWithdrawDialog = (item: CaseProofingItemView) => {
    setWithdrawDialogItem(item);
    setWithdrawReason("");
  };

  return (
    <Card data-testid="card-case-proofing">
      <CardHeader>
        <CardTitle className="text-base font-heading flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#5a7d58]" />
          Proofing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger data-testid="select-proofing-type-filter"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="session_summary">Session summaries</SelectItem>
              <SelectItem value="draft_financial_schedule">Financial Schedules</SelectItem>
              <SelectItem value="financial_disclosure_checklist">Checklists</SelectItem>
              <SelectItem value="court_form">Court forms</SelectItem>
              <SelectItem value="case_document">Other client-facing documents</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-proofing-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Awaiting review + Returned</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="awaiting_review">Awaiting review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="withdrawn">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ageingFilter} onValueChange={setAgeingFilter}>
            <SelectTrigger data-testid="select-proofing-ageing-filter"><SelectValue placeholder="Ageing" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ageing</SelectItem>
              <SelectItem value="green">0-2 working days</SelectItem>
              <SelectItem value="amber">3-4 working days</SelectItem>
              <SelectItem value="red">5+ working days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {proofingQuery.isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : filteredItems.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-muted-foreground">No proofing items match these filters.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]" data-testid="proofing-master-detail">
            <div className="space-y-2" data-testid="proofing-queue-list">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedProofingItemId(item.id)}
                  className={`w-full rounded-md border p-3 text-left transition ${selectedProofingItem?.id === item.id ? "border-[#5a7d58] bg-[#f4f8f2]" : "hover:bg-muted/40"} ${item.status === "approved" || item.status === "withdrawn" ? "opacity-75" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.displayTitle}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.displaySubtitle || typeLabel(item.itemType)}</div>
                    </div>
                    {ageingBadge(item)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{statusBadge(item)}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {item.reviewCycleLabel}
                    {item.versionLabel ? ` · ${item.versionLabel}` : ""}
                    {" · "}
                    {item.partyName || item.sessionLabel || "Case-level item"} &middot; Submitted {formatDate(item.submittedAt)}
                  </div>
                </button>
              ))}
            </div>

            <div className="rounded-md border p-4" data-testid="proofing-detail-pane">
              {selectedProofingItem ? (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-heading font-semibold">{selectedProofingItem.displayTitle}</h3>
                        {statusBadge(selectedProofingItem)}
                        {ageingBadge(selectedProofingItem)}
                        <Badge variant="outline">{selectedProofingItem.reviewCycleLabel}</Badge>
                        {selectedProofingItem.versionLabel && <Badge variant="secondary">{selectedProofingItem.versionLabel}</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedProofingItem.displaySubtitle || typeLabel(selectedProofingItem.itemType)}</p>
                    </div>
                    {isAdmin && selectedProofingItem.status !== "withdrawn" && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" data-testid="button-approve-proofing-item" disabled={approveMutation.isPending} onClick={() => setApproveDialogItem(selectedProofingItem)}>
                          {selectedProofingItem.status === "approved" ? "Verify release" : "Approve"}
                        </Button>
                        <Button size="sm" variant="outline" data-testid="button-return-proofing-item" disabled={returnMutation.isPending} onClick={() => openReturnDialog(selectedProofingItem)}>
                          Return
                        </Button>
                        <Button size="sm" variant="destructive" data-testid="button-withdraw-proofing-item" disabled={withdrawMutation.isPending} onClick={() => openWithdrawDialog(selectedProofingItem)}>
                          Withdraw
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-md bg-muted/30 p-3 text-sm">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Context</div>
                      <div className="mt-1 space-y-1">
                        <div>Type: {typeLabel(selectedProofingItem.itemType)}</div>
                        <div>Party: {selectedProofingItem.partyName || "Case-level"}</div>
                        <div>Session: {selectedProofingItem.sessionLabel || "Not session-specific"}</div>
                        <div>Review: {selectedProofingItem.reviewCycleLabel}</div>
                        {selectedProofingItem.versionLabel && <div>Version: {selectedProofingItem.versionLabel}</div>}
                        <div>Submitted by: {selectedProofingItem.submittedByName || "Unknown"}</div>
                        <div>Submitted: {formatDate(selectedProofingItem.submittedAt)}</div>
                      </div>
                    </div>
                    <div className="rounded-md bg-muted/30 p-3 text-sm">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Release effect</div>
                      <p className="mt-1">{selectedProofingItem.releaseEffect}</p>
                      {selectedProofingItem.returnComments && <p className="mt-2 text-muted-foreground">Return comments: {selectedProofingItem.returnComments}</p>}
                      {selectedProofingItem.reviewedByName && <p className="mt-2 text-muted-foreground">Reviewed by {selectedProofingItem.reviewedByName}</p>}
                    </div>
                  </div>

                  <div className="rounded-md border p-3" data-testid="proofing-review-history">
                    <div className="text-sm font-medium">Review history</div>
                    <div className="mt-3 space-y-3">
                      {(selectedProofingItem.cycles || []).map((cycle) => (
                        <div key={cycle.id} className="rounded-md bg-muted/30 p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">Review cycle {cycle.cycleNumber}</span>
                            <Badge variant={cycle.status === "approved" ? "default" : cycle.status === "returned" ? "outline" : cycle.status === "withdrawn" ? "secondary" : "destructive"}>
                              {cycle.status.replaceAll("_", " ")}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Submitted {formatDate(cycle.submittedAt)}{cycle.submittedByName ? ` by ${cycle.submittedByName}` : ""}
                            {cycle.fileName ? ` · ${cycle.fileName}` : ""}
                          </div>
                          {cycle.reviewedAt && <div className="mt-1 text-xs text-muted-foreground">Approved {formatDate(cycle.reviewedAt)}{cycle.reviewedByName ? ` by ${cycle.reviewedByName}` : ""}</div>}
                          {cycle.returnedAt && <div className="mt-1 text-xs text-muted-foreground">Returned {formatDate(cycle.returnedAt)}{cycle.returnComments ? ` · ${cycle.returnComments}` : ""}</div>}
                          {cycle.withdrawnAt && <div className="mt-1 text-xs text-muted-foreground">Withdrawn {formatDate(cycle.withdrawnAt)}{cycle.withdrawReason ? ` · ${cycle.withdrawReason}` : ""}</div>}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border bg-muted/20">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">Preview</div>
                        <div className="text-xs text-muted-foreground">
                          {selectedProofingItem.fileName || "Review metadata"}
                          {selectedProofingItem.documentDate ? ` &middot; Document date ${formatDate(selectedProofingItem.documentDate)}` : ""}
                          {selectedProofingItem.uploadDate ? ` &middot; Upload date ${formatDate(selectedProofingItem.uploadDate)}` : ""}
                        </div>
                      </div>
                      {selectedProofingItem.fileUrl && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={selectedProofingItem.fileUrl} target="_blank" rel="noreferrer">Open</a>
                        </Button>
                      )}
                    </div>
                    {selectedProofingItem.previewKind === "document" && selectedProofingItem.fileUrl ? (
                      <iframe
                        title={`${selectedProofingItem.displayTitle} preview`}
                        src={selectedProofingItem.fileUrl}
                        className="h-[62vh] w-full border-0 bg-white"
                        data-testid="iframe-proofing-document-preview"
                      />
                    ) : selectedProofingItem.previewKind === "draft_financial_schedule_pdf" ? (
                      draftPreviewLoading ? (
                        <div className="flex h-[62vh] items-center justify-center text-sm text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading preview...
                        </div>
                      ) : draftPreviewError ? (
                        <div className="flex h-[62vh] items-center justify-center p-6 text-center text-sm text-destructive">
                          {draftPreviewError}
                        </div>
                      ) : draftPreviewUrl ? (
                        <iframe
                          title="Draft Financial Schedule proofing preview"
                          src={draftPreviewUrl}
                          className="h-[62vh] w-full border-0 bg-white"
                          data-testid="iframe-proofing-draft-financial-schedule-preview"
                        />
                      ) : null
                    ) : (
                      <div className="flex min-h-48 flex-col justify-center p-6 text-sm text-muted-foreground">
                        <FileText className="mb-2 h-5 w-5" />
                        No PDF preview available.
                        <span className="mt-1">Use the context and release effect above to complete this proofing decision.</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!approveDialogItem} onOpenChange={(open) => { if (!open) setApproveDialogItem(null); }}>
        <AlertDialogContent data-testid="dialog-approve-proofing-item">
          <AlertDialogHeader>
            <AlertDialogTitle>{approveDialogItem?.status === "approved" ? "Verify client release?" : "Approve proofing item?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {approveDialogItem ? `${approveDialogItem.displayTitle}. ${approveDialogItem.releaseEffect}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!approveDialogItem || approveMutation.isPending} onClick={() => approveDialogItem && approveMutation.mutate(approveDialogItem.id)}>
              {approveDialogItem?.status === "approved" ? "Verify release" : "Approve"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!returnDialogItem} onOpenChange={(open) => { if (!open) setReturnDialogItem(null); }}>
        <DialogContent data-testid="dialog-return-proofing-item">
          <DialogHeader>
            <DialogTitle>Return proofing item</DialogTitle>
            <DialogDescription>{returnDialogItem?.displayTitle || "Add comments for the mediator."}</DialogDescription>
          </DialogHeader>
          <Textarea
            data-testid="textarea-proofing-return-comments"
            placeholder="Return comments"
            value={returnComments}
            onChange={(event) => setReturnComments(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogItem(null)}>Cancel</Button>
            <Button disabled={!returnDialogItem || returnMutation.isPending || !returnComments.trim()} onClick={() => returnDialogItem && returnMutation.mutate({ id: returnDialogItem.id, returnComments })}>
              Return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!withdrawDialogItem} onOpenChange={(open) => { if (!open) setWithdrawDialogItem(null); }}>
        <DialogContent data-testid="dialog-withdraw-proofing-item">
          <DialogHeader>
            <DialogTitle>Withdraw proofing item</DialogTitle>
            <DialogDescription>{withdrawDialogItem?.displayTitle || "Record why this item should not be released."}</DialogDescription>
          </DialogHeader>
          <Textarea
            data-testid="textarea-proofing-withdraw-reason"
            placeholder="Withdraw reason"
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawDialogItem(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!withdrawDialogItem || withdrawMutation.isPending || !withdrawReason.trim()} onClick={() => withdrawDialogItem && withdrawMutation.mutate({ id: withdrawDialogItem.id, withdrawReason })}>
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FinancialDisclosurePanel({ caseId, canUpdateStaffItems, canUploadFormE }: { caseId: string; canUpdateStaffItems: boolean; canUploadFormE: boolean }) {
  const { toast } = useToast();
  const [draftScheduleOpen, setDraftScheduleOpen] = useState(false);

  const folderQuery = useQuery<FinancialDisclosureFolderView[]>({
    queryKey: ["/api/cases", caseId, "financial-disclosure-folders"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/financial-disclosure-folders`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load financial disclosure folders");
      return res.json();
    },
    enabled: !!caseId,
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ item, patch }: { item: FinancialDisclosureItemView; patch: { status?: string; payload?: Record<string, unknown> } }) => {
      const res = await apiRequest("PATCH", `/api/financial-disclosure-items/${item.id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/client"] });
      toast({ title: "Financial disclosure updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update financial disclosure", description: err.message, variant: "destructive" }),
  });

  const updateOfsMutation = useMutation({
    mutationFn: async ({ folder, ofsRequired }: { folder: FinancialDisclosureFolderView; ofsRequired: string }) => {
      const res = await apiRequest("PATCH", `/api/financial-disclosure-folders/${folder.id}/ofs`, { ofsRequired });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      toast({ title: "OFS updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update OFS", description: err.message, variant: "destructive" }),
  });

  const updateBookletSectionMutation = useMutation({
    mutationFn: async ({ item, sectionKey, status, answers }: { item: FinancialDisclosureItemView; sectionKey: string; status: FinancialDisclosureProgressStatus; answers: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/financial-disclosure-items/${item.id}/booklet-sections/${sectionKey}`, { status, answers });
      return res.json() as Promise<FinancialDisclosureItemView>;
    },
    onSuccess: async (updatedItem) => {
      const queryKey = ["/api/cases", caseId, "financial-disclosure-folders"];
      queryClient.setQueryData<FinancialDisclosureFolderView[]>(queryKey, (current) => (current || []).map((folder) => (
        folder.id === updatedItem.folderId
          ? { ...folder, items: folder.items.map((item) => item.id === updatedItem.id ? updatedItem : item) }
          : folder
      )));
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.refetchQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/client"] });
    },
  });

  const submitBookletMutation = useMutation({
    mutationFn: async ({
      item,
      sectionKey,
      answers,
      status,
    }: {
      item: FinancialDisclosureItemView;
      sectionKey: string;
      answers: Record<string, unknown>;
      status: FinancialDisclosureProgressStatus;
    }) => {
      const updatedItem = await updateBookletSectionMutation.mutateAsync({ item, sectionKey, status, answers });
      const res = await apiRequest("POST", `/api/financial-disclosure-items/${updatedItem.id}/booklet-submit`, {});
      return res.json();
    },
    onSuccess: async () => {
      const queryKey = ["/api/cases", caseId, "financial-disclosure-folders"];
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.refetchQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/client"] });
      toast({ title: "Disclosure booklet submitted" });
    },
    onError: (err: Error) => toast({ title: "Failed to submit booklet", description: err.message, variant: "destructive" }),
  });

  const updateChecklistRowMutation = useMutation({
    mutationFn: async ({ item, rowKey, status, documentDate, notes }: { item: FinancialDisclosureItemView; rowKey: string; status: FinancialDisclosureProgressStatus; documentDate?: string | null; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/financial-disclosure-items/${item.id}/checklist-rows/${rowKey}`, { status, documentDate: documentDate || null, notes: notes || "" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "financial-disclosure-folders"] });
      toast({ title: "Checklist updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to update checklist", description: err.message, variant: "destructive" }),
  });

  if (folderQuery.isLoading) return <Skeleton className="h-40 w-full" />;

  const folders = folderQuery.data || [];

  if (folders.length === 0) {
    return (
      <Card data-testid="card-financial-disclosure-empty">
        <CardContent className="py-8 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No Financial Disclosure and Support Folder is required for this case type.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="panel-financial-disclosure">
      {canUpdateStaffItems && (
        <Card>
          <CardContent className="pt-2">
            <Accordion type="single" collapsible className="w-full" data-testid="accordion-financial-disclosure-combined-booklet">
              <AccordionItem value="combined-booklet">
                <AccordionTrigger data-testid="trigger-financial-disclosure-combined-booklet">
                  <div className="text-left">
                    <p className="text-sm font-medium">Combined booklet</p>
                    <p className="text-xs text-muted-foreground">Staff view of Client A and Client B entries in booklet order.</p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setDraftScheduleOpen(true)}
                        data-testid="button-draft-financial-schedule"
                      >
                        <FileText className="w-3.5 h-3.5 mr-1" />
                        Draft Financial Schedule
                      </Button>
                    </div>
                    <DraftFinancialScheduleDialog caseId={caseId} open={draftScheduleOpen} onOpenChange={setDraftScheduleOpen} />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Scroll inside the panel to review all booklet sections.</p>
                      <ScrollArea
                        className="h-[50vh] max-h-[680px] rounded-md border bg-background sm:h-[60vh]"
                        data-testid="financial-disclosure-combined-booklet-scroll"
                      >
                        <FinancialDisclosureCombinedBookletView folders={folders} />
                      </ScrollArea>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}
      {folders.map((folder) => (
        <FinancialDisclosurePartyFolderPanel
          key={folder.id}
          caseId={caseId}
          folder={folder}
          canUpdateStaffItems={canUpdateStaffItems}
          canUploadFormE={canUploadFormE}
          updateItem={(item, patch) => updateItemMutation.mutate({ item, patch })}
          updateItemPending={updateItemMutation.isPending}
          updateOfs={(ofsRequired) => updateOfsMutation.mutate({ folder, ofsRequired })}
          updateBookletSection={(item, sectionKey, status, answers) => updateBookletSectionMutation.mutateAsync({ item, sectionKey, status, answers })}
          submitBooklet={async (item, sectionKey, answers, status) => {
            await submitBookletMutation.mutateAsync({ item, sectionKey, answers, status });
          }}
          submitBookletPending={submitBookletMutation.isPending}
          updateChecklistRow={(item, rowKey, status, documentDate, notes) => updateChecklistRowMutation.mutate({ item, rowKey, status, documentDate, notes })}
        />
      ))}
    </div>
  );
}

function FinancialDisclosurePartyFolderPanel({
  caseId,
  folder,
  canUpdateStaffItems,
  canUploadFormE,
  updateItem,
  updateItemPending,
  updateOfs,
  updateBookletSection,
  submitBooklet,
  submitBookletPending,
  updateChecklistRow,
}: {
  caseId: string;
  folder: FinancialDisclosureFolderView;
  canUpdateStaffItems: boolean;
  canUploadFormE: boolean;
  updateItem: (item: FinancialDisclosureItemView, patch: { status?: string; payload?: Record<string, unknown> }) => void;
  updateItemPending: boolean;
  updateOfs: (ofsRequired: string) => void;
  updateBookletSection: (item: FinancialDisclosureItemView, sectionKey: string, status: FinancialDisclosureProgressStatus, answers: Record<string, unknown>) => Promise<FinancialDisclosureItemView>;
  submitBooklet: (item: FinancialDisclosureItemView, sectionKey: string, answers: Record<string, unknown>, status: FinancialDisclosureProgressStatus) => Promise<void>;
  submitBookletPending: boolean;
  updateChecklistRow: (item: FinancialDisclosureItemView, rowKey: string, status: FinancialDisclosureProgressStatus, documentDate?: string | null, notes?: string) => void;
}) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [bookletPdfOpen, setBookletPdfOpen] = useState(false);
  const [exportingBookletPdf, setExportingBookletPdf] = useState(false);

  const booklet = folder.items.find((item) => item.itemType === "online_disclosure_booklet") || null;
  const checklist = folder.items.find((item) => item.itemType === "financial_disclosure_checklist") || null;
  const categories = folder.evidenceCategories || [];
  const partyName = [folder.party.firstName, folder.party.lastName].filter(Boolean).join(" ") || "Client";
  const completedItems = folder.items.filter((item) => item.status === "completed").length;
  const totalItems = folder.items.length;
  const sectionDocuments = (target: FinancialDisclosureUploadTargetView) => folder.documents.filter((document) => document.financialDisclosureUploadTarget === target);
  const checklistRows = normalizedChecklistRows(checklist?.payload || {});
  const partyId = folder.partyId;

  const exportBookletPdf = async () => {
    setExportingBookletPdf(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/financial-disclosure-booklet/${partyId}/export.pdf`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Failed to export financial disclosure booklet PDF" }));
        throw new Error(body.message || "Failed to export financial disclosure booklet PDF");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFromContentDisposition(res.headers.get("Content-Disposition"), "Financial_Disclosure_Booklet.pdf");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Financial disclosure booklet PDF unavailable",
        description: err instanceof Error ? err.message : "Failed to export financial disclosure booklet PDF",
        variant: "destructive",
      });
    } finally {
      setExportingBookletPdf(false);
    }
  };

  return (
    <Card data-testid={`card-financial-disclosure-folder-${folder.partyId}`}>
      <CardHeader className="p-4 sm:p-5">
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between gap-3 whitespace-normal p-0 text-left hover:bg-transparent"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} financial disclosure folder for Client ${folder.party.role || ""}: ${partyName}`}
          data-testid={`button-toggle-financial-disclosure-folder-${folder.partyId}`}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-[#5a7d58]" />
              <CardTitle className="min-w-0 break-words text-base font-heading">
                Financial Disclosure - Client {folder.party.role || ""}: {partyName}
              </CardTitle>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant={folder.status === "completed" ? "default" : folder.status === "archived" ? "secondary" : "outline"}>
                {folder.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-xs font-normal text-muted-foreground">
                {completedItems}/{totalItems} items complete
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {folder.documents.length} document{folder.documents.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
        </Button>
      </CardHeader>
      {isExpanded && (
        <CardContent className="space-y-4">
          <FinancialDisclosureSourceDetails sourceSummary={folder.sourceSummary} />
          {booklet && (
            <div className="space-y-2" data-testid="card-financial-disclosure-booklet">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium">{booklet.title}</p>
                  <p className="text-xs text-muted-foreground">{booklet.description}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Badge variant={booklet.status === "completed" ? "default" : "outline"}>{booklet.status.replace(/_/g, " ")}</Badge>
                  {canUpdateStaffItems && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setBookletPdfOpen(true)}
                        data-testid={`button-preview-financial-disclosure-booklet-pdf-${folder.partyId}`}
                      >
                        <FileText className="w-3.5 h-3.5 mr-1" />
                        Preview PDF
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void exportBookletPdf()}
                        disabled={exportingBookletPdf}
                        data-testid={`button-export-financial-disclosure-booklet-pdf-${folder.partyId}`}
                      >
                        {exportingBookletPdf ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
                        {exportingBookletPdf ? "Exporting..." : "Export PDF"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {canUpdateStaffItems && (
                <FinancialDisclosureBookletPdfDialog
                  caseId={caseId}
                  partyId={folder.partyId}
                  partyName={partyName}
                  open={bookletPdfOpen}
                  onOpenChange={setBookletPdfOpen}
                />
              )}
              <FinancialDisclosureBookletWizard
                item={booklet}
                updateBookletSection={updateBookletSection}
                submitBooklet={submitBooklet}
                submitBookletPending={submitBookletPending}
              />
              <FinancialDisclosureSectionUpload
                caseId={caseId}
                folderId={folder.id}
                uploadTarget="online_disclosure_booklet"
                itemId={booklet.id}
                fileTestId="input-financial-disclosure-booklet-file"
                buttonTestId="button-upload-financial-disclosure-booklet"
              />
              <FinancialDisclosureDocumentLinks documents={sectionDocuments("online_disclosure_booklet")} emptyLabel="No booklet documents uploaded." />
            </div>
          )}

          <div className="rounded-md border p-3 space-y-3" data-testid="card-financial-disclosure-form-e">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#5a7d58]" />
              <p className="text-sm font-medium">Form E</p>
            </div>
            {canUploadFormE && (
              <FinancialDisclosureSectionUpload
                caseId={caseId}
                folderId={folder.id}
                uploadTarget="form_e"
                fileTestId="input-financial-disclosure-form-e-file"
                buttonTestId="button-upload-financial-disclosure-form-e"
              />
            )}
            <FinancialDisclosureDocumentLinks documents={sectionDocuments("form_e")} emptyLabel="No Form E documents uploaded." />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border p-3 space-y-3" data-testid="card-financial-disclosure-ofs">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Open Financial Statement (OFS)</p>
                <Badge variant={folder.ofsRequired === "yes" ? "default" : folder.ofsRequired === "waived" ? "secondary" : "outline"}>
                  {(folder.ofsRequired || "unknown").replace(/_/g, " ")}
                </Badge>
              </div>
              {canUpdateStaffItems && (
                <Select
                  value={folder.ofsRequired || "unknown"}
                  onValueChange={updateOfs}
                >
                  <SelectTrigger data-testid="select-financial-disclosure-ofs-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="waived">Waived</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <FinancialDisclosureSectionUpload
                caseId={caseId}
                folderId={folder.id}
                uploadTarget="ofs"
                fileTestId="input-financial-disclosure-ofs-file"
                buttonTestId="button-upload-financial-disclosure-ofs"
              />
              <FinancialDisclosureDocumentLinks documents={sectionDocuments("ofs")} emptyLabel="No OFS documents uploaded." />
            </div>

            {checklist && (
              <div className="rounded-md border p-3 space-y-3" data-testid="card-financial-disclosure-checklist">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{checklist.title}</p>
                    <p className="text-xs text-muted-foreground">{checklist.description}</p>
                  </div>
                  <Badge variant={checklist.status === "completed" ? "default" : "outline"}>{checklist.status.replace(/_/g, " ")}</Badge>
                </div>
                {canUpdateStaffItems && (
                  <Select
                    value={checklist.status}
                    onValueChange={(status) => updateItem(checklist, { status })}
                  >
                    <SelectTrigger data-testid="select-financial-disclosure-checklist-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FINANCIAL_DISCLOSURE_ITEM_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {canUpdateStaffItems && (
                  <div className="space-y-2">
                    {checklistRows.map((row) => (
                      <div key={row.key} className="rounded-md border bg-muted/10 p-2 space-y-2" data-testid={`financial-disclosure-checklist-row-${row.key}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">{row.label}</p>
                          <Badge variant={row.status === "completed" ? "default" : row.status === "in_progress" ? "outline" : "secondary"}>
                            {row.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(130px,160px)]">
                          <Select
                            value={row.status}
                            onValueChange={(status) => updateChecklistRow(checklist, row.key, status as FinancialDisclosureProgressStatus, row.documentDate, row.notes)}
                          >
                            <SelectTrigger data-testid={`select-checklist-row-status-${row.key}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="not_started">Not started</SelectItem>
                              <SelectItem value="in_progress">In progress</SelectItem>
                              <SelectItem value="completed">Received</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="date"
                            value={row.documentDate ? String(row.documentDate).slice(0, 10) : ""}
                            onChange={(e) => updateChecklistRow(checklist, row.key, row.status, e.target.value || null, row.notes)}
                            data-testid={`input-checklist-row-document-date-${row.key}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {canUpdateStaffItems && (
                  <FinancialDisclosureSectionUpload
                    caseId={caseId}
                    folderId={folder.id}
                    uploadTarget="financial_disclosure_checklist"
                    itemId={checklist.id}
                    fileTestId="input-financial-disclosure-checklist-file"
                    buttonTestId="button-upload-financial-disclosure-checklist"
                  />
                )}
                <FinancialDisclosureDocumentLinks documents={sectionDocuments("financial_disclosure_checklist")} emptyLabel="No checklist documents uploaded." />
              </div>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-4" data-testid="card-financial-disclosure-evidence">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[#5a7d58]" />
              <p className="text-sm font-medium">Disclosure Documents</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Evidence category</Label>
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger data-testid="select-financial-disclosure-evidence-category">
                  <SelectValue placeholder="Choose category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FinancialDisclosureSectionUpload
              caseId={caseId}
              folderId={folder.id}
              uploadTarget="evidence_category"
              evidenceCategoryId={selectedCategoryId || null}
              disabled={!selectedCategoryId}
              fileTestId="input-financial-disclosure-evidence-file"
              buttonTestId="button-upload-financial-disclosure-evidence"
            />
            <div className="grid gap-3 md:grid-cols-2">
              {categories.map((category) => (
                <div key={category.id} className="rounded-md border p-3 space-y-2" data-testid={`financial-disclosure-category-${category.categoryKey}`}>
                  <div>
                    <p className="text-sm font-medium">{category.label}</p>
                    <p className="text-xs text-muted-foreground">{category.description}</p>
                  </div>
                  <FinancialDisclosureDocumentLinks documents={category.documents} emptyLabel="No evidence uploaded." />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function FinancialDisclosureSourceDetails({ sourceSummary }: { sourceSummary?: FinancialDisclosureFolderView["sourceSummary"] }) {
  if (!sourceSummary) return null;
  const rows = [
    ["Client", sourceSummary.clientName],
    ["Date of birth", sourceSummary.dateOfBirth],
    ["Email", sourceSummary.email],
    ["Phone", sourceSummary.phone],
    ["Address", sourceSummary.address],
    ["National Insurance", sourceSummary.nationalInsuranceNumber],
    ["Employment", sourceSummary.employmentStatus],
    ["Legal aid", sourceSummary.legalAidEligible],
    ["Voucher scheme", sourceSummary.voucherSchemeEligible],
    ["Court proceedings", sourceSummary.courtProceedingsStatus],
    ["Court reference", sourceSummary.courtReference],
    ["Court name", sourceSummary.courtName],
    ["CAFCASS", sourceSummary.cafcassInvolved],
    ["Solicitor", sourceSummary.solicitorInvolved],
    ["Solicitor name", sourceSummary.solicitorName],
    ["Children ages", sourceSummary.childrenAges],
    ["Additional needs", sourceSummary.additionalNeeds],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");

  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3" data-testid="financial-disclosure-source-details">
      <p className="text-sm font-medium">Client source details</p>
      <div className="grid gap-2 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="break-words text-sm">{String(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinancialDisclosureDocumentLinks({ documents, emptyLabel }: { documents: CaseDocumentView[]; emptyLabel: string }) {
  if (documents.length === 0) return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  return (
    <div className="space-y-1">
      {documents.map((document) => (
        <div key={document.id} className="text-xs">
          <a href={document.fileUrl} target="_blank" rel="noreferrer" className="block text-[#5a7d58] hover:underline break-words">
            {document.title}
          </a>
          <p className="text-muted-foreground">
            {document.documentDate ? `Document date ${new Date(document.documentDate).toLocaleDateString()}` : "No document date"}
            {" · "}
            Uploaded {new Date(document.createdAt).toLocaleDateString()}
            {document.fileSizeBytes ? ` · ${Math.ceil(document.fileSizeBytes / 1024)} KB` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function SessionParticipantOverview({ caseData }: { caseData: CaseDetail }) {
  return (
    <div className="space-y-6" data-testid="session-participant-overview">
      <Card>
        <CardHeader><CardTitle className="text-lg">Case overview</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div><p className="text-xs uppercase text-muted-foreground">Case reference</p><p className="font-medium">{caseData.caseRef}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Lead mediator</p><p className="font-medium">{caseData.mediatorName || "Unassigned"}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Category</p><p className="font-medium">{caseData.mediationCategory || caseData.issueType || "Not recorded"}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Stage</p><p className="font-medium">{caseData.stage || "Not recorded"}</p></div>
        </CardContent>
      </Card>
      <SessionParticipantClients caseData={caseData} compact />
    </div>
  );
}

function SessionParticipantClients({ caseData, compact = false }: { caseData: CaseDetail; compact?: boolean }) {
  const parties = caseData.parties || [];
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid={compact ? "session-participant-client-summary" : "session-participant-clients"}>
      {parties.map((party) => (
        <Card key={party.id}>
          <CardHeader><CardTitle className="text-base">Client {party.role}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{[party.firstName, party.lastName].filter(Boolean).join(" ") || "Name not recorded"}</p>
            <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{party.email || "Email not recorded"}</p>
            <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{[party.phoneCode, party.phone].filter(Boolean).join(" ") || "Phone not recorded"}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SessionParticipantMiamSummary({ summaries = [] }: { summaries?: SessionParticipantMiamSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="session-participant-miam-summary">
      {summaries.map((summary) => (
        <Card key={summary.partyId}>
          <CardHeader><CardTitle className="text-base">Client {summary.role} MIAM</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Record</span><span>{summary.recordStatus === "recorded" ? "Recorded" : "Not started"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Approval</span><span>{formatLifecycleLabel(summary.approvalStatus)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Suitable for mediation</span><span>{summary.suitableForMediation || "Not recorded"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Completed</span><span>{summary.completedAt ? formatUkWallClockDateTime(summary.completedAt) : "Not completed"}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Validity</span><span>{summary.valid ? "Valid" : summary.expired ? "Expired" : "Not valid"}</span></div>
            {summary.expiresAt && <div className="flex justify-between gap-4"><span className="text-muted-foreground">Valid until</span><span>{formatUkWallClockDateTime(summary.expiresAt)}</span></div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function CaseDetailPage() {
  const [pageLocation, navigate] = useLocation();
  const [match, params] = useRoute("/cases/:id");
  const caseId = params?.id;
  const { toast } = useToast();
  const { user } = useAuth();
  const isStaff = user?.role === "superadmin" || user?.role === "subadmin" || user?.role === "staff" || user?.role === "mediator";
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";
  const isSuperadmin = user?.role === "superadmin";
  const isClient = user?.role === "client";
  const { canEdit, canView } = usePermissions();

  const [addingNote, setAddingNote] = useState(false);
  const [noteCategory, setNoteCategory] = useState("Safety Concern");
  const [noteContent, setNoteContent] = useState("");
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [confidentialModalOpen, setConfidentialModalOpen] = useState(false);
  const [confidentialModalCaseId, setConfidentialModalCaseId] = useState<string | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: caseData, isLoading } = useQuery<CaseDetail>({
    queryKey: ["/api/cases", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch case");
      return res.json();
    },
    enabled: !!caseId,
  });

  const isMiamOnlyMediator = !!(caseData as Record<string, unknown> | undefined)?.isMiamOnlyMediator;
  const isSessionObserverOnly = !!caseData?.isSessionObserverOnly;
  const isSessionCoMediator = !!caseData?.isSessionCoMediator;
  const isSessionParticipant = isSessionObserverOnly || isSessionCoMediator;
  const canViewOperationalStaffData = isAdmin || (user?.role === "mediator" && !isMiamOnlyMediator && !isSessionParticipant);
  const canManageDocumentRequests = isAdmin || (user?.role === "mediator" && caseData?.mediatorId === user.id);
  const canViewFinance = isClient || (canViewOperationalStaffData && canView("finance"));
  const canUseCaseWhatsapp = isAdmin && canView("cases") && canEdit("whatsapp");
  const { canViewPrivateNotes, canAccessNotesTab, canViewCourtFormsStatus } = getCaseDetailCapabilities({
    canViewOperationalStaffData,
    privateNotesAccess: caseData?.privateNotesAccess,
    canViewCourtForms: canView("court_forms"),
  });
  const canViewMediationSessionsTab = isAdmin || isClient || caseData?.sessionAccess === "full" || caseData?.sessionAccess === "observer" || caseData?.sessionAccess === "co_mediator";

  const overviewMediationSessionsQuery = useQuery<MediationSessionsResponse>({
    queryKey: ["/api/cases", caseId, "mediation-sessions"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/mediation-sessions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load mediation sessions");
      return res.json();
    },
    enabled: !!caseId && isAdmin && !isMiamOnlyMediator && !isSessionObserverOnly,
  });

  const refreshCaseDetailIntakeWorkflow = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks", caseId, "intake-chase"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const shuttleMutation = useMutation({
    mutationFn: async (shuttleMediation: boolean) => {
      await apiRequest("PATCH", `/api/cases/${caseId}/shuttle`, { shuttleMediation });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Shuttle mediation updated" });
    },
    onError: () => {
      toast({ title: "Failed to update shuttle mediation", variant: "destructive" });
    },
  });

  const archiveCaseMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/archive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Case archived", description: "The case has been moved to Archived." });
      setArchiveDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to archive case", description: err.message, variant: "destructive" });
    },
  });

  const restoreCaseMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/cases/${caseId}/restore`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Case restored", description: "The case is now Active again." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to restore case", description: err.message, variant: "destructive" });
    },
  });

  const hardDeleteCaseMutation = useMutation({
    mutationFn: async (confirm: string) => {
      await apiRequest("DELETE", `/api/cases/${caseId}`, { confirm });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      toast({ title: "Case permanently deleted" });
      setDeleteDialogOpen(false);
      navigate("/cases");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete case", description: err.message, variant: "destructive" });
    },
  });

  const confidentialNotesQuery = useQuery<ConfidentialNoteWithAuthor[]>({
    queryKey: ["/api/cases", caseId, "confidential-notes"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/confidential-notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch confidential notes");
      return res.json();
    },
    enabled: !!caseId && canViewOperationalStaffData,
  });
  const hasConfidentialNotes = (confidentialNotesQuery.data?.length ?? 0) > 0;

  const { data: miamTabData } = useQuery<{ miamMediatorTabHidden?: boolean }>({
    queryKey: ["/api/miam-records/case", caseId, "tab-visibility"],
    queryFn: async () => {
      const res = await fetch(`/api/miam-records/case/${caseId}`, { credentials: "include" });
      if (!res.ok) return { miamMediatorTabHidden: false };
      return res.json();
    },
    enabled: !!caseId && isStaff && user?.role === "mediator" && !isSessionParticipant,
  });

  const showMiamTab = isSessionParticipant || (isStaff && !(miamTabData?.miamMediatorTabHidden === true));
  const showFinancialDisclosureTab = !isSessionObserverOnly && !isSessionCoMediator && isFinancialDisclosureEligibleCaseDetail(caseData);

  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tab");
    // Support both singular and plural spellings of the demographic tab param.
    const tab = raw === "demographics" ? "demographic" : raw;
    const allowed = ["overview", "clients", "appointments", "mediation-sessions", "demographic", "financial-disclosure", "documents", "proofing", "payments", "miam-record", "communications", "notes"];
    return allowed.includes(tab ?? "") ? (tab as string) : "overview";
  });

  useEffect(() => {
    const raw = new URLSearchParams(pageLocation.split("?")[1] || "").get("tab");
    const tab = raw === "demographics" ? "demographic" : raw;
    const allowed = ["overview", "clients", "appointments", "mediation-sessions", "demographic", "financial-disclosure", "documents", "proofing", "payments", "miam-record", "communications", "notes"];
    if (allowed.includes(tab ?? "")) setActiveTab(tab as string);
  }, [pageLocation]);

  useEffect(() => {
    if (activeTab === "payments" && !canViewFinance) {
      setActiveTab("overview");
    }
  }, [activeTab, canViewFinance]);

  useEffect(() => {
    if (activeTab === "miam-record" && !showMiamTab) {
      setActiveTab("overview");
    }
  }, [showMiamTab, activeTab]);

  useEffect(() => {
    if (caseData && activeTab === "financial-disclosure" && !showFinancialDisclosureTab) {
      setActiveTab("overview");
    }
  }, [caseData, activeTab, showFinancialDisclosureTab]);

  useEffect(() => {
    if (caseData && activeTab === "mediation-sessions" && !canViewMediationSessionsTab) {
      setActiveTab("overview");
    }
  }, [caseData, activeTab, canViewMediationSessionsTab]);

  useEffect(() => {
    if (["proofing", "communications"].includes(activeTab) && !canViewOperationalStaffData) {
      setActiveTab("overview");
    }
    if (shouldRedirectFromNotesTab({
      activeTab,
      caseDetailLoaded: !!caseData,
      canAccessNotesTab,
    })) {
      setActiveTab("overview");
    }
    if (activeTab === "documents" && !isClient && !canViewOperationalStaffData && !isSessionCoMediator) {
      setActiveTab("overview");
    }
  }, [activeTab, canAccessNotesTab, canViewOperationalStaffData, caseData, isClient, isSessionCoMediator]);

  const { data: overviewAppointments, isLoading: appointmentsLoading } = useQuery<{ id: string; partyId?: string | null; status: string; serviceName?: string | null; dateTime?: string | Date | null }[]>({
    queryKey: ["/api/appointments/case", caseId, "overview"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/case/${caseId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!caseId && (isAdmin || user?.role === "client"),
  });

  const appointmentsNotReady = (isAdmin || user?.role === "client") && appointmentsLoading;
  const overviewParties = caseData?.parties ?? [
    ...(caseData?.partyA ? [caseData.partyA] : []),
    ...(caseData?.partyB ? [caseData.partyB] : []),
  ];
  const partyHasActiveApptByRole = (role: string): boolean => {
    if (appointmentsNotReady) return true;
    const party = overviewParties.find((p) => p.role === role);
    if (!party) return false;
    return (overviewAppointments || []).some(
      (a) => a.partyId === party.id && ACTIVE_BOOKING_STATUSES.has(a.status),
    );
  };
  const partyHasActiveMiamBookingByRole = (role: string): boolean => {
    if (appointmentsNotReady) return true;
    const party = overviewParties.find((p) => p.role === role);
    if (!party) return false;
    if (isClient) return (overviewAppointments || []).some((a) => isActiveMiamBookingBlocker(a));
    return (overviewAppointments || []).some(
      (a) => a.partyId === party.id && isActiveMiamBookingBlocker(a),
    );
  };

  const addNoteMutation = useMutation({
    mutationFn: async (data: { category: string; content: string }) => {
      await apiRequest("POST", `/api/cases/${caseId}/confidential-notes`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "confidential-notes"] });
      setAddingNote(false);
      setNoteContent("");
      setNoteCategory("Safety Concern");
      toast({ title: "Note added" });
    },
    onError: () => {
      toast({ title: "Failed to add note", variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest("DELETE", `/api/cases/${caseId}/confidential-notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "confidential-notes"] });
      setDeletingNoteId(null);
      toast({ title: "Note deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete note", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (canViewOperationalStaffData && caseData && confidentialModalCaseId !== caseId && !confidentialNotesQuery.isLoading && hasConfidentialNotes) {
      setConfidentialModalOpen(true);
      setConfidentialModalCaseId(caseId ?? null);
    }
  }, [canViewOperationalStaffData, caseData, caseId, confidentialModalCaseId, hasConfidentialNotes, confidentialNotesQuery.isLoading]);

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-5 w-96" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">{isClient ? "Mediation case not found." : "Case not found."}</p>
        <Button variant="ghost" onClick={() => navigate("/cases")}>{isClient ? "Back to mediation" : "Back to cases"}</Button>
      </div>
    );
  }

  const isShuttle = caseData.shuttleMediation;
  const displayRef = isShuttle ? `${caseData.caseRef}-SHUTTLE` : caseData.caseRef;
  const showPersistentActivityCard = user?.role === "superadmin";
  const visibleActiveTab = activeTab === "financial-disclosure" && !showFinancialDisclosureTab ? "overview" : activeTab;
  const showMediatorIntakeBadges = user?.role === "mediator" && !isClient && !isSessionParticipant;
  const caseParties = caseData.parties ?? [
    ...(caseData.partyA ? [caseData.partyA] : []),
    ...(caseData.partyB ? [caseData.partyB] : []),
  ];
  const isAssignedFinancialDisclosureMediator = user?.role === "mediator" && (
    caseData.mediatorId === user.id
      || caseParties.some((party) => party.miamMediatorId === user.id || party.allocatedMediatorId === user.id)
  );
  const canUploadFormE = isClient || isAdmin || !!isAssignedFinancialDisclosureMediator;
  const canRaiseComplaint = isAdmin || isClient || (user?.role === "mediator" && !isMiamOnlyMediator && !isSessionParticipant);
  const openProofingFromDocuments = () => {
    setActiveTab("proofing");
    navigate(`/cases/${caseId}?tab=proofing`);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="case-detail-page">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/cases")} data-testid="button-back-cases">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid="text-case-ref">
              {displayRef}
            </h1>
            <Badge variant={caseData.status === "Active" ? "default" : "secondary"} data-testid="badge-case-status">
              {caseData.status}
            </Badge>
            {caseData.legacyCaseNumber && (
              <Badge variant="outline" className="text-slate-700 border-slate-300 bg-slate-50" data-testid="badge-case-legacy">
                Legacy
              </Badge>
            )}
            {isShuttle && (
              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                <Shuffle className="w-3 h-3 mr-1" /> Shuttle
              </Badge>
            )}
            {canViewOperationalStaffData && (
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 border-red-300 text-red-600 hover:bg-red-50"
                onClick={() => setConfidentialModalOpen(true)}
                title="View confidential notes"
                data-testid="button-open-confidential-modal"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
              </Button>
            )}
            {canRaiseComplaint && (
              <Button variant="outline" size="sm" className="h-7" asChild data-testid="button-raise-case-complaint">
                <Link href={`/raise-complaint?caseId=${encodeURIComponent(caseId!)}`}>Raise complaint</Link>
              </Button>
            )}
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    data-testid="button-case-detail-actions"
                    aria-label="Case actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {caseData.status === "Archived" ? (
                    user?.role === "superadmin" && (
                      <DropdownMenuItem
                        onClick={() => restoreCaseMutation.mutate()}
                        disabled={restoreCaseMutation.isPending}
                        data-testid="menu-restore-case-detail"
                      >
                        <ArchiveRestore className="w-4 h-4 mr-2" />
                        Restore case
                      </DropdownMenuItem>
                    )
                  ) : (
                    <DropdownMenuItem
                      onClick={() => setArchiveDialogOpen(true)}
                      data-testid="menu-archive-case-detail"
                    >
                      <Archive className="w-4 h-4 mr-2" />
                      Archive case
                    </DropdownMenuItem>
                  )}
                  {user?.role === "superadmin" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteDialogOpen(true)}
                        className="text-destructive focus:text-destructive"
                        data-testid="menu-delete-case-detail"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete permanently
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {isSessionObserverOnly ? (
            <p className="text-muted-foreground text-sm mt-1" data-testid="text-case-subtitle">
              Mediation session observer
            </p>
          ) : (
            <p className="text-muted-foreground text-sm mt-1" data-testid="text-case-subtitle">
              {caseData.issueType} &middot; Mediator: {caseData.mediatorName}
              {caseData.leadSource && !isClient && <> &middot; Source: {caseData.leadSource}</>}
            </p>
          )}
          <p className="text-muted-foreground text-xs mt-0.5" data-testid="text-case-dates">
            <CalendarDays className="w-3 h-3 inline mr-1" />
            Opened {formatDate(caseData.createdAt)} &middot; Updated {relativeTime(caseData.lastUpdated)}
          </p>
          {showMediatorIntakeBadges && (
            <div className="flex items-center gap-2 flex-wrap mt-2" data-testid="mediator-intake-badges">
              <Badge variant={caseData.intakeStatus === "Safeguarding" ? "destructive" : caseData.intakeStatus === "Closed" ? "outline" : "secondary"} data-testid="badge-mediator-intake-status">
                Intake: {caseData.intakeStatus || "New"}
              </Badge>
              <Badge
                variant={caseData.safeguardingStatus === "concern" ? "destructive" : "outline"}
                className={caseData.safeguardingStatus === "clear" ? "text-green-700 border-green-300 bg-green-50" : ""}
                data-testid="badge-mediator-safeguarding-status"
              >
                {caseData.safeguardingStatus === "concern" ? "Safeguarding concern" : caseData.safeguardingStatus === "clear" ? "Safeguarding clear" : "Safeguarding pending"}
              </Badge>
              {isShuttle && (
                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50" data-testid="badge-mediator-shuttle">
                  <Shuffle className="w-3 h-3 mr-1" /> Shuttle
                </Badge>
              )}
              <Badge variant={caseData.firstContactAttemptedAt ? "outline" : "secondary"} data-testid="badge-mediator-first-contact-status">
                {caseData.firstContactAttemptedAt ? "First contact recorded" : "First contact pending"}
              </Badge>
              {caseData.intakeStatus === "Closed" && (
                <Badge variant="outline" data-testid="badge-mediator-intake-closed">
                  Closed intake
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <Tabs value={visibleActiveTab} onValueChange={setActiveTab} className="space-y-6 min-w-0">
        <div className="w-full overflow-x-auto pb-1" data-testid="case-detail-tabs-scroll">
          <TabsList className="inline-flex min-w-max whitespace-nowrap" data-testid="tabs-case-detail">
            <TabsTrigger className="shrink-0" value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger className="shrink-0" value="clients" data-testid="tab-clients">{isClient ? "My Details" : "Clients"}</TabsTrigger>
            <TabsTrigger className="shrink-0" value="appointments" data-testid="tab-appointments">Appointments</TabsTrigger>
            {isSessionParticipant && showMiamTab && <TabsTrigger className="shrink-0" value="miam-record" data-testid="tab-miam-record">MIAM Record</TabsTrigger>}
            {canViewMediationSessionsTab && <TabsTrigger className="shrink-0" value="mediation-sessions" data-testid="tab-mediation-sessions">Mediation Sessions</TabsTrigger>}
            {!isSessionObserverOnly && (isAdmin || isClient) && <TabsTrigger className="shrink-0" value="demographic" data-testid="tab-demographic">Demographic Data</TabsTrigger>}
            {showFinancialDisclosureTab && <TabsTrigger className="shrink-0" value="financial-disclosure" data-testid="tab-financial-disclosure">Financial Disclosure</TabsTrigger>}
            {canViewOperationalStaffData && <TabsTrigger className="shrink-0" value="proofing" data-testid="tab-proofing">Proofing</TabsTrigger>}
            {(isClient || canViewOperationalStaffData || isSessionCoMediator) && <TabsTrigger className="shrink-0" value="documents" data-testid="tab-documents">Documents</TabsTrigger>}
            {!isSessionObserverOnly && canViewFinance && <TabsTrigger className="shrink-0" value="payments" data-testid="tab-payments">Payments</TabsTrigger>}
            {!isSessionParticipant && showMiamTab && <TabsTrigger className="shrink-0" value="miam-record" data-testid="tab-miam-record">MIAM Record</TabsTrigger>}
            {canViewOperationalStaffData && <TabsTrigger className="shrink-0" value="communications" data-testid="tab-communications">Communications</TabsTrigger>}
            {canAccessNotesTab && <TabsTrigger className="shrink-0" value="notes" data-testid="tab-notes">Notes</TabsTrigger>}
            {isSuperadmin && <TabsTrigger className="shrink-0" value="complaints" data-testid="tab-complaints">Complaints</TabsTrigger>}
          </TabsList>
        </div>

        <div className={showPersistentActivityCard ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start" : ""} data-testid="case-detail-content-grid">
          <div className="min-w-0 space-y-6">
        <TabsContent value="overview" className="space-y-6 mt-0">
          {isSessionParticipant ? <SessionParticipantOverview caseData={caseData} /> : <>
          {!isClient && !isSessionParticipant && <StageProgressCard caseData={caseData} caseId={caseId!} />}

          {isAdmin && <SourceEnquirySummaryCard caseData={caseData} canViewSensitiveCaseMarkers={canViewOperationalStaffData} />}

          {isAdmin && !isSessionObserverOnly && (
            <IntakeWorkflowCard
              mode="safeguarding-only"
              caseData={caseData}
              caseId={caseId!}
              onWorkflowUpdated={refreshCaseDetailIntakeWorkflow}
              shuttleControl={{
                checked: isShuttle,
                isPending: shuttleMutation.isPending,
                canEdit: canEdit("cases"),
                onChange: (checked) => shuttleMutation.mutate(checked),
              }}
            />
          )}

          {canViewCourtFormsStatus && <CourtFormsStatusCard caseId={caseId!} parties={caseData.parties ?? []} stageIdx={MAIN_WORKFLOW_STAGES.indexOf(caseData.stage)} />}

          <CaseInformationCard caseData={caseData} caseId={caseId!} canViewSensitiveCaseMarkers={canViewOperationalStaffData} />

          {canViewOperationalStaffData && (
            <Card className="border-red-300 bg-red-50/50" data-testid="card-confidential-notes">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-heading flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    Confidential Case Information
                  </CardTitle>
                  {canEdit("cases") && !addingNote && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setAddingNote(true)}
                      data-testid="button-add-confidential-note"
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add Note
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {addingNote && (
                  <div className="space-y-3 border border-red-200 rounded-lg p-3 bg-white" data-testid="form-add-confidential-note">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Category</Label>
                      <Select value={noteCategory} onValueChange={setNoteCategory}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-note-category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONFIDENTIAL_NOTE_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Note</Label>
                      <Textarea
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        placeholder="Please share sensitive information that those working with the case need to know — e.g. changes in client's behaviour/presentation, agreements or requests, safeguarding considerations, domestic abuse, additional needs, and how to be most inclusive."
                        className="min-h-[80px] text-sm"
                        data-testid="textarea-confidential-note"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setAddingNote(false); setNoteContent(""); }}
                        disabled={addNoteMutation.isPending}
                        data-testid="button-cancel-add-note"
                      >
                        <X className="w-3 h-3 mr-1" /> Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                        onClick={() => addNoteMutation.mutate({ category: noteCategory, content: noteContent })}
                        disabled={addNoteMutation.isPending || !noteContent.trim()}
                        data-testid="button-save-confidential-note"
                      >
                        {addNoteMutation.isPending ? "Saving..." : "Save Note"}
                      </Button>
                    </div>
                  </div>
                )}

                {confidentialNotesQuery.isLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="border border-red-100 rounded-lg p-3 bg-white space-y-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-5 w-24 rounded-full" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ))}
                  </div>
                ) : confidentialNotesQuery.data && confidentialNotesQuery.data.length > 0 ? (
                  <div className="space-y-2">
                    {confidentialNotesQuery.data.map((note) => (
                      <div key={note.id} className="border border-red-100 rounded-lg p-3 bg-white" data-testid={`confidential-note-${note.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <ConfidentialCategoryBadge category={note.category} />
                            <span className="text-xs text-muted-foreground">
                              {note.createdByName} &middot; {relativeTime(note.createdAt)}
                            </span>
                          </div>
                          {(note.createdBy === user?.id || user?.role === "superadmin") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                              onClick={() => setDeletingNoteId(note.id)}
                              data-testid={`button-delete-note-${note.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                        <p className="text-sm mt-1.5 leading-relaxed whitespace-pre-wrap" data-testid={`text-note-content-${note.id}`}>{note.content}</p>
                      </div>
                    ))}
                  </div>
                ) : !addingNote ? (
                  <p className="text-sm text-muted-foreground italic" data-testid="text-confidential-notes-empty">No confidential notes recorded yet.</p>
                ) : null}
              </CardContent>

              <AlertDialog open={!!deletingNoteId && !confidentialModalOpen} onOpenChange={(open) => !open && setDeletingNoteId(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete confidential note?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone. The note will be permanently removed.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete-note">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => deletingNoteId && deleteNoteMutation.mutate(deletingNoteId)}
                      data-testid="button-confirm-delete-note"
                    >
                      {deleteNoteMutation.isPending ? "Deleting..." : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {overviewParties.map((party) => (
              <PartySummaryCard
                key={party.id}
                party={party}
                role={party.role}
                caseRef={caseData.caseRef}
                isShuttle={isShuttle}
                caseId={caseData.id}
                isAdmin={isAdmin}
                partyHasActiveAppointment={partyHasActiveApptByRole(party.role)}
                partyHasActiveMiamBooking={partyHasActiveMiamBookingByRole(party.role)}
                partyMiamValidity={caseData.miamValidity?.parties?.find((item) => item.partyId === party.id)}
              />
            ))}
            {/* Render an empty Party B summary placeholder so admins/mediators see "Not yet added" before any party B exists. */}
            {!isClient && !isMiamOnlyMediator && !overviewParties.some((p) => (p.role || "").toUpperCase() === "B") && (
              <PartySummaryCard party={undefined} role="B" caseRef={caseData.caseRef} isShuttle={isShuttle} caseId={caseData.id} isAdmin={isAdmin} partyHasActiveAppointment={false} partyHasActiveMiamBooking={false} />
            )}
          </div>

          {isAdmin && !isMiamOnlyMediator && !isSessionObserverOnly && (
            <MiamReadinessCard
              readiness={overviewMediationSessionsQuery.data?.readiness}
              isLoading={overviewMediationSessionsQuery.isLoading}
              dataTestId="card-overview-miam-readiness"
              onGoToMediationSessions={() => setActiveTab("mediation-sessions")}
            />
          )}

          {isAdmin && !isMiamOnlyMediator && !isSessionObserverOnly && (
            <CimEligibilityCard
              caseId={caseId!}
              caseData={caseData}
              parties={caseData.parties ?? []}
            />
          )}

          {canViewOperationalStaffData && <CaseNotesCard caseData={caseData} caseId={caseId!} />}
          </>}
        </TabsContent>

        <TabsContent value="clients" className="space-y-6">
          {isSessionParticipant ? <SessionParticipantClients caseData={caseData} /> : <>
          {overviewParties.map((party, idx) => (
            <div key={party.id}>
              {idx > 0 && !isClient && <Separator className="mb-6" />}
              <h2 className="text-lg font-heading font-semibold mb-1">
                {isClient ? "Your Details" : `Client ${party.role}`}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                {isClient
                  ? "Your personal information and case details."
                  : isAdmin
                  ? "Summary and full demographic record shown side by side."
                  : "Client summary information."}
              </p>
              <div className={(isAdmin || isClient) ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
                <PartySummaryCard
                  party={party}
                  role={party.role}
                  caseRef={caseData.caseRef}
                  isShuttle={isShuttle}
                  caseId={caseData.id}
                  isAdmin={isAdmin}
                  partyHasActiveAppointment={partyHasActiveApptByRole(party.role)}
                  partyHasActiveMiamBooking={partyHasActiveMiamBookingByRole(party.role)}
                  partyMiamValidity={caseData.miamValidity?.parties?.find((item) => item.partyId === party.id)}
                />
                {(isAdmin || isClient) && (
                  <PartyFullRecord
                    party={party}
                    role={party.role}
                    caseRef={caseData.caseRef}
                    isShuttle={isShuttle}
                    isStaff={isStaff}
                    caseId={caseData.id}
                  />
                )}
              </div>
              <div className="mt-4">
                <RepresentativesSection
                  caseId={caseData.id}
                  partyId={party.id}
                  partyRole={party.role}
                  clientId={party.clientId}
                  canMutate={isAdmin || (isClient && (caseData.userPartyRole || "").toUpperCase() === (party.role || "").toUpperCase())}
                />
              </div>
            </div>
          ))}

          {isAdmin && (
            <MediatorRepVisibilityToggle caseId={caseData.id} value={!!caseData.mediatorCanSeeReps} />
          )}
          {!isAdmin && user?.role === "mediator" && (
            <MediatorRepVisibilityToggle caseId={caseData.id} value={!!caseData.mediatorCanSeeReps} readOnly />
          )}

          {isStaff && !isMiamOnlyMediator && !isSessionParticipant && canEdit("cases") && caseData.nextRoleLetter && (
            <AddPartyCard caseId={caseData.id} nextRoleLetter={caseData.nextRoleLetter} />
          )}
          </>}
        </TabsContent>

        <TabsContent value="appointments" className="space-y-6">
          <AppointmentsTab caseId={caseId!} caseData={caseData} isStaff={isStaff && !isSessionParticipant} />
        </TabsContent>

        {canViewMediationSessionsTab && (
          <TabsContent value="mediation-sessions" className="space-y-6">
            <MediationSessionsTab
              caseId={caseId!}
              isAdmin={isAdmin}
              isSuperadmin={isSuperadmin}
              isClient={isClient}
              sessionAccess={caseData.sessionAccess}
              parties={caseData.parties || []}
            />
          </TabsContent>
        )}

        <TabsContent value="demographic" className="space-y-6">
          <DemographicDataTab caseId={caseId!} caseData={caseData} isStaff={isStaff} />
        </TabsContent>

        {showFinancialDisclosureTab && (
          <TabsContent value="financial-disclosure" className="space-y-6">
            <FinancialDisclosurePanel caseId={caseId!} canUpdateStaffItems={isStaff} canUploadFormE={canUploadFormE} />
          </TabsContent>
        )}

        {showMiamTab && (
          <TabsContent value="miam-record" className="space-y-6">
            {isSessionParticipant
              ? <SessionParticipantMiamSummary summaries={caseData.miamSummaries} />
              : <MiamRecordTab caseId={caseId!} canEdit={canEdit("cases")} isMiamOnlyMediator={isMiamOnlyMediator} />}
          </TabsContent>
        )}

        <TabsContent value="documents" className="space-y-6">
          {canViewOperationalStaffData && (
            <DocumentsCourtFormsSection
              caseId={caseId!}
              parties={caseData.parties ?? []}
              stageIdx={MAIN_WORKFLOW_STAGES.indexOf(caseData.stage)}
              miamValidForCourtAction={caseData.miamValidity?.valid ?? false}
              miamValidity={caseData.miamValidity}
              caseLeadMediatorId={caseData.mediatorId}
            />
          )}
          <CaseDocumentRequestsSection
            caseId={caseId!}
            parties={caseData.parties ?? []}
            canManage={canManageDocumentRequests}
            canView={canManageDocumentRequests || isClient}
          />
          <CaseDocumentsPanel caseId={caseId!} canView={canViewOperationalStaffData || isClient || isSessionCoMediator} canUpload={canViewOperationalStaffData} isAdmin={isAdmin} onReviewInProofing={openProofingFromDocuments} />
        </TabsContent>

        {canViewOperationalStaffData && (
          <TabsContent value="proofing" className="space-y-6">
            <CaseProofingPanel caseId={caseId!} canView={isStaff} isAdmin={isAdmin} />
          </TabsContent>
        )}
        {isSuperadmin && (
          <TabsContent value="complaints" className="space-y-6">
            <CaseComplaintsPanel caseId={caseId!} />
          </TabsContent>
        )}

        {canViewFinance && (
          <TabsContent value="payments">
            <PaymentsTab caseId={caseId!} />
          </TabsContent>
        )}

        {canViewOperationalStaffData && (
          <TabsContent value="communications">
            <Card data-testid="card-communications">
              <CardHeader>
                <CardTitle className="text-lg font-heading flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-[#b8825a]" />
                  Case Communication Ledger
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Combined email, WhatsApp, phone, and manual communication history for this case.
                </p>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="history" className="space-y-4">
                  <TabsList><TabsTrigger value="history">History</TabsTrigger>{canUseCaseWhatsapp && <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>}</TabsList>
                  <TabsContent value="history"><CaseCommunicationsLedger caseId={caseId!} parties={caseData.parties ?? []} /></TabsContent>
                  {canUseCaseWhatsapp && <TabsContent value="whatsapp"><CaseWhatsappPanel caseId={caseId!} /></TabsContent>}
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canAccessNotesTab && (
          <TabsContent value="notes">
            {canViewPrivateNotes ? <PrivateCaseNotesPanel caseId={caseId!} /> : <Card data-testid="card-notes-placeholder"><CardContent className="flex flex-col items-center justify-center py-16 text-center"><StickyNote className="w-12 h-12 text-muted-foreground/40 mb-4" /><h3 className="text-lg font-heading font-semibold mb-1">Notes</h3><p className="text-sm text-muted-foreground max-w-md">Case notes are coming soon.</p></CardContent></Card>}
          </TabsContent>
        )}
          </div>

        {showPersistentActivityCard && (
          <PersistentRecentActivityCard
            caseId={caseId!}
            isStaff={isStaff}
            onViewAll={() => setActiveTab("communications")}
          />
        )}
        </div>
      </Tabs>

      {canViewOperationalStaffData && (
        <Dialog open={confidentialModalOpen} onOpenChange={setConfidentialModalOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto border-red-300 bg-red-50" data-testid="dialog-confidential-notes">
            <DialogHeader>
              <DialogTitle className="text-base font-heading flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600" />
                Confidential Case Information
              </DialogTitle>
              <DialogDescription className="text-xs text-red-600">
                Staff-only notes visible to admins and mediators. Not accessible to clients.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {canEdit("cases") && !addingNote && (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setAddingNote(true)}
                    data-testid="button-modal-add-confidential-note"
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add Note
                  </Button>
                </div>
              )}
              {addingNote && (
                <div className="space-y-3 border border-red-200 rounded-lg p-3 bg-white" data-testid="form-modal-add-confidential-note">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Category</Label>
                    <Select value={noteCategory} onValueChange={setNoteCategory}>
                      <SelectTrigger className="h-8 text-sm" data-testid="select-modal-note-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONFIDENTIAL_NOTE_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Note</Label>
                    <Textarea
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Please share sensitive information that those working with the case need to know — e.g. changes in client's behaviour/presentation, agreements or requests, safeguarding considerations, domestic abuse, additional needs, and how to be most inclusive."
                      className="min-h-[80px] text-sm"
                      data-testid="textarea-modal-confidential-note"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setAddingNote(false); setNoteContent(""); }}
                      disabled={addNoteMutation.isPending}
                      data-testid="button-modal-cancel-add-note"
                    >
                      <X className="w-3 h-3 mr-1" /> Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white"
                      onClick={() => addNoteMutation.mutate({ category: noteCategory, content: noteContent })}
                      disabled={addNoteMutation.isPending || !noteContent.trim()}
                      data-testid="button-modal-save-confidential-note"
                    >
                      {addNoteMutation.isPending ? "Saving..." : "Save Note"}
                    </Button>
                  </div>
                </div>
              )}

              {confidentialNotesQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="border border-red-100 rounded-lg p-3 bg-white space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-5 w-24 rounded-full" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ) : confidentialNotesQuery.data && confidentialNotesQuery.data.length > 0 ? (
                <div className="space-y-2">
                  {confidentialNotesQuery.data.map((note) => (
                    <div key={note.id} className="border border-red-100 rounded-lg p-3 bg-white" data-testid={`modal-confidential-note-${note.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ConfidentialCategoryBadge category={note.category} />
                          <span className="text-xs text-muted-foreground">
                            {note.createdByName} &middot; {relativeTime(note.createdAt)}
                          </span>
                        </div>
                        {(note.createdBy === user?.id || user?.role === "superadmin") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                            onClick={() => setDeletingNoteId(note.id)}
                            data-testid={`button-modal-delete-note-${note.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      <p className="text-sm mt-1.5 leading-relaxed whitespace-pre-wrap" data-testid={`text-modal-note-content-${note.id}`}>{note.content}</p>
                    </div>
                  ))}
                </div>
              ) : !addingNote ? (
                <p className="text-sm text-muted-foreground italic" data-testid="text-modal-confidential-notes-empty">No confidential notes recorded yet.</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-100"
                onClick={() => setConfidentialModalOpen(false)}
                data-testid="button-close-confidential-modal"
              >
                Acknowledged
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {canViewOperationalStaffData && (
        <AlertDialog open={!!deletingNoteId && confidentialModalOpen} onOpenChange={(open) => !open && setDeletingNoteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete confidential note?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone. The note will be permanently removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-modal-cancel-delete-note">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => deletingNoteId && deleteNoteMutation.mutate(deletingNoteId)}
                data-testid="button-modal-confirm-delete-note"
              >
                {deleteNoteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isAdmin && (
        <>
          <DeleteDialog
            open={archiveDialogOpen}
            onOpenChange={setArchiveDialogOpen}
            title={`Archive case ${caseData.caseRef}?`}
            description="Archived cases are hidden from default lists and the dashboard. You can restore them at any time from the Archived filter."
            onConfirm={() => archiveCaseMutation.mutate()}
            confirmLabel="Archive"
            cancelTestId="button-cancel-archive-case-detail"
            confirmTestId="button-confirm-archive-case-detail"
            isPending={archiveCaseMutation.isPending}
          />
          {user?.role === "superadmin" && (
            <DeleteDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
              title="Permanently delete case?"
              description={`This will permanently remove case ${caseData.caseRef} along with all party links, appointments, MIAM records, notes, activities, and notifications. Client records themselves are preserved and remain accessible from the Clients page. This cannot be undone.`}
              onConfirm={(typed) => hardDeleteCaseMutation.mutate(typed ?? "")}
              confirmLabel="Delete permanently"
              confirmText={caseData.caseRef}
              confirmInputTestId="input-confirm-delete-case-detail"
              cancelTestId="button-cancel-delete-case-detail"
              confirmTestId="button-confirm-delete-case-detail"
              isPending={hardDeleteCaseMutation.isPending}
            />
          )}
        </>
      )}
    </div>
  );
}
