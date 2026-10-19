# Financial Disclosure Party Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct SOP 1.3a so Financial Disclosure and Support folders are created per eligible case per party, keep each client's disclosure private, and use the existing MIAM OFS field as the single source of truth.

**Architecture:** Revise the current in-progress case-scoped implementation to a party-scoped model. Folder creation becomes "ensure folders for every active party on an eligible AIM/PF case"; document upload metadata validates against the selected party folder; OFS reads/writes `miam_records.ofs_required` through a narrow folder route instead of a financial-disclosure item.

**Tech Stack:** TypeScript, Express, Drizzle ORM, PostgreSQL migrations, React, TanStack Query, shadcn/ui, node:test static regression tests.

**Spec:** `docs/superpowers/specs/2026-09-01-financial-disclosure-party-folders-design.md`

## Global Constraints

- Eligible cases are Family cases with subtype `Property & finance (PF)` or `All issues mediation (AIM)`.
- Folder uniqueness is `(case_id, party_id)`, not `case_id`.
- Clients can view and upload only to their own party folder.
- Superadmins and subadmins can view and update all party folders.
- Assigned mediators can view all party folders and update checklist/OFS where they have case/session access.
- OFS status is stored only in `miam_records.ofs_required`.
- The Financial Disclosure folder must not create an independent OFS status item.
- Uploads must support targets: `online_disclosure_booklet`, `ofs`, `financial_disclosure_checklist`, and `evidence_category`.
- Existing upload storage must be reused; only metadata validation and persistence changes.
- Existing folders and submitted data are preserved when a case changes away from AIM/PF.
- The Draft Financial Schedule is out of scope for this implementation.

---

## File Structure

- Modify `shared/schema.ts`: add `partyId` to folders, change unique/index constraints, remove `ofs_requirement` from financial-disclosure item types, add document upload target constants and document metadata fields.
- Modify `migrations/0012_financial_disclosure_folders.sql`: revise the uncommitted migration to create party-scoped folders and document upload target metadata.
- Modify `server/db-bootstrap.ts`: mirror the migration for bootstrap-created databases.
- Modify `server/repositories/financial-disclosure.repository.ts`: query/create folders by `(caseId, partyId)`, list folders by case, and validate item/category ownership.
- Modify `server/storage.ts`: expose party-scoped repository methods.
- Modify `server/services/financial-disclosure.service.ts`: ensure one folder per active party, assemble actor-visible folders, validate upload metadata, and read/write OFS via MIAM records.
- Modify `server/services/booking.service.ts`: call the revised ensure method after booking onboarding subtype persistence and before appointment/payment side effects.
- Modify `server/routes/case.routes.ts`: call the revised ensure method after case-type updates.
- Modify `server/services/mediation-session.service.ts`: call the revised ensure method before creating a mediation-session hold and enforce party-scoped document upload validation.
- Modify `server/routes/mediation-session.routes.ts`: expose plural folder GET route and OFS patch route; extend upload schema.
- Modify `client/src/pages/case-detail.tsx`: render party folder panels, party-private client view, MIAM-backed OFS controls, and upload controls for all disclosure targets.
- Modify `replit.md`: document the corrected per-case-per-party folder model and MIAM-backed OFS behavior.
- Modify `tests/financial-disclosure-folder.test.ts`: update static regression tests to lock the corrected behavior.

---

### Task 1: Lock Corrected Schema Expectations

**Files:**
- Modify: `tests/financial-disclosure-folder.test.ts`

**Interfaces:**
- Consumes: current static test helper `read(path: string): string`.
- Produces: failing tests that require party-scoped folders, MIAM-backed OFS, and upload target metadata.

- [ ] **Step 1: Update the schema regression test**

Replace the first test body with assertions for party-scoped ownership:

```ts
test("schema, migration, and bootstrap define party-scoped financial disclosure folders", () => {
  assert.match(schema, /financialDisclosureFolders = pgTable\("financial_disclosure_folders"/);
  assert.match(schema, /partyId: varchar\("party_id"\)\.notNull\(\)\.references\(\(\) => parties\.id/);
  assert.match(schema, /uniqueIndex\("financial_disclosure_folders_case_party_unique"\)\.on\(table\.caseId,\s*table\.partyId\)/);
  assert.doesNotMatch(schema, /caseId: varchar\("case_id"\)[\s\S]*\.unique\(\)/);
  assert.match(schema, /FINANCIAL_DISCLOSURE_ITEM_TYPES[\s\S]*online_disclosure_booklet[\s\S]*financial_disclosure_checklist/);
  assert.doesNotMatch(schema, /"ofs_requirement"/);
  assert.match(schema, /FINANCIAL_DISCLOSURE_UPLOAD_TARGETS[\s\S]*online_disclosure_booklet[\s\S]*ofs[\s\S]*financial_disclosure_checklist[\s\S]*evidence_category/);
  assert.match(schema, /financialDisclosureUploadTarget: text\("financial_disclosure_upload_target"\)/);
  assert.match(migration, /"party_id" varchar NOT NULL/);
  assert.match(migration, /financial_disclosure_folders_case_party_unique/);
  assert.match(bootstrap, /party_id VARCHAR NOT NULL REFERENCES parties\(id\) ON DELETE CASCADE/);
});
```

- [ ] **Step 2: Add service/API/UI expectations**

Add assertions that force the corrected service and routes:

```ts
test("service ensures one folder per active party and keeps OFS backed by MIAM", () => {
  assert.match(financialService, /ensureFinancialDisclosureFoldersForCase/);
  assert.match(financialService, /listPartiesByCase/);
  assert.match(financialService, /getMiamRecord\(folder\.partyId,\s*folder\.caseId\)/);
  assert.match(financialService, /updateFolderOfsRequired/);
  assert.doesNotMatch(financialService, /itemType:\s*"ofs_requirement"/);
});

test("routes expose party folder collection and narrow OFS updates", () => {
  assert.match(sessionRoutes, /\/api\/cases\/:id\/financial-disclosure-folders/);
  assert.match(sessionRoutes, /\/api\/financial-disclosure-folders\/:folderId\/ofs/);
  assert.match(sessionRoutes, /financialDisclosureUploadTarget/);
});

test("case detail renders party folder panels and upload targets", () => {
  assert.match(caseDetail, /FinancialDisclosureFolderView/);
  assert.match(caseDetail, /partyId/);
  assert.match(caseDetail, /select-financial-disclosure-upload-target/);
  assert.match(caseDetail, /online_disclosure_booklet/);
  assert.match(caseDetail, /ofs/);
  assert.match(caseDetail, /financial_disclosure_checklist/);
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
npx tsx tests/financial-disclosure-folder.test.ts
```

Expected: FAIL because the current implementation is still case-scoped and has a folder-scoped `ofs_requirement` item.

- [ ] **Step 4: Commit the failing test**

```bash
git add tests/financial-disclosure-folder.test.ts
git commit -m "test: lock party scoped financial disclosure model"
```

---

### Task 2: Correct Schema, Migration, Bootstrap, And Storage

**Files:**
- Modify: `shared/schema.ts`
- Modify: `migrations/0012_financial_disclosure_folders.sql`
- Modify: `server/db-bootstrap.ts`
- Modify: `server/repositories/financial-disclosure.repository.ts`
- Modify: `server/storage.ts`

**Interfaces:**
- Produces:
  - `financialDisclosureFolders.partyId`
  - unique index `financial_disclosure_folders_case_party_unique`
  - `FINANCIAL_DISCLOSURE_UPLOAD_TARGETS`
  - repository method `getFolderByCaseAndParty(caseId: string, partyId: string)`
  - repository method `listFoldersByCase(caseId: string)`
  - repository method `createFolder(data: InsertFinancialDisclosureFolder)`

- [ ] **Step 1: Update `shared/schema.ts` constants**

Change financial disclosure item types to exclude OFS:

```ts
export const FINANCIAL_DISCLOSURE_ITEM_TYPES = [
  "online_disclosure_booklet",
  "financial_disclosure_checklist",
] as const;
```

Add upload targets:

```ts
export const FINANCIAL_DISCLOSURE_UPLOAD_TARGETS = [
  "online_disclosure_booklet",
  "ofs",
  "financial_disclosure_checklist",
  "evidence_category",
] as const;
export type FinancialDisclosureUploadTarget = typeof FINANCIAL_DISCLOSURE_UPLOAD_TARGETS[number];
```

- [ ] **Step 2: Update `financialDisclosureFolders`**

Add `partyId` and replace the case-only unique rule:

```ts
partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
```

Use indexes:

```ts
uniqueIndex("financial_disclosure_folders_case_party_unique").on(table.caseId, table.partyId),
index("financial_disclosure_folders_case_idx").on(table.caseId),
index("financial_disclosure_folders_party_idx").on(table.partyId),
index("financial_disclosure_folders_status_idx").on(table.status),
```

- [ ] **Step 3: Update `caseDocuments` metadata**

Add:

```ts
financialDisclosureItemId: varchar("financial_disclosure_item_id").references(() => financialDisclosureItems.id, { onDelete: "set null" }),
financialDisclosureUploadTarget: text("financial_disclosure_upload_target"),
```

Include the fields in `insertCaseDocumentSchema`.

- [ ] **Step 4: Revise migration `0012`**

Because this migration is currently uncommitted in the working tree, edit it in place rather than creating `0013`.

Folder table must include:

```sql
"case_id" varchar NOT NULL,
"party_id" varchar NOT NULL,
CONSTRAINT "financial_disclosure_folders_case_party_unique" UNIQUE("case_id","party_id")
```

Document alters must include:

```sql
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_item_id" varchar;
ALTER TABLE "case_documents" ADD COLUMN IF NOT EXISTS "financial_disclosure_upload_target" text;
```

Add FKs and indexes for `party_id`, item ID, and upload target.

- [ ] **Step 5: Mirror bootstrap**

Update `server/db-bootstrap.ts` with the same table columns, constraints, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, FKs, and indexes as the migration.

- [ ] **Step 6: Update repository/storage methods**

Repository methods:

```ts
async getFolderByCaseAndParty(caseId: string, partyId: string): Promise<FinancialDisclosureFolder | undefined>
async listFoldersByCase(caseId: string): Promise<FinancialDisclosureFolder[]>
async createFolder(data: InsertFinancialDisclosureFolder): Promise<FinancialDisclosureFolder>
```

Use conflict target:

```ts
target: [financialDisclosureFolders.caseId, financialDisclosureFolders.partyId]
```

Expose the same methods through `server/storage.ts`.

- [ ] **Step 7: Run schema regression**

Run:

```bash
npx tsx tests/financial-disclosure-folder.test.ts
```

Expected: schema/storage tests move toward PASS; service/API/UI tests may still fail.

- [ ] **Step 8: Commit schema/storage correction**

```bash
git add shared/schema.ts migrations/0012_financial_disclosure_folders.sql server/db-bootstrap.ts server/repositories/financial-disclosure.repository.ts server/storage.ts tests/financial-disclosure-folder.test.ts
git commit -m "feat: make financial disclosure folders party scoped"
```

---

### Task 3: Revise Financial Disclosure Service

**Files:**
- Modify: `server/services/financial-disclosure.service.ts`

**Interfaces:**
- Consumes:
  - `storage.listPartiesByCase(caseId)`
  - `storage.getFinancialDisclosureFolderByCaseAndParty(caseId, partyId)`
  - `storage.listFinancialDisclosureFoldersByCase(caseId)`
  - `storage.getMiamRecord(partyId, caseId)`
  - `storage.upsertMiamRecord(partyId, caseId, data)`
- Produces:
  - `ensureFinancialDisclosureFoldersForCase(caseId, triggerSource, actor?)`
  - `getVisibleFoldersForCase(caseId, actor)`
  - `updateFolderOfsRequired(folderId, actor, ofsRequired)`
  - `validateFinancialDisclosureUploadMetadata(caseId, actor, input)`

- [ ] **Step 1: Remove OFS item seeding**

Delete the `ofs_requirement` item from `ITEM_DEFINITIONS`. Keep only:

```ts
online_disclosure_booklet
financial_disclosure_checklist
```

- [ ] **Step 2: Implement per-party ensure**

Replace `ensureFinancialDisclosureFolderForCase` with:

```ts
async ensureFinancialDisclosureFoldersForCase(
  caseId: string,
  triggerSource: FolderTriggerSource,
  actor?: ActorUser | null,
): Promise<FinancialDisclosureFolderView[]> {
  const caseRecord = await storage.getCase(caseId);
  if (!isFinancialDisclosureEligibleCase(caseRecord)) return [];

  const parties = (await storage.listPartiesByCase(caseId)).filter((party) => party.status !== "removed");
  const views: FinancialDisclosureFolderView[] = [];

  for (const party of parties) {
    const existing = await storage.getFinancialDisclosureFolderByCaseAndParty(caseId, party.id);
    const folder = existing || await storage.createFinancialDisclosureFolder({
      caseId,
      partyId: party.id,
      status: "active",
      triggerSource,
    });

    await this.seedFolderItems(folder.id);
    await this.seedEvidenceCategories(folder.id);
    if (!existing) await this.logCreatedFolder(folder, party, triggerSource, actor);
    views.push(await this.assembleFolder(folder));
  }

  return views;
}
```

- [ ] **Step 3: Include party and MIAM OFS in folder views**

Extend `FinancialDisclosureFolderView`:

```ts
party: Pick<Party, "id" | "role" | "firstName" | "lastName" | "userId">;
ofsRequired: string | null;
```

In `assembleFolder`, read:

```ts
const miamRecord = await storage.getMiamRecord(folder.partyId, folder.caseId);
```

Set:

```ts
ofsRequired: miamRecord?.ofsRequired || null
```

- [ ] **Step 4: Implement visible folder selection**

Rules:

```ts
client -> folders whose party.userId === actor.id
superadmin/subadmin -> all folders
mediator -> all folders only when mediationSessionService-style case access permits full access
```

Avoid importing `mediationSessionService` into this service if it causes a circular dependency. Accept a boolean from routes or keep route-level access checks and let this service apply only the client party filter.

- [ ] **Step 5: Implement OFS update**

Implement:

```ts
async updateFolderOfsRequired(folderId: string, actor: ActorUser, ofsRequired: string | null): Promise<FinancialDisclosureFolderView | null>
```

Validation:

```ts
ofsRequired === null || ["yes", "no", "unknown", "waived"].includes(ofsRequired)
```

Persistence:

```ts
await storage.upsertMiamRecord(folder.partyId, folder.caseId, { ofsRequired });
```

- [ ] **Step 6: Implement upload metadata validation**

Input:

```ts
{
  financialDisclosureFolderId?: string | null;
  financialDisclosureItemId?: string | null;
  financialDisclosureEvidenceCategoryId?: string | null;
  financialDisclosureUploadTarget?: FinancialDisclosureUploadTarget | null;
}
```

Rules:

- If no financial disclosure metadata is supplied, return null for legacy uploads.
- `financialDisclosureFolderId` is required when any upload target/category/item metadata is supplied.
- Folder must belong to `caseId`.
- Client actor can only target a folder whose party `userId` equals actor id.
- `online_disclosure_booklet` requires the matching booklet item ID.
- `financial_disclosure_checklist` requires the matching checklist item ID and staff/assigned mediator actor.
- `ofs` requires no item ID and stores only the upload target.
- `evidence_category` requires a category ID belonging to the folder.

Return:

```ts
{
  folderId: string;
  itemId: string | null;
  evidenceCategoryId: string | null;
  uploadTarget: FinancialDisclosureUploadTarget;
}
```

- [ ] **Step 7: Run service regression**

Run:

```bash
npx tsx tests/financial-disclosure-folder.test.ts
```

Expected: service tests pass; route/UI tests may still fail.

- [ ] **Step 8: Commit service correction**

```bash
git add server/services/financial-disclosure.service.ts tests/financial-disclosure-folder.test.ts
git commit -m "feat: ensure party financial disclosure folders"
```

---

### Task 4: Update API Routes And Document Upload Flow

**Files:**
- Modify: `server/services/booking.service.ts`
- Modify: `server/routes/case.routes.ts`
- Modify: `server/services/mediation-session.service.ts`
- Modify: `server/routes/mediation-session.routes.ts`

**Interfaces:**
- Consumes:
  - `ensureFinancialDisclosureFoldersForCase`
  - `getVisibleFoldersForCase`
  - `updateFolderOfsRequired`
  - `validateFinancialDisclosureUploadMetadata`
- Produces:
  - `GET /api/cases/:id/financial-disclosure-folders`
  - `PATCH /api/financial-disclosure-folders/:folderId/ofs`
  - extended `POST /api/cases/:id/documents`

- [ ] **Step 1: Update creation triggers**

Replace calls to:

```ts
ensureFinancialDisclosureFolderForCase
```

with:

```ts
ensureFinancialDisclosureFoldersForCase
```

Keep trigger order:

- Booking: after onboarding subtype persistence, before `storage.createAppointment`.
- Case type update: after successful `storage.updateCaseType`.
- Mediation-session hold: before `storage.createAppointment`.

- [ ] **Step 2: Update upload schema**

In `server/routes/mediation-session.routes.ts`, extend `caseDocumentUploadSchema`:

```ts
financialDisclosureFolderId: z.string().trim().optional().nullable(),
financialDisclosureItemId: z.string().trim().optional().nullable(),
financialDisclosureEvidenceCategoryId: z.string().trim().optional().nullable(),
financialDisclosureUploadTarget: z.enum(FINANCIAL_DISCLOSURE_UPLOAD_TARGETS).optional().nullable(),
```

- [ ] **Step 3: Update upload service call**

In `uploadCaseDocument`, call:

```ts
const financialDisclosureTag = await financialDisclosureService.validateFinancialDisclosureUploadMetadata(caseId, actor, input);
```

Persist:

```ts
financialDisclosureFolderId: financialDisclosureTag?.folderId || null,
financialDisclosureItemId: financialDisclosureTag?.itemId || null,
financialDisclosureEvidenceCategoryId: financialDisclosureTag?.evidenceCategoryId || null,
financialDisclosureUploadTarget: financialDisclosureTag?.uploadTarget || null,
```

- [ ] **Step 4: Replace GET route with plural folder route**

Implement:

```ts
router.get("/api/cases/:id/financial-disclosure-folders", requirePermission("cases", "view"), async (req, res) => {
  const actor = getUser(req as any);
  const access = await mediationSessionService.verifyCaseAccessForActor(req.params.id, actor);
  if (!access.ok) return res.status(access.status).json({ message: access.error });
  const folders = await financialDisclosureService.getVisibleFoldersForCase(req.params.id, actor);
  return res.json(folders);
});
```

- [ ] **Step 5: Add OFS route**

Implement:

```ts
const financialDisclosureOfsPatchSchema = z.object({
  ofsRequired: z.enum(["yes", "no", "unknown", "waived"]).nullable(),
});
```

Route:

```ts
router.patch("/api/financial-disclosure-folders/:folderId/ofs", requirePermission("cases", "view"), async (req, res) => {
  const parsed = financialDisclosureOfsPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid OFS update", issues: parsed.error.issues });
  const actor = getUser(req as any);
  const updated = await financialDisclosureService.updateFolderOfsRequired(req.params.folderId, actor, parsed.data.ofsRequired);
  if (!updated) return res.status(404).json({ message: "Financial disclosure folder not found" });
  return res.json(updated);
});
```

The service must return 403-style failures if the actor is not superadmin, subadmin, or assigned mediator.

- [ ] **Step 6: Run route/upload regression**

Run:

```bash
npx tsx tests/financial-disclosure-folder.test.ts
npx tsx tests/booking-onboarding-flow.test.ts
npx tsx tests/mediation-session-post-session-ops.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit API correction**

```bash
git add server/services/booking.service.ts server/routes/case.routes.ts server/services/mediation-session.service.ts server/routes/mediation-session.routes.ts tests/financial-disclosure-folder.test.ts
git commit -m "feat: expose party financial disclosure APIs"
```

---

### Task 5: Update Case Detail Financial Disclosure UI

**Files:**
- Modify: `client/src/pages/case-detail.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/cases/:id/financial-disclosure-folders`
  - `PATCH /api/financial-disclosure-items/:id`
  - `PATCH /api/financial-disclosure-folders/:folderId/ofs`
  - `POST /api/cases/:id/documents`
- Produces:
  - `FinancialDisclosurePanel`
  - `FinancialDisclosurePartyFolderPanel`
  - upload target select with `data-testid="select-financial-disclosure-upload-target"`

- [ ] **Step 1: Update client types**

Folder view:

```ts
type FinancialDisclosureFolderView = {
  id: string;
  caseId: string;
  partyId: string;
  party: {
    id: string;
    role?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    userId?: string | null;
  };
  status: string;
  triggerSource: string;
  ofsRequired?: string | null;
  items: FinancialDisclosureItemView[];
  evidenceCategories: FinancialDisclosureEvidenceCategoryView[];
  documents: CaseDocumentView[];
};
```

Document view additions:

```ts
financialDisclosureItemId?: string | null;
financialDisclosureUploadTarget?: "online_disclosure_booklet" | "ofs" | "financial_disclosure_checklist" | "evidence_category" | null;
```

- [ ] **Step 2: Query plural folders**

Change query URL:

```ts
fetch(`/api/cases/${caseId}/financial-disclosure-folders`, { credentials: "include" })
```

Handle empty array with the non-required message.

- [ ] **Step 3: Render one panel per folder**

Use:

```tsx
{folders.map((folder) => (
  <FinancialDisclosurePartyFolderPanel
    key={folder.id}
    folder={folder}
    caseId={caseId}
    canUpdateStaffItems={canUpdateStaffItems}
  />
))}
```

Panel heading:

```tsx
Client {folder.party.role}: {[folder.party.firstName, folder.party.lastName].filter(Boolean).join(" ") || "Client"}
```

- [ ] **Step 4: Add upload target select**

Options:

```tsx
<SelectItem value="online_disclosure_booklet">Online disclosure booklet</SelectItem>
<SelectItem value="ofs">Open Financial Statement (OFS)</SelectItem>
<SelectItem value="financial_disclosure_checklist">Financial Disclosure Checklist</SelectItem>
<SelectItem value="evidence_category">Evidence category</SelectItem>
```

Use `data-testid="select-financial-disclosure-upload-target"`.

- [ ] **Step 5: Build upload payload**

For booklet:

```ts
financialDisclosureFolderId: folder.id,
financialDisclosureItemId: booklet.id,
financialDisclosureUploadTarget: "online_disclosure_booklet",
```

For OFS:

```ts
financialDisclosureFolderId: folder.id,
financialDisclosureUploadTarget: "ofs",
```

For checklist:

```ts
financialDisclosureFolderId: folder.id,
financialDisclosureItemId: checklist.id,
financialDisclosureUploadTarget: "financial_disclosure_checklist",
```

For evidence category:

```ts
financialDisclosureFolderId: folder.id,
financialDisclosureEvidenceCategoryId: selectedCategoryId,
financialDisclosureUploadTarget: "evidence_category",
```

- [ ] **Step 6: Wire OFS control to MIAM-backed route**

Display:

```tsx
folder.ofsRequired || "unknown"
```

Patch:

```ts
apiRequest("PATCH", `/api/financial-disclosure-folders/${folder.id}/ofs`, { ofsRequired })
```

- [ ] **Step 7: Run UI regression**

Run:

```bash
npx tsx tests/financial-disclosure-folder.test.ts
npx tsx tests/case-detail-miam-readiness-overview.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit UI correction**

```bash
git add client/src/pages/case-detail.tsx tests/financial-disclosure-folder.test.ts
git commit -m "feat: show party financial disclosure folders"
```

---

### Task 6: Update Documentation And Final Verification

**Files:**
- Modify: `replit.md`

**Interfaces:**
- Consumes: implemented behavior from Tasks 1-5.
- Produces: accurate implementation note for SOP 1.3a.

- [ ] **Step 1: Replace the current `replit.md` claim**

Replace the Financial Disclosure bullet with text covering:

```md
SOP 1.3a financial disclosure folders are first-class party-scoped records for Family cases whose subtype is `Property & finance (PF)` or `All issues mediation (AIM)`. The system creates one idempotent folder per eligible case per active party, with distinct folder items for the client's online disclosure booklet and mediator-facing Financial Disclosure Checklist, plus seeded evidence categories. OFS is not a separate folder field; the folder reads and updates the party's existing MIAM `ofs_required` value. Superadmins/subadmins can set the initial OFS value, and assigned mediators can update it later through the financial disclosure workflow. Clients see and upload only to their own folder; staff and assigned mediators can review all party folders. Documents can be uploaded against the booklet, OFS, checklist, or evidence categories through the existing case document upload pipeline. Folder creation runs after AIM/PF classification is persisted during booking onboarding, after admin case-type updates, and defensively before mediation-session hold creation. Existing folders remain in place if the case later changes away from AIM/PF, preserving submitted client data.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx tsx tests/financial-disclosure-folder.test.ts
npx tsx tests/db-migration-journal.test.ts
npx tsx tests/booking-onboarding-flow.test.ts
npx tsx tests/mediation-session-post-session-ops.test.ts
npx tsx tests/mediation-session-allocation.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run repository hygiene checks**

Run:

```bash
git diff --check
NODE_OPTIONS=--max-old-space-size=4096 npm run check
```

Expected:

- `git diff --check` passes.
- `npm run check` may still fail on pre-existing contractor/mediator pipeline and case-activity TypeScript errors. Any new financial disclosure TypeScript errors must be fixed before completion.

- [ ] **Step 4: Commit docs and verification**

```bash
git add replit.md docs/superpowers/specs/2026-09-01-financial-disclosure-party-folders-design.md docs/superpowers/plans/2026-09-01-financial-disclosure-party-folders.md
git commit -m "docs: plan party financial disclosure folders"
```

---

## Self-Review

Spec coverage:

- Per eligible case per party folders: Task 2 and Task 3.
- AIM/PF-only eligibility: Task 3.
- Booking, case-type update, and pre-session triggers: Task 4.
- Booklet/checklist/evidence categories: Task 2 and Task 3.
- Uploads for booklet, OFS, checklist, and evidence categories: Task 2, Task 4, and Task 5.
- OFS reads/writes MIAM `ofs_required`: Task 3, Task 4, and Task 5.
- Superadmin initial OFS and assigned mediator later edit: Task 3 and Task 4.
- Client privacy: Task 3, Task 4, and Task 5.
- Preserve folders when type changes away: Task 3, Task 4, and Task 6.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified implementation steps remain.

Type consistency:

- The plan consistently uses `partyId`, `financialDisclosureUploadTarget`, `ensureFinancialDisclosureFoldersForCase`, `getVisibleFoldersForCase`, `updateFolderOfsRequired`, and `validateFinancialDisclosureUploadMetadata`.
