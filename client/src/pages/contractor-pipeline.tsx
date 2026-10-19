import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/page-header";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Search, LayoutGrid, Table as TableIcon, Link2, Copy, Check, RefreshCw, Building2,
} from "lucide-react";
import { ContractorKanbanBoard } from "@/components/contractor-pipeline/kanban-board";
import { AddProspectDialog } from "@/components/contractor-pipeline/add-prospect-dialog";
import {
  CONTRACTOR_APPLICANT_STAGES, CONTRACTOR_TYPES, LEAD_SOURCES, type ContractorApplicantStage, type ContractorApplicant,
} from "@shared/schema";

const STAGE_LABEL: Record<ContractorApplicantStage, string> = {
  prospect: "Applications",
  screening: "Screening",
  contract_sent: "Contract Sent",
  active: "Active",
  off_boarded: "Off-boarded",
};

const STAGE_VARIANT: Record<ContractorApplicantStage, "default" | "secondary" | "outline" | "destructive"> = {
  prospect: "outline",
  screening: "outline",
  contract_sent: "secondary",
  active: "default",
  off_boarded: "destructive",
};

const NONE_VALUE = "__none__";

type EditForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  contractorType: string;
  source: string;
  notes: string;
  stage: ContractorApplicantStage;
};

const blankEditForm: EditForm = {
  firstName: "", lastName: "", email: "", phone: "", contractorType: "", source: "", notes: "", stage: "prospect",
};

export default function ContractorPipelinePage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | ContractorApplicantStage>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ContractorApplicant | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(blankEditForm);
  const [deleteTarget, setDeleteTarget] = useState<ContractorApplicant | null>(null);
  const [view, setView] = useState<"board" | "table">("board");
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data } = useQuery<ContractorApplicant[]>({ queryKey: ["/api/contractor-applicants"] });

  const { data: appLink, isLoading: appLinkLoading } = useQuery<{ token: string | null; url: string | null; createdAt: string | null; createdByName: string | null }>({
    queryKey: ["/api/contractor-application-link"],
    enabled: shareLinkOpen,
  });

  const generateLink = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contractor-application-link", {});
      return res.json() as Promise<{ token: string; url: string; createdAt: string }>;
    },
    onSuccess: (d) => {
      queryClient.setQueryData(["/api/contractor-application-link"], { token: d.token, url: d.url, createdAt: d.createdAt, createdByName: null });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-application-link"] });
      toast({ title: "New application link generated" });
    },
    onError: (err: Error) => toast({ title: "Couldn't generate link", description: err?.message, variant: "destructive" }),
  });

  const filtered = (data ?? []).filter((a) => {
    if (stageFilter !== "all" && a.stage !== stageFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      a.firstName.toLowerCase().includes(s) ||
      a.lastName.toLowerCase().includes(s) ||
      a.email.toLowerCase().includes(s) ||
      (a.contractorType ?? "").toLowerCase().includes(s)
    );
  });

  function openEdit(a: ContractorApplicant) {
    setEditing(a);
    setEditForm({
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      phone: a.phone ?? "",
      contractorType: a.contractorType ?? "",
      source: a.source ?? "",
      notes: a.notes ?? "",
      stage: a.stage as ContractorApplicantStage,
    });
    setEditOpen(true);
  }

  const saveEdit = useMutation({
    mutationFn: async () => {
      const body = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
        contractorType: editForm.contractorType || null,
        source: editForm.source || null,
        notes: editForm.notes.trim() || null,
        stage: editForm.stage,
      };
      return apiRequest("PATCH", `/api/contractor-applicants/${editing!.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      setEditOpen(false);
      toast({ title: "Applicant updated" });
    },
    onError: (err: Error) => toast({ title: "Couldn't save", description: err?.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/contractor-applicants/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      setDeleteTarget(null);
      toast({ title: "Applicant deleted" });
    },
    onError: (err: Error) => toast({ title: "Couldn't delete", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Contractor Pipeline"
        subtitle="Track contractor prospects from first approach to off-boarding. Drag a card to update its stage."
        icon={Building2}
        iconColor="text-[#b8825a]"
        iconBg="bg-[#dcae96]/15"
        titleTestId="text-contractor-pipeline-title"
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-card overflow-hidden">
              <Button variant={view === "board" ? "secondary" : "ghost"} size="sm" className="rounded-none" onClick={() => setView("board")} data-testid="button-view-board">
                <LayoutGrid className="w-4 h-4 mr-1" />Board
              </Button>
              <Button variant={view === "table" ? "secondary" : "ghost"} size="sm" className="rounded-none" onClick={() => setView("table")} data-testid="button-view-table">
                <TableIcon className="w-4 h-4 mr-1" />Table
              </Button>
            </div>
            <Button variant="outline" onClick={() => setShareLinkOpen(true)} data-testid="button-share-contractor-link">
              <Link2 className="w-4 h-4 mr-1" />Share application link
            </Button>
            <Button onClick={() => setAddOpen(true)} data-testid="button-new-contractor-applicant">
              <Plus className="w-4 h-4 mr-1" />New application
            </Button>
          </div>
        }
      />

      {view === "board" && <ContractorKanbanBoard />}

      {view === "table" && (
        <Card>
          <CardContent className="p-4 md:p-6 space-y-4">
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by name, email, type" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-contractor-applicants" />
              </div>
              <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as "all" | ContractorApplicantStage)}>
                <SelectTrigger className="md:w-48" data-testid="select-contractor-stage-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {CONTRACTOR_APPLICANT_STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No applicants yet.</TableCell></TableRow>
                )}
                {filtered.map((a) => (
                  <TableRow key={a.id} data-testid={`row-contractor-applicant-${a.id}`} className="cursor-pointer hover-elevate" onClick={() => openEdit(a)}>
                    <TableCell className="font-medium">{a.firstName} {a.lastName}</TableCell>
                    <TableCell>{a.email}</TableCell>
                    <TableCell>{a.contractorType ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={a.stage === "rejected" ? "destructive" : STAGE_VARIANT[a.stage as ContractorApplicantStage] ?? "outline"}>
                        {a.stage === "rejected" ? "Rejected" : STAGE_LABEL[a.stage as ContractorApplicantStage] ?? a.stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {!a.convertedUserId && (
                          <>
                            <Button size="icon" variant="ghost" onClick={() => openEdit(a)} data-testid={`button-edit-contractor-${a.id}`}><Pencil className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(a)} data-testid={`button-delete-contractor-${a.id}`}><Trash2 className="w-4 h-4" /></Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Add Prospect dialog (minimal, always creates at prospect stage) ── */}
      <AddProspectDialog open={addOpen} onClose={() => setAddOpen(false)} />

      {/* ── Edit dialog (full details) ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="flex flex-col max-h-[90vh] gap-0 p-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
            <DialogTitle>Edit applicant</DialogTitle>
            <DialogDescription>Update applicant details and stage.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>First name</Label><Input value={editForm.firstName} onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))} data-testid="input-edit-first-name" /></div>
            <div><Label>Last name</Label><Input value={editForm.lastName} onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))} data-testid="input-edit-last-name" /></div>
            <div className="md:col-span-2"><Label>Email</Label><Input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} data-testid="input-edit-email" /></div>
            <div><Label>Phone</Label><Input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} data-testid="input-edit-phone" /></div>
            <div>
              <Label>Contractor type</Label>
              <Select value={editForm.contractorType || NONE_VALUE} onValueChange={(v) => setEditForm((f) => ({ ...f, contractorType: v === NONE_VALUE ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-contractor-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                  {CONTRACTOR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={editForm.source || NONE_VALUE} onValueChange={(v) => setEditForm((f) => ({ ...f, source: v === NONE_VALUE ? "" : v }))}>
                <SelectTrigger data-testid="select-edit-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                  {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={editForm.stage} onValueChange={(v) => setEditForm((f) => ({ ...f, stage: v as ContractorApplicantStage }))}>
                <SelectTrigger data-testid="select-edit-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTRACTOR_APPLICANT_STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} rows={3} data-testid="input-edit-notes" />
            </div>
          </div>
          <div className="shrink-0 px-6 py-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saveEdit.isPending}>Cancel</Button>
            <Button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending || !editForm.firstName.trim() || !editForm.lastName.trim() || !editForm.email.trim()} data-testid="button-save-edit">
              {saveEdit.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Share link dialog ── */}
      <Dialog open={shareLinkOpen} onOpenChange={setShareLinkOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-share-contractor-link">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-[#b8825a]" />Contractor application link
            </DialogTitle>
            <DialogDescription>
              Share this link with prospective contractors. Anyone with the link can submit an application — generating a new link invalidates the old one.
            </DialogDescription>
          </DialogHeader>
          {appLinkLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3">
              {appLink?.url ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input value={appLink.url} readOnly className="font-mono text-xs" data-testid="input-contractor-app-link" />
                    <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(appLink.url!); setCopied(true); setTimeout(() => setCopied(false), 2000); }} data-testid="button-copy-contractor-link">
                      {copied ? <Check className="w-4 h-4 text-[#5a7d58]" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  {appLink.createdAt && (
                    <p className="text-xs text-muted-foreground">
                      Generated {new Date(appLink.createdAt).toLocaleString()}
                      {appLink.createdByName ? ` by ${appLink.createdByName}` : ""}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground italic">No link generated yet.</p>
              )}
              <Button variant="outline" size="sm" onClick={() => generateLink.mutate()} disabled={generateLink.isPending} data-testid="button-generate-contractor-link">
                <RefreshCw className={`w-4 h-4 mr-1 ${generateLink.isPending ? "animate-spin" : ""}`} />
                {appLink?.url ? "Generate new link" : "Generate link"}
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareLinkOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && del.mutate(deleteTarget.id)}
        title="Delete applicant"
        description={`This will permanently delete ${deleteTarget?.firstName} ${deleteTarget?.lastName}'s application. This action cannot be undone.`}
        isPending={del.isPending}
      />
    </div>
  );
}
