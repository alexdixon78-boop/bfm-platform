import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("Google timestamp repair is an explicit reconciliation mode without routine admin tasks", () => {
  const google = read("server/services/google-calendar.service.ts");
  const reconciliation = read("server/services/calendar-availability-reconciliation-runtime.ts");
  const repair = read("server/scripts/repair-google-calendar-instants.ts");

  assert.match(google, /syncCalendar\(mediatorId: string, reconciliationTrigger: CalendarAvailabilityTrigger = "fallback_sweep"\)/);
  assert.match(reconciliation, /"timestamp_repair"/);
  assert.match(reconciliation, /calendar_availability_timestamp_normalized/);
  assert.match(reconciliation, /trigger !== "timestamp_repair"/);
  assert.match(reconciliation, /retiredReason: "timestamp_repair"/);
  assert.match(reconciliation, /timestampRepairBookedSlots/);
  assert.match(repair, /syncCalendar\(mediator\.id, "timestamp_repair"\)/);
  assert.match(repair, /await pool\.end\(\)/);
});
