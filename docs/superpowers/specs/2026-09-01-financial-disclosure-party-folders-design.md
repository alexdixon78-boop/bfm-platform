# Financial Disclosure Party Folders Design

## Goal

Correct SOP 1.3a Financial Disclosure and Support folders so they are created per eligible case per party, keep client disclosure private by party, and use the existing MIAM OFS field as the single source of truth.

## Current State

The current in-progress implementation documents and models financial disclosure folders as one folder per eligible case. `replit.md` currently says one `financial_disclosure_folders` row is created per eligible case and that the Open Financial Statement requirement is folder-scoped. The implementation mirrors that with a unique `case_id` on `financial_disclosure_folders` and a stored `ofs_requirement` item.

That is incorrect for the intended workflow.

## Corrected Model

An eligible case is a Family case whose subtype is `Property & finance (PF)` or `All issues mediation (AIM)`.

For each eligible case, the system creates one Financial Disclosure and Support folder for each active party/client on the case. The folder uniqueness rule is `(case_id, party_id)`, not `case_id`.

Each party folder contains:

- Online disclosure booklet item, completed by that party.
- Financial Disclosure Checklist item, reviewed by staff or the assigned mediator.
- Evidence upload categories seeded per party folder.
- Upload targets for Online Disclosure Booklet, Open Financial Statement, Financial Disclosure Checklist, and evidence categories.

Open Financial Statement status is not stored as a financial disclosure item. It is read from and written to the existing per-client MIAM field `miam_records.ofs_required`. Superadmin or subadmin sets the initial OFS value. The assigned mediator may later update only that OFS value from the financial disclosure workflow.

The later Draft Financial Schedule is a separate future case-level review artifact that combines the parties' disclosures. It is not part of this implementation.

## Access Rules

Clients can see and upload only to their own party folder.

Superadmins and subadmins can see and update all party folders on an eligible case.

Assigned mediators can see all party folders when they have case/session access. Assigned mediators can update the checklist and can update the MIAM-backed OFS value later through a narrow OFS route.

Changing a case away from AIM/PF does not delete existing folders, booklet content, checklist content, OFS values, or uploaded documents.

## API Shape

`GET /api/cases/:id/financial-disclosure-folders` returns the visible folder set for the actor. Clients receive only their own folder. Staff and assigned mediators receive all party folders.

`PATCH /api/financial-disclosure-items/:id` updates booklet or checklist item status/payload.

`PATCH /api/financial-disclosure-folders/:folderId/ofs` updates `miam_records.ofs_required` for the folder's party.

`POST /api/cases/:id/documents` keeps the existing upload pipeline and accepts financial disclosure metadata:

- `financialDisclosureFolderId`
- `financialDisclosureItemId`
- `financialDisclosureEvidenceCategoryId`
- `financialDisclosureUploadTarget`

The service validates that all supplied metadata belongs to the same case and party folder visible to the actor.

## Documentation

`replit.md` must be updated to remove the case-scoped and folder-scoped OFS claims. It must state that folders are per eligible case per party, client disclosure is party-private, and OFS uses the MIAM record field.
