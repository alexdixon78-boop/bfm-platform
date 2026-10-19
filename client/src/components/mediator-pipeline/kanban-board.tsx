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
import { OffboardDialog } from "@/components/mediator/offboard-dialog";
import { KanbanColumn } from "./kanban-column";
import { MediatorPipelineCard } from "./mediator-card";
import { CardDetailDrawer } from "./card-detail-drawer";
import { AcceptInterviewDialog } from "./accept-interview-dialog";
import { StatCard } from "@/components/shared/stat-card";
import { STAGE_ORDER, STAGE_LABEL, type PipelineCard, type PipelineResponse, type MediatorLifecycleStage } from "./types";
import {
  Inbox, MessageSquare, ShieldCheck, FileText,
  UserPlus, Users, RefreshCw, UserMinus,
  type LucideIcon,
} from "lucide-react";

// Icon + colour per pipeline stage
const STAGE_ICON: Record<string, LucideIcon> = {
  recruitment_approach: Inbox,
  interview: MessageSquare,
  reference_credential_check: ShieldCheck,
  contract_issued: FileText,
  onboarding_portal_access: UserPlus,
  active_on_panel: Users,
  annual_review: RefreshCw,
  off_boarded: UserMinus,
};
const STAGE_ICON_COLOR: Record<string, string> = {
  recruitment_approach: "text-[#5a7d58]",
  interview: "text-blue-600 dark:text-blue-400",
  reference_credential_check: "text-[#b8825a]",
  contract_issued: "text-amber-600 dark:text-amber-400",
  onboarding_portal_access: "text-violet-600 dark:text-violet-400",
  active_on_panel: "text-[#5a7d58]",
  annual_review: "text-sky-600 dark:text-sky-400",
  off_boarded: "text-gray-500 dark:text-gray-400",
};
const STAGE_ICON_BG: Record<string, string> = {
  recruitment_approach: "bg-[#a7baa4]/15",
  interview: "bg-blue-50 dark:bg-blue-950/30",
  reference_credential_check: "bg-[#dcae96]/15",
  contract_issued: "bg-amber-50 dark:bg-amber-950/30",
  onboarding_portal_access: "bg-violet-50 dark:bg-violet-950/30",
  active_on_panel: "bg-[#a7baa4]/15",
  annual_review: "bg-sky-50 dark:bg-sky-950/30",
  off_boarded: "bg-gray-100 dark:bg-gray-800",
};

export function KanbanBoard() {
  const { toast } = useToast();
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [drawerCard, setDrawerCard] = useState<PipelineCard | null>(null);
  const [offboardTarget, setOffboardTarget] = useState<PipelineCard | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [pendingInterviewCard, setPendingInterviewCard] = useState<PipelineCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data, isLoading } = useQuery<PipelineResponse>({
    queryKey: ["/api/mediator-pipeline"],
  });

  const move = useMutation({
    mutationFn: (vars: { kind: "applicant" | "mediator"; id: string; toStage: MediatorLifecycleStage; fromStage: MediatorLifecycleStage }) =>
      apiRequest("PATCH", "/api/mediator-pipeline/move", vars),
    // Optimistic update: snapshot, mutate cache, rollback on error.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["/api/mediator-pipeline"] });
      const snapshot = queryClient.getQueryData<PipelineResponse>(["/api/mediator-pipeline"]);
      // Skip optimistic move for mediator→off_boarded: server always responds
      // with 409+OffboardDialog, so showing the card briefly land in column 7
      // before snapping back is just visual flicker. Snapshot is still kept
      // so the rollback path is a no-op.
      if (vars.kind === "mediator" && vars.toStage === "off_boarded") {
        return { snapshot };
      }
      if (snapshot) {
        const next: PipelineResponse = {
          ...snapshot,
          columns: { ...snapshot.columns },
        };
        // Build a fresh copy of every column to avoid in-place mutation.
        for (const s of STAGE_ORDER) next.columns[s] = [...(snapshot.columns[s] ?? [])];
        let movedCard: PipelineCard | undefined;
        for (const s of STAGE_ORDER) {
          const idx = next.columns[s].findIndex((c) => c.kind === vars.kind && c.id === vars.id);
          if (idx >= 0) {
            movedCard = next.columns[s][idx];
            next.columns[s].splice(idx, 1);
            break;
          }
        }
        if (movedCard) {
          next.columns[vars.toStage] = [{ ...movedCard, stage: vars.toStage }, ...next.columns[vars.toStage]];
          queryClient.setQueryData(["/api/mediator-pipeline"], next);
        }
      }
      return { snapshot };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
    },
    onError: (err: unknown, vars, context) => {
      // Roll back the optimistic move first.
      if (context?.snapshot) {
        queryClient.setQueryData(["/api/mediator-pipeline"], context.snapshot);
      }
      const raw = err instanceof Error ? err.message : "Couldn't move card";
      // apiRequest throws "{status}: {body}". Detect 409 + structured
      // requiresOffboardDialog flag instead of relying on message wording.
      const match = /^(\d+):\s*([\s\S]*)$/.exec(raw);
      const status = match ? parseInt(match[1], 10) : 0;
      const body = match ? match[2] : raw;
      let parsed: { message?: string; requiresOffboardDialog?: boolean } = {};
      try { parsed = JSON.parse(body); } catch { /* plain text */ }
      if (status === 409 && parsed.requiresOffboardDialog) {
        const card = findCard(context?.snapshot, vars.kind, vars.id);
        if (card) setOffboardTarget(card);
        return;
      }
      toast({ title: "Move rejected", description: parsed.message ?? body, variant: "destructive" });
    },
  });

  function handleDragStart(e: DragStartEvent) {
    setActiveCard((e.active.data.current as PipelineCard) ?? null);
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("col:")) return;
    const toStage = overId.slice(4) as MediatorLifecycleStage;
    const card = e.active.data.current as PipelineCard;
    if (!card || card.stage === toStage) return;

    // Intercept applicant drag from Applications → Interview:
    // open the invite dialog instead of silently moving the card.
    // The AcceptInterviewDialog handles the stage transition + email itself,
    // so we must NOT also call move.mutate() for this combination.
    if (card.kind === "applicant" && card.stage === "recruitment_approach" && toStage === "interview") {
      setPendingInterviewCard(card);
      return;
    }

    // All other drags: call the normal move endpoint.
    // The server returns 409+requiresOffboardDialog for mediator→off_boarded;
    // the onError handler opens the OffboardDialog in that case.
    move.mutate({ kind: card.kind, id: card.id, toStage, fromStage: card.stage });
  }

  const counts = useMemo(() => {
    if (!data) return null;
    return STAGE_ORDER.reduce((acc, s) => {
      acc[s] = data.columns[s]?.length ?? 0;
      return acc;
    }, {} as Record<MediatorLifecycleStage, number>);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        {/* Stat card skeletons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCard
              key={i}
              label=""
              value={0}
              icon={Inbox}
              iconColor="text-muted-foreground"
              iconBg="bg-muted"
              isLoading
            />
          ))}
        </div>
        {/* Board skeletons */}
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
      {/* ── Pipeline stat cards — one per stage ─────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {STAGE_ORDER.map((s) => (
          <StatCard
            key={s}
            label={STAGE_LABEL[s]}
            value={counts?.[s] ?? 0}
            icon={STAGE_ICON[s]}
            iconColor={STAGE_ICON_COLOR[s]}
            iconBg={STAGE_ICON_BG[s]}
            isLoading={!counts}
            testId={`text-stat-${s}`}
          />
        ))}
      </div>

      {/* ── Toolbar row (show/hide rejected toggle) ──────────────────── */}
      <div className="flex items-center justify-end">
        <Button
          variant={showRejected ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowRejected((v) => !v)}
          data-testid="button-toggle-rejected"
        >
          {showRejected ? "Hide" : "Show"} rejected
          <Badge variant="outline" className="ml-2">{data.rejectedCount}</Badge>
        </Button>
      </div>

      {/* ── Kanban board ─────────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGE_ORDER.map((s) => (
            <KanbanColumn
              key={s}
              stage={s}
              cards={data.columns[s] ?? []}
              onCardClick={setDrawerCard}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? <MediatorPipelineCard card={activeCard} onClick={() => {}} /> : null}
        </DragOverlay>
      </DndContext>

      {showRejected && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2" data-testid="rejected-section">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Rejected applicants</h3>
          {data.rejected.length === 0 && <p className="text-xs text-muted-foreground italic">None.</p>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.rejected.map((c) => (
              <MediatorPipelineCard key={`${c.kind}:${c.id}`} card={c} onClick={() => setDrawerCard(c)} />
            ))}
          </div>
        </div>
      )}

      <CardDetailDrawer
        card={drawerCard}
        open={!!drawerCard}
        onClose={() => setDrawerCard(null)}
        onConvert={(c) => {
          setDrawerCard(null);
          move.mutate({ kind: c.kind, id: c.id, toStage: "onboarding_portal_access", fromStage: c.stage });
        }}
      />

      {offboardTarget && (
        <OffboardDialog
          open={!!offboardTarget}
          onOpenChange={(o) => {
            if (!o) {
              setOffboardTarget(null);
              // Refetch so the card visibly returns to its original column
              queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
            }
          }}
          mediatorId={offboardTarget.id}
          mediatorName={`${offboardTarget.firstName} ${offboardTarget.lastName}`.trim()}
        />
      )}

      {/* ── Drag-to-interview intercept dialog ───────────────────────── */}
      {pendingInterviewCard && (
        <AcceptInterviewDialog
          applicantId={pendingInterviewCard.id}
          applicantName={`${pendingInterviewCard.firstName} ${pendingInterviewCard.lastName}`}
          applicantFirstName={pendingInterviewCard.firstName}
          open={!!pendingInterviewCard}
          onClose={() => setPendingInterviewCard(null)}
          onSuccess={() => setPendingInterviewCard(null)}
        />
      )}
    </div>
  );
}

function findCard(data: PipelineResponse | undefined, kind: string, id: string): PipelineCard | null {
  if (!data) return null;
  for (const stage of STAGE_ORDER) {
    const found = data.columns[stage]?.find((c) => c.kind === kind && c.id === id);
    if (found) return found;
  }
  return data.rejected.find((c) => c.kind === kind && c.id === id) ?? null;
}
