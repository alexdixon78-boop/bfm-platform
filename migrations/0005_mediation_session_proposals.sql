CREATE TABLE IF NOT EXISTS "mediation_session_proposals" (
  "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" VARCHAR NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "mediation_session_id" VARCHAR NOT NULL REFERENCES "mediation_sessions"("id") ON DELETE CASCADE,
  "appointment_id" VARCHAR NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
  "proposed_start_at" TIMESTAMP NOT NULL,
  "proposed_end_at" TIMESTAMP NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'held',
  "voucher_form_required" BOOLEAN NOT NULL DEFAULT false,
  "created_by" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE "mediation_session_proposals"
  ADD COLUMN IF NOT EXISTS "voucher_form_required" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "mediation_session_proposals_appointment_unique"
  ON "mediation_session_proposals" ("appointment_id");
CREATE INDEX IF NOT EXISTS "mediation_session_proposals_session_idx"
  ON "mediation_session_proposals" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "mediation_session_proposals_case_idx"
  ON "mediation_session_proposals" ("case_id");
CREATE INDEX IF NOT EXISTS "mediation_session_proposals_status_idx"
  ON "mediation_session_proposals" ("status");

CREATE TABLE IF NOT EXISTS "mediation_session_proposal_recipients" (
  "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposal_id" VARCHAR NOT NULL REFERENCES "mediation_session_proposals"("id") ON DELETE CASCADE,
  "case_id" VARCHAR NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "mediation_session_id" VARCHAR NOT NULL REFERENCES "mediation_sessions"("id") ON DELETE CASCADE,
  "party_id" VARCHAR REFERENCES "parties"("id") ON DELETE CASCADE,
  "user_id" VARCHAR REFERENCES "users"("id") ON DELETE CASCADE,
  "recipient_type" TEXT NOT NULL,
  "recipient_name" TEXT NOT NULL,
  "recipient_email" TEXT,
  "token_hash" TEXT NOT NULL UNIQUE,
  "response_status" TEXT NOT NULL DEFAULT 'pending',
  "sent_at" TIMESTAMP,
  "viewed_at" TIMESTAMP,
  "responded_at" TIMESTAMP,
  "decline_notes" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "mediation_session_proposal_recipients_proposal_idx"
  ON "mediation_session_proposal_recipients" ("proposal_id");
CREATE INDEX IF NOT EXISTS "mediation_session_proposal_recipients_session_idx"
  ON "mediation_session_proposal_recipients" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "mediation_session_proposal_recipients_response_idx"
  ON "mediation_session_proposal_recipients" ("response_status");

ALTER TABLE "mediation_session_availability_windows"
  ALTER COLUMN "party_id" DROP NOT NULL;
ALTER TABLE "mediation_session_availability_windows"
  ADD COLUMN IF NOT EXISTS "proposal_recipient_id" VARCHAR REFERENCES "mediation_session_proposal_recipients"("id") ON DELETE CASCADE;
