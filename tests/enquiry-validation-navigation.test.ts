import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { revealFirstInvalidFormField } from "../client/src/lib/form-validation-navigation";

function setupForm() {
  const dom = new JSDOM(`
    <div id="dialog">
      <input data-form-field="firstName" />
      <button data-form-field="leadSource" type="button">Choose source</button>
      <button data-form-field="referralType" type="button">Choose referral</button>
    </div>
  `);
  const dialog = dom.window.document.getElementById("dialog") as HTMLElement;
  const firstName = dialog.querySelector('[data-form-field="firstName"]') as HTMLElement;
  const leadSource = dialog.querySelector('[data-form-field="leadSource"]') as HTMLElement;
  const referralType = dialog.querySelector('[data-form-field="referralType"]') as HTMLElement;
  return { dialog, firstName, leadSource, referralType };
}

test("reveals and focuses the first invalid visible enquiry field", () => {
  const { dialog, leadSource, referralType } = setupForm();
  const scrollCalls: ScrollIntoViewOptions[] = [];
  let focused = false;
  let laterFieldFocused = false;
  leadSource.scrollIntoView = (options) => scrollCalls.push(options);
  leadSource.focus = () => { focused = true; };
  referralType.focus = () => { laterFieldFocused = true; };

  revealFirstInvalidFormField({
    errors: { leadSource: { message: "Lead source is required" }, referralType: { message: "Referral type is required" } },
    fieldOrder: ["firstName", "leadSource", "referralType"],
    container: dialog,
    prefersReducedMotion: false,
  });

  assert.equal(focused, true);
  assert.equal(laterFieldFocused, false);
  assert.deepEqual(scrollCalls, [{ behavior: "smooth", block: "center", inline: "nearest" }]);
});

test("uses instant scrolling when reduced motion is requested", () => {
  const { dialog, firstName } = setupForm();
  const scrollCalls: ScrollIntoViewOptions[] = [];
  firstName.scrollIntoView = (options) => scrollCalls.push(options);
  firstName.focus = () => {};

  revealFirstInvalidFormField({
    errors: { firstName: { message: "First name is required" } },
    fieldOrder: ["firstName", "leadSource", "referralType"],
    container: dialog,
    prefersReducedMotion: true,
  });

  assert.deepEqual(scrollCalls, [{ behavior: "auto", block: "center", inline: "nearest" }]);
});
