CREATE TABLE IF NOT EXISTS "case_proofing_item_cycles" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "proofing_item_id" varchar NOT NULL REFERENCES "case_proofing_items"("id") ON DELETE CASCADE,
  "cycle_number" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'awaiting_review',
  "submitted_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_at" timestamp NOT NULL DEFAULT NOW(),
  "reviewed_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "return_comments" text,
  "returned_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "returned_at" timestamp,
  "withdrawn_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "withdrawn_at" timestamp,
  "withdraw_reason" text,
  "source_entity_type" text NOT NULL,
  "source_entity_id" varchar NOT NULL,
  "file_name" text,
  "document_date" timestamp,
  "upload_date" timestamp,
  "source_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_proofing_item_cycles_item_cycle_unique"
  ON "case_proofing_item_cycles"("proofing_item_id", "cycle_number");
CREATE INDEX IF NOT EXISTS "case_proofing_item_cycles_item_idx" ON "case_proofing_item_cycles"("proofing_item_id");
CREATE INDEX IF NOT EXISTS "case_proofing_item_cycles_status_idx" ON "case_proofing_item_cycles"("status");

INSERT INTO "case_proofing_item_cycles" (
  "proofing_item_id", "cycle_number", "status", "submitted_by", "submitted_at",
  "reviewed_by", "reviewed_at", "return_comments", "returned_by", "returned_at",
  "withdrawn_by", "withdrawn_at", "withdraw_reason", "source_entity_type", "source_entity_id",
  "file_name", "document_date", "upload_date", "source_metadata", "created_at", "updated_at"
)
SELECT
  p."id",
  1,
  p."status",
  p."submitted_by",
  p."submitted_at",
  p."reviewed_by",
  p."reviewed_at",
  p."return_comments",
  p."returned_by",
  p."returned_at",
  p."withdrawn_by",
  p."withdrawn_at",
  p."withdraw_reason",
  p."source_entity_type",
  p."source_entity_id",
  d."file_name",
  d."document_date",
  COALESCE(d."created_at", p."submitted_at"),
  jsonb_build_object(
    'itemType', p."item_type",
    'sourceEntityType', p."source_entity_type",
    'sourceEntityId', p."source_entity_id"
  ),
  p."created_at",
  NOW()
FROM "case_proofing_items" p
LEFT JOIN "case_documents" d
  ON p."source_entity_type" = 'case_document'
  AND p."source_entity_id" = d."id"
ON CONFLICT ("proofing_item_id", "cycle_number") DO NOTHING;
