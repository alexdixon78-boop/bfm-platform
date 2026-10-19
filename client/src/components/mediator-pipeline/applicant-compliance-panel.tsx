import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, FileCheck2, ShieldCheck, Mail } from "lucide-react";
import {
  APPLICANT_CHECK_KINDS,
  APPLICANT_CHECK_STATUSES,
  type MediatorApplicantCheck,
  type MediatorApplicantReference,
  type ApplicantCheckKind,
  type ApplicantCheckStatus,
} from "@shared/schema";

const KIND_LABEL: Record<ApplicantCheckKind, string> = {
  fmc_cmc: "FMC / CMC accreditation",
  other_regulator: "Other regulator check",
  pi_insurance: "PI insurance",
  dbs: "DBS check",
  ppc_supervision: "PPC supervision",
};

const STATUS_VARIANT: Record<ApplicantCheckStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  verified: "default",
  failed: "destructive",
};

function invalidateAll(applicantId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "checks"] });
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "references"] });
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
}

export function ApplicantCompliancePanel({ applicantId }: { applicantId: string }) {
  const { toast } = useToast();
  const { data: checks } = useQuery<MediatorApplicantCheck[]>({
    queryKey: ["/api/mediator-applicants", applicantId, "checks"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}/checks`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: refs } = useQuery<MediatorApplicantReference[]>({
    queryKey: ["/api/mediator-applicants", applicantId, "references"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}/references`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const requestAll = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediator-applicants/${applicantId}/update-link/request`),
    onSuccess: (data: { emailSent?: boolean }) => {
      invalidateAll(applicantId);
      toast({
        title: "Credentials link sent",
        description: data?.emailSent === false
          ? "The link was created, but the email could not be sent."
          : "The mediator has been emailed with the public update link.",
        variant: data?.emailSent === false ? "destructive" : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't send link", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="panel-applicant-compliance">
      <div>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />Credential checks
            </h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              One public update link lets the mediator complete all credential uploads in one place.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={() => requestAll.mutate()}
            disabled={requestAll.isPending}
            data-testid="button-request-credentials-link"
          >
            <Mail className="w-3 h-3 mr-1" />
            {requestAll.isPending ? "Sending…" : "Send update link"}
          </Button>
        </div>
        <div className="space-y-2">
          {APPLICANT_CHECK_KINDS.map((kind) => (
            <CheckRow
              key={kind}
              applicantId={applicantId}
              kind={kind}
              row={(checks ?? []).find((c) => c.kind === kind) ?? null}
            />
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
          <FileCheck2 className="w-3 h-3" />Professional references
          <span className="ml-auto text-[10px] font-normal normal-case text-muted-foreground">
            {refs?.length ?? 0} of 2
          </span>
        </h4>
        <div className="space-y-2">
          {(refs ?? []).map((r) => (
            <ReferenceRow key={r.id} applicantId={applicantId} row={r} />
          ))}
          {(refs?.length ?? 0) < 2 && <AddReferenceForm applicantId={applicantId} />}
        </div>
      </div>
    </div>
  );
}

function CheckRow({ applicantId, kind, row }: { applicantId: string; kind: ApplicantCheckKind; row: MediatorApplicantCheck | null }) {
  const [open, setOpen] = useState(false);
  const hasDetails = !!row && Boolean(row.referenceNumber || row.provider || row.expiresAt);
  const failureReason = row?.status === "failed" ? row.notes?.trim() : "";

  return (
    <div className="rounded-md border p-2 bg-card" data-testid={`row-check-${kind}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium flex-1">{KIND_LABEL[kind]}</span>
        {row ? (
          <Badge
            variant={STATUS_VARIANT[row.status as ApplicantCheckStatus]}
            className="text-[10px] capitalize"
            data-testid={`badge-check-${kind}`}
          >
            {row.status}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            Not requested
          </Badge>
        )}
        {row ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setOpen(true)}
            data-testid={`button-edit-check-${kind}`}
          >
            <Pencil className="w-3 h-3" />
          </Button>
        ) : null}
      </div>

      {hasDetails ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {row!.referenceNumber ? <span className="mr-2">#{row!.referenceNumber}</span> : null}
          {row!.provider ? <span className="mr-2">{row!.provider}</span> : null}
          {row!.expiresAt ? <span>exp {row!.expiresAt}</span> : null}
        </div>
      ) : null}

      {failureReason ? (
        <div className="mt-1 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          Reason for reupload: {failureReason}
        </div>
      ) : null}

      {open && row ? (
        <CheckEditDialog
          applicantId={applicantId}
          kind={kind}
          row={row}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CheckEditDialog({ applicantId, kind, row, onClose }: { applicantId: string; kind: ApplicantCheckKind; row: MediatorApplicantCheck; onClose: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ApplicantCheckStatus>(row.status as ApplicantCheckStatus);
  const [referenceNumber, setReferenceNumber] = useState(row.referenceNumber ?? "");
  const [provider, setProvider] = useState(row.provider ?? "");
  const [issuedAt, setIssuedAt] = useState(row.issuedAt ?? "");
  const [expiresAt, setExpiresAt] = useState(row.expiresAt ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState(row.evidenceUrl ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [ppcSupervisorName, setPpcSupervisorName] = useState(row.ppcSupervisorName ?? "");
  const [ppcSupervisorOrg, setPpcSupervisorOrg] = useState(row.ppcSupervisorOrg ?? "");
  const [ppcSupervisorEmail, setPpcSupervisorEmail] = useState(row.ppcSupervisorEmail ?? "");
  const [ppcSupervisorPhone, setPpcSupervisorPhone] = useState(row.ppcSupervisorPhone ?? "");
  const [ppcSupervisorLastSignoff, setPpcSupervisorLastSignoff] = useState(row.ppcSupervisorLastSignoff ?? "");
  const [ppcSupervisorNextReview, setPpcSupervisorNextReview] = useState(row.ppcSupervisorNextReview ?? "");

  useEffect(() => {
    setStatus(row.status as ApplicantCheckStatus);
    setReferenceNumber(row.referenceNumber ?? "");
    setProvider(row.provider ?? "");
    setIssuedAt(row.issuedAt ?? "");
    setExpiresAt(row.expiresAt ?? "");
    setEvidenceUrl(row.evidenceUrl ?? "");
    setNotes(row.notes ?? "");
    setPpcSupervisorName(row.ppcSupervisorName ?? "");
    setPpcSupervisorOrg(row.ppcSupervisorOrg ?? "");
    setPpcSupervisorEmail(row.ppcSupervisorEmail ?? "");
    setPpcSupervisorPhone(row.ppcSupervisorPhone ?? "");
    setPpcSupervisorLastSignoff(row.ppcSupervisorLastSignoff ?? "");
    setPpcSupervisorNextReview(row.ppcSupervisorNextReview ?? "");
  }, [row]);

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/mediator-applicants/${applicantId}/checks/${kind}`, {
      status,
      referenceNumber: referenceNumber || null,
      provider: kind === "pi_insurance" || kind === "other_regulator" ? (provider || null) : undefined,
      issuedAt: issuedAt || null,
      expiresAt: expiresAt || null,
      evidenceUrl: evidenceUrl || null,
      notes: notes || null,
      ppcSupervisorName: kind === "ppc_supervision" ? (ppcSupervisorName || null) : undefined,
      ppcSupervisorOrg: kind === "ppc_supervision" ? (ppcSupervisorOrg || null) : undefined,
      ppcSupervisorEmail: kind === "ppc_supervision" ? (ppcSupervisorEmail || null) : undefined,
      ppcSupervisorPhone: kind === "ppc_supervision" ? (ppcSupervisorPhone || null) : undefined,
      ppcSupervisorLastSignoff: kind === "ppc_supervision" ? (ppcSupervisorLastSignoff || null) : undefined,
      ppcSupervisorNextReview: kind === "ppc_supervision" ? (ppcSupervisorNextReview || null) : undefined,
    }),
    onSuccess: () => { invalidateAll(applicantId); toast({ title: "Check updated" }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't save check", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{KIND_LABEL[kind]}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ApplicantCheckStatus)}>
              <SelectTrigger data-testid="select-check-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {APPLICANT_CHECK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind !== "ppc_supervision" && (
            <div className="space-y-1">
              <Label className="text-xs">
                {kind === "pi_insurance" ? "Policy number" : kind === "dbs" ? "Certificate number" : kind === "other_regulator" ? "Regulator number" : "Reference number / URN"}
              </Label>
              <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} data-testid="input-check-reference" />
            </div>
          )}
          {kind === "pi_insurance" && (
            <div className="space-y-1">
              <Label className="text-xs">Provider</Label>
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="input-check-provider" />
            </div>
          )}
          {kind === "other_regulator" && (
            <div className="space-y-1">
              <Label className="text-xs">Regulator name</Label>
              <Input value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="input-check-provider" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Issued</Label>
            <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} data-testid="input-check-issued" />
          </div>
          {kind !== "dbs" && kind !== "ppc_supervision" && (
            <div className="space-y-1">
              <Label className="text-xs">Expires</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} data-testid="input-check-expires" />
            </div>
          )}
          {kind === "ppc_supervision" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Supervisor name</Label>
                <Input value={ppcSupervisorName} onChange={(e) => setPpcSupervisorName(e.target.value)} data-testid="input-check-ppc-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Organisation</Label>
                <Input value={ppcSupervisorOrg} onChange={(e) => setPpcSupervisorOrg(e.target.value)} data-testid="input-check-ppc-org" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={ppcSupervisorEmail} onChange={(e) => setPpcSupervisorEmail(e.target.value)} data-testid="input-check-ppc-email" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={ppcSupervisorPhone} onChange={(e) => setPpcSupervisorPhone(e.target.value)} data-testid="input-check-ppc-phone" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Last sign-off</Label>
                <Input type="date" value={ppcSupervisorLastSignoff} onChange={(e) => setPpcSupervisorLastSignoff(e.target.value)} data-testid="input-check-ppc-last-signoff" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Next review due</Label>
                <Input type="date" value={ppcSupervisorNextReview} onChange={(e) => setPpcSupervisorNextReview(e.target.value)} data-testid="input-check-ppc-next-review" />
              </div>
            </>
          )}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Evidence URL</Label>
            <Input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://…" data-testid="input-check-evidence" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-check-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-check">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReferenceRow({ applicantId, row }: { applicantId: string; row: MediatorApplicantReference }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const verify = useMutation({
    mutationFn: (status: ApplicantCheckStatus) =>
      apiRequest("PATCH", `/api/mediator-applicants/${applicantId}/references/${row.id}`, { status }),
    onSuccess: () => { invalidateAll(applicantId); toast({ title: "Reference updated" }); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/mediator-applicants/${applicantId}/references/${row.id}`),
    onSuccess: () => { invalidateAll(applicantId); toast({ title: "Reference removed" }); },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border p-2 bg-card" data-testid={`row-reference-${row.id}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{row.refereeName}</p>
          <p className="text-[11px] text-muted-foreground truncate">{row.refereeEmail}</p>
        </div>
        <Badge variant={STATUS_VARIANT[row.status as ApplicantCheckStatus]} className="text-[10px] capitalize">
          {row.status}
        </Badge>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)} data-testid={`button-edit-reference-${row.id}`}>
          <Pencil className="w-3 h-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove.mutate()} disabled={remove.isPending} data-testid={`button-delete-reference-${row.id}`}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      {(row.organisation || row.relationship) && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {row.organisation && <span className="mr-2">{row.organisation}</span>}
          {row.relationship && <span>· {row.relationship}</span>}
        </div>
      )}
      {row.status !== "verified" && (
        <div className="flex gap-2 mt-2">
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => verify.mutate("verified")} disabled={verify.isPending} data-testid={`button-verify-reference-${row.id}`}>
            Mark verified
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => verify.mutate("failed")} disabled={verify.isPending} data-testid={`button-fail-reference-${row.id}`}>
            Mark failed
          </Button>
        </div>
      )}
      {editing && (
        <ReferenceEditDialog
          applicantId={applicantId}
          row={row}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function ReferenceEditDialog({ applicantId, row, onClose }: { applicantId: string; row: MediatorApplicantReference; onClose: () => void }) {
  const { toast } = useToast();
  const [refereeName, setRefereeName] = useState(row.refereeName);
  const [refereeEmail, setRefereeEmail] = useState(row.refereeEmail);
  const [refereePhone, setRefereePhone] = useState(row.refereePhone ?? "");
  const [organisation, setOrganisation] = useState(row.organisation ?? "");
  const [relationship, setRelationship] = useState(row.relationship ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/mediator-applicants/${applicantId}/references/${row.id}`, {
      refereeName, refereeEmail,
      refereePhone: refereePhone || null,
      organisation: organisation || null,
      relationship: relationship || null,
      notes: notes || null,
    }),
    onSuccess: () => { invalidateAll(applicantId); toast({ title: "Reference updated" }); onClose(); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit reference</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={refereeName} onChange={(e) => setRefereeName(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={refereeEmail} onChange={(e) => setRefereeEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={refereePhone} onChange={(e) => setRefereePhone(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Organisation</Label><Input value={organisation} onChange={(e) => setOrganisation(e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Relationship</Label><Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Co-mediator, Supervisor" /></div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{row.status === "failed" ? "Reason for failure / reupload" : "Notes"}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddReferenceForm({ applicantId }: { applicantId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [refereeName, setRefereeName] = useState("");
  const [refereeEmail, setRefereeEmail] = useState("");
  const [refereePhone, setRefereePhone] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [relationship, setRelationship] = useState("");

  function reset() {
    setRefereeName(""); setRefereeEmail(""); setRefereePhone("");
    setOrganisation(""); setRelationship("");
  }

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediator-applicants/${applicantId}/references`, {
      refereeName, refereeEmail,
      refereePhone: refereePhone || null,
      organisation: organisation || null,
      relationship: relationship || null,
    }),
    onSuccess: () => { invalidateAll(applicantId); toast({ title: "Reference added" }); reset(); setOpen(false); },
    onError: (e: Error) => toast({ title: "Couldn't add reference", description: e.message, variant: "destructive" }),
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={() => setOpen(true)} data-testid="button-add-reference">
        <Plus className="w-3 h-3 mr-1" />Add reference
      </Button>
    );
  }
  return (
    <div className="rounded-md border p-2 bg-card space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={refereeName} onChange={(e) => setRefereeName(e.target.value)} data-testid="input-new-reference-name" /></div>
        <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={refereeEmail} onChange={(e) => setRefereeEmail(e.target.value)} data-testid="input-new-reference-email" /></div>
        <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={refereePhone} onChange={(e) => setRefereePhone(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Organisation</Label><Input value={organisation} onChange={(e) => setOrganisation(e.target.value)} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-xs">Relationship</Label><Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Co-mediator" /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || !refereeName.trim() || !refereeEmail.trim()} data-testid="button-save-new-reference">
          {create.isPending ? "Saving…" : "Add"}
        </Button>
      </div>
    </div>
  );
}
