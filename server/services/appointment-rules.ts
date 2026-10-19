export const APPOINTMENT_PAYMENT_STATUSES = [
  "payment_pending",
  "paid",
  "voucher_pending",
  "voucher_accepted_by_opia",
  "payment_not_required",
  "failed_or_not_received",
] as const;

export type AppointmentPaymentStatus = (typeof APPOINTMENT_PAYMENT_STATUSES)[number];

const CONFIRMABLE_PAYMENT_STATUSES: readonly AppointmentPaymentStatus[] = [
  "paid",
  "voucher_accepted_by_opia",
  "payment_not_required",
];

const HOLD_ALERT_HOURS_BEFORE_APPOINTMENT = 72;
const HOLD_CANCEL_HOURS_BEFORE_APPOINTMENT = 55;
const WORKING_DAY_START_HOUR = 9;
const WORKING_DAY_END_HOUR = 17;

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function moveToPreviousWorkingDayEnd(date: Date): Date {
  const adjusted = new Date(date.getTime());
  adjusted.setUTCHours(WORKING_DAY_END_HOUR, 0, 0, 0);
  while (isWeekend(adjusted)) {
    adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  }
  return adjusted;
}

export function isAppointmentPaymentStatus(value: string): value is AppointmentPaymentStatus {
  return (APPOINTMENT_PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function canConfirmAppointmentPayment(status: string | null | undefined): boolean {
  return CONFIRMABLE_PAYMENT_STATUSES.includes((status || "payment_pending") as AppointmentPaymentStatus);
}

export function calculateHoldAlertAt(appointmentStart: Date): Date {
  const alertAt = new Date(appointmentStart.getTime() - HOLD_ALERT_HOURS_BEFORE_APPOINTMENT * 60 * 60 * 1000);
  if (isWeekend(alertAt) || alertAt.getUTCHours() < WORKING_DAY_START_HOUR || alertAt.getUTCHours() >= WORKING_DAY_END_HOUR) {
    return moveToPreviousWorkingDayEnd(alertAt);
  }
  return alertAt;
}

export function calculateHoldDeadline(appointmentStart: Date): Date {
  return new Date(appointmentStart.getTime() - HOLD_CANCEL_HOURS_BEFORE_APPOINTMENT * 60 * 60 * 1000);
}

export function calculatePublicBookingHoldDeadline(appointmentStart: Date, asOf: Date = new Date()): Date {
  const standardDeadline = calculateHoldDeadline(appointmentStart);
  return standardDeadline.getTime() > asOf.getTime()
    ? standardDeadline
    : new Date(appointmentStart.getTime());
}

export function calculateFollowUpDueAt(cancelledAt: Date): Date {
  const due = new Date(cancelledAt.getTime());
  let added = 0;
  while (added < 3) {
    due.setUTCDate(due.getUTCDate() + 1);
    if (!isWeekend(due)) added++;
  }
  return due;
}

export function calculateMiamExpiry(sourceDate: Date | null | undefined): Date | null {
  if (!(sourceDate instanceof Date) || isNaN(sourceDate.valueOf())) return null;
  const validUntil = addMonths(sourceDate, 4);
  validUntil.setUTCHours(23, 59, 59, 999);
  return validUntil;
}

export function getMiamValiditySourceDate(
  miamCompletedDate: Date | null | undefined,
  latestMediationSessionDate: Date | null | undefined,
): Date | null {
  const dates = [miamCompletedDate, latestMediationSessionDate]
    .filter((d): d is Date => d instanceof Date && !isNaN(d.valueOf()));
  if (dates.length === 0) return null;

  return dates.sort((a, b) => b.valueOf() - a.valueOf())[0];
}

export function isMiamValidForCourtAction(
  miamCompletedDate: Date | null | undefined,
  latestMediationSessionDate: Date | null | undefined,
  asOf: Date = new Date(),
): boolean {
  const sourceDate = getMiamValiditySourceDate(miamCompletedDate, latestMediationSessionDate);
  const validUntil = calculateMiamExpiry(sourceDate);
  if (!validUntil) return false;
  return validUntil.getTime() >= asOf.getTime();
}
