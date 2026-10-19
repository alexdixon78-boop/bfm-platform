import { Router } from "express";
import { requirePermission } from "../middleware/permissions";
import { clientService } from "../services/client.service";
import { logAudit } from "../services/audit-log.service";
import type { PaginationParams, User } from "@shared/schema";
import { legacyClientImportService } from "../services/legacy-client-import.service";
import { storage } from "../storage";

function parsePaginationParams(query: Record<string, any>): PaginationParams {
  const sortOrder =
    query.sortOrder === "asc"
      ? ("asc" as const)
      : query.sortOrder === "desc"
        ? ("desc" as const)
        : undefined;
  return {
    page: Math.max(1, parseInt(query.page) || 1),
    limit: Math.min(100, Math.max(1, parseInt(query.limit) || 20)),
    search: query.search || undefined,
    status: query.status || undefined,
    sortBy: query.sortBy || undefined,
    sortOrder,
  };
}

const router = Router();

function requireImportAdmin(req: any, res: any) {
  const actor = req.user as User;
  if (!["superadmin", "subadmin"].includes(actor.role)) {
    res
      .status(403)
      .json({ message: "Only superadmins and subadmins can import legacy clients" });
    return null;
  }
  return actor;
}

function importFailure(res: any, error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status: unknown }).status)
      : 400;
  const message =
    error instanceof Error ? error.message : "Legacy client import failed";
  return res.status(Number.isFinite(status) ? status : 400).json({ message });
}

router.get(
  "/api/clients",
  requirePermission("clients", "view"),
  async (req, res) => {
    const actor = (req as any).user as User;
    if (!["superadmin", "subadmin", "staff"].includes(actor.role)) {
      return res.status(403).json({ message: "Client directory access is restricted to authorised staff" });
    }
    const params = parsePaginationParams(req.query);
    const result = await clientService.listClients(params);
    return res.json(result);
  },
);

router.post(
  "/api/clients/legacy-import/inspect",
  requirePermission("clients", "edit"),
  async (req, res) => {
    if (!requireImportAdmin(req, res)) return;
    try {
      const result = await legacyClientImportService.inspect(req.body);
      return res.json(result);
    } catch (error) {
      return importFailure(res, error);
    }
  },
);

router.post(
  "/api/clients/legacy-import/preview",
  requirePermission("clients", "edit"),
  async (req, res) => {
    if (!requireImportAdmin(req, res)) return;
    try {
      const result = await legacyClientImportService.preview(req.body);
      return res.json(result);
    } catch (error) {
      return importFailure(res, error);
    }
  },
);

router.post(
  "/api/clients/legacy-import/commit",
  requirePermission("clients", "edit"),
  async (req, res) => {
    const actor = requireImportAdmin(req, res);
    if (!actor) return;
    try {
      const receipt = await legacyClientImportService.commit(
        req.body,
        actor.id,
      );
      return res.status(201).json(receipt);
    } catch (error) {
      return importFailure(res, error);
    }
  },
);

router.get(
  "/api/clients/:id",
  requirePermission("clients", "view"),
  async (req, res) => {
    const actor = (req as any).user as User;
    if (!["superadmin", "subadmin", "staff"].includes(actor.role)) {
      return res.status(403).json({ message: "Client directory access is restricted to authorised staff" });
    }
    const client = await clientService.getClientDetail(req.params.id);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    return res.json(client);
  },
);

router.get(
  "/api/clients/:id/legacy-history",
  requirePermission("clients", "view"),
  async (req, res) => {
    const actor = (req as any).user as User;
    if (actor.role !== "superadmin" && actor.role !== "subadmin") {
      return res
        .status(403)
        .json({
          message: "Client directory access is restricted to administrators",
        });
    }
    const client = await storage.getClient(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    return res.json(
      await legacyClientImportService.historyForClient(req.params.id),
    );
  },
);

router.post(
  "/api/clients",
  requirePermission("clients", "edit"),
  async (req, res) => {
    const result = await clientService.createClient(req.body);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.error });
    }
    const actor = (req as any).user as User;
    logAudit({
      userId: actor.id,
      action: "create",
      entity: "client",
      entityId: result.party.id,
      entityRef: `${result.party.firstName} ${result.party.lastName}`,
    });
    return res.status(201).json(result.party);
  },
);

router.patch(
  "/api/clients/:id",
  requirePermission("clients", "edit"),
  async (req, res) => {
    const result = await clientService.updateClient(req.params.id, req.body);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.error });
    }
    const actor = (req as any).user as User;
    logAudit({
      userId: actor.id,
      action: "update",
      entity: "client",
      entityId: req.params.id,
      entityRef: `${result.party.firstName} ${result.party.lastName}`,
    });
    return res.json(result.party);
  },
);

router.delete(
  "/api/clients/:id",
  requirePermission("clients", "edit"),
  async (req, res) => {
    const actor = (req as any).user as User;
    if (actor.role !== "superadmin") {
      return res
        .status(403)
        .json({
          message: "Only superadmins can permanently delete client records",
        });
    }
    const result = await clientService.deleteOrphanedClient(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.error });
    }
    logAudit({
      userId: actor.id,
      action: "delete",
      entity: "client",
      entityId: req.params.id,
    });
    return res.json({ ok: true });
  },
);

export default router;
