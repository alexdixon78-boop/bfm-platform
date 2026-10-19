import { Router, type Request } from "express";
import { storage } from "../storage";
import { requirePermission } from "../middleware/permissions";
import { caseFiltersSchema, insertCaseFilterPresetSchema, type User } from "@shared/schema";

interface AuthenticatedRequest extends Request {
  user: User;
}
function getUser(req: Request): User {
  return (req as AuthenticatedRequest).user;
}

const router = Router();

router.get("/api/case-filter-presets", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const presets = await storage.listCaseFilterPresets(user.id);
  // Fail-closed validate stored filters; replace bad blobs with {} so the UI
  // can still display the preset name without trusting unverified JSON.
  const sanitised = presets.map((p) => {
    const parsed = caseFiltersSchema.safeParse(p.filters);
    return parsed.success ? p : { ...p, filters: {}, _filtersInvalid: true };
  });
  return res.json(sanitised);
});

router.get("/api/case-filter-presets/default", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const preset = await storage.getDefaultCaseFilterPreset(user.id);
  if (!preset) return res.json(null);
  const parsed = caseFiltersSchema.safeParse(preset.filters);
  return res.json(parsed.success ? preset : { ...preset, filters: {}, _filtersInvalid: true });
});

router.post("/api/case-filter-presets", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const parsed = insertCaseFilterPresetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid preset", errors: parsed.error.flatten() });
  }
  try {
    const created = await storage.createCaseFilterPreset(user.id, parsed.data.name, parsed.data.filters, parsed.data.isDefault ?? false);
    return res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique/i.test(msg)) return res.status(409).json({ message: "A preset with that name already exists" });
    console.error("[case-filter-presets.create] error:", err);
    return res.status(500).json({ message: "Failed to create preset" });
  }
});

router.patch("/api/case-filter-presets/:id", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const partialSchema = insertCaseFilterPresetSchema.partial();
  const parsed = partialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid preset", errors: parsed.error.flatten() });
  }
  // Validate filters explicitly when provided.
  if (parsed.data.filters !== undefined) {
    const f = caseFiltersSchema.safeParse(parsed.data.filters);
    if (!f.success) return res.status(400).json({ message: "Invalid filters", errors: f.error.flatten() });
    parsed.data.filters = f.data;
  }
  try {
    const updated = await storage.updateCaseFilterPreset(req.params.id, user.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Preset not found" });
    return res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique/i.test(msg)) return res.status(409).json({ message: "A preset with that name already exists" });
    console.error("[case-filter-presets.update] error:", err);
    return res.status(500).json({ message: "Failed to update preset" });
  }
});

router.delete("/api/case-filter-presets/:id", requirePermission("cases", "view"), async (req, res) => {
  const user = getUser(req);
  const ok = await storage.deleteCaseFilterPreset(req.params.id, user.id);
  if (!ok) return res.status(404).json({ message: "Preset not found" });
  return res.json({ success: true });
});

export default router;
