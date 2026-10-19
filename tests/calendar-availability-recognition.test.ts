import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recognizeCalendarAvailabilityEvent,
  type CalendarAvailabilityCandidate,
} from "../server/services/calendar-availability-recognition";

const base: CalendarAvailabilityCandidate = {
  provider: "google",
  externalEventId: "event-1",
  externalSeriesId: null,
  title: "BFM availability",
  startAt: new Date("2030-01-10T09:00:00.000Z"),
  endAt: new Date("2030-01-10T16:00:00.000Z"),
  isAllDay: false,
  organizerEmail: "mediator@example.com",
  attendees: [{ email: "info@brighterfuturemediation.co.uk" }],
};

test("recognises a future timed event using trimmed case-insensitive title", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, title: "  bFm AvAiLaBiLiTy  " },
    { connectedEmail: "MEDIATOR@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: true });
});

test("accepts titles that begin with the availability prefix", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, title: "BFM availability - morning" },
    { connectedEmail: "mediator@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: true });
});

test("accepts titles that begin with the BFM available prefix", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, title: "  bFm AvAiLaBlE - afternoon  " },
    { connectedEmail: "mediator@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: true });
});

test("rejects titles where the availability phrase is not at the beginning", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, title: "Morning BFM availability" },
    { connectedEmail: "mediator@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: false, reason: "title_mismatch" });
});

test("requires the connected mediator account to organise the event", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, organizerEmail: "someone-else@example.com" },
    { connectedEmail: "mediator@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: false, reason: "organizer_mismatch" });
});

test("requires the BFM mailbox invitation", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, attendees: [{ email: "other@example.com" }] },
    { connectedEmail: "mediator@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: false, reason: "bfm_attendee_missing" });
});

test("accepts all-day and elapsed matching events for lifecycle reconciliation", () => {
  const context = { connectedEmail: "mediator@example.com", now: new Date("2030-01-11T00:00:00.000Z") };
  assert.deepEqual(
    recognizeCalendarAvailabilityEvent({ ...base, isAllDay: true }, context),
    { qualified: true },
  );
  assert.deepEqual(recognizeCalendarAvailabilityEvent(base, context), { qualified: true });
});

test("rejects invalid event windows", () => {
  const context = { connectedEmail: "mediator@example.com", now: new Date("2030-01-11T00:00:00.000Z") };
  assert.deepEqual(
    recognizeCalendarAvailabilityEvent({ ...base, endAt: base.startAt }, context),
    { qualified: false, reason: "invalid_window" },
  );
});

test("accepts timed events shorter than the booking duration", () => {
  const result = recognizeCalendarAvailabilityEvent(
    { ...base, endAt: new Date("2030-01-10T09:30:00.000Z") },
    { connectedEmail: "mediator@example.com", now: new Date("2030-01-01T00:00:00.000Z") },
  );
  assert.deepEqual(result, { qualified: true });
});
