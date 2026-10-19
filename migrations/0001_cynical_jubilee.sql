CREATE TABLE "mediation_session_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text NOT NULL,
	"added_by" varchar,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mediation_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"session_number" integer NOT NULL,
	"lead_mediator_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"appointment_id" varchar,
	"outcome" text,
	"outcome_notes" text,
	"created_by" varchar,
	"allocated_by" varchar,
	"allocated_at" timestamp,
	"completed_by" varchar,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mediation_session_participants" ADD CONSTRAINT "mediation_session_participants_session_id_mediation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mediation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_session_participants" ADD CONSTRAINT "mediation_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_session_participants" ADD CONSTRAINT "mediation_session_participants_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_lead_mediator_id_users_id_fk" FOREIGN KEY ("lead_mediator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_allocated_by_users_id_fk" FOREIGN KEY ("allocated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mediation_sessions" ADD CONSTRAINT "mediation_sessions_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mediation_session_participants_session_user_role_unique" ON "mediation_session_participants" USING btree ("session_id","user_id","role");--> statement-breakpoint
CREATE INDEX "mediation_session_participants_session_idx" ON "mediation_session_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "mediation_session_participants_user_idx" ON "mediation_session_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mediation_sessions_case_number_unique" ON "mediation_sessions" USING btree ("case_id","session_number");--> statement-breakpoint
CREATE INDEX "mediation_sessions_case_idx" ON "mediation_sessions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "mediation_sessions_lead_mediator_idx" ON "mediation_sessions" USING btree ("lead_mediator_id");