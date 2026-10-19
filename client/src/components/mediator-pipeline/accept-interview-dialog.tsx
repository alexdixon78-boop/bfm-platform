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
import { useToast } from "@/hooks/use-toast";
import { Link2, Mail } from "lucide-react";

function buildDefaultBody(firstName: string, interviewLink: string): string {
  const linkSection = interviewLink.trim()
    ? `To join the interview, please use the following link:\n${interviewLink.trim()}\n\n`
    : "";

  return (
    `Dear ${firstName},\n\n` +
    `Thank you for your application to join Brighter Future Mediation as a mediator.\n\n` +
    `We are delighted to invite you to the next stage of our recruitment process — an interview with our team. We look forward to learning more about you and your experience in mediation.\n\n` +
    linkSection +
    `If you have any questions, or if you are unable to attend at the proposed time, please do not hesitate to contact us.\n\n` +
    `Kind regards,\n` +
    `The Brighter Future Mediation Team`
  );
}

function buildDefaultSubject(): string {
  return "Invitation to Interview — Brighter Future Mediation";
}

export function AcceptInterviewDialog({
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
  const [interviewLink, setInterviewLink] = useState("");
  const [subject, setSubject] = useState(buildDefaultSubject());
  const [body, setBody] = useState(() => buildDefaultBody(applicantFirstName, ""));
  const [bodyTouched, setBodyTouched] = useState(false);

  // Reset state when dialog opens fresh
  useEffect(() => {
    if (open) {
      setInterviewLink("");
      setSubject(buildDefaultSubject());
      setBody(buildDefaultBody(applicantFirstName, ""));
      setBodyTouched(false);
    }
  }, [open, applicantFirstName]);

  // Auto-update body when link changes, only if user hasn't manually edited it
  useEffect(() => {
    if (!bodyTouched) {
      setBody(buildDefaultBody(applicantFirstName, interviewLink));
    }
  }, [interviewLink, applicantFirstName, bodyTouched]);

  const accept = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mediator-applicants/${applicantId}/accept-interview`, {
        interviewLink: interviewLink.trim() || undefined,
        emailSubject: subject.trim(),
        emailBody: body.trim(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to accept");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-applicants"] });
      toast({ title: "Applicant invited to interview", description: "The applicant has been moved to the Interview stage and emailed." });
      onSuccess();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-accept-interview">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#5a7d58]" />
            Invite to interview — {applicantName}
          </DialogTitle>
          <DialogDescription>
            Review and edit the email below before sending. The applicant will be moved to the
            <strong> Interview</strong> stage once you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Interview link */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Link2 className="w-3 h-3" />
              Interview link <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              value={interviewLink}
              onChange={(e) => setInterviewLink(e.target.value)}
              placeholder="https://meet.google.com/… or Zoom link"
              data-testid="input-interview-link"
            />
            <p className="text-[11px] text-muted-foreground">
              If provided, this link will be automatically added to the email body below.
            </p>
          </div>

          <Separator />

          {/* Email preview */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email preview</p>

            <div className="space-y-1.5">
              <Label className="text-xs">Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                data-testid="input-accept-subject"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Body</Label>
              <Textarea
                rows={14}
                value={body}
                onChange={(e) => { setBody(e.target.value); setBodyTouched(true); }}
                className="font-mono text-xs resize-y"
                data-testid="textarea-accept-body"
              />
              {bodyTouched && (
                <p className="text-[11px] text-muted-foreground">
                  You've edited the body manually.{" "}
                  <button
                    type="button"
                    className="text-[#5a7d58] underline-offset-2 hover:underline"
                    onClick={() => { setBody(buildDefaultBody(applicantFirstName, interviewLink)); setBodyTouched(false); }}
                  >
                    Reset to default
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={accept.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => accept.mutate()}
            disabled={accept.isPending || !canSubmit}
            className="bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
            data-testid="button-confirm-accept-interview"
          >
            {accept.isPending ? "Sending…" : "Send & move to Interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
