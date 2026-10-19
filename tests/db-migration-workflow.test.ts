/**
 * Regression checks for safe Drizzle migration workflow documentation and scripts.
 *
 * Run with: npx tsx tests/db-migration-workflow.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const packageJson = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };
const docs = read("../replit.md");
const generateScript = read("../server/scripts/db-generate.ts");
const migrateScript = read("../server/scripts/db-migrate.ts");
const drizzleConfig = read("../drizzle.config.ts");
const migrationSql = read("../migrations/0000_add_miam_other_fields.sql");
const journal = JSON.parse(read("../migrations/meta/_journal.json")) as {
  entries: Array<{ tag: string }>;
};

test("package exposes logged generate and migrate scripts while retaining local db push", () => {
  assert.equal(
    packageJson.scripts["db:generate"],
    "tsx server/scripts/db-generate.ts",
  );
  assert.equal(
    packageJson.scripts["db:migrate"],
    "tsx server/scripts/db-migrate.ts",
  );
  assert.equal(packageJson.scripts["db:push"], "drizzle-kit push");
});

test("db generate wrapper loads runtime env and forwards optional arguments", () => {
  assert.match(generateScript, /import "dotenv\/config";/);
  assert.match(generateScript, /import \{ loadRuntimeEnv \} from "\.\.\/config\/runtime-env";/);
  assert.ok(
    generateScript.indexOf("await dependencies.loadRuntimeEnv()") <
      generateScript.indexOf('await dependencies.runChildCommand("drizzle-kit", ["generate", ...extraArgs])'),
    "runtime env should be loaded before drizzle-kit generate reads drizzle.config.ts",
  );
  assert.match(generateScript, /process\.argv\.slice\(2\)/);
  assert.match(generateScript, /runLoggedTask\("DbGenerate"/);
  assert.match(drizzleConfig, /use `npm run db:generate`/i);
});

test("db migrate wrapper loads runtime env before invoking drizzle-kit", () => {
  assert.match(migrateScript, /import "dotenv\/config";/);
  assert.match(migrateScript, /import \{ loadRuntimeEnv \} from "\.\.\/config\/runtime-env";/);
  assert.match(migrateScript, /validateMigrationJournal/);
  assert.ok(
    migrateScript.indexOf("await loadRuntimeEnv()") < migrateScript.indexOf('await runChildCommand("drizzle-kit", ["migrate"])'),
    "runtime env should be loaded before drizzle-kit migrate reads drizzle.config.ts",
  );
  assert.ok(
    migrateScript.indexOf("validateMigrationJournal()") < migrateScript.indexOf('await runChildCommand("drizzle-kit", ["migrate"])'),
    "migration journal should be validated before drizzle-kit migrate runs",
  );
  assert.match(migrateScript, /Registered migrations:/);
  assert.match(migrateScript, /Latest registered migration:/);
  assert.match(migrateScript, /Unregistered SQL migration/);
  assert.match(migrateScript, /runLoggedTask\("DbMigrate"/);
  assert.match(migrateScript, /runChildCommand\("drizzle-kit", \["migrate"\]\)/);
  assert.doesNotMatch(migrateScript, /runLoggedChildCommand\("DbMigrate"/);
});

test("docs route production-like schema changes through migrations, not db push", () => {
  assert.match(docs, /use committed migrations/i);
  assert.match(docs, /npm run db:generate/);
  assert.match(docs, /npm run db:migrate/);
  assert.match(docs, /`db:push` is local-only/);
  assert.match(docs, /No, abort/);
  assert.doesNotMatch(docs, /against production before starting\/restarting the web process: `npm run db:push`/);
});

test("first committed migration is additive and limited to MIAM other fields", () => {
  assert.equal(journal.entries[0]?.tag, "0000_add_miam_other_fields");
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS "domestic_abuse_support_services_other" text/);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS "ppc_reason_other" text/);
  assert.doesNotMatch(migrationSql, /\bDROP\b/i);
  assert.doesNotMatch(migrationSql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migrationSql, /\bDELETE\b/i);
  assert.doesNotMatch(migrationSql, /CREATE TABLE/i);
});
