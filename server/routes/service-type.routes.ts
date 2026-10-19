import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { requireAuth } from "../middleware/auth";
import { serviceTypeService } from "../services/service-type.service";
import { serviceTypesForRole } from "../services/service-type-access";
import { permissionService } from "../services/permission.service";
import { mediatorServiceApprovalService } from "../services/mediator-service-approval.service";
import { canViewSection } from "@shared/permissions";
import { logAudit } from "../services/audit-log.service";
import { insertServiceTypeSchema, normalizeMediationRoleQualification } from "@shared/schema";
import type { MediatorServiceAssignmentInput, User } from "@shared/schema";
import { z } from "zod";
import { storage } from "../storage";

const updateServiceTypeSchema = insertServiceTypeSchema.partial();
const mediatorServiceAssignmentsSchema = z.union([
  z.object({
    services: z.array(z.object({
      serviceTypeId: z.string(),
      mediationRoleQualification: z.enum(["unclassified", "observer", "co_mediator", "lead"]).optional(),
    })),
  }),
  // Legacy payload: keep accepting serviceTypeIds and store each role as unclassified.
  z.object({ serviceTypeIds: z.array(z.string()) }),
]);

const router = Router();

function validateOnlinePaymentConfig(data: { onlinePaymentEnabled?: boolean | null; paymentAmountPence?: number | null; paymentCurrency?: string | null }) {
  if (!data.onlinePaymentEnabled) return null;
  if (!data.paymentAmountPence || data.paymentAmountPence <= 0) {
    return "Payment amount is required when online payment is enabled";
  }
  if ((data.paymentCurrency || "gbp").toLowerCase() !== "gbp") {
    return "Only GBP online payments are supported";
  }
  return null;
}

// Public — no auth required. Returns only active service types for the
// unauthenticated mediator application form (/apply/mediator/:token).
router.get("/api/public/service-types", async (_req, res) => {
  try {
    const list = await serviceTypeService.list();
    return res.json(list.filter((s) => s.isActive));
  } catch (err) {
    console.error("[public/service-types] Error fetching service types:", err);
    return res.status(500).json({ message: "Failed to load service types" });
  }
});

router.get("/api/service-types", requirePermission("services", "view"), async (req, res) => {
  const list = await serviceTypeService.list();
  const actor = (req as any).user as User;
  return res.json(serviceTypesForRole(actor.role, list));
});

router.post("/api/service-types", requirePermission("services", "edit"), async (req, res) => {
  const parsed = insertServiceTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid data" });
  }
  const paymentError = validateOnlinePaymentConfig(parsed.data);
  if (paymentError) return res.status(400).json({ message: paymentError });
  const created = await serviceTypeService.create(parsed.data);
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "create", entity: "service_type", entityId: created.id, entityRef: created.name });
  return res.status(201).json(created);
});

router.patch("/api/service-types/:id", requirePermission("services", "edit"), async (req, res) => {
  const existing = await serviceTypeService.getById(req.params.id);
  if (!existing) return res.status(404).json({ message: "Service type not found" });
  const parsed = updateServiceTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid data" });
  }
  const merged = { ...existing, ...parsed.data };
  const paymentError = validateOnlinePaymentConfig(merged);
  if (paymentError) return res.status(400).json({ message: paymentError });
  const updated = await serviceTypeService.update(req.params.id, parsed.data);
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "update", entity: "service_type", entityId: req.params.id, entityRef: updated?.name });
  return res.json(updated);
});

router.delete("/api/service-types/:id", requireAuth, async (req: any, res) => {
  const actor = req.user as User | undefined;
  if (!actor || actor.role !== "superadmin") {
    return res.status(403).json({ message: "Only superadmins can delete service types" });
  }

  const result = await serviceTypeService.deleteIfUnlinked(req.params.id);
  if (!result) return res.status(404).json({ message: "Service type not found" });
  if (!result.deleted) {
    return res.status(409).json({
      message: `This service cannot be deleted because it is linked to ${result.dependencies.join(", ")}. Make it inactive instead.`,
      dependencies: result.dependencies,
    });
  }

  logAudit({ userId: actor.id, action: "delete", entity: "service_type", entityId: result.service.id, entityRef: result.service.name });
  return res.json({ deleted: true });
});

router.get("/api/mediators/:id/services", requireAuth, async (req: any, res) => {
  const actor = await storage.getUser(req.session.userId);
  if (!actor) return res.status(401).json({ message: "Not authenticated" });
  const isSelfMediator = actor.role === "mediator" && actor.id === req.params.id;
  if (!isSelfMediator) {
    const perms = await permissionService.getPermissions();
    if (!canViewSection(perms, actor.role, "mediators")) {
      return res.status(403).json({ message: "Access denied" });
    }
  }
  const services = await serviceTypeService.getMediatorServices(req.params.id);
  const approvals = await mediatorServiceApprovalService.listForMediator(req.params.id);
  const servicesById = new Map(services.map((service) => [service.serviceTypeId, service]));
  for (const approval of approvals) {
    if (!servicesById.has(approval.serviceTypeId)) {
      servicesById.set(approval.serviceTypeId, {
        id: approval.id,
        mediatorId: req.params.id,
        serviceTypeId: approval.serviceTypeId,
        mediationRoleQualification: "unclassified",
      } as any);
    }
  }
  return res.json(Array.from(servicesById.values()).map((service) => ({
    serviceTypeId: service.serviceTypeId,
    mediationRoleQualification: normalizeMediationRoleQualification(service.mediationRoleQualification),
  })));
});

router.put("/api/mediators/:id/services", requirePermission("mediators", "edit"), async (req, res) => {
  const parsed = mediatorServiceAssignmentsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "services must be an array of service assignments" });
  }
  const services: MediatorServiceAssignmentInput[] = "services" in parsed.data
    ? parsed.data.services.map((service) => ({
      serviceTypeId: service.serviceTypeId,
      mediationRoleQualification: normalizeMediationRoleQualification(service.mediationRoleQualification),
    }))
    : parsed.data.serviceTypeIds.map((serviceTypeId) => ({
      serviceTypeId,
      mediationRoleQualification: "unclassified",
    }));
  const serviceTypeIds = services.map((service) => service.serviceTypeId);
  if (new Set(serviceTypeIds).size !== serviceTypeIds.length) {
    return res.status(400).json({ message: "Duplicate service type IDs are not allowed" });
  }
  const targetUser = await storage.getUser(req.params.id);
  if (!targetUser || targetUser.role !== "mediator") {
    return res.status(400).json({ message: "Target user is not a mediator" });
  }
  if (serviceTypeIds.length > 0) {
    const allTypes = await serviceTypeService.list();
    const validIds = new Set(allTypes.map(t => t.id));
    const invalid = serviceTypeIds.filter(id => !validIds.has(id));
    if (invalid.length > 0) {
      return res.status(400).json({ message: `Invalid service type IDs: ${invalid.join(", ")}` });
    }
  }
  await serviceTypeService.setMediatorServices(req.params.id, services);
  const { reconcileServiceApprovalsForCalendarAvailability } = await import("../services/calendar-availability-reconciliation-runtime");
  await reconcileServiceApprovalsForCalendarAvailability(req.params.id)
    .catch((error) => console.error("[MediatorServices] Calendar availability reconciliation failed:", error));
  const actor = (req as any).user as User;
  logAudit({ userId: actor.id, action: "update", entity: "mediator", entityId: req.params.id, details: JSON.stringify({ services }) });
  return res.json({ success: true });
});

router.get("/api/mediator-service-types", requirePermission("mediators", "view"), async (_req, res) => {
  const all = await serviceTypeService.listAllMediatorServices();
  return res.json(all);
});

export default router;
