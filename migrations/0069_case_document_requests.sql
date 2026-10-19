CREATE TABLE IF NOT EXISTS "case_document_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "party_id" varchar NOT NULL REFERENCES "parties"("id") ON DELETE CASCADE,
  "requested_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "document_type" text NOT NULL,
  "document_name" text NOT NULL,
  "instructions" text,
  "status" text DEFAULT 'outstanding' NOT NULL,
  "delivery_status" text DEFAULT 'not_attempted' NOT NULL,
  "delivery_last_attempted_at" timestamp,
  "delivery_error" text,
  "submitted_at" timestamp,
  "completed_at" timestamp,
  "completed_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "returned_at" timestamp,
  "returned_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "return_reason" text,
  "cancelled_at" timestamp,
  "cancelled_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "case_document_requests_case_idx" ON "case_document_requests" ("case_id");
CREATE INDEX IF NOT EXISTS "case_document_requests_party_status_idx" ON "case_document_requests" ("party_id", "status");
CREATE INDEX IF NOT EXISTS "case_document_requests_delivery_idx" ON "case_document_requests" ("delivery_status");

ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "document_request_id" varchar;
DO $$ BEGIN
  ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_document_request_id_case_document_requests_id_fk"
    FOREIGN KEY ("document_request_id") REFERENCES "case_document_requests"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "case_documents_document_request_idx" ON "case_documents" ("document_request_id");

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "document_request_id" varchar;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_document_request_id_case_document_requests_id_fk"
    FOREIGN KEY ("document_request_id") REFERENCES "case_document_requests"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "notifications_document_request_idx" ON "notifications" ("document_request_id");
