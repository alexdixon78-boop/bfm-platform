import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, Trash2 } from "lucide-react";
import type { ServiceType } from "@shared/schema";
import { getUkWallClockDateTimeParts } from "@/lib/date-time";

export type ServiceScheduleSlotDraft = {
  id?: string;
  date: string;
  startTime: string;
  endTime: string;
  preserveOnly?: boolean;
  unsupportedReason?: string;
  availabilitySourceId?: string | null;
  availabilityOrigin?: string | null;
  availabilityScopeMode?: string | null;
};

export type ServiceScheduleSlotRow = {
  id: string;
  serviceTypeId: string;
  startAt: string;
  endAt: string;
  availabilitySourceId?: string | null;
  availabilityOrigin?: string | null;
  availabilityScopeMode?: string | null;
};

function combineDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

function hasOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function getTodayIsoDate(): string {
  return getUkWallClockDateTimeParts(new Date()).date;
}

function isHistoricalSlot(row: ServiceScheduleSlotDraft): boolean {
  return !!row.id && !!row.date && row.date < getTodayIsoDate();
}

export function ServiceScheduleModal({
  open,
  onOpenChange,
  service,
  slots,
  isSaving,
  readOnly = false,
  notice = null,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Pick<ServiceType, "id" | "name" | "category"> | null;
  slots: ServiceScheduleSlotRow[];
  isSaving: boolean;
  readOnly?: boolean;
  notice?: string | null;
  onSave: (rows: ServiceScheduleSlotDraft[]) => void;
}) {
  const [rows, setRows] = useState<ServiceScheduleSlotDraft[]>([]);

  useEffect(() => {
    if (!open) return;
    if (slots.length > 0) {
      setRows(slots.map((slot) => {
        const start = getUkWallClockDateTimeParts(slot.startAt);
        const end = getUkWallClockDateTimeParts(slot.endAt);
        const unsupportedReason = start.date !== end.date || end.time <= start.time
          ? "Overnight availability is not supported in this editor. This saved slot will be kept unchanged."
          : undefined;
        return {
          id: slot.id,
          date: start.date,
          startTime: start.time,
          endTime: end.time,
          preserveOnly: !!unsupportedReason,
          unsupportedReason,
          availabilitySourceId: slot.availabilitySourceId ?? null,
          availabilityOrigin: slot.availabilityOrigin ?? null,
          availabilityScopeMode: slot.availabilityScopeMode ?? null,
        };
      }));
      return;
    }
    setRows([]);
  }, [open, readOnly, slots]);

  const validation = useMemo(() => {
    if (readOnly) return "";
    if (rows.length === 0) return "";
    const editableRows = rows.filter((row) => !row.unsupportedReason);
    if (editableRows.length === 0) return "";
    const parsed = editableRows.map((row, index) => {
      if (!row.date || !row.startTime || !row.endTime) return { index, valid: false as const, reason: "Complete every slot." };
      const start = combineDateTime(row.date, row.startTime);
      const end = combineDateTime(row.date, row.endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { index, valid: false as const, reason: "Invalid date or time." };
      }
      if (end <= start) {
        return { index, valid: false as const, reason: "End time must be after start time." };
      }
      return { index, valid: true as const, start, end };
    });
    const bad = parsed.find((row) => !row.valid);
    if (bad && "reason" in bad) return bad.reason;
    const validRows = parsed.filter((row): row is { index: number; valid: true; start: Date; end: Date } => row.valid);
    const ordered = [...validRows].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < ordered.length; i++) {
      if (hasOverlap(ordered[i - 1].start, ordered[i - 1].end, ordered[i].start, ordered[i].end)) {
        return "Slots on the same service cannot overlap.";
      }
    }
    return "";
  }, [readOnly, rows]);

  const addRow = () => {
    const editableRows = rows.filter((row) => !row.unsupportedReason);
    const last = editableRows[editableRows.length - 1];
    const date = last?.date || getTodayIsoDate();
    setRows((prev) => [...prev, { date, startTime: "09:00", endTime: "10:00" }]);
  };

  const updateRow = (index: number, patch: Partial<ServiceScheduleSlotDraft>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    const row = rows[index];
    if (row?.availabilityOrigin === "mediator_invite" && row.availabilityScopeMode === "all_approved_services") {
      const confirmed = window.confirm("Delete this calendar availability? This will remove it from every approved service. Existing appointments will stay unchanged.");
      if (!confirmed) return;
    }
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(rows);
  };

  const editableRowsNewestFirst = rows.map((row, index) => ({ row, index })).reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto pb-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#5a7d58]" />
            {service?.name ?? "Service schedule"}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "View the saved availability slots for this service."
              : "Add one or more availability slots for this service. Each slot becomes its own connected calendar event."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{service?.category ?? "Service"}</Badge>
          {!slots.length && <Badge variant="secondary">{readOnly ? "No availability yet" : "Schedule required"}</Badge>}
        </div>

        {notice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {notice}
          </div>
        )}

        {readOnly ? (
          <div className="space-y-2">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No availability has been set for this service yet.</p>
            ) : (
              rows.map((row, index) => (
                <div key={row.id ?? `${row.date}-${index}`} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Slot {index + 1}</p>
                    <Badge variant="outline">{row.date}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-background p-2 border">
                      <span className="block text-xs text-muted-foreground">Start</span>
                      <span>{row.startTime}</span>
                    </div>
                    <div className="rounded-md bg-background p-2 border">
                      <span className="block text-xs text-muted-foreground">End</span>
                      <span>{row.endTime}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Availability slots</p>
                <p className="text-xs text-muted-foreground">Newest slots appear first.</p>
              </div>
              <Button type="button" variant="outline" onClick={addRow} data-testid="button-add-service-schedule-slot">
                <Plus className="mr-1.5 h-4 w-4" />
                Add slot
              </Button>
            </div>
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
                No slots are set for this service yet. Add a slot, or save now to clear any unbooked calendar events.
              </div>
            ) : (
              <div className="space-y-3" data-testid="service-schedule-editable-slots">
                {editableRowsNewestFirst.map(({ row, index }) => (
                  <div key={row.id ?? `${row.date}-${index}`} className="rounded-lg border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">Slot {index + 1}</p>
                        {isHistoricalSlot(row) && <Badge variant="secondary">History</Badge>}
                        {row.unsupportedReason && <Badge variant="secondary">Kept unchanged</Badge>}
                        {row.availabilityOrigin === "mediator_invite" && <Badge variant="outline">Shared across approved services</Badge>}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(index)}
                        disabled={isHistoricalSlot(row) || row.preserveOnly}
                        title={row.unsupportedReason || (isHistoricalSlot(row) ? "Historical booked slots are kept in place." : "Remove slot")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {row.unsupportedReason && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {row.unsupportedReason}
                      </div>
                    )}
                    {row.availabilityOrigin === "mediator_invite" && (
                      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                        Changing this time updates the connected calendar event and every approved service.
                      </div>
                    )}
                    {isHistoricalSlot(row) && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Historical booked slot kept for case, payment, and booking history.
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Date</Label>
                        <Input
                          type="date"
                          min={getTodayIsoDate()}
                          value={row.date}
                          onChange={(e) => updateRow(index, { date: e.target.value })}
                          disabled={isHistoricalSlot(row) || row.preserveOnly}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Start time</Label>
                        <Input
                          type="time"
                          value={row.startTime}
                          onChange={(e) => updateRow(index, { startTime: e.target.value })}
                          disabled={isHistoricalSlot(row) || row.preserveOnly}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">End time</Label>
                        <Input
                          type="time"
                          value={row.endTime}
                          onChange={(e) => updateRow(index, { endTime: e.target.value })}
                          disabled={isHistoricalSlot(row) || row.preserveOnly}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {validation && <p className="text-sm text-destructive">{validation}</p>}

        <div className="sticky bottom-0 -mx-6 mt-2 border-t bg-background/95 px-6 py-4 backdrop-blur" data-testid="service-schedule-sticky-footer">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {!readOnly && (
              <Button type="button" onClick={handleSave} disabled={!!validation || isSaving}>
                {isSaving ? "Saving..." : "Save schedule"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
