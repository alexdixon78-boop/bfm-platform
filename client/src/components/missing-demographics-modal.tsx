import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, ArrowRight } from "lucide-react";

type MissingDemographicsCase = {
  caseId: string;
  caseRef: string;
  stage: string;
  status: string;
};

interface Props {
  open: boolean;
  cases: MissingDemographicsCase[];
  onDismiss: () => void;
}

export function MissingDemographicsModal({ open, cases, onDismiss }: Props) {
  const [, navigate] = useLocation();

  function handleViewCase(caseId: string) {
    onDismiss();
    navigate(`/cases/${caseId}?tab=demographics`);
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent className="max-w-lg" data-testid="missing-demographics-modal">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-[#dcae96]/20 flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5 text-[#b8825a]" />
            </div>
            <DialogTitle className="font-heading text-lg">
              Demographic information needed
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            To help us provide the best service, please complete your demographic information for the following{" "}
            {cases.length === 1 ? "case" : "cases"}. This takes just a few minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-64 overflow-y-auto py-1" data-testid="missing-demographics-list">
          {cases.map((c) => (
            <div
              key={c.caseId}
              className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"
              data-testid={`missing-demographics-case-${c.caseId}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground font-mono" data-testid={`text-case-ref-${c.caseId}`}>
                  {c.caseRef}
                </p>
                <p className="text-xs text-muted-foreground truncate mt-0.5" data-testid={`text-case-stage-${c.caseId}`}>
                  {c.stage}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant={c.status === "Active" ? "default" : "secondary"}
                  className="text-[10px]"
                  data-testid={`badge-case-status-${c.caseId}`}
                >
                  {c.status}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs h-8"
                  onClick={() => handleViewCase(c.caseId)}
                  data-testid={`button-view-case-${c.caseId}`}
                >
                  View details
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="text-muted-foreground"
            data-testid="button-remind-later"
          >
            Remind me later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
