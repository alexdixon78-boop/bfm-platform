ALTER TABLE "case_draft_financial_schedules"
  ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp;

ALTER TABLE "case_draft_financial_schedules"
  ADD COLUMN IF NOT EXISTS "confirmed_by" varchar;

ALTER TABLE "case_draft_financial_schedules"
  ADD COLUMN IF NOT EXISTS "confirmed_in_session_id" varchar;

DO $$ BEGIN
  ALTER TABLE "case_draft_financial_schedules"
  ADD CONSTRAINT "case_draft_financial_schedules_confirmed_by_users_id_fk"
  FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_draft_financial_schedules"
  ADD CONSTRAINT "case_draft_financial_schedules_confirmed_in_session_id_mediation_sessions_id_fk"
  FOREIGN KEY ("confirmed_in_session_id") REFERENCES "mediation_sessions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
