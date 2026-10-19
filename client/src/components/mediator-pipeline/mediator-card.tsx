import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical, ShieldCheck, ShieldAlert, Shield, FileCheck2, FileWarning, FileX2, CheckCircle2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PipelineCard, CredentialStatus, InsuranceStatus } from "./types";
import { STAGE_LABEL } from "./types";

const CRED_PILL: Record<CredentialStatus, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  verified: { label: "Verified", cls: "bg-[#a7baa4]/20 text-[#5a7d58] border-[#a7baa4]/40", Icon: ShieldCheck },
  pending:  { label: "Pending",  cls: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800", Icon: Shield },
  failed:   { label: "Failed",   cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: ShieldAlert },
  none:     { label: "—",        cls: "bg-muted text-muted-foreground border-border", Icon: Shield },
};
const INS_PILL: Record<InsuranceStatus, { label: string; cls: string; Icon: typeof FileCheck2 }> = {
  valid:    { label: "Valid",    cls: "bg-[#a7baa4]/20 text-[#5a7d58] border-[#a7baa4]/40", Icon: FileCheck2 },
  expiring: { label: "Expiring", cls: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800", Icon: FileWarning },
  expired:  { label: "Expired",  cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: FileX2 },
  none:     { label: "—",        cls: "bg-muted text-muted-foreground border-border", Icon: FileCheck2 },
};

export function MediatorPipelineCard({
  card, onClick,
}: { card: PipelineCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${card.kind}:${card.id}`,
    data: card,
  });
  const cred = CRED_PILL[card.credentialStatus];
  const ins  = INS_PILL[card.insuranceStatus];
  const visibleAreas = card.areaOfPractice.slice(0, 2);
  const overflow = card.areaOfPractice.length - visibleAreas.length;
  const fullName = `${card.firstName} ${card.lastName}`.trim() || card.email;

  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
      }}
      className="p-3 hover-elevate cursor-pointer border bg-card"
      onClick={onClick}
      data-testid={`pipeline-card-${card.kind}-${card.id}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing pt-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Drag card"
          {...listeners}
          {...attributes}
          onClick={(e) => e.stopPropagation()}
          data-testid={`drag-handle-${card.kind}-${card.id}`}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <p className="font-medium truncate" data-testid={`text-card-name-${card.id}`}>{fullName}</p>
              {card.contractReady && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span data-testid={`badge-contract-ready-${card.id}`} className="shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#5a7d58]" aria-label="Contract signed and ICO active" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Contract signed &amp; ICO active — ready to convert</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <Badge variant="outline" className="text-[10px] uppercase shrink-0">
              {card.kind === "applicant" ? "Applicant" : "Mediator"}
            </Badge>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Badge variant="secondary" className="text-[10px] font-normal" data-testid={`badge-stage-${card.id}`}>
              {STAGE_LABEL[card.stage]}
            </Badge>
            {card.reviewDueSoon && card.kind === "mediator" && (
              <Badge
                className="text-[10px] font-normal bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 animate-pulse"
                data-testid={`badge-review-due-${card.id}`}
              >
                Review due
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{card.email}</p>
          {card.accreditationStatus && (
            <p className="text-xs text-muted-foreground truncate">{card.accreditationStatus}</p>
          )}
          {visibleAreas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {visibleAreas.map((a) => (
                <Badge key={a} variant="secondary" className="text-[10px] font-normal">{a}</Badge>
              ))}
              {overflow > 0 && (
                <Badge variant="secondary" className="text-[10px] font-normal">+{overflow}</Badge>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-1">
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${cred.cls}`}>
              <cred.Icon className="w-3 h-3" />Credentials: {cred.label}
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${ins.cls}`}>
              <ins.Icon className="w-3 h-3" />Insurance: {ins.label}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
