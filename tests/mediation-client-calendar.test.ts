import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareMediationInviteRecipients, privateMediationEventId, reschedulePrivateMediationInvites, cancelPrivateMediationInvites, syncPrivateMediationInvites } from "../server/services/mediation-client-calendar";
import { generateIcsContent } from "../server/utils/ics";

test("mediation invitations require a usable address for every party", () => {
  const result = prepareMediationInviteRecipients([
    { partyId: "a", role: "A", name: "Alex", email: "alex@example.com" },
    { partyId: "b", role: "B", name: "Blair", email: "invalid" },
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Client B/);
});

test("separate invitations keep client addresses private and retries reuse stored events", async () => {
  const recipients = prepareMediationInviteRecipients([
    { partyId: "a", role: "A", name: "Alex", email: "alex@example.com" },
    { partyId: "b", role: "B", name: "Blair", email: "blair@outlook.com" },
  ]);
  assert.equal(recipients.ok, true);
  if (!recipients.ok) return;
  const stored = new Map<string, { eventId: string; icalUid: string }>();
  const created: string[] = [];
  const dependencies = {
    get: async (partyId: string) => stored.get(partyId),
    create: async (recipient: { partyId: string; email: string }) => {
      created.push(recipient.email);
      return { eventId: `event-${recipient.partyId}`, icalUid: `uid-${recipient.partyId}@example.com` };
    },
    save: async (partyId: string, event: { eventId: string; icalUid: string }) => { stored.set(partyId, event); },
  };
  await syncPrivateMediationInvites(recipients.recipients, dependencies);
  await syncPrivateMediationInvites(recipients.recipients, dependencies);
  assert.deepEqual(created, ["alex@example.com", "blair@outlook.com"]);
  assert.equal(stored.get("a")?.icalUid, "uid-a@example.com");
  assert.equal(stored.get("b")?.icalUid, "uid-b@example.com");
});

test("a retry uses the same provider event ID for the same appointment and party", () => {
  const first = privateMediationEventId("appointment-1", "party-a");
  assert.equal(first, privateMediationEventId("appointment-1", "party-a"));
  assert.notEqual(first, privateMediationEventId("appointment-1", "party-b"));
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("retry after the second invitation fails preserves the first invitation", async () => {
  const recipients = [
    { partyId: "a", role: "A", name: "Alex", email: "alex@example.com" },
    { partyId: "b", role: "B", name: "Blair", email: "blair@example.com" },
  ];
  const stored = new Map<string, { eventId: string; icalUid: string }>();
  const calls: string[] = [];
  let failSecond = true;
  const dependencies = {
    get: async (partyId: string) => stored.get(partyId),
    create: async (recipient: { partyId: string }) => {
      calls.push(recipient.partyId);
      if (recipient.partyId === "b" && failSecond) throw new Error("provider unavailable");
      return { eventId: recipient.partyId, icalUid: `${recipient.partyId}@example.com` };
    },
    save: async (partyId: string, event: { eventId: string; icalUid: string }) => { stored.set(partyId, event); },
  };
  await assert.rejects(syncPrivateMediationInvites(recipients, dependencies), /provider unavailable/);
  failSecond = false;
  await syncPrivateMediationInvites(recipients, dependencies);
  assert.deepEqual(calls, ["a", "b", "b"]);
  assert.equal(stored.size, 2);
});

test("confirmation attachment identifies the matching private invitation", () => {
  const ics = generateIcsContent({
    summary: "Mediation session — BFM-2026-0010",
    description: "Online mediation session",
    startTime: new Date("2026-10-05T10:00:00Z"),
    durationMinutes: 120,
    organizer: "info@brighterfuturemediation.co.uk",
    attendee: "alex@example.com",
    uid: "google-event-uid@example.com",
  });
  assert.match(ics, /UID:google-event-uid@example\.com/);
  assert.match(ics, /ATTENDEE:mailto:alex@example\.com/);
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/London/);
  assert.match(ics, /DTSTART;TZID=Europe\/London:20261005T110000/);
  assert.match(ics, /DTEND;TZID=Europe\/London:20261005T130000/);
  assert.doesNotMatch(ics, /blair@outlook\.com/);
});

test("a failed second reschedule restores the first client's original time", async () => {
  const patches: string[] = [];
  await assert.rejects(reschedulePrivateMediationInvites(
    ["event-a", "event-b"],
    new Date("2026-10-08T10:00:00Z"), new Date("2026-10-08T12:00:00Z"),
    new Date("2026-10-05T10:00:00Z"), new Date("2026-10-05T12:00:00Z"),
    async (id, start) => {
      patches.push(`${id}:${start.toISOString()}`);
      if (id === "event-b") throw new Error("provider failed");
    },
  ), /provider failed/);
  assert.deepEqual(patches, [
    "event-a:2026-10-08T10:00:00.000Z",
    "event-b:2026-10-08T10:00:00.000Z",
    "event-a:2026-10-05T10:00:00.000Z",
  ]);
});

test("cancellation removes every client's event and mapping", async () => {
  const removed: string[] = [];
  await cancelPrivateMediationInvites(["event-a", "event-b"],
    async (id) => { removed.push(`provider:${id}`); },
    async (id) => { removed.push(`mapping:${id}`); },
  );
  assert.deepEqual(removed, ["provider:event-a", "mapping:event-a", "provider:event-b", "mapping:event-b"]);
});

test("cancellation still attempts the second client when the first provider deletion fails", async () => {
  const removed: string[] = [];
  await assert.rejects(cancelPrivateMediationInvites(["event-a", "event-b"],
    async (id) => {
      removed.push(`provider:${id}`);
      if (id === "event-a") throw new Error("calendar unavailable");
    },
    async (id) => { removed.push(`mapping:${id}`); },
  ), /calendar unavailable/);
  assert.deepEqual(removed, ["provider:event-a", "provider:event-b", "mapping:event-b"]);
});
