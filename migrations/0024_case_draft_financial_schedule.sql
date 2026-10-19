CREATE TABLE IF NOT EXISTS "case_draft_financial_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" varchar,
  "updated_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "case_draft_financial_schedules"
  ADD CONSTRAINT "case_draft_financial_schedules_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_draft_financial_schedules"
  ADD CONSTRAINT "case_draft_financial_schedules_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_draft_financial_schedules"
  ADD CONSTRAINT "case_draft_financial_schedules_updated_by_users_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "case_draft_financial_schedules_case_unique" ON "case_draft_financial_schedules" ("case_id");
CREATE INDEX IF NOT EXISTS "case_draft_financial_schedules_status_idx" ON "case_draft_financial_schedules" ("status");
