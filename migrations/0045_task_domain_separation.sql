CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  audience TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'assignees',
  type TEXT NOT NULL,
  urgency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  case_id VARCHAR,
  enquiry_id VARCHAR,
  complaint_id VARCHAR REFERENCES case_complaints(id) ON DELETE SET NULL,
  appointment_id VARCHAR,
  due_at TIMESTAMP,
  completion_notes TEXT,
  completed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  case_note_required BOOLEAN NOT NULL DEFAULT false,
  created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  legacy_notification_id VARCHAR UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT tasks_audience_check CHECK (audience IN ('internal', 'mediator', 'client')),
  CONSTRAINT tasks_visibility_check CHECK (visibility IN ('assignees', 'admin_wide', 'superadmin_only')),
  CONSTRAINT tasks_status_check CHECK (status IN ('active', 'in_progress', 'follow_up', 'completed'))
);

CREATE INDEX IF NOT EXISTS tasks_audience_status_idx ON tasks(audience, status);
CREATE INDEX IF NOT EXISTS tasks_case_idx ON tasks(case_id);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_at);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id VARCHAR NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_assignees_user_idx ON task_assignees(user_id);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_id VARCHAR;
DO $$ BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT notifications_task_id_tasks_id_fk
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Explicit catalogue used by the expand migration. Any open legacy row that
-- the old /api/tasks endpoint exposed must be reviewed before deployment if it
-- is not listed here. This intentionally fails instead of silently hiding work.
DO $$
DECLARE unknown_types TEXT;
BEGIN
  SELECT string_agg(DISTINCT type, ', ' ORDER BY type)
  INTO unknown_types
  FROM notifications
  WHERE status IN ('active', 'in_progress', 'follow_up')
    AND type <> 'task_follow_up_due_alert'
    AND type NOT IN (
      'task',
      'enquiry_follow_up', 'enquiry_chase', 'enquiry_persistent_follow_up',
      'duplicate_enquiry_review', 'returning_client_match_review',
      'complaint_review', 'safeguarding_rebecca_notification',
      'appointment_cancellation_request', 'appointment_calendar_sync_failed',
      'calendar_reauth_required', 'payment_hold_cancel_follow_up',
      'case_closure_follow_up', 'demographic_data_completed',
      'miam_review_required', 'miam_revision_required', 'miam_flagged', 'miam_submitted',
      'service_proof_pending_review', 'service_proof_requested', 'service_approval_expiry_reminder',
      'mediation_session_payment_due', 'mediation_session_post_session_review',
      'mediation_session_reschedule_requested', 'mediation_session_next_session_requested',
      'mediation_session_held_acknowledgement', 'mediation_session_confirmed_acknowledgement',
      'mediation_session_cancelled_acknowledgement', 'mediation_session_expired_acknowledgement',
      'documents_ready_for_review', 'mediation_session_documents_required',
      'mediation_session_follow_up_required', 'mediation_session_hold_expired',
      'mediation_session_no_common_availability', 'mediation_session_slot_declined',
      'proofing_returned_to_mediator', 'required_form_withdrawn',
      -- Known informational delivery types that were historically returned by
      -- /api/tasks but are intentionally notifications after this cutover.
      'hold', 'held', 'confirmed', 'cancelled', 'expired',
      'task_calendar_reminder',
      'appointment_hold', 'payment_hold_72h_alert', 'bfm_calendar_health',
      'bank_transfer_in_flight', 'mediation_session_booking',
      'mediation_session_cancelled', 'mediation_session_form_signed',
      'mediation_session_form_signed_upload', 'mediation_session_auto_confirmed',
      'mediation_session_next_session_scheduled', 'mediation_session_payment_reminder_sent',
      'mediation_session_proposal_accepted', 'mediation_session_proposal_link_resent',
      'mediation_session_slot_proposed', 'mediation_session_participant_invite',
      'miam_approved', 'miam_rejected', 'miam_mediator_unassigned',
      'proofing_approved', 'proofing_returned', 'proofing_withdrawn',
      'finance_invoice_created', 'finance_invoice_updated', 'finance_invoice_voided',
      'finance_payment_deleted', 'finance_payment_link_retried',
      'finance_payment_paid', 'finance_payment_refunded',
      'financial_disclosure_folder_created', 'whatsapp',
      'mediation_session_participant_invitation_accepted',
      'mediation_session_participant_invitation_declined',
      'service_approval_approved', 'service_approval_expired',
      'service_approval_rejected', 'service_approval_revoked',
      'task_assigned'
    );
  IF unknown_types IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown open legacy task types: %', unknown_types;
  END IF;
END $$;

INSERT INTO tasks (
  id, audience, visibility, type, urgency, status, title, message,
  case_id, complaint_id, appointment_id, due_at, completion_notes,
  completed_by, completed_at, case_note_required, legacy_notification_id,
  created_at, updated_at
)
SELECT
  n.id,
  CASE
    WHEN n.recipient_role IN ('admin', 'superadmin', 'task_assignee', 'subadmin', 'staff') THEN 'internal'
    WHEN n.recipient_role = 'mediator' THEN 'mediator'
    WHEN n.recipient_role = 'client' THEN 'client'
  END,
  CASE
    WHEN n.recipient_role = 'superadmin' THEN 'superadmin_only'
    WHEN n.recipient_role = 'admin' THEN 'admin_wide'
    ELSE 'assignees'
  END,
  n.type, n.urgency, n.status, n.title, n.message,
  n.case_id, n.complaint_id, n.appointment_id, n.follow_up_date,
  n.completion_notes, n.completed_by, n.completed_at,
  n.case_note_required, n.id, n.created_at, n.created_at
FROM notifications n
WHERE n.recipient_role IN ('admin', 'superadmin', 'task_assignee', 'subadmin', 'staff', 'mediator', 'client')
  AND n.type IN (
    'task',
    'enquiry_follow_up', 'enquiry_chase', 'enquiry_persistent_follow_up',
    'duplicate_enquiry_review', 'returning_client_match_review',
    'complaint_review', 'safeguarding_rebecca_notification',
    'appointment_cancellation_request', 'appointment_calendar_sync_failed',
    'calendar_reauth_required', 'payment_hold_cancel_follow_up',
    'case_closure_follow_up', 'demographic_data_completed',
    'miam_review_required', 'miam_revision_required', 'miam_flagged', 'miam_submitted',
    'service_proof_pending_review', 'service_proof_requested', 'service_approval_expiry_reminder',
    'mediation_session_payment_due', 'mediation_session_post_session_review',
    'mediation_session_reschedule_requested', 'mediation_session_next_session_requested',
    'mediation_session_held_acknowledgement', 'mediation_session_confirmed_acknowledgement',
    'mediation_session_cancelled_acknowledgement', 'mediation_session_expired_acknowledgement',
    'documents_ready_for_review', 'mediation_session_documents_required',
    'mediation_session_follow_up_required', 'mediation_session_hold_expired',
    'mediation_session_no_common_availability', 'mediation_session_slot_declined',
    'proofing_returned_to_mediator', 'required_form_withdrawn'
  )
  AND (
    n.recipient_role IN ('admin', 'superadmin')
    OR EXISTS (
      SELECT 1
      FROM notification_assignees owner_na
      JOIN users owner_u ON owner_u.id = owner_na.user_id
      WHERE owner_na.notification_id = n.id
    )
    OR EXISTS (SELECT 1 FROM users owner_u WHERE owner_u.id = n.assigned_to)
    OR EXISTS (SELECT 1 FROM users owner_u WHERE owner_u.id = n.recipient_id)
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at)
SELECT na.notification_id, na.user_id, na.assigned_by, na.assigned_at
FROM notification_assignees na
JOIN tasks t ON t.id = na.notification_id
JOIN users assignee_user ON assignee_user.id = na.user_id
ON CONFLICT (task_id, user_id) DO NOTHING;

INSERT INTO task_assignees (task_id, user_id, assigned_by)
SELECT n.id, n.assigned_to, NULL
FROM notifications n
JOIN tasks t ON t.id = n.id
JOIN users assigned_user ON assigned_user.id = n.assigned_to
WHERE n.assigned_to IS NOT NULL
ON CONFLICT (task_id, user_id) DO NOTHING;

INSERT INTO task_assignees (task_id, user_id, assigned_by)
SELECT n.id, n.recipient_id, NULL
FROM notifications n
JOIN tasks t ON t.id = n.id
JOIN users recipient_user ON recipient_user.id = n.recipient_id
WHERE n.recipient_id IS NOT NULL
  AND n.recipient_role IN ('mediator', 'client', 'task_assignee', 'staff', 'subadmin')
ON CONFLICT (task_id, user_id) DO NOTHING;

UPDATE notifications n SET task_id = t.id
FROM tasks t
WHERE t.legacy_notification_id = n.id
  AND n.task_id IS DISTINCT FROM t.id;

-- Complaint review and other workflow tables already store the legacy
-- notification ID. Because task IDs are preserved exactly, those references
-- now identify the corresponding row in tasks without a lossy ID remap.

-- Transitional dual-write safety for legacy producers that still write
-- notifications inside larger workflow transactions. This can be removed
-- with the legacy task columns after Release 2 parity verification.
CREATE OR REPLACE FUNCTION mirror_actionable_notification_to_task()
RETURNS TRIGGER AS $$
DECLARE task_audience TEXT;
DECLARE task_visibility TEXT;
BEGIN
  IF pg_trigger_depth() > 2 OR NEW.type NOT IN (
    'task', 'enquiry_follow_up', 'enquiry_chase', 'enquiry_persistent_follow_up',
    'duplicate_enquiry_review', 'returning_client_match_review',
    'complaint_review', 'safeguarding_rebecca_notification',
    'appointment_cancellation_request', 'appointment_calendar_sync_failed',
    'calendar_reauth_required', 'payment_hold_cancel_follow_up',
    'case_closure_follow_up', 'demographic_data_completed',
    'miam_review_required', 'miam_revision_required', 'miam_flagged', 'miam_submitted',
    'service_proof_pending_review', 'service_proof_requested', 'service_approval_expiry_reminder',
    'mediation_session_payment_due', 'mediation_session_post_session_review',
    'mediation_session_reschedule_requested', 'mediation_session_next_session_requested',
    'mediation_session_held_acknowledgement', 'mediation_session_confirmed_acknowledgement',
    'mediation_session_cancelled_acknowledgement', 'mediation_session_expired_acknowledgement',
    'documents_ready_for_review', 'mediation_session_documents_required',
    'mediation_session_follow_up_required', 'mediation_session_hold_expired',
    'mediation_session_no_common_availability', 'mediation_session_slot_declined',
    'proofing_returned_to_mediator', 'required_form_withdrawn'
  ) THEN
    RETURN NEW;
  END IF;
  task_audience := CASE
    WHEN NEW.recipient_role IN ('admin', 'superadmin', 'task_assignee', 'subadmin', 'staff') THEN 'internal'
    WHEN NEW.recipient_role = 'mediator' THEN 'mediator'
    WHEN NEW.recipient_role = 'client' THEN 'client'
    ELSE NULL
  END;
  IF task_audience IS NULL THEN RETURN NEW; END IF;
  task_visibility := CASE
    WHEN NEW.recipient_role = 'superadmin' THEN 'superadmin_only'
    WHEN NEW.recipient_role = 'admin' THEN 'admin_wide'
    ELSE 'assignees'
  END;
  IF task_visibility = 'assignees' AND NOT (
    (NEW.assigned_to IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE id = NEW.assigned_to))
    OR (
      NEW.recipient_role IN ('mediator', 'client', 'task_assignee', 'staff', 'subadmin')
      AND NEW.recipient_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.recipient_id)
    )
    OR EXISTS (
      SELECT 1
      FROM notification_assignees owner_na
      JOIN users owner_u ON owner_u.id = owner_na.user_id
      WHERE owner_na.notification_id = NEW.id
    )
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO tasks (
    id, audience, visibility, type, urgency, status, title, message,
    case_id, complaint_id, appointment_id, due_at, completion_notes,
    completed_by, completed_at, case_note_required, legacy_notification_id,
    created_at, updated_at
  ) VALUES (
    NEW.id, task_audience, task_visibility, NEW.type, NEW.urgency, NEW.status,
    NEW.title, NEW.message, NEW.case_id, NEW.complaint_id, NEW.appointment_id,
    NEW.follow_up_date, NEW.completion_notes, NEW.completed_by, NEW.completed_at,
    NEW.case_note_required, NEW.id, NEW.created_at, NOW()
  ) ON CONFLICT (id) DO UPDATE SET
    audience = EXCLUDED.audience,
    visibility = EXCLUDED.visibility,
    type = EXCLUDED.type,
    urgency = EXCLUDED.urgency,
    status = EXCLUDED.status,
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    case_id = EXCLUDED.case_id,
    complaint_id = EXCLUDED.complaint_id,
    appointment_id = EXCLUDED.appointment_id,
    due_at = EXCLUDED.due_at,
    completion_notes = EXCLUDED.completion_notes,
    completed_by = EXCLUDED.completed_by,
    completed_at = EXCLUDED.completed_at,
    case_note_required = EXCLUDED.case_note_required,
    updated_at = NOW();

  IF NEW.assigned_to IS NOT NULL
    AND EXISTS (SELECT 1 FROM users WHERE id = NEW.assigned_to) THEN
    INSERT INTO task_assignees (task_id, user_id)
    VALUES (NEW.id, NEW.assigned_to)
    ON CONFLICT (task_id, user_id) DO NOTHING;
  END IF;
  IF NEW.recipient_role IN ('mediator', 'client', 'task_assignee', 'staff', 'subadmin')
    AND NEW.recipient_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM users WHERE id = NEW.recipient_id) THEN
    INSERT INTO task_assignees (task_id, user_id)
    VALUES (NEW.id, NEW.recipient_id)
    ON CONFLICT (task_id, user_id) DO NOTHING;
  END IF;
  UPDATE notifications SET task_id = NEW.id WHERE id = NEW.id AND task_id IS DISTINCT FROM NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_task_mirror_trigger ON notifications;
CREATE TRIGGER notifications_task_mirror_trigger
AFTER INSERT OR UPDATE OF recipient_id, recipient_role, type, urgency, status,
  title, message, case_id, complaint_id, appointment_id, assigned_to,
  follow_up_date, completion_notes, completed_by, completed_at, case_note_required
ON notifications
FOR EACH ROW EXECUTE FUNCTION mirror_actionable_notification_to_task();

CREATE OR REPLACE FUNCTION mirror_notification_assignee_to_task()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM task_assignees
    WHERE task_id = OLD.notification_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tasks WHERE id = NEW.notification_id) THEN
    UPDATE notifications
    SET assigned_to = assigned_to
    WHERE id = NEW.notification_id;
  END IF;
  IF EXISTS (SELECT 1 FROM tasks WHERE id = NEW.notification_id) THEN
    INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at)
    VALUES (NEW.notification_id, NEW.user_id, NEW.assigned_by, NEW.assigned_at)
    ON CONFLICT (task_id, user_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_assignees_task_mirror_trigger ON notification_assignees;
CREATE TRIGGER notification_assignees_task_mirror_trigger
AFTER INSERT OR UPDATE OR DELETE ON notification_assignees
FOR EACH ROW EXECUTE FUNCTION mirror_notification_assignee_to_task();
