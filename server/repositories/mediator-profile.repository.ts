import { db } from "../db";
import {
  mediatorProfiles, type MediatorProfile, type InsertMediatorProfile,
  mediatorCpdEntries, type MediatorCpdEntry, type InsertMediatorCpdEntry,
  mediatorReferences, type MediatorReference, type InsertMediatorReference,
  mediatorTrainings, type MediatorTraining, type InsertMediatorTraining,
  mediatorHolidays, type MediatorHoliday, type InsertMediatorHoliday,
  mediatorComplaints, type MediatorComplaint, type InsertMediatorComplaint,
  mediatorTimebankEntries, type MediatorTimebankEntry, type InsertMediatorTimebankEntry,
  mediatorConsents, type MediatorConsent,
  mediatorBioVersions, type MediatorBioVersion, type InsertMediatorBioVersion,
} from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";

export class MediatorProfileRepository {
  listRoleQualifications(): Promise<Array<Pick<MediatorProfile, "userId" | "mediationRoleQualification">>> {
    return db.select({
      userId: mediatorProfiles.userId,
      mediationRoleQualification: mediatorProfiles.mediationRoleQualification,
    }).from(mediatorProfiles);
  }

  async getProfile(userId: string): Promise<MediatorProfile | undefined> {
    const [row] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, userId));
    return row;
  }

  async upsertProfile(userId: string, data: Partial<Omit<InsertMediatorProfile, "userId">>): Promise<MediatorProfile> {
    const existing = await this.getProfile(userId);
    if (!existing) {
      const [row] = await db.insert(mediatorProfiles).values({ userId, ...data, updatedAt: new Date() }).returning();
      return row;
    }
    await db.update(mediatorProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mediatorProfiles.userId, userId));
    return (await this.getProfile(userId))!;
  }

  // CPD
  listCpd(mediatorId: string): Promise<MediatorCpdEntry[]> {
    return db.select().from(mediatorCpdEntries).where(eq(mediatorCpdEntries.mediatorId, mediatorId)).orderBy(desc(mediatorCpdEntries.date));
  }
  async createCpd(data: InsertMediatorCpdEntry): Promise<MediatorCpdEntry> {
    const [row] = await db.insert(mediatorCpdEntries).values(data).returning();
    return row;
  }
  async deleteCpd(id: string, mediatorId: string): Promise<void> {
    const result = await db.delete(mediatorCpdEntries)
      .where(and(eq(mediatorCpdEntries.id, id), eq(mediatorCpdEntries.mediatorId, mediatorId))).returning();
    if (result.length === 0) throw new Error("not_found_or_wrong_mediator");
  }

  // References
  listReferences(mediatorId: string): Promise<MediatorReference[]> {
    return db.select().from(mediatorReferences).where(eq(mediatorReferences.mediatorId, mediatorId)).orderBy(desc(mediatorReferences.createdAt));
  }
  async createReference(data: InsertMediatorReference): Promise<MediatorReference> {
    const [row] = await db.insert(mediatorReferences).values(data).returning();
    return row;
  }
  async updateReference(id: string, mediatorId: string, data: Partial<MediatorReference>): Promise<MediatorReference | undefined> {
    const result = await db.update(mediatorReferences).set(data)
      .where(and(eq(mediatorReferences.id, id), eq(mediatorReferences.mediatorId, mediatorId))).returning();
    return result[0];
  }
  async deleteReference(id: string, mediatorId: string): Promise<void> {
    const result = await db.delete(mediatorReferences)
      .where(and(eq(mediatorReferences.id, id), eq(mediatorReferences.mediatorId, mediatorId))).returning();
    if (result.length === 0) throw new Error("not_found_or_wrong_mediator");
  }

  // Trainings
  listTrainings(mediatorId: string): Promise<MediatorTraining[]> {
    return db.select().from(mediatorTrainings).where(eq(mediatorTrainings.mediatorId, mediatorId)).orderBy(desc(mediatorTrainings.date));
  }
  async createTraining(data: InsertMediatorTraining): Promise<MediatorTraining> {
    const [row] = await db.insert(mediatorTrainings).values(data).returning();
    return row;
  }
  async deleteTraining(id: string, mediatorId: string): Promise<void> {
    const result = await db.delete(mediatorTrainings)
      .where(and(eq(mediatorTrainings.id, id), eq(mediatorTrainings.mediatorId, mediatorId))).returning();
    if (result.length === 0) throw new Error("not_found_or_wrong_mediator");
  }

  // Holidays
  listHolidays(mediatorId: string): Promise<MediatorHoliday[]> {
    return db.select().from(mediatorHolidays).where(eq(mediatorHolidays.mediatorId, mediatorId)).orderBy(desc(mediatorHolidays.startDate));
  }
  async createHoliday(data: InsertMediatorHoliday): Promise<MediatorHoliday> {
    const [row] = await db.insert(mediatorHolidays).values(data).returning();
    return row;
  }
  async deleteHoliday(id: string, mediatorId: string): Promise<void> {
    const result = await db.delete(mediatorHolidays)
      .where(and(eq(mediatorHolidays.id, id), eq(mediatorHolidays.mediatorId, mediatorId))).returning();
    if (result.length === 0) throw new Error("not_found_or_wrong_mediator");
  }

  // Complaints
  listComplaints(mediatorId: string): Promise<MediatorComplaint[]> {
    return db.select().from(mediatorComplaints).where(eq(mediatorComplaints.mediatorId, mediatorId)).orderBy(desc(mediatorComplaints.date));
  }
  async createComplaint(data: InsertMediatorComplaint): Promise<MediatorComplaint> {
    const [row] = await db.insert(mediatorComplaints).values(data).returning();
    return row;
  }
  async deleteComplaint(id: string, mediatorId: string): Promise<void> {
    const result = await db.delete(mediatorComplaints)
      .where(and(eq(mediatorComplaints.id, id), eq(mediatorComplaints.mediatorId, mediatorId))).returning();
    if (result.length === 0) throw new Error("not_found_or_wrong_mediator");
  }

  // Time-bank ledger
  listTimebank(mediatorId: string): Promise<MediatorTimebankEntry[]> {
    return db.select().from(mediatorTimebankEntries).where(eq(mediatorTimebankEntries.mediatorId, mediatorId)).orderBy(desc(mediatorTimebankEntries.date));
  }
  async createTimebank(data: InsertMediatorTimebankEntry): Promise<MediatorTimebankEntry> {
    const [row] = await db.insert(mediatorTimebankEntries).values(data).returning();
    return row;
  }
  async deleteTimebank(id: string, mediatorId: string): Promise<void> {
    const result = await db.delete(mediatorTimebankEntries)
      .where(and(eq(mediatorTimebankEntries.id, id), eq(mediatorTimebankEntries.mediatorId, mediatorId))).returning();
    if (result.length === 0) throw new Error("not_found_or_wrong_mediator");
  }

  // Consents (idempotent upsert by mediator + type)
  listConsents(mediatorId: string): Promise<MediatorConsent[]> {
    return db.select().from(mediatorConsents).where(eq(mediatorConsents.mediatorId, mediatorId));
  }
  async upsertConsent(mediatorId: string, consentType: string, granted: boolean): Promise<MediatorConsent> {
    const existing = await db.select().from(mediatorConsents)
      .where(and(eq(mediatorConsents.mediatorId, mediatorId), eq(mediatorConsents.consentType, consentType)));
    const now = new Date();
    if (existing.length === 0) {
      const [row] = await db.insert(mediatorConsents).values({
        mediatorId, consentType, granted,
        grantedAt: granted ? now : null,
        withdrawnAt: granted ? null : now,
      }).returning();
      return row;
    }
    await db.update(mediatorConsents)
      .set({
        granted,
        grantedAt: granted ? (existing[0].grantedAt ?? now) : existing[0].grantedAt,
        withdrawnAt: granted ? null : now,
      })
      .where(and(eq(mediatorConsents.mediatorId, mediatorId), eq(mediatorConsents.consentType, consentType)));
    const [row] = await db.select().from(mediatorConsents)
      .where(and(eq(mediatorConsents.mediatorId, mediatorId), eq(mediatorConsents.consentType, consentType)));
    return row;
  }

  // Bio versions
  listBioVersions(mediatorId: string): Promise<MediatorBioVersion[]> {
    return db.select().from(mediatorBioVersions).where(eq(mediatorBioVersions.mediatorId, mediatorId)).orderBy(desc(mediatorBioVersions.createdAt));
  }
  async getBioVersion(id: string): Promise<MediatorBioVersion | undefined> {
    const [row] = await db.select().from(mediatorBioVersions).where(eq(mediatorBioVersions.id, id));
    return row;
  }
  async createBioVersion(data: InsertMediatorBioVersion): Promise<MediatorBioVersion> {
    const [row] = await db.insert(mediatorBioVersions).values(data).returning();
    return row;
  }
  async updateBioVersion(id: string, data: Partial<MediatorBioVersion>): Promise<MediatorBioVersion | undefined> {
    await db.update(mediatorBioVersions).set(data).where(eq(mediatorBioVersions.id, id));
    return this.getBioVersion(id);
  }
}

export const mediatorProfileRepository = new MediatorProfileRepository();
