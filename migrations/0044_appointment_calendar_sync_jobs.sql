CREATE TABLE IF NOT EXISTS appointment_calendar_sync_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id VARCHAR NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_lease_expires_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  completed_at TIMESTAMP,
  failure_stage TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS appointment_calendar_sync_jobs_due_idx
  ON appointment_calendar_sync_jobs(status, next_attempt_at);
