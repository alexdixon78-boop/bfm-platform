CREATE TABLE "gmail_case_reply_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" varchar NOT NULL,
	"case_email_message_id" varchar NOT NULL,
	"case_document_id" varchar,
	"gmail_attachment_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_case_reply_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" varchar NOT NULL,
	"recipient_user_id" varchar NOT NULL,
	"notification_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_reply_sync_state" (
	"id" varchar PRIMARY KEY NOT NULL,
	"checkpoint_at" timestamp,
	"last_attempt_at" timestamp,
	"last_success_at" timestamp,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_email_messages" ADD COLUMN "reply_token_hash" text;--> statement-breakpoint
ALTER TABLE "case_email_messages" ADD COLUMN "reply_to_email" text;--> statement-breakpoint
ALTER TABLE "case_email_messages" ADD COLUMN "gmail_thread_id" text;--> statement-breakpoint
ALTER TABLE "gmail_messages" ADD COLUMN "linked_case_email_message_id" varchar;--> statement-breakpoint
ALTER TABLE "gmail_case_reply_attachments" ADD CONSTRAINT "gmail_case_reply_attachments_gmail_message_id_gmail_messages_id_fk" FOREIGN KEY ("gmail_message_id") REFERENCES "public"."gmail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_case_reply_attachments" ADD CONSTRAINT "gmail_case_reply_attachments_case_email_message_id_case_email_messages_id_fk" FOREIGN KEY ("case_email_message_id") REFERENCES "public"."case_email_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_case_reply_attachments" ADD CONSTRAINT "gmail_case_reply_attachments_case_document_id_case_documents_id_fk" FOREIGN KEY ("case_document_id") REFERENCES "public"."case_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_case_reply_notifications" ADD CONSTRAINT "gmail_case_reply_notifications_gmail_message_id_gmail_messages_id_fk" FOREIGN KEY ("gmail_message_id") REFERENCES "public"."gmail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_case_reply_notifications" ADD CONSTRAINT "gmail_case_reply_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_case_reply_notifications" ADD CONSTRAINT "gmail_case_reply_notifications_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_case_reply_attachments_message_attachment_unique" ON "gmail_case_reply_attachments" USING btree ("gmail_message_id","gmail_attachment_id");--> statement-breakpoint
CREATE INDEX "gmail_case_reply_attachments_document_idx" ON "gmail_case_reply_attachments" USING btree ("case_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_case_reply_notifications_message_recipient_unique" ON "gmail_case_reply_notifications" USING btree ("gmail_message_id","recipient_user_id");--> statement-breakpoint
ALTER TABLE "gmail_messages" ADD CONSTRAINT "gmail_messages_linked_case_email_message_id_case_email_messages_id_fk" FOREIGN KEY ("linked_case_email_message_id") REFERENCES "public"."case_email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_email_messages_gmail_thread_idx" ON "case_email_messages" USING btree ("gmail_thread_id");--> statement-breakpoint
ALTER TABLE "case_email_messages" ADD CONSTRAINT "case_email_messages_reply_token_hash_unique" UNIQUE("reply_token_hash");