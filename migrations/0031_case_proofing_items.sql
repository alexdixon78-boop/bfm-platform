CREATE TABLE IF NOT EXISTS "case_proofing_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "session_id" varchar REFERENCES "mediation_sessions"("id") ON DELETE SET NULL,
  "item_type" text NOT NULL,
  "source_entity_type" text NOT NULL,
  "source_entity_id" varchar NOT NULL,
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
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_proofing_items_source_unique"
  ON "case_proofing_items"("source_entity_type", "source_entity_id", "item_type");
CREATE INDEX IF NOT EXISTS "case_proofing_items_case_idx" ON "case_proofing_items"("case_id");
CREATE INDEX IF NOT EXISTS "case_proofing_items_session_idx" ON "case_proofing_items"("session_id");
CREATE INDEX IF NOT EXISTS "case_proofing_items_status_idx" ON "case_proofing_items"("status");
CREATE INDEX IF NOT EXISTS "case_proofing_items_item_type_idx" ON "case_proofing_items"("item_type");

INSERT INTO "case_proofing_items" (
  -- Backfill item type: "session_summary"
  "case_id", "session_id", "item_type", "source_entity_type", "source_entity_id",
  "status", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "created_at", "updated_at"
)
SELECT
  "case_id",
  "id",
  'session_summary',
  'mediation_session',
  "id",
  CASE WHEN "post_session_review_status" = 'approved' THEN 'approved' ELSE 'awaiting_review' END,
  "summary_submitted_by",
  COALESCE("summary_submitted_at", "updated_at", "created_at", NOW()),
  "post_session_reviewed_by",
  "post_session_reviewed_at",
  COALESCE("summary_submitted_at", "created_at", NOW()),
  NOW()
FROM "mediation_sessions"
WHERE "post_session_review_status" IN ('submitted', 'changes_requested', 'approved')
ON CONFLICT ("source_entity_type", "source_entity_id", "item_type") DO NOTHING;

INSERT INTO "case_proofing_items" (
  -- Backfill item type: "draft_financial_schedule"
  "case_id", "session_id", "item_type", "source_entity_type", "source_entity_id",
  "status", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "created_at", "updated_at"
)
SELECT
  "case_id",
  "confirmed_in_session_id",
  'draft_financial_schedule',
  'case_draft_financial_schedule',
  "id",
  'awaiting_review',
  "confirmed_by",
  COALESCE("confirmed_at", "updated_at", "created_at", NOW()),
  NULL,
  NULL,
  COALESCE("confirmed_at", "created_at", NOW()),
  NOW()
FROM "case_draft_financial_schedules"
WHERE "status" = 'confirmed'
ON CONFLICT ("source_entity_type", "source_entity_id", "item_type") DO NOTHING;

INSERT INTO "case_proofing_items" (
  -- Backfill item type: "financial_disclosure_checklist"
  "case_id", "session_id", "item_type", "source_entity_type", "source_entity_id",
  "status", "submitted_by", "submitted_at", "created_at", "updated_at"
)
SELECT
  f."case_id",
  NULL,
  'financial_disclosure_checklist',
  'financial_disclosure_item',
  i."id",
  CASE WHEN i."status" = 'completed' THEN 'awaiting_review' ELSE 'awaiting_review' END,
  i."updated_by",
  COALESCE(i."updated_at", i."created_at", NOW()),
  COALESCE(i."created_at", NOW()),
  NOW()
FROM "financial_disclosure_items" i
JOIN "financial_disclosure_folders" f ON f."id" = i."folder_id"
WHERE i."item_type" = 'financial_disclosure_checklist'
ON CONFLICT ("source_entity_type", "source_entity_id", "item_type") DO NOTHING;

INSERT INTO "case_proofing_items" (
  -- Backfill item type: "court_form"
  "case_id", "session_id", "item_type", "source_entity_type", "source_entity_id",
  "status", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "created_at", "updated_at"
)
SELECT
  g."case_id",
  NULL,
  'court_form',
  'court_form_generation',
  g."id",
  CASE WHEN d."review_status" = 'reviewed' THEN 'approved' ELSE 'awaiting_review' END,
  g."generated_by",
  COALESCE(g."generated_at", d."ready_for_review_at", d."created_at", NOW()),
  d."reviewed_by",
  d."reviewed_at",
  COALESCE(g."generated_at", d."created_at", NOW()),
  NOW()
FROM "court_form_generations" g
LEFT JOIN "case_documents" d ON d."id" = g."case_document_id"
ON CONFLICT ("source_entity_type", "source_entity_id", "item_type") DO NOTHING;

INSERT INTO "case_proofing_items" (
  -- Backfill item type: "case_document"
  "case_id", "session_id", "item_type", "source_entity_type", "source_entity_id",
  "status", "submitted_by", "submitted_at", "reviewed_by", "reviewed_at", "created_at", "updated_at"
)
SELECT
  "case_id",
  "mediation_session_id",
  'case_document',
  'case_document',
  "id",
  CASE WHEN "review_status" = 'reviewed' THEN 'approved' ELSE 'awaiting_review' END,
  "uploaded_by",
  COALESCE("ready_for_review_at", "created_at", NOW()),
  "reviewed_by",
  "reviewed_at",
  COALESCE("created_at", NOW()),
  NOW()
FROM "case_documents"
WHERE "review_status" IN ('ready_for_review', 'reviewed')
ON CONFLICT ("source_entity_type", "source_entity_id", "item_type") DO NOTHING;
