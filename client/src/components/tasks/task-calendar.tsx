import { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DateSelectArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, CalendarPlus, CheckCircle2, Clock, ExternalLink, Loader2, RefreshCw, UserRound, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildCalendarTaskScheduleUpdate,
  canChangeTaskStatus,
  canCancelTask,
  canOpenTaskSchedule,
  calendarEventFromTask,
  getTaskStatusTransitions,
  londonWallTimeToIso,
  scheduleFromCalendarSelection,
  selectActiveTaskAssigneeIds,
  taskUrgencyAccentClass,
  taskUrgencyLabel,
  type TaskStatusValue,
} from "./task-calendar-utils";

export type TaskScheduleDto = {
  active: boolean;
  kind: "timed" | "all_day";
  startAt?: string | null;
  endAt?: string | null;
  allDayStart?: string | null;
  allDayEndExclusive?: string | null;
  reminderMinutes?: number | null;
  syncStatus?: "pending" | "succeeded" | "failed";
  lastSyncErrorMessage?: string | null;
};

export type CalendarTaskDto = {
  id: string;
  type: string;
  title: string;
  message: string;
  urgency: string;
  status: string;
  caseId?: string | null;
  caseReference?: string | null;
  audience?: string;
  caseNoteRequired?: boolean;
  followUpDate?: string | Date | null;
  assignedUserIds?: string[];
  assignedTo?: string | null;
  schedule?: TaskScheduleDto | null;
  seriesId?: string | null;
  occurrenceDate?: string | null;
  series?: { frequency: "daily" | "weekly" | "monthly"; endDate: string | null; active: boolean } | null;
  assignees?: { id: string; name: string }[];
  actionHref?: string;
  actionLabel?: string;
  createdAt?: string | Date;
  createdByName?: string | null;
  completedAt?: string | Date | null;
  completedByName?: string | null;
  completionNotes?: string | null;
  cancelledAt?: string | Date | null;
  cancelledByName?: string | null;
  cancellationReason?: string | null;
};

type StaffUser = { id: string; name: string; role: string; email?: string; caseRole?: string };
type TaskCaseOption = { id: string; caseRef: string; hasLeadMediator: boolean; clients: { name: string; email: string | null }[]; mediators: { id: string; name: string; email: string; caseRole: string }[] };
type TaskSeriesOption = { id: string; title: string; message: string; urgency: string; caseId: string | null; frequency: "daily" | "weekly" | "monthly"; endDate: string | null; assigneeIds: string[] };
type SchedulePayload =
  | { kind: "timed"; startAt: string; endAt: string; reminderMinutes: number | null }
  | { kind: "all_day"; startDate: string; endDateExclusive: string; reminderMinutes: number | null };

type CalendarPayload = {
  events: CalendarTaskDto[];
  unscheduled: CalendarTaskDto[];
  selectedTask?: CalendarTaskDto | null;
  syncHealth: { status: string; accountEmail: string | null; lastError: string | null };
};

const reminderOptions = [
  { value: "none", label: "None" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "1440", label: "1 day" },
  { value: "10080", label: "1 week" },
];

function toLocalInput(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date).replace(" ", "T");
}

function formatLondon(value?: string | Date | null, includeTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function ScheduleFields(props: {
  kind: "timed" | "all_day";
  setKind: (value: "timed" | "all_day") => void;
  start: string;
  setStart: (value: string) => void;
  end: string;
  setEnd: (value: string) => void;
  reminder: string;
  setReminder: (value: string) => void;
}) {
  return <div className="space-y-3 rounded-lg border p-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium">Calendar schedule</p>
      <Select value={props.kind} onValueChange={(value) => props.setKind(value as "timed" | "all_day")}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="timed">Timed</SelectItem><SelectItem value="all_day">All day</SelectItem></SelectContent>
      </Select>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><label className="mb-1 block text-xs text-muted-foreground">Starts</label><Input type={props.kind === "timed" ? "datetime-local" : "date"} value={props.start} onChange={(event) => props.setStart(event.target.value)} /></div>
      <div><label className="mb-1 block text-xs text-muted-foreground">Ends {props.kind === "all_day" && "(exclusive)"}</label><Input type={props.kind === "timed" ? "datetime-local" : "date"} value={props.end} onChange={(event) => props.setEnd(event.target.value)} /></div>
    </div>
    <div><label className="mb-1 block text-xs text-muted-foreground">Reminder</label><Select value={props.reminder} onValueChange={props.setReminder}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{reminderOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
    <p className="text-xs text-muted-foreground">Times are interpreted and shown in Europe/London.</p>
  </div>;
}

function AssigneePicker({ people, selectedIds, onChange }: {
  people: StaffUser[]; selectedIds: string[]; onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = people.filter((person) => `${person.name} ${person.email || ""} ${person.role}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-2"><p className="text-sm font-medium">Assignees</p>
    <Popover><PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start text-left font-normal">{selectedIds.length ? `${selectedIds.length} selected: ${selectedIds.map((id) => people.find((person) => person.id === id)?.name || id).join(", ")}` : "Search and select assignees"}</Button></PopoverTrigger>
      <PopoverContent className="w-[min(420px,90vw)] p-2" align="start"><Input aria-label="Search assignees" placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="mt-2 max-h-56 overflow-y-auto">{visible.map((person) => <label key={person.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-muted"><Checkbox checked={selectedIds.includes(person.id)} onCheckedChange={() => onChange(selectedIds.includes(person.id) ? selectedIds.filter((id) => id !== person.id) : [...selectedIds, person.id])} /><span>{person.name} <span className="text-muted-foreground">({person.caseRole?.replaceAll("_", " ") || person.role})</span>{person.email && <span className="block text-xs text-muted-foreground">{person.email}</span>}</span></label>)}{visible.length === 0 && <p className="p-2 text-sm text-muted-foreground">No matching assignees</p>}</div>
      </PopoverContent></Popover>
  </div>;
}

export function TaskCalendar({
  staffUsers = [], userId, userRole, canView, canEdit, queryString, onStatusChange,
}: {
  staffUsers?: StaffUser[];
  userId: string;
  userRole: string;
  canView: boolean;
  canEdit: boolean;
  queryString: string;
  onStatusChange: (task: CalendarTaskDto, status: TaskStatusValue) => void;
}) {
  const { toast } = useToast();
  const canAssign = canEdit && (userRole === "superadmin" || userRole === "subadmin");
  const canCreate = canAssign;
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailsTask, setDetailsTask] = useState<CalendarTaskDto | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelScope, setCancelScope] = useState<"occurrence" | "future">("occurrence");
  const [cancellationReason, setCancellationReason] = useState("");
  const [editingTask, setEditingTask] = useState<CalendarTaskDto | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("green");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [debouncedCaseSearch, setDebouncedCaseSearch] = useState("");
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [frequency, setFrequency] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [editScope, setEditScope] = useState<"one" | "future">("one");
  const [kind, setKind] = useState<"timed" | "all_day">("timed");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reminder, setReminder] = useState("30");
  const isSuperadmin = userRole === "superadmin";
  const { data: availableAssignees = [] } = useQuery<StaffUser[]>({ queryKey: ["/api/tasks/assignees"], enabled: canCreate });
  const { data: selectedCase } = useQuery<TaskCaseOption>({
    queryKey: ["/api/tasks/case-options", selectedCaseId], enabled: isSuperadmin && !!selectedCaseId,
    queryFn: async () => { const response = await fetch(`/api/tasks/case-options/${selectedCaseId}`, { credentials: "include" }); if (!response.ok) throw new Error("Case is unavailable"); return response.json(); },
  });
  const { data: editingSeries } = useQuery<TaskSeriesOption>({
    queryKey: ["/api/task-series", editingTask?.seriesId], enabled: isSuperadmin && editorOpen && !!editingTask?.seriesId,
    queryFn: async () => { const response = await fetch(`/api/task-series/${editingTask!.seriesId}`, { credentials: "include" }); if (!response.ok) throw new Error("Task series is unavailable"); return response.json(); },
  });
  useEffect(() => {
    if (!editingTask?.seriesId || !editingSeries || !editorOpen) return;
    if (editScope === "future") {
      setTitle(editingSeries.title); setMessage(editingSeries.message); setPriority(editingSeries.urgency);
      setSelectedCaseId(editingSeries.caseId); setAssigneeIds(editingSeries.assigneeIds);
      setFrequency(editingSeries.frequency); setRepeatEndDate(editingSeries.endDate || "");
    } else {
      setTitle(editingTask.title); setMessage(editingTask.message); setPriority(editingTask.urgency);
      setSelectedCaseId(editingTask.caseId || null); setAssigneeIds(editingTask.assignedUserIds || []);
    }
  }, [editScope, editingSeries, editingTask, editorOpen]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedCaseSearch(caseSearch.trim()), 250); return () => clearTimeout(timer); }, [caseSearch]);
  const { data: caseResults = [] } = useQuery<TaskCaseOption[]>({
    queryKey: ["/api/tasks/case-search", debouncedCaseSearch], enabled: isSuperadmin && casePickerOpen && debouncedCaseSearch.length >= 2,
    queryFn: async () => { const response = await fetch(`/api/tasks/case-search?q=${encodeURIComponent(debouncedCaseSearch)}`, { credentials: "include" }); if (!response.ok) throw new Error("Case search failed"); return response.json(); },
  });
  const people = availableAssignees.length ? availableAssignees : staffUsers;
  const selectablePeople = selectedCaseId && selectedCase
    ? people.filter((person) => selectedCase.mediators.some((mediator) => mediator.id === person.id) || (person.id === userId && person.role === "superadmin" && !selectedCase.hasLeadMediator)).map((person) => ({ ...person, caseRole: selectedCase.mediators.find((mediator) => mediator.id === person.id)?.caseRole }))
    : selectedCaseId ? [] : people;
  const invalidMediatorIds = selectedCaseId && selectedCase ? assigneeIds.filter((id) => !selectablePeople.some((person) => person.id === id)) : [];
  const selectedActiveAssigneeIds = selectActiveTaskAssigneeIds({ assignedUserIds: assigneeIds, activeUsers: people });

  const params = new URLSearchParams();
  if (range) { params.set("start", range.start); params.set("end", range.end); }
  new URLSearchParams(queryString).forEach((value, key) => params.append(key, value));
  const selectedCaseFilter = new URLSearchParams(queryString).get("caseId");
  const selectedTaskId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("taskId") : null;
  if (selectedTaskId) params.set("taskId", selectedTaskId);

  const { data, isLoading, error } = useQuery<CalendarPayload>({
    queryKey: ["/api/tasks/calendar", range, queryString],
    enabled: !!range,
    queryFn: async () => {
      const response = await fetch(`/api/tasks/calendar?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "Could not load task calendar");
      return response.json();
    },
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/counts"] }),
    ]);
  };

  const schedulePayload = (): SchedulePayload => {
    const reminderMinutes = reminder === "none" ? null : Number(reminder);
    if (!start || !end) throw new Error("Choose both a start and an end");
    return kind === "timed"
      ? { kind, startAt: londonWallTimeToIso(start), endAt: londonWallTimeToIso(end), reminderMinutes }
      : { kind, startDate: start, endDateExclusive: end, reminderMinutes };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const schedule = schedulePayload();
      const input = { title, message, urgency: priority, caseId: isSuperadmin ? selectedCaseId : null, assignedUserIds: assigneeIds, schedule };
      if (editingTask && isSuperadmin && editingTask.type === "task") {
        if (editingTask.seriesId && editScope === "future") return apiRequest("PATCH", `/api/task-series/${editingTask.seriesId}/future`, {
          ...input, frequency, endDate: repeatEndDate || null, fromDate: editingTask.occurrenceDate,
        }).then((response) => response.json());
        return apiRequest("PATCH", `/api/tasks/${editingTask.id}/manual`, input).then((response) => response.json());
      }
      if (editingTask) {
        const update = buildCalendarTaskScheduleUpdate({ schedule, canAssign, assignedUserIds: selectedActiveAssigneeIds });
        return apiRequest("PATCH", `/api/tasks/${editingTask.id}`, update).then((response) => response.json());
      }
      if (frequency !== "none" && isSuperadmin) return apiRequest("POST", "/api/task-series", { ...input, frequency, endDate: repeatEndDate || null }).then((response) => response.json());
      return apiRequest("POST", "/api/tasks/batch", input).then((response) => response.json());
    },
    onSuccess: async () => { setEditorOpen(false); await refresh(); toast({ title: editingTask ? "Task scheduled" : "Task created" }); },
    onError: (mutationError: Error) => toast({ title: "Calendar update failed", description: mutationError.message, variant: "destructive" }),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ taskId, schedule }: { taskId: string; schedule: SchedulePayload }) => apiRequest("PATCH", `/api/tasks/${taskId}`, { schedule }),
    onSuccess: refresh,
    onError: (mutationError: Error) => toast({ title: "Schedule could not be changed", description: mutationError.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: async (taskId: string) => apiRequest("POST", `/api/tasks/${taskId}/calendar-sync/retry`),
    onSuccess: refresh,
    onError: (mutationError: Error) => toast({ title: "Retry failed", description: mutationError.message, variant: "destructive" }),
  });
  const cancelMutation = useMutation({
    mutationFn: async ({ taskId, scope, reason }: { taskId: string; scope: "occurrence" | "future"; reason: string }) => apiRequest("POST", `/api/tasks/${taskId}/cancel`, { scope, reason }),
    onSuccess: async () => { setCancelDialogOpen(false); setDetailsTask(null); putTaskInUrl(null); await refresh(); toast({ title: cancelScope === "future" ? "This and future occurrences cancelled" : "Task cancelled" }); },
    onError: (error: Error) => toast({ title: "Could not cancel task", description: error.message, variant: "destructive" }),
  });

  const events = useMemo(() => (data?.events ?? []).map(calendarEventFromTask).filter(Boolean) as any[], [data?.events]);

  const putTaskInUrl = (taskId: string | null) => {
    const url = new URL(window.location.href);
    if (taskId) url.searchParams.set("taskId", taskId); else url.searchParams.delete("taskId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  useEffect(() => {
    const selectedId = new URLSearchParams(window.location.search).get("taskId");
    if (!selectedId || !data) return;
    const selected = data.selectedTask ?? [...data.events, ...data.unscheduled].find((task) => task.id === selectedId);
    if (selected) setDetailsTask(selected);
  }, [data]);

  const openForSelection = (selection: DateSelectArg) => {
    if (!canCreate) return;
    const schedule = scheduleFromCalendarSelection(selection);
    setEditingTask(null); setTitle(""); setMessage(""); setPriority("green"); setAssigneeIds([]); setSelectedCaseId(isSuperadmin ? selectedCaseFilter : null); setFrequency("none"); setRepeatEndDate(""); setEditScope("one");
    setKind(schedule.kind);
    if (schedule.kind === "timed") { setStart(toLocalInput(schedule.startAt)); setEnd(toLocalInput(schedule.endAt)); setReminder("30"); }
    else { setStart(schedule.startDate); setEnd(schedule.endDateExclusive); setReminder("1440"); }
    setEditorOpen(true);
  };

  const openNewTask = () => {
    const now = new Date();
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    setEditingTask(null); setTitle(""); setMessage(""); setPriority("green"); setAssigneeIds([]); setSelectedCaseId(isSuperadmin ? selectedCaseFilter : null); setFrequency("none"); setRepeatEndDate(""); setEditScope("one");
    setKind("timed"); setStart(toLocalInput(now)); setEnd(toLocalInput(later)); setReminder("30"); setEditorOpen(true);
  };

  const openSchedule = (task: CalendarTaskDto) => {
    setEditingTask(task); setTitle(task.title); setMessage(task.message); setPriority(task.urgency); setAssigneeIds(task.assignedUserIds ?? (task.assignedTo ? [task.assignedTo] : []));
    setSelectedCaseId(task.caseId || null); setFrequency(task.series?.frequency || "none"); setRepeatEndDate(task.series?.endDate || ""); setEditScope("one");
    setKind(task.schedule?.kind || "timed");
    const now = new Date();
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    if (task.schedule?.kind === "all_day") { setStart(task.schedule.allDayStart || ""); setEnd(task.schedule.allDayEndExclusive || ""); }
    else { setStart(toLocalInput(task.schedule?.startAt || now)); setEnd(toLocalInput(task.schedule?.endAt || later)); }
    setReminder(task.schedule?.reminderMinutes == null ? "none" : String(task.schedule.reminderMinutes)); setEditorOpen(true);
  };

  const movedSchedule = (event: EventDropArg["event"]): SchedulePayload => event.allDay
    ? { kind: "all_day", startDate: event.startStr.slice(0, 10), endDateExclusive: (event.endStr || event.startStr).slice(0, 10), reminderMinutes: (event.extendedProps.task as CalendarTaskDto).schedule?.reminderMinutes ?? 1440 }
    : { kind: "timed", startAt: event.start!.toISOString(), endAt: (event.end ?? new Date(event.start!.getTime() + 60 * 60 * 1000)).toISOString(), reminderMinutes: (event.extendedProps.task as CalendarTaskDto).schedule?.reminderMinutes ?? 30 };

  const handleMove = (info: EventDropArg | EventResizeDoneArg) => {
    moveMutation.mutate({ taskId: info.event.id, schedule: movedSchedule(info.event) }, { onError: () => info.revert() });
  };

  const syncWarningTitle = data?.syncHealth.status === "needs_reauth"
    ? "Google task sync needs reconnection"
    : data?.syncHealth.status === "needs_write_scope"
      ? "Google task sync needs calendar permission"
      : "Google task sync is not ready";
  const syncWarningDescription = data?.syncHealth.status === "needs_write_scope"
    ? "CRM schedules remain saved. A Superadmin must reconnect the shared BFM Google account and approve calendar event access."
    : "CRM schedules remain saved and will sync when a Superadmin reconnects the shared BFM Google account. Client booking also requires this shared connection.";

  const clickEvent = (info: EventClickArg) => {
    const task = info.event.extendedProps.task as CalendarTaskDto;
    setDetailsTask(task); putTaskInUrl(task.id);
  };

  const canChangeStatus = (task: CalendarTaskDto) => canChangeTaskStatus({
    canViewCases: canView,
    canEditCases: canEdit,
    userRole,
    userId,
    assignedUserIds: task.assignedUserIds ?? (task.assignedTo ? [task.assignedTo] : []),
    taskType: task.type,
  });

  const canCancel = (task: CalendarTaskDto) => canCancelTask({ userRole, canEditCases: canEdit, audience: task.audience, status: task.status });

  const openCancellation = (task: CalendarTaskDto, scope: "occurrence" | "future") => {
    setDetailsTask(task); setCancelScope(scope); setCancellationReason(""); setCancelDialogOpen(true);
  };

  const requestStatusChange = (task: CalendarTaskDto, nextStatus: TaskStatusValue) => {
    onStatusChange(task, nextStatus);
    if (detailsTask?.id === task.id) {
      setDetailsTask(null);
      putTaskInUrl(null);
    }
  };

  const editingTaskWasUnassigned = !!editingTask
    && (editingTask.assignedUserIds?.length ?? (editingTask.assignedTo ? 1 : 0)) === 0;
  const saveDisabled = saveMutation.isPending
    || (!editingTask && (!title.trim() || !message.trim() || assigneeIds.length === 0))
    || (!!editingTask && canAssign && selectedActiveAssigneeIds.length === 0)
    || (!!editingTask && isSuperadmin && editingTask.type === "task" && editScope === "one" && assigneeIds.length !== 1)
    || (!!editingTask?.seriesId && editScope === "future" && (!editingSeries || frequency === "none"))
    || !!invalidMediatorIds.length || (isSuperadmin && !!selectedCaseId && !selectedCase);

  return <div className="task-calendar-view space-y-4" data-testid="task-calendar-view">
    {canCreate && <div className="flex justify-end"><Button onClick={openNewTask}><CalendarPlus className="mr-1.5 h-4 w-4" />New task</Button></div>}
    {data && data.syncHealth.status !== "ready" && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>{syncWarningTitle}</AlertTitle><AlertDescription>{syncWarningDescription}</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Calendar unavailable</AlertTitle><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Card className="overflow-hidden"><CardContent className="p-3 md:p-5">
        {isLoading && <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading calendar…</div>}
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView={window.matchMedia("(max-width: 640px)").matches ? "listDay" : "dayGridMonth"}
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listDay" }}
          buttonText={{ month: "Month", week: "Week", day: "Day", list: "Agenda" }}
          timeZone="Europe/London"
          selectable={canCreate}
          editable={canEdit}
          events={events}
          eventClassNames={(info) => ["task-calendar-event", taskUrgencyAccentClass(info.event.extendedProps.task.urgency)]}
          eventDidMount={(info) => { info.el.setAttribute("title", info.event.title); }}
          select={openForSelection}
          eventClick={clickEvent}
          eventDrop={handleMove}
          eventResize={handleMove}
          datesSet={(dateInfo) => setRange({ start: dateInfo.start.toISOString(), end: dateInfo.end.toISOString() })}
          height="auto"
          nowIndicator
        />
      </CardContent></Card>
      <Card><CardHeader className="pb-3"><CardTitle className="text-base">Unscheduled tasks</CardTitle></CardHeader><CardContent className="space-y-2">
        {(data?.unscheduled ?? []).slice(0, 20).map((task) => {
          const statusTransitions = canChangeStatus(task) ? getTaskStatusTransitions(task.status) : [];
          return <div key={task.id} className={`task-calendar-unscheduled ${taskUrgencyAccentClass(task.urgency)} rounded-md p-3`}>
            <div className="mb-2"><div><p className="text-sm font-medium leading-tight">{task.title}</p><p className="text-xs text-muted-foreground">{taskUrgencyLabel(task.urgency)} priority</p></div></div>
            {canEdit && <Button size="sm" variant="outline" className="w-full" onClick={() => openSchedule(task)} disabled={!canOpenTaskSchedule({ canEdit, userRole, assigneeCount: task.assignedUserIds?.length ?? (task.assignedTo ? 1 : 0) })}><CalendarPlus className="mr-1.5 h-3.5 w-3.5" />Schedule</Button>}
            {statusTransitions.length > 0 && <div className="mt-2 flex gap-2">
              {statusTransitions.includes("in_progress") && <Button size="sm" variant="secondary" className="flex-1" onClick={() => requestStatusChange(task, "in_progress")}><Clock className="mr-1.5 h-3.5 w-3.5" />Start task</Button>}
              {statusTransitions.includes("completed") && <Button size="sm" variant="secondary" className="flex-1" onClick={() => requestStatusChange(task, "completed")}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Complete task</Button>}
            </div>}
            {(task.assignedUserIds?.length ?? (task.assignedTo ? 1 : 0)) === 0 && <p className="mt-1 text-[11px] text-muted-foreground">{canAssign ? "Choose an owner in the scheduling dialog." : "Assign an owner first."}</p>}
          </div>;
        })}
        {(data?.unscheduled.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No unscheduled tasks.</p>}
      </CardContent></Card>
    </div>

    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{editingTask ? (isSuperadmin && editingTask.type === "task" ? "Edit task" : "Schedule task") : "Create task"}</DialogTitle><DialogDescription>{editingTask ? editingTask.title : "Create a separate task for every selected assignee."}</DialogDescription></DialogHeader><div className="max-h-[65vh] space-y-4 overflow-y-auto py-1">
      {(!editingTask || (isSuperadmin && editingTask.type === "task")) && <><div><label className="mb-1 block text-sm font-medium">Title</label><Input value={title} onChange={(event) => setTitle(event.target.value)} /></div><div><label className="mb-1 block text-sm font-medium">Details</label><Textarea value={message} onChange={(event) => setMessage(event.target.value)} /></div><div><label className="mb-1 block text-sm font-medium">Urgency</label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="red">High</SelectItem><SelectItem value="amber">Medium</SelectItem><SelectItem value="green">Low</SelectItem></SelectContent></Select></div></>}
      {isSuperadmin && (!editingTask || editingTask.type === "task") && <div className="space-y-2"><p className="text-sm font-medium">Case (optional)</p><Popover open={casePickerOpen} onOpenChange={setCasePickerOpen}><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal">{selectedCase?.caseRef || "Search cases"}</Button></PopoverTrigger><PopoverContent className="w-[min(460px,90vw)] p-2" align="start"><Input aria-label="Search cases" placeholder="Case ref, client name/email, mediator email" value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} /><div className="mt-2 max-h-56 overflow-y-auto">{caseResults.map((item) => <button type="button" key={item.id} className="block w-full rounded p-2 text-left text-sm hover:bg-muted" onClick={() => { setSelectedCaseId(item.id); setCasePickerOpen(false); }}>{item.caseRef}<span className="block text-xs text-muted-foreground">{item.clients.map((client) => `${client.name} (${client.email || "no email"})`).join("; ")}</span></button>)}{debouncedCaseSearch.length < 2 && <p className="p-2 text-xs text-muted-foreground">Enter at least two characters.</p>}</div></PopoverContent></Popover>{selectedCaseId && <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedCaseId(null)}>Remove case</Button>}</div>}
      {(!editingTask || canAssign) && <AssigneePicker people={selectablePeople} selectedIds={assigneeIds} onChange={setAssigneeIds} />}
      {!!invalidMediatorIds.length && <p role="alert" className="text-sm text-destructive">A selected assignee is not eligible for this case. Choose an available case mediator.</p>}
      {editingTask?.seriesId && isSuperadmin && <div className="space-y-2"><p className="text-sm font-medium">Apply changes to</p><Select value={editScope} onValueChange={(value) => setEditScope(value as "one" | "future")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">This occurrence</SelectItem>{editingTask.occurrenceDate && editingTask.occurrenceDate >= toLocalInput(new Date()).slice(0, 10) && <SelectItem value="future">This and future occurrences</SelectItem>}</SelectContent></Select></div>}
      {isSuperadmin && (!editingTask || (editingTask.seriesId && editScope === "future")) && <div className="grid grid-cols-2 gap-3"><div><p className="mb-1 text-sm font-medium">Repeat</p><Select value={frequency} onValueChange={(value) => setFrequency(value as typeof frequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{!editingTask && <SelectItem value="none">Does not repeat</SelectItem>}<SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></div>{frequency !== "none" && <div><label className="mb-1 block text-sm font-medium">End date (optional)</label><Input type="date" value={repeatEndDate} onChange={(event) => setRepeatEndDate(event.target.value)} /></div>}</div>}
      <ScheduleFields kind={kind} setKind={setKind} start={start} setStart={setStart} end={end} setEnd={setEnd} reminder={reminder} setReminder={setReminder} />
    </div><DialogFooter><Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button onClick={() => saveMutation.mutate()} disabled={saveDisabled}>{saveMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{editingTask ? (editingTaskWasUnassigned ? "Assign and schedule" : "Save task") : "Create task"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!detailsTask} onOpenChange={(open) => { if (!open) { setDetailsTask(null); putTaskInUrl(null); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Task details</DialogTitle><DialogDescription>{detailsTask?.title}</DialogDescription></DialogHeader>
        {detailsTask && <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          <section className="space-y-2"><div className="flex flex-wrap gap-2"><Badge>{detailsTask.status.replaceAll("_", " ")}</Badge><Badge variant="outline">{taskUrgencyLabel(detailsTask.urgency)} priority</Badge>{detailsTask.schedule && <Badge variant={detailsTask.schedule.syncStatus === "failed" ? "destructive" : "secondary"}>{detailsTask.schedule.syncStatus === "succeeded" ? "Calendar synced" : detailsTask.schedule.syncStatus === "failed" ? "Sync failed" : "Sync pending"}</Badge>}</div><p className="whitespace-pre-wrap text-sm text-muted-foreground">{detailsTask.message}</p></section>
          <section className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">Schedule</p>{detailsTask.schedule?.active ? <div className="flex items-start gap-2 text-sm"><CalendarDays className="mt-0.5 h-4 w-4 text-muted-foreground" /><span>{detailsTask.schedule.kind === "all_day" ? `${detailsTask.schedule.allDayStart} (all day)` : `${formatLondon(detailsTask.schedule.startAt)} – ${formatLondon(detailsTask.schedule.endAt)}`}<span className="block text-xs text-muted-foreground">Reminder: {detailsTask.schedule.reminderMinutes == null ? "None" : `${detailsTask.schedule.reminderMinutes} minutes before`}</span></span></div> : <p className="text-sm text-muted-foreground">Not scheduled on the calendar.</p>}{detailsTask.schedule?.lastSyncErrorMessage && <p className="mt-2 text-sm text-destructive">{detailsTask.schedule.lastSyncErrorMessage}</p>}</section>
          <section className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">Assignment</p><div className="flex items-start gap-2 text-sm"><UserRound className="mt-0.5 h-4 w-4 text-muted-foreground" /><span>{detailsTask.assignees?.length ? detailsTask.assignees.map((person) => person.name).join(", ") : "Unassigned"}</span></div></section>
          <section className="rounded-lg border p-3"><p className="mb-2 text-sm font-medium">Linked record</p>{detailsTask.caseReference ? <p className="text-sm">Case {detailsTask.caseReference}</p> : <p className="text-sm text-muted-foreground">No linked case.</p>}{detailsTask.actionHref && detailsTask.actionHref !== "/tasks" && <Button variant="ghost" className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80" onClick={() => { window.location.href = detailsTask.actionHref!; }}><ExternalLink className="mr-1 h-4 w-4" />{detailsTask.actionLabel || "Open record"}</Button>}</section>
          <section className="rounded-lg border p-3 text-sm"><p className="mb-2 font-medium">Activity</p><p>Created {formatLondon(detailsTask.createdAt)}{detailsTask.createdByName ? ` by ${detailsTask.createdByName}` : ""}</p>{detailsTask.completedAt && <p className="mt-1">Completed {formatLondon(detailsTask.completedAt)}{detailsTask.completedByName ? ` by ${detailsTask.completedByName}` : ""}{detailsTask.completionNotes ? ` — ${detailsTask.completionNotes}` : ""}</p>}{detailsTask.cancelledAt && <p className="mt-1 text-destructive">Cancelled {formatLondon(detailsTask.cancelledAt)}{detailsTask.cancelledByName ? ` by ${detailsTask.cancelledByName}` : ""}{detailsTask.cancellationReason ? ` — ${detailsTask.cancellationReason}` : ""}</p>}</section>
        </div>}
        <DialogFooter className="flex-wrap">{detailsTask && canChangeStatus(detailsTask) && getTaskStatusTransitions(detailsTask.status).includes("in_progress") && <Button variant="outline" onClick={() => requestStatusChange(detailsTask, "in_progress")}><Clock className="mr-1 h-4 w-4" />Start task</Button>}{detailsTask && canChangeStatus(detailsTask) && getTaskStatusTransitions(detailsTask.status).includes("follow_up") && <Button variant="outline" onClick={() => requestStatusChange(detailsTask, "follow_up")}><CalendarDays className="mr-1 h-4 w-4" />Set follow-up</Button>}{detailsTask && canChangeStatus(detailsTask) && getTaskStatusTransitions(detailsTask.status).includes("completed") && <Button variant="outline" onClick={() => requestStatusChange(detailsTask, "completed")}><CheckCircle2 className="mr-1 h-4 w-4" />Complete task</Button>}{canEdit && detailsTask?.schedule?.syncStatus === "failed" && <Button variant="outline" onClick={() => retryMutation.mutate(detailsTask.id)}><RefreshCw className="mr-1 h-4 w-4" />Retry sync</Button>}{detailsTask && canCancel(detailsTask) && <Button variant="destructive" onClick={() => openCancellation(detailsTask, "occurrence")}><XCircle className="mr-1 h-4 w-4" />{detailsTask.seriesId ? "Cancel this occurrence" : "Cancel task"}</Button>}{detailsTask && canCancel(detailsTask) && detailsTask.seriesId && detailsTask.occurrenceDate && <Button variant="destructive" onClick={() => openCancellation(detailsTask, "future")}>Cancel this and future</Button>}{canEdit && detailsTask && <Button onClick={() => { openSchedule(detailsTask); setDetailsTask(null); }}>{isSuperadmin && detailsTask.type === "task" ? "Edit task" : "Edit schedule"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{cancelScope === "future" ? "Cancel this and future occurrences?" : "Cancel task?"}</AlertDialogTitle><AlertDialogDescription>{cancelScope === "future" ? "The selected occurrence and every outstanding future occurrence will be cancelled. Completed history will be retained." : "The task will be retained in history and removed from open work and the calendar."}</AlertDialogDescription></AlertDialogHeader><div><label className="mb-1 block text-sm font-medium" htmlFor="task-cancellation-reason">Cancellation reason <span className="font-normal text-muted-foreground">(optional)</span></label><Textarea id="task-cancellation-reason" value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} maxLength={2000} /></div><AlertDialogFooter><AlertDialogCancel disabled={cancelMutation.isPending}>Keep task</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); if (detailsTask) cancelMutation.mutate({ taskId: detailsTask.id, scope: cancelScope, reason: cancellationReason }); }} disabled={cancelMutation.isPending}>{cancelMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirm cancellation</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
