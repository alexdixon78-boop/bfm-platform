ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "confidential" boolean NOT NULL DEFAULT false;
