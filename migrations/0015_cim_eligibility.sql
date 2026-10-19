ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "cim_eligible" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "cim_eligibility_marked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "cim_eligibility_marked_by" varchar;

DO $$ BEGIN
  ALTER TABLE "cases" ADD CONSTRAINT "cases_cim_eligibility_marked_by_users_id_fk" FOREIGN KEY ("cim_eligibility_marked_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "case_cim_consents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL,
  "party_id" varchar NOT NULL,
  "form_type" text DEFAULT 'cf10' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "recorded_by" varchar,
  "recorded_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "case_cim_consents" ADD CONSTRAINT "case_cim_consents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_cim_consents" ADD CONSTRAINT "case_cim_consents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_cim_consents" ADD CONSTRAINT "case_cim_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "cases_cim_eligible_idx" ON "cases" ("cim_eligible");
CREATE UNIQUE INDEX IF NOT EXISTS "case_cim_consents_case_party_form_unique" ON "case_cim_consents" ("case_id","party_id","form_type");
CREATE INDEX IF NOT EXISTS "case_cim_consents_case_idx" ON "case_cim_consents" ("case_id");
CREATE INDEX IF NOT EXISTS "case_cim_consents_party_idx" ON "case_cim_consents" ("party_id");
CREATE INDEX IF NOT EXISTS "case_cim_consents_status_idx" ON "case_cim_consents" ("status");
