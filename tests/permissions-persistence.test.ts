/**
 * Source-level regression checks for permission persistence and propagation.
 *
 * Run with: npx tsx tests/permissions-persistence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const repository = read("../server/repositories/permission.repository.ts");
const service = read("../server/services/permission.service.ts");
const route = read("../server/routes/permission.routes.ts");
const realtime = read("../server/services/notification-realtime.service.ts");
const seed = read("../server/seed.ts");
const migration = read("../migrations/0042_repair_permission_defaults.sql");

test("permission repository performs one conflict-aware bulk upsert", () => {
  assert.match(repository, /insert\(permissions\)\.values\(entries\)/);
  assert.match(repository, /onConflictDoUpdate/);
  assert.doesNotMatch(repository, /for \(const entry of entries\)/);
  assert.doesNotMatch(repository, /db\.select\(\).*entry/);
});

test("permission service merges stored rows with the canonical defaults", () => {
  assert.match(service, /mergeCanonicalPermissions\(dbPerms/);
  assert.match(service, /actualChanges/);
  assert.match(service, /affectedRoles/);
});

test("permission update endpoint is superadmin-only, validates updates, audits changes and broadcasts roles", () => {
  assert.match(route, /router\.put\("\/api\/permissions", requireAuth/);
  assert.match(route, /actor\.role !== "superadmin"/);
  assert.match(route, /validatePermissionUpdates/);
  assert.match(route, /changes/);
  assert.match(route, /broadcastPermissionsUpdated\(affectedRoles\)/);
  assert.match(route, /return res\.json\(permissions\)/);
});

test("authenticated websocket supports role-targeted permission updates", () => {
  assert.match(realtime, /type: "permissions_updated"; roles: Role\[\]/);
  assert.match(realtime, /broadcastPermissionsUpdated\(roles: Role\[\]\)/);
  assert.match(realtime, /roles\.includes\(user\.role as Role\)/);
});

test("bootstrap and migration repair missing defaults without overwriting configured values", () => {
  assert.match(seed, /insert\(permissions\)[\s\S]*?\.values\(DEFAULT_PERMISSIONS\)/);
  assert.match(seed, /onConflictDoNothing/);
  assert.doesNotMatch(seed, /for \(const permission of DEFAULT_PERMISSIONS\)/);
  assert.match(migration, /ON CONFLICT \(role, section\) DO NOTHING/i);
  assert.match(migration, /court_forms/);
});
