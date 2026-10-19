ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "post_session_review_status" text DEFAULT 'not_submitted' NOT NULL;

ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "post_session_review_requested_by" varchar;

ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "post_session_review_requested_at" timestamp;

ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "post_session_reviewed_by" varchar;

ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "post_session_reviewed_at" timestamp;

ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "post_session_review_notes" text;

DO $$ BEGIN
  ALTER TABLE "mediation_sessions"
  ADD CONSTRAINT "mediation_sessions_post_session_review_requested_by_users_id_fk"
  FOREIGN KEY ("post_session_review_requested_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "mediation_sessions"
  ADD CONSTRAINT "mediation_sessions_post_session_reviewed_by_users_id_fk"
  FOREIGN KEY ("post_session_reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

UPDATE "mediation_sessions"
SET "post_session_review_status" = 'approved',
    "post_session_reviewed_at" = COALESCE("completed_at", "summary_submitted_at", "updated_at"),
    "post_session_reviewed_by" = COALESCE("completed_by", "summary_submitted_by")
WHERE "status" = 'completed'
  AND "post_session_review_status" = 'not_submitted';

CREATE INDEX IF NOT EXISTS "mediation_sessions_post_session_review_status_idx"
  ON "mediation_sessions" ("post_session_review_status");
