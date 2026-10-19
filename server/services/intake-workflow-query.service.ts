import { and, asc, eq, inArray } from "drizzle-orm";
import { notifications, users } from "@shared/schema";
import { isIntakeAdminRole } from "./intake-access-policy";
import { isSupersededIntakeTask } from "./intake-task-state";

const INTAKE_TASK_TYPES = ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up", "enquiry_dynamic_follow_up"] as const;

export type IntakeWorkflowStage = "day0" | "day5" | "day10" | "weekly" | "dynamic";

export type IntakeWorkflowTaskRow = {
  id: string;
  type: string;
  status: string;
  title: string;
  message: string;
  followUpDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  completedByName: string | null;
  completionNotes: string | null;
  intakeFollowUpIntervalDays?: number | null;
};

export type IntakeWorkflowTaskDto = {
  id: string;
  stage: IntakeWorkflowStage;
  status: string;
  title: string;
  dueAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  completedByName: string | null;
  contactMethod: string | null;
  outcomeNotes: string | null;
  superseded: boolean;
  intervalDays: number | null;
};

export type IntakeWorkflowTaskReader = {
  listRows(caseId: string): Promise<IntakeWorkflowTaskRow[]>;
};

function taskStage(row: Pick<IntakeWorkflowTaskRow, "type" | "title" | "message">): IntakeWorkflowStage | null {
  if (row.type === "enquiry_follow_up") return "day0";
  if (row.type === "enquiry_persistent_follow_up") return "weekly";
  if (row.type === "enquiry_dynamic_follow_up") return "dynamic";
  if (row.type !== "enquiry_chase") return null;
  const text = `${row.title} ${row.message}`.toLowerCase();
  if (text.includes("day 10") || text.includes("day-10")) return "day10";
  if (text.includes("day 5") || text.includes("day-5")) return "day5";
  return null;
}

function parseCompletionNotes(notes: string | null): { contactMethod: string | null; outcomeNotes: string | null } {
  if (!notes?.trim()) return { contactMethod: null, outcomeNotes: null };
  const match = notes.match(/^Contact method:\s*(.+?)(?:\n{2,}([\s\S]*))?$/);
  if (!match) return { contactMethod: null, outcomeNotes: notes.trim() };
  return {
    contactMethod: match[1]?.trim() || null,
    outcomeNotes: match[2]?.trim() || null,
  };
}

export function canReadIntakeWorkflowTasks(
  actor: { id: string; role: string },
  caseRecord: { claimedBy?: string | null },
): boolean {
  if (isIntakeAdminRole(actor.role)) return true;
  return actor.role === "staff" && !!caseRecord.claimedBy && caseRecord.claimedBy === actor.id;
}

async function productionReader(): Promise<IntakeWorkflowTaskReader> {
  const { db } = await import("../db");
  return {
    async listRows(caseId) {
      return db.select({
        id: notifications.id,
        type: notifications.type,
        status: notifications.status,
        title: notifications.title,
        message: notifications.message,
        followUpDate: notifications.followUpDate,
        createdAt: notifications.createdAt,
        completedAt: notifications.completedAt,
        completedBy: notifications.completedBy,
        completedByName: users.name,
        completionNotes: notifications.completionNotes,
        intakeFollowUpIntervalDays: notifications.intakeFollowUpIntervalDays,
      })
        .from(notifications)
        .leftJoin(users, eq(users.id, notifications.completedBy))
        .where(and(
          eq(notifications.caseId, caseId),
          inArray(notifications.type, [...INTAKE_TASK_TYPES]),
        ))
        .orderBy(asc(notifications.createdAt), asc(notifications.id));
    },
  };
}

export async function listIntakeWorkflowTasks(
  caseId: string,
  reader?: IntakeWorkflowTaskReader,
): Promise<IntakeWorkflowTaskDto[]> {
  const rows = await (reader ?? await productionReader()).listRows(caseId);
  return [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .flatMap((row) => {
      const stage = taskStage(row);
      if (!stage) return [];
      const superseded = isSupersededIntakeTask(row);
      const parsed = superseded ? { contactMethod: null, outcomeNotes: null } : parseCompletionNotes(row.completionNotes);
      return [{
        id: row.id,
        stage,
        status: row.status,
        title: row.title,
        dueAt: row.followUpDate,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        completedBy: row.completedBy,
        completedByName: row.completedByName,
        contactMethod: parsed.contactMethod,
        outcomeNotes: parsed.outcomeNotes,
        superseded,
        intervalDays: row.intakeFollowUpIntervalDays ?? null,
      }];
    });
}
