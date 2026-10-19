export type ParsedCaseReferenceInput = {
  baseCaseRef: string;
  partyRole: string | null;
};

const PARTY_CASE_REFERENCE_PATTERN = /^(BFM-\d{4}-\d{4,})-([A-Z])$/i;

export function parseCaseReferenceInput(input: string): ParsedCaseReferenceInput {
  const normalized = input.trim().toUpperCase();
  const match = PARTY_CASE_REFERENCE_PATTERN.exec(normalized);
  if (!match) return { baseCaseRef: normalized, partyRole: null };
  return { baseCaseRef: match[1], partyRole: match[2] };
}

export function filterPartyMatchesByReferenceRole<T extends { role: string | null | undefined }>(
  matches: readonly T[],
  partyRole: string | null,
): T[] {
  if (!partyRole) return [...matches];
  return matches.filter((match) => match.role?.toUpperCase() === partyRole);
}

export function formatCaseRefWithRole(
  caseRef: string | null | undefined,
  role: string | null | undefined,
): string {
  if (!caseRef) return "";
  if (!role) return caseRef;
  return `${caseRef}-${role}`;
}

/**
 * Returns the next free role letter for a new party on a case (A → Z), or
 * `null` if the case is already at the Z cap.
 *
 * Policy: returns the FIRST FREE letter (A first, then B, ... ), not strictly
 * "highest existing + 1". This is the spec-aligned behaviour for Task #146:
 *   "Each new party gets the next free letter; A and B never reorder."
 *
 * Under normal operation parties are append-only and never deleted, so
 * "first free" and "highest + 1" produce the same result. If a future
 * operational policy ever introduces party deletion that should NOT recycle
 * letters, switch this helper to scan for `max(existing) + 1` instead.
 */
export function getNextRoleLetter(existingRoles: Array<string | null | undefined>): string | null {
  const used = new Set(
    existingRoles
      .filter((r): r is string => typeof r === "string" && r.length > 0)
      .map((r) => r.toUpperCase()),
  );
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return letter;
  }
  return null;
}

export function compareRoleLetters(a: string | null | undefined, b: string | null | undefined): number {
  const av = (a || "").toUpperCase();
  const bv = (b || "").toUpperCase();
  if (av === bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return av < bv ? -1 : 1;
}
