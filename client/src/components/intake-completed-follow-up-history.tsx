import React from "react";
import type { IntakeActionTask } from "./enquiry-intake-workflow-card-state";
import { selectCompletedIntakeFollowUps } from "./enquiry-intake-workflow-card-state";

function stageLabel(task: IntakeActionTask): string {
  if (task.stage === "weekly" || task.type === "enquiry_persistent_follow_up") return "Weekly follow-up";
  if (task.stage === "day10" || `${task.title} ${task.message || ""}`.toLowerCase().includes("day 10")) return "Day 10 follow-up";
  return "Day 5 follow-up";
}

function formatCompletedAt(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CompletedFollowUp({ task, latest = false }: { task: IntakeActionTask; latest?: boolean }) {
  const completedAt = formatCompletedAt(task.completedAt);
  return (
    <div
      className={latest ? "rounded-md border border-[#a7baa4]/60 bg-[#a7baa4]/10 px-3 py-3" : "rounded-md border bg-background px-3 py-3"}
      data-testid={latest ? "intake-latest-completed-follow-up" : "intake-completed-follow-up-history-item"}
    >
      {latest && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest completed follow-up</p>}
      <p className={`text-sm font-medium ${latest ? "mt-1" : ""}`}>{stageLabel(task)}</p>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {completedAt && <p><span className="font-medium text-foreground">Completed:</span> {completedAt}</p>}
        {task.completedByName && <p><span className="font-medium text-foreground">Completed by:</span> {task.completedByName}</p>}
        {task.contactMethod && <p><span className="font-medium text-foreground">Contact method:</span> {task.contactMethod}</p>}
        {task.outcomeNotes && <p className="whitespace-pre-wrap"><span className="font-medium text-foreground">Outcome:</span> {task.outcomeNotes}</p>}
      </div>
    </div>
  );
}

export function CompletedIntakeFollowUpHistory({
  tasks,
  onViewFullHistory,
}: {
  tasks: IntakeActionTask[];
  onViewFullHistory?: () => void;
}) {
  const completed = selectCompletedIntakeFollowUps(tasks);
  if (completed.length === 0) return null;

  return (
    <div className="mt-4 space-y-3" data-testid="intake-completed-follow-up-history">
      <CompletedFollowUp task={completed[0]} latest />
      <details className="rounded-md border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-[#5a7d58]">
          Show all completed follow-ups ({completed.length})
        </summary>
        <div className="mt-3 space-y-2" data-testid="intake-all-completed-follow-ups">
          {completed.map((task) => <CompletedFollowUp key={task.id} task={task} />)}
        </div>
      </details>
      {onViewFullHistory && (
        <button type="button" className="text-xs font-medium text-[#5a7d58] underline-offset-4 hover:underline" onClick={onViewFullHistory}>
          View full chase history
        </button>
      )}
    </div>
  );
}
