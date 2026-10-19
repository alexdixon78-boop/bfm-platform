import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  inspectLegacyWorkbook,
  normalizeLegacyDate,
  normalizeLegacyPhone,
  parseLegacyWorkbook,
} from "../server/services/legacy-client-import.workbook";

async function workbookBase64(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Legacy clients");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
}

test("inspects an xlsx and suggests the known old-CRM mappings", async () => {
  const contentBase64 = await workbookBase64([
    ["custom_case_id", "client_1_firstname", "client_1_lastname", "client_1_email"],
    ["AA-2601-001", "Alice", "Able", "ALICE@EXAMPLE.TEST"],
  ]);

  const result = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });

  assert.equal(result.sheets[0].name, "Legacy clients");
  assert.equal(result.sheets[0].dataRowCount, 1);
  assert.equal(result.suggestedMapping.legacyReference, "custom_case_id");
  assert.equal(result.suggestedMapping.client1FirstName, "client_1_firstname");
  assert.equal(result.suggestedMapping.client1LastName, "client_1_lastname");
  assert.equal(result.suggestedMapping.client1Email, "client_1_email");
  assert.deepEqual(
    result.mappingTargets.find((target) => target.key === "legacyReference"),
    {
      key: "legacyReference",
      label: "Legacy reference",
      section: "Legacy record",
      required: true,
    },
  );
  assert.deepEqual(
    result.mappingTargets.find((target) => target.key === "client1FirstName"),
    {
      key: "client1FirstName",
      label: "First name",
      section: "Client 1",
      required: true,
    },
  );
});

test("permanently excludes sensitive integration and payment headers", async () => {
  const contentBase64 = await workbookBase64([
    ["custom_case_id", "client_1_firstname", "client_1_lastname", "bank_details", "payment_method", "integration_payload", "external_token", "password_hash"],
    ["REF-1", "Alice", "Able", "secret", "pm_1", "{}", "token", "hash"],
  ]);
  const result = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });

  assert.deepEqual(result.ignoredHeaders, ["bank_details", "payment_method", "integration_payload", "external_token", "password_hash"]);
  assert.ok(result.ignoredHeaders.every((header) => !result.unmappedHeaders.includes(header)));
});

test("normalises UK-local ISO dates, UK text dates, Excel serials, and phones", () => {
  assert.equal(normalizeLegacyDate("1995-05-01T23:00:00.000Z"), "1995-05-02");
  assert.equal(normalizeLegacyDate("28/01/1983"), "1983-01-28");
  assert.equal(normalizeLegacyDate(36501), "1999-12-07");
  assert.equal(normalizeLegacyDate("2025-02-31"), null);
  assert.deepEqual(normalizeLegacyPhone("7.985777777E9", "44.0"), {
    phone: "7985777777",
    phoneCode: "+44",
  });
});

test("parses clients, detects repeated placeholders, and blocks mapped formula cells", async () => {
  const header = ["custom_case_id", "client_1_firstname", "client_1_lastname", "client_1_email"];
  const rows: unknown[][] = [header];
  for (let index = 1; index <= 10; index += 1) {
    rows.push([`AA-2601-${String(index).padStart(3, "0")}`, `Person${index}`, "Example", "dummy@example.test"]);
  }
  const contentBase64 = await workbookBase64(rows);
  const inspected = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });
  const parsed = await parseLegacyWorkbook({
    fileName: "legacy.xlsx",
    contentBase64,
    sheetName: "Legacy clients",
    mapping: inspected.suggestedMapping,
    confirmedPlaceholders: [],
  });

  assert.deepEqual(parsed.placeholderCandidates, [{ kind: "email", value: "dummy@example.test", count: 10 }]);
  assert.equal(parsed.people.length, 10);
  assert.equal(parsed.people[0].profile.email, "dummy@example.test");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Legacy clients");
  sheet.addRow(header);
  sheet.addRow(["AA-2601-999", { formula: '="Ali"&"ce"', result: "Alice" }, "Able", "alice@example.test"]);
  const formulaFile = Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
  const formulaParsed = await parseLegacyWorkbook({
    fileName: "legacy.xlsx",
    contentBase64: formulaFile,
    sheetName: "Legacy clients",
    mapping: inspected.suggestedMapping,
    confirmedPlaceholders: [],
  });

  assert.ok(formulaParsed.people[0].errors.some((error) => error.code === "formula_cell"));
});

test("blocks formulas in mapped record-level fields", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Legacy clients");
  sheet.addRow(["custom_case_id", "lead_source", "client_1_firstname", "client_1_lastname"]);
  sheet.addRow(["AA-2601-999", { formula: '=UPPER("web")', result: "WEB" }, "Alice", "Able"]);
  const contentBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
  const inspected = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });
  const parsed = await parseLegacyWorkbook({
    fileName: "legacy.xlsx",
    contentBase64,
    sheetName: "Legacy clients",
    mapping: inspected.suggestedMapping,
    confirmedPlaceholders: [],
  });

  assert.ok(parsed.people[0].errors.some((error) => error.code === "formula_cell" && error.field === "leadSource"));
});

test("normalises safe record dates while retaining their original source text", async () => {
  const contentBase64 = await workbookBase64([
    ["custom_case_id", "enquiry_date", "closed_at", "client_1_firstname", "client_1_lastname", "client_1_assessment_date"],
    ["REF-1", "2025-01-01T23:00:00.000Z", "28/02/2025", "Alice", "Able", 45658],
  ]);
  const inspected = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });
  const parsed = await parseLegacyWorkbook({
    fileName: "legacy.xlsx", contentBase64, sheetName: "Legacy clients",
    mapping: inspected.suggestedMapping, confirmedPlaceholders: [],
  });

  assert.equal(parsed.records[0].safeValues.enquiryDate, "2025-01-01");
  assert.equal(parsed.records[0].safeValues.closedAt, "2025-02-28");
  assert.equal(parsed.records[0].originalValues.closedAt, "28/02/2025");
  assert.equal(parsed.people[0].legacyOnlyValues.assessmentDate, "2025-01-01");
});

test("maps curated old-CRM demographic aliases and leaves unknown values in history", async () => {
  const contentBase64 = await workbookBase64([
    ["custom_case_id", "client_1_firstname", "client_1_lastname", "client_1_gender", "client_1_ethnic_origin_formatted", "client_1_disability_formatted"],
    ["REF-1", "Alice", "Able", "Female", "Asian or Asian British Pakistani (07)", "Hearing impaired (HEA)"],
    ["REF-2", "Bob", "Baker", "Unlisted", "Unknown (99)", "Mystery value"],
  ]);
  const inspected = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });
  const parsed = await parseLegacyWorkbook({
    fileName: "legacy.xlsx",
    contentBase64,
    sheetName: "Legacy clients",
    mapping: inspected.suggestedMapping,
    confirmedPlaceholders: [],
  });

  assert.equal(parsed.people[0].profile.gender, "Woman");
  assert.equal(parsed.people[0].profile.ethnicOrigin, "Asian - Pakistani");
  assert.equal(parsed.people[0].profile.disabilityOrHealthCondition, "Deafness or partial hearing");
  assert.equal(parsed.people[1].profile.gender, null);
  assert.equal(parsed.people[1].profile.ethnicOrigin, null);
  assert.equal(parsed.people[1].profile.disabilityOrHealthCondition, null);
  assert.ok(parsed.people[1].warnings.some((error) => error.code === "unmapped_ethnic_origin"));
  assert.ok(parsed.people[1].warnings.some((error) => error.code === "unmapped_disability"));
});

test("parses the supplied-workbook shape of 506 rows into 761 people", async () => {
  const rows: unknown[][] = [["custom_case_id", "client_1_firstname", "client_1_lastname", "client_2_firstname", "client_2_lastname"]];
  for (let index = 1; index <= 506; index += 1) {
    rows.push([`REF-${index}`, `First${index}`, "Primary", index <= 255 ? `Second${index}` : null, index <= 255 ? "Secondary" : null]);
  }
  const contentBase64 = await workbookBase64(rows);
  const inspected = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64 });
  const parsed = await parseLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64, sheetName: "Legacy clients", mapping: inspected.suggestedMapping, confirmedPlaceholders: [] });

  assert.equal(parsed.records.length, 506);
  assert.equal(parsed.people.length, 761);
});

test("lists additional worksheets and enforces workbook size, row, and column limits", async () => {
  const multi = new ExcelJS.Workbook();
  multi.addWorksheet("First").addRow(["custom_case_id", "client_1_firstname", "client_1_lastname"]);
  multi.addWorksheet("Second").addRow(["different_header"]);
  const multiResult = await inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64: Buffer.from(await multi.xlsx.writeBuffer()).toString("base64") });
  assert.deepEqual(multiResult.sheets.map((sheet) => sheet.name), ["First", "Second"]);

  const wide = new ExcelJS.Workbook();
  wide.addWorksheet("Wide").addRow(Array.from({ length: 201 }, (_, index) => `column_${index}`));
  const wideBase64 = Buffer.from(await wide.xlsx.writeBuffer()).toString("base64");
  await assert.rejects(() => inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64: wideBase64 }), /200 columns/);

  const tall = new ExcelJS.Workbook();
  const tallSheet = tall.addWorksheet("Tall");
  tallSheet.addRow(["custom_case_id"]);
  for (let index = 0; index < 5_001; index += 1) tallSheet.addRow([`REF-${index}`]);
  const tallBase64 = Buffer.from(await tall.xlsx.writeBuffer()).toString("base64");
  await assert.rejects(() => inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64: tallBase64 }), /5,000 data rows/);

  await assert.rejects(() => inspectLegacyWorkbook({ fileName: "legacy.xlsx", contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }), /10 MB/);
});
