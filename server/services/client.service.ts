import { storage } from "../storage";
import { hashPassword } from "../utils/helpers";
import type { ServiceResult } from "./types";
import type {
  Client,
  PaginationParams,
  PaginatedResponse,
} from "@shared/schema";
import crypto from "crypto";

interface RelatedCase {
  partyId: string;
  caseId: string;
  caseRef: string;
  caseStatus: string;
  role: string;
  portalStatus: string;
  mediatorName: string;
}

export interface ClientRecord {
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
  cases: RelatedCase[];
}

export type ClientDetailRecord = ClientRecord;

export class ClientService {
  async listClients(
    params: PaginationParams,
  ): Promise<PaginatedResponse<ClientRecord>> {
    const { rows, total, counts } = await storage.listClientsPaginated(params);

    const clientIds = rows.map((r) => r.id);
    const caseLinks = await storage.getCaseLinksForClients(clientIds);

    const casesByClient = new Map<string, RelatedCase[]>();
    for (const link of caseLinks) {
      const arr = casesByClient.get(link.clientId) ?? [];
      arr.push({
        partyId: link.partyId,
        caseId: link.caseId,
        caseRef: link.caseRef,
        caseStatus: link.caseStatus,
        role: link.role,
        portalStatus: link.portalStatus,
        mediatorName: link.mediatorName,
      });
      casesByClient.set(link.clientId, arr);
    }

    const data: ClientRecord[] = rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      phoneCode: row.phoneCode,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      ethnicOrigin: row.ethnicOrigin,
      nationalInsuranceNumber: row.nationalInsuranceNumber,
      disabilityOrHealthCondition: row.disabilityOrHealthCondition,
      additionalNeeds: row.additionalNeeds,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      postcode: row.postcode,
      country: row.country,
      userId: row.userId,
      portalStatus: row.portalStatus,
      cases: casesByClient.get(row.id) ?? [],
    }));

    const { page, limit } = params;
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      counts,
    };
  }

  async getClientDetail(id: string): Promise<ClientDetailRecord | null> {
    const client = await storage.getClient(id);
    if (!client) return null;

    const caseLinks = await storage.getCaseLinksForClients([id]);
    const portalStatus = caseLinks.some(
      (link) => link.portalStatus === "active",
    )
      ? "active"
      : caseLinks.some((link) => link.portalStatus === "invited")
        ? "invited"
        : "inactive";

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      phoneCode: client.phoneCode,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      ethnicOrigin: client.ethnicOrigin,
      nationalInsuranceNumber: client.nationalInsuranceNumber,
      disabilityOrHealthCondition: client.disabilityOrHealthCondition,
      additionalNeeds: client.additionalNeeds,
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      city: client.city,
      postcode: client.postcode,
      country: client.country,
      userId: client.userId,
      portalStatus,
      cases: caseLinks.map((link) => ({
        partyId: link.partyId,
        caseId: link.caseId,
        caseRef: link.caseRef,
        caseStatus: link.caseStatus,
        role: link.role,
        portalStatus: link.portalStatus,
        mediatorName: link.mediatorName,
      })),
    };
  }

  async findOrCreateClient(data: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    phoneCode?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    ethnicOrigin?: string | null;
    nationalInsuranceNumber?: string | null;
    disabilityOrHealthCondition?: string | null;
    additionalNeeds?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    postcode?: string | null;
    country?: string | null;
    userId?: string | null;
  }): Promise<Client> {
    const normalizedEmail = data.email ? data.email.trim().toLowerCase() : null;

    if (normalizedEmail) {
      const existing = await storage.findClientByEmail(normalizedEmail);
      if (existing) return existing;
    }

    // Name+DOB fallback runs whether or not an email was provided:
    // if the email lookup missed (e.g. different address for same person),
    // we still want to match on name+DOB rather than create a duplicate.
    if (data.firstName && data.lastName && data.dateOfBirth) {
      const existing = await storage.findClientByNameDob(
        data.firstName.trim(),
        data.lastName.trim(),
        data.dateOfBirth.trim(),
      );
      if (existing) return existing;
    }

    return storage.createClient({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: normalizedEmail,
      phone: data.phone,
      phoneCode: data.phoneCode,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      ethnicOrigin: data.ethnicOrigin,
      nationalInsuranceNumber: data.nationalInsuranceNumber,
      disabilityOrHealthCondition: data.disabilityOrHealthCondition,
      additionalNeeds: data.additionalNeeds,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      postcode: data.postcode,
      country: data.country,
      userId: data.userId,
    });
  }

  async createClient(data: {
    caseId: string;
    role: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    phoneCode?: string;
    dateOfBirth?: string;
    gender?: string;
    ethnicOrigin?: string;
    nationalInsuranceNumber?: string;
    disabilityOrHealthCondition?: string;
    additionalNeeds?: string;
    confidential?: boolean;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    postcode?: string;
    country?: string;
    miamMediatorId?: string | null;
    allocatedMediatorId?: string | null;
  }): Promise<
    ServiceResult<{
      party: {
        id: string;
        firstName: string;
        lastName: string;
        [key: string]: unknown;
      };
    }>
  > {
    if (!data.caseId || !data.role || !data.firstName || !data.lastName) {
      return {
        ok: false,
        error: "caseId, role, firstName, and lastName are required",
        status: 400,
      };
    }

    let userId: string | undefined;

    if (data.email) {
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser && existingUser.role === "client") {
        userId = existingUser.id;
      } else if (!existingUser) {
        const placeholderPassword = hashPassword(crypto.randomUUID());
        const clientUser = await storage.createUser({
          email: data.email,
          password: placeholderPassword,
          name: `${data.firstName} ${data.lastName}`,
          role: "client",
          status: "inactive",
        });
        userId = clientUser.id;
      }
    }

    const client = await this.findOrCreateClient({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      phoneCode: data.phoneCode,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      ethnicOrigin: data.ethnicOrigin,
      nationalInsuranceNumber: data.nationalInsuranceNumber,
      disabilityOrHealthCondition: data.disabilityOrHealthCondition,
      additionalNeeds: data.additionalNeeds,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      postcode: data.postcode,
      country: data.country,
      userId,
    });

    if (userId && !client.userId) {
      await storage.updateClient(client.id, { userId });
    }

    const party = await storage.createParty({
      caseId: data.caseId,
      clientId: client.id,
      role: data.role,
      confidential: data.confidential,
      miamMediatorId:
        data.miamMediatorId === null ? null : data.miamMediatorId || undefined,
      allocatedMediatorId:
        data.allocatedMediatorId === null
          ? null
          : data.allocatedMediatorId || undefined,
      portalStatus: "inactive",
    });

    return { ok: true, party };
  }

  async updateClient(
    id: string,
    data: Record<string, unknown>,
  ): Promise<
    ServiceResult<{
      party: {
        id: string;
        firstName: string;
        lastName: string;
        [key: string]: unknown;
      };
    }>
  > {
    const client = await storage.getClient(id);
    if (!client) return { ok: false, error: "Client not found", status: 404 };

    const clientPersonFields = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "phoneCode",
      "dateOfBirth",
      "gender",
      "ethnicOrigin",
      "nationalInsuranceNumber",
      "disabilityOrHealthCondition",
      "additionalNeeds",
      "addressLine1",
      "addressLine2",
      "city",
      "postcode",
      "country",
    ];

    const clientUpdate: Record<string, unknown> = {};
    for (const field of clientPersonFields) {
      if (data[field] !== undefined) clientUpdate[field] = data[field];
    }

    if (Object.keys(clientUpdate).length > 0) {
      await storage.updateClient(
        id,
        clientUpdate as Parameters<typeof storage.updateClient>[1],
      );
    }

    const updated = await storage.getClient(id);
    if (!updated)
      return { ok: false, error: "Client not found after update", status: 500 };
    return {
      ok: true,
      party: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
      },
    };
  }

  async deleteOrphanedClient(id: string): Promise<ServiceResult<{}>> {
    const existing = await storage.getClient(id);
    if (!existing) {
      return { ok: false, error: "Client not found", status: 404 };
    }
    const parties = await storage.listPartiesByClientId(id);
    if (parties.length > 0) {
      return {
        ok: false,
        error: "Client has active case links and cannot be deleted",
        status: 409,
      };
    }
    if (await storage.hasLegacyClientHistory(id)) {
      return {
        ok: false,
        error: "Client has legacy CRM history and cannot be deleted",
        status: 409,
      };
    }
    const deleted = await storage.deleteClient(id);
    if (!deleted) {
      return { ok: false, error: "Failed to delete client", status: 500 };
    }
    return { ok: true };
  }
}

export const clientService = new ClientService();
