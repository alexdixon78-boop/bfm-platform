import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Send, Briefcase, ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX, Mail, Phone, Search, UserPlus } from "lucide-react";
import {
  REPRESENTATIVE_TYPES,
  REPRESENTATIVE_CHANNELS,
  type CaseRepresentative,
  type ClientRepresentative,
} from "@shared/schema";

const TYPE_LABELS: Record<string, string> = {
  solicitor: "Solicitor",
  hr: "HR representative",
  union: "Union representative",
  advocate: "Advocate / supporter",
  other: "Other",
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
    pending:   { label: "Not yet requested", cls: "bg-stone-100 text-stone-700 border-stone-300", Icon: ShieldQuestion },
    sent:      { label: "Awaiting response",  cls: "bg-amber-50 text-amber-700 border-amber-300",  Icon: ShieldAlert },
    granted:   { label: "Consent granted",    cls: "bg-emerald-50 text-emerald-700 border-emerald-300", Icon: ShieldCheck },
    withdrawn: { label: "Consent withdrawn",  cls: "bg-stone-100 text-stone-700 border-stone-300", Icon: ShieldX },
    refused:   { label: "Consent refused",    cls: "bg-red-50 text-red-700 border-red-300",        Icon: ShieldX },
  };
  const s = map[status] || map.pending;
  return (
    <Badge variant="outline" className={`text-xs ${s.cls}`} data-testid={`badge-rep-status-${status}`}>
      <s.Icon className="w-3 h-3 mr-1" /> {s.label}
    </Badge>
  );
}

const repFormSchema = z.object({
  type: z.enum(REPRESENTATIVE_TYPES),
  roleTitle: z.string().optional().or(z.literal("")),
  fullName: z.string().min(2, "Name is required"),
  organisation: z.string().optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  preferredChannel: z.enum(REPRESENTATIVE_CHANNELS).default("email"),
  addressLine1: z.string().optional().or(z.literal("")),
  addressLine2: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  postcode: z.string().optional().or(z.literal("")),
  country: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

type RepFormValues = z.infer<typeof repFormSchema>;
type RepType = (typeof REPRESENTATIVE_TYPES)[number];
type RepChannel = (typeof REPRESENTATIVE_CHANNELS)[number];

function asRepType(v: string | null | undefined): RepType {
  return (REPRESENTATIVE_TYPES as readonly string[]).includes(v ?? "") ? (v as RepType) : "solicitor";
}
function asRepChannel(v: string | null | undefined): RepChannel {
  return (REPRESENTATIVE_CHANNELS as readonly string[]).includes(v ?? "") ? (v as RepChannel) : "email";
}

/**
 * Edit-only dialog for an existing case attachment. Person-level fields
 * mirror back to the master record server-side so every other case the rep
 * is attached to picks up the new contact details.
 */
function EditRepDialog({
  caseId, partyId, existing, trigger,
}: {
  caseId: string; partyId: string; existing: CaseRepresentative; trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const form = useForm<RepFormValues>({
    resolver: zodResolver(repFormSchema),
    defaultValues: {
      type: asRepType(existing.type),
      roleTitle: existing.roleTitle ?? "",
      fullName: existing.fullName,
      organisation: existing.organisation ?? "",
      email: existing.email ?? "",
      phone: existing.phone ?? "",
      preferredChannel: asRepChannel(existing.preferredChannel),
      addressLine1: existing.addressLine1 ?? "",
      addressLine2: existing.addressLine2 ?? "",
      city: existing.city ?? "",
      postcode: existing.postcode ?? "",
      country: existing.country ?? "United Kingdom",
      notes: existing.notes ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: RepFormValues) => {
      const payload = {
        ...data,
        roleTitle: data.roleTitle || null,
        organisation: data.organisation || null,
        email: data.email || null,
        phone: data.phone || null,
        addressLine1: data.addressLine1 || null,
        addressLine2: data.addressLine2 || null,
        city: data.city || null,
        postcode: data.postcode || null,
        country: data.country || null,
        notes: data.notes || null,
        partyId,
      };
      return apiRequest("PATCH", `/api/representatives/${existing.id}`, payload);
    },
    onSuccess: () => {
      // Invalidate both the case attachments list AND the master Rolodex —
      // the edit may have mirrored back to the master.
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/representatives`] });
      queryClient.invalidateQueries({ queryKey: [`/api/clients`] });
      toast({ title: "Representative updated" });
      setOpen(false);
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Error", description: err?.message || "Could not save" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-rep-edit">
        <DialogHeader>
          <DialogTitle>Edit representative</DialogTitle>
          <DialogDescription>
            Changes to name, organisation, contact details and address are mirrored to every other
            case this representative is attached to. Notes and preferred channel stay scoped to this case.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-rep-type"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {REPRESENTATIVE_TYPES.map((t) => (<SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="preferredChannel" render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred contact</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-rep-channel"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {REPRESENTATIVE_CHANNELS.map((t) => (<SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="fullName" render={({ field }) => (
              <FormItem><FormLabel>Full name</FormLabel><FormControl><Input {...field} data-testid="input-rep-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="roleTitle" render={({ field }) => (
                <FormItem><FormLabel>Role / job title</FormLabel><FormControl><Input {...field} data-testid="input-rep-role-title" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="organisation" render={({ field }) => (
                <FormItem><FormLabel>Organisation</FormLabel><FormControl><Input {...field} data-testid="input-rep-org" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} data-testid="input-rep-email" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input type="tel" {...field} data-testid="input-rep-phone" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="space-y-3 border-t border-stone-100 pt-3">
              <p className="text-xs font-medium text-stone-500">Postal address (optional)</p>
              <FormField control={form.control} name="addressLine1" render={({ field }) => (
                <FormItem><FormLabel className="text-xs">Address line 1</FormLabel><FormControl><Input {...field} data-testid="input-rep-addr-1" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="addressLine2" render={({ field }) => (
                <FormItem><FormLabel className="text-xs">Address line 2</FormLabel><FormControl><Input {...field} data-testid="input-rep-addr-2" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-3 gap-3">
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs">City</FormLabel><FormControl><Input {...field} data-testid="input-rep-city" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="postcode" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs">Postcode</FormLabel><FormControl><Input {...field} data-testid="input-rep-postcode" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="country" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs">Country</FormLabel><FormControl><Input {...field} data-testid="input-rep-country" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes (this case only)</FormLabel><FormControl><Textarea {...field} rows={3} data-testid="input-rep-notes" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-rep-save">
                {mutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Two-step Add flow (Task #202):
 *   Step 1 — show the client's existing master records with a search box.
 *            Click any to attach (POST /api/cases/:caseId/representatives/attach).
 *   Step 2 — "+ Add brand-new representative" switches the dialog to the form.
 *            Submitting the form upserts the master + creates the attachment.
 */
function AddRepFlow({
  caseId, partyId, clientId, trigger,
}: {
  caseId: string; partyId: string; clientId: string; trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const masterKey = ["/api/clients", clientId, "representatives"];
  const { data: masters = [], isLoading: mastersLoading } = useQuery<ClientRepresentative[]>({
    queryKey: masterKey,
    enabled: open && !!clientId,
  });
  const { data: existingAtts = [] } = useQuery<CaseRepresentative[]>({
    queryKey: [`/api/cases/${caseId}/representatives`],
  });
  const alreadyAttachedIds = useMemo(
    () => new Set(existingAtts.filter(a => a.partyId === partyId)
      .map(a => a.clientRepresentativeId).filter(Boolean) as string[]),
    [existingAtts, partyId],
  );

  const filteredMasters = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return masters;
    return masters.filter((m) =>
      [m.fullName, m.email, m.organisation, m.roleTitle]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [masters, search]);

  const closeAndReset = () => {
    setOpen(false);
    setTimeout(() => { setMode("pick"); setSearch(""); }, 200);
  };

  const attach = useMutation({
    mutationFn: (clientRepresentativeId: string) =>
      apiRequest("POST", `/api/cases/${caseId}/representatives/attach`, { clientRepresentativeId, partyId }),
    onSuccess: (_d, _vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/representatives`] });
      toast({ title: "Representative attached" });
      closeAndReset();
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Could not attach", description: err?.message }),
  });

  const form = useForm<RepFormValues>({
    resolver: zodResolver(repFormSchema),
    defaultValues: {
      type: "solicitor", roleTitle: "", fullName: "", organisation: "",
      email: "", phone: "", preferredChannel: "email",
      addressLine1: "", addressLine2: "", city: "", postcode: "", country: "United Kingdom", notes: "",
    },
  });

  const create = useMutation({
    mutationFn: async (data: RepFormValues) => {
      const payload = {
        ...data,
        roleTitle: data.roleTitle || null,
        organisation: data.organisation || null,
        email: data.email || null,
        phone: data.phone || null,
        addressLine1: data.addressLine1 || null,
        addressLine2: data.addressLine2 || null,
        city: data.city || null,
        postcode: data.postcode || null,
        country: data.country || null,
        notes: data.notes || null,
        partyId,
      };
      return apiRequest("POST", `/api/cases/${caseId}/representatives`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/representatives`] });
      queryClient.invalidateQueries({ queryKey: masterKey });
      toast({ title: "Representative added" });
      form.reset();
      closeAndReset();
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: "Error", description: err?.message || "Could not save" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeAndReset())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-rep-add">
        <DialogHeader>
          <DialogTitle>{mode === "pick" ? "Add representative to case" : "New representative"}</DialogTitle>
          <DialogDescription>
            {mode === "pick"
              ? "Pick from the client's saved representatives, or add a brand-new one. Reps appear on the case but cannot log in."
              : "We'll save this person to the client's master contact list and attach them to this case."}
          </DialogDescription>
        </DialogHeader>

        {mode === "pick" && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-stone-400" />
              <Input
                placeholder="Search saved representatives by name, organisation or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-rep-pick-search"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border border-stone-200 rounded-md divide-y divide-stone-100">
              {mastersLoading && <p className="text-xs text-stone-500 p-3">Loading…</p>}
              {!mastersLoading && filteredMasters.length === 0 && (
                <p className="text-xs text-stone-500 p-4 text-center">
                  {masters.length === 0
                    ? "This client has no saved representatives yet."
                    : "No matches for that search."}
                </p>
              )}
              {filteredMasters.map((m) => {
                const already = alreadyAttachedIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={already || attach.isPending}
                    onClick={() => attach.mutate(m.id)}
                    className="w-full text-left p-3 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-start justify-between gap-3"
                    data-testid={`button-pick-rep-${m.id}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{m.fullName}</span>
                        <Badge variant="secondary" className="text-xs">{TYPE_LABELS[m.type] || m.type}</Badge>
                      </div>
                      {(m.roleTitle || m.organisation) && (
                        <p className="text-xs text-stone-600 mt-0.5">
                          {[m.roleTitle, m.organisation].filter(Boolean).join(" — ")}
                        </p>
                      )}
                      {m.email && <p className="text-xs text-stone-500 mt-0.5">{m.email}</p>}
                    </div>
                    {already && <Badge variant="outline" className="text-xs flex-shrink-0">Already attached</Badge>}
                  </button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setMode("new")}
              data-testid="button-switch-to-new-rep"
            >
              <UserPlus className="w-4 h-4 mr-1" /> Add brand-new representative
            </Button>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={closeAndReset}>Cancel</Button>
            </DialogFooter>
          </div>
        )}

        {mode === "new" && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => create.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-rep-type"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {REPRESENTATIVE_TYPES.map((t) => (<SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="preferredChannel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preferred contact</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-rep-channel"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {REPRESENTATIVE_CHANNELS.map((t) => (<SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem><FormLabel>Full name</FormLabel><FormControl><Input {...field} data-testid="input-rep-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="roleTitle" render={({ field }) => (
                  <FormItem><FormLabel>Role / job title</FormLabel><FormControl><Input {...field} placeholder="e.g. Senior Partner" data-testid="input-rep-role-title" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="organisation" render={({ field }) => (
                  <FormItem><FormLabel>Organisation</FormLabel><FormControl><Input {...field} placeholder="e.g. Smith & Co" data-testid="input-rep-org" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} data-testid="input-rep-email" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem><FormLabel>Phone</FormLabel><FormControl><Input type="tel" {...field} data-testid="input-rep-phone" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="space-y-3 border-t border-stone-100 pt-3">
                <p className="text-xs font-medium text-stone-500">Postal address (optional)</p>
                <FormField control={form.control} name="addressLine1" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs">Address line 1</FormLabel><FormControl><Input {...field} data-testid="input-rep-addr-1" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="addressLine2" render={({ field }) => (
                  <FormItem><FormLabel className="text-xs">Address line 2</FormLabel><FormControl><Input {...field} data-testid="input-rep-addr-2" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-3 gap-3">
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs">City</FormLabel><FormControl><Input {...field} data-testid="input-rep-city" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="postcode" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs">Postcode</FormLabel><FormControl><Input {...field} data-testid="input-rep-postcode" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="country" render={({ field }) => (
                    <FormItem><FormLabel className="text-xs">Country</FormLabel><FormControl><Input {...field} data-testid="input-rep-country" /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notes (this case only)</FormLabel><FormControl><Textarea {...field} rows={3} data-testid="input-rep-notes" /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" onClick={() => setMode("pick")}>← Back to picker</Button>
                <Button type="submit" disabled={create.isPending} data-testid="button-rep-save">
                  {create.isPending ? "Saving…" : "Add representative"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RepresentativesSection({
  caseId, partyId, partyRole, clientId, canMutate,
}: {
  caseId: string;
  partyId: string;
  partyRole: string;
  clientId: string;
  canMutate: boolean;
}) {
  const { toast } = useToast();
  const queryKey = [`/api/cases/${caseId}/representatives`];
  const { data: allReps = [], isLoading } = useQuery<CaseRepresentative[]>({ queryKey });
  const reps = allReps.filter((r) => r.partyId === partyId);

  const sendConsent = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/representatives/${id}/send-consent`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Consent request sent" });
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Could not send", description: err?.message }),
  });

  // Detach (was "Remove"). Master record stays in the client's Rolodex.
  const detachRep = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/representatives/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Representative detached from this case", description: "They remain in the client's contact list." });
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Could not detach", description: err?.message }),
  });

  return (
    <Card className="border-stone-200" data-testid={`card-reps-party-${partyRole}`}>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-heading flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-stone-500" />
          Representatives — Client {partyRole}
          {reps.length > 0 && (
            <span className="text-xs text-stone-500 font-normal">({reps.length})</span>
          )}
        </CardTitle>
        {canMutate && (
          <AddRepFlow
            caseId={caseId}
            partyId={partyId}
            clientId={clientId}
            trigger={
              <Button variant="outline" size="sm" data-testid={`button-add-rep-${partyRole}`}>
                <Plus className="w-3 h-3 mr-1" /> Add representative
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-xs text-stone-500">Loading…</p>}
        {!isLoading && reps.length === 0 && (
          <p className="text-xs text-stone-500">No representatives recorded.</p>
        )}
        {reps.map((rep) => (
          <div
            key={rep.id}
            className="border border-stone-200 rounded-md p-3 hover-elevate"
            data-testid={`rep-card-${rep.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm" data-testid={`text-rep-name-${rep.id}`}>{rep.fullName}</span>
                  <Badge variant="secondary" className="text-xs">{TYPE_LABELS[rep.type] || rep.type}</Badge>
                  {statusBadge(rep.consentStatus)}
                </div>
                {(rep.roleTitle || rep.organisation) && (
                  <p className="text-xs text-stone-600 mt-0.5">
                    {[rep.roleTitle, rep.organisation].filter(Boolean).join(" — ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 mt-1 text-xs text-stone-500">
                  {rep.email && (
                    <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{rep.email}</span>
                  )}
                  {rep.phone && (
                    <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{rep.phone}</span>
                  )}
                </div>
                {rep.notes && (
                  <p className="text-xs text-stone-600 mt-2 whitespace-pre-wrap">{rep.notes}</p>
                )}
              </div>
              {canMutate && (
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {rep.email && rep.consentStatus !== "granted" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => sendConsent.mutate(rep.id)}
                      disabled={sendConsent.isPending}
                      data-testid={`button-send-consent-${rep.id}`}
                      title="Send GDPR consent request email"
                    >
                      <Send className="w-3 h-3 mr-1" />
                      {rep.consentStatus === "sent" ? "Resend" : "Request consent"}
                    </Button>
                  )}
                  <EditRepDialog
                    caseId={caseId}
                    partyId={partyId}
                    existing={rep}
                    trigger={
                      <Button variant="ghost" size="sm" data-testid={`button-edit-rep-${rep.id}`}>
                        <Pencil className="w-3 h-3 mr-1" /> Edit
                      </Button>
                    }
                  />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" data-testid={`button-remove-rep-${rep.id}`}>
                        <Trash2 className="w-3 h-3 mr-1" /> Remove from case
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Detach representative from this case?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove {rep.fullName} from this case. Their contact details will remain in
                          the client's representatives list and can be re-attached at any time.
                          This action is audit-logged.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700 text-white"
                          onClick={() => detachRep.mutate(rep.id)}
                        >
                          Detach
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Admin-only toggle: controls whether mediators on this case can see the representatives list.
 */
export function MediatorRepVisibilityToggle({
  caseId, value, readOnly = false,
}: { caseId: string; value: boolean; readOnly?: boolean }) {
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: (next: boolean) => apiRequest("PATCH", `/api/cases/${caseId}/mediator-rep-visibility`, { mediatorCanSeeReps: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
      toast({ title: "Updated mediator access" });
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Could not update", description: err?.message }),
  });
  const description = readOnly
    ? value
      ? "Admins have granted you access to view representatives on this case."
      : "Admins have not granted you access to representatives on this case."
    : "When off, mediators on this case cannot see any representative details.";
  return (
    <div className="flex items-center justify-between gap-3 border border-stone-200 rounded-md p-3">
      <div>
        <Label htmlFor="mediator-rep-visibility" className="text-sm font-medium">Mediator access to representatives</Label>
        <p className="text-xs text-stone-500 mt-0.5">{description}</p>
      </div>
      <Switch
        id="mediator-rep-visibility"
        checked={value}
        disabled={readOnly || mutation.isPending}
        onCheckedChange={(v) => { if (!readOnly) mutation.mutate(v); }}
        data-testid="switch-mediator-rep-visibility"
        aria-readonly={readOnly}
      />
    </div>
  );
}
