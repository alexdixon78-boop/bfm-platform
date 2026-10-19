import { test } from "node:test";
import assert from "node:assert/strict";
import * as schema from "../shared/schema";
import {
  canEditField,
  canViewField,
  SECTION_D_FIELD_META,
  validateSectionD,
  validateServiceOfferingRequirements,
} from "../shared/mediator-rbac";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("mediation role qualification is hierarchical", () => {
  const qualifies = (schema as any).isMediationRoleQualifiedFor;
  assert.equal(typeof qualifies, "function");

  assert.equal(qualifies("lead", "lead_mediator"), true);
  assert.equal(qualifies("lead", "co_mediator"), true);
  assert.equal(qualifies("lead", "observer"), true);
  assert.equal(qualifies("co_mediator", "lead_mediator"), false);
  assert.equal(qualifies("co_mediator", "co_mediator"), true);
  assert.equal(qualifies("co_mediator", "observer"), true);
  assert.equal(qualifies("observer", "lead_mediator"), false);
  assert.equal(qualifies("observer", "co_mediator"), false);
  assert.equal(qualifies("observer", "observer"), true);
  assert.equal(qualifies("unclassified", "observer"), false);
});

test("unknown qualification values never grant assignment eligibility", () => {
  const qualifies = (schema as any).isMediationRoleQualifiedFor;
  assert.equal(typeof qualifies, "function");
  assert.equal(qualifies("unexpected", "observer"), false);
  assert.equal(qualifies(null, "lead_mediator"), false);
});

test("assignment options require active approved mediators and split them by hierarchy", () => {
  const buildOptions = (schema as any).buildMediationRoleOptionSets;
  assert.equal(typeof buildOptions, "function");
  const options = buildOptions([
    { id: "lead", name: "Lead", email: "lead@test", status: "active", mediationRoleQualification: "lead", mediationSessionsApproved: true },
    { id: "co", name: "Co", email: "co@test", status: "active", mediationRoleQualification: "co_mediator", mediationSessionsApproved: true },
    { id: "observer", name: "Observer", email: "observer@test", status: "active", mediationRoleQualification: "observer", mediationSessionsApproved: true },
    { id: "inactive", name: "Inactive", email: "inactive@test", status: "archived", mediationRoleQualification: "lead", mediationSessionsApproved: true },
    { id: "unapproved", name: "Unapproved", email: "unapproved@test", status: "active", mediationRoleQualification: "lead", mediationSessionsApproved: false },
    { id: "unknown", name: "Unknown", email: "unknown@test", status: "active", mediationRoleQualification: "unclassified", mediationSessionsApproved: true },
  ]);

  assert.deepEqual(options.leadMediators.map((row: any) => row.id), ["lead"]);
  assert.deepEqual(options.coMediators.map((row: any) => row.id), ["lead", "co"]);
  assert.deepEqual(options.observers.map((row: any) => row.id), ["lead", "co", "observer"]);
});

test("case lead options accept any matching Lead-qualified approved service and deduplicate by mediator", () => {
  const buildOptions = (schema as any).buildCaseLeadMediatorOptions;
  assert.equal(typeof buildOptions, "function");

  const options = buildOptions([
    { id: "zeta", name: "Zeta Lead", role: "mediator", status: "active", serviceTypeId: "family-miam", mediationRoleQualification: "lead", serviceApproved: true },
    { id: "alpha", name: "Alpha Lead", role: "mediator", status: "active", serviceTypeId: "workplace", mediationRoleQualification: "lead", serviceApproved: true },
    { id: "alpha", name: "Alpha Lead", role: "mediator", status: "active", serviceTypeId: "civil", mediationRoleQualification: "lead", serviceApproved: true },
    { id: "mismatch", name: "Mismatch", role: "mediator", status: "active", serviceTypeId: "service-a", mediationRoleQualification: "lead", serviceApproved: false },
    { id: "mismatch", name: "Mismatch", role: "mediator", status: "active", serviceTypeId: "service-b", mediationRoleQualification: "co_mediator", serviceApproved: true },
    { id: "pending", name: "Pending", role: "mediator", status: "active", serviceTypeId: "service-c", mediationRoleQualification: "lead", serviceApproved: false },
    { id: "rejected", name: "Rejected", role: "mediator", status: "active", serviceTypeId: "service-d", mediationRoleQualification: "lead", serviceApproved: false },
    { id: "expired", name: "Expired", role: "mediator", status: "active", serviceTypeId: "service-e", mediationRoleQualification: "lead", serviceApproved: false },
    { id: "inactive", name: "Inactive", role: "mediator", status: "archived", serviceTypeId: "service-f", mediationRoleQualification: "lead", serviceApproved: true },
    { id: "admin", name: "Admin", role: "superadmin", status: "active", serviceTypeId: "service-g", mediationRoleQualification: "lead", serviceApproved: true },
  ]);

  assert.deepEqual(options, [
    { id: "alpha", name: "Alpha Lead" },
    { id: "zeta", name: "Zeta Lead" },
  ]);
});

test("session role validation reports mediators selected in more than one role", () => {
  const duplicates = (schema as any).findDuplicateMediationSessionRoleIds;
  assert.equal(typeof duplicates, "function");
  assert.deepEqual(duplicates("lead", ["co", "duplicate"], ["observer", "duplicate"]), ["duplicate"]);
  assert.deepEqual(duplicates("lead", ["lead"], []), ["lead"]);
  assert.deepEqual(duplicates("lead", ["co"], ["observer"]), []);
});

test("profile-level qualification remains readable legacy data but is no longer mandatory service offering input", () => {
  assert.equal(canEditField("mediationRoleQualification", "superadmin", "admin", "mediator"), true);
  assert.equal(canEditField("mediationRoleQualification", "subadmin", "subadmin", "mediator"), true);
  assert.equal(canEditField("mediationRoleQualification", "mediator", "mediator", "mediator"), false);
  assert.equal(canViewField("mediationRoleQualification", "mediator", "mediator", "mediator"), true);
});

test("service offering no longer requires profile-level qualification", () => {
  const metadata = new Map(SECTION_D_FIELD_META.map((field) => [field.key, field.mandatory]));
  assert.equal(metadata.get("mediationRoleQualification"), "N");
  assert.equal(metadata.get("mediationTypes"), "N");

  assert.deepEqual(validateSectionD({
    mediationRoleQualification: "unclassified",
    mediationTypes: [],
  }), []);
});

test("service offering requires at least one selected service", () => {
  assert.deepEqual(validateServiceOfferingRequirements({
    mediationRoleQualification: "observer",
    mediationTypes: [],
  }, []), [{
    field: "services",
    message: "Services are required",
  }]);

  assert.deepEqual(validateServiceOfferingRequirements({
    mediationRoleQualification: "observer",
    mediationTypes: [],
  }, ["service-1"]), []);
});

test("mediator service assignments carry per-service mediation role qualification", () => {
  const schemaSource = read("../shared/schema.ts");
  const routeSource = read("../server/routes/service-type.routes.ts");
  const repoSource = read("../server/repositories/service-type.repository.ts");
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const migrationSource = read("../migrations/0061_per_service_mediator_role_qualification.sql");

  assert.match(schemaSource, /mediationRoleQualification:\s*text\("mediation_role_qualification"\)\.notNull\(\)\.default\("unclassified"\)/);
  assert.match(routeSource, /services:\s*z\.array\(/);
  assert.match(routeSource, /Legacy payload:[\s\S]*serviceTypeIds/);
  assert.match(routeSource, /normalizeMediationRoleQualification/);
  assert.match(repoSource, /setMediatorServices\(mediatorId: string, services: MediatorServiceAssignmentInput\[\]\)/);
  assert.match(repoSource, /mediationRoleQualification/);
  assert.match(bootstrapSource, /role_column_exists BOOLEAN/);
  assert.match(bootstrapSource, /IF NOT role_column_exists THEN[\s\S]*ADD COLUMN mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified'/);
  assert.match(bootstrapSource, /UPDATE mediator_service_types mst[\s\S]*mp\.mediation_role_qualification[\s\S]*mediator_profiles mp/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified'/);
  assert.match(migrationSource, /UPDATE mediator_service_types mst[\s\S]*mp\.mediation_role_qualification[\s\S]*mediator_profiles mp/);
});

test("role backfill promotes approved approval-only services without promoting pending or expired approvals", () => {
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const migrationSource = read("../migrations/0061_per_service_mediator_role_qualification.sql");
  for (const source of [bootstrapSource, migrationSource]) {
    assert.match(source, /INSERT INTO mediator_service_types\s*\(\s*mediator_id,\s*service_type_id,\s*mediation_role_qualification\s*\)/);
    assert.match(source, /FROM mediator_service_approvals msa[\s\S]*JOIN mediator_profiles mp[\s\S]*JOIN users u/);
    assert.match(source, /msa\.status = 'approved'/);
    assert.match(source, /msa\.expired_at IS NULL/);
    assert.match(source, /msa\.expiry_date IS NULL OR msa\.expiry_date >= CURRENT_DATE::text/);
    assert.match(source, /u\.role = 'mediator'[\s\S]*u\.status = 'active'/);
    assert.match(source, /ON CONFLICT \(mediator_id, service_type_id\) DO NOTHING/);
    assert.doesNotMatch(source, /msa\.status IN \('approved', 'pending_review'\)/);
  }
});

test("service assignment API rejects duplicate service IDs before persistence", () => {
  const routeSource = read("../server/routes/service-type.routes.ts");
  assert.match(routeSource, /new Set\(serviceTypeIds\)\.size !== serviceTypeIds\.length/);
  assert.match(routeSource, /Duplicate service type IDs are not allowed/);
});

test("mediator listing enrichment includes qualification with a legacy fallback", () => {
  const rows = schema.attachMediatorQualifications(
    [{ id: "lead", name: "Lead" }, { id: "legacy", name: "Legacy" }],
    [{ userId: "lead", mediationRoleQualification: "lead" }],
  );

  assert.deepEqual(rows, [
    { id: "lead", name: "Lead", mediationRoleQualification: "lead" },
    { id: "legacy", name: "Legacy", mediationRoleQualification: "unclassified" },
  ]);
});

test("qualification labels are suitable for the mediator listing", () => {
  const label = (schema as any).getMediationRoleQualificationLabel;
  assert.equal(typeof label, "function");
  assert.equal(label("lead"), "Lead mediator");
  assert.equal(label("co_mediator"), "Co-mediator");
  assert.equal(label("observer"), "Observer");
  assert.equal(label("unclassified"), "Unclassified");
  assert.equal(label("unexpected"), "Unclassified");
});

test("Add/Edit mediator puts qualification selectors on selected services instead of the account form", () => {
  const pageSource = read("../client/src/pages/mediators.tsx");
  assert.match(pageSource, /selectedServiceQualifications/);
  assert.match(pageSource, /serviceAssignmentsPayload/);
  assert.match(pageSource, /services:\s*serviceAssignmentsPayload/);
  assert.match(pageSource, /data-testid=\{`select-service-role-\$\{st\.id\}`\}/);
  assert.doesNotMatch(pageSource, /data-testid="select-mediator-role-qualification"/);
});

test("applicant conversion explicitly creates an unclassified mediator", () => {
  const conversionSource = read("../server/services/mediator-applicant.service.ts");
  assert.match(conversionSource, /createMediator\(\{ name: fullName, email: applicant\.email, mediationRoleQualification: "unclassified" \}\)/);
});

test("profile service offering UI uses per-service qualification selection", () => {
  const detailSource = read("../client/src/pages/mediator-detail.tsx");
  assert.match(detailSource, /selectedServiceQualifications/);
  assert.match(detailSource, /servicesPatch\.mutate\(serviceAssignmentsPayload\)/);
  assert.match(detailSource, /data-testid=\{`select-profile-service-role-\$\{st\.id\}`\}/);
  assert.match(detailSource, /Service role qualification/);
  assert.doesNotMatch(detailSource, /data-testid="select-mediation-role-qualification"/);
  assert.doesNotMatch(detailSource, /data-testid="grid-solo-co-matrix"/);
});

test("service role selectors explain the Lead Co-mediator Observer hierarchy", () => {
  const addEditSource = read("../client/src/pages/mediators.tsx");
  const detailSource = read("../client/src/pages/mediator-detail.tsx");
  const note = "Lead mediators can act as Lead, Co-mediator, or Observer. Co-mediators can act as Co-mediator or Observer. Observers can only observe.";
  assert.match(addEditSource, new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(detailSource, new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("bootstrap and migration persist qualification and backfill approved session mediators", () => {
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const migrationSource = read("../migrations/0043_mediator_role_qualification.sql");
  assert.match(bootstrapSource, /mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified'/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified'/);
  assert.match(migrationSource, /st\.name = 'Mediation Sessions'/);
  assert.match(migrationSource, /msa\.status = 'approved'/);
  assert.match(migrationSource, /SET mediation_role_qualification = 'lead'/);
});
