/**
 * E2E integration test: Task delete (Task #154)
 *
 * Tests:
 *   - Superadmin creates throwaway tasks, deletes single (DELETE /api/tasks/:id)
 *   - Superadmin creates throwaway tasks, bulk-deletes (POST /api/tasks/bulk-delete)
 *   - Validation: 400 on empty ids, 400 with missingIds on unknown ids, 404 on unknown single
 *   - Audit log records delete_task for each deleted task
 *   - Non-superadmin (subadmin) gets 403 on both endpoints
 *   - Cleanup: any leftover test tasks are removed at the end
 *
 * Run against the local dev server (npm run dev must be running):
 *   npx tsx tests/e2e/task-delete.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const TEST_TAG = "e2e-task-delete-test";

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.ok, true, `Login failed (${email}): ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "Expected session cookie on login response");
  const match = setCookie.match(/connect\.sid=([^;]+)/);
  assert.ok(match, "Expected connect.sid cookie");
  return `connect.sid=${decodeURIComponent(match[1])}`;
}

async function api(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

type TaskItem = { id: string; title: string; status: string; recipientId?: string; recipientRole?: string; assignedTo?: string | null };

async function createTask(cookie: string, suffix: string): Promise<TaskItem> {
  const r = await api("POST", "/api/tasks", cookie, {
    title: `${TEST_TAG} ${suffix}`,
    message: `Throwaway task for E2E delete test (${suffix})`,
    urgency: "green",
    recipientRole: "admin",
  });
  assert.equal(r.status, 201, `Failed to create task (${suffix}): ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as TaskItem;
}

async function cleanupTestTasks(cookie: string): Promise<void> {
  const r = await api("GET", "/api/tasks", cookie);
  if (r.status !== 200) return;
  const list = Array.isArray(r.body) ? r.body as TaskItem[] : [];
  const testIds = list.filter(t => t.title.startsWith(TEST_TAG)).map(t => t.id);
  if (testIds.length > 0) {
    await api("POST", "/api/tasks/bulk-delete", cookie, { ids: testIds });
  }
}

test("Task delete — full lifecycle with throwaway tasks", { concurrency: false }, async (t) => {
  const superCookie = await login("rebecca@brighterfuturemediation.co.uk", "admin123");

  // Clean up any leftover test tasks from previous aborted runs
  await cleanupTestTasks(superCookie);

  // Create throwaway tasks for this test run
  const task1 = await createTask(superCookie, "single-delete");
  const task2 = await createTask(superCookie, "bulk-delete-A");
  const task3 = await createTask(superCookie, "bulk-delete-B");

  await t.test("created throwaway tasks are visible in /api/tasks before deletion", async () => {
    const r = await api("GET", "/api/tasks", superCookie);
    assert.equal(r.status, 200, `GET /api/tasks failed: ${r.status}`);
    const list = Array.isArray(r.body) ? r.body as TaskItem[] : [];
    const visibleIds = new Set(list.map(t => t.id));
    for (const task of [task1, task2, task3]) {
      assert.ok(visibleIds.has(task.id), `Task "${task.title}" (${task.id}) should be visible in task list before deletion`);
    }
  });

  await t.test("superadmin can delete a single task", async () => {
    const r = await api("DELETE", `/api/tasks/${task1.id}`, superCookie);
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { deleted: boolean; id: string };
    assert.equal(body.deleted, true, "Expected deleted:true");
    assert.equal(body.id, task1.id, "Returned id should match the deleted task");
  });

  await t.test("deleted task no longer appears in task list", async () => {
    const r = await api("GET", "/api/tasks", superCookie);
    assert.equal(r.status, 200);
    const list = Array.isArray(r.body) ? r.body as TaskItem[] : [];
    assert.ok(!list.some(t => t.id === task1.id), "Deleted task should not appear in list");
  });

  await t.test("delete of non-existent task returns 404", async () => {
    const r = await api("DELETE", "/api/tasks/nonexistent-task-id-xyz", superCookie);
    assert.equal(r.status, 404, `Expected 404, got ${r.status}`);
  });

  await t.test("bulk-delete with empty ids array returns 400", async () => {
    const r = await api("POST", "/api/tasks/bulk-delete", superCookie, { ids: [] });
    assert.equal(r.status, 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await t.test("bulk-delete with non-existent id returns 400 with missingIds", async () => {
    const r = await api("POST", "/api/tasks/bulk-delete", superCookie, { ids: ["nonexistent-xyz-abc"] });
    assert.equal(r.status, 400, `Expected 400 for missing IDs, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { missingIds: string[] };
    assert.ok(Array.isArray(body.missingIds) && body.missingIds.includes("nonexistent-xyz-abc"), "Expected missingIds to include the bad ID");
  });

  await t.test("audit log records delete_task for the single-deleted task", async () => {
    const r = await api("GET", "/api/audit-logs?page=1&limit=100", superCookie);
    assert.equal(r.status, 200, `Audit log endpoint failed: ${r.status}`);
    type LogEntry = { action: string; entityId: string; details?: string };
    type AuditBody = LogEntry[] | { data: LogEntry[] };
    const body = r.body as AuditBody;
    const logs: LogEntry[] = Array.isArray(body) ? body : (body as { data: LogEntry[] }).data ?? [];
    const entry = logs.find(l => l.action === "delete_task" && l.entityId === task1.id);
    assert.ok(entry, `Expected delete_task audit entry for task ${task1.id} ("${task1.title}"), recent actions: ${logs.slice(0, 5).map(l => l.action).join(", ")}`);
    // Verify audit snapshot contains recipient context
    if (entry.details) {
      const snapshot = JSON.parse(entry.details);
      assert.ok("title" in snapshot, "Audit snapshot should include title");
      assert.ok("recipientRole" in snapshot, "Audit snapshot should include recipientRole");
    }
  });

  await t.test("superadmin can bulk-delete multiple tasks", async () => {
    const ids = [task2.id, task3.id];
    const r = await api("POST", "/api/tasks/bulk-delete", superCookie, { ids });
    assert.equal(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    const result = r.body as { deleted: number; ids: string[] };
    assert.equal(result.deleted, 2, `Expected 2 deleted, got ${result.deleted}`);
    assert.deepEqual(result.ids.sort(), ids.sort(), "Returned ids should match the deleted ones");
  });

  await t.test("bulk-deleted tasks no longer appear in list", async () => {
    const r = await api("GET", "/api/tasks", superCookie);
    assert.equal(r.status, 200);
    const list = Array.isArray(r.body) ? r.body as TaskItem[] : [];
    const remaining = list.filter(t => t.title.startsWith(TEST_TAG));
    assert.equal(remaining.length, 0, `Expected 0 test tasks remaining, found: ${remaining.map(t => t.title).join(", ")}`);
  });

  await t.test("audit log records delete_task for each bulk-deleted task", async () => {
    const r = await api("GET", "/api/audit-logs?page=1&limit=100", superCookie);
    assert.equal(r.status, 200, `Audit log endpoint failed: ${r.status}`);
    type LogEntry = { action: string; entityId: string };
    type AuditBody = LogEntry[] | { data: LogEntry[] };
    const body = r.body as AuditBody;
    const logs: LogEntry[] = Array.isArray(body) ? body : (body as { data: LogEntry[] }).data ?? [];
    for (const deletedId of [task2.id, task3.id]) {
      const entry = logs.find(l => l.action === "delete_task" && l.entityId === deletedId);
      assert.ok(entry, `Expected delete_task audit entry for task ${deletedId}`);
    }
  });

  await t.test("non-superadmin (subadmin) gets 403 on single and bulk delete", async () => {
    const allUsersRes = await api("GET", "/api/users", superCookie);
    type UserItem = { id: string; role: string; email: string; status: string };
    type UsersBody = UserItem[] | { data: UserItem[] } | { users: UserItem[] };
    const usersBody = allUsersRes.body as UsersBody;
    const users: UserItem[] = Array.isArray(usersBody)
      ? usersBody
      : (usersBody as { data?: UserItem[]; users?: UserItem[] }).data
        ?? (usersBody as { users?: UserItem[] }).users ?? [];

    const subadmin = users.find(u => u.role === "subadmin" && u.status === "active");
    if (!subadmin) {
      console.log("  (skipped: no active subadmin found for 403 test)");
      return;
    }

    const subCookie = await login(subadmin.email, "admin123");

    // Create a temporary task to test 403 against
    const tempTask = await createTask(superCookie, "403-test");

    const rSingle = await api("DELETE", `/api/tasks/${tempTask.id}`, subCookie);
    assert.equal(rSingle.status, 403, `Expected 403 for subadmin single delete, got ${rSingle.status}`);

    const rBulk = await api("POST", "/api/tasks/bulk-delete", subCookie, { ids: [tempTask.id] });
    assert.equal(rBulk.status, 403, `Expected 403 for subadmin bulk delete, got ${rBulk.status}`);

    // Clean up the temp task
    await api("DELETE", `/api/tasks/${tempTask.id}`, superCookie);
  });
});
