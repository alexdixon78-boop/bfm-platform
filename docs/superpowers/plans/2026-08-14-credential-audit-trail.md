# Credential Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a complete, human-readable audit trail for credential submissions, requests, reviews, and resubmissions so admins can see what changed and when.

**Architecture:** Keep the existing credential check rows as the source of truth for current status, and add audit-log entries at the exact mutation points that change those rows. The public update link should continue to upsert credential data but should also emit explicit submission events per credential kind; admin request/review paths should keep emitting request and decision events so the timeline can be reconstructed from audit logs alone.

**Tech Stack:** TypeScript, Express, Drizzle ORM, Zod, React, existing `audit_logs` table, existing mediator applicant/service approval repositories.

## Global Constraints

- Preserve the current public update link behavior: failed credential checks remain visible until the mediator resubmits updated proof.
- Keep audit entries human-readable and store enough detail to reconstruct the timeline: mediator, requested credential/service, submitted proof, reviewing administrator, approval or rejection decision, and decision date/time.
- Do not add a second audit system; use the existing `audit_logs` table and `logAudit` helper.
- Keep the mediator-facing forms and admin review screens aligned with the same credential field set already used in the codebase.

---

### Task 1: Map the credential lifecycle to audit events

**Files:**
- Modify: `server/routes/mediator-application-link.routes.ts`
- Modify: `server/routes/mediator-applicant.routes.ts`
- Modify: `server/services/mediator-service-approval.service.ts`

**Interfaces:**
- Consumes: `logAudit`, `mediatorApplicantService`, `mediatorServiceApprovalService`
- Produces: explicit audit events for credential submission, request, review, and resubmission

- [ ] **Step 1: Verify the existing audit event names and payload shapes**

Read the current `logAudit` call sites for applicant checks and service approvals, and note the event names already used for request/review so the new events match the existing audit vocabulary.

- [ ] **Step 2: Record credential resubmission from the public update link**

In `server/routes/mediator-application-link.routes.ts`, after a successful credential update, emit one audit entry for each credential kind that was submitted or changed. Include the mediator/applicant identity, credential kind, captured fields, and a `submitted_at` timestamp in the `details` JSON.

- [ ] **Step 3: Record service-proof submission and review decisions**

In `server/services/mediator-service-approval.service.ts`, keep the existing submission/review audit entries but enrich their `details` with the service name, proof source flags, reviewing admin, decision, and decision timestamp so the approval trail can be reconstructed without guessing.

- [ ] **Step 4: Record admin credential request events**

In `server/routes/mediator-applicant.routes.ts`, keep the credential request audit entry and include the requested credential label and the update-link purpose so admins can tell whether the link was for credentials or a service document.

### Task 2: Preserve failed state until the mediator resubmits

**Files:**
- Modify: `server/routes/mediator-application-link.routes.ts`
- Modify: `client/src/components/mediator-pipeline/applicant-application-dialog.tsx`

**Interfaces:**
- Consumes: public credential submission payload, current check rows, current review state
- Produces: failed status remains visible in admin UI until a new submission arrives

- [ ] **Step 1: Confirm failed status is not overwritten by the admin flow**

Inspect the review path and make sure the admin review action leaves the row in `failed` until the mediator sends new data, rather than collapsing it to a generic requested state in the UI.

- [ ] **Step 2: Keep the public update form as the resubmission trigger**

Ensure the public credentials update path writes the new credential values and sets the check row back to the pending/review state only after the mediator submits fresh data.

- [ ] **Step 3: Keep the admin list readable**

Update the admin credential dialog copy, if needed, so the row still shows `failed` plus the reason note and the review timeline entry is the source of truth for who reviewed it and when.

### Task 3: Verify audit trail output end to end

**Files:**
- Modify: `replit.md`
- Test: existing server/client verification commands

**Interfaces:**
- Consumes: the updated audit-log writes and status transitions
- Produces: a verified record of submission/request/review events in the audit trail

- [ ] **Step 1: Smoke test the public credential update path**

Submit a credential update through the public link and confirm the row updates and the new audit log entry is created for the credential kind that changed.

- [ ] **Step 2: Smoke test the admin review path**

Request a credential update from the admin panel, review it, and confirm the audit log records the request, the review decision, and the timestamp.

- [ ] **Step 3: Update the implementation notes**

Add a short note to `replit.md` summarising the credential audit trail so future changes do not accidentally bypass it.

