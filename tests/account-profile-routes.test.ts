import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const routePath = new URL("../server/routes/account.routes.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(routePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(role: string) {
  const actor = { id: "self", role, name: "Old Name", email: "self@example.com", password: "stored" };
  const changes: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];
  const dependencies: Record<string, unknown> = {
    "../middleware/auth": { requireAuth(_req: unknown, _res: unknown, next: () => void) { next(); } },
    "../storage": { storage: { async updateUser(_id: string, patch: Record<string, unknown>) { changes.push(patch); Object.assign(actor, patch); } } },
    "../utils/helpers": { verifyPassword(input: string) { return input === "correct"; }, hashPassword(input: string) { return `hashed:${input}`; } },
    "../services/auth.service": { authService: { async getCurrentUser() { return { id: actor.id, name: (actor as any).accountDisplayName || actor.name, avatarUrl: (actor as any).avatarUrl }; } } },
    "../services/audit-log.service": { logAudit() {} },
    "../services/profile-image.service": { async saveProfileImage() { return { fileUrl: "/uploads/profile-images/new.png" }; } },
    "@shared/schema": { mediatorProfileChangeRequests: {}, mediatorProfiles: {} },
    "../db": { db: {
      select() { return { from() { return { async where() { return [{ firstName: "Old", lastName: "Name" }]; } }; } }; },
      insert() { return { async values(value: unknown) { requests.push(value as Record<string, unknown>); } }; },
    } },
    "drizzle-orm": { eq() {} },
  };
  const module = { exports: {} as any };
  const require = createRequire(routePath);
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => dependencies[name] ?? require(name) });
  const router = module.exports.default;
  return {
    actor, changes, requests,
    async call(path: string, method: string, body: unknown) {
      const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route;
      let status = 200;
      let output: any;
      const response = { status(code: number) { status = code; return response; }, json(value: unknown) { output = value; return response; } };
      await route.stack.at(-1).handle({ user: actor, body }, response);
      return { status, output };
    },
  };
}

test("every signed-in role can change only its own account name", async () => {
  for (const role of ["superadmin", "subadmin", "staff", "mediator", "client", "contractor"]) {
    const h = harness(role);
    const response = await h.call("/api/account", "patch", { name: "New Name", id: "another-user" });
    assert.equal(response.status, 400);
    assert.equal(h.changes.length, 0);
    const valid = await h.call("/api/account", "patch", { name: "New Name" });
    assert.equal(valid.status, 200);
    assert.equal(h.changes[0][role === "mediator" ? "accountDisplayName" : "name"], "New Name");
    if (role === "mediator") {
      assert.equal(h.requests.length, 1);
      assert.equal((h.requests[0] as any)[0].field, "firstName");
      assert.equal((h.requests[0] as any).length, 1);
    }
  }
});

test("password change rejects the wrong current password and does not log it", async () => {
  const h = harness("client");
  const wrong = await h.call("/api/account/password", "post", { currentPassword: "wrong", newPassword: "newpass" });
  assert.equal(wrong.status, 403);
  assert.equal(h.changes.length, 0);
  const valid = await h.call("/api/account/password", "post", { currentPassword: "correct", newPassword: "newpass" });
  assert.equal(valid.status, 200);
  assert.equal(h.changes[0].password, "hashed:newpass");
});

test("profile picture updates only the session owner", async () => {
  const h = harness("staff");
  const result = await h.call("/api/account/photo", "post", { imageData: "data:image/png;base64,AA==" });
  assert.equal(result.status, 200);
  assert.equal(h.changes[0].avatarUrl, "/uploads/profile-images/new.png");
});
