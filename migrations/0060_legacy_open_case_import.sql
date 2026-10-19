ALTER TABLE cases ADD COLUMN IF NOT EXISTS legacy_source_system TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS legacy_case_number TEXT;

ALTER TABLE legacy_client_import_batches ADD COLUMN IF NOT EXISTS legacy_cases_created INTEGER NOT NULL DEFAULT 0;

ALTER TABLE legacy_crm_records ADD COLUMN IF NOT EXISTS case_id VARCHAR REFERENCES cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cases_legacy_case_number_idx
  ON cases(legacy_source_system, legacy_case_number)
  WHERE legacy_case_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS legacy_crm_records_case_id_idx
  ON legacy_crm_records(case_id);
