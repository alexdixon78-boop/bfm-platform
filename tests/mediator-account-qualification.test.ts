import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const serviceUrl = new URL("../server/services/user.service.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(serviceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(failProfileWrite = false) {
  let account: Record<string, any> | undefined;
  let profile: Record<string, any> | undefined;
  let transactions = 0;
  const users = { id: "users" };
  const mediatorProfiles = { id: "mediatorProfiles", userId: "userId" };
  const db = {
    async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      transactions++;
      const priorAccount = account && { ...account };
      const priorProfile = profile && { ...profile };
      const tx = {
        insert(table: unknown) { return { values(value: Record<string, any>) { return {
          returning: async () => {
            if (table === users) { account = { id: "mediator-1", ...value }; return [account]; }
            if (failProfileWrite) throw new Error("profile write failed");
            profile = { ...profile, ...value }; return [profile];
          },
          onConflictDoUpdate: async ({ set }: { set: Record<string, any> }) => {
            if (failProfileWrite) throw new Error("profile write failed");
            profile = { ...profile, ...value, ...set };
          },
        }; } }; },
        update(table: unknown) { return { set(value: Record<string, any>) { return { where() { return { async returning() {
          if (table === users) account = { ...account, ...value };
          return [account];
        } }; } }; } }; },
        select() { return { from() { return { async where() { return [account]; } }; } }; },
      };
      try { return await callback(tx); }
      catch (error) { account = priorAccount; profile = priorProfile; throw error; }
    },
  };
  const storage = {
    async getUserByEmail() { return undefined; },
    async getUser() { return account; },
    async createUser(value: Record<string, unknown>) { account = { id: "mediator-1", ...value }; return account; },
    async updateUser(_id: string, value: Record<string, unknown>) { account = { ...account, ...value }; return account; },
  };
  const dependencies: Record<string, unknown> = {
    "../storage": { storage },
    "../utils/helpers": { hashPassword(value: string) { return `hash:${value}`; } },
    "./service-type.service": { serviceTypeService: {} },
    "@shared/schema": { attachMediatorQualifications() {}, MEDIATION_ROLE_QUALIFICATIONS: ["unclassified", "observer", "co_mediator", "lead"], users, mediatorProfiles },
    "../db": { db },
    "drizzle-orm": { eq(a: unknown, b: unknown) { return [a, b]; } },
    "../security/singleton-superadmin-policy": { validateAdminRoleMutation() {} },
    "../repositories/mediator-profile.repository": { mediatorProfileRepository: {} },
    "./email.service": { sendTeamUserInviteEmail() {} },
    "@shared/team-user-invitation": { canSendTeamUserInvite() {} },
  };
  const module = { exports: {} as any };
  const require = createRequire(serviceUrl);
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => dependencies[name] ?? require(name) });
  return {
    service: new module.exports.UserService(),
    seed() { account = { id: "mediator-1", name: "Old", email: "old@example.com", role: "mediator", password: "hash:old" }; profile = { userId: "mediator-1", mediationRoleQualification: "observer" }; },
    get account() { return account; }, get profile() { return profile; }, get transactions() { return transactions; },
  };
}

test("creation requires an explicit valid qualification", async () => {
  const h = harness();
  for (const value of [undefined, "unknown", ""]) {
    const result = await h.service.createMediator({ name: "Alex", email: "alex@example.com", password: "password123", mediationRoleQualification: value });
    assert.equal(result.ok, false);
  }
  assert.equal(h.account, undefined);
});

test("all four qualifications persist with the new mediator account", async () => {
  for (const qualification of ["unclassified", "observer", "co_mediator", "lead"]) {
    const h = harness();
    const result = await h.service.createMediator({ name: "Alex", email: "alex@example.com", password: "password123", mediationRoleQualification: qualification });
    assert.equal(result.ok, true);
    assert.equal(h.profile?.mediationRoleQualification, qualification);
    assert.equal(h.profile?.firstName, "Alex");
    assert.equal(h.transactions, 1);
  }
});

test("profile write failure rolls back a new mediator account", async () => {
  const h = harness(true);
  await assert.rejects(h.service.createMediator({ name: "Alex", email: "alex@example.com", password: "password123", mediationRoleQualification: "lead" }));
  assert.equal(h.account, undefined);
});

test("edit changes qualification atomically and omission preserves it", async () => {
  const h = harness(); h.seed();
  const edited = await h.service.updateMediator("mediator-1", { name: "New", mediationRoleQualification: "lead" });
  assert.equal(edited.ok, true);
  assert.equal(h.account?.name, "New");
  assert.equal(h.profile?.mediationRoleQualification, "lead");
  const omitted = await h.service.updateMediator("mediator-1", { name: "Newest" });
  assert.equal(omitted.ok, true);
  assert.equal(h.profile?.mediationRoleQualification, "lead");
});

test("edit rejects an unknown qualification without changing the mediator", async () => {
  const h = harness(); h.seed();
  const result = await h.service.updateMediator("mediator-1", { name: "New", mediationRoleQualification: "unknown" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(h.account?.name, "Old");
  assert.equal(h.profile?.mediationRoleQualification, "observer");
});

test("failed edit profile write leaves account and qualification unchanged", async () => {
  const h = harness(true); h.seed();
  await assert.rejects(h.service.updateMediator("mediator-1", { name: "New", mediationRoleQualification: "lead" }));
  assert.equal(h.account?.name, "Old");
  assert.equal(h.profile?.mediationRoleQualification, "observer");
});
