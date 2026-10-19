CREATE TABLE IF NOT EXISTS "notification_assignees" (
  "notification_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "assigned_by" varchar,
  "assigned_at" timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("notification_id","user_id")
);

ALTER TABLE "notification_assignees"
  ADD CONSTRAINT "notification_assignees_notification_id_notifications_id_fk"
  FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "notification_assignees"
  ADD CONSTRAINT "notification_assignees_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "notification_assignees"
  ADD CONSTRAINT "notification_assignees_assigned_by_users_id_fk"
  FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "notification_assignees_user_idx" ON "notification_assignees" USING btree ("user_id");

INSERT INTO "notification_assignees" ("notification_id", "user_id", "assigned_by")
SELECT "id", "assigned_to", NULL
FROM "notifications"
WHERE "assigned_to" IS NOT NULL
ON CONFLICT ("notification_id","user_id") DO NOTHING;
