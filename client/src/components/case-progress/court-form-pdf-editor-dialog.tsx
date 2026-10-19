import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getCourtFormMergeSourceLabel } from "@shared/court-form-merge-sources";
import { PDF_FIELD_OVERRIDES_KEY } from "@shared/court-form-pdf-overrides";
import { formatPdfFieldLabel } from "@/components/court-forms/court-form-mapping-picker";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type CourtFormFieldMetadata = {
  name: string;
  type: "text" | "checkbox" | "radio" | "select" | "unsupported";
  pageIndex: number;
  widgetIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  options?: string[];
  exportValue?: string | null;
};

type MappingEntry = { pdfField: string; source: string; required?: boolean; defaultValue?: string | null };
type ResolvedField = { pdfField: string; source: string; value: string; required: boolean };

type CourtFormPdfEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  previewUrl: string | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  mapping: MappingEntry[];
  resolvedFields: ResolvedField[];
  draftAnswers: Record<string, unknown>;
  previewStale: boolean;
  diagnosticNotice?: ReactNode;
  fieldNames: string[];
  fieldMetadata: CourtFormFieldMetadata[];
  onDraftAnswerChange: (path: string, value: string) => void;
  onPdfFieldOverrideChange: (fieldName: string, value: string | boolean) => void;
  onSaveDraft: () => void;
  canSaveDraft: boolean;
  isSavingDraft: boolean;
};

type PageView = { pageIndex: number; width: number; height: number; scale: number };
type PreviewFieldRow = {
  name: string;
  metadata?: CourtFormFieldMetadata;
  mapping?: MappingEntry;
  resolved?: ResolvedField;
};

function asOverrideRecord(answers: Record<string, unknown>): Record<string, unknown> {
  const raw = answers[PDF_FIELD_OVERRIDES_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function getDraftPathValue(answers: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, answers);
  return value == null ? "" : String(value);
}

function overlayStyle(field: CourtFormFieldMetadata, page: PageView): CSSProperties {
  const { rect } = field;
  return {
    left: rect.x * page.scale,
    top: page.height - ((rect.y + rect.height) * page.scale),
    width: Math.max(rect.width * page.scale, field.type === "checkbox" || field.type === "radio" ? 18 : 42),
    height: Math.max(rect.height * page.scale, field.type === "checkbox" || field.type === "radio" ? 18 : 24),
  };
}

function fieldValue(field: CourtFormFieldMetadata, overrides: Record<string, unknown>, resolvedByName: Map<string, ResolvedField>): string {
  return pdfFieldValue(field.name, overrides, resolvedByName);
}

function pdfFieldValue(fieldName: string, overrides: Record<string, unknown>, resolvedByName: Map<string, ResolvedField>): string {
  const override = overrides[fieldName];
  if (typeof override === "boolean") return override ? "true" : "";
  if (override != null) return String(override);
  return resolvedByName.get(fieldName)?.value || "";
}

function isCheckedValue(value: string): boolean {
  return /^(true|yes|checked|1|on|y)$/i.test(value.trim());
}

function buildPreviewFieldRows(
  fieldNames: string[],
  fieldMetadata: CourtFormFieldMetadata[],
  mappingByName: Map<string, MappingEntry>,
  resolvedByName: Map<string, ResolvedField>,
): PreviewFieldRow[] {
  const orderedNames = fieldNames.length
    ? fieldNames.map((fieldName) => fieldName)
    : Array.from(new Set(fieldMetadata.map((field) => field.name)));
  return orderedNames.map((name) => ({
    name,
    metadata: fieldMetadata.find((field) => field.name === name),
    mapping: mappingByName.get(name),
    resolved: resolvedByName.get(name),
  }));
}

function PdfPageCanvas({ pdf, page }: { pdf: PDFDocumentProxy; page: PageView }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;

    async function renderPage() {
      const pdfPage = await pdf.getPage(page.pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: page.scale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) return;
      renderTask = pdfPage.render({ canvasContext, viewport });
      await renderTask.promise.catch(() => undefined);
    }

    renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [page.pageIndex, page.scale, pdf]);

  return <canvas ref={canvasRef} className="block bg-white shadow-sm" />;
}

export function CourtFormPdfEditorDialog({
  open,
  onOpenChange,
  title,
  previewUrl,
  isLoading,
  error,
  onRetry,
  mapping,
  resolvedFields,
  draftAnswers,
  previewStale,
  diagnosticNotice,
  fieldNames,
  fieldMetadata,
  onDraftAnswerChange,
  onPdfFieldOverrideChange,
  onSaveDraft,
  canSaveDraft,
  isSavingDraft,
}: CourtFormPdfEditorDialogProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const overrides = useMemo(() => asOverrideRecord(draftAnswers), [draftAnswers]);
  const mappingByName = useMemo(() => new Map(mapping.map((entry) => [entry.pdfField, entry])), [mapping]);
  const resolvedByName = useMemo(() => new Map(resolvedFields.map((field) => [field.pdfField, field])), [resolvedFields]);
  const previewFieldRows = useMemo(
    () => buildPreviewFieldRows(fieldNames, fieldMetadata, mappingByName, resolvedByName),
    [fieldNames, fieldMetadata, mappingByName, resolvedByName],
  );

  useEffect(() => {
    if (!open || !previewUrl) return;
    let cancelled = false;
    let loadedPdf: PDFDocumentProxy | null = null;
    const loadingTask = getDocument(previewUrl);
    loadingTask.promise.then(async (document) => {
      if (cancelled) {
        document.destroy();
        return;
      }
      loadedPdf = document;
      const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1.25 });
        return { pageIndex: index, width: viewport.width, height: viewport.height, scale: 1.25 };
      }));
      if (!cancelled) {
        setPdf(document);
        setPageViews(pages);
      }
    }).catch(() => {
      if (!cancelled) {
        setPdf(null);
        setPageViews([]);
      }
    });
    return () => {
      cancelled = true;
      loadingTask.destroy();
      loadedPdf?.destroy();
      setPdf(null);
      setPageViews([]);
    };
  }, [open, previewUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-7xl max-h-[92vh] overflow-hidden flex flex-col" data-testid="dialog-court-form-preview">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {diagnosticNotice}
        <div className="grid min-h-[70vh] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
          <div className="min-w-0 rounded-md border bg-muted/30 overflow-auto">
            {isLoading ? (
              <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">Preparing preview...</div>
            ) : error ? (
              <div className="flex h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" onClick={onRetry}>Retry</Button>
              </div>
            ) : previewUrl && pdf ? (
              <div className="space-y-4 p-4">
                {pageViews.map((page) => (
                  <div key={page.pageIndex} className="relative mx-auto" style={{ width: page.width, height: page.height }}>
                    <PdfPageCanvas pdf={pdf} page={page} />
                    {fieldMetadata.filter((field) => field.pageIndex === page.pageIndex).map((field) => {
                      const value = fieldValue(field, overrides, resolvedByName);
                      return (
                        <div key={`${field.name}:${field.widgetIndex}`} className="absolute" style={overlayStyle(field, page)} title={formatPdfFieldLabel(field.name)}>
                          {field.type === "text" && (
                            <Input
                              value={value}
                              onChange={(event) => onPdfFieldOverrideChange(field.name, event.target.value)}
                              readOnly={!canSaveDraft}
                              className="h-full min-h-0 border-[#5a7d58] bg-white/90 px-1 py-0 text-[10px]"
                              data-testid={`input-pdf-field-${field.name}`}
                            />
                          )}
                          {field.type === "checkbox" && (
                            <input
                              type="checkbox"
                              checked={value === "true" || value === "yes" || value === "checked" || value === field.exportValue}
                              onChange={(event) => onPdfFieldOverrideChange(field.name, event.target.checked)}
                              disabled={!canSaveDraft}
                              className="h-full w-full accent-[#5a7d58]"
                              data-testid={`checkbox-pdf-field-${field.name}`}
                            />
                          )}
                          {field.type === "radio" && (
                            <input
                              type="radio"
                              name={`pdf-radio-${field.name}`}
                              value={field.exportValue || field.options?.[field.widgetIndex] || ""}
                              checked={value === (field.exportValue || field.options?.[field.widgetIndex] || "")}
                              onChange={(event) => onPdfFieldOverrideChange(field.name, event.target.value)}
                              disabled={!canSaveDraft}
                              className="h-full w-full accent-[#5a7d58]"
                            />
                          )}
                          {field.type === "select" && (
                            <Select value={value} onValueChange={(next) => onPdfFieldOverrideChange(field.name, next)} disabled={!canSaveDraft}>
                              <SelectTrigger className="h-full min-h-0 border-[#5a7d58] bg-white/90 px-1 py-0 text-[10px]">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {(field.options || []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                          {field.type === "unsupported" && (
                            <div className="h-full w-full rounded-sm border border-dashed border-amber-500 bg-amber-50/80" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">No preview loaded.</div>
            )}
          </div>
          <div className="flex min-w-0 max-w-full flex-col rounded-md border bg-background overflow-hidden" data-testid="panel-court-form-preview-values">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <p className="text-sm font-medium">Preview values</p>
              {previewStale && <Badge variant="outline">Needs refresh</Badge>}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-testid="panel-court-form-preview-values-scroll">
              {previewFieldRows.length ? previewFieldRows.map((field) => {
                const value = pdfFieldValue(field.name, overrides, resolvedByName);
                const hasOverride = Object.prototype.hasOwnProperty.call(overrides, field.name);
                const mapping = field.mapping;
                const metadata = field.metadata;
                const sourceLabel = mapping
                  ? getCourtFormMergeSourceLabel(mapping.source)
                  : "Unmapped";
                const isUnsupported = metadata?.type === "unsupported";
                return (
                  <div key={field.name} className="min-w-0 max-w-full space-y-1.5 rounded-md border p-2" data-testid={`row-preview-pdf-field-${field.name}`}>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <Label className="text-xs break-words">{formatPdfFieldLabel(field.name)}</Label>
                        <p className="text-[11px] text-muted-foreground break-words">{field.name}</p>
                      </div>
                      <div className="flex min-w-0 max-w-full flex-wrap gap-1 sm:justify-end">
                        <Badge className="max-w-full whitespace-normal break-words text-left" variant={mapping ? "secondary" : "outline"}>{sourceLabel}</Badge>
                        {hasOverride && <Badge variant="outline">Manual override</Badge>}
                      </div>
                    </div>
                    {mapping?.source.startsWith("draft.") && (
                      <Input
                        value={getDraftPathValue(draftAnswers, mapping.source.slice("draft.".length))}
                        onChange={(event) => onDraftAnswerChange(mapping.source.slice("draft.".length), event.target.value)}
                        className="w-full min-w-0"
                        data-testid="input-preview-draft-value"
                      />
                    )}
                    {isUnsupported ? (
                      <Input value="Unsupported PDF field" readOnly className="w-full min-w-0 bg-muted/40" />
                    ) : metadata?.type === "checkbox" ? (
                      <label className="flex h-9 items-center gap-2 rounded-md border px-2 text-xs">
                        <input
                          type="checkbox"
                          checked={isCheckedValue(value)}
                          onChange={(event) => onPdfFieldOverrideChange(field.name, event.target.checked)}
                          disabled={!canSaveDraft}
                          data-testid={`checkbox-preview-pdf-field-${field.name}`}
                        />
                        Checked
                      </label>
                    ) : (metadata?.type === "select" || metadata?.type === "radio") && metadata.options?.length ? (
                      <Select value={value} onValueChange={(next) => onPdfFieldOverrideChange(field.name, next)} disabled={!canSaveDraft}>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue placeholder="Select value" />
                        </SelectTrigger>
                        <SelectContent>
                          {metadata.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={value}
                        onChange={(event) => onPdfFieldOverrideChange(field.name, event.target.value)}
                        readOnly={!canSaveDraft}
                        className={`w-full min-w-0 ${!canSaveDraft ? "bg-muted/40" : ""}`}
                        data-testid={`input-preview-pdf-field-${field.name}`}
                      />
                    )}
                  </div>
                );
              }) : (
                <p className="text-sm text-muted-foreground">No extracted PDF fields are available for this template.</p>
              )}
              {fieldMetadata.some((field) => field.type === "unsupported") && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  Some PDF widgets are read-only in this editor and can be reviewed in the uploaded template.
                </p>
              )}
            </div>
            <div className="sticky bottom-0 space-y-2 border-t bg-background p-3" data-testid="panel-court-form-preview-actions">
              <Button className="w-full" onClick={onSaveDraft} disabled={!canSaveDraft || isSavingDraft}>
                <Save className="w-4 h-4 mr-2" /> Save draft
              </Button>
              <Button variant={previewStale ? "default" : "outline"} className="w-full" onClick={onRetry} disabled={isLoading || !previewStale}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh preview
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
