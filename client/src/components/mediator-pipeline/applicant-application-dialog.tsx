import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { User, Shield, BookUser, Briefcase, Save, ChevronDown, ChevronRight, Mail } from "lucide-react";
import {
  FMC_ACCREDITATION_STATUSES,
  LEAD_SOURCES,
  type MediatorApplicant,
  type MediatorApplicantCheck,
  type MediatorApplicantReference,
  type ApplicantCheckKind,
  type ApplicantCheckStatus,
  type ServiceType as SchemaServiceType,
} from "@shared/schema";

const NONE_VALUE = "__none__";

type ServiceType = Pick<SchemaServiceType, "id" | "name" | "isActive">;
type ServiceApprovalRecord = {
  id: string;
  applicantId: string | null;
  mediatorId: string | null;
  serviceTypeId: string;
  status: string;
  effectiveStatus?: string;
  proofFileName?: string | null;
  proofFileUrl?: string | null;
  proofLink?: string | null;
  proofMimeType?: string | null;
  expiryDate?: string | null;
  requestedAt?: string | Date | null;
  requestedBy?: string | null;
  reviewedAt?: string | Date | null;
  reviewedBy?: string | null;
  reviewReason?: string | null;
  serviceType?: ServiceType | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  verified: "default",
  failed: "destructive",
};

const KIND_LABEL: Record<string, string> = {
  fmc_cmc: "FMC / CMC Registration",
  other_regulator: "Other Regulator Check",
  pi_insurance: "Professional Indemnity Insurance",
  dbs: "DBS Check",
  ppc_supervision: "PPC Supervision",
};

function invalidatePipeline(id: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", id] });
  queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", id, "service-approvals"] });
}

// ── Personal Details section ──────────────────────────────────────────────────
function PersonalDetailsSection({ applicantId, applicant }: { applicantId: string; applicant: MediatorApplicant }) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(applicant.firstName);
  const [lastName, setLastName] = useState(applicant.lastName);
  const [email, setEmail] = useState(applicant.email);
  const [phone, setPhone] = useState(applicant.phone ?? "");
  const [source, setSource] = useState(applicant.source ?? "");

  useEffect(() => {
    setFirstName(applicant.firstName);
    setLastName(applicant.lastName);
    setEmail(applicant.email);
    setPhone(applicant.phone ?? "");
    setSource(applicant.source ?? "");
  }, [applicant]);

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/mediator-applicants/${applicantId}`, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      source: source.trim() || null,
    }),
    onSuccess: () => {
      invalidatePipeline(applicantId);
      toast({ title: "Personal details saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // Determine if source matches a known lead source
  const isKnownSource = source === "" || (LEAD_SOURCES as readonly string[]).includes(source);
  const sourceDisplayValue = source === "" ? NONE_VALUE : (isKnownSource ? source : "other_custom");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">First name</Label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-app-first-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Last name</Label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-app-last-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-app-email" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 000000" data-testid="input-app-phone" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">How did they hear about us?</Label>
          <Select
            value={sourceDisplayValue}
            onValueChange={(v) => {
              if (v === NONE_VALUE) setSource("");
              else if (v === "other_custom") { /* keep existing */ }
              else setSource(v);
            }}
          >
            <SelectTrigger data-testid="select-app-source">
              <SelectValue placeholder="Not specified" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>— Not specified —</SelectItem>
              {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              {!isKnownSource && source && (
                <SelectItem value="other_custom">{source} (custom)</SelectItem>
              )}
            </SelectContent>
          </Select>
          {!isKnownSource && source && (
            <Input
              className="mt-1"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Custom source…"
              data-testid="input-app-source-custom"
            />
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-personal">
          <Save className="w-3 h-3 mr-1" />{save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Professional Background section ──────────────────────────────────────────
function ProfessionalBackgroundSection({ applicantId, applicant }: { applicantId: string; applicant: MediatorApplicant }) {
  const { toast } = useToast();
  const [accreditationStatus, setAccreditationStatus] = useState(applicant.accreditationStatus ?? "");
  const [areaOfPractice, setAreaOfPractice] = useState<string[]>(applicant.areaOfPractice ?? []);

  useEffect(() => {
    setAccreditationStatus(applicant.accreditationStatus ?? "");
    setAreaOfPractice(applicant.areaOfPractice ?? []);
  }, [applicant]);

  const { data: serviceTypes } = useQuery<ServiceType[]>({
    queryKey: ["/api/service-types"],
  });

  const practiceOptions = Array.from(new Set([
    ...(serviceTypes?.filter((s) => s.isActive).map((s) => s.name) ?? []),
    ...areaOfPractice,
  ])).sort();

  function toggleArea(name: string) {
    setAreaOfPractice((prev) => prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]);
  }

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/mediator-applicants/${applicantId}`, {
      accreditationStatus: accreditationStatus || null,
      areaOfPractice,
    }),
    onSuccess: () => {
      invalidatePipeline(applicantId);
      toast({ title: "Background saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">FMC accreditation status</Label>
        <Select
          value={accreditationStatus || NONE_VALUE}
          onValueChange={(v) => setAccreditationStatus(v === NONE_VALUE ? "" : v)}
        >
          <SelectTrigger data-testid="select-app-accreditation">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
            {FMC_ACCREDITATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            {accreditationStatus && !(FMC_ACCREDITATION_STATUSES as readonly string[]).includes(accreditationStatus) && (
              <SelectItem value={accreditationStatus}>{accreditationStatus} (legacy — please re-select)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Areas of practice</Label>
        {areaOfPractice.length > 0 && (
          <p className="text-xs text-muted-foreground">{areaOfPractice.length} selected</p>
        )}
        <div className="grid grid-cols-2 gap-1 rounded border p-2 max-h-40 overflow-y-auto bg-muted/20">
          {practiceOptions.length === 0 && (
            <p className="col-span-2 text-xs text-muted-foreground italic">No service types configured.</p>
          )}
          {practiceOptions.map((name) => (
            <label key={name} className="flex items-center gap-2 text-xs cursor-pointer px-1 py-0.5 rounded hover:bg-muted/50">
              <Checkbox
                checked={areaOfPractice.includes(name)}
                onCheckedChange={() => toggleArea(name)}
                data-testid={`checkbox-app-area-${name}`}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-background">
          <Save className="w-3 h-3 mr-1" />{save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Single credential row ────────────────────────────────────────────────────
function CredentialRow({ applicantId, kind, check }: {
  applicantId: string;
  kind: ApplicantCheckKind;
  check: MediatorApplicantCheck | undefined;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState(check?.referenceNumber ?? "");
  const [provider, setProvider] = useState(check?.provider ?? "");
  const [issuedAt, setIssuedAt] = useState(check?.issuedAt ?? "");
  const [expiresAt, setExpiresAt] = useState(check?.expiresAt ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState(check?.evidenceUrl ?? "");
  const [notes, setNotes] = useState(check?.notes ?? "");
  const [ppcSupervisorName, setPpcSupervisorName] = useState(check?.ppcSupervisorName ?? "");
  const [ppcSupervisorOrg, setPpcSupervisorOrg] = useState(check?.ppcSupervisorOrg ?? "");
  const [ppcSupervisorEmail, setPpcSupervisorEmail] = useState(check?.ppcSupervisorEmail ?? "");
  const [ppcSupervisorPhone, setPpcSupervisorPhone] = useState(check?.ppcSupervisorPhone ?? "");
  const [ppcSupervisorLastSignoff, setPpcSupervisorLastSignoff] = useState(check?.ppcSupervisorLastSignoff ?? "");
  const [ppcSupervisorNextReview, setPpcSupervisorNextReview] = useState(check?.ppcSupervisorNextReview ?? "");

  useEffect(() => {
    setReferenceNumber(check?.referenceNumber ?? "");
    setProvider(check?.provider ?? "");
    setIssuedAt(check?.issuedAt ?? "");
    setExpiresAt(check?.expiresAt ?? "");
    setEvidenceUrl(check?.evidenceUrl ?? "");
    setNotes(check?.notes ?? "");
    setPpcSupervisorName(check?.ppcSupervisorName ?? "");
    setPpcSupervisorOrg(check?.ppcSupervisorOrg ?? "");
    setPpcSupervisorEmail(check?.ppcSupervisorEmail ?? "");
    setPpcSupervisorPhone(check?.ppcSupervisorPhone ?? "");
    setPpcSupervisorLastSignoff(check?.ppcSupervisorLastSignoff ?? "");
    setPpcSupervisorNextReview(check?.ppcSupervisorNextReview ?? "");
  }, [check]);

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/mediator-applicants/${applicantId}/checks/${kind}`, {
      status: check?.status ?? "pending",
      referenceNumber: referenceNumber.trim() || null,
      provider: kind === "pi_insurance" || kind === "other_regulator" ? (provider.trim() || null) : undefined,
      issuedAt: issuedAt || null,
      expiresAt: kind === "ppc_supervision" ? null : (expiresAt || null),
      evidenceUrl: evidenceUrl.trim() || null,
      notes: notes.trim() || null,
      ppcSupervisorName: kind === "ppc_supervision" ? (ppcSupervisorName.trim() || null) : undefined,
      ppcSupervisorOrg: kind === "ppc_supervision" ? (ppcSupervisorOrg.trim() || null) : undefined,
      ppcSupervisorEmail: kind === "ppc_supervision" ? (ppcSupervisorEmail.trim() || null) : undefined,
      ppcSupervisorPhone: kind === "ppc_supervision" ? (ppcSupervisorPhone.trim() || null) : undefined,
      ppcSupervisorLastSignoff: kind === "ppc_supervision" ? (ppcSupervisorLastSignoff || null) : undefined,
      ppcSupervisorNextReview: kind === "ppc_supervision" ? (ppcSupervisorNextReview || null) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "checks"] });
      invalidatePipeline(applicantId);
      toast({ title: `${KIND_LABEL[kind]} saved` });
      setExpanded(false);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const hasData = referenceNumber || provider || issuedAt || expiresAt || evidenceUrl || notes || ppcSupervisorName || ppcSupervisorOrg || ppcSupervisorEmail || ppcSupervisorPhone || ppcSupervisorLastSignoff || ppcSupervisorNextReview;

  return (
    <div className="rounded-md border bg-card" data-testid={`row-app-check-${kind}`}>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-md"
        onClick={() => setExpanded((e) => !e)}
        data-testid={`button-expand-check-${kind}`}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <span className="text-xs font-medium flex-1">{KIND_LABEL[kind]}</span>
        {check?.status && (
          <Badge variant={STATUS_VARIANT[check.status] ?? "outline"} className="text-[10px] capitalize">
            {check.status}
          </Badge>
        )}
        {!check && <Badge variant="outline" className="text-[10px]">No data</Badge>}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          <div className="grid grid-cols-2 gap-2">
            {kind !== "ppc_supervision" && (
              <div className="space-y-1">
                <Label className="text-xs">
                  {kind === "pi_insurance" ? "Policy number" : kind === "dbs" ? "Certificate number" : kind === "other_regulator" ? "Regulator number" : "URN / Reference number"}
                </Label>
                <Input
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder={kind === "fmc_cmc" ? "e.g. FMC12345" : kind === "dbs" ? "DBS cert number" : kind === "other_regulator" ? "Regulator number" : "Policy number"}
                  data-testid={`input-app-check-ref-${kind}`}
                />
              </div>
            )}
            {(kind === "pi_insurance" || kind === "other_regulator") && (
              <div className="space-y-1">
                <Label className="text-xs">{kind === "pi_insurance" ? "Provider" : "Regulator name"}</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder={kind === "pi_insurance" ? "e.g. Hiscox" : "Regulator name"}
                  data-testid="input-app-check-provider"
                />
              </div>
            )}
            {kind !== "ppc_supervision" && (
              <div className="space-y-1">
                <Label className="text-xs">{kind === "pi_insurance" ? "Issue date" : "Date"}</Label>
                <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} data-testid={`input-app-check-issued-${kind}`} />
              </div>
            )}
            {kind !== "dbs" && kind !== "ppc_supervision" && (
              <div className="space-y-1">
                <Label className="text-xs">Expiry date</Label>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} data-testid={`input-app-check-expiry-${kind}`} />
              </div>
            )}
            {kind === "ppc_supervision" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Supervisor name</Label>
                  <Input value={ppcSupervisorName} onChange={(e) => setPpcSupervisorName(e.target.value)} data-testid="input-app-check-ppc-name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Organisation</Label>
                  <Input value={ppcSupervisorOrg} onChange={(e) => setPpcSupervisorOrg(e.target.value)} data-testid="input-app-check-ppc-org" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={ppcSupervisorEmail} onChange={(e) => setPpcSupervisorEmail(e.target.value)} data-testid="input-app-check-ppc-email" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Phone</Label>
                  <Input value={ppcSupervisorPhone} onChange={(e) => setPpcSupervisorPhone(e.target.value)} data-testid="input-app-check-ppc-phone" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Last sign-off</Label>
                  <Input type="date" value={ppcSupervisorLastSignoff} onChange={(e) => setPpcSupervisorLastSignoff(e.target.value)} data-testid="input-app-check-ppc-last-signoff" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Next review due</Label>
                  <Input type="date" value={ppcSupervisorNextReview} onChange={(e) => setPpcSupervisorNextReview(e.target.value)} data-testid="input-app-check-ppc-next-review" />
                </div>
              </>
            )}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Evidence URL</Label>
              <Input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://…" data-testid={`input-app-check-evidence-${kind}`} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid={`input-app-check-notes-${kind}`} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid={`button-save-check-${kind}`}>
              <Save className="w-3 h-3 mr-1" />{save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Single reference card ────────────────────────────────────────────────────
function ReferenceCard({ applicantId, reference, index }: {
  applicantId: string;
  reference: MediatorApplicantReference;
  index: number;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [refereeName, setRefereeName] = useState(reference.refereeName);
  const [refereeEmail, setRefereeEmail] = useState(reference.refereeEmail);
  const [refereePhone, setRefereePhone] = useState(reference.refereePhone ?? "");
  const [organisation, setOrganisation] = useState(reference.organisation ?? "");
  const [relationship, setRelationship] = useState(reference.relationship ?? "");

  useEffect(() => {
    setRefereeName(reference.refereeName);
    setRefereeEmail(reference.refereeEmail);
    setRefereePhone(reference.refereePhone ?? "");
    setOrganisation(reference.organisation ?? "");
    setRelationship(reference.relationship ?? "");
  }, [reference]);

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/mediator-applicants/${applicantId}/references/${reference.id}`, {
      refereeName: refereeName.trim(),
      refereeEmail: refereeEmail.trim(),
      refereePhone: refereePhone.trim() || null,
      organisation: organisation.trim() || null,
      relationship: relationship.trim() || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "references"] });
      invalidatePipeline(applicantId);
      toast({ title: "Reference saved" });
      setEditing(false);
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border p-3 bg-card space-y-2" data-testid={`card-app-reference-${index}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Reference {index + 1}</span>
          {reference.status && (
            <Badge variant={STATUS_VARIANT[reference.status] ?? "outline"} className="text-[10px] capitalize">
              {reference.status}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setEditing((e) => !e)}
          data-testid={`button-edit-app-reference-${index}`}
        >
          {editing ? "Collapse" : "Edit"}
        </Button>
      </div>

      {!editing ? (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p className="font-medium text-foreground">{reference.refereeName}</p>
          <p>{reference.refereeEmail}</p>
          {reference.refereePhone && <p>{reference.refereePhone}</p>}
          {(reference.organisation || reference.relationship) && (
            <p>{[reference.organisation, reference.relationship].filter(Boolean).join(" · ")}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input value={refereeName} onChange={(e) => setRefereeName(e.target.value)} data-testid={`input-app-ref-name-${index}`} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email *</Label>
              <Input type="email" value={refereeEmail} onChange={(e) => setRefereeEmail(e.target.value)} data-testid={`input-app-ref-email-${index}`} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone</Label>
              <Input value={refereePhone} onChange={(e) => setRefereePhone(e.target.value)} data-testid={`input-app-ref-phone-${index}`} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Organisation</Label>
              <Input value={organisation} onChange={(e) => setOrganisation(e.target.value)} data-testid={`input-app-ref-org-${index}`} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Role / job title</Label>
              <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Senior Mediator" data-testid={`input-app-ref-role-${index}`} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              disabled={save.isPending || !refereeName.trim() || !refereeEmail.trim()}
              data-testid={`button-save-app-reference-${index}`}
            >
              <Save className="w-3 h-3 mr-1" />{save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────
export function ApplicantApplicationDialog({
  applicantId,
  applicantName,
  open,
  onClose,
  }: {
  applicantId: string;
  applicantName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { data: applicant, isLoading: loadingApplicant } = useQuery<MediatorApplicant>({
    queryKey: ["/api/mediator-applicants", applicantId],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load applicant");
      return res.json();
    },
    enabled: open && !!applicantId,
  });

  const { data: checks, isLoading: loadingChecks } = useQuery<MediatorApplicantCheck[]>({
    queryKey: ["/api/mediator-applicants", applicantId, "checks"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}/checks`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!applicantId,
  });

  const { data: refs, isLoading: loadingRefs } = useQuery<MediatorApplicantReference[]>({
    queryKey: ["/api/mediator-applicants", applicantId, "references"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}/references`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!applicantId,
  });

  const { data: serviceTypes } = useQuery<ServiceType[]>({
    queryKey: ["/api/service-types"],
    enabled: open && !!applicantId,
  });

  const { data: serviceApprovals, isLoading: loadingServiceApprovals } = useQuery<ServiceApprovalRecord[]>({
    queryKey: ["/api/mediator-applicants", applicantId, "service-approvals"],
    queryFn: async () => {
      const res = await fetch(`/api/mediator-applicants/${applicantId}/service-approvals`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!applicantId,
  });

  const requestServiceApproval = useMutation({
    mutationFn: (serviceTypeId: string) =>
      apiRequest("POST", `/api/mediator-applicants/${applicantId}/service-approvals/${serviceTypeId}/request`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "service-approvals"] });
      toast({ title: "Document requested", description: "The applicant has been sent an update link." });
    },
    onError: (e: Error) => toast({ title: "Request failed", description: e.message, variant: "destructive" }),
  });

  const reviewServiceApproval = useMutation({
    mutationFn: (input: { serviceTypeId: string; decision: "approved" | "rejected"; reviewReason?: string | null }) =>
      apiRequest("POST", `/api/mediator-applicants/${applicantId}/service-approvals/${input.serviceTypeId}/review`, {
        decision: input.decision,
        reviewReason: input.reviewReason ?? null,
      }).then(async (res) => ({
        ...(await res.json().catch(() => ({}))),
        decision: input.decision,
      })),
    onSuccess: (result: { decision: "approved" | "rejected"; notificationSentToMediator?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants", applicantId, "service-approvals"] });
      toast({
        title: "Service review saved",
        description:
          result.decision === "rejected"
            ? (result.notificationSentToMediator ? "Notification sent to mediator." : "Notification could not be sent to mediator.")
            : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Review failed", description: e.message, variant: "destructive" }),
  });

  const approvalByServiceId = new Map((serviceApprovals ?? []).map((row) => [row.serviceTypeId, row]));
  const selectedServiceTypes = (serviceTypes ?? []).filter((service) =>
    (applicant?.areaOfPractice ?? []).includes(service.name),
  );
  const [rejectReasonByServiceId, setRejectReasonByServiceId] = useState<Record<string, string>>({});

  const isLoading = loadingApplicant || loadingChecks || loadingRefs || loadingServiceApprovals;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="dialog-application"
      >
        <DialogHeader>
          <DialogTitle>Application — {applicantName}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 py-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !applicant ? (
          <p className="text-sm text-muted-foreground py-4">Could not load application data.</p>
        ) : (
          <div className="space-y-6 pb-2">

            {/* Section 1: Personal Details */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-[#5a7d58]" />
                <h3 className="text-sm font-semibold">Personal Details</h3>
              </div>
              <PersonalDetailsSection applicantId={applicantId} applicant={applicant} />
            </div>

            <Separator />

            {/* Section 2: Professional Background */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-[#5a7d58]" />
                <h3 className="text-sm font-semibold">Professional Background</h3>
              </div>
              <ProfessionalBackgroundSection applicantId={applicantId} applicant={applicant} />
            </div>

            <Separator />

            {/* Section 3: Service approvals */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-[#5a7d58]" />
                <h3 className="text-sm font-semibold">Service approvals</h3>
                <span className="text-xs text-muted-foreground ml-1">{serviceApprovals?.length ?? 0} record(s)</span>
              </div>
              {(serviceTypes ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No services configured.</p>
              ) : selectedServiceTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No services were selected by the mediator.</p>
              ) : (
                <div className="space-y-2">
                  {selectedServiceTypes.map((service) => {
                    const approval = approvalByServiceId.get(service.id);
                    const status = approval ? (approval.effectiveStatus ?? approval.status ?? null).toLowerCase() : null;
                    const displayStatus = approval?.reviewReason && status === "requested" ? "rejected" : status;
                    const showStatusBadge = Boolean(displayStatus && (displayStatus !== "requested" || approval?.requestedBy || approval?.requestedAt || approval?.reviewedAt || approval?.proofFileUrl || approval?.proofLink));
                    const isPendingReview = status === "pending_review";
                    const reason = rejectReasonByServiceId[service.id] ?? "";
                    const needsRequest = !approval || approval.status === "rejected" || approval.effectiveStatus === "rejected" || approval.status === "expired" || approval.effectiveStatus === "expired";
                    return (
                      <div key={service.id} className="rounded-md border bg-card p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{service.name}</p>
                            <p className="text-xs text-muted-foreground">{service.category}</p>
                          </div>
                          {showStatusBadge && (
                          <Badge variant={displayStatus === "approved" ? "default" : displayStatus === "rejected" || displayStatus === "expired" ? "destructive" : displayStatus === "pending_review" ? "secondary" : "outline"} className="text-[10px] capitalize">
                              {displayStatus.replaceAll("_", " ")}
                          </Badge>
                          )}
                        </div>
                        {isPendingReview && (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={() => reviewServiceApproval.mutate({ serviceTypeId: service.id, decision: "approved" })}
                                disabled={reviewServiceApproval.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => reviewServiceApproval.mutate({ serviceTypeId: service.id, decision: "rejected", reviewReason: reason || null })}
                                disabled={reviewServiceApproval.isPending || !reason.trim()}
                              >
                                Reject
                              </Button>
                            </div>
                            <Input
                              value={reason}
                              onChange={(e) => setRejectReasonByServiceId((prev) => ({ ...prev, [service.id]: e.target.value }))}
                              placeholder="Rejection reason"
                            />
                          </div>
                        )}
                        {approval ? (
                          <div className="space-y-2 text-xs text-muted-foreground">
                            <div className="flex flex-wrap gap-2">
                              {approval.proofFileUrl && (
                                <a href={approval.proofFileUrl} target="_blank" rel="noreferrer" className="text-[#5a7d58] hover:underline">
                                  View file
                                </a>
                              )}
                              {approval.proofLink && (
                                <a href={approval.proofLink} target="_blank" rel="noreferrer" className="text-[#5a7d58] hover:underline">
                                  Open link
                                </a>
                              )}
                              {approval.expiryDate && <span>Expiry: {approval.expiryDate}</span>}
                            </div>
                            {approval.reviewReason && (
                              <p className="text-destructive">Reason: {approval.reviewReason}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No request sent yet.</p>
                        )}
                        <div className="flex flex-col gap-2">
                          {needsRequest && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => requestServiceApproval.mutate(service.id)}
                              disabled={requestServiceApproval.isPending}
                              className="w-fit"
                            >
                              <Mail className="mr-1.5 h-3.5 w-3.5" />
                              Request document
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator />

            {/* Section 4: Professional References */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BookUser className="w-4 h-4 text-[#5a7d58]" />
                <h3 className="text-sm font-semibold">Professional References</h3>
                <span className="text-xs text-muted-foreground ml-1">{refs?.length ?? 0} of 2</span>
              </div>
              {(!refs || refs.length === 0) ? (
                <p className="text-xs text-muted-foreground italic">No references submitted.</p>
              ) : (
                <div className="space-y-2">
                  {refs.map((ref, i) => (
                    <ReferenceCard
                      key={ref.id}
                      applicantId={applicantId}
                      reference={ref}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
