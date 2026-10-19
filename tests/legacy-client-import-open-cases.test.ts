import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isLegacyOpenCaseStatus } from "../server/services/legacy-client-import.open-cases";

const importService = readFileSync(new URL("../server/services/legacy-client-import.service.ts", import.meta.url), "utf8");

test("legacy open case status normalization is exact", () => {
  for (const value of ["open", "Open", " OPEN "]) {
    assert.equal(isLegacyOpenCaseStatus(value), true);
  }
  for (const value of ["active", "closed", "", null, undefined, "reopened", "in progress"]) {
    assert.equal(isLegacyOpenCaseStatus(value), false);
  }
});

test("legacy import creates active enquiry-stage cases without operational side effects", () => {
  assert.match(importService, /stage: "Enquiry"/);
  assert.match(importService, /status: "Active"/);
  assert.match(importService, /intakeStatus: "New"/);
  assert.match(importService, /safeguardingStatus: "pending"/);
  assert.doesNotMatch(importService, /insert\(enquiries\)/);
  assert.doesNotMatch(importService, /insert\(notifications\)/);
  assert.doesNotMatch(importService, /insert\(users\)/);
  assert.doesNotMatch(importService, /insert\(appointments\)/);
});
