import { Calendar, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Mode = "prompt" | "manage";
type CalendarOAuthReturnTarget = "settings" | "appointments" | "dashboard" | "onboarding";

interface CalendarConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: Mode;
  connectedEmail?: string | null;
  connectedProvider?: "google" | "outlook" | null;
  needsReauth?: boolean;
  onDismiss?: () => void;
  returnTo: CalendarOAuthReturnTarget;
}

export function CalendarConnectModal({
  open,
  onOpenChange,
  mode = "prompt",
  connectedEmail,
  connectedProvider = null,
  needsReauth = false,
  onDismiss,
  returnTo,
}: CalendarConnectModalProps) {
  const isManage = mode === "manage";
  const title = isManage
    ? needsReauth
      ? "Reauthentication required"
      : "Calendar settings"
    : "Connect your calendar";
  const description = isManage
    ? connectedEmail
      ? `Currently connected as ${connectedEmail}. Reconnect to switch accounts or restore access if syncing has stopped. BFM uses this connection to read your availability windows AND to create, edit, and delete events on your calendar when bookings are taken or cancelled.`
      : "Reconnect your calendar to keep BFM appointments in sync. BFM uses this connection to read your availability windows AND to create, edit, and delete events on your calendar when bookings are taken or cancelled."
    : "Your calendar isn't connected yet. Connect Google Calendar or Microsoft Outlook so BFM can keep your availability and bookings in sync.";

  const googleButtonLabel = isManage
    ? connectedEmail
      ? "Re-authorise / change account"
      : "Connect Google Calendar"
    : "Connect Google Calendar";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="dialog-calendar-connect">
        <DialogHeader>
          <div className="w-12 h-12 rounded-full bg-[#a7baa4]/20 flex items-center justify-center mb-3">
            <Calendar className="w-6 h-6 text-[#5a7d58]" />
          </div>
          <DialogTitle className="font-heading text-xl" data-testid="text-calendar-modal-title">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed pt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        {needsReauth && (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3"
            data-testid="alert-modal-needs-reauth"
          >
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 text-xs leading-relaxed">
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Google rejected our saved authorisation
              </p>
              <p className="text-amber-800/90 dark:text-amber-200/90 mt-0.5">
                Reconnect below to resume calendar sync. Your existing availability events stay safe — only the BFM connection is affected.
              </p>
            </div>
          </div>
        )}

        {connectedProvider && (
          <p className="text-xs text-muted-foreground" data-testid="text-calendar-single-provider-help">
            Disconnect your current calendar before connecting another calendar provider.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch py-2">
          <div className="group flex flex-col h-full border rounded-xl p-5 bg-card hover:border-[#5a7d58]/50 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/20 flex items-center justify-center shrink-0 group-hover:bg-[#a7baa4]/30 transition-colors">
                <Calendar className="w-5 h-5 text-[#5a7d58]" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground">Google Calendar</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Sync your BFM appointments automatically with your Google account.
                </p>
              </div>
            </div>
            <a
              href={`/api/auth/google?returnTo=${returnTo}`}
              className="block w-full mt-auto"
              aria-disabled={connectedProvider === "outlook"}
              onClick={(event) => { if (connectedProvider === "outlook") event.preventDefault(); }}
              data-testid="link-calendar-connect-google"
            >
              <Button className="w-full bg-[#5a7d58] hover:bg-[#4a6b48] text-white" variant="default" disabled={connectedProvider === "outlook"}>
                {googleButtonLabel}
              </Button>
            </a>
          </div>

          <div
            className="group flex flex-col h-full border rounded-xl p-5 bg-card hover:border-[#5a7d58]/50 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            data-testid="card-calendar-connect-outlook"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/20 flex items-center justify-center shrink-0 group-hover:bg-[#a7baa4]/30 transition-colors">
                <Calendar className="w-5 h-5 text-[#5a7d58]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sm text-foreground">Microsoft Outlook</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Sync your BFM appointments with your Microsoft 365 / Outlook account.
                </p>
              </div>
            </div>
            <a
              href={`/api/auth/outlook?returnTo=${returnTo}`}
              className="block w-full mt-auto"
              aria-disabled={connectedProvider === "google"}
              onClick={(event) => { if (connectedProvider === "google") event.preventDefault(); }}
              data-testid="link-calendar-connect-outlook"
            >
              <Button className="w-full bg-[#5a7d58] hover:bg-[#4a6b48] text-white" variant="default" disabled={connectedProvider === "google"} data-testid="button-calendar-connect-outlook">
                Connect Microsoft Outlook
              </Button>
            </a>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onDismiss?.();
              onOpenChange(false);
            }}
            data-testid="button-calendar-connect-dismiss"
          >
            {isManage ? "Close" : "Maybe later"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
