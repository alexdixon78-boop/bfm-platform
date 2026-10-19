/**
 * Regression coverage for Superadmin manual approval of live-mediator services.
 *
 * Run with: npx tsx --test tests/mediator-service-manual-approval.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const routeSource = read("../server/routes/mediator-profile.routes.ts");
const serviceSource = read("../server/services/mediator-service-approval.service.ts");
const schemaSource = read("../shared/schema.ts");
const bootstrapSource = read("../server/db-bootstrap.ts");
const detailSource = read("../client/src/pages/mediator-detail.tsx");
const migrationSource = read("../migrations/0047_manual_mediator_service_approval.sql");
const docsSource = read("../replit.md");
const routePath = new URL("../server/routes/mediator-profile.routes.ts", import.meta.url);
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function routeHarness(role: string) {
  const calls: Array<Record<string, unknown>> = [];
  const actor = { id: "actor-1", role, name: "Actor", status: "active" };
  const mediator = { id: "mediator-1", role: "mediator", name: "Mediator", status: "active" };
  const service = { id: "service-1", name: "MIAM", isActive: true };
  const dependencies: Record<string, unknown> = {
    "../middleware/auth": { requireAuth(_req: unknown, _res: unknown, next: () => void) { next(); } },
    "../storage": { storage: {
      async getUser(id: string) { return id === actor.id ? actor : id === mediator.id ? mediator : undefined; },
      async getServiceType(id: string) { return id === service.id ? service : undefined; },
    } },
    "../services/mediator-profile.service": { mediatorProfileService: {} },
    "../services/mediator-service-approval.service": {
      buildServiceApprovalActionPath() { return "/mediators/mediator-1"; },
      mediatorServiceApprovalService: {
        async manualApprove(actorId: string, input: Record<string, unknown>) {
          calls.push({ actorId, ...input });
          return { id: "approval-1", status: "approved", ...input };
        },
      },
    },
    "../services/email.service": {
      async sendMediatorServiceApprovalDecisionEmail() { throw new Error("manual approval must not email"); },
      async sendMediatorServiceProofRequestEmail() { throw new Error("manual approval must not email"); },
    },
  };
  const module = { exports: {} as any };
  const require = createRequire(routePath);
  runInNewContext(compiledRoute, {
    Buffer,
    URLSearchParams,
    module,
    exports: module.exports,
    process,
    require: (name: string) => dependencies[name] ?? require(name),
  });
  const route = module.exports.default.stack.find(
    (layer: any) => layer.route?.path === "/api/mediators/:id/service-approvals/:serviceTypeId/manual-approve" && layer.route.methods.post,
  ).route;

  return {
    calls,
    async post(body: Record<string, unknown>) {
      let status = 200;
      let responseBody: any;
      const response = {
        status(code: number) { status = code; return response; },
        json(value: unknown) { responseBody = value; return response; },
      };
      await route.stack.at(-1).handle({
        session: { userId: actor.id },
        params: { id: mediator.id, serviceTypeId: service.id },
        body,
      }, response);
      return { status, body: responseBody };
    },
  };
}

test("manual approval route permits Superadmin and Subadmin and rejects every other role", async () => {
  const superadmin = routeHarness("superadmin");
  const accepted = await superadmin.post({ evidenceNote: "Certificate checked against the issuing body's register." });
  assert.equal(accepted.status, 200);
  assert.equal(superadmin.calls.length, 1);
  assert.equal(superadmin.calls[0].evidenceNote, "Certificate checked against the issuing body's register.");

  const subadmin = routeHarness("subadmin");
  const subadminAccepted = await subadmin.post({ evidenceNote: "Certificate checked by subadmin." });
  assert.equal(subadminAccepted.status, 200);
  assert.equal(subadmin.calls.length, 1);

  for (const role of ["mediator", "staff", "client"]) {
    const denied = routeHarness(role);
    const response = await denied.post({ evidenceNote: "Evidence held." });
    assert.equal(response.status, 403, `${role} must be denied`);
    assert.equal(denied.calls.length, 0);
  }
});

test("manual approval route accepts each evidence form independently", async () => {
  const payloads = [
    { evidenceNote: "Original certificate inspected." },
    { proofLink: "https://example.test/register/mediator" },
    {
      proofFileName: "certificate.pdf",
      proofFileData: "data:application/pdf;base64,QQ==",
      proofMimeType: "application/pdf",
    },
  ];
  for (const payload of payloads) {
    const h = routeHarness("superadmin");
    assert.equal((await h.post(payload)).status, 200);
    assert.equal(h.calls.length, 1);
  }
});

test("manual approval route rejects empty, malformed, and expired evidence payloads", async () => {
  for (const payload of [
    {},
    { proofLink: "not-a-url" },
    { proofLink: "ftp://example.test/certificate" },
    { proofFileName: "certificate.pdf" },
    { proofFileName: "certificate.pdf", proofFileData: "not-base64", proofMimeType: "application/pdf" },
    { evidenceNote: "Evidence held.", expiryDate: "2000-01-01" },
    { evidenceNote: "Evidence held.", expiryDate: "2099-02-30" },
  ]) {
    const h = routeHarness("superadmin");
    assert.equal((await h.post(payload)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test("manual approval endpoint permits Superadmin/Subadmin and does not send a decision email", () => {
  const start = routeSource.indexOf("/manual-approve");
  const end = routeSource.indexOf("router.", start + 20);
  const handler = routeSource.slice(start, end < 0 ? undefined : end);

  assert.ok(start >= 0, "manual approval route is registered");
  assert.match(handler, /actor\.actorRole !== "superadmin" && actor\.actorRole !== "subadmin"/);
  assert.match(handler, /manualApprove/);
  assert.doesNotMatch(handler, /sendMediatorServiceApprovalDecisionEmail/);
});

test("manual approval validates new evidence, URL, file pairs, and a non-past expiry", () => {
  assert.match(routeSource, /manualServiceApprovalSchema/);
  assert.match(routeSource, /At least one supporting file, URL, or evidence note is required/);
  assert.match(routeSource, /proofFileName.*proofFileData|proofFileData.*proofFileName/s);
  assert.match(routeSource, /Expiry date cannot be in the past/);
  assert.match(serviceSource, /parsed\.getTime\(\) < Date\.UTC/);
});

test("manual approval persists an approved live-mediator row and its audit metadata", () => {
  const start = serviceSource.indexOf("async manualApprove");
  const end = serviceSource.indexOf("async revoke", start);
  const method = serviceSource.slice(start, end);

  assert.ok(start >= 0, "manualApprove service method exists");
  assert.match(method, /status:\s*"approved"/);
  assert.match(method, /manualApprovalNote/);
  assert.match(method, /reviewedBy:\s*actorId/);
  assert.match(method, /reviewedAt:/);
  assert.match(method, /tx\.insert\(mediatorServiceTypes\)[\s\S]*onConflictDoNothing/);
  assert.match(method, /action:\s*"manual_service_approval"/);
  assert.match(method, /previousStatus/);
  assert.match(method, /evidenceTypes/);
  assert.match(method, /tx\.insert\(notifications\)/);
  assert.match(method, /proofLink:\s*proofLink \?\? lockedExisting\?\.proofLink \?\? null/);
  assert.match(method, /proofFileUrl:\s*filePayload\?\.fileUrl \?\? lockedExisting\?\.proofFileUrl \?\? null/);
  assert.match(method, /expiryDate:\s*input\.expiryDate \?\? null/);
});

test("manual approval rejects already-approved rows and completes stale proof tasks", () => {
  const start = serviceSource.indexOf("async manualApprove");
  const end = serviceSource.indexOf("async revoke", start);
  const method = serviceSource.slice(start, end);

  assert.match(method, /getEffectiveApprovalStatus\(existing\[0\]\) === "approved"/);
  assert.match(method, /status\?: number/);
  assert.match(method, /tx\.update\(tasks\)/);
  assert.match(method, /service_proof_requested/);
  assert.match(method, /service_proof_pending_review/);
  assert.match(method, /completionNotes:\s*"Completed by Superadmin manual service approval\."/);
  assert.doesNotMatch(method, /delete\(/);
});

test("manual approval serializes decisions and commits durable side effects atomically", () => {
  const start = serviceSource.indexOf("async manualApprove");
  const end = serviceSource.indexOf("async revoke", start);
  const method = serviceSource.slice(start, end);

  assert.match(method, /db\.transaction\(async \(tx\)/);
  assert.match(method, /pg_advisory_xact_lock/);
  assert.match(method, /tx\.insert\(auditLogs\)/);
  assert.match(method, /tx\.insert\(notifications\)/);
  assert.match(method, /tx\s*\.update\(notifications\)/);
  assert.match(method, /tx\.update\(tasks\)/);
  assert.match(method, /lockedExisting && getEffectiveApprovalStatus\(lockedExisting\) === "approved"/);
});

test("manual approval metadata is added everywhere and normal lifecycles clear it", () => {
  assert.match(schemaSource, /manualApprovalNote:\s*text\("manual_approval_note"\)/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS manual_approval_note TEXT/i);
  assert.match(bootstrapSource, /ADD COLUMN IF NOT EXISTS manual_approval_note TEXT/i);

  for (const methodName of ["async requestForMediator", "async upsertSubmission", "async review"]) {
    const start = serviceSource.indexOf(methodName);
    const end = serviceSource.indexOf("\n  async ", start + methodName.length);
    assert.match(serviceSource.slice(start, end < 0 ? undefined : end), /manualApprovalNote:\s*null/);
  }
});

test("mediator detail offers a complete manual approval dialog to Superadmins and Subadmins", () => {
  assert.match(detailSource, /button-manual-approve-service-\$\{service\.id\}/);
  assert.match(detailSource, /\(role === "superadmin" \|\| role === "subadmin"\).*!isApproved/s);
  assert.match(detailSource, /Supporting URL/);
  assert.match(detailSource, /Written evidence note/);
  assert.match(detailSource, /Optional expiry date/);
  assert.match(detailSource, /manualApprovalNote/);
  assert.match(detailSource, /reviewedAt/);
  assert.match(detailSource, /queryKey: \["\/api\/mediators"\]/);
  assert.match(detailSource, /queryKey: \["\/api\/mediator-service-types"\]/);
});

test("runbook documents the live-mediator manual approval policy", () => {
  assert.match(docsSource, /manual service approval/i);
  assert.match(docsSource, /Superadmin-only/i);
  assert.match(docsSource, /in-app only/i);
});
