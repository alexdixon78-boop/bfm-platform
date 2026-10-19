import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("notification inbox exposes history, per-user read controls, and task conversion contracts", async () => {
  const [routes, service, bell, layout] = await Promise.all([
    read("../server/routes/notification.routes.ts"),
    read("../server/services/notification.service.ts"),
    read("../client/src/components/notifications/notification-bell.tsx"),
    read("../client/src/components/layout/dashboard-layout.tsx"),
  ]);
  assert.match(routes, /get\("\/api\/notifications\/inbox"/);
  assert.match(routes, /post\("\/api\/notifications\/:id\/unread"/);
  assert.match(routes, /post\("\/api\/notifications\/:id\/create-task"/);
  assert.match(service, /listInbox/);
  assert.match(service, /markUnread/);
  assert.match(service, /createTaskFromNotification/);
  assert.match(bell, /View all/);
  assert.match(bell, /\/notifications/);
  assert.match(layout, /path="\/notifications"/);
});

test("notification inbox provides the workspace triage controls", async () => {
  const [page, routes, service] = await Promise.all([
    read("../client/src/pages/notifications.tsx"),
    read("../server/routes/notification.routes.ts"),
    read("../server/services/notification.service.ts"),
  ]);

  assert.match(page, /data-testid="notifications-quick-filters"/);
  assert.match(page, /Mark all read/);
  assert.match(page, /Clear filters/);
  assert.match(page, /DropdownMenu/);
  assert.match(page, /Previous/);
  assert.match(page, /Next/);
  assert.match(page, /canCreateTask/);
  assert.match(routes, /createdFrom/);
  assert.match(routes, /caseId/);
  assert.match(service, /totalPages/);
  assert.match(service, /linkedRecord/);
});

test("notification rows use task-style priority stripes without unread colour treatment", async () => {
  const page = await read("../client/src/pages/notifications.tsx");

  assert.match(page, /border: "border-l-red-500"/);
  assert.match(page, /border: "border-l-amber-500"/);
  assert.match(page, /border: "border-l-green-500"/);
  assert.match(page, /"group relative border-l-4\b/);
  assert.doesNotMatch(page, /bg-primary\/\[0\.03\]/);
  assert.doesNotMatch(page, /block h-2\.5 w-2\.5 rounded-full/);
});
