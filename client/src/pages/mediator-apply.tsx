import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, AlertCircle, Plus, Trash2, User, Shield, BookUser, Loader2 } from "lucide-react";
import { BFMLogoMark } from "@/components/bfm-logo";
import { LEAD_SOURCES, FMC_ACCREDITATION_STATUSES, type ServiceType } from "@shared/schema";

const NONE_VALUE = "__none__";
const OTHER_VALUE = "Other";

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
  piProvider: string;
  piPolicy: string;
  piExpiry: string;
  dbsCert: string;
  dbsDate: string;
  references: Reference[];
  serviceApprovals: Record<string, ServiceApprovalDraft>;
};

const blank: FormState = {
  firstName: "", lastName: "", email: "", phone: "",
  source: "", sourceOther: "", accreditationStatus: "", areaOfPractice: [],
  fmcUrn: "", fmcDate: "", piProvider: "", piPolicy: "", piExpiry: "",
  dbsCert: "", dbsDate: "",
  references: [],
  serviceApprovals: {},
};

function blankServiceApprovalDraft(): ServiceApprovalDraft {
  return { proofLink: "", proofFileName: "", proofFileData: "", proofMimeType: "", expiryDate: "" };
}

function readFileAsDataUrl(file: File): Promise<{ fileName: string; fileData: string; fileMimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        fileName: file.name,
        fileData: String(reader.result ?? ""),
        fileMimeType: file.type || "application/octet-stream",
      });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function MediatorApplyPage() {
  const [, params] = useRoute("/apply/mediator/:token");
  const token = params?.token ?? "";

  const [form, setForm] = useState<FormState>(blank);
  const [submitted, setSubmitted] = useState(false);

  // Pre-validate the token on page load â€” show expired state immediately if
  // the link has been replaced or never existed, without making the user fill
  // out the whole form before discovering it's stale.
  const { data: validation, isLoading: validating } = useQuery<{ ok: boolean }>({
    queryKey: [`/api/public/mediator-application-link/validate/${token}`],
    enabled: !!token,
    retry: false,
  });
  const linkInvalid = !validating && (!validation || !(validation as { ok?: boolean }).ok);

  // Fetch service types for area-of-practice checkboxes.
  // Uses the public endpoint â€” no auth required on this anonymous page.
  // enabled: !!token (not gated on linkInvalid) so the query fires in parallel
  // with link validation; the form is never visible while validating or when
  // the link is invalid, so there is no need to block service types on that.
  const {
    data: serviceTypes,
    isLoading: serviceTypesLoading,
    isError: serviceTypesError,
  } = useQuery<ServiceType[]>({
    queryKey: ["/api/public/service-types"],
    enabled: !!token,
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
  const selectedServiceTypes = form.areaOfPractice
    .map((name) => serviceTypeByName.get(name))
    .filter((s): s is ServiceType => !!s);

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

  const submit = useMutation({
    mutationFn: async () => {
      const selectedServiceIds = new Set(selectedServiceTypes.map((s) => s.id));
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
      const res = await fetch("/api/public/mediator-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          source: form.source || undefined,
          sourceOther: form.source === OTHER_VALUE ? form.sourceOther.trim() || undefined : undefined,
          accreditationStatus: form.accreditationStatus || undefined,
          areaOfPractice: form.areaOfPractice.length > 0 ? form.areaOfPractice : undefined,
          fmcUrn: form.fmcUrn.trim() || undefined,
          fmcDate: form.fmcDate || undefined,
          piProvider: form.piProvider.trim() || undefined,
          piPolicy: form.piPolicy.trim() || undefined,
          piExpiry: form.piExpiry || undefined,
          dbsCert: form.dbsCert.trim() || undefined,
          dbsDate: form.dbsDate || undefined,
          references: form.references
            .filter((r) => r.refereeName.trim() && r.refereeEmail.trim())
            .map((r) => ({
              refereeName: r.refereeName.trim(),
              refereeEmail: r.refereeEmail.trim(),
              refereePhone: r.refereePhone.trim() || undefined,
              organisation: r.organisation.trim() || undefined,
              roleOrJobTitle: r.roleOrJobTitle.trim() || undefined,
            })),
          serviceApprovals: serviceApprovals.length > 0 ? serviceApprovals : undefined,
        }),
      });
      if (res.status === 410) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error === "link_expired" ? "link_expired" : "link_expired");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
  });

  // If the link expired mid-form (token invalidated between load and submit)
  const linkExpiredOnSubmit = submit.error?.message === "link_expired";

  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    !(form.source === OTHER_VALUE && !form.sourceOther.trim()) &&
    !submit.isPending;

  // â”€â”€ Loading state while validating token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (validating) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </PublicShell>
    );
  }

  // â”€â”€ Invalid / expired link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (linkInvalid || linkExpiredOnSubmit) {
    return (
      <PublicShell>
        <div className="text-center py-12 space-y-4">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">Link no longer active</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            This application link has expired or been replaced. Please contact Brighter Future Mediation for an updated link.
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

  // â”€â”€ Success â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (submitted) {
    return (
      <PublicShell>
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#a7baa4]/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-[#5a7d58]" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Application received</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Thank you for applying to join the Brighter Future Mediation panel. We'll review your details and be in touch shortly. A confirmation email has been sent to you.
          </p>
        </div>
      </PublicShell>
    );
  }

  // â”€â”€ Form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <PublicShell>
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-heading font-semibold text-foreground">Mediator Application</h1>
        <p className="text-muted-foreground text-sm">
          Please complete all sections below. Fields marked with an asterisk (*) are required. Credential and reference information is optional at this stage and can be provided later.
        </p>
      </div>

      {submit.error && !linkExpiredOnSubmit && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 mb-4">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{submit.error.message}</p>
        </div>
      )}

      <div className="space-y-6">

        {/* â”€â”€ Section 1: Contact & Background â”€â”€ */}
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
              <Label>Email address *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@example.com"
                data-testid="input-email"
              />
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

            {/* How did you hear about us — with conditional "Other" input */}
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
                  <SelectItem value={NONE_VALUE}>— Please select —</SelectItem>
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
                  placeholder="Please specify…"
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
                  <SelectItem value={NONE_VALUE}>— Please select —</SelectItem>
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

        {/* â”€â”€ Section 2: Service-specific proof â”€â”€ */}
        <Card>
          <CardHeader className="pb-3 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#5a7d58]" />
              <CardTitle className="text-base font-heading">Service-specific proof</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Add a certificate file or link for any service you want reviewed. If you skip this now, admin can request it later.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {selectedServiceTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Select a service above to attach proof for it.</p>
            ) : (
              selectedServiceTypes.map((service) => {
                const draft = form.serviceApprovals[service.id] ?? blankServiceApprovalDraft();
                return (
                  <div key={service.id} className="rounded-lg border bg-background p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{service.name}</p>
                        <p className="text-xs text-muted-foreground">{service.category}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5 sm:col-span-2">
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
                      <div className="space-y-1.5 sm:col-span-2">
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
              })
            )}
          </CardContent>
        </Card>



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

        <div className="flex justify-end">
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit}
            className="bg-[#5a7d58] hover:bg-[#4a6b48] text-white px-8"
            data-testid="button-submit-application"
          >
            {submit.isPending ? "Submittingâ€¦" : "Submit application"}
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
