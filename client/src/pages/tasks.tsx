import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskCalendar, type CalendarTaskDto, type TaskScheduleDto } from "@/components/tasks/task-calendar";
import {
  buildTaskFollowUpUpdate,
  canChangeTaskStatus,
  getTaskStatusTransitions,
  londonWallTimeToIso,
  taskUrgencyLabel,
  type TaskStatusValue,
} from "@/components/tasks/task-calendar-utils";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Clock,
  CalendarClock,
  CircleDot,
  MoreHorizontal,
  UserPlus,
  CalendarDays,
  ExternalLink,
  ListFilter,
  ClipboardList,
  Loader2,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import type { Notification } from "@shared/schema";
import { parseTaskQuery, taskQueryFromSearchParams, taskQueryToSearchParams } from "@shared/task-query";

type StaffUser = { id: string; name: string; role: string };
type ActionableNotification = Notification & {
  actionHref?: string;
  actionLabel?: string;
  assignedUserIds?: string[];
  schedule?: TaskScheduleDto | null;
  audience?: string;
};
type TaskActionTarget = ActionableNotification | CalendarTaskDto;
type TaskSavedView = { id: string; name: string; query: Record<string, unknown> };

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CircleDot; color: string; bg: string }> = {
  scheduled: { label: "Upcoming", icon: CalendarClock, color: "text-slate-600", bg: "bg-slate-100 text-slate-700" },
  active: { label: "Active", icon: CircleDot, color: "text-blue-600", bg: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  in_progress: { label: "In Progress", icon: Clock, color: "text-amber-600", bg: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  follow_up: { label: "Follow-up", icon: CalendarClock, color: "text-purple-600", bg: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
};

const URGENCY_CONFIG: Record<string, { dot: string; border: string; bg: string }> = {
  red: { dot: "bg-red-500", border: "border-l-red-500", bg: "bg-red-50 dark:bg-red-950/20" },
  amber: { dot: "bg-amber-500", border: "border-l-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20" },
  green: { dot: "bg-green-500", border: "border-l-green-500", bg: "bg-green-50 dark:bg-green-950/20" },
};

function formatDate(dateVal: string | Date | null): string {
  if (!dateVal) return "—";
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatTimeAgo(dateVal: string | Date): string {
  const now = new Date();
  const date = dateVal instanceof Date ? dateVal : new Date(dateVal);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateVal);
}

function isOverdue(followUpDate: string | Date | null): boolean {
  if (!followUpDate) return false;
  const d = followUpDate instanceof Date ? followUpDate : new Date(followUpDate);
  return d <= new Date();
}

function londonInputValue(value?: string | Date | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value)).replace(" ", "T");
}

export default function TasksPage() {
  const { user } = useAuth();
  const { canView, canEdit } = usePermissions();
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isInternalCalendarUser = !!user && ["superadmin", "subadmin", "staff"].includes(user.role);
  const canUseCalendar = isInternalCalendarUser || user?.role === "mediator";
  const canViewTasks = canView("cases");
  const canEditTasks = canEdit("cases");
  const canAssign = canEditTasks && !!user && ["superadmin", "subadmin"].includes(user.role);
  const requestedView = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
  const [view, setView] = useState<"calendar" | "list">(requestedView === "list" ? "list" : "calendar");
  const initialTaskQuery = taskQueryFromSearchParams(typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams());

  const [statusFilter, setStatusFilter] = useState<string>(initialTaskQuery.statuses.join(",") || "open");
  const [urgencyFilter, setUrgencyFilter] = useState<string>(initialTaskQuery.urgencies[0] || "all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>(initialTaskQuery.assignedTo[0] || "all");
  const [caseFilter, setCaseFilter] = useState<string>(initialTaskQuery.caseIds[0] || "all");
  const [searchFilter, setSearchFilter] = useState(initialTaskQuery.q);
  const [scheduleStateFilter, setScheduleStateFilter] = useState<string>(initialTaskQuery.scheduleState || "all");
  const [dueStateFilter, setDueStateFilter] = useState<string>(initialTaskQuery.dueState || "all");
  const [unassignedFilter, setUnassignedFilter] = useState(initialTaskQuery.unassigned);
  const [savedViewName, setSavedViewName] = useState("");

  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskActionTarget | null>(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [caseNoteText, setCaseNoteText] = useState("");

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);

  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [followUpDateValue, setFollowUpDateValue] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [hadSchedule, setHadSchedule] = useState(false);
  const [scheduleKind, setScheduleKind] = useState<"timed" | "all_day">("timed");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [scheduleReminder, setScheduleReminder] = useState("30");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Notification | null>(null);

  const taskQuery = useMemo(() => parseTaskQuery({
    q: searchFilter,
    ...(statusFilter === "all" ? { status: "all" } : { status: statusFilter }),
    ...(urgencyFilter === "all" ? {} : { urgency: urgencyFilter }),
    ...(assigneeFilter === "all" ? {} : { assignedTo: assigneeFilter }),
    ...(caseFilter === "all" ? {} : { caseId: caseFilter }),
    ...(scheduleStateFilter === "all" ? {} : { scheduleState: scheduleStateFilter }),
    ...(dueStateFilter === "all" ? {} : { due: dueStateFilter }),
    ...(unassignedFilter ? { unassigned: "true" } : {}),
  }), [searchFilter, statusFilter, urgencyFilter, assigneeFilter, caseFilter, scheduleStateFilter, dueStateFilter, unassignedFilter]);
  const queryParams = useMemo(() => taskQueryToSearchParams(taskQuery), [taskQuery]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const viewValue = url.searchParams.get("view");
    url.search = queryParams.toString();
    if (viewValue) url.searchParams.set("view", viewValue);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [queryParams]);

  const { data: tasks, isLoading } = useQuery<ActionableNotification[]>({
    queryKey: ["/api/tasks", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  const { data: counts } = useQuery<{
    active: number;
    inProgress: number;
    followUp: number;
    overdueFollowUp: number;
    completed: number;
  }>({
    queryKey: ["/api/tasks/counts", queryParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/tasks/counts?${queryParams.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch task counts");
      return response.json();
    },
  });

  const isStaff = isInternalCalendarUser;

  const { data: staffUsers } = useQuery<StaffUser[]>({
    queryKey: ["/api/tasks/staff"],
    enabled: isInternalCalendarUser,
  });
  const { data: savedViews = [] } = useQuery<TaskSavedView[]>({ queryKey: ["/api/task-saved-views"] });
  const saveViewMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/task-saved-views", { name: savedViewName, query: taskQuery });
      return response.json();
    },
    onSuccess: async () => { setSavedViewName(""); await queryClient.invalidateQueries({ queryKey: ["/api/task-saved-views"] }); toast({ title: "Saved task view" }); },
  });
  const applySavedView = (saved: TaskSavedView) => {
    const next = parseTaskQuery(saved.query as Record<string, string | string[] | undefined>);
    setSearchFilter(next.q); setStatusFilter(next.statuses.join(",") || "all"); setUrgencyFilter(next.urgencies[0] || "all"); setAssigneeFilter(next.assignedTo[0] || "all"); setCaseFilter(next.caseIds[0] || "all"); setScheduleStateFilter(next.scheduleState || "all"); setDueStateFilter(next.dueState || "all"); setUnassignedFilter(next.unassigned);
  };

  const updateTaskListCaches = (updatedTask: ActionableNotification) => {
    queryClient.setQueriesData<ActionableNotification[]>(
      { queryKey: ["/api/tasks"] },
      (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((task) => task.id === updatedTask.id ? { ...task, ...updatedTask } : task);
      },
    );
  };

  const invalidateTasks = () => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/counts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; [key: string]: unknown }) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, body);
      return res.json() as Promise<ActionableNotification>;
    },
    onSuccess: async (updatedTask) => {
      updateTaskListCaches(updatedTask);
      await invalidateTasks();
      toast({ title: "Task updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/tasks/${id}`);
      return res.json();
    },
    onSuccess: (_data, deletedId) => {
      invalidateTasks();
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(deletedId);
        return next;
      });
      setDeleteConfirmOpen(false);
      setTaskToDelete(null);
      toast({ title: "Task deleted", description: "The task has been permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error deleting task", description: err.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/tasks/bulk-delete", { ids });
      return res.json() as Promise<{ deleted: number }>;
    },
    onSuccess: (data) => {
      invalidateTasks();
      setSelectedIds(new Set());
      setBulkDeleteConfirmOpen(false);
      toast({ title: `${data.deleted} task${data.deleted !== 1 ? "s" : ""} deleted`, description: "The selected tasks have been permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error deleting tasks", description: err.message, variant: "destructive" });
    },
  });

  const getTaskAssigneeIds = (task: TaskActionTarget) => (
    task.assignedUserIds?.length ? task.assignedUserIds : (task.assignedTo ? [task.assignedTo] : [])
  );

  const canChangeStatusForTask = (task: TaskActionTarget) => !!user && canChangeTaskStatus({
    canViewCases: canViewTasks,
    canEditCases: canEditTasks,
    userRole: user.role,
    userId: user.id,
    assignedUserIds: getTaskAssigneeIds(task),
    taskType: task.type,
  });

  const handleStatusChange = (task: TaskActionTarget, newStatus: TaskStatusValue) => {
    if (!canChangeStatusForTask(task)) {
      toast({ title: "Task cannot be updated", description: "Staff can change the status only of tasks assigned to them." });
      return;
    }
    if (newStatus === "completed") {
      setSelectedTask(task);
      setCompletionNotes("");
      setCaseNoteText("");
      setCompleteDialogOpen(true);
      return;
    }
    if (newStatus === "follow_up") {
      const existingAssigneeIds = getTaskAssigneeIds(task);
      if (!task.followUpDate || (canAssign && existingAssigneeIds.length === 0)) {
        openFollowUpDialog(task);
        return;
      }
    }
    updateMutation.mutate({ id: task.id, status: newStatus });
  };

  const handleCompleteSubmit = () => {
    if (!selectedTask) return;
    updateMutation.mutate({
      id: selectedTask.id,
      status: "completed",
      completionNotes: completionNotes.trim() || undefined,
      caseNote: caseNoteText.trim() || undefined,
    });
    setCompleteDialogOpen(false);
    setSelectedTask(null);
  };

  const handleAssignSubmit = () => {
    if (!selectedTask) return;
    try {
      updateMutation.mutate({ id: selectedTask.id, assignedUserIds: selectedAssigneeIds, schedule: buildDialogSchedule() });
    } catch (error) {
      toast({ title: "Invalid schedule", description: (error as Error).message, variant: "destructive" });
      return;
    }
    setAssignDialogOpen(false);
    setSelectedTask(null);
  };

  const handleFollowUpSubmit = () => {
    if (!selectedTask || !followUpDateValue || (canAssign && selectedAssigneeIds.length === 0)) return;
    try {
      const update = buildTaskFollowUpUpdate({
        currentStatus: selectedTask.status,
        followUpDate: new Date(followUpDateValue).toISOString(),
        assignedUserIds: selectedAssigneeIds,
        schedule: isInternalCalendarUser && canEditTasks ? buildDialogSchedule() : undefined,
        canAssign,
        canSchedule: canEditTasks,
      });
      updateMutation.mutate({ id: selectedTask.id, ...update });
    } catch (error) {
      toast({ title: "Invalid schedule", description: (error as Error).message, variant: "destructive" });
      return;
    }
    setFollowUpDialogOpen(false);
    setSelectedTask(null);
  };

  const openAssignDialog = (task: ActionableNotification) => {
    setSelectedTask(task);
    setSelectedAssigneeIds(getTaskAssigneeIds(task));
    initialiseScheduleEditor(task);
    setAssignDialogOpen(true);
  };

  const openFollowUpDialog = (task: TaskActionTarget) => {
    setSelectedTask(task);
    setFollowUpDateValue(task.followUpDate ? new Date(task.followUpDate).toISOString().slice(0, 10) : "");
    setSelectedAssigneeIds(getTaskAssigneeIds(task));
    if (isInternalCalendarUser) initialiseScheduleEditor(task);
    setFollowUpDialogOpen(true);
  };

  const initialiseScheduleEditor = (task: TaskActionTarget) => {
    const schedule = task.schedule?.active ? task.schedule : null;
    setHadSchedule(!!schedule);
    setScheduleEnabled(!!schedule);
    setScheduleKind(schedule?.kind ?? "timed");
    if (schedule?.kind === "all_day") {
      setScheduleStart(schedule.allDayStart ?? "");
      setScheduleEnd(schedule.allDayEndExclusive ?? "");
      setScheduleReminder(String(schedule.reminderMinutes ?? 1440));
    } else {
      const start = schedule?.startAt ? new Date(schedule.startAt) : new Date();
      const end = schedule?.endAt ? new Date(schedule.endAt) : new Date(start.getTime() + 60 * 60 * 1000);
      setScheduleStart(londonInputValue(start));
      setScheduleEnd(londonInputValue(end));
      setScheduleReminder(schedule?.reminderMinutes === null ? "none" : String(schedule?.reminderMinutes ?? 30));
    }
  };

  const buildDialogSchedule = () => {
    if (!scheduleEnabled) return hadSchedule ? null : undefined;
    if (!scheduleStart || !scheduleEnd) throw new Error("Choose both a calendar start and end");
    const reminderMinutes = scheduleReminder === "none" ? null : Number(scheduleReminder);
    return scheduleKind === "timed"
      ? { kind: "timed", startAt: londonWallTimeToIso(scheduleStart), endAt: londonWallTimeToIso(scheduleEnd), reminderMinutes }
      : { kind: "all_day", startDate: scheduleStart, endDateExclusive: scheduleEnd, reminderMinutes };
  };

  const getStaffName = (userId: string | null) => {
    if (!userId) return "Unassigned";
    const s = staffUsers?.find(u => u.id === userId);
    return s ? s.name : "Unknown";
  };

  const getAssignedStaffNames = (task: ActionableNotification) => {
    const ids = getTaskAssigneeIds(task);
    return Array.from(new Set(ids)).map(getStaffName).filter((name) => name !== "Unassigned");
  };

  const toggleSelectedAssignee = (userId: string) => {
    setSelectedAssigneeIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  };

  const allIds = tasks?.map(t => t.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSingle = (task: Notification) => {
    setTaskToDelete(task);
    setDeleteConfirmOpen(true);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setBulkDeleteConfirmOpen(true);
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setUrgencyFilter("all");
    setAssigneeFilter("all");
    setCaseFilter("all");
    setSelectedIds(new Set());
  };

  useEffect(() => {
    const normalized = canUseCalendar ? view : "list";
    if (!canUseCalendar && view !== "list") setView("list");
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") !== normalized) {
      url.searchParams.set("view", normalized);
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }, [canUseCalendar, view]);

  const changeView = (nextView: string) => {
    const normalized = nextView === "list" ? "list" : "calendar";
    setView(normalized);
    const url = new URL(window.location.href);
    url.searchParams.set("view", normalized);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };

  const scheduleEditor = (
    <div className="space-y-3 rounded-lg border p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={scheduleEnabled} onCheckedChange={(checked) => setScheduleEnabled(checked === true)} />
        Schedule on the shared Google calendar
      </label>
      {scheduleEnabled && <>
        <Select value={scheduleKind} onValueChange={(value) => {
          const nextKind = value as "timed" | "all_day";
          setScheduleKind(nextKind);
          setScheduleReminder(nextKind === "timed" ? "30" : "1440");
        }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="timed">Timed event</SelectItem><SelectItem value="all_day">All-day event</SelectItem></SelectContent></Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs text-muted-foreground">Starts</label><Input type={scheduleKind === "timed" ? "datetime-local" : "date"} value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} /></div>
          <div><label className="mb-1 block text-xs text-muted-foreground">Ends {scheduleKind === "all_day" && "(exclusive)"}</label><Input type={scheduleKind === "timed" ? "datetime-local" : "date"} value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} /></div>
        </div>
        <div><label className="mb-1 block text-xs text-muted-foreground">Reminder</label><Select value={scheduleReminder} onValueChange={setScheduleReminder}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="15">15 minutes</SelectItem><SelectItem value="30">30 minutes</SelectItem><SelectItem value="60">1 hour</SelectItem><SelectItem value="1440">1 day</SelectItem><SelectItem value="10080">1 week</SelectItem></SelectContent></Select></div>
        <p className="text-xs text-muted-foreground">Shown and interpreted in Europe/London.</p>
      </>}
    </div>
  );

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="tasks-page">
      <div>
        <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid="text-tasks-heading">
          Tasks
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage and track follow-up tasks across your cases.
        </p>
      </div>

      {canUseCalendar && <Tabs value={view} onValueChange={changeView}>
        <TabsList data-testid="tasks-view-tabs">
          <TabsTrigger value="calendar"><CalendarDays className="mr-1.5 h-4 w-4" />Calendar</TabsTrigger>
          <TabsTrigger value="list"><ClipboardList className="mr-1.5 h-4 w-4" />List</TabsTrigger>
        </TabsList>
      </Tabs>}

      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="cursor-pointer hover:bg-muted/30" onClick={() => { setStatusFilter("active"); setSelectedIds(new Set()); }} data-testid="card-count-active">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <CircleDot className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground" data-testid="text-count-active">{counts.active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/30" onClick={() => { setStatusFilter("in_progress"); setSelectedIds(new Set()); }} data-testid="card-count-in-progress">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground" data-testid="text-count-in-progress">{counts.inProgress}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/30" onClick={() => { setStatusFilter("follow_up"); setSelectedIds(new Set()); }} data-testid="card-count-follow-up">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <CalendarClock className="w-4 h-4 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground" data-testid="text-count-follow-up">{counts.followUp}</p>
                <p className="text-xs text-muted-foreground">
                  Follow-up
                  {counts.overdueFollowUp > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">({counts.overdueFollowUp} overdue)</span>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:bg-muted/30" onClick={() => { setStatusFilter("completed"); setSelectedIds(new Set()); changeView("list"); }} data-testid="card-count-completed">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground" data-testid="text-count-completed">{counts.completed}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input value={searchFilter} onChange={(event) => { setSearchFilter(event.target.value); setSelectedIds(new Set()); }} placeholder="Search tasks, cases, enquiries or clients" className="h-9 w-[min(320px,100%)]" aria-label="Search tasks" data-testid="input-task-search" />
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ListFilter className="w-4 h-4" />
          <span>Filters:</span>
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelectedIds(new Set()); }}>
          <SelectTrigger className="w-[140px] h-9" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open (not completed)</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="follow_up">Follow-up</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={urgencyFilter} onValueChange={(v) => { setUrgencyFilter(v); setSelectedIds(new Set()); }}>
          <SelectTrigger className="w-[130px] h-9" data-testid="select-urgency-filter">
            <SelectValue placeholder="Urgency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgency</SelectItem>
            <SelectItem value="red">High</SelectItem>
            <SelectItem value="amber">Medium</SelectItem>
            <SelectItem value="green">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={scheduleStateFilter} onValueChange={(v) => { setScheduleStateFilter(v); setSelectedIds(new Set()); }}>
          <SelectTrigger className="w-[145px] h-9"><SelectValue placeholder="Schedule" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All schedules</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="unscheduled">Unscheduled</SelectItem></SelectContent>
        </Select>

        <Select value={dueStateFilter} onValueChange={(v) => { setDueStateFilter(v); setSelectedIds(new Set()); }}>
          <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Due date" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All due dates</SelectItem><SelectItem value="overdue">Overdue</SelectItem><SelectItem value="today">Due today</SelectItem><SelectItem value="upcoming">Upcoming</SelectItem><SelectItem value="none">No due date</SelectItem></SelectContent>
        </Select>

        {isStaff && staffUsers && (
          <Select value={assigneeFilter} onValueChange={(v) => { setAssigneeFilter(v); setSelectedIds(new Set()); }}>
            <SelectTrigger className="w-[160px] h-9" data-testid="select-assignee-filter">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              {staffUsers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Input value={caseFilter === "all" ? "" : caseFilter} onChange={(event) => { setCaseFilter(event.target.value.trim() || "all"); setSelectedIds(new Set()); }} placeholder="Case ID" className="h-9 w-36" data-testid="input-case-filter" />

        <div className="flex flex-wrap gap-1">
          {[
            ["All open", "open", "all", "all"], ["My tasks", "open", "mine", "all"], ["Unassigned", "open", "unassigned", "all"], ["Overdue", "open", "all", "overdue"], ["Due today", "open", "all", "today"], ["Upcoming", "open", "all", "upcoming"], ["Unscheduled", "open", "all", "none"], ["Completed", "completed", "all", "all"],
          ].map(([label, status, assignee, due]) => <Button key={label} variant="outline" size="sm" className="h-8" onClick={() => { setStatusFilter(status); setAssigneeFilter(assignee === "mine" ? user?.id || "all" : "all"); setUnassignedFilter(assignee === "unassigned"); setScheduleStateFilter(label === "Unscheduled" ? "unscheduled" : "all"); setDueStateFilter(due); }}>{label}</Button>)}
        </div>

        <Select onValueChange={(id) => { const saved = savedViews.find((view) => view.id === id); if (saved) applySavedView(saved); }}>
          <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Saved views" /></SelectTrigger>
          <SelectContent>{savedViews.length ? savedViews.map((view) => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>) : <SelectItem value="none" disabled>No saved views</SelectItem>}</SelectContent>
        </Select>
        <Input value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} placeholder="View name" className="h-9 w-36" aria-label="Saved view name" />
        <Button size="sm" className="h-9" disabled={!savedViewName.trim() || saveViewMutation.isPending} onClick={() => saveViewMutation.mutate()}>Save view</Button>

        {isSuperadmin && someSelected && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={handleBulkDelete}
            disabled={bulkDeleteMutation.isPending}
            data-testid="button-bulk-delete"
          >
            {bulkDeleteMutation.isPending
              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              : <Trash2 className="w-4 h-4 mr-1.5" />
            }
            Delete selected ({selectedIds.size})
          </Button>
        )}
      </div>

      {view === "calendar" && (isInternalCalendarUser || user?.role === "mediator") ? (
        <TaskCalendar
          staffUsers={staffUsers}
          userId={user?.id ?? ""}
          userRole={user?.role ?? ""}
          canView={canViewTasks}
          canEdit={user?.role === "mediator" ? false : canEditTasks}
          queryString={queryParams.toString()}
          onStatusChange={handleStatusChange}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="p-4 flex items-center gap-4">
                <Skeleton className="h-3 w-3 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tasks && tasks.length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                {isSuperadmin && (
                  <TableHead className="w-10 pl-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all tasks"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                )}
                <TableHead className="w-10"></TableHead>
                <TableHead>Task</TableHead>
                <TableHead className="w-[120px]">Case</TableHead>
                {isStaff && staffUsers && <TableHead className="w-[140px]">Assigned to</TableHead>}
                <TableHead className="w-[110px]">Follow-up</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[80px]">Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map(task => {
                const urgency = URGENCY_CONFIG[task.urgency] || URGENCY_CONFIG.green;
                const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.active;
                const StatusIcon = statusCfg.icon;
                const overdue = task.status === "follow_up" && isOverdue(task.followUpDate);
                const isSelected = selectedIds.has(task.id);
                const isIntakeTask = ["enquiry_follow_up", "enquiry_chase", "enquiry_persistent_follow_up"].includes(task.type);
                const canChangeStatus = canChangeStatusForTask(task);
                const statusTransitions = canChangeStatus ? getTaskStatusTransitions(task.status) : [];

                return (
                  <TableRow
                    key={task.id}
                    className={`border-l-4 ${urgency.border} ${isSelected ? "bg-muted/40" : ""}`}
                    data-testid={`row-task-${task.id}`}
                  >
                    {isSuperadmin && (
                      <TableCell className="pl-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectOne(task.id)}
                          aria-label={`Select task ${task.title}`}
                          data-testid={`checkbox-task-${task.id}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <div className={`w-3 h-3 rounded-full ${urgency.dot}`} />
                          </TooltipTrigger>
                          <TooltipContent>{taskUrgencyLabel(task.urgency)} priority</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm text-foreground" data-testid={`text-task-title-${task.id}`}>
                        {task.title}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {task.message}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Link href={task.actionHref || "/tasks"}>
                        <span className="text-xs text-blue-600 hover:underline cursor-pointer" data-testid={`link-task-case-${task.id}`}>
                          <ExternalLink className="w-3 h-3 inline mr-1" />
                          {task.actionLabel || "Open"}
                        </span>
                      </Link>
                    </TableCell>
                    {isStaff && staffUsers && (
                      <TableCell>
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          onClick={() => openAssignDialog(task)}
                          disabled={!canAssign}
                          data-testid={`button-assign-${task.id}`}
                        >
                          <UserPlus className="w-3 h-3" />
                          {getAssignedStaffNames(task).length > 0 ? (
                            <span className="flex flex-wrap gap-1">
                              {getAssignedStaffNames(task).map((name) => (
                                <Badge key={name} variant="outline" className="text-[11px]" data-testid={`badge-task-assignee-${task.id}`}>
                                  {name}
                                </Badge>
                              ))}
                            </span>
                          ) : "Unassigned"}
                        </button>
                      </TableCell>
                    )}
                    <TableCell>
                      {task.followUpDate ? (
                        <span className={`text-xs ${overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}
                          data-testid={`text-follow-up-${task.id}`}
                        >
                          {overdue && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                          {formatDate(task.followUpDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canChangeStatus ? <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Change status for ${task.title}`} data-testid={`button-task-status-${task.id}`}>
                            <Badge variant="secondary" className={`text-xs ${statusCfg.bg}`} data-testid={`badge-task-status-${task.id}`}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {statusCfg.label}
                            </Badge>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {statusTransitions.map((nextStatus) => {
                            const nextStatusConfig = STATUS_CONFIG[nextStatus];
                            const NextStatusIcon = nextStatusConfig.icon;
                            return <DropdownMenuItem key={nextStatus} onClick={() => handleStatusChange(task, nextStatus)} data-testid={`status-option-${nextStatus}-${task.id}`}>
                              <NextStatusIcon className={`w-4 h-4 mr-2 ${nextStatusConfig.color}`} />
                              {nextStatus === "completed" ? "Complete task" : nextStatus === "active" && task.status === "completed" ? "Reopen as Active" : `Set ${nextStatusConfig.label}`}
                            </DropdownMenuItem>;
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu> : <Badge variant="secondary" className={`text-xs ${statusCfg.bg}`} data-testid={`badge-task-status-${task.id}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusCfg.label}
                      </Badge>}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground" data-testid={`text-task-created-${task.id}`}>
                        {formatTimeAgo(task.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-task-actions-${task.id}`}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {isIntakeTask && task.actionHref && (
                            <DropdownMenuItem asChild>
                              <Link href={task.actionHref} data-testid={`action-intake-workflow-${task.id}`}>
                                <ExternalLink className="w-4 h-4 mr-2" />
                                {task.actionLabel || "Open intake workflow"}
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {canAssign && staffUsers && (
                            <DropdownMenuItem onClick={() => openAssignDialog(task)} data-testid={`action-assign-${task.id}`}>
                              <UserPlus className="w-4 h-4 mr-2" />
                              Assign
                            </DropdownMenuItem>
                          )}
                          {canChangeStatus && task.status !== "completed" && (<DropdownMenuItem onClick={() => openFollowUpDialog(task)} data-testid={`action-follow-up-date-${task.id}`}>
                            <CalendarDays className="w-4 h-4 mr-2" />
                            Set follow-up date
                          </DropdownMenuItem>)}
                          {isSuperadmin && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteSingle(task)}
                                className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30"
                                data-testid={`action-delete-task-${task.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete task
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No tasks match your filters</p>
            <Button variant="ghost" className="mt-2 text-sm text-blue-600 hover:text-blue-700" onClick={clearFilters}>
              Clear all filters
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Complete task dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete task</DialogTitle>
            <DialogDescription>
              Record the outcome of this task. {selectedTask?.caseNoteRequired && "A case note is required."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Outcome notes</label>
              <Textarea
                placeholder="What was done? What's the outcome?"
                value={completionNotes}
                onChange={e => setCompletionNotes(e.target.value)}
                rows={3}
                data-testid="input-completion-notes"
              />
              {selectedTask?.caseId && (
                <p className="text-xs text-muted-foreground mt-1">
                  These notes will be recorded in the case activity timeline.
                </p>
              )}
            </div>
            {selectedTask?.caseNoteRequired && (
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">
                  Case note <span className="text-red-500">*</span>
                </label>
                <Textarea
                  placeholder="Enter case note (required)..."
                  value={caseNoteText}
                  onChange={e => setCaseNoteText(e.target.value)}
                  rows={3}
                  data-testid="input-case-note"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This will be saved to the case's confidential notes.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)} data-testid="button-cancel-complete">
              Cancel
            </Button>
            <Button
              onClick={handleCompleteSubmit}
              disabled={updateMutation.isPending || (selectedTask?.caseNoteRequired && !caseNoteText.trim())}
              data-testid="button-submit-complete"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Complete task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign task dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign task</DialogTitle>
            <DialogDescription>
              Choose one or more team members to assign this task to.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {staffUsers?.map(s => (
              <label key={s.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Checkbox
                  checked={selectedAssigneeIds.includes(s.id)}
                  onCheckedChange={() => toggleSelectedAssignee(s.id)}
                  data-testid={`checkbox-assignee-${s.id}`}
                />
                <span>{s.name} ({s.role})</span>
              </label>
            ))}
            {staffUsers?.length === 0 && (
              <p className="text-sm text-muted-foreground">No active staff members available.</p>
            )}
            {scheduleEditor}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)} data-testid="button-cancel-assign">
              Cancel
            </Button>
            <Button onClick={handleAssignSubmit} disabled={updateMutation.isPending} data-testid="button-submit-assign">
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-up date dialog */}
      <Dialog open={followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set follow-up date</DialogTitle>
            <DialogDescription>
              Choose when this task should be followed up and who owns the follow-up.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Follow-up date</label>
              <Input
                type="date"
                value={followUpDateValue}
                onChange={e => setFollowUpDateValue(e.target.value)}
                data-testid="input-follow-up-date"
              />
            </div>
            {canAssign && <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Follow-up owner</p>
              {staffUsers?.map(s => (
                <label key={s.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={selectedAssigneeIds.includes(s.id)}
                    onCheckedChange={() => toggleSelectedAssignee(s.id)}
                    data-testid={`checkbox-follow-up-assignee-${s.id}`}
                  />
                  <span>{s.name} ({s.role})</span>
                </label>
              ))}
              {staffUsers?.length === 0 && (
                <p className="text-sm text-muted-foreground">No active staff members available.</p>
              )}
            </div>}
            {isInternalCalendarUser && canEditTasks && scheduleEditor}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpDialogOpen(false)} data-testid="button-cancel-follow-up">
              Cancel
            </Button>
            <Button
              onClick={handleFollowUpSubmit}
              disabled={updateMutation.isPending || !followUpDateValue || (canAssign && selectedAssigneeIds.length === 0)}
              data-testid="button-submit-follow-up"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Set date
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single task delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete-task">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{taskToDelete?.title}</strong> will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-task">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => taskToDelete && deleteMutation.mutate(taskToDelete.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-task"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-bulk-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} task{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {selectedIds.size} selected task{selectedIds.size !== 1 ? "s" : ""} will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Delete {selectedIds.size} task{selectedIds.size !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
