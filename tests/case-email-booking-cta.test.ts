import test from "node:test";
import assert from "node:assert/strict";
import { ensureBookingCta } from "../server/services/case-email-booking-cta";

test("ensureBookingCta upgrades an existing booking link and includes a readable fallback URL", () => {
  const result = ensureBookingCta(
    '<p>Please <a href="https://app.example.test/book/token">book now</a>.</p>',
    "https://app.example.test/book/token",
  );

  assert.match(result, /Book your MIAM appointment/);
  assert.match(result, /background-color: #5a7d58/);
  assert.match(result, /If the button does not work/);
  assert.equal((result.match(/href="https:\/\/app\.example\.test\/book\/token"/g) || []).length, 2);
});

test("ensureBookingCta appends one booking button when the template has no booking link", () => {
  const result = ensureBookingCta("<p>Hello client.</p>", "https://app.example.test/book/token");

  assert.match(result, /Hello client/);
  assert.match(result, /Book your MIAM appointment/);
  assert.equal((result.match(/Book your MIAM appointment/g) || []).length, 1);
});
