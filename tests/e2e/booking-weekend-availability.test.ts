/**
 * E2E integration test: Booking weekend availability (Task #162)
 *
 * Regression coverage for the bug where Saturday/Sunday were silently
 * hidden by a hard-coded `isWeekend` disable in the public booking
 * MiniCalendar even though the server correctly returned the date.
 *
 * Strategy:
 *   - Find an active mediator with Google Calendar connected (write scope)
 *     and at least one qualifying service type.
 *   - Find a party with a valid (unexpired) booking token.
 *   - Seed a `google_calendar_events` row for that mediator on the next
 *     Saturday at 09:30–13:30 (wall-clock-as-UTC), bfm_attendance_status
 *     = "accepted".
 *   - Call `GET /api/booking/{token}/available-dates` for that month
 *     and assert the seeded Saturday is included.
 *   - Clean up the seeded row.
 *
 * Run against the local dev server (npm run dev must be running):
 *   npx tsx tests/e2e/booking-weekend-availability.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

function nextSaturdayUTC(from: Date): Date {
  // Find the next Saturday strictly after `from` (UTC). If `from` is itself
  // a Saturday, return the following Saturday to ensure we don't race the
  // server's "today" cutoff in availabilityService.getAvailableDates.
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const daysUntilSat = ((6 - dow + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilSat);
  return d;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

test("Saturday with seeded BFM-accepted Google availability appears in /available-dates", async (t) => {
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();

  let seededEventId: string | null = null;

  try {
    // 1. Pick a fulfillable mediator (active + Google connected with write
    //    scope + not in needs_write_scope error state).
    const mediatorRes = await pg.query<{ id: string; email: string }>(
      `SELECT id, email FROM users
         WHERE role = 'mediator' AND status = 'active'
           AND google_calendar_connected = true
           AND (last_calendar_sync_error IS NULL OR last_calendar_sync_error <> 'needs_write_scope')
           AND (
             google_scope_granted LIKE '%calendar.events%'
             OR google_scope_granted LIKE '%/auth/calendar%'
           )
         LIMIT 1`,
    );
    if (mediatorRes.rowCount === 0) {
      t.skip("No fulfillable Google-connected mediator seeded — skipping");
      return;
    }
    const mediator = mediatorRes.rows[0];

    // 2. Find a service type the mediator is qualified for (joined via
    //    mediator_service_types).
    const serviceRes = await pg.query<{ id: string; name: string }>(
      `SELECT st.id, st.name
         FROM service_types st
         JOIN mediator_service_types mst ON mst.service_type_id = st.id
         WHERE mst.mediator_id = $1 AND st.is_active = true
         LIMIT 1`,
      [mediator.id],
    );
    if (serviceRes.rowCount === 0) {
      t.skip(`Mediator ${mediator.email} has no qualifying active service — skipping`);
      return;
    }
    const service = serviceRes.rows[0];

    // 3. Find a party with a non-expired booking token.
    const partyRes = await pg.query<{ booking_token: string }>(
      `SELECT booking_token FROM parties
         WHERE booking_token IS NOT NULL
           AND (booking_token_expires_at IS NULL OR booking_token_expires_at > NOW())
         LIMIT 1`,
    );
    if (partyRes.rowCount === 0) {
      t.skip("No party with active booking token — skipping");
      return;
    }
    const token = partyRes.rows[0].booking_token;

    // 4. Compute next Saturday (UTC) and seed a Google availability event
    //    on that Saturday 09:30–13:30 wall-clock-as-UTC.
    const sat = nextSaturdayUTC(new Date());
    const startAt = new Date(Date.UTC(sat.getUTCFullYear(), sat.getUTCMonth(), sat.getUTCDate(), 9, 30, 0));
    const endAt = new Date(Date.UTC(sat.getUTCFullYear(), sat.getUTCMonth(), sat.getUTCDate(), 13, 30, 0));
    const month = `${sat.getUTCFullYear()}-${String(sat.getUTCMonth() + 1).padStart(2, "0")}`;
    const expectedDateStr = ymd(sat);
    const fakeGoogleEventId = `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const insertRes = await pg.query<{ id: string }>(
      `INSERT INTO google_calendar_events
         (mediator_id, google_event_id, title, start_at, end_at, is_all_day,
          attendees, bfm_attendance_status, is_organiser)
       VALUES ($1, $2, $3, $4, $5, false, $6::jsonb, 'accepted', false)
       RETURNING id`,
      [
        mediator.id,
        fakeGoogleEventId,
        "E2E Test — Saturday Availability",
        startAt,
        endAt,
        JSON.stringify([
          { email: "info@brighterfuturemediation.co.uk", responseStatus: "accepted" },
        ]),
      ],
    );
    seededEventId = insertRes.rows[0].id;

    // 5. Hit the public available-dates endpoint and assert Saturday is
    //    present in the returned set.
    const url = `${BASE_URL}/api/booking/${encodeURIComponent(token)}/available-dates`
      + `?serviceTypeId=${encodeURIComponent(service.id)}&month=${encodeURIComponent(month)}`;
    const res = await fetch(url);
    assert.equal(res.status, 200, `available-dates returned ${res.status}`);
    const body = (await res.json()) as { dates: string[]; bookingPaused: boolean };
    assert.equal(body.bookingPaused, false, "bookingPaused must be false");
    assert.ok(
      Array.isArray(body.dates) && body.dates.includes(expectedDateStr),
      `Expected ${expectedDateStr} (Saturday) in available dates for service "${service.name}"; `
        + `got: ${JSON.stringify(body.dates)}`,
    );
  } finally {
    if (seededEventId) {
      await pg.query(`DELETE FROM google_calendar_events WHERE id = $1`, [seededEventId]);
    }
    await pg.end();
  }
});
