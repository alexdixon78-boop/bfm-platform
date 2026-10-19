/** Run with: npx tsx tests/staff-rbac-correction.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyCaseAccessFromContext, hasFullOperationalCaseAccess } from "../server/security/case-access-policy";
import { canDownloadCaseDocument } from "../server/security/document-access";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Staff has a full operational case tier without becoming an administrator", () => {
  const access = classifyCaseAccessFromContext(
    { id: "staff-1", role: "staff" },
    { caseMediatorId: null, parties: [], sessions: [], participants: [] },
  );
  assert.deepEqual(access, { tier: "operational_staff" });
  assert.equal(hasFullOperationalCaseAccess(access), true);
  assert.equal(canDownloadCaseDocument({}, access), true);
});

test("Staff case listing uses all-case scope and still redacts admin-only invitation fields", () => {
  const source = read("../server/services/case.service.ts");
  const detailPage = read("../client/src/pages/case-detail.tsx");
  const demographics = read("../server/routes/demographic.routes.ts");
  assert.match(source, /hasAllCaseScope/);
  assert.match(source, /user\.role === "staff"/);
  assert.match(source, /\? \{ kind: "all" \}/);
  assert.match(source, /stripInviteFields/);
  assert.match(detailPage, /canManageOrdinaryCase = canEdit\("cases"\).*user\?\.role === "staff"/);
  assert.match(demographics, /user\.role === "staff"/);
  assert.match(demographics, /permissionService\.getPermissions\(\)/);
});

test("Client Records and Reporting rely on permissions for ordinary reads", () => {
  const clients = read("../server/routes/client.routes.ts");
  const reports = read("../server/routes/report.routes.ts");
  const clientList = clients.slice(clients.indexOf('router.get(\n  "/api/clients"'), clients.indexOf('router.post(\n  "/api/clients/legacy-import'));
  const clientDetail = clients.slice(clients.indexOf('router.get(\n  "/api/clients/:id"'), clients.indexOf('router.get(\n  "/api/clients/:id/legacy-history"'));
  assert.doesNotMatch(clientList, /restricted to administrators/);
  assert.doesNotMatch(clientDetail, /restricted to administrators/);
  assert.match(clientList, /\["superadmin", "subadmin", "staff"\]\.includes\(actor\.role\)/);
  assert.match(clientDetail, /\["superadmin", "subadmin", "staff"\]\.includes\(actor\.role\)/);
  assert.doesNotMatch(reports, /Admin reports are only available to admins/);
});

test("mediator and contractor pipelines use matching View and Edit permissions", () => {
  const mediator = read("../server/routes/mediator-pipeline.routes.ts");
  const applicants = read("../server/routes/mediator-applicant.routes.ts");
  const contractor = read("../server/routes/contractor-pipeline.routes.ts");
  assert.match(mediator, /requirePermission\("mediators", "view"\)/);
  assert.match(mediator, /requirePermission\("mediators", "edit"\)/);
  assert.doesNotMatch(mediator, /Only superadmin or subadmin/);
  assert.match(applicants, /requirePermission\("mediators", "view"\)/);
  assert.match(applicants, /requirePermission\("mediators", "edit"\)/);
  assert.match(contractor, /requirePermission\("contractors", "view"\)/);
  assert.match(contractor, /requirePermission\("contractors", "edit"\)/);
  assert.doesNotMatch(contractor, /Only superadmin or subadmin/);
});

test("Staff user administration is restricted to Staff peers", () => {
  const service = read("../server/services/user.service.ts");
  const routes = read("../server/routes/user.routes.ts");
  const page = read("../client/src/pages/users.tsx");
  assert.match(service, /assertActorCanManageAdminUser/);
  assert.match(service, /actor\.role === "staff"/);
  assert.match(service, /targetRole !== "staff"/);
  assert.match(routes, /createAdminUser\(req\.body, actor\)/);
  assert.match(routes, /updateAdminUser\(req\.params\.id, req\.body, actor\)/);
  assert.match(routes, /deleteAdminUser\(req\.params\.id, actor\)/);
  assert.match(page, /isStaffActor/);
  assert.match(page, /canManageUser/);
  assert.match(page, /!isStaffActor \|\| user\.role === "staff"/);
});

test("ordinary finance reads and appointment writes use their matching permissions", () => {
  const finance = read("../server/routes/finance.routes.ts");
  const appointments = read("../server/routes/appointment.routes.ts");
  assert.match(finance, /cases\/:caseId\/finance", requireAuth, requireClientOrFinanceView/);
  assert.match(finance, /payments\/:paymentId\/receipt", requireAuth, requireClientOrFinanceView/);
  assert.match(finance, /const requireFinanceView = requirePermission\("finance", "view"\)/);
  assert.match(appointments, /appointments\/:id", requirePermission\("appointments", "edit"\)/);
  assert.match(appointments, /appointments\/:id\/complete", requirePermission\("appointments", "edit"\)/);
});

test("hard-delete and sensitive case exceptions remain administrator-only", () => {
  const appointments = read("../server/routes/appointment.routes.ts");
  const mediatorRoutes = read("../server/routes/mediator.routes.ts");
  const contractorRoutes = read("../server/routes/contractor.routes.ts");
  const contractorPipeline = read("../server/routes/contractor-pipeline.routes.ts");
  const cases = read("../server/routes/case.routes.ts");
  assert.match(appointments, /Only administrators can permanently delete appointments/);
  assert.match(mediatorRoutes, /Only administrators can remove mediators/);
  assert.match(contractorRoutes, /Only administrators can permanently delete contractors/);
  assert.match(contractorPipeline, /Only administrators can permanently delete contractor applicants/);
  assert.match(cases, /Only admins can update case confidentiality/);
});
