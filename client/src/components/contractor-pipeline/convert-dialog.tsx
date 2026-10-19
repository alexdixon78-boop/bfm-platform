import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { UserCheck, EyeIcon, EyeOffIcon } from "lucide-react";
import { CONTRACTOR_TYPES } from "@shared/schema";
import type { ContractorPipelineCard } from "./types";

const NONE_VALUE = "__none__";

export function ConvertContractorDialog({
  card, open, onClose, onSuccess,
}: {
  card: ContractorPipelineCard | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [contractorType, setContractorType] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (open && card) {
      setName(`${card.firstName} ${card.lastName}`.trim());
      setEmail(card.email);
      setContractorType(card.contractorType ?? "");
      setSendInvite(true);
      setPassword("");
    }
  }, [open, card]);

  const convert = useMutation({
    mutationFn: async () => {
      if (!sendInvite && !password.trim()) throw new Error("Please enter a password or choose to send an invite email.");
      const res = await apiRequest("POST", `/api/contractor-applicants/${card!.id}/convert`, {
        name: name.trim(),
        email: email.trim(),
        contractorType: contractorType || undefined,
        sendInvite,
        password: sendInvite ? undefined : password.trim() || undefined,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).message ?? "Conversion failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractor-applicants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      toast({
        title: "Contractor account created",
        description: sendInvite
          ? "An invite email has been sent to the contractor."
          : "The account is ready to use with the password you set.",
      });
      onSuccess();
    },
    onError: (err: Error) => toast({ title: "Conversion failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = name.trim() && email.trim() && (sendInvite || password.trim()) && !convert.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-convert-contractor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-[#5a7d58]" />
            Convert to contractor
          </DialogTitle>
          <DialogDescription>
            This will create a contractor system account. Choose whether to send an invite email or set a password directly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Full name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-convert-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-convert-email" />
          </div>
          <div className="space-y-1.5">
            <Label>Contractor type</Label>
            <Select value={contractorType || NONE_VALUE} onValueChange={(v) => setContractorType(v === NONE_VALUE ? "" : v)}>
              <SelectTrigger data-testid="select-convert-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Not set —</SelectItem>
                {CONTRACTOR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Account setup option */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="send-invite"
                checked={sendInvite}
                onCheckedChange={(c) => setSendInvite(!!c)}
                data-testid="checkbox-send-invite"
              />
              <Label htmlFor="send-invite" className="text-sm cursor-pointer">
                Send invite email with a link to set up their password
              </Label>
            </div>
            {!sendInvite && (
              <div className="space-y-1.5">
                <Label className="text-xs">Set password directly *</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="pr-10"
                    data-testid="input-convert-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={convert.isPending}>Cancel</Button>
          <Button
            onClick={() => convert.mutate()}
            disabled={!canSubmit}
            className="bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
            data-testid="button-confirm-convert"
          >
            {convert.isPending ? "Converting…" : "Convert & create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
