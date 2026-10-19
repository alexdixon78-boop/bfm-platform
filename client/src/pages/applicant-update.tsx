import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, AlertCircle, Plus, Trash2, User, Shield, BookUser, Loader2 } from "lucide-react";
import { BFMLogoMark } from "@/components/bfm-logo";
import {
  APPLICANT_CHECK_KINDS,
  FMC_ACCREDITATION_STATUSES,
  LEAD_SOURCES,
  type ApplicantCheckKind,
  type ServiceType,
} from "@shared/schema";

const NONE_VALUE = "__none__";
const OTHER_VALUE = "Other";
const DBS_LEVELS = ["Basic", "Standard", "Enhanced", "Enhanced with barred lists"] as const;

function getTodayIsoDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

type Reference = {
  refereeName: string;
  refereeEmail: string;
  refereePhone: string;
  organisation: string;
  roleOrJobTitle: string;
};

type ServiceApprovalDraft = {
  proofLink: string;
  proofFileName: string;
  proofFileData: string;
  proofMimeType: string;
  expiryDate: string;
};

type PrefillServiceApproval = {
  serviceTypeId: string;
  proofLink: string;
  proofFileName: string;
  proofFileData: string;
  proofMimeType: string;
  expiryDate: string;
  status?: string;
  effectiveStatus?: string;
  reviewReason?: string;
};

type CredentialCheckSummary = {
  kind: string;
  label: string;
  status: string;
  referenceNumber: string;
  provider: string;
  issuedAt: string;
  expiresAt: string;
  evidenceUrl: string;
  notes: string;
  ppcSupervisorName: string;
  ppcSupervisorOrg: string;
  ppcSupervisorEmail: string;
  ppcSupervisorPhone: string;
  ppcSupervisorLastSignoff: string;
  ppcSupervisorNextReview: string;
};

type CredentialDraft = {
  kind: ApplicantCheckKind;
  status: string;
  referenceNumber: string;
  provider: string;
  issuedAt: string;
  expiresAt: string;
  evidenceUrl: string;
  notes: string;
  ppcSupervisorName: string;
  ppcSupervisorOrg: string;
  ppcSupervisorEmail: string;
  ppcSupervisorPhone: string;
  ppcSupervisorLastSignoff: string;
  ppcSupervisorNextReview: string;
};

const blankRef = (): Reference => ({
  refereeName: "", refereeEmail: "", refereePhone: "",
  organisation: "", roleOrJobTitle: "",
});

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  sourceOther: string;
  accreditationStatus: string;
  areaOfPractice: string[];
  fmcUrn: string;
  fmcDate: string;
  fmcAccreditationStatus: string;
  fmcAccreditationDate: string;
  cmcRegNumber: string;
  otherRegulatorName: string;
  otherRegulatorNumber: string;
  higherQualifications: string;
  piProvider: string;
  piPolicy: string;
  piExpiry: string;
  piPolicyNumber: string;
  piCoverAmount: string;
  piExpiryDate: string;
  piCertificateUrl: string;
  icoRegistration: string;
  icoExpiryDate: string;
  dbsLevel: string;
  dbsCert: string;
  dbsDate: string;
  dbsCertNumber: string;
  dbsIssueDate: string;
  dbsCertificateUrl: string;
  ppcSupervisorName: string;
  ppcSupervisorOrg: string;
  ppcSupervisorEmail: string;
  ppcSupervisorPhone: string;
  ppcSupervisorLastSignoff: string;
  ppcSupervisorNextReview: string;
  credentialChecks: CredentialDraft[];
  references: Reference[];
  serviceApprovals: Record<string, ServiceApprovalDraft>;
};

const blank: FormState = {
  firstName: "", lastName: "", email: "", phone: "",
  source: "", sourceOther: "", accreditationStatus: "", areaOfPractice: [],
  fmcUrn: "", fmcDate: "", fmcAccreditationStatus: "", fmcAccreditationDate: "",
  cmcRegNumber: "", otherRegulatorName: "", otherRegulatorNumber: "", higherQualifications: "",
  piProvider: "", piPolicy: "", piExpiry: "", piPolicyNumber: "", piCoverAmount: "", piExpiryDate: "", piCertificateUrl: "",
  icoRegistration: "", icoExpiryDate: "", dbsLevel: "",
  dbsCert: "", dbsDate: "", dbsCertNumber: "", dbsIssueDate: "", dbsCertificateUrl: "",
  ppcSupervisorName: "", ppcSupervisorOrg: "", ppcSupervisorEmail: "", ppcSupervisorPhone: "", ppcSupervisorLastSignoff: "", ppcSupervisorNextReview: "",
  credentialChecks: [],
  references: [],
  serviceApprovals: {},
};

function blankServiceApprovalDraft(): ServiceApprovalDraft {
  return { proofLink: "", proofFileName: "", proofFileData: "", proofMimeType: "", expiryDate: "" };
}

function readFileAsDataUrl(file: File): Promise<{ fileName: string; fileData: string; fileMimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      fileData: String(reader.result ?? ""),
      fileMimeType: file.type || "application/octet-stream",
    });
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

const CREDENTIAL_LABELS: Record<ApplicantCheckKind, string> = {
  fmc_cmc: "FMC / CMC Registration",
  other_regulator: "Other Regulator Check",
  pi_insurance: "Professional Indemnity Insurance",
  dbs: "DBS Check",
  ppc_supervision: "PPC Supervision",
};

const CREDENTIAL_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  verified: "default",
  failed: "destructive",
  not_requested: "outline",
};

const CREDENTIAL_ORDER: ApplicantCheckKind[] = APPLICANT_CHECK_KINDS as ApplicantCheckKind[];

function CredentialCheckCard({
  draft,
  onChange,
}: {
  draft: CredentialDraft;
  onChange: (patch: Partial<CredentialDraft>) => void;
}) {
  const referenceLabel =
    draft.kind === "pi_insurance"
      ? "Policy number"
      : draft.kind === "dbs"
        ? "Certificate number"
        : draft.kind === "other_regulator"
          ? "Regulator number"
          : "Reference number / URN";
  const providerLabel =
    draft.kind === "pi_insurance"
      ? "Provider"
      : draft.kind === "other_regulator"
        ? "Regulator name"
        : null;
  const showExpires = draft.kind !== "dbs" && draft.kind !== "ppc_supervision";
  const isPpc = draft.kind === "ppc_supervision";
  const statusLabel = draft.status.replaceAll("_", " ");
  const hasFailedReason = draft.status === "failed" && draft.notes.trim().length > 0;

  return (
    <div className="rounded-xl border bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">{CREDENTIAL_LABELS[draft.kind]}</p>
          <p className="text-xs text-muted-foreground">
            {draft.kind === "fmc_cmc"
              ? "Reference number, issue date, expiry, and evidence link"
              : draft.kind === "other_regulator"
                ? "Regulator details and evidence"
                : draft.kind === "pi_insurance"
                  ? "Policy details, expiry, and evidence"
                  : draft.kind === "dbs"
                    ? "Certificate details and evidence"
                    : "Supervisor details and evidence"}
          </p>
        </div>
        <Badge variant={CREDENTIAL_STATUS_VARIANT[draft.status] ?? "outline"} className="text-[10px] capitalize">
          {statusLabel}
        </Badge>
      </div>

      {hasFailedReason && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Reason for reupload: {draft.notes}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!isPpc && (
          <div className="space-y-1.5">
            <Label>{referenceLabel}</Label>
            <Input
              value={draft.referenceNumber}
              onChange={(e) => onChange({ referenceNumber: e.target.value })}
              placeholder={
                draft.kind === "fmc_cmc"
                  ? "e.g. FMC12345"
                  : draft.kind === "dbs"
                    ? "DBS certificate number"
                    : draft.kind === "other_regulator"
                      ? "Regulator number"
                      : "Policy number"
              }
            />
          </div>
        )}
        {providerLabel && (
          <div className="space-y-1.5">
            <Label>{providerLabel}</Label>
            <Input
              value={draft.provider}
              onChange={(e) => onChange({ provider: e.target.value })}
              placeholder={draft.kind === "pi_insurance" ? "e.g. Hiscox" : "Regulator name"}
            />
          </div>
        )}
        {!isPpc && (
          <div className="space-y-1.5">
            <Label>Issued</Label>
            <Input
              type="date"
              value={draft.issuedAt}
              onChange={(e) => onChange({ issuedAt: e.target.value })}
            />
          </div>
        )}
        {showExpires && (
          <div className="space-y-1.5">
            <Label>Expires</Label>
            <Input
              type="date"
              value={draft.expiresAt}
              onChange={(e) => onChange({ expiresAt: e.target.value })}
            />
          </div>
        )}
        {isPpc ? (
          <>
            <div className="space-y-1.5">
              <Label>Supervisor name</Label>
              <Input value={draft.ppcSupervisorName} onChange={(e) => onChange({ ppcSupervisorName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Organisation</Label>
              <Input value={draft.ppcSupervisorOrg} onChange={(e) => onChange({ ppcSupervisorOrg: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={draft.ppcSupervisorEmail} onChange={(e) => onChange({ ppcSupervisorEmail: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={draft.ppcSupervisorPhone} onChange={(e) => onChange({ ppcSupervisorPhone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Last sign-off</Label>
              <Input type="date" value={draft.ppcSupervisorLastSignoff} onChange={(e) => onChange({ ppcSupervisorLastSignoff: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Next review due</Label>
              <Input type="date" value={draft.ppcSupervisorNextReview} onChange={(e) => onChange({ ppcSupervisorNextReview: e.target.value })} />
            </div>
          </>
        ) : null}
        <div className="sm:col-span-2 space-y-1.5">
          <Label>Evidence URL</Label>
          <Input
            value={draft.evidenceUrl}
            onChange={(e) => onChange({ evidenceUrl: e.target.value })}
            placeholder="https://..."
          />
        </div>
      </div>
    </div>
  );
}

type PreFillData = Omit<FormState, "serviceApprovals" | "credentialChecks"> & {
  emailReadOnly?: boolean;
  updatePurpose?: "application" | "credentials" | "service_proof";
  credentialChecks?: CredentialCheckSummary[];
  serviceApprovals?: PrefillServiceApproval[];
};

export default function ApplicantUpdatePage() {
  const [, params] = useRoute("/update-application/:token");
  const token = params?.token ?? "";

  const [form, setForm] = useState<FormState>(blank);
  const [submitted, setSubmitted] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const {
    data: prefillData,
    isLoading,
    isError,
    error,
  } = useQuery<PreFillData>({
    queryKey: [`/api/public/applicant-update/${token}`],
    enabled: !!token,
    retry: false,
    // Treat 410 as an error so isError = true
  });

  const linkExpired = isError && (error as any)?.status === 410;
  const queryPurpose = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("purpose") as PreFillData["updatePurpose"] | null)
    : null;
  const updatePurpose = queryPurpose ?? prefillData?.updatePurpose ?? "application";
  const isCredentialsOnlyUpdate = updatePurpose === "credentials";
  const showContactBackground = !isCredentialsOnlyUpdate;
  const showCredentialsSection = isCredentialsOnlyUpdate;
  const showServiceProofSection = !isCredentialsOnlyUpdate;
  const failedCredentialChecks = (prefillData?.credentialChecks ?? []).filter((check) => check.status === "failed");

  // Pre-fill form once data arrives
  useEffect(() => {
    if (prefillData && !prefilled) {
      setForm({
        firstName: prefillData.firstName ?? "",
        lastName: prefillData.lastName ?? "",
        email: prefillData.email ?? "",
        phone: prefillData.phone ?? "",
        source: prefillData.source ?? "",
        sourceOther: prefillData.sourceOther ?? "",
        accreditationStatus: prefillData.accreditationStatus ?? "",
        areaOfPractice: prefillData.areaOfPractice ?? [],
        fmcUrn: prefillData.fmcUrn ?? "",
        fmcDate: prefillData.fmcDate ?? "",
        fmcAccreditationStatus: prefillData.fmcAccreditationStatus ?? "",
        fmcAccreditationDate: prefillData.fmcAccreditationDate ?? "",
        cmcRegNumber: prefillData.cmcRegNumber ?? "",
        otherRegulatorName: prefillData.otherRegulatorName ?? "",
        otherRegulatorNumber: prefillData.otherRegulatorNumber ?? "",
        higherQualifications: prefillData.higherQualifications ?? "",
        piProvider: prefillData.piProvider ?? "",
        piPolicy: prefillData.piPolicy ?? "",
        piExpiry: prefillData.piExpiry ?? "",
        piPolicyNumber: prefillData.piPolicyNumber ?? "",
        piCoverAmount: prefillData.piCoverAmount ?? "",
        piExpiryDate: prefillData.piExpiryDate ?? "",
        piCertificateUrl: prefillData.piCertificateUrl ?? "",
        icoRegistration: prefillData.icoRegistration ?? "",
        icoExpiryDate: prefillData.icoExpiryDate ?? "",
        dbsLevel: prefillData.dbsLevel ?? "",
        dbsCert: prefillData.dbsCert ?? "",
        dbsDate: prefillData.dbsDate ?? "",
        dbsCertNumber: prefillData.dbsCertNumber ?? "",
        dbsIssueDate: prefillData.dbsIssueDate ?? "",
        dbsCertificateUrl: prefillData.dbsCertificateUrl ?? "",
        ppcSupervisorName: prefillData.ppcSupervisorName ?? "",
        ppcSupervisorOrg: prefillData.ppcSupervisorOrg ?? "",
        ppcSupervisorEmail: prefillData.ppcSupervisorEmail ?? "",
        ppcSupervisorPhone: prefillData.ppcSupervisorPhone ?? "",
        ppcSupervisorLastSignoff: prefillData.ppcSupervisorLastSignoff ?? "",
        ppcSupervisorNextReview: prefillData.ppcSupervisorNextReview ?? "",
        credentialChecks: APPLICANT_CHECK_KINDS.map((kind) => {
          const existing = (prefillData.credentialChecks ?? []).find((check) => check.kind === kind);
          return {
            kind,
            status: existing?.status ?? "pending",
            referenceNumber: existing?.referenceNumber ?? "",
            provider: existing?.provider ?? "",
            issuedAt: existing?.issuedAt ?? "",
            expiresAt: existing?.expiresAt ?? "",
            evidenceUrl: existing?.evidenceUrl ?? "",
            notes: existing?.notes ?? "",
            ppcSupervisorName: existing?.ppcSupervisorName ?? "",
            ppcSupervisorOrg: existing?.ppcSupervisorOrg ?? "",
            ppcSupervisorEmail: existing?.ppcSupervisorEmail ?? "",
            ppcSupervisorPhone: existing?.ppcSupervisorPhone ?? "",
            ppcSupervisorLastSignoff: existing?.ppcSupervisorLastSignoff ?? "",
            ppcSupervisorNextReview: existing?.ppcSupervisorNextReview ?? "",
          };
        }),
        references: (prefillData.references ?? []).map((r) => ({
          refereeName: r.refereeName ?? "",
          refereeEmail: r.refereeEmail ?? "",
          refereePhone: r.refereePhone ?? "",
          organisation: r.organisation ?? "",
          roleOrJobTitle: r.roleOrJobTitle ?? "",
        })),
        serviceApprovals: Object.fromEntries((prefillData.serviceApprovals ?? []).map((s) => [
          s.serviceTypeId,
          {
            proofLink: s.proofLink ?? "",
            proofFileName: s.proofFileName ?? "",
            proofFileData: "",
            proofMimeType: s.proofMimeType ?? "",
            expiryDate: s.expiryDate ?? "",
          },
        ])),
      });
      setPrefilled(true);
    }
  }, [prefillData, prefilled]);

  // Fetch service types for area-of-practice checkboxes
  const {
    data: serviceTypes,
    isLoading: serviceTypesLoading,
    isError: serviceTypesError,
  } = useQuery<ServiceType[]>({
    queryKey: ["/api/public/service-types"],
    enabled: !!token && !linkExpired,
    staleTime: 0,
    retry: 1,
  });

  const activeByCategory = (() => {
    const active = (serviceTypes ?? []).filter((s) => s.isActive);
    const groups = new Map<string, ServiceType[]>();
    for (const s of active) {
      const arr = groups.get(s.category) ?? [];
      arr.push(s);
      groups.set(s.category, arr);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const order = ["Family", "Workplace", "Civil", "Commercial", "Other", "Packages"];
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const ra = order.indexOf(a); const rb = order.indexOf(b);
      return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    });
  })();
  const serviceTypeByName = new Map((serviceTypes ?? []).map((s) => [s.name, s]));
  const serviceTypeById = new Map((serviceTypes ?? []).map((s) => [s.id, s]));
  const requestedServiceApprovals = (prefillData?.serviceApprovals ?? []).filter(
    (approval) => approval.status === "requested" || approval.effectiveStatus === "requested",
  );
  const requestedServiceTypes = requestedServiceApprovals
    .map((approval) => serviceTypeById.get(approval.serviceTypeId))
    .filter((service): service is ServiceType => !!service);
  const proofServiceTypes = showServiceProofSection ? requestedServiceTypes : [];
  const proofRequiredServiceIds = showServiceProofSection
    ? new Set(requestedServiceApprovals.map((approval) => approval.serviceTypeId))
    : new Set<string>();

  function hasProofForService(serviceTypeId: string) {
    const draft = form.serviceApprovals[serviceTypeId];
    return !!draft && (draft.proofLink.trim().length > 0 || draft.proofFileData.trim().length > 0);
  }

  function isMissingRequiredServiceProof(serviceTypeId: string) {
    return proofRequiredServiceIds.has(serviceTypeId) && !hasProofForService(serviceTypeId);
  }

  const missingRequiredServiceProofs = proofServiceTypes.filter(
    (service) => isMissingRequiredServiceProof(service.id),
  );
  const hasMissingRequiredServiceProof = missingRequiredServiceProofs.length > 0;

  function toggleArea(name: string) {
    setForm((f) => ({
      ...f,
      areaOfPractice: f.areaOfPractice.includes(name)
        ? f.areaOfPractice.filter((n) => n !== name)
        : [...f.areaOfPractice, name],
    }));
  }

  function setRef(idx: number, field: keyof Reference, value: string) {
    setForm((f) => {
      const refs = [...f.references];
      refs[idx] = { ...refs[idx], [field]: value };
      return { ...f, references: refs };
    });
  }

  function addRef() {
    if (form.references.length < 2) {
      setForm((f) => ({ ...f, references: [...f.references, blankRef()] }));
    }
  }

  function removeRef(idx: number) {
    setForm((f) => ({ ...f, references: f.references.filter((_, i) => i !== idx) }));
  }

  function setServiceApprovalDraft(serviceTypeId: string, patch: Partial<ServiceApprovalDraft>) {
    setForm((f) => {
      const current = f.serviceApprovals[serviceTypeId] ?? blankServiceApprovalDraft();
      return {
        ...f,
        serviceApprovals: {
          ...f.serviceApprovals,
          [serviceTypeId]: { ...current, ...patch },
        },
      };
    });
  }

  function setCredentialDraft(kind: ApplicantCheckKind, patch: Partial<CredentialDraft>) {
    setForm((f) => ({
      ...f,
      credentialChecks: f.credentialChecks.map((check) =>
        check.kind === kind ? { ...check, ...patch } : check,
      ),
    }));
  }

  const submit = useMutation({
    mutationFn: async () => {
      const selectedServiceIds = new Set(proofServiceTypes.map((s) => s.id));
      const missingProofs = showServiceProofSection ? proofServiceTypes.filter((service) => isMissingRequiredServiceProof(service.id)) : [];
      if (missingProofs.length > 0) {
        throw new Error(`Missing proof for requested service: ${missingProofs.map((service) => service.name).join(", ")}`);
      }
      const serviceApprovals = Object.entries(form.serviceApprovals)
        .map(([serviceTypeId, value]) => ({
          serviceTypeId,
          proofLink: value.proofLink.trim() || undefined,
          proofFileName: value.proofFileName.trim() || undefined,
          proofFileData: value.proofFileData || undefined,
          proofMimeType: value.proofMimeType || undefined,
          expiryDate: value.expiryDate || undefined,
        }))
        .filter((row) => selectedServiceIds.has(row.serviceTypeId) && (row.proofLink || row.proofFileData || row.expiryDate));
      const res = await fetch(`/api/public/applicant-update/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim() || undefined,
          source: form.source || undefined,
          sourceOther: form.source === OTHER_VALUE ? form.sourceOther.trim() || undefined : undefined,
          accreditationStatus: form.accreditationStatus || undefined,
          areaOfPractice: form.areaOfPractice.length > 0 ? form.areaOfPractice : undefined,
          fmcUrn: form.fmcUrn.trim() || undefined,
          fmcDate: form.fmcDate || undefined,
          fmcAccreditationStatus: form.fmcAccreditationStatus || undefined,
          fmcAccreditationDate: form.fmcAccreditationDate || undefined,
          cmcRegNumber: form.cmcRegNumber.trim() || undefined,
          otherRegulatorName: form.otherRegulatorName.trim() || undefined,
          otherRegulatorNumber: form.otherRegulatorNumber.trim() || undefined,
          higherQualifications: form.higherQualifications.trim() || undefined,
          piProvider: form.piProvider.trim() || undefined,
          piPolicy: form.piPolicy.trim() || undefined,
          piExpiry: form.piExpiry || undefined,
          piPolicyNumber: form.piPolicyNumber.trim() || undefined,
          piCoverAmount: form.piCoverAmount.trim() || undefined,
          piExpiryDate: form.piExpiryDate || undefined,
          piCertificateUrl: form.piCertificateUrl.trim() || undefined,
          icoRegistration: form.icoRegistration.trim() || undefined,
          icoExpiryDate: form.icoExpiryDate || undefined,
          dbsLevel: form.dbsLevel || undefined,
          dbsCert: form.dbsCert.trim() || undefined,
          dbsDate: form.dbsDate || undefined,
          dbsCertNumber: form.dbsCertNumber.trim() || undefined,
          dbsIssueDate: form.dbsIssueDate || undefined,
          dbsCertificateUrl: form.dbsCertificateUrl.trim() || undefined,
          ppcSupervisorName: form.ppcSupervisorName.trim() || undefined,
          ppcSupervisorOrg: form.ppcSupervisorOrg.trim() || undefined,
          ppcSupervisorEmail: form.ppcSupervisorEmail.trim() || undefined,
          ppcSupervisorPhone: form.ppcSupervisorPhone.trim() || undefined,
          ppcSupervisorLastSignoff: form.ppcSupervisorLastSignoff || undefined,
          ppcSupervisorNextReview: form.ppcSupervisorNextReview || undefined,
          credentialChecks: form.credentialChecks.map((check) => ({
            kind: check.kind,
            referenceNumber: check.referenceNumber.trim() || undefined,
            provider: check.provider.trim() || undefined,
            issuedAt: check.issuedAt || undefined,
            expiresAt: check.expiresAt || undefined,
            evidenceUrl: check.evidenceUrl.trim() || undefined,
            notes: check.notes.trim() || undefined,
            ppcSupervisorName: check.ppcSupervisorName.trim() || undefined,
            ppcSupervisorOrg: check.ppcSupervisorOrg.trim() || undefined,
            ppcSupervisorEmail: check.ppcSupervisorEmail.trim() || undefined,
            ppcSupervisorPhone: check.ppcSupervisorPhone.trim() || undefined,
            ppcSupervisorLastSignoff: check.ppcSupervisorLastSignoff || undefined,
            ppcSupervisorNextReview: check.ppcSupervisorNextReview || undefined,
          })),
          references: form.references
            .filter((r) => r.refereeName.trim() && r.refereeEmail.trim())
            .map((r) => ({
              refereeName: r.refereeName.trim(),
              refereeEmail: r.refereeEmail.trim(),
              refereePhone: r.refereePhone.trim() || undefined,
              organisation: r.organisation.trim() || undefined,
              roleOrJobTitle: r.roleOrJobTitle.trim() || undefined,
            })),
          serviceApprovals: showServiceProofSection && serviceApprovals.length > 0 ? serviceApprovals : undefined,
        }),
      });
      if (res.status === 410) throw new Error("link_expired");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
  });

  const linkExpiredOnSubmit = submit.error?.message === "link_expired";

  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    !(form.source === OTHER_VALUE && !form.sourceOther.trim()) &&
    !hasMissingRequiredServiceProof &&
    !submit.isPending;

  // â”€â”€ Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isLoading) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </PublicShell>
    );
  }

  // â”€â”€ Expired / invalid link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (linkExpired || linkExpiredOnSubmit || isError) {
    return (
      <PublicShell>
        <div className="text-center py-12 space-y-4">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">This link has expired or has already been used</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            This personalised update link is one-time use and expires after 7 days. Please contact Brighter Future Mediation if you need a new link.
          </p>
          <p className="text-sm text-muted-foreground">
            <a href="mailto:info@brighterfuturemediation.co.uk" className="text-[#5a7d58] hover:underline">
              info@brighterfuturemediation.co.uk
            </a>
          </p>
        </div>
      </PublicShell>
    );
  }

  // â”€â”€ Success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (submitted) {
    return (
      <PublicShell>
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#a7baa4]/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-[#5a7d58]" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            {isCredentialsOnlyUpdate ? "Credentials updated" : "Details updated"}
          </h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            {isCredentialsOnlyUpdate
              ? "Thank you — your credential details have been updated. Our team will be in touch about the next steps."
              : "Thank you — your application details have been updated. Our team will be in touch about the next steps."}
          </p>
        </div>
      </PublicShell>
    );
  }

  // â”€â”€ Form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <PublicShell>
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-heading font-semibold text-foreground">
          {isCredentialsOnlyUpdate ? "Update your credentials" : "Review your application"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isCredentialsOnlyUpdate ? (
            <>
              Your current credential and reference details are pre-filled below. Please review and update any information, then click <strong>Save updates</strong> when you're done.
              This link can only be used once.
            </>
          ) : (
            <>
              Your current details are pre-filled below. Please review and update any information, then click <strong>Save updates</strong> when you're done.
              This link can only be used once.
            </>
          )}
        </p>
      </div>

      {submit.error && !linkExpiredOnSubmit && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 mb-4">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{submit.error.message}</p>
        </div>
      )}

      <div className="space-y-6">

        {showContactBackground && (
          <Card>
          <CardHeader className="pb-3 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#5a7d58]" />
              <CardTitle className="text-base font-heading">Contact & Background</CardTitle>
            </div>
            <CardDescription className="text-xs">Your personal and professional background</CardDescription>
          </CardHeader>
          <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div className="space-y-1.5">
              <Label>First name *</Label>
              <Input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="Jane"
                data-testid="input-first-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Last name *</Label>
              <Input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Smith"
                data-testid="input-last-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email address</Label>
              <Input
                type="email"
                value={form.email}
                readOnly
                disabled
                className="bg-muted/50 cursor-not-allowed"
                data-testid="input-email"
              />
              <p className="text-xs text-muted-foreground">
                To update your email address, please contact us directly.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Phone number</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+44 7700 000000"
                data-testid="input-phone"
              />
            </div>

            <div className="space-y-1.5">
              <Label>How did you hear about us?</Label>
              <Select
                value={form.source || NONE_VALUE}
                onValueChange={(v) => setForm((f) => ({
                  ...f,
                  source: v === NONE_VALUE ? "" : v,
                  sourceOther: v !== OTHER_VALUE ? "" : f.sourceOther,
                }))}
              >
                <SelectTrigger data-testid="select-source">
                  <SelectValue placeholder="Please select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>â€” Please select â€”</SelectItem>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                  <SelectItem value={OTHER_VALUE}>Other</SelectItem>
                </SelectContent>
              </Select>
              {form.source === OTHER_VALUE && (
                <Input
                  className="mt-2"
                  value={form.sourceOther}
                  onChange={(e) => setForm((f) => ({ ...f, sourceOther: e.target.value }))}
                  placeholder="Please specifyâ€¦"
                  data-testid="input-source-other"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>FMC accreditation status</Label>
              <Select
                value={form.accreditationStatus || NONE_VALUE}
                onValueChange={(v) => setForm((f) => ({ ...f, accreditationStatus: v === NONE_VALUE ? "" : v }))}
              >
                <SelectTrigger data-testid="select-accreditation">
                  <SelectValue placeholder="Please select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>â€” Please select â€”</SelectItem>
                  {FMC_ACCREDITATION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label>Area of practice</Label>
              <div className="border rounded-md p-3 bg-muted/20 space-y-3">
                {serviceTypesLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading servicesâ€¦</span>
                  </div>
                )}
                {serviceTypesError && !serviceTypesLoading && (
                  <p className="text-sm text-destructive">
                    Could not load services â€” please refresh the page.
                  </p>
                )}
                {!serviceTypesLoading && !serviceTypesError && activeByCategory.length === 0 && (
                  <p className="text-sm text-muted-foreground">No services available.</p>
                )}
                {activeByCategory.map(([category, items]) => (
                  <div key={category} className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{category}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {items.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                          data-testid={`checkbox-area-${s.id}`}
                        >
                          <Checkbox
                            checked={form.areaOfPractice.includes(s.name)}
                            onCheckedChange={() => toggleArea(s.name)}
                          />
                          <span className="text-sm">{s.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {form.areaOfPractice.length > 0 && (
                <p className="text-xs text-muted-foreground">{form.areaOfPractice.length} selected</p>
              )}
            </div>

          </CardContent>
          </Card>
        )}

        {showCredentialsSection && (
          <Card>
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#5a7d58]" />
                <CardTitle className="text-base font-heading">Credentials & registrations</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Section C - accreditation, regulator numbers, insurance, DBS, and PPC supervision.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 space-y-5">
              {failedCredentialChecks.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                  <p className="font-medium text-destructive">Failed checks need attention</p>
                  <div className="mt-2 space-y-2">
                    {failedCredentialChecks.map((check) => (
                      <div key={check.kind} className="rounded-md border border-destructive/20 bg-background/80 px-3 py-2">
                        <p className="font-medium text-foreground">{check.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[
                            check.referenceNumber ? `Reference: ${check.referenceNumber}` : null,
                            check.provider ? `Provider: ${check.provider}` : null,
                            check.issuedAt ? `Issued: ${check.issuedAt}` : null,
                            check.expiresAt ? `Expiry: ${check.expiresAt}` : null,
                          ].filter(Boolean).join(" · ") || "No captured details yet."}
                        </p>
                        {check.notes?.trim() ? (
                          <p className="mt-1 text-xs text-muted-foreground">Reason: {check.notes.trim()}</p>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">Reason: not provided yet.</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {form.credentialChecks.map((check) => (
                  <CredentialCheckCard
                    key={check.kind}
                    draft={check}
                    onChange={(patch) => setCredentialDraft(check.kind, patch)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {showServiceProofSection && (
          <Card>
          <CardHeader className="pb-3 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#5a7d58]" />
              <CardTitle className="text-base font-heading">Service-specific proof</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Add a certificate file or link for any service your admin asked you to update.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {proofServiceTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Select or keep a service in area of practice to attach proof.</p>
            ) : (
              <>
                {hasMissingRequiredServiceProof && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    At least one starred service needs a file or link before you can submit:
                    {" "}
                    {missingRequiredServiceProofs.map((service) => service.name).join(", ")}.
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  <span className="text-destructive font-semibold">*</span> marks the service your admin asked you to upload.
                </p>
                {proofServiceTypes.map((service) => {
                  const draft = form.serviceApprovals[service.id] ?? blankServiceApprovalDraft();
                  const approval = prefillData?.serviceApprovals?.find((s) => s.serviceTypeId === service.id);
                  const needsUpload = proofRequiredServiceIds.has(service.id);
                  return (
                    <div key={service.id} className="rounded-lg border bg-background p-4 space-y-3">
                      <div className="flex items-center gap-1.5">
                        {needsUpload && <span className="text-destructive font-bold">*</span>}
                        <p className="font-medium text-sm">{service.name}</p>
                      </div>
                      {approval?.reviewReason?.trim() ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          <span className="font-semibold">Reason for reupload:</span>{" "}
                          {approval.reviewReason}
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">{service.category}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2 space-y-1.5">
                          <Label>Certificate file</Label>
                          <Input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const uploaded = await readFileAsDataUrl(file);
                              setServiceApprovalDraft(service.id, {
                                proofFileName: uploaded.fileName,
                                proofFileData: uploaded.fileData,
                                proofMimeType: uploaded.fileMimeType,
                              });
                            }}
                          />
                          {draft.proofFileName && (
                            <p className="text-xs text-muted-foreground">Selected: {draft.proofFileName}</p>
                          )}
                        </div>
                        <div className="sm:col-span-2 space-y-1.5">
                          <Label>Supporting link</Label>
                          <Input
                            value={draft.proofLink}
                            onChange={(e) => setServiceApprovalDraft(service.id, { proofLink: e.target.value })}
                            placeholder="Optional supporting URL"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Expiry date</Label>
                          <Input
                            type="date"
                            min={getTodayIsoDate()}
                            value={draft.expiryDate}
                            onChange={(e) => setServiceApprovalDraft(service.id, { expiryDate: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
          </Card>
        )}

        {/* â”€â”€ Section 3: Professional References â”€â”€ */}
        <Card>
          <CardHeader className="pb-3 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <BookUser className="w-4 h-4 text-[#5a7d58]" />
              <CardTitle className="text-base font-heading">Professional References</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Up to 2 professional references. Name and email are required for each reference you provide.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">

            {form.references.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No references added yet.</p>
            )}

            {form.references.map((ref, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-3 bg-muted/10 relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">Reference {idx + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => removeRef(idx)}
                    data-testid={`button-remove-ref-${idx}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Full name *</Label>
                    <Input
                      value={ref.refereeName}
                      onChange={(e) => setRef(idx, "refereeName", e.target.value)}
                      placeholder="Referee full name"
                      data-testid={`input-ref-name-${idx}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email address *</Label>
                    <Input
                      type="email"
                      value={ref.refereeEmail}
                      onChange={(e) => setRef(idx, "refereeEmail", e.target.value)}
                      placeholder="referee@example.com"
                      data-testid={`input-ref-email-${idx}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone number</Label>
                    <Input
                      value={ref.refereePhone}
                      onChange={(e) => setRef(idx, "refereePhone", e.target.value)}
                      placeholder="+44 7700 000000"
                      data-testid={`input-ref-phone-${idx}`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Organisation</Label>
                    <Input
                      value={ref.organisation}
                      onChange={(e) => setRef(idx, "organisation", e.target.value)}
                      placeholder="Organisation name"
                      data-testid={`input-ref-org-${idx}`}
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>Role / job title</Label>
                    <Input
                      value={ref.roleOrJobTitle}
                      onChange={(e) => setRef(idx, "roleOrJobTitle", e.target.value)}
                      placeholder="e.g. Senior Mediator, Practice Manager"
                      data-testid={`input-ref-role-${idx}`}
                    />
                  </div>
                </div>
              </div>
            ))}

            {form.references.length < 2 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRef}
                data-testid="button-add-reference"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add reference
              </Button>
            )}

          </CardContent>
        </Card>

        {/* â”€â”€ Submit â”€â”€ */}
        <div className="flex justify-end">
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit || hasMissingRequiredServiceProof}
            className="bg-[#5a7d58] hover:bg-[#4a6b48] text-white px-8"
            data-testid="button-submit-update"
          >
            {submit.isPending ? "Savingâ€¦" : "Save updates"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center pb-4">
          By submitting this form you agree that Brighter Future Mediation may hold and process the information you have provided for the purpose of managing your application.
        </p>

      </div>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <BFMLogoMark className="h-9 w-auto" />
          <div>
            <p className="text-xs text-muted-foreground leading-none">Mediator Application</p>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        {children}
      </main>
      <footer className="border-t mt-12 py-6">
        <p className="text-center text-xs text-muted-foreground">
          Brighter Future Mediation Ltd Â· FMC Accredited Â· Regulated Service
        </p>
      </footer>
    </div>
  );
}


