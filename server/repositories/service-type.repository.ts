import { db } from "../db";
import { serviceTypes, serviceTypeDeletions, mediatorServiceTypes, mediatorServiceScheduleSlots, mediatorServiceApprovals, appointments, caseInvoices, caseInvoiceLineItems, type InsertServiceType, type ServiceType, type MediatorServiceType, type MediatorServiceAssignmentInput } from "@shared/schema";
import { eq, asc, count } from "drizzle-orm";

export type ServiceTypeDeletionResult =
  | { deleted: true; service: ServiceType }
  | { deleted: false; dependencies: string[] };

export class ServiceTypeRepository {
  async list(): Promise<ServiceType[]> {
    return db.select().from(serviceTypes).orderBy(asc(serviceTypes.sortOrder), asc(serviceTypes.name));
  }

  async getById(id: string): Promise<ServiceType | undefined> {
    const [row] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, id));
    return row;
  }

  async create(data: InsertServiceType): Promise<ServiceType> {
    return db.transaction(async (tx) => {
      await tx.delete(serviceTypeDeletions).where(eq(serviceTypeDeletions.name, data.name));
      const [row] = await tx.insert(serviceTypes).values(data).returning();
      return row;
    });
  }

  async update(id: string, data: Partial<Omit<ServiceType, "id" | "createdAt">>): Promise<ServiceType | undefined> {
    const [row] = await db.update(serviceTypes).set(data).where(eq(serviceTypes.id, id)).returning();
    return row;
  }

  async deleteIfUnlinked(id: string): Promise<ServiceTypeDeletionResult | undefined> {
    return db.transaction(async (tx) => {
      const [service] = await tx.select().from(serviceTypes).where(eq(serviceTypes.id, id)).for("update");
      if (!service) return undefined;

      const dependencyCounts = await Promise.all([
        tx.select({ value: count() }).from(mediatorServiceTypes).where(eq(mediatorServiceTypes.serviceTypeId, id)),
        tx.select({ value: count() }).from(mediatorServiceApprovals).where(eq(mediatorServiceApprovals.serviceTypeId, id)),
        tx.select({ value: count() }).from(mediatorServiceScheduleSlots).where(eq(mediatorServiceScheduleSlots.serviceTypeId, id)),
        tx.select({ value: count() }).from(appointments).where(eq(appointments.serviceTypeId, id)),
        tx.select({ value: count() }).from(caseInvoices).where(eq(caseInvoices.serviceTypeId, id)),
        tx.select({ value: count() }).from(caseInvoiceLineItems).where(eq(caseInvoiceLineItems.serviceTypeId, id)),
      ]);
      const labels = ["mediator service assignments", "mediator service approvals", "mediator schedule slots", "appointments", "invoices", "invoice line items"];
      const dependencies = dependencyCounts.flatMap(([row], index) => Number(row.value) > 0 ? [labels[index]] : []);
      if (dependencies.length > 0) return { deleted: false, dependencies };

      await tx.delete(serviceTypes).where(eq(serviceTypes.id, id));
      await tx.insert(serviceTypeDeletions).values({ name: service.baselineServiceName ?? service.name }).onConflictDoNothing();
      return { deleted: true, service };
    });
  }

  async listMediatorServices(mediatorId: string): Promise<MediatorServiceType[]> {
    return db.select().from(mediatorServiceTypes).where(eq(mediatorServiceTypes.mediatorId, mediatorId));
  }

  async setMediatorServices(mediatorId: string, services: MediatorServiceAssignmentInput[]): Promise<void> {
    await db.delete(mediatorServiceTypes).where(eq(mediatorServiceTypes.mediatorId, mediatorId));
    if (services.length > 0) {
      await db.insert(mediatorServiceTypes).values(
        services.map((service) => ({
          mediatorId,
          serviceTypeId: service.serviceTypeId,
          mediationRoleQualification: service.mediationRoleQualification,
        }))
      );
    }
  }

  async listAllMediatorServices(): Promise<MediatorServiceType[]> {
    return db.select().from(mediatorServiceTypes);
  }
}
