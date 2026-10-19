CREATE TABLE IF NOT EXISTS appointment_client_calendar_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id VARCHAR NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  party_id VARCHAR NOT NULL REFERENCES parties(id),
  google_event_id TEXT NOT NULL,
  ical_uid TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_client_calendar_events_appointment_party_unique
  ON appointment_client_calendar_events(appointment_id, party_id);
