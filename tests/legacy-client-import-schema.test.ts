import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cases,
  legacyClientImportBatches,
  legacyCrmRecordClients,
  legacyCrmRecords,
} from "../shared/schema";

test("exports the legacy import batch, record, and client-link tables", () => {
  assert.equal(legacyClientImportBatches.fileSha256.name, "file_sha256");
  assert.equal(legacyClientImportBatches.legacyCasesCreated.name, "legacy_cases_created");
  assert.equal(legacyCrmRecords.legacyReference.name, "legacy_reference");
  assert.equal(legacyCrmRecords.caseId.name, "case_id");
  assert.equal(legacyCrmRecordClients.clientId.name, "client_id");
  assert.equal(cases.legacySourceSystem.name, "legacy_source_system");
  assert.equal(cases.legacyCaseNumber.name, "legacy_case_number");
});

test("migration installs idempotency indexes and restricted client history links", () => {
  const sql = readFileSync(new URL("../migrations/0041_legacy_client_import.sql", import.meta.url), "utf8");
  assert.match(sql, /legacy_client_import_batches_source_hash_unique/);
  assert.match(sql, /legacy_crm_records_source_record_unique/);
  assert.match(sql, /legacy_crm_records_source_reference_unique/);
  assert.match(sql, /REFERENCES clients\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /batch_id VARCHAR NOT NULL REFERENCES legacy_client_import_batches\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /record_id VARCHAR NOT NULL REFERENCES legacy_crm_records\(id\) ON DELETE RESTRICT/);
});

test("migration adds legacy open-case metadata and links", () => {
  const sql = readFileSync(new URL("../migrations/0060_legacy_open_case_import.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS legacy_source_system TEXT/);
  assert.match(sql, /ALTER TABLE cases ADD COLUMN IF NOT EXISTS legacy_case_number TEXT/);
  assert.match(sql, /ALTER TABLE legacy_crm_records ADD COLUMN IF NOT EXISTS case_id VARCHAR REFERENCES cases\(id\) ON DELETE SET NULL/);
  assert.match(sql, /ALTER TABLE legacy_client_import_batches ADD COLUMN IF NOT EXISTS legacy_cases_created INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /cases_legacy_case_number_idx/);
  assert.match(sql, /legacy_crm_records_case_id_idx/);
});
