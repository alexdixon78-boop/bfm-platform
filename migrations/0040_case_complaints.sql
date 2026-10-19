DO $$
BEGIN
  IF (SELECT count(*) FROM users WHERE role = 'superadmin') > 1 THEN
    RAISE EXCEPTION 'Cannot install confidential complaints: multiple superadmin users exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_single_superadmin_unique ON users (role) WHERE role = 'superadmin';
CREATE SEQUENCE IF NOT EXISTS case_complaint_ref_seq START WITH 1;

CREATE TABLE IF NOT EXISTS case_complaints (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_ref TEXT NOT NULL UNIQUE DEFAULT ('CMP-' || lpad(nextval('case_complaint_ref_seq')::text, 6, '0')),
  case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_role TEXT NOT NULL,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT,
  complainant_party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
  submission_channel TEXT NOT NULL DEFAULT 'portal',
  on_behalf_of_name TEXT,
  on_behalf_of_email TEXT,
  category TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  target_name TEXT,
  incident_date TEXT,
  details TEXT NOT NULL,
  desired_resolution TEXT,
  supporting_notes TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  acknowledgement_due_at TIMESTAMP NOT NULL,
  acknowledged_at TIMESTAMP,
  acknowledged_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  response_due_at TIMESTAMP NOT NULL,
  next_update_at TIMESTAMP,
  final_response_at TIMESTAMP,
  closed_at TIMESTAMP,
  closed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  escalated_at TIMESTAMP,
  outcome TEXT,
  resolution_summary TEXT,
  duplicate_of_id VARCHAR REFERENCES case_complaints(id) ON DELETE SET NULL,
  fmc_relevant_date TIMESTAMP,
  fmc_within_three_months BOOLEAN,
  receipt_email_status TEXT NOT NULL DEFAULT 'pending',
  receipt_email_last_attempted_at TIMESTAMP,
  receipt_email_sent_at TIMESTAMP,
  receipt_email_last_error TEXT,
  review_task_id VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS case_complaints_case_idx ON case_complaints(case_id);
CREATE INDEX IF NOT EXISTS case_complaints_submitter_idx ON case_complaints(submitted_by);
CREATE INDEX IF NOT EXISTS case_complaints_status_idx ON case_complaints(status);
CREATE INDEX IF NOT EXISTS case_complaints_ack_due_idx ON case_complaints(acknowledgement_due_at);
CREATE INDEX IF NOT EXISTS case_complaints_response_due_idx ON case_complaints(response_due_at);

CREATE TABLE IF NOT EXISTS case_complaint_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id VARCHAR NOT NULL REFERENCES case_complaints(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  actor_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  message TEXT,
  from_status TEXT,
  to_status TEXT,
  related_event_id VARCHAR REFERENCES case_complaint_events(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  redacted_at TIMESTAMP,
  redacted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  redaction_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS case_complaint_events_complaint_idx ON case_complaint_events(complaint_id);
CREATE INDEX IF NOT EXISTS case_complaint_events_related_idx ON case_complaint_events(related_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS case_complaint_single_clarification_reply_idx
  ON case_complaint_events(related_event_id) WHERE type = 'clarification_replied';

CREATE OR REPLACE FUNCTION protect_case_complaint_events() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'case complaint events are append-only';
  END IF;
  IF NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'case complaint event actor may only be cleared by retention handling';
  END IF;
  IF (to_jsonb(NEW) - 'actor_id' - 'redacted_at' - 'redacted_by' - 'redaction_reason')
      IS DISTINCT FROM (to_jsonb(OLD) - 'actor_id' - 'redacted_at' - 'redacted_by' - 'redaction_reason') THEN
    RAISE EXCEPTION 'case complaint event content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS case_complaint_events_append_only ON case_complaint_events;
CREATE TRIGGER case_complaint_events_append_only BEFORE UPDATE OR DELETE ON case_complaint_events
  FOR EACH ROW EXECUTE FUNCTION protect_case_complaint_events();

CREATE TABLE IF NOT EXISTS case_complaint_attachments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id VARCHAR NOT NULL REFERENCES case_complaints(id) ON DELETE CASCADE,
  event_id VARCHAR REFERENCES case_complaint_events(id) ON DELETE SET NULL,
  uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  redacted_at TIMESTAMP,
  redacted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  redaction_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS case_complaint_attachments_complaint_idx ON case_complaint_attachments(complaint_id);
CREATE INDEX IF NOT EXISTS case_complaint_attachments_event_idx ON case_complaint_attachments(event_id);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS complaint_id VARCHAR;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'notifications'
      AND constraint_name = 'notifications_complaint_id_case_complaints_id_fk'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_complaint_id_case_complaints_id_fk
      FOREIGN KEY (complaint_id) REFERENCES case_complaints(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS notifications_complaint_idx ON notifications(complaint_id);
