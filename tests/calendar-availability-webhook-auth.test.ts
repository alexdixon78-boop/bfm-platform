import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCalendarWebhookToken,
  getCalendarReconciliationRetryDelayMs,
  secureTokenMatches,
} from "../server/services/calendar-availability-webhook";

test("calendar webhook tokens are deterministic and scoped to provider, mediator, and channel", () => {
  const token = deriveCalendarWebhookToken("secret", "google", "mediator-1", "channel-1");
  assert.equal(token, deriveCalendarWebhookToken("secret", "google", "mediator-1", "channel-1"));
  assert.notEqual(token, deriveCalendarWebhookToken("secret", "outlook", "mediator-1", "channel-1"));
  assert.notEqual(token, deriveCalendarWebhookToken("secret", "google", "mediator-2", "channel-1"));
});

test("retry delay uses capped exponential backoff", () => {
  assert.equal(getCalendarReconciliationRetryDelayMs(1), 5_000);
  assert.equal(getCalendarReconciliationRetryDelayMs(2), 10_000);
  assert.equal(getCalendarReconciliationRetryDelayMs(10), 15 * 60_000);
});

test("secure token comparison rejects malformed and changed values", () => {
  const token = deriveCalendarWebhookToken("secret", "google", "mediator-1", "channel-1");
  assert.equal(secureTokenMatches(token, token), true);
  assert.equal(secureTokenMatches(token, `${token}x`), false);
  assert.equal(secureTokenMatches(token, "not-hex"), false);
});
