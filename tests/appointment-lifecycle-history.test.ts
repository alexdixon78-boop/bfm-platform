import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema, migration, and bootstrap define canonical appointment lifecycle history", () => {
  const schema = read("../shared/schema.ts");
  const bootstrap = read("../server/db-bootstrap.ts");
  const migrationPath = new URL("../migrations/0008_appointment_lifecycle_history.sql", import.meta.url);

  assert.ok(existsSync(migrationPath), "migration 0008 should exist");
  const migration = read("../migrations/0008_appointment_lifecycle_history.sql");

  for (const source of [schema, bootstrap, migration]) {
    assert.match(source, /appointment_status_history/);
    assert.match(source, /appointment_id/);
    assert.match(source, /mediation_session_id/);
    assert.match(source, /previous_status/);
    assert.match(source, /new_status/);
    assert.match(source, /previous_date_time/);
    assert.match(source, /new_date_time/);
    assert.match(source, /event_type/);
    assert.match(source, /changed_by/);
    assert.match(source, /metadata/);
  }

  assert.match(migration, /ON DELETE set null/i);
  assert.match(migration, /appointment_status_history_appointment_idx/);
  assert.match(migration, /appointment_status_history_case_idx/);
  assert.match(migration, /appointment_status_history_session_idx/);
  assert.match(migration, /appointment_status_history_changed_at_idx/);
});

test("services record appointment lifecycle status changes and reschedule reminder reset", () => {
  const appointmentService = read("../server/services/appointment.service.ts");
  const mediationSessionService = read("../server/services/mediation-session.service.ts");

  assert.match(appointmentService, /appointmentLifecycleHistoryService/);
  assert.match(appointmentService, /recordAppointmentCreated/);
  assert.match(appointmentService, /recordAppointmentRescheduled/);
  assert.match(appointmentService, /recordAppointmentStatusChange/);
  assert.match(appointmentService, /holdAlertSentAt\s*=\s*null/);
  assert.match(appointmentService, /holdExpiresAt\s*=\s*calculateHoldDeadline\(newDateTime\)/);

  assert.match(mediationSessionService, /recordMediationSessionHoldReleased/);
  assert.match(mediationSessionService, /recordMediationSessionReplacementProposed/);
  assert.match(mediationSessionService, /recordAppointmentStatusChange\(updated,\s*appointment\.status,\s*"expired"/);
});

test("history APIs and UI surfaces expose sanitized appointment lifecycle history", () => {
  const routes = read("../server/routes/appointment.routes.ts");
  const appointmentsPage = read("../client/src/pages/appointments.tsx");
  const caseDetail = read("../client/src/pages/case-detail.tsx");

  assert.match(routes, /\/api\/appointments\/:id\/history/);
  assert.match(routes, /\/api\/cases\/:caseId\/appointment-history/);
  assert.match(routes, /sanitizeAppointmentHistory/);

  assert.match(appointmentsPage, /AppointmentHistoryList/);
  assert.match(appointmentsPage, /\/api\/appointments\/\$\{appointmentId\}\/history/);
  assert.match(appointmentsPage, /data-testid="appointment-history-section"/);

  assert.match(caseDetail, /SessionAppointmentHistoryList/);
  assert.match(caseDetail, /\/api\/appointments\/\$\{appointmentId\}\/history/);
  assert.match(caseDetail, /data-testid=\{`session-appointment-history-\$\{appointmentId\}`\}/);
});
