ALTER TABLE "miam_records" ADD COLUMN IF NOT EXISTS "superseded_at" timestamp;
ALTER TABLE "miam_records" ADD COLUMN IF NOT EXISTS "superseded_by" varchar REFERENCES "miam_records"("id") ON DELETE set null;
ALTER TABLE "miam_records" ADD COLUMN IF NOT EXISTS "renewal_of_miam_record_id" varchar REFERENCES "miam_records"("id") ON DELETE set null;
ALTER TABLE "miam_records" ADD COLUMN IF NOT EXISTS "renewal_sequence" integer NOT NULL DEFAULT 0;

ALTER TABLE "miam_records" DROP CONSTRAINT IF EXISTS "miam_records_party_case_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "miam_records_current_party_case_unique"
  ON "miam_records" ("party_id", "case_id")
  WHERE "superseded_at" IS NULL;
