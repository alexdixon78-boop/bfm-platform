/**
 * Regression coverage for the managed service catalogue.
 *
 * Run with: npx tsx --test tests/service-catalogue-management.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const seedSource = read("../server/seed.ts");
const routeSource = read("../server/routes/service-type.routes.ts");
const pageSource = read("../client/src/pages/services.tsx");
const repositorySource = read("../server/repositories/service-type.repository.ts");
const migrationSource = read("../migrations/0055_service_catalogue_expansion.sql");
const docsSource = read("../replit.md");

const missingServices = [
  ["Mediation Child only", "Mediation"],
  ["Mediation AIM", "Mediation"],
  ["Mediation P&F", "Mediation"],
  ["Child Inclusive Parent Prep session", "Mediation"],
  ["Child Inclusive Mediation session", "Mediation"],
  ["Open Financial Statement (OFS)", "Court & Documentation"],
  ["Consent Order Essential Package", "Packages"],
  ["Consent Order Supported Package", "Packages"],
] as const;

test("baseline seed includes every approved catalogue addition with manual pricing", () => {
  for (const [name, category] of missingServices) {
    const escapedName = name.replace(/[()&]/g, "\\$&");
    const entry = new RegExp(`name:\\s*"${escapedName}"[\\s\\S]*?category:\\s*"${category}"[\\s\\S]*?priceInfo:\\s*"Contact for pricing"[\\s\\S]*?onlinePaymentEnabled:\\s*false[\\s\\S]*?paymentAmountPence:\\s*null`);
    assert.match(seedSource, entry, `${name} must be seeded with the agreed defaults`);
  }
});

test("service deletion is a superadmin-only guarded hard-delete route", () => {
  assert.match(routeSource, /router\.delete\("\/api\/service-types\/:id"/);
  const deleteStart = routeSource.indexOf('router.delete("/api/service-types/:id"');
  const deleteHandler = routeSource.slice(deleteStart);
  assert.match(deleteHandler, /actor\.role !== "superadmin"/);
  assert.match(deleteHandler, /deleteIfUnlinked/);
  assert.match(deleteHandler, /status\(409\)/);
  assert.match(deleteHandler, /action:\s*"delete"/);
  assert.match(repositorySource, /serviceTypes\.id, id\)\)\.for\("update"\)/);
  assert.match(repositorySource, /serviceTypeDeletions/);
  assert.match(repositorySource, /baselineServiceName \?\? service\.name/);
});

test("services page exposes destructive deletion only to superadmins with confirmation", () => {
  assert.match(pageSource, /user\?\.role === "superadmin"/);
  assert.match(pageSource, /button-delete-service-/);
  assert.match(pageSource, /Delete service type/);
  assert.match(pageSource, /This cannot be undone/);
  assert.match(pageSource, /getApiErrorMessage\(err\)/);
});

test("mediator service listing excludes financial columns", () => {
  assert.match(pageSource, /!isMediator && <TableHead>Price Info<\/TableHead>/);
  assert.match(pageSource, /!isMediator && <TableHead>Online payment<\/TableHead>/);
  assert.match(pageSource, /!isMediator && \(\s*<TableCell className="text-sm" data-testid=\{`text-service-price-/);
  assert.match(pageSource, /!isMediator && \(\s*<TableCell className="text-sm" data-testid=\{`text-service-online-payment-/);
});

test("changing mediator service assignments reconciles imported calendar availability", () => {
  const assignmentStart = routeSource.indexOf('router.put("/api/mediators/:id/services"');
  const assignmentHandler = routeSource.slice(assignmentStart);
  assert.match(assignmentHandler, /reconcileServiceApprovalsForCalendarAvailability/);
  assert.match(assignmentHandler, /Calendar availability reconciliation failed/);
});

test("service catalogue documentation records the safe deletion policy", () => {
  assert.match(docsSource, /Service Catalogue/i);
  assert.match(docsSource, /superadmin/i);
  assert.match(docsSource, /unlinked/i);
  assert.match(docsSource, /tombstone/i);
});

test("baseline service tombstones survive renamed services and repeat migrations", () => {
  assert.match(seedSource, /baselineServiceName/);
  assert.match(seedSource, /or\(eq\(serviceTypes\.name, serviceType\.name\), eq\(serviceTypes\.baselineServiceName, serviceType\.name\)\)/);
  assert.match(migrationSource, /WHERE NOT EXISTS \(SELECT 1 FROM service_type_deletions/);
  assert.match(migrationSource, /NULL::integer/);
  assert.match(migrationSource, /service_types\.baseline_service_name = seed\.name/);
});
