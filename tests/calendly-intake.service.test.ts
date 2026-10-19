import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalendlyDuplicateNeedle,
  buildCalendlyMetadata,
  enrichCalendlyConsultation,
  getCalendlySafeDiagnostics,
  getCalendlyValidationDiagnostics,
  mapCalendlyConsultation,
} from "../server/services/calendly-intake.service";

const fullWebhook = {
  event: "invitee.created",
  created_at: "2026-08-11T04:00:00Z",
  payload: {
    uri: "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
    event: "https://api.calendly.com/scheduled_events/event-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    scheduled_event: {
      uri: "https://api.calendly.com/scheduled_events/event-1",
      name: "New Meeting",
      start_time: "2026-08-12T10:00:00Z",
      end_time: "2026-08-12T10:30:00Z",
      timezone: "Asia/Kolkata",
    },
    questions_and_answers: [
      { question: "Phone", answer: "+44 7000 000000" },
      { question: "Address", answer: "1 Mediation Street" },
      { question: "Post code", answer: "AB1 2CD" },
      { question: "Lead source", answer: "Google" },
      { question: "Referral type", answer: "Self referral" },
      { question: "Mediation type", answer: "Civil" },
      { question: "Notes", answer: "Needs a morning callback" },
    ],
  },
};

test("Calendly mapper accepts common labels and normalizes CRM enum answers", () => {
  const mapped = mapCalendlyConsultation(fullWebhook);

  assert.equal(mapped.data.firstName, "Ada");
  assert.equal(mapped.data.lastName, "Lovelace");
  assert.equal(mapped.data.mobileTelephone, "+44 7000 000000");
  assert.equal(mapped.data.addressLine1, "1 Mediation Street");
  assert.equal(mapped.data.postcode, "AB1 2CD");
  assert.equal(mapped.data.leadSource, "Google search");
  assert.equal(mapped.data.referralType, "Self-referral");
  assert.equal(mapped.data.issueType, "Civil mediation");
  assert.equal(mapped.data.notes, "Needs a morning callback");
});

test("Calendly mapper accepts native invitee phone fields", () => {
  const mapped = mapCalendlyConsultation({
    ...fullWebhook,
    payload: {
      ...fullWebhook.payload,
      questions_and_answers: fullWebhook.payload.questions_and_answers.filter(
        (answer) => answer.question !== "Phone",
      ),
      phone_number: "+44 7111 111111",
    },
  });

  assert.equal(mapped.data.mobileTelephone, "+44 7111 111111");
});

test("Calendly mapper accepts common custom phone question labels", () => {
  const mapped = mapCalendlyConsultation({
    ...fullWebhook,
    payload: {
      ...fullWebhook.payload,
      questions_and_answers: [
        { question: "Contact number", answer: "+44 7222 222222" },
        ...fullWebhook.payload.questions_and_answers.filter(
          (answer) => answer.question !== "Phone",
        ),
      ],
    },
  });

  assert.equal(mapped.data.mobileTelephone, "+44 7222 222222");
});

test("Calendly diagnostics report missing fields and invalid enum values", () => {
  const mapped = mapCalendlyConsultation({
    event: "invitee.created",
    payload: {
      name: "Only Name",
      email: "only@example.com",
      questions_and_answers: [
        { question: "Lead source", answer: "Newspaper" },
        { question: "Referral type", answer: "Friend" },
        { question: "Mediation type", answer: "Something else" },
      ],
    },
  });

  const diagnostics = getCalendlyValidationDiagnostics(mapped.data);

  assert.deepEqual(diagnostics.missingFields.sort(), [
    "addressLine1",
    "mobileTelephone",
    "postcode",
  ]);
  assert.deepEqual(diagnostics.invalidEnums, {
    issueType: "Something else",
    leadSource: "Newspaper",
    referralType: "Friend",
  });
});

test("Calendly safe diagnostics expose labels and phone field presence without values", () => {
  const mapped = mapCalendlyConsultation({
    event: "invitee.created",
    payload: {
      name: "Only Name",
      email: "private@example.com",
      phone_number: "+44 7999 999999",
      questions_and_answers: [
        { question: "WhatsApp number", answer: "+44 7000 000000" },
        { question: "Address", answer: "10 Private Street" },
      ],
    },
  });

  const diagnostics = getCalendlySafeDiagnostics(mapped);
  const serialized = JSON.stringify(diagnostics);

  assert.deepEqual(diagnostics.answerLabels, ["WhatsApp number", "Address"]);
  assert.equal(diagnostics.phoneCandidateFieldsPresent.phone_number, true);
  assert.equal(diagnostics.phoneCandidateFieldsPresent.text_reminder_number, false);
  assert.equal(serialized.includes("+44"), false);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("10 Private Street"), false);
});

test("Calendly enrichment fetches full invitee details when webhook answers are incomplete", async () => {
  const fetchCalls: string[] = [];
  const mapped = await enrichCalendlyConsultation(
    {
      event: "invitee.created",
      payload: {
        uri: "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
        event: "https://api.calendly.com/scheduled_events/event-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
    },
    {
      token: "pat-token",
      fetchImpl: async (url, init) => {
        fetchCalls.push(String(url));
        assert.equal(init?.headers?.["Authorization"], "Bearer pat-token");
        return new Response(
          JSON.stringify({
            resource: fullWebhook.payload,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.deepEqual(fetchCalls, [
    "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
  ]);
  assert.equal(mapped.enrichment.status, "fetched");
  assert.equal(mapped.data.issueType, "Civil mediation");
});

test("Calendly enrichment returns retryable fetch failures for webhook retries", async () => {
  const mapped = await enrichCalendlyConsultation(
    {
      event: "invitee.created",
      payload: {
        uri: "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
        event: "https://api.calendly.com/scheduled_events/event-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
    },
    {
      token: "pat-token",
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: "upstream unavailable" }), {
          status: 503,
        }),
    },
  );

  assert.equal(mapped.enrichment.status, "failed");
  assert.equal(mapped.enrichment.retryable, true);
  assert.equal(mapped.enrichment.httpStatus, 503);
});

test("Calendly metadata keeps invitee URI available for duplicate detection", () => {
  const mapped = mapCalendlyConsultation(fullWebhook);
  const metadata = buildCalendlyMetadata(mapped);

  assert.equal(
    metadata.calendly.inviteeUri,
    "https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1",
  );
  assert.equal(
    buildCalendlyDuplicateNeedle(metadata.calendly.inviteeUri),
    '"inviteeUri":"https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1"',
  );
});
