import type { Case, CaseDocument, CaseDocumentRequest, InsertCaseDocument, InsertCaseDocumentRequest, Party, User } from "@shared/schema";
import {
  isDocumentRequestType,
  resolveDocumentRequestName,
  validateDocumentRequestUpload,
  type DocumentRequestStatus,
  type DocumentRequestType,
} from "@shared/document-request";
import { withProtectedCaseDocumentUrl } from "../security/document-access";
import type { DocumentRequestLifecycleEvent, DocumentRequestLifecycleEventDraft } from "../repositories/case-document-request.repository";

type DocumentRequestActor = Pick<User, "id" | "role">;
export type DocumentRequestAction = "submit" | "return" | "complete" | "cancel";

export function canManageDocumentRequests(
  caseRecord: Pick<Case, "mediatorId">,
  actor: DocumentRequestActor,
): boolean {
  return actor.role === "superadmin"
    || actor.role === "subadmin"
    || (actor.role === "mediator" && caseRecord.mediatorId === actor.id);
}

export function canApplyDocumentRequestAction(
  status: DocumentRequestStatus,
  action: DocumentRequestAction,
): boolean {
  if (action === "submit") return status === "outstanding";
  if (action === "return" || action === "complete") return status === "submitted";
  if (action === "cancel") return status === "outstanding" || status === "submitted";
  return false;
}

export function documentRequestHref(caseId: string, requestId: string): string {
  return `/cases/${encodeURIComponent(caseId)}?tab=documents&documentRequestId=${encodeURIComponent(requestId)}`;
}

type CaseRecord = Pick<Case, "id" | "caseRef" | "mediatorId">;
type PartyRecord = Pick<Party, "id" | "caseId"> & {
  userId?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};
type Actor = Pick<User, "id" | "role"> & { name?: string | null };
type ServiceFailure = { ok: false; status: number; error: string };
type SafeCaseDocument = Omit<CaseDocument, "storageKey">;
type RequestView = CaseDocumentRequest & { submissions: SafeCaseDocument[] };
type ClientSubmissionView = Pick<CaseDocument, "id" | "fileName" | "mimeType" | "fileSizeBytes" | "createdAt"> & { fileUrl: string };
type ClientRequestView = Omit<RequestView,
  | "requestedBy"
  | "deliveryStatus"
  | "deliveryLastAttemptedAt"
  | "deliveryError"
  | "completedBy"
  | "returnedBy"
  | "cancelledBy"
  | "submissions"
> & { submissions: ClientSubmissionView[] };

export interface DocumentRequestServiceDependencies {
  getCase(id: string): Promise<CaseRecord | undefined>;
  listPartiesByCase(caseId: string): Promise<PartyRecord[]>;
  listPartiesByUserId(userId: string): Promise<PartyRecord[]>;
  createRequest(data: InsertCaseDocumentRequest, event?: DocumentRequestLifecycleEventDraft): Promise<CaseDocumentRequest>;
  getRequest(id: string): Promise<CaseDocumentRequest | undefined>;
  listRequestsByCase(caseId: string): Promise<CaseDocumentRequest[]>;
  listRequestsByPartyIds(partyIds: string[]): Promise<CaseDocumentRequest[]>;
  updateRequest(id: string, updates: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent): Promise<CaseDocumentRequest | undefined>;
  transitionRequest(id: string, expectedStatuses: DocumentRequestStatus[], updates: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, event?: DocumentRequestLifecycleEvent): Promise<CaseDocumentRequest | undefined>;
  commitSubmission(id: string, requestUpdates: Partial<Omit<CaseDocumentRequest, "id" | "createdAt">>, documentData: InsertCaseDocument, event: DocumentRequestLifecycleEvent): Promise<{ request: CaseDocumentRequest; document: CaseDocument } | undefined>;
  listDocumentsByRequestId(requestId: string): Promise<CaseDocument[]>;
  saveFile(input: { fileName: string; buffer: Buffer; mimeType: string }): Promise<{ fileUrl: string; storageKey: string }>;
  deleteFile(storageKey: string): Promise<void>;
  sendRequestEmail(input: { to: string; clientName: string; caseRef: string; documentName: string; instructions: string | null; requestUrl: string }): Promise<boolean>;
  createNotification(input: {
    recipientId: string;
    recipientRole: "client";
    type: "case_document_request";
    urgency: "amber";
    caseId: string;
    documentRequestId: string;
    title: string;
    message: string;
    status: "active";
  }): Promise<unknown>;
  setNotificationCompleted(requestId: string): Promise<void>;
  setNotificationOutstanding(requestId: string): Promise<void>;
}

function failure(status: number, error: string): ServiceFailure {
  return { ok: false, status, error };
}

function parseUploadData(fileData: string, fallbackMimeType?: string | null): { buffer: Buffer; mimeType: string } {
  const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  return { mimeType: fallbackMimeType || "application/octet-stream", buffer: Buffer.from(fileData, "base64") };
}

function clientSubmissionView(document: SafeCaseDocument): ClientSubmissionView {
  return {
    id: document.id,
    fileName: document.fileName,
    fileUrl: document.fileUrl,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    createdAt: document.createdAt,
  };
}

export class DocumentRequestService {
  constructor(private readonly deps: DocumentRequestServiceDependencies) {}

  private async attemptRequestEmail(input: Parameters<DocumentRequestServiceDependencies["sendRequestEmail"]>[0]): Promise<boolean> {
    try {
      return await this.deps.sendRequestEmail(input);
    } catch (error) {
      console.error("[DocumentRequest] Email delivery failed", error);
      return false;
    }
  }

  private async updateNotificationBestEffort(label: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      console.error(`[DocumentRequest] ${label} notification update failed`, error);
    }
  }

  private lifecycleEvent(input: {
    request: CaseDocumentRequest;
    actor: Actor;
    type: string;
    title: string;
    description: string;
    action: string;
    entityRef: string;
    details: Record<string, unknown>;
    ipAddress?: string;
  }): DocumentRequestLifecycleEvent {
    return {
      activity: {
        caseId: input.request.caseId,
        type: input.type,
        title: input.title,
        description: input.description,
        metadata: JSON.stringify({ documentRequestId: input.request.id }),
        performedBy: input.actor.id,
        performedByName: input.actor.name || (input.actor.role === "client" ? "Client" : "Staff"),
        actorType: input.actor.role === "client" ? "client" : input.actor.role === "mediator" ? "mediator" : "staff",
        relatedEntityId: input.request.id,
        relatedEntityType: "case_document_request",
        occurredAt: new Date(),
      },
      audit: {
        userId: input.actor.id,
        action: input.action,
        entity: "case_document_request",
        entityId: input.request.id,
        entityRef: input.entityRef,
        details: JSON.stringify(input.details),
        ipAddress: input.ipAddress,
      },
    };
  }

  private async view(request: CaseDocumentRequest): Promise<RequestView> {
    const submissions = await this.deps.listDocumentsByRequestId(request.id);
    return { ...request, submissions: submissions.map((document) => withProtectedCaseDocumentUrl(document) as SafeCaseDocument) };
  }

  private async clientView(request: CaseDocumentRequest): Promise<ClientRequestView> {
    const view = await this.view(request);
    const {
      requestedBy: _requestedBy,
      deliveryStatus: _deliveryStatus,
      deliveryLastAttemptedAt: _deliveryLastAttemptedAt,
      deliveryError: _deliveryError,
      completedBy: _completedBy,
      returnedBy: _returnedBy,
      cancelledBy: _cancelledBy,
      submissions,
      ...clientView
    } = view;
    return {
      ...clientView,
      submissions: submissions.map(clientSubmissionView),
    };
  }

  private async managedRequest(id: string, actor: Actor): Promise<{ request: CaseDocumentRequest; caseRecord: CaseRecord } | ServiceFailure> {
    const request = await this.deps.getRequest(id);
    if (!request) return failure(404, "Document request not found");
    const caseRecord = await this.deps.getCase(request.caseId);
    if (!caseRecord) return failure(404, "Case not found");
    if (!canManageDocumentRequests(caseRecord, actor)) return failure(403, "Only admins and the case lead mediator can manage document requests");
    return { request, caseRecord };
  }

  async createRequests(
    caseId: string,
    actor: Actor,
    input: { partyIds: string[]; documentType: string; customDocumentName?: string | null; instructions?: string | null },
    ipAddress?: string,
  ): Promise<{ ok: true; requests: RequestView[] } | ServiceFailure> {
    const caseRecord = await this.deps.getCase(caseId);
    if (!caseRecord) return failure(404, "Case not found");
    if (!canManageDocumentRequests(caseRecord, actor)) return failure(403, "Only admins and the case lead mediator can manage document requests");
    if (!isDocumentRequestType(input.documentType)) return failure(400, "Invalid requested document type");
    const partyIds = Array.from(new Set(input.partyIds.map((id) => id.trim()).filter(Boolean)));
    if (partyIds.length === 0) return failure(400, "Select at least one client");
    let documentName: string;
    try {
      documentName = resolveDocumentRequestName(input.documentType, input.customDocumentName);
    } catch (error) {
      return failure(400, error instanceof Error ? error.message : "Invalid requested document");
    }
    const caseParties = await this.deps.listPartiesByCase(caseId);
    const selectedParties = partyIds.map((partyId) => caseParties.find((party) => party.id === partyId));
    if (selectedParties.some((party) => !party)) return failure(400, "Every selected party must belong to this case");
    if (selectedParties.some((party) => !party?.userId || !party.email)) {
      return failure(400, "Every selected client must have a linked portal account and email address");
    }

    const created: RequestView[] = [];
    for (const party of selectedParties as PartyRecord[]) {
      let request = await this.deps.createRequest({
        caseId,
        partyId: party.id,
        requestedBy: actor.id,
        documentType: input.documentType,
        documentName,
        instructions: input.instructions?.trim() || null,
        status: "outstanding",
        deliveryStatus: "not_attempted",
        deliveryLastAttemptedAt: null,
        deliveryError: null,
        submittedAt: null,
        completedAt: null,
        completedBy: null,
        returnedAt: null,
        returnedBy: null,
        returnReason: null,
        cancelledAt: null,
        cancelledBy: null,
      }, {
        activity: {
          caseId,
          type: "document_request_created",
          title: "Client document requested",
          description: `${actor.name || "Staff"} requested ${documentName} from ${party.firstName || "client"}.`,
          performedBy: actor.id,
          performedByName: actor.name || "Staff",
          actorType: actor.role === "mediator" ? "mediator" : "staff",
          relatedEntityType: "case_document_request",
          occurredAt: new Date(),
        },
        audit: {
          userId: actor.id,
          action: "create_document_request",
          entity: "case_document_request",
          entityRef: caseRecord.caseRef,
          details: JSON.stringify({ caseId, partyId: party.id, documentType: input.documentType }),
          ipAddress,
        },
      });
      const href = documentRequestHref(caseId, request.id);
      await this.updateNotificationBestEffort("Create", () => this.deps.createNotification({
        recipientId: party.userId!,
        recipientRole: "client",
        type: "case_document_request",
        urgency: "amber",
        caseId,
        documentRequestId: request.id,
        title: `Upload requested document: ${documentName}`,
        message: `Please upload ${documentName}. Open ${href}`,
        status: "active",
      }));
      const attemptedAt = new Date();
      const sent = await this.attemptRequestEmail({
        to: party.email!,
        clientName: `${party.firstName || ""} ${party.lastName || ""}`.trim() || "Client",
        caseRef: caseRecord.caseRef,
        documentName,
        instructions: input.instructions?.trim() || null,
        requestUrl: href,
      });
      request = await this.deps.updateRequest(request.id, {
        deliveryStatus: sent ? "sent" : "failed",
        deliveryLastAttemptedAt: attemptedAt,
        deliveryError: sent ? null : "Email send failed",
      }) || request;
      created.push(await this.view(request));
    }
    return { ok: true, requests: created };
  }

  async listCaseRequests(caseId: string, actor: Actor): Promise<{ ok: true; requests: Array<RequestView | ClientRequestView> } | ServiceFailure> {
    const caseRecord = await this.deps.getCase(caseId);
    if (!caseRecord) return failure(404, "Case not found");
    let rows: CaseDocumentRequest[];
    if (canManageDocumentRequests(caseRecord, actor)) {
      rows = await this.deps.listRequestsByCase(caseId);
    } else if (actor.role === "client") {
      const ownParties = (await this.deps.listPartiesByUserId(actor.id)).filter((party) => party.caseId === caseId);
      if (ownParties.length === 0) return failure(403, "Access denied");
      rows = await this.deps.listRequestsByPartyIds(ownParties.map((party) => party.id));
    } else {
      return failure(403, "Access denied");
    }
    return {
      ok: true,
      requests: await Promise.all(rows.map((row) => actor.role === "client" ? this.clientView(row) : this.view(row))),
    };
  }

  async submitRequest(
    id: string,
    actor: Actor,
    input: { fileName: string; fileData: string; mimeType?: string | null; fileSizeBytes?: number | null },
    ipAddress?: string,
  ): Promise<{ ok: true; request: ClientRequestView; document: ClientSubmissionView } | ServiceFailure> {
    const request = await this.deps.getRequest(id);
    if (!request) return failure(404, "Document request not found");
    if (actor.role !== "client") return failure(403, "Only the requested client can submit this document");
    const ownPartyIds = new Set((await this.deps.listPartiesByUserId(actor.id)).map((party) => party.id));
    if (!ownPartyIds.has(request.partyId)) return failure(404, "Document request not found");
    if (!canApplyDocumentRequestAction(request.status as DocumentRequestStatus, "submit")) {
      return failure(409, "This document request is not awaiting an upload");
    }
    const parsed = parseUploadData(input.fileData, input.mimeType);
    const validation = validateDocumentRequestUpload({
      fileName: input.fileName,
      mimeType: parsed.mimeType,
      sizeBytes: Math.max(input.fileSizeBytes || 0, parsed.buffer.byteLength),
    });
    if (!validation.ok) return validation;
    const safeFileName = `${crypto.randomUUID()}-${input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    const stored = await this.deps.saveFile({ fileName: safeFileName, buffer: parsed.buffer, mimeType: parsed.mimeType });
    let committed: { request: CaseDocumentRequest; document: CaseDocument } | undefined;
    try {
      committed = await this.deps.commitSubmission(request.id, { status: "submitted", submittedAt: new Date() }, {
        caseId: request.caseId,
        mediationSessionId: null,
        financialDisclosureFolderId: null,
        financialDisclosureItemId: null,
        financialDisclosureEvidenceCategoryId: null,
        financialDisclosureUploadTarget: null,
        documentRequestId: request.id,
        partyId: request.partyId,
        documentCategory: "requested_evidence",
        title: request.documentName,
        fileName: input.fileName,
        fileUrl: stored.fileUrl,
        storageKey: stored.storageKey,
        mimeType: parsed.mimeType,
        documentDate: null,
        fileSizeBytes: parsed.buffer.byteLength,
        uploadedBy: actor.id,
        reviewStatus: "draft",
        readyForReviewAt: null,
        reviewedBy: null,
        reviewedAt: null,
        sharedWithClients: false,
      }, this.lifecycleEvent({
        request,
        actor,
        type: "document_request_submitted",
        title: "Requested document submitted",
        description: `${request.documentName} was uploaded by the client.`,
        action: "submit_document_request",
        entityRef: request.caseId,
        details: { partyId: request.partyId, fileName: input.fileName },
        ipAddress,
      }));
    } catch (error) {
      await this.deps.deleteFile(stored.storageKey).catch((cleanupError) => console.error("[DocumentRequest] Failed to clean up uncommitted upload", cleanupError));
      throw error;
    }
    if (!committed) {
      await this.deps.deleteFile(stored.storageKey).catch((cleanupError) => console.error("[DocumentRequest] Failed to clean up losing concurrent upload", cleanupError));
      return failure(409, "This document request is not awaiting an upload");
    }
    const { request: submittedRequest, document } = committed;
    await this.updateNotificationBestEffort("Submission", () => this.deps.setNotificationCompleted(request.id));
    return {
      ok: true,
      request: await this.clientView(submittedRequest),
      document: clientSubmissionView(withProtectedCaseDocumentUrl(document) as SafeCaseDocument),
    };
  }

  async returnRequest(id: string, actor: Actor, reason: string, ipAddress?: string): Promise<{ ok: true; request: RequestView } | ServiceFailure> {
    const reasonText = reason.trim();
    if (!reasonText) return failure(400, "A return reason is required");
    const managed = await this.managedRequest(id, actor);
    if ("ok" in managed) return managed;
    if (!canApplyDocumentRequestAction(managed.request.status as DocumentRequestStatus, "return")) return failure(409, "Only a submitted document request can be returned");
    const updated = await this.deps.transitionRequest(id, ["submitted"], { status: "outstanding", returnedAt: new Date(), returnedBy: actor.id, returnReason: reasonText }, this.lifecycleEvent({ request: managed.request, actor, type: "document_request_returned", title: "Requested document returned", description: `${managed.request.documentName} was returned for another upload.`, action: "return_document_request", entityRef: managed.caseRecord.caseRef, details: { reason: reasonText }, ipAddress }));
    if (!updated) return failure(409, "Only a submitted document request can be returned");
    await this.updateNotificationBestEffort("Return", () => this.deps.setNotificationOutstanding(id));
    return { ok: true, request: await this.view(updated) };
  }

  async completeRequest(id: string, actor: Actor, ipAddress?: string): Promise<{ ok: true; request: RequestView } | ServiceFailure> {
    const managed = await this.managedRequest(id, actor);
    if ("ok" in managed) return managed;
    if (!canApplyDocumentRequestAction(managed.request.status as DocumentRequestStatus, "complete")) return failure(409, "Only a submitted document request can be completed");
    const updated = await this.deps.transitionRequest(id, ["submitted"], { status: "completed", completedAt: new Date(), completedBy: actor.id }, this.lifecycleEvent({ request: managed.request, actor, type: "document_request_completed", title: "Requested document completed", description: `${managed.request.documentName} was marked complete.`, action: "complete_document_request", entityRef: managed.caseRecord.caseRef, details: { partyId: managed.request.partyId }, ipAddress }));
    if (!updated) return failure(409, "Only a submitted document request can be completed");
    await this.updateNotificationBestEffort("Completion", () => this.deps.setNotificationCompleted(id));
    return { ok: true, request: await this.view(updated) };
  }

  async cancelRequest(id: string, actor: Actor, ipAddress?: string): Promise<{ ok: true; request: RequestView } | ServiceFailure> {
    const managed = await this.managedRequest(id, actor);
    if ("ok" in managed) return managed;
    if (!canApplyDocumentRequestAction(managed.request.status as DocumentRequestStatus, "cancel")) return failure(409, "This document request cannot be cancelled");
    const updated = await this.deps.transitionRequest(id, ["outstanding", "submitted"], { status: "cancelled", cancelledAt: new Date(), cancelledBy: actor.id }, this.lifecycleEvent({ request: managed.request, actor, type: "document_request_cancelled", title: "Client document request cancelled", description: `${managed.request.documentName} was cancelled.`, action: "cancel_document_request", entityRef: managed.caseRecord.caseRef, details: { partyId: managed.request.partyId }, ipAddress }));
    if (!updated) return failure(409, "This document request cannot be cancelled");
    await this.updateNotificationBestEffort("Cancellation", () => this.deps.setNotificationCompleted(id));
    return { ok: true, request: await this.view(updated) };
  }

  async resendRequest(id: string, actor: Actor, ipAddress?: string): Promise<{ ok: true; request: RequestView } | ServiceFailure> {
    const managed = await this.managedRequest(id, actor);
    if ("ok" in managed) return managed;
    if (managed.request.status === "completed" || managed.request.status === "cancelled") return failure(409, "This document request is closed");
    const party = (await this.deps.listPartiesByCase(managed.request.caseId)).find((candidate) => candidate.id === managed.request.partyId);
    if (!party?.userId || !party.email) return failure(400, "The requested client no longer has a linked portal account and email address");
    const sent = await this.attemptRequestEmail({
      to: party.email,
      clientName: `${party.firstName || ""} ${party.lastName || ""}`.trim() || "Client",
      caseRef: managed.caseRecord.caseRef,
      documentName: managed.request.documentName,
      instructions: managed.request.instructions,
      requestUrl: documentRequestHref(managed.request.caseId, managed.request.id),
    });
    const updated = await this.deps.updateRequest(id, { deliveryStatus: sent ? "sent" : "failed", deliveryLastAttemptedAt: new Date(), deliveryError: sent ? null : "Email send failed" }, this.lifecycleEvent({ request: managed.request, actor, type: "document_request_email_resent", title: "Document request email resent", description: `${managed.request.documentName} request email was ${sent ? "sent" : "not delivered"}.`, action: "resend_document_request", entityRef: managed.caseRecord.caseRef, details: { sent }, ipAddress }));
    if (!updated) return failure(500, "Failed to update document request delivery");
    return { ok: true, request: await this.view(updated) };
  }
}

function absolutePortalUrl(relativeUrl: string): string {
  const baseUrl = (process.env.APP_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, "");
  return `${baseUrl}${relativeUrl}`;
}

const defaultDependencies: DocumentRequestServiceDependencies = {
  async getCase(id) { return (await import("../storage")).storage.getCase(id); },
  async listPartiesByCase(caseId) { return (await import("../storage")).storage.listPartiesByCase(caseId); },
  async listPartiesByUserId(userId) { return (await import("../storage")).storage.listPartiesByUserId(userId); },
  async createRequest(data, event) { return (await import("../storage")).storage.createCaseDocumentRequest(data, event); },
  async getRequest(id) { return (await import("../storage")).storage.getCaseDocumentRequest(id); },
  async listRequestsByCase(caseId) { return (await import("../storage")).storage.listCaseDocumentRequests(caseId); },
  async listRequestsByPartyIds(partyIds) { return (await import("../storage")).storage.listCaseDocumentRequestsByPartyIds(partyIds); },
  async updateRequest(id, updates, event) { return (await import("../storage")).storage.updateCaseDocumentRequest(id, updates, event); },
  async transitionRequest(id, expectedStatuses, updates, event) { return (await import("../storage")).storage.transitionCaseDocumentRequest(id, expectedStatuses, updates, event); },
  async commitSubmission(id, requestUpdates, documentData, event) { return (await import("../storage")).storage.commitCaseDocumentRequestSubmission(id, requestUpdates, documentData, event); },
  async listDocumentsByRequestId(requestId) { return (await import("../storage")).storage.listCaseDocumentsByRequestId(requestId); },
  async saveFile(input) { return (await import("./file-storage.service")).fileStorageService.saveCaseDocumentFile(input); },
  async deleteFile(storageKey) { return (await import("./file-storage.service")).fileStorageService.deleteCaseDocumentFile(storageKey); },
  async sendRequestEmail(input) {
    return (await import("./document-request-email.service")).sendClientDocumentRequestEmail({ ...input, requestUrl: absolutePortalUrl(input.requestUrl) });
  },
  async createNotification(input) { return (await import("./notification.service")).notificationService.createNotification(input); },
  async setNotificationCompleted(requestId) { await (await import("./notification.service")).notificationService.completeDocumentRequestNotification(requestId); },
  async setNotificationOutstanding(requestId) { await (await import("./notification.service")).notificationService.reopenDocumentRequestNotification(requestId); },
};

export const documentRequestService = new DocumentRequestService(defaultDependencies);
