ALTER TABLE "court_form_templates"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

ALTER TABLE "court_form_templates"
  ADD COLUMN IF NOT EXISTS "deleted_by" varchar;

DO $$ BEGIN
  ALTER TABLE "court_form_templates"
    ADD CONSTRAINT "court_form_templates_deleted_by_users_id_fk"
    FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "court_form_templates_deleted_idx"
  ON "court_form_templates" ("deleted_at");

DROP INDEX IF EXISTS "court_form_templates_type_version_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "court_form_templates_type_version_unique"
  ON "court_form_templates" ("form_type", "version_label")
  WHERE "deleted_at" IS NULL;
