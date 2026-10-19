ALTER TABLE "mediation_session_participants"
  ADD COLUMN IF NOT EXISTS "invitation_status" text NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS "invitation_token_hash" text UNIQUE,
  ADD COLUMN IF NOT EXISTS "invitation_sent_at" timestamp,
  ADD COLUMN IF NOT EXISTS "invitation_viewed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "invitation_responded_at" timestamp,
  ADD COLUMN IF NOT EXISTS "invitation_decline_notes" text;

ALTER TABLE "mediation_session_proposal_recipients"
  ADD COLUMN IF NOT EXISTS "participant_id" varchar REFERENCES "mediation_session_participants"("id") ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS "participant_role" text;
