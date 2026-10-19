-- Preserve historic case-level schedules while making new schedules session-scoped.
ALTER TABLE "case_draft_financial_schedules"
  ADD COLUMN IF NOT EXISTS "mediation_session_id" varchar;

DO $$ BEGIN
  ALTER TABLE "case_draft_financial_schedules"
    ADD CONSTRAINT "case_draft_financial_schedules_mediation_session_id_mediation_sessions_id_fk"
    FOREIGN KEY ("mediation_session_id") REFERENCES "mediation_sessions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

UPDATE "case_draft_financial_schedules"
SET "mediation_session_id" = "confirmed_in_session_id"
WHERE "mediation_session_id" IS NULL AND "confirmed_in_session_id" IS NOT NULL;

DROP INDEX IF EXISTS "case_draft_financial_schedules_case_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "case_draft_financial_schedules_session_unique"
  ON "case_draft_financial_schedules" ("mediation_session_id")
  WHERE "mediation_session_id" IS NOT NULL;
