import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ExcelJS from "exceljs";
import type { LegacyClientProfile } from "../server/services/legacy-client-import.workbook";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const {
  activeLegacyImportResolutions,
  createLegacyPreviewFingerprint,
  fillBlankLegacyClientFields,
  legacyClientImportService,
  normalizeReviewedLegacyProfile,
  validateLegacyPersonCorrections,
  validateLegacyRecordCorrections,
  validateLegacyImportResolutions,
} = await import("../server/services/legacy-client-import.service");

const profile: LegacyClientProfile = {
  firstName: "Alice",
  lastName: "Able",
  dateOfBirth: "1990-01-02",
  email: "alice@example.test",
  phone: "7700900123",
  phoneCode: "+44",
  gender: "Woman",
  ethnicOrigin: null,
  nationalInsuranceNumber: null,
  disabilityOrHealthCondition: null,
  additionalNeeds: "Interpreter",
  addressLine1: null,
  addressLine2: null,
  city: "London",
  postcode: null,
  country: "United Kingdom",
};

test("fills only blank existing client fields", () => {
  const result = fillBlankLegacyClientFields(
    {
      ...profile,
      email: "kept@example.test",
      phone: null,
      additionalNeeds: "",
      city: "Manchester",
    },
    profile,
  );

  assert.deepEqual(result.values, {
    phone: "7700900123",
    additionalNeeds: "Interpreter",
  });
  assert.equal(result.changedFields.includes("email"), false);
  assert.equal(result.changedFields.includes("city"), false);
});

test("requires each staged person exactly once in commit resolutions", () => {
  assert.throws(
    () =>
      validateLegacyImportResolutions(
        ["row-2:client_1", "row-3:client_1"],
        [
          {
            targetKey: "new-a",
            action: "create_new",
            memberKeys: ["row-2:client_1"],
            clientData: profile,
          },
        ],
      ),
    /row-3:client_1/,
  );

  assert.throws(
    () =>
      validateLegacyImportResolutions(
        ["row-2:client_1"],
        [
          {
            targetKey: "new-a",
            action: "create_new",
            memberKeys: ["row-2:client_1"],
            clientData: profile,
          },
          {
            targetKey: "skip-a",
            action: "skip",
            memberKeys: ["row-2:client_1"],
          },
        ],
      ),
    /more than once/,
  );
});

test("blocks conflicting create-new emails and impossible reviewed dates before commit", () => {
  assert.throws(
    () =>
      validateLegacyImportResolutions(
        ["a", "b"],
        [
          {
            targetKey: "new-a",
            action: "create_new",
            memberKeys: ["a"],
            clientData: profile,
          },
          {
            targetKey: "new-b",
            action: "create_new",
            memberKeys: ["b"],
            clientData: {
              ...profile,
              firstName: "Annie",
              email: "ALICE@example.test",
            },
          },
        ],
      ),
    /email.*more than one new client/i,
  );

  assert.throws(
    () =>
      validateLegacyImportResolutions(
        ["a"],
        [
          {
            targetKey: "new-a",
            action: "create_new",
            memberKeys: ["a"],
            clientData: { ...profile, dateOfBirth: "2025-02-31" },
          },
        ],
      ),
    /date of birth/i,
  );
});

test("ignores skipped rows when evaluating active duplicate conflicts", () => {
  const active = activeLegacyImportResolutions([
    {
      targetKey: "skip-a",
      action: "skip",
      memberKeys: ["row-1:client_1"],
      clientData: { ...profile, email: "duplicate@example.test" },
    },
    {
      targetKey: "new-b",
      action: "create_new",
      memberKeys: ["row-2:client_1"],
      clientData: { ...profile, firstName: "Berta", email: "new@example.test" },
    },
    {
      targetKey: "existing-c",
      action: "use_existing",
      memberKeys: ["row-3:client_1"],
      existingClientId: "client-123",
      clientData: { ...profile, email: "new@example.test" },
    },
  ]);

  assert.deepEqual(
    active.map((resolution) => resolution.targetKey),
    ["new-b", "existing-c"],
  );
});

test("fingerprints are stable across object-key order and change with reviewed data", () => {
  const first = createLegacyPreviewFingerprint({ b: 2, a: { y: 2, x: 1 } });
  const second = createLegacyPreviewFingerprint({ a: { x: 1, y: 2 }, b: 2 });
  const changed = createLegacyPreviewFingerprint({ a: { x: 1, y: 3 }, b: 2 });
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("reviewed client data is normalised and allowlisted before database writes", () => {
  const normalized = normalizeReviewedLegacyProfile({
    ...profile,
    firstName: "  Alice  ",
    email: " ALICE@EXAMPLE.TEST ",
    rogueAdminField: "must-not-pass",
  } as LegacyClientProfile & { rogueAdminField: string });

  assert.equal(normalized.firstName, "Alice");
  assert.equal(normalized.email, "alice@example.test");
  assert.equal("rogueAdminField" in normalized, false);
});

test("mapped record formulas require an explicit reviewed correction", () => {
  const records = [
    {
      sourceRowNumber: 2,
      legacyReference: "REF-1",
      sourceRecordId: "old-1",
      originalValues: {},
      safeValues: { leadSource: "WEB" },
      errors: [
        {
          code: "formula_cell",
          message: "formula",
          field: "leadSource" as const,
        },
      ],
    },
  ];
  assert.throws(
    () => validateLegacyRecordCorrections(records, new Set([2]), new Map()),
    /leadSource/,
  );
  assert.doesNotThrow(() =>
    validateLegacyRecordCorrections(
      records,
      new Set([2]),
      new Map([[2, { leadSource: "Website" }]]),
    ),
  );
});

test("mapped person formulas require a reviewed profile or history-only correction", () => {
  const people = [
    {
      personKey: "row-2:client_1",
      sourceRowNumber: 2,
      sourceRole: "client_1" as const,
      legacyReference: "REF-1",
      profile,
      originalValues: {},
      legacyOnlyValues: {},
      warnings: [],
      errors: [
        {
          code: "formula_cell",
          message: "formula",
          field: "client1FirstName" as const,
        },
      ],
    },
  ];
  const resolution = {
    targetKey: "new",
    action: "create_new" as const,
    memberKeys: [people[0].personKey],
    clientData: profile,
  };
  assert.throws(
    () => validateLegacyPersonCorrections(people, [resolution], new Map()),
    /firstName/,
  );
  assert.doesNotThrow(() =>
    validateLegacyPersonCorrections(
      people,
      [{ ...resolution, reviewedFields: ["firstName"] }],
      new Map(),
    ),
  );
});

test("prior-batch warnings stay informational and do not hard-block the import review", () => {
  const serviceSource = readFileSync(
    new URL(
      "../server/services/legacy-client-import.service.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(serviceSource, /previousBatch/);
  assert.doesNotMatch(serviceSource, /if \(conflicts\.previousBatch\)/);
  assert.doesNotMatch(
    serviceSource,
    /This workbook was already imported as batch/,
  );
});

test("inspection reports every mapping target and placeholder candidates before preview", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Legacy clients");
  sheet.addRow([
    "custom_case_id",
    "client_1_firstname",
    "client_1_lastname",
    "client_1_email",
  ]);
  for (let index = 1; index <= 10; index += 1) {
    sheet.addRow([
      `REF-${index}`,
      `First${index}`,
      "Person",
      "placeholder@example.test",
    ]);
  }
  const contentBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString(
    "base64",
  );
  const inspected = await legacyClientImportService.inspect({
    fileName: "legacy.xlsx",
    contentBase64,
  });

  assert.ok(
    inspected.mappingTargets.some(
      (target) =>
        target.key === "client2FirstName" &&
        target.label === "First name" &&
        target.section === "Client 2" &&
        target.required === false,
    ),
  );
  assert.deepEqual(inspected.placeholderCandidates, [
    { kind: "email", value: "placeholder@example.test", count: 10 },
  ]);
});
