import { and, asc, eq, inArray } from "drizzle-orm";
import { auditLogs, caseActivities, caseConfidentialNotes, cases, notificationAssignees, notifications } from "@shared/schema";
import { completeIntakeChaseTransition, type IntakeChaseDependencies, type IntakeChaseInput } from "./intake-chase.transition";
import type { db } from "../db";

/** Injectable persistence boundary also used by the production entry point. */
export function createIntakeChaseDependencies(
  database: Pick<typeof db, "transaction">,
  publish: IntakeChaseDependencies["publish"],
): IntakeChaseDependencies {
  return {
    transaction: (work) => database.transaction(async (tx) => work({
      async lockCaseAndTasks(caseId) {
        // Match Day 0's case lock, then lock task rows too so a concurrent
        // generic task completion is observed before validating this request.
        const [caseRecord] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1).for("update");
        if (!caseRecord) return { caseRecord: undefined, tasks: [] };
        const tasks = await tx.select().from(notifications).where(eq(notifications.caseId, caseId))
          .orderBy(asc(notifications.createdAt), asc(notifications.id)).for("update");
        const assignees = tasks.length ? await tx.select().from(notificationAssignees)
          .where(inArray(notificationAssignees.notificationId, tasks.map((task) => task.id))) : [];
        return { caseRecord, tasks: tasks.map((task) => ({ ...task,
          assignedUserIds: assignees.filter((row) => row.notificationId === task.id).map((row) => row.userId),
        })) };
      },
      async updateTask(id, values) {
        const [updated] = await tx.update(notifications).set(values).where(and(
          eq(notifications.id, id), inArray(notifications.status, ["active", "in_progress", "follow_up"]),
        )).returning();
        if (!updated) throw new Error("Locked intake task is no longer open");
        return updated;
      },
      async createTask(values) {
        const [created] = await tx.insert(notifications).values(values).returning();
        return created;
      },
      async insertAudit(values) { await tx.insert(auditLogs).values(values); },
      async insertActivity(values) { await tx.insert(caseActivities).values(values); },
      async insertNote(values) { await tx.insert(caseConfidentialNotes).values(values); },
    })),
    publish,
  };
}

export async function completeIntakeChase(input: IntakeChaseInput) {
  const { db } = await import("../db");
  const { notificationRealtimeService } = await import("./notification-realtime.service");
  return completeIntakeChaseTransition(input, createIntakeChaseDependencies(db, (task, event) => {
    notificationRealtimeService.broadcastToNotificationAudience(task, event);
  }));
}
