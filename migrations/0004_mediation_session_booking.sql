CREATE TABLE IF NOT EXISTS "party_required_forms" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "party_id" varchar NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "appointment_id" varchar REFERENCES "appointments"("id") ON DELETE set null,
  "mediation_session_id" varchar REFERENCES "mediation_sessions"("id") ON DELETE cascade,
  "form_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'outstanding',
  "delivery_status" text NOT NULL DEFAULT 'not_sent',
  "delivery_last_attempted_at" timestamp,
  "delivery_error" text,
  "issued_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "sent_at" timestamp,
  "viewed_at" timestamp,
  "signed_at" timestamp,
  "signed_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "signer_name" text,
  "signature_ip_address" text,
  "attestation_text" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "party_required_forms_session_party_type_unique"
  ON "party_required_forms" ("mediation_session_id", "party_id", "form_type");
CREATE INDEX IF NOT EXISTS "party_required_forms_case_idx" ON "party_required_forms" ("case_id");
CREATE INDEX IF NOT EXISTS "party_required_forms_party_idx" ON "party_required_forms" ("party_id");
CREATE INDEX IF NOT EXISTS "party_required_forms_appointment_idx" ON "party_required_forms" ("appointment_id");
CREATE INDEX IF NOT EXISTS "party_required_forms_status_idx" ON "party_required_forms" ("status");

CREATE TABLE IF NOT EXISTS "mediation_session_availability_windows" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "mediation_session_id" varchar NOT NULL REFERENCES "mediation_sessions"("id") ON DELETE cascade,
  "party_id" varchar NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "start_at" timestamp NOT NULL,
  "end_at" timestamp NOT NULL,
  "source" text NOT NULL DEFAULT 'client',
  "submitted_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mediation_session_availability_session_idx"
  ON "mediation_session_availability_windows" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "mediation_session_availability_party_idx"
  ON "mediation_session_availability_windows" ("party_id");
CREATE INDEX IF NOT EXISTS "mediation_session_availability_window_idx"
  ON "mediation_session_availability_windows" ("start_at", "end_at");

DROP INDEX IF EXISTS "case_invoices_appointment_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "case_invoices_appointment_unique_idx"
  ON "case_invoices" ("appointment_id", "bill_to_party_id")
  WHERE "appointment_id" IS NOT NULL AND "bill_to_party_id" IS NOT NULL;

DROP INDEX IF EXISTS "case_payments_appointment_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "case_payments_appointment_unique_idx"
  ON "case_payments" ("appointment_id", "party_id")
  WHERE "appointment_id" IS NOT NULL AND "party_id" IS NOT NULL;
