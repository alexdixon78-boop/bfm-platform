import { storage } from "../storage";
import {
  insertEnquirySchema,
  updateEnquirySchema,
  type InsertEnquiry,
  type Enquiry,
  type UpdateEnquiryData,
  type PaginationParams,
  type Case,
  type Client,
  type Notification,
  enquiries,
  cases,
  clients,
  users,
  parties,
  notifications,
} from "@shared/schema";
import { hashPassword } from "../utils/helpers";
import type { ServiceResult } from "./types";
import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { caseActivityService, systemActor } from "./case-activity.service";
import { enquiryDuplicateService } from "./enquiry-duplicate.service";
import { enquiryAcknowledgementService } from "./enquiry-acknowledgement.service";
import crypto from "crypto";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ConversionBundle = {
  enquiry: Enquiry;
  newCase: Case;
  followUpTask?: Notification;
  returningClientReviewTask?: Notification;
};

type EnquiryCreateOptions = {
  deferPostCreateSideEffects?: boolean;
};

export class EnquiryService {
  async list(params: PaginationParams) {
    const result = await storage.listEnquiries(params);
    const counts = await enquiryDuplicateService.countPendingByEnquiryIds(result.data.map((enquiry) => enquiry.id));
    return {
      ...result,
      data: result.data.map((enquiry) => ({
        ...enquiry,
        pendingDuplicateCount: counts.get(enquiry.id) || 0,
      })),
    };
  }

  async get(id: string) {
    return storage.getEnquiry(id);
  }

  async create(body: unknown, options: EnquiryCreateOptions = {}): Promise<ServiceResult<{ enquiry: Enquiry; newCase: Case }>> {
    const result = insertEnquirySchema.safeParse(body);
    if (!result.success) {
      return { ok: false, error: "Invalid enquiry data", status: 400 };
    }

    let bundle: ConversionBundle;
    try {
      bundle = await this.withUniqueRefRetry(() =>
        db.transaction((tx) => this.createEnquiryCaseBundle(tx, result.data)),
      );
    } catch (err) {
      console.error("[EnquiryService] Atomic enquiry creation failed:", err);
      return { ok: false, error: "Could not create enquiry", status: 500 };
    }
    const { enquiry, newCase, followUpTask } = bundle;

    this.logCreatedTask(newCase.id, followUpTask, "auto follow-up on enquiry");
    this.logCreatedTask(newCase.id, bundle.returningClientReviewTask, "returning client matching");

    await this.logPostConversionActivity(enquiry, newCase);

    let updatedEnquiry: any = await storage.getEnquiry(enquiry.id);
    if (options.deferPostCreateSideEffects) {
      this.runPostCreateSideEffects(updatedEnquiry || enquiry, newCase.id).catch((err) => {
        console.error("[EnquiryService] Deferred post-create work failed after enquiry creation:", err);
      });
      return { ok: true, enquiry: updatedEnquiry || enquiry, newCase };
    }
    updatedEnquiry = await this.runPostCreateSideEffects(updatedEnquiry || enquiry, newCase.id);

    return { ok: true, enquiry: updatedEnquiry || enquiry, newCase };
  }

  async update(id: string, body: unknown): Promise<ServiceResult<{ enquiry: any }>> {
    const existing = await storage.getEnquiry(id);
    if (!existing) return { ok: false, error: "Enquiry not found", status: 404 };

    const result = updateEnquirySchema.safeParse(body);
    if (!result.success) {
      return { ok: false, error: "Invalid update data", status: 400 };
    }

    const updateData: UpdateEnquiryData = { ...result.data };
    if (existing.convertedCaseId) {
      delete updateData.status;
    }
    if (updateData.consentFollowUp === true && !existing.consentFollowUp) {
      updateData.consentFollowUpDate = new Date();
    }
    if (updateData.consentFollowUp === false) {
      updateData.consentFollowUpDate = null;
    }

    const enquiry = await storage.updateEnquiry(id, updateData);
    if (!enquiry) return { ok: false, error: "Enquiry not found", status: 404 };
    if (typeof updateData.shuttleMediation === "boolean" && existing.convertedCaseId) {
      await storage.updateCaseShuttle(existing.convertedCaseId, updateData.shuttleMediation);
    }
    return { ok: true, enquiry };
  }

  async convertToCase(id: string): Promise<ServiceResult<{ newCase: any }>> {
    const existing = await storage.getEnquiry(id);
    if (!existing) return { ok: false, error: "Enquiry not found", status: 404 };
    if (existing.convertedCaseId) return { ok: false, error: "Already converted", status: 400 };

    let bundle: ConversionBundle;
    try {
      bundle = await this.withUniqueRefRetry(() =>
        db.transaction(async (tx) => {
          const enquiry = await this.getEnquiryForConversionTx(tx, id);
          if (!enquiry) throw new Error("Enquiry not found");
          if (enquiry.convertedCaseId) throw new Error("Already converted");
          return this.convertEnquiryToCaseTx(tx, enquiry);
        }),
      );
    } catch (err) {
      console.error("[EnquiryService] Atomic enquiry conversion failed:", err);
      return { ok: false, error: "Could not convert enquiry", status: 500 };
    }

    this.logCreatedTask(bundle.newCase.id, bundle.followUpTask, "auto follow-up on enquiry");
    this.logCreatedTask(bundle.newCase.id, bundle.returningClientReviewTask, "returning client matching");
    await this.logPostConversionActivity(bundle.enquiry, bundle.newCase);
    return { ok: true, newCase: bundle.newCase };
  }

  private async createEnquiryCaseBundle(tx: DbTransaction, data: InsertEnquiry): Promise<ConversionBundle> {
    const enquiryRef = await this.getNextEnquiryRefTx(tx);
    const [enquiry] = await tx.insert(enquiries).values({
      ...data,
      enquiryRef,
      privacyConsentStatus: data.privacyConsent ? "granted" : "pending",
      privacyConsentDecidedAt: data.privacyConsent ? new Date() : undefined,
      consentFollowUpDate: data.consentFollowUp ? new Date() : undefined,
    }).returning();
    return this.convertEnquiryToCaseTx(tx, enquiry);
  }

  private async runPostCreateSideEffects(enquiry: Enquiry, caseId: string): Promise<Enquiry> {
    let updatedEnquiry: any = enquiry;
    const duplicateDetectionStartedAt = Date.now();
    try {
      await enquiryDuplicateService.detectForNewEnquiry(updatedEnquiry || enquiry, caseId);
    } catch (err) {
      console.error("[EnquiryService] Duplicate detection failed after enquiry creation:", err);
    } finally {
      console.info(`[EnquiryService] Duplicate detection completed for ${enquiry.enquiryRef} in ${Date.now() - duplicateDetectionStartedAt}ms`);
    }

    const acknowledgementStartedAt = Date.now();
    try {
      updatedEnquiry = await enquiryAcknowledgementService.sendAutomaticAcknowledgement(updatedEnquiry || enquiry) || updatedEnquiry;
    } catch (err) {
      console.error("[EnquiryService] Acknowledgement email attempt failed:", err);
    } finally {
      console.info(`[EnquiryService] Acknowledgement attempt completed for ${enquiry.enquiryRef} in ${Date.now() - acknowledgementStartedAt}ms`);
    }
    return updatedEnquiry || enquiry;
  }

  private async convertEnquiryToCaseTx(tx: DbTransaction, enquiry: Enquiry): Promise<ConversionBundle> {
    const caseRef = await this.getNextCaseRefTx(tx);
    const enquiryReceivedAt = enquiry.dateReceived ? new Date(enquiry.dateReceived) : new Date();
    const firstContactDueAt = new Date(enquiryReceivedAt.getTime() + 24 * 60 * 60 * 1000);
    const [newCase] = await tx.insert(cases).values({
      caseRef,
      stage: "Enquiry",
      status: "Active",
      issueType: enquiry.issueType,
      leadSource: enquiry.leadSource || undefined,
      shuttleMediation: enquiry.shuttleMediation || false,
      enquiryDate: enquiryReceivedAt,
      intakeStatus: "New",
      safeguardingStatus: "pending",
      firstContactDueAt,
    }).returning();

    const normalizedEmail = enquiry.email ? enquiry.email.trim().toLowerCase() : null;
    let userId: string | undefined;

    if (normalizedEmail) {
      const existingUser = await this.findUserByEmailTx(tx, normalizedEmail);
      if (existingUser && existingUser.role === "client") {
        userId = existingUser.id;
      } else if (!existingUser) {
        const placeholderPassword = hashPassword(crypto.randomUUID());
        const [clientUser] = await tx.insert(users).values({
          email: normalizedEmail,
          password: placeholderPassword,
          name: `${enquiry.firstName} ${enquiry.lastName}`,
          role: "client",
          status: "inactive",
        }).returning();
        userId = clientUser.id;
      }
    }

    const matchInput = {
      firstName: enquiry.firstName.trim(),
      lastName: enquiry.lastName.trim(),
      email: normalizedEmail,
      phone: enquiry.mobileTelephone || null,
      dateOfBirth: enquiry.dateOfBirth || null,
    };

    let client: Client | undefined = await this.findStrongClientMatchForEnquiryTx(tx, matchInput);
    const strongClientMatch = !!client;
    if (!client && normalizedEmail) {
      const emailMatchedClient = await this.findClientByEmailTx(tx, normalizedEmail);
      if (emailMatchedClient) {
        client = emailMatchedClient;
      }
    }
    if (!client && matchInput.dateOfBirth) {
      client = await this.findClientByNameDobTx(tx, matchInput.firstName, matchInput.lastName, matchInput.dateOfBirth);
    }
    const potentialMatches = strongClientMatch ? [] : await this.findPotentialClientMatchesTx(tx, matchInput);
    let returningClientReviewTask: Notification | undefined;

    if (!client) {
      const [createdClient] = await tx.insert(clients).values({
        firstName: enquiry.firstName.trim(),
        lastName: enquiry.lastName.trim(),
        email: normalizedEmail,
        phone: enquiry.mobileTelephone || null,
        phoneCode: enquiry.phoneCode || "+44",
        dateOfBirth: enquiry.dateOfBirth || null,
        addressLine1: enquiry.addressLine1 || null,
        addressLine2: enquiry.addressLine2 || null,
        postcode: enquiry.postcode || null,
        userId: userId || null,
      }).returning();
      client = createdClient;
    } else if (userId && !client.userId) {
      const [updatedClient] = await tx.update(clients).set({ userId }).where(eq(clients.id, client.id)).returning();
      client = updatedClient || client;
    }

    if (!client || potentialMatches.length > 0) {
      returningClientReviewTask = await this.createReturningClientMatchReviewTx(tx, newCase.id, enquiry, potentialMatches.map((c) => c.id));
    }

    await tx.insert(parties).values({
      caseId: newCase.id,
      clientId: client.id,
      role: "A",
      portalStatus: "inactive",
    });

    const [updatedEnquiry] = await tx.update(enquiries)
      .set({ status: "New", convertedCaseId: newCase.id })
      .where(eq(enquiries.id, enquiry.id))
      .returning();

    const [followUpTask] = await tx.insert(notifications).values({
      recipientRole: "admin",
      type: "enquiry_follow_up",
      urgency: "red",
      caseId: newCase.id,
      title: `First contact required — ${enquiry.enquiryRef}`,
      message: `New enquiry received from ${enquiry.firstName} ${enquiry.lastName}. Please follow up with a phone call within 24 hours.`,
      status: "active",
      followUpDate: firstContactDueAt,
      caseNoteRequired: false,
    }).returning();

    return { enquiry: updatedEnquiry || enquiry, newCase, followUpTask, returningClientReviewTask };
  }

  private async getEnquiryForConversionTx(tx: DbTransaction, id: string): Promise<Enquiry | undefined> {
    const [row] = await tx.select().from(enquiries).where(eq(enquiries.id, id));
    return row;
  }

  private async getNextEnquiryRefTx(tx: DbTransaction): Promise<string> {
    const year = new Date().getFullYear().toString();
    const prefix = `ENQ-${year}-`;
    const result = await tx
      .select({ enquiryRef: enquiries.enquiryRef })
      .from(enquiries)
      .where(sql`${enquiries.enquiryRef} LIKE ${prefix + "%"}`)
      .orderBy(sql`${enquiries.enquiryRef} DESC`)
      .limit(1);

    const lastRef = result[0]?.enquiryRef;
    const lastNum = parseInt(lastRef?.split("-").pop() || "0", 10);
    const nextNum = Number.isNaN(lastNum) ? 1 : lastNum + 1;
    return `ENQ-${year}-${nextNum.toString().padStart(4, "0")}`;
  }

  private async getNextCaseRefTx(tx: DbTransaction): Promise<string> {
    const year = new Date().getFullYear().toString();
    const prefix = `BFM-${year}-`;
    const result = await tx
      .select({ caseRef: cases.caseRef })
      .from(cases)
      .where(sql`${cases.caseRef} LIKE ${prefix + "%"}`)
      .orderBy(sql`${cases.caseRef} DESC`)
      .limit(1);

    const lastRef = result[0]?.caseRef;
    const lastNum = parseInt(lastRef?.split("-").pop() || "0", 10);
    const nextNum = Number.isNaN(lastNum) ? 1 : lastNum + 1;
    return `BFM-${year}-${nextNum.toString().padStart(4, "0")}`;
  }

  private async findUserByEmailTx(tx: DbTransaction, email: string) {
    const [row] = await tx.select().from(users).where(eq(users.email, email));
    return row;
  }

  private async findClientByEmailTx(tx: DbTransaction, email: string): Promise<Client | undefined> {
    const [row] = await tx.select().from(clients).where(sql`lower(${clients.email}) = lower(${email})`);
    return row;
  }

  private async findClientByNameDobTx(tx: DbTransaction, firstName: string, lastName: string, dateOfBirth: string): Promise<Client | undefined> {
    const [row] = await tx.select().from(clients).where(and(
      sql`lower(${clients.firstName}) = lower(${firstName})`,
      sql`lower(${clients.lastName}) = lower(${lastName})`,
      eq(clients.dateOfBirth, dateOfBirth),
    ));
    return row;
  }

  private normalizePhone(value: string | null | undefined): string {
    return (value || "").replace(/\D/g, "").replace(/^44/, "0");
  }

  private async findStrongClientMatchForEnquiryTx(tx: DbTransaction, data: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: string | null;
  }): Promise<Client | undefined> {
    if (!data.email || !data.phone || !data.dateOfBirth) return undefined;
    const normalizedPhone = this.normalizePhone(data.phone);
    const rows = await tx.select().from(clients).where(and(
      sql`lower(${clients.firstName}) = lower(${data.firstName})`,
      sql`lower(${clients.lastName}) = lower(${data.lastName})`,
      sql`lower(${clients.email}) = lower(${data.email})`,
      eq(clients.dateOfBirth, data.dateOfBirth),
    ));
    return rows.find((row) => this.normalizePhone(row.phone) === normalizedPhone);
  }

  private async findPotentialClientMatchesTx(tx: DbTransaction, data: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: string | null;
  }): Promise<Client[]> {
    const normalizedPhone = this.normalizePhone(data.phone);
    const rows = await tx.select().from(clients).where(
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

  private async createReturningClientMatchReviewTx(tx: DbTransaction, caseId: string, enquiry: Enquiry, possibleClientIds: string[]): Promise<Notification | undefined> {
    if (possibleClientIds.length === 0) return undefined;
    const [task] = await tx.insert(notifications).values({
      recipientId: null,
      recipientRole: "admin",
      type: "returning_client_match_review",
      urgency: "amber",
      caseId,
      appointmentId: null,
      title: `Review possible returning client — ${enquiry.firstName} ${enquiry.lastName}`,
      message: `Possible existing client record(s) found, but name/email/phone/DOB did not form a strong match. Review before relying on reused details. Candidate IDs: ${possibleClientIds.join(", ")}`,
      status: "active",
      followUpDate: new Date(),
      caseNoteRequired: true,
    }).returning();
    return task;
  }

  private logCreatedTask(caseId: string, task: Notification | undefined, channel: string): void {
    if (!task) return;
    caseActivityService.logTaskCreated(
      caseId,
      task.title,
      task.urgency,
      systemActor(channel),
    ).catch((err: unknown) => {
      console.error("[EnquiryService] Failed to log task activity:", err);
    });
  }

  private async logPostConversionActivity(enquiry: Enquiry, newCase: Case): Promise<void> {
    const clientName = `${enquiry.firstName} ${enquiry.lastName}`.trim() || "Unknown";
    await caseActivityService.logEnquiryCreated(newCase.id, enquiry.enquiryRef, clientName, systemActor("enquiry intake"));
    await caseActivityService.logCaseCreated(newCase.id, newCase.caseRef, enquiry.enquiryRef, systemActor("case shell creation"));

    try {
      const { caseService } = await import("./case.service");
      await caseService.refreshCaseFilterCache(newCase.id);
    } catch (err) {
      console.error("[enquiry.convertToCase] refreshCaseFilterCache failed:", err);
    }
  }

  private async withUniqueRefRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await operation();
      } catch (err: unknown) {
        if (attempt === 2 || !this.isUniqueViolation(err)) throw err;
      }
    }
    throw new Error("Unable to allocate unique enquiry/case reference");
  }

  private isUniqueViolation(err: unknown): boolean {
    const maybePgError = err as { code?: unknown; message?: unknown };
    return maybePgError.code === "23505"
      || (typeof maybePgError.message === "string" && maybePgError.message.includes("unique"));
  }

  async findStrongClientMatchForEnquiry(data: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: string | null;
  }) {
    const strong = await storage.findStrongClientMatch(data);
    if (strong) return strong;
    if (data.email) {
      const emailMatch = await storage.findClientByEmail(data.email);
      if (emailMatch?.dateOfBirth && data.dateOfBirth && emailMatch.dateOfBirth === data.dateOfBirth) return emailMatch;
    }
    return undefined;
  }

  async archive(id: string): Promise<ServiceResult<{ enquiry: Enquiry }>> {
    const existing = await storage.getEnquiry(id);
    if (!existing) return { ok: false, error: "Enquiry not found", status: 404 };
    if (existing.status === "Archived") {
      return { ok: false, error: "Enquiry is already archived", status: 400 };
    }
    const enquiry = await storage.updateEnquiryStatus(id, "Archived");
    if (!enquiry) return { ok: false, error: "Enquiry not found", status: 404 };
    return { ok: true, enquiry };
  }

  async restore(id: string): Promise<ServiceResult<{ enquiry: Enquiry }>> {
    const existing = await storage.getEnquiry(id);
    if (!existing) return { ok: false, error: "Enquiry not found", status: 404 };
    if (existing.status !== "Archived") {
      return { ok: false, error: "Enquiry is not archived", status: 400 };
    }
    const linkedCase = existing.convertedCaseId ? await storage.getCase(existing.convertedCaseId) : undefined;
    const restoredStatus = linkedCase?.intakeStatus || "New";
    const enquiry = await storage.updateEnquiryStatus(id, restoredStatus);
    if (!enquiry) return { ok: false, error: "Enquiry not found", status: 404 };
    return { ok: true, enquiry };
  }

  async hardDelete(id: string): Promise<ServiceResult<{ enquiryRef: string }>> {
    const existing = await storage.getEnquiry(id);
    if (!existing) return { ok: false, error: "Enquiry not found", status: 404 };
    if (existing.convertedCaseId) {
      const linkedCase = await storage.getCase(existing.convertedCaseId);
      const refLabel = linkedCase?.caseRef ?? existing.convertedCaseId;
      return {
        ok: false,
        error: `Cannot permanently delete this enquiry — it is linked to case ${refLabel}. Archive it or delete the case first.`,
        status: 409,
      };
    }
    const ok = await storage.hardDeleteEnquiry(id);
    if (!ok) {
      const reloaded = await storage.getEnquiry(id);
      const linkedRef = reloaded?.convertedCaseId
        ? (await storage.getCase(reloaded.convertedCaseId))?.caseRef ?? reloaded.convertedCaseId
        : null;
      return {
        ok: false,
        error: linkedRef
          ? `Cannot permanently delete this enquiry — it was just linked to case ${linkedRef}. Refresh and try again.`
          : "Cannot permanently delete this enquiry — it may have just been linked to a case. Refresh and try again.",
        status: 409,
      };
    }
    return { ok: true, enquiryRef: existing.enquiryRef };
  }
}

export const enquiryService = new EnquiryService();
