CREATE TABLE IF NOT EXISTS "case_draft_financial_schedule_versions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" varchar NOT NULL REFERENCES "case_draft_financial_schedules"("id") ON DELETE CASCADE,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "status" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "edited_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "edited_at" timestamp NOT NULL DEFAULT NOW(),
  "source" text NOT NULL,
  "confirmed_in_session_id" varchar REFERENCES "mediation_sessions"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_draft_financial_schedule_versions_schedule_version_unique"
  ON "case_draft_financial_schedule_versions"("schedule_id", "version_number");

CREATE INDEX IF NOT EXISTS "case_draft_financial_schedule_versions_schedule_idx"
  ON "case_draft_financial_schedule_versions"("schedule_id");

CREATE INDEX IF NOT EXISTS "case_draft_financial_schedule_versions_case_idx"
  ON "case_draft_financial_schedule_versions"("case_id");

CREATE INDEX IF NOT EXISTS "case_draft_financial_schedule_versions_edited_at_idx"
  ON "case_draft_financial_schedule_versions"("edited_at");
