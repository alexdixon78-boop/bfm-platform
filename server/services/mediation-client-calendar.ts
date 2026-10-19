export interface MediationInviteRecipient {
  partyId: string;
  role: string;
  name: string;
  email: string;
}

export interface PrivateCalendarEvent {
  eventId: string;
  icalUid: string;
}

const USABLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function privateMediationEventId(appointmentId: string, partyId: string): string {
  return createHash("sha256").update(`bfm-mediation-client:${appointmentId}:${partyId}`).digest("hex");
}

export function prepareMediationInviteRecipients(
  parties: MediationInviteRecipient[],
): { ok: true; recipients: MediationInviteRecipient[] } | { ok: false; error: string } {
  if (parties.length === 0) return { ok: false, error: "No clients are linked to this mediation session" };
  const recipients: MediationInviteRecipient[] = [];
  for (const party of parties) {
    const email = party.email?.trim() || "";
    if (!USABLE_EMAIL.test(email)) {
      return { ok: false, error: `Client ${party.role || party.name} needs a usable email address before this mediation session can be confirmed` };
    }
    recipients.push({ ...party, email });
  }
  return { ok: true, recipients };
}

export async function syncPrivateMediationInvites(
  recipients: MediationInviteRecipient[],
  dependencies: {
    get(partyId: string): Promise<PrivateCalendarEvent | undefined>;
    create(recipient: MediationInviteRecipient): Promise<PrivateCalendarEvent>;
    save(partyId: string, event: PrivateCalendarEvent): Promise<void>;
  },
): Promise<Map<string, PrivateCalendarEvent>> {
  const events = new Map<string, PrivateCalendarEvent>();
  for (const recipient of recipients) {
    let event = await dependencies.get(recipient.partyId);
    if (!event) {
      event = await dependencies.create(recipient);
      await dependencies.save(recipient.partyId, event);
    }
    events.set(recipient.partyId, event);
  }
  return events;
}

export async function reschedulePrivateMediationInvites(
  eventIds: string[],
  start: Date,
  end: Date,
  oldStart: Date,
  oldEnd: Date,
  patch: (eventId: string, start: Date, end: Date) => Promise<void>,
  onRollbackFailure?: (eventId: string, error: unknown) => Promise<void>,
): Promise<void> {
  const updated: string[] = [];
  try {
    for (const eventId of eventIds) {
      await patch(eventId, start, end);
      updated.push(eventId);
    }
  } catch (error) {
    for (const eventId of updated) {
      try {
        await patch(eventId, oldStart, oldEnd);
      } catch (rollbackError) {
        await onRollbackFailure?.(eventId, rollbackError);
      }
    }
    throw error;
  }
}

export async function cancelPrivateMediationInvites(
  eventIds: string[],
  removeProviderEvent: (eventId: string) => Promise<void>,
  removeMapping: (eventId: string) => Promise<void>,
): Promise<void> {
  let firstError: unknown;
  for (const eventId of eventIds) {
    try {
      await removeProviderEvent(eventId);
    } catch (error) {
      const status = (error as { code?: number; response?: { status?: number } })?.code
        ?? (error as { response?: { status?: number } })?.response?.status;
      if (status !== 404 && status !== 410) {
        firstError ??= error;
        continue;
      }
    }
    try {
      await removeMapping(eventId);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}
import { createHash } from "crypto";
