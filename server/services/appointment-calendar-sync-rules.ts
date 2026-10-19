export const CALENDAR_SYNC_MAX_ATTEMPTS = 5;

const CALENDAR_SYNC_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
] as const;

export function getNextCalendarSyncAttemptAt(attemptCount: number, now = new Date()): Date | null {
  const delay = CALENDAR_SYNC_RETRY_DELAYS_MS[attemptCount - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

export function isPaidPublicBookingEligibleForAutoConfirmation(appointment: {
  bookingToken: string | null;
  paymentStatus: string;
  paymentProvider: string | null;
  status: string;
}): boolean {
  return !!appointment.bookingToken
    && appointment.paymentStatus === "paid"
    && (appointment.paymentProvider === "stripe" || appointment.paymentProvider === "xero_stripe")
    && (appointment.status === "hold" || appointment.status === "held" || appointment.status === "confirmed");
}
