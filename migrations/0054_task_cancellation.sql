ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('scheduled', 'active', 'in_progress', 'follow_up', 'completed', 'cancelled'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
