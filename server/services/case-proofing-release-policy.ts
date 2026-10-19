import crypto from "crypto";

export type ProofingReleaseRecipientCandidate = {
  partyId: string;
  userId: string | null;
};

const TERMINAL_PROOFING_STATUSES = new Set(["approved", "returned", "withdrawn"]);

export function shouldStartNewProofingCycle(
  existingStatus: string | null,
  incomingStatus: string,
  hasExistingCycle: boolean,
): boolean {
  if (!existingStatus || !hasExistingCycle) return true;
  return incomingStatus === "awaiting_review" && TERMINAL_PROOFING_STATUSES.has(existingStatus);
}

export function selectProofingReleaseRecipientIds(
  candidates: readonly ProofingReleaseRecipientCandidate[],
  documentPartyId: string | null,
): string[] {
  return Array.from(new Set(
    candidates
      .filter((candidate) => !documentPartyId || candidate.partyId === documentPartyId)
      .map((candidate) => candidate.userId)
      .filter((userId): userId is string => Boolean(userId)),
  ));
}

export function proofingReleaseNotificationId(itemId: string, cycleNumber: number, recipientId: string): string {
  const digest = crypto.createHash("sha256")
    .update(`case_document_released:${itemId}:${cycleNumber}:${recipientId}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function proofingReleaseDocumentId(itemId: string, cycleNumber: number): string {
  const digest = crypto.createHash("sha256")
    .update(`proofing_released_document:${itemId}:${cycleNumber}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
