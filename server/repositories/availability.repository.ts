import { db } from "../db";
import { mediatorAvailability, type MediatorAvailability, type InsertMediatorAvailability } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export class AvailabilityRepository {
  async listByMediator(mediatorId: string): Promise<MediatorAvailability[]> {
    return db.select().from(mediatorAvailability).where(eq(mediatorAvailability.mediatorId, mediatorId));
  }

  async create(data: InsertMediatorAvailability): Promise<MediatorAvailability> {
    const [slot] = await db.insert(mediatorAvailability).values(data).returning();
    return slot;
  }

  async update(id: string, data: Partial<Omit<MediatorAvailability, "id">>): Promise<MediatorAvailability | undefined> {
    const [updated] = await db.update(mediatorAvailability).set(data).where(eq(mediatorAvailability.id, id)).returning();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(mediatorAvailability).where(eq(mediatorAvailability.id, id)).returning();
    return result.length > 0;
  }

  async deleteByMediator(mediatorId: string): Promise<void> {
    await db.delete(mediatorAvailability).where(eq(mediatorAvailability.mediatorId, mediatorId));
  }

  async bulkReplace(mediatorId: string, slots: Omit<InsertMediatorAvailability, "mediatorId">[]): Promise<MediatorAvailability[]> {
    await this.deleteByMediator(mediatorId);
    if (slots.length === 0) return [];
    const values = slots.map(s => ({ ...s, mediatorId }));
    return db.insert(mediatorAvailability).values(values).returning();
  }

  async listActive(): Promise<MediatorAvailability[]> {
    return db.select().from(mediatorAvailability).where(eq(mediatorAvailability.isActive, true));
  }

  async listActiveByMediator(mediatorId: string): Promise<MediatorAvailability[]> {
    return db.select().from(mediatorAvailability).where(
      and(eq(mediatorAvailability.mediatorId, mediatorId), eq(mediatorAvailability.isActive, true))
    );
  }
}
