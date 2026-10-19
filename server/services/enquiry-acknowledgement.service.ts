import { eq } from "drizzle-orm";
import { db } from "../db";
import { enquiries, type Enquiry } from "@shared/schema";
import { sendEnquiryAcknowledgementEmail } from "./email.service";
import { bookingService } from "./booking.service";
import { storage } from "../storage";

export type EnquiryAcknowledgementStatus = "not_attempted" | "sent" | "failed" | "skipped";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAcknowledgementEmailEligible(email: string | null | undefined) {
  return EMAIL_PATTERN.test((email || "").trim());
}

class EnquiryAcknowledgementService {
  async sendAutomaticAcknowledgement(enquiry: Enquiry) {
    return this.sendAcknowledgement(enquiry, "automatic");
  }

  async sendManualAcknowledgement(enquiry: Enquiry) {
    return this.sendAcknowledgement(enquiry, "manual");
  }

  private async sendAcknowledgement(enquiry: Enquiry, mode: "automatic" | "manual") {
    const attemptedAt = new Date();
    if (!isAcknowledgementEmailEligible(enquiry.email)) {
      return this.updateStatus(enquiry.id, {
        acknowledgementStatus: "skipped",
        acknowledgementLastAttemptedAt: attemptedAt,
        acknowledgementSentAt: null,
        acknowledgementLastError: "Missing or invalid email address",
      });
    }

    try {
      const acknowledgementContext = await this.buildAcknowledgementContext(enquiry);
      if (!acknowledgementContext) {
        return this.updateStatus(enquiry.id, {
          acknowledgementStatus: "failed",
          acknowledgementLastAttemptedAt: attemptedAt,
          acknowledgementSentAt: null,
          acknowledgementLastError: "Missing linked case or Client A booking link",
        });
      }

      const sent = await sendEnquiryAcknowledgementEmail({
        to: enquiry.email.trim(),
        firstName: enquiry.firstName,
        caseRef: acknowledgementContext.caseRef,
        bookingUrl: acknowledgementContext.bookingUrl,
        availabilityPreview: acknowledgementContext.availabilityPreview,
      });
      if (sent) {
        return this.updateStatus(enquiry.id, {
          acknowledgementStatus: "sent",
          acknowledgementLastAttemptedAt: attemptedAt,
          acknowledgementSentAt: attemptedAt,
          acknowledgementLastError: null,
        });
      }
      return this.updateStatus(enquiry.id, {
        acknowledgementStatus: "failed",
        acknowledgementLastAttemptedAt: attemptedAt,
        acknowledgementSentAt: null,
        acknowledgementLastError: "Email provider returned failure",
      });
    } catch (err) {
      console.error(`[EnquiryAcknowledgement] ${mode} acknowledgement failed:`, err);
      return this.updateStatus(enquiry.id, {
        acknowledgementStatus: "failed",
        acknowledgementLastAttemptedAt: attemptedAt,
        acknowledgementSentAt: null,
        acknowledgementLastError: err instanceof Error ? err.message : "Email send failed",
      });
    }
  }

  private async buildAcknowledgementContext(enquiry: Enquiry): Promise<{
    caseRef: string;
    bookingUrl: string;
    availabilityPreview: Array<{ displayDate: string; times: string[]; url: string }>;
  } | null> {
    if (!enquiry.convertedCaseId) return null;
    const [linkedCase, parties] = await Promise.all([
      storage.getCase(enquiry.convertedCaseId),
      storage.listPartiesByCase(enquiry.convertedCaseId),
    ]);
    const clientAParty = parties.find((party) => (party.role || "").toUpperCase() === "A") || parties[0];
    if (!linkedCase?.caseRef || !clientAParty?.id) return null;

    const bookingLink = await bookingService.createOrReuseBookingTokenForAcknowledgement(clientAParty.id);
    if (!bookingLink.ok) return null;
    const preview = await bookingService.buildMiamAvailabilityPreviewForAcknowledgement(bookingLink.token);

    return {
      caseRef: linkedCase.caseRef,
      bookingUrl: preview.serviceTypeId
        ? `${bookingLink.fullBookingUrl}?serviceTypeId=${encodeURIComponent(preview.serviceTypeId)}`
        : bookingLink.fullBookingUrl,
      availabilityPreview: preview.rows,
    };
  }

  private async updateStatus(enquiryId: string, values: {
    acknowledgementStatus: EnquiryAcknowledgementStatus;
    acknowledgementLastAttemptedAt: Date;
    acknowledgementSentAt: Date | null;
    acknowledgementLastError: string | null;
  }) {
    const [updated] = await db
      .update(enquiries)
      .set(values)
      .where(eq(enquiries.id, enquiryId))
      .returning();
    return updated;
  }
}

export const enquiryAcknowledgementService = new EnquiryAcknowledgementService();
