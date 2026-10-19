import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClientAppointmentView, canClientAccessAppointment } from "../server/security/appointment-visibility";

const ownPartyIds = new Set(["party-a"]);

test("client appointment visibility allows own and joint appointments only", () => {
  assert.equal(canClientAccessAppointment({ partyId: "party-a" }, ownPartyIds), true);
  assert.equal(canClientAccessAppointment({ partyId: null }, ownPartyIds), true);
  assert.equal(canClientAccessAppointment({ partyId: "party-b" }, ownPartyIds), false);
});

test("client appointment DTO excludes notes, party identity, raw meeting links, Xero, and internal payment data", () => {
  const view = buildClientAppointmentView({
    id: "appt-1",
    caseId: "case-1",
    partyId: "party-a",
    serviceTypeId: "service-1",
    mediatorId: "mediator-1",
    dateTime: new Date("2026-09-17T10:00:00Z"),
    dateTimeBasis: "instant",
    duration: 60,
    status: "confirmed",
    notes: "private admin note",
    meetingLink: "https://meet.example.test/private",
    paymentStatus: "paid",
    partyName: "Alice Able",
    mediatorName: "Mediator One",
    serviceName: "MIAM",
    caseReference: "BFM-2026-0001",
    xeroInvoice: { invoiceNumber: "INV-1" },
    hasMeetingLink: true,
    canJoin: true,
  } as any);

  assert.deepEqual(Object.keys(view).sort(), [
    "canJoin", "caseId", "caseReference", "dateTime", "dateTimeBasis", "duration", "hasMeetingLink", "id",
    "mediatorName", "serviceName", "status",
  ].sort());
  assert.equal(JSON.stringify(view).includes("private admin note"), false);
  assert.equal(JSON.stringify(view).includes("meet.example"), false);
  assert.equal(JSON.stringify(view).includes("INV-1"), false);
  assert.equal(view.dateTimeBasis, "instant");
});
