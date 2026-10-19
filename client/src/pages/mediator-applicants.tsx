import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { PageHeader } from "@/components/shared/page-header";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ArrowRightCircle, Search, UserPlus, LayoutGrid, Table as TableIcon, Link2, Copy, Check, RefreshCw } from "lucide-react";
import { KanbanBoard } from "@/components/mediator-pipeline/kanban-board";
import type { PipelineCard } from "@/components/mediator-pipeline/types";
import { Link } from "wouter";
import {
  MEDIATOR_APPLICANT_STAGES,
  FMC_ACCREDITATION_STATUSES,
  LEAD_SOURCES,
  type MediatorApplicant,
  type MediatorApplicantStage,
  type ServiceType,
} from "@shared/schema";

const NONE_VALUE = "__none__";
const SOURCE_OTHER_OPTIONS = new Set<string>([
  "Other (please specify)",
  "Word of mouth (please tell us who?)",
]);
const SOURCE_SEPARATOR = " — ";

function splitStoredSource(stored: string | null | undefined): {
  source: string;
  sourceOther: string;
} {
  const value = (stored ?? "").trim();
  if (!value) return { source: "", sourceOther: "" };
  const sepIdx = value.indexOf(SOURCE_SEPARATOR);
  if (sepIdx > -1) {
    const head = value.slice(0, sepIdx);
    const tail = value.slice(sepIdx + SOURCE_SEPARATOR.length).trim();
    if (SOURCE_OTHER_OPTIONS.has(head)) {
      return { source: head, sourceOther: tail };
    }
  }
  return { source: value, sourceOther: "" };
}

function combineSource(source: string, sourceOther: string): string | null {
  const head = source.trim();
  if (!head) return null;
  if (SOURCE_OTHER_OPTIONS.has(head)) {
    const tail = sourceOther.trim();
    return tail ? `${head}${SOURCE_SEPARATOR}${tail}` : head;
  }
  return head;
}

const STAGE_LABEL: Record<MediatorApplicantStage, string> = {
  recruitment_approach: "Applications",
  interview: "Interview",
  reference_credential_check: "Reference & Credential Check",
  contract_issued: "Contract issued",
  onboarded: "Onboarded",
  rejected: "Rejected",
};

const STAGE_VARIANT: Record<MediatorApplicantStage, "default" | "secondary" | "outline" | "destructive"> = {
  recruitment_approach: "outline",
  interview: "outline",
  reference_credential_check: "secondary",
  contract_issued: "secondary",
  onboarded: "default",
  rejected: "destructive",
};

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  sourceOther: string;
  accreditationStatus: string;
  areaOfPractice: string[];
  stage: MediatorApplicantStage;
  notes: string;
};

const blankForm: FormState = {
  firstName: "", lastName: "", email: "", phone: "", source: "", sourceOther: "", accreditationStatus: "", areaOfPractice: [], stage: "recruitment_approach", notes: "",
};

export default function MediatorApplicantsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | MediatorApplicantStage>("all");
  const [detailTarget, setDetailTarget] = useState<MediatorApplicant | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MediatorApplicant | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [deleteTarget, setDeleteTarget] = useState<MediatorApplicant | null>(null);
  const [convertTarget, setConvertTarget] = useState<MediatorApplicant | null>(null);
  const [view, setView] = useState<"board" | "table">("board");
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<MediatorApplicant[]>({ queryKey: ["/api/mediator-applicants"] });
  const { data: serviceTypes, isLoading: serviceTypesLoading } = useQuery<ServiceType[]>({
    queryKey: ["/api/service-types"],
  });

  const { data: appLink, isLoading: appLinkLoading } = useQuery<{ token: string | null; url: string | null; createdAt: string | null; createdByName: string | null }>({
    queryKey: ["/api/mediator-application-link"],
    enabled: shareLinkOpen,
  });

  const generateLink = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mediator-application-link", {});
      return res.json() as Promise<{ token: string; url: string; createdAt: string }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/mediator-application-link"], {
        token: data.token,
        url: data.url,
        createdAt: data.createdAt,
        createdByName: null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-application-link"] });
      toast({ title: "New application link generated" });
    },
    onError: (err: Error) => toast({ title: "Couldn't generate link", description: err?.message, variant: "destructive" }),
  });

  const activeServicesByCategory = (() => {
    const active = (serviceTypes ?? []).filter((s) => s.isActive);
    const groups = new Map<string, ServiceType[]>();
    for (const s of active) {
      const arr = groups.get(s.category) ?? [];
      arr.push(s);
      groups.set(s.category, arr);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    // Explicit display order per spec: Family → Workplace → Civil → Commercial → Other → Packages,
    // with any unknown category appended alphabetically afterwards.
    const order = ["Family", "Workplace", "Civil", "Commercial", "Other", "Packages"];
    const rank = (c: string) => {
      const i = order.indexOf(c);
      return i === -1 ? order.length : i;
    };
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
  })();

  const activeServiceNames = new Set(
    (serviceTypes ?? []).filter((s) => s.isActive).map((s) => s.name),
  );
  const legacyAreaOfPracticeNames = form.areaOfPractice.filter(
    (n) => !activeServiceNames.has(n),
  );
  function toggleAreaOfPractice(name: string) {
    setForm((f) => {
      const has = f.areaOfPractice.includes(name);
      return {
        ...f,
        areaOfPractice: has
          ? f.areaOfPractice.filter((n) => n !== name)
          : [...f.areaOfPractice, name],
      };
    });
  }
  const isLegacyAccreditation =
    !!form.accreditationStatus &&
    !(FMC_ACCREDITATION_STATUSES as readonly string[]).includes(form.accreditationStatus);
  const isLegacySource =
    !!form.source && !(LEAD_SOURCES as readonly string[]).includes(form.source);
  const showSourceOther = SOURCE_OTHER_OPTIONS.has(form.source);

  const filtered = (data ?? []).filter((a) => {
    if (stageFilter !== "all" && a.stage !== stageFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      a.firstName.toLowerCase().includes(s) ||
      a.lastName.toLowerCase().includes(s) ||
      a.email.toLowerCase().includes(s) ||
      (a.source ?? "").toLowerCase().includes(s) ||
      (a.areaOfPractice ?? []).some((n) => n.toLowerCase().includes(s))
    );
  });

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setDialogOpen(true);
  }
  function openEdit(a: MediatorApplicant) {
    setEditing(a);
    const { source, sourceOther } = splitStoredSource(a.source);
    setForm({
      firstName: a.firstName,
      lastName: a.lastName,
      accreditationStatus: a.accreditationStatus ?? "",
      areaOfPractice: Array.isArray(a.areaOfPractice) ? a.areaOfPractice : [],
      email: a.email,
      phone: a.phone ?? "",
      source,
      sourceOther,
      stage: a.stage as MediatorApplicantStage,
      notes: a.notes ?? "",
    });
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        accreditationStatus: form.accreditationStatus.trim() || null,
        areaOfPractice: form.areaOfPractice.length > 0 ? form.areaOfPractice : null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        source: combineSource(form.source, form.sourceOther),
        stage: form.stage,
        notes: form.notes.trim() || null,
      };
      if (editing) return apiRequest("PATCH", `/api/mediator-applicants/${editing.id}`, body);
      return apiRequest("POST", `/api/mediator-applicants`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      setDialogOpen(false);
      toast({ title: editing ? "Applicant updated" : "Applicant added" });
    },
    onError: (err: Error) => toast({ title: "Couldn't save applicant", description: err?.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/mediator-applicants/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      setDeleteTarget(null);
      toast({ title: "Applicant deleted" });
    },
    onError: (err: Error) => toast({ title: "Couldn't delete", description: err?.message, variant: "destructive" }),
  });

  const convert = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/mediator-applicants/${id}/convert`, { sendInvite: true }),
    onSuccess: async (res: Response) => {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      setConvertTarget(null);
      toast({ title: "Mediator created", description: body?.message });
    },
    onError: (err: Error) => toast({ title: "Couldn't convert applicant", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Mediator Pipeline"
        subtitle="Full lifecycle from first approach to off-boarding. Drag a card between columns to update its stage."
        icon={UserPlus}
        iconColor="text-[#5a7d58]"
        iconBg="bg-[#a7baa4]/15"
        titleTestId="text-applicants-title"
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-card overflow-hidden">
              <Button
                variant={view === "board" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none"
                onClick={() => setView("board")}
                data-testid="button-view-board"
              >
                <LayoutGrid className="w-4 h-4 mr-1" />Board
              </Button>
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none"
                onClick={() => setView("table")}
                data-testid="button-view-table"
              >
                <TableIcon className="w-4 h-4 mr-1" />Table
              </Button>
            </div>
            <Button variant="outline" onClick={() => setShareLinkOpen(true)} data-testid="button-share-application-link">
              <Link2 className="w-4 h-4 mr-1" />Share application link
            </Button>
            <Button onClick={openCreate} data-testid="button-new-applicant"><Plus className="w-4 h-4 mr-1" />New applicant</Button>
          </div>
        }
      />

      {view === "board" && <KanbanBoard />}

      {view === "table" && (

      <Card>
        <CardContent className="p-4 md:p-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, source"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-applicants"
              />
            </div>
            <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as "all" | MediatorApplicantStage)}>
              <SelectTrigger className="md:w-56" data-testid="select-stage-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {MEDIATOR_APPLICANT_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No applicants yet.</TableCell></TableRow>
              )}
              {filtered.map((a) => {
                const stage = a.stage as MediatorApplicantStage;
                const isConverted = !!a.convertedUserId;
                return (
                  <TableRow
                    key={a.id}
                    data-testid={`row-applicant-${a.id}`}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setDetailTarget(a)}
                  >
                    <TableCell className="font-medium" data-testid={`text-name-${a.id}`}>{a.firstName} {a.lastName}</TableCell>
                    <TableCell>{a.email}</TableCell>
                    <TableCell>{a.phone ?? "—"}</TableCell>
                    <TableCell>{a.source ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STAGE_VARIANT[stage]} data-testid={`badge-stage-${a.id}`}>{STAGE_LABEL[stage]}</Badge>
                      {isConverted && (
                        <Link href={`/mediators/${a.convertedUserId}`}>
                          <Badge variant="outline" className="ml-2 cursor-pointer" data-testid={`badge-converted-${a.id}`}>Mediator →</Badge>
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {!isConverted && stage !== "rejected" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConvertTarget(a)}
                            data-testid={`button-convert-${a.id}`}
                          >
                            <ArrowRightCircle className="w-4 h-4 mr-1" />Convert
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => openEdit(a)} data-testid={`button-edit-${a.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        {!isConverted && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(a)} data-testid={`button-delete-${a.id}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex flex-col max-h-[90vh] gap-0 p-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
            <DialogTitle>{editing ? "Edit applicant" : "New applicant"}</DialogTitle>
            <DialogDescription>
              Capture a prospective mediator before they're a user. Convert to mediator to fire the invite email.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>First name</Label><Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} data-testid="input-first-name" /></div>
            <div><Label>Last name</Label><Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} data-testid="input-last-name" /></div>
            <div className="md:col-span-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} data-testid="input-email" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} data-testid="input-phone" /></div>
            <div>
              <Label>Source</Label>
              <Select
                value={form.source === "" ? NONE_VALUE : form.source}
                onValueChange={(v) =>
                  setForm((f) => {
                    const next = v === NONE_VALUE ? "" : v;
                    return {
                      ...f,
                      source: next,
                      sourceOther: SOURCE_OTHER_OPTIONS.has(next) ? f.sourceOther : "",
                    };
                  })
                }
              >
                <SelectTrigger data-testid="select-source">
                  <SelectValue placeholder="How did you hear about us?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  {isLegacySource && (
                    <SelectItem value={form.source}>
                      {form.source} (legacy — please re-select)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {showSourceOther && (
                <div className="mt-2">
                  <Label>Please specify</Label>
                  <Input
                    value={form.sourceOther}
                    onChange={(e) => setForm((f) => ({ ...f, sourceOther: e.target.value }))}
                    placeholder="Please specify"
                    data-testid="input-source-other"
                  />
                </div>
              )}
            </div>
            <div>
              <Label>Accreditation status</Label>
              <Select
                value={form.accreditationStatus === "" ? NONE_VALUE : form.accreditationStatus}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, accreditationStatus: v === NONE_VALUE ? "" : v }))
                }
              >
                <SelectTrigger data-testid="select-accreditation-status">
                  <SelectValue placeholder="Select accreditation status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                  {FMC_ACCREDITATION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  {isLegacyAccreditation && (
                    <SelectItem value={form.accreditationStatus}>
                      {form.accreditationStatus} (legacy — please re-select)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div data-testid="select-area-of-practice">
              <Label>Area of practice</Label>
              {serviceTypesLoading ? (
                <div className="border rounded-md p-3 text-sm text-muted-foreground bg-muted/20">
                  Loading services…
                </div>
              ) : (
                <div className="border rounded-md p-2 bg-muted/20 max-h-52 overflow-y-auto space-y-2">
                  {activeServicesByCategory.map(([category, items]) => (
                    <div key={category} className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                        {category}
                      </p>
                      <div className="grid gap-0.5">
                        {items.map((s) => {
                          const checked = form.areaOfPractice.includes(s.name);
                          return (
                            <label
                              key={s.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                              data-testid={`checkbox-area-${s.id}`}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleAreaOfPractice(s.name)}
                              />
                              <span className="text-sm">{s.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {legacyAreaOfPracticeNames.length > 0 && (
                    <div className="space-y-1 pt-1 border-t">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                        Legacy — please re-select
                      </p>
                      <div className="grid gap-0.5">
                        {legacyAreaOfPracticeNames.map((name) => (
                          <label
                            key={name}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                            data-testid={`checkbox-area-legacy-${name}`}
                          >
                            <Checkbox
                              checked
                              onCheckedChange={() => toggleAreaOfPractice(name)}
                            />
                            <span className="text-sm italic text-muted-foreground">{name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {form.areaOfPractice.length > 0 && (
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-muted-foreground">
                    {form.areaOfPractice.length} selected
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setForm((f) => ({ ...f, areaOfPractice: [] }))}
                    data-testid="button-clear-area-of-practice"
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v as MediatorApplicantStage }))}>
                <SelectTrigger data-testid="select-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEDIATOR_APPLICANT_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} data-testid="input-notes" /></div>
          </div>
          <DialogFooter className="shrink-0 px-6 py-4 border-t bg-background">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim()}
              data-testid="button-save-applicant"
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete applicant"
        description={`Permanently remove ${deleteTarget?.firstName ?? ""} ${deleteTarget?.lastName ?? ""}? This can't be undone.`}
        onConfirm={() => deleteTarget && del.mutate(deleteTarget.id)}
        isPending={del.isPending}
      />

      <Sheet open={!!detailTarget} onOpenChange={(o) => !o && setDetailTarget(null)}>
        <SheetContent className="sm:max-w-md" data-testid="sheet-applicant-detail">
          {detailTarget && (
            <>
              <SheetHeader>
                <SheetTitle data-testid="text-detail-name">{detailTarget.firstName} {detailTarget.lastName}</SheetTitle>
                <SheetDescription>{detailTarget.email}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={STAGE_VARIANT[detailTarget.stage as MediatorApplicantStage]}>
                    {STAGE_LABEL[detailTarget.stage as MediatorApplicantStage]}
                  </Badge>
                  {detailTarget.convertedUserId && (
                    <Link href={`/mediators/${detailTarget.convertedUserId}`}>
                      <Badge variant="outline" className="cursor-pointer">Open mediator profile →</Badge>
                    </Link>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="col-span-2">{detailTarget.phone ?? "—"}</span>
                  <span className="text-muted-foreground">Source</span>
                  <span className="col-span-2">{detailTarget.source ?? "—"}</span>
                  <span className="text-muted-foreground">Accreditation</span>
                  <span className="col-span-2">{detailTarget.accreditationStatus ?? "—"}</span>
                  <span className="text-muted-foreground">Practice area</span>
                  <span className="col-span-2">
                    {detailTarget.areaOfPractice && detailTarget.areaOfPractice.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {detailTarget.areaOfPractice.map((n) => (
                          <Badge key={n} variant="secondary" className="text-[11px]">{n}</Badge>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className="text-muted-foreground">Created</span>
                  <span className="col-span-2">{detailTarget.createdAt ? new Date(detailTarget.createdAt).toLocaleString() : "—"}</span>
                  {detailTarget.convertedAt && (
                    <>
                      <span className="text-muted-foreground">Converted</span>
                      <span className="col-span-2">{new Date(detailTarget.convertedAt).toLocaleString()}</span>
                    </>
                  )}
                  {detailTarget.rejectedReason && (
                    <>
                      <span className="text-muted-foreground">Rejected reason</span>
                      <span className="col-span-2">{detailTarget.rejectedReason}</span>
                    </>
                  )}
                </div>
                {detailTarget.notes && (
                  <div>
                    <div className="text-muted-foreground mb-1">Notes</div>
                    <p className="whitespace-pre-wrap rounded-md border p-3 bg-muted/30">{detailTarget.notes}</p>
                  </div>
                )}
              </div>
              <SheetFooter className="mt-6 flex flex-row gap-2 sm:justify-end">
                <Button variant="outline" onClick={() => { openEdit(detailTarget); setDetailTarget(null); }} data-testid="button-detail-edit">
                  <Pencil className="w-4 h-4 mr-1" />Edit
                </Button>
                {!detailTarget.convertedUserId && detailTarget.stage !== "rejected" && (
                  <Button onClick={() => { setConvertTarget(detailTarget); setDetailTarget(null); }} data-testid="button-detail-convert">
                    <ArrowRightCircle className="w-4 h-4 mr-1" />Convert to mediator
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Share Application Link dialog */}
      <Dialog open={shareLinkOpen} onOpenChange={(o) => { setShareLinkOpen(o); if (!o) setCopied(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share application link</DialogTitle>
            <DialogDescription>
              Anyone with this link can submit a public application form. Generating a new link immediately invalidates the previous one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {appLinkLoading ? (
              <div className="h-10 bg-muted animate-pulse rounded-md" />
            ) : appLink?.url ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={appLink.url}
                    className="font-mono text-xs"
                    data-testid="input-application-link-url"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(appLink.url!).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      });
                    }}
                    data-testid="button-copy-application-link"
                  >
                    {copied ? <Check className="w-4 h-4 text-[#5a7d58]" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                {appLink.createdAt && (
                  <p className="text-xs text-muted-foreground">
                    Generated {new Date(appLink.createdAt).toLocaleString()}
                    {appLink.createdByName && ` by ${appLink.createdByName}`}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No link generated yet. Click below to create one.</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => generateLink.mutate()}
              disabled={generateLink.isPending}
              data-testid="button-generate-application-link"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${generateLink.isPending ? "animate-spin" : ""}`} />
              {appLink?.url ? "Generate new link" : "Generate link"}
            </Button>
            <Button onClick={() => { setShareLinkOpen(false); setCopied(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!convertTarget} onOpenChange={(o) => !o && setConvertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to mediator</DialogTitle>
            <DialogDescription>
              This creates a mediator user account for {convertTarget?.firstName} {convertTarget?.lastName} and emails them an invite link to set their password and connect Google Calendar. They will appear in the Mediators list immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancel</Button>
            <Button
              onClick={() => convertTarget && convert.mutate(convertTarget.id)}
              disabled={convert.isPending}
              data-testid="button-confirm-convert"
            >
              {convert.isPending ? "Converting…" : "Convert and send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
