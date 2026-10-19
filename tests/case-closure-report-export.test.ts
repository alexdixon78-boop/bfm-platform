/**
 * Regression tests for anonymised case closure reporting export rows.
 *
 * Run with: npx tsx tests/case-closure-report-export.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCaseClosureExportRow,
  toCaseClosureCsv,
  type CaseClosureExportSourceRow,
} from "../server/services/case-closure-report.service";

test("case closure export rows omit direct identifiers and free-text notes", () => {
  const source: CaseClosureExportSourceRow = {
    caseId: "case-123",
    caseRef: "BFM-2026-0001",
    clientFirstName: "Asha",
    clientLastName: "Patel",
    clientEmail: "asha@example.test",
    clientPhone: "+447700900123",
    closureDetails: "Sensitive notes that should never leave reporting.",
    closedAt: new Date("2026-08-17T09:30:00.000Z"),
    closureReason: "Agreement reached",
    followUpConsentStatus: "declined",
    outreachExcluded: true,
    lifeSatisfaction: 8,
    anxietyScore: null,
    serviceRating: 9,
    netPromoterScore: 10,
    followUpEligibleClients: 1,
    followUpExcludedClients: 1,
    followUpScheduledTasks: 3,
    mediationCategory: "Family",
    familySubType: "Child arrangements (CA)",
    workplaceSubType: null,
    civilSubType: null,
    commercialSubType: null,
    otherSubType: null,
    fundingSource: "Self-funded",
    voucherStatus: "Not eligible",
    inCourtStatus: "No",
    cafcassStatus: "No",
  };

  const row = buildCaseClosureExportRow(source);

  assert.deepEqual(Object.keys(row), [
    "closureMonth",
    "closureReason",
    "followUpConsentStatus",
    "outreachExcluded",
    "lifeSatisfaction",
    "anxietyScore",
    "serviceRating",
    "netPromoterScore",
    "followUpEligibleClients",
    "followUpExcludedClients",
    "followUpScheduledTasks",
    "mediationCategory",
    "caseSubtype",
    "fundingSource",
    "voucherStatus",
    "inCourtStatus",
    "cafcassStatus",
  ]);
  assert.equal(JSON.stringify(row).includes("case-123"), false);
  assert.equal(JSON.stringify(row).includes("BFM-2026-0001"), false);
  assert.equal(JSON.stringify(row).includes("Asha"), false);
  assert.equal(JSON.stringify(row).includes("Sensitive notes"), false);
  assert.equal(row.closureMonth, "2026-08");
  assert.equal(row.outreachExcluded, true);
});

test("case closure CSV export quotes values and does not include identifiers", () => {
  const csv = toCaseClosureCsv([
    buildCaseClosureExportRow({
      caseId: "case-456",
      caseRef: "BFM-2026-0002",
      clientFirstName: "Sam",
      clientLastName: "Jones",
      clientEmail: "sam@example.test",
      clientPhone: "+447700900999",
      closureDetails: "Do not export me",
      closedAt: new Date("2026-08-18T09:30:00.000Z"),
      closureReason: "ELSE (going elsewhere)",
      followUpConsentStatus: "granted",
      outreachExcluded: false,
      lifeSatisfaction: null,
      anxietyScore: 4,
      serviceRating: null,
      netPromoterScore: null,
      followUpEligibleClients: 2,
      followUpExcludedClients: 0,
      followUpScheduledTasks: 6,
      mediationCategory: "Commercial",
      familySubType: null,
      workplaceSubType: null,
      civilSubType: null,
      commercialSubType: "Contract",
      otherSubType: null,
      fundingSource: null,
      voucherStatus: null,
      inCourtStatus: null,
      cafcassStatus: null,
    }),
  ]);

  assert.match(csv, /^closureMonth,closureReason,followUpConsentStatus,outreachExcluded/);
  assert.match(csv, /"ELSE \(going elsewhere\)"/);
  assert.equal(csv.includes("case-456"), false);
  assert.equal(csv.includes("BFM-2026-0002"), false);
  assert.equal(csv.includes("sam@example.test"), false);
  assert.equal(csv.includes("Do not export me"), false);
});
