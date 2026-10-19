ALTER TABLE "court_form_templates"
  ADD COLUMN IF NOT EXISTS "field_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL;
