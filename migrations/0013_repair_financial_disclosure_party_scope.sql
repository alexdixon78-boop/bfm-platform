ALTER TABLE "financial_disclosure_folders" ADD COLUMN IF NOT EXISTS "party_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_folder_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_item_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_evidence_category_id" varchar;
--> statement-breakpoint
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_upload_target" text;
--> statement-breakpoint
ALTER TABLE "financial_disclosure_folders" DROP CONSTRAINT IF EXISTS "financial_disclosure_folders_case_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "financial_disclosure_folders_case_id_unique";
--> statement-breakpoint
WITH first_party AS (
  SELECT DISTINCT ON ("case_id")
    "case_id",
    "id" AS party_id
  FROM "parties"
  ORDER BY "case_id", "role", "id"
)
UPDATE "financial_disclosure_folders" folder
SET "party_id" = first_party.party_id
FROM first_party
WHERE folder."party_id" IS NULL
  AND folder."case_id" = first_party."case_id";
--> statement-breakpoint
WITH ranked_folders AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "case_id", "party_id"
      ORDER BY "created_at", "id"
    ) AS rn
  FROM "financial_disclosure_folders"
  WHERE "party_id" IS NOT NULL
),
duplicate_targets AS (
  SELECT "id"
  FROM ranked_folders
  WHERE rn > 1
)
UPDATE "case_documents" document
SET "financial_disclosure_folder_id" = NULL,
    "financial_disclosure_item_id" = NULL,
    "financial_disclosure_evidence_category_id" = NULL,
    "financial_disclosure_upload_target" = NULL
FROM duplicate_targets
WHERE document."financial_disclosure_folder_id" = duplicate_targets."id";
--> statement-breakpoint
WITH ranked_folders AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "case_id", "party_id"
      ORDER BY "created_at", "id"
    ) AS rn
  FROM "financial_disclosure_folders"
  WHERE "party_id" IS NOT NULL
)
DELETE FROM "financial_disclosure_folders" duplicate
USING ranked_folders
WHERE duplicate."id" = ranked_folders."id"
  AND ranked_folders.rn > 1;
--> statement-breakpoint
WITH orphan_folders AS (
  SELECT "id"
  FROM "financial_disclosure_folders"
  WHERE "party_id" IS NULL
)
UPDATE "case_documents" document
SET "financial_disclosure_folder_id" = NULL,
    "financial_disclosure_item_id" = NULL,
    "financial_disclosure_evidence_category_id" = NULL,
    "financial_disclosure_upload_target" = NULL
FROM orphan_folders
WHERE document."financial_disclosure_folder_id" = orphan_folders."id";
--> statement-breakpoint
DELETE FROM "financial_disclosure_folders"
WHERE "party_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "financial_disclosure_folders" ALTER COLUMN "party_id" SET NOT NULL;
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
CREATE UNIQUE INDEX IF NOT EXISTS "financial_disclosure_folders_case_party_unique" ON "financial_disclosure_folders" ("case_id", "party_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_folders_case_idx" ON "financial_disclosure_folders" ("case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_folders_party_idx" ON "financial_disclosure_folders" ("party_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_folders_status_idx" ON "financial_disclosure_folders" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_disclosure_items_folder_type_unique" ON "financial_disclosure_items" ("folder_id", "item_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_items_folder_idx" ON "financial_disclosure_items" ("folder_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_items_type_idx" ON "financial_disclosure_items" ("item_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_disclosure_items_status_idx" ON "financial_disclosure_items" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financial_disclosure_evidence_folder_key_unique" ON "financial_disclosure_evidence_categories" ("folder_id", "category_key");
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
