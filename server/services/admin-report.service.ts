import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { appointments, caseClosureRecords, caseInvoices, cases, clients, mediationSessions, parties, serviceTypes, users } from "@shared/schema";

type ReportCaseRow = {
  id: string;
  stage: string | null;
  status: string | null;
  createdAt: Date | string | null;
  manualRevenuePence: number | null;
};

type ReportSessionRow = {
  id: string;
  status: string | null;
  outcome: string | null;
  postSessionReviewStatus: string | null;
  createdAt: Date | string | null;
};

type ReportAppointmentRow = {
  id: string;
  dateTime: Date | string;
  status: string | null;
  type: string | null;
  mediator: string | null;
  clientNames: string | null;
};

type ReportClosureRow = {
  id: string;
  closureReason: string | null;
  closedAt: Date | string | null;
};

type ReportRevenueInvoiceRow = {
  id: string;
  updatedAt: Date | string | null;
  status: string | null;
  paymentStatus: string | null;
  amountPaidPence: number | null;
  outstandingPence: number | null;
};

export type AdminReportSourceRows = {
  cases: ReportCaseRow[];
  sessions: ReportSessionRow[];
  appointments: ReportAppointmentRow[];
  closures: ReportClosureRow[];
  revenueInvoices: ReportRevenueInvoiceRow[];
};

export type AdminReportDateRange = {
  from: Date;
  to: Date;
};

type CountRow<K extends string> = Record<K, string> & { count: number };

export type AdminReportSummary = {
  range: { from: string; to: string };
  totalCases: number;
  totalSessions: number;
  upcomingSessionsCount: number;
  casesByStage: Array<{ stage: string; count: number }>;
  closureReasons: Array<{ reason: string; count: number }>;
  sessionStatuses: Array<{ status: string; count: number }>;
  sessionOutcomes: Array<{ outcome: string; count: number }>;
  postSessionReviews: Array<{ status: string; count: number }>;
  upcomingSessions: Array<{ id: string; dateTime: string; type: string; mediator: string; clientNames: string; status: string }>;
  revenue?: {
    totalRevenuePence: number;
    monthlyRevenue: Array<{ month: string; revenuePence: number }>;
  };
};

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function monthKey(value: Date | string | null): string | null {
  const date = asDate(value);
  return date ? date.toISOString().slice(0, 7) : null;
}

function sortedCounts<K extends string>(rows: CountRow<K>[], key: K): CountRow<K>[] {
  return rows
    .slice()
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
}

function countBy<T, K extends string>(items: T[], key: K, label: (item: T) => string | null | undefined): CountRow<K>[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = label(item)?.trim() || "Unspecified";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return sortedCounts(Array.from(counts, ([value, count]) => ({ [key]: value, count }) as CountRow<K>), key);
}

export function parseAdminReportDateRange(query: Record<string, unknown>, now = new Date()): AdminReportDateRange {
  const explicitFrom = parseDate(query.from);
  const explicitTo = parseDate(query.to);
  const defaultFrom = new Date(now);
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);

  return {
    from: startOfDay(explicitFrom ?? defaultFrom),
    to: endOfDay(explicitTo ?? now),
  };
}

export function buildAdminReportSummary(
  rows: AdminReportSourceRows,
  options: AdminReportDateRange & { includeRevenue: boolean },
): AdminReportSummary {
  const activeUpcomingAppointments = rows.appointments
    .filter((appointment) => ["hold", "held", "confirmed"].includes(appointment.status || ""))
    .slice()
    .sort((a, b) => asDate(a.dateTime)!.getTime() - asDate(b.dateTime)!.getTime());
  const upcomingSessions = activeUpcomingAppointments
    .slice(0, 8)
    .map((appointment) => ({
      id: appointment.id,
      dateTime: asDate(appointment.dateTime)!.toISOString(),
      type: appointment.type || "Appointment",
      mediator: appointment.mediator || "Unassigned",
      clientNames: appointment.clientNames || "Unknown client",
      status: appointment.status || "unknown",
    }));

  const summary: AdminReportSummary = {
    range: {
      from: options.from.toISOString(),
      to: options.to.toISOString(),
    },
    totalCases: rows.cases.length,
    totalSessions: rows.sessions.length,
    upcomingSessionsCount: activeUpcomingAppointments.length,
    casesByStage: countBy(rows.cases, "stage", (row) => row.stage).map(({ stage, count }) => ({ stage, count })),
    closureReasons: countBy(rows.closures, "reason", (row) => row.closureReason).map(({ reason, count }) => ({ reason, count })),
    sessionStatuses: countBy(rows.sessions, "status", (row) => row.status).map(({ status, count }) => ({ status, count })),
    sessionOutcomes: countBy(rows.sessions, "outcome", (row) => row.outcome).map(({ outcome, count }) => ({ outcome, count })),
    postSessionReviews: countBy(rows.sessions, "status", (row) => row.postSessionReviewStatus).map(({ status, count }) => ({ status, count })),
    upcomingSessions,
  };

  if (options.includeRevenue) {
    const monthly = new Map<string, number>();
    let totalRevenuePence = 0;
    for (const row of rows.revenueInvoices) {
      if (row.status === "void") continue;
      if (["cancelled", "expired", "refunded"].includes(row.paymentStatus || "")) continue;
      if (row.paymentStatus !== "paid" && (row.outstandingPence ?? 0) > 0) continue;
      const amount = row.amountPaidPence ?? 0;
      if (amount <= 0) continue;
      totalRevenuePence += amount;
      const month = monthKey(row.updatedAt);
      if (!month) continue;
      monthly.set(month, (monthly.get(month) ?? 0) + amount);
    }
    summary.revenue = {
      totalRevenuePence,
      monthlyRevenue: Array.from(monthly, ([month, revenuePence]) => ({ month, revenuePence }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  return summary;
}

export class AdminReportService {
  async getAdminSummary(user: { role: string }, query: Record<string, unknown>): Promise<AdminReportSummary> {
    const { db } = await import("../db");
    const range = parseAdminReportDateRange(query);
    const includeRevenue = user.role === "superadmin";
    const caseRows = await db
      .select({
        id: cases.id,
        stage: cases.stage,
        status: cases.status,
        createdAt: cases.createdAt,
        manualRevenuePence: sql<number | null>`NULL`,
      })
      .from(cases)
      .where(and(gte(cases.createdAt, range.from), lte(cases.createdAt, range.to)));

    const sessionRows = await db
      .select({
        id: mediationSessions.id,
        status: mediationSessions.status,
        outcome: mediationSessions.outcome,
        postSessionReviewStatus: mediationSessions.postSessionReviewStatus,
        createdAt: mediationSessions.createdAt,
      })
      .from(mediationSessions)
      .where(and(gte(mediationSessions.createdAt, range.from), lte(mediationSessions.createdAt, range.to)));

    const appointmentRows = await db
      .select({
        id: appointments.id,
        dateTime: appointments.dateTime,
        status: appointments.status,
        type: serviceTypes.name,
        mediator: users.name,
        clientNames: sql<string | null>`concat_ws(' ', ${clients.firstName}, ${clients.lastName})`,
      })
      .from(appointments)
      .leftJoin(serviceTypes, eq(appointments.serviceTypeId, serviceTypes.id))
      .leftJoin(users, eq(appointments.mediatorId, users.id))
      .leftJoin(parties, eq(appointments.partyId, parties.id))
      .leftJoin(clients, eq(parties.clientId, clients.id))
      .where(and(
        gte(appointments.dateTime, new Date()),
        inArray(appointments.status, ["hold", "held", "confirmed"]),
      ))
      .orderBy(asc(appointments.dateTime))
      .limit(25);

    const closureRows = await db
      .select({
        id: caseClosureRecords.id,
        closureReason: caseClosureRecords.closureReason,
        closedAt: caseClosureRecords.closedAt,
      })
      .from(caseClosureRecords)
      .where(and(gte(caseClosureRecords.closedAt, range.from), lte(caseClosureRecords.closedAt, range.to)));

    const revenueInvoices = includeRevenue
      ? await db
        .select({
          id: caseInvoices.id,
          updatedAt: caseInvoices.updatedAt,
          status: caseInvoices.status,
          paymentStatus: caseInvoices.paymentStatus,
          amountPaidPence: caseInvoices.amountPaidPence,
          outstandingPence: caseInvoices.outstandingPence,
        })
        .from(caseInvoices)
        .where(and(
          gte(caseInvoices.updatedAt, range.from),
          lte(caseInvoices.updatedAt, range.to),
          sql`${caseInvoices.status} <> 'void'`,
          sql`${caseInvoices.paymentStatus} NOT IN ('cancelled', 'expired', 'refunded')`,
          sql`(${caseInvoices.paymentStatus} = 'paid' OR ${caseInvoices.outstandingPence} <= 0)`,
        ))
      : [];

    return buildAdminReportSummary({
      cases: caseRows,
      sessions: sessionRows,
      appointments: appointmentRows,
      closures: closureRows,
      revenueInvoices,
    }, {
      ...range,
      includeRevenue,
    });
  }
}

export const adminReportService = new AdminReportService();
