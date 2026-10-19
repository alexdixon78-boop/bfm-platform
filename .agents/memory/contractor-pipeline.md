---
name: Contractor Pipeline Architecture
description: How the contractor pipeline (Task #255) is structured — board data sources, intercepts, and key files.
---

## Board data sources
- `prospect`, `screening`, `contract_sent` → from `contractor_applicants` where `converted_user_id IS NULL`
- `active` → from `users` where `role = 'contractor'` and `status = 'active'`
- `off_boarded` → from `users` where `role = 'contractor'` and `status = 'inactive'`
- Converted applicants (converted_user_id set) are skipped; their card lives on the contractor user row.

## Drag intercepts (frontend)
- `contract_sent → active`: opens ConvertContractorDialog (doesn't call move endpoint; calls POST /api/contractor-applicants/:id/convert)
- `active → off_boarded`: opens AlertDialog confirmation, then calls PATCH /api/contractor-pipeline/move

## Key files
- `server/services/contractor-pipeline.service.ts` — board builder + move + convert + timeline
- `server/routes/contractor-pipeline.routes.ts` — CRUD + board + move + convert + timeline endpoints
- `server/routes/contractor-application-link.routes.ts` — token generation + public validate + public apply
- `client/src/components/contractor-pipeline/kanban-board.tsx` — DnD orchestration + stat cards + optimistic updates
- `client/src/pages/contractor-pipeline.tsx` — staff page (board + table toggle)
- `client/src/pages/contractor-apply.tsx` — public-facing apply form at /apply/contractor/:token

**Why:** Mirroring mediator pipeline pattern (separate applicant vs user cards, token-based public form) keeps management paradigms consistent across mediators and contractors.
