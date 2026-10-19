import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileText, ShieldAlert, Pencil } from "lucide-react";
import {
  APPLICANT_ENGAGEMENT_TYPES,
  type MediatorApplicantCheck,
  type ApplicantEngagementType,
} from "@shared/schema";

const ENGAGEMENT_LABEL: Record<ApplicantEngagementType, string> = {
  wta: "Freelance Mediator Agreement — WTA",
  accredited: "Freelance Mediator Agreement — Accredited",
};

const CHECKIN_DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

type ContractData = {
  engagementType: ApplicantEngagementType | null;
  contractVersion: string | null;
  contractSignedDate: string | null;
  contractFileUrl: string | null;
  timebankAgreement: boolean | null;
  timebankSignedDate: string | null;
  timebankHoursPerWeek: number | null;
  timebankCheckinDay: string | null;
  timebankCheckinTime: string | null;
  timebankFileUrl: string | null;
  icoRegistration: string | null;
  icoExpiryDate: string | null;
  icoEvidenceUrl: string | null;
};

const EMPTY: ContractData = {
  engagementType: null,
  contractVersion: null,
  contractSignedDate: null,
  contractFileUrl: null,
  timebankAgreement: false,
  timebankSignedDate: null,
  timebankHoursPerWeek: null,
  timebankCheckinDay: null,
  timebankCheckinTime: null,
  timebankFileUrl: null,
  icoRegistration: null,
  icoExpiryDate: null,
  icoEvidenceUrl: null,
};

type Group = "contract" | "timebank" | "ico";

function isExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T23:59:59");
  return Number.isFinite(d.getTime()) && d.getTime() < Date.now();
}

export function ApplicantContractPanel({ applicantId }: { applicantId: string }) {
  const { data: applicant } = useQuery<ContractData & { id: string }>({
    queryKey: ["/api/mediator-applicants", applicantId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load applicant");
      return res.json();
    },
  });

  const { data: checks } = useQuery<MediatorApplicantCheck[]>({
    queryKey: ["/api/mediator-applicants", applicantId, "checks"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}/checks`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const piRow = (checks ?? []).find((c) => c.kind === "pi_insurance") ?? null;

  const data: ContractData = applicant ? {
    engagementType: applicant.engagementType ?? null,
    contractVersion: applicant.contractVersion ?? null,
    contractSignedDate: applicant.contractSignedDate ?? null,
    contractFileUrl: applicant.contractFileUrl ?? null,
    timebankAgreement: applicant.timebankAgreement ?? false,
    timebankSignedDate: applicant.timebankSignedDate ?? null,
    timebankHoursPerWeek: applicant.timebankHoursPerWeek ?? null,
    timebankCheckinDay: applicant.timebankCheckinDay ?? null,
    timebankCheckinTime: applicant.timebankCheckinTime ?? null,
    timebankFileUrl: applicant.timebankFileUrl ?? null,
    icoRegistration: applicant.icoRegistration ?? null,
    icoExpiryDate: applicant.icoExpiryDate ?? null,
    icoEvidenceUrl: applicant.icoEvidenceUrl ?? null,
  } : EMPTY;

  const [openGroup, setOpenGroup] = useState<Group | null>(null);

  // Derived status pills
  const contractIssued = !!data.contractSignedDate;
  const icoExpired = isExpired(data.icoExpiryDate);
  const icoStatus: "missing" | "active" | "expired" =
    !data.icoRegistration || !data.icoExpiryDate ? "missing" :
    icoExpired ? "expired" :
    "active";

  return (
    <div className="space-y-3" data-testid="panel-applicant-contract">
      <h4 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <FileText className="w-3 h-3" />Contract &amp; registrations
      </h4>

      {/* Freelance mediator agreement summary */}
      <div className="rounded-md border p-2 bg-card" data-testid="card-contract-summary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium flex-1">Freelance Mediator Agreement</span>
          {contractIssued ? (
            <Badge className="text-[10px]" data-testid="badge-contract-status">Issued</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]" data-testid="badge-contract-status">Not signed</Badge>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpenGroup("contract")} data-testid="button-edit-contract">
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {(data.engagementType || data.contractVersion || data.contractSignedDate) && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {data.engagementType && <span className="mr-2">{ENGAGEMENT_LABEL[data.engagementType]}</span>}
            {data.contractVersion && <span className="mr-2">v{data.contractVersion}</span>}
            {data.contractSignedDate && <span>signed {data.contractSignedDate}</span>}
          </div>
        )}
      </div>

      {/* Time-banking summary */}
      <div className="rounded-md border p-2 bg-card" data-testid="card-timebank-summary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium flex-1">Time-banking side agreement</span>
          {data.timebankAgreement ? (
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-timebank-status">In place</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]" data-testid="badge-timebank-status">None</Badge>
          )}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpenGroup("timebank")} data-testid="button-edit-timebank">
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {data.timebankAgreement && (data.timebankHoursPerWeek != null || data.timebankCheckinDay) && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {data.timebankHoursPerWeek != null && <span className="mr-2">{data.timebankHoursPerWeek}h / week</span>}
            {data.timebankCheckinDay && (
              <span className="mr-2 capitalize">check-in {data.timebankCheckinDay}{data.timebankCheckinTime ? ` ${data.timebankCheckinTime}` : ""}</span>
            )}
            {data.timebankSignedDate && <span>signed {data.timebankSignedDate}</span>}
          </div>
        )}
      </div>

      {/* ICO summary */}
      <div className="rounded-md border p-2 bg-card" data-testid="card-ico-summary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium flex-1">ICO registration</span>
          {icoStatus === "active" && <Badge className="text-[10px]" data-testid="badge-ico-status">Active</Badge>}
          {icoStatus === "expired" && <Badge variant="destructive" className="text-[10px]" data-testid="badge-ico-status">Expired</Badge>}
          {icoStatus === "missing" && <Badge variant="outline" className="text-[10px]" data-testid="badge-ico-status">Missing</Badge>}
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpenGroup("ico")} data-testid="button-edit-ico">
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {(data.icoRegistration || data.icoExpiryDate) && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {data.icoRegistration && <span className="mr-2">#{data.icoRegistration}</span>}
            {data.icoExpiryDate && <span>exp {data.icoExpiryDate}</span>}
          </div>
        )}
      </div>

      {/* PI insurance — read-only mirror */}
      <div className="rounded-md border p-2 bg-muted/30" data-testid="card-pi-readonly">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium flex-1 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />PI insurance
          </span>
          {piRow ? (
            <Badge variant={piRow.status === "verified" ? "default" : piRow.status === "failed" ? "destructive" : "outline"} className="text-[10px] capitalize">
              {piRow.status}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">Not recorded</Badge>
          )}
        </div>
        {piRow && (piRow.provider || piRow.referenceNumber || piRow.expiresAt) && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {piRow.provider && <span className="mr-2">{piRow.provider}</span>}
            {piRow.referenceNumber && <span className="mr-2">#{piRow.referenceNumber}</span>}
            {piRow.expiresAt && <span>exp {piRow.expiresAt}</span>}
          </div>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground italic">
          Manage insurance in the Credential Checks card above.
        </p>
      </div>

      {openGroup && (
        <ContractEditDialog
          applicantId={applicantId}
          group={openGroup}
          current={data}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  );
}

function ContractEditDialog({
  applicantId, group, current, onClose,
}: { applicantId: string; group: Group; current: ContractData; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<ContractData>(current);
  useEffect(() => { setForm(current); }, [current]);

  const set = <K extends keyof ContractData>(k: K, v: ContractData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const str = (v: string | null | undefined) => v ?? "";

  const save = useMutation({
    mutationFn: () => {
      // Send only the fields belonging to the active group so audit logs
      // stay scoped to what the user actually edited.
      const payload: Partial<ContractData> = {};
      if (group === "contract") {
        payload.engagementType = form.engagementType;
        payload.contractVersion = form.contractVersion;
        payload.contractSignedDate = form.contractSignedDate;
        payload.contractFileUrl = form.contractFileUrl;
      } else if (group === "timebank") {
        payload.timebankAgreement = form.timebankAgreement;
        payload.timebankSignedDate = form.timebankSignedDate;
        payload.timebankHoursPerWeek = form.timebankHoursPerWeek;
        payload.timebankCheckinDay = form.timebankCheckinDay;
        payload.timebankCheckinTime = form.timebankCheckinTime;
        payload.timebankFileUrl = form.timebankFileUrl;
      } else {
        payload.icoRegistration = form.icoRegistration;
        payload.icoExpiryDate = form.icoExpiryDate;
        payload.icoEvidenceUrl = form.icoEvidenceUrl;
      }
      return apiRequest("PATCH", `/api/mediator-applicants/${applicantId}/contract`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      toast({ title: "Saved" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const title =
    group === "contract" ? "Freelance Mediator Agreement" :
    group === "timebank" ? "Time-banking side agreement" :
    "ICO registration";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        {group === "contract" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Variant</Label>
              <Select
                value={form.engagementType ?? ""}
                onValueChange={(v) => set("engagementType", (v || null) as ApplicantEngagementType | null)}
              >
                <SelectTrigger data-testid="select-engagement-type"><SelectValue placeholder="Select variant" /></SelectTrigger>
                <SelectContent>
                  {APPLICANT_ENGAGEMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{ENGAGEMENT_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contract version</Label>
              <Input value={str(form.contractVersion)} onChange={(e) => set("contractVersion", e.target.value || null)} placeholder="v2.1" data-testid="input-contract-version" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Signed date</Label>
              <Input type="date" value={str(form.contractSignedDate)} onChange={(e) => set("contractSignedDate", e.target.value || null)} data-testid="input-contract-signed" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Evidence URL</Label>
              <Input value={str(form.contractFileUrl)} onChange={(e) => set("contractFileUrl", e.target.value || null)} placeholder="https://…" data-testid="input-contract-url" />
            </div>
          </div>
        )}

        {group === "timebank" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Switch id="tb-toggle" checked={!!form.timebankAgreement} onCheckedChange={(v) => set("timebankAgreement", v)} data-testid="switch-timebank" />
              <Label htmlFor="tb-toggle" className="text-xs">Time-banking agreement in place</Label>
            </div>
            {form.timebankAgreement && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Signed date</Label>
                  <Input type="date" value={str(form.timebankSignedDate)} onChange={(e) => set("timebankSignedDate", e.target.value || null)} data-testid="input-timebank-signed" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hours / week</Label>
                  <Input type="number" min={0} max={80} value={form.timebankHoursPerWeek ?? ""} onChange={(e) => {
                    const n = e.target.value === "" ? null : Number(e.target.value);
                    set("timebankHoursPerWeek", Number.isFinite(n) ? (n as number) : null);
                  }} data-testid="input-timebank-hours" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Check-in day</Label>
                  <Select value={form.timebankCheckinDay ?? ""} onValueChange={(v) => set("timebankCheckinDay", v || null)}>
                    <SelectTrigger data-testid="select-timebank-day"><SelectValue placeholder="Select day" /></SelectTrigger>
                    <SelectContent>
                      {CHECKIN_DAYS.map((d) => (
                        <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Check-in time</Label>
                  <Input type="time" value={str(form.timebankCheckinTime)} onChange={(e) => set("timebankCheckinTime", e.target.value || null)} data-testid="input-timebank-time" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Evidence URL</Label>
                  <Input value={str(form.timebankFileUrl)} onChange={(e) => set("timebankFileUrl", e.target.value || null)} placeholder="https://…" data-testid="input-timebank-url" />
                </div>
              </div>
            )}
          </div>
        )}

        {group === "ico" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Registration number</Label>
              <Input value={str(form.icoRegistration)} onChange={(e) => set("icoRegistration", e.target.value || null)} placeholder="ZA123456" data-testid="input-ico-number" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expiry date</Label>
              <Input type="date" value={str(form.icoExpiryDate)} onChange={(e) => set("icoExpiryDate", e.target.value || null)} data-testid="input-ico-expiry" />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Evidence URL</Label>
              <Input value={str(form.icoEvidenceUrl)} onChange={(e) => set("icoEvidenceUrl", e.target.value || null)} placeholder="https://…" data-testid="input-ico-url" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-contract">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
