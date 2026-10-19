ALTER TABLE "case_invoices" ADD COLUMN IF NOT EXISTS "appointment_id" varchar;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD COLUMN IF NOT EXISTS "provider_invoice_id" text;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD COLUMN IF NOT EXISTS "payment_link_url" text;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD COLUMN IF NOT EXISTS "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD COLUMN IF NOT EXISTS "failure_reason" text;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "appointment_id" varchar;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "payment_status" text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "failure_reason" text;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "refunded_amount_pence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "receipt_number" text;--> statement-breakpoint
ALTER TABLE "case_payments" ADD COLUMN IF NOT EXISTS "receipt_generated_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_invoices_appointment_unique_idx" ON "case_invoices" USING btree ("appointment_id") WHERE "appointment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_invoices_payment_status_idx" ON "case_invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "case_payments_appointment_unique_idx" ON "case_payments" USING btree ("appointment_id") WHERE "appointment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_payments_payment_status_idx" ON "case_payments" USING btree ("payment_status");
