import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { PipelineCard } from "./types";
import { STAGE_LABEL } from "./types";
import { FMC_ACCREDITATION_STATUSES } from "@shared/schema";

const NONE_VALUE = "__none__";

const LEAD_SOURCES = [
  "Google search",
  "Google search - BFM website",
  "FMC website",
  "Word of mouth",
  "Previous client recommendation",
  "Referral",
];

type ServiceType = { id: string; name: string; isActive: boolean };

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "recruitment_approach", label: STAGE_LABEL["recruitment_approach"] },
  { value: "interview", label: STAGE_LABEL["interview"] },
  { value: "reference_credential_check", label: STAGE_LABEL["reference_credential_check"] },
  { value: "contract_issued", label: STAGE_LABEL["contract_issued"] },
  { value: "rejected", label: "Rejected" },
];

export function InlineApplicantEdit({ card, onDone }: { card: PipelineCard; onDone: () => void }) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState(card.firstName);
  const [lastName, setLastName] = useState(card.lastName);
  const [email, setEmail] = useState(card.email);
  const [phone, setPhone] = useState(card.phone ?? "");
  const [accreditationStatus, setAccreditationStatus] = useState(card.accreditationStatus ?? "");
  const [stage, setStage] = useState(card.stage as string);
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("");
  const [areaOfPractice, setAreaOfPractice] = useState<string[]>(card.areaOfPractice ?? []);

  const { data: serviceTypes } = useQuery<ServiceType[]>({ queryKey: ["/api/service-types"] });
  const practiceOptions = Array.from(new Set([
    ...(serviceTypes?.filter((s) => s.isActive).map((s) => s.name) ?? []),
    ...areaOfPractice,
  ]));

  function toggleArea(name: string) {
    setAreaOfPractice((prev) => prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]);
  }

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/mediator-applicants/${card.id}`, {
      firstName, lastName, email, phone, accreditationStatus, stage,
      source: source || undefined,
      areaOfPractice,
      notes: notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      toast({ title: "Applicant updated" });
      onDone();
    },
    onError: (e: unknown) => toast({ title: "Update failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="ap-first" className="text-xs">First name</Label>
          <Input id="ap-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-applicant-first" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ap-last" className="text-xs">Last name</Label>
          <Input id="ap-last" value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-applicant-last" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ap-email" className="text-xs">Email</Label>
        <Input id="ap-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-applicant-email" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ap-phone" className="text-xs">Phone</Label>
        <Input id="ap-phone" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-applicant-phone" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ap-acc" className="text-xs">Accreditation status</Label>
        <Select
          value={accreditationStatus === "" ? NONE_VALUE : accreditationStatus}
          onValueChange={(v) => setAccreditationStatus(v === NONE_VALUE ? "" : v)}
        >
          <SelectTrigger data-testid="select-applicant-accreditation">
            <SelectValue placeholder="Select accreditation status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
            {FMC_ACCREDITATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
            {accreditationStatus !== "" &&
              !(FMC_ACCREDITATION_STATUSES as readonly string[]).includes(accreditationStatus) && (
              <SelectItem value={accreditationStatus}>
                {accreditationStatus} (legacy — please re-select)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Lead source</Label>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger data-testid="select-applicant-source"><SelectValue placeholder="Choose source" /></SelectTrigger>
          <SelectContent>
            {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Areas of practice</Label>
        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto rounded border p-2">
          {practiceOptions.length === 0 && <p className="text-xs text-muted-foreground col-span-2 italic">No service types defined yet.</p>}
          {practiceOptions.map((name) => (
            <label key={name} className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={areaOfPractice.includes(name)}
                onCheckedChange={() => toggleArea(name)}
                data-testid={`checkbox-area-${name}`}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Stage</Label>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger data-testid="select-applicant-stage"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STAGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="ap-notes" className="text-xs">Add a note (optional)</Label>
        <Textarea id="ap-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-applicant-notes" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onDone} data-testid="button-cancel-inline-edit">Cancel</Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-inline-edit">
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
