import assert from "node:assert/strict";
import test from "node:test";
import { isConfidentialResponsePath } from "../server/logger";

test("all complaint response paths suppress body logging case-insensitively", () => {
  assert.equal(isConfidentialResponsePath("/api/complaints"), true);
  assert.equal(isConfidentialResponsePath("/api/Complaints/id/notes"), true);
  assert.equal(isConfidentialResponsePath("/api/complaint-attachments/id/download"), true);
  assert.equal(isConfidentialResponsePath("/api/cases/id/Complaints"), true);
  assert.equal(isConfidentialResponsePath("/api/cases/id"), false);
});
