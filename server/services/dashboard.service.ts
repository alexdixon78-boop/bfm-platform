import { db } from "../db";
import { formatAppointmentTime } from "@shared/booking-time";
import { storage } from "../storage";
import {
  appointments,
  cases,
  caseInvoices,
  serviceTypes,
  mediationSessions,
  notifications,
  enquiries,
  parties,
  clients,
  users,
  mediatorServiceScheduleSlots,
  caseDocumentRequests,
} from "@shared/schema";
import { and, asc, desc, eq, gt, gte, lte, ne, or, inArray, sql } from "drizzle-orm";
import { financeService } from "./finance.service";
import { mediationSessionService } from "./mediation-session.service";
import { financialDisclosureService, type FinancialDisclosureFolderView } from "./financial-disclosure.service";
import { isClientDemographicComplete } from "../utils/demographic-completion";
import { getUkDateKey } from "../utils/uk-wall-clock";

type DashboardUser = { id: string; role: string };

type DashboardAppointment = {
  id: string;
  kind: "appointment" | "service_event";
  time: string;
  clientNames: string;
  type: string;
  mediator: string;
  location: string;
  status: string;
};

type ClientDashboardAppointment = {
  id: string;
  dateTime: Date;
  dateTimeBasis: string;
  duration: number;
  sessionType: string;
  mediatorName: string;
  hasMeetingLink: boolean;
  canJoin: boolean;
  status: string;
  paymentStatus: string | null;
};

type ClientDashboardAction = {
  id: string;
  kind: "demographic" | "payment" | "signed_form" | "document" | "task";
  title: string;
  message: string;
  urgency: string;
  href: string;
  source: "derived" | "task";
  invoiceId?: string;
  invoiceNumber?: string;
  subtotalPence?: number;
  voucherDiscountPence?: number;
  totalPence?: number;
  outstandingPence?: number;
  currency?: string;
  paymentLinkUrl?: string | null;
  isMediationSessionInvoice?: boolean;
};

type ClientDashboardNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  urgency: string;
  appointmentId: string | null;
  createdAt: Date;
};

type ClientDashboardCase = {
  caseId: string;
  caseRef: string;
  stage: string;
  status: string;
  issueType: string | null;
  mediatorName: string;
  nextConfirmedAppointment: ClientDashboardAppointment | null;
  pendingAppointment: ClientDashboardAppointment | null;
  tasks: ClientDashboardAction[];
  notifications: ClientDashboardNotification[];
};

const ACTIVE_APPT_STATUSES = ["hold", "held", "confirmed"] as const;
const ACTIVE_TASK_STATUSES = ["active", "in_progress", "follow_up"] as const;
const ACTIVE_MEDIATION_SESSION_FORM_STATUSES = ["pending", "allocated", "scheduled"] as const;
const ADMIN_TASK_TYPES = ["task", "appointment_cancellation_request", "mediation_session_held_acknowledgement", "mediation_session_confirmed_acknowledgement", "mediation_session_cancelled_acknowledgement", "mediation_session_expired_acknowledgement", "mediation_session_reschedule_requested", "mediation_session_next_session_requested"] as const;
const SIGNED_FORM_PENDING_STAGES = [
  "C100 signed form pending",
  "Form A signed form pending",
  "FM1 signed form pending",
] as const;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfThisWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

function endOfThisWeek(): Date {
  const start = startOfThisWeek();
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function statusLabel(status: string, paymentStatus?: string | null): string {
  if (status === "confirmed") return "Confirmed";
  if ((status === "hold" || status === "held") && paymentStatus === "paid") return "Pending confirmation";
  if (status === "hold" || status === "held") return "Pending payment";
  if (status === "cancelled") return "Cancelled";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function canClientJoinAppointment(row: { status: string; dateTime: Date; meetingLink: string | null }): boolean {
  return row.status === "confirmed" && Boolean(row.meetingLink) && getUkDateKey(row.dateTime) === getUkDateKey();
}

function clientAppointmentFromRow(row: {
  id: string;
  dateTime: Date;
  dateTimeBasis: string;
  duration: number;
  status: string;
  paymentStatus: string | null;
  meetingLink: string | null;
  serviceTypeName: string | null;
  mediatorName: string | null;
}): ClientDashboardAppointment {
  return {
    id: row.id,
    dateTime: row.dateTime,
    dateTimeBasis: row.dateTimeBasis,
    duration: row.duration,
    sessionType: row.serviceTypeName ?? "Appointment",
    mediatorName: row.mediatorName ?? "Unassigned",
    hasMeetingLink: Boolean(row.meetingLink),
    canJoin: canClientJoinAppointment(row),
    status: statusLabel(row.status, row.paymentStatus),
    paymentStatus: row.paymentStatus ?? null,
  };
}

function taskKindFromTitle(task: { title: string; message: string }): ClientDashboardAction["kind"] {
  const text = `${task.title} ${task.message}`.toLowerCase();
  if (text.includes("upload") || text.includes("document")) return "document";
  if (text.includes("invoice") || text.includes("pay") || text.includes("payment")) return "payment";
  if (text.includes("sign") || text.includes("form")) return "signed_form";
  return "task";
}

function isMediationSessionFormTask(task: { title: string; message: string }): boolean {
  const text = `${task.title} ${task.message}`.toLowerCase();
  return taskKindFromTitle(task) === "signed_form" && text.includes("mediation session");
}

function requiredFormLabel(formType: string): string {
  if (formType === "agreement_to_mediate_confidentiality") return "Confidentiality + Agreement to Mediate";
  if (formType === "voucher_scheme_client_consent") return "Family Mediation Voucher Scheme client consent";
  if (formType === "voucher_diversity_questionnaire_opt_in") return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
  if (formType === "voucher_moj_research_contact_opt_in") return "Family Mediation Voucher Scheme: Privacy Policy and Client Consent";
  return "required mediation form";
}

function isBlockingMediationSessionForm(formType: string): boolean {
  return formType === "agreement_to_mediate_confidentiality" || formType === "voucher_scheme_client_consent";
}

function clientTaskHref(caseId: string, kind: ClientDashboardAction["kind"], task?: { title: string; message: string }): string {
  const text = task ? `${task.title} ${task.message}`.toLowerCase() : "";
  if (text.includes("financial disclosure")) return `/cases/${caseId}?tab=financial-disclosure`;
  if (kind === "signed_form" && text.includes("mediation session")) return `/cases/${caseId}?tab=mediation-sessions`;
  if (kind === "document" || kind === "signed_form") return `/cases/${caseId}?tab=documents`;
  if (kind === "payment") return `/cases/${caseId}?tab=payments`;
  return `/cases/${caseId}`;
}

function findFinancialDisclosureAction(
  caseId: string,
  user: DashboardUser,
  folders: FinancialDisclosureFolderView[],
): ClientDashboardAction | null {
  const folder = folders.find((candidate) => candidate.status === "active");
  if (!folder) return null;

  const booklet = folder.items.find((item) => item.itemType === "online_disclosure_booklet");
  const bookletIncomplete = !booklet || booklet.status !== "completed";
  const hasClientUploadedDisclosureDocument = folder.documents.some((document) => document.uploadedBy === user.id);

  if (!bookletIncomplete && hasClientUploadedDisclosureDocument) return null;

  return {
    id: `financial-disclosure:${caseId}:${folder.id}`,
    kind: "document",
    title: "Complete financial disclosure",
    message: "Please complete your online financial disclosure booklet and upload supporting evidence.",
    urgency: "amber",
    href: `/cases/${caseId}?tab=financial-disclosure`,
    source: "derived",
  };
}

export class DashboardService {
  private async getMediatorCaseIds(mediatorId: string): Promise<Set<string>> {
    const allCases = await storage.listCases();
    const caseIds = new Set<string>();
    for (const c of allCases) {
      if (c.mediatorId === mediatorId) {
        caseIds.add(c.id);
        continue;
      }
      const caseParties = await storage.listPartiesByCase(c.id);
      if (caseParties.some(p => p.miamMediatorId === mediatorId || p.allocatedMediatorId === mediatorId)) {
        caseIds.add(c.id);
      }
    }
    return caseIds;
  }

  async getStats(user: DashboardUser) {
    const isMediator = user.role === "mediator";
    const weekStart = startOfThisWeek();
    const weekEnd = endOfThisWeek();
    const todayStart = startOfToday();
    const todayEnd = endOfToday();

    const allCases = await storage.listCases();
    let scopedCaseIds: Set<string> | null = null;
    if (isMediator) {
      scopedCaseIds = await this.getMediatorCaseIds(user.id);
    }

    const filteredCases = scopedCaseIds
      ? allCases.filter(c => scopedCaseIds!.has(c.id))
      : allCases;

    const activeCases = filteredCases.filter(c => c.status === "Active").length;

    let newEnquiries = 0;
    let outstandingEnquiries = 0;
    if (!isMediator) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(enquiries)
        .where(
          and(
            eq(enquiries.status, "New"),
            gte(enquiries.dateReceived, todayStart),
            lte(enquiries.dateReceived, todayEnd),
          ),
        );
      newEnquiries = Number(count) || 0;

      const [{ count: outstandingCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(enquiries)
        .innerJoin(cases, eq(enquiries.convertedCaseId, cases.id))
        .where(
          and(
            ne(enquiries.status, "Archived"),
            ne(enquiries.status, "Closed"),
            sql`COALESCE(${cases.intakeStatus}, '') <> 'Closed'`,
            sql`${cases.claimedBy} IS NULL`,
          ),
        );
      outstandingEnquiries = Number(outstandingCount) || 0;
    }

    const apptConditions = [
      gte(appointments.dateTime, weekStart),
      lte(appointments.dateTime, weekEnd),
      inArray(appointments.status, ACTIVE_APPT_STATUSES as unknown as string[]),
    ];
    if (isMediator) {
      apptConditions.push(eq(appointments.mediatorId, user.id));
    }

    const weekAppointments = await db
      .select({
        id: appointments.id,
        category: serviceTypes.category,
      })
      .from(appointments)
      .leftJoin(serviceTypes, eq(appointments.serviceTypeId, serviceTypes.id))
      .where(and(...apptConditions));

    let miamsThisWeek = 0;
    let sessionsThisWeek = 0;
    for (const a of weekAppointments) {
      if (a.category === "MIAM") miamsThisWeek += 1;
      else sessionsThisWeek += 1;
    }

    const buildTaskConditions = (recipientRole: "client" | "admin") => {
      const conditions = [
        recipientRole === "admin"
          ? inArray(notifications.type, ADMIN_TASK_TYPES as unknown as string[])
          : eq(notifications.type, "task"),
        inArray(notifications.status, ACTIVE_TASK_STATUSES as unknown as string[]),
        eq(notifications.recipientRole, recipientRole),
      ];
      if (isMediator) {
        const caseIdArr = Array.from(scopedCaseIds ?? []);
        const caseScope = caseIdArr.length > 0
          ? inArray(notifications.caseId, caseIdArr)
          : sql`false`;
        if (recipientRole === "client") {
          // Client-action tasks: only those tied to the mediator's cases.
          // Clients aren't recipients/assignees of staff-style tasks, so a
          // case-membership filter is the correct mediator scope here.
          conditions.push(caseScope);
        } else {
          // Admin/BFM-action tasks: tasks the mediator owns directly OR
          // tasks tied to one of their cases.
          conditions.push(
            or(
              eq(notifications.recipientId, user.id),
              eq(notifications.assignedTo, user.id),
              caseScope,
            )!,
          );
        }
      }
      return conditions;
    };

    const [{ count: clientActionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...buildTaskConditions("client")));

    const [{ count: bfmActionCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...buildTaskConditions("admin")));

    const overduePayments = isMediator ? 0 : await financeService.countOverdueInvoices();

    return {
      newEnquiries,
      outstandingEnquiries,
      activeCases,
      miamsThisWeek,
      sessionsThisWeek,
      overduePayments,
      awaitingClientAction: Number(clientActionCount) || 0,
      awaitingBfmAction: Number(bfmActionCount) || 0,
    };
  }

  async getAppointments(user: DashboardUser): Promise<DashboardAppointment[]> {
    const isMediator = user.role === "mediator";
    const todayStart = startOfToday();
    const todayEnd = endOfToday();

    const conditions = [
      gte(appointments.dateTime, todayStart),
      lte(appointments.dateTime, todayEnd),
      inArray(appointments.status, ACTIVE_APPT_STATUSES as unknown as string[]),
    ];
    if (isMediator) {
      conditions.push(eq(appointments.mediatorId, user.id));
    }

    const rows = await db
      .select({
        id: appointments.id,
        dateTime: appointments.dateTime,
        dateTimeBasis: appointments.dateTimeBasis,
        status: appointments.status,
        meetingLink: appointments.meetingLink,
        caseId: appointments.caseId,
        partyId: appointments.partyId,
        parentGoogleEventId: appointments.parentGoogleEventId,
        partyClientId: parties.clientId,
        partyClientFirst: clients.firstName,
        partyClientLast: clients.lastName,
        serviceTypeName: serviceTypes.name,
        mediatorName: users.name,
      })
      .from(appointments)
      .leftJoin(parties, eq(appointments.partyId, parties.id))
      .leftJoin(clients, eq(parties.clientId, clients.id))
      .leftJoin(serviceTypes, eq(appointments.serviceTypeId, serviceTypes.id))
      .leftJoin(users, eq(appointments.mediatorId, users.id))
      .where(and(...conditions))
      .orderBy(appointments.dateTime);

    const serviceConditions = [
      eq(mediatorServiceScheduleSlots.lifecycle, "active"),
      gte(mediatorServiceScheduleSlots.startAt, todayStart),
      lte(mediatorServiceScheduleSlots.startAt, todayEnd),
    ];
    if (isMediator) {
      serviceConditions.push(eq(mediatorServiceScheduleSlots.mediatorId, user.id));
    }
    const serviceRows = await db
      .select({
        id: mediatorServiceScheduleSlots.id,
        mediatorId: mediatorServiceScheduleSlots.mediatorId,
        startAt: mediatorServiceScheduleSlots.startAt,
        endAt: mediatorServiceScheduleSlots.endAt,
        googleEventId: mediatorServiceScheduleSlots.googleEventId,
        serviceName: serviceTypes.name,
        serviceCategory: serviceTypes.category,
        mediatorName: users.name,
      })
      .from(mediatorServiceScheduleSlots)
      .leftJoin(serviceTypes, eq(mediatorServiceScheduleSlots.serviceTypeId, serviceTypes.id))
      .leftJoin(users, eq(mediatorServiceScheduleSlots.mediatorId, users.id))
      .where(and(...serviceConditions))
      .orderBy(mediatorServiceScheduleSlots.startAt);

    const bookedServiceParentIds = new Set(
      rows
        .map((row) => row.parentGoogleEventId)
        .filter((id): id is string => !!id),
    );

    const result: DashboardAppointment[] = [];
    for (const r of rows) {
      let clientNames = "";
      if (r.partyClientFirst || r.partyClientLast) {
        clientNames = `${r.partyClientFirst ?? ""} ${r.partyClientLast ?? ""}`.trim();
      } else {
        const caseParties = await storage.listPartiesByCase(r.caseId);
        const names: string[] = [];
        for (const p of caseParties) {
          const c = await storage.getClient(p.clientId);
          if (c) names.push(`${c.firstName} ${c.lastName}`.trim());
        }
        clientNames = names.join(" & ") || "Unknown client";
      }

      result.push({
        id: r.id,
        kind: "appointment",
        time: formatAppointmentTime(r.dateTime, r.dateTimeBasis === "instant" ? "instant" : "wall_clock_utc"),
        clientNames,
        type: r.serviceTypeName ?? "Appointment",
        mediator: r.mediatorName ?? "Unassigned",
        location: r.meetingLink ?? "Video Call",
        status: statusLabel(r.status),
      });
    }

    for (const r of serviceRows) {
      if (r.googleEventId && bookedServiceParentIds.has(r.googleEventId)) continue;
      result.push({
        id: r.id,
        kind: "service_event",
        time: formatAppointmentTime(r.startAt, "instant"),
        clientNames: "Service availability",
        type: r.serviceName ?? "Service event",
        mediator: r.mediatorName ?? "Unassigned",
        location: r.serviceCategory ?? "Service event",
        status: "Approved",
      });
    }

    result.sort((a, b) => a.time.localeCompare(b.time));

    return result;
  }

  async getMediatorSessionIndicators(user: DashboardUser) {
    return mediationSessionService.getMediatorSessionIndicators({
      id: user.id,
      role: user.role,
      name: "Mediator",
    });
  }

  async getClientDashboard(user: DashboardUser): Promise<{ cases: ClientDashboardCase[] }> {
    if (user.role !== "client") {
      const err = new Error("Client dashboard is only available to client users");
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    const clientParties = await storage.listPartiesByUserId(user.id);
    const partiesByCaseId = new Map<string, typeof clientParties[number]>();
    for (const party of clientParties) {
      if (!partiesByCaseId.has(party.caseId)) partiesByCaseId.set(party.caseId, party);
    }

    const caseRows = [];
    for (const [caseId, party] of Array.from(partiesByCaseId.entries())) {
      const c = await storage.getCase(caseId);
      if (!c || c.status === "Archived" || c.status === "Closed") continue;
      const mediator = c.mediatorId ? await storage.getUser(c.mediatorId) : null;
      caseRows.push({ case: c, party, mediatorName: mediator?.name || "Unassigned" });
    }

    if (caseRows.length === 0) return { cases: [] };

    const caseIds = caseRows.map((row) => row.case.id);
    const partyIds = caseRows.map((row) => row.party.id);
    const clientIds = caseRows.map((row) => row.party.clientId);
    const clientDashboardAppointmentStart = startOfToday();

    const outstandingDocumentRequestRows = await db
      .select()
      .from(caseDocumentRequests)
      .where(and(
        inArray(caseDocumentRequests.partyId, partyIds),
        eq(caseDocumentRequests.status, "outstanding"),
      ))
      .orderBy(desc(caseDocumentRequests.createdAt));
    const documentRequestsByCaseId = new Map<string, typeof outstandingDocumentRequestRows>();
    for (const request of outstandingDocumentRequestRows) {
      const list = documentRequestsByCaseId.get(request.caseId) ?? [];
      list.push(request);
      documentRequestsByCaseId.set(request.caseId, list);
    }

    const appointmentRows = await db
      .select({
        id: appointments.id,
        caseId: appointments.caseId,
        partyId: appointments.partyId,
        dateTime: appointments.dateTime,
        dateTimeBasis: appointments.dateTimeBasis,
        duration: appointments.duration,
        status: appointments.status,
        paymentStatus: appointments.paymentStatus,
        meetingLink: appointments.meetingLink,
        serviceTypeName: serviceTypes.name,
        mediatorName: users.name,
      })
      .from(appointments)
      .leftJoin(serviceTypes, eq(appointments.serviceTypeId, serviceTypes.id))
      .leftJoin(users, eq(appointments.mediatorId, users.id))
      .where(and(
        inArray(appointments.caseId, caseIds),
        or(inArray(appointments.partyId, partyIds), sql`${appointments.partyId} IS NULL`),
        gte(appointments.dateTime, clientDashboardAppointmentStart),
        inArray(appointments.status, ACTIVE_APPT_STATUSES as unknown as string[]),
      ))
      .orderBy(asc(appointments.dateTime));

    const apptsByCaseId = new Map<string, typeof appointmentRows>();
    for (const row of appointmentRows) {
      const list = apptsByCaseId.get(row.caseId) ?? [];
      list.push(row);
      apptsByCaseId.set(row.caseId, list);
    }

    const explicitTaskRows = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, user.id),
        eq(notifications.recipientRole, "client"),
        eq(notifications.type, "task"),
        ne(notifications.status, "completed"),
        inArray(notifications.caseId, caseIds),
      ))
      .orderBy(desc(notifications.createdAt));

    const explicitTasksByCaseId = new Map<string, typeof explicitTaskRows>();
    for (const task of explicitTaskRows) {
      if (!task.caseId) continue;
      if (isMediationSessionFormTask(task)) continue;
      const list = explicitTasksByCaseId.get(task.caseId) ?? [];
      list.push(task);
      explicitTasksByCaseId.set(task.caseId, list);
    }

    const notificationRows = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, user.id),
        eq(notifications.recipientRole, "client"),
        ne(notifications.type, "task"),
        ne(notifications.status, "completed"),
        inArray(notifications.caseId, caseIds),
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const notificationsByCaseId = new Map<string, typeof notificationRows>();
    for (const notice of notificationRows) {
      if (!notice.caseId) continue;
      const list = notificationsByCaseId.get(notice.caseId) ?? [];
      list.push(notice);
      notificationsByCaseId.set(notice.caseId, list);
    }

    const invoiceRows = await db
      .select({
        id: caseInvoices.id,
        caseId: caseInvoices.caseId,
        billToClientId: caseInvoices.billToClientId,
        invoiceNumber: caseInvoices.invoiceNumber,
        status: caseInvoices.status,
        paymentStatus: caseInvoices.paymentStatus,
        subtotalPence: caseInvoices.subtotalPence,
        voucherDiscountPence: caseInvoices.voucherDiscountPence,
        totalPence: caseInvoices.totalPence,
        outstandingPence: caseInvoices.outstandingPence,
        currency: caseInvoices.currency,
        paymentLinkUrl: caseInvoices.paymentLinkUrl,
        serviceName: serviceTypes.name,
        dueDate: caseInvoices.dueDate,
      })
      .from(caseInvoices)
      .leftJoin(serviceTypes, eq(caseInvoices.serviceTypeId, serviceTypes.id))
      .where(and(
        inArray(caseInvoices.caseId, caseIds),
        inArray(caseInvoices.billToClientId, clientIds),
        ne(caseInvoices.status, "void"),
        ne(caseInvoices.paymentStatus, "paid"),
        gt(caseInvoices.outstandingPence, 0),
      ))
      .orderBy(asc(caseInvoices.dueDate), desc(caseInvoices.createdAt));

    const invoicesByCaseId = new Map<string, typeof invoiceRows>();
    for (const invoice of invoiceRows) {
      const list = invoicesByCaseId.get(invoice.caseId) ?? [];
      list.push(invoice);
      invoicesByCaseId.set(invoice.caseId, list);
    }

    const partyRequiredForms = await storage.listPartyRequiredFormsByPartyIds(partyIds);
    const activeMediationSessionRows = await db
      .select({ id: mediationSessions.id, caseId: mediationSessions.caseId })
      .from(mediationSessions)
      .where(and(
        inArray(mediationSessions.caseId, caseIds),
        inArray(mediationSessions.status, ACTIVE_MEDIATION_SESSION_FORM_STATUSES as unknown as string[]),
      ));
    const activeMediationSessionIds = new Set(activeMediationSessionRows.map((session) => session.id));
    const activeMediationSessionCaseIds = new Set(activeMediationSessionRows.map((session) => session.caseId));
    const caseHasActiveMediationSession = (caseId: string) => activeMediationSessionCaseIds.has(caseId);
    const pendingSessionFormsByCaseId = new Map<string, typeof partyRequiredForms>();
    for (const form of partyRequiredForms) {
      if (form.status === "signed" || form.withdrawnAt) continue;
      if (!isBlockingMediationSessionForm(form.formType)) continue;
      if (form.mediationSessionId) {
        if (!activeMediationSessionIds.has(form.mediationSessionId)) continue;
      } else if (!caseHasActiveMediationSession(form.caseId)) {
        continue;
      }
      const list = pendingSessionFormsByCaseId.get(form.caseId) ?? [];
      list.push(form);
      pendingSessionFormsByCaseId.set(form.caseId, list);
    }

    const casesPayload: ClientDashboardCase[] = [];
    for (const row of caseRows) {
      const caseAppointments = apptsByCaseId.get(row.case.id) ?? [];
      const nextConfirmed = caseAppointments.find((appt) => appt.status === "confirmed") ?? null;
      const pending = caseAppointments.find((appt) => appt.status === "hold" || appt.status === "held") ?? null;
      const actions: ClientDashboardAction[] = [];

      const demographic = await storage.getDemographicDataByParty(row.party.id);
      if (!isClientDemographicComplete(demographic)) {
        actions.push({
          id: `demographic:${row.case.id}:${row.party.id}`,
          kind: "demographic",
          title: "Complete demographic information",
          message: "Please complete your demographic information for this case.",
          urgency: "amber",
          href: `/cases/${row.case.id}?tab=demographics`,
          source: "derived",
        });
      }

      const outstandingInvoices = invoicesByCaseId.get(row.case.id) ?? [];
      for (const invoice of outstandingInvoices) {
        if (invoice.billToClientId !== row.party.clientId) continue;
        actions.push({
          id: `payment:${invoice.id}`,
          kind: "payment",
          title: "Pay outstanding invoice",
          message: `${invoice.invoiceNumber} has an outstanding balance.`,
          urgency: invoice.dueDate && invoice.dueDate.getTime() < Date.now() ? "red" : "amber",
          href: invoice.paymentLinkUrl || `/cases/${row.case.id}?tab=payments`,
          source: "derived",
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          subtotalPence: invoice.subtotalPence,
          voucherDiscountPence: invoice.voucherDiscountPence,
          totalPence: invoice.totalPence,
          outstandingPence: invoice.outstandingPence,
          currency: invoice.currency,
          paymentLinkUrl: invoice.paymentLinkUrl,
          isMediationSessionInvoice: invoice.serviceName === "Mediation Sessions",
        });
      }

      const pendingSessionForms = (pendingSessionFormsByCaseId.get(row.case.id) ?? [])
        .filter((form) => form.partyId === row.party.id);
      if (pendingSessionForms.length > 0) {
        const labels = Array.from(new Set(pendingSessionForms.map((form) => requiredFormLabel(form.formType))));
        actions.push({
          id: `mediation-session-form:${row.case.id}:${row.party.id}`,
          kind: "signed_form",
          title: labels.includes("Confidentiality + Agreement to Mediate")
            ? "Sign Confidentiality + Agreement to Mediate"
            : "Sign required mediation forms",
          message: `${labels.join(", ")} ${labels.length === 1 ? "is" : "are"} awaiting your signature.`,
          urgency: "amber",
          href: `/cases/${row.case.id}?tab=mediation-sessions`,
          source: "derived",
        });
      }

      if ((SIGNED_FORM_PENDING_STAGES as readonly string[]).includes(row.case.stage)) {
        actions.push({
          id: `signed-form:${row.case.id}:${row.case.stage}`,
          kind: "signed_form",
          title: "Sign required forms",
          message: `${row.case.stage.replace(" pending", "")} is awaiting your signature.`,
          urgency: "amber",
          href: `/cases/${row.case.id}?tab=documents`,
          source: "derived",
        });
      }

      const financialDisclosureFolders = await financialDisclosureService.getVisibleFoldersForCase(row.case.id, user);
      const financialDisclosureAction = findFinancialDisclosureAction(row.case.id, user, financialDisclosureFolders);
      if (financialDisclosureAction) actions.push(financialDisclosureAction);

      for (const request of documentRequestsByCaseId.get(row.case.id) ?? []) {
        if (request.partyId !== row.party.id) continue;
        actions.push({
          id: `document-request:${request.id}`,
          kind: "document",
          title: `Upload requested document: ${request.documentName}`,
          message: request.returnReason
            ? `Please upload another copy. ${request.returnReason}`
            : request.instructions || `Please upload ${request.documentName}.`,
          urgency: "amber",
          href: `/cases/${encodeURIComponent(row.case.id)}?tab=documents&documentRequestId=${encodeURIComponent(request.id)}`,
          source: "derived",
        });
      }

      for (const task of explicitTasksByCaseId.get(row.case.id) ?? []) {
        const kind = taskKindFromTitle(task);
        actions.push({
          id: task.id,
          kind,
          title: task.title,
          message: task.message,
          urgency: task.urgency,
          href: clientTaskHref(row.case.id, kind, task),
          source: "task",
        });
      }

      casesPayload.push({
        caseId: row.case.id,
        caseRef: row.case.caseRef,
        stage: row.case.stage,
        status: row.case.status,
        issueType: row.case.issueType ?? null,
        mediatorName: row.mediatorName,
        nextConfirmedAppointment: nextConfirmed ? clientAppointmentFromRow(nextConfirmed) : null,
        pendingAppointment: pending ? clientAppointmentFromRow(pending) : null,
        tasks: actions,
        notifications: (notificationsByCaseId.get(row.case.id) ?? []).slice(0, 5).map((notice) => ({
          id: notice.id,
          type: notice.type,
          title: notice.title,
          message: notice.message,
          urgency: notice.urgency,
          appointmentId: notice.appointmentId,
          createdAt: notice.createdAt,
        })),
      });
    }

    return { cases: casesPayload };
  }
}

export const dashboardService = new DashboardService();
