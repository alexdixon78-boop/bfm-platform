import { Router, type Request, type Response } from "express";
import { requirePermission } from "../middleware/permissions";
import { mediatorPipelineService } from "../services/mediator-pipeline.service";
import type { User } from "@shared/schema";

const router = Router();

async function loadStaff(req: Request, res: Response): Promise<User | null> {
  const u = (req as any).user as User | undefined;
  if (!u) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return u;
}

router.get("/api/mediator-pipeline", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const board = await mediatorPipelineService.getBoard();
  res.json(board);
});

router.patch("/api/mediator-pipeline/move", requirePermission("mediators", "edit"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const { kind, id, toStage, fromStage } = req.body ?? {};
  if (!kind || !id || !toStage) {
    return res.status(400).json({ message: "kind, id, and toStage are required." });
  }
  const result = await mediatorPipelineService.move(actor.id, { kind, id, toStage, fromStage });
  if (!result.ok) {
    // Service marks the explicit off-board branch with requiresOffboardDialog.
    // All other failures (including unrelated 409s) propagate as normal toasts.
    if (result.requiresOffboardDialog) {
      return res.status(result.status).json({ message: result.error, requiresOffboardDialog: true });
    }
    return res.status(result.status).json({ message: result.error });
  }
  res.json(result);
});

router.get("/api/mediator-pipeline/:kind/:id/timeline", requirePermission("mediators", "view"), async (req, res) => {
  const actor = await loadStaff(req, res);
  if (!actor) return;
  const kind = req.params.kind === "mediator" ? "mediator" : "applicant";
  const rows = await mediatorPipelineService.timeline(kind, req.params.id);
  res.json(rows);
});

export default router;
