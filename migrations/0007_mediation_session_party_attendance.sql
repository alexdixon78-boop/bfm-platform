CREATE TABLE IF NOT EXISTS "mediation_session_party_attendance" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" varchar NOT NULL REFERENCES "cases"("id") ON DELETE cascade,
  "mediation_session_id" varchar NOT NULL REFERENCES "mediation_sessions"("id") ON DELETE cascade,
  "party_id" varchar NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'no_show',
  "marked_by" varchar REFERENCES "users"("id") ON DELETE set null,
  "marked_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "mediation_session_party_attendance_session_party_unique"
  ON "mediation_session_party_attendance" ("mediation_session_id", "party_id");
CREATE INDEX IF NOT EXISTS "mediation_session_party_attendance_session_idx"
  ON "mediation_session_party_attendance" ("mediation_session_id");
CREATE INDEX IF NOT EXISTS "mediation_session_party_attendance_party_idx"
  ON "mediation_session_party_attendance" ("party_id");
