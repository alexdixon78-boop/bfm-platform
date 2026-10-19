ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "intake_follow_up_interval_days" integer;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "intake_follow_up_scheduled_by" varchar REFERENCES "users"("id") ON DELETE SET NULL;
