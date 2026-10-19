CREATE TABLE "case_private_notes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(), "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "source_conversation_id" varchar REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL,
  "author_kind" text NOT NULL, "author_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "author_party_id" varchar REFERENCES "parties"("id") ON DELETE SET NULL, "author_role_snapshot" text NOT NULL,
  "author_name_snapshot" text NOT NULL, "body" text, "status" text NOT NULL DEFAULT 'draft',
  "completed_at" timestamp, "cancelled_at" timestamp, "text_redacted_at" timestamp,
  "text_redacted_by" varchar REFERENCES "users"("id") ON DELETE SET NULL, "text_redaction_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "case_private_notes_author_check" CHECK ((author_kind = 'party' AND author_party_id IS NOT NULL) OR (author_kind = 'user' AND author_user_id IS NOT NULL)),
  CONSTRAINT "case_private_notes_status_check" CHECK (status IN ('draft','completed','cancelled'))
);
CREATE INDEX "case_private_notes_case_idx" ON "case_private_notes" ("case_id", "created_at");
CREATE INDEX "case_private_notes_party_idx" ON "case_private_notes" ("author_party_id", "created_at");
CREATE INDEX "case_private_notes_user_idx" ON "case_private_notes" ("author_user_id", "created_at");

CREATE TABLE "case_private_note_attachments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(), "note_id" varchar NOT NULL REFERENCES "case_private_notes"("id") ON DELETE CASCADE,
  "source_whatsapp_attachment_id" varchar REFERENCES "whatsapp_attachments"("id") ON DELETE SET NULL,
  "source_message_id" varchar REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL, "meta_media_id" text,
  "file_name" text, "declared_mime_type" text, "detected_mime_type" text, "size_bytes" integer,
  "storage_key" text, "status" text NOT NULL DEFAULT 'queued', "retry_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(), "processing_lease_expires_at" timestamp, "last_error" text,
  "redacted_at" timestamp, "redacted_by" varchar REFERENCES "users"("id") ON DELETE SET NULL, "redaction_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "case_private_note_attachment_status_check" CHECK (status IN ('queued','downloading','quarantined','scanning','clean','blocked','failed','redacted'))
);
CREATE UNIQUE INDEX "case_private_note_attachments_source_unique" ON "case_private_note_attachments" ("source_message_id") WHERE "source_message_id" IS NOT NULL;
CREATE INDEX "case_private_note_attachments_note_idx" ON "case_private_note_attachments" ("note_id");
CREATE INDEX "case_private_note_attachments_work_idx" ON "case_private_note_attachments" ("status", "next_attempt_at");

CREATE TABLE "whatsapp_private_note_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(), "conversation_id" varchar NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  "case_id" varchar REFERENCES "cases"("id") ON DELETE CASCADE, "party_id" varchar REFERENCES "parties"("id") ON DELETE SET NULL,
  "author_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL, "note_id" varchar REFERENCES "case_private_notes"("id") ON DELETE SET NULL,
  "otp_id" varchar REFERENCES "whatsapp_otps"("id") ON DELETE SET NULL, "state" text NOT NULL DEFAULT 'awaiting_case_reference',
  "case_reference_input" text, "identity_email_hash" text, "lookup_attempt_count" integer NOT NULL DEFAULT 0,
  "verified_at" timestamp, "expires_at" timestamp NOT NULL, "completed_at" timestamp, "cancelled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "whatsapp_private_note_sessions_conversation_idx" ON "whatsapp_private_note_sessions" ("conversation_id", "created_at");
CREATE INDEX "whatsapp_private_note_sessions_expiry_idx" ON "whatsapp_private_note_sessions" ("expires_at");
CREATE UNIQUE INDEX "whatsapp_private_note_sessions_one_active_idx" ON "whatsapp_private_note_sessions" ("conversation_id") WHERE "completed_at" IS NULL AND "cancelled_at" IS NULL;
