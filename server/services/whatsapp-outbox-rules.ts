export const WHATSAPP_OUTBOX_LEASE_MS = 5 * 60 * 1000;
export const WHATSAPP_OUTBOX_MAX_ATTEMPTS = 6;

const RETRYABLE_PROVIDER_CODES = new Set([130429, 131000, 131048, 131056]);

type FailureInput = {
  httpStatus: number;
  providerCode?: number | null;
  retryCount: number;
  now?: Date;
};

export type WhatsappOutboxFailureDecision = {
  status: "pending" | "failed";
  retryCount: number;
  nextAttemptAt: Date;
};

export function getWhatsappOutboxLeaseExpiry(now = new Date()): Date {
  return new Date(now.getTime() + WHATSAPP_OUTBOX_LEASE_MS);
}

export function getWhatsappOutboxFailureDecision(
  input: FailureInput,
): WhatsappOutboxFailureDecision {
  const now = input.now ?? new Date();
  const retryCount = input.retryCount + 1;
  const retryable = input.httpStatus === 408
    || input.httpStatus === 429
    || input.httpStatus >= 500
    || (input.providerCode != null && RETRYABLE_PROVIDER_CODES.has(input.providerCode));
  const exhausted = retryCount >= WHATSAPP_OUTBOX_MAX_ATTEMPTS;

  if (!retryable || exhausted) {
    return { status: "failed", retryCount, nextAttemptAt: now };
  }

  const delayMinutes = 2 ** input.retryCount;
  return {
    status: "pending",
    retryCount,
    nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000),
  };
}
