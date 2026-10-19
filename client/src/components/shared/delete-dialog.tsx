import { useEffect, useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: (typedValue?: string) => void;
  cancelTestId?: string;
  confirmTestId?: string;
  confirmLabel?: string;
  /**
   * If provided, requires the user to type this exact value to enable confirm.
   * Useful for hard-delete confirmations.
   */
  confirmText?: string;
  confirmInputTestId?: string;
  isPending?: boolean;
}

export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  cancelTestId,
  confirmTestId,
  confirmLabel = "Delete",
  confirmText,
  confirmInputTestId,
  isPending = false,
}: DeleteDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const requiresTyping = !!confirmText;
  const matches = !requiresTyping || typed === confirmText;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requiresTyping && (
          <div className="space-y-2">
            <Label htmlFor="delete-confirm-input" className="text-sm">
              Type <span className="font-mono font-semibold text-foreground">{confirmText}</span> to confirm
            </Label>
            <Input
              id="delete-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
              data-testid={confirmInputTestId}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={cancelTestId} disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            onClick={() => onConfirm(requiresTyping ? typed : undefined)}
            disabled={!matches || isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid={confirmTestId}
          >
            {isPending ? "Working..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
