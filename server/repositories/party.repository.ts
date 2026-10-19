import { type Party, type PartyLink, type InsertParty, parties, clients } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

const richSelect = {
  id: parties.id,
  caseId: parties.caseId,
  clientId: parties.clientId,
  role: parties.role,
  confidential: parties.confidential,
  miamMediatorId: parties.miamMediatorId,
  allocatedMediatorId: parties.allocatedMediatorId,
  portalStatus: parties.portalStatus,
  inviteToken: parties.inviteToken,
  inviteExpiresAt: parties.inviteExpiresAt,
  bookingToken: parties.bookingToken,
  bookingTokenExpiresAt: parties.bookingTokenExpiresAt,
  miamFormToken: parties.miamFormToken,
  miamFormTokenExpiresAt: parties.miamFormTokenExpiresAt,
  firstName: clients.firstName,
  lastName: clients.lastName,
  dateOfBirth: clients.dateOfBirth,
  email: clients.email,
  phone: clients.phone,
  phoneCode: clients.phoneCode,
  gender: clients.gender,
  ethnicOrigin: clients.ethnicOrigin,
  nationalInsuranceNumber: clients.nationalInsuranceNumber,
  disabilityOrHealthCondition: clients.disabilityOrHealthCondition,
  additionalNeeds: clients.additionalNeeds,
  addressLine1: clients.addressLine1,
  addressLine2: clients.addressLine2,
  city: clients.city,
  postcode: clients.postcode,
  country: clients.country,
  userId: clients.userId,
} as const;

export class PartyRepository {
  async getParty(id: string): Promise<Party | undefined> {
    const [row] = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.id, id));
    return row as Party | undefined;
  }

  async getPartyByInviteToken(token: string): Promise<Party | undefined> {
    const [row] = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.inviteToken, token));
    return row as Party | undefined;
  }

  async getPartyByBookingToken(token: string): Promise<Party | undefined> {
    const [row] = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.bookingToken, token));
    return row as Party | undefined;
  }

  async getPartyByMiamFormToken(token: string): Promise<Party | undefined> {
    const [row] = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.miamFormToken, token));
    return row as Party | undefined;
  }

  async listPartiesByCase(caseId: string): Promise<Party[]> {
    const rows = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.caseId, caseId));
    return rows as Party[];
  }

  async createParty(party: InsertParty): Promise<Party> {
    const [link] = await db.insert(parties).values(party).returning();
    const full = await this.getParty(link.id);
    if (!full) throw new Error("Party not found after creation");
    return full;
  }

  async updateParty(id: string, data: Partial<Omit<PartyLink, "id" | "caseId" | "clientId">>): Promise<Party | undefined> {
    await db.update(parties).set(data).where(eq(parties.id, id));
    return this.getParty(id);
  }

  async listPartiesByUserId(userId: string): Promise<Party[]> {
    const rows = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(clients.userId, userId));
    return rows as Party[];
  }

  async listPartiesByClientId(clientId: string): Promise<Party[]> {
    const rows = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id))
      .where(eq(parties.clientId, clientId));
    return rows as Party[];
  }

  async listAllParties(): Promise<Party[]> {
    const rows = await db
      .select(richSelect)
      .from(parties)
      .innerJoin(clients, eq(parties.clientId, clients.id));
    return rows as Party[];
  }
}
