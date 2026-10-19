import {
  type Case,
  type InsertCase,
  type CaseClosureRecord,
  type InsertCaseClosureRecord,
  type CaseClosurePartyFollowUp,
  type CaseFilters,
  cases,
  caseClosureRecords,
  caseClosurePartyFollowUps,
  clients,
  parties,
  appointments,
  caseConfidentialNotes,
  caseActivities,
  demographicData,
  miamRecords,
  miamEditRequests,
  notifications,
  enquiries,
  caseRepresentatives,
  isMojVoucherEligibleCase,
  mediationSessionParticipants,
  mediationSessions,
} from "@shared/schema";
import { db } from "../db";
import { and, eq, desc, inArray, sql, type SQL } from "drizzle-orm";

export type CaseClosurePartyFollowUpInput = {
  partyId: string;
  clientId: string;
  consentStatus: "granted" | "declined" | "excluded" | "pending";
  consentSource?:
    | "enquiry_carry_forward"
    | "closure_admin"
    | "legacy_case"
    | "system_exclusion"
    | "email_request"
    | "public_link";
  exclusionReason?: string | null;
  followUpTasksScheduled?: number;
};

export type CaseFollowUpConsentContext = CaseClosurePartyFollowUp & {
  caseRef: string;
  caseStatus: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string | null;
  partyRole: string;
};

export type CaseScope =
  | { kind: "all" }
  | { kind: "mediator"; userId: string }
  | { kind: "client"; userId: string };

export interface ListCasesOptions {
  filters: CaseFilters;
  scope: CaseScope;
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** When true, exclude rows with status='Archived' unless statuses filter explicitly contains it. */
  excludeArchivedByDefault?: boolean;
}

export interface ListCasesResult {
  rows: Case[];
  total: number;
  /** Status counts under the same scope+filters but with the `statuses` filter removed. */
  statusCounts: Record<string, number>;
}

export interface HardDeleteCaseCounts {
  partyLinks: number;
  clientsAffected: number;
  appointments: number;
  confidentialNotes: number;
  caseActivities: number;
  demographicData: number;
  miamRecords: number;
  miamEditRequests: number;
  notifications: number;
  mediationSessions: number;
  mediationSessionParticipants: number;
  caseClosureRecords: number;
  enquiriesUnlinked: number;
}

export class CaseRepository {
  async getNextCaseRef(): Promise<string> {
    const year = new Date().getFullYear().toString();
    const prefix = `BFM-${year}-`;

    const result = await db
      .select({ caseRef: cases.caseRef })
      .from(cases)
      .where(sql`${cases.caseRef} LIKE ${prefix + "%"}`)
      .orderBy(sql`${cases.caseRef} DESC`)
      .limit(1);

    let nextNum = 1;
    if (result.length > 0) {
      const lastRef = result[0].caseRef;
      const lastNum = parseInt(lastRef.split("-").pop() || "0", 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }

    return `BFM-${year}-${nextNum.toString().padStart(4, "0")}`;
  }

  async listCases(): Promise<Case[]> {
    return db.select().from(cases).orderBy(desc(cases.lastUpdated));
  }

  /**
   * SQL-level cases listing with permission scope and 14 user filters AND-composed
   * in a single query. Critical: scope is always part of the same WHERE so a
   * mediator/client cannot probe for the existence of out-of-scope cases via
   * filter values.
   */
  async listCasesFiltered(opts: ListCasesOptions): Promise<ListCasesResult> {
    const {
      filters,
      scope,
      page,
      limit,
      sortBy,
      sortOrder,
      excludeArchivedByDefault,
    } = opts;

    // ---------------- Scope predicate ----------------
    let scopePredicate: SQL;
    if (scope.kind === "all") {
      scopePredicate = sql`TRUE`;
    } else if (scope.kind === "mediator") {
      scopePredicate = sql`(
        cases.mediator_id = ${scope.userId}
        OR EXISTS (
          SELECT 1 FROM parties p
          WHERE p.case_id = cases.id
            AND (p.allocated_mediator_id = ${scope.userId} OR p.miam_mediator_id = ${scope.userId})
        )
        OR EXISTS (
          SELECT 1 FROM mediation_sessions ms
          WHERE ms.case_id = cases.id
            AND ms.lead_mediator_id = ${scope.userId}
        )
        OR EXISTS (
          SELECT 1 FROM mediation_sessions ms
          JOIN mediation_session_participants msp ON msp.session_id = ms.id
          WHERE ms.case_id = cases.id
            AND msp.user_id = ${scope.userId}
            AND msp.role IN ('lead_mediator', 'co_mediator', 'observer')
            AND msp.invitation_status = 'accepted'
        )
      )`;
    } else {
      // client
      scopePredicate = sql`EXISTS (
        SELECT 1 FROM parties p
        JOIN clients cl ON cl.id = p.client_id
        WHERE p.case_id = cases.id AND cl.user_id = ${scope.userId}
      )`;
    }

    // ---------------- Filter predicates ----------------
    const inFilter = (col: SQL, values: string[] | undefined): SQL | null => {
      if (!values || values.length === 0) return null;
      return sql`${col} IN (${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )})`;
    };

    const dateFromTo = (
      col: SQL,
      from: string | undefined,
      to: string | undefined,
    ): SQL | null => {
      const parts: SQL[] = [];
      if (from) parts.push(sql`${col} >= ${from}::date`);
      if (to) parts.push(sql`${col} < (${to}::date + INTERVAL '1 day')`);
      if (parts.length === 0) return null;
      return parts.length === 1
        ? parts[0]
        : sql`(${sql.join(parts, sql` AND `)})`;
    };

    const userPredicates: SQL[] = [];

    // Status (with default-archive-exclusion semantics)
    if (filters.statuses && filters.statuses.length > 0) {
      userPredicates.push(inFilter(sql`cases.status`, filters.statuses)!);
    } else if (excludeArchivedByDefault) {
      userPredicates.push(sql`cases.status <> 'Archived'`);
    }

    const stagePred = inFilter(sql`cases.stage`, filters.stages);
    if (stagePred) userPredicates.push(stagePred);

    const catPred = inFilter(
      sql`cases.mediation_category`,
      filters.mediationCategories as string[] | undefined,
    );
    if (catPred) userPredicates.push(catPred);

    const subTypeOred: SQL[] = [];
    const fam = inFilter(sql`cases.family_sub_type`, filters.familySubTypes);
    if (fam) subTypeOred.push(fam);
    const wp = inFilter(
      sql`cases.workplace_sub_type`,
      filters.workplaceSubTypes,
    );
    if (wp) subTypeOred.push(wp);
    const civ = inFilter(sql`cases.civil_sub_type`, filters.civilSubTypes);
    if (civ) subTypeOred.push(civ);
    const com = inFilter(
      sql`cases.commercial_sub_type`,
      filters.commercialSubTypes,
    );
    if (com) subTypeOred.push(com);
    const oth = inFilter(sql`cases.other_sub_type`, filters.otherSubTypes);
    if (oth) subTypeOred.push(oth);
    if (subTypeOred.length > 0) {
      userPredicates.push(sql`(${sql.join(subTypeOred, sql` OR `)})`);
    }

    const fundPred = inFilter(
      sql`cases.funding_source`,
      filters.fundingSources,
    );
    if (fundPred) userPredicates.push(fundPred);
    const vouPred = inFilter(
      sql`cases.voucher_status`,
      filters.voucherStatuses,
    );
    if (vouPred) userPredicates.push(vouPred);
    const courtPred = inFilter(
      sql`cases.in_court_status`,
      filters.inCourtStatuses,
    );
    if (courtPred) userPredicates.push(courtPred);
    const cafPred = inFilter(
      sql`cases.cafcass_status`,
      filters.cafcassStatuses,
    );
    if (cafPred) userPredicates.push(cafPred);
    if (typeof filters.cimEligible === "boolean") {
      userPredicates.push(sql`cases.cim_eligible = ${filters.cimEligible}`);
    }

    if (filters.assignedMediatorIds && filters.assignedMediatorIds.length > 0) {
      const ids = filters.assignedMediatorIds;
      const idsSql = sql.join(
        ids.map((v) => sql`${v}`),
        sql`, `,
      );
      userPredicates.push(sql`(
        cases.mediator_id IN (${idsSql})
        OR EXISTS (
          SELECT 1 FROM parties p WHERE p.case_id = cases.id AND p.allocated_mediator_id IN (${idsSql})
        )
      )`);
    }

    if (filters.miamMediatorIds && filters.miamMediatorIds.length > 0) {
      const ids = filters.miamMediatorIds;
      const idsSql = sql.join(
        ids.map((v) => sql`${v}`),
        sql`, `,
      );
      userPredicates.push(sql`EXISTS (
        SELECT 1 FROM parties p WHERE p.case_id = cases.id AND p.miam_mediator_id IN (${idsSql})
      )`);
    }

    const enqDate = dateFromTo(
      sql`cases.enquiry_date`,
      filters.enquiryDateFrom,
      filters.enquiryDateTo,
    );
    if (enqDate) userPredicates.push(enqDate);
    const miamDate = dateFromTo(
      sql`cases.miam_completed_date`,
      filters.miamCompletedDateFrom,
      filters.miamCompletedDateTo,
    );
    if (miamDate) userPredicates.push(miamDate);
    const closeDate = dateFromTo(
      sql`cases.closure_date`,
      filters.closureDateFrom,
      filters.closureDateTo,
    );
    if (closeDate) userPredicates.push(closeDate);

    // Search across case_ref, party names, mediator name
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      userPredicates.push(sql`(
        cases.case_ref ILIKE ${q}
        OR cases.issue_type ILIKE ${q}
        OR EXISTS (
          SELECT 1 FROM parties p
          JOIN clients cl ON cl.id = p.client_id
          WHERE p.case_id = cases.id
            AND (
              cl.first_name ILIKE ${q}
              OR cl.last_name ILIKE ${q}
              OR (cl.first_name || ' ' || cl.last_name) ILIKE ${q}
              OR cl.email ILIKE ${q}
              OR cl.date_of_birth ILIKE ${q}
            )
        )
        OR EXISTS (
          SELECT 1 FROM mediation_session_voucher_claims vc
          WHERE vc.case_id = cases.id
            AND vc.opia_claim_reference ILIKE ${q}
        )
        OR EXISTS (
          SELECT 1 FROM users u WHERE u.id = cases.mediator_id AND u.name ILIKE ${q}
        )
      )`);
    }

    const wherePredicates = [scopePredicate, ...userPredicates];
    const whereSql = sql.join(wherePredicates, sql` AND `);

    // ---------------- Sort ----------------
    const order = sortOrder === "asc" ? sql`ASC` : sql`DESC`;
    let orderSql: SQL;
    switch (sortBy) {
      case "caseRef":
        orderSql = sql`cases.case_ref ${order}`;
        break;
      case "stage":
        orderSql = sql`cases.stage ${order} NULLS LAST`;
        break;
      case "status":
        orderSql = sql`cases.status ${order}`;
        break;
      case "issueType":
        orderSql = sql`cases.issue_type ${order} NULLS LAST`;
        break;
      case "mediatorName":
        orderSql = sql`(SELECT u.name FROM users u WHERE u.id = cases.mediator_id) ${order} NULLS LAST`;
        break;
      case "partyA":
        orderSql = sql`(SELECT cl.first_name || ' ' || cl.last_name FROM parties p JOIN clients cl ON cl.id = p.client_id WHERE p.case_id = cases.id AND upper(p.role) = 'A' LIMIT 1) ${order} NULLS LAST`;
        break;
      case "partyB":
        orderSql = sql`(SELECT cl.first_name || ' ' || cl.last_name FROM parties p JOIN clients cl ON cl.id = p.client_id WHERE p.case_id = cases.id AND upper(p.role) = 'B' LIMIT 1) ${order} NULLS LAST`;
        break;
      default:
        orderSql = sql`cases.last_updated DESC`;
    }

    // ---------------- Pagination + total ----------------
    const offset = (page - 1) * limit;

    const rowsResult = await db.execute(sql`
      SELECT cases.* FROM cases
      WHERE ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${limit} OFFSET ${offset}
    `);
    const rows = rowsResult.rows.map((r: Record<string, unknown>) =>
      this.mapRowToCase(r),
    );

    const totalResult = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM cases WHERE ${whereSql}
    `);
    const total = Number((totalResult.rows[0] as { n: number }).n) || 0;

    // ---------------- Status counts (without `statuses` user filter) ----------------
    const filtersNoStatus = { ...filters, statuses: undefined };
    const countsResult = await this.computeStatusCounts(
      scope,
      filtersNoStatus,
      excludeArchivedByDefault,
    );

    return { rows, total, statusCounts: countsResult };
  }

  private async computeStatusCounts(
    scope: CaseScope,
    filters: CaseFilters,
    excludeArchivedByDefault?: boolean,
  ): Promise<Record<string, number>> {
    // Re-run a light query that mirrors listCasesFiltered's where-building.
    // Build inline rather than recursing to avoid double pagination/sort work.
    const opts: ListCasesOptions = {
      filters,
      scope,
      page: 1,
      limit: 1,
      excludeArchivedByDefault,
    };
    const where = this.buildWhereForCounts(opts);
    const r = await db.execute(sql`
      SELECT cases.status AS status, COUNT(*)::int AS n
      FROM cases WHERE ${where}
      GROUP BY cases.status
    `);
    const out: Record<string, number> = {};
    for (const row of r.rows as Array<{ status: string; n: number }>) {
      out[row.status] = Number(row.n);
    }
    return out;
  }

  private buildWhereForCounts(opts: ListCasesOptions): SQL {
    // Duplicate of listCasesFiltered's where-building, isolated for the counts query.
    const { filters, scope, excludeArchivedByDefault } = opts;
    let scopePredicate: SQL;
    if (scope.kind === "all") {
      scopePredicate = sql`TRUE`;
    } else if (scope.kind === "mediator") {
      scopePredicate = sql`(
        cases.mediator_id = ${scope.userId}
        OR EXISTS (SELECT 1 FROM parties p WHERE p.case_id = cases.id AND (p.allocated_mediator_id = ${scope.userId} OR p.miam_mediator_id = ${scope.userId}))
        OR EXISTS (SELECT 1 FROM mediation_sessions ms WHERE ms.case_id = cases.id AND ms.lead_mediator_id = ${scope.userId})
        OR EXISTS (
          SELECT 1 FROM mediation_sessions ms
          JOIN mediation_session_participants msp ON msp.session_id = ms.id
          WHERE ms.case_id = cases.id AND msp.user_id = ${scope.userId} AND msp.role IN ('lead_mediator', 'co_mediator', 'observer') AND msp.invitation_status = 'accepted'
        )
      )`;
    } else {
      scopePredicate = sql`EXISTS (SELECT 1 FROM parties p JOIN clients cl ON cl.id = p.client_id WHERE p.case_id = cases.id AND cl.user_id = ${scope.userId})`;
    }
    const preds: SQL[] = [scopePredicate];
    const inF = (col: SQL, values: string[] | undefined): SQL | null => {
      if (!values || values.length === 0) return null;
      return sql`${col} IN (${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )})`;
    };
    if (filters.statuses && filters.statuses.length > 0) {
      preds.push(inF(sql`cases.status`, filters.statuses)!);
    } else if (excludeArchivedByDefault) {
      preds.push(sql`cases.status <> 'Archived'`);
    }
    const stagePred = inF(sql`cases.stage`, filters.stages);
    if (stagePred) preds.push(stagePred);
    const catPred = inF(
      sql`cases.mediation_category`,
      filters.mediationCategories as string[] | undefined,
    );
    if (catPred) preds.push(catPred);
    const subOr: SQL[] = [];
    for (const [col, vals] of [
      [sql`cases.family_sub_type`, filters.familySubTypes],
      [sql`cases.workplace_sub_type`, filters.workplaceSubTypes],
      [sql`cases.civil_sub_type`, filters.civilSubTypes],
      [sql`cases.commercial_sub_type`, filters.commercialSubTypes],
      [sql`cases.other_sub_type`, filters.otherSubTypes],
    ] as const) {
      const p = inF(col as SQL, vals as string[] | undefined);
      if (p) subOr.push(p);
    }
    if (subOr.length > 0) preds.push(sql`(${sql.join(subOr, sql` OR `)})`);
    for (const [col, vals] of [
      [sql`cases.funding_source`, filters.fundingSources],
      [sql`cases.voucher_status`, filters.voucherStatuses],
      [sql`cases.in_court_status`, filters.inCourtStatuses],
      [sql`cases.cafcass_status`, filters.cafcassStatuses],
    ] as const) {
      const p = inF(col as SQL, vals as string[] | undefined);
      if (p) preds.push(p);
    }
    if (filters.assignedMediatorIds && filters.assignedMediatorIds.length > 0) {
      const ids = filters.assignedMediatorIds;
      const idsSql = sql.join(
        ids.map((v) => sql`${v}`),
        sql`, `,
      );
      preds.push(
        sql`(cases.mediator_id IN (${idsSql}) OR EXISTS (SELECT 1 FROM parties p WHERE p.case_id = cases.id AND p.allocated_mediator_id IN (${idsSql})))`,
      );
    }
    if (filters.miamMediatorIds && filters.miamMediatorIds.length > 0) {
      const ids = filters.miamMediatorIds;
      const idsSql = sql.join(
        ids.map((v) => sql`${v}`),
        sql`, `,
      );
      preds.push(
        sql`EXISTS (SELECT 1 FROM parties p WHERE p.case_id = cases.id AND p.miam_mediator_id IN (${idsSql}))`,
      );
    }
    const dateFt = (col: SQL, from?: string, to?: string): SQL | null => {
      const ps: SQL[] = [];
      if (from) ps.push(sql`${col} >= ${from}::date`);
      if (to) ps.push(sql`${col} < (${to}::date + INTERVAL '1 day')`);
      if (ps.length === 0) return null;
      return ps.length === 1 ? ps[0] : sql`(${sql.join(ps, sql` AND `)})`;
    };
    const ed = dateFt(
      sql`cases.enquiry_date`,
      filters.enquiryDateFrom,
      filters.enquiryDateTo,
    );
    if (ed) preds.push(ed);
    const md = dateFt(
      sql`cases.miam_completed_date`,
      filters.miamCompletedDateFrom,
      filters.miamCompletedDateTo,
    );
    if (md) preds.push(md);
    const cd = dateFt(
      sql`cases.closure_date`,
      filters.closureDateFrom,
      filters.closureDateTo,
    );
    if (cd) preds.push(cd);
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      preds.push(
        sql`(cases.case_ref ILIKE ${q} OR cases.issue_type ILIKE ${q} OR EXISTS (SELECT 1 FROM parties p JOIN clients cl ON cl.id = p.client_id WHERE p.case_id = cases.id AND (cl.first_name ILIKE ${q} OR cl.last_name ILIKE ${q} OR (cl.first_name || ' ' || cl.last_name) ILIKE ${q} OR cl.email ILIKE ${q} OR cl.date_of_birth ILIKE ${q})) OR EXISTS (SELECT 1 FROM mediation_session_voucher_claims vc WHERE vc.case_id = cases.id AND vc.opia_claim_reference ILIKE ${q}) OR EXISTS (SELECT 1 FROM users u WHERE u.id = cases.mediator_id AND u.name ILIKE ${q}))`,
      );
    }
    return sql.join(preds, sql` AND `);
  }

  private mapRowToCase(r: Record<string, unknown>): Case {
    return {
      id: r.id as string,
      caseRef: r.case_ref as string,
      mediatorId: (r.mediator_id as string | null) ?? null,
      stage: r.stage as string,
      status: r.status as string,
      issueType: (r.issue_type as string | null) ?? null,
      leadSource: (r.lead_source as string | null) ?? null,
      shuttleMediation: Boolean(r.shuttle_mediation),
      confidential: Boolean(r.confidential),
      cimEligible: Boolean(r.cim_eligible),
      lastUpdated: new Date(r.last_updated as string),
      createdAt: new Date(r.created_at as string),
      notes: (r.notes as string | null) ?? null,
      referralPartnerName: (r.referral_partner_name as string | null) ?? null,
      referralPartnerCode: (r.referral_partner_code as string | null) ?? null,
      closureDetails: (r.closure_details as string | null) ?? null,
      mediationCategory: (r.mediation_category as string | null) ?? null,
      familySubType: (r.family_sub_type as string | null) ?? null,
      workplaceSubType: (r.workplace_sub_type as string | null) ?? null,
      civilSubType: (r.civil_sub_type as string | null) ?? null,
      commercialSubType: (r.commercial_sub_type as string | null) ?? null,
      otherSubType: (r.other_sub_type as string | null) ?? null,
      fundingSource: (r.funding_source as string | null) ?? null,
      voucherStatus: (r.voucher_status as string | null) ?? null,
      inCourtStatus: (r.in_court_status as string | null) ?? null,
      cafcassStatus: (r.cafcass_status as string | null) ?? null,
      mojVoucherEligible: Boolean(r.moj_voucher_eligible),
      enquiryDate: r.enquiry_date ? new Date(r.enquiry_date as string) : null,
      miamCompletedDate: r.miam_completed_date
        ? new Date(r.miam_completed_date as string)
        : null,
      closureDate: r.closure_date ? new Date(r.closure_date as string) : null,
    } as Case;
  }

  /** Update the cached filter columns (sourced from MIAM records and other tables). */
  async updateFilterCache(
    id: string,
    data: Partial<{
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
      mojVoucherEligible: boolean;
      enquiryDate: Date | null;
      miamCompletedDate: Date | null;
      closureDate: Date | null;
    }>,
  ): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await db.update(cases).set(data).where(eq(cases.id, id));
  }

  async getCase(id: string): Promise<Case | undefined> {
    const [c] = await db.select().from(cases).where(eq(cases.id, id));
    return c;
  }

  async createCase(c: InsertCase): Promise<Case> {
    const [created] = await db.insert(cases).values(c).returning();
    return created;
  }

  async updateCaseStage(id: string, stage: string): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ stage, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseShuttle(
    id: string,
    shuttleMediation: boolean,
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ shuttleMediation, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseConfidential(
    id: string,
    confidential: boolean,
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ confidential, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseCimEligibility(
    id: string,
    data: { cimEligible: boolean; markedBy?: string | null },
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({
        cimEligible: data.cimEligible,
        cimEligibilityMarkedAt: data.cimEligible ? new Date() : null,
        cimEligibilityMarkedBy: data.cimEligible
          ? (data.markedBy ?? null)
          : null,
        lastUpdated: new Date(),
      })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseNotes(id: string, notes: string): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ notes, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseReferral(
    id: string,
    data: {
      referralPartnerName?: string | null;
      referralPartnerCode?: string | null;
    },
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ ...data, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseClosureDetails(
    id: string,
    closureDetails: string,
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ closureDetails, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseMediator(
    id: string,
    mediatorId: string | null,
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ mediatorId, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseType(
    id: string,
    data: { mediationCategory: string; subType: string },
  ): Promise<Case | undefined> {
    const subtypeFields = {
      familySubType: null as string | null,
      workplaceSubType: null as string | null,
      civilSubType: null as string | null,
      commercialSubType: null as string | null,
      otherSubType: null as string | null,
    };

    switch (data.mediationCategory) {
      case "Family":
        subtypeFields.familySubType = data.subType;
        break;
      case "Workplace":
        subtypeFields.workplaceSubType = data.subType;
        break;
      case "Civil":
        subtypeFields.civilSubType = data.subType;
        break;
      case "Commercial":
        subtypeFields.commercialSubType = data.subType;
        break;
      case "Other":
        subtypeFields.otherSubType = data.subType;
        break;
    }

    const [updated] = await db
      .update(cases)
      .set({
        mediationCategory: data.mediationCategory,
        ...subtypeFields,
        mojVoucherEligible: isMojVoucherEligibleCase({
          mediationCategory: data.mediationCategory,
          familySubType: subtypeFields.familySubType,
          issueType: null,
        }),
        lastUpdated: new Date(),
      })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async updateCaseManualRevenue(
    id: string,
    data: { manualRevenuePence: number | null; updatedBy: string },
  ): Promise<Case | undefined> {
    const now = new Date();
    const [updated] = await db
      .update(cases)
      .set({
        manualRevenuePence: data.manualRevenuePence,
        manualRevenueUpdatedBy: data.updatedBy,
        manualRevenueUpdatedAt: now,
        lastUpdated: now,
      })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async getCaseClosureRecord(
    caseId: string,
  ): Promise<CaseClosureRecord | undefined> {
    const [record] = await db
      .select()
      .from(caseClosureRecords)
      .where(eq(caseClosureRecords.caseId, caseId))
      .limit(1);
    return record;
  }

  async listCaseClosurePartyFollowUps(
    caseId: string,
  ): Promise<CaseClosurePartyFollowUp[]> {
    return db
      .select()
      .from(caseClosurePartyFollowUps)
      .where(eq(caseClosurePartyFollowUps.caseId, caseId));
  }

  async getCaseFollowUpConsentByTokenHash(
    tokenHash: string,
  ): Promise<CaseFollowUpConsentContext | undefined> {
    const [row] = await db
      .select({
        id: caseClosurePartyFollowUps.id,
        closureRecordId: caseClosurePartyFollowUps.closureRecordId,
        caseId: caseClosurePartyFollowUps.caseId,
        partyId: caseClosurePartyFollowUps.partyId,
        clientId: caseClosurePartyFollowUps.clientId,
        consentStatus: caseClosurePartyFollowUps.consentStatus,
        consentSource: caseClosurePartyFollowUps.consentSource,
        exclusionReason: caseClosurePartyFollowUps.exclusionReason,
        consentRecordedAt: caseClosurePartyFollowUps.consentRecordedAt,
        consentRecordedBy: caseClosurePartyFollowUps.consentRecordedBy,
        followUpConsentTokenHash:
          caseClosurePartyFollowUps.followUpConsentTokenHash,
        followUpConsentTokenExpiresAt:
          caseClosurePartyFollowUps.followUpConsentTokenExpiresAt,
        followUpConsentRequestSentAt:
          caseClosurePartyFollowUps.followUpConsentRequestSentAt,
        followUpConsentEmailStatus:
          caseClosurePartyFollowUps.followUpConsentEmailStatus,
        followUpConsentEmailLastError:
          caseClosurePartyFollowUps.followUpConsentEmailLastError,
        followUpConsentDecidedAt:
          caseClosurePartyFollowUps.followUpConsentDecidedAt,
        followUpConsentDecisionSource:
          caseClosurePartyFollowUps.followUpConsentDecisionSource,
        followUpTasksScheduled:
          caseClosurePartyFollowUps.followUpTasksScheduled,
        createdAt: caseClosurePartyFollowUps.createdAt,
        updatedAt: caseClosurePartyFollowUps.updatedAt,
        caseRef: cases.caseRef,
        caseStatus: cases.status,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientEmail: clients.email,
        partyRole: parties.role,
      })
      .from(caseClosurePartyFollowUps)
      .innerJoin(cases, eq(caseClosurePartyFollowUps.caseId, cases.id))
      .innerJoin(parties, eq(caseClosurePartyFollowUps.partyId, parties.id))
      .innerJoin(clients, eq(caseClosurePartyFollowUps.clientId, clients.id))
      .where(eq(caseClosurePartyFollowUps.followUpConsentTokenHash, tokenHash))
      .limit(1);
    return row;
  }

  async upsertCaseFollowUpConsentRequest(data: {
    caseId: string;
    partyId: string;
    clientId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedBy: string;
    emailSent: boolean;
    emailError?: string | null;
  }): Promise<CaseClosurePartyFollowUp> {
    const now = new Date();
    const [row] = await db
      .insert(caseClosurePartyFollowUps)
      .values({
        closureRecordId: null,
        caseId: data.caseId,
        partyId: data.partyId,
        clientId: data.clientId,
        consentStatus: "pending",
        consentSource: "email_request",
        exclusionReason: null,
        consentRecordedAt: now,
        consentRecordedBy: data.requestedBy,
        followUpConsentTokenHash: data.tokenHash,
        followUpConsentTokenExpiresAt: data.expiresAt,
        followUpConsentRequestSentAt: now,
        followUpConsentEmailStatus: data.emailSent ? "sent" : "failed",
        followUpConsentEmailLastError: data.emailError ?? null,
        followUpConsentDecidedAt: null,
        followUpConsentDecisionSource: null,
        followUpTasksScheduled: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          caseClosurePartyFollowUps.caseId,
          caseClosurePartyFollowUps.partyId,
        ],
        set: {
          consentStatus: "pending",
          consentSource: "email_request",
          exclusionReason: null,
          consentRecordedAt: now,
          consentRecordedBy: data.requestedBy,
          followUpConsentTokenHash: data.tokenHash,
          followUpConsentTokenExpiresAt: data.expiresAt,
          followUpConsentRequestSentAt: now,
          followUpConsentEmailStatus: data.emailSent ? "sent" : "failed",
          followUpConsentEmailLastError: data.emailError ?? null,
          followUpConsentDecidedAt: null,
          followUpConsentDecisionSource: null,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  async recordCaseFollowUpConsentGranted(
    id: string,
    scheduledTaskCount: number,
    tokenClearFields: {
      followUpConsentTokenHash: null;
      followUpConsentTokenExpiresAt: null;
    } = {
      followUpConsentTokenHash: null,
      followUpConsentTokenExpiresAt: null,
    },
  ): Promise<CaseClosurePartyFollowUp | undefined> {
    const now = new Date();
    const [updated] = await db
      .update(caseClosurePartyFollowUps)
      .set({
        consentStatus: "granted",
        consentSource: "public_link",
        exclusionReason: null,
        consentRecordedAt: now,
        consentRecordedBy: null,
        ...tokenClearFields,
        followUpConsentDecidedAt: now,
        followUpConsentDecisionSource: "public_link",
        followUpTasksScheduled: sql`${caseClosurePartyFollowUps.followUpTasksScheduled} + ${scheduledTaskCount}`,
        updatedAt: now,
      })
      .where(eq(caseClosurePartyFollowUps.id, id))
      .returning();
    return updated;
  }

  async updateCaseClosure(
    id: string,
    data: Omit<
      InsertCaseClosureRecord,
      "caseId" | "closedAt" | "outreachExcluded" | "followUpConsentStatus"
    > & {
      followUpConsentStatus?: "granted" | "declined";
      closedById: string | null;
      partyFollowUpConsents?: CaseClosurePartyFollowUpInput[];
    },
  ): Promise<Case | undefined> {
    const now = new Date();
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(cases)
        .set({
          status: "Closed",
          closureReason: data.closureReason,
          closureDetails: data.closureDetails ?? null,
          closureDate: now,
          lastUpdated: now,
        })
        .where(eq(cases.id, id))
        .returning();
      if (!updated) return undefined;

      const followUpConsentStatus =
        data.followUpConsentStatus ??
        (data.partyFollowUpConsents?.some(
          (row) => row.consentStatus === "granted",
        )
          ? "granted"
          : "declined");
      const outreachExcluded = data.partyFollowUpConsents?.length
        ? data.partyFollowUpConsents.every(
            (row) => row.consentStatus !== "granted",
          )
        : followUpConsentStatus === "declined";

      const [closureRecord] = await tx
        .insert(caseClosureRecords)
        .values({
          caseId: id,
          closureReason: data.closureReason,
          closureDetails: data.closureDetails ?? null,
          closedAt: now,
          closedById: data.closedById,
          followUpConsentStatus,
          outreachExcluded,
          lifeSatisfaction: data.lifeSatisfaction ?? null,
          anxietyScore: data.anxietyScore ?? null,
          serviceRating: data.serviceRating ?? null,
          netPromoterScore: data.netPromoterScore ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: caseClosureRecords.caseId,
          set: {
            closureReason: data.closureReason,
            closureDetails: data.closureDetails ?? null,
            closedAt: now,
            closedById: data.closedById,
            followUpConsentStatus,
            outreachExcluded,
            lifeSatisfaction: data.lifeSatisfaction ?? null,
            anxietyScore: data.anxietyScore ?? null,
            serviceRating: data.serviceRating ?? null,
            netPromoterScore: data.netPromoterScore ?? null,
            updatedAt: now,
          },
        })
        .returning();

      if (closureRecord && data.partyFollowUpConsents) {
        for (const row of data.partyFollowUpConsents) {
          const isPending = row.consentStatus === "pending";
          const baseValues = {
            closureRecordId: closureRecord.id,
            caseId: id,
            partyId: row.partyId,
            clientId: row.clientId,
            consentStatus: row.consentStatus,
            consentSource: row.consentSource ?? "closure_admin",
            exclusionReason: row.exclusionReason ?? null,
            consentRecordedAt: now,
            consentRecordedBy: data.closedById,
            followUpTasksScheduled: row.followUpTasksScheduled ?? 0,
            createdAt: now,
            updatedAt: now,
          };
          await tx
            .insert(caseClosurePartyFollowUps)
            .values(baseValues)
            .onConflictDoUpdate({
              target: [
                caseClosurePartyFollowUps.caseId,
                caseClosurePartyFollowUps.partyId,
              ],
              set: {
                closureRecordId: closureRecord.id,
                consentStatus: row.consentStatus,
                consentSource: row.consentSource ?? "closure_admin",
                exclusionReason: row.exclusionReason ?? null,
                consentRecordedAt: now,
                consentRecordedBy: data.closedById,
                followUpTasksScheduled: row.followUpTasksScheduled ?? 0,
                ...(isPending
                  ? {}
                  : {
                      followUpConsentTokenHash: null,
                      followUpConsentTokenExpiresAt: null,
                      followUpConsentDecidedAt: now,
                      followUpConsentDecisionSource:
                        row.consentSource ?? "closure_admin",
                    }),
                updatedAt: now,
              },
            });
        }
      }

      return updated;
    });
  }

  async updateCaseMediatorRepVisibility(
    id: string,
    mediatorCanSeeReps: boolean,
  ): Promise<Case | undefined> {
    await db
      .update(cases)
      .set({ mediatorCanSeeReps, lastUpdated: new Date() })
      .where(eq(cases.id, id));
    return this.getCase(id);
  }

  async updateCaseStatus(
    id: string,
    status: string,
  ): Promise<Case | undefined> {
    const [updated] = await db
      .update(cases)
      .set({ status, lastUpdated: new Date() })
      .where(eq(cases.id, id))
      .returning();
    return updated;
  }

  async hardDeleteCase(id: string): Promise<HardDeleteCaseCounts> {
    return db.transaction(async (tx) => {
      const linkedParties = await tx
        .select({ clientId: parties.clientId })
        .from(parties)
        .where(eq(parties.caseId, id));
      const distinctClientIds = Array.from(
        new Set(linkedParties.map((p) => p.clientId)),
      );
      const editReqs = await tx
        .delete(miamEditRequests)
        .where(eq(miamEditRequests.caseId, id))
        .returning({ id: miamEditRequests.id });
      const miamRecs = await tx
        .delete(miamRecords)
        .where(eq(miamRecords.caseId, id))
        .returning({ id: miamRecords.id });
      const activities = await tx
        .delete(caseActivities)
        .where(eq(caseActivities.caseId, id))
        .returning({ id: caseActivities.id });
      const closureRows = await tx
        .delete(caseClosureRecords)
        .where(eq(caseClosureRecords.caseId, id))
        .returning({ id: caseClosureRecords.id });
      const confNotes = await tx
        .delete(caseConfidentialNotes)
        .where(eq(caseConfidentialNotes.caseId, id))
        .returning({ id: caseConfidentialNotes.id });
      const notifs = await tx
        .delete(notifications)
        .where(eq(notifications.caseId, id))
        .returning({ id: notifications.id });
      const sessionRows = await tx
        .select({ id: mediationSessions.id })
        .from(mediationSessions)
        .where(eq(mediationSessions.caseId, id));
      const sessionIds = sessionRows.map((row) => row.id);
      const sessionParticipants =
        sessionIds.length > 0
          ? await tx
              .delete(mediationSessionParticipants)
              .where(
                inArray(mediationSessionParticipants.sessionId, sessionIds),
              )
              .returning({ id: mediationSessionParticipants.id })
          : [];
      const mediationSessionRows = await tx
        .delete(mediationSessions)
        .where(eq(mediationSessions.caseId, id))
        .returning({ id: mediationSessions.id });
      const appts = await tx
        .delete(appointments)
        .where(eq(appointments.caseId, id))
        .returning({ id: appointments.id });
      const demos = await tx
        .delete(demographicData)
        .where(eq(demographicData.caseId, id))
        .returning({ id: demographicData.id });
      // Cascade-delete representatives so hard-delete doesn't leave orphan rep rows
      // (with potentially still-active consent tokens).
      await tx
        .delete(caseRepresentatives)
        .where(eq(caseRepresentatives.caseId, id));
      const partyRows = await tx
        .delete(parties)
        .where(eq(parties.caseId, id))
        .returning({ id: parties.id });
      const enq = await tx
        .update(enquiries)
        .set({ convertedCaseId: null })
        .where(eq(enquiries.convertedCaseId, id))
        .returning({ id: enquiries.id });
      await tx.delete(cases).where(eq(cases.id, id));
      return {
        partyLinks: partyRows.length,
        clientsAffected: distinctClientIds.length,
        appointments: appts.length,
        confidentialNotes: confNotes.length,
        caseActivities: activities.length,
        demographicData: demos.length,
        miamRecords: miamRecs.length,
        miamEditRequests: editReqs.length,
        notifications: notifs.length,
        mediationSessions: mediationSessionRows.length,
        mediationSessionParticipants: sessionParticipants.length,
        caseClosureRecords: closureRows.length,
        enquiriesUnlinked: enq.length,
      };
    });
  }
}
