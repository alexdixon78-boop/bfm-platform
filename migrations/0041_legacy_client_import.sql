CREATE TABLE IF NOT EXISTS legacy_client_import_batches (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL DEFAULT 'owner_old_crm',
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  selected_sheet TEXT NOT NULL,
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_placeholders JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_row_count INTEGER NOT NULL,
  staged_person_count INTEGER NOT NULL,
  clients_created INTEGER NOT NULL DEFAULT 0,
  clients_linked INTEGER NOT NULL DEFAULT 0,
  clients_updated INTEGER NOT NULL DEFAULT 0,
  legacy_records_created INTEGER NOT NULL DEFAULT 0,
  skipped_people INTEGER NOT NULL DEFAULT 0,
  imported_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_client_import_batches_source_hash_unique ON legacy_client_import_batches(source_system, file_sha256);
CREATE INDEX IF NOT EXISTS legacy_client_import_batches_imported_at_idx ON legacy_client_import_batches(imported_at);

CREATE TABLE IF NOT EXISTS legacy_crm_records (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id VARCHAR NOT NULL REFERENCES legacy_client_import_batches(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL DEFAULT 'owner_old_crm',
  source_row_number INTEGER NOT NULL,
  source_record_id TEXT,
  legacy_reference TEXT NOT NULL,
  enquiry_date TEXT,
  lead_source TEXT,
  mediation_type TEXT,
  custom_mediation_type TEXT,
  legacy_status TEXT,
  closure_outcome TEXT,
  closed_at TEXT,
  reopened_at TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  mediator_name TEXT,
  mediator_email TEXT,
  mediator_company TEXT,
  original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  corrected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_crm_records_source_record_unique ON legacy_crm_records(source_system, source_record_id) WHERE source_record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS legacy_crm_records_source_reference_unique ON legacy_crm_records(source_system, legacy_reference);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_crm_records_batch_row_unique ON legacy_crm_records(batch_id, source_row_number);
CREATE INDEX IF NOT EXISTS legacy_crm_records_batch_idx ON legacy_crm_records(batch_id);

CREATE TABLE IF NOT EXISTS legacy_crm_record_clients (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id VARCHAR NOT NULL REFERENCES legacy_crm_records(id) ON DELETE RESTRICT,
  client_id VARCHAR NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  source_role TEXT NOT NULL,
  original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  legacy_only_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  corrected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT legacy_crm_record_clients_source_role_check CHECK (source_role IN ('client_1', 'client_2'))
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_crm_record_clients_record_role_unique ON legacy_crm_record_clients(record_id, source_role);
CREATE INDEX IF NOT EXISTS legacy_crm_record_clients_client_idx ON legacy_crm_record_clients(client_id);
