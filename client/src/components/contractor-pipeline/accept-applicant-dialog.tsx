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
import { Mail } from "lucide-react";

function buildDefaultSubject(): string {
  return "Application Update — Brighter Future Mediation";
}

function buildDefaultBody(firstName: string): string {
  return (
    `Dear ${firstName},\n\n` +
    `Thank you for your application to work with Brighter Future Mediation.\n\n` +
    `We are pleased to let you know that your application has been reviewed and we would like to progress to the next stage of our process.\n\n` +
    `A member of our team will be in touch shortly with further details. In the meantime, if you have any questions, please do not hesitate to contact us.\n\n` +
    `Kind regards,\n` +
    `The Brighter Future Mediation Team`
  );
}

export function AcceptApplicantDialog({
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
  const [subject, setSubject] = useState(buildDefaultSubject());
  const [body, setBody] = useState(() => buildDefaultBody(applicantFirstName));
  const [bodyTouched, setBodyTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setSubject(buildDefaultSubject());
      setBody(buildDefaultBody(applicantFirstName));
      setBodyTouched(false);
    }
  }, [open, applicantFirstName]);

  const accept = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/contractor-applicants/${applicantId}/accept`, {
        emailSubject: subject.trim(),
        emailBody: body.trim(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? "Failed to accept applicant");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      toast({
        title: "Applicant accepted",
        description: "The applicant has been moved to Screening and emailed.",
      });
      onSuccess();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-accept-applicant">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#5a7d58]" />
            Accept applicant — {applicantName}
          </DialogTitle>
          <DialogDescription>
            Review and edit the email below before sending. The applicant will be moved to{" "}
            <strong>Screening</strong> once you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Separator />

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
                rows={12}
                value={body}
                onChange={(e) => { setBody(e.target.value); setBodyTouched(true); }}
                className="font-mono text-xs resize-y"
                data-testid="textarea-accept-body"
              />
              {bodyTouched && (
                <p className="text-[11px] text-muted-foreground">
                  You&apos;ve edited the body manually.{" "}
                  <button
                    type="button"
                    className="text-[#5a7d58] underline-offset-2 hover:underline"
                    onClick={() => { setBody(buildDefaultBody(applicantFirstName)); setBodyTouched(false); }}
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
            data-testid="button-confirm-accept-applicant"
          >
            {accept.isPending ? "Sending…" : "Accept & move to Screening"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
