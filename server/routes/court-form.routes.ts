import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { courtFormTemplateService, isCourtFormType } from "../services/court-form-template.service";
import { courtFormGenerationService } from "../services/court-form-generation.service";
import { logAudit } from "../services/audit-log.service";
import { storage } from "../storage";
import { COURT_FORM_MERGE_SOURCE_GROUPS } from "@shared/court-form-merge-sources";
import { auditFinancialDisclosureBookletMapping } from "@shared/financial-disclosure-booklet-auto-map";
import { auditDraftFinancialScheduleMapping } from "@shared/draft-financial-schedule-auto-map";
import {
  COURT_FORM_DRAFT_STATUSES,
  COURT_FORM_GUIDANCE_SIGNOFF_STATUSES,
  COURT_FORM_TYPES,
  type CourtFormType,
  type User,
} from "@shared/schema";

const router = Router();

function getUser(req: { user?: User }): User {
  return req.user as User;
}

function inlinePdfFileName(fileName: string): string {
  return fileName.replace(/["\\\r\n]+/g, "_") || "court-form-template.pdf";
}

function requireTemplateManager(req: { user?: User }, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  const role = req.user?.role;
  if (role === "superadmin" || role === "subadmin") return true;
  res.status(403).json({ message: "Only superadmins and subadmins can manage court form templates" });
  return false;
}

function handleTemplateRouteError(err: unknown, res: Response): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === "Court form template not found") {
    res.status(404).json({ message: err.message });
    return true;
  }
  if (err.message.includes("archived court form template")) {
    res.status(409).json({ message: err.message });
    return true;
  }
  return false;
}

async function requireCaseLeadMediatorOrTemplateManager(
  req: { user?: User; params: { caseId: string } },
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<boolean> {
  const role = req.user?.role;
  if (role === "superadmin" || role === "subadmin") return true;
  const existingCase = await storage.getCase(req.params.caseId);
  if (role === "mediator" && existingCase?.mediatorId === req.user?.id) return true;
  res.status(403).json({ message: "Only superadmins, subadmins, and the case lead mediator can manage this court form mapping" });
  return false;
}

const formTypeSchema = z.enum(COURT_FORM_TYPES);
const templateUploadSchema = z.object({
  formType: formTypeSchema,
  versionLabel: z.string().trim().min(1),
  sourceFileName: z.string().trim().min(1),
  fileData: z.string().trim().min(1),
  mimeType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const templateReuploadSchema = z.object({
  sourceFileName: z.string().trim().min(1),
  fileData: z.string().trim().min(1),
  mimeType: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
const templatePatchSchema = z.object({
  versionLabel: z.string().trim().min(1).optional(),
  notes: z.string().optional().nullable(),
});
const markCurrentSchema = z.object({
  verifiedCurrentAt: z.string().optional().nullable(),
});
const mappingPatchSchema = z.object({
  fieldMapping: z.array(z.object({
    pdfField: z.string().trim().min(1),
    source: z.string().trim().min(1),
    required: z.boolean().optional(),
    defaultValue: z.string().optional().nullable(),
  })),
});
const guidanceSchema = z.object({
  formType: formTypeSchema,
  templateId: z.string().trim().optional().nullable(),
  sectionKey: z.string().trim().min(1),
  sectionTitle: z.string().trim().min(1),
  body: z.string().trim().min(1),
  sortOrder: z.number().int().optional(),
  legalSignoffStatus: z.enum(COURT_FORM_GUIDANCE_SIGNOFF_STATUSES).optional(),
});
const guidancePatchSchema = guidanceSchema.partial();
const draftSchema = z.object({
  templateId: z.string().trim().optional().nullable(),
  answers: z.record(z.unknown()).optional(),
  status: z.enum(COURT_FORM_DRAFT_STATUSES).optional(),
});
const generationSchema = z.object({
  partyId: z.string().trim().min(1),
  formType: formTypeSchema,
  draftId: z.string().trim().optional().nullable(),
  recipientEmail: z.string().email().optional().nullable(),
  sendEmail: z.boolean().optional(),
});
const previewSchema = z.object({
  partyId: z.string().trim().min(1),
  formType: formTypeSchema,
  templateId: z.string().trim().optional().nullable(),
  answers: z.record(z.unknown()).optional(),
});

router.get("/api/court-form-merge-sources", requireAuth, requirePermission("court_forms", "view"), async (_req, res) => {
  res.json(COURT_FORM_MERGE_SOURCE_GROUPS);
});

router.get("/api/court-form-templates", requireAuth, requirePermission("court_forms", "view"), async (_req, res, next) => {
  try {
    res.json(await courtFormTemplateService.listTemplates());
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.post("/api/court-form-templates", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = templateUploadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form template upload", issues: parsed.error.issues });
    const template = await courtFormTemplateService.createTemplate(getUser(req as { user?: User }), parsed.data);
    res.status(201).json(template);
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.patch("/api/court-form-templates/:id", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = templatePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form template update", issues: parsed.error.issues });
    res.json(await courtFormTemplateService.updateTemplate(req.params.id, parsed.data));
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.post("/api/court-form-templates/:id/reupload", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = templateReuploadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form template reupload", issues: parsed.error.issues });
    res.json(await courtFormTemplateService.reuploadTemplate(req.params.id, parsed.data));
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.post("/api/court-form-templates/:id/mark-current", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = markCurrentSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid current-template request", issues: parsed.error.issues });
    res.json(await courtFormTemplateService.markCurrent(req.params.id, getUser(req as { user?: User }), parsed.data));
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.delete("/api/court-form-templates/:id", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const template = await courtFormTemplateService.deleteTemplate(req.params.id, getUser(req as { user?: User }));
    await logAudit({
      userId: getUser(req as { user?: User }).id,
      action: "delete",
      entity: "court_form_template",
      entityId: template.id,
      entityRef: `${template.formType} - ${template.versionLabel}`,
      details: JSON.stringify({
        formType: template.formType,
        versionLabel: template.versionLabel,
        sourceFileName: template.sourceFileName,
      }),
    });
    res.json(template);
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.get("/api/court-form-templates/:id/fields", requireAuth, requirePermission("court_forms", "view"), async (req, res, next) => {
  try {
    const template = await storage.getCourtFormTemplate(req.params.id);
    if (!template || template.deletedAt) return res.status(404).json({ message: "Court form template not found" });
    res.json({ fields: template.fieldNames });
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.get("/api/court-form-templates/:id/mapping-audit", requireAuth, requirePermission("court_forms", "view"), async (req, res, next) => {
  try {
    const template = await storage.getCourtFormTemplate(req.params.id);
    if (!template || template.deletedAt) return res.status(404).json({ message: "Court form template not found" });
    if (template.formType !== "FinancialDisclosureBooklet" && template.formType !== "DraftFinancialSchedule") {
      return res.status(400).json({ message: "Mapping audit is only available for Financial Disclosure Booklet and Draft Financial Schedule templates" });
    }
    const fieldNames = Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : [];
    const existingMapping = Array.isArray(template.fieldMapping) ? template.fieldMapping : [];
    res.json(template.formType === "DraftFinancialSchedule"
      ? auditDraftFinancialScheduleMapping({ fieldNames, existingMapping })
      : auditFinancialDisclosureBookletMapping({ fieldNames, existingMapping }));
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.get("/api/court-form-templates/:id/preview", requireAuth, requirePermission("court_forms", "view"), async (req, res, next) => {
  try {
    const template = await storage.getCourtFormTemplate(req.params.id);
    if (!template || template.deletedAt) return res.status(404).json({ message: "Court form template not found" });
    const pdfBuffer = await courtFormTemplateService.getTemplateBuffer(template);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${inlinePdfFileName(template.sourceFileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(pdfBuffer);
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.patch("/api/court-form-templates/:id/mapping", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = mappingPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form mapping", issues: parsed.error.issues });
    res.json(await courtFormTemplateService.updateMapping(req.params.id, parsed.data.fieldMapping));
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.patch("/api/cases/:caseId/court-form-templates/:id/mapping", requireAuth, async (req, res, next) => {
  try {
    if (!await requireCaseLeadMediatorOrTemplateManager(req as { user?: User; params: { caseId: string } }, res)) return;
    const parsed = mappingPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form mapping", issues: parsed.error.issues });
    res.json(await courtFormTemplateService.updateMapping(req.params.id, parsed.data.fieldMapping));
  } catch (err) {
    if (handleTemplateRouteError(err, res)) return;
    next(err);
  }
});

router.get("/api/court-form-guidance", requireAuth, requirePermission("court_forms", "view"), async (req, res, next) => {
  try {
    const formType = typeof req.query.formType === "string" && isCourtFormType(req.query.formType) ? req.query.formType : undefined;
    const templateId = typeof req.query.templateId === "string" ? req.query.templateId : undefined;
    res.json(await storage.listCourtFormGuidance(formType, templateId));
  } catch (err) {
    next(err);
  }
});

router.post("/api/court-form-guidance", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = guidanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form guidance", issues: parsed.error.issues });
    res.status(201).json(await storage.createCourtFormGuidance({ ...parsed.data, updatedBy: getUser(req as { user?: User }).id }));
  } catch (err) {
    next(err);
  }
});

router.patch("/api/court-form-guidance/:id", requireAuth, requirePermission("court_forms", "edit"), async (req, res, next) => {
  try {
    if (!requireTemplateManager(req as { user?: User }, res)) return;
    const parsed = guidancePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form guidance update", issues: parsed.error.issues });
    const updated = await storage.updateCourtFormGuidance(req.params.id, { ...parsed.data, updatedBy: getUser(req as { user?: User }).id });
    if (!updated) return res.status(404).json({ message: "Court form guidance not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/api/cases/:caseId/court-forms", requireAuth, requirePermission("court_forms", "view"), async (req, res, next) => {
  try {
    res.json(await courtFormGenerationService.getCaseCourtForms(req.params.caseId, getUser(req as { user?: User })));
  } catch (err) {
    next(err);
  }
});

router.get("/api/cases/:caseId/court-form-drafts/:formType/:partyId", requireAuth, requirePermission("court_forms", "view"), async (req, res, next) => {
  try {
    if (!isCourtFormType(req.params.formType)) return res.status(400).json({ message: "Invalid court form type" });
    res.json(await courtFormGenerationService.getDraft(req.params.caseId, req.params.partyId, req.params.formType as CourtFormType, getUser(req as { user?: User })));
  } catch (err) {
    next(err);
  }
});

router.put("/api/cases/:caseId/court-form-drafts/:formType/:partyId", requireAuth, async (req, res, next) => {
  try {
    if (!await requireCaseLeadMediatorOrTemplateManager(req as { user?: User; params: { caseId: string } }, res)) return;
    if (!isCourtFormType(req.params.formType)) return res.status(400).json({ message: "Invalid court form type" });
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form draft", issues: parsed.error.issues });
    res.json(await courtFormGenerationService.saveDraft(req.params.caseId, req.params.partyId, req.params.formType as CourtFormType, getUser(req as { user?: User }), parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post("/api/cases/:caseId/court-form-generations", requireAuth, async (req, res, next) => {
  try {
    const parsed = generationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form generation", issues: parsed.error.issues });
    res.status(201).json(await courtFormGenerationService.generate(req.params.caseId, getUser(req as { user?: User }), parsed.data, req.ip));
  } catch (err) {
    next(err);
  }
});

router.post("/api/cases/:caseId/court-form-preview", requireAuth, async (req, res, next) => {
  try {
    if (!await requireCaseLeadMediatorOrTemplateManager(req as { user?: User; params: { caseId: string } }, res)) return;
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid court form preview", issues: parsed.error.issues });
    const preview = await courtFormGenerationService.previewFilledPdf(req.params.caseId, getUser(req as { user?: User }), parsed.data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${preview.fileName}"`);
    res.send(Buffer.from(preview.pdfBytes));
  } catch (err) {
    next(err);
  }
});

router.post("/api/court-form-generations/:id/resend", requireAuth, async (req, res, next) => {
  try {
    res.json(await courtFormGenerationService.resend(req.params.id, getUser(req as { user?: User }), req.ip));
  } catch (err) {
    next(err);
  }
});

export default router;
