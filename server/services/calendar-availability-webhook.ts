import { createHmac, timingSafeEqual } from "node:crypto";

export type CalendarWebhookProvider = "google" | "outlook";

export function deriveCalendarWebhookToken(
  secret: string,
  provider: CalendarWebhookProvider,
  mediatorId: string,
  subscriptionIdentity: string,
): string {
  return createHmac("sha256", secret)
    .update(`${provider}:${mediatorId}:${subscriptionIdentity}`)
    .digest("hex");
}

export function secureTokenMatches(expected: string, supplied: string | undefined | null): boolean {
  if (!supplied || !/^[a-f0-9]+$/i.test(expected) || !/^[a-f0-9]+$/i.test(supplied)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function getCalendarReconciliationRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(15 * 60_000, 5_000 * (2 ** exponent));
}
