import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CONTRACTOR_TYPES, LEAD_SOURCES } from "@shared/schema";

const NONE_VALUE = "__none__";

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  contractorType: string;
  source: string;
  notes: string;
};

const blank: FormState = { firstName: "", lastName: "", email: "", phone: "", contractorType: "", source: "", notes: "" };

export function AddProspectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(blank);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contractor-applicants", {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        contractorType: form.contractorType || null,
        source: form.source || null,
        notes: form.notes.trim() || null,
        stage: "prospect",
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).message ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      toast({ title: "Prospect added" });
      setForm(blank);
      onClose();
    },
    onError: (err: Error) => toast({ title: "Couldn't add prospect", description: err.message, variant: "destructive" }),
  });

  const canSubmit = form.firstName.trim() && form.lastName.trim() && form.email.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-add-prospect">
        <DialogHeader>
          <DialogTitle>Add prospect</DialogTitle>
          <DialogDescription>Capture a prospective contractor at the Prospect stage.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1.5">
            <Label>First name *</Label>
            <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} data-testid="input-prospect-first-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Last name *</Label>
            <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} data-testid="input-prospect-last-name" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} data-testid="input-prospect-email" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+44 7700 000000" data-testid="input-prospect-phone" />
          </div>
          <div className="space-y-1.5">
            <Label>Contractor type</Label>
            <Select value={form.contractorType || NONE_VALUE} onValueChange={(v) => setForm((f) => ({ ...f, contractorType: v === NONE_VALUE ? "" : v }))}>
              <SelectTrigger data-testid="select-prospect-type"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                {CONTRACTOR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>How did you hear about us?</Label>
            <Select value={form.source || NONE_VALUE} onValueChange={(v) => setForm((f) => ({ ...f, source: v === NONE_VALUE ? "" : v }))}>
              <SelectTrigger data-testid="select-prospect-source"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} data-testid="textarea-prospect-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !canSubmit} data-testid="button-save-prospect">
            {save.isPending ? "Saving…" : "Add prospect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
