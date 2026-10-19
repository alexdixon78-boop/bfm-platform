import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { clientRepresentativeService } from "../services/client-representative.service";
import {
  insertClientRepresentativeSchema,
  updateClientRepresentativeSchema,
  type User,
} from "@shared/schema";

const router = Router();
// `requireAuth` (and downstream auth helpers) attach the authenticated `User`
// to the request object. Express's stock `Request` type doesn't know about
// that field, so we narrow it via an intersection type instead of `as any`.
type RequestWithUser = Request & { user: User };
const getUser = (req: Request) => (req as RequestWithUser).user;

/**
 * Task #202 — Client-owned representatives master list. Visibility:
 *   - staff (superadmin/subadmin)  → any client's list
 *   - portal client                → only their own clients.id
 *   - mediators / contractors      → 403 (they never get master-list access)
 *
 * Per-case attachment is handled by `representative.routes.ts`; the master
 * record stays untouched when an attachment is removed.
 */

router.get("/api/clients/:clientId/representatives",
  requireAuth,
  async (req, res) => {
    const result = await clientRepresentativeService.listForClient(req.params.clientId, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json(result.reps);
  });

router.post("/api/clients/:clientId/representatives",
  requireAuth,
  async (req, res) => {
    const parsed = insertClientRepresentativeSchema.omit({ clientId: true, createdBy: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    }
    const result = await clientRepresentativeService.createForClient(req.params.clientId, parsed.data, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.status(result.created ? 201 : 200).json({ rep: result.rep, created: result.created });
  });

router.patch("/api/client-representatives/:id",
  requireAuth,
  async (req, res) => {
    const parsed = updateClientRepresentativeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    }
    const result = await clientRepresentativeService.update(req.params.id, parsed.data, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json(result.rep);
  });

router.delete("/api/client-representatives/:id",
  requireAuth,
  async (req, res) => {
    const force = z.coerce.boolean().safeParse(req.query.force).data ?? false;
    const result = await clientRepresentativeService.delete(req.params.id, getUser(req), force);
    if (!result.ok) {
      // The service's failure variants are a discriminated union — when the
      // failure is "still attached", it carries an `attachments` array. We
      // surface that to the client so the UI can list the offending cases.
      const body: { message: string; attachments?: unknown } = { message: result.error };
      if ("attachments" in result) body.attachments = result.attachments;
      return res.status(result.status).json(body);
    }
    res.json({ success: true });
  });

export default router;
