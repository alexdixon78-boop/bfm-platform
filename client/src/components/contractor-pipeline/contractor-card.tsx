import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Building2, UserCheck } from "lucide-react";
import type { ContractorPipelineCard } from "./types";
import { STAGE_LABEL } from "./types";

export function ContractorCard({ card, onClick }: { card: ContractorPipelineCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${card.kind}:${card.id}`,
    data: card,
  });
  const fullName = `${card.firstName} ${card.lastName}`.trim() || card.email;

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      className="p-3 hover-elevate cursor-pointer border bg-card"
      onClick={onClick}
      data-testid={`contractor-pipeline-card-${card.kind}-${card.id}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing pt-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Drag card"
          {...listeners}
          {...attributes}
          onClick={(e) => e.stopPropagation()}
          data-testid={`contractor-drag-handle-${card.kind}-${card.id}`}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium truncate" data-testid={`text-contractor-card-name-${card.id}`}>{fullName}</p>
            <Badge variant="outline" className="text-[10px] uppercase shrink-0">
              {card.kind === "applicant" ? "Applicant" : "Contractor"}
            </Badge>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Badge variant="secondary" className="text-[10px] font-normal" data-testid={`badge-contractor-stage-${card.id}`}>
              {STAGE_LABEL[card.stage]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{card.email}</p>
          {card.contractorType && (
            <div className="flex items-center gap-1">
              <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground truncate">{card.contractorType}</p>
            </div>
          )}
          {card.convertedUserId && (
            <div className="flex items-center gap-1">
              <UserCheck className="w-3 h-3 text-[#5a7d58] shrink-0" />
              <p className="text-[10px] text-[#5a7d58]">Converted</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
