ALTER TABLE "whatsapp_messages" ADD COLUMN "case_id" varchar REFERENCES "cases"("id") ON DELETE SET NULL;
ALTER TABLE "whatsapp_messages" ADD COLUMN "party_id" varchar REFERENCES "parties"("id") ON DELETE SET NULL;
ALTER TABLE "whatsapp_messages" ADD COLUMN "client_id" varchar REFERENCES "clients"("id") ON DELETE SET NULL;
ALTER TABLE "whatsapp_messages" ADD COLUMN "content_classification" text NOT NULL DEFAULT 'ordinary';
ALTER TABLE "whatsapp_messages" ADD COLUMN "case_assignment_source" text;
UPDATE "whatsapp_messages" AS message SET "case_id" = conversation."case_id", "case_assignment_source" = 'legacy_conversation'
FROM "whatsapp_conversations" AS conversation
WHERE message."conversation_id" = conversation."id" AND conversation."case_id" IS NOT NULL;
CREATE INDEX "whatsapp_messages_case_idx" ON "whatsapp_messages" ("case_id", "created_at");
CREATE INDEX "whatsapp_messages_party_idx" ON "whatsapp_messages" ("party_id", "created_at");

CREATE TABLE "party_whatsapp_preferences" (
  "party_id" varchar PRIMARY KEY REFERENCES "parties"("id") ON DELETE CASCADE, "status" text NOT NULL DEFAULT 'unknown',
  "source" text, "recorded_by" varchar REFERENCES "users"("id") ON DELETE SET NULL, "recorded_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "party_whatsapp_preferences_status_check" CHECK (status IN ('unknown','opted_in','opted_out'))
);
CREATE TABLE "whatsapp_template_catalog" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(), "meta_template_id" text NOT NULL, "name" text NOT NULL,
  "language" text NOT NULL, "category" text, "status" text NOT NULL, "components" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "parameter_definitions" jsonb NOT NULL DEFAULT '[]'::jsonb, "header_media_type" text, "last_synced_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), UNIQUE("name", "language")
);
CREATE INDEX "whatsapp_template_catalog_status_idx" ON "whatsapp_template_catalog" ("status");
CREATE TABLE "whatsapp_outbound_media" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(), "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "party_id" varchar NOT NULL REFERENCES "parties"("id") ON DELETE CASCADE, "conversation_id" varchar REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL,
  "source_type" text NOT NULL, "source_document_id" varchar REFERENCES "case_documents"("id") ON DELETE SET NULL,
  "file_name" text NOT NULL, "mime_type" text NOT NULL, "size_bytes" integer NOT NULL, "storage_key" text,
  "meta_media_id" text, "status" text NOT NULL DEFAULT 'queued', "retry_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(), "processing_lease_expires_at" timestamp, "last_error" text,
  "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "whatsapp_outbound_media_case_idx" ON "whatsapp_outbound_media" ("case_id", "created_at");
CREATE INDEX "whatsapp_outbound_media_work_idx" ON "whatsapp_outbound_media" ("status", "next_attempt_at");
