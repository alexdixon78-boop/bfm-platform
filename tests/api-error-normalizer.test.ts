/**
 * Tests for client-side API error normalization.
 *
 * Run with: npx tsx tests/api-error-normalizer.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getApiErrorMessage, parseApiError } from "../client/src/lib/queryClient";

test("parses JSON API message without exposing raw status-prefixed payload", () => {
  const parsed = parseApiError(new Error('400: {"message":"Invalid preview request"}'));

  assert.equal(parsed.statusCode, 400);
  assert.equal(parsed.userMessage, "Invalid preview request");
  assert.doesNotMatch(parsed.userMessage, /^\d+:/);
  assert.doesNotMatch(parsed.userMessage, /\{.*message/);
});

test("formats validation fields into readable text", () => {
  const parsed = parseApiError(new Error('400: {"message":"Invalid preview request","errors":{"senderEmail":["Invalid email address"]}}'));

  assert.equal(parsed.statusCode, 400);
  assert.deepEqual(parsed.validationFields, ["senderEmail"]);
  assert.equal(parsed.userMessage, "Invalid preview request: senderEmail");
});

test("maps known Gmail setup failures to staff-facing guidance", () => {
  assert.equal(
    getApiErrorMessage(new Error('400: {"message":"BFM Google account is not connected"}'), "preview"),
    "Connect the BFM Google account before previewing mail.",
  );
  assert.equal(
    getApiErrorMessage(new Error('400: {"message":"BFM Google account must be reconnected with https://www.googleapis.com/auth/gmail.readonly"}'), "preview"),
    "Reconnect the BFM Google account to grant Gmail access.",
  );
});

test("maps empty search validation to a staff-facing search prompt", () => {
  assert.equal(
    getApiErrorMessage(new Error('400: {"message":"Invalid preview request","errors":{"searchQuery":["String must contain at least 1 character(s)"]}}'), "preview"),
    "Enter a name, email, or search term.",
  );
});

test("falls back safely for raw non-json responses and redacts sensitive values", () => {
  assert.equal(
    getApiErrorMessage(new Error("500: <html>server exploded</html>"), "detail"),
    "Could not load this email. Please try again.",
  );
  assert.equal(
    getApiErrorMessage(new Error('400: {"message":"Token abc sent to jane@example.com at https://secret.example/invite"}'), "preview"),
    "Could not preview Gmail messages.",
  );
});
