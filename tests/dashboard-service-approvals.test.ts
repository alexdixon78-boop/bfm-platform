/**
 * Regression test for the dashboard mediator view:
 * service approvals should be visible even when today's schedule is empty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboardPageSource = readFileSync(new URL("../client/src/pages/dashboard.tsx", import.meta.url), "utf8");

test("dashboard shows a mediator service approvals section", () => {
  assert.match(dashboardPageSource, /Service approvals/);
  assert.match(dashboardPageSource, /\[\"\/api\/mediators\", user\?\.id, \"service-approvals\"\]/);
  assert.match(dashboardPageSource, /Approved - awaiting calendar event/);
  assert.match(dashboardPageSource, /Calendar event captured/);
  assert.match(dashboardPageSource, /Manage in profile/);
});

test("dashboard defines separate mediator login prompts for approval and availability", () => {
  assert.match(dashboardPageSource, /approvalPromptOpen/);
  assert.match(dashboardPageSource, /availabilityPromptOpen/);
  assert.match(dashboardPageSource, /bfm:mediatorApprovalPromptDismissed/);
  assert.match(dashboardPageSource, /bfm:mediatorAvailabilityPromptDismissed/);
  assert.match(dashboardPageSource, /Service approval needed/);
  assert.match(dashboardPageSource, /Availability needed/);
});

test("approval login prompt uses selected non-approved services and excludes pending review", () => {
  assert.match(dashboardPageSource, /servicesNeedingApproval/);
  assert.match(dashboardPageSource, /status === "requested"/);
  assert.match(dashboardPageSource, /status === "rejected"/);
  assert.match(dashboardPageSource, /status === "expired"/);
  assert.match(dashboardPageSource, /status === "not_requested"/);
  assert.match(dashboardPageSource, /servicesPendingReview/);
  assert.match(dashboardPageSource, /status === "pending_review"/);
});

test("availability login prompt uses approved services with no future slots", () => {
  assert.match(dashboardPageSource, /servicesNeedingAvailability/);
  assert.match(dashboardPageSource, /new Date\(slot\.startAt\)\.getTime\(\) >= nowMs/);
  assert.match(dashboardPageSource, /futureSlotsByServiceTypeId/);
  assert.match(dashboardPageSource, /status === "approved"/);
});

test("availability prompt waits for mediator pending tasks and can re-open after one slot is added", () => {
  assert.match(dashboardPageSource, /mediatorPendingTasksModalOpen/);
  assert.match(dashboardPageSource, /if \(mediatorPendingTasksModalOpen\) return/);
  assert.match(dashboardPageSource, /mediatorPendingTasksModalOpen,\s*\n\s*selectedServiceApprovalId/);
  assert.match(dashboardPageSource, /const closeAvailabilityPromptForDrawer = \(\) => \{/);
  assert.match(dashboardPageSource, /setAvailabilityPromptOpen\(false\)/);
  assert.match(dashboardPageSource, /openAvailabilityDrawer[\s\S]*closeAvailabilityPromptForDrawer\(\)[\s\S]*setSelectedServiceApprovalId\(approval\.id\)/);
  assert.doesNotMatch(dashboardPageSource, /openAvailabilityDrawer[\s\S]{0,120}dismissAvailabilityPrompt\(\)/);
});

test("availability prompt dismissal remains explicit session dismissal only", () => {
  assert.match(dashboardPageSource, /const dismissAvailabilityPrompt = \(\) => \{/);
  assert.match(dashboardPageSource, /sessionStorage\.setItem\(AVAILABILITY_PROMPT_DISMISSED_KEY, "1"\)/);
  assert.match(dashboardPageSource, /data-testid="button-dismiss-availability-prompt"/);
});
