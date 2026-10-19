import { and, desc, eq, gte, ne, or } from "drizzle-orm";
import { db } from "../db";
import { enquiries, enquiryDuplicateReviews, type Enquiry, type EnquiryDuplicateReview } from "@shared/schema";
import { notificationService } from "./notification.service";

export type DuplicateMatchReason = "email" | "phone";

type DuplicateCandidateInput = Pick<Enquiry, "id" | "enquiryRef" | "dateReceived" | "email" | "mobileTelephone" | "contactMethod">;

export type DuplicateCandidateMatch = {
  matchedEnquiryId: string;
  matchReasons: DuplicateMatchReason[];
};

export type EnquiryDuplicateReviewDetails = EnquiryDuplicateReview & {
  sourceEnquiry: Enquiry | null;
  matchedEnquiry: Enquiry | null;
  primaryEnquiry: Enquiry | null;
};

const DUPLICATE_WINDOW_DAYS = 30;

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizePhone(value: string | null | undefined) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function parseDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function findDuplicateEnquiryCandidates(input: {
  enquiry: DuplicateCandidateInput;
  existing: DuplicateCandidateInput[];
  now?: Date;
  windowDays?: number;
}): DuplicateCandidateMatch[] {
  const windowDays = input.windowDays ?? DUPLICATE_WINDOW_DAYS;
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const enquiryDate = parseDate(input.enquiry.dateReceived) ?? now;
  const email = normalizeEmail(input.enquiry.email);
  const phone = normalizePhone(input.enquiry.mobileTelephone);

  return input.existing.flatMap((candidate) => {
    if (candidate.id === input.enquiry.id) return [];
    if ((candidate.contactMethod || "") === (input.enquiry.contactMethod || "")) return [];
    const candidateDate = parseDate(candidate.dateReceived);
    if (!candidateDate || candidateDate < cutoff || candidateDate > enquiryDate) return [];

    const matchReasons: DuplicateMatchReason[] = [];
    if (email && email === normalizeEmail(candidate.email)) matchReasons.push("email");
    if (phone && phone === normalizePhone(candidate.mobileTelephone)) matchReasons.push("phone");
    return matchReasons.length ? [{ matchedEnquiryId: candidate.id, matchReasons }] : [];
  });
}

class EnquiryDuplicateService {
  async detectForNewEnquiry(enquiry: Enquiry, caseId?: string | null) {
    const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const existing = await db
      .select()
      .from(enquiries)
      .where(and(
        ne(enquiries.id, enquiry.id),
        ne(enquiries.status, "Archived"),
        gte(enquiries.dateReceived, cutoff),
      ));

    const matches = findDuplicateEnquiryCandidates({ enquiry, existing });
    if (matches.length === 0) return [];

    const created: EnquiryDuplicateReview[] = [];
    for (const match of matches) {
      const [review] = await db
        .insert(enquiryDuplicateReviews)
        .values({
          sourceEnquiryId: enquiry.id,
          matchedEnquiryId: match.matchedEnquiryId,
          matchReasons: match.matchReasons.join(","),
        })
        .onConflictDoNothing()
        .returning();
      if (review) created.push(review);
    }

    if (created.length > 0) {
      const refs = existing
        .filter((candidate) => created.some((review) => review.matchedEnquiryId === candidate.id))
        .map((candidate) => candidate.enquiryRef)
        .join(", ");
      await notificationService.createNotification({
        recipientId: null,
        recipientRole: "admin",
        type: "duplicate_enquiry_review",
        urgency: "amber",
        caseId: caseId || enquiry.convertedCaseId || null,
        appointmentId: null,
        title: `Review possible duplicate enquiry — ${enquiry.enquiryRef}`,
        message: `Possible duplicate enquiry submitted through a different channel. Compare ${enquiry.enquiryRef}${refs ? ` with ${refs}` : ""} and link or dismiss the match.`,
        status: "active",
        caseNoteRequired: false,
      });
    }

    return created;
  }

  async countPendingByEnquiryIds(enquiryIds: string[]) {
    if (enquiryIds.length === 0) return new Map<string, number>();
    const rows = await db.select().from(enquiryDuplicateReviews).where(and(
      eq(enquiryDuplicateReviews.status, "pending"),
      or(
        ...enquiryIds.map((id) => eq(enquiryDuplicateReviews.sourceEnquiryId, id)),
        ...enquiryIds.map((id) => eq(enquiryDuplicateReviews.matchedEnquiryId, id)),
      )!,
    ));
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.sourceEnquiryId, (counts.get(row.sourceEnquiryId) || 0) + 1);
      counts.set(row.matchedEnquiryId, (counts.get(row.matchedEnquiryId) || 0) + 1);
    }
    return counts;
  }

  async listForEnquiry(enquiryId: string): Promise<EnquiryDuplicateReviewDetails[]> {
    const rows = await db
      .select({
        review: enquiryDuplicateReviews,
        sourceEnquiry: enquiries,
      })
      .from(enquiryDuplicateReviews)
      .leftJoin(enquiries, eq(enquiryDuplicateReviews.sourceEnquiryId, enquiries.id))
      .where(or(
        eq(enquiryDuplicateReviews.sourceEnquiryId, enquiryId),
        eq(enquiryDuplicateReviews.matchedEnquiryId, enquiryId),
      ))
      .orderBy(desc(enquiryDuplicateReviews.createdAt));

    const allIds = Array.from(new Set(rows.flatMap(({ review }) => [
      review.sourceEnquiryId,
      review.matchedEnquiryId,
      review.primaryEnquiryId,
    ]).filter(Boolean) as string[]));
    const related = allIds.length
      ? await db.select().from(enquiries).where(or(...allIds.map((id) => eq(enquiries.id, id)))!)
      : [];
    const byId = new Map(related.map((enquiry) => [enquiry.id, enquiry]));

    return rows.map(({ review }) => ({
      ...review,
      sourceEnquiry: byId.get(review.sourceEnquiryId) ?? null,
      matchedEnquiry: byId.get(review.matchedEnquiryId) ?? null,
      primaryEnquiry: review.primaryEnquiryId ? byId.get(review.primaryEnquiryId) ?? null : null,
    }));
  }

  async review(input: {
    reviewId: string;
    status: "linked" | "dismissed";
    note: string;
    primaryEnquiryId?: string | null;
    reviewedBy: string;
  }) {
    const [existing] = await db
      .select()
      .from(enquiryDuplicateReviews)
      .where(eq(enquiryDuplicateReviews.id, input.reviewId))
      .limit(1);
    if (!existing) return null;

    const primaryEnquiryId = input.status === "linked"
      ? input.primaryEnquiryId || existing.sourceEnquiryId
      : null;
    if (input.status === "linked" && primaryEnquiryId !== existing.sourceEnquiryId && primaryEnquiryId !== existing.matchedEnquiryId) {
      throw new Error("Primary enquiry must be one of the possible duplicate records");
    }

    const [updated] = await db
      .update(enquiryDuplicateReviews)
      .set({
        status: input.status,
        primaryEnquiryId,
        reviewNote: input.note,
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date(),
      })
      .where(eq(enquiryDuplicateReviews.id, input.reviewId))
      .returning();
    return updated;
  }
}

export const enquiryDuplicateService = new EnquiryDuplicateService();
