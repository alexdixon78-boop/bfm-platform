CREATE TABLE IF NOT EXISTS task_series (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  urgency TEXT NOT NULL,
  case_id VARCHAR,
  frequency TEXT NOT NULL,
  first_date TEXT NOT NULL,
  end_date TEXT,
  schedule JSONB NOT NULL,
  assignee_ids JSONB NOT NULL,
  generated_through TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('scheduled', 'active', 'in_progress', 'follow_up', 'completed'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS series_id VARCHAR REFERENCES task_series(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS series_assignee_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS occurrence_date TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_series_occurrence_unique ON tasks(series_id, series_assignee_id, occurrence_date);
ALTER TABLE task_schedules ADD COLUMN IF NOT EXISTS delivery_kind TEXT NOT NULL DEFAULT 'bfm';
ALTER TABLE task_schedules ADD COLUMN IF NOT EXISTS delivery_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_calendar_sync_jobs ADD COLUMN IF NOT EXISTS delivery_kind TEXT;
ALTER TABLE task_calendar_sync_jobs ADD COLUMN IF NOT EXISTS delivery_user_id VARCHAR;
