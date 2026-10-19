import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { CellState, CourtFormState, CourtFormId, MiamMilestone, PartyMiamStatus } from "./derivation";

export function MiamPartyStatusPill({ status, partyId }: { status: PartyMiamStatus; partyId: string }) {
  const styles: Record<PartyMiamStatus, string> = {
    "Completed": "bg-[#a7baa4]/30 text-[#3f5a3d] border border-[#a7baa4]/60",
    "Attended": "bg-[#a7baa4]/25 text-[#5a7d58] border border-[#a7baa4]/50",
    "Booked": "bg-[#dcae96]/25 text-[#b8825a] border border-[#dcae96]/50",
    "Not started": "bg-muted text-muted-foreground/70 border border-muted-foreground/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${styles[status]}`}
      data-testid={`pill-miam-party-status-${partyId}`}
    >
      {status}
    </span>
  );
}

export function MiamCellPill({ state, partyId, milestone }: { state: CellState; partyId: string; milestone: MiamMilestone }) {
  if (state === "Not tracked") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-dashed border-muted-foreground/30 cursor-help"
              data-testid={`pill-miam-${milestone.toLowerCase()}-${partyId}`}
            >
              Not tracked yet
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            Per-party MIAM tracking for additional parties will be added when the backend supports it.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  const styles: Record<Exclude<CellState, "Not tracked">, string> = {
    "Done": "bg-[#a7baa4]/25 text-[#5a7d58] border border-[#a7baa4]/50",
    "In progress": "bg-[#dcae96]/25 text-[#b8825a] border border-[#dcae96]/50",
    "Not reached": "bg-muted text-muted-foreground/70 border border-muted-foreground/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${styles[state]}`}
      data-testid={`pill-miam-${milestone.toLowerCase()}-${partyId}`}
    >
      {state}
    </span>
  );
}

export function CourtFormCellPill({ state, partyId, formId }: { state: CourtFormState; partyId: string; formId: CourtFormId }) {
  if (state === "Not tracked") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-dashed border-muted-foreground/30 cursor-help"
              data-testid={`pill-court-form-${formId.toLowerCase()}-${partyId}`}
            >
              Not tracked yet
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            Per-party court-form tracking for additional parties will be added when the backend supports it.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  const styles: Record<Exclude<CourtFormState, "Not tracked">, string> = {
    "Filed": "bg-[#a7baa4]/30 text-[#3f5a3d] border border-[#a7baa4]/60",
    "Signed": "bg-[#a7baa4]/25 text-[#5a7d58] border border-[#a7baa4]/50",
    "Sent": "bg-[#dcae96]/25 text-[#b8825a] border border-[#dcae96]/50",
    "Not started": "bg-muted text-muted-foreground/70 border border-muted-foreground/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${styles[state]}`}
      data-testid={`pill-court-form-${formId.toLowerCase()}-${partyId}`}
    >
      {state}
    </span>
  );
}
