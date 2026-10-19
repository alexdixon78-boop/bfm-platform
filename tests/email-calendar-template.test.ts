import test from "node:test";
import assert from "node:assert/strict";
import { calendarTemplateCode } from "../server/services/email-calendar-template";

test("calendar template codes match MIAM and joint session mediator variants", () => {
  assert.equal(calendarTemplateCode("MIAM", "Davina West"), "M4-D");
  assert.equal(calendarTemplateCode("Mediation Sessions", "Manpreet Singh"), "F4-Ma");
  assert.equal(calendarTemplateCode("MIAM", "Unknown Person"), null);
  assert.equal(calendarTemplateCode("Consultation", "Davina West"), null);
});
