# Task 1 — Atomic Day 0 transition and production repair

## Implementation

- Added `recordIntakeFirstContact`, which locks and reloads the case inside a
  transaction before enforcing terminal-case, safeguarding, claim ownership,
  and immutable-first-contact gates.
- The transaction persists canonical Day 0 method, optional notes, and
  timestamp; syncs the linked enquiry; completes open Day 0 tasks; reuses or
  creates the Day 5 task due five calendar days later; and writes first-contact
  plus Day-5 audit/activity records.
- Realtime updates for completed/created tasks are published only after the
  transaction resolves successfully. The route validates a required contact
  method and maps repeat/concurrent first-contact submissions to HTTP 409.
- Added nullable `cases.first_contact_method` and
  `cases.first_contact_notes` fields, bootstrap compatibility alters, migration
  `0038_intake_first_contact_transition.sql`, journal entry, and generated
  `0038_snapshot.json`.
- The migration is additive and guarded: it uses the earliest Day 0 audit row,
  completes stale Day 0 tasks, creates only missing eligible Day 5 tasks,
  backfills missing Day-5 audits, and writes a guarded repair audit row. It has
  no email, webhook, or realtime publication path.

## TDD evidence

1. Added the canonical Day 0 schema regression test before the schema fields.
2. Ran `npx tsx tests/intake-first-contact-transition.test.ts` and observed the
   expected failure: `cases.firstContactMethod` was undefined.
3. Added the schema fields and reran the test successfully.
4. Added the endpoint-delegation regression before replacing the route writes,
   observed its expected assertion failure, then implemented the transactional
   service and route delegation.

## Verification

- `npx tsx tests/intake-first-contact-transition.test.ts` — 2 passing, 0 failing.
- `npx tsx tests/enquiry-sop-workflow.test.ts` — 17 passing, 0 failing.
- `git diff --check` — clean.
- `npm run check` initially exhausted Node's default heap. Re-running with
  `NODE_OPTIONS=--max-old-space-size=4096 npm run check` ran to completion and
  reported 22 errors, all in contractor/mediator pipeline and applicant UI
  files outside the Task 1 diff. No Task 1 file appears in that error output.
  The initial large-heap run exposed one local readonly-array type error in the
  new service; it was fixed, and the final large-heap run no longer reports it.

## Self-review

- Confirmed every Day 0 state-changing database write is made through the
  transaction and the case is locked before validation.
- Confirmed the migration was generated/edited locally only; no migration or
  repair SQL was run against the configured shared database.
- Confirmed the migration has guards for repeated execution and contains no
  external notification calls.
- The repository-wide typecheck currently reports the 22 non-Task-1 errors
  listed in the verification output; their origin cannot be established from
  this task's diff, so they were not modified.

## Review remediation (2026-09-18)

- Corrected the migration journal timestamp to `1790640000001`, strictly after
  migration 0037.
- The repair migration now restores all canonical Day 0 values from the
  earliest matching audit row, uses `IS DISTINCT FROM` for repeat-safe repair,
  parses guarded JSON task IDs for Day 5 audit idempotency, and skips Day 5
  creation when an open Day 10 or weekly task proves later-stage progress.
- The locked service gate now treats `intakeStatus = 'Closed'` as terminal.
  Day 5 reconciliation chooses one open Day 5 task, resets its due date/status,
  completes competing open intake tasks, and never alters completed history.
- Extracted `intake-first-contact.transition.ts` as an in-process test boundary
  with no database configuration or connection requirement. It is used by the
  production transaction and exercises locked gates, repeat/competing-claim
  conflicts, calendar due-date calculation, and reconciliation.

### Review TDD evidence

Red: `DATABASE_URL=postgres://localhost:5432/placeholder npx tsx tests/intake-first-contact-transition.test.ts`
ran before the extracted transition boundary existed. It produced 2 failures:
`validateLockedFirstContact is not a function` and
`reconcileDay5Tasks is not a function` (2 passing, 2 failing).

Green: `npx tsx tests/intake-first-contact-transition.test.ts` after the
boundary and service/migration corrections: 5 passing, 0 failing.

Focused verification: `npx tsx tests/enquiry-sop-workflow.test.ts`: 17 passing,
0 failing. `git diff --check`: clean. No shared database migration was run.

## Review remediation round 2 (2026-09-18)

Red: `npx tsx tests/intake-first-contact-transition.test.ts` produced 5
passing and 2 failing tests: `hasOpenLaterStageTask is not a function`, and the
migration still matched the double-backslash regex guard.

Green: added the later-stage anomaly predicate to the production transaction
before any write, returning HTTP 409 for an open Day 10/weekly task. Replaced
the SQL regex gate with `jsonb_typeof(prior.details::jsonb) = 'object'` plus
the parsed `taskId` comparison. The same command then reported 7 passing, 0
failing; `npx tsx tests/enquiry-sop-workflow.test.ts` reported 17 passing, 0
failing; `git diff --check` was clean. No shared database migration was run.

## Review remediation round 3 (2026-09-18)

Red: `npx tsx tests/intake-first-contact-transition.test.ts` reported 6
passing and 1 failing because the Day 5 audit-backfill guard still contained
`prior.details::jsonb`.

Green: replaced that guard with the non-throwing text expression
`'"taskId"[[:space:]]*:[[:space:]]*"' || n.id || '"'`, which accepts formatted
JSON while matching the concrete task ID and never casts legacy details.
The final command reported 7 passing, 0 failing; the SOP suite reported 17
passing, 0 failing; and `git diff --check` was clean. No shared database
migration was run.

## Review remediation round 4 (2026-09-18)

Red: updated the migration regression to reject regex/LIKE matching of audit
details and require a literal `position` comparison after whitespace removal.
`npx tsx tests/intake-first-contact-transition.test.ts` reported 6 passing and
1 failing on the existing `prior.details ~ (...)` guard.

Green: replaced that guard with
`position('"taskId":"' || n.id || '"' in regexp_replace(prior.details, '[[:space:]]', '', 'g')) > 0`.
The notification ID is now a literal substring, never a regex or LIKE pattern,
and the guard does not parse legacy audit details as JSON.

Verification: the transition suite reported 7 passing, 0 failing; the SOP
suite reported 17 passing, 0 failing; `git diff --check` was clean. Verification
was limited to these focused tests and diff checks for this SQL/test-only fix;
the previously recorded repository-wide typecheck errors remain outside this
round's scope. No shared database migration was run.

## Review remediation round 5 (2026-09-18)

Red: changed the migration regression to require a session-local PL/pgSQL
parser that catches parse errors, compares the decoded `taskId` exactly, and
rejects regex/substring matching and notification-ID interpolation.
`npx tsx tests/intake-first-contact-transition.test.ts` reported 6 passing and
1 failing because the temporary parser was absent.

Green: added `pg_temp.try_parse_jsonb(text)`, returning SQL NULL on parse
exceptions, and replaced the whitespace-normalized substring guard with
`(pg_temp.try_parse_jsonb(prior.details) ->> 'taskId') = n.id`. This preserves
whitespace inside IDs and handles JSON escapes through JSON decoding. The
helper is created before the backfill and explicitly dropped afterward;
it creates no persistent application-schema object. The installed Drizzle
PostgreSQL migration implementation executes statements through one
transaction connection, retaining the temporary helper for the backfill.

Verification: transition suite 7 passing, SOP suite 17 passing, and
`git diff --check` clean. These are migration-source regression assertions;
no SQL was executed against a database, and no shared database migration was
run. No new runtime TypeScript changed; the previously recorded unrelated
repository-wide typecheck failures were not rerun for this SQL/test-only fix.
