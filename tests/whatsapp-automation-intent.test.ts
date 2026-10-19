import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isWhatsappMenuRestartIntent,
  shouldRestartWhatsappVerification,
} from "../server/utils/whatsapp-automation-intent";

describe("WhatsApp automation restart intent", () => {
  it("accepts exact greeting and menu commands with case, whitespace, or terminal punctuation", () => {
    for (const input of [
      "hi",
      " Hello ",
      "HEY!",
      "menu?",
      "Start.",
      "restart...",
    ]) {
      assert.equal(isWhatsappMenuRestartIntent(input), true, input);
    }
  });

  it("rejects partial matches and user data containing greeting words", () => {
    for (const input of [
      "hi@example.com",
      "hello there",
      "restart verification please",
      "this is my case reference",
      "",
    ]) {
      assert.equal(isWhatsappMenuRestartIntent(input), false, input);
    }
  });

  it("restarts only during unverified private-note states", () => {
    for (const state of [
      "awaiting_case_reference",
      "awaiting_identity_email",
      "awaiting_otp",
    ]) {
      assert.equal(shouldRestartWhatsappVerification(state, "hello"), true, state);
    }

    for (const state of [
      "awaiting_private_note_content",
      "awaiting_enquiry_flow",
      "awaiting_menu",
      null,
    ]) {
      assert.equal(shouldRestartWhatsappVerification(state, "hello"), false, String(state));
    }
  });
});
