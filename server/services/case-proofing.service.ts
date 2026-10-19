import crypto from "crypto";
import { storage } from "../storage";
import { notificationService } from "./notification.service";
import { caseActivityService, staffActor } from "./case-activity.service";
import { logAudit } from "./audit-log.service";
import { fileStorageService } from "./file-storage.service";
import { financialDisclosureService } from "./financial-disclosure.service";
import type {
  CaseDocument,
  CaseProofingItem,
  CaseProofingItemCycle,
  CaseProofingStatus,
  InsertCaseProofingItem,
  User,
} from "@shared/schema";
import type { ServiceResult } from "./types";
import { caseDocumentDownloadHref } from "../security/document-access";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";
import { proofingReleaseDocumentId, proofingReleaseNotificationId, selectProofingReleaseRecipientIds, shouldStartNewProofingCycle } from "./case-proofing-release-policy";

type ActorUser = Pick<User, "id" | "name" | "role">;

export type ProofingAgeingStatus = "green" | "amber" | "red";

export type CaseProofingItemView = CaseProofingItem & {
  ageingStatus: ProofingAgeingStatus;
  ageingDays: number;
  displayTitle: string;
  displaySubtitle: string | null;
  partyName: string | null;
  sessionLabel: string | null;
  submittedByName: string | null;
  reviewedByName: string | null;
  fileName: string | null;
  mimeType: string | null;
  documentDate: Date | string | null;
  uploadDate: Date | string | null;
  fileUrl: string | null;
  previewKind: "document" | "draft_financial_schedule_pdf" | "metadata_only" | "unavailable";
  releaseEffect: string;
  currentCycleNumber: number;
  reviewCycleLabel: string;
  versionNumber: number | null;
  versionLabel: string | null;
  signatureSource: string | null;
  requiredFormType: string | null;
  cycles: CaseProofingCycleView[];
};

type CaseProofingCycleView = Pick<CaseProofingItemCycle,
  "id" | "cycleNumber" | "status" | "submittedAt" | "reviewedAt" | "returnedAt" | "returnComments" | "withdrawnAt" | "withdrawReason" | "fileName" | "documentDate" | "uploadDate"
> & {
  submittedByName: string | null;
  reviewedByName: string | null;
  returnedByName: string | null;
  withdrawnByName: string | null;
};

function isAdmin(actor: ActorUser): boolean {
  return actor.role === "superadmin" || actor.role === "subadmin";
}

function addWorkingDays(start: Date, days: number): Date {
  const current = new Date(start);
  let added = 0;
  while (added < days) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return current;
}

function workingDaysSince(start: Date, now = new Date()): number {
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  let days = 0;
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "document.pdf";
}

function titleFromType(itemType: string): string {
  switch (itemType) {
    case "session_summary":
      return "Session summary";
    case "draft_financial_schedule":
      return "Draft Financial Schedule";
    case "financial_disclosure_checklist":
      return "Financial Disclosure Checklist";
    case "court_form":
      return "Court form";
    case "case_document":
      return "Case document";
    default:
      return itemType.replaceAll("_", " ");
  }
}

function requiredFormLabel(formType: string): string {
  if (formType === "agreement_to_mediate_confidentiality") return "Agreement to Mediate";
  if (formType === "voucher_scheme_client_consent") return "Family Mediation Voucher Scheme client consent";
  if (formType === "voucher_moj_research_contact_opt_in") return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
  if (formType === "voucher_diversity_questionnaire_opt_in") return "Legacy Diversity questionnaire opt-in";
  return formType.replaceAll("_", " ");
}

function signatureSourceLabel(source?: string | null): string {
  if (source === "platform") return "Portal signature";
  if (source === "upload") return "Client upload";
  if (source === "admin_offline") return "Admin offline upload";
  return "Signed form";
}

function clientDisplayName(client?: { firstName?: string | null; lastName?: string | null } | null): string | null {
  const name = `${client?.firstName || ""} ${client?.lastName || ""}`.trim();
  return name || null;
}

class CaseProofingService {
  calculateProofingAgeingStatus(submittedAt: Date | string, now = new Date()): ProofingAgeingStatus {
    const days = workingDaysSince(new Date(submittedAt), now);
    if (days >= 5) return "red";
    if (days >= 3) return "amber";
    return "green";
  }

  private async actorName(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await storage.getUser(userId);
    return user?.name || null;
  }

  async resolveProofingReviewContext(item: CaseProofingItem): Promise<Omit<CaseProofingItemView, keyof CaseProofingItem | "ageingStatus" | "ageingDays" | "currentCycleNumber" | "reviewCycleLabel" | "versionNumber" | "versionLabel" | "cycles">> {
    const base = {
      displayTitle: titleFromType(item.itemType),
      displaySubtitle: item.sourceEntityType.replaceAll("_", " "),
      partyName: null as string | null,
      sessionLabel: null as string | null,
      submittedByName: await this.actorName(item.submittedBy),
      reviewedByName: await this.actorName(item.reviewedBy),
      fileName: null as string | null,
      mimeType: null as string | null,
      documentDate: null as Date | string | null,
      uploadDate: null as Date | string | null,
      fileUrl: null as string | null,
      previewKind: "metadata_only" as CaseProofingItemView["previewKind"],
      releaseEffect: "Approving records this item as reviewed for the case file.",
      signatureSource: null as string | null,
      requiredFormType: null as string | null,
    };

    if (item.sessionId || item.sourceEntityType === "mediation_session") {
      const session = await storage.getMediationSession(item.sessionId || item.sourceEntityId);
      if (session) {
        base.sessionLabel = `Session ${session.sessionNumber}`;
        if (item.itemType === "session_summary") {
          base.displayTitle = `Session ${session.sessionNumber} summary`;
          base.displaySubtitle = session.outcome ? `Outcome: ${session.outcome.replaceAll("_", " ")}` : "Post-session summary";
          base.releaseEffect = "Approving records the session summary as reviewed for the case file.";
        }
      }
    }

    if (item.itemType === "draft_financial_schedule") {
      base.previewKind = "draft_financial_schedule_pdf";
      base.displayTitle = "Draft Financial Schedule";
      base.displaySubtitle = base.sessionLabel ? `${base.sessionLabel} confirmed schedule` : "Confirmed schedule";
      base.fileName = "Draft Financial Schedule.pdf";
      base.mimeType = "application/pdf";
      base.releaseEffect = "Approving will create and release the reviewed Draft Financial Schedule PDF to clients.";
    }

    if (item.itemType === "case_document" || item.sourceEntityType === "case_document") {
      const document = await storage.getCaseDocument(item.sourceEntityId);
      if (document) {
        const requiredForms = await storage.listPartyRequiredFormsByCase(document.caseId);
        const requiredForm = requiredForms.find((form) => form.uploadedDocumentId === document.id || form.generatedDocumentId === document.id);
        base.displayTitle = document.title || document.fileName || base.displayTitle;
        base.displaySubtitle = document.documentCategory || document.financialDisclosureUploadTarget || "Case document";
        base.fileName = document.fileName || null;
        base.mimeType = document.mimeType || null;
        base.documentDate = document.documentDate || null;
        base.uploadDate = document.createdAt || null;
        base.fileUrl = caseDocumentDownloadHref(document.id);
        base.previewKind = "document";
        base.releaseEffect = "Approving will make this document visible to clients.";
        if (document.partyId) base.partyName = await this.partyDisplayName(document.partyId);
        if (requiredForm) {
          base.displayTitle = requiredFormLabel(requiredForm.formType);
          base.displaySubtitle = `${signatureSourceLabel(requiredForm.signatureSource)} · Signed required form`;
          base.signatureSource = requiredForm.signatureSource || null;
          base.requiredFormType = requiredForm.formType;
          base.releaseEffect = requiredForm.formType === "voucher_scheme_client_consent"
            ? "Approving records this mandatory voucher consent as reviewed for voucher claim eligibility."
            : "Approving records this signed form as reviewed for the case file.";
        }
      }
    }

    if (item.itemType === "court_form") {
      const generation = await storage.getCourtFormGeneration(item.sourceEntityId);
      const document = generation?.caseDocumentId ? await storage.getCaseDocument(generation.caseDocumentId) : undefined;
      const template = generation?.templateId ? await storage.getCourtFormTemplate(generation.templateId) : undefined;
      base.displayTitle = document?.title || (template ? `${template.formType} court form` : "Court form");
      base.displaySubtitle = template?.versionLabel ? `Template ${template.versionLabel}` : "Generated court form PDF";
      base.fileName = document?.fileName || null;
      base.mimeType = document?.mimeType || "application/pdf";
      base.documentDate = document?.documentDate || null;
      base.uploadDate = generation?.generatedAt || document?.createdAt || null;
      base.fileUrl = document ? caseDocumentDownloadHref(document.id) : null;
      base.previewKind = document ? "document" : "unavailable";
      base.releaseEffect = "Approving will make this generated court form PDF visible to clients.";
      if (generation?.partyId) base.partyName = await this.partyDisplayName(generation.partyId);
    }

    if (item.itemType === "financial_disclosure_checklist") {
      const checklist = item.sourceEntityType === "financial_disclosure_item" ? await storage.getFinancialDisclosureItem(item.sourceEntityId) : undefined;
      if (checklist) {
        const folder = await storage.getFinancialDisclosureFolder(checklist.folderId);
        base.displayTitle = "Financial Disclosure Checklist";
        base.displaySubtitle = `Checklist status: ${checklist.status.replaceAll("_", " ")}`;
        base.uploadDate = checklist.updatedAt || checklist.createdAt || null;
        base.releaseEffect = "Approving records the checklist package as ready for client-facing or internal use.";
        if (folder?.partyId) base.partyName = await this.partyDisplayName(folder.partyId);
      }
      base.previewKind = "metadata_only";
    }

    return base;
  }

  private async partyDisplayName(partyId: string): Promise<string | null> {
    const party = await storage.getParty(partyId);
    if (!party) return null;
    const client = await storage.getClient(party.clientId);
    const name = clientDisplayName(client);
    return name ? `${name} (${party.role})` : `Client ${party.role}`;
  }

  private async sourceSnapshot(item: CaseProofingItem): Promise<{
    fileName: string | null;
    documentDate: Date | null;
    uploadDate: Date | null;
    sourceMetadata: Record<string, unknown>;
  }> {
    const snapshot = {
      fileName: null as string | null,
      documentDate: null as Date | null,
      uploadDate: item.submittedAt || null,
      sourceMetadata: {
        itemType: item.itemType,
        sourceEntityType: item.sourceEntityType,
        sourceEntityId: item.sourceEntityId,
      } as Record<string, unknown>,
    };
    if (item.sourceEntityType === "case_document") {
      const document = await storage.getCaseDocument(item.sourceEntityId);
      snapshot.fileName = document?.fileName || null;
      snapshot.documentDate = document?.documentDate || null;
      snapshot.uploadDate = document?.createdAt || item.submittedAt || null;
    }
    if (item.itemType === "court_form") {
      const generation = await storage.getCourtFormGeneration(item.sourceEntityId);
      const document = generation?.caseDocumentId ? await storage.getCaseDocument(generation.caseDocumentId) : undefined;
      snapshot.fileName = document?.fileName || null;
      snapshot.documentDate = document?.documentDate || null;
      snapshot.uploadDate = generation?.generatedAt || document?.createdAt || item.submittedAt || null;
    }
    return snapshot;
  }

  private async cycleView(cycle: CaseProofingItemCycle): Promise<CaseProofingCycleView> {
    return {
      id: cycle.id,
      cycleNumber: cycle.cycleNumber,
      status: cycle.status,
      submittedAt: cycle.submittedAt,
      reviewedAt: cycle.reviewedAt,
      returnedAt: cycle.returnedAt,
      returnComments: cycle.returnComments,
      withdrawnAt: cycle.withdrawnAt,
      withdrawReason: cycle.withdrawReason,
      fileName: cycle.fileName,
      documentDate: cycle.documentDate,
      uploadDate: cycle.uploadDate,
      submittedByName: await this.actorName(cycle.submittedBy),
      reviewedByName: await this.actorName(cycle.reviewedBy),
      returnedByName: await this.actorName(cycle.returnedBy),
      withdrawnByName: await this.actorName(cycle.withdrawnBy),
    };
  }

  private async draftScheduleVersion(item: CaseProofingItem): Promise<{ versionNumber: number | null; versionLabel: string | null }> {
    if (item.itemType !== "draft_financial_schedule") return { versionNumber: null, versionLabel: null };
    const schedule = await storage.getCaseDraftFinancialSchedule(item.caseId);
    if (!schedule) return { versionNumber: null, versionLabel: null };
    const versions = await storage.listDraftScheduleVersions(schedule.id);
    const latest = versions[0];
    return latest ? { versionNumber: latest.versionNumber, versionLabel: `Version ${latest.versionNumber}` } : { versionNumber: null, versionLabel: null };
  }

  private async toView(item: CaseProofingItem): Promise<CaseProofingItemView> {
    const ageingDays = workingDaysSince(item.submittedAt);
    const reviewContext = await this.resolveProofingReviewContext(item);
    const cycles = await storage.listCaseProofingItemCycles([item.id]);
    const cycleViews = await Promise.all(cycles.map((cycle) => this.cycleView(cycle)));
    const currentCycleNumber = cycles[0]?.cycleNumber || 1;
    const version = await this.draftScheduleVersion(item);
    return {
      ...item,
      ageingDays,
      ageingStatus: this.calculateProofingAgeingStatus(item.submittedAt),
      ...reviewContext,
      currentCycleNumber,
      reviewCycleLabel: `Review cycle ${currentCycleNumber}`,
      versionNumber: version.versionNumber,
      versionLabel: version.versionLabel,
      cycles: cycleViews,
    };
  }

  async listCaseProofingItems(caseId: string, actor: ActorUser): Promise<ServiceResult<{ items: CaseProofingItemView[] }>> {
    if (!hasFullOperationalCaseAccess(await classifyCaseAccess(caseId, actor))) {
      return { ok: false, error: "Access denied", status: 403 };
    }
    const items = await storage.listCaseProofingItems(caseId);
    return { ok: true, items: await Promise.all(items.map((item) => this.toView(item))) };
  }

  async ensureProofingItemForSource(data: InsertCaseProofingItem): Promise<CaseProofingItem> {
    const existing = await storage.getCaseProofingItemBySource(data.sourceEntityType, data.sourceEntityId, data.itemType);
    const incomingStatus = data.status || "awaiting_review";
    const item = await storage.upsertCaseProofingItem({
      ...data,
      status: incomingStatus,
      submittedAt: data.submittedAt || new Date(),
    });
    const cycles = await storage.listCaseProofingItemCycles([item.id]);
    if (shouldStartNewProofingCycle(existing?.status || null, incomingStatus, cycles.length > 0)) {
      const snapshot = await this.sourceSnapshot(item);
      await storage.createNextCaseProofingItemCycle(item.id, {
        status: item.status as CaseProofingStatus,
        submittedBy: item.submittedBy,
        submittedAt: item.submittedAt,
        reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt,
        returnComments: item.returnComments,
        returnedBy: item.returnedBy,
        returnedAt: item.returnedAt,
        withdrawnBy: item.withdrawnBy,
        withdrawnAt: item.withdrawnAt,
        withdrawReason: item.withdrawReason,
        sourceEntityType: item.sourceEntityType,
        sourceEntityId: item.sourceEntityId,
        fileName: snapshot.fileName,
        documentDate: snapshot.documentDate,
        uploadDate: snapshot.uploadDate,
        sourceMetadata: snapshot.sourceMetadata,
      });
    }
    return item;
  }

  private async getItemForAdmin(id: string, actor: ActorUser): Promise<ServiceResult<{ item: CaseProofingItem }>> {
    if (!isAdmin(actor)) return { ok: false, error: "Only superadmins and subadmins can manage proofing items", status: 403 };
    const item = await storage.getCaseProofingItem(id);
    if (!item) return { ok: false, error: "Proofing item not found", status: 404 };
    return { ok: true, item };
  }

  private async releaseDocument(documentId: string, actor: ActorUser): Promise<CaseDocument | undefined> {
    const existing = await storage.getCaseDocument(documentId);
    if (!existing) return undefined;
    if (existing.documentRequestId || existing.documentCategory === "requested_evidence") return undefined;
    if (existing.reviewStatus === "reviewed" && existing.sharedWithClients) return existing;
    return storage.updateCaseDocument(documentId, {
      reviewStatus: "reviewed",
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      sharedWithClients: true,
    });
  }

  private async hideDocument(documentId: string): Promise<CaseDocument | undefined> {
    return storage.updateCaseDocument(documentId, { sharedWithClients: false });
  }

  private async hideDraftFinancialSchedule(item: CaseProofingItem): Promise<void> {
    const document = await this.releasedDocumentForItem(item);
    if (document) await this.hideDocument(document.id);
  }

  private async prepareDraftFinancialSchedule(item: CaseProofingItem, actor: ActorUser, cycleNumber: number): Promise<CaseDocument | undefined> {
    const schedule = await storage.getCaseDraftFinancialSchedule(item.caseId);
    if (!schedule || schedule.status !== "confirmed") return undefined;
    const cycleDocumentId = proofingReleaseDocumentId(item.id, cycleNumber);
    const cycleDocument = await storage.getCaseDocument(cycleDocumentId);
    if (cycleDocument) return cycleDocument;
    const existingDocuments = item.sessionId ? await storage.listCaseDocumentsBySessionIds([item.sessionId]) : await storage.listCaseDocumentsByCase(item.caseId);
    const legacyHiddenDocument = cycleNumber === 1 ? existingDocuments.find((document) => (
      document.documentCategory === "draft_financial_schedule"
      && !document.sharedWithClients
    )) : undefined;
    if (legacyHiddenDocument) return legacyHiddenDocument;
    const exported = await financialDisclosureService.exportDraftFinancialSchedulePdf(item.caseId, actor);
    if (!exported.ok) return undefined;
    const safeFileName = `${crypto.randomUUID()}-${sanitizeFileName(exported.filename)}`;
    const stored = await fileStorageService.saveCaseDocumentFile({
      fileName: safeFileName,
      buffer: exported.buffer,
      mimeType: "application/pdf",
    });
    const now = new Date();
    return storage.createCaseDocumentOnce(cycleDocumentId, {
      caseId: item.caseId,
      mediationSessionId: item.sessionId,
      financialDisclosureFolderId: null,
      financialDisclosureItemId: null,
      financialDisclosureEvidenceCategoryId: null,
      financialDisclosureUploadTarget: null,
      partyId: null,
      documentCategory: "draft_financial_schedule",
      title: "Draft Financial Schedule",
      fileName: exported.filename,
      fileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType: "application/pdf",
      documentDate: now,
      fileSizeBytes: exported.buffer.byteLength,
      uploadedBy: actor.id,
      reviewStatus: "ready_for_review",
      readyForReviewAt: now,
      reviewedBy: null,
      reviewedAt: null,
      sharedWithClients: false,
    });
  }

  private async releasedDocumentForItem(item: CaseProofingItem): Promise<CaseDocument | undefined> {
    if (item.sourceEntityType === "case_document") return storage.getCaseDocument(item.sourceEntityId);
    if (item.itemType === "court_form") {
      const generation = await storage.getCourtFormGeneration(item.sourceEntityId);
      return generation?.caseDocumentId ? storage.getCaseDocument(generation.caseDocumentId) : undefined;
    }
    if (item.itemType === "draft_financial_schedule") {
      const documents = item.sessionId
        ? await storage.listCaseDocumentsBySessionIds([item.sessionId])
        : await storage.listCaseDocumentsByCase(item.caseId);
      return documents.find((document) => document.documentCategory === "draft_financial_schedule");
    }
    return undefined;
  }

  private async prepareReleaseSource(item: CaseProofingItem, actor: ActorUser, cycleNumber: number): Promise<CaseDocument | undefined> {
    if (item.itemType === "draft_financial_schedule") {
      return this.prepareDraftFinancialSchedule(item, actor, cycleNumber);
    }
    return this.releasedDocumentForItem(item);
  }

  private async hideSource(item: CaseProofingItem): Promise<void> {
    if (item.sourceEntityType === "case_document") await this.hideDocument(item.sourceEntityId);
    if (item.itemType === "court_form") {
      const generation = await storage.getCourtFormGeneration(item.sourceEntityId);
      if (generation?.caseDocumentId) await this.hideDocument(generation.caseDocumentId);
    }
    if (item.itemType === "draft_financial_schedule") await this.hideDraftFinancialSchedule(item);
  }

  private async createReturnTask(item: CaseProofingItem, actor: ActorUser, returnComments: string): Promise<void> {
    const caseRecord = await storage.getCase(item.caseId);
    await notificationService.createNotification({
      recipientId: caseRecord?.mediatorId || null,
      recipientRole: caseRecord?.mediatorId ? "mediator" : "admin",
      type: "proofing_returned_to_mediator",
      urgency: "amber",
      caseId: item.caseId,
      appointmentId: null,
      title: "Proofing item returned",
      message: `${actor.name} returned ${item.itemType.replaceAll("_", " ")} for updates. Comments: ${returnComments}`,
      status: "active",
      assignedTo: caseRecord?.mediatorId || null,
      followUpDate: addWorkingDays(new Date(), 3),
      caseNoteRequired: true,
    });
  }

  private async notifyClientsOfReleasedDocument(item: CaseProofingItem, document: CaseDocument, cycleNumber: number): Promise<void> {
    const parties = await storage.listPartiesByCase(item.caseId);
    const candidates = [];
    for (const party of parties) {
      const client = await storage.getClient(party.clientId);
      candidates.push({ partyId: party.id, userId: client?.userId || null });
    }
    const recipientIds = selectProofingReleaseRecipientIds(candidates, document.partyId || null);
    const documentTitle = document.title || document.fileName || "A case document";
    const actionPath = `/cases/${item.caseId}?tab=documents`;
    for (const recipientId of recipientIds) {
      await notificationService.createNotification({
        id: proofingReleaseNotificationId(item.id, cycleNumber, recipientId),
        recipientId,
        recipientRole: "client",
        type: "case_document_released",
        urgency: "green",
        caseId: item.caseId,
        appointmentId: null,
        title: "New document available",
        message: `${documentTitle} is now available in your Documents tab. ${actionPath}`,
        status: "active",
        caseNoteRequired: false,
      });
    }
  }

  async approveProofingItem(id: string, actor: ActorUser, ipAddress?: string): Promise<ServiceResult<{ item: CaseProofingItemView }>> {
    const result = await this.getItemForAdmin(id, actor);
    if (!result.ok) return result as ServiceResult<{ item: CaseProofingItemView }>;
    if (result.item.status === "withdrawn") {
      return { ok: false, error: "Withdrawn proofing items cannot be approved", status: 409 };
    }
    const cycles = await storage.listCaseProofingItemCycles([id]);
    const currentCycleNumber = cycles[0]?.cycleNumber || 1;
    const releasesDocument = result.item.sourceEntityType === "case_document"
      || result.item.itemType === "court_form"
      || result.item.itemType === "draft_financial_schedule";
    const preparedDocument = await this.prepareReleaseSource(result.item, actor, currentCycleNumber);
    if (releasesDocument && !preparedDocument) {
      return { ok: false, error: "Failed to prepare proofing document for release", status: 500 };
    }
    if (result.item.status === "approved") {
      const releasedDocument = preparedDocument ? await this.releaseDocument(preparedDocument.id, actor) : undefined;
      if (releasesDocument && !releasedDocument) {
        return { ok: false, error: "Failed to release proofing document", status: 500 };
      }
      if (releasedDocument) await this.notifyClientsOfReleasedDocument(result.item, releasedDocument, currentCycleNumber);
      return { ok: true, item: await this.toView(result.item) };
    }
    const updated = await storage.updateCaseProofingItemStatus(id, {
      status: "approved" satisfies CaseProofingStatus,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      returnComments: null,
      returnedBy: null,
      returnedAt: null,
      withdrawnBy: null,
      withdrawnAt: null,
      withdrawReason: null,
    });
    if (!updated) return { ok: false, error: "Failed to approve proofing item", status: 500 };
    await storage.updateCurrentCaseProofingItemCycle(id, {
      status: "approved",
      reviewedBy: actor.id,
      reviewedAt: updated.reviewedAt || new Date(),
      returnComments: null,
      returnedBy: null,
      returnedAt: null,
      withdrawnBy: null,
      withdrawnAt: null,
      withdrawReason: null,
    });
    await caseActivityService.log({
      caseId: updated.caseId,
      type: "proofing_approved",
      title: "Proofing item approved",
      description: `${actor.name} approved ${updated.itemType.replaceAll("_", " ")}.`,
      relatedEntityId: updated.id,
      relatedEntityType: "case_proofing_item",
      metadata: JSON.stringify({ itemType: updated.itemType, sourceEntityType: updated.sourceEntityType, sourceEntityId: updated.sourceEntityId }),
      actor: staffActor(actor),
    });
    await logAudit({ userId: actor.id, action: "approve_case_proofing_item", entity: "case_proofing_item", entityId: id, details: JSON.stringify({ itemType: updated.itemType }), ipAddress });
    const releasedDocument = preparedDocument ? await this.releaseDocument(preparedDocument.id, actor) : undefined;
    if (releasesDocument && !releasedDocument) {
      return { ok: false, error: "Failed to release proofing document", status: 500 };
    }
    if (releasedDocument) await this.notifyClientsOfReleasedDocument(updated, releasedDocument, currentCycleNumber);
    return { ok: true, item: await this.toView(updated) };
  }

  async returnProofingItem(id: string, actor: ActorUser, input: { returnComments: string }, ipAddress?: string): Promise<ServiceResult<{ item: CaseProofingItemView }>> {
    const result = await this.getItemForAdmin(id, actor);
    if (!result.ok) return result as ServiceResult<{ item: CaseProofingItemView }>;
    const returnComments = input.returnComments.trim();
    if (!returnComments) return { ok: false, error: "Return comments are required", status: 400 };
    await this.hideSource(result.item);
    const updated = await storage.updateCaseProofingItemStatus(id, {
      status: "returned",
      returnComments,
      returnedBy: actor.id,
      returnedAt: new Date(),
      reviewedBy: null,
      reviewedAt: null,
    });
    if (!updated) return { ok: false, error: "Failed to return proofing item", status: 500 };
    await storage.updateCurrentCaseProofingItemCycle(id, {
      status: "returned",
      returnComments,
      returnedBy: actor.id,
      returnedAt: updated.returnedAt || new Date(),
      reviewedBy: null,
      reviewedAt: null,
    });
    await this.createReturnTask(updated, actor, returnComments);
    await caseActivityService.log({
      caseId: updated.caseId,
      type: "proofing_returned",
      title: "Proofing item returned",
      description: `${actor.name} returned ${updated.itemType.replaceAll("_", " ")} for updates.`,
      relatedEntityId: updated.id,
      relatedEntityType: "case_proofing_item",
      metadata: JSON.stringify({ itemType: updated.itemType, sourceEntityType: updated.sourceEntityType, sourceEntityId: updated.sourceEntityId, hasComments: true }),
      actor: staffActor(actor),
    });
    await logAudit({ userId: actor.id, action: "return_case_proofing_item", entity: "case_proofing_item", entityId: id, details: JSON.stringify({ itemType: updated.itemType, hasComments: true }), ipAddress });
    return { ok: true, item: await this.toView(updated) };
  }

  async withdrawProofingItem(id: string, actor: ActorUser, input: { withdrawReason: string }, ipAddress?: string): Promise<ServiceResult<{ item: CaseProofingItemView }>> {
    const result = await this.getItemForAdmin(id, actor);
    if (!result.ok) return result as ServiceResult<{ item: CaseProofingItemView }>;
    const withdrawReason = input.withdrawReason.trim();
    if (!withdrawReason) return { ok: false, error: "Withdraw reason is required", status: 400 };
    await this.hideSource(result.item);
    const updated = await storage.updateCaseProofingItemStatus(id, {
      status: "withdrawn",
      withdrawnBy: actor.id,
      withdrawnAt: new Date(),
      withdrawReason,
      reviewedBy: null,
      reviewedAt: null,
    });
    if (!updated) return { ok: false, error: "Failed to withdraw proofing item", status: 500 };
    await storage.updateCurrentCaseProofingItemCycle(id, {
      status: "withdrawn",
      withdrawnBy: actor.id,
      withdrawnAt: updated.withdrawnAt || new Date(),
      withdrawReason,
      reviewedBy: null,
      reviewedAt: null,
    });
    await caseActivityService.log({
      caseId: updated.caseId,
      type: "proofing_withdrawn",
      title: "Proofing item withdrawn",
      description: `${actor.name} withdrew ${updated.itemType.replaceAll("_", " ")} from client release.`,
      relatedEntityId: updated.id,
      relatedEntityType: "case_proofing_item",
      metadata: JSON.stringify({ itemType: updated.itemType, sourceEntityType: updated.sourceEntityType, sourceEntityId: updated.sourceEntityId, hasReason: true }),
      actor: staffActor(actor),
    });
    await logAudit({ userId: actor.id, action: "withdraw_case_proofing_item", entity: "case_proofing_item", entityId: id, details: JSON.stringify({ itemType: updated.itemType, hasReason: true }), ipAddress });
    return { ok: true, item: await this.toView(updated) };
  }
}

export const caseProofingService = new CaseProofingService();
