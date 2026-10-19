import crypto from "crypto";
import { db } from "../db";
import { logAudit } from "./audit-log.service";
import { googleCalendarService, BFM_EMAIL, hasWriteScope } from "./google-calendar.service";
import { outlookCalendarService } from "./outlook-calendar.service";
import {
  assertActiveMediatorCalendarProvider,
  getMediatorCalendarProviderService,
  isCalendarProvider,
  type CalendarProvider,
} from "./mediator-calendar-provider.service";
import { storage } from "../storage";
import { notificationService } from "./notification.service";
import { buildAvailabilityFingerprint } from "./calendar-availability-reconciliation";
import { fileStorageService } from "./file-storage.service";
import { startOfTodayInUk } from "../utils/uk-wall-clock";
import {
  appointments,
  auditLogs,
  mediatorCalendarAvailabilitySources,
  mediatorServiceApprovals,
  mediatorServiceScheduleSlots,
  mediatorServiceTypes,
  notifications,
  tasks,
  type MediatorServiceApproval,
  type MediatorServiceScheduleSlot,
  type MediatorServiceApprovalStatus,
  type Appointment,
  type ServiceType,
} from "@shared/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

const REMINDER_WINDOW_DAYS = 7;
const SERVICE_APPROVAL_DECISION_NOTIFICATION_TYPES = {
  approved: "service_approval_approved",
  rejected: "service_approval_rejected",
  revoked: "service_approval_revoked",
} as const;

function parseExpiryDate(expiryDate: string | null | undefined): Date | null {
  if (!expiryDate) return null;
  const parsed = new Date(`${expiryDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isExpired(expiryDate: string | null | undefined, now = new Date()): boolean {
  const parsed = parseExpiryDate(expiryDate);
  if (!parsed) return false;
  // An approval remains valid throughout its stated expiry date and expires
  // at the start of the following UTC date.
  return parsed.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function isDueForReminder(expiryDate: string | null | undefined, reminderSentAt: Date | null | undefined, now = new Date()): boolean {
  if (reminderSentAt) return false;
  const parsed = parseExpiryDate(expiryDate);
  if (!parsed) return false;
  const reminderDate = new Date(parsed.getTime() - REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return reminderDate.getTime() <= todayStart && parsed.getTime() >= todayStart;
}

function slotKey(startAt: Date, endAt: Date) {
  return `${startAt.toISOString()}|${endAt.toISOString()}`;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function rangeContains(outerStart: Date, outerEnd: Date, innerStart: Date, innerEnd: Date): boolean {
  return outerStart <= innerStart && innerEnd <= outerEnd;
}

function appointmentRange(appt: Pick<Appointment, "dateTime" | "duration">): { startAt: Date; endAt: Date } {
  const startAt = new Date(appt.dateTime);
  const endAt = new Date(startAt.getTime() + appt.duration * 60000);
  return { startAt, endAt };
}

function formatAppointmentTime(startAt: Date, endAt: Date): string {
  return `${startAt.toLocaleString("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/London",
  })}-${endAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  })}`;
}

export function getEffectiveApprovalStatus(row: Pick<MediatorServiceApproval, "status" | "expiryDate" | "expiredAt">): MediatorServiceApprovalStatus {
  if ((row.status === "approved" || row.status === "pending_review") && isExpired(row.expiryDate)) {
    return "expired";
  }
  return row.status as MediatorServiceApprovalStatus;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function parseDataUrl(data: string): { buffer: Buffer; mimeType: string } {
  const match = data.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  }
  return { mimeType: "application/octet-stream", buffer: Buffer.from(data, "base64") };
}

export async function saveProofAttachment(input: {
  fileName: string;
  fileData: string;
  mimeType?: string | null;
}): Promise<{ fileName: string; fileUrl: string; mimeType: string }> {
  const safeName = `${crypto.randomUUID()}-${sanitizeFileName(input.fileName || "proof.bin")}`;
  const parsed = input.fileData.startsWith("data:") ? parseDataUrl(input.fileData) : { buffer: Buffer.from(input.fileData, "base64"), mimeType: input.mimeType || "application/octet-stream" };
  const mimeType = input.mimeType || parsed.mimeType;
  const stored = await fileStorageService.saveMediatorServiceApprovalFile({
    fileName: safeName,
    buffer: parsed.buffer,
    mimeType,
  });
  return {
    fileName: input.fileName,
    fileUrl: stored.fileUrl,
    mimeType,
  };
}

async function getServiceTypeMap() {
  const serviceTypes = await storage.listServiceTypes();
  return new Map(serviceTypes.map((s) => [s.id, s]));
}
function formatCalendarEventTitle(service: ServiceType, explicitTitle?: string | null): string {
  return explicitTitle?.trim() || `BFM Service Availability — ${service.name}`;
}

export function buildServiceApprovalActionPath(mediatorId: string, serviceTypeId: string): string {
  const params = new URLSearchParams({
    tab: "service_offering",
    section: "service-proof",
    serviceTypeId,
  });
  return `/mediators/${mediatorId}?${params.toString()}`;
}

async function upsertMediatorServiceType(mediatorId: string, serviceTypeId: string) {
  const existing = await db
    .select({ id: mediatorServiceTypes.id })
    .from(mediatorServiceTypes)
    .where(
      and(
        eq(mediatorServiceTypes.mediatorId, mediatorId),
        eq(mediatorServiceTypes.serviceTypeId, serviceTypeId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(mediatorServiceTypes).values({ mediatorId, serviceTypeId });
}

async function removeMediatorServiceType(mediatorId: string, serviceTypeId: string) {
  await db
    .delete(mediatorServiceTypes)
    .where(
      and(
        eq(mediatorServiceTypes.mediatorId, mediatorId),
        eq(mediatorServiceTypes.serviceTypeId, serviceTypeId),
      ),
    );
}

export async function createAdminServiceProofReviewNotification(input: {
  mediatorId: string;
  serviceTypeId: string;
}): Promise<boolean> {
  const [mediator, serviceType] = await Promise.all([
    storage.getUser(input.mediatorId),
    storage.getServiceType(input.serviceTypeId),
  ]);
  if (mediator?.role !== "mediator" || mediator.status !== "active" || !serviceType) return false;

  const reviewKey = `${input.mediatorId}:${input.serviceTypeId}`;
  const actionPath = buildServiceApprovalActionPath(input.mediatorId, input.serviceTypeId);
  let retiredNotificationIds: string[] = [];
  const created = await db.transaction(async (tx) => {
    // Prevent concurrent submissions or rollout backfill runs from creating
    // more than one shared notification for this mediator/service review.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`service-proof-review:${reviewKey}`}, 0))`);

    // Retire the old per-Superadmin alerts as they are superseded by the
    // shared admin alert. Their read history remains intact in the database.
    const retiredNotifications = await tx.update(notifications)
      .set({
        status: "completed",
        completedAt: new Date(),
        completionNotes: "Superseded by the shared admin service-proof review notification.",
      })
      .where(and(
        eq(notifications.recipientRole, "superadmin"),
        eq(notifications.type, "service_proof_pending_review"),
        eq(notifications.status, "active"),
        sql`${notifications.message} LIKE ${`%Review key: ${reviewKey}%`}`,
      ))
      .returning({ id: notifications.id });
    retiredNotificationIds = retiredNotifications.map((notification) => notification.id);

    const [existing] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.recipientRole, "admin"),
        eq(notifications.type, "service_proof_pending_review"),
        eq(notifications.status, "active"),
        sql`${notifications.message} LIKE ${`%Review key: ${reviewKey}%`}`,
      ))
      .limit(1);
    if (existing) return false;

    await notificationService.createNotification({
      recipientRole: "admin",
      recipientId: null,
      type: "service_proof_pending_review",
      urgency: "amber",
      caseId: null,
      appointmentId: null,
      title: `Service proof pending review — ${mediator.name}`,
      message: `${mediator.name} submitted proof for ${serviceType.name}. Review it here: ${actionPath}. Review key: ${reviewKey}`,
      status: "active",
      assignedTo: null,
      followUpDate: null,
      caseNoteRequired: false,
    });
    return true;
  });
  await notificationService.publishPersistedNotifications(retiredNotificationIds)
    .catch((err) => console.error("[ServiceApproval] Legacy review notification publish failed:", err));
  return created;
}

async function completeServiceProofReviewNotification(input: { actorId: string; mediatorId: string; serviceTypeId: string; decision: "approved" | "rejected" }): Promise<string[]> {
  const reviewKey = `${input.mediatorId}:${input.serviceTypeId}`;
  const completedAt = new Date();
  const completed = await db.update(notifications)
    .set({
      status: "completed",
      completedBy: input.actorId,
      completedAt,
      completionNotes: `Completed when the service proof was ${input.decision}.`,
    })
    .where(and(
      eq(notifications.type, "service_proof_pending_review"),
      eq(notifications.status, "active"),
      sql`${notifications.message} LIKE ${`%Review key: ${reviewKey}%`}`,
    ))
    .returning({ id: notifications.id });
  return completed.map((notification) => notification.id);
}

export async function backfillPendingMediatorServiceReviewNotifications(): Promise<{ reviewed: number; created: number }> {
  const rows = await db
    .select({ mediatorId: mediatorServiceApprovals.mediatorId, serviceTypeId: mediatorServiceApprovals.serviceTypeId, status: mediatorServiceApprovals.status, expiryDate: mediatorServiceApprovals.expiryDate, expiredAt: mediatorServiceApprovals.expiredAt })
    .from(mediatorServiceApprovals)
    .where(and(
      eq(mediatorServiceApprovals.status, "pending_review"),
      isNotNull(mediatorServiceApprovals.mediatorId),
    ));

  let created = 0;
  for (const row of rows) {
    if (!row.mediatorId || getEffectiveApprovalStatus(row) !== "pending_review") continue;
    if (await createAdminServiceProofReviewNotification({ mediatorId: row.mediatorId, serviceTypeId: row.serviceTypeId })) {
      created++;
    }
  }
  return { reviewed: rows.length, created };
}

async function createMediatorServiceProofRequestTask(input: {
  actorId: string;
  mediatorId: string;
  serviceTypeId: string;
}) {
  const [mediator, serviceType] = await Promise.all([
    storage.getUser(input.mediatorId),
    storage.getServiceType(input.serviceTypeId),
  ]);
  if (!mediator || !serviceType) return;
  const requestKey = `${input.mediatorId}:${input.serviceTypeId}`;
  const actionPath = buildServiceApprovalActionPath(input.mediatorId, input.serviceTypeId);
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.recipientRole, "mediator"),
      eq(notifications.recipientId, input.mediatorId),
      eq(notifications.type, "service_proof_requested"),
      eq(notifications.status, "active"),
      sql`${notifications.message} LIKE ${`%Request key: ${requestKey}%`}`,
    ))
    .limit(1);
  if (existing) return;

  await notificationService.createNotification({
    recipientRole: "mediator",
    recipientId: input.mediatorId,
    type: "service_proof_requested",
    urgency: "amber",
    caseId: null,
    appointmentId: null,
    title: `Service proof requested — ${serviceType.name}`,
    message: `Admin requested service proof for ${serviceType.name}. Open it here: ${actionPath}. Request key: ${requestKey}`,
    status: "active",
    assignedTo: input.mediatorId,
    followUpDate: null,
    caseNoteRequired: false,
  });
}

async function createMediatorServiceApprovalDecisionNotification(input: {
  mediatorId: string;
  serviceTypeId: string;
  decision: "approved" | "rejected" | "revoked";
  reviewReason?: string | null;
}) {
  const [mediator, serviceType] = await Promise.all([
    storage.getUser(input.mediatorId),
    storage.getServiceType(input.serviceTypeId),
  ]);
  if (!mediator || !serviceType) return;

  const actionPath = buildServiceApprovalActionPath(input.mediatorId, input.serviceTypeId);
  const type = SERVICE_APPROVAL_DECISION_NOTIFICATION_TYPES[input.decision];
  const reasonText = input.reviewReason?.trim() ? ` Reason: ${input.reviewReason.trim()}` : "";
  const decisionLabel = input.decision === "approved"
    ? "approved"
    : input.decision === "revoked"
      ? "revoked"
      : "not approved";
  const title = input.decision === "approved"
    ? `Service approval approved — ${serviceType.name}`
    : input.decision === "revoked"
      ? `Service approval revoked — ${serviceType.name}`
      : `Service approval rejected — ${serviceType.name}`;
  const message = input.decision === "approved"
    ? `Your approval for ${serviceType.name} has been approved. Open it here: ${actionPath}.`
    : `Your approval for ${serviceType.name} was ${decisionLabel}.${reasonText} Open it here: ${actionPath}.`;

  await notificationService.createNotification({
    recipientRole: "mediator",
    recipientId: input.mediatorId,
    type,
    urgency: input.decision === "approved" ? "green" : "amber",
    caseId: null,
    appointmentId: null,
    title,
    message,
    status: "active",
    assignedTo: input.mediatorId,
    followUpDate: null,
    caseNoteRequired: false,
  });
}

export class MediatorServiceApprovalService {
  private async describeAppointmentConflict(appt: Pick<Appointment, "id" | "caseId" | "partyId" | "dateTime" | "duration" | "status">): Promise<string> {
    const { startAt, endAt } = appointmentRange(appt);
    const parts = [`${appt.status} appointment at ${formatAppointmentTime(startAt, endAt)}`];

    if (appt.partyId) {
      const party = await storage.getParty(appt.partyId).catch(() => undefined);
      if (party?.clientId) {
        const client = await storage.getClient(party.clientId).catch(() => undefined);
        const name = [client?.firstName, client?.lastName].filter(Boolean).join(" ").trim();
        if (name) parts.push(`client ${name}`);
        if (party.role) parts.push(`party role ${party.role}`);
      }
    }

    const caseRow = await storage.getCase(appt.caseId).catch(() => undefined);
    if (caseRow?.caseRef) parts.push(`case ${caseRow.caseRef}`);

    return parts.join(", ");
  }

  async listForApplicant(applicantId: string) {
    const serviceMap = await getServiceTypeMap();
    const rows = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(eq(mediatorServiceApprovals.applicantId, applicantId))
      .orderBy(asc(mediatorServiceApprovals.submittedAt));
    const scheduleSlots: Record<string, MediatorServiceScheduleSlot[]> = {};
    return rows.map((row) => ({
      ...row,
      effectiveStatus: getEffectiveApprovalStatus(row),
      serviceType: serviceMap.get(row.serviceTypeId) ?? null,
      calendarIsBooked: false,
      scheduleSlots: scheduleSlots[row.serviceTypeId] ?? [],
    }));
  }

  async listForMediator(mediatorId: string) {
    const serviceMap = await getServiceTypeMap();
    const assignments = await db
      .select({
        serviceTypeId: mediatorServiceTypes.serviceTypeId,
        mediationRoleQualification: mediatorServiceTypes.mediationRoleQualification,
      })
      .from(mediatorServiceTypes)
      .where(eq(mediatorServiceTypes.mediatorId, mediatorId));
    const assignmentRoleByServiceId = new Map(assignments.map((row) => [row.serviceTypeId, row.mediationRoleQualification]));
    const rows = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(eq(mediatorServiceApprovals.mediatorId, mediatorId))
      .orderBy(asc(mediatorServiceApprovals.submittedAt));
    const scheduleRows = await db
      .select()
      .from(mediatorServiceScheduleSlots)
      .where(and(eq(mediatorServiceScheduleSlots.mediatorId, mediatorId), eq(mediatorServiceScheduleSlots.lifecycle, "active")))
      .orderBy(asc(mediatorServiceScheduleSlots.startAt), asc(mediatorServiceScheduleSlots.endAt));
    const scheduleSlotsByServiceId = new Map<string, MediatorServiceScheduleSlot[]>();
    for (const slot of scheduleRows) {
      const arr = scheduleSlotsByServiceId.get(slot.serviceTypeId) ?? [];
      arr.push(slot);
      scheduleSlotsByServiceId.set(slot.serviceTypeId, arr);
    }
    const bookedRows = await db
      .select({ parentGoogleEventId: appointments.parentGoogleEventId })
      .from(appointments)
      .where(
        and(
          eq(appointments.mediatorId, mediatorId),
          inArray(appointments.status, ["hold", "held", "confirmed"]),
        ),
      )
      .orderBy(desc(appointments.createdAt));
    const bookedSet = new Set(bookedRows.map((row) => row.parentGoogleEventId).filter((id): id is string => !!id));
    return rows.map((row) => ({
      ...row,
      effectiveStatus: getEffectiveApprovalStatus(row),
      serviceType: serviceMap.get(row.serviceTypeId) ?? null,
      mediationRoleQualification: assignmentRoleByServiceId.get(row.serviceTypeId) ?? "unclassified",
      calendarIsBooked: !!row.calendarGoogleEventId && bookedSet.has(row.calendarGoogleEventId),
      scheduleSlots: scheduleSlotsByServiceId.get(row.serviceTypeId) ?? [],
    }));
  }

  async listScheduleSlots(mediatorId: string, serviceTypeId?: string) {
    const conditions = [eq(mediatorServiceScheduleSlots.mediatorId, mediatorId), eq(mediatorServiceScheduleSlots.lifecycle, "active")];
    if (serviceTypeId) conditions.push(eq(mediatorServiceScheduleSlots.serviceTypeId, serviceTypeId));
    const rows = await db
      .select()
      .from(mediatorServiceScheduleSlots)
      .where(and(...conditions))
      .orderBy(asc(mediatorServiceScheduleSlots.startAt), asc(mediatorServiceScheduleSlots.endAt));
    const sourceIds = Array.from(new Set(rows.flatMap((row) => row.availabilitySourceId ? [row.availabilitySourceId] : [])));
    const sourceRows = sourceIds.length ? await db.select({
      id: mediatorCalendarAvailabilitySources.id,
      origin: mediatorCalendarAvailabilitySources.origin,
      scopeMode: mediatorCalendarAvailabilitySources.scopeMode,
    }).from(mediatorCalendarAvailabilitySources).where(inArray(mediatorCalendarAvailabilitySources.id, sourceIds)) : [];
    const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
    return rows.map((row) => ({
      ...row,
      availabilityOrigin: row.availabilitySourceId ? sourceById.get(row.availabilitySourceId)?.origin ?? null : null,
      availabilityScopeMode: row.availabilitySourceId ? sourceById.get(row.availabilitySourceId)?.scopeMode ?? null : null,
    }));
  }

  async replaceScheduleSlots(actorId: string, mediatorId: string, serviceTypeId: string, slots: Array<{ id?: string; startAt: Date; endAt: Date; preserveOnly?: boolean }>, options: { groupedSourceAware?: boolean } = {}) {
    const approvalRows = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(
        eq(mediatorServiceApprovals.mediatorId, mediatorId),
        eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
      ))
      .limit(1);
    if (approvalRows.length === 0 || getEffectiveApprovalStatus(approvalRows[0]) !== "approved") {
      const err = new Error("Service must be approved before scheduling slots.");
      (err as { status?: number }).status = 400;
      throw err;
    }

    const mediator = await storage.getUser(mediatorId);
    if (!mediator) {
      const err = new Error("Mediator not found.");
      (err as { status?: number }).status = 404;
      throw err;
    }

    const normalized = slots.map((slot) => ({
      id: slot.id ?? null,
      startAt: new Date(slot.startAt),
      endAt: new Date(slot.endAt),
      preserveOnly: slot.preserveOnly ?? false,
    }));
    const existingAll = await db
      .select()
      .from(mediatorServiceScheduleSlots)
      .where(and(
        eq(mediatorServiceScheduleSlots.mediatorId, mediatorId),
        eq(mediatorServiceScheduleSlots.lifecycle, "active"),
      ));
    const allExistingSameService = existingAll.filter((row) => row.serviceTypeId === serviceTypeId);
    const groupedSourceIds = Array.from(new Set(allExistingSameService.flatMap((row) => row.availabilitySourceId ? [row.availabilitySourceId] : [])));
    let groupedIds = new Set<string>();
    if (groupedSourceIds.length > 0) {
      const groupedSources = await db.select({ id: mediatorCalendarAvailabilitySources.id })
        .from(mediatorCalendarAvailabilitySources)
        .where(and(
          inArray(mediatorCalendarAvailabilitySources.id, groupedSourceIds),
          eq(mediatorCalendarAvailabilitySources.scopeMode, "all_approved_services"),
        ));
      groupedIds = new Set(groupedSources.map((source) => source.id));
      const groupedRows = allExistingSameService.filter((row) => row.availabilitySourceId && groupedIds.has(row.availabilitySourceId));
      const legacyMutation = groupedRows.some((row) => {
        const submitted = normalized.find((slot) => slot.id === row.id);
        return !submitted || submitted.startAt.getTime() !== row.startAt.getTime() || submitted.endAt.getTime() !== row.endAt.getTime();
      });
      if (groupedRows.length > 0 && !options.groupedSourceAware) {
        const err = new Error(legacyMutation
          ? "This time is shared across approved services and cannot be changed for one service. Refresh the page and edit the calendar availability as one group."
          : "This schedule includes availability shared across approved services. Refresh the page before saving so it can be handled safely.");
        (err as { status?: number }).status = 409;
        throw err;
      }
    }
    const existingSameService = options.groupedSourceAware
      ? allExistingSameService.filter((row) => !row.availabilitySourceId || !groupedIds.has(row.availabilitySourceId))
      : allExistingSameService;
    const existingById = new Map(existingSameService.map((row) => [row.id, row]));
    const submittedIds = new Set(normalized.map((row) => row.id).filter((id): id is string => !!id));
    for (const id of Array.from(submittedIds)) {
      if (!existingById.has(id)) {
        const err = new Error("Service slot was not found for this mediator and service.");
        (err as { status?: number }).status = 400;
        throw err;
      }
    }
    for (const slot of normalized) {
      if (slot.preserveOnly) {
        if (!slot.id) {
          const err = new Error("Service slot was not found for this mediator and service.");
          (err as { status?: number }).status = 400;
          throw err;
        }
        continue;
      }
      if (Number.isNaN(slot.startAt.getTime()) || Number.isNaN(slot.endAt.getTime())) {
        const err = new Error("Invalid slot date or time.");
        (err as { status?: number }).status = 400;
        throw err;
      }
      if (slot.endAt <= slot.startAt) {
        const err = new Error("End time must be after start time.");
        (err as { status?: number }).status = 400;
        throw err;
      }
    }
    const todayStart = startOfTodayInUk();
    const isHistoricalExistingSlot = (slot: { endAt: Date }) => slot.endAt < todayStart;
    const historicalExistingById = new Map(existingSameService.filter(isHistoricalExistingSlot).map((row) => [row.id, row]));
    const editableExistingSameService = existingSameService.filter((row) => !historicalExistingById.has(row.id));
    const editableNormalized = normalized.filter((slot) => {
      if (slot.preserveOnly) return false;
      if (!slot.id) return true;
      return !historicalExistingById.has(slot.id);
    });

    for (const slot of editableNormalized) {
      if (!slot.id && slot.startAt < todayStart) {
        const err = new Error("New service slots cannot be scheduled in the past.");
        (err as { status?: number }).status = 400;
        throw err;
      }
    }

    const ordered = [...editableNormalized].sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.endAt.getTime() - b.endAt.getTime());
    for (let i = 1; i < ordered.length; i++) {
      if (rangesOverlap(ordered[i - 1].startAt, ordered[i - 1].endAt, ordered[i].startAt, ordered[i].endAt)) {
        const err = new Error("Slots for the same service cannot overlap.");
        (err as { status?: number }).status = 400;
        throw err;
      }
    }

    const keepIds = new Set(normalized.map((row) => row.id).filter((id): id is string => !!id));

    const rangeSource = [...editableNormalized, ...editableExistingSameService];
    const activeAppointments = rangeSource.length > 0
      ? await storage.listAppointmentsByMediatorAndDateRange(
          mediatorId,
          new Date(Math.min(...rangeSource.map((slot) => slot.startAt.getTime()))),
          new Date(Math.max(...rangeSource.map((slot) => slot.endAt.getTime()))),
        )
      : [];
    const blockingAppointments = activeAppointments.filter((appt) => appt.status !== "cancelled" && appt.status !== "expired");

    const isBookedSlot = (slot: { startAt: Date; endAt: Date }) => blockingAppointments.some((activeBooking) => {
      const appt = appointmentRange(activeBooking);
      return rangesOverlap(slot.startAt, slot.endAt, appt.startAt, appt.endAt);
    });

    for (const slot of editableNormalized) {
      const existing = slot.id ? existingById.get(slot.id) : undefined;
      if (existing) {
        for (const activeBooking of blockingAppointments) {
          const appt = appointmentRange(activeBooking);
          const wasInsideExistingSlot = rangesOverlap(existing.startAt, existing.endAt, appt.startAt, appt.endAt);
          const remainsInsideSubmittedSlot = rangeContains(slot.startAt, slot.endAt, appt.startAt, appt.endAt);
          if (wasInsideExistingSlot && !remainsInsideSubmittedSlot) {
            const detail = await this.describeAppointmentConflict(activeBooking);
            const err = new Error(`This service slot contains an existing booking (${detail}) and cannot be moved or shortened past that appointment.`);
            (err as { status?: number }).status = 409;
            throw err;
          }
        }
      }
    }

    const serviceMap = await getServiceTypeMap();
    const service = serviceMap.get(serviceTypeId);
    if (!service) {
      const err = new Error("Service type not found.");
      (err as { status?: number }).status = 404;
      throw err;
    }
    const title = formatCalendarEventTitle(service, null);
    const description = [
      `Approved service: ${service.name}`,
      `Category: ${service.category}`,
      `Managed from the mediator profile service schedule modal.`,
    ].join("\n");
    const attendees = [
      { email: BFM_EMAIL, displayName: "Brighter Future Mediation", responseStatus: "accepted" as const },
    ];
    if (mediator.email) {
      attendees.push({ email: mediator.email, displayName: mediator.name ?? undefined, responseStatus: "accepted" as const });
    }
    const activeProvider = assertActiveMediatorCalendarProvider(mediator);
    const activeCalendar = getMediatorCalendarProviderService(activeProvider);
    const syncProviderCalendar = (provider: CalendarProvider) => {
      const service = provider === "outlook" ? outlookCalendarService : googleCalendarService;
      service.syncCalendar(mediatorId).catch(() => {});
    };

    const createdRows: MediatorServiceScheduleSlot[] = [];
    const updatedRows: MediatorServiceScheduleSlot[] = [];
    const deletedRows: MediatorServiceScheduleSlot[] = [];
    const preservedRows: MediatorServiceScheduleSlot[] = [];
    const preservedIds = new Set<string>();

    const preserveRow = (row: MediatorServiceScheduleSlot) => {
      if (preservedIds.has(row.id)) return;
      preservedRows.push(row);
      preservedIds.add(row.id);
    };

    for (const row of Array.from(historicalExistingById.values())) {
      preserveRow(row);
    }

    for (const row of normalized) {
      if (!row.preserveOnly || !row.id) continue;
      const existing = existingById.get(row.id);
      if (existing) preserveRow(existing);
    }

    for (const row of editableExistingSameService) {
      if (keepIds.has(row.id)) continue;
      if (isBookedSlot(row)) {
        preserveRow(row);
        continue;
      }
      if (row.googleEventId) {
        const provider = isCalendarProvider(row.calendarProvider) ? row.calendarProvider : "google";
        if (row.availabilitySourceId) {
          const { enqueueCalendarAvailabilityReconciliation, completeCalendarAvailabilityReconciliationJob } = await import("./calendar-availability-job.service");
          await db.update(mediatorCalendarAvailabilitySources).set({ expectedProviderFingerprint: "deleted", updatedAt: new Date() })
            .where(eq(mediatorCalendarAvailabilitySources.id, row.availabilitySourceId));
          const mutationJob = await enqueueCalendarAvailabilityReconciliation({
            mediatorId,
            provider,
            trigger: "bfm_mutation_retry",
            dedupeKey: `mutation:delete:${row.availabilitySourceId}`,
            payload: { operation: "delete", sourceId: row.availabilitySourceId },
            nextAttemptAt: new Date(Date.now() + 30_000),
          });
          await getMediatorCalendarProviderService(provider).deleteEvent(mediatorId, row.googleEventId);
          const now = new Date();
          const [deleted] = await db.transaction(async (tx) => {
            await tx.update(mediatorCalendarAvailabilitySources).set({
              state: "deleted",
              deletedAt: now,
              expectedProviderFingerprint: null,
              updatedAt: now,
            }).where(eq(mediatorCalendarAvailabilitySources.id, row.availabilitySourceId!));
            return tx.delete(mediatorServiceScheduleSlots).where(eq(mediatorServiceScheduleSlots.id, row.id)).returning();
          });
          await completeCalendarAvailabilityReconciliationJob(mutationJob?.id);
          await logAudit({
            userId: actorId,
            action: "calendar_availability_bfm_originated_deletion",
            entity: "mediator_calendar_availability_source",
            entityId: row.availabilitySourceId,
            details: JSON.stringify({ trigger: "service_schedule", provider, externalEventId: row.googleEventId }),
          });
          deletedRows.push(deleted);
          syncProviderCalendar(provider);
          continue;
        }
        await getMediatorCalendarProviderService(provider).deleteEvent(mediatorId, row.googleEventId);
        syncProviderCalendar(provider);
      }
      const [deleted] = await db
        .delete(mediatorServiceScheduleSlots)
        .where(eq(mediatorServiceScheduleSlots.id, row.id))
        .returning();
      deletedRows.push(deleted);
    }

    for (const slot of ordered) {
      const existing = slot.id ? existingById.get(slot.id) : undefined;
      if (existing) {
        const provider = isCalendarProvider(existing.calendarProvider) ? existing.calendarProvider : activeProvider;
        const calendar = getMediatorCalendarProviderService(provider);
        let googleEventId = existing.googleEventId ?? null;
        let expectedFingerprint: string | null = null;
        let mutationJobId: string | undefined;
        if (!googleEventId) {
          googleEventId = await calendar.createEvent(mediatorId, {
            summary: title,
            description,
            start: slot.startAt,
            end: slot.endAt,
            attendees,
            location: mediator.zoomLink ?? undefined,
          });
        } else {
          if (existing.availabilitySourceId) {
            const providerEvent = await calendar.getEventById(mediatorId, googleEventId);
            if (!providerEvent) {
              const err = new Error("The connected calendar event no longer exists. Sync the calendar and try again.");
              (err as { status?: number }).status = 409;
              throw err;
            }
            expectedFingerprint = buildAvailabilityFingerprint({
              title,
              startAt: slot.startAt,
              endAt: slot.endAt,
              attendees: providerEvent.attendees,
            });
            await db.update(mediatorCalendarAvailabilitySources).set({ expectedProviderFingerprint: expectedFingerprint, updatedAt: new Date() })
              .where(eq(mediatorCalendarAvailabilitySources.id, existing.availabilitySourceId));
            const { enqueueCalendarAvailabilityReconciliation } = await import("./calendar-availability-job.service");
            const mutationJob = await enqueueCalendarAvailabilityReconciliation({
              mediatorId,
              provider,
              trigger: "bfm_mutation_retry",
              dedupeKey: `mutation:patch:${existing.availabilitySourceId}`,
              payload: {
                operation: "patch",
                sourceId: existing.availabilitySourceId,
                startAt: slot.startAt.toISOString(),
                endAt: slot.endAt.toISOString(),
                expectedFingerprint,
                summary: title,
                description,
              },
              nextAttemptAt: new Date(Date.now() + 30_000),
            });
            mutationJobId = mutationJob?.id;
          }
          await calendar.patchEvent(mediatorId, googleEventId, {
            summary: title,
            description,
            start: slot.startAt,
            end: slot.endAt,
          });
        }
        syncProviderCalendar(provider);
        const now = new Date();
        const [updated] = await db.transaction(async (tx) => {
          if (existing.availabilitySourceId && expectedFingerprint) {
            await tx.update(mediatorCalendarAvailabilitySources).set({
              title,
              startAt: slot.startAt,
              endAt: slot.endAt,
              providerFingerprint: expectedFingerprint,
              expectedProviderFingerprint: null,
              state: "active",
              updatedAt: now,
            }).where(eq(mediatorCalendarAvailabilitySources.id, existing.availabilitySourceId));
          }
          return tx.update(mediatorServiceScheduleSlots)
            .set({
              startAt: slot.startAt,
              endAt: slot.endAt,
              googleEventId,
              calendarProvider: provider,
              updatedAt: now,
            })
            .where(eq(mediatorServiceScheduleSlots.id, existing.id))
            .returning();
        });
        if (mutationJobId) {
          const { completeCalendarAvailabilityReconciliationJob } = await import("./calendar-availability-job.service");
          await completeCalendarAvailabilityReconciliationJob(mutationJobId);
          await logAudit({
            userId: actorId,
            action: "calendar_availability_bfm_originated_update",
            entity: "mediator_calendar_availability_source",
            entityId: existing.availabilitySourceId,
            details: JSON.stringify({ trigger: "service_schedule", provider, externalEventId: googleEventId, before: { startAt: existing.startAt, endAt: existing.endAt }, after: { startAt: slot.startAt, endAt: slot.endAt } }),
          });
        }
        updatedRows.push(updated);
      } else {
        const googleEventId = await activeCalendar.createEvent(mediatorId, {
          summary: title,
          description,
          start: slot.startAt,
          end: slot.endAt,
          attendees,
          location: mediator.zoomLink ?? undefined,
        });
        const fingerprint = buildAvailabilityFingerprint({
          title,
          startAt: slot.startAt,
          endAt: slot.endAt,
          attendees,
        });
        try {
          const [created] = await db.transaction(async (tx) => {
            const [source] = await tx.insert(mediatorCalendarAvailabilitySources).values({
              mediatorId,
              provider: activeProvider,
              externalEventId: googleEventId,
              origin: "bfm_service",
              scopeMode: "fixed_services",
              title,
              startAt: slot.startAt,
              endAt: slot.endAt,
              providerFingerprint: fingerprint,
              state: "active",
              lastSeenAt: new Date(),
            }).returning();
            return tx.insert(mediatorServiceScheduleSlots)
              .values({
                mediatorId,
                serviceTypeId,
                startAt: slot.startAt,
                endAt: slot.endAt,
                googleEventId,
                calendarProvider: activeProvider,
                availabilitySourceId: source.id,
              })
              .returning();
          });
          createdRows.push(created);
        } catch (error) {
          await activeCalendar.deleteEvent(mediatorId, googleEventId).catch(() => undefined);
          throw error;
        }
      }
    }

    syncProviderCalendar(activeProvider);

    await logAudit({
      userId: actorId,
      action: "update",
      entity: "mediator",
      entityId: mediatorId,
      details: JSON.stringify({
        serviceTypeId,
        slotCount: ordered.length,
        createdCount: createdRows.length,
        updatedCount: updatedRows.length,
        deletedCount: deletedRows.length,
        preservedCount: preservedRows.length,
      }),
    });

    return {
      rows: [...createdRows, ...updatedRows, ...preservedRows],
      deletedCount: deletedRows.length,
      createdCount: createdRows.length,
      updatedCount: updatedRows.length,
      preservedCount: preservedRows.length,
    };
  }

  async requestMissing(actorId: string, applicantId: string, serviceTypeId: string) {
    const service = await storage.getServiceType(serviceTypeId);
    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(
        and(
          eq(mediatorServiceApprovals.applicantId, applicantId),
          eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
        ),
      )
      .limit(1);

    const patch = {
      applicantId,
      mediatorId: existing[0]?.mediatorId ?? null,
      serviceTypeId,
      status: "requested" as const,
      requestedAt: new Date(),
      requestedBy: actorId,
      reviewReason: null,
      manualApprovalNote: null,
    };

    const row = existing.length > 0
      ? (await db.update(mediatorServiceApprovals).set(patch).where(eq(mediatorServiceApprovals.id, existing[0].id)).returning())[0]
      : (await db.insert(mediatorServiceApprovals).values(patch).returning())[0];

    await logAudit({
      userId: actorId,
      action: "request_service_proof",
      entity: "mediator_applicant",
      entityId: applicantId,
      details: JSON.stringify({
        serviceTypeId,
        serviceName: service?.name ?? null,
        requestedAt: new Date().toISOString(),
      }),
    });
    return row;
  }

  async requestForMediator(actorId: string, mediatorId: string, serviceTypeId: string) {
    const [mediator, service] = await Promise.all([
      storage.getUser(mediatorId),
      storage.getServiceType(serviceTypeId),
    ]);
    if (!mediator) {
      const err = new Error("Mediator not found.");
      (err as { status?: number }).status = 404;
      throw err;
    }
    if (!service) {
      const err = new Error("Service type not found.");
      (err as { status?: number }).status = 404;
      throw err;
    }

    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(
        eq(mediatorServiceApprovals.mediatorId, mediatorId),
        eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
      ))
      .limit(1);

    const currentStatus = existing[0] ? getEffectiveApprovalStatus(existing[0]) : null;
    if (currentStatus === "pending_review") {
      const err = new Error("This service proof is already awaiting review.");
      (err as { status?: number }).status = 409;
      throw err;
    }
    if (currentStatus === "approved") {
      const err = new Error("This service is already approved.");
      (err as { status?: number }).status = 409;
      throw err;
    }

    const patch = {
      applicantId: null,
      mediatorId,
      serviceTypeId,
      status: "requested" as const,
      requestedAt: new Date(),
      requestedBy: actorId,
      reviewedAt: null,
      reviewedBy: null,
      reviewReason: null,
      manualApprovalNote: null,
      expiredAt: null,
    };
    const row = existing.length > 0
      ? (await db.update(mediatorServiceApprovals).set(patch).where(eq(mediatorServiceApprovals.id, existing[0].id)).returning())[0]
      : (await db.insert(mediatorServiceApprovals).values(patch).returning())[0];

    await upsertMediatorServiceType(mediatorId, serviceTypeId);
    await createMediatorServiceProofRequestTask({ actorId, mediatorId, serviceTypeId });
    await logAudit({
      userId: actorId,
      action: "request_service_proof",
      entity: "mediator",
      entityId: mediatorId,
      details: JSON.stringify({
        serviceTypeId,
        serviceName: service.name,
        requestedAt: new Date().toISOString(),
      }),
    });
    return row;
  }

  async upsertSubmission(actorId: string | null, input: {
    applicantId?: string | null;
    mediatorId?: string | null;
    serviceTypeId: string;
    proofLink?: string | null;
    proofFileName?: string | null;
    proofFileData?: string | null;
    proofMimeType?: string | null;
    expiryDate?: string | null;
  }) {
    const existingConditions = [eq(mediatorServiceApprovals.serviceTypeId, input.serviceTypeId)];
    if (input.mediatorId) existingConditions.push(eq(mediatorServiceApprovals.mediatorId, input.mediatorId));
    if (input.applicantId) existingConditions.push(eq(mediatorServiceApprovals.applicantId, input.applicantId));
    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(...existingConditions))
      .limit(1);

    let filePayload: { fileName: string; fileUrl: string; mimeType: string } | null = null;
    if (input.proofFileName && input.proofFileData) {
      filePayload = await saveProofAttachment({
        fileName: input.proofFileName,
        fileData: input.proofFileData,
        mimeType: input.proofMimeType,
      });
    }

    const patch = {
      applicantId: input.applicantId ?? null,
      mediatorId: input.mediatorId ?? null,
      serviceTypeId: input.serviceTypeId,
      status: "pending_review" as const,
      proofLink: input.proofLink ?? null,
      proofFileName: filePayload?.fileName ?? input.proofFileName ?? null,
      proofFileUrl: filePayload?.fileUrl ?? null,
      proofMimeType: filePayload?.mimeType ?? input.proofMimeType ?? null,
      expiryDate: input.expiryDate ?? null,
      submittedAt: new Date(),
      reviewReason: null,
      manualApprovalNote: null,
      expiredAt: null,
    };

    const row = existing.length > 0
      ? (await db.update(mediatorServiceApprovals).set(patch).where(eq(mediatorServiceApprovals.id, existing[0].id)).returning())[0]
      : (await db.insert(mediatorServiceApprovals).values(patch).returning())[0];

    if (patch.mediatorId) {
      await upsertMediatorServiceType(patch.mediatorId, patch.serviceTypeId);
      const actor = actorId ? await storage.getUser(actorId) : null;
      if (actor?.role === "mediator") {
        await createAdminServiceProofReviewNotification({ mediatorId: patch.mediatorId, serviceTypeId: patch.serviceTypeId });
      }
    }

    const service = await storage.getServiceType(input.serviceTypeId);
    await logAudit({
      userId: actorId,
      action: "submit_service_proof",
      entity: input.mediatorId ? "mediator" : "mediator_applicant",
      entityId: input.mediatorId ?? input.applicantId ?? "",
      details: JSON.stringify({
        serviceTypeId: input.serviceTypeId,
        serviceName: service?.name ?? null,
        hasFile: !!filePayload,
        hasLink: !!input.proofLink,
        submittedAt: new Date().toISOString(),
      }),
    });
    return row;
  }

  async review(actorId: string, scope: { applicantId?: string; mediatorId?: string }, serviceTypeId: string, decision: "approved" | "rejected", reviewReason?: string | null) {
    const reviewConditions = [eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId)];
    if (scope.applicantId) reviewConditions.push(eq(mediatorServiceApprovals.applicantId, scope.applicantId));
    if (scope.mediatorId) reviewConditions.push(eq(mediatorServiceApprovals.mediatorId, scope.mediatorId));
    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(...reviewConditions))
      .limit(1);
    if (existing.length === 0) {
      return null;
    }
    const row = existing[0];
    const isRejected = decision === "rejected";
    const patch = {
      status: isRejected ? "requested" : "approved",
      reviewedAt: new Date(),
      reviewedBy: actorId,
      requestedAt: isRejected ? new Date() : row.requestedAt,
      requestedBy: isRejected ? actorId : row.requestedBy,
      reviewReason: isRejected ? (reviewReason ?? null) : null,
      manualApprovalNote: null,
      expiredAt: isRejected ? row.expiredAt : null,
    };
    const [updated] = await db.update(mediatorServiceApprovals).set(patch).where(eq(mediatorServiceApprovals.id, row.id)).returning();
    if (updated.mediatorId && decision === "approved") {
      await upsertMediatorServiceType(updated.mediatorId, updated.serviceTypeId);
    }
    if (updated.mediatorId && decision === "rejected") {
      // Leave the service assignment in place, but keep it out of booking
      // unless the approval becomes valid again.
    }
    let completedNotificationIds: string[] = [];
    if (updated.mediatorId) {
      completedNotificationIds = await completeServiceProofReviewNotification({
        actorId,
        mediatorId: updated.mediatorId,
        serviceTypeId: updated.serviceTypeId,
        decision,
      });
      await createMediatorServiceApprovalDecisionNotification({
        mediatorId: updated.mediatorId,
        serviceTypeId: updated.serviceTypeId,
        decision,
        reviewReason: isRejected ? (reviewReason ?? null) : null,
      });
    }
    const service = await storage.getServiceType(serviceTypeId);
    await logAudit({
      userId: actorId,
      action: `service_proof_${decision}`,
      entity: updated.mediatorId ? "mediator" : "mediator_applicant",
      entityId: updated.mediatorId ?? updated.applicantId ?? "",
      details: JSON.stringify({
        serviceTypeId,
        serviceName: service?.name ?? null,
        reviewReason: reviewReason ?? null,
        decisionAt: new Date().toISOString(),
        previousStatus: row.status,
        nextStatus: updated.status,
        reviewedBy: actorId,
      }),
    });
    if (updated.mediatorId) {
      const { reconcileServiceApprovalsForCalendarAvailability } = await import("./calendar-availability-reconciliation-runtime");
      await reconcileServiceApprovalsForCalendarAvailability(updated.mediatorId).catch((err) => console.error("[ServiceApproval] Calendar availability reconciliation failed:", err));
      await notificationService.publishPersistedNotifications(completedNotificationIds)
        .catch((err) => console.error("[ServiceApproval] Review notification publish failed:", err));
    }
    return updated;
  }

  async manualApprove(actorId: string, input: {
    mediatorId: string;
    serviceTypeId: string;
    proofLink?: string | null;
    proofFileName?: string | null;
    proofFileData?: string | null;
    proofMimeType?: string | null;
    evidenceNote?: string | null;
    expiryDate?: string | null;
  }) {
    const [mediator, service, existing] = await Promise.all([
      storage.getUser(input.mediatorId),
      storage.getServiceType(input.serviceTypeId),
      db.select().from(mediatorServiceApprovals).where(and(
        eq(mediatorServiceApprovals.mediatorId, input.mediatorId),
        eq(mediatorServiceApprovals.serviceTypeId, input.serviceTypeId),
      )).limit(1),
    ]);

    if (!mediator || mediator.role !== "mediator" || mediator.status !== "active") {
      const err = new Error("Active mediator not found.");
      (err as { status?: number }).status = mediator ? 400 : 404;
      throw err;
    }
    if (!service || !service.isActive) {
      const err = new Error(service ? "Only an active service type can be approved." : "Service type not found.");
      (err as { status?: number }).status = service ? 400 : 404;
      throw err;
    }
    if (existing[0] && getEffectiveApprovalStatus(existing[0]) === "approved") {
      const err = new Error("This service is already approved.");
      (err as { status?: number }).status = 409;
      throw err;
    }

    const evidenceNote = input.evidenceNote?.trim() || null;
    const proofLink = input.proofLink?.trim() || null;
    const hasNewFile = !!input.proofFileName && !!input.proofFileData;
    if (!hasNewFile && !proofLink && !evidenceNote) {
      const err = new Error("At least one new supporting file, URL, or evidence note is required.");
      (err as { status?: number }).status = 400;
      throw err;
    }

    let filePayload: { fileName: string; fileUrl: string; mimeType: string } | null = null;
    if (hasNewFile) {
      filePayload = await saveProofAttachment({
        fileName: input.proofFileName!,
        fileData: input.proofFileData!,
        mimeType: input.proofMimeType,
      });
    }

    const evidenceTypes = [
      filePayload ? "file" : null,
      proofLink ? "url" : null,
      evidenceNote ? "note" : null,
    ].filter((value): value is string => !!value);
    const workflowKey = `${input.mediatorId}:${input.serviceTypeId}`;
    const actionPath = buildServiceApprovalActionPath(input.mediatorId, input.serviceTypeId);
    const transactionResult = await db.transaction(async (tx) => {
      // Serialize both create and update attempts for this mediator/service pair.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${workflowKey}, 0))`);
      const lockedRows = await tx
        .select()
        .from(mediatorServiceApprovals)
        .where(and(
          eq(mediatorServiceApprovals.mediatorId, input.mediatorId),
          eq(mediatorServiceApprovals.serviceTypeId, input.serviceTypeId),
        ))
        .limit(1);
      const lockedExisting = lockedRows[0];
      if (lockedExisting && getEffectiveApprovalStatus(lockedExisting) === "approved") {
        const err = new Error("This service is already approved.");
        (err as { status?: number }).status = 409;
        throw err;
      }

      const decidedAt = new Date();
      const previousStatus = lockedExisting ? getEffectiveApprovalStatus(lockedExisting) : null;
      const patch = {
        applicantId: null,
        mediatorId: input.mediatorId,
        serviceTypeId: input.serviceTypeId,
        status: "approved" as const,
        proofLink: proofLink ?? lockedExisting?.proofLink ?? null,
        proofFileName: filePayload?.fileName ?? lockedExisting?.proofFileName ?? null,
        proofFileUrl: filePayload?.fileUrl ?? lockedExisting?.proofFileUrl ?? null,
        proofMimeType: filePayload?.mimeType ?? lockedExisting?.proofMimeType ?? null,
        expiryDate: input.expiryDate ?? null,
        reviewedAt: decidedAt,
        reviewedBy: actorId,
        reviewReason: null,
        // A non-null value also marks file/link-only overrides as manual approvals.
        // Normal request/submission/review paths clear the field back to null.
        manualApprovalNote: evidenceNote ?? "",
        expiredAt: null,
        reminderSentAt: null,
      };
      const updated = lockedExisting
        ? (await tx.update(mediatorServiceApprovals).set(patch).where(eq(mediatorServiceApprovals.id, lockedExisting.id)).returning())[0]
        : (await tx.insert(mediatorServiceApprovals).values(patch).returning())[0];

      await tx.insert(mediatorServiceTypes)
        .values({ mediatorId: input.mediatorId, serviceTypeId: input.serviceTypeId })
        .onConflictDoNothing();

      const completedNotifications = await tx
        .update(notifications)
        .set({
          status: "completed",
          completedBy: actorId,
          completedAt: decidedAt,
          completionNotes: "Completed by Superadmin manual service approval.",
        })
        .where(and(
          inArray(notifications.type, ["service_proof_requested", "service_proof_pending_review"]),
          sql`${notifications.status} <> 'completed'`,
          sql`${notifications.message} LIKE ${`%${workflowKey}%`}`,
        ))
        .returning();
      const completedNotificationIds = completedNotifications.map((notification) => notification.id);
      let completedTaskIds: string[] = [];
      if (completedNotificationIds.length > 0) {
        const completedTasks = await tx.update(tasks)
          .set({
            status: "completed",
            completedBy: actorId,
            completedAt: decidedAt,
            completionNotes: "Completed by Superadmin manual service approval.",
            updatedAt: decidedAt,
          })
          .where(or(
            inArray(tasks.id, completedNotificationIds),
            inArray(tasks.legacyNotificationId, completedNotificationIds),
          ))
          .returning({ id: tasks.id });
        completedTaskIds = completedTasks.map((task) => task.id);
      }

      const [decisionNotification] = await tx.insert(notifications).values({
        recipientRole: "mediator",
        recipientId: input.mediatorId,
        type: "service_approval_approved",
        urgency: "green",
        caseId: null,
        appointmentId: null,
        title: `Service approval approved — ${service.name}`,
        message: `Your approval for ${service.name} has been approved. Open it here: ${actionPath}.`,
        status: "active",
        assignedTo: input.mediatorId,
        followUpDate: null,
        caseNoteRequired: false,
      }).returning();

      await tx.insert(auditLogs).values({
        userId: actorId,
        action: "manual_service_approval",
        entity: "mediator",
        entityId: input.mediatorId,
        details: JSON.stringify({
          serviceTypeId: input.serviceTypeId,
          serviceName: service.name,
          evidenceTypes,
          expiryDate: updated.expiryDate,
          previousStatus,
          nextStatus: updated.status,
          approvedBy: actorId,
          decisionAt: decidedAt.toISOString(),
        }),
      });

      return { updated, decisionNotification, completedNotificationIds, completedTaskIds };
    });

    // Durable state is already committed. Realtime delivery and calendar cleanup
    // are recoverable conveniences and must not turn a successful decision into
    // an unretryable API failure.
    await notificationService.publishPersistedNotifications([
      transactionResult.decisionNotification.id,
      ...transactionResult.completedNotificationIds,
    ]).catch((err) => console.error("[ManualServiceApproval] Realtime publish failed:", err));
    if (transactionResult.completedTaskIds.length > 0) {
      const { taskCalendarService } = await import("./task-calendar.service");
      await Promise.all(transactionResult.completedTaskIds.map((id) =>
        taskCalendarService.removeSchedule(id).catch((err) => console.error("[ManualServiceApproval] Task calendar cleanup failed:", err)),
      ));
    }

    const { reconcileServiceApprovalsForCalendarAvailability } = await import("./calendar-availability-reconciliation-runtime");
    await reconcileServiceApprovalsForCalendarAvailability(input.mediatorId).catch((err) => console.error("[ManualServiceApproval] Calendar availability reconciliation failed:", err));
    return transactionResult.updated;
  }

  async revoke(actorId: string, scope: { mediatorId: string }, serviceTypeId: string, reviewReason: string) {
    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(
        eq(mediatorServiceApprovals.mediatorId, scope.mediatorId),
        eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId),
      ))
      .limit(1);
    if (existing.length === 0) {
      return null;
    }

    const row = existing[0];
    if (getEffectiveApprovalStatus(row) !== "approved") {
      const err = new Error("Only approved service approvals can be revoked.");
      (err as { status?: number }).status = 409;
      throw err;
    }
    if (!reviewReason.trim()) {
      const err = new Error("Revocation reason is required.");
      (err as { status?: number }).status = 400;
      throw err;
    }

    const [updated] = await db
      .update(mediatorServiceApprovals)
      .set({
        status: "revoked",
        reviewedAt: new Date(),
        reviewedBy: actorId,
        requestedAt: new Date(),
        requestedBy: actorId,
        reviewReason: reviewReason.trim(),
      })
      .where(eq(mediatorServiceApprovals.id, row.id))
      .returning();

    if (updated.mediatorId) {
      await createMediatorServiceProofRequestTask({ actorId, mediatorId: updated.mediatorId, serviceTypeId });
      await createMediatorServiceApprovalDecisionNotification({
        mediatorId: updated.mediatorId,
        serviceTypeId,
        decision: "revoked",
        reviewReason: reviewReason.trim(),
      });
    }

    const service = await storage.getServiceType(serviceTypeId);
    await logAudit({
      userId: actorId,
      action: "service_approval_revoked",
      entity: "mediator",
      entityId: updated.mediatorId ?? scope.mediatorId,
      details: JSON.stringify({
        serviceTypeId,
        serviceName: service?.name ?? null,
        reviewReason: reviewReason.trim(),
        decisionAt: new Date().toISOString(),
        previousStatus: row.status,
        nextStatus: updated.status,
        reviewedBy: actorId,
      }),
    });

    const { reconcileServiceApprovalsForCalendarAvailability } = await import("./calendar-availability-reconciliation-runtime");
    await reconcileServiceApprovalsForCalendarAvailability(scope.mediatorId).catch((err) => console.error("[ServiceRevocation] Calendar availability reconciliation failed:", err));

    return updated;
  }

  async saveCalendarEvent(actorId: string, scope: { applicantId?: string; mediatorId?: string }, serviceTypeId: string, input: {
    startAt: Date;
    endAt: Date;
    title?: string | null;
    notes?: string | null;
  }) {
    const conditions = [eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId)];
    if (scope.applicantId) conditions.push(eq(mediatorServiceApprovals.applicantId, scope.applicantId));
    if (scope.mediatorId) conditions.push(eq(mediatorServiceApprovals.mediatorId, scope.mediatorId));
    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(...conditions))
      .limit(1);
    if (existing.length === 0) return null;
    const row = existing[0];
    if (getEffectiveApprovalStatus(row) !== "approved") {
      const err = new Error("Service must be approved before creating a calendar event.");
      (err as { status?: number }).status = 400;
      throw err;
    }
    if (Number.isNaN(input.startAt.getTime()) || Number.isNaN(input.endAt.getTime())) {
      const err = new Error("Invalid calendar event date/time.");
      (err as { status?: number }).status = 400;
      throw err;
    }
    if (input.endAt <= input.startAt) {
      const err = new Error("End time must be after start time.");
      (err as { status?: number }).status = 400;
      throw err;
    }
    if (!row.mediatorId) {
      const err = new Error("Approved service is not linked to a mediator yet.");
      (err as { status?: number }).status = 400;
      throw err;
    }
    const mediator = await storage.getUser(row.mediatorId);
    if (!mediator) {
      const err = new Error("Mediator not found.");
      (err as { status?: number }).status = 404;
      throw err;
    }
    if (!mediator.googleCalendarConnected || !hasWriteScope(mediator.googleScopeGranted)) {
      const err = new Error("Google Calendar must be connected before saving a service event.");
      (err as { status?: number }).status = 400;
      throw err;
    }

    const activeBooking = row.calendarGoogleEventId
      ? await db
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.mediatorId, row.mediatorId),
              eq(appointments.parentGoogleEventId, row.calendarGoogleEventId),
              inArray(appointments.status, ["hold", "held", "confirmed"]),
            ),
          )
          .limit(1)
      : [];
    if (activeBooking.length > 0) {
      const err = new Error("This service event is already linked to a client booking and cannot be edited.");
      (err as { status?: number }).status = 409;
      throw err;
    }

    const serviceMap = await getServiceTypeMap();
    const service = serviceMap.get(serviceTypeId);
    if (!service) {
      const err = new Error("Service type not found.");
      (err as { status?: number }).status = 404;
      throw err;
    }

    const title = formatCalendarEventTitle(service, input.title ?? null);
    const notes = input.notes?.trim() || null;
    const description = [
      `Approved service: ${service.name}`,
      `Category: ${service.category}`,
      notes ? `Notes: ${notes}` : null,
      `Managed from the mediator profile service approvals tab.`,
    ].filter(Boolean).join("\n");
    const attendees = [
      { email: BFM_EMAIL, displayName: "Brighter Future Mediation", responseStatus: "accepted" as const },
    ];
    if (mediator.email) {
      attendees.push({ email: mediator.email, displayName: mediator.name ?? undefined, responseStatus: "accepted" as const });
    }

    let googleEventId = row.calendarGoogleEventId ?? null;
    if (!googleEventId) {
      googleEventId = await googleCalendarService.createEvent(row.mediatorId, {
        summary: title,
        description,
        start: input.startAt,
        end: input.endAt,
        attendees,
        location: mediator.zoomLink ?? undefined,
      });
    } else {
      await googleCalendarService.patchEvent(row.mediatorId, googleEventId, {
        summary: title,
        description,
        start: input.startAt,
        end: input.endAt,
      });
    }

    const [updated] = await db
      .update(mediatorServiceApprovals)
      .set({
        calendarStartAt: input.startAt,
        calendarEndAt: input.endAt,
        calendarTitle: title,
        calendarNotes: notes,
        calendarGoogleEventId: googleEventId,
        calendarUpdatedAt: new Date(),
      })
      .where(eq(mediatorServiceApprovals.id, row.id))
      .returning();

    await googleCalendarService.syncCalendar(row.mediatorId).catch(() => {});

    await logAudit({
      userId: actorId,
      action: "update",
      entity: updated.mediatorId ? "mediator" : "mediator_applicant",
      entityId: updated.mediatorId ?? updated.applicantId ?? "",
      details: JSON.stringify({
        serviceTypeId,
        calendarGoogleEventId: googleEventId,
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
      }),
    });

    return updated;
  }

  async deleteCalendarEvent(actorId: string, scope: { applicantId?: string; mediatorId?: string }, serviceTypeId: string) {
    const conditions = [eq(mediatorServiceApprovals.serviceTypeId, serviceTypeId)];
    if (scope.applicantId) conditions.push(eq(mediatorServiceApprovals.applicantId, scope.applicantId));
    if (scope.mediatorId) conditions.push(eq(mediatorServiceApprovals.mediatorId, scope.mediatorId));
    const existing = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(and(...conditions))
      .limit(1);
    if (existing.length === 0) return null;
    const row = existing[0];
    if (!row.mediatorId) {
      const err = new Error("Approved service is not linked to a mediator yet.");
      (err as { status?: number }).status = 400;
      throw err;
    }
    const activeBooking = row.calendarGoogleEventId
      ? await db
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.mediatorId, row.mediatorId),
              eq(appointments.parentGoogleEventId, row.calendarGoogleEventId),
              inArray(appointments.status, ["hold", "held", "confirmed"]),
            ),
          )
          .limit(1)
      : [];
    if (activeBooking.length > 0) {
      const err = new Error("This service event is already linked to a client booking and cannot be deleted.");
      (err as { status?: number }).status = 409;
      throw err;
    }
    if (row.calendarGoogleEventId) {
      await googleCalendarService.deleteEvent(row.mediatorId, row.calendarGoogleEventId);
    }
    const [updated] = await db
      .update(mediatorServiceApprovals)
      .set({
        calendarStartAt: null,
        calendarEndAt: null,
        calendarTitle: null,
        calendarNotes: null,
        calendarGoogleEventId: null,
        calendarUpdatedAt: new Date(),
      })
      .where(eq(mediatorServiceApprovals.id, row.id))
      .returning();

    await googleCalendarService.syncCalendar(row.mediatorId).catch(() => {});

    await logAudit({
      userId: actorId,
      action: "delete",
      entity: updated.mediatorId ? "mediator" : "mediator_applicant",
      entityId: updated.mediatorId ?? updated.applicantId ?? "",
      details: JSON.stringify({ serviceTypeId, calendarGoogleEventId: row.calendarGoogleEventId ?? null }),
    });

    return updated;
  }
  async linkApplicantRowsToMediator(applicantId: string, mediatorId: string) {
    const rows = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(eq(mediatorServiceApprovals.applicantId, applicantId));
    for (const row of rows) {
      const [updated] = await db
        .update(mediatorServiceApprovals)
        .set({ mediatorId })
        .where(eq(mediatorServiceApprovals.id, row.id))
        .returning();
      // Keep the mediator's service-offering list aligned with the applicant's
      // selected/requested services. Booking eligibility is still gated later
      // by the approval status, so this only restores the selected-service
      // checklist on the live profile.
      await upsertMediatorServiceType(mediatorId, updated.serviceTypeId);
    }
  }

  async sweepExpiriesAndReminders(now = new Date()) {
    const rows = await db
      .select()
      .from(mediatorServiceApprovals)
      .where(
        or(
          eq(mediatorServiceApprovals.status, "approved"),
          eq(mediatorServiceApprovals.status, "pending_review"),
        ),
      )
      .orderBy(asc(mediatorServiceApprovals.submittedAt));

    const expired: MediatorServiceApproval[] = [];
    const reminderDue: MediatorServiceApproval[] = [];
    for (const row of rows) {
      if ((row.status === "approved" || row.status === "pending_review") && isExpired(row.expiryDate, now)) {
        const [updated] = await db
          .update(mediatorServiceApprovals)
          .set({ status: "expired", expiredAt: now })
          .where(eq(mediatorServiceApprovals.id, row.id))
          .returning();
        expired.push(updated);
        if (updated.mediatorId && row.status === "approved") {
          await removeMediatorServiceType(updated.mediatorId, updated.serviceTypeId);
        }
        continue;
      }
      if (row.status === "approved" && isDueForReminder(row.expiryDate, row.reminderSentAt, now)) {
        const [updated] = await db
          .update(mediatorServiceApprovals)
          .set({ reminderSentAt: now })
          .where(eq(mediatorServiceApprovals.id, row.id))
          .returning();
        reminderDue.push(updated);
      }
    }
    return { expired, reminderDue };
  }
}

export const mediatorServiceApprovalService = new MediatorServiceApprovalService();
