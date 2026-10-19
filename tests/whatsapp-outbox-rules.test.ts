import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHATSAPP_OUTBOX_LEASE_MS,
  getWhatsappOutboxFailureDecision,
  getWhatsappOutboxLeaseExpiry,
} from "../server/services/whatsapp-outbox-rules";

const now = new Date("2026-09-28T12:00:00.000Z");

test("leases an outbox attempt for five minutes", () => {
  assert.equal(
    getWhatsappOutboxLeaseExpiry(now).getTime(),
    now.getTime() + WHATSAPP_OUTBOX_LEASE_MS,
  );
});

test("retries transient HTTP and Meta provider failures with exponential backoff", () => {
  const cases = [
    { httpStatus: 408 },
    { httpStatus: 429 },
    { httpStatus: 503 },
    { httpStatus: 400, providerCode: 130429 },
    { httpStatus: 400, providerCode: 131000 },
    { httpStatus: 400, providerCode: 131048 },
    { httpStatus: 400, providerCode: 131056 },
  ];

  for (const input of cases) {
    const decision = getWhatsappOutboxFailureDecision({
      ...input,
      retryCount: 0,
      now,
    });
    assert.equal(decision.status, "pending");
    assert.equal(decision.retryCount, 1);
    assert.equal(decision.nextAttemptAt.getTime(), now.getTime() + 60_000);
  }
});

test("uses 1, 2, 4, 8 and 16 minute retry delays", () => {
  const delays = [0, 1, 2, 3, 4].map((retryCount) => {
    const result = getWhatsappOutboxFailureDecision({
      httpStatus: 503,
      retryCount,
      now,
    });
    return result.nextAttemptAt.getTime() - now.getTime();
  });

  assert.deepEqual(delays, [1, 2, 4, 8, 16].map((minutes) => minutes * 60_000));
});

test("stops after six total attempts", () => {
  const decision = getWhatsappOutboxFailureDecision({
    httpStatus: 503,
    retryCount: 5,
    now,
  });

  assert.equal(decision.status, "failed");
  assert.equal(decision.retryCount, 6);
});

test("marks permanent Meta errors such as 131030 failed immediately", () => {
  const decision = getWhatsappOutboxFailureDecision({
    httpStatus: 400,
    providerCode: 131030,
    retryCount: 0,
    now,
  });

  assert.equal(decision.status, "failed");
  assert.equal(decision.retryCount, 1);
});
