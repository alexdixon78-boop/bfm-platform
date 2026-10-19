import { useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, User, Loader2 } from "lucide-react";
import { BFMLogoMark } from "@/components/bfm-logo";
import { CONTRACTOR_TYPES, LEAD_SOURCES } from "@shared/schema";

const NONE_VALUE = "__none__";
const OTHER_VALUE = "Other";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  contractorType: string;
  contractorTypeOther: string;
  source: string;
  sourceOther: string;
  notes: string;
};

const blank: FormState = {
  firstName: "", lastName: "", email: "", phone: "",
  contractorType: "", contractorTypeOther: "", source: "", sourceOther: "", notes: "",
};

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <header className="bg-white border-b px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <BFMLogoMark size={32} />
          <div>
            <p className="font-heading font-semibold text-foreground text-sm">Brighter Future Mediation</p>
            <p className="text-[11px] text-muted-foreground">Contractor Application</p>
          </div>
        </div>
      </header>
      <main className="flex-1 py-8 px-4">
        <div className="max-w-2xl mx-auto">{children}</div>
      </main>
      <footer className="border-t bg-white py-4 px-6 text-center">
        <p className="text-[11px] text-muted-foreground">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </footer>
    </div>
  );
}

export default function ContractorApplyPage() {
  const [, params] = useRoute("/apply/contractor/:token");
  const token = params?.token ?? "";

  const [form, setForm] = useState<FormState>(blank);
  const [submitted, setSubmitted] = useState(false);

  const { data: validation, isLoading: validating } = useQuery<{ ok: boolean }>({
    queryKey: [`/api/public/contractor-application-link/validate/${token}`],
    enabled: !!token,
    retry: false,
  });
  const linkInvalid = !validating && (!validation || !(validation as { ok?: boolean }).ok);

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public/contractor-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          contractorType: form.contractorType,
          contractorTypeOther: form.contractorType === OTHER_VALUE ? form.contractorTypeOther.trim() || undefined : undefined,
          source: form.source || undefined,
          sourceOther: form.source === OTHER_VALUE ? form.sourceOther.trim() || undefined : undefined,
          notes: form.notes.trim() || undefined,
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

  const linkExpiredOnSubmit = submit.error?.message === "link_expired";

  const canSubmit =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.email.trim() &&
    form.contractorType &&
    !(form.contractorType === OTHER_VALUE && !form.contractorTypeOther.trim()) &&
    !(form.source === OTHER_VALUE && !form.sourceOther.trim()) &&
    !submit.isPending;

  if (validating) {
    return (
      <PublicShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </PublicShell>
    );
  }

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

  if (submitted) {
    return (
      <PublicShell>
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#a7baa4]/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-[#5a7d58]" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Application received</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Thank you for your interest in working with Brighter Future Mediation. We'll review your details and be in touch shortly. A confirmation email has been sent to you.
          </p>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <div className="space-y-2 mb-6">
        <h1 className="text-2xl font-heading font-semibold text-foreground">Contractor Application</h1>
        <p className="text-muted-foreground text-sm">
          Please complete the form below. Fields marked with an asterisk (*) are required.
        </p>
      </div>

      {submit.error && !linkExpiredOnSubmit && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 mb-4">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{submit.error.message}</p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[#b8825a]" />
            <CardTitle className="text-base font-heading">Your Details</CardTitle>
          </div>
          <CardDescription className="text-xs">Tell us a little about yourself and the type of work you're interested in.</CardDescription>
        </CardHeader>
        <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">

          <div className="space-y-1.5">
            <Label>First name *</Label>
            <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="Jane" data-testid="input-first-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Last name *</Label>
            <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="Smith" data-testid="input-last-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Email address *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" data-testid="input-email" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone number</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+44 7700 000000" data-testid="input-phone" />
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <Label>Contractor type *</Label>
            <Select
              value={form.contractorType || NONE_VALUE}
              onValueChange={(v) => setForm((f) => ({
                ...f,
                contractorType: v === NONE_VALUE ? "" : v,
                contractorTypeOther: v !== OTHER_VALUE ? "" : f.contractorTypeOther,
              }))}
            >
              <SelectTrigger data-testid="select-contractor-type"><SelectValue placeholder="Please select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Please select —</SelectItem>
                {CONTRACTOR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.contractorType === OTHER_VALUE && (
              <Input
                className="mt-2"
                value={form.contractorTypeOther}
                onChange={(e) => setForm((f) => ({ ...f, contractorTypeOther: e.target.value }))}
                placeholder="Please specify…"
                data-testid="input-contractor-type-other"
              />
            )}
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <Label>How did you hear about us?</Label>
            <Select value={form.source || NONE_VALUE} onValueChange={(v) => setForm((f) => ({ ...f, source: v === NONE_VALUE ? "" : v, sourceOther: v !== OTHER_VALUE ? "" : f.sourceOther }))}>
              <SelectTrigger data-testid="select-source"><SelectValue placeholder="Please select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Please select —</SelectItem>
                {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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

          <div className="sm:col-span-2 space-y-1.5">
            <Label>Additional information</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Tell us about your experience, availability, or anything else you'd like us to know…"
              rows={4}
              data-testid="textarea-notes"
            />
          </div>

        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button
          onClick={() => submit.mutate()}
          disabled={!canSubmit}
          className="bg-[#b8825a] hover:bg-[#a07048] text-white"
          data-testid="button-submit-application"
        >
          {submit.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</>
          ) : "Submit application"}
        </Button>
      </div>
    </PublicShell>
  );
}
