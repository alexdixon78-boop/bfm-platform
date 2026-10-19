import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, FileText, Loader2, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  FieldMappingPicker,
  SourceMappingPicker,
  formatPdfFieldLabel,
  type PdfFieldOption,
} from "@/components/court-forms/court-form-mapping-picker";
import { type CourtFormMergeSourceGroup } from "@shared/court-form-merge-sources";
import { FORM_CATALOGUE as FORM_TYPES, FORM_CATEGORIES, FORM_CATEGORY_BY_TYPE, type FormCategory } from "@shared/court-form-catalog";

const COURT_FORM_UPLOAD_TYPES = FORM_TYPES.filter((form) => form.id !== "VoucherDiversityQuestionnaireOptIn");

const DEFAULT_FORM_CATEGORY = "court";

function formLabelForTemplateLibrary(formType: string): string {
  return FORM_TYPES.find((form) => form.id === formType)?.label || formType;
}

type MappingEntry = { pdfField: string; source: string; required?: boolean; defaultValue?: string | null };
type Template = {
  id: string;
  formType: string;
  versionLabel: string;
  sourceFileName: string;
  isCurrent: boolean;
  uploadedAt: string;
  notes?: string | null;
  verifiedCurrentAt?: string | null;
  fieldNames: string[];
  fieldMapping: MappingEntry[];
};
type TemplateReuploadResponse = {
  template: Template;
  removedMappings: MappingEntry[];
};
type MappingAuditRow = {
  pdfField: string;
  currentSource: string | null;
  proposedSource: string | null;
  status: "mapped" | "corrected" | "ignored" | "unmapped" | "stale" | "ambiguous";
  sourceLabel: string | null;
  candidates: Array<{ source: string; sourceLabel: string; score: number }>;
};
type MappingAudit = {
  rows: MappingAuditRow[];
  staleMappings: MappingEntry[];
  summary: {
    fieldCount: number;
    mapped: number;
    corrected?: number;
    ignored?: number;
    unmapped: number;
    stale: number;
    ambiguous?: number;
  };
};
type Guidance = {
  id: string;
  formType: string;
  templateId?: string | null;
  sectionKey: string;
  sectionTitle: string;
  body: string;
  sortOrder: number;
  legalSignoffStatus: "draft" | "pending_review" | "approved";
};
type UploadProgressStep = "preparing" | "uploading" | "extracting" | "refreshing";
type UploadProgressStatus = "pending" | "error";
type UploadProgressMode = "upload" | "reupload";

const UPLOAD_PROGRESS_STEPS: Array<{ id: UploadProgressStep; label: string }> = [
  { id: "preparing", label: "Preparing PDF" },
  { id: "uploading", label: "Uploading template" },
  { id: "extracting", label: "Extracting PDF fields" },
  { id: "refreshing", label: "Refreshing template library" },
];

function getPdfFieldOptions(fieldNames: string[] = []): PdfFieldOption[] {
  return fieldNames.map((field) => ({ raw: field, label: formatPdfFieldLabel(field) }));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CourtFormsPage() {
  const { toast } = useToast();
  const [activeFormCategory, setActiveFormCategory] = useState<FormCategory>(DEFAULT_FORM_CATEGORY);
  const [formType, setFormType] = useState("FM1");
  const [versionLabel, setVersionLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [mapping, setMapping] = useState<MappingEntry[]>([]);
  const [sectionTitle, setSectionTitle] = useState("");
  const [guidanceBody, setGuidanceBody] = useState("");
  const [verifiedDate, setVerifiedDate] = useState("");
  const [uploadProgressOpen, setUploadProgressOpen] = useState(false);
  const [uploadProgressStep, setUploadProgressStep] = useState<UploadProgressStep>("preparing");
  const [uploadProgressStatus, setUploadProgressStatus] = useState<UploadProgressStatus>("pending");
  const [uploadProgressError, setUploadProgressError] = useState("");
  const [uploadProgressMode, setUploadProgressMode] = useState<UploadProgressMode>("upload");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [reuploadOpen, setReuploadOpen] = useState(false);
  const [reuploadFile, setReuploadFile] = useState<File | null>(null);
  const [reuploadNotes, setReuploadNotes] = useState("");
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<Template | null>(null);

  const templatesQuery = useQuery<Template[]>({
    queryKey: ["/api/court-form-templates"],
  });
  const activeCategory = FORM_CATEGORIES.find((category) => category.id === activeFormCategory)!;
  const visibleUploadTypes = useMemo(
    () => COURT_FORM_UPLOAD_TYPES.filter((form) => FORM_CATEGORY_BY_TYPE[form.id] === activeFormCategory),
    [activeFormCategory],
  );
  const filteredTemplates = useMemo(
    () => (templatesQuery.data || []).filter((template) => FORM_CATEGORY_BY_TYPE[template.formType] === activeFormCategory),
    [activeFormCategory, templatesQuery.data],
  );
  const selectedTemplate = useMemo(
    () => filteredTemplates.find((template) => template.id === selectedTemplateId) || filteredTemplates?.[0],
    [filteredTemplates, selectedTemplateId],
  );
  const pdfFieldOptions = useMemo(() => getPdfFieldOptions(selectedTemplate?.fieldNames || []), [selectedTemplate?.fieldNames]);
  const guidanceQuery = useQuery<Guidance[]>({
    queryKey: ["/api/court-form-guidance", selectedTemplate?.formType, selectedTemplate?.id],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedTemplate?.formType) params.set("formType", selectedTemplate.formType);
      if (selectedTemplate?.id) params.set("templateId", selectedTemplate.id);
      const res = await fetch(`/api/court-form-guidance?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load guidance");
      return res.json();
    },
    enabled: Boolean(selectedTemplate),
  });
  const sourceGroupsQuery = useQuery<CourtFormMergeSourceGroup[]>({
    queryKey: ["/api/court-form-merge-sources"],
  });
  const mappingAuditQuery = useQuery<MappingAudit>({
    queryKey: ["/api/court-form-templates", selectedTemplate?.id, "mapping-audit"],
    queryFn: async () => {
      if (!selectedTemplate) throw new Error("Select a template");
      const res = await fetch(`/api/court-form-templates/${selectedTemplate.id}/mapping-audit`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load mapping audit");
      return res.json();
    },
    enabled: selectedTemplate?.formType === "FinancialDisclosureBooklet" || selectedTemplate?.formType === "DraftFinancialSchedule",
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a PDF template file");
      setUploadProgressMode("upload");
      setUploadProgressOpen(true);
      setUploadProgressStatus("pending");
      setUploadProgressError("");
      setUploadProgressStep("preparing");
      const fileData = await fileToDataUrl(file);
      setUploadProgressStep("uploading");
      const body = {
        formType,
        versionLabel,
        sourceFileName: file.name,
        mimeType: file.type || "application/pdf",
        fileData,
        notes,
      };
      setUploadProgressStep("extracting");
      return apiRequest("POST", "/api/court-form-templates", body);
    },
    onSuccess: async () => {
      setUploadProgressStep("refreshing");
      toast({ title: "Template uploaded" });
      setFile(null);
      setVersionLabel("");
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
      setUploadProgressOpen(false);
    },
    onError: (error: Error) => {
      setUploadProgressStatus("error");
      setUploadProgressError(error.message);
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const reuploadMutation = useMutation({
    mutationFn: async (): Promise<TemplateReuploadResponse> => {
      if (!selectedTemplate) throw new Error("Select a template");
      if (!reuploadFile) throw new Error("Choose a replacement PDF file");
      setUploadProgressMode("reupload");
      setUploadProgressOpen(true);
      setUploadProgressStatus("pending");
      setUploadProgressError("");
      setUploadProgressStep("preparing");
      const fileData = await fileToDataUrl(reuploadFile);
      setUploadProgressStep("uploading");
      const body = {
        sourceFileName: reuploadFile.name,
        mimeType: reuploadFile.type || "application/pdf",
        fileData,
        notes: reuploadNotes.trim() ? reuploadNotes : null,
      };
      setUploadProgressStep("extracting");
      const res = await apiRequest("POST", `/api/court-form-templates/${selectedTemplate.id}/reupload`, body);
      return res.json();
    },
    onSuccess: async ({ template: updatedTemplate, removedMappings }) => {
      setUploadProgressStep("refreshing");
      setSelectedTemplateId(updatedTemplate.id);
      setMapping(Array.isArray(updatedTemplate.fieldMapping) ? updatedTemplate.fieldMapping : []);
      setReuploadFile(null);
      setReuploadNotes("");
      setReuploadOpen(false);
      const removedCount = removedMappings?.length || 0;
      toast({
        title: "PDF replaced",
        description: removedCount > 0 ? `${removedCount} mappings need review.` : "Existing mappings were preserved.",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
      setUploadProgressOpen(false);
    },
    onError: (error: Error) => {
      setUploadProgressStatus("error");
      setUploadProgressError(error.message);
      toast({ title: "Replace PDF failed", description: error.message, variant: "destructive" });
    },
  });

  const saveMappingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate) throw new Error("Select a template");
      return apiRequest("PATCH", `/api/court-form-templates/${selectedTemplate.id}/mapping`, { fieldMapping: mapping });
    },
    onSuccess: async () => {
      toast({ title: "Mapping saved" });
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates", selectedTemplate?.id, "mapping-audit"] });
    },
    onError: (error: Error) => toast({ title: "Mapping failed", description: error.message, variant: "destructive" }),
  });

  const markCurrentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate) throw new Error("Select a template");
      return apiRequest("POST", `/api/court-form-templates/${selectedTemplate.id}/mark-current`, {
        verifiedCurrentAt: selectedTemplate.formType === "FormE" ? verifiedDate : null,
      });
    },
    onSuccess: async () => {
      toast({ title: "Current template updated" });
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
    },
    onError: (error: Error) => toast({ title: "Current update failed", description: error.message, variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTemplateTarget) throw new Error("Select a template to delete");
      return apiRequest("DELETE", `/api/court-form-templates/${deleteTemplateTarget.id}`);
    },
    onSuccess: async () => {
      const deletedId = deleteTemplateTarget?.id;
      toast({ title: "Template deleted" });
      setDeleteTemplateTarget(null);
      if (deletedId && selectedTemplate?.id === deletedId) {
        setSelectedTemplateId("");
        setMapping([]);
        setPreviewOpen(false);
        setReuploadOpen(false);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-templates"] });
    },
    onError: (error: Error) => toast({ title: "Delete failed", description: error.message, variant: "destructive" }),
  });

  const createGuidanceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate) throw new Error("Select a template");
      return apiRequest("POST", "/api/court-form-guidance", {
        formType: selectedTemplate.formType,
        templateId: selectedTemplate.id,
        sectionKey: sectionTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        sectionTitle,
        body: guidanceBody,
        legalSignoffStatus: "draft",
      });
    },
    onSuccess: async () => {
      toast({ title: "Guidance saved" });
      setSectionTitle("");
      setGuidanceBody("");
      await queryClient.invalidateQueries({ queryKey: ["/api/court-form-guidance", selectedTemplate?.formType, selectedTemplate?.id] });
    },
    onError: (error: Error) => toast({ title: "Guidance failed", description: error.message, variant: "destructive" }),
  });

  const loadMapping = (template: Template) => {
    setSelectedTemplateId(template.id);
    setMapping(Array.isArray(template.fieldMapping) ? template.fieldMapping : []);
    setVerifiedDate(template.verifiedCurrentAt ? template.verifiedCurrentAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setPreviewLoaded(false);
    setPreviewError(false);
  };

  const openTemplatePreview = () => {
    setPreviewLoaded(false);
    setPreviewError(false);
    setPreviewOpen(true);
  };

  const openReuploadDialog = () => {
    setReuploadFile(null);
    setReuploadNotes(selectedTemplate?.notes || "");
    setReuploadOpen(true);
  };

  const handleCategoryChange = (value: string) => {
    const category = value as FormCategory;
    setActiveFormCategory(category);
    setSelectedTemplateId("");
    setMapping([]);
    setPreviewOpen(false);
    setReuploadOpen(false);
    if (FORM_CATEGORY_BY_TYPE[formType] !== category) {
      const firstVisibleForm = COURT_FORM_UPLOAD_TYPES.find((form) => FORM_CATEGORY_BY_TYPE[form.id] === category);
      if (firstVisibleForm) setFormType(firstVisibleForm.id);
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="page-court-forms">
      <div>
        <h1 className="text-2xl font-heading font-semibold text-foreground">Forms</h1>
        <p className="text-sm text-muted-foreground">Manage versioned form templates, mappings, and procedural guidance.</p>
      </div>

      <Tabs value={activeFormCategory} onValueChange={handleCategoryChange}>
        <TabsList>
          {FORM_CATEGORIES.map((category) => (
            <TabsTrigger key={category.id} value={category.id}>{category.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div>
        <h2 className="text-lg font-heading font-semibold text-foreground">{activeCategory.label}</h2>
        <p className="text-sm text-muted-foreground">{activeCategory.description}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" /> Upload template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Form</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{visibleUploadTypes.map((form) => <SelectItem key={form.id} value={form.id}>{form.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Version label</Label>
              <Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. GOV.UK 2026-03" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PDF template</Label>
              <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20" />
            </div>
            <Button className="w-full bg-[#5a7d58] hover:bg-[#4a6d48]" onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending || !file || !versionLabel.trim()}>
              {uploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload and extract PDF fields
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Template library</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                role="button"
                tabIndex={0}
                onClick={() => loadMapping(template)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") loadMapping(template);
                }}
                className="w-full cursor-pointer rounded-md border p-3 text-left hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{formLabelForTemplateLibrary(template.formType)} - {template.versionLabel}</p>
                    <p className="text-xs text-muted-foreground">{template.sourceFileName} | extracted PDF fields: {template.fieldNames?.length || 0}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {template.isCurrent && <Badge>Current</Badge>}
                    {template.formType === "FormE" && <Badge variant="outline">verified against GOV.UK {template.verifiedCurrentAt ? template.verifiedCurrentAt.slice(0, 10) : "pending"}</Badge>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteTemplateTarget(template);
                      }}
                      data-testid={`button-delete-court-form-template-${template.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {templatesQuery.data && filteredTemplates.length === 0 && <p className="text-sm text-muted-foreground">No {activeFormCategory === "court" ? "court form" : "mediation document"} templates uploaded.</p>}
          </CardContent>
        </Card>
      </div>

      {selectedTemplate && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Mapping</CardTitle>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openReuploadDialog}
                  disabled={!selectedTemplate}
                  data-testid="button-replace-template-pdf"
                >
                  <Upload className="w-4 h-4 mr-2" /> Replace PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openTemplatePreview}
                  disabled={!selectedTemplate}
                  data-testid="button-preview-template-pdf"
                >
                  <Eye className="w-4 h-4 mr-2" /> Preview uploaded PDF
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-40 overflow-auto rounded-md border text-xs text-muted-foreground">
                {pdfFieldOptions.map((field) => (
                  <div key={field.raw} className="border-b px-2 py-1.5 last:border-b-0 break-words leading-snug">
                    {field.label}
                  </div>
                ))}
              </div>
              {(selectedTemplate.formType === "FinancialDisclosureBooklet" || selectedTemplate.formType === "DraftFinancialSchedule") && (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-3"
                >
                  {selectedTemplate.formType === "DraftFinancialSchedule" ? (
                    <span className="sr-only" data-testid="card-draft-financial-schedule-mapping-audit" />
                  ) : (
                    <span className="sr-only" data-testid="card-financial-disclosure-booklet-mapping-audit" />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-amber-950">{formLabelForTemplateLibrary(selectedTemplate.formType)} mapping audit</p>
                      <p className="text-xs text-amber-900">
                        Compares uploaded PDF field names with the supported CRM sources before preview/export repairs mapping.
                      </p>
                    </div>
                    {mappingAuditQuery.data?.summary && (
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Badge variant="outline">{mappingAuditQuery.data.summary.mapped} mapped</Badge>
                        {Boolean(mappingAuditQuery.data.summary.corrected) && <Badge variant="secondary">{mappingAuditQuery.data.summary.corrected} corrected</Badge>}
                        {Boolean(mappingAuditQuery.data.summary.ignored) && <Badge variant="secondary">{mappingAuditQuery.data.summary.ignored} preview-only</Badge>}
                        <Badge variant="secondary">{mappingAuditQuery.data.summary.stale} stale</Badge>
                        {typeof mappingAuditQuery.data.summary.ambiguous === "number" && (
                          <Badge variant="secondary">{mappingAuditQuery.data.summary.ambiguous} ambiguous</Badge>
                        )}
                        <Badge variant="secondary">{mappingAuditQuery.data.summary.unmapped} unmapped</Badge>
                      </div>
                    )}
                  </div>
                  {mappingAuditQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Auditing mappings...
                    </div>
                  ) : mappingAuditQuery.isError ? (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4" /> Mapping audit could not be loaded.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-auto rounded-md border bg-background">
                      {(mappingAuditQuery.data?.rows || []).slice(0, 120).map((row) => (
                        <div
                          key={row.pdfField}
                          className="grid gap-2 border-b p-2 text-xs last:border-b-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_90px]"
                        >
                          {selectedTemplate.formType === "DraftFinancialSchedule" ? (
                            <span className="sr-only" data-testid="row-draft-financial-schedule-mapping-audit" />
                          ) : (
                            <span className="sr-only" data-testid="row-booklet-mapping-audit" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium break-words">{formatPdfFieldLabel(row.pdfField)}</p>
                            <p className="text-muted-foreground break-words">{row.pdfField}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-muted-foreground">Current</p>
                            <p className="break-words">{row.currentSource || "Not mapped"}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-muted-foreground">Proposed</p>
                            <p className="break-words">{row.proposedSource || row.candidates[0]?.source || "Needs manual review"}</p>
                            {row.sourceLabel && <p className="mt-1 text-muted-foreground break-words">{row.sourceLabel}</p>}
                          </div>
                          <div className="flex items-start justify-end">
                            <Badge variant={row.status === "mapped" ? "default" : row.status === "stale" ? "destructive" : "secondary"}>
                              {row.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mapping.map((entry, index) => (
                <div key={`${entry.pdfField}-${index}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_90px_90px]">
                  <FieldMappingPicker
                    value={entry.pdfField}
                    options={pdfFieldOptions}
                    onChange={(value) => setMapping((rows) => rows.map((row, i) => i === index ? { ...row, pdfField: value } : row))}
                  />
                  <SourceMappingPicker value={entry.source} onChange={(value) => setMapping((rows) => rows.map((row, i) => i === index ? { ...row, source: value } : row))} groups={sourceGroupsQuery.data} />
                  <label className="flex items-center gap-2 rounded-md border px-2 text-xs">
                    <Checkbox checked={Boolean(entry.required)} onCheckedChange={(checked) => setMapping((rows) => rows.map((row, i) => i === index ? { ...row, required: checked === true } : row))} />
                    Required
                  </label>
                  <Button variant="outline" onClick={() => setMapping((rows) => rows.filter((_, i) => i !== index))}>Remove</Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setMapping((rows) => [...rows, { pdfField: pdfFieldOptions[0]?.raw || "", source: "draft.notes", required: false }])}>Add mapping</Button>
                <Button onClick={() => saveMappingMutation.mutate()} disabled={saveMappingMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" /> Save mapping
                </Button>
              </div>
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Current version control</p>
                {selectedTemplate.formType === "FormE" && (
                  <Input type="date" value={verifiedDate} onChange={(e) => setVerifiedDate(e.target.value)} aria-label="Form E verified against GOV.UK date" />
                )}
                <Button variant="outline" onClick={() => markCurrentMutation.mutate()} disabled={markCurrentMutation.isPending || (selectedTemplate.formType === "FormE" && !verifiedDate)}>
                  <RefreshCw className="w-4 h-4 mr-2" /> Mark current
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Guidance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Procedural guidance only. This is not legal advice.
              </div>
              {(guidanceQuery.data || []).map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{item.sectionTitle}</p>
                    <Badge variant={item.legalSignoffStatus === "approved" ? "default" : "outline"}>{item.legalSignoffStatus}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{item.body}</p>
                </div>
              ))}
              <div className="space-y-2">
                <Input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} placeholder="Section title" />
                <Textarea value={guidanceBody} onChange={(e) => setGuidanceBody(e.target.value)} placeholder="Procedural completion guidance" className="min-h-28" />
                <Button onClick={() => createGuidanceMutation.mutate()} disabled={createGuidanceMutation.isPending || !sectionTitle.trim() || !guidanceBody.trim()}>
                  <Save className="w-4 h-4 mr-2" /> Save guidance
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      <Dialog open={reuploadOpen} onOpenChange={setReuploadOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-template-pdf-reupload">
          <DialogHeader>
            <DialogTitle>Replace PDF</DialogTitle>
            <DialogDescription>
              Upload a replacement PDF for this existing template. Matching field mappings will be kept, and mappings for removed PDF fields will need review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{selectedTemplate ? `${selectedTemplate.formType} - ${selectedTemplate.versionLabel}` : "Selected template"}</p>
              <p className="text-xs text-muted-foreground">{selectedTemplate?.sourceFileName}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Replacement PDF</Label>
              <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setReuploadFile(e.target.files?.[0] || null)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={reuploadNotes} onChange={(e) => setReuploadNotes(e.target.value)} className="min-h-20" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReuploadOpen(false)} disabled={reuploadMutation.isPending}>Cancel</Button>
            <Button onClick={() => reuploadMutation.mutate()} disabled={reuploadMutation.isPending || !reuploadFile}>
              {reuploadMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Replace PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DeleteDialog
        open={Boolean(deleteTemplateTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTemplateTarget(null);
        }}
        title="Delete court form template?"
        description="This removes the template from active use but keeps historical generated documents."
        confirmLabel="Delete template"
        onConfirm={() => deleteTemplateMutation.mutate()}
        isPending={deleteTemplateMutation.isPending}
        confirmTestId="dialog-delete-court-form-template-confirm"
        cancelTestId="dialog-delete-court-form-template-cancel"
      />
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-7xl max-h-[92vh] overflow-hidden flex flex-col" data-testid="dialog-template-pdf-preview">
          <DialogHeader>
            <DialogTitle>{selectedTemplate ? `${selectedTemplate.sourceFileName} preview` : "Template preview"}</DialogTitle>
            <DialogDescription>
              Review the uploaded template before or while maintaining its field mapping.
            </DialogDescription>
          </DialogHeader>
          <div className="relative rounded-md border bg-muted/30 overflow-hidden">
            {!previewLoaded && !previewError && (
              <div className="absolute inset-0 z-10 flex h-[70vh] items-center justify-center bg-background/80 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF...
              </div>
            )}
            {previewError ? (
              <div className="flex h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-destructive">The uploaded PDF could not be loaded.</p>
                <Button variant="outline" onClick={openTemplatePreview}>Retry</Button>
              </div>
            ) : selectedTemplate ? (
              <iframe
                title={`${selectedTemplate.sourceFileName} preview`}
                src={`/api/court-form-templates/${selectedTemplate.id}/preview`}
                className="h-[70vh] w-full border-0 bg-white"
                onLoad={() => setPreviewLoaded(true)}
                onError={() => setPreviewError(true)}
                data-testid="iframe-template-pdf-preview"
              />
            ) : (
              <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
                Select a template to preview.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={uploadProgressOpen} onOpenChange={(open) => {
        if (!uploadMutation.isPending && !reuploadMutation.isPending) setUploadProgressOpen(open);
      }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-court-form-upload-progress">
          <DialogHeader>
            <DialogTitle>
              {uploadProgressStatus === "error"
                ? uploadProgressMode === "reupload" ? "Replace PDF failed" : "Upload failed"
                : uploadProgressMode === "reupload" ? "Replacing court form PDF" : "Uploading court form"}
            </DialogTitle>
            <DialogDescription>
              {uploadProgressStatus === "error"
                ? "The template was not uploaded. Review the message below, then close this dialog and try again."
                : "Please keep this page open while the template is uploaded and PDF fields are extracted."}
            </DialogDescription>
          </DialogHeader>
          {uploadProgressStatus === "error" ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{uploadProgressError || "Upload failed"}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {UPLOAD_PROGRESS_STEPS.map((step) => {
                const active = step.id === uploadProgressStep;
                return (
                  <div key={step.id} className="flex items-center gap-3 text-sm">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${active ? "border-[#5a7d58] text-[#5a7d58]" : "border-muted text-muted-foreground"}`}>
                      {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>{step.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          {uploadProgressStatus === "error" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setUploadProgressOpen(false)}>Close</Button>
              <Button
                onClick={() => uploadProgressMode === "reupload" ? reuploadMutation.mutate() : uploadMutation.mutate()}
                disabled={uploadProgressMode === "reupload" ? (!selectedTemplate || !reuploadFile) : (!file || !versionLabel.trim())}
              >
                Retry upload
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
