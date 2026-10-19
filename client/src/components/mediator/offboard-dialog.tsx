import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";

type OpenCase = { id: string; caseRef: string; status: string; mediatorId: string | null; mediatorRoles: string[] };
type Mediator = { id: string; name: string; email: string; status?: string };
type MediatorListResponse = Mediator[] | { data: Mediator[] };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediatorId: string;
  mediatorName: string;
}

export function OffboardDialog({ open, onOpenChange, mediatorId, mediatorName }: Props) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reassignments, setReassignments] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setReason("");
      setDate(new Date().toISOString().slice(0, 10));
      setReassignments({});
    }
  }, [open]);

  const { data: openCases, isLoading } = useQuery<OpenCase[]>({
    queryKey: ["/api/mediators", mediatorId, "open-cases"],
    enabled: open,
  });
  // /api/mediators returns a paginated `{ data, ... }` response. The backend
  // pagination param is `limit` (capped at 100), so we ask for the maximum
  // supported page size to make sure every active mediator is available as a
  // replacement option.
  const { data: mediatorsResponse } = useQuery<MediatorListResponse>({
    queryKey: ["/api/mediators", { limit: 100 }],
    queryFn: async () => {
      const res = await fetch("/api/mediators?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load mediators: ${res.status}`);
      return res.json();
    },
    enabled: open,
  });
  const mediators: Mediator[] = Array.isArray(mediatorsResponse)
    ? mediatorsResponse
    : (mediatorsResponse?.data ?? []);

  const replacementOptions = mediators.filter(
    (m) => m.id !== mediatorId && m.status === "active",
  );

  const allMapped = (openCases ?? []).every((c) => reassignments[c.id]);
  const canSubmit = !!reason.trim() && allMapped && !isLoading;

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${mediatorId}/offboard`, {
      reason: reason.trim(),
      offboardingDate: date,
      reassignments,
    }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", mediatorId] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", mediatorId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Mediator off-boarded", description: `${mediatorName} is now inactive and cases have been reassigned.` });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Couldn't off-board mediator", description: err?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" />Off-board {mediatorName}</DialogTitle>
          <DialogDescription>
            This sets the panel status to "Off-boarded", deactivates the user account (login refused), and reassigns every open case to a replacement mediator. The action is audit-logged with the reason and reassignment map.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Off-boarding date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-offboard-date" />
            </div>
          </div>
          <div>
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Mediator resigned to take a new role; final case completed 10 May."
              data-testid="input-offboard-reason"
            />
          </div>

          <div>
            <Label className="block mb-2">Open cases requiring reassignment</Label>
            {isLoading && <p className="text-sm text-muted-foreground">Loading open cases…</p>}
            {!isLoading && (openCases?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No open cases — this mediator can be off-boarded immediately.</p>
            )}
            {!isLoading && (openCases?.length ?? 0) > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role(s)</TableHead>
                    <TableHead>Reassign to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openCases!.map((c) => (
                    <TableRow key={c.id} data-testid={`row-open-case-${c.id}`}>
                      <TableCell className="font-medium">{c.caseRef}</TableCell>
                      <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.mediatorRoles.join(", ")}</TableCell>
                      <TableCell>
                        <Select
                          value={reassignments[c.id] ?? ""}
                          onValueChange={(v) => setReassignments((m) => ({ ...m, [c.id]: v }))}
                        >
                          <SelectTrigger data-testid={`select-reassign-${c.id}`}><SelectValue placeholder="Pick a mediator" /></SelectTrigger>
                          <SelectContent>
                            {replacementOptions.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
            data-testid="button-confirm-offboard"
          >
            {submit.isPending ? "Off-boarding…" : "Confirm off-boarding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
