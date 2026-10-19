import { useState, useEffect } from "react";
import { Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { COURT_FORMS, partyDisplayLabel, type CourtFormId, type PartyLike } from "./derivation";

export function SendCourtFormModal({
  open, onOpenChange, parties, initialFormId, onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parties: PartyLike[];
  initialFormId: CourtFormId;
  onSent: (formId: CourtFormId, partyId: string) => void;
}) {
  const { toast } = useToast();
  const [formId, setFormId] = useState<CourtFormId>(initialFormId);
  const [partyId, setPartyId] = useState<string>(parties[0]?.id ?? "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (open) {
      setFormId(initialFormId);
      setPartyId(parties[0]?.id ?? "");
      setMessage("");
    }
  }, [open, initialFormId, parties]);

  const handleSubmit = () => {
    const recipient = parties.find((p) => p.id === partyId);
    if (!recipient) return;
    const formName = COURT_FORMS.find((f) => f.id === formId)?.name ?? formId;
    const label = partyDisplayLabel(recipient);
    const name = `${recipient.firstName ?? ""} ${recipient.lastName ?? ""}`.trim() || "—";
    onSent(formId, partyId);
    onOpenChange(false);
    toast({
      title: `${formName} sent to ${label} for signature — UI mock`,
      description: `${name} — no email was sent.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="modal-send-court-form">
        <DialogHeader>
          <DialogTitle>Send court form for signature</DialogTitle>
          <DialogDescription>
            UI preview only — no email is sent and no record is saved. Backend wiring is the next task.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Form</Label>
            <Select value={formId} onValueChange={(v) => setFormId(v as CourtFormId)}>
              <SelectTrigger data-testid="select-send-court-form-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COURT_FORMS.map((f) => (
                  <SelectItem key={f.id} value={f.id} data-testid={`option-send-form-${f.id.toLowerCase()}`}>
                    {f.name} — {f.description.split("—")[0].trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Recipient</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger data-testid="select-send-court-form-recipient">
                <SelectValue placeholder="Select a party..." />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => {
                  const label = partyDisplayLabel(p);
                  const email = p.email ? ` <${p.email}>` : "";
                  return (
                    <SelectItem key={p.id} value={p.id} data-testid={`option-send-recipient-${p.id}`}>
                      {label}{email}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Optional message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add an optional note that will accompany the signature request..."
              className="min-h-[80px] text-sm"
              data-testid="textarea-send-court-form-message"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-send-court-form-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!partyId}
            className="bg-[#5a7d58] hover:bg-[#4a6d48]"
            data-testid="button-send-court-form-submit"
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            Send for signature
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
