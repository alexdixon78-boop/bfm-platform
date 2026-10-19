/**
 * Regression checks for case-linked email subjects and calendar titles.
 *
 * Run with: npx tsx tests/case-communication-format.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCaseEmailSubject,
  formatMiamCalendarTitle,
  formatSessionCalendarTitle,
} from "../server/utils/case-communication-format";

test("case email subjects append one canonical bracketed case reference", () => {
  assert.equal(
    formatCaseEmailSubject("Appointment Confirmed: MIAM", "BFM-2026-0001"),
    "Appointment Confirmed: MIAM [BFM-2026-0001]",
  );
  assert.equal(
    formatCaseEmailSubject("Appointment Confirmed: MIAM [BFM-2026-0001]", "BFM-2026-0001"),
    "Appointment Confirmed: MIAM [BFM-2026-0001]",
  );
  assert.equal(
    formatCaseEmailSubject("Appointment Confirmed: MIAM - BFM-2026-0001", "BFM-2026-0001"),
    "Appointment Confirmed: MIAM [BFM-2026-0001]",
  );
  assert.equal(
    formatCaseEmailSubject("Appointment Confirmed: MIAM — BFM-2026-0001", "BFM-2026-0001"),
    "Appointment Confirmed: MIAM [BFM-2026-0001]",
  );
  assert.equal(
    formatCaseEmailSubject("Reset Your Password — Brighter Future Mediation"),
    "Reset Your Password — Brighter Future Mediation",
  );
});

test("calendar titles use mediator, client names, and canonical case reference", () => {
  assert.equal(
    formatMiamCalendarTitle({
      mediatorName: "Rebecca Jones",
      clientFirstName: "Amelia",
      caseRef: "BFM-2026-0001",
    }),
    "MIAM - Rebecca - Amelia [BFM-2026-0001]",
  );
  assert.equal(
    formatMiamCalendarTitle({
      mediatorName: "",
      clientFirstName: "",
      caseRef: "BFM-2026-0001-A",
    }),
    "MIAM - Mediator - Client [BFM-2026-0001]",
  );
  assert.equal(
    formatSessionCalendarTitle({
      mediatorName: "Rebecca Jones",
      clientAFirstName: "Amelia",
      clientBFirstName: "Noah",
      caseRef: "BFM-2026-0001",
    }),
    "Session - Rebecca - Amelia and Noah [BFM-2026-0001]",
  );
  assert.equal(
    formatSessionCalendarTitle({
      mediatorName: "Rebecca Jones",
      clientAFirstName: "",
      clientBFirstName: "",
      caseRef: "BFM-2026-0001-B",
    }),
    "Session - Rebecca - Client A and Client B [BFM-2026-0001]",
  );
});
