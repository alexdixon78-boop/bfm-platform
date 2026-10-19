import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Mail, Trash2 } from "lucide-react";

function buildDefaultRejectionBody(firstName: string): string {
  return (
    `Dear ${firstName},\n\n` +
    `Thank you for your interest in joining Brighter Future Mediation as a mediator and for the time you invested in submitting your application.\n\n` +
    `After careful consideration, we regret to inform you that we are unable to progress your application further at this time. This was a difficult decision and we appreciate the effort you put into your application.\n\n` +
    `We wish you every success in your future endeavours.\n\n` +
    `Kind regards,\n` +
    `The Brighter Future Mediation Team`
  );
}

function buildDefaultRejectionSubject(): string {
  return "Your Application to Brighter Future Mediation";
}

export function RejectApplicantDialog({
  applicantId,
  applicantName,
  applicantFirstName,
  open,
  onClose,
  onSuccess,
}: {
  applicantId: string;
  applicantName: string;
  applicantFirstName: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [subject, setSubject] = useState(buildDefaultRejectionSubject());
  const [body, setBody] = useState(() => buildDefaultRejectionBody(applicantFirstName));

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setReason("");
      setSendEmail(true);
      setSubject(buildDefaultRejectionSubject());
      setBody(buildDefaultRejectionBody(applicantFirstName));
    }
  }, [open, applicantFirstName]);

  const reject = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mediator-applicants/${applicantId}/reject`, {
        reason: reason.trim() || undefined,
        sendEmail,
        emailSubject: sendEmail ? subject.trim() : undefined,
        emailBody: sendEmail ? body.trim() : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to reject");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      toast({ title: "Applicant rejected", description: sendEmail ? "The applicant has been notified by email." : "No email was sent." });
      onSuccess();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteApplicant = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/mediator-applicants/${applicantId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      toast({ title: "Applicant deleted", description: "The applicant record has been permanently removed." });
      onSuccess();
    },
    onError: (err: Error) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const isPending = reject.isPending || deleteApplicant.isPending;
  const canReject = !sendEmail || (subject.trim().length > 0 && body.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-reject-applicant">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Reject applicant — {applicantName}
          </DialogTitle>
          <DialogDescription>
            This will move the applicant to the <strong>Rejected</strong> stage. You can optionally
            send them a rejection email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Internal rejection reason */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Rejection reason <span className="text-muted-foreground font-normal">(internal — not sent to applicant)</span>
            </Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Does not meet current accreditation requirements, insufficient experience…"
              data-testid="textarea-reject-reason"
            />
          </div>

          <Separator />

          {/* Send email toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                Send rejection email to applicant
              </Label>
              <p className="text-xs text-muted-foreground">
                A polite rejection email will be sent to {applicantFirstName}.
              </p>
            </div>
            <Switch
              checked={sendEmail}
              onCheckedChange={setSendEmail}
              data-testid="switch-send-rejection-email"
            />
          </div>

          {/* Editable email preview */}
          {sendEmail && (
            <div className="space-y-3 rounded-md border p-3 bg-muted/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email preview</p>

              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  data-testid="input-reject-subject"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Body</Label>
                <Textarea
                  rows={12}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="font-mono text-xs resize-y"
                  data-testid="textarea-reject-body"
                />
                <button
                  type="button"
                  className="text-[11px] text-[#5a7d58] underline-offset-2 hover:underline"
                  onClick={() => setBody(buildDefaultRejectionBody(applicantFirstName))}
                >
                  Reset to default
                </button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:items-center sm:justify-between">
          {/* Delete on the left */}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
            onClick={() => deleteApplicant.mutate()}
            disabled={isPending}
            data-testid="button-delete-applicant"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete applicant
          </Button>

          {/* Confirm/cancel on the right */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => reject.mutate()}
              disabled={isPending || !canReject}
              data-testid="button-confirm-reject"
            >
              {reject.isPending ? "Rejecting…" : "Reject applicant"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
