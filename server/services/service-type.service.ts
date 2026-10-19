import { ServiceTypeRepository } from "../repositories/service-type.repository";
import type { InsertServiceType, MediatorServiceAssignmentInput, ServiceType } from "@shared/schema";

const repo = new ServiceTypeRepository();

export class ServiceTypeService {
  async list() {
    return repo.list();
  }

  async getById(id: string) {
    return repo.getById(id);
  }

  async create(data: InsertServiceType) {
    return repo.create(data);
  }

  async update(id: string, data: Partial<Omit<ServiceType, "id" | "createdAt">>) {
    return repo.update(id, data);
  }

  async deleteIfUnlinked(id: string) {
    return repo.deleteIfUnlinked(id);
  }

  async getMediatorServices(mediatorId: string) {
    return repo.listMediatorServices(mediatorId);
  }

  async setMediatorServices(mediatorId: string, services: MediatorServiceAssignmentInput[]) {
    return repo.setMediatorServices(mediatorId, services);
  }

  async listAllMediatorServices() {
    return repo.listAllMediatorServices();
  }
}

export const serviceTypeService = new ServiceTypeService();
