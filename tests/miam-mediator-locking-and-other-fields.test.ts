/**
 * Regression checks for MIAM session mediator locking and explicit "Other" values.
 *
 * Run with: npx tsx tests/miam-mediator-locking-and-other-fields.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const routeSource = read("../server/routes/miam-record.routes.ts");
const componentSource = read("../client/src/components/miam-record-tab.tsx");
const schemaSource = read("../shared/schema.ts");
const bootstrapSource = read("../server/db-bootstrap.ts");
const pdfSource = read("../server/services/miam-pdf.service.ts");

test("MIAM save normalizes session mediator by role", () => {
  assert.match(routeSource, /resolveMediatorName\(party\.miamMediatorId \|\| party\.allocatedMediatorId\)/);
  assert.doesNotMatch(routeSource, /if \(user\.role === "mediator"\) \{\s*updateData\.sessionMediator = user\.name \|\| null;/);
  assert.match(routeSource, /if \(user\.role === "mediator" \|\| user\.role === "subadmin"\) \{/);
  assert.match(routeSource, /existingRecord\?\.sessionMediator/);
  assert.match(routeSource, /user\.role === "superadmin"[\s\S]*&& updateData\.sessionMediator[\s\S]*&& updateData\.sessionMediator !== existingRecord\?\.sessionMediator/);
  assert.match(routeSource, /Session mediator must be an active mediator/);
});

test("MIAM case response exposes mediator options only for superadmin", () => {
  assert.match(routeSource, /async function listActiveMediatorOptions/);
  assert.match(routeSource, /user\.role === "superadmin" \? await listActiveMediatorOptions\(\) : undefined/);
  assert.match(routeSource, /\.\.\.\(mediatorOptions \? \{ mediatorOptions \} : \{\}\)/);
});

test("MIAM UI keeps mediator read-only except superadmin dropdown", () => {
  assert.match(componentSource, /applyBlankMiamHeaderDefaults/);
  assert.doesNotMatch(componentSource, /user\?\.role === "mediator"[\s\S]*merged\.sessionMediator = user\.name \|\| ""/);
  assert.doesNotMatch(componentSource, /user\?\.role === "mediator"[\s\S]*next\.sessionMediator = user\.name \|\| ""/);
  assert.match(componentSource, /data-testid="select-session-mediator"/);
  assert.match(componentSource, /\{isSuperadmin \? \(/);
  assert.match(componentSource, /<ReadOnlyField label="Mediator" value=\{str\(formData\.sessionMediator\)\} \/>/);
  assert.doesNotMatch(componentSource, /\/api\/parties\/\$\{.*\}\/link-settings[\s\S]*miam-record/i);
});

test("blank MIAM record headers default to assigned mediator and current UK date time", () => {
  assert.match(componentSource, /function getCurrentUkMiamDateTime/);
  assert.match(componentSource, /timeZone: "Europe\/London"/);
  assert.match(componentSource, /sessionMediator: isBlankMiamHeaderValue\(draft\.sessionMediator\) \? assignedMediator : draft\.sessionMediator/);
  assert.match(componentSource, /sessionDate: isBlankMiamHeaderValue\(draft\.sessionDate\) \? ukNow\.date : draft\.sessionDate/);
  assert.match(componentSource, /sessionTime: isBlankMiamHeaderValue\(draft\.sessionTime\) \? ukNow\.time : draft\.sessionTime/);
  assert.match(componentSource, /setIsDirty\(false\)/);
});

test("MIAM session date cannot be future dated", () => {
  assert.match(componentSource, /const todayUkDate = getCurrentUkMiamDateTime\(\)\.date/);
  assert.match(componentSource, /max=\{todayUkDate\}/);
  assert.match(componentSource, /const nextSessionDate = e\.target\.value > todayUkDate \? todayUkDate : e\.target\.value/);
  assert.match(routeSource, /function getCurrentUkDateString/);
  assert.match(routeSource, /sessionDate cannot be in the future/);
});

test("MIAM stores explicit other values for DA support and PPC reasons", () => {
  assert.match(schemaSource, /domesticAbuseSupportServicesOther: text\("domestic_abuse_support_services_other"\)/);
  assert.match(schemaSource, /ppcReasonOther: text\("ppc_reason_other"\)/);
  assert.match(bootstrapSource, /domestic_abuse_support_services_other TEXT/);
  assert.match(bootstrapSource, /ppc_reason_other TEXT/);
  assert.match(routeSource, /domesticAbuseSupportServicesOther: z\.string\(\)\.max\(500\)/);
  assert.match(routeSource, /ppcReasonOther: z\.string\(\)\.max\(500\)/);
});

test("MIAM UI and PDF render explicit other values", () => {
  assert.match(componentSource, /data-testid="input-da-support-other"/);
  assert.match(componentSource, /data-testid="input-ppc-reason-other"/);
  assert.match(componentSource, /Other: \$\{formData\.domesticAbuseSupportServicesOther\}/);
  assert.match(componentSource, /Other: \$\{formData\.ppcReasonOther\}/);
  assert.match(pdfSource, /record\.domesticAbuseSupportServicesOther/);
  assert.match(pdfSource, /record\.ppcReasonOther/);
});

test("MIAM read-only dates render in UK display format", () => {
  assert.match(componentSource, /import \{ formatUkWallClockDate \} from "@\/lib\/date-time";/);
  assert.match(componentSource, /function formatMiamDisplayDate/);
  assert.match(componentSource, /formatUkWallClockDate\(parsed/);
  assert.match(componentSource, /<ReadOnlyField label="Date" value=\{formatMiamDisplayDate\(formData\.sessionDate\)\} \/>/);
  assert.match(componentSource, /<ReadOnlyField label="DOB" value=\{formatMiamDisplayDate\(formData\.clientDob\)\} \/>/);
  assert.match(componentSource, /<ReadOnlyField label="Date of birth" value=\{formatMiamDisplayDate\(child\.dob\)\} \/>/);
  assert.match(componentSource, /<ReadOnlyField label="Date of separation" value=\{formatMiamDisplayDate\(formData\.dateOfSeparation\)\} \/>/);
});
