/**
 * Permission model contract tests.
 *
 * Run with: npx tsx --test tests/permissions-model.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_AREAS,
  CLIENT_PORTAL_ACCESS,
  CONFIGURABLE_ROLES,
  DEFAULT_PERMISSIONS,
  mergeCanonicalPermissions,
  validatePermissionUpdates,
} from "../shared/permissions";

test("the configurable catalogue contains business areas, not legacy client-only sections", () => {
  assert.deepEqual(CONFIGURABLE_ROLES, ["subadmin", "staff", "mediator", "contractor"]);
  assert.deepEqual(
    ACCESS_AREAS.map((area) => area.label),
    [
      "Overview",
      "Enquiry Management",
      "Case Management",
      "Appointment Management",
      "Client Records",
      "Mediator Management",
      "Contractor Management",
      "Finance",
      "Court Forms",
      "Reporting",
      "Team Management",
      "Audit & Compliance",
      "Service Catalogue",
      "WhatsApp Communications",
    ],
  );
  assert.equal(ACCESS_AREAS.some((area) => area.section === "documents"), false);
  assert.equal(ACCESS_AREAS.some((area) => area.section === "contacts"), false);
  assert.equal(ACCESS_AREAS.some((area) => area.section === "settings"), false);
  assert.equal(ACCESS_AREAS.find((area) => area.section === "dashboard")?.supportsEdit, false);
  assert.equal(ACCESS_AREAS.find((area) => area.section === "reports")?.supportsEdit, false);
  assert.equal(ACCESS_AREAS.find((area) => area.section === "audit_log")?.supportsEdit, false);
});

test("client portal access is fixed and documents are described as case-level", () => {
  assert.deepEqual(CLIENT_PORTAL_ACCESS.map((item) => item.label), [
    "Dashboard",
    "Mediation",
    "Appointments",
    "My Contacts",
  ]);
  assert.match(CLIENT_PORTAL_ACCESS.find((item) => item.label === "Mediation")?.description ?? "", /Documents/i);
});

test("canonical merge restores every default row while preserving stored overrides", () => {
  const legacyWithoutCourtForms = DEFAULT_PERMISSIONS.filter(
    (entry) => entry.section !== "court_forms",
  );
  assert.equal(legacyWithoutCourtForms.length, 96);

  const stored = legacyWithoutCourtForms.map((entry) =>
    entry.role === "staff" && entry.section === "cases"
      ? { ...entry, canView: true, canEdit: true }
      : entry,
  );
  const canonical = mergeCanonicalPermissions(stored);

  assert.equal(canonical.length, 102);
  assert.equal(canonical.filter((entry) => entry.section === "court_forms").length, 6);
  assert.deepEqual(
    canonical.find((entry) => entry.role === "staff" && entry.section === "cases"),
    { role: "staff", section: "cases", canView: true, canEdit: true },
  );
});

test("permission update validation accepts changed configurable entries only", () => {
  assert.deepEqual(
    validatePermissionUpdates([
      { role: "staff", section: "cases", canView: true, canEdit: true },
    ]),
    [{ role: "staff", section: "cases", canView: true, canEdit: true }],
  );

  const invalidPayloads: unknown[] = [
    [{ role: "client", section: "cases", canView: true, canEdit: false }],
    [{ role: "superadmin", section: "cases", canView: true, canEdit: false }],
    [{ role: "staff", section: "documents", canView: true, canEdit: false }],
    [{ role: "staff", section: "dashboard", canView: true, canEdit: true }],
    [{ role: "staff", section: "cases", canView: false, canEdit: true }],
    [{ role: "staff", section: "cases", canView: 1, canEdit: false }],
    [
      { role: "staff", section: "cases", canView: true, canEdit: false },
      { role: "staff", section: "cases", canView: false, canEdit: false },
    ],
  ];

  for (const payload of invalidPayloads) {
    assert.throws(() => validatePermissionUpdates(payload));
  }
});
