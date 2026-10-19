CREATE TABLE IF NOT EXISTS mediator_calendar_availability_sources (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  external_series_id TEXT,
  origin TEXT NOT NULL,
  scope_mode TEXT NOT NULL,
  title TEXT,
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP NOT NULL,
  provider_fingerprint TEXT NOT NULL,
  expected_provider_fingerprint TEXT,
  admin_task_id VARCHAR,
  audit_correlation_id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT mediator_calendar_availability_sources_provider_check CHECK (provider IN ('google', 'outlook')),
  CONSTRAINT mediator_calendar_availability_sources_origin_check CHECK (origin IN ('mediator_invite', 'bfm_service')),
  CONSTRAINT mediator_calendar_availability_sources_scope_check CHECK (scope_mode IN ('all_approved_services', 'fixed_services')),
  CONSTRAINT mediator_calendar_availability_sources_state_check CHECK (state IN ('active', 'invalid', 'deleted', 'sync_error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS mediator_calendar_availability_source_event_unique
  ON mediator_calendar_availability_sources(mediator_id, provider, external_event_id);
CREATE INDEX IF NOT EXISTS mediator_calendar_availability_source_series_idx
  ON mediator_calendar_availability_sources(mediator_id, provider, external_series_id);
CREATE INDEX IF NOT EXISTS mediator_calendar_availability_source_state_idx
  ON mediator_calendar_availability_sources(state, last_seen_at);

ALTER TABLE google_calendar_events
  ADD COLUMN IF NOT EXISTS external_series_id TEXT,
  ADD COLUMN IF NOT EXISTS organizer_email TEXT;

ALTER TABLE outlook_calendar_events
  ADD COLUMN IF NOT EXISTS external_series_id TEXT,
  ADD COLUMN IF NOT EXISTS organizer_email TEXT;

ALTER TABLE mediator_service_schedule_slots
  ADD COLUMN IF NOT EXISTS availability_source_id VARCHAR REFERENCES mediator_calendar_availability_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS retired_reason TEXT,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMP;

INSERT INTO mediator_calendar_availability_sources (
  mediator_id, provider, external_event_id, origin, scope_mode, title,
  start_at, end_at, provider_fingerprint, last_seen_at
)
SELECT DISTINCT ON (mediator_id, COALESCE(calendar_provider, 'google'), google_event_id)
  mediator_id,
  COALESCE(calendar_provider, 'google'),
  google_event_id,
  'bfm_service',
  'fixed_services',
  'BFM service availability',
  start_at,
  end_at,
  'legacy_backfill:' || md5(COALESCE(calendar_provider, 'google') || ':' || google_event_id || ':' || start_at::text || ':' || end_at::text),
  NOW()
FROM mediator_service_schedule_slots
WHERE google_event_id IS NOT NULL
ON CONFLICT (mediator_id, provider, external_event_id) DO NOTHING;

UPDATE mediator_service_schedule_slots AS slot
SET availability_source_id = source.id
FROM mediator_calendar_availability_sources AS source
WHERE slot.google_event_id IS NOT NULL
  AND source.mediator_id = slot.mediator_id
  AND source.provider = COALESCE(slot.calendar_provider, 'google')
  AND source.external_event_id = slot.google_event_id
  AND slot.availability_source_id IS NULL;

DROP INDEX IF EXISTS mediator_service_schedule_slots_unique;
CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_schedule_slots_manual_unique
  ON mediator_service_schedule_slots(mediator_id, service_type_id, start_at, end_at)
  WHERE availability_source_id IS NULL AND lifecycle = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_schedule_slots_source_service_unique
  ON mediator_service_schedule_slots(availability_source_id, service_type_id)
  WHERE availability_source_id IS NOT NULL AND lifecycle = 'active';

CREATE TABLE IF NOT EXISTS calendar_webhook_subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_subscription_id TEXT,
  channel_id TEXT,
  resource_id TEXT,
  client_state_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP,
  last_notification_at TIMESTAMP,
  last_error TEXT,
  renewal_failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT calendar_webhook_subscriptions_provider_check CHECK (provider IN ('google', 'outlook'))
);
ALTER TABLE calendar_webhook_subscriptions
  ADD COLUMN IF NOT EXISTS renewal_failure_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_webhook_subscriptions_provider_external_unique
  ON calendar_webhook_subscriptions(provider, external_subscription_id);
CREATE INDEX IF NOT EXISTS calendar_webhook_subscriptions_renewal_idx
  ON calendar_webhook_subscriptions(status, expires_at);

CREATE TABLE IF NOT EXISTS calendar_availability_reconciliation_jobs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  trigger TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_lease_expires_at TIMESTAMP,
  last_attempt_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT calendar_availability_reconciliation_jobs_provider_check CHECK (provider IN ('google', 'outlook'))
);
CREATE INDEX IF NOT EXISTS calendar_availability_reconciliation_jobs_due_idx
  ON calendar_availability_reconciliation_jobs(status, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_availability_reconciliation_jobs_active_dedupe_unique
  ON calendar_availability_reconciliation_jobs(mediator_id, provider, dedupe_key)
  WHERE status IN ('pending', 'processing');

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS availability_source_id VARCHAR REFERENCES mediator_calendar_availability_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS availability_reservation_mode TEXT;
