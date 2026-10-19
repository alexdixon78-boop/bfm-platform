import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, gte, ilike, isNull, lte, notInArray } from "drizzle-orm";
import { db } from "../db";
import {
  caseComplaintAttachments,
  caseComplaintEvents,
  caseComplaints,
  cases,
  notifications,
  notificationAssignees,
  users,
  type CaseComplaint,
  type ComplaintSubmissionInput,
  type User,
} from "@shared/schema";
import { classifyCaseAccess } from "../security/case-access-policy";
import { canSubmitCaseComplaint, canTransitionComplaint } from "../security/complaint-policy";
import { toSubmitterComplaintStatus } from "../security/complaint-projection";
import { validateComplaintAttachments } from "../security/complaint-attachments";
import { addEnglandWalesWorkingDays } from "../utils/uk-business-days";
import { fileStorageService } from "./file-storage.service";
import { sendComplaintAdminAlertEmail, sendComplaintReceiptEmail, sendComplaintStatusEmail } from "./email.service";
import { logAudit } from "./audit-log.service";
import { notificationRealtimeService } from "./notification-realtime.service";

export class ComplaintServiceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function validateAttachments(input: ComplaintSubmissionInput["attachments"]) {
  try {
    return validateComplaintAttachments(input);
  } catch (error) {
    throw new ComplaintServiceError(error instanceof Error ? error.message : "Invalid complaint attachment", 400);
  }
}

type Actor = Pick<User, "id" | "role" | "name" | "email">;

function fmcTiming(incidentDate: string | null | undefined, receivedAt: Date) {
  if (!incidentDate) return { relevantDate: null, within: null };
  const relevantDate = new Date(`${incidentDate}T12:00:00.000Z`);
  if (Number.isNaN(relevantDate.getTime())) return { relevantDate: null, within: null };
  const cutoff = new Date(relevantDate);
  cutoff.setUTCMonth(cutoff.getUTCMonth() + 3);
  return { relevantDate, within: receivedAt <= cutoff };
}

const TERMINAL_COMPLAINT_STATUSES = new Set(["closed", "withdrawn", "duplicate"]);

function taskStateForComplaint(complaint: CaseComplaint) {
  if (TERMINAL_COMPLAINT_STATUSES.has(complaint.status)) {
    return { status: "completed", followUpDate: null } as const;
  }
  if (!complaint.acknowledgedAt) {
    return { status: "follow_up", followUpDate: complaint.acknowledgementDueAt } as const;
  }
  if (complaint.status === "response_issued") {
    return complaint.nextUpdateAt
      ? { status: "follow_up", followUpDate: complaint.nextUpdateAt } as const
      : { status: "active", followUpDate: null } as const;
  }
  const followUpDate = complaint.nextUpdateAt && complaint.nextUpdateAt < complaint.responseDueAt
    ? complaint.nextUpdateAt
    : complaint.responseDueAt;
  return { status: "follow_up", followUpDate } as const;
}

async function singletonSuperadmin() {
  const rows = await db.select().from(users).where(eq(users.role, "superadmin")).limit(2);
  if (rows.length !== 1 || rows[0].status !== "active") throw new ComplaintServiceError("Complaint service is not configured", 503);
  return rows[0];
}

class CaseComplaintService {
  private async notifySubmitter(complaint: CaseComplaint) {
    if (!complaint.submitterEmail) return;
    try {
      const appUrl = process.env.APP_URL ?? process.env.BASE_URL ?? "https://brighterfuturemediation.co.uk";
      const sent = await sendComplaintStatusEmail(complaint.submitterEmail, complaint.complaintRef, `${appUrl}/complaints/${complaint.id}`);
      await db.insert(caseComplaintEvents).values({ complaintId: complaint.id, type: "email_delivery", visibility: "internal", actorName: "System", message: "Complainant update email attempted", metadata: { status: sent ? "sent" : "failed" } });
    } catch (error) {
      console.error("[Complaints] Unable to record complainant email delivery status", error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async resolveCase(input: ComplaintSubmissionInput, actor: Actor) {
    const [caseRecord] = input.caseId
      ? await db.select().from(cases).where(eq(cases.id, input.caseId)).limit(1)
      : await db.select().from(cases).where(eq(cases.caseRef, input.caseRef!)).limit(1);
    if (!caseRecord) throw new ComplaintServiceError("Case reference not found or unavailable", 404);
    const access = actor.role === "staff"
      ? { tier: "none" as const }
      : await classifyCaseAccess(caseRecord.id, actor);
    const lookupMode = input.caseRef ? "case_ref" : "case_id";
    if (!canSubmitCaseComplaint(actor.role, access.tier, lookupMode)) {
      throw new ComplaintServiceError("Case reference not found or unavailable", 404);
    }
    return { caseRecord, partyId: access.tier === "client_party" ? access.partyId : null };
  }

  async submit(input: ComplaintSubmissionInput, actor: Actor) {
    const [{ caseRecord, partyId }, superadmin] = await Promise.all([
      this.resolveCase(input, actor), singletonSuperadmin(),
    ]);
    if (actor.role !== "superadmin" && (input.onBehalfOfName || input.onBehalfOfEmail || input.submissionChannel !== "portal")) {
      throw new ComplaintServiceError("Only the superadmin can record an on-behalf-of complaint");
    }
    const validated = validateAttachments(input.attachments);
    const stored = [] as Array<(typeof validated)[number] & { storageKey: string }>;
    try {
      for (const attachment of validated) {
        const storedFile = await fileStorageService.saveComplaintAttachment({
          fileName: `${randomUUID()}${path.extname(attachment.fileName).toLowerCase()}`,
          buffer: attachment.buffer,
          mimeType: attachment.mimeType,
        });
        stored.push({ ...attachment, storageKey: storedFile.storageKey });
      }
    } catch (error) {
      await Promise.allSettled(stored.map((file) => fileStorageService.deleteComplaintAttachment(file.storageKey)));
      throw error;
    }

    const receivedAt = new Date();
    const timing = fmcTiming(input.incidentDate, receivedAt);
    let createdBundle: { complaint: CaseComplaint; task: typeof notifications.$inferSelect };
    try {
      createdBundle = await db.transaction(async (tx) => {
      const [created] = await tx.insert(caseComplaints).values({
        caseId: caseRecord.id,
        submittedBy: actor.id,
        submittedByRole: actor.role,
        submitterName: actor.name,
        submitterEmail: input.onBehalfOfEmail || actor.email,
        complainantPartyId: partyId,
        submissionChannel: input.submissionChannel,
        onBehalfOfName: input.onBehalfOfName,
        onBehalfOfEmail: input.onBehalfOfEmail,
        category: input.category,
        targetType: input.targetType,
        targetUserId: input.targetUserId,
        targetName: input.targetName,
        incidentDate: input.incidentDate,
        details: input.details,
        desiredResolution: input.desiredResolution,
        supportingNotes: input.supportingNotes,
        receivedAt,
        acknowledgementDueAt: addEnglandWalesWorkingDays(receivedAt, 10),
        responseDueAt: addEnglandWalesWorkingDays(receivedAt, 30),
        fmcRelevantDate: timing.relevantDate,
        fmcWithinThreeMonths: timing.within,
      }).returning();
      const [event] = await tx.insert(caseComplaintEvents).values({
        complaintId: created.id,
        type: "submitted",
        visibility: "submitter",
        actorId: actor.id,
        actorName: actor.name,
        message: "Complaint received",
        toStatus: "received",
      }).returning();
      if (stored.length) {
        await tx.insert(caseComplaintAttachments).values(stored.map((file) => ({
          complaintId: created.id,
          eventId: event.id,
          uploadedBy: actor.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey: file.storageKey,
        })));
      }
      const [task] = await tx.insert(notifications).values({
        recipientId: superadmin.id,
        recipientRole: "superadmin",
        type: "complaint_review",
        urgency: "red",
        complaintId: created.id,
        caseId: null,
        title: `Complaint review — ${created.complaintRef}`,
        message: "A confidential complaint requires review.",
        status: "follow_up",
        assignedTo: superadmin.id,
        followUpDate: created.acknowledgementDueAt,
        caseNoteRequired: false,
      }).returning();
      await tx.insert(notificationAssignees).values({ notificationId: task.id, userId: superadmin.id, assignedBy: actor.id });
      const [withTask] = await tx.update(caseComplaints).set({ reviewTaskId: task.id, updatedAt: new Date() })
        .where(eq(caseComplaints.id, created.id)).returning();
        return { complaint: withTask, task };
      });
    } catch (error) {
      await Promise.allSettled(stored.map((file) => fileStorageService.deleteComplaintAttachment(file.storageKey)));
      throw error;
    }

    const { complaint, task } = createdBundle;
    notificationRealtimeService.broadcastToNotificationAudience({ ...task, assignedUserIds: [superadmin.id] });
    await logAudit({ userId: actor.id, action: "create", entity: "case_complaint", entityId: complaint.id, entityRef: complaint.complaintRef, details: JSON.stringify({ status: "received" }) });
    try {
      const appUrl = process.env.APP_URL ?? process.env.BASE_URL ?? "https://brighterfuturemediation.co.uk";
      const adminEmailSent = await sendComplaintAdminAlertEmail(superadmin.email, complaint.complaintRef, `${appUrl}/complaints/${complaint.id}`);
      await db.insert(caseComplaintEvents).values({ complaintId: complaint.id, type: "email_delivery", visibility: "internal", actorName: "System", message: "Superadmin complaint alert attempted", metadata: { recipient: "superadmin", status: adminEmailSent ? "sent" : "failed" } });
    } catch (error) {
      console.error("[Complaints] Unable to record superadmin email delivery status", error instanceof Error ? error.message : "Unknown error");
    }
    try {
      await this.deliverReceipt(complaint, caseRecord.caseRef);
    } catch (error) {
      console.error("[Complaints] Unable to record receipt email delivery status", error instanceof Error ? error.message : "Unknown error");
    }
    return { id: complaint.id, complaintRef: complaint.complaintRef, caseRef: caseRecord.caseRef, status: complaint.status, receivedAt };
  }

  private async deliverReceipt(complaint: CaseComplaint, caseRef: string) {
    if (!complaint.submitterEmail) return;
    const attemptedAt = new Date();
    const appUrl = process.env.APP_URL ?? process.env.BASE_URL ?? "https://brighterfuturemediation.co.uk";
    const sent = await sendComplaintReceiptEmail(complaint.submitterEmail, complaint.complaintRef, caseRef, complaint.receivedAt, `${appUrl}/complaints/${complaint.id}`);
    await db.update(caseComplaints).set({
      receiptEmailStatus: sent ? "sent" : "failed",
      receiptEmailLastAttemptedAt: attemptedAt,
      receiptEmailSentAt: sent ? new Date() : complaint.receiptEmailSentAt,
      receiptEmailLastError: sent ? null : "Email delivery failed",
      updatedAt: new Date(),
    }).where(eq(caseComplaints.id, complaint.id));
  }

  async list(actor: Actor, query: Record<string, unknown>) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    const conditions = [];
    if (typeof query.status === "string" && query.status) conditions.push(eq(caseComplaints.status, query.status));
    if (typeof query.category === "string" && query.category) conditions.push(eq(caseComplaints.category, query.category));
    if (typeof query.caseRef === "string" && query.caseRef) conditions.push(ilike(cases.caseRef, `%${query.caseRef}%`));
    if (typeof query.subject === "string" && query.subject) conditions.push(ilike(caseComplaints.targetName, `%${query.subject}%`));
    if (typeof query.from === "string" && query.from) conditions.push(gte(caseComplaints.receivedAt, new Date(query.from)));
    if (typeof query.to === "string" && query.to) conditions.push(lte(caseComplaints.receivedAt, new Date(`${query.to}T23:59:59.999Z`)));
    if (query.overdueAcknowledgement === "true") conditions.push(and(notInArray(caseComplaints.status, ["closed", "withdrawn", "duplicate"]), isNull(caseComplaints.acknowledgedAt), lte(caseComplaints.acknowledgementDueAt, new Date()))!);
    if (query.overdueResponse === "true") conditions.push(and(notInArray(caseComplaints.status, ["closed", "withdrawn", "duplicate"]), isNull(caseComplaints.finalResponseAt), lte(caseComplaints.responseDueAt, new Date()))!);
    return db.select({ complaint: caseComplaints, caseRef: cases.caseRef }).from(caseComplaints)
      .innerJoin(cases, eq(cases.id, caseComplaints.caseId))
      .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(caseComplaints.receivedAt));
  }

  async listMine(actor: Actor, caseId?: string) {
    const condition = caseId
      ? and(eq(caseComplaints.submittedBy, actor.id), eq(caseComplaints.caseId, caseId))
      : eq(caseComplaints.submittedBy, actor.id);
    const rows = await db.select({ complaint: caseComplaints, caseRef: cases.caseRef }).from(caseComplaints)
      .innerJoin(cases, eq(cases.id, caseComplaints.caseId)).where(condition).orderBy(desc(caseComplaints.receivedAt));
    return Promise.all(rows.map(({ complaint, caseRef }) => this.safeDetail(complaint, caseRef)));
  }

  private async safeDetail(complaint: CaseComplaint, caseRef: string) {
    const events = await db.select().from(caseComplaintEvents).where(and(
      eq(caseComplaintEvents.complaintId, complaint.id), eq(caseComplaintEvents.visibility, "submitter"),
    )).orderBy(asc(caseComplaintEvents.createdAt));
    return toSubmitterComplaintStatus({ complaint: { ...complaint, caseRef }, events });
  }

  async get(id: string, actor: Actor) {
    const [row] = await db.select({ complaint: caseComplaints, caseRef: cases.caseRef }).from(caseComplaints)
      .innerJoin(cases, eq(cases.id, caseComplaints.caseId)).where(eq(caseComplaints.id, id)).limit(1);
    if (!row || (actor.role !== "superadmin" && row.complaint.submittedBy !== actor.id)) throw new ComplaintServiceError("Not found", 404);
    if (actor.role !== "superadmin") return this.safeDetail(row.complaint, row.caseRef);
    const [events, attachments] = await Promise.all([
      db.select().from(caseComplaintEvents).where(eq(caseComplaintEvents.complaintId, id)).orderBy(asc(caseComplaintEvents.createdAt)),
      db.select({ id: caseComplaintAttachments.id, fileName: caseComplaintAttachments.fileName, mimeType: caseComplaintAttachments.mimeType, sizeBytes: caseComplaintAttachments.sizeBytes, createdAt: caseComplaintAttachments.createdAt, redactedAt: caseComplaintAttachments.redactedAt }).from(caseComplaintAttachments).where(eq(caseComplaintAttachments.complaintId, id)),
    ]);
    return { ...row.complaint, caseRef: row.caseRef, events, attachments };
  }

  async listForCase(caseId: string, actor: Actor) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    return db.select().from(caseComplaints).where(eq(caseComplaints.caseId, caseId)).orderBy(desc(caseComplaints.receivedAt));
  }

  async changeStatus(id: string, actor: Actor, input: { status: string; clarificationRequest?: string; releasedResponse?: string; outcome?: string; resolutionSummary?: string; duplicateOfId?: string }) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    const [current] = await db.select().from(caseComplaints).where(eq(caseComplaints.id, id)).limit(1);
    if (!current) throw new ComplaintServiceError("Not found", 404);
    if (!canTransitionComplaint(current.status as any, input.status as any)) throw new ComplaintServiceError("Invalid complaint status transition", 409);
    if (input.status === "duplicate") {
      if (input.duplicateOfId === id) throw new ComplaintServiceError("A complaint cannot duplicate itself");
      const [original] = await db.select({ id: caseComplaints.id }).from(caseComplaints).where(eq(caseComplaints.id, input.duplicateOfId!)).limit(1);
      if (!original) throw new ComplaintServiceError("Original complaint not found", 404);
    }
    const now = new Date();
    const eventType = input.status === "acknowledged" ? "acknowledged" : input.status === "awaiting_information" ? "clarification_requested" : input.status === "response_issued" ? "response_issued" : input.status === "closed" ? "closed" : input.status === "withdrawn" ? "withdrawn" : input.status === "duplicate" ? "duplicate_marked" : "status_changed";
    const message = input.clarificationRequest || input.releasedResponse || input.resolutionSummary || `Status changed to ${input.status}`;
    const visibility = ["acknowledged", "clarification_requested", "response_issued", "closed", "withdrawn", "duplicate_marked"].includes(eventType) ? "submitter" : "internal";
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(caseComplaints).set({
        status: input.status,
        acknowledgedAt: input.status === "acknowledged" ? now : current.acknowledgedAt,
        acknowledgedBy: input.status === "acknowledged" ? actor.id : current.acknowledgedBy,
        finalResponseAt: input.status === "response_issued" ? now : current.finalResponseAt,
        closedAt: ["closed", "withdrawn", "duplicate"].includes(input.status) ? now : current.closedAt,
        closedBy: ["closed", "withdrawn", "duplicate"].includes(input.status) ? actor.id : current.closedBy,
        outcome: input.outcome || (input.status === "withdrawn" ? "withdrawn" : input.status === "duplicate" ? "duplicate" : current.outcome),
        resolutionSummary: input.resolutionSummary || current.resolutionSummary,
        duplicateOfId: input.duplicateOfId || current.duplicateOfId,
        updatedAt: now,
      }).where(and(eq(caseComplaints.id, id), eq(caseComplaints.status, current.status))).returning();
      if (!row) throw new ComplaintServiceError("Complaint status changed; refresh and try again", 409);
      await tx.insert(caseComplaintEvents).values({ complaintId: id, type: eventType, visibility, actorId: actor.id, actorName: actor.name, message, fromStatus: current.status, toStatus: input.status });
      if (current.reviewTaskId) {
        const taskState = taskStateForComplaint(row);
        await tx.update(notifications).set(taskState.status === "completed"
          ? { ...taskState, completedBy: actor.id, completedAt: now }
          : { ...taskState, completedBy: null, completedAt: null }).where(eq(notifications.id, current.reviewTaskId));
      }
      return row;
    });
    await logAudit({ userId: actor.id, action: "update", entity: "case_complaint", entityId: id, entityRef: current.complaintRef, details: JSON.stringify({ fromStatus: current.status, toStatus: input.status }) });
    if (visibility === "submitter") await this.notifySubmitter(updated);
    return updated;
  }

  async addNote(id: string, actor: Actor, input: { message: string; visibility: "internal" | "submitter"; nextUpdateAt?: string }) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    const event = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(caseComplaints).where(eq(caseComplaints.id, id)).for("update").limit(1);
      if (!current) throw new ComplaintServiceError("Not found", 404);
      if (input.nextUpdateAt && TERMINAL_COMPLAINT_STATUSES.has(current.status)) throw new ComplaintServiceError("A closed complaint cannot have a next-update date", 409);
      const nextUpdateAt = input.nextUpdateAt ? new Date(input.nextUpdateAt) : current.nextUpdateAt;
      if (input.nextUpdateAt && nextUpdateAt! <= new Date()) throw new ComplaintServiceError("Next-update date must be in the future");
      const [created] = await tx.insert(caseComplaintEvents).values({ complaintId: id, type: input.visibility === "internal" ? "internal_note" : "released_update", visibility: input.visibility, actorId: actor.id, actorName: actor.name, message: input.message, metadata: input.nextUpdateAt ? { nextUpdateAt: input.nextUpdateAt } : {} }).returning();
      if (input.nextUpdateAt) {
        const [complaint] = await tx.update(caseComplaints).set({ nextUpdateAt, updatedAt: new Date() }).where(eq(caseComplaints.id, id)).returning();
        if (complaint?.reviewTaskId) await tx.update(notifications).set(taskStateForComplaint(complaint)).where(eq(notifications.id, complaint.reviewTaskId));
      }
      return created;
    });
    if (input.visibility === "submitter") {
      const [complaint] = await db.select().from(caseComplaints).where(eq(caseComplaints.id, id)).limit(1);
      if (complaint) await this.notifySubmitter(complaint);
    }
    return event;
  }

  async extendDeadline(id: string, actor: Actor, input: { responseDueAt: string; reason: string; releasedUpdate: string }) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    const [current] = await db.select().from(caseComplaints).where(eq(caseComplaints.id, id)).limit(1);
    if (!current) throw new ComplaintServiceError("Not found", 404);
    if (TERMINAL_COMPLAINT_STATUSES.has(current.status)) throw new ComplaintServiceError("A closed complaint deadline cannot be extended", 409);
    const revised = new Date(input.responseDueAt);
    if (revised <= current.responseDueAt) throw new ComplaintServiceError("Revised deadline must be later than the current deadline");
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(caseComplaints).where(eq(caseComplaints.id, id)).for("update").limit(1);
      if (!locked || TERMINAL_COMPLAINT_STATUSES.has(locked.status)) throw new ComplaintServiceError("A closed complaint deadline cannot be extended", 409);
      if (revised <= locked.responseDueAt) throw new ComplaintServiceError("Revised deadline must be later than the current deadline");
      const [complaint] = await tx.update(caseComplaints).set({ responseDueAt: revised, updatedAt: new Date() }).where(eq(caseComplaints.id, id)).returning();
      await tx.insert(caseComplaintEvents).values({ complaintId: id, type: "deadline_extended", visibility: "submitter", actorId: actor.id, actorName: actor.name, message: input.releasedUpdate, metadata: { reason: input.reason, previousDate: locked.responseDueAt.toISOString(), revisedDate: revised.toISOString() } });
      if (locked.reviewTaskId) await tx.update(notifications).set(taskStateForComplaint(complaint)).where(eq(notifications.id, locked.reviewTaskId));
    });
    const [updated] = await db.select().from(caseComplaints).where(eq(caseComplaints.id, id)).limit(1);
    if (updated) await this.notifySubmitter(updated);
    return this.get(id, actor);
  }

  async escalate(id: string, actor: Actor, input: { destination: string; note: string }) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    await this.get(id, actor);
    await db.transaction(async (tx) => {
      await tx.update(caseComplaints).set({ escalatedAt: new Date(), updatedAt: new Date() }).where(eq(caseComplaints.id, id));
      await tx.insert(caseComplaintEvents).values({ complaintId: id, type: "escalated", visibility: "internal", actorId: actor.id, actorName: actor.name, message: input.note, metadata: { destination: input.destination } });
    });
    return this.get(id, actor);
  }

  async reply(id: string, actor: Actor, input: { requestEventId: string; response: string; attachments: ComplaintSubmissionInput["attachments"] }) {
    const [complaint] = await db.select().from(caseComplaints).where(and(eq(caseComplaints.id, id), eq(caseComplaints.submittedBy, actor.id))).limit(1);
    if (!complaint) throw new ComplaintServiceError("Not found", 404);
    const [request] = await db.select().from(caseComplaintEvents).where(and(eq(caseComplaintEvents.id, input.requestEventId), eq(caseComplaintEvents.complaintId, id), eq(caseComplaintEvents.type, "clarification_requested"))).limit(1);
    if (!request || complaint.status !== "awaiting_information") throw new ComplaintServiceError("Clarification request is not open", 409);
    const [existingReply] = await db.select({ id: caseComplaintEvents.id }).from(caseComplaintEvents).where(and(eq(caseComplaintEvents.relatedEventId, request.id), eq(caseComplaintEvents.type, "clarification_replied"))).limit(1);
    if (existingReply) throw new ComplaintServiceError("Clarification request has already been answered", 409);
    const files = validateAttachments(input.attachments);
    const stored = [] as Array<(typeof files)[number] & { storageKey: string }>;
    try {
      for (const file of files) {
        const result = await fileStorageService.saveComplaintAttachment({ fileName: `${randomUUID()}${path.extname(file.fileName).toLowerCase()}`, buffer: file.buffer, mimeType: file.mimeType });
        stored.push({ ...file, storageKey: result.storageKey });
      }
    } catch (error) {
      await Promise.allSettled(stored.map((file) => fileStorageService.deleteComplaintAttachment(file.storageKey)));
      throw error;
    }
    try {
      await db.transaction(async (tx) => {
        const [lockedComplaint] = await tx.select().from(caseComplaints)
          .where(and(eq(caseComplaints.id, id), eq(caseComplaints.submittedBy, actor.id)))
          .for("update").limit(1);
        if (!lockedComplaint || lockedComplaint.status !== "awaiting_information") throw new ComplaintServiceError("Clarification request is not open", 409);
        const [latestRequest] = await tx.select().from(caseComplaintEvents).where(and(
          eq(caseComplaintEvents.complaintId, id), eq(caseComplaintEvents.type, "clarification_requested"),
        )).orderBy(desc(caseComplaintEvents.createdAt)).limit(1);
        if (!latestRequest || latestRequest.id !== input.requestEventId) throw new ComplaintServiceError("Only the latest clarification request can be answered", 409);
        const [transactionReply] = await tx.select({ id: caseComplaintEvents.id }).from(caseComplaintEvents).where(and(
          eq(caseComplaintEvents.relatedEventId, latestRequest.id), eq(caseComplaintEvents.type, "clarification_replied"),
        )).limit(1);
        if (transactionReply) throw new ComplaintServiceError("Clarification request has already been answered", 409);
        const [event] = await tx.insert(caseComplaintEvents).values({ complaintId: id, type: "clarification_replied", visibility: "submitter", actorId: actor.id, actorName: actor.name, message: input.response, relatedEventId: request.id }).returning();
        if (stored.length) await tx.insert(caseComplaintAttachments).values(stored.map((file) => ({ complaintId: id, eventId: event.id, uploadedBy: actor.id, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, storageKey: file.storageKey })));
        const [updated] = await tx.update(caseComplaints).set({ status: "under_review", updatedAt: new Date() })
          .where(and(eq(caseComplaints.id, id), eq(caseComplaints.status, "awaiting_information"))).returning();
        if (!updated) throw new ComplaintServiceError("Complaint status changed; refresh and try again", 409);
        if (updated.reviewTaskId) await tx.update(notifications).set({ ...taskStateForComplaint(updated), urgency: "red" }).where(eq(notifications.id, updated.reviewTaskId));
      });
    } catch (error) {
      await Promise.allSettled(stored.map((file) => fileStorageService.deleteComplaintAttachment(file.storageKey)));
      throw error;
    }
    return this.get(id, actor);
  }

  async retryReceipt(id: string, actor: Actor) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    const [row] = await db.select({ complaint: caseComplaints, caseRef: cases.caseRef }).from(caseComplaints).innerJoin(cases, eq(cases.id, caseComplaints.caseId)).where(eq(caseComplaints.id, id)).limit(1);
    if (!row) throw new ComplaintServiceError("Not found", 404);
    await this.deliverReceipt(row.complaint, row.caseRef);
    return this.get(id, actor);
  }

  async redactEvent(id: string, eventId: string, actor: Actor, reason: string) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(caseComplaintEvents).set({ redactedAt: new Date(), redactedBy: actor.id, redactionReason: reason })
        .where(and(eq(caseComplaintEvents.id, eventId), eq(caseComplaintEvents.complaintId, id))).returning();
      if (!updated) throw new ComplaintServiceError("Not found", 404);
      await tx.insert(caseComplaintEvents).values({ complaintId: id, type: "redacted", visibility: "internal", actorId: actor.id, actorName: actor.name, message: "An event was redacted", metadata: { eventId, reason } });
      return updated;
    });
  }

  async redactAttachment(id: string, attachmentId: string, actor: Actor, reason: string) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    return db.transaction(async (tx) => {
      const [updated] = await tx.update(caseComplaintAttachments).set({ redactedAt: new Date(), redactedBy: actor.id, redactionReason: reason })
        .where(and(eq(caseComplaintAttachments.id, attachmentId), eq(caseComplaintAttachments.complaintId, id))).returning();
      if (!updated) throw new ComplaintServiceError("Not found", 404);
      await tx.insert(caseComplaintEvents).values({ complaintId: id, type: "redacted", visibility: "internal", actorId: actor.id, actorName: actor.name, message: "An attachment was redacted", metadata: { attachmentId, reason } });
      return updated;
    });
  }

  async openAttachment(attachmentId: string, actor: Actor) {
    if (actor.role !== "superadmin") throw new ComplaintServiceError("Not found", 404);
    const [attachment] = await db.select().from(caseComplaintAttachments).where(eq(caseComplaintAttachments.id, attachmentId)).limit(1);
    if (!attachment || attachment.redactedAt) throw new ComplaintServiceError("Not found", 404);
    return { attachment, file: await fileStorageService.openComplaintAttachment(attachment.storageKey) };
  }
}

export const caseComplaintService = new CaseComplaintService();
