/**
 * Regression coverage for the atomic Day 0 intake transition.
 *
 * Run with: npx tsx tests/intake-first-contact-transition.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cases } from "../shared/schema";
import * as intakeTransition from "../server/services/intake-first-contact.transition";

test("Day 0 stores the canonical contact method and optional notes on the case", () => {
  // Removing either persisted field would make the completed Day 0 record
  // impossible to display immutably while later chase tasks advance.
  assert.equal(cases.firstContactMethod.name, "first_contact_method");
  assert.equal(cases.firstContactNotes.name, "first_contact_notes");
});

test("first-contact endpoint delegates its Day 0 state transition to the atomic service", () => {
  const routeSource = readFileSync(new URL("../server/routes/case.routes.ts", import.meta.url), "utf8");

  // Replacing this delegation with independent route writes would reintroduce
  // the partial-transition failure this service protects against.
  assert.match(routeSource, /recordIntakeFirstContact\(/);
});

test("locked transition gates closed intake and derives a five-calendar-day due date", () => {
  const result = (intakeTransition as any).validateLockedFirstContact(
    {
      status: "Active",
      intakeStatus: "Closed",
      firstContactAttemptedAt: null,
      safeguardingStatus: "clear",
      standardChaseStopped: false,
      claimedBy: "staff-1",
    },
    { id: "staff-1", role: "subadmin" },
  );
  assert.deepEqual(result, { ok: false, status: 400, message: "Closed or archived cases cannot be chased" });
  assert.equal(
    (intakeTransition as any).addFiveCalendarDays(new Date("2026-03-27T12:00:00.000Z")).toISOString(),
    "2026-04-01T12:00:00.000Z",
  );
});

test("locked transition blocks pending safeguarding and competing Staff claims", () => {
  const base = {
    status: "Active",
    intakeStatus: "Claimed",
    firstContactAttemptedAt: null,
    safeguardingStatus: "clear",
    standardChaseStopped: false,
    claimedBy: "staff-1",
  } as const;
  assert.deepEqual(
    (intakeTransition as any).validateLockedFirstContact({ ...base, firstContactAttemptedAt: new Date("2026-03-27") }, { id: "staff-1", role: "subadmin" }),
    { ok: false, status: 409, message: "First contact has already been recorded" },
  );
  assert.deepEqual(
    (intakeTransition as any).validateLockedFirstContact({ ...base, safeguardingStatus: "pending" }, { id: "staff-1", role: "subadmin" }),
    { ok: false, status: 409, message: "Please complete the safeguarding check before recording first contact" },
  );
  assert.deepEqual(
    (intakeTransition as any).validateLockedFirstContact(base, { id: "staff-2", role: "staff" }),
    { ok: false, status: 409, message: "This enquiry is claimed by another staff member" },
  );
});

test("both admin roles can record first contact across claims during active safeguarding", () => {
  const activeConcern = {
    status: "Active",
    intakeStatus: "Safeguarding",
    firstContactAttemptedAt: null,
    safeguardingStatus: "concern",
    standardChaseStopped: true,
    claimedBy: "superadmin-owner",
  } as const;

  assert.deepEqual(
    (intakeTransition as any).validateLockedFirstContact(activeConcern, { id: "subadmin-1", role: "subadmin" }),
    { ok: true },
  );
  assert.deepEqual(
    (intakeTransition as any).validateLockedFirstContact(activeConcern, { id: "superadmin-2", role: "superadmin" }),
    { ok: true },
  );
  assert.equal(
    (intakeTransition as any).validateLockedFirstContact(activeConcern, { id: "staff-1", role: "staff" }).status,
    409,
  );
});

test("Day 5 reconciliation preserves completed history and leaves exactly one open task", () => {
  const reconciliation = (intakeTransition as any).reconcileDay5Tasks([
    { id: "completed", status: "completed", type: "enquiry_chase", title: "Day 5 chase", message: "[day-5]", followUpDate: new Date("2026-04-01") },
    { id: "open-old", status: "active", type: "enquiry_chase", title: "Day 5 chase", message: "[day-5]", followUpDate: new Date("2026-03-31") },
    { id: "open-duplicate", status: "follow_up", type: "enquiry_chase", title: "Day 5 chase", message: "[day-5]", followUpDate: new Date("2026-04-02") },
  ], new Date("2026-03-27T12:00:00.000Z"));

  assert.equal(reconciliation.reuseTaskId, "open-old");
  assert.deepEqual(reconciliation.completeTaskIds, ["open-duplicate"]);
  assert.equal(reconciliation.dueAt.toISOString(), "2026-04-01T12:00:00.000Z");
});

test("later-stage open work blocks a Day 0 regression", () => {
  assert.equal((intakeTransition as any).hasOpenLaterStageTask([
    { status: "active", type: "enquiry_chase", title: "Day 10 chase", message: "[day-10]" },
  ]), true);
});

test("migration compares decoded audit task IDs exactly using an exception-safe temporary parser", () => {
  const migration = readFileSync(new URL("../migrations/0038_intake_first_contact_transition.sql", import.meta.url), "utf8");
  const auditBackfill = migration.slice(migration.indexOf("-- Backfill exactly one audit record"));
  // A direct cast aborts on malformed legacy details. Text matching cannot
  // distinguish IDs containing whitespace or decode JSON-escaped characters.
  const parser = migration.match(/CREATE OR REPLACE FUNCTION pg_temp\.try_parse_jsonb\(value text\)([\s\S]*?)\$\$;/i)?.[1];
  assert.ok(parser, "the parser must live only in the migration session's temporary schema");
  assert.match(parser, /RETURNS jsonb/i);
  assert.match(parser, /LANGUAGE plpgsql/i);
  assert.match(parser, /RETURN value::jsonb;/i);
  assert.match(parser, /EXCEPTION\s+WHEN OTHERS THEN\s+RETURN NULL;/i);
  assert.ok(
    migration.indexOf("CREATE OR REPLACE FUNCTION pg_temp.try_parse_jsonb")
      < migration.indexOf("-- Restore canonical Day 0 values"),
    "the safe parser must exist before the earliest Day 0 audit recovery reads legacy details",
  );
  assert.doesNotMatch(
    migration,
    /\bdetails\s*::\s*jsonb\b/i,
    "every legacy audit JSON read must go through the exception-safe parser",
  );
  assert.match(
    migration,
    /pg_temp\.try_parse_jsonb\(details\)\s+AS\s+details/i,
  );
  assert.match(
    migration,
    /first_contact_method\s*=\s*CASE\s+WHEN\s+e\.details\s+IS\s+NULL\s+THEN\s+c\.first_contact_method/i,
    "a malformed legacy details value must not erase a bootstrap-populated contact method",
  );
  assert.match(
    migration,
    /first_contact_notes\s*=\s*CASE\s+WHEN\s+e\.details\s+IS\s+NULL\s+THEN\s+c\.first_contact_notes/i,
    "a malformed legacy details value must not erase a bootstrap-populated contact note",
  );
  assert.match(
    migration,
    /first_contact_attempted_at\s*=\s*e\.timestamp/i,
    "an unreadable audit payload must still restore the canonical earliest timestamp",
  );
  assert.ok(migration.indexOf("CREATE OR REPLACE FUNCTION pg_temp.try_parse_jsonb") < migration.indexOf("-- Backfill exactly one audit record"));
  assert.doesNotMatch(auditBackfill, /details::jsonb/);
  assert.doesNotMatch(auditBackfill, /prior\.details\s*(?:~\*?|!~\*?|(?:I?LIKE|SIMILAR\s+TO)\b)/i);
  assert.doesNotMatch(auditBackfill, /\b(?:position|strpos|regexp_replace)\s*\(/i);
  assert.doesNotMatch(auditBackfill, /\|\|\s*n\.id|n\.id\s*\|\|/i);
  assert.match(
    auditBackfill,
    /\(pg_temp\.try_parse_jsonb\(prior\.details\)\s*->>\s*'taskId'\)\s*=\s*n\.id/i,
  );
  assert.match(auditBackfill, /DROP FUNCTION pg_temp\.try_parse_jsonb\(text\);/i);
});

test("0038 is a registered schema snapshot that repairs intake state without external delivery", () => {
  // Removing the journal entry or snapshot means a target database can no
  // longer receive the same Day 0 repair shape as the application schema.
  const migration = readFileSync(new URL("../migrations/0038_intake_first_contact_transition.sql", import.meta.url), "utf8");
  const journal = JSON.parse(readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const snapshot = JSON.parse(readFileSync(new URL("../migrations/meta/0038_snapshot.json", import.meta.url), "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; type: string; notNull: boolean }> }>;
  };
  const caseColumns = snapshot.tables["public.cases"]?.columns;
  const entry = journal.entries.find((candidate) => candidate.tag === "0038_intake_first_contact_transition");

  assert.deepEqual(entry, {
    idx: 38,
    version: "7",
    when: 1790640000001,
    tag: "0038_intake_first_contact_transition",
    breakpoints: true,
  });
  assert.deepEqual(caseColumns?.first_contact_method, {
    name: "first_contact_method",
    type: "text",
    primaryKey: false,
    notNull: false,
  });
  assert.deepEqual(caseColumns?.first_contact_notes, {
    name: "first_contact_notes",
    type: "text",
    primaryKey: false,
    notNull: false,
  });
  assert.equal(cases.firstContactMethod.name, caseColumns?.first_contact_method.name);
  assert.equal(cases.firstContactNotes.name, caseColumns?.first_contact_notes.name);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "first_contact_method" text/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "first_contact_notes" text/i);
  assert.match(migration, /ORDER BY entity_id, timestamp ASC, id ASC/i);
  assert.match(migration, /UPDATE notifications AS n[\s\S]*n\.type = 'enquiry_follow_up'[\s\S]*c\.first_contact_attempted_at IS NOT NULL/i);
  assert.match(migration, /AND NOT EXISTS \([\s\S]*existing\.case_id = c\.id[\s\S]*%day-5%/i);
  assert.match(migration, /case_intake_first_contact_repaired/i);
  assert.match(migration, /case_intake_day5_chase_created/i);
  // PostgreSQL LISTEN/NOTIFY would publish a side effect during the repair;
  // this data migration must leave external delivery to the app after commit.
  assert.doesNotMatch(migration, /\bNOTIFY\b/i);
});
