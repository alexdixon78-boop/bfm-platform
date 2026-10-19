CREATE TABLE IF NOT EXISTS "case_closure_party_follow_ups" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "closure_record_id" varchar REFERENCES "case_closure_records"("id") ON DELETE cascade,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "party_id" varchar NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "client_id" varchar NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "consent_status" text NOT NULL,
  "consent_source" text NOT NULL DEFAULT 'closure_admin',
  "exclusion_reason" text,
  "consent_recorded_at" timestamp NOT NULL DEFAULT now(),
  "consent_recorded_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "follow_up_consent_token_hash" text,
  "follow_up_consent_token_expires_at" timestamp,
  "follow_up_consent_request_sent_at" timestamp,
  "follow_up_consent_email_status" text NOT NULL DEFAULT 'not_attempted',
  "follow_up_consent_email_last_error" text,
  "follow_up_consent_decided_at" timestamp,
  "follow_up_consent_decision_source" text,
  "follow_up_tasks_scheduled" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("closure_record_id","party_id")
);

CREATE INDEX IF NOT EXISTS "case_closure_party_follow_ups_case_idx" ON "case_closure_party_follow_ups" ("case_id");
CREATE UNIQUE INDEX IF NOT EXISTS "case_closure_party_follow_ups_case_party_unique" ON "case_closure_party_follow_ups" ("case_id", "party_id");
CREATE UNIQUE INDEX IF NOT EXISTS "case_closure_party_follow_ups_token_hash_unique" ON "case_closure_party_follow_ups" ("follow_up_consent_token_hash") WHERE "follow_up_consent_token_hash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "case_closure_party_follow_ups_party_idx" ON "case_closure_party_follow_ups" ("party_id");
CREATE INDEX IF NOT EXISTS "case_closure_party_follow_ups_client_idx" ON "case_closure_party_follow_ups" ("client_id");
CREATE INDEX IF NOT EXISTS "case_closure_party_follow_ups_consent_idx" ON "case_closure_party_follow_ups" ("consent_status");
