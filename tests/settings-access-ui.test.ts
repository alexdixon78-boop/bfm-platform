/** Run with: npx tsx tests/settings-access-ui.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const settings = read("../client/src/pages/settings.tsx");
const clientNav = read("../client/src/components/layout/client-top-nav.tsx");
const sidebar = read("../client/src/components/layout/app-sidebar.tsx");
const layout = read("../client/src/components/layout/dashboard-layout.tsx");
const bell = read("../client/src/components/notifications/notification-bell.tsx");

test("settings separates configurable internal access from fixed client access", () => {
  assert.match(settings, />Internal Role Access<\/CardTitle>/);
  assert.match(settings, /ACCESS_AREAS\.map/);
  assert.match(settings, /CONFIGURABLE_ROLES\.map/);
  assert.match(settings, />Client Portal Access<\/CardTitle>/);
  assert.match(settings, /Fixed client access[^<]*not configurable/i);
  assert.match(settings, /CLIENT_PORTAL_ACCESS\.map/);
  assert.match(settings, /supportsEdit/);
  assert.match(settings, />N\/A</);
});

test("client navigation is fixed and standalone Documents navigation is gone", () => {
  assert.doesNotMatch(clientNav, /usePermissions/);
  assert.doesNotMatch(clientNav, /url: "\/documents"/);
  assert.match(clientNav, /CLIENT_TABS\.map/);
  assert.doesNotMatch(sidebar, /url: "\/documents"/);
});

test("settings route and sidebar use fixed eligible roles", () => {
  assert.match(layout, /allowedRoles=\{\["superadmin", "subadmin", "mediator"\]\}/);
  assert.match(sidebar, /SETTINGS_ROLES/);
  assert.match(sidebar, /item\.url === "\/settings"/);
});

test("permission websocket events refresh the permission query", () => {
  assert.match(bell, /message\.type === "permissions_updated"/);
  assert.match(bell, /queryKey: \["\/api\/permissions"\]/);
});
