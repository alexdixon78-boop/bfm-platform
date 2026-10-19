ALTER TABLE "party_required_forms"
  ADD COLUMN IF NOT EXISTS "delivery_status" text NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS "delivery_last_attempted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "delivery_error" text;
