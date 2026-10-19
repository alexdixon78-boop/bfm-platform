import { useDroppable } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { MediatorPipelineCard } from "./mediator-card";
import { STAGE_LABEL, STAGE_DESCRIPTION, type MediatorLifecycleStage, type PipelineCard } from "./types";

export function KanbanColumn({
  stage, cards, onCardClick,
}: {
  stage: MediatorLifecycleStage;
  cards: PipelineCard[];
  onCardClick: (card: PipelineCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stage}` });

  return (
    <div className="flex flex-col min-w-[280px] w-[280px] shrink-0" data-testid={`column-${stage}`}>
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {STAGE_LABEL[stage]}
          </h3>
          <Badge variant="outline" className="shrink-0" data-testid={`count-${stage}`}>{cards.length}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{STAGE_DESCRIPTION[stage]}</p>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] p-2 space-y-2 rounded-md transition-colors ${isOver ? "bg-[#a7baa4]/15 ring-1 ring-[#5a7d58]/40" : ""}`}
      >
        {cards.length === 0 && (
          <p className="text-xs text-muted-foreground italic px-2 py-6 text-center">No cards in this stage.</p>
        )}
        {cards.map((c) => (
          <MediatorPipelineCard key={`${c.kind}:${c.id}`} card={c} onClick={() => onCardClick(c)} />
        ))}
      </div>
    </div>
  );
}
