import { desc, eq, sql } from "drizzle-orm";
import { caseClosurePartyFollowUps, caseClosureRecords, cases } from "@shared/schema";

export type CaseClosureExportSourceRow = {
  caseId?: string | null;
  caseRef?: string | null;
  clientFirstName?: string | null;
  clientLastName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  closureDetails?: string | null;
  closedAt: Date | string | null;
  closureReason: string | null;
  followUpConsentStatus: string | null;
  outreachExcluded: boolean | null;
  lifeSatisfaction: number | null;
  anxietyScore: number | null;
  serviceRating: number | null;
  netPromoterScore: number | null;
  followUpEligibleClients: number | null;
  followUpExcludedClients: number | null;
  followUpScheduledTasks: number | null;
  mediationCategory: string | null;
  familySubType: string | null;
  workplaceSubType: string | null;
  civilSubType: string | null;
  commercialSubType: string | null;
  otherSubType: string | null;
  fundingSource: string | null;
  voucherStatus: string | null;
  inCourtStatus: string | null;
  cafcassStatus: string | null;
};

export type CaseClosureExportRow = {
  closureMonth: string | null;
  closureReason: string | null;
  followUpConsentStatus: string | null;
  outreachExcluded: boolean;
  lifeSatisfaction: number | null;
  anxietyScore: number | null;
  serviceRating: number | null;
  netPromoterScore: number | null;
  followUpEligibleClients: number;
  followUpExcludedClients: number;
  followUpScheduledTasks: number;
  mediationCategory: string | null;
  caseSubtype: string | null;
  fundingSource: string | null;
  voucherStatus: string | null;
  inCourtStatus: string | null;
  cafcassStatus: string | null;
};

const EXPORT_HEADERS: Array<keyof CaseClosureExportRow> = [
  "closureMonth",
  "closureReason",
  "followUpConsentStatus",
  "outreachExcluded",
  "lifeSatisfaction",
  "anxietyScore",
  "serviceRating",
  "netPromoterScore",
  "followUpEligibleClients",
  "followUpExcludedClients",
  "followUpScheduledTasks",
  "mediationCategory",
  "caseSubtype",
  "fundingSource",
  "voucherStatus",
  "inCourtStatus",
  "cafcassStatus",
];

function formatClosureMonth(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString().slice(0, 7);
}

function selectSubtype(row: CaseClosureExportSourceRow): string | null {
  return row.familySubType
    ?? row.workplaceSubType
    ?? row.civilSubType
    ?? row.commercialSubType
    ?? row.otherSubType
    ?? null;
}

export function buildCaseClosureExportRow(row: CaseClosureExportSourceRow): CaseClosureExportRow {
  return {
    closureMonth: formatClosureMonth(row.closedAt),
    closureReason: row.closureReason,
    followUpConsentStatus: row.followUpConsentStatus,
    outreachExcluded: row.outreachExcluded === true,
    lifeSatisfaction: row.lifeSatisfaction,
    anxietyScore: row.anxietyScore,
    serviceRating: row.serviceRating,
    netPromoterScore: row.netPromoterScore,
    followUpEligibleClients: row.followUpEligibleClients ?? 0,
    followUpExcludedClients: row.followUpExcludedClients ?? 0,
    followUpScheduledTasks: row.followUpScheduledTasks ?? 0,
    mediationCategory: row.mediationCategory,
    caseSubtype: selectSubtype(row),
    fundingSource: row.fundingSource,
    voucherStatus: row.voucherStatus,
    inCourtStatus: row.inCourtStatus,
    cafcassStatus: row.cafcassStatus,
  };
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCaseClosureCsv(rows: CaseClosureExportRow[]): string {
  const lines = [
    EXPORT_HEADERS.join(","),
    ...rows.map(row => EXPORT_HEADERS.map(header => csvCell(row[header])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

export async function listCaseClosureExportRows(): Promise<CaseClosureExportRow[]> {
  const { db } = await import("../db");
  const rows = await db
    .select({
      closedAt: caseClosureRecords.closedAt,
      closureReason: caseClosureRecords.closureReason,
      followUpConsentStatus: caseClosureRecords.followUpConsentStatus,
      outreachExcluded: caseClosureRecords.outreachExcluded,
      lifeSatisfaction: caseClosureRecords.lifeSatisfaction,
      anxietyScore: caseClosureRecords.anxietyScore,
      serviceRating: caseClosureRecords.serviceRating,
      netPromoterScore: caseClosureRecords.netPromoterScore,
      followUpEligibleClients: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${caseClosurePartyFollowUps} party_follow_ups
        WHERE party_follow_ups.closure_record_id = ${caseClosureRecords.id}
          AND party_follow_ups.consent_status = 'granted'
      )`,
      followUpExcludedClients: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${caseClosurePartyFollowUps} party_follow_ups
        WHERE party_follow_ups.closure_record_id = ${caseClosureRecords.id}
          AND party_follow_ups.consent_status IN ('declined', 'excluded', 'pending')
      )`,
      followUpScheduledTasks: sql<number>`(
        SELECT COALESCE(SUM(party_follow_ups.follow_up_tasks_scheduled), 0)::int
        FROM ${caseClosurePartyFollowUps} party_follow_ups
        WHERE party_follow_ups.closure_record_id = ${caseClosureRecords.id}
      )`,
      mediationCategory: cases.mediationCategory,
      familySubType: cases.familySubType,
      workplaceSubType: cases.workplaceSubType,
      civilSubType: cases.civilSubType,
      commercialSubType: cases.commercialSubType,
      otherSubType: cases.otherSubType,
      fundingSource: cases.fundingSource,
      voucherStatus: cases.voucherStatus,
      inCourtStatus: cases.inCourtStatus,
      cafcassStatus: cases.cafcassStatus,
    })
    .from(caseClosureRecords)
    .innerJoin(cases, eq(caseClosureRecords.caseId, cases.id))
    .orderBy(desc(caseClosureRecords.closedAt));

  return rows.map(buildCaseClosureExportRow);
}
