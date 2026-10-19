import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mediatorsPage = readFileSync(
  new URL("../client/src/pages/mediators.tsx", import.meta.url),
  "utf8",
);
const enquiriesPage = readFileSync(
  new URL("../client/src/pages/enquiries.tsx", import.meta.url),
  "utf8",
);

test("mediators listing exposes an accessible operational help dialog", () => {
  assert.match(mediatorsPage, /button-mediator-info/);
  assert.match(mediatorsPage, /aria-label="About Mediators"/);
  assert.match(mediatorsPage, /dialog-mediator-info/);
  assert.match(mediatorsPage, /About Mediators/);
  assert.match(mediatorsPage, /const mediatorInfoButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(mediatorsPage, /onCloseAutoFocus=\{\(event\) => \{/);
  assert.match(mediatorsPage, /mediatorInfoButtonRef\.current\?\.focus\(\)/);
});

test("enquiries help dialog describes the current intake workspace and linked-case flow", () => {
  assert.match(enquiriesPage, /dialog-enquiry-info/);
  assert.match(enquiriesPage, /About Enquiries/);
  assert.match(enquiriesPage, /automatically creates a case shell/);
  assert.match(enquiriesPage, /Intake workspace/);
  assert.match(enquiriesPage, /Triage and follow-up/);
  assert.match(enquiriesPage, /does not close the linked case/);
  assert.doesNotMatch(enquiriesPage, /After conversion, admins can send a portal invitation/);
});
