CREATE TABLE "case_invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"bill_to_client_id" varchar NOT NULL,
	"bill_to_party_id" varchar,
	"service_type_id" varchar,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"subtotal_pence" integer DEFAULT 0 NOT NULL,
	"vat_total_pence" integer DEFAULT 0 NOT NULL,
	"total_pence" integer DEFAULT 0 NOT NULL,
	"amount_paid_pence" integer DEFAULT 0 NOT NULL,
	"outstanding_pence" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'gbp' NOT NULL,
	"notes" text,
	"created_by" varchar,
	"updated_by" varchar,
	"voided_by" varchar,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "case_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "case_invoice_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"service_type_id" varchar,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_pence" integer NOT NULL,
	"vat_rate" integer,
	"vat_amount_pence" integer DEFAULT 0 NOT NULL,
	"line_subtotal_pence" integer NOT NULL,
	"line_total_pence" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"client_id" varchar NOT NULL,
	"party_id" varchar,
	"invoice_id" varchar,
	"amount_pence" integer NOT NULL,
	"currency" text DEFAULT 'gbp' NOT NULL,
	"payment_date" timestamp DEFAULT now() NOT NULL,
	"method" text DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"notes" text,
	"recorded_by" varchar,
	"updated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_bill_to_client_id_clients_id_fk" FOREIGN KEY ("bill_to_client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_bill_to_party_id_parties_id_fk" FOREIGN KEY ("bill_to_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoice_line_items" ADD CONSTRAINT "case_invoice_line_items_invoice_id_case_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."case_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_invoice_line_items" ADD CONSTRAINT "case_invoice_line_items_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_invoice_id_case_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."case_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_invoices_case_idx" ON "case_invoices" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_invoices_client_idx" ON "case_invoices" USING btree ("bill_to_client_id");--> statement-breakpoint
CREATE INDEX "case_invoices_status_idx" ON "case_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "case_invoices_due_date_idx" ON "case_invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "case_invoice_line_items_invoice_idx" ON "case_invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "case_payments_case_idx" ON "case_payments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_payments_client_idx" ON "case_payments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "case_payments_invoice_idx" ON "case_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "case_payments_payment_date_idx" ON "case_payments" USING btree ("payment_date");--> statement-breakpoint
UPDATE "permissions" SET "can_view" = true, "can_edit" = true WHERE "role" = 'subadmin' AND "section" = 'finance';
