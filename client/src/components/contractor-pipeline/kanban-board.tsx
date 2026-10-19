import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, KeyboardSensor, useSensor, useSensors, closestCorners,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { StatCard } from "@/components/shared/stat-card";
import { ContractorKanbanColumn } from "./kanban-column";
import { ContractorCard } from "./contractor-card";
import { ContractorCardDetailDrawer } from "./card-detail-drawer";
import { AcceptApplicantDialog } from "./accept-applicant-dialog";
import { ConvertContractorDialog } from "./convert-dialog";
import { STAGE_ORDER, STAGE_LABEL, type ContractorApplicantStage, type ContractorPipelineCard, type ContractorPipelineResponse } from "./types";
import {
  Eye, Search, FileSignature, CheckCircle, UserMinus, ChevronDown, ChevronUp,
  type LucideIcon,
} from "lucide-react";

const STAGE_ICON: Record<string, LucideIcon> = {
  prospect: Eye,
  screening: Search,
  contract_sent: FileSignature,
  active: CheckCircle,
  off_boarded: UserMinus,
};
const STAGE_ICON_COLOR: Record<string, string> = {
  prospect: "text-[#5a7d58]",
  screening: "text-blue-600 dark:text-blue-400",
  contract_sent: "text-amber-600 dark:text-amber-400",
  active: "text-[#5a7d58]",
  off_boarded: "text-gray-500 dark:text-gray-400",
};
const STAGE_ICON_BG: Record<string, string> = {
  prospect: "bg-[#a7baa4]/15",
  screening: "bg-blue-50 dark:bg-blue-950/30",
  contract_sent: "bg-amber-50 dark:bg-amber-950/30",
  active: "bg-[#a7baa4]/15",
  off_boarded: "bg-gray-100 dark:bg-gray-800",
};

export function ContractorKanbanBoard() {
  const { toast } = useToast();
  const [activeCard, setActiveCard] = useState<ContractorPipelineCard | null>(null);
  const [drawerCard, setDrawerCard] = useState<ContractorPipelineCard | null>(null);
  const [acceptCard, setAcceptCard] = useState<ContractorPipelineCard | null>(null);
  const [convertCard, setConvertCard] = useState<ContractorPipelineCard | null>(null);
  const [offboardCard, setOffboardCard] = useState<ContractorPipelineCard | null>(null);
  const [rejectCard, setRejectCard] = useState<ContractorPipelineCard | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejected, setShowRejected] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data, isLoading } = useQuery<ContractorPipelineResponse & { rejectedCount: number; rejected: ContractorPipelineCard[] }>({
    queryKey: ["/api/contractor-pipeline"],
  });

  const move = useMutation({
    mutationFn: (vars: { kind: "applicant" | "contractor"; id: string; toStage: ContractorApplicantStage; fromStage: ContractorApplicantStage }) =>
      apiRequest("PATCH", "/api/contractor-pipeline/move", vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["/api/contractor-pipeline"] });
      const snapshot = queryClient.getQueryData<ContractorPipelineResponse>(["/api/contractor-pipeline"]);
      if (snapshot) {
        const next = { ...snapshot, columns: { ...snapshot.columns } };
        for (const s of STAGE_ORDER) next.columns[s] = [...(snapshot.columns[s] ?? [])];
        let movedCard: ContractorPipelineCard | undefined;
        for (const s of STAGE_ORDER) {
          const idx = next.columns[s].findIndex((c) => c.kind === vars.kind && c.id === vars.id);
          if (idx >= 0) { movedCard = next.columns[s][idx]; next.columns[s].splice(idx, 1); break; }
        }
        if (movedCard) {
          next.columns[vars.toStage] = [{ ...movedCard, stage: vars.toStage }, ...next.columns[vars.toStage]];
          queryClient.setQueryData(["/api/contractor-pipeline"], next);
        }
      }
      return { snapshot };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
    },
    onError: (err: unknown, _vars, context) => {
      if (context?.snapshot) queryClient.setQueryData(["/api/contractor-pipeline"], context.snapshot);
      const msg = err instanceof Error ? err.message : "Couldn't move card";
      toast({ title: "Move rejected", description: msg, variant: "destructive" });
    },
  });

  const offboardMutation = useMutation({
    mutationFn: (vars: { kind: "applicant" | "contractor"; id: string; fromStage: ContractorApplicantStage }) =>
      apiRequest("PATCH", "/api/contractor-pipeline/move", { ...vars, toStage: "off_boarded" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      setOffboardCard(null);
      toast({ title: "Contractor off-boarded" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (vars: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/contractor-applicants/${vars.id}/reject`, { reason: vars.reason });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as any).message ?? "Failed to reject"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      setRejectCard(null);
      setRejectReason("");
      toast({ title: "Applicant rejected" });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  function handleDragStart(e: DragStartEvent) {
    setActiveCard((e.active.data.current as ContractorPipelineCard) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("col:")) return;
    const toStage = overId.slice(4) as ContractorApplicantStage;
    const card = e.active.data.current as ContractorPipelineCard;
    if (!card || card.stage === toStage) return;

    // Intercept: applicant in contract_sent dragged to active → open convert dialog
    if (card.kind === "applicant" && card.stage === "contract_sent" && toStage === "active") {
      setConvertCard(card);
      return;
    }
    // Block: any other applicant-to-active or applicant-to-off_boarded drag
    if (card.kind === "applicant" && (toStage === "active" || toStage === "off_boarded")) {
      toast({
        title: "Cannot move here",
        description: toStage === "active"
          ? "Move the applicant to 'Contract Sent' first, then convert to create their account."
          : "Only converted contractor accounts can be off-boarded. Reject this applicant instead.",
        variant: "destructive",
      });
      return;
    }
    // Intercept: contractor dragged to off_boarded → show confirmation
    if (card.kind === "contractor" && toStage === "off_boarded") {
      setOffboardCard(card);
      return;
    }
    // Normal move
    move.mutate({ kind: card.kind, id: card.id, toStage, fromStage: card.stage });
  }

  const counts = useMemo(() => {
    if (!data) return null;
    return STAGE_ORDER.reduce((acc, s) => {
      acc[s] = data.columns[s]?.length ?? 0;
      return acc;
    }, {} as Record<ContractorApplicantStage, number>);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <StatCard key={i} label="" value={0} icon={Eye} iconColor="text-muted-foreground" iconBg="bg-muted" isLoading />
          ))}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="min-w-[280px] w-[280px] shrink-0 space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {STAGE_ORDER.map((s) => (
          <StatCard
            key={s}
            label={STAGE_LABEL[s]}
            value={counts?.[s] ?? 0}
            icon={STAGE_ICON[s]}
            iconColor={STAGE_ICON_COLOR[s]}
            iconBg={STAGE_ICON_BG[s]}
            isLoading={!counts}
            testId={`text-contractor-stat-${s}`}
          />
        ))}
      </div>

      {/* ── Kanban board ─────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGE_ORDER.map((s) => (
            <ContractorKanbanColumn
              key={s}
              stage={s}
              cards={data.columns[s] ?? []}
              onCardClick={setDrawerCard}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? <ContractorCard card={activeCard} onClick={() => {}} /> : null}
        </DragOverlay>
      </DndContext>

      {/* ── Rejected bucket ──────────────────────────────────────── */}
      {(data.rejectedCount ?? 0) > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-sm font-medium"
            onClick={() => setShowRejected((v) => !v)}
            data-testid="button-toggle-rejected"
          >
            <span className="flex items-center gap-2">
              <UserMinus className="w-4 h-4 text-muted-foreground" />
              Rejected applicants
              <Badge variant="secondary" className="text-[10px]">{data.rejectedCount}</Badge>
            </span>
            {showRejected ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showRejected && (
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 bg-muted/10">
              {data.rejected.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded border bg-card p-3 opacity-70">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    {c.contractorType && <p className="text-xs text-muted-foreground">{c.contractorType}</p>}
                    {c.rejectedReason && <p className="text-xs text-destructive mt-1 truncate">{c.rejectedReason}</p>}
                  </div>
                  <Badge variant="destructive" className="text-[10px] shrink-0">Rejected</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ContractorCardDetailDrawer
        card={drawerCard}
        open={!!drawerCard}
        onClose={() => setDrawerCard(null)}
        onAccept={(c) => { setDrawerCard(null); setAcceptCard(c); }}
        onConvert={(c) => { setDrawerCard(null); setConvertCard(c); }}
        onReject={(c) => { setDrawerCard(null); setRejectCard(c); }}
      />

      <AcceptApplicantDialog
        applicantId={acceptCard?.id ?? ""}
        applicantName={acceptCard ? `${acceptCard.firstName} ${acceptCard.lastName}` : ""}
        applicantFirstName={acceptCard?.firstName ?? ""}
        open={!!acceptCard}
        onClose={() => setAcceptCard(null)}
        onSuccess={() => setAcceptCard(null)}
      />

      <ConvertContractorDialog
        card={convertCard}
        open={!!convertCard}
        onClose={() => setConvertCard(null)}
        onSuccess={() => setConvertCard(null)}
      />

      {/* Off-board confirmation */}
      <AlertDialog open={!!offboardCard} onOpenChange={(o) => { if (!o) { setOffboardCard(null); queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] }); } }}>
        <AlertDialogContent data-testid="dialog-offboard-contractor">
          <AlertDialogHeader>
            <AlertDialogTitle>Off-board contractor?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark <strong>{offboardCard?.firstName} {offboardCard?.lastName}</strong> as inactive. Their account will no longer be able to log in. You can reactivate them by dragging back to Active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-offboard-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => offboardCard && offboardMutation.mutate({ kind: offboardCard.kind, id: offboardCard.id, fromStage: offboardCard.stage })}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              data-testid="button-offboard-confirm"
            >
              Off-board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectCard} onOpenChange={(o) => { if (!o) { setRejectCard(null); setRejectReason(""); } }}>
        <DialogContent data-testid="dialog-reject-contractor">
          <DialogHeader>
            <DialogTitle>Reject applicant</DialogTitle>
            <DialogDescription>
              Reject <strong>{rejectCard?.firstName} {rejectCard?.lastName}</strong>? They will be moved to the rejected bucket. You can view rejected applicants at the bottom of the board.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <Label className="text-sm">Reason for rejection (optional)</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Insufficient experience, not the right fit at this time…"
              rows={3}
              data-testid="textarea-reject-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectCard(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectCard && rejectMutation.mutate({ id: rejectCard.id, reason: rejectReason })}
              disabled={rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject applicant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
