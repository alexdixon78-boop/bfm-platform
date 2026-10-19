import { notificationService } from "./notification.service";
import { caseActivityService, systemActor } from "./case-activity.service";
import { storage } from "../storage";

class WhatsappNotificationService {
  async notifyPrivateNoteAudience(caseId: string) {
    const [caseRecord, parties, sessions] = await Promise.all([storage.getCase(caseId), storage.listPartiesByCase(caseId), storage.listMediationSessionsByCase(caseId)]);
    const participants = await storage.listMediationSessionParticipantsBySessionIds(sessions.map((session) => session.id));
    const leadIds = new Set<string>();
    if (caseRecord?.mediatorId) leadIds.add(caseRecord.mediatorId);
    for (const party of parties) if (party.allocatedMediatorId) leadIds.add(party.allocatedMediatorId);
    for (const session of sessions) if (session.leadMediatorId) leadIds.add(session.leadMediatorId);
    for (const participant of participants) if (participant.role === "lead_mediator" && participant.invitationStatus === "accepted") leadIds.add(participant.userId);
    await notificationService.createNotification({ recipientRole: "admin", assignedUserIds: Array.from(leadIds), title: "Private WhatsApp note received", message: "A private WhatsApp note is available in the case Private Notes area.", type: "whatsapp", urgency: "amber", status: "active", caseId, caseNoteRequired: false });
  }
  async notifyStaffInbound(conversationId: string, summary: string, caseId?: string | null) {
    await notificationService.createNotification({
      recipientRole: "admin",
      title: "WhatsApp message received",
      message: summary,
      type: "whatsapp",
      urgency: "amber",
      status: "active",
      caseId: caseId || null,
      caseNoteRequired: false,
    });
  }

  async logCaseNote(caseId: string, summary: string, contactName?: string | null) {
    await caseActivityService.logCommunication({
      caseId,
      type: "whatsapp_logged",
      direction: "inbound",
      summary,
      contactName: contactName || undefined,
      actor: systemActor("whatsapp"),
    });
  }
}

export const whatsappNotificationService = new WhatsappNotificationService();
