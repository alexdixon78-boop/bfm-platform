/**
 * Regression checks for the manually controlled case-level confidential flag.
 *
 * Run with: npx tsx tests/case-confidential-flag.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CaseRepository } from "../server/repositories/case.repository";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("schema, migration, and bootstrap define cases.confidential with default false only", () => {
  const schema = read("../shared/schema.ts");
  const bootstrap = read("../server/db-bootstrap.ts");
  const migration = read("../migrations/0037_case_confidential_flag.sql");

  assert.match(
    schema,
    /confidential:\s*boolean\("confidential"\)\.notNull\(\)\.default\(false\)/,
  );
  assert.match(bootstrap, /confidential BOOLEAN NOT NULL DEFAULT false/);
  assert.match(
    bootstrap,
    /ALTER TABLE cases ADD COLUMN IF NOT EXISTS confidential BOOLEAN NOT NULL DEFAULT false/,
  );
  assert.match(
    migration,
    /ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "confidential" boolean NOT NULL DEFAULT false/,
  );
  assert.doesNotMatch(migration, /safeguarding_confidential/);
});

test("safeguarding concern does not set the general confidential flag", () => {
  const routeSource = read("../server/routes/case.routes.ts");
  const concernUpdates = routeSource.match(
    /const updates: Partial<Case> = status === "concern"\s*\? \{([\s\S]*?)\}\s*: \{/,
  );

  assert.ok(concernUpdates, "safeguarding concern update block should exist");
  assert.match(concernUpdates[1], /safeguardingConfidential:\s*true/);
  assert.doesNotMatch(concernUpdates[1], /confidential:\s*true/);
});

test("case confidentiality has an explicit admin update endpoint with audit and activity", () => {
  const routeSource = read("../server/routes/case.routes.ts");
  const repositorySource = read("../server/repositories/case.repository.ts");

  assert.match(routeSource, /\/api\/cases\/:id\/confidential/);
  assert.match(routeSource, /requirePermission\("cases", "edit"\)/);
  assert.match(routeSource, /confidential:\s*z\.boolean\(\)/);
  assert.match(routeSource, /updateCaseConfidential/);
  assert.match(routeSource, /action:\s*"case_confidentiality_updated"/);
  assert.match(routeSource, /type:\s*"case_confidentiality_updated"/);
  assert.match(
    repositorySource,
    /async updateCaseConfidential\(id: string, confidential: boolean\)/,
  );
  assert.match(repositorySource, /lastUpdated: new Date\(\)/);
});

test("case list mapper preserves confidential and CIM flags in the API payload", () => {
  const repo = new CaseRepository();
  const mapped = (repo as any).mapRowToCase({
    id: "case-123",
    case_ref: "BFM-2026-0001",
    mediator_id: null,
    stage: "Intake",
    status: "Open",
    issue_type: "Family",
    lead_source: null,
    shuttle_mediation: false,
    last_updated: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    notes: null,
    referral_partner_name: null,
    referral_partner_code: null,
    closure_details: null,
    mediation_category: "Family",
    family_sub_type: null,
    workplace_sub_type: null,
    civil_sub_type: null,
    commercial_sub_type: null,
    other_sub_type: null,
    funding_source: null,
    voucher_status: null,
    in_court_status: null,
    cafcass_status: null,
    confidential: true,
    cim_eligible: true,
    moj_voucher_eligible: false,
    enquiry_date: null,
    miam_completed_date: null,
    closure_date: null,
  });

  assert.equal(mapped.confidential, true);
  assert.equal(mapped.cimEligible, true);
  assert.equal(mapped.mojVoucherEligible, false);
});

test("case confidentiality marking creates admin and full-access mediator notifications only when newly marked", () => {
  const routeSource = read("../server/routes/case.routes.ts");

  assert.match(
    routeSource,
    /async function collectSensitiveCaseMediatorRecipientIds/,
  );
  assert.match(
    routeSource,
    /storage\.listMediationSessionsByCase\(caseRecord\.id\)/,
  );
  assert.match(
    routeSource,
    /storage\.listMediationSessionParticipantsBySessionIds\(sessions\.map\(\(session\) => session\.id\)\)/,
  );
  assert.match(routeSource, /participant\.invitationStatus === "accepted"/);
  assert.match(
    routeSource,
    /participant\.role === "lead_mediator" \|\| participant\.role === "co_mediator"/,
  );
  assert.doesNotMatch(
    routeSource,
    /participant\.role === "observer"[\s\S]*sensitiveCaseMediatorRecipientIds/,
  );
  assert.match(routeSource, /recipientRole: "admin"/);
  assert.match(routeSource, /recipientRole: "mediator"/);
  const sensitiveNotificationHelper = routeSource.match(
    /async function notifySensitiveCaseAudience[\s\S]*?\n}\n\nfunction isOpenIntakeFollowUpStatus/,
  );
  assert.ok(
    sensitiveNotificationHelper,
    "sensitive notification helper should exist",
  );
  assert.doesNotMatch(
    sensitiveNotificationHelper[0],
    /recipientRole: "client"/,
  );

  const confidentialRoute = routeSource.match(
    /router\.patch\("\/api\/cases\/:id\/confidential"[\s\S]*?return res\.json\(updated\);\n}\);/,
  );
  assert.ok(confidentialRoute, "confidential route should exist");
  assert.match(
    confidentialRoute[0],
    /if \(existing\.confidential !== updated\.confidential\)/,
  );
  assert.match(confidentialRoute[0], /if \(updated\.confidential\)/);
  assert.match(
    confidentialRoute[0],
    /notifySensitiveCaseAudience\({[\s\S]*type: "case_confidentiality_updated"[\s\S]*urgency: "amber"[\s\S]*title: `Case marked confidential/,
  );
  assert.doesNotMatch(
    confidentialRoute[0],
    /if \(!updated\.confidential\)[\s\S]*notifySensitiveCaseAudience/,
  );
});

test("case detail redacts confidential from clients but exposes it to admins and mediators", () => {
  const serviceSource = read("../server/services/case.service.ts");
  const visibilitySource = read("../server/security/case-visibility.ts");

  assert.match(serviceSource, /buildClientCaseDetail/);
  assert.match(serviceSource, /access\.tier === "client_party"/);
  assert.match(visibilitySource, /export function buildClientCaseDetail/);
  assert.doesNotMatch(visibilitySource, /confidential:/);
});

test("enquiries expose derived caseConfidential from the linked case", () => {
  const repositorySource = read("../server/repositories/enquiry.repository.ts");

  assert.match(repositorySource, /caseConfidential:\s*boolean/);
  assert.match(repositorySource, /caseConfidential:\s*cases\.confidential/);
  assert.match(
    repositorySource,
    /caseConfidential:\s*r\.caseConfidential \?\? false/,
  );
});

test("case and enquiry pages render confidential badges and admin-only toggles", () => {
  const casesPage = read("../client/src/pages/cases.tsx");
  const caseDetailPage = read("../client/src/pages/case-detail.tsx");
  const enquiriesPage = read("../client/src/pages/enquiries.tsx");
  const enquiryDetailPage = read("../client/src/pages/enquiry-detail.tsx");

  assert.match(
    casesPage,
    /<div className="flex flex-col gap-1">[\s\S]*<div className="flex items-center gap-1\.5">[\s\S]*data-testid=\{`badge-case-confidential-\$\{c\.id\}`\}/,
  );
  assert.match(casesPage, /const canViewSensitiveCaseMarkers = !isClient/);
  assert.match(
    casesPage,
    /canViewSensitiveCaseMarkers && c\.confidential && \(/,
  );
  assert.match(
    casesPage,
    /canViewSensitiveCaseMarkers && selectedCase\.confidential && \(/,
  );
  assert.match(
    caseDetailPage,
    /canViewSensitiveCaseMarkers=\{canViewOperationalStaffData\}/,
  );
  assert.match(
    caseDetailPage,
    /canViewSensitiveCaseMarkers && caseData\.confidential && \(/,
  );
  assert.match(caseDetailPage, /data-testid="badge-case-confidential"/);
  assert.match(caseDetailPage, /\/api\/cases\/\$\{caseId\}\/confidential/);
  assert.match(caseDetailPage, /data-testid="button-toggle-case-confidential"/);
  assert.match(
    enquiriesPage,
    /data-testid=\{`badge-enquiry-confidential-\$\{enquiry\.id\}`\}/,
  );
  assert.match(
    enquiryDetailPage,
    /data-testid="badge-enquiry-case-confidential"/,
  );
  assert.match(
    enquiryDetailPage,
    /\/api\/cases\/\$\{linkedCaseId\}\/confidential/,
  );
  assert.match(
    enquiryDetailPage,
    /data-testid="button-toggle-enquiry-case-confidential"/,
  );
  assert.match(enquiryDetailPage, /isAdmin/);
});

test("case detail auto-opens confidential modal only when notes exist", () => {
  const caseDetailPage = read("../client/src/pages/case-detail.tsx");
  const autoOpenEffect = caseDetailPage.match(
    /useEffect\(\(\) => \{[\s\S]*?setConfidentialModalCaseId\(caseId \?\? null\);[\s\S]*?\}, \[[^\]]*confidentialNotesQuery\.isLoading[^\]]*\]\);/,
  );

  assert.ok(autoOpenEffect, "confidential auto-open effect should exist");
  assert.match(caseDetailPage, /const hasConfidentialNotes = \(confidentialNotesQuery\.data\?\.length \?\? 0\) > 0;/);
  assert.match(autoOpenEffect[0], /hasConfidentialNotes/);
  assert.match(autoOpenEffect[0], /confidentialModalCaseId !== caseId/);
  assert.match(caseDetailPage, /data-testid="button-open-confidential-modal"/);
  assert.match(caseDetailPage, /onClick=\{\(\) => setConfidentialModalOpen\(true\)\}/);
});
