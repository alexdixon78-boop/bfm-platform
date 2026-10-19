/**
 * Regression checks for keeping server startup fast and DB bootstrap explicit.
 *
 * Run with: npx tsx tests/startup-bootstrap-separation.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("route registration does not run schema bootstrap work", () => {
  const routeIndex = read("../server/routes/index.ts");

  assert.doesNotMatch(routeIndex, /db\.execute/);
  assert.doesNotMatch(routeIndex, /seedDatabase/);
  assert.doesNotMatch(routeIndex, /CREATE TABLE IF NOT EXISTS/);
  assert.match(routeIndex, /app\.use\(authRoutes\)/);
  assert.match(routeIndex, /notificationRealtimeService\.attach\(httpServer,/);
});

test("database bootstrap and seed are explicit package commands", () => {
  const packageSource = read("../package.json");
  const bootstrapSource = read("../server/db-bootstrap.ts");
  const bootstrapScriptSource = read("../server/scripts/db-bootstrap.ts");
  const seedScriptSource = read("../server/scripts/db-seed.ts");
  const sessionSource = read("../server/config/session.ts");

  assert.match(packageSource, /"db:bootstrap": "tsx server\/scripts\/db-bootstrap\.ts"/);
  assert.match(packageSource, /"db:seed": "tsx server\/scripts\/db-seed\.ts"/);
  assert.match(packageSource, /"start": "NODE_ENV=production node dist\/index\.cjs"/);
  assert.match(bootstrapSource, /pg_advisory_lock/);
  assert.match(bootstrapSource, /CREATE TABLE IF NOT EXISTS "session"/);
  assert.match(bootstrapSource, /await seedDatabase\(\)/);
  assert.match(bootstrapSource, /DATABASE_URL is required for db:bootstrap/);
  assert.match(bootstrapScriptSource, /import "dotenv\/config"/);
  assert.match(bootstrapScriptSource, /import \{ loadRuntimeEnv \} from "\.\.\/config\/runtime-env"/);
  assert.match(bootstrapScriptSource, /await loadRuntimeEnv\(\)/);
  assert.match(bootstrapScriptSource, /runLoggedTask\("DbBootstrap"/);
  assert.match(bootstrapScriptSource, /await import\("\.\.\/db-bootstrap"\)/);
  assert.match(seedScriptSource, /import "dotenv\/config"/);
  assert.match(seedScriptSource, /await import\("\.\.\/seed"\)/);
  assert.match(sessionSource, /createTableIfMissing:\s*false/);
});

test("app exposes separate liveness and readiness checks", () => {
  const appSource = read("../server/app.ts");

  assert.match(appSource, /app\.get\("\/healthz"/);
  assert.match(appSource, /app\.get\("\/readyz"/);
  assert.match(appSource, /database_bootstrap_required/);
  assert.match(appSource, /Startup phase/);
});
