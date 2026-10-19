ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "manual_revenue_pence" integer;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "manual_revenue_updated_by" varchar REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "manual_revenue_updated_at" timestamp;

