import { Router, type Request } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/permissions";
import { caseActivityService, staffActor } from "../services/case-activity.service";
import { caseCommunicationLogService } from "../services/case-communication-log.service";
import type { User } from "@shared/schema";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";

interface AuthenticatedRequest extends Request {
  user: User;
}

function getUser(req: Request): User {
  return (req as AuthenticatedRequest).user;
}

const router = Router();

router.get("/api/cases/:id/communications", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  if (user.role === "client") {
    return res.status(403).json({ message: "Not authorised" });
  }

  const caseId = req.params.id;
  const access = await classifyCaseAccess(caseId, user);
  if (!hasFullOperationalCaseAccess(access)) {
    return res.status(403).json({ message: "Not authorised" });
  }

  const parseDate = (value: unknown) => {
    if (typeof value !== "string" || !value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  const result = await caseCommunicationLogService.listByCase(caseId, {
    channel: typeof req.query.channel === "string" && req.query.channel !== "all" ? req.query.channel : undefined,
    direction: typeof req.query.direction === "string" && req.query.direction !== "all" ? req.query.direction : undefined,
    deliveryStatus: typeof req.query.deliveryStatus === "string" && req.query.deliveryStatus !== "all" ? req.query.deliveryStatus : undefined,
    recipientId: typeof req.query.recipientId === "string" && req.query.recipientId !== "all" ? req.query.recipientId : undefined,
    dateFrom: parseDate(req.query.dateFrom),
    dateTo: parseDate(req.query.dateTo),
    limit: Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 100)),
    offset: Math.max(0, parseInt(req.query.offset as string) || 0),
  });

  return res.json(result);
});

router.get("/api/cases/:id/communications/:communicationId/email", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  if (user.role === "client") return res.status(403).json({ message: "Not authorised" });
  const access = await classifyCaseAccess(req.params.id, user);
  if (!hasFullOperationalCaseAccess(access)) return res.status(403).json({ message: "Not authorised" });
  const detail = await caseCommunicationLogService.getEmailDetail(req.params.id, req.params.communicationId);
  if (!detail) return res.status(404).json({ message: "Email communication not found" });
  return res.json(detail);
});

const manualCommunicationSchema = z.object({
  type: z.enum(["call_logged", "whatsapp_logged", "email_sent", "manual"]).default("manual"),
  direction: z.enum(["inbound", "outbound", "internal"]),
  summary: z.string().trim().min(1).max(2000),
  contactName: z.string().trim().max(200).optional(),
  recipientEmail: z.string().trim().email().optional().or(z.literal("")),
  recipientPhone: z.string().trim().max(40).optional(),
  occurredAt: z.string().optional(),
});

router.post("/api/cases/:id/communications/manual", requirePermission("cases", "edit"), async (req, res) => {
  const user = getUser(req);
  if (user.role === "client") {
    return res.status(403).json({ message: "Not authorised" });
  }

  const caseId = req.params.id;
  const access = await classifyCaseAccess(caseId, user);
  if (!hasFullOperationalCaseAccess(access)) {
    return res.status(403).json({ message: "Not authorised" });
  }

  const parsed = manualCommunicationSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid communication log request" });
  }

  let occurredAt: Date | undefined;
  if (parsed.data.occurredAt) {
    occurredAt = new Date(parsed.data.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return res.status(400).json({ message: "occurredAt must be a valid date" });
    }
  }

  const actor = staffActor(user);
  const labels: Record<string, string> = {
    call_logged: "Phone call",
    whatsapp_logged: "WhatsApp message",
    email_sent: "Email",
    manual: "Manual communication",
  };
  const activity = await caseActivityService.log({
    caseId,
    type: parsed.data.type === "manual" ? "call_logged" : parsed.data.type,
    title: `${labels[parsed.data.type]} (${parsed.data.direction})`,
    description: parsed.data.summary,
    direction: parsed.data.direction,
    metadata: JSON.stringify({
      contactName: parsed.data.contactName || null,
      recipientEmail: parsed.data.recipientEmail || null,
      recipientPhone: parsed.data.recipientPhone || null,
      direction: parsed.data.direction,
    }),
    occurredAt,
    actor,
  });

  const ledger = await caseCommunicationLogService.recordManualCommunication({
    caseId,
    type: parsed.data.type,
    direction: parsed.data.direction,
    summary: parsed.data.summary,
    contactName: parsed.data.contactName,
    recipientEmail: parsed.data.recipientEmail || null,
    recipientPhone: parsed.data.recipientPhone || null,
    occurredAt,
    actor,
    sourceEntityId: activity?.id || null,
  });

  return res.status(201).json(ledger || activity);
});

export default router;
