/** Run with: npx tsx --test tests/mediator-login-recovery.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("password reset activates pending invited internal accounts and clears onboarding state", () => {
  const source = read("../server/services/auth.service.ts");
  const resetBlock = source.match(/async resetPassword[\s\S]*?async login/)?.[0] ?? "";

  assert.match(resetBlock, /user\.status === "pending"/);
  assert.match(resetBlock, /role === "mediator"/);
  assert.match(resetBlock, /role === "staff"/);
  assert.match(resetBlock, /role === "subadmin"/);
  assert.match(resetBlock, /role === "contractor"/);
  assert.match(resetBlock, /status:\s*"active"/);
  assert.match(resetBlock, /onboardingToken:\s*null/);
  assert.match(resetBlock, /onboardingTokenExpiresAt:\s*null/);
  assert.match(resetBlock, /resetToken:\s*null/);
  assert.match(resetBlock, /resetExpiresAt:\s*null/);
});

test("onboarding set-password saves the session before responding", () => {
  const source = read("../server/routes/onboarding.routes.ts");
  const setPasswordBlock = source.match(/router\.post\("\/api\/onboarding\/set-password"[\s\S]*?return res\.json/)?.[0] ?? "";

  assert.match(setPasswordBlock, /req\.session\.userId = user\.id/);
  assert.match(setPasswordBlock, /req\.session\.save/);
  assert.ok(
    setPasswordBlock.indexOf("req.session.save") < setPasswordBlock.indexOf("return res.json"),
    "session save must happen before the success response",
  );
});

test("auth and account invite links use the shared APP_URL-aware helper", () => {
  const helper = read("../server/utils/app-url.ts");
  assert.match(helper, /process\.env\.APP_URL/);
  assert.match(helper, /process\.env\.BASE_URL/);
  assert.match(helper, /replace\(\/\\\/\$\/,\s*""\)/);

  const files = [
    "../server/services/auth.service.ts",
    "../server/services/user.service.ts",
    "../server/services/mediator-applicant.service.ts",
    "../server/routes/mediator.routes.ts",
    "../server/routes/contractor.routes.ts",
    "../server/routes/contractor-pipeline.routes.ts",
  ];

  for (const file of files) {
    const source = read(file);
    assert.match(source, /getPublicAppUrl/);
    assert.doesNotMatch(source, /function getBaseUrl/);
  }
});

test("mediator password endpoint is admin-only and clears pending onboarding state", () => {
  const route = read("../server/routes/mediator.routes.ts");
  const service = read("../server/services/user.service.ts");
  const schema = read("../shared/schema.ts");
  const routeBlock = route.match(/router\.post\("\/api\/mediators\/:id\/password"[\s\S]*?\n\}\);/)?.[0] ?? "";

  assert.match(route, /"\/api\/mediators\/:id\/password"/);
  assert.match(routeBlock, /actor\.role !== "superadmin" && actor\.role !== "subadmin"/);
  assert.match(routeBlock, /changeMediatorPassword/);
  assert.match(routeBlock, /action:\s*"password_changed"/);
  assert.match(schema, /"password_changed"/);

  const serviceBlock = service.match(/async changeMediatorPassword[\s\S]*?async deleteMediator/)?.[0] ?? "";
  assert.match(serviceBlock, /password\.length < 8/);
  assert.match(serviceBlock, /password !== confirmPassword/);
  assert.match(serviceBlock, /status:\s*"active"/);
  assert.match(serviceBlock, /onboardingToken:\s*null/);
  assert.match(serviceBlock, /onboardingTokenExpiresAt:\s*null/);
  assert.match(serviceBlock, /return \{ ok: true, success: true \}/);
  assert.match(routeBlock, /return res\.json\(\{ success: true \}\)/);
  assert.doesNotMatch(routeBlock, /return res\.json\([\s\S]*(password|hashPassword)/);
});

test("mediator listing exposes admin-only manual password change UI", () => {
  const page = read("../client/src/pages/mediators.tsx");

  assert.match(page, /canManageMediatorPasswords/);
  assert.match(page, /button-change-password-/);
  assert.match(page, /\/api\/mediators\/\$\{id\}\/password/);
  assert.match(page, /Change mediator password/);
  assert.match(page, /confirmPassword/);
  assert.match(page, /Passwords do not match/);
  assert.match(page, /share this password securely out of band/);
});
