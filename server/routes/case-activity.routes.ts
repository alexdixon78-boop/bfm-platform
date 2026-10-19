import { Router, type Request } from "express";
import { requirePermission } from "../middleware/permissions";
import { caseActivityService, staffActor, type ActorType } from "../services/case-activity.service";
import { caseCommunicationLogService } from "../services/case-communication-log.service";
import { storage } from "../storage";
import type { User } from "@shared/schema";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";

interface AuthenticatedRequest extends Request {
  user: User;
}

function getUser(req: Request): User {
  return (req as AuthenticatedRequest).user;
}

const router = Router();

router.get("/api/cases/:id/activities", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const caseId = req.params.id;

  if (user.role === "client") {
    return res.status(403).json({ message: "Not authorised" });
  }

  const access = await classifyCaseAccess(caseId, user);
  if (!hasFullOperationalCaseAccess(access)) {
    return res.status(403).json({ message: "Not authorised" });
  }

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  const result = await caseActivityService.listByCase(caseId, limit, offset);

  const performerIds = new Set<string>();
  for (const row of result.data) {
    if (row.performedBy) performerIds.add(row.performedBy);
  }

  const userRoleMap = new Map<string, string>();
  if (performerIds.size > 0) {
    const lookups = await Promise.all(Array.from(performerIds).map(id => storage.getUser(id)));
    for (const u of lookups) {
      if (u) userRoleMap.set(u.id, u.role);
    }
  }

  function roleToType(role: string | undefined): ActorType | null {
    if (!role) return null;
    if (role === "mediator") return "mediator";
    if (role === "client") return "client";
    if (role === "superadmin" || role === "subadmin") return "staff";
    return null;
  }

  const VALID_ACTOR_TYPES: ReadonlySet<ActorType> = new Set<ActorType>(["staff", "mediator", "client", "system"]);

  function inferActorType(row: typeof result.data[number]): ActorType {
    if (row.actorType && VALID_ACTOR_TYPES.has(row.actorType as ActorType)) {
      return row.actorType as ActorType;
    }
    if (row.performedBy) {
      const role = userRoleMap.get(row.performedBy);
      const fromRole = roleToType(role);
      if (fromRole) return fromRole;
      return "system";
    }
    return "system";
  }

  function specificRoleLabel(type: ActorType, performedBy: string | null): string {
    if (type === "system") return "System";
    if (type === "client") return "Client";
    if (performedBy) {
      const role = userRoleMap.get(performedBy);
      if (role === "superadmin") return "Superadmin";
      if (role === "subadmin") return "Subadmin";
      if (role === "mediator") return "Mediator";
    }
    return type === "mediator" ? "Mediator" : "Staff";
  }

  const hydratedRows = result.data.map(row => {
    const inferred = inferActorType(row);
    return {
      ...row,
      actorType: inferred,
      actorChannel: row.actorChannel ?? null,
      actorRoleLabel: specificRoleLabel(inferred, row.performedBy),
      performedByName: row.performedByName || (inferred === "system" ? "System" : null),
    };
  });

  return res.json({ data: hydratedRows, total: result.total });
});

router.post("/api/cases/:id/activities", requirePermission("cases", "edit"), async (req, res) => {
  const user = getUser(req);
  const caseId = req.params.id;

  if (user.role === "client") {
    return res.status(403).json({ message: "Not authorised" });
  }

  const access = await classifyCaseAccess(caseId, user);
  if (!hasFullOperationalCaseAccess(access)) {
    return res.status(403).json({ message: "Not authorised" });
  }

  const { type, direction, summary, contactName, occurredAt } = req.body;

  const validTypes = ["call_logged", "whatsapp_logged", "email_sent"];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ message: "type must be one of: call_logged, whatsapp_logged, email_sent" });
  }
  if (!direction || !["inbound", "outbound"].includes(direction)) {
    return res.status(400).json({ message: "direction must be inbound or outbound" });
  }
  if (!summary || typeof summary !== "string" || !summary.trim()) {
    return res.status(400).json({ message: "summary is required" });
  }

  let parsedOccurredAt: Date | undefined;
  if (occurredAt) {
    parsedOccurredAt = new Date(occurredAt);
    if (isNaN(parsedOccurredAt.getTime())) {
      return res.status(400).json({ message: "occurredAt must be a valid date" });
    }
  }

  const activity = await caseActivityService.logCommunication({
    caseId,
    type,
    direction,
    summary: summary.trim().slice(0, 2000),
    contactName: contactName?.trim() || undefined,
    occurredAt: parsedOccurredAt,
    actor: staffActor(user),
  });

  await caseCommunicationLogService.recordManualCommunication({
    caseId,
    type,
    direction,
    summary: summary.trim().slice(0, 2000),
    contactName: contactName?.trim() || undefined,
    occurredAt: parsedOccurredAt,
    actor: staffActor(user),
    sourceEntityId: activity?.id || null,
  });

  if (!activity) {
    return res.status(500).json({ message: "Failed to log communication" });
  }

  return res.status(201).json(activity);
});

router.get("/api/cases/:id/key-dates", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const caseId = req.params.id;

  if (user.role === "client") {
    return res.status(403).json({ message: "Not authorised" });
  }

  const access = await classifyCaseAccess(caseId, user);
  if (access.tier === "none" || access.tier === "session_observer") return res.status(403).json({ message: "Not authorised" });

  const [appointments, miamRecords, parties, serviceTypes] = await Promise.all([
    storage.listAppointmentsByCase(caseId),
    storage.listMiamRecordsByCase(caseId),
    storage.listPartiesByCase(caseId),
    storage.listServiceTypes(),
  ]);

  let visiblePartyIds: Set<string> | null = access.tier === "miam_only_mediator" ? new Set(access.partyIds) : null;

  if (user.role === "mediator") {
    if (access.tier === "miam_only_mediator") {
      const miamAssignedParties = parties.filter(p => p.miamMediatorId === user.id);
      if (miamAssignedParties.length > 0) {
        visiblePartyIds = new Set<string>();
        for (const assignedParty of miamAssignedParties) {
          const miamRecord = miamRecords.find(r => r.partyId === assignedParty.id);
          const status = miamRecord?.approvalStatus || "draft";
          if (status === "draft" || status === "rejected") {
            visiblePartyIds.add(assignedParty.id);
          }
        }
      }
    }
  }

  const serviceMap = new Map(serviceTypes.map(s => [s.id, s.name]));
  const serviceCategoryMap = new Map(serviceTypes.map(s => [s.id, s.category]));
  const partyMap = new Map(parties.map(p => [p.id, { name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), role: p.role }]));

  const scopedMiamRecords = visiblePartyIds ? miamRecords.filter(r => visiblePartyIds!.has(r.partyId)) : miamRecords;
  const scopedAppointments = visiblePartyIds
    ? appointments.filter(a => a.mediatorId === user.id && !!a.partyId && visiblePartyIds!.has(a.partyId))
    : appointments;

  function partyLabel(partyId: string | null): string {
    if (!partyId) return "";
    const p = partyMap.get(partyId);
    return p ? ` — ${p.role === "A" ? "Client A" : p.role === "B" ? "Client B" : ""}` : "";
  }

  const miamDates: Array<{ type: string; label: string; date: string; status: string }> = [];

  for (const r of scopedMiamRecords) {
    if (r.submittedAt) {
      const party = partyMap.get(r.partyId);
      miamDates.push({
        type: "miam_submitted",
        label: `MIAM ${party?.role === "A" ? "Client A" : party?.role === "B" ? "Client B" : ""} — ${party?.name || "Unknown"}`,
        date: r.submittedAt.toISOString(),
        status: r.approvalStatus || "submitted",
      });
    }
  }

  const miamPartyIdsWithRecordDates = new Set(scopedMiamRecords.filter(r => r.submittedAt).map(r => r.partyId));

  const confirmedOrCompleted = scopedAppointments.filter(a => a.status === "confirmed" || a.status === "completed");

  for (const a of confirmedOrCompleted) {
    const category = a.serviceTypeId ? serviceCategoryMap.get(a.serviceTypeId) : null;
    if (category === "MIAM" && a.partyId && !miamPartyIdsWithRecordDates.has(a.partyId)) {
      const serviceName = (a.serviceTypeId && serviceMap.get(a.serviceTypeId)) || "MIAM";
      miamDates.push({
        type: "miam_appointment",
        label: `${serviceName}${partyLabel(a.partyId)}`,
        date: a.dateTime.toISOString(),
        status: a.status,
      });
    }
  }

  miamDates.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const mediationDates = confirmedOrCompleted
    .filter(a => {
      const cat = a.serviceTypeId ? serviceCategoryMap.get(a.serviceTypeId) : null;
      return cat === "Mediation";
    })
    .map(a => {
      const serviceName = (a.serviceTypeId && serviceMap.get(a.serviceTypeId)) || "Mediation Session";
      return {
        type: "mediation_session",
        label: `${serviceName}${partyLabel(a.partyId)}`,
        date: a.dateTime.toISOString(),
        status: a.status,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const otherAppointmentDates = confirmedOrCompleted
    .filter(a => {
      const cat = a.serviceTypeId ? serviceCategoryMap.get(a.serviceTypeId) : null;
      return cat !== "MIAM" && cat !== "Mediation";
    })
    .map(a => {
      const serviceName = (a.serviceTypeId && serviceMap.get(a.serviceTypeId)) || "Appointment";
      return {
        type: "appointment",
        label: `${serviceName}${partyLabel(a.partyId)}`,
        date: a.dateTime.toISOString(),
        status: a.status,
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return res.json({ miamDates, mediationDates, otherAppointmentDates });
});

export default router;
