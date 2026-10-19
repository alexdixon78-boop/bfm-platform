import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { canChangeTaskStatus, isWorkflowManagedTask } from "../client/src/components/tasks/task-calendar-utils";

test("task queue hides all generic intake status/date mutations and links to its server-derived workflow", () => {
  const source = readFileSync(new URL("../client/src/pages/tasks.tsx", import.meta.url), "utf8");
  for (const taskType of ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up", "enquiry_dynamic_follow_up"]) {
    assert.equal(isWorkflowManagedTask(taskType), true);
    assert.equal(canChangeTaskStatus({
      canViewCases: true,
      canEditCases: true,
      userRole: "superadmin",
      userId: "admin-1",
      assignedUserIds: [],
      taskType,
    }), false);
  }
  assert.match(source, /isIntakeTask && task.actionHref[\s\S]*?href=\{task.actionHref\}[\s\S]*?action-intake-workflow-/);
  assert.match(source, /canChangeStatus && task\.status !== "completed"[\s\S]*?openFollowUpDialog\(task\)/);
});

test("legacy notification completion returns HTTP 409 for invalid intake transitions", async () => {
  const path = new URL("../server/routes/notification.routes.ts", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const require = createRequire(path);
  const dependencies: Record<string, unknown> = {
    "../middleware/auth": { requireAuth() {} },
    "../storage": { storage: { async getUser() { return { id: "admin-1", role: "subadmin" }; } } },
    "../services/notification.service": { notificationService: { async complete() { return { error: "invalid_transition" }; } } },
    "../services/audit-log.service": { logAudit() {} },
  };
  runInNewContext(compiled, { module, exports: module.exports,
    require: (name: string) => dependencies[name] ?? require(name) });
  const route = module.exports.default.stack.find((layer: any) => layer.route?.path === "/api/notifications/:id/complete").route;
  let status = 200;
  let body: any;
  const response = { status(code: number) { status = code; return response; }, json(value: unknown) { body = value; return response; } };
  await route.stack.at(-1).handle({ session: { userId: "admin-1" }, params: { id: "day5" }, body: {} }, response);
  assert.equal(status, 409);
  assert.ok(body.message);
});
