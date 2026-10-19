ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_calendar_provider text;

UPDATE users
SET active_calendar_provider = CASE
  WHEN COALESCE(google_calendar_connected, false) = true
    AND COALESCE(outlook_calendar_connected, false) = false THEN 'google'
  WHEN COALESCE(outlook_calendar_connected, false) = true
    AND COALESCE(google_calendar_connected, false) = false THEN 'outlook'
  ELSE NULL
END
WHERE role = 'mediator'
  AND active_calendar_provider IS NULL;

ALTER TABLE mediator_service_schedule_slots
  ADD COLUMN IF NOT EXISTS calendar_provider text;

UPDATE mediator_service_schedule_slots
SET calendar_provider = 'google'
WHERE google_event_id IS NOT NULL
  AND calendar_provider IS NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS parent_calendar_provider text,
  ADD COLUMN IF NOT EXISTS booking_calendar_provider text,
  ADD COLUMN IF NOT EXISTS trailing_remnant_calendar_provider text;

UPDATE appointments
SET parent_calendar_provider = 'google'
WHERE parent_google_event_id IS NOT NULL
  AND parent_calendar_provider IS NULL;

UPDATE appointments
SET booking_calendar_provider = 'google'
WHERE google_booking_event_id IS NOT NULL
  AND booking_calendar_provider IS NULL;

UPDATE appointments
SET trailing_remnant_calendar_provider = 'google'
WHERE google_trailing_remnant_event_id IS NOT NULL
  AND trailing_remnant_calendar_provider IS NULL;
