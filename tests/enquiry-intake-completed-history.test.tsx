import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CompletedIntakeFollowUpHistory } from "../client/src/components/intake-completed-follow-up-history";
import type { IntakeActionTask } from "../client/src/components/enquiry-intake-workflow-card-state";

function completed(
  id: string,
  stage: "day5" | "day10" | "weekly",
  completedAt: string,
  overrides: Partial<IntakeActionTask> = {},
): IntakeActionTask {
  return {
    id,
    type: stage === "weekly" ? "enquiry_persistent_follow_up" : "enquiry_chase",
    stage,
    title: stage === "day5" ? "Day 5 chase" : stage === "day10" ? "Day 10 chase" : "Ongoing enquiry follow-up",
    status: "completed",
    completedAt,
    createdAt: completedAt,
    completedByName: "Sub Admin",
    contactMethod: "Direct email",
    outcomeNotes: `${stage} outcome`,
    ...overrides,
  };
}

test("the latest completion is visible and all completed follow-ups are available in a collapsible history", () => {
  const html = renderToStaticMarkup(React.createElement(CompletedIntakeFollowUpHistory, {
    tasks: [
      completed("day5", "day5", "2026-10-05T09:00:00Z"),
      completed("day10", "day10", "2026-10-07T10:00:00Z", { completedByName: "Admin Two" }),
      completed("weekly", "weekly", "2026-10-08T11:00:00Z"),
    ],
    onViewFullHistory: () => undefined,
  }));

  assert.match(html, /Latest completed follow-up/);
  assert.match(html, /Weekly follow-up/);
  assert.match(html, /Show all completed follow-ups \(3\)/);
  assert.match(html, /<details/);
  assert.match(html, /Day 5 follow-up/);
  assert.match(html, /Day 10 follow-up/);
  assert.match(html, /Completed by:<\/span> Sub Admin/);
  assert.match(html, /Contact method:<\/span> Direct email/);
  assert.match(html, /day10 outcome/);
  assert.match(html, /View full chase history/);
});

test("superseded completions are not rendered", () => {
  const html = renderToStaticMarkup(React.createElement(CompletedIntakeFollowUpHistory, {
    tasks: [
      completed("valid", "day5", "2026-10-05T09:00:00Z"),
      completed("superseded", "day10", "2026-10-06T09:00:00Z", {
        superseded: true,
        outcomeNotes: "Must not be shown",
      }),
    ],
  }));

  assert.match(html, /Show all completed follow-ups \(1\)/);
  assert.doesNotMatch(html, /Must not be shown/);
});

test("no completed follow-up renders no history block", () => {
  const html = renderToStaticMarkup(React.createElement(CompletedIntakeFollowUpHistory, {
    tasks: [{
      id: "day10-open",
      type: "enquiry_chase",
      stage: "day10",
      title: "Day 10 chase",
      status: "active",
    }],
  }));

  assert.equal(html, "");
});
