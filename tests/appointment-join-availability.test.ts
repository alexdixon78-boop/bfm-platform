import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildClientAppointmentView, buildCoMediatorAppointmentView } from "../server/security/appointment-visibility";
import { buildObserverMediationSessionView } from "../server/security/session-visibility";

const NOW = new Date("2026-09-23T10:00:00.000Z");

async function loadPolicy() {
  try {
    return await import("../server/security/appointment-join-policy");
  } catch {
    assert.fail("appointment join availability policy should exist");
  }
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: "appointment-1",
    caseId: "case-1",
    partyId: null,
    dateTime: new Date("2026-09-23T13:00:00.000Z"),
    duration: 120,
    status: "confirmed",
    meetingLink: "https://meeting.example.test/private",
    ...overrides,
  };
}

test("session join availability explains every non-joinable state and allows confirmed same-day sessions", async () => {
  const policy = await loadPolicy();
  const build = policy.buildSessionJoinAvailability;

  assert.deepEqual(build({ appointment: appointment(), sessionStatus: "cancelled" }, NOW), {
    canJoin: false,
    reasonCode: "session_cancelled",
    message: "This session has been cancelled.",
  });
  assert.equal(build({ appointment: appointment({ status: "expired" }) }, NOW).reasonCode, "session_expired");
  assert.equal(build({ appointment: appointment({ status: "hold" }), blockingFormsPending: true }, NOW).reasonCode, "forms_pending");
  assert.equal(build({ appointment: appointment({ status: "hold" }), proposalResponsesPending: true }, NOW).reasonCode, "responses_pending");
  assert.equal(build({ appointment: appointment({ status: "hold" }) }, NOW).reasonCode, "confirmation_pending");
  assert.equal(build({ appointment: appointment({ meetingLink: null }) }, NOW).reasonCode, "meeting_link_missing");
  assert.equal(build({ appointment: appointment({ dateTime: new Date("2026-09-24T13:00:00.000Z") }) }, NOW).reasonCode, "appointment_day_pending");
  assert.equal(build({ appointment: appointment({ dateTime: new Date("2026-09-22T13:00:00.000Z") }) }, NOW).reasonCode, "appointment_day_passed");
  assert.deepEqual(build({ appointment: appointment() }, NOW), {
    canJoin: true,
    reasonCode: "available",
    message: "Join Session is available.",
  });
});

test("restricted appointment views preserve join availability without exposing the meeting URL", () => {
  const joinAvailability = {
    canJoin: false,
    reasonCode: "forms_pending",
    message: "Join will be available after all required client forms are signed and the session is confirmed.",
  };
  const source = { ...appointment(), joinAvailability };

  const client = buildClientAppointmentView(source);
  const coMediator = buildCoMediatorAppointmentView(source);
  const observer = buildObserverMediationSessionView({
    id: "session-1",
    caseId: "case-1",
    sessionNumber: 1,
    status: "allocated",
    leadMediatorName: "Lead Mediator",
    appointment: source,
    createdAt: NOW,
    updatedAt: NOW,
  } as any);

  assert.deepEqual(client.joinAvailability, joinAvailability);
  assert.deepEqual(coMediator.joinAvailability, joinAvailability);
  assert.deepEqual(observer.appointment?.joinAvailability, joinAvailability);
  assert.equal("meetingLink" in client, false);
  assert.equal("meetingLink" in coMediator, false);
  assert.equal("meetingLink" in (observer.appointment || {}), false);
});

test("case detail always renders an appointment join control and a visible disabled reason", () => {
  const source = readFileSync(new URL("../client/src/pages/case-detail.tsx", import.meta.url), "utf8");

  assert.match(source, /const joinAvailability = session\.appointment\?\.joinAvailability/);
  assert.match(source, /disabled=\{!joinAvailability\.canJoin \|\| joiningAppointmentId === session\.appointment!\.id\}/);
  assert.match(source, /data-testid=\{`text-join-session-reason-\$\{session\.id\}`\}/);
  assert.doesNotMatch(source, /&& canJoinSession\(session\) &&/);
});

test("audited join endpoint applies the linked mediation session status", () => {
  const source = readFileSync(new URL("../server/routes/appointment.routes.ts", import.meta.url), "utf8");

  assert.match(source, /storage\.listMediationSessionsByCase\(appt\.caseId\)/);
  assert.match(source, /sessionStatus: mediationSession\?\.status/);
});
