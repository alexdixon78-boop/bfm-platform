import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  REPRESENTATIVE_TYPES,
  type ClientRepresentative,
} from "@shared/schema";

/**
 * Shared master-rep dialogs (Task #202). Used by:
 *   - Client portal `/contacts` page
 *   - Staff client-detail Sheet inside `/clients`
 * Both create/edit operate on the master Rolodex record (per-client). Attach
 * binds an existing master to a specific case+party.
 */

const TYPE_LABELS: Record<string, string> = {
  solicitor: "Solicitor",
  hr: "HR representative",
  union: "Union representative",
  advocate: "Advocate / supporter",
  other: "Other",
};

export type AttachableCase = {
  caseId: string;
  caseRef: string;
  caseStatus: string;
  partyId: string;
  partyRole: string;
  otherParties?: Array<{ role: string; name: string }>;
};

const repFormSchema = z.object({
  type: z.enum(REPRESENTATIVE_TYPES),
  fullName: z.string().min(2, "Name is required"),
  roleTitle: z.string().optional().or(z.literal("")),
  organisation: z.string().optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
});
type RepFormValues = z.infer<typeof repFormSchema>;

type MasterPayload = {
  type: RepFormValues["type"];
  fullName: string;
  roleTitle: string | null;
  organisation: string | null;
  email: string | null;
  phone: string | null;
};

export function MasterRepDialog({
  clientId,
  existing,
  trigger,
  onSuccess,
}: {
  clientId: string;
  existing?: ClientRepresentative;
  trigger: React.ReactNode;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const isEdit = !!existing;
  const form = useForm<RepFormValues>({
    resolver: zodResolver(repFormSchema),
    defaultValues: {
      type: (REPRESENTATIVE_TYPES as readonly string[]).includes(existing?.type ?? "")
        ? (existing!.type as RepFormValues["type"])
        : "solicitor",
      fullName: existing?.fullName ?? "",
      roleTitle: existing?.roleTitle ?? "",
      organisation: existing?.organisation ?? "",
      email: existing?.email ?? "",
      phone: existing?.phone ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: async (data: RepFormValues) => {
      const payload: MasterPayload = {
        type: data.type,
        fullName: data.fullName,
        roleTitle: data.roleTitle || null,
        organisation: data.organisation || null,
        email: data.email || null,
        phone: data.phone || null,
      };
      if (isEdit && existing) {
        return apiRequest("PATCH", `/api/client-representatives/${existing.id}`, payload);
      }
      return apiRequest("POST", `/api/clients/${clientId}/representatives`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/representatives/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "representatives"] });
      toast({ title: isEdit ? "Representative updated" : "Representative saved" });
      setOpen(false);
      form.reset();
      onSuccess?.();
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Error", description: err.message || "Could not save" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-master-rep">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit representative" : "Add representative to contacts"}</DialogTitle>
          <DialogDescription>
            This saves a contact to the master list. You can attach them to any case afterwards.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="type" render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-rep-type"><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {REPRESENTATIVE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="fullName" render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl><Input {...field} data-testid="input-rep-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="roleTitle" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role / job title</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Senior Partner" data-testid="input-rep-role-title" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="organisation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Organisation</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Smith & Co" data-testid="input-rep-org" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} data-testid="input-rep-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input type="tel" {...field} data-testid="input-rep-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-rep-save">
                {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Save representative"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function AttachToCaseDialog({
  master,
  cases,
  alreadyAttachedCaseIds,
  triggerLabel = "Attach to case",
  onSuccess,
}: {
  master: ClientRepresentative;
  cases: AttachableCase[];
  alreadyAttachedCaseIds: Set<string>;
  triggerLabel?: string;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const attach = useMutation({
    mutationFn: ({ caseId, partyId }: { caseId: string; partyId: string }) =>
      apiRequest("POST", `/api/cases/${caseId}/representatives/attach`, {
        clientRepresentativeId: master.id,
        partyId,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/representatives/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", master.clientId, "representatives"] });
      // Refresh the case-detail rep list so an open case page picks up the
      // new attachment without a manual reload. The case page uses a single
      // template-string queryKey (see `representatives-section.tsx`), so the
      // invalidation key MUST match exactly — array-form keys would miss it.
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${variables.caseId}/representatives`] });
      toast({ title: "Attached to case" });
      setOpen(false);
      onSuccess?.();
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Could not attach", description: err.message }),
  });
  const attachable = cases.filter((c) => !alreadyAttachedCaseIds.has(c.caseId));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-attach-master-${master.id}`}>
          <Link2 className="w-3 h-3 mr-1" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" data-testid="dialog-attach-rep">
        <DialogHeader>
          <DialogTitle>Attach {master.fullName} to a case</DialogTitle>
          <DialogDescription>
            Pick the case to add this representative to. They'll appear on the case immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto border border-stone-200 rounded-md divide-y divide-stone-100">
          {attachable.length === 0 && (
            <p className="text-xs text-stone-500 p-4 text-center">
              {cases.length === 0
                ? "No cases available."
                : "Already attached to all cases."}
            </p>
          )}
          {attachable.map((c) => (
            <button
              key={c.caseId + ":" + c.partyId}
              type="button"
              disabled={attach.isPending}
              onClick={() => attach.mutate({ caseId: c.caseId, partyId: c.partyId })}
              className="w-full text-left p-3 hover:bg-stone-50 disabled:opacity-50"
              data-testid={`button-attach-to-case-${c.caseId}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{c.caseRef}</span>
                <Badge variant="outline" className="text-xs">{c.caseStatus}</Badge>
                <Badge variant="secondary" className="text-xs">Client {c.partyRole}</Badge>
              </div>
              {c.otherParties && c.otherParties.length > 0 && (
                <p className="text-xs text-stone-600 mt-0.5">
                  With: {c.otherParties.map(p => `${p.name}${p.role ? ` (Party ${p.role})` : ""}`).join(", ")}
                </p>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { TYPE_LABELS as REP_TYPE_LABELS };
