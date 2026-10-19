import { db } from "../db";
import { mediatorApplicants, type MediatorApplicant, type InsertMediatorApplicant } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export class MediatorApplicantRepository {
  list(): Promise<MediatorApplicant[]> {
    return db.select().from(mediatorApplicants).orderBy(desc(mediatorApplicants.createdAt));
  }
  async getById(id: string): Promise<MediatorApplicant | undefined> {
    const [row] = await db.select().from(mediatorApplicants).where(eq(mediatorApplicants.id, id));
    return row;
  }
  async findByEmail(email: string): Promise<MediatorApplicant | undefined> {
    const [row] = await db.select().from(mediatorApplicants).where(eq(mediatorApplicants.email, email));
    return row;
  }
  async create(data: InsertMediatorApplicant): Promise<MediatorApplicant> {
    const [row] = await db.insert(mediatorApplicants).values(data).returning();
    return row;
  }
  async update(id: string, data: Partial<Omit<MediatorApplicant, "id" | "createdAt">>): Promise<MediatorApplicant | undefined> {
    const [row] = await db.update(mediatorApplicants)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mediatorApplicants.id, id))
      .returning();
    return row;
  }
  async delete(id: string): Promise<boolean> {
    const r = await db.delete(mediatorApplicants).where(eq(mediatorApplicants.id, id)).returning();
    return r.length > 0;
  }
}

export const mediatorApplicantRepository = new MediatorApplicantRepository();
