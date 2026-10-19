ALTER TABLE "mediation_sessions"
  ADD COLUMN IF NOT EXISTS "next_action" text,
  ADD COLUMN IF NOT EXISTS "documents_required" text,
  ADD COLUMN IF NOT EXISTS "follow_up_requirements" text,
  ADD COLUMN IF NOT EXISTS "next_session_required" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "summary_submitted_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "summary_submitted_at" timestamp;

CREATE TABLE IF NOT EXISTS "mediation_session_notes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "mediation_session_id" varchar NOT NULL REFERENCES "mediation_sessions"("id") ON DELETE cascade,
  "content" text NOT NULL,
  "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mediation_session_notes_session_idx"
  ON "mediation_session_notes" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "mediation_session_notes_case_idx"
  ON "mediation_session_notes" ("case_id");

CREATE TABLE IF NOT EXISTS "case_documents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "mediation_session_id" varchar REFERENCES "mediation_sessions"("id") ON DELETE set null,
  "title" text NOT NULL,
  "file_name" text NOT NULL,
  "file_url" text NOT NULL,
  "storage_key" text,
  "mime_type" text,
  "uploaded_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "review_status" text NOT NULL DEFAULT 'draft',
  "ready_for_review_at" timestamp,
  "reviewed_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "reviewed_at" timestamp,
  "shared_with_clients" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "case_documents_case_idx"
  ON "case_documents" ("case_id");
CREATE INDEX IF NOT EXISTS "case_documents_session_idx"
  ON "case_documents" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "case_documents_review_status_idx"
  ON "case_documents" ("review_status");
