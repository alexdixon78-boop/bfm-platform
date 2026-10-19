import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const hashBuffer = Buffer.from(hash, "hex");
  const suppliedHashBuffer = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuffer, suppliedHashBuffer);
}


export function redactPartyPrivateFields(party: any): any {
  return {
    ...party,
    addressLine1: null,
    addressLine2: null,
    city: null,
    postcode: null,
    country: null,
    nationalInsuranceNumber: null,
    additionalNeeds: null,
    confidential: null,
    dateOfBirth: null,
    ethnicOrigin: null,
    gender: null,
    disabilityOrHealthCondition: null,
    inviteToken: null,
    inviteExpiresAt: null,
  };
}

export function stripInviteFields(party: any): any {
  const { inviteToken, inviteExpiresAt, ...rest } = party;
  return rest;
}
