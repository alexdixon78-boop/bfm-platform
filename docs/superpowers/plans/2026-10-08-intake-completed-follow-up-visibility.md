# Intake Completed Follow-Up Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a completed Day 5 follow-up visible in the “Claim and next intake action” card, including who recorded it, while the card advances to Day 10.

**Architecture:** Treat the intake workflow’s notification rows as the authoritative source for this case-scoped view, because the Day 0/5/10 transition writes those rows transactionally. Add a protected intake-task projection for the enquiry card, then derive and render the latest completed follow-up beside the current action; retain the existing full history section below.

**Tech Stack:** TypeScript, Express, React, TanStack Query, PostgreSQL, Drizzle ORM, Node test runner.

**Spec:** User-reported enquiry `ed58b488-6a4a-4cf6-8564-0d17092a4b91` and `docs/superpowers/plans/2026-09-18-dynamic-intake-follow-up.md`.

## Global Constraints

- Completing Day 5 must still advance the next action to Day 10.
- Completed Day 5 data is read-only and must show completion time, acting user, contact method, and notes.
- Safeguarding status, claim ownership, task sequencing, audit entries, and communication restrictions must not change.
- Superadmins and subadmins may see the workflow across claims; Staff retain existing case and claim restrictions.
- Mediators and clients must not receive internal intake history.
- No email, WhatsApp, voicemail, or other external communication is triggered by viewing or recording the summary.
- Leave all changes unstaged; do not commit or push.

## Review Focus

- A completed Day 5 and open Day 10 must appear together: Day 5 as history, Day 10 as the current action.
- Duplicate or superseded Day 5 tasks must not become the visible latest completion.
- A task-load failure must show an error instead of looking like missing history.
- The acting subadmin’s name must be returned safely without exposing unrelated user data.
- Completed history must remain visible during an active safeguarding concern for authorised admins.

---

### Task 1: Add an authoritative case-scoped intake-task projection

**Files:**
- Create: `server/services/intake-workflow-query.service.ts`
- Modify: `server/routes/case.routes.ts`
- Test: `tests/intake-workflow-query.test.ts`

**Interfaces:**
- Produces: `listIntakeWorkflowTasks(caseId: string): Promise<IntakeWorkflowTaskDto[]>`.
- Produces: `GET /api/cases/:id/intake/tasks` for authorised internal users only.
- `IntakeWorkflowTaskDto` contains task identity/stage fields plus `completedAt`, `completionNotes`, `completedBy`, and `completedByName`.

- [ ] Write failing tests proving a completed Day 5 recorded by a subadmin and the newly opened Day 10 are returned together in deterministic order.
- [ ] Add role/access tests proving superadmins and subadmins can read across claims, authorised Staff can read only within existing access rules, and mediators/clients are rejected.
- [ ] Query the transactional intake notification source for `enquiry_follow_up`, `enquiry_chase`, and `enquiry_persistent_follow_up`; join only the completing user’s display name and return an allowlisted DTO.
- [ ] Add the protected route without changing the existing `/api/tasks` contract.
- [ ] Verify the reported enquiry through the new response after deployment: completed Day 5, actor, timestamp, notes, and open Day 10 must all be present.

### Task 2: Keep the latest completion visible in the action card

**Files:**
- Modify: `client/src/components/enquiry-intake-workflow-card-state.ts`
- Modify: `client/src/components/enquiry-intake-workflow-card.tsx`
- Test: `tests/enquiry-intake-workflow-card-state.test.ts`
- Test: `tests/enquiry-sop-workflow.test.ts`

**Interfaces:**
- Consumes: `IntakeWorkflowTaskDto[]` from Task 1.
- Produces: `selectLatestCompletedIntakeFollowUp(tasks)` that excludes superseded records and sorts by `completedAt`, then `createdAt`, then ID.

- [ ] Write failing selector tests for completed Day 5 plus open Day 10, duplicate/superseded tasks, equal timestamps, and no completed history.
- [ ] Switch the card query to `/api/cases/:id/intake/tasks`; stop converting a failed response into an empty array.
- [ ] Render a read-only “Latest completed follow-up” block inside `panel-claim-first-contact`, after the Day 0 summary and before the current form.
- [ ] Show the stage, completion date/time, `completedByName`, parsed contact method, and outcome notes; keep the current Day 10 form directly below it.
- [ ] Add a “View full chase history” control that focuses the existing `section-intake-chase-status`; do not duplicate the entire history in the action card.
- [ ] Show a retryable inline message when intake tasks fail to load, and disable task completion until the authoritative task list is available.
- [ ] Invalidate the new query key after Day 0 and chase mutations so the completion summary and next action update together.

### Task 3: Regression, documentation, and release verification

**Files:**
- Modify: `replit.md`
- Test: `tests/intake-workflow-query.test.ts`
- Test: `tests/enquiry-intake-workflow-card-state.test.ts`
- Test: `tests/enquiry-sop-workflow.test.ts`
- Test: `tests/intake-chase-transition.test.ts`
- Test: `tests/intake-chase-persistence.test.ts`

- [ ] Add a regression scenario where a subadmin completes Day 5 on a superadmin-owned safeguarding enquiry and both the completed Day 5 summary and open Day 10 action remain visible.
- [ ] Confirm the completion still creates audit/activity records and the next internal task without sending email or WhatsApp.
- [ ] Document that the action card shows the latest completed follow-up while the lower section retains full immutable history.
- [ ] Run `npx tsx --test tests/intake-workflow-query.test.ts tests/enquiry-intake-workflow-card-state.test.ts tests/enquiry-sop-workflow.test.ts tests/intake-chase-transition.test.ts tests/intake-chase-persistence.test.ts`.
- [ ] Run `npm run check`, `npm run build`, and `git diff --check`; report unrelated baseline failures separately.
- [ ] Recheck the reported development enquiry as both subadmin and superadmin after deployment.

