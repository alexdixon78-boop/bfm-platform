ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS date_time_basis text NOT NULL DEFAULT 'wall_clock_utc';

-- Only classify bookings with an exact saved calendar-slot match. Ambiguous
-- historical appointments retain their existing display until reviewed.
UPDATE appointments AS appointment
SET date_time_basis = 'instant'
WHERE appointment.booking_token IS NOT NULL
  AND appointment.parent_google_event_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM mediator_service_schedule_slots AS slot
    WHERE slot.mediator_id = appointment.mediator_id
      AND slot.service_type_id = appointment.service_type_id
      AND slot.google_event_id = appointment.parent_google_event_id
      AND appointment.date_time >= slot.start_at
      AND appointment.date_time + appointment.duration * INTERVAL '1 minute' <= slot.end_at
  );
