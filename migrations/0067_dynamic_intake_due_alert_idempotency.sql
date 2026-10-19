CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dynamic_intake_due_alert_once"
  ON "notifications" ("type", "task_id")
  WHERE "type" = 'task_follow_up_due_alert' AND "task_id" IS NOT NULL;
