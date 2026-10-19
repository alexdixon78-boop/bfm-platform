import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { canRequestMediatorField, canReviewMediatorField } from "../shared/mediator-rbac";

const routePath = new URL("../server/routes/mediator-profile.routes.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(routePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(role: string, actorId = "mediator-1") {
  let request = { id: "request-1", mediatorId: "mediator-1", field: "fmcUrn", proposedValue: "FMC-123", status: "pending" };
  const applied: Array<Record<string, unknown>> = [];
  const dependencies: Record<string, unknown> = {
    "../middleware/auth": { requireAuth(_req: unknown, _res: unknown, next: () => void) { next(); } },
    "../storage": { storage: { async getUser(id: string) { return id === actorId ? { id, role } : { id, role: "mediator" }; } } },
    "../services/mediator-profile.service": { mediatorProfileService: { async updateProfile(_id: string, patch: Record<string, unknown>) { applied.push(patch); return { ok: true, profile: patch }; } } },
    "../services/mediator-service-approval.service": { mediatorServiceApprovalService: {}, buildServiceApprovalActionPath() { return ""; } },
    "../services/email.service": { sendMediatorServiceApprovalDecisionEmail() {}, sendMediatorServiceProofRequestEmail() {} },
    "../utils/uk-wall-clock": { getUkDateKey() {}, toUkWallClockDateTime() {} },
    "@shared/mediator-rbac": { canManageMediatorServiceSlots() {}, canRequestMediatorField, canReviewMediatorField },
    "@shared/schema": { mediatorProfileChangeRequests: { id: "id", mediatorId: "mediatorId", status: "status", submittedAt: "submittedAt" } },
    "../repositories/mediator-profile.repository": { mediatorProfileRepository: { async getProfile() { return { fmcUrn: "old" }; }, async upsertProfile() {} } },
    "../services/audit-log.service": { logAudit() {} },
    "drizzle-orm": { and(...args: unknown[]) { return args; }, eq(a: unknown, b: unknown) { return [a, b]; }, desc(a: unknown) { return a; } },
    "../db": { db: {
      select() { return { from() { return { where() { return { async orderBy() { return [request]; }, then(resolve: (value: unknown) => void) { resolve([request]); } }; } }; } }; },
      insert() { return { values(value: Record<string, unknown>) { request = { ...request, ...value }; return { async returning() { return [request]; } }; } }; },
      update() { return { set(value: Record<string, unknown>) { return { where() { return { async returning() { request = { ...request, ...value }; return [request]; } }; } }; } }; },
    } },
  };
  const module = { exports: {} as any };
  const require = createRequire(routePath);
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => dependencies[name] ?? require(name) });
  const router = module.exports.default;
  return {
    applied,
    get request() { return request; },
    async call(path: string, body: unknown, targetId = "mediator-1") {
      const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods.post).route;
      let status = 200;
      let output: any;
      const response = { status(code: number) { status = code; return response; }, json(value: unknown) { output = value; return response; } };
      await route.stack.at(-1).handle({ session: { userId: actorId }, params: { id: targetId, requestId: "request-1" }, body }, response);
      return { status, output };
    },
  };
}

test("mediator can propose own credentials but cannot target another mediator or decisions", async () => {
  const h = harness("mediator");
  const path = "/api/mediators/:id/change-requests";
  assert.equal((await h.call(path, { field: "fmcUrn", proposedValue: "FMC-123" }, "mediator-2")).status, 403);
  assert.equal((await h.call(path, { field: "panelStatus", proposedValue: "Active" })).status, 403);
  assert.equal((await h.call(path, { field: "fmcUrn", proposedValue: "FMC-123" })).status, 201);
  assert.equal(h.applied.length, 0);
});

test("subadmin approval applies a request once; mediator review is denied", async () => {
  const path = "/api/mediators/:id/change-requests/:requestId/review";
  const mediator = harness("mediator");
  assert.equal((await mediator.call(path, { decision: "approved" })).status, 403);
  const admin = harness("subadmin", "admin-1");
  assert.equal((await admin.call(path, { decision: "approved" })).status, 200);
  assert.equal(admin.applied.length, 1);
  assert.equal(admin.applied[0].fmcUrn, "FMC-123");
  assert.equal((await admin.call(path, { decision: "approved" })).status, 409);
});

test("superadmin rejection does not apply the proposed value", async () => {
  const h = harness("superadmin", "admin-1");
  const result = await h.call("/api/mediators/:id/change-requests/:requestId/review", { decision: "rejected", note: "Outdated" });
  assert.equal(result.status, 200);
  assert.equal(h.applied.length, 0);
  assert.equal(h.request.status, "rejected");
});
