import test from "node:test";
import assert from "node:assert/strict";
import { findTemplateVariables, miamAvailabilityVariables, renderTemplate, validateTemplate, validatePublication } from "../shared/email-template-core";

test("maps independent suggested MIAM times to E1 variables", () => {
  assert.deepEqual(miamAvailabilityVariables([
    { displayDate: "Monday 2 March 2026", times: ["09:00", "10:00"] },
    { displayDate: "Tuesday 3 March 2026", times: ["14:00"] },
  ]), {
    date_1: "Monday 2 March 2026",
    times_1: "09:00, 10:00",
    date_2: "Tuesday 3 March 2026",
    times_2: "14:00",
    date_3: "",
    times_3: "",
  });
});

test("template renderer escapes values and reports missing fields", () => {
  const source = "Hello {{client_first_name}}. Visit {{portal_link}} at {{date}}.";
  assert.deepEqual(findTemplateVariables(source), ["client_first_name", "portal_link", "date"]);
  assert.deepEqual(renderTemplate(source, { client_first_name: "<Jane>", portal_link: "https://example.test/?a=1&b=2" }), {
    output: "Hello &lt;Jane&gt;. Visit https://example.test/?a=1&amp;b=2 at {{date}}.",
    missing: ["date"],
  });
});

test("template renderer can blank optional variables while keeping required variables strict", () => {
  const source = "Hello {{client_first_name}} {{optional_note}} {{booking_link}}.";

  assert.deepEqual(
    renderTemplate(source, { client_first_name: "Jane", optional_note: "", booking_link: "" }, true, {
      allowBlankOptionalVariables: true,
      requiredVariables: ["booking_link"],
    }),
    {
      output: "Hello Jane  {{booking_link}}.",
      missing: ["booking_link"],
    },
  );
});

test("incomplete review entry cannot be published", () => {
  assert.match(validatePublication({ code: "N2", subject: "", bodyHtml: "<p>Source wording is missing from the review document.</p>", requiredVariables: [] }) || "", /subject/i);
  assert.equal(validatePublication({ code: "E1", subject: "Hello", bodyHtml: "<p>Hi</p>", requiredVariables: [] }), null);
  assert.match(validatePublication({ code: "E1", subject: "Hello", bodyHtml: "<p>{{If approved:</p><p>send now}}</p>", requiredVariables: [] }) || "", /placeholder/i);
});

test("protected variables cannot be removed from system templates", () => {
  assert.deepEqual(validateTemplate("<p>{{portal_link}}</p>", ["portal_link"]), []);
  assert.deepEqual(validateTemplate("<p>Click here</p>", ["portal_link"]), ["portal_link"]);
});
