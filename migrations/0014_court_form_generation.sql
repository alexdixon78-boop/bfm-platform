CREATE TABLE IF NOT EXISTS "court_form_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_type" text NOT NULL,
  "version_label" text NOT NULL,
  "source_file_name" text NOT NULL,
  "source_file_url" text NOT NULL,
  "storage_key" text,
  "mime_type" text DEFAULT 'application/pdf' NOT NULL,
  "is_current" boolean DEFAULT false NOT NULL,
  "uploaded_by" varchar NOT NULL,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  "notes" text,
  "verified_current_at" timestamp,
  "verified_by" varchar,
  "field_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "field_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "court_form_guidance" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_type" text NOT NULL,
  "template_id" varchar,
  "section_key" text NOT NULL,
  "section_title" text NOT NULL,
  "body" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "legal_signoff_status" text DEFAULT 'draft' NOT NULL,
  "updated_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "court_form_drafts" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL,
  "party_id" varchar NOT NULL,
  "form_type" text NOT NULL,
  "template_id" varchar,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "updated_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "court_form_generations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL,
  "party_id" varchar NOT NULL,
  "template_id" varchar NOT NULL,
  "template_version_label" text NOT NULL,
  "draft_id" varchar,
  "case_document_id" varchar,
  "generated_by" varchar NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "recipient_email" text,
  "delivery_status" text DEFAULT 'not_attempted' NOT NULL,
  "delivery_last_attempted_at" timestamp,
  "delivery_last_error" text,
  "resend_history" jsonb DEFAULT '[]'::jsonb NOT NULL
);

ALTER TABLE "party_required_forms"
  ADD COLUMN IF NOT EXISTS "court_form_template_id" varchar,
  ADD COLUMN IF NOT EXISTS "court_form_generation_id" varchar,
  ADD COLUMN IF NOT EXISTS "generated_document_id" varchar;

DO $$ BEGIN
  ALTER TABLE "court_form_templates" ADD CONSTRAINT "court_form_templates_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_templates" ADD CONSTRAINT "court_form_templates_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_guidance" ADD CONSTRAINT "court_form_guidance_template_id_court_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "court_form_templates"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_guidance" ADD CONSTRAINT "court_form_guidance_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_drafts" ADD CONSTRAINT "court_form_drafts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_drafts" ADD CONSTRAINT "court_form_drafts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_drafts" ADD CONSTRAINT "court_form_drafts_template_id_court_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "court_form_templates"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_drafts" ADD CONSTRAINT "court_form_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_generations" ADD CONSTRAINT "court_form_generations_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_generations" ADD CONSTRAINT "court_form_generations_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_generations" ADD CONSTRAINT "court_form_generations_template_id_court_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "court_form_templates"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_generations" ADD CONSTRAINT "court_form_generations_draft_id_court_form_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "court_form_drafts"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_generations" ADD CONSTRAINT "court_form_generations_case_document_id_case_documents_id_fk" FOREIGN KEY ("case_document_id") REFERENCES "case_documents"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "court_form_generations" ADD CONSTRAINT "court_form_generations_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "court_form_templates_type_idx" ON "court_form_templates" ("form_type");
CREATE INDEX IF NOT EXISTS "court_form_templates_current_idx" ON "court_form_templates" ("form_type","is_current");
CREATE UNIQUE INDEX IF NOT EXISTS "court_form_templates_type_version_unique" ON "court_form_templates" ("form_type","version_label");
CREATE INDEX IF NOT EXISTS "court_form_guidance_type_idx" ON "court_form_guidance" ("form_type");
CREATE INDEX IF NOT EXISTS "court_form_guidance_template_idx" ON "court_form_guidance" ("template_id");
CREATE UNIQUE INDEX IF NOT EXISTS "court_form_guidance_template_section_unique" ON "court_form_guidance" ("template_id","section_key");
CREATE UNIQUE INDEX IF NOT EXISTS "court_form_drafts_case_party_type_unique" ON "court_form_drafts" ("case_id","party_id","form_type");
CREATE INDEX IF NOT EXISTS "court_form_drafts_case_idx" ON "court_form_drafts" ("case_id");
CREATE INDEX IF NOT EXISTS "court_form_drafts_party_idx" ON "court_form_drafts" ("party_id");
CREATE INDEX IF NOT EXISTS "court_form_generations_case_idx" ON "court_form_generations" ("case_id");
CREATE INDEX IF NOT EXISTS "court_form_generations_party_idx" ON "court_form_generations" ("party_id");
CREATE INDEX IF NOT EXISTS "court_form_generations_template_idx" ON "court_form_generations" ("template_id");
CREATE INDEX IF NOT EXISTS "court_form_generations_document_idx" ON "court_form_generations" ("case_document_id");
