ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "first_contact_method" text;
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "first_contact_notes" text;
--> statement-breakpoint

-- Keep malformed legacy audit details from aborting the repair. The migration
-- runs on one transaction connection; pg_temp creates no application objects.
CREATE OR REPLACE FUNCTION pg_temp.try_parse_jsonb(value text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Restore canonical Day 0 values from the earliest existing audit record.
WITH earliest_first_contact AS (
  SELECT DISTINCT ON (entity_id)
    entity_id,
    timestamp,
    pg_temp.try_parse_jsonb(details) AS details
  FROM audit_logs
  WHERE action = 'case_intake_first_contact'
    AND entity = 'case'
    AND entity_id IS NOT NULL
  ORDER BY entity_id, timestamp ASC, id ASC
), repaired_cases AS (
  UPDATE cases AS c
  SET
    first_contact_attempted_at = e.timestamp,
    -- SQL NULL here means the temporary parser rejected malformed legacy
    -- details (or the old value was absent). Preserve bootstrap-populated
    -- fields in that case; JSON null/missing fields remain valid payloads and
    -- retain the original canonical-null behavior below.
    first_contact_method = CASE
      WHEN e.details IS NULL THEN c.first_contact_method
      ELSE NULLIF(e.details ->> 'contactMethod', 'not specified')
    END,
    first_contact_notes = CASE
      WHEN e.details IS NULL THEN c.first_contact_notes
      ELSE NULLIF(e.details ->> 'notes', '')
    END,
    intake_status = CASE WHEN c.intake_status IN ('New', 'Claimed') THEN 'Chasing' ELSE c.intake_status END,
    last_updated = now()
  FROM earliest_first_contact AS e
  WHERE c.id = e.entity_id
    AND (
      c.first_contact_attempted_at IS DISTINCT FROM e.timestamp
      OR c.first_contact_method IS DISTINCT FROM CASE
        WHEN e.details IS NULL THEN c.first_contact_method
        ELSE NULLIF(e.details ->> 'contactMethod', 'not specified')
      END
      OR c.first_contact_notes IS DISTINCT FROM CASE
        WHEN e.details IS NULL THEN c.first_contact_notes
        ELSE NULLIF(e.details ->> 'notes', '')
      END
    )
  RETURNING c.id, c.case_ref, c.first_contact_attempted_at
)
INSERT INTO audit_logs (user_id, action, entity, entity_id, entity_ref, details)
SELECT
  NULL,
  'case_intake_first_contact_repaired',
  'case',
  r.id,
  r.case_ref,
  jsonb_build_object('repair', true, 'firstContactAttemptedAt', r.first_contact_attempted_at)::text
FROM repaired_cases AS r
WHERE NOT EXISTS (
  SELECT 1
  FROM audit_logs AS prior
  WHERE prior.action = 'case_intake_first_contact_repaired'
    AND prior.entity = 'case'
    AND prior.entity_id = r.id
);
--> statement-breakpoint

-- A repaired Day 0 record makes any still-open Day 0 reminder stale.
UPDATE notifications AS n
SET
  status = 'completed',
  completed_at = COALESCE(n.completed_at, now()),
  completion_notes = COALESCE(n.completion_notes, 'Completed by intake first-contact transition repair.')
FROM cases AS c
WHERE n.case_id = c.id
  AND n.type = 'enquiry_follow_up'
  AND n.status IN ('active', 'in_progress', 'follow_up')
  AND c.first_contact_attempted_at IS NOT NULL;
--> statement-breakpoint

-- Create a Day 5 task only when an eligible case has no Day 5 task already.
INSERT INTO notifications (
  recipient_role,
  type,
  urgency,
  case_id,
  title,
  message,
  status,
  follow_up_date,
  case_note_required
)
SELECT
  'admin',
  'enquiry_chase',
  'amber',
  c.id,
  'Day 5 chase — ' || c.case_ref,
  '[day-5] Standard SOP enquiry chase. Completion notes are required before closing this task.',
  'active',
  c.first_contact_attempted_at + INTERVAL '5 days',
  true
FROM cases AS c
WHERE c.first_contact_attempted_at IS NOT NULL
  AND c.status NOT IN ('Closed', 'Archived')
  AND c.intake_status <> 'Closed'
  AND c.safeguarding_status = 'clear'
  AND COALESCE(c.standard_chase_stopped, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM notifications AS existing
    WHERE existing.case_id = c.id
      AND existing.type = 'enquiry_chase'
      AND (existing.message ILIKE '%day-5%' OR existing.title ILIKE '%Day 5%')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM notifications AS later_open
    WHERE later_open.case_id = c.id
      AND later_open.status IN ('active', 'in_progress', 'follow_up')
      AND (
        later_open.type = 'enquiry_persistent_follow_up'
        OR (later_open.type = 'enquiry_chase' AND (later_open.message ILIKE '%day-10%' OR later_open.title ILIKE '%Day 10%'))
      )
  );
--> statement-breakpoint

-- Backfill exactly one audit record for every Day 5 task, including tasks
-- created before this migration. This migration deliberately sends no emails,
-- webhooks, or realtime notifications.
INSERT INTO audit_logs (user_id, action, entity, entity_id, entity_ref, details)
SELECT
  NULL,
  'case_intake_day5_chase_created',
  'case',
  c.id,
  c.case_ref,
  jsonb_build_object('taskId', n.id, 'followUpDate', n.follow_up_date, 'repair', true)::text
FROM notifications AS n
JOIN cases AS c ON c.id = n.case_id
WHERE n.type = 'enquiry_chase'
  AND (n.message ILIKE '%day-5%' OR n.title ILIKE '%Day 5%')
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs AS prior
    WHERE prior.action = 'case_intake_day5_chase_created'
      AND prior.entity = 'case'
      AND prior.entity_id = c.id
      AND (pg_temp.try_parse_jsonb(prior.details) ->> 'taskId') = n.id
  );
--> statement-breakpoint

DROP FUNCTION pg_temp.try_parse_jsonb(text);
