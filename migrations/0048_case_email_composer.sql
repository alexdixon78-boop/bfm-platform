CREATE TABLE "email_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "is_archived" boolean DEFAULT false NOT NULL,
  "created_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "case_email_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "communication_log_id" varchar NOT NULL REFERENCES "case_communication_logs"("id") ON DELETE CASCADE,
  "template_id" varchar REFERENCES "email_templates"("id") ON DELETE SET NULL,
  "template_code" text,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "recipient_kind" text NOT NULL,
  "recipient_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "included_booking_link" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE "case_email_attachments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email_message_id" varchar NOT NULL REFERENCES "case_email_messages"("id") ON DELETE CASCADE,
  "document_id" varchar NOT NULL REFERENCES "case_documents"("id") ON DELETE RESTRICT,
  "file_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "email_templates_active_idx" ON "email_templates" ("is_archived");
CREATE INDEX "case_email_attachments_message_idx" ON "case_email_attachments" ("email_message_id");
