CREATE TABLE IF NOT EXISTS "case_closure_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"closure_reason" text NOT NULL,
	"closure_details" text,
	"closed_at" timestamp DEFAULT now() NOT NULL,
	"closed_by_id" varchar,
	"follow_up_consent_status" text NOT NULL,
	"outreach_excluded" boolean DEFAULT false NOT NULL,
	"life_satisfaction" integer,
	"anxiety_score" integer,
	"service_rating" integer,
	"net_promoter_score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "case_closure_records_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
ALTER TABLE "case_closure_records" ADD CONSTRAINT "case_closure_records_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "case_closure_records" ADD CONSTRAINT "case_closure_records_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_closure_records_case_id_idx" ON "case_closure_records" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_closure_records_closed_at_idx" ON "case_closure_records" USING btree ("closed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_closure_records_follow_up_consent_idx" ON "case_closure_records" USING btree ("follow_up_consent_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "case_closure_records_outreach_excluded_idx" ON "case_closure_records" USING btree ("outreach_excluded");
--> statement-breakpoint
INSERT INTO "case_closure_records" (
	"case_id",
	"closure_reason",
	"closure_details",
	"closed_at",
	"closed_by_id",
	"follow_up_consent_status",
	"outreach_excluded",
	"created_at",
	"updated_at"
)
SELECT
	c."id",
	COALESCE(c."closure_reason", 'Other'),
	c."closure_details",
	COALESCE(c."closure_date", c."last_updated", now()),
	NULL,
	'unknown',
	false,
	now(),
	now()
FROM "cases" c
WHERE c."status" = 'Closed'
  AND NOT EXISTS (
    SELECT 1 FROM "case_closure_records" existing
    WHERE existing."case_id" = c."id"
  );
