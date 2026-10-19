import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, History, Shield, Clock3 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ServiceScheduleModal, type ServiceScheduleSlotRow, type ServiceScheduleSlotDraft } from "@/components/mediator-service-schedule-modal";
import { saveMediatorServiceSchedule } from "@/lib/mediator-service-schedule-save";
import { getUkWallClockDateTimeParts } from "@/lib/date-time";

type ServiceTypeInfo = {
  id: string;
  name: string;
  category: string;
};

export type ServiceApprovalSheetRow = {
  id: string;
  serviceTypeId: string;
  status: string;
  effectiveStatus?: string;
  proofFileName?: string | null;
  proofFileUrl?: string | null;
  proofLink?: string | null;
  proofMimeType?: string | null;
  expiryDate?: string | null;
  submittedAt?: string | null;
  requestedAt?: string | null;
  requestedBy?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewReason?: string | null;
  reminderSentAt?: string | null;
  expiredAt?: string | null;
  calendarStartAt?: string | null;
  calendarEndAt?: string | null;
  calendarTitle?: string | null;
  calendarGoogleEventId?: string | null;
  serviceType?: ServiceTypeInfo | null;
  scheduleSlots?: ServiceScheduleSlotRow[];
};

function getTodayIsoDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "approved":
      return "bg-green-50 text-green-700 border-green-200";
    case "pending_review":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "rejected":
    case "expired":
    case "revoked":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-gray-100 text-gray-500 border-gray-200";
  }
}

function buildHistory(approval: ServiceApprovalSheetRow) {
  const history: Array<{ label: string; value: string; detail?: string | null }> = [];
  if (approval.submittedAt) history.push({ label: "Proof submitted", value: approval.submittedAt });
  if (approval.requestedAt) history.push({ label: "Request logged", value: approval.requestedAt });
  if (approval.reviewedAt) {
    history.push({
      label: approval.effectiveStatus === "approved" ? "Approved" : approval.effectiveStatus === "rejected" ? "Rejected" : "Reviewed",
      value: approval.reviewedAt,
      detail: approval.reviewReason ?? null,
    });
  }
  if (approval.reminderSentAt) history.push({ label: "Reminder sent", value: approval.reminderSentAt });
  if (approval.expiredAt) history.push({ label: "Expired", value: approval.expiredAt });
  return history.sort((a, b) => new Date(a.value).getTime() - new Date(b.value).getTime());
}

export function ServiceApprovalDrawer({
  open,
  onOpenChange,
  mediatorId,
  serviceTypeId,
  serviceType,
  approval,
  scheduleSlots,
  autoOpenSchedulePrompt = false,
  onSchedulePromptConsumed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediatorId: string;
  serviceTypeId: string;
  serviceType?: ServiceTypeInfo | null;
  approval: ServiceApprovalSheetRow | null;
  scheduleSlots: ServiceScheduleSlotRow[];
  autoOpenSchedulePrompt?: boolean;
  onSchedulePromptConsumed?: () => void;
}) {
  const { toast } = useToast();
  const [proofLink, setProofLink] = useState("");
  const [proofFileName, setProofFileName] = useState("");
  const [proofFileData, setProofFileData] = useState("");
  const [proofMimeType, setProofMimeType] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleModalReadOnly, setScheduleModalReadOnly] = useState(false);
  const [scheduleModalNotice, setScheduleModalNotice] = useState<string | null>(null);
  const consumedAutoPromptRef = useRef<string | null>(null);
  const { data: liveScheduleSlots } = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", mediatorId, "service-approvals", serviceTypeId, "schedule-slots"],
    enabled: open && !!approval && !!serviceTypeId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const resolvedServiceType = serviceType ?? approval?.serviceType ?? null;
  const currentStatus = (approval?.effectiveStatus ?? approval?.status ?? (resolvedServiceType ? "not_requested" : "requested")).toLowerCase();
  const isApproved = currentStatus === "approved";
  const canUpload = currentStatus === "requested" || currentStatus === "rejected" || currentStatus === "expired" || currentStatus === "revoked" || currentStatus === "not_requested";
  const serviceName = resolvedServiceType?.name ?? "Service";
  const serviceCategory = resolvedServiceType?.category ?? "Service";
  const resolvedScheduleSlots = liveScheduleSlots ?? approval?.scheduleSlots ?? scheduleSlots;
  const slotCount = resolvedScheduleSlots.length;
  const history = useMemo(() => (approval ? buildHistory(approval) : []), [approval]);

  useEffect(() => {
    if (!open) {
      setProofLink("");
      setProofFileName("");
      setProofFileData("");
      setProofMimeType("");
      setExpiryDate("");
      return;
    }

    if (!approval) {
      setProofLink("");
      setProofFileName("");
      setProofFileData("");
      setProofMimeType("");
      setExpiryDate("");
      return;
    }

    setProofLink(approval.proofLink ?? "");
    setProofFileName(approval.proofFileName ?? "");
    setProofFileData("");
    setProofMimeType(approval.proofMimeType ?? "");
    setExpiryDate(approval.expiryDate ?? "");
  }, [open, approval, serviceTypeId]);

  useEffect(() => {
    if (open) return;
    setScheduleModalOpen(false);
    setScheduleModalReadOnly(false);
  }, [open]);

  useEffect(() => {
    if (!open || !approval || !autoOpenSchedulePrompt || !isApproved || slotCount > 0) return;
    if (consumedAutoPromptRef.current === approval.serviceTypeId) return;
    consumedAutoPromptRef.current = approval.serviceTypeId;
    setScheduleModalReadOnly(false);
    setScheduleModalOpen(true);
    onSchedulePromptConsumed?.();
  }, [autoOpenSchedulePrompt, approval, isApproved, open, onSchedulePromptConsumed, slotCount]);

  const saveProof = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/mediators/${mediatorId}/service-approvals/${serviceTypeId}`, {
        proofLink: proofLink.trim() || null,
        proofFileName: proofFileName || null,
        proofFileData: proofFileData || null,
        proofMimeType: proofMimeType || null,
        expiryDate: expiryDate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", mediatorId, "service-approvals"] });
      toast({ title: "Request sent", description: "The service proof was sent for admin review." });
      setProofFileData("");
    },
    onError: (e: unknown) => {
      toast({ title: "Could not send request", description: (e as Error).message, variant: "destructive" });
    },
  });

  const saveScheduleSlots = useMutation({
    mutationFn: async (rows: ServiceScheduleSlotDraft[]) => {
      if (!approval) throw new Error("No service selected");
      return saveMediatorServiceSchedule({
        mediatorId,
        serviceTypeId: approval.serviceTypeId,
        originalSlots: resolvedScheduleSlots,
        rows,
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", mediatorId, "service-schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", mediatorId, "service-approvals", approval?.serviceTypeId ?? serviceTypeId, "schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", mediatorId, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/appointments"] });
      const summary = result.preservedCount > 0
        ? `Saved with ${result.preservedCount} booked slot(s) kept in place.`
        : "The service availability slots were saved.";
      toast({ title: "Schedule saved", description: summary });
      setScheduleModalNotice(result.preservedCount > 0 ? summary : null);
      if (result.preservedCount === 0) {
        setScheduleModalOpen(false);
      }
    },
    onError: (e: unknown) => {
      toast({ title: "Could not save schedule", description: (e as Error).message, variant: "destructive" });
    },
  });

  const openScheduleModal = (readOnly: boolean) => {
    setScheduleModalReadOnly(readOnly);
    setScheduleModalOpen(true);
  };

  const handleDrawerOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setScheduleModalOpen(false);
      setScheduleModalReadOnly(false);
      setScheduleModalNotice(null);
    }
    onOpenChange(nextOpen);
  };

  if (!approval) {
    return (
      <Sheet open={open} onOpenChange={handleDrawerOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-service-approval-details">
          <SheetHeader className="space-y-2 pr-8">
            <div className="flex items-center gap-2 flex-wrap">
              <SheetTitle className="font-heading text-lg" data-testid="text-service-drawer-title">
                {serviceName}
              </SheetTitle>
              <Badge variant="outline" className="capitalize">
                Not requested
              </Badge>
            </div>
            <SheetDescription>
              {serviceCategory}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {canUpload ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[#5a7d58]" />
                  <p className="text-sm font-semibold">Proof & expiry</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1.5">
                    <Label>Supporting link</Label>
                    <Input
                      value={proofLink}
                      onChange={(e) => setProofLink(e.target.value)}
                      placeholder="Optional supporting URL"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Certificate file</Label>
                    <Input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          setProofFileName(file.name);
                          setProofFileData(String(reader.result ?? ""));
                          setProofMimeType(file.type || "application/octet-stream");
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    {proofFileName && <p className="text-xs text-muted-foreground">Selected: {proofFileName}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expiry date</Label>
                    <Input
                      type="date"
                      min={getTodayIsoDate()}
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => saveProof.mutate()}
                      disabled={saveProof.isPending}
                    >
                      {saveProof.isPending ? "Sending..." : "Send request"}
                    </Button>
                    <span className="text-xs text-muted-foreground">File or link is required to request admin review.</span>
                  </div>
                </div>
              </div>
            ) : null}

            <Accordion type="multiple" defaultValue={[]} className="space-y-3">
              <AccordionItem value="schedule" className="rounded-lg border px-4">
                <AccordionTrigger className="text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4" />
                    Schedule
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <p className="text-sm text-muted-foreground">Scheduling becomes available after admin approval.</p>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="history" className="rounded-lg border px-4">
                <AccordionTrigger className="text-sm font-semibold">
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    History
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <p className="text-sm text-muted-foreground">No request has been logged for this service yet.</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleDrawerOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-service-approval-details">
        <SheetHeader className="space-y-2 pr-8">
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="font-heading text-lg" data-testid="text-service-drawer-title">
              {serviceName}
            </SheetTitle>
            <Badge variant="outline" className={`capitalize ${getStatusBadgeClass(currentStatus)}`}>
              {formatStatusLabel(currentStatus)}
            </Badge>
          </div>
          <SheetDescription>
            {serviceCategory}
            {approval.expiryDate ? ` · Expiry ${approval.expiryDate}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {approval.reviewReason && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {currentStatus === "revoked" ? "Revocation reason" : "Rejection reason"}
              </div>
              <p className="mt-1">{approval.reviewReason}</p>
            </div>
          )}

          {canUpload ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-[#5a7d58]" />
                <p className="text-sm font-semibold">Proof & expiry</p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label>Supporting link</Label>
                  <Input
                    value={proofLink}
                    onChange={(e) => setProofLink(e.target.value)}
                    placeholder="Optional supporting URL"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Certificate file</Label>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        setProofFileName(file.name);
                        setProofFileData(String(reader.result ?? ""));
                        setProofMimeType(file.type || "application/octet-stream");
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  {proofFileName && <p className="text-xs text-muted-foreground">Selected: {proofFileName}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Expiry date</Label>
                  <Input
                    type="date"
                    min={getTodayIsoDate()}
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => saveProof.mutate()}
                    disabled={saveProof.isPending}
                  >
                    {saveProof.isPending ? "Sending..." : "Send request"}
                  </Button>
                  {approval.proofFileUrl && (
                    <a href={approval.proofFileUrl} target="_blank" rel="noreferrer" className="text-sm text-[#5a7d58] hover:underline">
                      Open uploaded file
                    </a>
                  )}
                  {approval.proofLink && !proofFileName && (
                    <a href={approval.proofLink} target="_blank" rel="noreferrer" className="text-sm text-[#5a7d58] hover:underline">
                      Open supporting link
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
              {isApproved
                ? "This service is already approved. Proof controls are hidden."
                : "This service is pending review. Proof controls will reappear if the service is rejected or expires."}
            </div>
          )}

          <Accordion type="multiple" defaultValue={slotCount > 0 ? ["schedule", "history"] : ["schedule", "history"]} className="space-y-3">
            <AccordionItem value="schedule" className="rounded-lg border px-4">
              <AccordionTrigger className="text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  Schedule
                </span>
                <Badge variant={slotCount > 0 ? "outline" : "secondary"} className="ml-2">
                  {slotCount} slot{slotCount !== 1 ? "s" : ""}
                </Badge>
              </AccordionTrigger>
              <AccordionContent className="pb-4 space-y-3">
                {isApproved ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Add one or more availability slots for this service. Each slot becomes its own connected calendar event.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openScheduleModal(false)}
                      >
                        {slotCount > 0 ? "Edit schedule" : "Set schedule"}
                      </Button>
                      {slotCount === 0 ? (
                        <Badge variant="secondary">Schedule required</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">{slotCount} slot{slotCount !== 1 ? "s" : ""} captured</span>
                      )}
                    </div>
                    {slotCount > 0 ? (
                      <div className="space-y-2">
                        {resolvedScheduleSlots.map((slot, idx) => {
                          const start = getUkWallClockDateTimeParts(slot.startAt);
                          const end = getUkWallClockDateTimeParts(slot.endAt);
                          return (
                            <div key={slot.id} className="rounded-md border bg-background p-3 text-sm">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium">Slot {idx + 1}</p>
                                <Badge variant="outline">{start.date}</Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                <div>Start: {start.time}</div>
                                <div>End: {end.time}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No availability has been set yet.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Scheduling opens once the service is approved by admin.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="history" className="rounded-lg border px-4">
              <AccordionTrigger className="text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  History
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No history captured yet.</p>
                ) : (
                  <div className="space-y-3">
                    {history.map((item) => (
                      <div key={`${item.label}-${item.value}`} className="rounded-md border bg-background p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{item.label}</p>
                          <span className="text-xs text-muted-foreground">{formatDateTime(item.value)}</span>
                        </div>
                        {item.detail && <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <Separator className="my-5" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Status updates and schedule changes are saved per service.
          </div>
          <Button type="button" variant="ghost" onClick={() => handleDrawerOpenChange(false)}>
            Close
          </Button>
        </div>

        <ServiceScheduleModal
          open={scheduleModalOpen}
          onOpenChange={(nextOpen) => {
            setScheduleModalOpen(nextOpen);
            if (!nextOpen) {
              setScheduleModalReadOnly(false);
              setScheduleModalNotice(null);
            }
          }}
          service={approval.serviceType ? { id: approval.serviceType.id, name: approval.serviceType.name, category: approval.serviceType.category } : null}
          slots={resolvedScheduleSlots}
          isSaving={saveScheduleSlots.isPending}
          readOnly={scheduleModalReadOnly}
          notice={scheduleModalNotice}
          onSave={(rows) => {
            if (!approval) return;
            saveScheduleSlots.mutate(rows);
          }}
          />
      </SheetContent>
    </Sheet>
  );
}
