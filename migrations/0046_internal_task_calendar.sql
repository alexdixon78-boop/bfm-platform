CREATE TABLE IF NOT EXISTS task_schedules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id VARCHAR NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  start_at TIMESTAMP,
  end_at TIMESTAMP,
  all_day_start TEXT,
  all_day_end_exclusive TEXT,
  reminder_minutes INTEGER,
  reminder_sent_at TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  google_event_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_sync_error_code TEXT,
  last_sync_error_message TEXT,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT task_schedules_kind_check CHECK (kind IN ('timed', 'all_day')),
  CONSTRAINT task_schedules_shape_check CHECK (
    (kind = 'timed' AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at
      AND all_day_start IS NULL AND all_day_end_exclusive IS NULL)
    OR
    (kind = 'all_day' AND start_at IS NULL AND end_at IS NULL
      AND all_day_start IS NOT NULL AND all_day_end_exclusive IS NOT NULL
      AND all_day_end_exclusive > all_day_start)
  ),
  CONSTRAINT task_schedules_reminder_check CHECK (
    reminder_minutes IS NULL OR reminder_minutes IN (15, 30, 60, 1440, 10080)
  )
);

CREATE INDEX IF NOT EXISTS task_schedules_active_start_idx ON task_schedules(active, start_at);
CREATE INDEX IF NOT EXISTS task_schedules_reminder_idx ON task_schedules(active, reminder_sent_at);

CREATE TABLE IF NOT EXISTS task_calendar_sync_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id VARCHAR,
  task_schedule_id VARCHAR REFERENCES task_schedules(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  schedule_version INTEGER NOT NULL,
  google_event_id TEXT,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_lease_expires_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT task_calendar_sync_jobs_operation_check CHECK (operation IN ('upsert', 'delete')),
  CONSTRAINT task_calendar_sync_jobs_status_check CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped')),
  UNIQUE (task_id, schedule_version, operation)
);

CREATE INDEX IF NOT EXISTS task_calendar_sync_jobs_due_idx
  ON task_calendar_sync_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS task_reminder_deliveries (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  task_schedule_id VARCHAR NOT NULL REFERENCES task_schedules(id) ON DELETE CASCADE,
  task_id VARCHAR NOT NULL,
  schedule_version INTEGER NOT NULL,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (task_schedule_id, schedule_version, user_id)
);

CREATE INDEX IF NOT EXISTS task_reminder_deliveries_task_idx ON task_reminder_deliveries(task_id);
