import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { appointmentService } from "../services/appointment.service";
import { appointmentLifecycleHistoryService, type AppointmentLifecycleHistoryView } from "../services/appointment-lifecycle-history.service";
import { mediationSessionService } from "../services/mediation-session.service";
import { caseService } from "../services/case.service";
import { logAudit } from "../services/audit-log.service";
import { caseActivityService, clientActor, staffActor, type Actor } from "../services/case-activity.service";
import { storage } from "../storage";
import { APPOINTMENT_PAYMENT_STATUSES, type User, type Appointment } from "@shared/schema";
import { xeroService } from "../services/xero.service";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";
import { buildClientAppointmentView, buildCoMediatorAppointmentView, canClientAccessAppointment } from "../security/appointment-visibility";
import { appointmentCalendarSyncService } from "../services/appointment-calendar-sync.service";
import { buildSessionJoinAvailability } from "../security/appointment-join-policy";

const router = Router();

async function canAccessCase(user: User, caseId: string): Promise<boolean> {
  if (user.role === "superadmin" || user.role === "subadmin") return true;
  try {
    const detail = await caseService.getCaseDetailForUser(caseId, user);
    return detail.ok === true;
  } catch {
    return false;
  }
}

async function participantAppointmentIds(caseId: string, userId: string, role: "co_mediator" | "observer"): Promise<Set<string>> {
  const sessions = await storage.listMediationSessionsByCase(caseId);
  const participants = await storage.listMediationSessionParticipantsBySessionIds(sessions.map((session) => session.id));
  const acceptedSessionIds = new Set(participants
    .filter((participant) => participant.userId === userId && participant.role === role && participant.invitationStatus === "accepted")
    .map((participant) => participant.sessionId));
  return new Set(sessions
    .filter((session) => acceptedSessionIds.has(session.id) && session.appointmentId)
    .map((session) => session.appointmentId as string));
}

async function visibleAppointmentsForCase(user: User, caseId: string, appointments: Appointment[]): Promise<Appointment[]> {
  const access = await classifyCaseAccess(caseId, user);
  if (hasFullOperationalCaseAccess(access)) return appointments;
  if (access.tier === "session_co_mediator") {
    const allowedIds = await participantAppointmentIds(caseId, user.id, "co_mediator");
    return appointments.filter((appointment) => allowedIds.has(appointment.id));
  }
  if (access.tier === "client_party") {
    return appointments.filter((appointment) => canClientAccessAppointment(appointment, new Set([access.partyId])));
  }
  if (access.tier === "miam_only_mediator") {
    const partyIds = new Set(access.partyIds);
    return appointments.filter((appointment) => appointment.mediatorId === user.id && !!appointment.partyId && partyIds.has(appointment.partyId));
  }
  if (access.tier === "session_observer") {
    const allowedIds = await participantAppointmentIds(caseId, user.id, "observer");
    return appointments.filter((appointment) => allowedIds.has(appointment.id));
  }
  return [];
}

async function canAccessAppointment(user: User, appointmentId: string): Promise<boolean> {
  const appt = await appointmentService.getById(appointmentId);
  if (!appt) return false;
  const visible = await visibleAppointmentsForCase(user, appt.caseId, [appt]);
  return visible.length === 1;
}

async function canManageAppointment(user: User, appointmentId: string): Promise<boolean> {
  const appointment = await appointmentService.getById(appointmentId);
  if (!appointment) return false;
  const access = await classifyCaseAccess(appointment.caseId, user);
  if (hasFullOperationalCaseAccess(access)) return true;
  return access.tier === "miam_only_mediator"
    && appointment.mediatorId === user.id
    && appointment.partyId != null
    && access.partyIds.includes(appointment.partyId);
}

async function loadUser(req: any, res: any): Promise<User | null> {
  const user = await storage.getUser(req.session.userId);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return user;
}

function canJoinAppointment(appt: Pick<Appointment, "dateTime" | "status" | "meetingLink">): boolean {
  return buildSessionJoinAvailability({ appointment: appt }).canJoin;
}

function sanitizeAppointmentHistory(rows: AppointmentLifecycleHistoryView[], user: User) {
  const safe = user.role !== "superadmin" && user.role !== "subadmin";
  return safe ? appointmentLifecycleHistoryService.sanitize(rows as any, true) : rows;
}

async function buildAppointmentJoinActor(user: User, appt: Appointment): Promise<Actor> {
  if (user.role === "client") {
    if (appt.partyId) {
      const party = await storage.getParty(appt.partyId);
      if (party) return clientActor(party, "appointment-join");
    }
    const parties = await storage.listPartiesByUserId(user.id);
    const party = parties.find((p) => p.caseId === appt.caseId);
    if (party) return clientActor(party, "appointment-join");
    return { id: user.id, name: user.name || "Client", type: "client", channel: "appointment-join" };
  }
  return staffActor(user);
}

router.post("/api/appointments", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  const { caseId, partyId, serviceTypeId, mediatorId, dateTime, duration, notes } = req.body;
  if (!caseId || !partyId || !serviceTypeId || !mediatorId || !dateTime) {
    return res.status(400).json({ message: "caseId, partyId, serviceTypeId, mediatorId, and dateTime are required" });
  }
  if (!hasFullOperationalCaseAccess(await classifyCaseAccess(caseId, user))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await appointmentService.create({ caseId, partyId, serviceTypeId, mediatorId, dateTime: new Date(dateTime), duration, notes }, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  logAudit({ userId: user.id, action: "create", entity: "appointment", entityId: result.appointment.id });
  return res.status(201).json(result.appointment);
});

router.get("/api/appointments/case/:caseId", requirePermission("cases", "view"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canAccessCase(user, req.params.caseId))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const appointments = await visibleAppointmentsForCase(user, req.params.caseId, await appointmentService.listByCase(req.params.caseId));
  const access = await classifyCaseAccess(req.params.caseId, user);
  const enriched = await enrichAppointments(appointments, {
    forClient: user.role === "client",
    forCoMediator: access.tier === "session_co_mediator" || access.tier === "session_observer",
    adminCalendarDetails: user.role === "superadmin" || user.role === "subadmin",
  });
  return res.json(enriched);
});

router.get("/api/appointments/:id/history", requirePermission("appointments", "view"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canAccessAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const history = await appointmentLifecycleHistoryService.listByAppointment(req.params.id, {
    safe: user.role !== "superadmin" && user.role !== "subadmin",
  });
  return res.json(sanitizeAppointmentHistory(history, user));
});

router.get("/api/cases/:caseId/appointment-history", requirePermission("cases", "view"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canAccessCase(user, req.params.caseId))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const visibleAppointments = await visibleAppointmentsForCase(
    user,
    req.params.caseId,
    await appointmentService.listByCase(req.params.caseId),
  );
  const visibleAppointmentIds = new Set(visibleAppointments.map((appointment) => appointment.id));
  const history = (await appointmentLifecycleHistoryService.listByCase(req.params.caseId, {
    safe: user.role !== "superadmin" && user.role !== "subadmin",
  })).filter((row) => row.appointmentId != null && visibleAppointmentIds.has(row.appointmentId));
  return res.json(sanitizeAppointmentHistory(history, user));
});

router.get("/api/appointments/mediator/:mediatorId", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  if (user.role !== "superadmin" && user.role !== "subadmin" && user.id !== req.params.mediatorId) {
    return res.status(403).json({ message: "Access denied" });
  }
  const appointments = await appointmentService.listByMediator(req.params.mediatorId);
  return res.json(appointments);
});

router.post("/api/appointments/:id/join", requirePermission("appointments", "view"), async (req, res) => {
  const user = (req as any).user as User;
  const appt = await appointmentService.getById(req.params.id);
  if (!appt) return res.status(404).json({ message: "Appointment not found" });
  if (!(await canAccessAppointment(user, appt.id))) return res.status(403).json({ message: "Access denied" });
  const mediationSession = (await storage.listMediationSessionsByCase(appt.caseId))
    .find((session) => session.appointmentId === appt.id);
  const joinAvailability = buildSessionJoinAvailability({
    appointment: appt,
    sessionStatus: mediationSession?.status,
  });
  if (!joinAvailability.canJoin) {
    const status = joinAvailability.reasonCode === "meeting_link_missing" ? 404 : 409;
    return res.status(status).json({ message: joinAvailability.message });
  }
  const actor = await buildAppointmentJoinActor(user, appt);

  await caseActivityService.log({
    caseId: appt.caseId,
    type: "appointment_joined",
    title: "Session join link opened",
    description: `${user.name} opened the join link for appointment ${appt.id}.`,
    relatedEntityId: appt.id,
    relatedEntityType: "appointment",
    actor,
  });
  await logAudit({
    userId: user.id,
    action: "appointment_join",
    entity: "appointment",
    entityId: appt.id,
    details: JSON.stringify({ caseId: appt.caseId, role: user.role, joinedAt: new Date().toISOString() }),
    ipAddress: req.ip,
  });

  return res.json({ meetingLink: appt.meetingLink });
});

router.post("/api/appointments/:id/cancellation-request", requirePermission("appointments", "view"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "mediator" && user.role !== "client") {
    return res.status(403).json({ message: "Access denied" });
  }
  const allowed = user.role === "client"
    ? await canAccessAppointment(user, req.params.id)
    : await canManageAppointment(user, req.params.id);
  if (!allowed) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await appointmentService.requestCancellation(req.params.id, user, req.body?.reason, req.ip);
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.status(201).json({ requested: true });
});

async function enrichAppointments(rawAppointments: Appointment[], options: { forClient?: boolean; forCoMediator?: boolean; adminCalendarDetails?: boolean } = {}) {
  const serviceTypes = await storage.listServiceTypes();
  const serviceMap = new Map<string, string>(serviceTypes.map(s => [s.id, s.name]));

  const partyIds = rawAppointments.map(a => a.partyId).filter((id): id is string => id !== null && id !== undefined);
  const uniquePartyIds = Array.from(new Set(partyIds));
  const mediatorIds = rawAppointments.map(a => a.mediatorId).filter((id): id is string => id !== null && id !== undefined);
  const uniqueMediatorIds = Array.from(new Set(mediatorIds));
  const caseIds = rawAppointments.map(a => a.caseId).filter((id): id is string => id !== null && id !== undefined);
  const uniqueCaseIds = Array.from(new Set(caseIds));

  const partyMap = new Map<string, string>();
  for (const pid of uniquePartyIds) {
    const party = await storage.getParty(pid);
    if (party) partyMap.set(pid, `${party.firstName} ${party.lastName}`);
  }

  const mediatorMap = new Map<string, string>();
  for (const mid of uniqueMediatorIds) {
    const u = await storage.getUser(mid);
    if (u) mediatorMap.set(mid, u.name);
  }

  const caseMap = new Map<string, string>();
  for (const cid of uniqueCaseIds) {
    const c = await storage.getCase(cid);
    if (c) caseMap.set(cid, c.caseRef);
  }

  const xeroRecords = await xeroService.getInvoicesByAppointmentIds(rawAppointments.map(a => a.id));
  const xeroMap = new Map(xeroRecords.map(record => [record.appointmentId, {
    id: record.id,
    invoiceId: record.xeroInvoiceId,
    invoiceNumber: record.xeroInvoiceNumber,
    invoiceUrl: record.xeroInvoiceUrl,
    status: record.xeroStatus,
    sentAt: record.sentAt,
    paidAt: record.paidAt,
    lastSyncedAt: record.lastSyncedAt,
    lastError: record.lastError,
    amountPence: record.amountPence,
    currency: record.currency,
  }]));
  const calendarSyncJobs = await Promise.all(rawAppointments.map((appointment) => appointmentCalendarSyncService.getJob(appointment.id)));
  const calendarSyncMap = new Map(calendarSyncJobs.filter((job): job is NonNullable<typeof job> => !!job).map((job) => [job.appointmentId, job]));

  return rawAppointments.map(a => {
    const calendarJob = calendarSyncMap.get(a.id);
    const enriched = {
      ...a,
      hasMeetingLink: Boolean(a.meetingLink),
      canJoin: canJoinAppointment(a),
      partyName: (a.partyId && partyMap.get(a.partyId)) || null,
      mediatorName: (a.mediatorId && mediatorMap.get(a.mediatorId)) || null,
      serviceName: (a.serviceTypeId && serviceMap.get(a.serviceTypeId)) || null,
      caseReference: (a.caseId && caseMap.get(a.caseId)) || null,
      xeroInvoice: xeroMap.get(a.id) || null,
      calendarSync: calendarJob ? {
        status: calendarJob.status,
        attemptCount: calendarJob.attemptCount,
        lastAttemptAt: calendarJob.lastAttemptAt,
        failureStage: options.adminCalendarDetails ? calendarJob.failureStage : null,
        lastErrorCode: options.adminCalendarDetails ? calendarJob.lastErrorCode : null,
        lastErrorMessage: options.adminCalendarDetails ? calendarJob.lastErrorMessage : null,
      } : null,
    };
    if (options.forClient) return buildClientAppointmentView(enriched);
    if (options.forCoMediator) return buildCoMediatorAppointmentView(enriched);
    return enriched;
  });
}

router.get("/api/appointments", requirePermission("appointments", "view"), async (req, res) => {
  const user = (req as any).user as User;
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ message: "start and end query params are required (ISO date strings)" });
  }
  const startDate = new Date(start as string);
  const endDate = new Date(end as string);

  let rawAppointments;

  if (user.role === "superadmin" || user.role === "subadmin" || user.role === "staff") {
    rawAppointments = await appointmentService.listByDateRange(startDate, endDate);
  } else if (user.role === "mediator") {
    rawAppointments = await appointmentService.listByMediatorDateRange(user.id, startDate, endDate);
  } else if (user.role === "client") {
    const parties = await storage.listPartiesByUserId(user.id);
    const partyIds = parties.map(p => p.id);
    const caseIds = Array.from(new Set(parties.map(p => p.caseId)));
    const [partyAppointments, caseAppointments] = await Promise.all([
      appointmentService.listByPartyIdsDateRange(partyIds, startDate, endDate),
      storage.listAppointmentsByCaseIdsDateRange(caseIds, startDate, endDate),
    ]);
    const partyIdSet = new Set(partyIds);
    const byId = new Map<string, Appointment>();
    for (const appt of [...partyAppointments, ...caseAppointments.filter((appt) => !appt.partyId || partyIdSet.has(appt.partyId))]) {
      byId.set(appt.id, appt);
    }
    rawAppointments = Array.from(byId.values());
  } else {
    return res.status(403).json({ message: "Access denied" });
  }

  const enriched = await enrichAppointments(rawAppointments, {
    forClient: user.role === "client",
    adminCalendarDetails: user.role === "superadmin" || user.role === "subadmin",
  });
  return res.json(enriched);
});

router.patch("/api/appointments/:id", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canManageAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const { dateTime, duration, notes, meetingLink } = req.body;
  const updateData: Record<string, unknown> = {};
  if (dateTime !== undefined) updateData.dateTime = new Date(dateTime);
  if (duration !== undefined) updateData.duration = duration;
  if (notes !== undefined) updateData.notes = notes;
  if (meetingLink !== undefined) {
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      return res.status(403).json({ message: "Only admins can manage meeting links" });
    }
    if (meetingLink === null || meetingLink === "") {
      updateData.meetingLink = null;
    } else {
      try {
        const url = new URL(meetingLink);
        if (url.protocol !== "https:") {
          return res.status(400).json({ message: "Meeting link must be a valid HTTPS URL" });
        }
        updateData.meetingLink = meetingLink;
      } catch {
        return res.status(400).json({ message: "Meeting link must be a valid URL" });
      }
    }
  }
  const result = await appointmentService.update(req.params.id, updateData, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  logAudit({ userId: user.id, action: "update", entity: "appointment", entityId: req.params.id });
  return res.json(result.appointment);
});

router.patch("/api/appointments/:id/payment-status", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only admins can update appointment payment status" });
  }
  if (!(await canAccessAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const { paymentStatus, paymentNotes } = req.body as { paymentStatus?: string; paymentNotes?: string | null };
  if (!paymentStatus || !(APPOINTMENT_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) {
    return res.status(400).json({ message: "Invalid appointment payment status" });
  }
  const xeroInvoice = await xeroService.getInvoiceByAppointment(req.params.id);
  const appointment = await storage.getAppointment(req.params.id);
  if (xeroInvoice && appointment?.paymentStatus === "paid" && paymentStatus !== "paid" && paymentNotes !== "override_xero") {
    return res.status(409).json({ message: "This appointment is linked to a paid Xero invoice. Sync with Xero or add an explicit override note before changing it." });
  }
  const result = await appointmentService.updatePaymentStatus(
    req.params.id,
    { paymentStatus, paymentNotes },
    staffActor(user),
  );
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.appointment);
});

router.patch("/api/appointments/:id/miam-arrangement", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only admins can resolve MIAM mediator arrangements" });
  }
  if (!(await canManageAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const { mediatorId, dateTime } = req.body as { mediatorId?: string; dateTime?: string | null };
  if (!mediatorId || typeof mediatorId !== "string") {
    return res.status(400).json({ message: "mediatorId is required" });
  }
  const result = await appointmentService.resolvePaidMiamArrangement(
    req.params.id,
    { mediatorId, dateTime: dateTime ? new Date(dateTime) : null },
    staffActor(user),
  );
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  return res.json(result.appointment);
});

router.delete("/api/appointments/:id", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only administrators can permanently delete appointments" });
  }
  if (!(await canManageAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await appointmentService.delete(req.params.id, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  logAudit({ userId: user.id, action: "delete", entity: "appointment", entityId: req.params.id });
  return res.status(204).send();
});

// Live read of both Google calendar legs for the side panel "Calendar events"
// section. Staff-only; mediators get the BFM (client) side redacted.
router.get("/api/appointments/:id/calendar-events", requireAuth, async (req, res) => {
  const user = await loadUser(req, res);
  if (!user) return;
  const role = user.role;
  if (role !== "superadmin" && role !== "subadmin" && role !== "mediator") {
    return res.status(403).json({ message: "Access denied" });
  }
  if (!(await canAccessAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const appt = await appointmentService.getById(req.params.id);
  if (!appt) return res.status(404).json({ message: "Appointment not found" });
  if ((await classifyCaseAccess(appt.caseId, user)).tier === "session_observer") {
    return res.status(403).json({ message: "Calendar event details are not available to observers" });
  }

  const isFullAccess = role === "superadmin" || role === "subadmin";

  const { googleCalendarService } = await import("../services/google-calendar.service");

  const result: {
    mediatorEvent: {
      googleEventId: string;
      summary: string | null;
      start: string | null;
      end: string | null;
      attendees: { email: string; displayName?: string; responseStatus?: string }[];
      organizerEmail: string | null;
      htmlLink: string | null;
      fetchedAt: string;
    } | null;
    bfmEvent: {
      googleEventId: string;
      summary: string | null;
      start: string | null;
      end: string | null;
      attendees: { email: string; displayName?: string; responseStatus?: string }[];
      organizerEmail: string | null;
      htmlLink: string | null;
      fetchedAt: string;
    } | null;
  } = { mediatorEvent: null, bfmEvent: null };

  if (appt.mediatorId && appt.googleBookingEventId) {
    try {
      const ev = await googleCalendarService.getEventById(appt.mediatorId, appt.googleBookingEventId);
      if (ev) {
        result.mediatorEvent = {
          googleEventId: ev.id,
          summary: ev.summary,
          start: ev.start.toISOString(),
          end: ev.end.toISOString(),
          attendees: ev.attendees,
          organizerEmail: ev.organizerEmail,
          htmlLink: ev.htmlLink,
          fetchedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error("[Appt Calendar Events] mediator-side fetch failed:", err);
    }
  }

  if (appt.googleClientEventId) {
    try {
      const ev = await googleCalendarService.getBfmEventById(appt.googleClientEventId);
      if (ev) {
        // Redact client email + info@ link from mediators.
        const attendees = isFullAccess
          ? ev.attendees
          : ev.attendees.map(a => ({
              email: "[redacted]",
              displayName: a.displayName,
              responseStatus: a.responseStatus,
            }));
        result.bfmEvent = {
          googleEventId: ev.id,
          summary: ev.summary,
          start: ev.start.toISOString(),
          end: ev.end.toISOString(),
          attendees,
          organizerEmail: isFullAccess ? ev.organizerEmail : (ev.organizerEmail ? "[redacted]" : null),
          htmlLink: isFullAccess ? ev.htmlLink : null,
          fetchedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error("[Appt Calendar Events] BFM-side fetch failed:", err);
    }
  }

  return res.json(result);
});

router.patch("/api/appointments/:id/confirm", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canManageAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await appointmentService.confirm(req.params.id, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  logAudit({ userId: user.id, action: "confirm_appointment", entity: "appointment", entityId: req.params.id });
  return res.json(result.appointment);
});

router.post("/api/appointments/:id/calendar-sync/retry", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== "superadmin" && user.role !== "subadmin") {
    return res.status(403).json({ message: "Only administrators can retry calendar synchronization" });
  }
  if (!(await canAccessAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const appointment = await appointmentService.getById(req.params.id);
  if (!appointment) return res.status(404).json({ message: "Appointment not found" });
  if (appointment.status !== "confirmed" || appointment.paymentStatus !== "paid") {
    return res.status(409).json({ message: "Calendar synchronization can be retried only for paid confirmed appointments" });
  }
  const existingJob = await appointmentCalendarSyncService.getJob(req.params.id);
  if (!existingJob) return res.status(404).json({ message: "Calendar synchronization job not found" });
  if (existingJob.status !== "failed") {
    return res.status(409).json({ message: "Calendar synchronization can be manually retried only after automatic retries have failed" });
  }
  const job = await appointmentCalendarSyncService.retry(req.params.id);
  if (!job) return res.status(404).json({ message: "Calendar synchronization job not found" });
  await logAudit({
    userId: user.id,
    action: "retry_calendar_sync",
    entity: "appointment",
    entityId: appointment.id,
    details: JSON.stringify({ previousStatus: existingJob.status }),
  });
  return res.status(202).json({ status: "pending" });
});

router.patch("/api/appointments/:id/cancel", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canManageAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await appointmentService.cancel(req.params.id, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  const sessions = await storage.listMediationSessionsByCase(result.appointment.caseId);
  if (sessions.some((session) => session.appointmentId === result.appointment.id)) {
    await mediationSessionService.createAppointmentAcknowledgementTask(result.appointment, "cancelled");
  }
  logAudit({ userId: user.id, action: "cancel_appointment", entity: "appointment", entityId: req.params.id });
  return res.json(result.appointment);
});

router.patch("/api/appointments/:id/complete", requirePermission("appointments", "edit"), async (req, res) => {
  const user = (req as any).user as User;
  if (!(await canManageAppointment(user, req.params.id))) {
    return res.status(403).json({ message: "Access denied" });
  }
  const result = await appointmentService.complete(req.params.id, staffActor(user));
  if (!result.ok) return res.status(result.status).json({ message: result.error });
  logAudit({ userId: user.id, action: "update", entity: "appointment", entityId: req.params.id, details: JSON.stringify({ status: "completed" }) });
  return res.json(result.appointment);
});

export default router;
