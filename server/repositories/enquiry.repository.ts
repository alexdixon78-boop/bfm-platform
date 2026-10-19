import { type Enquiry, type InsertEnquiry, type UpdateEnquiryData, type PaginationParams, type PaginatedResponse, enquiries, cases, users, notifications } from "@shared/schema";
import { db } from "../db";
import { eq, ne, desc, asc, ilike, or, sql, and, isNull, inArray, count as drizzleCount, type AnyColumn } from "drizzle-orm";

type FollowUpState = "upcoming" | "due_today" | "overdue" | "none";
type EnquiryFollowUpFields = {
  nextFollowUpLabel: string | null;
  nextFollowUpDueAt: Date | null;
  nextFollowUpState: FollowUpState;
  nextFollowUpTitle: string | null;
};
type EnquiryListRow = Enquiry & {
  convertedCaseRef: string | null;
  caseConfidential: boolean;
  claimedByName: string | null;
} & EnquiryFollowUpFields;

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getFollowUpLabel(task: { type: string; title: string; message: string }): string {
  const raw = `${task.title} ${task.message}`.toLowerCase();
  if (raw.includes("day 10") || raw.includes("day-10")) return "Day 10";
  if (raw.includes("day 5") || raw.includes("day-5")) return "Day 5";
  if (task.type === "enquiry_follow_up") return "Day 0";
  if (task.type === "enquiry_persistent_follow_up") return "Ongoing";
  return "Follow-up";
}

function getFollowUpState(followUpDate: Date | null): FollowUpState {
  if (!followUpDate) return "upcoming";
  const now = new Date();
  if (isSameCalendarDay(followUpDate, now)) return "due_today";
  return followUpDate < now ? "overdue" : "upcoming";
}

function emptyFollowUp(): EnquiryFollowUpFields {
  return {
    nextFollowUpLabel: null,
    nextFollowUpDueAt: null,
    nextFollowUpState: "none",
    nextFollowUpTitle: null,
  };
}

export class EnquiryRepository {
  async getNextEnquiryRef(): Promise<string> {
    const year = new Date().getFullYear().toString();
    const prefix = `ENQ-${year}-`;

    const result = await db
      .select({ enquiryRef: enquiries.enquiryRef })
      .from(enquiries)
      .where(sql`${enquiries.enquiryRef} LIKE ${prefix + '%'}`)
      .orderBy(sql`${enquiries.enquiryRef} DESC`)
      .limit(1);

    let nextNum = 1;
    if (result.length > 0) {
      const lastRef = result[0].enquiryRef;
      const lastNum = parseInt(lastRef.split("-").pop() || "0", 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }

    return `ENQ-${year}-${nextNum.toString().padStart(4, "0")}`;
  }

  async listEnquiries(params: PaginationParams): Promise<PaginatedResponse<EnquiryListRow>> {
    const { page, limit, search, status, followUpFilter } = params;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (status) {
      conditions.push(eq(enquiries.status, status));
    } else {
      // Default list excludes archived enquiries
      conditions.push(ne(enquiries.status, "Archived"));
    }
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(enquiries.enquiryRef, pattern),
          ilike(enquiries.firstName, pattern),
          ilike(enquiries.lastName, pattern),
          ilike(enquiries.email, pattern),
          ilike(enquiries.issueType, pattern),
          ilike(enquiries.status, pattern),
        )!
      );
    }
    if (followUpFilter === "unclaimed") {
      conditions.push(isNull(cases.claimedBy));
      conditions.push(sql`${cases.id} IS NOT NULL`);
      conditions.push(ne(enquiries.status, "Closed"));
      conditions.push(sql`COALESCE(${cases.intakeStatus}, '') <> 'Closed'`);
    }
    if (followUpFilter === "safeguarding") {
      conditions.push(or(eq(enquiries.status, "Safeguarding"), eq(cases.intakeStatus, "Safeguarding"))!);
    }
    if (followUpFilter === "due_today") {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.case_id = ${cases.id}
          AND n.type IN ('enquiry_follow_up', 'enquiry_chase', 'enquiry_persistent_follow_up')
          AND n.status <> 'completed'
          AND n.follow_up_date IS NOT NULL
          AND n.follow_up_date::date = CURRENT_DATE
      )`);
    }
    if (followUpFilter === "overdue") {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.case_id = ${cases.id}
          AND n.type IN ('enquiry_follow_up', 'enquiry_chase', 'enquiry_persistent_follow_up')
          AND n.status <> 'completed'
          AND n.follow_up_date IS NOT NULL
          AND n.follow_up_date < NOW()
          AND n.follow_up_date::date <> CURRENT_DATE
      )`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ count: drizzleCount() })
      .from(enquiries)
      .leftJoin(cases, eq(enquiries.convertedCaseId, cases.id))
      .where(whereClause);

    const sortColumnMap: Record<string, AnyColumn> = {
      enquiryRef: enquiries.enquiryRef,
      dateReceived: enquiries.dateReceived,
      firstName: enquiries.firstName,
      email: enquiries.email,
      issueType: enquiries.issueType,
      leadSource: enquiries.leadSource,
      status: enquiries.status,
    };
    const sortCol = sortColumnMap[params.sortBy || ""] || enquiries.dateReceived;
    const sortDir = params.sortOrder === "asc" ? asc : desc;

    const rows = await db
      .select({ enquiry: enquiries, convertedCaseRef: cases.caseRef, caseConfidential: cases.confidential, claimedByName: users.name })
      .from(enquiries)
      .leftJoin(cases, eq(enquiries.convertedCaseId, cases.id))
      .leftJoin(users, eq(cases.claimedBy, users.id))
      .where(whereClause)
      .orderBy(sortDir(sortCol))
      .limit(limit)
      .offset(offset);
    const caseIds = rows.map((r) => r.enquiry.convertedCaseId).filter((id): id is string => !!id);
    const intakeTasks = caseIds.length
      ? await db
        .select()
        .from(notifications)
        .where(and(
          inArray(notifications.caseId, caseIds),
          inArray(notifications.type, ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up"]),
          ne(notifications.status, "completed"),
        ))
      : [];
    const tasksByCaseId = new Map<string, typeof intakeTasks>();
    for (const task of intakeTasks) {
      if (!task.caseId) continue;
      const current = tasksByCaseId.get(task.caseId) || [];
      current.push(task);
      tasksByCaseId.set(task.caseId, current);
    }

    const pickNextFollowUp = (caseId: string | null): EnquiryFollowUpFields => {
      if (!caseId) return emptyFollowUp();
      const tasks = tasksByCaseId.get(caseId) || [];
      const ranked = tasks
        .map((task) => {
          const dueAt = task.followUpDate ? new Date(task.followUpDate) : null;
          const state = getFollowUpState(dueAt);
          const stateRank = state === "overdue" ? 0 : state === "due_today" ? 1 : 2;
          return { task, dueAt, state, stateRank };
        })
        .sort((a, b) => {
          if (a.stateRank !== b.stateRank) return a.stateRank - b.stateRank;
          return (a.dueAt?.getTime() || Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() || Number.MAX_SAFE_INTEGER);
        });
      const next = ranked[0];
      if (!next) return emptyFollowUp();
      return {
        nextFollowUpLabel: getFollowUpLabel(next.task),
        nextFollowUpDueAt: next.dueAt,
        nextFollowUpState: next.state,
        nextFollowUpTitle: next.task.title,
      };
    };

    const data = rows.map((r) => ({
      ...r.enquiry,
      convertedCaseRef: r.convertedCaseRef ?? null,
      caseConfidential: r.caseConfidential ?? false,
      claimedByName: r.claimedByName ?? null,
      ...pickNextFollowUp(r.enquiry.convertedCaseId),
    }));

    const countsResult = await db
      .select({ status: enquiries.status, count: drizzleCount() })
      .from(enquiries)
      .groupBy(enquiries.status);

    const counts: Record<string, number> = {};
    for (const row of countsResult) {
      counts[row.status] = row.count;
    }

    const total = totalResult.count;
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      counts,
    };
  }

  async getEnquiry(id: string): Promise<(Enquiry & { convertedCaseRef: string | null; caseConfidential: boolean; claimedByName: string | null }) | undefined> {
    const [row] = await db
      .select({ enquiry: enquiries, convertedCaseRef: cases.caseRef, caseConfidential: cases.confidential, claimedByName: users.name })
      .from(enquiries)
      .leftJoin(cases, eq(enquiries.convertedCaseId, cases.id))
      .leftJoin(users, eq(cases.claimedBy, users.id))
      .where(eq(enquiries.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      ...row.enquiry,
      convertedCaseRef: row.convertedCaseRef ?? null,
      caseConfidential: row.caseConfidential ?? false,
      claimedByName: row.claimedByName ?? null,
    };
  }

  async createEnquiry(enquiry: InsertEnquiry & { enquiryRef: string }): Promise<Enquiry> {
    const [created] = await db.insert(enquiries).values(enquiry).returning();
    return created;
  }

  async updateEnquiry(id: string, data: UpdateEnquiryData): Promise<Enquiry | undefined> {
    const [updated] = await db.update(enquiries).set(data).where(eq(enquiries.id, id)).returning();
    return updated;
  }

  async updateEnquiryStatus(
    id: string,
    status: string,
    convertedCaseId?: string,
  ): Promise<Enquiry | undefined> {
    const values: Partial<Enquiry> = { status };
    if (convertedCaseId) values.convertedCaseId = convertedCaseId;
    const [updated] = await db.update(enquiries).set(values).where(eq(enquiries.id, id)).returning();
    return updated;
  }

  async updateEnquiryShuttle(id: string, shuttleMediation: boolean): Promise<Enquiry | undefined> {
    const [updated] = await db.update(enquiries).set({ shuttleMediation }).where(eq(enquiries.id, id)).returning();
    return updated;
  }

  async hardDeleteEnquiry(id: string): Promise<boolean> {
    const deleted = await db
      .delete(enquiries)
      .where(and(eq(enquiries.id, id), isNull(enquiries.convertedCaseId)))
      .returning({ id: enquiries.id });
    return deleted.length > 0;
  }
}
