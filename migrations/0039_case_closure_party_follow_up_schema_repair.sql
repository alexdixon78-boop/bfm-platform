ALTER TABLE "case_closure_party_follow_ups"
  ALTER COLUMN "closure_record_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_token_hash" text;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_token_expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_request_sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_email_status" text;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_email_last_error" text;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_decided_at" timestamp;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ADD COLUMN IF NOT EXISTS "follow_up_consent_decision_source" text;
--> statement-breakpoint
UPDATE "case_closure_party_follow_ups"
SET "follow_up_consent_email_status" = 'not_attempted'
WHERE "follow_up_consent_email_status" IS NULL;
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ALTER COLUMN "follow_up_consent_email_status" SET DEFAULT 'not_attempted';
--> statement-breakpoint
ALTER TABLE "case_closure_party_follow_ups"
  ALTER COLUMN "follow_up_consent_email_status" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "case_closure_party_follow_ups"
    GROUP BY "case_id", "party_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'case_closure_party_follow_ups contains duplicate (case_id, party_id) rows; manual resolution is required before migration 0039 can continue';
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "case_closure_party_follow_ups"
    WHERE "follow_up_consent_token_hash" IS NOT NULL
    GROUP BY "follow_up_consent_token_hash"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'case_closure_party_follow_ups contains duplicate non-null follow_up_consent_token_hash values; manual resolution is required before migration 0039 can continue';
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_closure_party_follow_ups_case_party_unique"
  ON "case_closure_party_follow_ups" ("case_id", "party_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_closure_party_follow_ups_token_hash_unique"
  ON "case_closure_party_follow_ups" ("follow_up_consent_token_hash")
  WHERE "follow_up_consent_token_hash" IS NOT NULL;
