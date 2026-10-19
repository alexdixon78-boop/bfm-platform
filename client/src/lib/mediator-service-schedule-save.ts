import { apiRequest } from "@/lib/queryClient";
import { getUkWallClockDateTimeParts } from "@/lib/date-time";
import type { ServiceScheduleSlotDraft, ServiceScheduleSlotRow } from "@/components/mediator-service-schedule-modal";

type ScheduleSaveResult = {
  deletedCount: number;
  preservedCount: number;
  createdCount: number;
  updatedCount: number;
  rows: ServiceScheduleSlotRow[];
};

export async function saveMediatorServiceSchedule(input: {
  mediatorId: string;
  serviceTypeId: string;
  originalSlots: ServiceScheduleSlotRow[];
  rows: ServiceScheduleSlotDraft[];
}): Promise<ScheduleSaveResult> {
  const genericOriginals = input.originalSlots.filter((slot) =>
    slot.availabilitySourceId && slot.availabilityOrigin === "mediator_invite" && slot.availabilityScopeMode === "all_approved_services",
  );
  const handledSources = new Set<string>();
  for (const original of genericOriginals) {
    const sourceId = original.availabilitySourceId!;
    if (handledSources.has(sourceId)) continue;
    handledSources.add(sourceId);
    const draft = input.rows.find((row) => row.availabilitySourceId === sourceId);
    if (!draft) {
      await apiRequest("DELETE", `/api/mediators/${input.mediatorId}/calendar-availability-sources/${sourceId}`);
      continue;
    }
    const originalStart = getUkWallClockDateTimeParts(original.startAt);
    const originalEnd = getUkWallClockDateTimeParts(original.endAt);
    if (draft.date !== originalStart.date || draft.startTime !== originalStart.time || draft.endTime !== originalEnd.time) {
      await apiRequest("PATCH", `/api/mediators/${input.mediatorId}/calendar-availability-sources/${sourceId}`, {
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
      });
    }
  }

  const legacyRows = input.rows.filter((row) => row.availabilityOrigin !== "mediator_invite");
  const response = await apiRequest("PUT", `/api/mediators/${input.mediatorId}/service-approvals/${input.serviceTypeId}/schedule-slots`, {
    groupedSourceAware: true,
    slots: legacyRows.map((row) => ({
      id: row.id ?? null,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      preserveOnly: row.preserveOnly ?? false,
    })),
  });
  return await response.json() as ScheduleSaveResult;
}
