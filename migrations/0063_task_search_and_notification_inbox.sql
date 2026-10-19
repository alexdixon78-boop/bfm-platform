CREATE TABLE IF NOT EXISTS task_saved_views (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT task_saved_views_user_name_unique UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS task_saved_views_user_updated_idx ON task_saved_views (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS notification_task_links (
  notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id VARCHAR NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  reopened_at TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  UNIQUE (task_id)
);
CREATE INDEX IF NOT EXISTS notification_task_links_user_idx ON notification_task_links (user_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx ON tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tasks_message_trgm_idx ON tasks USING gin (message gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cases_case_ref_trgm_idx ON cases USING gin (case_ref gin_trgm_ops);
