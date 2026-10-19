import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "client/src/pages/appointments.tsx"), "utf8");

test("appointments page always shows availability help to admins and mediators", () => {
  assert.match(source, /\/api\/calendar\/availability-import-status/);
  assert.match(source, /\{\(isAdmin \|\| isMediator\) && \(/);
  assert.doesNotMatch(source, /availabilityImportStatus\?\.enabled && \(isAdmin \|\| isMediator\)/);
  assert.match(source, /data-testid="card-calendar-availability-help"/);
  assert.match(source, /data-testid="text-calendar-availability-help-title"/);
  assert.match(source, /data-testid="list-calendar-availability-steps"/);
});

test("staff and clients are excluded by the admin-or-mediator role gate", () => {
  assert.match(source, /const isAdmin = role === "superadmin" \|\| role === "subadmin"/);
  assert.match(source, /const isMediator = role === "mediator"/);
  assert.match(source, /\{\(isAdmin \|\| isMediator\) && \(/);
});

test("guidance lists both accepted availability prefixes and the required invitation details", () => {
  assert.match(source, /Add availability from your calendar/);
  assert.match(source, /Mediators can add availability from their calendar/);
  assert.match(source, /info@brighterfuturemediation\.co\.uk/);
  assert.match(source, /BFM availability/);
  assert.match(source, /BFM available/);
  assert.match(source, /begins with/);
  assert.match(source, /BFM availability - MIAM/);
  assert.match(source, /BFM available - MIAM/);
  assert.match(source, /all-day event makes.*available for the whole day/);
  assert.match(source, /Capital letters do not matter/);
  assert.match(source, /Only add times that clients can book/);
});

test("disconnected mediators can open the existing connection modal from the card", () => {
  assert.match(source, /data-testid="button-calendar-availability-connect"/);
  assert.match(source, /setCalendarSettingsOpen\(true\)/);
});

test("guidance always promises calendar importing because the feature is permanent", () => {
  assert.match(source, /BFM will add this time to every service/);
  assert.doesNotMatch(source, /Calendar availability is not turned on yet/);
  assert.doesNotMatch(source, /availabilityImportStatus && !availabilityImportStatus\.enabled/);
});

test("capability errors keep the card visible and show a simple retry message", () => {
  assert.match(source, /isError: availabilityImportStatusError/);
  assert.match(source, /BFM could not check whether calendar availability is turned on\. Please try again later\./);
});
