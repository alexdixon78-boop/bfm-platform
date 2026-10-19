CREATE TABLE "case_communication_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" varchar NOT NULL,
  "case_ref" text NOT NULL,
  "party_id" varchar,
  "client_id" varchar,
  "recipient_type" text NOT NULL DEFAULT 'client',
  "recipient_name" text,
  "recipient_email" text,
  "recipient_phone" text,
  "channel" text NOT NULL,
  "direction" text NOT NULL,
  "trigger" text NOT NULL DEFAULT 'manual',
  "template_name" text,
  "subject" text,
  "sent_at" timestamp,
  "delivery_status" text NOT NULL DEFAULT 'unknown',
  "source_entity_type" text,
  "source_entity_id" varchar,
  "provider_message_id" text,
  "actor_type" text NOT NULL DEFAULT 'system',
  "actor_id" varchar,
  "actor_name" text,
  "preview" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "backfill_confidence" text NOT NULL DEFAULT 'exact',
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

ALTER TABLE "case_communication_logs"
  ADD CONSTRAINT "case_communication_logs_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "case_communication_logs"
  ADD CONSTRAINT "case_communication_logs_party_id_parties_id_fk"
  FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "case_communication_logs"
  ADD CONSTRAINT "case_communication_logs_client_id_clients_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "case_communication_logs"
  ADD CONSTRAINT "case_communication_logs_actor_id_users_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "case_communication_logs_case_sent_idx" ON "case_communication_logs" USING btree ("case_id","sent_at");
CREATE INDEX "case_communication_logs_channel_idx" ON "case_communication_logs" USING btree ("channel");
CREATE INDEX "case_communication_logs_status_idx" ON "case_communication_logs" USING btree ("delivery_status");
CREATE INDEX "case_communication_logs_recipient_idx" ON "case_communication_logs" USING btree ("party_id","client_id");
CREATE UNIQUE INDEX "case_communication_logs_source_unique_idx" ON "case_communication_logs" USING btree ("source_entity_type","source_entity_id") WHERE "source_entity_type" IS NOT NULL AND "source_entity_id" IS NOT NULL;
