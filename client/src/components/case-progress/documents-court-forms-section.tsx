import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, FileText, Plus, RefreshCw, Save, Send, Settings2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { COURT_FORMS, deriveCourtFormState, partyHeading, type CourtFormId, type CourtFormState, type PartyLike } from "./derivation";
import { CourtFormCellPill } from "./cell-pills";
import { CourtFormPdfEditorDialog, type CourtFormFieldMetadata } from "./court-form-pdf-editor-dialog";
import {
  FieldMappingPicker,
  SourceMappingPicker,
  formatPdfFieldLabel,
  type PdfFieldOption,
} from "@/components/court-forms/court-form-mapping-picker";
import { getCourtFormMergeSourceLabel, type CourtFormMergeSourceGroup } from "@shared/court-form-merge-sources";
import { PDF_FIELD_OVERRIDES_KEY } from "@shared/court-form-pdf-overrides";
import { CASE_FORM_CATEGORIES, FORM_CATEGORY_BY_TYPE, type FormCategory } from "@shared/court-form-catalog";

type MappingEntry = { pdfField: string; source: string; required?: boolean; defaultValue?: string | null };
type Template = { id: string; formType: CourtFormId; versionLabel: string; isCurrent: boolean; fieldNames?: string[]; fieldMetadata?: CourtFormFieldMetadata[]; fieldMapping?: MappingEntry[] };
type Draft = { id: string; caseId: string; partyId: string; formType: CourtFormId; templateId?: string | null; answers?: Record<string, unknown> | null };
type Generation = {
  id: string;
  caseId: string;
  partyId: string;
  templateId: string;
  templateVersionLabel: string;
  status: string;
  recipientEmail?: string | null;
  deliveryStatus: string;
  deliveryLastAttemptedAt?: string | null;
};
type Readiness = {
  formType: CourtFormId;
  partyId: string;
  templateId: string | null;
  templateVersionLabel: string | null;
  hasUploadedTemplate: boolean;
  hasCurrentTemplate: boolean;
  requiresGovUkVerification: boolean;
  mappingCount: number;
  requiredMappedFields: number;
  resolvedRequiredFields: number;
  missingRequiredFields: Array<{ pdfField: string; source: string; draftKey?: string | null }>;
  resolvedFields: Array<{ pdfField: string; source: string; value: string; required: boolean }>;
  canGenerate: boolean;
  blockingReasons: string[];
};
type CourtFormsPayload = {
  templates: Template[];
  generations: Generation[];
  parties: PartyLike[];
  drafts?: Draft[];
  readiness: Readiness[];
};
type MiamValidity = {
  expiresAt: string | null;
  parties?: Array<{ role: string; expiresAt: string | null; expired: boolean }>;
};
type InlineMappingRow = MappingEntry & { pdfField: string };

function latestGeneration(generations: Generation[], partyId: string, templates: Template[], formType: CourtFormId): Generation | undefined {
  const templateIds = new Set(templates.filter((template) => template.formType === formType).map((template) => template.id));
  return generations.find((generation) => generation.partyId === partyId && templateIds.has(generation.templateId));
}

function stateFromGeneration(generation: Generation | undefined, fallback: CourtFormState): CourtFormState {
  if (!generation) return fallback;
  if (generation.status === "sent" || generation.deliveryStatus === "sent") return "Sent";
  if (generation.status === "saved" || generation.status === "generated") return "Signed";
  return "Not started";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getDraftPathValue(answers: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, answers);
  return value == null ? "" : String(value);
}

function setDraftPathValue(answers: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...answers };
  const parts = path.split(".").filter(Boolean);
  let cursor = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    const existing = cursor[part];
    const child = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
    cursor[part] = child;
    cursor = child;
  });
  return next;
}

function setPdfFieldOverrideValue(answers: Record<string, unknown>, fieldName: string, value: string | boolean): Record<string, unknown> {
  const rawOverrides = answers[PDF_FIELD_OVERRIDES_KEY];
  const overrides = rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)
    ? { ...(rawOverrides as Record<string, unknown>) }
    : {};
  overrides[fieldName] = value;
  return { ...answers, [PDF_FIELD_OVERRIDES_KEY]: overrides };
}

function getPdfFieldOptions(fieldNames: string[] = []): PdfFieldOption[] {
  return fieldNames.map((field) => ({ raw: field, label: formatPdfFieldLabel(field) }));
}

function compactInlineMappingRows(rows: InlineMappingRow[]): MappingEntry[] {
  return rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      pdfField: row.pdfField,
      source: row.source,
      required: Boolean(row.required),
      defaultValue: row.source === "static" ? row.defaultValue || "" : row.defaultValue || null,
    }));
}

function buildInlineMappingRows(template?: Template): InlineMappingRow[] {
  const mappingByField = new Map((Array.isArray(template?.fieldMapping) ? template.fieldMapping : []).map((entry) => [entry.pdfField, entry]));
  return (template?.fieldNames || []).map((pdfField) => {
    const entry = mappingByField.get(pdfField);
    return {
      pdfField,
      source: entry?.source || "",
      required: Boolean(entry?.required),
      defaultValue: entry?.defaultValue || null,
    };
  });
}

function areMappingsEqual(a: MappingEntry[], b: MappingEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function CourtFormMappingDialog({
  open,
  onOpenChange,
  template,
  caseId,
  sourceGroups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: Template;
  caseId: string;
  sourceGroups?: CourtFormMergeSourceGroup[];
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<MappingEntry[]>([]);
  const pdfFieldOptions = useMemo(() => getPdfFieldOptions(template?.fieldNames || []), [template?.fieldNames]);

  useEffect(() => {
    if (open) setRows(Array.isArray(template?.fieldMapping) ? template.fieldMapping : []);
  }, [open, template?.id, template?.fieldMapping]);

  const saveMappingMutation = useMutation({
    mutationFn: async () => {
      if (!template) throw new Error("Select a template");
      return apiRequest("PATCH", `/api/cases/${caseId}/court-form-templates/${template.id}/mapping`, { fieldMapping: rows });
    },
    onSuccess: async () => {
      toast({ title: "Mapping saved" });
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "court-forms"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
    },
    onError: (error: Error) => toast({ title: "Mapping failed", description: error.message, variant: "destructive" }),
  });

  const addRow = () => setRows((current) => [...current, { pdfField: pdfFieldOptions[0]?.raw || "", source: "draft.notes", required: false }]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-court-form-mapping">
        <DialogHeader>
          <DialogTitle>Manage mapping</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            Mapping is saved to the current template and reused for both parties and future cases.
          </div>
          <div className="max-h-40 overflow-auto rounded-md border text-xs text-muted-foreground">
            {pdfFieldOptions.map((field) => (
              <div key={field.raw} className="border-b px-2 py-1.5 last:border-b-0 break-words leading-snug">
                {field.label}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {rows.map((entry, index) => (
              <div key={`${entry.pdfField}-${index}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)_94px_44px]">
                <FieldMappingPicker
                  value={entry.pdfField}
                  options={pdfFieldOptions}
                  onChange={(value) => setRows((current) => current.map((row, i) => i === index ? { ...row, pdfField: value } : row))}
                />
                <SourceMappingPicker value={entry.source} onChange={(value) => setRows((current) => current.map((row, i) => i === index ? { ...row, source: value } : row))} groups={sourceGroups} />
                <label className="flex items-center gap-2 rounded-md border px-2 text-xs">
                  <Checkbox checked={Boolean(entry.required)} onCheckedChange={(checked) => setRows((current) => current.map((row, i) => i === index ? { ...row, required: checked === true } : row))} />
                  Required
                </label>
                <Button variant="outline" size="icon" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} aria-label="Remove mapping">
                  <Trash2 className="w-4 h-4" />
                </Button>
                {entry.source === "static" && (
                  <Input
                    className="md:col-start-2"
                    value={entry.defaultValue || ""}
                    onChange={(e) => setRows((current) => current.map((row, i) => i === index ? { ...row, defaultValue: e.target.value } : row))}
                    placeholder="Static value"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={addRow} disabled={!template || pdfFieldOptions.length === 0}>
            <Plus className="w-4 h-4 mr-2" /> Add mapping
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => saveMappingMutation.mutate()} disabled={!template || saveMappingMutation.isPending}>
              <Save className="w-4 h-4 mr-2" /> Save mapping
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function readinessLabel(readiness: Readiness | undefined, miamValidForCourtAction: boolean): string {
  if (!miamValidForCourtAction) return "MIAM expired";
  if (!readiness) return "No template uploaded";
  if (!readiness.hasUploadedTemplate) return "No template uploaded";
  if (!readiness.hasCurrentTemplate) return readiness.requiresGovUkVerification ? "Form E verification required" : "Template uploaded, not current";
  if (readiness.mappingCount === 0) return "Mapping incomplete";
  if (readiness.missingRequiredFields.length > 0) return "Missing case data";
  return readiness.canGenerate ? "Ready to generate" : readiness.blockingReasons[0] || "Mapping incomplete";
}

export function DocumentsCourtFormsSection({
  caseId,
  parties,
  stageIdx,
  miamValidForCourtAction = true,
  miamValidity = null,
  caseLeadMediatorId = null,
}: {
  caseId: string;
  parties: PartyLike[];
  stageIdx: number;
  miamValidForCourtAction?: boolean;
  miamValidity?: MiamValidity | null;
  caseLeadMediatorId?: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManageCaseForms = user?.role === "superadmin" || user?.role === "subadmin" || (user?.role === "mediator" && caseLeadMediatorId === user.id);
  const canPreviewCourtForm = canManageCaseForms;
  const sorted = parties.slice().sort((a, b) => (a.role || "").localeCompare(b.role || ""));
  const [activeFormCategory, setActiveFormCategory] = useState<FormCategory>("court");
  const [selectedPartyId, setSelectedPartyId] = useState(sorted[0]?.id ?? "");
  const [selectedFormId, setSelectedFormId] = useState<CourtFormId>("C100");
  const [draftAnswers, setDraftAnswers] = useState<Record<string, unknown>>({});
  const [mappingOpen, setMappingOpen] = useState(false);
  const [inlineFieldRows, setInlineFieldRows] = useState<InlineMappingRow[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);

  const courtFormsQuery = useQuery<CourtFormsPayload>({
    queryKey: ["/api/cases", caseId, "court-forms"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/court-forms`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load court forms");
      return res.json();
    },
  });
  const guidanceQuery = useQuery<Array<{ id: string; sectionTitle: string; body: string; legalSignoffStatus: string }>>({
    queryKey: ["/api/court-form-guidance", selectedFormId],
    queryFn: async () => {
      const res = await fetch(`/api/court-form-guidance?formType=${encodeURIComponent(selectedFormId)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load court form guidance");
      return res.json();
    },
  });
  const sourceGroupsQuery = useQuery<CourtFormMergeSourceGroup[]>({
    queryKey: ["/api/court-form-merge-sources"],
  });

  const templates = courtFormsQuery.data?.templates ?? [];
  const generations = courtFormsQuery.data?.generations ?? [];
  const drafts = courtFormsQuery.data?.drafts ?? [];
  const readiness = courtFormsQuery.data?.readiness ?? [];
  const visibleForms = COURT_FORMS.filter((form) => FORM_CATEGORY_BY_TYPE[form.id] === activeFormCategory);
  const currentTemplate = templates.find((template) => template.formType === selectedFormId && template.isCurrent);
  const latestUploadedTemplate = templates.find((template) => template.formType === selectedFormId);
  const editableTemplate = currentTemplate || latestUploadedTemplate;
  const selectedParty = sorted.find((party) => party.id === selectedPartyId) || sorted[0];
  const selectedGeneration = selectedParty ? latestGeneration(generations, selectedParty.id, templates, selectedFormId) : undefined;
  const selectedReadiness = selectedParty ? readiness.find((item) => item.partyId === selectedParty.id && item.formType === selectedFormId) : undefined;
  const selectedDraft = selectedParty ? drafts.find((draft) => draft.partyId === selectedParty.id && draft.formType === selectedFormId) : undefined;
  const generationByKey = useMemo(() => new Map(generations.map((generation) => [`${generation.partyId}:${generation.templateId}`, generation])), [generations]);
  const savedInlineMappingRows = useMemo(() => buildInlineMappingRows(editableTemplate), [editableTemplate?.id, editableTemplate?.fieldNames, editableTemplate?.fieldMapping]);
  const compactInlineMapping = useMemo(() => compactInlineMappingRows(inlineFieldRows), [inlineFieldRows]);
  const savedCompactInlineMapping = useMemo(() => compactInlineMappingRows(savedInlineMappingRows), [savedInlineMappingRows]);
  const hasInlineMappingChanges = !areMappingsEqual(compactInlineMapping, savedCompactInlineMapping);
  const resolvedFieldByPdfField = useMemo(
    () => new Map((selectedReadiness?.resolvedFields || []).map((field) => [field.pdfField, field])),
    [selectedReadiness?.resolvedFields],
  );
  const missingRequiredFieldSet = useMemo(
    () => new Set((selectedReadiness?.missingRequiredFields || []).map((field) => field.pdfField)),
    [selectedReadiness?.missingRequiredFields],
  );

  useEffect(() => {
    setDraftAnswers(asRecord(selectedDraft?.answers));
  }, [selectedDraft?.id, selectedDraft?.answers, selectedFormId, selectedPartyId]);

  useEffect(() => {
    setInlineFieldRows(savedInlineMappingRows);
  }, [savedInlineMappingRows]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handlePreviewOpenChange = (open: boolean) => {
    setPreviewOpen(open);
    if (!open) {
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewStale(false);
    }
  };

  const handlePreviewDraftAnswerChange = (path: string, value: string) => {
    setDraftAnswers((answers) => setDraftPathValue(answers, path, value));
    setPreviewStale(true);
  };

  const handlePdfFieldOverrideChange = (fieldName: string, value: string | boolean) => {
    setDraftAnswers((answers) => setPdfFieldOverrideValue(answers, fieldName, value));
    setPreviewStale(true);
  };

  const updateInlineMapping = (pdfField: string, patch: Partial<MappingEntry>) => {
    setInlineFieldRows((rows) => rows.map((row) => row.pdfField === pdfField ? { ...row, ...patch } : row));
  };

  const clearInlineMapping = (pdfField: string) => {
    updateInlineMapping(pdfField, { source: "", required: false, defaultValue: null });
  };

  const saveInlineMappingMutation = useMutation({
    mutationFn: async () => {
      if (!editableTemplate) throw new Error("Select a template");
      return apiRequest("PATCH", `/api/cases/${caseId}/court-form-templates/${editableTemplate.id}/mapping`, { fieldMapping: compactInlineMapping });
    },
    onSuccess: async () => {
      toast({ title: "Mapping saved" });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "court-forms"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
    },
    onError: (error: Error) => toast({ title: "Mapping failed", description: error.message, variant: "destructive" }),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!selectedParty || !editableTemplate) throw new Error("Select a party and template");
      return apiRequest("PUT", `/api/cases/${caseId}/court-form-drafts/${selectedFormId}/${selectedParty.id}`, {
        templateId: editableTemplate.id,
        answers: draftAnswers,
        status: "ready_to_generate",
      });
    },
    onSuccess: async () => {
      toast({ title: "Court form draft saved" });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "court-forms"] });
    },
    onError: (error: Error) => toast({ title: "Draft save failed", description: error.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedParty) throw new Error("Select a party");
      return apiRequest("POST", `/api/cases/${caseId}/court-form-generations`, {
        partyId: selectedParty.id,
        formType: selectedFormId,
        recipientEmail: selectedParty.email || null,
        sendEmail: true,
      });
    },
    onSuccess: async () => {
      toast({ title: "Court form generated" });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "court-forms"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "documents"] });
    },
    onError: (error: Error) => toast({ title: "Generation failed", description: error.message, variant: "destructive" }),
  });

  const resendMutation = useMutation({
    mutationFn: async (generationId: string) => apiRequest("POST", `/api/court-form-generations/${generationId}/resend`, {}),
    onSuccess: async () => {
      toast({ title: "Court form resent" });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "court-forms"] });
    },
    onError: (error: Error) => toast({ title: "Resend failed", description: error.message, variant: "destructive" }),
  });
  const previewMutation = useMutation({
    onMutate: () => {
      setPreviewOpen(true);
      setPreviewError(null);
    },
    mutationFn: async () => {
      if (!selectedParty) throw new Error("Select a party");
      if (!editableTemplate) throw new Error("Select a template");
      const res = await fetch(`/api/cases/${caseId}/court-form-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ partyId: selectedParty.id, formType: selectedFormId, templateId: editableTemplate.id, answers: draftAnswers }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to preview court form" }));
        throw new Error(err.message || "Failed to preview court form");
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const previewUrl = URL.createObjectURL(blob);
      setPreviewUrl(previewUrl);
      setPreviewError(null);
      setPreviewOpen(true);
      setPreviewStale(false);
    },
    onError: (error: Error) => {
      setPreviewError(error.message);
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    },
  });

  const selectedFormName = COURT_FORMS.find((form) => form.id === selectedFormId)?.name || selectedFormId;
  const previewTitle = `${selectedFormName} preview${selectedParty ? ` - ${partyHeading(selectedParty)}` : ""}`;
  const miamExpiryDate = miamValidity?.expiresAt
    ? new Date(miamValidity.expiresAt).toLocaleDateString("en-GB")
    : "not recorded";

  return (
    <Card data-testid="card-documents-court-forms">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-heading flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#5a7d58]" />
          Forms
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Generate and track versioned court forms and mediation documents for this case.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!miamValidForCourtAction && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2" data-testid="alert-expired-miam-court-forms">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">MIAM has expired for court applications.</p>
              <p className="text-xs mt-0.5">MIAM expiry: {miamExpiryDate}. Send MIAM Booking Link before issuing court forms or court application packages.</p>
            </div>
          </div>
        )}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Procedural guidance only. This is not legal advice.
        </div>
        <Tabs
          value={activeFormCategory}
          onValueChange={(value) => {
            const category = value as FormCategory;
            setActiveFormCategory(category);
            const firstForm = COURT_FORMS.find((form) => FORM_CATEGORY_BY_TYPE[form.id] === category);
            if (firstForm) setSelectedFormId(firstForm.id);
          }}
        >
          <TabsList>
            {CASE_FORM_CATEGORIES.map((category) => (
              <TabsTrigger key={category.id} value={category.id}>{category.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Form</Label>
            <Select value={selectedFormId} onValueChange={(value) => setSelectedFormId(value as CourtFormId)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{visibleForms.map((form) => <SelectItem key={form.id} value={form.id}>{form.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Party</Label>
            <Select value={selectedParty?.id || ""} onValueChange={setSelectedPartyId}>
              <SelectTrigger><SelectValue placeholder="Select a party" /></SelectTrigger>
              <SelectContent>{sorted.map((party) => <SelectItem key={party.id} value={party.id}>{partyHeading(party)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{COURT_FORMS.find((form) => form.id === selectedFormId)?.name}</p>
            <Badge variant={selectedReadiness?.canGenerate ? "default" : "outline"}>{readinessLabel(selectedReadiness, miamValidForCourtAction)}</Badge>
            {currentTemplate && <Badge variant="outline">Current template {currentTemplate.versionLabel}</Badge>}
            {selectedGeneration && <Badge variant={selectedGeneration.deliveryStatus === "sent" ? "default" : "outline"}>deliveryStatus: {selectedGeneration.deliveryStatus}</Badge>}
          </div>
          {editableTemplate ? (
            <div className="rounded-md border" data-testid="panel-inline-court-form-mapping">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Template field mapping</p>
                  <p className="text-xs text-muted-foreground">
                    Mapping is saved to this template and reused for both parties and future cases.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {hasInlineMappingChanges && <Badge variant="outline">Unsaved changes</Badge>}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMappingOpen(true)}
                    disabled={!canManageCaseForms}
                    data-testid="button-open-mapping-empty-state"
                  >
                    <Settings2 className="w-4 h-4 mr-2" /> Manage mapping
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveInlineMappingMutation.mutate()}
                    disabled={!canManageCaseForms || !hasInlineMappingChanges || saveInlineMappingMutation.isPending}
                  >
                    <Save className="w-4 h-4 mr-2" /> Save mapping
                  </Button>
                </div>
              </div>
              {!canManageCaseForms && (
                <p className="border-b px-3 py-2 text-xs text-muted-foreground">You do not have permission to edit court form mappings.</p>
              )}
              {inlineFieldRows.length > 0 ? (
                <div className="max-h-80 overflow-auto text-xs">
                  {inlineFieldRows.map((field) => {
                    const resolvedField = resolvedFieldByPdfField.get(field.pdfField);
                    const isMapped = Boolean(field.source);
                    const displayedValue = resolvedField?.value || (field.source === "static" ? field.defaultValue || "" : "");
                    const isMissingRequired = isMapped && (missingRequiredFieldSet.has(field.pdfField) || (field.required && !displayedValue.trim()));
                    const statusLabel = !isMapped ? "Unmapped" : isMissingRequired ? "Required missing data" : displayedValue ? "Resolved" : "Mapped";
                    const statusVariant = !isMapped || isMissingRequired ? "outline" : "secondary";
                    return (
                      <div
                        key={field.pdfField}
                        className="grid gap-2 border-b px-3 py-3 last:border-b-0 lg:grid-cols-[minmax(180px,1.2fr)_minmax(220px,1fr)_112px_minmax(160px,1fr)_44px]"
                        data-testid={`row-inline-court-form-field-${field.pdfField}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium leading-snug break-words">{formatPdfFieldLabel(field.pdfField)}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground break-words">{field.pdfField}</p>
                        </div>
                        <div className="min-w-0">
                          {canManageCaseForms ? (
                            <SourceMappingPicker
                              value={field.source}
                              onChange={(value) => updateInlineMapping(field.pdfField, { source: value, defaultValue: value === "static" ? field.defaultValue || "" : null })}
                              groups={sourceGroupsQuery.data}
                            />
                          ) : (
                            <p className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground break-words">
                              {field.source ? getCourtFormMergeSourceLabel(field.source) : "No source mapped"}
                            </p>
                          )}
                          {field.source === "static" && (
                            <Input
                              className="mt-2"
                              value={field.defaultValue || ""}
                              onChange={(e) => updateInlineMapping(field.pdfField, { defaultValue: e.target.value })}
                              placeholder="Static value"
                              disabled={!canManageCaseForms}
                            />
                          )}
                        </div>
                        <label className="flex h-9 items-center gap-2 rounded-md border px-2 text-xs">
                          <Checkbox
                            checked={Boolean(field.required)}
                            onCheckedChange={(checked) => updateInlineMapping(field.pdfField, { required: checked === true })}
                            disabled={!canManageCaseForms || !field.source}
                          />
                          Required
                        </label>
                        <div className="min-w-0 space-y-1">
                          <Badge variant={statusVariant}>{statusLabel}</Badge>
                          {isMapped && (
                            <p className={displayedValue ? "break-words text-foreground" : "break-words text-muted-foreground"}>
                              {displayedValue || "No value available"}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => clearInlineMapping(field.pdfField)}
                          disabled={!canManageCaseForms || !field.source}
                          aria-label="Clear mapping"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="p-3 text-xs text-muted-foreground">No extracted PDF fields are available for this template.</p>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground space-y-2">
              <p>No uploaded template is available for this form.</p>
            </div>
          )}
          {selectedReadiness?.missingRequiredFields.some((field) => field.source.startsWith("draft.")) && (
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">Missing case data</p>
              {selectedReadiness.missingRequiredFields.filter((field) => field.source.startsWith("draft.") && field.draftKey).map((field) => (
                <div key={field.source} className="space-y-1.5">
                  <Label className="text-xs">{field.pdfField}</Label>
                  <Input
                    value={getDraftPathValue(draftAnswers, field.draftKey || "")}
                    onChange={(e) => setDraftAnswers((answers) => setDraftPathValue(answers, field.draftKey || "", e.target.value))}
                    placeholder={field.source}
                  />
                </div>
              ))}
            </div>
          )}
          {selectedReadiness?.missingRequiredFields.some((field) => !field.source.startsWith("draft.")) && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Some required values are missing from CRM, demographic, or MIAM data. Update the source record, or ask an admin to map those PDF fields to draft fields.
            </p>
          )}
          <Textarea
            value={getDraftPathValue(draftAnswers, "notes")}
            onChange={(e) => setDraftAnswers((answers) => setDraftPathValue(answers, "notes", e.target.value))}
            className="min-h-20"
            placeholder="Optional draft notes."
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => saveDraftMutation.mutate()} disabled={!canManageCaseForms || !editableTemplate || !selectedParty || saveDraftMutation.isPending}>
              <Save className="w-4 h-4 mr-2" /> Save draft
            </Button>
            <Button variant="outline" onClick={() => setMappingOpen(true)} disabled={!canManageCaseForms || !editableTemplate}>
              <Settings2 className="w-4 h-4 mr-2" /> Manage mapping
            </Button>
            <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!canPreviewCourtForm || !editableTemplate || !selectedParty || previewMutation.isPending}>
              <Eye className="w-4 h-4 mr-2" /> Preview filled PDF
            </Button>
            <Button className="bg-[#5a7d58] hover:bg-[#4a6d48]" onClick={() => generateMutation.mutate()} disabled={!canManageCaseForms || !selectedReadiness?.canGenerate || !selectedParty || generateMutation.isPending}>
              <Send className="w-4 h-4 mr-2" /> Generate locked PDF
            </Button>
            {selectedGeneration && (
              <Button variant="outline" onClick={() => resendMutation.mutate(selectedGeneration.id)} disabled={!canManageCaseForms || resendMutation.isPending}>
                <RefreshCw className="w-4 h-4 mr-2" /> Resend
              </Button>
            )}
          </div>
        </div>
        <CourtFormMappingDialog
          open={mappingOpen}
          onOpenChange={setMappingOpen}
          template={editableTemplate}
          caseId={caseId}
          sourceGroups={sourceGroupsQuery.data}
        />
        <CourtFormPdfEditorDialog
          open={previewOpen}
          onOpenChange={handlePreviewOpenChange}
          title={previewTitle}
          previewUrl={previewUrl}
          isLoading={previewMutation.isPending}
          error={previewError}
          onRetry={() => previewMutation.mutate()}
          mapping={Array.isArray(editableTemplate?.fieldMapping) ? editableTemplate.fieldMapping : []}
          resolvedFields={selectedReadiness?.resolvedFields || []}
          draftAnswers={draftAnswers}
          previewStale={previewStale}
          fieldNames={editableTemplate?.fieldNames || []}
          fieldMetadata={editableTemplate?.fieldMetadata || []}
          onDraftAnswerChange={handlePreviewDraftAnswerChange}
          onPdfFieldOverrideChange={handlePdfFieldOverrideChange}
          onSaveDraft={() => saveDraftMutation.mutate()}
          canSaveDraft={canManageCaseForms && Boolean(editableTemplate && selectedParty)}
          isSavingDraft={saveDraftMutation.isPending}
        />
        <div className="grid gap-3">
          {visibleForms.map((form) => {
            const formTemplates = templates.filter((template) => template.formType === form.id);
            const representativeReadiness = sorted[0] ? readiness.find((item) => item.partyId === sorted[0].id && item.formType === form.id) : undefined;
            return (
              <div key={form.id} className="rounded-md border p-3" data-testid={`card-documents-form-${form.id.toLowerCase()}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{form.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{form.description}</p>
                  </div>
                  <Badge variant={representativeReadiness?.canGenerate ? "default" : "outline"}>{readinessLabel(representativeReadiness, miamValidForCourtAction)}</Badge>
                </div>
                {sorted.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sorted.map((party) => {
                      const current = formTemplates.find((template) => template.isCurrent);
                      const generation = current ? generationByKey.get(`${party.id}:${current.id}`) : latestGeneration(generations, party.id, templates, form.id);
                      return (
                        <div key={party.id} className="flex items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">{partyHeading(party)}:</span>
                          <CourtFormCellPill state={stateFromGeneration(generation, deriveCourtFormState(form.id, party.role, stageIdx))} partyId={party.id} formId={form.id} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {(guidanceQuery.data || []).length > 0 && (
          <div className="space-y-2">
            {(guidanceQuery.data || []).map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.sectionTitle}</p>
                  <Badge variant={item.legalSignoffStatus === "approved" ? "default" : "outline"}>{item.legalSignoffStatus}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{item.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
