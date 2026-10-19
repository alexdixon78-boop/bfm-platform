import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { ExternalLink, Pencil, Clock, Check, X, UserX, UserCheck } from "lucide-react";
import { STAGE_LABEL, type ContractorPipelineCard } from "./types";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CONTRACTOR_TYPES, LEAD_SOURCES } from "@shared/schema";

type Activity = { id: string; timestamp: string; action: string; details: string | null; userId: string | null };

type EditForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  contractorType: string;
  source: string;
  notes: string;
};

const NONE_VALUE = "__none__";

export function ContractorCardDetailDrawer({
  card, open, onClose, onAccept, onConvert, onReject,
}: {
  card: ContractorPipelineCard | null;
  open: boolean;
  onClose: () => void;
  onAccept: (card: ContractorPipelineCard) => void;
  onConvert: (card: ContractorPipelineCard) => void;
  onReject: (card: ContractorPipelineCard) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>({ firstName: "", lastName: "", email: "", phone: "", contractorType: "", source: "", notes: "" });

  useEffect(() => {
    if (!open) { setEditing(false); return; }
    if (card) {
      setForm({
        firstName: card.firstName,
        lastName: card.lastName,
        email: card.email,
        phone: card.phone ?? "",
        contractorType: card.contractorType ?? "",
        source: card.source ?? "",
        notes: card.notes ?? "",
      });
    }
  }, [open, card]);

  const { canEdit: canEditSection } = usePermissions();
  const { toast } = useToast();
  const canEdit = canEditSection("contractors");
  const isApplicant = card?.kind === "applicant";
  const isConverted = !!card?.convertedUserId;
  const isAtApplicationsStage = card?.stage === "prospect";

  const { data: activity } = useQuery<Activity[]>({
    queryKey: ["/api/contractor-pipeline", card?.kind, card?.id, "timeline"],
    enabled: !!card,
    queryFn: async () => {
      const res = await fetch(`/api/contractor-pipeline/${card!.kind}/${card!.id}/timeline`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/contractor-applicants/${card!.id}`, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        contractorType: form.contractorType || null,
        source: form.source || null,
        notes: form.notes.trim() || null,
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).message ?? "Failed to save"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      setEditing(false);
      toast({ title: "Applicant updated" });
    },
    onError: (err: Error) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="sheet-contractor-pipeline-card">
        {card && (
          <>
            <SheetHeader>
              <SheetTitle data-testid="text-contractor-drawer-name">{card.firstName} {card.lastName}</SheetTitle>
              <SheetDescription>{card.email}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{STAGE_LABEL[card.stage]}</Badge>
                <Badge variant="outline" className="text-[10px] uppercase">{card.kind}</Badge>
                {isConverted && <Badge variant="outline" className="text-[10px] text-[#5a7d58] border-[#5a7d58]/40">Converted</Badge>}
              </div>

              {!editing && (
                <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                  <span className="text-muted-foreground">Phone</span><span className="col-span-2">{card.phone ?? "—"}</span>
                  <span className="text-muted-foreground">Type</span><span className="col-span-2">{card.contractorType ?? "—"}</span>
                  <span className="text-muted-foreground">Source</span><span className="col-span-2">{card.source ?? "—"}</span>
                  {card.notes && (
                    <>
                      <span className="text-muted-foreground">Notes</span>
                      <span className="col-span-2 whitespace-pre-line">{card.notes}</span>
                    </>
                  )}
                  {card.rejectedReason && (
                    <>
                      <span className="text-muted-foreground text-destructive">Rejected</span>
                      <span className="col-span-2 text-destructive">{card.rejectedReason}</span>
                    </>
                  )}
                  {card.updatedAt && (
                    <>
                      <span className="text-muted-foreground">Last updated</span>
                      <span className="col-span-2">{new Date(card.updatedAt).toLocaleString()}</span>
                    </>
                  )}
                </div>
              )}

              {card.kind === "contractor" && !editing && (
                <Link href="/contractors">
                  <Button variant="outline" size="sm" className="w-full" data-testid="button-open-contractor">
                    <ExternalLink className="w-4 h-4 mr-2" />Open contractor profile
                  </Button>
                </Link>
              )}

              {editing && isApplicant && !isConverted && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">First name</Label>
                      <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} data-testid="input-edit-first-name" />
                    </div>
                    <div>
                      <Label className="text-xs">Last name</Label>
                      <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} data-testid="input-edit-last-name" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} data-testid="input-edit-email" />
                  </div>
                  <div>
                    <Label className="text-xs">Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} data-testid="input-edit-phone" />
                  </div>
                  <div>
                    <Label className="text-xs">Contractor type</Label>
                    <Select value={form.contractorType || NONE_VALUE} onValueChange={(v) => setForm((f) => ({ ...f, contractorType: v === NONE_VALUE ? "" : v }))}>
                      <SelectTrigger data-testid="select-edit-contractor-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                        {CONTRACTOR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Source</Label>
                    <Select value={form.source || NONE_VALUE} onValueChange={(v) => setForm((f) => ({ ...f, source: v === NONE_VALUE ? "" : v }))}>
                      <SelectTrigger data-testid="select-edit-source"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                        {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} data-testid="textarea-edit-notes" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-edit">
                      <Check className="w-4 h-4 mr-1" />{saveMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)} data-testid="button-cancel-edit">
                      <X className="w-4 h-4 mr-1" />Cancel
                    </Button>
                  </div>
                </div>
              )}

              <Separator />

              <div>
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />Activity timeline
                </h4>
                {(!activity || activity.length === 0) && (
                  <p className="text-xs text-muted-foreground italic">No recorded activity yet.</p>
                )}
                <ul className="space-y-2">
                  {activity?.slice(0, 15).map((a) => (
                    <li key={a.id} className="text-xs border-l-2 border-muted pl-3 py-1">
                      <p className="font-medium">{a.action.replace(/_/g, " ")}</p>
                      <p className="text-muted-foreground">{new Date(a.timestamp).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <SheetFooter className="mt-6 flex-row gap-2 sm:justify-end flex-wrap">
              {isApplicant && !editing && canEdit && !isConverted && card.stage !== "rejected" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-drawer-edit">
                    <Pencil className="w-4 h-4 mr-1" />Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/40 hover:bg-destructive/5"
                    onClick={() => onReject(card)}
                    data-testid="button-drawer-reject"
                  >
                    <UserX className="w-4 h-4 mr-1" />Reject
                  </Button>
                  {isAtApplicationsStage && (
                    <Button
                      size="sm"
                      onClick={() => onAccept(card)}
                      className="bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
                      data-testid="button-drawer-accept"
                    >
                      <UserCheck className="w-4 h-4 mr-1" />Accept applicant
                    </Button>
                  )}
                  {card.stage === "contract_sent" && (
                    <Button
                      size="sm"
                      onClick={() => onConvert(card)}
                      className="bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
                      data-testid="button-drawer-convert"
                    >
                      Convert & invite
                    </Button>
                  )}
                </>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
