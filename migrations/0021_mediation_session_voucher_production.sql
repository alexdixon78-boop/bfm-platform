ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "voucher_claim_eligible" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "voucher_claim_eligible_set_at" timestamp,
  ADD COLUMN IF NOT EXISTS "voucher_claim_eligible_set_by" varchar;

ALTER TABLE "case_documents"
  ADD COLUMN IF NOT EXISTS "party_id" varchar,
  ADD COLUMN IF NOT EXISTS "document_category" text;

ALTER TABLE "party_required_forms"
  ADD COLUMN IF NOT EXISTS "attestation_version" text,
  ADD COLUMN IF NOT EXISTS "confirmation_ticked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "signature_source" text,
  ADD COLUMN IF NOT EXISTS "uploaded_document_id" varchar,
  ADD COLUMN IF NOT EXISTS "upload_notes" text,
  ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp,
  ADD COLUMN IF NOT EXISTS "withdrawn_by" varchar;

ALTER TABLE "case_invoices"
  ADD COLUMN IF NOT EXISTS "voucher_discount_pence" integer NOT NULL DEFAULT 0;

ALTER TABLE "demographic_data"
  ADD COLUMN IF NOT EXISTS "relationship_to_child" text;

DO $$ BEGIN
  ALTER TABLE "cases" ADD CONSTRAINT "cases_voucher_claim_eligible_set_by_users_id_fk"
    FOREIGN KEY ("voucher_claim_eligible_set_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_party_id_parties_id_fk"
    FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "party_required_forms" ADD CONSTRAINT "party_required_forms_withdrawn_by_users_id_fk"
    FOREIGN KEY ("withdrawn_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "party_required_forms" ADD CONSTRAINT "party_required_forms_uploaded_document_id_case_documents_id_fk"
    FOREIGN KEY ("uploaded_document_id") REFERENCES "case_documents"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE "cases"
SET "voucher_claim_eligible" = "moj_voucher_eligible",
    "voucher_claim_eligible_set_at" = COALESCE("voucher_claim_eligible_set_at", now())
WHERE "status" NOT IN ('Closed', 'Archived')
  AND "moj_voucher_eligible" = true
  AND "voucher_claim_eligible" = false;

UPDATE "party_required_forms"
SET "form_type" = 'voucher_scheme_client_consent',
    "signature_source" = COALESCE("signature_source", CASE WHEN "status" = 'signed' THEN 'platform' ELSE NULL END),
    "attestation_version" = COALESCE("attestation_version", 'legacy-combined-voucher-consent')
WHERE "form_type" = 'voucher_claim_moj_privacy_consent'
  AND "case_id" IN (SELECT "id" FROM "cases" WHERE "status" NOT IN ('Closed', 'Archived'));

INSERT INTO "party_required_forms" (
  "case_id",
  "party_id",
  "appointment_id",
  "mediation_session_id",
  "form_type",
  "status",
  "issued_by",
  "sent_at",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (f."case_id", f."party_id", opt.form_type)
  f."case_id",
  f."party_id",
  f."appointment_id",
  f."mediation_session_id",
  opt.form_type,
  CASE WHEN f."sent_at" IS NULL THEN 'outstanding' ELSE 'sent' END,
  f."issued_by",
  f."sent_at",
  now(),
  now()
FROM "party_required_forms" f
CROSS JOIN (VALUES
  ('voucher_diversity_questionnaire_opt_in'),
  ('voucher_moj_research_contact_opt_in')
) AS opt(form_type)
JOIN "cases" c ON c."id" = f."case_id"
WHERE f."form_type" = 'voucher_scheme_client_consent'
  AND c."status" NOT IN ('Closed', 'Archived')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "mediation_session_voucher_claims" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "mediation_session_id" varchar NOT NULL REFERENCES "mediation_sessions"("id") ON DELETE cascade,
  "appointment_id" varchar REFERENCES "appointments"("id") ON DELETE set null,
  "status" text NOT NULL DEFAULT 'voucher_claim_submitted',
  "opia_claim_reference" text,
  "submitted_at" timestamp,
  "submitted_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "accepted_at" timestamp,
  "accepted_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "paid_at" timestamp,
  "paid_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "last_chased_at" timestamp,
  "next_chase_due_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "party_required_forms_case_party_type_unique"
  ON "party_required_forms" ("case_id", "party_id", "form_type")
  WHERE "mediation_session_id" IS NULL;
CREATE INDEX IF NOT EXISTS "cases_voucher_claim_eligible_idx" ON "cases" ("voucher_claim_eligible");
CREATE INDEX IF NOT EXISTS "case_documents_party_idx" ON "case_documents" ("party_id");
CREATE INDEX IF NOT EXISTS "case_documents_category_idx" ON "case_documents" ("document_category");
CREATE UNIQUE INDEX IF NOT EXISTS "mediation_session_voucher_claims_session_unique" ON "mediation_session_voucher_claims" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "mediation_session_voucher_claims_case_idx" ON "mediation_session_voucher_claims" ("case_id");
CREATE INDEX IF NOT EXISTS "mediation_session_voucher_claims_opia_ref_idx" ON "mediation_session_voucher_claims" ("opia_claim_reference");
CREATE INDEX IF NOT EXISTS "mediation_session_voucher_claims_status_idx" ON "mediation_session_voucher_claims" ("status");
CREATE INDEX IF NOT EXISTS "mediation_session_voucher_claims_next_chase_idx" ON "mediation_session_voucher_claims" ("next_chase_due_at");
