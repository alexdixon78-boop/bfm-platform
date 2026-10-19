import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { representativeService } from "../services/representative.service";
import {
  insertCaseRepresentativeSchema,
  updateCaseRepresentativeSchema,
  type User,
} from "@shared/schema";

const router = Router();
// `requireAuth` (and downstream auth helpers) attach the authenticated `User`
// to the request object. Express's stock `Request` type doesn't know about
// that field, so we narrow it via an intersection type instead of `as any`.
type RequestWithUser = Request & { user: User };
const getUser = (req: Request) => (req as RequestWithUser).user;

function clientIp(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return xff[0];
  return req.ip || req.socket?.remoteAddress || null;
}

// Public — no auth. GET is a non-mutating token validity check (so email scanners /
// link-prefetchers cannot accidentally grant consent). POST records the explicit decision.
router.get("/api/representatives/consent/:token", async (req, res) => {
  const result = await representativeService.lookupByToken(req.params.token);
  if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });
  res.json({ success: true, fullName: result.rep.fullName, status: result.rep.consentStatus });
});

router.post("/api/representatives/consent/:token", async (req, res) => {
  const decision = z.enum(["granted", "withdrawn", "refused"]).safeParse(req.body?.decision);
  if (!decision.success) return res.status(400).json({ message: "Invalid decision" });
  const result = await representativeService.respondToConsent(req.params.token, decision.data, clientIp(req));
  if (!result.ok) return res.status(result.status).json({ success: false, message: result.error });
  res.json({ success: true, fullName: result.fullName, status: decision.data });
});

// Authenticated routes ----------------------------------------------------

// Client-portal: list all representatives attached to the authenticated client's
// own party across every case they belong to. Used by the new /contacts page.
router.get("/api/representatives/mine",
  requireAuth,
  async (req, res) => {
    const result = await representativeService.listMineForClient(getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    // Task #202: shape changed from `groups[]` to `{ masters, myCases, ownClientId }`.
    res.json({
      masters: result.masters,
      myCases: result.myCases,
      ownClientId: result.ownClientId,
    });
  });

router.get("/api/cases/:caseId/representatives",
  requireAuth, requirePermission("cases", "view"),
  async (req, res) => {
    const result = await representativeService.listVisibleByCase(req.params.caseId, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json(result.reps);
  });

router.post("/api/cases/:caseId/representatives",
  requireAuth, requirePermission("cases", "view"),
  async (req, res) => {
    const parsed = insertCaseRepresentativeSchema.omit({ caseId: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    const result = await representativeService.create(req.params.caseId, { ...parsed.data, caseId: req.params.caseId }, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.status(201).json(result.rep);
  });

router.patch("/api/representatives/:id",
  requireAuth, requirePermission("cases", "view"),
  async (req, res) => {
    const parsed = updateCaseRepresentativeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    const result = await representativeService.update(req.params.id, parsed.data, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json(result.rep);
  });

router.delete("/api/representatives/:id",
  requireAuth, requirePermission("cases", "view"),
  async (req, res) => {
    const result = await representativeService.remove(req.params.id, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json({ success: true });
  });

// Task #202 — Attach an existing master record to a case. Body must include
// `clientRepresentativeId` + `partyId`; optional per-attachment fields are
// `notes` and `preferredChannel`. Idempotent: re-attaching the same master to
// the same party returns the existing attachment with `alreadyAttached: true`.
router.post("/api/cases/:caseId/representatives/attach",
  requireAuth, requirePermission("cases", "view"),
  async (req, res) => {
    const parsed = z.object({
      clientRepresentativeId: z.string().min(1),
      partyId: z.string().min(1),
      notes: z.string().nullable().optional(),
      preferredChannel: z.enum(["email", "phone", "post"]).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten().fieldErrors });
    const result = await representativeService.attach(req.params.caseId, parsed.data, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.status(result.alreadyAttached ? 200 : 201).json({ rep: result.rep, alreadyAttached: result.alreadyAttached });
  });

router.post("/api/representatives/:id/send-consent",
  requireAuth, requirePermission("cases", "view"),
  async (req, res) => {
    const result = await representativeService.sendConsent(req.params.id, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json({ success: true, rep: result.rep, emailSent: result.emailSent });
  });

router.patch("/api/cases/:caseId/mediator-rep-visibility",
  requireAuth, requirePermission("cases", "edit"),
  async (req, res) => {
    const parsed = z.object({ mediatorCanSeeReps: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid payload" });
    const result = await representativeService.setMediatorVisibility(req.params.caseId, parsed.data.mediatorCanSeeReps, getUser(req));
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    res.json(result);
  });

export default router;
