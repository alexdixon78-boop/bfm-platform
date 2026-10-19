/** Run with: npx tsx tests/user-invitation-flow.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Users-page accounts are created through secure pending onboarding invitations", () => {
  const service = read("../server/services/user.service.ts");
  const routes = read("../server/routes/user.routes.ts");

  assert.match(service, /status:\s*"pending"/);
  assert.match(service, /onboardingToken:\s*tokenHash/);
  assert.match(service, /onboardingTokenExpiresAt:\s*expiresAt/);
  assert.match(service, /sendTeamUserInviteEmail/);
  assert.match(routes, /"\/api\/users\/:id\/send-invite"/);
});

test("active and pending team accounts can receive onboarding invitations", async () => {
  const { canSendTeamUserInvite } = await import("../shared/team-user-invitation");
  assert.equal(canSendTeamUserInvite({ role: "staff", status: "pending" }), true);
  assert.equal(canSendTeamUserInvite({ role: "staff", status: "active" }), true);
  assert.equal(canSendTeamUserInvite({ role: "subadmin", status: "active" }), true);
  assert.equal(canSendTeamUserInvite({ role: "superadmin", status: "active" }), false);
  assert.equal(canSendTeamUserInvite({ role: "mediator", status: "active" }), false);
  assert.equal(canSendTeamUserInvite({ role: "staff", status: "inactive" }), false);
  assert.equal(canSendTeamUserInvite({ role: "staff", status: "archived" }), false);
});

test("team onboarding completes at the dashboard rather than mediator calendar setup", async () => {
  const { onboardingDestination } = await import("../client/src/lib/onboarding-destination");
  assert.equal(onboardingDestination("staff"), "/dashboard");
  assert.equal(onboardingDestination("subadmin"), "/dashboard");
  assert.equal(onboardingDestination("contractor"), "/contractor-home");
  assert.equal(onboardingDestination("mediator"), null);
});

test("team invitation endpoint uses the shared eligibility rule and records the attempt", () => {
  const service = read("../server/services/user.service.ts");
  const routes = read("../server/routes/user.routes.ts");

  assert.match(service, /canSendTeamUserInvite\(target\)/);
  assert.match(routes, /action:\s*"invite_sent"/);
});

test("the user table exposes invitation state and keeps the superadmin role immutable", () => {
  const page = read("../client/src/pages/users.tsx");

  assert.match(page, /status:\s*string/);
  assert.match(page, /Activation status/);
  assert.match(page, /button-resend-invite-/);
  assert.match(page, /canSendTeamUserInvite\(u\)/);
  assert.match(page, /editingUser\?\.role === "superadmin"/);
  assert.match(page, /Superadmin role is fixed/);
});
