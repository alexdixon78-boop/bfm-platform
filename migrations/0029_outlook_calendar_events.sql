CREATE TABLE IF NOT EXISTS outlook_calendar_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  mediator_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlook_event_id text NOT NULL,
  title text,
  start_at timestamp NOT NULL,
  end_at timestamp NOT NULL,
  is_all_day boolean NOT NULL DEFAULT false,
  attendees jsonb DEFAULT '[]'::jsonb,
  bfm_attendance_status text,
  is_organiser boolean NOT NULL DEFAULT false,
  synced_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (mediator_id, outlook_event_id)
);
