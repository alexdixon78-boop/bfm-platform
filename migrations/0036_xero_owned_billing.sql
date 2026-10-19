ALTER TABLE xero_invoice_records
  ADD COLUMN IF NOT EXISTS case_invoice_id varchar REFERENCES case_invoices(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS xero_invoice_records_appointment_unique_idx;

CREATE INDEX IF NOT EXISTS "xero_invoice_records_appointment_idx"
  ON "xero_invoice_records" ("appointment_id");

CREATE UNIQUE INDEX IF NOT EXISTS "xero_invoice_records_case_invoice_unique_idx"
  ON "xero_invoice_records" ("case_invoice_id")
  WHERE "case_invoice_id" IS NOT NULL;
