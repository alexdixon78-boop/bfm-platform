import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const routePath = new URL("../server/routes/notification.routes.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(routePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(input: {
  canViewCases: boolean;
  canEditCases: boolean;
  assignedUserIds?: string[];
  taskType?: string;
}) {
  const user = { id: "staff-1", role: "staff", name: "Staff One", status: "active" };
  const task = {
    id: "task-1",
    type: input.taskType ?? "task",
    audience: "internal",
    status: "active",
    assignedUserIds: input.assignedUserIds ?? [user.id],
    schedule: null,
  };
  const updates: Array<Record<string, unknown>> = [];
  const dependencies: Record<string, unknown> = {
    "../middleware/auth": { requireAuth() {} },
    "../middleware/permissions": { requirePermission() { return () => {}; } },
    "../storage": { storage: { async getUser() { return user; } } },
    "../db": { db: {} },
    "../services/notification.service": { notificationService: {
      async updateTask(_id: string, _user: unknown, update: Record<string, unknown>) {
        updates.push(update);
        return { notification: { ...task, ...update } };
      },
    } },
    "../services/task.service": { taskService: { async getVisible() { return task; } } },
    "../services/permission.service": { permissionService: { async getPermissions() {
      return [{
        role: "staff",
        section: "cases",
        canView: input.canViewCases,
        canEdit: input.canEditCases,
      }];
    } } },
    "../services/task-calendar.service": { taskCalendarService: {} },
    "../services/manual-task-case.service": { caseTaskOptions() {}, searchTaskCases() {} },
    "../services/manual-task.service": { createManualTasks() {}, createTaskSeries() {}, editManualTask() {}, replaceFutureTaskSeries() {}, stopTaskSeries() {} },
    "../services/audit-log.service": { logAudit() {} },
  };
  const module = { exports: {} as any };
  const require = createRequire(routePath);
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => dependencies[name] ?? require(name),
  });
  const route = module.exports.default.stack.find(
    (layer: any) => layer.route?.path === "/api/tasks/:id" && layer.route.methods.patch,
  ).route;

  return {
    updates,
    async patch(body: Record<string, unknown>) {
      let status = 200;
      let responseBody: any;
      const response = {
        status(code: number) { status = code; return response; },
        json(value: unknown) { responseBody = value; return response; },
      };
      await route.stack.at(-1).handle({
        session: { userId: user.id },
        params: { id: task.id },
        body,
      }, response);
      return { status, body: responseBody };
    },
  };
}

test("assigned view-only staff can update task progress", async () => {
  const h = harness({ canViewCases: true, canEditCases: false });
  const response = await h.patch({ status: "in_progress" });
  assert.equal(response.status, 200);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].status, "in_progress");
  assert.equal(h.updates[0].assignedUserIds, undefined);
});

test("view-only staff cannot combine progress with assignment or schedule changes", async () => {
  for (const body of [
    { status: "in_progress", assignedUserIds: ["staff-1"] },
    { status: "in_progress", schedule: { kind: "all_day" } },
  ]) {
    const h = harness({ canViewCases: true, canEditCases: false });
    const response = await h.patch(body);
    assert.equal(response.status, 403);
    assert.deepEqual(h.updates, []);
  }
});

test("view-only staff cannot update tasks they do not own or access", async () => {
  for (const input of [
    { canViewCases: true, canEditCases: false, assignedUserIds: ["staff-2"] },
    { canViewCases: false, canEditCases: false, assignedUserIds: ["staff-1"] },
  ]) {
    const h = harness(input);
    const response = await h.patch({ status: "in_progress" });
    assert.equal(response.status, 403);
    assert.deepEqual(h.updates, []);
  }
});

test("view-only staff cannot bypass workflow-owned intake follow-up dates", async () => {
  const h = harness({
    canViewCases: true,
    canEditCases: false,
    taskType: "enquiry_chase",
  });
  const response = await h.patch({ followUpDate: "2031-12-01T00:00:00.000Z" });
  assert.equal(response.status, 403);
  assert.deepEqual(h.updates, []);
});
