ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_display_name TEXT;

CREATE TABLE IF NOT EXISTS mediator_profile_change_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  proposed_value JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_by VARCHAR REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS mediator_profile_change_requests_mediator_idx
  ON mediator_profile_change_requests(mediator_id);
