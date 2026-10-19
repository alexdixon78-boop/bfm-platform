import {
  type User, type InsertUser,
  type Enquiry, type InsertEnquiry, type UpdateEnquiryData,
  type Case, type InsertCase,
  type CaseClosureRecord, type CaseClosurePartyFollowUp, type CaseClosurePayload,
  type Party, type InsertParty, type PartyLink,
  type Client, type InsertClient,
  type Permission,
  type ConfidentialNote, type InsertConfidentialNote,
  type ServiceType, type InsertServiceType, type MediatorServiceType, type MediatorServiceAssignmentInput,
  type MediatorAvailability, type InsertMediatorAvailability,
  type Appointment, type InsertAppointment,
  type AppointmentStatusHistory, type InsertAppointmentStatusHistory,
  type DemographicData,
  type MiamRecord,
  type MiamEditRequest,
  type CaseActivity, type InsertCaseActivity,
  type MediationSession, type InsertMediationSession,
  type MediationSessionNote, type InsertMediationSessionNote,
  type MediationSessionParticipant, type InsertMediationSessionParticipant,
  type MediationSessionPartyAttendance, type InsertMediationSessionPartyAttendance,
  type MediationSessionProposal, type InsertMediationSessionProposal,
  type MediationSessionProposalRecipient, type InsertMediationSessionProposalRecipient,
  type MediationSessionProposalResponseStatus,
  type PartyRequiredForm, type InsertPartyRequiredForm, type PartyRequiredFormStatus, type PartyRequiredFormType,
  type CaseCimConsent, type InsertCaseCimConsent,
  type MediationSessionAvailabilityWindow, type InsertMediationSessionAvailabilityWindow,
  type CaseDocument, type InsertCaseDocument,
  type CaseDocumentRequest, type InsertCaseDocumentRequest,
  type CourtFormTemplate, type InsertCourtFormTemplate,
  type CourtFormGuidance, type InsertCourtFormGuidance,
  type CourtFormDraft, type InsertCourtFormDraft,
  type CourtFormGeneration, type InsertCourtFormGeneration, type CourtFormType,
  type CaseDraftFinancialSchedule, type InsertCaseDraftFinancialSchedule,
  type CaseDraftFinancialScheduleVersion, type InsertCaseDraftFinancialScheduleVersion,
  type CaseProofingItem, type InsertCaseProofingItem,
  type CaseProofingItemCycle, type InsertCaseProofingItemCycle,
  type FinancialDisclosureBookletTemplate, type InsertFinancialDisclosureBookletTemplate,
  type FinancialDisclosureFolder, type InsertFinancialDisclosureFolder,
  type FinancialDisclosureItem, type InsertFinancialDisclosureItem, type FinancialDisclosureItemStatus,
  type FinancialDisclosureEvidenceCategory, type InsertFinancialDisclosureEvidenceCategory,
  type GoogleCalendarEvent, type InsertGoogleCalendarEvent,
  type OutlookCalendarEvent, type InsertOutlookCalendarEvent,
  type PaginationParams, type PaginatedResponse,
  type CaseFilterPreset, type CaseFilters,
} from "@shared/schema";
import { UserRepository } from "./repositories/user.repository";
import { EnquiryRepository } from "./repositories/enquiry.repository";
import { CaseRepository, type CaseClosurePartyFollowUpInput, type CaseFollowUpConsentContext, type HardDeleteCaseCounts, type ListCasesOptions, type ListCasesResult } from "./repositories/case.repository";
import { CaseFilterPresetRepository } from "./repositories/case-filter-preset.repository";
import { PartyRepository } from "./repositories/party.repository";
import { ClientRepository, type ClientRow, type CaseLinkRow } from "./repositories/client.repository";
import { PermissionRepository } from "./repositories/permission.repository";
import { ConfidentialNoteRepository } from "./repositories/confidential-note.repository";
import { ServiceTypeRepository } from "./repositories/service-type.repository";
import { AvailabilityRepository } from "./repositories/availability.repository";
import { AppointmentRepository } from "./repositories/appointment.repository";
import { AppointmentStatusHistoryRepository } from "./repositories/appointment-status-history.repository";
import { DemographicDataRepository } from "./repositories/demographic-data.repository";
import { CaseActivityRepository } from "./repositories/case-activity.repository";
import { MiamRecordRepository } from "./repositories/miam-record.repository";
import { MiamEditRequestRepository } from "./repositories/miam-edit-request.repository";
import { GoogleCalendarEventsRepository } from "./repositories/google-calendar-events.repository";
import { OutlookCalendarEventsRepository } from "./repositories/outlook-calendar-events.repository";
import { MediationSessionRepository } from "./repositories/mediation-session.repository";
import { MediationSessionProposalRepository } from "./repositories/mediation-session-proposal.repository";
import { PartyRequiredFormRepository } from "./repositories/party-required-form.repository";
import { CimConsentRepository } from "./repositories/cim-consent.repository";
import { MediationSessionAvailabilityRepository } from "./repositories/mediation-session-availability.repository";
import { FinancialDisclosureRepository } from "./repositories/financial-disclosure.repository";
import { CourtFormRepository } from "./repositories/court-form.repository";
import { CaseProofingRepository } from "./repositories/case-proofing.repository";
import { CaseDocumentRequestRepository } from "./repositories/case-document-request.repository";
import type { DocumentRequestLifecycleEvent, DocumentRequestLifecycleEventDraft } from "./repositories/case-document-request.repository";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  listUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<Pick<User,
    | "name" | "email" | "password" | "role" | "status"
    | "resetToken" | "resetExpiresAt" | "zoomLink"
    | "onboardingToken" | "onboardingTokenExpiresAt"
    | "googleAccessToken" | "googleRefreshToken"
    | "googleCalendarConnected" | "googleCalendarEmail" | "googleTokenExpiresAt"
    | "googleScopeGranted"
    | "lastCalendarSyncAt" | "lastCalendarSyncError"
    | "outlookAccessToken" | "outlookRefreshToken"
    | "outlookCalendarConnected" | "outlookCalendarEmail" | "outlookTokenExpiresAt"
    | "outlookScopeGranted"
    | "lastOutlookSyncAt" | "lastOutlookSyncError"
    | "activeCalendarProvider"
    | "availabilityColor"
    | "contractorType"
    | "lastLoginAt"
  >>): Promise<User | undefined>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  getUserByOnboardingToken(token: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;

  listEnquiries(params: PaginationParams): Promise<PaginatedResponse<Enquiry & {
    convertedCaseRef: string | null;
    caseConfidential: boolean;
    claimedByName: string | null;
    nextFollowUpLabel: string | null;
    nextFollowUpDueAt: Date | null;
    nextFollowUpState: "upcoming" | "due_today" | "overdue" | "none";
    nextFollowUpTitle: string | null;
  }>>;
  getEnquiry(id: string): Promise<(Enquiry & { convertedCaseRef: string | null; caseConfidential: boolean; claimedByName: string | null }) | undefined>;
  createEnquiry(enquiry: InsertEnquiry & { enquiryRef: string }): Promise<Enquiry>;
  updateEnquiry(id: string, data: UpdateEnquiryData): Promise<Enquiry | undefined>;
  updateEnquiryStatus(id: string, status: string, convertedCaseId?: string): Promise<Enquiry | undefined>;
  updateEnquiryShuttle(id: string, shuttleMediation: boolean): Promise<Enquiry | undefined>;
  hardDeleteEnquiry(id: string): Promise<boolean>;
  getNextEnquiryRef(): Promise<string>;

  getNextCaseRef(): Promise<string>;
  listCases(): Promise<Case[]>;
  listCasesFiltered(opts: ListCasesOptions): Promise<ListCasesResult>;
  getCase(id: string): Promise<Case | undefined>;
  createCase(c: InsertCase): Promise<Case>;
  updateCaseStage(id: string, stage: string): Promise<Case | undefined>;
  updateCaseShuttle(id: string, shuttleMediation: boolean): Promise<Case | undefined>;
  updateCaseConfidential(id: string, confidential: boolean): Promise<Case | undefined>;
  updateCaseCimEligibility(id: string, data: { cimEligible: boolean; markedBy?: string | null }): Promise<Case | undefined>;
  updateCaseNotes(id: string, notes: string): Promise<Case | undefined>;
  updateCaseReferral(id: string, data: { referralPartnerName?: string | null; referralPartnerCode?: string | null }): Promise<Case | undefined>;
  updateCaseClosureDetails(id: string, closureDetails: string): Promise<Case | undefined>;
  updateCaseMediator(id: string, mediatorId: string | null): Promise<Case | undefined>;
  updateCaseType(id: string, data: { mediationCategory: string; subType: string }): Promise<Case | undefined>;
  updateCaseManualRevenue(id: string, data: { manualRevenuePence: number | null; updatedBy: string }): Promise<Case | undefined>;
  getCaseClosureRecord(caseId: string): Promise<CaseClosureRecord | undefined>;
  listCaseClosurePartyFollowUps(caseId: string): Promise<CaseClosurePartyFollowUp[]>;
  getCaseFollowUpConsentByTokenHash(tokenHash: string): Promise<CaseFollowUpConsentContext | undefined>;
  upsertCaseFollowUpConsentRequest(data: Parameters<CaseRepository["upsertCaseFollowUpConsentRequest"]>[0]): Promise<CaseClosurePartyFollowUp>;
  recordCaseFollowUpConsentGranted(
    id: string,
    scheduledTaskCount: number,
    tokenClearFields?: {
      followUpConsentTokenHash: null;
      followUpConsentTokenExpiresAt: null;
    },
  ): Promise<CaseClosurePartyFollowUp | undefined>;
  updateCaseClosure(id: string, data: Omit<CaseClosurePayload, "partyFollowUpConsents"> & { closedById: string | null; partyFollowUpConsents?: CaseClosurePartyFollowUpInput[] }): Promise<Case | undefined>;
  updateCaseStatus(id: string, status: string): Promise<Case | undefined>;
  updateCaseMediatorRepVisibility(id: string, mediatorCanSeeReps: boolean): Promise<Case | undefined>;
  updateCaseFilterCache(id: string, data: Parameters<CaseRepository["updateFilterCache"]>[1]): Promise<void>;
  hardDeleteCase(id: string): Promise<HardDeleteCaseCounts>;

  listCaseFilterPresets(userId: string): Promise<CaseFilterPreset[]>;
  getDefaultCaseFilterPreset(userId: string): Promise<CaseFilterPreset | undefined>;
  getCaseFilterPreset(id: string, userId: string): Promise<CaseFilterPreset | undefined>;
  createCaseFilterPreset(userId: string, name: string, filters: CaseFilters, isDefault: boolean): Promise<CaseFilterPreset>;
  updateCaseFilterPreset(id: string, userId: string, data: { name?: string; filters?: CaseFilters; isDefault?: boolean }): Promise<CaseFilterPreset | undefined>;
  deleteCaseFilterPreset(id: string, userId: string): Promise<boolean>;

  listConfidentialNotes(caseId: string): Promise<ConfidentialNote[]>;
  getConfidentialNote(id: string): Promise<ConfidentialNote | undefined>;
  createConfidentialNote(data: InsertConfidentialNote): Promise<ConfidentialNote>;
  deleteConfidentialNote(id: string): Promise<boolean>;

  getClient(id: string): Promise<Client | undefined>;
  getClientByUserId(userId: string): Promise<Client | undefined>;
  findClientByEmail(email: string): Promise<Client | undefined>;
  findClientByNameDob(firstName: string, lastName: string, dateOfBirth: string): Promise<Client | undefined>;
  findStrongClientMatch(data: { firstName: string; lastName: string; email?: string | null; phone?: string | null; dateOfBirth?: string | null }): Promise<Client | undefined>;
  findPotentialClientMatches(data: { firstName: string; lastName: string; email?: string | null; phone?: string | null; dateOfBirth?: string | null }): Promise<Client[]>;
  createClient(data: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<Omit<Client, "id" | "createdAt">>): Promise<Client | undefined>;
  deleteClient(id: string): Promise<boolean>;
  listAllClients(): Promise<Client[]>;
  hasLegacyClientHistory(clientId: string): Promise<boolean>;
  listClientsPaginated(params: PaginationParams): Promise<{ rows: ClientRow[]; total: number; counts: Record<string, number> }>;
  getCaseLinksForClients(clientIds: string[]): Promise<CaseLinkRow[]>;

  getParty(id: string): Promise<Party | undefined>;
  getPartyByInviteToken(token: string): Promise<Party | undefined>;
  getPartyByBookingToken(token: string): Promise<Party | undefined>;
  listPartiesByCase(caseId: string): Promise<Party[]>;
  createParty(party: InsertParty): Promise<Party>;
  updateParty(id: string, data: Partial<Omit<PartyLink, "id" | "caseId" | "clientId">>): Promise<Party | undefined>;
  listPartiesByUserId(userId: string): Promise<Party[]>;
  listPartiesByClientId(clientId: string): Promise<Party[]>;
  listAllParties(): Promise<Party[]>;

  listPermissions(): Promise<Permission[]>;
  upsertPermissions(entries: { role: string; section: string; canView: boolean; canEdit: boolean }[]): Promise<void>;

  listServiceTypes(): Promise<ServiceType[]>;
  getServiceType(id: string): Promise<ServiceType | undefined>;
  createServiceType(data: InsertServiceType): Promise<ServiceType>;
  updateServiceType(id: string, data: Partial<Omit<ServiceType, "id" | "createdAt">>): Promise<ServiceType | undefined>;
  listMediatorServices(mediatorId: string): Promise<MediatorServiceType[]>;
  setMediatorServices(mediatorId: string, services: MediatorServiceAssignmentInput[]): Promise<void>;
  listAllMediatorServices(): Promise<MediatorServiceType[]>;

  listAvailabilityByMediator(mediatorId: string): Promise<MediatorAvailability[]>;
  listActiveAvailability(): Promise<MediatorAvailability[]>;
  listActiveAvailabilityByMediator(mediatorId: string): Promise<MediatorAvailability[]>;
  bulkReplaceAvailability(mediatorId: string, slots: Omit<InsertMediatorAvailability, "mediatorId">[]): Promise<MediatorAvailability[]>;

  getAppointment(id: string): Promise<Appointment | undefined>;
  getAppointmentByBookingToken(token: string): Promise<Appointment | undefined>;
  getActiveAppointmentByPartyAndBookingToken(partyId: string, token: string): Promise<Appointment | undefined>;
  listAppointmentsByCase(caseId: string): Promise<Appointment[]>;
  listAppointmentsByMediator(mediatorId: string): Promise<Appointment[]>;
  listAppointmentsByMediatorAndDateRange(mediatorId: string, start: Date, end: Date): Promise<Appointment[]>;
  listAppointmentsByDateRange(start: Date, end: Date): Promise<Appointment[]>;
  listAppointmentsByPartyIds(partyIds: string[]): Promise<Appointment[]>;
  listAppointmentsByMediatorDateRange(mediatorId: string, start: Date, end: Date): Promise<Appointment[]>;
  listAppointmentsByPartyIdsDateRange(partyIds: string[], start: Date, end: Date): Promise<Appointment[]>;
  listAppointmentsByCaseIdsDateRange(caseIds: string[], start: Date, end: Date): Promise<Appointment[]>;
  createAppointment(data: InsertAppointment): Promise<Appointment>;
  updateAppointment(id: string, data: Partial<Omit<Appointment, "id" | "createdAt">>): Promise<Appointment | undefined>;
  deleteAppointment(id: string): Promise<boolean>;
  expireHeldAppointments(): Promise<Appointment[]>;
  findHeldAppointmentsToExpire(): Promise<Appointment[]>;
  findHeldAppointmentsNeedingPaymentAlert(now: Date): Promise<Appointment[]>;
  findExpiredMediationSessionHolds(now: Date): Promise<Appointment[]>;
  createAppointmentStatusHistory(data: InsertAppointmentStatusHistory): Promise<AppointmentStatusHistory>;
  listAppointmentStatusHistoryByAppointment(appointmentId: string): Promise<AppointmentStatusHistory[]>;
  listAppointmentStatusHistoryByCase(caseId: string): Promise<AppointmentStatusHistory[]>;
  listAppointmentStatusHistoryByAppointments(appointmentIds: string[]): Promise<AppointmentStatusHistory[]>;
  listAppointmentStatusHistoryByMediationSession(mediationSessionId: string): Promise<AppointmentStatusHistory[]>;

  getDemographicDataByParty(partyId: string): Promise<DemographicData | undefined>;
  getDemographicDataByCase(caseId: string): Promise<DemographicData[]>;
  upsertDemographicData(partyId: string, caseId: string, data: Partial<Omit<DemographicData, "id" | "partyId" | "caseId" | "createdAt">>): Promise<DemographicData>;
  getPartyByMiamFormToken(token: string): Promise<Party | undefined>;

  createCaseActivity(data: InsertCaseActivity): Promise<CaseActivity>;
  listCaseActivities(caseId: string, limit?: number, offset?: number): Promise<{ data: CaseActivity[]; total: number }>;

  listMediationSessionsByCase(caseId: string): Promise<MediationSession[]>;
  getMediationSession(id: string): Promise<MediationSession | undefined>;
  getLatestMediationSessionByCase(caseId: string): Promise<MediationSession | undefined>;
  createMediationSession(data: InsertMediationSession): Promise<MediationSession>;
  updateMediationSession(id: string, data: Partial<Omit<MediationSession, "id" | "createdAt">>): Promise<MediationSession | undefined>;
  listMediationSessionParticipants(sessionId: string): Promise<MediationSessionParticipant[]>;
  listMediationSessionParticipantsBySessionIds(sessionIds: string[]): Promise<MediationSessionParticipant[]>;
  listMediationSessionParticipantsByUser(userId: string): Promise<MediationSessionParticipant[]>;
  upsertMediationSessionParticipant(data: InsertMediationSessionParticipant): Promise<MediationSessionParticipant>;
  updateMediationSessionParticipant(id: string, data: Partial<Omit<MediationSessionParticipant, "id" | "addedAt">>): Promise<MediationSessionParticipant | undefined>;
  deleteMediationSessionParticipant(sessionId: string, userId: string, role: string): Promise<boolean>;
  replaceMediationSessionParticipants(sessionId: string, rows: InsertMediationSessionParticipant[]): Promise<MediationSessionParticipant[]>;
  listMediationSessionPartyAttendanceBySessionIds(sessionIds: string[]): Promise<MediationSessionPartyAttendance[]>;
  replaceMediationSessionPartyAttendance(sessionId: string, rows: InsertMediationSessionPartyAttendance[]): Promise<MediationSessionPartyAttendance[]>;
  listMediationSessionNotes(sessionId: string): Promise<MediationSessionNote[]>;
  listMediationSessionNotesBySessionIds(sessionIds: string[]): Promise<MediationSessionNote[]>;
  createMediationSessionNote(data: InsertMediationSessionNote): Promise<MediationSessionNote>;
  listCaseDocumentsByCase(caseId: string): Promise<CaseDocument[]>;
  listCaseDocumentsBySessionIds(sessionIds: string[]): Promise<CaseDocument[]>;
  getCaseDocument(id: string): Promise<CaseDocument | undefined>;
  createCaseDocument(data: InsertCaseDocument): Promise<CaseDocument>;
  createCaseDocumentOnce(id: string, data: InsertCaseDocument): Promise<CaseDocument>;
  updateCaseDocument(id: string, data: Partial<Omit<CaseDocument, "id" | "createdAt">>): Promise<CaseDocument | undefined>;
  createCaseDocumentRequest(data: InsertCaseDocumentRequest, event?: DocumentRequestLifecycleEventDraft): Promise<CaseDocumentRequest>;
  getCaseDocumentRequest(id: string): Promise<CaseDocumentRequest | undefined>;
  listCaseDocumentRequests(caseId: string): Promise<CaseDocumentRequest[]>;
  listCaseDocumentRequestsByPartyIds(partyIds: string[]): Promise<CaseDocumentRequest[]>;
  updateCaseDocumentRequest(id: string, data: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent): Promise<CaseDocumentRequest | undefined>;
  transitionCaseDocumentRequest(id: string, expectedStatuses: string[], data: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent): Promise<CaseDocumentRequest | undefined>;
  commitCaseDocumentRequestSubmission(id: string, requestData: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, documentData: InsertCaseDocument, event: DocumentRequestLifecycleEvent): Promise<{ request: CaseDocumentRequest; document: CaseDocument } | undefined>;
  listCaseDocumentsByRequestId(requestId: string): Promise<CaseDocument[]>;
  getFinancialDisclosureFolder(id: string): Promise<FinancialDisclosureFolder | undefined>;
  getFinancialDisclosureFolderByCaseAndParty(caseId: string, partyId: string): Promise<FinancialDisclosureFolder | undefined>;
  listFinancialDisclosureFoldersByCase(caseId: string): Promise<FinancialDisclosureFolder[]>;
  createFinancialDisclosureFolder(data: InsertFinancialDisclosureFolder): Promise<FinancialDisclosureFolder>;
  listFinancialDisclosureItems(folderId: string): Promise<FinancialDisclosureItem[]>;
  getFinancialDisclosureItem(id: string): Promise<FinancialDisclosureItem | undefined>;
  createFinancialDisclosureItem(data: InsertFinancialDisclosureItem): Promise<FinancialDisclosureItem>;
  updateFinancialDisclosureItem(id: string, data: { status?: FinancialDisclosureItemStatus; payload?: Record<string, unknown>; completedAt?: Date | null; completedBy?: string | null; updatedBy?: string | null }): Promise<FinancialDisclosureItem | undefined>;
  listFinancialDisclosureEvidenceCategories(folderId: string): Promise<FinancialDisclosureEvidenceCategory[]>;
  getFinancialDisclosureEvidenceCategory(id: string): Promise<FinancialDisclosureEvidenceCategory | undefined>;
  getFinancialDisclosureEvidenceCategoryByFolderAndKey(folderId: string, categoryKey: string): Promise<FinancialDisclosureEvidenceCategory | undefined>;
  createFinancialDisclosureEvidenceCategory(data: InsertFinancialDisclosureEvidenceCategory): Promise<FinancialDisclosureEvidenceCategory>;
  listFinancialDisclosureBookletTemplates(): Promise<FinancialDisclosureBookletTemplate[]>;
  getFinancialDisclosureBookletTemplate(id: string): Promise<FinancialDisclosureBookletTemplate | undefined>;
  getCurrentFinancialDisclosureBookletTemplate(): Promise<FinancialDisclosureBookletTemplate | undefined>;
  createFinancialDisclosureBookletTemplate(data: InsertFinancialDisclosureBookletTemplate): Promise<FinancialDisclosureBookletTemplate>;
  markFinancialDisclosureBookletTemplateCurrent(id: string, actorId: string): Promise<FinancialDisclosureBookletTemplate | undefined>;
  getCaseDraftFinancialSchedule(caseId: string): Promise<CaseDraftFinancialSchedule | undefined>;
  getMediationSessionDraftFinancialSchedule(sessionId: string): Promise<CaseDraftFinancialSchedule | undefined>;
  upsertCaseDraftFinancialSchedule(data: InsertCaseDraftFinancialSchedule): Promise<CaseDraftFinancialSchedule>;
  upsertMediationSessionDraftFinancialSchedule(data: InsertCaseDraftFinancialSchedule & { mediationSessionId: string }): Promise<CaseDraftFinancialSchedule>;
  listDraftScheduleVersions(scheduleId: string): Promise<CaseDraftFinancialScheduleVersion[]>;
  getNextDraftScheduleVersionNumber(scheduleId: string): Promise<number>;
  createCaseDraftFinancialScheduleVersion(data: InsertCaseDraftFinancialScheduleVersion): Promise<CaseDraftFinancialScheduleVersion>;
  listCaseProofingItems(caseId: string): Promise<CaseProofingItem[]>;
  getCaseProofingItem(id: string): Promise<CaseProofingItem | undefined>;
  getCaseProofingItemBySource(sourceEntityType: string, sourceEntityId: string, itemType: string): Promise<CaseProofingItem | undefined>;
  listCaseProofingItemCycles(proofingItemIds: string[]): Promise<CaseProofingItemCycle[]>;
  createNextCaseProofingItemCycle(proofingItemId: string, data: Omit<InsertCaseProofingItemCycle, "proofingItemId" | "cycleNumber">): Promise<CaseProofingItemCycle>;
  updateCurrentCaseProofingItemCycle(proofingItemId: string, data: Partial<Pick<CaseProofingItemCycle, "status" | "reviewedBy" | "reviewedAt" | "returnComments" | "returnedBy" | "returnedAt" | "withdrawnBy" | "withdrawnAt" | "withdrawReason">>): Promise<CaseProofingItemCycle | undefined>;
  upsertCaseProofingItem(data: InsertCaseProofingItem): Promise<CaseProofingItem>;
  updateCaseProofingItemStatus(id: string, data: Partial<Pick<CaseProofingItem, "status" | "reviewedBy" | "reviewedAt" | "returnComments" | "returnedBy" | "returnedAt" | "withdrawnBy" | "withdrawnAt" | "withdrawReason">>): Promise<CaseProofingItem | undefined>;
  createMediationSessionProposal(data: InsertMediationSessionProposal): Promise<MediationSessionProposal>;
  getMediationSessionProposal(id: string): Promise<MediationSessionProposal | undefined>;
  getMediationSessionProposalByAppointment(appointmentId: string): Promise<MediationSessionProposal | undefined>;
  listMediationSessionProposalsBySessions(sessionIds: string[]): Promise<MediationSessionProposal[]>;
  updateMediationSessionProposal(id: string, data: Partial<Omit<MediationSessionProposal, "id" | "createdAt">>): Promise<MediationSessionProposal | undefined>;
  createMediationSessionProposalRecipient(data: InsertMediationSessionProposalRecipient): Promise<MediationSessionProposalRecipient>;
  listMediationSessionProposalRecipientsByProposal(proposalId: string): Promise<MediationSessionProposalRecipient[]>;
  listMediationSessionProposalRecipientsBySessions(sessionIds: string[]): Promise<MediationSessionProposalRecipient[]>;
  getMediationSessionProposalRecipient(id: string): Promise<MediationSessionProposalRecipient | undefined>;
  getMediationSessionProposalRecipientByTokenHash(tokenHash: string): Promise<MediationSessionProposalRecipient | undefined>;
  updateMediationSessionProposalRecipient(id: string, data: Partial<Omit<MediationSessionProposalRecipient, "id" | "createdAt">>): Promise<MediationSessionProposalRecipient | undefined>;
  updateMediationSessionProposalRecipientResponse(id: string, responseStatus: MediationSessionProposalResponseStatus, declineNotes?: string | null): Promise<MediationSessionProposalRecipient | undefined>;
  markMediationSessionProposalRecipientViewed(id: string): Promise<MediationSessionProposalRecipient | undefined>;
  hasMediationSessionProposalDeclines(proposalId: string): Promise<boolean>;
  getPartyRequiredForm(id: string): Promise<PartyRequiredForm | undefined>;
  listPartyRequiredFormsByCase(caseId: string): Promise<PartyRequiredForm[]>;
  listPartyRequiredFormsBySession(sessionId: string): Promise<PartyRequiredForm[]>;
  listPartyRequiredFormsByAppointment(appointmentId: string): Promise<PartyRequiredForm[]>;
  listPartyRequiredFormsByPartyIds(partyIds: string[]): Promise<PartyRequiredForm[]>;
  upsertPartyRequiredForm(data: InsertPartyRequiredForm): Promise<PartyRequiredForm>;
  updatePartyRequiredForm(id: string, data: Partial<Omit<PartyRequiredForm, "id" | "createdAt">>): Promise<PartyRequiredForm | undefined>;
  updatePartyRequiredFormStatus(id: string, status: PartyRequiredFormStatus, patch?: Partial<Pick<PartyRequiredForm, "viewedAt" | "signedAt" | "signedBy" | "signerName" | "signatureIpAddress" | "attestationText" | "attestationVersion" | "confirmationTickedAt" | "signatureSource" | "uploadedDocumentId" | "uploadNotes" | "withdrawnAt" | "withdrawnBy" | "generatedDocumentId">>): Promise<PartyRequiredForm | undefined>;
  updatePartyRequiredFormsAppointmentForSession(sessionId: string, appointmentId: string): Promise<PartyRequiredForm[]>;
  findPartyRequiredFormBySessionPartyType(sessionId: string, partyId: string, formType: PartyRequiredFormType): Promise<PartyRequiredForm | undefined>;
  findPartyRequiredFormByCasePartyType(caseId: string, partyId: string, formType: PartyRequiredFormType): Promise<PartyRequiredForm | undefined>;
  listCaseCimConsents(caseId: string): Promise<CaseCimConsent[]>;
  upsertCaseCimConsent(data: InsertCaseCimConsent): Promise<CaseCimConsent>;
  listCourtFormTemplates(): Promise<CourtFormTemplate[]>;
  getCourtFormTemplate(id: string): Promise<CourtFormTemplate | undefined>;
  getCurrentCourtFormTemplate(formType: CourtFormType): Promise<CourtFormTemplate | undefined>;
  createCourtFormTemplate(data: InsertCourtFormTemplate): Promise<CourtFormTemplate>;
  updateCourtFormTemplate(id: string, data: Partial<Omit<CourtFormTemplate, "id" | "uploadedAt">>): Promise<CourtFormTemplate | undefined>;
  updateCourtFormTemplateMappingIfUnchanged(id: string, expectedMapping: unknown, fieldMapping: unknown): Promise<CourtFormTemplate | undefined>;
  markCourtFormTemplateCurrent(id: string, formType: CourtFormType, verifiedBy?: string | null, verifiedCurrentAt?: Date | null): Promise<CourtFormTemplate | undefined>;
  deleteCourtFormTemplate(id: string, deletedBy: string): Promise<CourtFormTemplate | undefined>;
  listCourtFormGuidance(formType?: CourtFormType, templateId?: string | null): Promise<CourtFormGuidance[]>;
  createCourtFormGuidance(data: InsertCourtFormGuidance): Promise<CourtFormGuidance>;
  updateCourtFormGuidance(id: string, data: Partial<Omit<CourtFormGuidance, "id" | "createdAt">>): Promise<CourtFormGuidance | undefined>;
  getCourtFormDraft(caseId: string, partyId: string, formType: CourtFormType): Promise<CourtFormDraft | undefined>;
  upsertCourtFormDraft(data: InsertCourtFormDraft): Promise<CourtFormDraft>;
  listCourtFormGenerationsByCase(caseId: string): Promise<CourtFormGeneration[]>;
  getCourtFormGeneration(id: string): Promise<CourtFormGeneration | undefined>;
  createCourtFormGeneration(data: InsertCourtFormGeneration): Promise<CourtFormGeneration>;
  updateCourtFormGeneration(id: string, data: Partial<Omit<CourtFormGeneration, "id" | "generatedAt">>): Promise<CourtFormGeneration | undefined>;
  listMediationSessionAvailabilityWindows(sessionId: string): Promise<MediationSessionAvailabilityWindow[]>;
  listMediationSessionAvailabilityWindowsBySessions(sessionIds: string[]): Promise<MediationSessionAvailabilityWindow[]>;
  replaceMediationSessionAvailabilityForParty(sessionId: string, partyId: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]>;
  replaceMediationSessionAvailabilityForProposalRecipient(proposalRecipientId: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]>;
  replaceMediationSessionAvailabilityForRescheduleRequest(sessionId: string, submittedBy: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]>;
  replaceMediationSessionAvailabilityForNextSessionRequest(sessionId: string, submittedBy: string, rows: InsertMediationSessionAvailabilityWindow[]): Promise<MediationSessionAvailabilityWindow[]>;

  getMiamRecord(partyId: string, caseId: string): Promise<MiamRecord | undefined>;
  getCurrentMiamRecord(partyId: string, caseId: string): Promise<MiamRecord | undefined>;
  getMiamRecordById(id: string): Promise<MiamRecord | undefined>;
  listMiamRecordsByCase(caseId: string): Promise<MiamRecord[]>;
  listMiamRecordHistoryByPartyAndCase(partyId: string, caseId: string): Promise<MiamRecord[]>;
  upsertMiamRecord(partyId: string, caseId: string, data: Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt">>): Promise<MiamRecord>;
  createRenewalMiamRecord(partyId: string, caseId: string, data: Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt" | "updatedAt">>): Promise<MiamRecord>;
  supersedeCurrentMiamRecordForPartyAndCase(partyId: string, caseId: string): Promise<MiamRecord | undefined>;
  updateMiamApprovalStatus(id: string, updates: { approvalStatus: string; submittedBy?: string | null; submittedAt?: Date | null; reviewedBy?: string | null; reviewedAt?: Date | null; reviewNotes?: string | null }): Promise<MiamRecord | undefined>;
  setPendingPartyOnMiamRecord(id: string, data: { pendingPartyUserId?: string | null; pendingPartyFirstName?: string | null; pendingPartyLastName?: string | null; pendingPartyEmail?: string | null }): Promise<MiamRecord | undefined>;
  claimAndClearPendingPartyOnMiamRecord(id: string): Promise<{ pendingPartyUserId: string | null; pendingPartyFirstName: string | null; pendingPartyLastName: string | null; pendingPartyEmail: string | null } | null>;
  getMiamEditRequestById(id: string): Promise<MiamEditRequest | undefined>;
  getPendingMiamEditRequest(miamRecordId: string): Promise<MiamEditRequest | undefined>;
  getLatestMiamEditRequest(miamRecordId: string): Promise<MiamEditRequest | undefined>;
  createMiamEditRequest(data: { miamRecordId: string; caseId: string; requestedBy: string; proposedChanges: Record<string, unknown>; originalValues: Record<string, unknown>; requestNote?: string }): Promise<MiamEditRequest>;
  updateMiamEditRequestStatus(id: string, updates: { status: string; reviewedBy?: string | null; reviewedAt?: Date | null; reviewNotes?: string | null }): Promise<MiamEditRequest | undefined>;
  cancelPendingMiamEditRequests(miamRecordId: string): Promise<void>;

  upsertGoogleCalendarEvents(events: InsertGoogleCalendarEvent[]): Promise<void>;
  listGoogleCalendarEventsByDateRange(mediatorId: string, start: Date, end: Date): Promise<GoogleCalendarEvent[]>;
  deleteGoogleCalendarEventsByMediator(mediatorId: string): Promise<void>;
  deleteStaleGoogleCalendarEventsInRange(mediatorId: string, keepIds: string[], windowStart: Date, windowEnd: Date): Promise<void>;
  upsertOutlookCalendarEvents(events: InsertOutlookCalendarEvent[]): Promise<void>;
  listOutlookCalendarEventsByDateRange(mediatorId: string, start: Date, end: Date): Promise<OutlookCalendarEvent[]>;
  deleteOutlookCalendarEventsByMediator(mediatorId: string): Promise<void>;
  deleteStaleOutlookCalendarEventsInRange(mediatorId: string, keepIds: string[], windowStart: Date, windowEnd: Date): Promise<void>;
}

class DatabaseStorage implements IStorage {
  private userRepo = new UserRepository();
  private enquiryRepo = new EnquiryRepository();
  private caseRepo = new CaseRepository();
  private partyRepo = new PartyRepository();
  private clientRepo = new ClientRepository();
  private permissionRepo = new PermissionRepository();
  private confNoteRepo = new ConfidentialNoteRepository();

  getUser(id: string) { return this.userRepo.getUser(id); }
  getUserByEmail(email: string) { return this.userRepo.getUserByEmail(email); }
  createUser(user: InsertUser) { return this.userRepo.createUser(user); }
  listUsers() { return this.userRepo.listUsers(); }
  updateUser(id: string, data: Parameters<UserRepository["updateUser"]>[1]) { return this.userRepo.updateUser(id, data); }
  getUserByResetToken(token: string) { return this.userRepo.getUserByResetToken(token); }
  getUserByOnboardingToken(token: string) { return this.userRepo.getUserByOnboardingToken(token); }
  deleteUser(id: string) { return this.userRepo.deleteUser(id); }

  listEnquiries(params: PaginationParams) { return this.enquiryRepo.listEnquiries(params); }
  getEnquiry(id: string) { return this.enquiryRepo.getEnquiry(id); }
  createEnquiry(enquiry: InsertEnquiry & { enquiryRef: string }) { return this.enquiryRepo.createEnquiry(enquiry); }
  updateEnquiry(id: string, data: UpdateEnquiryData) { return this.enquiryRepo.updateEnquiry(id, data); }
  updateEnquiryStatus(id: string, status: string, convertedCaseId?: string) { return this.enquiryRepo.updateEnquiryStatus(id, status, convertedCaseId); }
  updateEnquiryShuttle(id: string, shuttleMediation: boolean) { return this.enquiryRepo.updateEnquiryShuttle(id, shuttleMediation); }
  hardDeleteEnquiry(id: string) { return this.enquiryRepo.hardDeleteEnquiry(id); }
  getNextEnquiryRef() { return this.enquiryRepo.getNextEnquiryRef(); }

  getNextCaseRef() { return this.caseRepo.getNextCaseRef(); }
  listCases() { return this.caseRepo.listCases(); }
  listCasesFiltered(opts: ListCasesOptions) { return this.caseRepo.listCasesFiltered(opts); }
  updateCaseFilterCache(id: string, data: Parameters<CaseRepository["updateFilterCache"]>[1]) { return this.caseRepo.updateFilterCache(id, data); }
  getCase(id: string) { return this.caseRepo.getCase(id); }
  createCase(c: InsertCase) { return this.caseRepo.createCase(c); }
  updateCaseStage(id: string, stage: string) { return this.caseRepo.updateCaseStage(id, stage); }
  updateCaseShuttle(id: string, shuttleMediation: boolean) { return this.caseRepo.updateCaseShuttle(id, shuttleMediation); }
  updateCaseConfidential(id: string, confidential: boolean) { return this.caseRepo.updateCaseConfidential(id, confidential); }
  updateCaseCimEligibility(id: string, data: { cimEligible: boolean; markedBy?: string | null }) { return this.caseRepo.updateCaseCimEligibility(id, data); }
  updateCaseNotes(id: string, notes: string) { return this.caseRepo.updateCaseNotes(id, notes); }
  updateCaseReferral(id: string, data: { referralPartnerName?: string | null; referralPartnerCode?: string | null }) { return this.caseRepo.updateCaseReferral(id, data); }
  updateCaseClosureDetails(id: string, closureDetails: string) { return this.caseRepo.updateCaseClosureDetails(id, closureDetails); }
  updateCaseMediator(id: string, mediatorId: string | null) { return this.caseRepo.updateCaseMediator(id, mediatorId); }
  updateCaseType(id: string, data: { mediationCategory: string; subType: string }) { return this.caseRepo.updateCaseType(id, data); }
  updateCaseManualRevenue(id: string, data: { manualRevenuePence: number | null; updatedBy: string }) { return this.caseRepo.updateCaseManualRevenue(id, data); }
  getCaseClosureRecord(caseId: string) { return this.caseRepo.getCaseClosureRecord(caseId); }
  listCaseClosurePartyFollowUps(caseId: string) { return this.caseRepo.listCaseClosurePartyFollowUps(caseId); }
  getCaseFollowUpConsentByTokenHash(tokenHash: string) { return this.caseRepo.getCaseFollowUpConsentByTokenHash(tokenHash); }
  upsertCaseFollowUpConsentRequest(data: Parameters<CaseRepository["upsertCaseFollowUpConsentRequest"]>[0]) { return this.caseRepo.upsertCaseFollowUpConsentRequest(data); }
  recordCaseFollowUpConsentGranted(
    id: string,
    scheduledTaskCount: number,
    tokenClearFields?: { followUpConsentTokenHash: null; followUpConsentTokenExpiresAt: null },
  ) {
    return this.caseRepo.recordCaseFollowUpConsentGranted(id, scheduledTaskCount, tokenClearFields);
  }
  updateCaseClosure(id: string, data: Omit<CaseClosurePayload, "partyFollowUpConsents"> & { closedById: string | null; partyFollowUpConsents?: CaseClosurePartyFollowUpInput[] }) { return this.caseRepo.updateCaseClosure(id, data); }
  updateCaseStatus(id: string, status: string) { return this.caseRepo.updateCaseStatus(id, status); }
  updateCaseMediatorRepVisibility(id: string, mediatorCanSeeReps: boolean) { return this.caseRepo.updateCaseMediatorRepVisibility(id, mediatorCanSeeReps); }
  hardDeleteCase(id: string) { return this.caseRepo.hardDeleteCase(id); }

  private caseFilterPresetRepo = new CaseFilterPresetRepository();
  listCaseFilterPresets(userId: string) { return this.caseFilterPresetRepo.listForUser(userId); }
  getDefaultCaseFilterPreset(userId: string) { return this.caseFilterPresetRepo.getDefaultForUser(userId); }
  getCaseFilterPreset(id: string, userId: string) { return this.caseFilterPresetRepo.getById(id, userId); }
  createCaseFilterPreset(userId: string, name: string, filters: CaseFilters, isDefault: boolean) { return this.caseFilterPresetRepo.create(userId, name, filters, isDefault); }
  updateCaseFilterPreset(id: string, userId: string, data: { name?: string; filters?: CaseFilters; isDefault?: boolean }) { return this.caseFilterPresetRepo.update(id, userId, data); }
  deleteCaseFilterPreset(id: string, userId: string) { return this.caseFilterPresetRepo.delete(id, userId); }

  listConfidentialNotes(caseId: string) { return this.confNoteRepo.listByCaseId(caseId); }
  getConfidentialNote(id: string) { return this.confNoteRepo.getById(id); }
  createConfidentialNote(data: InsertConfidentialNote) { return this.confNoteRepo.create(data); }
  deleteConfidentialNote(id: string) { return this.confNoteRepo.delete(id); }

  getClient(id: string) { return this.clientRepo.getClient(id); }
  getClientByUserId(userId: string) { return this.clientRepo.getClientByUserId(userId); }
  findClientByEmail(email: string) { return this.clientRepo.findByEmail(email); }
  findClientByNameDob(firstName: string, lastName: string, dateOfBirth: string) { return this.clientRepo.findByNameDob(firstName, lastName, dateOfBirth); }
  findStrongClientMatch(data: { firstName: string; lastName: string; email?: string | null; phone?: string | null; dateOfBirth?: string | null }) { return this.clientRepo.findStrongMatch(data); }
  findPotentialClientMatches(data: { firstName: string; lastName: string; email?: string | null; phone?: string | null; dateOfBirth?: string | null }) { return this.clientRepo.findPotentialMatches(data); }
  createClient(data: InsertClient) { return this.clientRepo.createClient(data); }
  updateClient(id: string, data: Partial<Omit<Client, "id" | "createdAt">>) { return this.clientRepo.updateClient(id, data); }
  deleteClient(id: string) { return this.clientRepo.deleteClient(id); }
  listAllClients() { return this.clientRepo.listAll(); }
  hasLegacyClientHistory(clientId: string) { return this.clientRepo.hasLegacyHistory(clientId); }
  listClientsPaginated(params: PaginationParams) { return this.clientRepo.listPaginated(params); }
  getCaseLinksForClients(clientIds: string[]) { return this.clientRepo.getCaseLinksForClients(clientIds); }

  getParty(id: string) { return this.partyRepo.getParty(id); }
  getPartyByInviteToken(token: string) { return this.partyRepo.getPartyByInviteToken(token); }
  getPartyByBookingToken(token: string) { return this.partyRepo.getPartyByBookingToken(token); }
  listPartiesByCase(caseId: string) { return this.partyRepo.listPartiesByCase(caseId); }
  createParty(party: InsertParty) { return this.partyRepo.createParty(party); }
  updateParty(id: string, data: Partial<Omit<PartyLink, "id" | "caseId" | "clientId">>) { return this.partyRepo.updateParty(id, data); }
  listPartiesByUserId(userId: string) { return this.partyRepo.listPartiesByUserId(userId); }
  listPartiesByClientId(clientId: string) { return this.partyRepo.listPartiesByClientId(clientId); }
  listAllParties() { return this.partyRepo.listAllParties(); }

  listPermissions() { return this.permissionRepo.listPermissions(); }
  upsertPermissions(entries: { role: string; section: string; canView: boolean; canEdit: boolean }[]) { return this.permissionRepo.upsertPermissions(entries); }

  private serviceTypeRepo = new ServiceTypeRepository();
  listServiceTypes() { return this.serviceTypeRepo.list(); }
  getServiceType(id: string) { return this.serviceTypeRepo.getById(id); }
  createServiceType(data: InsertServiceType) { return this.serviceTypeRepo.create(data); }
  updateServiceType(id: string, data: Partial<Omit<ServiceType, "id" | "createdAt">>) { return this.serviceTypeRepo.update(id, data); }
  listMediatorServices(mediatorId: string) { return this.serviceTypeRepo.listMediatorServices(mediatorId); }
  setMediatorServices(mediatorId: string, services: MediatorServiceAssignmentInput[]) { return this.serviceTypeRepo.setMediatorServices(mediatorId, services); }
  listAllMediatorServices() { return this.serviceTypeRepo.listAllMediatorServices(); }

  private availabilityRepo = new AvailabilityRepository();
  listAvailabilityByMediator(mediatorId: string) { return this.availabilityRepo.listByMediator(mediatorId); }
  listActiveAvailability() { return this.availabilityRepo.listActive(); }
  listActiveAvailabilityByMediator(mediatorId: string) { return this.availabilityRepo.listActiveByMediator(mediatorId); }
  bulkReplaceAvailability(mediatorId: string, slots: Omit<InsertMediatorAvailability, "mediatorId">[]) { return this.availabilityRepo.bulkReplace(mediatorId, slots); }

  private demographicDataRepo = new DemographicDataRepository();
  getDemographicDataByParty(partyId: string) { return this.demographicDataRepo.getByPartyId(partyId); }
  getDemographicDataByCase(caseId: string) { return this.demographicDataRepo.getByCaseId(caseId); }
  upsertDemographicData(partyId: string, caseId: string, data: Partial<Omit<DemographicData, "id" | "partyId" | "caseId" | "createdAt">>) { return this.demographicDataRepo.upsert(partyId, caseId, data); }
  getPartyByMiamFormToken(token: string) { return this.partyRepo.getPartyByMiamFormToken(token); }

  private appointmentRepo = new AppointmentRepository();
  getAppointment(id: string) { return this.appointmentRepo.getById(id); }
  getAppointmentByBookingToken(token: string) { return this.appointmentRepo.getByBookingToken(token); }
  getActiveAppointmentByPartyAndBookingToken(partyId: string, token: string) { return this.appointmentRepo.getActiveByPartyAndBookingToken(partyId, token); }
  listAppointmentsByCase(caseId: string) { return this.appointmentRepo.listByCase(caseId); }
  listAppointmentsByMediator(mediatorId: string) { return this.appointmentRepo.listByMediator(mediatorId); }
  listAppointmentsByMediatorAndDateRange(mediatorId: string, start: Date, end: Date) { return this.appointmentRepo.listByMediatorAndDateRange(mediatorId, start, end); }
  listAppointmentsByDateRange(start: Date, end: Date) { return this.appointmentRepo.listByDateRange(start, end); }
  listAppointmentsByPartyIds(partyIds: string[]) { return this.appointmentRepo.listByPartyIds(partyIds); }
  listAppointmentsByMediatorDateRange(mediatorId: string, start: Date, end: Date) { return this.appointmentRepo.listByMediatorDateRange(mediatorId, start, end); }
  listAppointmentsByPartyIdsDateRange(partyIds: string[], start: Date, end: Date) { return this.appointmentRepo.listByPartyIdsDateRange(partyIds, start, end); }
  listAppointmentsByCaseIdsDateRange(caseIds: string[], start: Date, end: Date) { return this.appointmentRepo.listByCaseIdsDateRange(caseIds, start, end); }
  createAppointment(data: InsertAppointment) { return this.appointmentRepo.create(data); }
  updateAppointment(id: string, data: Partial<Omit<Appointment, "id" | "createdAt">>) { return this.appointmentRepo.update(id, data); }
  deleteAppointment(id: string) { return this.appointmentRepo.delete(id); }
  expireHeldAppointments() { return this.appointmentRepo.expireHeldAppointments(); }
  findHeldAppointmentsToExpire() { return this.appointmentRepo.findHeldAppointmentsToExpire(); }
  findHeldAppointmentsNeedingPaymentAlert(now: Date) { return this.appointmentRepo.findHeldAppointmentsNeedingPaymentAlert(now); }
  findExpiredMediationSessionHolds(now: Date) { return this.appointmentRepo.findExpiredMediationSessionHolds(now); }

  private appointmentStatusHistoryRepo = new AppointmentStatusHistoryRepository();
  createAppointmentStatusHistory(data: InsertAppointmentStatusHistory) { return this.appointmentStatusHistoryRepo.create(data); }
  listAppointmentStatusHistoryByAppointment(appointmentId: string) { return this.appointmentStatusHistoryRepo.listByAppointment(appointmentId); }
  listAppointmentStatusHistoryByCase(caseId: string) { return this.appointmentStatusHistoryRepo.listByCase(caseId); }
  listAppointmentStatusHistoryByAppointments(appointmentIds: string[]) { return this.appointmentStatusHistoryRepo.listByAppointments(appointmentIds); }
  listAppointmentStatusHistoryByMediationSession(mediationSessionId: string) { return this.appointmentStatusHistoryRepo.listByMediationSession(mediationSessionId); }

  private caseActivityRepo = new CaseActivityRepository();
  createCaseActivity(data: InsertCaseActivity) { return this.caseActivityRepo.create(data); }
  listCaseActivities(caseId: string, limit?: number, offset?: number) { return this.caseActivityRepo.listByCase(caseId, limit, offset); }

  private mediationSessionRepo = new MediationSessionRepository();
  listMediationSessionsByCase(caseId: string) { return this.mediationSessionRepo.listByCase(caseId); }
  getMediationSession(id: string) { return this.mediationSessionRepo.getById(id); }
  getLatestMediationSessionByCase(caseId: string) { return this.mediationSessionRepo.getLatestByCase(caseId); }
  createMediationSession(data: InsertMediationSession) { return this.mediationSessionRepo.create(data); }
  updateMediationSession(id: string, data: Partial<Omit<MediationSession, "id" | "createdAt">>) { return this.mediationSessionRepo.update(id, data); }
  listMediationSessionParticipants(sessionId: string) { return this.mediationSessionRepo.listParticipants(sessionId); }
  listMediationSessionParticipantsBySessionIds(sessionIds: string[]) { return this.mediationSessionRepo.listParticipantsBySessionIds(sessionIds); }
  listMediationSessionParticipantsByUser(userId: string) { return this.mediationSessionRepo.listParticipantsByUser(userId); }
  upsertMediationSessionParticipant(data: InsertMediationSessionParticipant) { return this.mediationSessionRepo.upsertParticipant(data); }
  updateMediationSessionParticipant(id: string, data: Partial<Omit<MediationSessionParticipant, "id" | "addedAt">>) { return this.mediationSessionRepo.updateParticipant(id, data); }
  deleteMediationSessionParticipant(sessionId: string, userId: string, role: string) { return this.mediationSessionRepo.deleteParticipant(sessionId, userId, role); }
  replaceMediationSessionParticipants(sessionId: string, rows: InsertMediationSessionParticipant[]) { return this.mediationSessionRepo.replaceParticipants(sessionId, rows); }
  listMediationSessionPartyAttendanceBySessionIds(sessionIds: string[]) { return this.mediationSessionRepo.listPartyAttendanceBySessionIds(sessionIds); }
  replaceMediationSessionPartyAttendance(sessionId: string, rows: InsertMediationSessionPartyAttendance[]) { return this.mediationSessionRepo.replacePartyAttendance(sessionId, rows); }
  listMediationSessionNotes(sessionId: string) { return this.mediationSessionRepo.listNotes(sessionId); }
  listMediationSessionNotesBySessionIds(sessionIds: string[]) { return this.mediationSessionRepo.listNotesBySessionIds(sessionIds); }
  createMediationSessionNote(data: InsertMediationSessionNote) { return this.mediationSessionRepo.createNote(data); }
  listCaseDocumentsByCase(caseId: string) { return this.mediationSessionRepo.listCaseDocuments(caseId); }
  listCaseDocumentsBySessionIds(sessionIds: string[]) { return this.mediationSessionRepo.listCaseDocumentsBySessionIds(sessionIds); }
  getCaseDocument(id: string) { return this.mediationSessionRepo.getCaseDocument(id); }
  createCaseDocument(data: InsertCaseDocument) { return this.mediationSessionRepo.createCaseDocument(data); }
  createCaseDocumentOnce(id: string, data: InsertCaseDocument) { return this.mediationSessionRepo.createCaseDocumentOnce(id, data); }
  updateCaseDocument(id: string, data: Partial<Omit<CaseDocument, "id" | "createdAt">>) { return this.mediationSessionRepo.updateCaseDocument(id, data); }

  private caseDocumentRequestRepo = new CaseDocumentRequestRepository();
  createCaseDocumentRequest(data: InsertCaseDocumentRequest, event?: DocumentRequestLifecycleEventDraft) { return this.caseDocumentRequestRepo.create(data, event); }
  getCaseDocumentRequest(id: string) { return this.caseDocumentRequestRepo.getById(id); }
  listCaseDocumentRequests(caseId: string) { return this.caseDocumentRequestRepo.listByCase(caseId); }
  listCaseDocumentRequestsByPartyIds(partyIds: string[]) { return this.caseDocumentRequestRepo.listByPartyIds(partyIds); }
  updateCaseDocumentRequest(id: string, data: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent) { return this.caseDocumentRequestRepo.update(id, data, event); }
  transitionCaseDocumentRequest(id: string, expectedStatuses: string[], data: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent) { return this.caseDocumentRequestRepo.transition(id, expectedStatuses, data, event); }
  commitCaseDocumentRequestSubmission(id: string, requestData: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, documentData: InsertCaseDocument, event: DocumentRequestLifecycleEvent) { return this.caseDocumentRequestRepo.commitSubmission(id, requestData, documentData, event); }
  listCaseDocumentsByRequestId(requestId: string) { return this.caseDocumentRequestRepo.listDocuments(requestId); }

  private financialDisclosureRepo = new FinancialDisclosureRepository();
  getFinancialDisclosureFolder(id: string) { return this.financialDisclosureRepo.getFolder(id); }
  getFinancialDisclosureFolderByCaseAndParty(caseId: string, partyId: string) { return this.financialDisclosureRepo.getFolderByCaseAndParty(caseId, partyId); }
  listFinancialDisclosureFoldersByCase(caseId: string) { return this.financialDisclosureRepo.listFoldersByCase(caseId); }
  createFinancialDisclosureFolder(data: InsertFinancialDisclosureFolder) { return this.financialDisclosureRepo.createFolder(data); }
  listFinancialDisclosureItems(folderId: string) { return this.financialDisclosureRepo.listItems(folderId); }
  getFinancialDisclosureItem(id: string) { return this.financialDisclosureRepo.getItem(id); }
  createFinancialDisclosureItem(data: InsertFinancialDisclosureItem) { return this.financialDisclosureRepo.createItem(data); }
  updateFinancialDisclosureItem(id: string, data: { status?: FinancialDisclosureItemStatus; payload?: Record<string, unknown>; completedAt?: Date | null; completedBy?: string | null; updatedBy?: string | null }) { return this.financialDisclosureRepo.updateItem(id, data); }
  listFinancialDisclosureEvidenceCategories(folderId: string) { return this.financialDisclosureRepo.listEvidenceCategories(folderId); }
  getFinancialDisclosureEvidenceCategory(id: string) { return this.financialDisclosureRepo.getEvidenceCategory(id); }
  getFinancialDisclosureEvidenceCategoryByFolderAndKey(folderId: string, categoryKey: string) { return this.financialDisclosureRepo.getEvidenceCategoryByFolderAndKey(folderId, categoryKey); }
  createFinancialDisclosureEvidenceCategory(data: InsertFinancialDisclosureEvidenceCategory) { return this.financialDisclosureRepo.createEvidenceCategory(data); }
  listFinancialDisclosureBookletTemplates() { return this.financialDisclosureRepo.listBookletTemplates(); }
  getFinancialDisclosureBookletTemplate(id: string) { return this.financialDisclosureRepo.getBookletTemplate(id); }
  getCurrentFinancialDisclosureBookletTemplate() { return this.financialDisclosureRepo.getCurrentBookletTemplate(); }
  createFinancialDisclosureBookletTemplate(data: InsertFinancialDisclosureBookletTemplate) { return this.financialDisclosureRepo.createBookletTemplate(data); }
  markFinancialDisclosureBookletTemplateCurrent(id: string, actorId: string) { return this.financialDisclosureRepo.markBookletTemplateCurrent(id, actorId); }
  getCaseDraftFinancialSchedule(caseId: string) { return this.financialDisclosureRepo.getDraftScheduleByCase(caseId); }
  getMediationSessionDraftFinancialSchedule(sessionId: string) { return this.financialDisclosureRepo.getDraftScheduleBySession(sessionId); }
  upsertCaseDraftFinancialSchedule(data: InsertCaseDraftFinancialSchedule) { return this.financialDisclosureRepo.upsertDraftSchedule(data); }
  upsertMediationSessionDraftFinancialSchedule(data: InsertCaseDraftFinancialSchedule & { mediationSessionId: string }) { return this.financialDisclosureRepo.upsertDraftScheduleForSession(data); }
  listDraftScheduleVersions(scheduleId: string) { return this.financialDisclosureRepo.listDraftScheduleVersions(scheduleId); }
  getNextDraftScheduleVersionNumber(scheduleId: string) { return this.financialDisclosureRepo.getNextDraftScheduleVersionNumber(scheduleId); }
  createCaseDraftFinancialScheduleVersion(data: InsertCaseDraftFinancialScheduleVersion) { return this.financialDisclosureRepo.createDraftScheduleVersion(data); }

  private caseProofingRepo = new CaseProofingRepository();
  listCaseProofingItems(caseId: string) { return this.caseProofingRepo.listByCase(caseId); }
  getCaseProofingItem(id: string) { return this.caseProofingRepo.getById(id); }
  getCaseProofingItemBySource(sourceEntityType: string, sourceEntityId: string, itemType: string) { return this.caseProofingRepo.getBySource(sourceEntityType, sourceEntityId, itemType); }
  listCaseProofingItemCycles(proofingItemIds: string[]) { return this.caseProofingRepo.listCyclesByProofingItemIds(proofingItemIds); }
  createNextCaseProofingItemCycle(proofingItemId: string, data: Omit<InsertCaseProofingItemCycle, "proofingItemId" | "cycleNumber">) { return this.caseProofingRepo.createNextCycle(proofingItemId, data); }
  updateCurrentCaseProofingItemCycle(proofingItemId: string, data: Partial<Pick<CaseProofingItemCycle, "status" | "reviewedBy" | "reviewedAt" | "returnComments" | "returnedBy" | "returnedAt" | "withdrawnBy" | "withdrawnAt" | "withdrawReason">>) { return this.caseProofingRepo.updateCurrentCycle(proofingItemId, data); }
  upsertCaseProofingItem(data: InsertCaseProofingItem) { return this.caseProofingRepo.upsertForSource(data); }
  updateCaseProofingItemStatus(id: string, data: Partial<Pick<CaseProofingItem, "status" | "reviewedBy" | "reviewedAt" | "returnComments" | "returnedBy" | "returnedAt" | "withdrawnBy" | "withdrawnAt" | "withdrawReason">>) { return this.caseProofingRepo.updateStatus(id, data); }

  private mediationSessionProposalRepo = new MediationSessionProposalRepository();
  createMediationSessionProposal(data: InsertMediationSessionProposal) { return this.mediationSessionProposalRepo.create(data); }
  getMediationSessionProposal(id: string) { return this.mediationSessionProposalRepo.getById(id); }
  getMediationSessionProposalByAppointment(appointmentId: string) { return this.mediationSessionProposalRepo.getByAppointment(appointmentId); }
  listMediationSessionProposalsBySessions(sessionIds: string[]) { return this.mediationSessionProposalRepo.listBySessions(sessionIds); }
  updateMediationSessionProposal(id: string, data: Partial<Omit<MediationSessionProposal, "id" | "createdAt">>) { return this.mediationSessionProposalRepo.update(id, data); }
  createMediationSessionProposalRecipient(data: InsertMediationSessionProposalRecipient) { return this.mediationSessionProposalRepo.createRecipient(data); }
  listMediationSessionProposalRecipientsByProposal(proposalId: string) { return this.mediationSessionProposalRepo.listRecipientsByProposal(proposalId); }
  listMediationSessionProposalRecipientsBySessions(sessionIds: string[]) { return this.mediationSessionProposalRepo.listRecipientsBySessions(sessionIds); }
  getMediationSessionProposalRecipient(id: string) { return this.mediationSessionProposalRepo.getRecipientById(id); }
  getMediationSessionProposalRecipientByTokenHash(tokenHash: string) { return this.mediationSessionProposalRepo.getRecipientByTokenHash(tokenHash); }
  updateMediationSessionProposalRecipient(id: string, data: Partial<Omit<MediationSessionProposalRecipient, "id" | "createdAt">>) { return this.mediationSessionProposalRepo.updateRecipient(id, data); }
  updateMediationSessionProposalRecipientResponse(id: string, responseStatus: MediationSessionProposalResponseStatus, declineNotes?: string | null) { return this.mediationSessionProposalRepo.updateRecipientResponse(id, responseStatus, declineNotes); }
  markMediationSessionProposalRecipientViewed(id: string) { return this.mediationSessionProposalRepo.markRecipientViewed(id); }
  hasMediationSessionProposalDeclines(proposalId: string) { return this.mediationSessionProposalRepo.hasDeclines(proposalId); }

  private partyRequiredFormRepo = new PartyRequiredFormRepository();
  private cimConsentRepo = new CimConsentRepository();
  getPartyRequiredForm(id: string) { return this.partyRequiredFormRepo.getById(id); }
  listPartyRequiredFormsByCase(caseId: string) { return this.partyRequiredFormRepo.listByCase(caseId); }
  listPartyRequiredFormsBySession(sessionId: string) { return this.partyRequiredFormRepo.listBySession(sessionId); }
  listPartyRequiredFormsByAppointment(appointmentId: string) { return this.partyRequiredFormRepo.listByAppointment(appointmentId); }
  listPartyRequiredFormsByPartyIds(partyIds: string[]) { return this.partyRequiredFormRepo.listByPartyIds(partyIds); }
  upsertPartyRequiredForm(data: InsertPartyRequiredForm) { return this.partyRequiredFormRepo.upsert(data); }
  updatePartyRequiredForm(id: string, data: Partial<Omit<PartyRequiredForm, "id" | "createdAt">>) { return this.partyRequiredFormRepo.update(id, data); }
  updatePartyRequiredFormStatus(id: string, status: PartyRequiredFormStatus, patch?: Partial<Pick<PartyRequiredForm, "viewedAt" | "signedAt" | "signedBy" | "signerName" | "signatureIpAddress" | "attestationText" | "attestationVersion" | "confirmationTickedAt" | "signatureSource" | "uploadedDocumentId" | "uploadNotes" | "withdrawnAt" | "withdrawnBy" | "generatedDocumentId">>) { return this.partyRequiredFormRepo.updateStatus(id, status, patch); }
  updatePartyRequiredFormsAppointmentForSession(sessionId: string, appointmentId: string) { return this.partyRequiredFormRepo.updateAppointmentForSession(sessionId, appointmentId); }
  findPartyRequiredFormBySessionPartyType(sessionId: string, partyId: string, formType: PartyRequiredFormType) { return this.partyRequiredFormRepo.findBySessionPartyType(sessionId, partyId, formType); }
  findPartyRequiredFormByCasePartyType(caseId: string, partyId: string, formType: PartyRequiredFormType) { return this.partyRequiredFormRepo.findByCasePartyType(caseId, partyId, formType); }
  listCaseCimConsents(caseId: string) { return this.cimConsentRepo.listByCase(caseId); }
  upsertCaseCimConsent(data: InsertCaseCimConsent) { return this.cimConsentRepo.upsert(data); }

  private courtFormTemplateRepo = new CourtFormRepository();
  listCourtFormTemplates() { return this.courtFormTemplateRepo.listTemplates(); }
  getCourtFormTemplate(id: string) { return this.courtFormTemplateRepo.getTemplate(id); }
  getCurrentCourtFormTemplate(formType: CourtFormType) { return this.courtFormTemplateRepo.getCurrentTemplate(formType); }
  createCourtFormTemplate(data: InsertCourtFormTemplate) { return this.courtFormTemplateRepo.createTemplate(data); }
  updateCourtFormTemplate(id: string, data: Partial<Omit<CourtFormTemplate, "id" | "uploadedAt">>) { return this.courtFormTemplateRepo.updateTemplate(id, data); }
  updateCourtFormTemplateMappingIfUnchanged(id: string, expectedMapping: unknown, fieldMapping: unknown) { return this.courtFormTemplateRepo.updateTemplateMappingIfUnchanged(id, expectedMapping, fieldMapping); }
  markCourtFormTemplateCurrent(id: string, formType: CourtFormType, verifiedBy?: string | null, verifiedCurrentAt?: Date | null) { return this.courtFormTemplateRepo.markCurrent(id, formType, verifiedBy, verifiedCurrentAt); }
  deleteCourtFormTemplate(id: string, deletedBy: string) { return this.courtFormTemplateRepo.deleteTemplate(id, deletedBy); }
  listCourtFormGuidance(formType?: CourtFormType, templateId?: string | null) { return this.courtFormTemplateRepo.listGuidance(formType, templateId); }
  createCourtFormGuidance(data: InsertCourtFormGuidance) { return this.courtFormTemplateRepo.createGuidance(data); }
  updateCourtFormGuidance(id: string, data: Partial<Omit<CourtFormGuidance, "id" | "createdAt">>) { return this.courtFormTemplateRepo.updateGuidance(id, data); }
  getCourtFormDraft(caseId: string, partyId: string, formType: CourtFormType) { return this.courtFormTemplateRepo.getDraft(caseId, partyId, formType); }
  upsertCourtFormDraft(data: InsertCourtFormDraft) { return this.courtFormTemplateRepo.upsertCourtFormDraft(data); }
  listCourtFormGenerationsByCase(caseId: string) { return this.courtFormTemplateRepo.listGenerationsByCase(caseId); }
  getCourtFormGeneration(id: string) { return this.courtFormTemplateRepo.getGeneration(id); }
  createCourtFormGeneration(data: InsertCourtFormGeneration) { return this.courtFormTemplateRepo.createCourtFormGeneration(data); }
  updateCourtFormGeneration(id: string, data: Partial<Omit<CourtFormGeneration, "id" | "generatedAt">>) { return this.courtFormTemplateRepo.updateGeneration(id, data); }

  private mediationSessionAvailabilityRepo = new MediationSessionAvailabilityRepository();
  listMediationSessionAvailabilityWindows(sessionId: string) { return this.mediationSessionAvailabilityRepo.listBySession(sessionId); }
  listMediationSessionAvailabilityWindowsBySessions(sessionIds: string[]) { return this.mediationSessionAvailabilityRepo.listBySessions(sessionIds); }
  replaceMediationSessionAvailabilityForParty(sessionId: string, partyId: string, rows: InsertMediationSessionAvailabilityWindow[]) { return this.mediationSessionAvailabilityRepo.replaceForParty(sessionId, partyId, rows); }
  replaceMediationSessionAvailabilityForProposalRecipient(proposalRecipientId: string, rows: InsertMediationSessionAvailabilityWindow[]) { return this.mediationSessionAvailabilityRepo.replaceForProposalRecipient(proposalRecipientId, rows); }
  replaceMediationSessionAvailabilityForRescheduleRequest(sessionId: string, submittedBy: string, rows: InsertMediationSessionAvailabilityWindow[]) { return this.mediationSessionAvailabilityRepo.replaceForRescheduleRequest(sessionId, submittedBy, rows); }
  replaceMediationSessionAvailabilityForNextSessionRequest(sessionId: string, submittedBy: string, rows: InsertMediationSessionAvailabilityWindow[]) { return this.mediationSessionAvailabilityRepo.replaceForNextSessionRequest(sessionId, submittedBy, rows); }

  private miamRecordRepo = new MiamRecordRepository();
  getMiamRecord(partyId: string, caseId: string) { return this.miamRecordRepo.getByPartyAndCase(partyId, caseId); }
  getCurrentMiamRecord(partyId: string, caseId: string) { return this.miamRecordRepo.getCurrentByPartyAndCase(partyId, caseId); }
  getMiamRecordById(id: string) { return this.miamRecordRepo.getById(id); }
  listMiamRecordsByCase(caseId: string) { return this.miamRecordRepo.listByCase(caseId); }
  listMiamRecordHistoryByPartyAndCase(partyId: string, caseId: string) { return this.miamRecordRepo.listHistoryByPartyAndCase(partyId, caseId); }
  upsertMiamRecord(partyId: string, caseId: string, data: Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt">>) { return this.miamRecordRepo.upsert(partyId, caseId, data); }
  createRenewalMiamRecord(partyId: string, caseId: string, data: Partial<Omit<MiamRecord, "id" | "partyId" | "caseId" | "createdAt" | "updatedAt">>) { return this.miamRecordRepo.createRenewal(partyId, caseId, data); }
  supersedeCurrentMiamRecordForPartyAndCase(partyId: string, caseId: string) { return this.miamRecordRepo.supersedeCurrentForPartyAndCase(partyId, caseId); }
  updateMiamApprovalStatus(id: string, updates: { approvalStatus: string; submittedBy?: string | null; submittedAt?: Date | null; reviewedBy?: string | null; reviewedAt?: Date | null; reviewNotes?: string | null }) { return this.miamRecordRepo.updateApprovalStatus(id, updates); }
  setPendingPartyOnMiamRecord(id: string, data: { pendingPartyUserId?: string | null; pendingPartyFirstName?: string | null; pendingPartyLastName?: string | null; pendingPartyEmail?: string | null }) { return this.miamRecordRepo.setPendingParty(id, data); }
  claimAndClearPendingPartyOnMiamRecord(id: string) { return this.miamRecordRepo.claimAndClearPendingParty(id); }

  private miamEditRequestRepo = new MiamEditRequestRepository();
  getMiamEditRequestById(id: string) { return this.miamEditRequestRepo.getById(id); }
  getPendingMiamEditRequest(miamRecordId: string) { return this.miamEditRequestRepo.getPendingByMiamRecordId(miamRecordId); }
  getLatestMiamEditRequest(miamRecordId: string) { return this.miamEditRequestRepo.getLatestByMiamRecordId(miamRecordId); }
  createMiamEditRequest(data: { miamRecordId: string; caseId: string; requestedBy: string; proposedChanges: Record<string, unknown>; originalValues: Record<string, unknown>; requestNote?: string }) { return this.miamEditRequestRepo.create(data); }
  updateMiamEditRequestStatus(id: string, updates: { status: string; reviewedBy?: string | null; reviewedAt?: Date | null; reviewNotes?: string | null }) { return this.miamEditRequestRepo.updateStatus(id, updates); }
  cancelPendingMiamEditRequests(miamRecordId: string) { return this.miamEditRequestRepo.cancelPendingForRecord(miamRecordId); }

  private googleCalendarEventsRepo = new GoogleCalendarEventsRepository();
  private outlookCalendarEventsRepo = new OutlookCalendarEventsRepository();
  upsertGoogleCalendarEvents(events: InsertGoogleCalendarEvent[]) { return this.googleCalendarEventsRepo.upsertEvents(events); }
  listGoogleCalendarEventsByDateRange(mediatorId: string, start: Date, end: Date) { return this.googleCalendarEventsRepo.listByMediatorAndDateRange(mediatorId, start, end); }
  deleteGoogleCalendarEventsByMediator(mediatorId: string) { return this.googleCalendarEventsRepo.deleteByMediator(mediatorId); }
  deleteStaleGoogleCalendarEventsInRange(mediatorId: string, keepIds: string[], windowStart: Date, windowEnd: Date) { return this.googleCalendarEventsRepo.deleteStaleEventsInRange(mediatorId, keepIds, windowStart, windowEnd); }
  upsertOutlookCalendarEvents(events: InsertOutlookCalendarEvent[]) { return this.outlookCalendarEventsRepo.upsertEvents(events); }
  listOutlookCalendarEventsByDateRange(mediatorId: string, start: Date, end: Date) { return this.outlookCalendarEventsRepo.listByMediatorAndDateRange(mediatorId, start, end); }
  deleteOutlookCalendarEventsByMediator(mediatorId: string) { return this.outlookCalendarEventsRepo.deleteByMediator(mediatorId); }
  deleteStaleOutlookCalendarEventsInRange(mediatorId: string, keepIds: string[], windowStart: Date, windowEnd: Date) { return this.outlookCalendarEventsRepo.deleteStaleEventsInRange(mediatorId, keepIds, windowStart, windowEnd); }
}

export const storage = new DatabaseStorage();
