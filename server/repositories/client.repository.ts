import { type Client, type InsertClient, clients, legacyCrmRecordClients, users } from "@shared/schema";
import { db, pool } from "../db";
import { eq, and, sql } from "drizzle-orm";
import type { PaginationParams } from "@shared/schema";

export interface ClientRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneCode: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  ethnicOrigin: string | null;
  nationalInsuranceNumber: string | null;
  disabilityOrHealthCondition: string | null;
  additionalNeeds: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  userId: string | null;
  portalStatus: string;
  caseCount: number;
}

export interface CaseLinkRow {
  clientId: string;
  partyId: string;
  caseId: string;
  caseRef: string;
  caseStatus: string;
  role: string;
  portalStatus: string;
  mediatorName: string;
}

export class ClientRepository {
  async getClient(id: string): Promise<Client | undefined> {
    const [row] = await db.select().from(clients).where(eq(clients.id, id));
    return row;
  }

  async getClientByUserId(userId: string): Promise<Client | undefined> {
    const [row] = await db.select().from(clients).where(eq(clients.userId, userId));
    if (row) return row;
    // Self-healing auto-link: if no row is linked by user_id, fall back to a
    // case-insensitive email match against the user's email. If a UNIQUE
    // match is found AND its user_id is NULL, persist the link before
    // returning. Multiple matches → don't auto-pick (return undefined and
    // let the caller render the empty state).
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u || !u.email) return undefined;
    const matches = await db.select().from(clients)
      .where(sql`lower(${clients.email}) = lower(${u.email})`);
    if (matches.length !== 1) return undefined;
    const candidate = matches[0];
    if (candidate.userId && candidate.userId !== userId) return undefined;
    if (!candidate.userId) {
      const [linked] = await db.update(clients)
        .set({ userId })
        .where(and(eq(clients.id, candidate.id), sql`${clients.userId} IS NULL`))
        .returning();
      if (linked) {
        console.log(`[clients] auto-linked clients.id=${candidate.id} to users.id=${userId} via email match`);
        return linked;
      }
      return candidate;
    }
    return candidate;
  }

  async findByEmail(email: string): Promise<Client | undefined> {
    const [row] = await db.select().from(clients)
      .where(sql`lower(${clients.email}) = lower(${email})`);
    return row;
  }

  async findByNameDob(firstName: string, lastName: string, dateOfBirth: string): Promise<Client | undefined> {
    const [row] = await db.select().from(clients)
      .where(and(
        sql`lower(${clients.firstName}) = lower(${firstName})`,
        sql`lower(${clients.lastName}) = lower(${lastName})`,
        eq(clients.dateOfBirth, dateOfBirth),
      ));
    return row;
  }

  private normalizePhone(value: string | null | undefined): string {
    return (value || "").replace(/\D/g, "").replace(/^44/, "0");
  }

  async findStrongMatch(data: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: string | null;
  }): Promise<Client | undefined> {
    if (!data.email || !data.phone || !data.dateOfBirth) return undefined;
    const normalizedPhone = this.normalizePhone(data.phone);
    const rows = await db.select().from(clients).where(and(
      sql`lower(${clients.firstName}) = lower(${data.firstName})`,
      sql`lower(${clients.lastName}) = lower(${data.lastName})`,
      sql`lower(${clients.email}) = lower(${data.email})`,
      eq(clients.dateOfBirth, data.dateOfBirth),
    ));
    return rows.find((row) => this.normalizePhone(row.phone) === normalizedPhone);
  }

  async findPotentialMatches(data: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: string | null;
  }): Promise<Client[]> {
    const normalizedPhone = this.normalizePhone(data.phone);
    const rows = await db.select().from(clients).where(
      sql`lower(${clients.firstName}) = lower(${data.firstName}) OR lower(${clients.lastName}) = lower(${data.lastName}) OR lower(${clients.email}) = lower(${data.email || ""})`,
    );
    return rows.filter((row) => {
      const emailMatch = !!data.email && row.email?.toLowerCase() === data.email.toLowerCase();
      const dobMatch = !!data.dateOfBirth && row.dateOfBirth === data.dateOfBirth;
      const phoneMatch = !!normalizedPhone && this.normalizePhone(row.phone) === normalizedPhone;
      const nameMatch = row.firstName.toLowerCase() === data.firstName.toLowerCase()
        && row.lastName.toLowerCase() === data.lastName.toLowerCase();
      return emailMatch || phoneMatch || (nameMatch && dobMatch) || (nameMatch && !dobMatch);
    });
  }

  async listAll(): Promise<Client[]> {
    return db.select().from(clients);
  }

  async hasLegacyHistory(clientId: string): Promise<boolean> {
    const [row] = await db.select({ id: legacyCrmRecordClients.id })
      .from(legacyCrmRecordClients)
      .where(eq(legacyCrmRecordClients.clientId, clientId))
      .limit(1);
    return !!row;
  }

  async listPaginated(params: PaginationParams): Promise<{ rows: ClientRow[]; total: number; counts: Record<string, number> }> {
    const { page, limit, search, status, sortBy, sortOrder } = params;
    const offset = (page - 1) * limit;

    // Portal status is derived: active > invited > inactive
    const portalExpr = `
      CASE
        WHEN EXISTS (SELECT 1 FROM parties p2 WHERE p2.client_id = c.id AND p2.portal_status = 'active')   THEN 'active'
        WHEN EXISTS (SELECT 1 FROM parties p2 WHERE p2.client_id = c.id AND p2.portal_status = 'invited')  THEN 'invited'
        ELSE 'inactive'
      END`;

    // searchArgs/searchConditions: used for tab counts (no status filter)
    const searchArgs: (string | number)[] = [];
    const searchConditions: string[] = [];

    if (search) {
      searchArgs.push(`%${search.toLowerCase()}%`);
      const idx = searchArgs.length;
      searchConditions.push(
        `(lower(c.first_name || ' ' || c.last_name) LIKE $${idx}` +
        ` OR lower(coalesce(c.email,'')) LIKE $${idx}` +
        ` OR EXISTS (SELECT 1 FROM parties p_s JOIN cases cs_s ON cs_s.id = p_s.case_id` +
        `  WHERE p_s.client_id = c.id AND lower(cs_s.case_ref) LIKE $${idx}))`,
      );
    }

    const searchWhere = searchConditions.length ? `WHERE ${searchConditions.join(" AND ")}` : "";

    // fullArgs/fullConditions: search + optional status filter — used for rows + total
    const fullArgs: (string | number)[] = [...searchArgs];
    const fullConditions: string[] = [...searchConditions];

    if (status) {
      fullArgs.push(status);
      fullConditions.push(`(${portalExpr}) = $${fullArgs.length}`);
    }

    const fullWhere = fullConditions.length ? `WHERE ${fullConditions.join(" AND ")}` : "";

    // Sort
    const sortMap: Record<string, string> = {
      name: "lower(c.first_name || ' ' || c.last_name)",
      email: "lower(coalesce(c.email,''))",
      phone: "lower(coalesce(c.phone,''))",
      portalStatus: portalExpr,
      cases: `(SELECT count(*) FROM parties p3 WHERE p3.client_id = c.id)`,
    };
    const orderExpr = sortMap[sortBy ?? ""] ?? sortMap.name;
    const direction = sortOrder === "asc" ? "ASC" : "DESC";

    const conn = await pool.connect();

    try {
      // 1. Counts per status (for UI tab badges) — excludes status filter so all tabs stay populated
      const countSql = `
        SELECT (${portalExpr}) AS portal_status, count(*) AS n
        FROM clients c
        ${searchWhere}
        GROUP BY 1
      `;
      const countRes = await conn.query<{ portal_status: string; n: string }>(countSql, searchArgs);
      const counts: Record<string, number> = {};
      for (const row of countRes.rows) {
        counts[row.portal_status] = parseInt(row.n, 10);
      }

      // 2. Total (respects status filter for pagination)
      const totalRes = await conn.query<{ n: string }>(
        `SELECT count(*) AS n FROM clients c ${fullWhere}`,
        fullArgs,
      );
      const total = parseInt(totalRes.rows[0]?.n ?? "0", 10);

      // 3. Paginated client rows
      const rowArgs = [...fullArgs, limit, offset];
      const rowSql = `
        SELECT
          c.id,
          c.first_name        AS "firstName",
          c.last_name         AS "lastName",
          c.email,
          c.phone,
          c.phone_code        AS "phoneCode",
          c.date_of_birth     AS "dateOfBirth",
          c.gender,
          c.ethnic_origin     AS "ethnicOrigin",
          c.national_insurance_number AS "nationalInsuranceNumber",
          c.disability_or_health_condition AS "disabilityOrHealthCondition",
          c.additional_needs  AS "additionalNeeds",
          c.address_line_1    AS "addressLine1",
          c.address_line_2    AS "addressLine2",
          c.city,
          c.postcode,
          c.country,
          c.user_id           AS "userId",
          (${portalExpr})     AS "portalStatus",
          (SELECT count(*) FROM parties p3 WHERE p3.client_id = c.id)::int AS "caseCount"
        FROM clients c
        ${fullWhere}
        ORDER BY ${orderExpr} ${sortBy ? direction : "ASC"}
        LIMIT $${rowArgs.length - 1}
        OFFSET $${rowArgs.length}
      `;
      const rowRes = await conn.query<ClientRow>(rowSql, rowArgs);

      return { rows: rowRes.rows, total, counts };
    } finally {
      conn.release();
    }
  }

  async getCaseLinksForClients(clientIds: string[]): Promise<CaseLinkRow[]> {
    if (clientIds.length === 0) return [];
    const conn = await pool.connect();
    try {
      const res = await conn.query<CaseLinkRow>(
        `SELECT
           p.client_id AS "clientId",
           p.id        AS "partyId",
           p.case_id   AS "caseId",
           cs.case_ref AS "caseRef",
           cs.status   AS "caseStatus",
           p.role,
           p.portal_status AS "portalStatus",
           coalesce(u.name, 'Unassigned') AS "mediatorName"
         FROM parties p
         JOIN cases cs ON cs.id = p.case_id
         LEFT JOIN users u ON u.id = cs.mediator_id
         WHERE p.client_id = ANY($1::text[])`,
        [clientIds],
      );
      return res.rows;
    } finally {
      conn.release();
    }
  }

  async createClient(data: InsertClient): Promise<Client> {
    const [created] = await db.insert(clients).values({
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      phoneCode: data.phoneCode ?? "+44",
      gender: data.gender ?? null,
      ethnicOrigin: data.ethnicOrigin ?? null,
      nationalInsuranceNumber: data.nationalInsuranceNumber ?? null,
      disabilityOrHealthCondition: data.disabilityOrHealthCondition ?? null,
      additionalNeeds: data.additionalNeeds ?? null,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      postcode: data.postcode ?? null,
      country: data.country ?? "United Kingdom",
      userId: data.userId ?? null,
    }).returning();
    return created;
  }

  async updateClient(id: string, data: Partial<Omit<Client, "id" | "createdAt">>): Promise<Client | undefined> {
    const [updated] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
    return updated;
  }

  async deleteClient(id: string): Promise<boolean> {
    const result = await db.delete(clients).where(eq(clients.id, id)).returning({ id: clients.id });
    return result.length > 0;
  }
}
