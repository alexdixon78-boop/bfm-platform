import type { Notification } from "@shared/schema";

// Persisted machine marker; UI-facing completion prose is not workflow state.
const SUPERSEDED_MARKER = "[intake-superseded]";
const SUPERSEDED_NOTES = {
  day0: "Superseded by the Day 0 first-contact transition.",
  chase: "Superseded by the current intake chase transition.",
} as const;

export function supersededIntakeTaskUpdate(
  task: Pick<Notification, "message">,
  source: keyof typeof SUPERSEDED_NOTES,
  actorId: string,
  now: Date,
): Partial<Notification> {
  return {
    status: "completed",
    completedBy: actorId,
    completedAt: now,
    completionNotes: SUPERSEDED_NOTES[source],
    message: `${task.message}\n${SUPERSEDED_MARKER}`,
  };
}

export function isSupersededIntakeTask(task: Pick<Notification, "message" | "completionNotes">): boolean {
  if (task.message.includes(SUPERSEDED_MARKER)) return true;
  // Exact legacy values only: rows written before the marker was introduced
  // remain readable without rewriting completed history.
  return Object.values(SUPERSEDED_NOTES).some((notes) => task.completionNotes === notes);
}
