ALTER TABLE mediator_calendar_availability_sources
  ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS historical_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS out_of_window_at TIMESTAMP;

ALTER TABLE mediator_calendar_availability_sources
  DROP CONSTRAINT IF EXISTS mediator_calendar_availability_sources_state_check;

ALTER TABLE mediator_calendar_availability_sources
  ADD CONSTRAINT mediator_calendar_availability_sources_state_check
  CHECK (state IN ('active', 'historical', 'out_of_window', 'invalid', 'deleted', 'sync_error'));

DROP INDEX IF EXISTS mediator_service_schedule_slots_source_service_unique;
CREATE UNIQUE INDEX mediator_service_schedule_slots_source_service_unique
  ON mediator_service_schedule_slots(availability_source_id, service_type_id, start_at, end_at)
  WHERE availability_source_id IS NOT NULL AND lifecycle = 'active';
