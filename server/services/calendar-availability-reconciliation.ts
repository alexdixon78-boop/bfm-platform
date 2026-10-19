import { createHash } from "node:crypto";

export function buildAvailabilityFingerprint(input: {
  title: string | null;
  startAt: Date;
  endAt: Date;
  isAllDay?: boolean;
  attendees: Array<{ email: string }>;
}): string {
  const normalized = JSON.stringify({
    title: input.title?.trim().toLowerCase() ?? "",
    startAt: input.startAt.toISOString(),
    endAt: input.endAt.toISOString(),
    isAllDay: !!input.isAllDay,
    attendees: input.attendees
      .map((attendee) => attendee.email.trim().toLowerCase())
      .filter(Boolean)
      .sort(),
  });
  return createHash("sha256").update(normalized).digest("hex");
}

export function planServiceSlotReconciliation(input: {
  approvedServiceIds: string[];
  activeSlots: Array<{ serviceTypeId: string }>;
  bookedServiceIds: string[];
}) {
  const approved = new Set(input.approvedServiceIds);
  const active = new Set(input.activeSlots.map((slot) => slot.serviceTypeId));
  const booked = new Set(input.bookedServiceIds);
  const sorted = (values: Iterable<string>) => Array.from(new Set(values)).sort();

  return {
    createServiceIds: sorted(Array.from(approved).filter((id) => !active.has(id))),
    retainServiceIds: sorted(Array.from(approved).filter((id) => active.has(id))),
    deleteServiceIds: sorted(Array.from(active).filter((id) => !approved.has(id) && !booked.has(id))),
    retireServiceIds: sorted(Array.from(active).filter((id) => !approved.has(id) && booked.has(id))),
  };
}
