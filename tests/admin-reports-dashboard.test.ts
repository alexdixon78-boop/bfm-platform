import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAdminReportSummary,
  parseAdminReportDateRange,
  type AdminReportSourceRows,
} from "../server/services/admin-report.service";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("reports page is routed and guarded with reports view permission", () => {
  const layout = read("../client/src/components/layout/dashboard-layout.tsx");
  const page = read("../client/src/pages/reports.tsx");
  const routes = read("../server/routes/report.routes.ts");
  const index = read("../server/routes/index.ts");

  assert.match(layout, /import ReportsPage from "@\/pages\/reports"/);
  assert.match(layout, /path="\/reports"/);
  assert.match(layout, /section="reports"/);
  assert.match(layout, /component=\{ReportsPage\}/);
  assert.match(page, /export default function ReportsPage/);
  assert.match(page, /\/api\/reports\/admin-summary/);
  assert.match(routes, /\/api\/reports\/admin-summary/);
  assert.match(routes, /requirePermission\("reports", "view"\)/);
  assert.doesNotMatch(routes, /Admin reports are only available to admins/);
  assert.match(index, /reportRoutes/);
});

test("admin report summary aggregates core metrics and omits revenue for subadmin", () => {
  const rows: AdminReportSourceRows = {
    cases: [
      { id: "case-1", stage: "Enquiry", status: "Active", createdAt: new Date("2026-01-05"), manualRevenuePence: 120000 },
      { id: "case-2", stage: "Mediation", status: "Active", createdAt: new Date("2026-02-05"), manualRevenuePence: 40000 },
      { id: "case-3", stage: "Mediation", status: "Closed", createdAt: new Date("2026-03-05"), manualRevenuePence: null },
    ],
    sessions: [
      { id: "session-1", status: "completed", outcome: "full_agreement", postSessionReviewStatus: "approved", createdAt: new Date("2026-02-10") },
      { id: "session-2", status: "scheduled", outcome: null, postSessionReviewStatus: "submitted", createdAt: new Date("2026-03-10") },
    ],
    appointments: [
      { id: "appt-1", dateTime: new Date("2026-04-10T09:00:00.000Z"), status: "confirmed", type: "Mediation Sessions", mediator: "Rebecca", clientNames: "Client A & Client B" },
      { id: "appt-2", dateTime: new Date("2026-04-11T09:00:00.000Z"), status: "cancelled", type: "Mediation Sessions", mediator: "Rebecca", clientNames: "Client C" },
    ],
    closures: [
      { id: "closure-1", closureReason: "Agreement reached", closedAt: new Date("2026-02-20") },
      { id: "closure-2", closureReason: "Agreement reached", closedAt: new Date("2026-03-20") },
      { id: "closure-3", closureReason: "COST", closedAt: new Date("2026-03-21") },
    ],
    revenueInvoices: [
      { id: "invoice-1", updatedAt: new Date("2026-02-20"), status: "issued", paymentStatus: "paid", amountPaidPence: 140000, outstandingPence: 0 },
    ],
  };

  const summary = buildAdminReportSummary(rows, {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T23:59:59.999Z"),
    includeRevenue: false,
  });

  assert.equal(summary.totalCases, 3);
  assert.equal(summary.totalSessions, 2);
  assert.equal(summary.upcomingSessionsCount, 1);
  assert.deepEqual(summary.casesByStage, [
    { stage: "Mediation", count: 2 },
    { stage: "Enquiry", count: 1 },
  ]);
  assert.deepEqual(summary.closureReasons, [
    { reason: "Agreement reached", count: 2 },
    { reason: "COST", count: 1 },
  ]);
  assert.equal("revenue" in summary, false);
});

test("admin report summary includes paid invoice revenue only for superadmin", () => {
  const summary = buildAdminReportSummary({
    cases: [
      { id: "case-1", stage: "Enquiry", status: "Active", createdAt: new Date("2026-01-05"), manualRevenuePence: 999999 },
    ],
    sessions: [],
    appointments: [],
    closures: [],
    revenueInvoices: [
      { id: "invoice-1", updatedAt: new Date("2026-01-15"), status: "issued", paymentStatus: "paid", amountPaidPence: 120000, outstandingPence: 0 },
      { id: "invoice-2", updatedAt: new Date("2026-01-20"), status: "issued", paymentStatus: "unpaid", amountPaidPence: 0, outstandingPence: 40000 },
      { id: "invoice-3", updatedAt: new Date("2026-02-15"), status: "issued", paymentStatus: "unpaid", amountPaidPence: 40000, outstandingPence: 0 },
    ],
  }, {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T23:59:59.999Z"),
    includeRevenue: true,
  });

  assert.deepEqual(summary.revenue, {
    totalRevenuePence: 160000,
    monthlyRevenue: [
      { month: "2026-01", revenuePence: 120000 },
      { month: "2026-02", revenuePence: 40000 },
    ],
  });
});

test("admin report summary excludes non-revenue invoice states", () => {
  const summary = buildAdminReportSummary({
    cases: [],
    sessions: [],
    appointments: [],
    closures: [],
    revenueInvoices: [
      { id: "paid", updatedAt: new Date("2026-01-15"), status: "issued", paymentStatus: "paid", amountPaidPence: 10000, outstandingPence: 0 },
      { id: "unpaid", updatedAt: new Date("2026-01-16"), status: "issued", paymentStatus: "unpaid", amountPaidPence: 0, outstandingPence: 10000 },
      { id: "void", updatedAt: new Date("2026-01-17"), status: "void", paymentStatus: "paid", amountPaidPence: 20000, outstandingPence: 0 },
      { id: "cancelled", updatedAt: new Date("2026-01-18"), status: "issued", paymentStatus: "cancelled", amountPaidPence: 30000, outstandingPence: 0 },
      { id: "expired", updatedAt: new Date("2026-01-19"), status: "issued", paymentStatus: "expired", amountPaidPence: 40000, outstandingPence: 0 },
      { id: "refunded", updatedAt: new Date("2026-01-20"), status: "issued", paymentStatus: "refunded", amountPaidPence: 50000, outstandingPence: 0 },
    ],
  }, {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T23:59:59.999Z"),
    includeRevenue: true,
  });

  assert.deepEqual(summary.revenue, {
    totalRevenuePence: 10000,
    monthlyRevenue: [{ month: "2026-01", revenuePence: 10000 }],
  });
});

test("admin report summary counts all upcoming sessions but previews the first eight", () => {
  const appointments = Array.from({ length: 10 }, (_, index) => ({
    id: `appt-${index + 1}`,
    dateTime: new Date(`2026-04-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`),
    status: "confirmed",
    type: "Mediation Sessions",
    mediator: "Rebecca",
    clientNames: `Client ${index + 1}`,
  }));

  const summary = buildAdminReportSummary({
    cases: [],
    sessions: [],
    appointments,
    closures: [],
    revenueInvoices: [],
  }, {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T23:59:59.999Z"),
    includeRevenue: false,
  });

  assert.equal(summary.upcomingSessionsCount, 10);
  assert.equal(summary.upcomingSessions.length, 8);
});

test("admin report date range defaults to last twelve months and accepts explicit dates", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  const defaultRange = parseAdminReportDateRange({}, now);
  assert.equal(defaultRange.from.toISOString(), "2025-09-14T00:00:00.000Z");
  assert.equal(defaultRange.to.toISOString(), "2026-09-14T23:59:59.999Z");

  const explicitRange = parseAdminReportDateRange({ from: "2026-01-02", to: "2026-03-04" }, now);
  assert.equal(explicitRange.from.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.equal(explicitRange.to.toISOString(), "2026-03-04T23:59:59.999Z");
});

test("manual revenue schema, route, and case UI are superadmin-only", () => {
  const schema = read("../shared/schema.ts");
  const migration = read("../migrations/0034_manual_case_revenue.sql");
  const bootstrap = read("../server/db-bootstrap.ts");
  const routes = read("../server/routes/case.routes.ts");
  const casePage = read("../client/src/pages/case-detail.tsx");
  const reportsPage = read("../client/src/pages/reports.tsx");

  assert.match(schema, /manualRevenuePence: integer\("manual_revenue_pence"\)/);
  assert.match(schema, /manualRevenueUpdatedBy: varchar\("manual_revenue_updated_by"\)/);
  assert.match(schema, /manualRevenueUpdatedAt: timestamp\("manual_revenue_updated_at"\)/);
  assert.match(migration, /ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "manual_revenue_pence" integer/);
  assert.match(bootstrap, /manual_revenue_pence/);
  assert.match(routes, /\/api\/cases\/:id\/manual-revenue/);
  assert.match(routes, /user\.role !== "superadmin"/);
  assert.match(routes, /manualRevenuePence/);
  assert.match(routes, /action: "case_manual_revenue_updated"/);
  assert.match(casePage, /data-testid="card-manual-case-revenue"/);
  assert.match(casePage, /isSuperadmin/);
  assert.match(casePage, /\/api\/cases\/\$\{caseId\}\/manual-revenue/);
  assert.match(reportsPage, /Paid invoice revenue/);
  assert.doesNotMatch(reportsPage, /MetricCard title="Manual revenue"/);
});
