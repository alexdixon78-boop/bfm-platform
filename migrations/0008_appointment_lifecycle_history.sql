CREATE TABLE IF NOT EXISTS "appointment_status_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" varchar,
	"case_id" varchar NOT NULL,
	"mediation_session_id" varchar,
	"previous_status" text,
	"new_status" text,
	"previous_date_time" timestamp,
	"new_date_time" timestamp,
	"previous_duration" integer,
	"new_duration" integer,
	"event_type" text NOT NULL,
	"reason" text,
	"changed_by" varchar,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_mediation_session_id_mediation_sessions_id_fk" FOREIGN KEY ("mediation_session_id") REFERENCES "public"."mediation_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_status_history_appointment_idx" ON "appointment_status_history" USING btree ("appointment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_status_history_case_idx" ON "appointment_status_history" USING btree ("case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_status_history_session_idx" ON "appointment_status_history" USING btree ("mediation_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_status_history_changed_at_idx" ON "appointment_status_history" USING btree ("changed_at");
