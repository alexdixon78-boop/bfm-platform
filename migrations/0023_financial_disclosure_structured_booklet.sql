ALTER TABLE "case_documents"
  ADD COLUMN IF NOT EXISTS "document_date" timestamp,
  ADD COLUMN IF NOT EXISTS "file_size_bytes" integer;

CREATE TABLE IF NOT EXISTS "financial_disclosure_booklet_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "version_label" text NOT NULL,
  "source_file_name" text NOT NULL,
  "source_file_url" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  "is_current" boolean NOT NULL DEFAULT false,
  "placeholder_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "uploaded_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "uploaded_at" timestamp NOT NULL DEFAULT now(),
  "notes" text
);

CREATE INDEX IF NOT EXISTS "financial_disclosure_booklet_templates_current_idx" ON "financial_disclosure_booklet_templates" ("is_current");
CREATE UNIQUE INDEX IF NOT EXISTS "financial_disclosure_booklet_templates_version_unique" ON "financial_disclosure_booklet_templates" ("version_label");
