import { storage } from "../storage";
import type { CaseActivity, InsertCaseActivity } from "@shared/schema";
import { caseCommunicationLogService } from "./case-communication-log.service";

export type ActorType = "staff" | "client" | "mediator" | "system";

export interface Actor {
  id?: string | null;
  name: string;
  type: ActorType;
  channel?: string | null;
}

export function staffActor(user: { id: string; name: string; role?: string | null }): Actor {
  const type: ActorType = user.role === "mediator" ? "mediator" : "staff";
  return { id: user.id, name: user.name, type };
}

export function mediatorActor(user: { id: string; name: string }): Actor {
  return { id: user.id, name: user.name, type: "mediator" };
}

export function clientActor(
  party: { id: string; firstName?: string | null; lastName?: string | null; role?: string | null },
  channel?: string,
): Actor {
  const fullName = `${party.firstName || ""} ${party.lastName || ""}`.trim() || "Client";
  const label = party.role ? `${fullName} (Client ${party.role})` : fullName;
  return { id: party.id, name: label, type: "client", channel };
}

export function systemActor(channel?: string): Actor {
  return { name: "System", type: "system", channel };
}

class CaseActivityService {
  async log(
    data: Omit<InsertCaseActivity, "occurredAt"> & { occurredAt?: Date; actor?: Actor },
  ): Promise<CaseActivity | null> {
    try {
      const { actor, ...rest } = data;
      const insert: InsertCaseActivity = {
        ...rest,
        occurredAt: data.occurredAt || new Date(),
      };
      if (actor) {
        insert.performedBy = actor.id ?? null;
        insert.performedByName = actor.name;
        insert.actorType = actor.type;
        insert.actorChannel = actor.channel ?? null;
      } else if (insert.performedByName && !insert.actorType) {
        insert.actorType = insert.performedBy ? "staff" : "system";
      } else if (!insert.actorType) {
        insert.actorType = "system";
        if (!insert.performedByName) insert.performedByName = "System";
      }
      return await storage.createCaseActivity(insert);
    } catch (err) {
      console.error("[CaseActivity] Failed to log activity:", err);
      return null;
    }
  }

  async listByCase(caseId: string, limit = 50, offset = 0) {
    return storage.listCaseActivities(caseId, limit, offset);
  }

  async logEnquiryCreated(caseId: string, enquiryRef: string, clientName: string, actor: Actor) {
    return this.log({
      caseId,
      type: "enquiry_created",
      title: "Enquiry received",
      description: `Enquiry ${enquiryRef} received from ${clientName}`,
      relatedEntityType: "enquiry",
      metadata: JSON.stringify({ enquiryRef }),
      actor,
    });
  }

  async logCaseCreated(caseId: string, caseRef: string, enquiryRef: string, actor: Actor) {
    return this.log({
      caseId,
      type: "case_created",
      title: "Case created",
      description: `Case ${caseRef} created from enquiry ${enquiryRef}`,
      relatedEntityType: "case",
      metadata: JSON.stringify({ caseRef, enquiryRef }),
      actor,
    });
  }

  async logAppointmentEvent(
    caseId: string,
    appointmentId: string,
    type: "appointment_hold" | "appointment_held" | "appointment_confirmed" | "appointment_cancelled" | "appointment_expired" | "appointment_completed",
    serviceTypeName: string,
    clientName: string,
    dateTime: Date,
    mediatorName: string | undefined,
    actor: Actor,
  ) {
    const labels: Record<string, string> = {
      appointment_hold: "Payment hold created",
      appointment_held: "Payment hold created",
      appointment_confirmed: "Appointment confirmed",
      appointment_cancelled: "Appointment cancelled",
      appointment_expired: "Appointment expired",
      appointment_completed: "Appointment completed",
    };
    const dateStr = dateTime.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const timeStr = dateTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    return this.log({
      caseId,
      type,
      title: labels[type] || type,
      description: `${serviceTypeName} for ${clientName} on ${dateStr} at ${timeStr}${mediatorName ? ` with ${mediatorName}` : ""}`,
      relatedEntityId: appointmentId,
      relatedEntityType: "appointment",
      metadata: JSON.stringify({ serviceTypeName, clientName, dateTime: dateTime.toISOString(), mediatorName }),
      actor,
    });
  }

  async logEmailSent(
    caseId: string,
    recipientEmail: string,
    subject: string,
    recipientName: string | undefined,
    actor: Actor,
  ) {
    const activity = await this.log({
      caseId,
      type: "email_sent",
      title: "Email sent",
      description: `Email sent to ${recipientName || recipientEmail}: ${subject}`,
      direction: "outbound",
      relatedEntityType: "email",
      metadata: JSON.stringify({ recipientEmail, subject }),
      actor,
    });
    await caseCommunicationLogService.record({
      caseId,
      recipientType: "client",
      recipientName,
      recipientEmail,
      channel: "email",
      direction: "outbound",
      trigger: "automated_email",
      subject,
      sentAt: activity?.occurredAt || new Date(),
      deliveryStatus: "sent",
      sourceEntityType: "case_activity",
      sourceEntityId: activity?.id || undefined,
      actorType: actor.type,
      actorId: actor.id || null,
      actorName: actor.name,
      preview: subject,
      metadata: { recipientEmail, subject },
    });
    return activity;
  }

  async logNoteAdded(caseId: string, category: string, actor: Actor) {
    return this.log({
      caseId,
      type: "note_added",
      title: "Confidential note added",
      description: `${category} note added by ${actor.name}`,
      relatedEntityType: "note",
      metadata: JSON.stringify({ category }),
      actor,
    });
  }

  async logStageChanged(caseId: string, caseRef: string, previousStage: string, newStage: string, actor: Actor) {
    return this.log({
      caseId,
      type: "stage_changed",
      title: "Stage updated",
      description: `Stage changed from "${previousStage}" to "${newStage}"`,
      relatedEntityType: "case",
      metadata: JSON.stringify({ previousStage, newStage, caseRef }),
      actor,
    });
  }

  async logTaskCreated(caseId: string, taskTitle: string, urgency: string, actor: Actor) {
    return this.log({
      caseId,
      type: "task_created",
      title: "Task created",
      description: `Task "${taskTitle}" created with ${urgency} urgency`,
      relatedEntityType: "task",
      metadata: JSON.stringify({ taskTitle, urgency }),
      actor,
    });
  }

  async logTaskAssigned(caseId: string, taskTitle: string, assigneeName: string, actor: Actor) {
    return this.log({
      caseId,
      type: "task_assigned",
      title: "Task assigned",
      description: `Task "${taskTitle}" assigned to ${assigneeName}`,
      relatedEntityType: "task",
      metadata: JSON.stringify({ taskTitle, assigneeName }),
      actor,
    });
  }

  async logTaskStatusChanged(caseId: string, taskTitle: string, previousStatus: string, newStatus: string, actor: Actor) {
    return this.log({
      caseId,
      type: "task_status_changed",
      title: "Task status changed",
      description: `Task "${taskTitle}" moved from ${previousStatus} to ${newStatus}`,
      relatedEntityType: "task",
      metadata: JSON.stringify({ taskTitle, previousStatus, newStatus }),
      actor,
    });
  }

  async logTaskCompleted(caseId: string, taskTitle: string, outcome: string, actor: Actor) {
    return this.log({
      caseId,
      type: "task_completed",
      title: "Task completed",
      description: `Task "${taskTitle}" completed: ${outcome}`,
      relatedEntityType: "task",
      metadata: JSON.stringify({ taskTitle, outcome }),
      actor,
    });
  }

  async logFollowUpEscalated(caseId: string, taskTitle: string, followUpDate: Date) {
    const dateStr = followUpDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return this.log({
      caseId,
      type: "task_status_changed",
      title: "Task follow-up escalated",
      description: `Task "${taskTitle}" follow-up date (${dateStr}) reached — escalated to active with red urgency`,
      relatedEntityType: "task",
      metadata: JSON.stringify({ taskTitle, followUpDate: followUpDate.toISOString(), escalatedTo: "active", newUrgency: "red" }),
      actor: systemActor("auto-escalation"),
    });
  }

  async logCommunication(data: {
    caseId: string;
    type: "call_logged" | "whatsapp_logged" | "email_sent";
    direction: "inbound" | "outbound";
    summary: string;
    contactName?: string;
    occurredAt?: Date;
    actor: Actor;
  }) {
    const labels: Record<string, string> = {
      call_logged: "Phone call",
      whatsapp_logged: "WhatsApp message",
      email_sent: "Email",
    };
    const activity = await this.log({
      caseId: data.caseId,
      type: data.type,
      title: `${labels[data.type] || data.type} (${data.direction})`,
      description: data.summary,
      direction: data.direction,
      occurredAt: data.occurredAt || new Date(),
      metadata: JSON.stringify({ contactName: data.contactName, direction: data.direction }),
      actor: data.actor,
    });
    await caseCommunicationLogService.record({
      caseId: data.caseId,
      recipientName: data.contactName,
      channel: data.type === "email_sent" ? "email" : data.type === "whatsapp_logged" ? "whatsapp" : "phone",
      direction: data.direction,
      trigger: "manual",
      sentAt: activity?.occurredAt || data.occurredAt || new Date(),
      deliveryStatus: "manual",
      sourceEntityType: "case_activity",
      sourceEntityId: activity?.id || undefined,
      actorType: data.actor.type,
      actorId: data.actor.id || null,
      actorName: data.actor.name,
      preview: data.summary,
      metadata: { contactName: data.contactName, direction: data.direction },
    });
    return activity;
  }
}

export const caseActivityService = new CaseActivityService();
