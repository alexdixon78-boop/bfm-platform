/** Read-only report for public bookings whose saved time basis can be verified. */
import "dotenv/config";
import { Pool } from "pg";
import { loadRuntimeEnv } from "../config/runtime-env";

async function main() {
  await loadRuntimeEnv();
  const { getPostgresPoolConfig } = await import("../config/postgres");
  const pool = new Pool(getPostgresPoolConfig());
  const client = await pool.connect();
  let applicationPool: Pool | null = null;
  try {
  await client.query("BEGIN READ ONLY");
  const { rows } = await client.query<{
    id: string;
    matching_schedule_slots: string;
    parent_google_event_id: string | null;
  }>(`
    SELECT appointment.id, appointment.parent_google_event_id,
      (SELECT count(*)::text FROM mediator_service_schedule_slots AS slot
        WHERE slot.mediator_id = appointment.mediator_id
          AND slot.service_type_id = appointment.service_type_id
          AND slot.google_event_id = appointment.parent_google_event_id
          AND appointment.date_time >= slot.start_at
          AND appointment.date_time + appointment.duration * INTERVAL '1 minute' <= slot.end_at
      ) AS matching_schedule_slots
    FROM appointments AS appointment
    WHERE appointment.booking_token IS NOT NULL
    ORDER BY appointment.created_at DESC
  `);
  const verified = rows.filter((row) => Number(row.matching_schedule_slots) === 1);
  const ambiguous = rows.filter((row) => Number(row.matching_schedule_slots) > 1);
  const unmatchedCalendar = rows.filter((row) => row.parent_google_event_id && Number(row.matching_schedule_slots) === 0);
  const legacy = rows.filter((row) => !row.parent_google_event_id);
  const migrationStatus = await client.query<{ id: number }>(
    "SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1",
  );
  const basisCounts = await client.query<{ date_time_basis: string; count: string }>(
    "SELECT date_time_basis, count(*)::text AS count FROM appointments WHERE booking_token IS NOT NULL GROUP BY date_time_basis",
  );
  const mediatorId = process.argv.find((arg) => arg.startsWith("--mediator="))?.slice("--mediator=".length);
  const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  let selectedMediatorSlots: unknown[] | undefined;
  let bookingSlots: unknown[] | undefined;
  if (mediatorId && date) {
    if (!/^[0-9a-f-]{36}$/i.test(mediatorId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Invalid mediator or date filter");
    }
    const selected = await client.query(`
      SELECT service_type_id, service.name AS service_name,
        to_char(start_at, 'YYYY-MM-DD HH24:MI') AS stored_utc_start,
        to_char(end_at, 'YYYY-MM-DD HH24:MI') AS stored_utc_end,
        to_char(start_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI') AS london_start,
        to_char(end_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London', 'HH24:MI') AS london_end
      FROM mediator_service_schedule_slots AS slot
      JOIN service_types AS service ON service.id = slot.service_type_id
      WHERE slot.mediator_id = $1
        AND (start_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date = $2::date
      ORDER BY start_at
    `, [mediatorId, date]);
    selectedMediatorSlots = selected.rows;
    if (process.argv.includes("--check-booking-slots")) {
      applicationPool = (await import("../db")).pool;
      const { availabilityService } = await import("../services/availability.service");
      const serviceIds = Array.from(new Set(selected.rows.map((row) => row.service_type_id as string)));
      bookingSlots = await Promise.all(serviceIds.map(async (serviceTypeId) => ({
        serviceTypeId,
        slots: await availabilityService.getAvailableSlots(serviceTypeId, date),
      })));
    }
  }
  console.log(JSON.stringify({
    latestAppliedMigrationId: migrationStatus.rows[0]?.id ?? null,
    appointmentBasisCounts: Object.fromEntries(basisCounts.rows.map((row) => [row.date_time_basis, Number(row.count)])),
    totalPublicBookings: rows.length,
    verifiedCalendarScheduleBookings: verified.length,
    legacyWithoutParentCalendarEvent: legacy.length,
    ambiguousAppointmentIds: ambiguous.map((row) => row.id),
    unmatchedCalendarAppointmentIds: unmatchedCalendar.map((row) => row.id),
    ...(selectedMediatorSlots ? { selectedMediatorSlots } : {}),
    ...(bookingSlots ? { bookingSlots } : {}),
  }, null, 2));
  await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
    if (applicationPool) await applicationPool.end();
  }
}

main().catch((error) => {
  console.error("Booking time audit failed:", error);
  process.exitCode = 1;
});
