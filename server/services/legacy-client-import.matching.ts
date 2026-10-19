import type { LegacyClientProfile, ParsedLegacyPerson } from "./legacy-client-import.workbook";

export type LegacyMatchReason = "email" | "name_dob" | "phone_last_name";

export interface LegacyExistingClientCandidate extends LegacyClientProfile {
  id: string;
}

export interface LegacyDuplicateMatch {
  clientId: string;
  reasons: LegacyMatchReason[];
  client: LegacyExistingClientCandidate;
}

function normalized(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizedPhone(profile: LegacyClientProfile) {
  const phone = (profile.phone || "").replace(/\D/g, "").replace(/^0/, "");
  const code = (profile.phoneCode || "").replace(/\D/g, "");
  return phone ? `${code}${phone}` : "";
}

export function matchReasons(left: LegacyClientProfile, right: LegacyClientProfile): LegacyMatchReason[] {
  const reasons: LegacyMatchReason[] = [];
  const leftEmail = normalized(left.email);
  if (leftEmail && leftEmail === normalized(right.email)) reasons.push("email");

  const sameFullName = !!normalized(left.firstName)
    && normalized(left.firstName) === normalized(right.firstName)
    && normalized(left.lastName) === normalized(right.lastName);
  if (sameFullName && left.dateOfBirth && left.dateOfBirth === right.dateOfBirth) reasons.push("name_dob");

  const leftPhone = normalizedPhone(left);
  if (leftPhone && leftPhone === normalizedPhone(right)
      && normalized(left.lastName) && normalized(left.lastName) === normalized(right.lastName)) {
    reasons.push("phone_last_name");
  }
  return reasons;
}

export function findLegacyDuplicateMatches(
  staged: ParsedLegacyPerson,
  existingClients: LegacyExistingClientCandidate[],
): LegacyDuplicateMatch[] {
  return existingClients
    .map((client) => ({ clientId: client.id, reasons: matchReasons(staged.profile, client), client }))
    .filter((match) => match.reasons.length > 0);
}

export function groupStagedLegacyPeople(people: ParsedLegacyPerson[]) {
  const parent = people.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const firstIndexByKey = new Map<string, number>();
  for (let index = 0; index < people.length; index += 1) {
    const profile = people[index].profile;
    const email = normalized(profile.email);
    const firstName = normalized(profile.firstName);
    const lastName = normalized(profile.lastName);
    const phone = normalizedPhone(profile);
    const keys = [
      email ? `email:${email}` : null,
      firstName && lastName && profile.dateOfBirth ? `name-dob:${firstName}:${lastName}:${profile.dateOfBirth}` : null,
      phone && lastName ? `phone-last:${phone}:${lastName}` : null,
    ].filter((key): key is string => !!key);
    for (const key of keys) {
      const prior = firstIndexByKey.get(key);
      if (prior == null) firstIndexByKey.set(key, index);
      else union(prior, index);
    }
  }

  const grouped = new Map<number, ParsedLegacyPerson[]>();
  people.forEach((person, index) => {
    const root = find(index);
    grouped.set(root, [...(grouped.get(root) || []), person]);
  });
  return Array.from(grouped.values()).map((members) => ({
    groupId: members.map((person) => person.personKey).sort().join("|"),
    memberKeys: members.map((person) => person.personKey).sort(),
    members,
  }));
}
