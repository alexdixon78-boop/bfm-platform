CREATE TABLE IF NOT EXISTS "financial_disclosure_folders" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL,
  "party_id" varchar NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "trigger_source" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "financial_disclosure_folders_case_party_unique" UNIQUE("case_id","party_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_disclosure_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "folder_id" varchar NOT NULL,
  "item_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'outstanding' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "completed_at" timestamp,
  "completed_by" varchar,
  "updated_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_disclosure_evidence_categories" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "folder_id" varchar NOT NULL,
  "category_key" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_folder_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_item_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_evidence_category_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_upload_target" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_folders" DROP CONSTRAINT "financial_disclosure_folders_case_id_unique";
EXCEPTION
 WHEN undefined_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "financial_disclosure_folders" ADD COLUMN IF NOT EXISTS "party_id" varchar;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_folders" ADD CONSTRAINT "financial_disclosure_folders_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_folders" ADD CONSTRAINT "financial_disclosure_folders_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_items" ADD CONSTRAINT "financial_disclosure_items_folder_id_financial_disclosure_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."financial_disclosure_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_items" ADD CONSTRAINT "financial_disclosure_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_items" ADD CONSTRAINT "financial_disclosure_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_disclosure_evidence_categories" ADD CONSTRAINT "financial_disclosure_evidence_categories_folder_id_financial_disclosure_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."financial_disclosure_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_financial_disclosure_folder_id_financial_disclosure_folders_id_fk" FOREIGN KEY ("financial_disclosure_folder_id") REFERENCES "public"."financial_disclosure_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_financial_disclosure_item_id_financial_disclosure_items_id_fk" FOREIGN KEY ("financial_disclosure_item_id") REFERENCES "public"."financial_disclosure_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_financial_disclosure_evidence_category_id_financial_disclosure_evidence_categories_id_fk" FOREIGN KEY ("financial_disclosure_evidence_category_id") REFERENCES "public"."financial_disclosure_evidence_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_folders_case_idx" ON "financial_disclosure_folders" ("case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_folders_party_idx" ON "financial_disclosure_folders" ("party_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_folders_status_idx" ON "financial_disclosure_folders" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_disclosure_items_folder_type_unique" ON "financial_disclosure_items" ("folder_id","item_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_items_folder_idx" ON "financial_disclosure_items" ("folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_items_type_idx" ON "financial_disclosure_items" ("item_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_items_status_idx" ON "financial_disclosure_items" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_disclosure_evidence_folder_key_unique" ON "financial_disclosure_evidence_categories" ("folder_id","category_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_evidence_folder_idx" ON "financial_disclosure_evidence_categories" ("folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_documents_financial_disclosure_folder_idx" ON "case_documents" ("financial_disclosure_folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_documents_financial_disclosure_item_idx" ON "case_documents" ("financial_disclosure_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_documents_financial_disclosure_category_idx" ON "case_documents" ("financial_disclosure_evidence_category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_documents_financial_disclosure_upload_target_idx" ON "case_documents" ("financial_disclosure_upload_target");
