import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AppointmentJoinFallbackDialogProps = {
  meetingLink: string | null;
  onClose: () => void;
};

export function AppointmentJoinFallbackDialog({
  meetingLink,
  onClose,
}: AppointmentJoinFallbackDialogProps) {
  return (
    <Dialog open={Boolean(meetingLink)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-appointment-join-fallback">
        <DialogHeader>
          <DialogTitle>Open Zoom session</DialogTitle>
          <DialogDescription>
            Your browser did not let the portal control the new tab. Use this button to open the session.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button asChild disabled={!meetingLink} data-testid="button-open-join-fallback">
            <a
              href={meetingLink ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
            >
              <ExternalLink className="w-4 h-4" />
              Open Zoom
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
