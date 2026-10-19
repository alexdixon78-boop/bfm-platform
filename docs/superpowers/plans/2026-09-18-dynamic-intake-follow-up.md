# Dynamic Intake Follow-Up Implementation Plan

> **For agentic workers:** Use test-driven development. Each task must add a failing regression test before production changes, then run the focused tests and typecheck.

**Goal:** Make the enquiry intake card advance from Day 0 to Day 5, Day 10, and weekly follow-up while preserving immutable completed history and repairing stale production records.

**Architecture:** Put the Day 0 state transition behind a focused transactional service that owns the case/enquiry/task/audit/activity writes and publishes notification changes after commit. Keep the existing chase endpoint for later stages, strengthening duplicate handling and task sequencing. Drive the React card from the case plus the current open intake task while loading all tasks for history.

**Tech Stack:** TypeScript, Express, React, TanStack Query, PostgreSQL, Drizzle ORM, Node test runner.

## Global Constraints

- Day 0 may be recorded exactly once; repeats return HTTP 409 without writes.
- Day 5 is due five calendar days after the original first-contact timestamp.
- Administrators may complete future-dated chase tasks early.
- Exactly one open intake follow-up task may exist per case.
- Completed Day 0 and chase records remain visible and immutable.
- Preserve existing authentication, role, case-access, safeguarding, claim-ownership, and client-visibility rules.
- Migration 0038 must be additive, idempotent, and must not send email or external notifications.

---

### Task 1: Atomic Day 0 transition and production data repair

**Files:**
- Create: `server/services/intake-first-contact.service.ts`
- Modify: `server/routes/case.routes.ts`
- Modify: `shared/schema.ts`
- Create: `migrations/0038_intake_first_contact_transition.sql`
- Modify: `migrations/meta/_journal.json` and generated snapshot
- Test: `tests/intake-first-contact-transition.test.ts`
- Test: `tests/enquiry-sop-workflow.test.ts`

Implement a transaction that row-locks the case, revalidates workflow state, records canonical method/notes/timestamp, syncs the enquiry status, completes open Day 0 tasks, creates or reuses one Day 5 task, and writes audit/activity rows. Publish notification updates only after commit. Require contact method, preserve optional notes, and return 409 on repeat/concurrent submissions. Add nullable case fields and an idempotent repair migration that restores the earliest audited Day 0 values, completes stale Day 0 tasks, creates only missing eligible Day 5 tasks, and backfills guarded repair/Day-5 audit records.

### Task 2: Atomic later-stage advancement

**Files:**
- Modify: `server/routes/case.routes.ts`
- Modify: relevant intake/notification service introduced or reused by Task 1
- Test: `tests/intake-first-contact-transition.test.ts`
- Test: `tests/enquiry-sop-workflow.test.ts`

Make Day 5 completion plus Day 10 creation, and Day 10/weekly completion plus next-weekly creation, one transactional transition. Preserve validation and allow early completion. Return 409 for already-completed or stale tasks and prevent duplicate open follow-ups, audits, and activities.

### Task 3: Dynamic intake-action card

**Files:**
- Modify: `client/src/components/enquiry-intake-workflow-card.tsx`
- Test: `tests/enquiry-sop-workflow.test.ts`

Load case tasks with `status=all`. Render one current action: safeguarding, claim, Day 0, Day 5, Day 10, weekly, none, or terminal. After Day 0 show its canonical method/notes/timestamp read-only and render the current chase form inline. Allow early entry, advance after successful mutations, keep the lower chase section as immutable history, and select an open weekly task before the most recently completed one.

### Task 4: Documentation and release verification

**Files:**
- Modify: `replit.md`
- Test: migration and SOP regression tests

Document the immutable Day 0 and dynamic follow-up behavior. Run focused tests, the full Node test suite, `npm run check`, and migration validation. Record pre/post-deployment invariant queries and verify `BFM-2026-0006` without mutating the development database during implementation.
