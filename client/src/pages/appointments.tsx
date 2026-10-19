import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AppointmentJoinFallbackDialog } from "@/components/appointments/appointment-join-fallback-dialog";
import { useAuditedAppointmentJoin } from "@/hooks/use-audited-appointment-join";
import { useCalendarOAuthResult } from "@/hooks/use-calendar-oauth-result";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import {
  Calendar,
  List,
  CalendarDays,
  ExternalLink,
  Link2,
  Pencil,
  RefreshCw,
  Settings,
  AlertTriangle,
  Trash2,
  XCircle,
  ArrowUpRight,
  Loader2,
  Clock,
  User,
  FileText,
} from "lucide-react";
import { CalendarConnectModal } from "@/components/calendar/calendar-connect-modal";
import { formatDistanceToNow } from "date-fns";
import {
  WeeklyCalendar,
  APPT_STATUS_STYLES,
  getWeekDates,
  resolveMediatorColor,
  type AppointmentData,
  type PersonalEventData,
} from "@/components/shared/weekly-calendar";
import { appointmentWallClockDate } from "@shared/booking-time";
import { getLondonInstantDateTimeParts } from "@/lib/date-time";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export { WeeklyCalendar, APPT_STATUS_STYLES, getWeekDates };
export type { AppointmentData };

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  payment_pending: "Payment pending",
  paid: "Paid",
  voucher_pending: "Voucher claim pending",
  voucher_accepted_by_opia: "Voucher accepted by OPIA",
  payment_not_required: "Payment not required",
  failed_or_not_received: "Failed / not received",
};

type AppointmentHistoryRow = {
  id: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousDateTime?: string | Date | null;
  newDateTime?: string | Date | null;
  previousDuration?: number | null;
  newDuration?: number | null;
  eventType: string;
  reason?: string | null;
  changedAt: string | Date;
};

function formatHistoryEvent(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatHistoryDate(value?: string | Date | null): string {
  return value ? new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) : "";
}

function AppointmentHistoryList({ appointmentId }: { appointmentId: string }) {
  const { data: history = [], isLoading } = useQuery<AppointmentHistoryRow[]>({
    queryKey: ["/api/appointments", appointmentId, "history"],
    queryFn: async () => {
      const res = await fetch(`/api/appointments/${appointmentId}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load appointment history");
      return res.json();
    },
  });

  return (
    <div className="rounded-md border p-3" data-testid="appointment-history-section">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">History</div>
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lifecycle history recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {history.slice(0, 8).map((row) => (
            <div key={row.id} className="text-xs rounded border bg-muted/20 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{formatHistoryEvent(row.eventType)}</span>
                <span className="text-muted-foreground">{formatHistoryDate(row.changedAt)}</span>
              </div>
              {(row.previousStatus || row.newStatus) && (
                <div className="text-muted-foreground mt-0.5">
                  {[row.previousStatus, row.newStatus].filter(Boolean).join(" to ")}
                </div>
              )}
              {(row.previousDateTime || row.newDateTime) && row.previousDateTime !== row.newDateTime && (
                <div className="text-muted-foreground mt-0.5">
                  {formatHistoryDate(row.previousDateTime)} to {formatHistoryDate(row.newDateTime)}
                </div>
              )}
              {row.reason && <div className="text-muted-foreground mt-0.5">{row.reason}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingLinkDialog({
  open,
  onOpenChange,
  appointment,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  appointment: AppointmentData | null;
  onSave: (id: string, link: string) => void;
}) {
  const [link, setLink] = useState("");

  const handleOpen = (o: boolean) => {
    if (o && appointment) {
      setLink(appointment.meetingLink || "");
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-meeting-link">
        <DialogHeader>
          <DialogTitle className="font-heading">Meeting Link</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="meetingLink">Zoom / Video Meeting URL</Label>
          <Input
            id="meetingLink"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://zoom.us/j/..."
            data-testid="input-meeting-link"
          />
          {appointment?.parentEventOriginalStart && appointment?.parentEventOriginalEnd && (
            <p
              className="text-xs text-muted-foreground italic"
              data-testid="text-carved-from-trace"
            >
              Carved from Google event{" "}
              <span className="font-medium">
                {appointment.parentEventOriginalTitle || "Available"}
              </span>{" "}
              ({appointmentWallClockDate(appointment.parentEventOriginalStart, appointment.dateTimeBasis ?? "wall_clock_utc").toLocaleString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              –{" "}
              {appointmentWallClockDate(appointment.parentEventOriginalEnd, appointment.dateTimeBasis ?? "wall_clock_utc").toLocaleString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })})
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-meeting-link">
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (appointment) onSave(appointment.id, link);
              onOpenChange(false);
            }}
            className="bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
            data-testid="button-save-meeting-link"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const weekDays = getWeekDates(now);
  return {
    start: weekDays[0].toISOString().split("T")[0],
    end: new Date(weekDays[6].getTime() + 24 * 60 * 60 * 1000 - 1).toISOString().split("T")[0],
  };
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState("all");
  const [mediatorFilter, setMediatorFilter] = useState("all");
  const [meetingLinkDialog, setMeetingLinkDialog] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentData | null>(null);
  const [sortBy, setSortBy] = useState<string | null>("dateTime");
  const [sortOrder, setSortOrder] = useState<SortDirection>("asc");

  const defaults = getDefaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.start);
  const [dateTo, setDateTo] = useState(defaults.end);

  const role = user?.role || "client";
  const isAdmin = role === "superadmin" || role === "subadmin";
  const isClient = role === "client";
  const isMediator = role === "mediator";
  const canEditAppointments = canEdit("appointments");

  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false);

  type CalendarStatus = {
    role: string;
    googleCalendarConnected: boolean;
    googleCalendarEmail: string | null;
    lastCalendarSyncAt: string | null;
    lastCalendarSyncError: string | null;
    hasWriteScope: boolean;
    needsWriteScope: boolean;
    needsReauth?: boolean;
    configured: boolean;
    outlookCalendarConnected: boolean;
    outlookCalendarEmail: string | null;
    lastOutlookSyncAt: string | null;
    lastOutlookSyncError: string | null;
    hasOutlookWriteScope: boolean;
    outlookConfigured: boolean;
    activeCalendarProvider: "google" | "outlook" | null;
  };

  const { data: calStatus, refetch: refetchCalStatus } = useQuery<CalendarStatus>({
    queryKey: ["/api/calendar/status/me"],
    enabled: isMediator,
    refetchOnWindowFocus: true,
  });

  const { isError: availabilityImportStatusError } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/calendar/availability-import-status"],
    enabled: isAdmin || isMediator,
  });

  const activeCalendarProvider = calStatus?.activeCalendarProvider ?? null;
  const googleCalendarReady = activeCalendarProvider === "google" && !!calStatus?.googleCalendarConnected;
  const outlookCalendarReady = activeCalendarProvider === "outlook" && !!calStatus?.outlookCalendarConnected;
  const activeCalendarReady = googleCalendarReady || outlookCalendarReady;
  const hasConnectedProvider = !!calStatus?.googleCalendarConnected || !!calStatus?.outlookCalendarConnected;
  const activeCalendarProviderLabel = activeCalendarProvider === "outlook" ? "Microsoft Outlook" : "Google Calendar";
  const activeCalendarEmail = activeCalendarProvider === "outlook"
    ? calStatus?.outlookCalendarEmail ?? null
    : calStatus?.googleCalendarEmail ?? null;
  const activeCalendarLastSyncAt = activeCalendarProvider === "outlook"
    ? calStatus?.lastOutlookSyncAt
    : calStatus?.lastCalendarSyncAt;
  const activeCalendarSyncError = activeCalendarProvider === "outlook"
    ? calStatus?.lastOutlookSyncError
    : calStatus?.lastCalendarSyncError;
  const activeCalendarNeedsReauth = activeCalendarSyncError === "needs_reauth";
  const activeCalendarNeedsWriteScope = activeCalendarProvider === "outlook"
    ? !!calStatus && calStatus.outlookCalendarConnected && !calStatus.hasOutlookWriteScope
    : !!calStatus?.needsWriteScope;

  const syncCalendarMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Not signed in");
      return apiRequest("POST", `/api/calendar/sync/${user.id}`, {});
    },
    onSuccess: async () => {
      await refetchCalStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Calendar synced" });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Sync failed";
      const needsReauth = /invalid_grant|needs_reauth|reconnect/i.test(msg);
      refetchCalStatus();
      toast({
        title: needsReauth ? "Reconnect needed" : "Sync failed",
        description: needsReauth
          ? `Your ${activeCalendarProviderLabel} authorisation has expired. Open Calendar settings to reconnect.`
          : msg,
        variant: "destructive",
      });
    },
  });

  const weekDays = getWeekDates(currentDate);
  const calStart = weekDays[0].toISOString();
  const calEnd = new Date(weekDays[6].getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();

  const listStart = dateFrom ? new Date(dateFrom).toISOString() : calStart;
  const listEnd = dateTo ? new Date(new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString() : calEnd;

  const { data: calendarAppointments = [], isLoading: calLoading } = useQuery<AppointmentData[]>({
    queryKey: ["/api/appointments", "calendar", calStart, calEnd],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?start=${encodeURIComponent(calStart)}&end=${encodeURIComponent(calEnd)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load appointments");
      return res.json();
    },
  });

  const { data: listAppointments = [], isLoading: listLoading } = useQuery<AppointmentData[]>({
    queryKey: ["/api/appointments", "list", listStart, listEnd],
    queryFn: async () => {
      const res = await fetch(`/api/appointments?start=${encodeURIComponent(listStart)}&end=${encodeURIComponent(listEnd)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load appointments");
      return res.json();
    },
  });

  const personalEventsTargetMediatorId = isMediator
    ? user?.id ?? null
    : isAdmin && mediatorFilter !== "all"
      ? mediatorFilter
      : null;

  const adminAllMediators = isAdmin && mediatorFilter === "all";

  const opportunisticSyncCooldownRef = useRef<Map<string, number>>(new Map());
  const opportunisticSyncInFlightRef = useRef<Set<string>>(new Set());
  const [allMediatorsSyncing, setAllMediatorsSyncing] = useState(false);

  useCalendarOAuthResult({
    onConnected: () => {
      if (!isMediator) return;
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/status/me"] });
      refetchCalStatus();
      if (user?.id) opportunisticSyncCooldownRef.current.delete(user.id);
    },
  });

  useEffect(() => {
    const targetId = personalEventsTargetMediatorId;
    if (!targetId) return;
    if (isMediator && !activeCalendarReady) return;
    if (opportunisticSyncInFlightRef.current.has(targetId)) return;
    const lastAttempt = opportunisticSyncCooldownRef.current.get(targetId) ?? 0;
    const lastSyncedFromStatus = isMediator && activeCalendarLastSyncAt
      ? new Date(activeCalendarLastSyncAt).getTime()
      : 0;
    const lastKnown = Math.max(lastAttempt, lastSyncedFromStatus);
    if (lastKnown > Date.now() - 60_000) return;
    opportunisticSyncCooldownRef.current.set(targetId, Date.now());
    opportunisticSyncInFlightRef.current.add(targetId);
    apiRequest("POST", `/api/calendar/sync/${targetId}`, {})
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/events", targetId] });
        if (isMediator) refetchCalStatus();
      })
      .catch((err: unknown) => {
        if (isMediator) {
          refetchCalStatus();
          const msg = err instanceof Error ? err.message : "";
          const needsReauth = /invalid_grant|needs_reauth|reconnect/i.test(msg);
          toast({
            title: needsReauth ? `Reconnect ${activeCalendarProviderLabel}` : "Calendar sync failed",
            description: needsReauth
              ? `Your ${activeCalendarProviderLabel} authorisation has expired. Open Calendar settings to reconnect.`
              : "Could not sync your calendar events. Try using the Sync now button.",
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        opportunisticSyncInFlightRef.current.delete(targetId);
      });
  }, [personalEventsTargetMediatorId, isMediator, activeCalendarReady, activeCalendarLastSyncAt, activeCalendarProviderLabel, refetchCalStatus]);

  // Opportunistic sync-all: fires when an admin switches to (or loads in) the
  // "All mediators" view. Uses a dedicated "__all__" key to rate-limit the
  // all-mediators call itself. After the call resolves, per-mediator cooldown
  // keys are stamped for each mediator the server actually synced — so if the
  // admin then switches to a specific mediator within 60 s, the individual
  // opportunistic sync is skipped (matching the individual-mediator behaviour).
  // Server-side, mediators whose lastCalendarSyncAt is within 60 s are also
  // skipped, providing a second layer of deduplication.
  const ALL_MEDIATORS_COOLDOWN_KEY = "__all__";
  useEffect(() => {
    if (!adminAllMediators) return;
    if (opportunisticSyncInFlightRef.current.has(ALL_MEDIATORS_COOLDOWN_KEY)) return;
    const lastAttempt = opportunisticSyncCooldownRef.current.get(ALL_MEDIATORS_COOLDOWN_KEY) ?? 0;
    if (lastAttempt > Date.now() - 60_000) return;
    opportunisticSyncCooldownRef.current.set(ALL_MEDIATORS_COOLDOWN_KEY, Date.now());
    opportunisticSyncInFlightRef.current.add(ALL_MEDIATORS_COOLDOWN_KEY);
    setAllMediatorsSyncing(true);
    apiRequest("POST", "/api/calendar/sync-all", {})
      .then(async (res) => {
        // Parse the JSON body — apiRequest returns a raw Response.
        const body = await res.json() as { syncedMediatorIds?: string[] };
        // Stamp per-mediator cooldown keys for each mediator the server synced.
        // This prevents a redundant individual sync if the admin immediately
        // switches to a specific mediator that was just included in the bulk run.
        const now = Date.now();
        if (Array.isArray(body?.syncedMediatorIds)) {
          for (const mid of body.syncedMediatorIds) {
            opportunisticSyncCooldownRef.current.set(mid, now);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/events", "all"] });
      })
      .catch((err: unknown) => {
        console.warn("[appointments] sync-all failed:", err);
      })
      .finally(() => {
        opportunisticSyncInFlightRef.current.delete(ALL_MEDIATORS_COOLDOWN_KEY);
        setAllMediatorsSyncing(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminAllMediators]);

  const personalEventsEnabled = isMediator
    ? !!user?.id && activeCalendarReady
    : isAdmin && (!!personalEventsTargetMediatorId || adminAllMediators);

  const { data: personalEvents = [], isLoading: personalEventsLoading } = useQuery<PersonalEventData[]>({
    queryKey: ["/api/calendar/events", adminAllMediators ? "all" : personalEventsTargetMediatorId, calStart, calEnd],
    queryFn: async () => {
      const url = adminAllMediators
        ? `/api/calendar/events?from=${encodeURIComponent(calStart)}&to=${encodeURIComponent(calEnd)}`
        : personalEventsTargetMediatorId
          ? `/api/calendar/events/${personalEventsTargetMediatorId}?from=${encodeURIComponent(calStart)}&to=${encodeURIComponent(calEnd)}`
          : null;
      if (!url) return [];
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: personalEventsEnabled,
  });

  const [selectedPersonalEvent, setSelectedPersonalEvent] = useState<PersonalEventData | null>(null);
  const [selectedApptSheet, setSelectedApptSheet] = useState<AppointmentData | null>(null);

  const refreshSelectedApptSheet = async (id: string) => {
    await queryClient.refetchQueries({ queryKey: ["/api/appointments"] });
    const allEntries = queryClient.getQueriesData<AppointmentData[]>({ queryKey: ["/api/appointments"] });
    for (const [, data] of allEntries) {
      if (!Array.isArray(data)) continue;
      const fresh = data.find((a) => a.id === id);
      if (fresh) { setSelectedApptSheet(fresh); return; }
    }
  };

  const cancelAppointmentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/appointments/${id}/cancel`, {});
      return res.json() as Promise<AppointmentData>;
    },
    onSuccess: (updated: AppointmentData) => {
      setSelectedApptSheet(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      toast({ title: "Appointment cancelled", description: "The mediator's availability has been restored." });
    },
    onError: async (err: unknown, id: string) => {
      const raw = parseApiError(err, "Failed to cancel appointment");
      const is502 = /502|restore|availability/i.test((err instanceof Error ? err.message : "") + raw);
      const description = is502 ? `${raw} Please try again in a moment.` : raw;
      toast({ title: "Could not cancel", description, variant: "destructive" });
      await refreshSelectedApptSheet(id);
    },
  });

  const requestCancellationMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await apiRequest("POST", `/api/appointments/${id}/cancellation-request`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
      toast({ title: "Request sent", description: "BFM has been notified and will review the cancellation request." });
    },
    onError: (err: unknown) => {
      const message = parseApiError(err, "Failed to request cancellation");
      const description = message.includes("already open")
        ? "A cancellation request is already open for this appointment."
        : message;
      toast({ title: "Could not send request", description, variant: "destructive" });
    },
  });

  const deleteAppointmentMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/appointments/${id}`, undefined);
    },
    onSuccess: () => {
      setSelectedApptSheet(null);
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      toast({ title: "Appointment deleted" });
    },
    onError: async (err: unknown, id: string) => {
      const raw = parseApiError(err, "Failed to delete appointment");
      const is502 = /502|restore|availability/i.test((err instanceof Error ? err.message : "") + raw);
      const description = is502 ? `${raw} Please try again in a moment.` : raw;
      toast({ title: "Could not delete", description, variant: "destructive" });
      await refreshSelectedApptSheet(id);
    },
  });

  const { data: mediators } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/mediators"],
    queryFn: async () => {
      const res = await fetch("/api/mediators?limit=100", { credentials: "include" });
      if (!res.ok) return { data: [] };
      return res.json();
    },
    enabled: !isClient,
  });

  const updateMeetingLinkMutation = useMutation({
    mutationFn: async ({ id, meetingLink }: { id: string; meetingLink: string }) => {
      await apiRequest("PATCH", `/api/appointments/${id}`, { meetingLink: meetingLink || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Meeting link updated" });
    },
    onError: () => toast({ title: "Failed to update meeting link", variant: "destructive" }),
  });

  const {
    fallbackMeetingLink,
    joiningAppointmentId,
    joinAppointment,
    clearFallbackMeetingLink,
  } = useAuditedAppointmentJoin();

  const calFiltered = useMemo(() => {
    let result = calendarAppointments;
    if (statusFilter !== "all") {
      result = result.filter((a) => a.status === statusFilter);
    }
    if (isAdmin && mediatorFilter !== "all") {
      result = result.filter((a) => a.mediatorId === mediatorFilter);
    }
    return result;
  }, [calendarAppointments, statusFilter, mediatorFilter, isAdmin]);

  const listFiltered = useMemo(() => {
    let result = listAppointments;
    if (statusFilter !== "all") {
      result = result.filter((a) => a.status === statusFilter);
    }
    if (isAdmin && mediatorFilter !== "all") {
      result = result.filter((a) => a.mediatorId === mediatorFilter);
    }
    return result;
  }, [listAppointments, statusFilter, mediatorFilter, isAdmin]);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : sortOrder === "desc" ? null : "asc");
      if (sortOrder === "desc") setSortBy(null);
    } else {
      setSortBy(key);
      setSortOrder("asc");
    }
  };

  const sortedForList = useMemo(() => {
    const items = [...listFiltered];
    if (!sortBy || !sortOrder) return items.sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

    return items.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "dateTime":
          cmp = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
          break;
        case "client":
          cmp = (a.partyName || "").localeCompare(b.partyName || "");
          break;
        case "service":
          cmp = (a.serviceName || "").localeCompare(b.serviceName || "");
          break;
        case "mediator":
          cmp = (a.mediatorName || "").localeCompare(b.mediatorName || "");
          break;
        case "caseRef":
          cmp = (a.caseReference || "").localeCompare(b.caseReference || "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        default:
          cmp = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }, [listFiltered, sortBy, sortOrder]);

  const handleAppointmentClick = (appt: AppointmentData) => {
    if (appt.status === "cancelled" || appt.status === "expired") return;
    setSelectedApptSheet(appt);
  };

  const handleMeetingLinkClick = (appt: AppointmentData) => {
    setSelectedAppointment(appt);
    setMeetingLinkDialog(true);
  };

  const handleSaveMeetingLink = (id: string, link: string) => {
    updateMeetingLinkMutation.mutate({ id, meetingLink: link });
  };

  const isLoading = calLoading || listLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="appointments-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-appointments">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground" data-testid="text-page-title">Appointments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isClient
              ? "Your upcoming and past appointments"
              : isAdmin
                ? "All appointments across cases and mediators"
                : "Your assigned appointments"}
          </p>
        </div>

        {isMediator && calStatus?.configured && (
          <div className="flex flex-wrap items-center justify-end gap-2" data-testid="calendar-controls-bar">
            {activeCalendarReady ? (
              <>
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-medium text-foreground" data-testid="text-active-calendar-provider">
                    {activeCalendarProviderLabel} connected
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-calendar-connected-email">
                    {activeCalendarEmail || "Calendar account connected"}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80" data-testid="text-calendar-last-sync">
                    {activeCalendarLastSyncAt
                      ? `Last synced ${formatDistanceToNow(new Date(activeCalendarLastSyncAt), { addSuffix: true })}`
                      : "Not yet synced"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncCalendarMutation.mutate()}
                  disabled={syncCalendarMutation.isPending}
                  data-testid="button-sync-my-calendar"
                >
                  <RefreshCw className={`w-4 h-4 mr-1.5 ${syncCalendarMutation.isPending ? "animate-spin" : ""}`} />
                  {syncCalendarMutation.isPending ? "Syncing..." : "Sync now"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCalendarSettingsOpen(true)}
                  data-testid="button-calendar-settings"
                >
                  <Settings className="w-4 h-4 mr-1.5" />
                  Calendar settings
                </Button>
              </>
            ) : hasConnectedProvider ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/settings")}
                data-testid="button-choose-active-calendar"
              >
                <Settings className="w-4 h-4 mr-1.5" />
                Choose active calendar provider
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => setCalendarSettingsOpen(true)}
                className="bg-[#5a7d58] hover:bg-[#4a6b48] text-white"
                data-testid="button-connect-calendar"
              >
                <Calendar className="w-4 h-4 mr-1.5" />
                Connect calendar
              </Button>
            )}
          </div>
        )}
      </div>

      {(isAdmin || isMediator) && (
        <Card
          className="border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20"
          data-testid="card-calendar-availability-help"
        >
          <CardContent className="flex items-start gap-3 p-4">
            <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-blue-950 dark:text-blue-100" data-testid="text-calendar-availability-help-title">
                {isMediator ? "Add availability from your calendar" : "Mediators can add availability from their calendar"}
              </p>
              <p className="mt-1 text-sm text-blue-900/90 dark:text-blue-200/90">
                {isMediator
                  ? "You can add available times from your connected Google Calendar or Outlook:"
                  : "Ask the mediator to create an event in their connected Google Calendar or Outlook:"}
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-blue-900 dark:text-blue-200" data-testid="list-calendar-availability-steps">
                <li>{isMediator ? "Create an event for the time you are available." : "Add the time they are available."}</li>
                <li>Invite <span className="font-medium">info@brighterfuturemediation.co.uk</span>.</li>
                <li>Name the event so it begins with <span className="font-medium">BFM availability</span> or <span className="font-medium">BFM available</span>, for example <span className="font-medium">BFM availability - MIAM</span> or <span className="font-medium">BFM available - MIAM</span>.</li>
              </ol>
              <p className="mt-2 text-sm text-blue-900/90 dark:text-blue-200/90">
                Capital letters do not matter. BFM will add this time to every service {isMediator ? "you are" : "the mediator is"} approved to provide.
                {isMediator && " Only add times that clients can book."}
              </p>
              <p className="mt-2 text-sm text-blue-900/90 dark:text-blue-200/90">
                An all-day event makes {isMediator ? "you" : "the mediator"} available for the whole day.
              </p>
              {availabilityImportStatusError ? (
                <p className="mt-2 text-sm text-blue-900/90 dark:text-blue-200/90" data-testid="text-calendar-availability-status-error">
                  BFM could not check whether calendar availability is turned on. Please try again later.
                </p>
              ) : null}
              {isMediator && !activeCalendarReady && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 border-blue-300 bg-white text-blue-900 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950"
                  onClick={() => setCalendarSettingsOpen(true)}
                  data-testid="button-calendar-availability-connect"
                >
                  <Calendar className="mr-1.5 h-4 w-4" />
                  Connect calendar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isMediator && calStatus?.configured && !activeCalendarReady && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4"
          data-testid="banner-calendar-provider-required"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-amber-900 dark:text-amber-100">
              {hasConnectedProvider ? "Choose active calendar provider" : "Connect your calendar"}
            </p>
            <p className="text-sm text-amber-800/90 dark:text-amber-200/90 mt-0.5">
              {hasConnectedProvider
                ? "You have a calendar connected, but BFM needs you to choose which provider should sync appointments."
                : "Connect Google Calendar or Microsoft Outlook so BFM can show your calendar status and synced appointment blocks."}
            </p>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => hasConnectedProvider ? navigate("/settings") : setCalendarSettingsOpen(true)}
            data-testid="button-calendar-provider-required"
          >
            {hasConnectedProvider ? "Open settings" : "Connect calendar"}
          </Button>
        </div>
      )}

      {isMediator && activeCalendarNeedsReauth && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4"
          data-testid="banner-calendar-needs-reauth"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-amber-900 dark:text-amber-100">
              Your {activeCalendarProviderLabel} needs to be reconnected
            </p>
            <p className="text-sm text-amber-800/90 dark:text-amber-200/90 mt-0.5">
              Authorisation has expired, so we're no longer syncing your events. Reconnect to resume automatic sync.
            </p>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => setCalendarSettingsOpen(true)}
            data-testid="button-reconnect-calendar"
          >
            Reconnect
          </Button>
        </div>
      )}

      {isMediator && activeCalendarNeedsWriteScope === true && (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4"
          data-testid="banner-calendar-needs-write-scope"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-amber-900 dark:text-amber-100">
              Reconnect {activeCalendarProviderLabel} to enable booking
            </p>
            <p className="text-sm text-amber-800/90 dark:text-amber-200/90 mt-0.5">
              Client bookings now write directly to your calendar. Reconnect and grant edit permission so we can split your availability events when a slot is booked.
            </p>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => setCalendarSettingsOpen(true)}
            data-testid="button-grant-write-scope"
          >
            Reconnect
          </Button>
        </div>
      )}

      {isMediator && (
        <CalendarConnectModal
          open={calendarSettingsOpen}
          onOpenChange={setCalendarSettingsOpen}
          mode="manage"
          connectedEmail={activeCalendarEmail}
          connectedProvider={activeCalendarProvider ?? (calStatus?.googleCalendarConnected ? "google" : calStatus?.outlookCalendarConnected ? "outlook" : null)}
          needsReauth={activeCalendarNeedsReauth}
          returnTo="appointments"
        />
      )}

      <Tabs defaultValue="calendar" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList data-testid="tabs-view-toggle">
            <TabsTrigger value="calendar" data-testid="tab-calendar">
              <CalendarDays className="w-4 h-4 mr-1.5" />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="list" data-testid="tab-list">
              <List className="w-4 h-4 mr-1.5" />
              List
            </TabsTrigger>
          </TabsList>

          {!isClient && (
            <div className="flex flex-wrap items-center gap-2" data-testid="appointments-shared-filters">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] h-9" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="hold">Payment hold</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>

              {isAdmin && mediators?.data && (
                <Select value={mediatorFilter} onValueChange={setMediatorFilter}>
                  <SelectTrigger className="w-[200px] h-9" data-testid="select-mediator-filter">
                    <SelectValue placeholder="Mediator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All mediators</SelectItem>
                    {mediators.data.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        <TabsContent value="calendar">
          <Card>
            <CardContent className="p-4">
              {adminAllMediators && allMediatorsSyncing && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3" data-testid="text-syncing-all-calendars">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>Syncing all mediator calendars…</span>
                </div>
              )}
              <WeeklyCalendar
                appointments={calFiltered}
                personalEvents={personalEventsEnabled ? personalEvents : []}
                currentDate={currentDate}
                onDateChange={setCurrentDate}
                onAppointmentClick={handleAppointmentClick}
                onPersonalEventClick={(ev) => setSelectedPersonalEvent(ev)}
                isClient={isClient}
              />
              {isMediator && activeCalendarReady && !personalEventsLoading && personalEvents.length === 0 && (
                <p className="text-[11px] text-muted-foreground/70 text-center mt-3" data-testid="text-no-bfm-google-events">
                  {activeCalendarProviderLabel} connected - no BFM-related events in this period yet
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-[160px] h-9"
                    data-testid="input-date-from"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-[160px] h-9"
                    data-testid="input-date-to"
                  />
                </div>
              </div>

              {sortedForList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Calendar className="w-12 h-12 text-muted-foreground/40 mb-4" />
                  <h3 className="text-lg font-heading font-semibold mb-1" data-testid="text-no-appointments">No Appointments Found</h3>
                  <p className="text-sm text-muted-foreground">No appointments match the current filters for the selected date range.</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table data-testid="table-appointments">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <SortableTableHead
                          label="Date / Time"
                          sortKey="dateTime"
                          currentSortBy={sortBy}
                          currentSortOrder={sortOrder}
                          onSort={handleSort}
                          className="text-xs"
                          testId="sort-dateTime"
                        />
                        <SortableTableHead
                          label="Client"
                          sortKey="client"
                          currentSortBy={sortBy}
                          currentSortOrder={sortOrder}
                          onSort={handleSort}
                          className="text-xs"
                          testId="sort-client"
                        />
                        <SortableTableHead
                          label="Service Type"
                          sortKey="service"
                          currentSortBy={sortBy}
                          currentSortOrder={sortOrder}
                          onSort={handleSort}
                          className="text-xs"
                          testId="sort-service"
                        />
                        {!isClient && (
                          <SortableTableHead
                            label="Mediator"
                            sortKey="mediator"
                            currentSortBy={sortBy}
                            currentSortOrder={sortOrder}
                            onSort={handleSort}
                            className="text-xs"
                            testId="sort-mediator"
                          />
                        )}
                        {!isClient && (
                          <SortableTableHead
                            label="Case Ref"
                            sortKey="caseRef"
                            currentSortBy={sortBy}
                            currentSortOrder={sortOrder}
                            onSort={handleSort}
                            className="text-xs"
                            testId="sort-caseRef"
                          />
                        )}
                        <SortableTableHead
                          label="Status"
                          sortKey="status"
                          currentSortBy={sortBy}
                          currentSortOrder={sortOrder}
                          onSort={handleSort}
                          className="text-xs"
                          testId="sort-status"
                        />
                        <TableHead className="text-xs">Meeting Link</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedForList.map((appt) => {
                        const dt = appointmentWallClockDate(appt.dateTime, appt.dateTimeBasis ?? "wall_clock_utc");
                        const endDt = new Date(dt.getTime() + appt.duration * 60000);
                        const style = APPT_STATUS_STYLES[appt.status] || APPT_STATUS_STYLES.hold;

                        return (
                          <TableRow
                            key={appt.id}
                            className={`${appt.status === "cancelled" || appt.status === "expired" ? "opacity-50" : "cursor-pointer hover:bg-muted/30"}`}
                            onClick={appt.status === "cancelled" || appt.status === "expired" ? undefined : () => handleAppointmentClick(appt)}
                            data-testid={`row-appt-${appt.id}`}
                          >
                            <TableCell className="text-xs">
                              <div className="font-medium">
                                {dt.toLocaleDateString("en-GB", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                  timeZone: "UTC",
                                })}
                              </div>
                              <div className="text-muted-foreground">
                                {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
                                {" – "}
                                {endDt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs" data-testid={`text-client-${appt.id}`}>
                              {appt.partyName || "—"}
                            </TableCell>
                            <TableCell className="text-xs" data-testid={`text-service-${appt.id}`}>
                              {appt.serviceName || "—"}
                            </TableCell>
                            {!isClient && (
                              <TableCell className="text-xs" data-testid={`text-mediator-${appt.id}`}>
                                {appt.mediatorName || "Unassigned"}
                              </TableCell>
                            )}
                            {!isClient && (
                              <TableCell className="text-xs font-mono" data-testid={`text-case-ref-${appt.id}`}>
                                {appt.caseReference || "—"}
                              </TableCell>
                            )}
                            <TableCell>
                              <Badge className={`${style.bg} ${style.text} border-none text-xs`} data-testid={`badge-status-${appt.id}`}>
                                {style.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                {isClient && appt.canJoin && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-[10px] px-2"
                                    onClick={() => void joinAppointment(appt.id)}
                                    disabled={joiningAppointmentId === appt.id}
                                    data-testid={`button-join-meeting-${appt.id}`}
                                  >
                                    {joiningAppointmentId === appt.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                                    Join
                                  </Button>
                                )}
                                {!isClient && appt.meetingLink && appt.status === "confirmed" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-[10px] px-2"
                                    onClick={() => void joinAppointment(appt.id)}
                                    disabled={joiningAppointmentId === appt.id}
                                    data-testid={`button-join-meeting-${appt.id}`}
                                  >
                                    {joiningAppointmentId === appt.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                                    Open
                                  </Button>
                                )}
                                {isAdmin && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-[10px] px-2"
                                    onClick={() => handleMeetingLinkClick(appt)}
                                    data-testid={`button-edit-meeting-link-${appt.id}`}
                                  >
                                    {appt.meetingLink ? <Pencil className="w-3 h-3" /> : <Link2 className="w-3 h-3" />}
                                  </Button>
                                )}
                                {!appt.meetingLink && !appt.hasMeetingLink && !isAdmin && (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <MeetingLinkDialog
        open={meetingLinkDialog}
        onOpenChange={setMeetingLinkDialog}
        appointment={selectedAppointment}
        onSave={handleSaveMeetingLink}
      />

      <PersonalEventDetailsSheet
        event={selectedPersonalEvent}
        onOpenChange={(o) => { if (!o) setSelectedPersonalEvent(null); }}
      />

      <AppointmentDetailsSheet
        appointment={selectedApptSheet}
        isAdmin={isAdmin}
        canManage={canEditAppointments}
        isClient={isClient}
        isMediator={isMediator}
        onOpenChange={(o) => { if (!o) setSelectedApptSheet(null); }}
        onViewCase={(caseId) => { setSelectedApptSheet(null); navigate(`/cases/${caseId}`); }}
        onJoin={(id) => void joinAppointment(id)}
        onCancel={(id) => cancelAppointmentMutation.mutate(id)}
        onRequestCancellation={(id, reason) => requestCancellationMutation.mutate({ id, reason })}
        onDelete={(id) => deleteAppointmentMutation.mutate(id)}
        isJoining={joiningAppointmentId === selectedApptSheet?.id}
        isCancelling={cancelAppointmentMutation.isPending}
        isRequestingCancellation={requestCancellationMutation.isPending}
        isDeleting={deleteAppointmentMutation.isPending}
      />
      <AppointmentJoinFallbackDialog meetingLink={fallbackMeetingLink} onClose={clearFallbackMeetingLink} />
    </div>
  );
}

function parseApiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  try {
    const match = err.message.match(/^\d+: ([\s\S]+)$/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      return parsed.message || parsed.error || match[1];
    }
  } catch { /* ignore */ }
  return err.message || fallback;
}

function formatUkDateTime(iso: string): { date: string; time: string } {
  const { date, time } = getLondonInstantDateTimeParts(iso);
  const [year, month, day] = date.split("-").map(Number);
  return {
    date: new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
    time,
  };
}

function formatDuration(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function PersonalEventDetailsSheet({
  event,
  onOpenChange,
}: {
  event: PersonalEventData | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!event;
  if (!event) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const color = resolveMediatorColor(event.mediatorId, event.mediatorAvailabilityColor);
  const start = formatUkDateTime(event.startAt);
  const end = formatUkDateTime(event.endAt);
  const sameDay = start.date === end.date;
  const status = (event.bfmAttendanceStatus ?? "").toLowerCase();
  const statusLabel = event.isOrganiser
    ? "Organiser"
    : status === "accepted"
      ? "Accepted"
      : status === "tentative"
        ? "Tentative"
        : status === "declined"
          ? "Declined"
          : status
            ? status.charAt(0).toUpperCase() + status.slice(1)
            : "Unknown";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" data-testid="sheet-personal-event-details">
        <SheetHeader className="space-y-2" data-testid="sheet-personal-event-header">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <SheetTitle className="font-heading text-lg" data-testid="text-personal-event-mediator">
              {event.mediatorName || "Available slot"}
            </SheetTitle>
          </div>
          <SheetDescription>
            Available bookable slot from this mediator&apos;s connected calendar. Times shown in UK time (Europe/London).
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {event.mediatorEmail && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Mediator email</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-mediator-email">{event.mediatorEmail}</div>
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Title</div>
            <div className="text-sm mt-0.5" data-testid="text-personal-event-title">
              {event.title || <span className="text-muted-foreground italic">No title</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Start</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-start">
                {start.date}
                <br />
                <span className="font-medium">{start.time}</span>
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">End</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-end">
                {sameDay ? <span className="text-muted-foreground">Same day</span> : start.date === end.date ? null : end.date}
                {!sameDay && <br />}
                <span className="font-medium">{end.time}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Duration</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-duration">
                {formatDuration(event.startAt, event.endAt)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">All day</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-all-day">
                {event.isAllDay ? "Yes" : "No"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">BFM status</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-status">{statusLabel}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">BFM organiser</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-organiser">
                {event.isOrganiser ? "Yes" : "No"}
              </div>
            </div>
          </div>

          {Array.isArray(event.attendees) && event.attendees.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Attendees</div>
              <ul className="mt-1 space-y-1.5" data-testid="list-personal-event-attendees">
                {event.attendees.map((a, idx) => {
                  const hasBoth = !!a.displayName && a.displayName !== a.email;
                  const isBfmMailbox = !!event.bfmCalendarEmail && a.email.toLowerCase() === event.bfmCalendarEmail.toLowerCase();
                  const bfmOverride =
                    isBfmMailbox &&
                    a.responseStatus === "needsAction" &&
                    (event.bfmAttendanceStatus === "accepted" || event.bfmAttendanceStatus === "organiser");
                  const displayStatus = bfmOverride ? (event.bfmAttendanceStatus ?? a.responseStatus) : a.responseStatus;
                  return (
                    <li key={`${a.email}-${idx}`} className="text-sm flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {hasBoth ? (
                          <>
                            <div className="truncate">{a.displayName}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{a.email}</div>
                          </>
                        ) : (
                          <div className="truncate">{a.email}</div>
                        )}
                        {bfmOverride && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Internal BFM status — not yet synced to Google
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide shrink-0">
                        {displayStatus}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {event.syncedAt && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Last synced</div>
              <div className="text-sm mt-0.5" data-testid="text-personal-event-synced-at">
                {formatDistanceToNow(new Date(event.syncedAt), { addSuffix: true })}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AppointmentDetailsSheet({
  appointment,
  isAdmin,
  canManage,
  isClient,
  isMediator,
  onOpenChange,
  onViewCase,
  onJoin,
  onCancel,
  onRequestCancellation,
  onDelete,
  isJoining,
  isCancelling,
  isRequestingCancellation,
  isDeleting,
}: {
  appointment: AppointmentData | null;
  isAdmin: boolean;
  canManage: boolean;
  isClient: boolean;
  isMediator: boolean;
  onOpenChange: (open: boolean) => void;
  onViewCase: (caseId: string) => void;
  onJoin: (id: string) => void;
  onCancel: (id: string) => void;
  onRequestCancellation: (id: string, reason: string) => void;
  onDelete: (id: string) => void;
  isJoining: boolean;
  isCancelling: boolean;
  isRequestingCancellation: boolean;
  isDeleting: boolean;
}) {
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestCancelOpen, setRequestCancelOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const open = !!appointment;
  const retryCalendarSyncMutation = useMutation({
    mutationFn: async (appointmentId: string) => {
      const response = await apiRequest("POST", `/api/appointments/${appointmentId}/calendar-sync/retry`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      toast({ title: "Calendar synchronization queued", description: "The appointment remains confirmed while calendar synchronization retries." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not retry calendar synchronization", description: error.message, variant: "destructive" });
    },
  });

  if (!appointment) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const style = APPT_STATUS_STYLES[appointment.status] || APPT_STATUS_STYLES.hold;
  const dt = appointmentWallClockDate(appointment.dateTime, appointment.dateTimeBasis ?? "wall_clock_utc");
  const endDt = new Date(dt.getTime() + appointment.duration * 60000);
  const dateLabel = dt.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const timeStart = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  const timeEnd = endDt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

  const canCancel = canManage && (appointment.status === "hold" || appointment.status === "held" || appointment.status === "confirmed");
  const canDelete = isAdmin && (appointment.status === "hold" || appointment.status === "held" || appointment.status === "cancelled" || appointment.status === "expired");
  const isFutureAppointment = new Date(appointment.dateTime).getTime() > Date.now();
  const canRequestCancellation = !isAdmin && (isMediator || isClient)
    && (appointment.status === "hold" || appointment.status === "held" || appointment.status === "confirmed")
    && isFutureAppointment;

  const statusLabel = style.label;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto flex flex-col" data-testid="sheet-appointment-details">
          <SheetHeader className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`${style.bg} ${style.text} border-none text-xs shrink-0`} data-testid="badge-appt-status">
                {statusLabel}
              </Badge>
              <SheetTitle className="font-heading text-lg leading-tight" data-testid="text-appt-service">
                {appointment.serviceName || "Appointment"}
              </SheetTitle>
            </div>
            <SheetDescription data-testid="text-appt-case-ref">
              {appointment.caseReference ? (
                <>
                  Case ref:{" "}
                  <button
                    onClick={() => onViewCase(appointment.caseId)}
                    className="font-mono font-medium text-foreground underline-offset-2 hover:underline focus:outline-none"
                    data-testid="link-appt-case-ref"
                  >
                    {appointment.caseReference}
                  </button>
                </>
              ) : (
                "No case reference"
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5 flex-1">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium" data-testid="text-appt-date">{dateLabel}</div>
                <div className="text-sm text-muted-foreground" data-testid="text-appt-time">
                  {timeStart} – {timeEnd} ({appointment.duration} min)
                </div>
              </div>
            </div>

            {appointment.partyName && (
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Client</div>
                  <div className="text-sm" data-testid="text-appt-client">{appointment.partyName}</div>
                </div>
              </div>
            )}

            {appointment.mediatorName && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Mediator</div>
                <div className="text-sm mt-0.5" data-testid="text-appt-mediator">{appointment.mediatorName}</div>
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Payment status</div>
              <div className="text-sm mt-0.5" data-testid="text-appt-payment-status">
                {PAYMENT_STATUS_LABELS[appointment.paymentStatus || "payment_pending"] || "Payment pending"}
              </div>
            </div>

            {isAdmin && appointment.calendarSync && (
              <div className="rounded-md border p-3" data-testid="appointment-calendar-sync-status">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Calendar synchronization</div>
                <div className="text-sm font-medium mt-1 capitalize">
                  {appointment.calendarSync.status.replace("_", " ")}
                </div>
                {appointment.calendarSync.failureStage && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Failed side: {appointment.calendarSync.failureStage === "mediator_calendar" ? "Mediator calendar" : "BFM client calendar"}
                    {appointment.calendarSync.lastErrorCode ? ` (${appointment.calendarSync.lastErrorCode})` : ""}
                  </p>
                )}
                {appointment.calendarSync.lastAttemptAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last attempt: {formatHistoryDate(appointment.calendarSync.lastAttemptAt)}
                  </p>
                )}
                {appointment.calendarSync.status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => retryCalendarSyncMutation.mutate(appointment.id)}
                    disabled={retryCalendarSyncMutation.isPending}
                    data-testid="button-retry-calendar-sync"
                  >
                    {retryCalendarSyncMutation.isPending ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
                    Retry calendar sync
                  </Button>
                )}
              </div>
            )}

            {isClient && appointment.canJoin && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Meeting link</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-8 gap-1.5"
                  onClick={() => onJoin(appointment.id)}
                  disabled={isJoining}
                  data-testid="button-appt-join"
                >
                  {isJoining ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                  Join video call
                </Button>
              </div>
            )}

            {!isClient && appointment.meetingLink && appointment.status === "confirmed" && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Meeting link</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-8 gap-1.5"
                  onClick={() => onJoin(appointment.id)}
                  disabled={isJoining}
                  data-testid="button-appt-join"
                >
                  {isJoining ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                  Join video call
                </Button>
              </div>
            )}

            {appointment.notes && (
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Notes</div>
                  <div className="text-sm whitespace-pre-wrap" data-testid="text-appt-notes">{appointment.notes}</div>
                </div>
              </div>
            )}

            {appointment.parentEventOriginalStart && appointment.parentEventOriginalEnd && (
              <div className="rounded-md border border-dashed p-3 bg-muted/30">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Carved from availability slot</div>
                <div className="text-sm font-medium" data-testid="text-appt-parent-title">
                  {appointment.parentEventOriginalTitle || "Available"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5" data-testid="text-appt-parent-range">
                  {appointmentWallClockDate(appointment.parentEventOriginalStart, appointment.dateTimeBasis ?? "wall_clock_utc").toLocaleString("en-GB", {
                    weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
                  })}
                  {" – "}
                  {appointmentWallClockDate(appointment.parentEventOriginalEnd, appointment.dateTimeBasis ?? "wall_clock_utc").toLocaleTimeString("en-GB", {
                    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
                  })}
                </div>
              </div>
            )}

            {/* Calendar events visible to all staff (superadmin/subadmin/mediator).
                Backend redacts the BFM-side client email + organiser for mediators.
                Each card has Open in Google + Edit/reschedule entrypoints; both
                trigger the same case-page navigation since reschedule is
                handled there and mirrors automatically across the two events. */}
            <CalendarEventsSection
              appointmentId={appointment.id}
              caseId={appointment.caseId}
              onViewCase={onViewCase}
            />
            <AppointmentHistoryList appointmentId={appointment.id} />
          </div>

          <div className="mt-6 pt-4 border-t space-y-2">
            <Button
              className="w-full bg-[#5a7d58] hover:bg-[#4a6d48] text-white"
              onClick={() => onViewCase(appointment.caseId)}
              data-testid="button-view-case-details"
            >
              <ArrowUpRight className="w-4 h-4 mr-2" />
              View case details
            </Button>

            {canCancel && (
              <Button
                variant="outline"
                className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => setConfirmCancel(true)}
                disabled={isCancelling || isDeleting}
                data-testid="button-cancel-appointment"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Cancel appointment
              </Button>
            )}

            {canRequestCancellation && (
              <Button
                variant="outline"
                className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => {
                  setCancellationReason("");
                  setRequestCancelOpen(true);
                }}
                disabled={isRequestingCancellation}
                data-testid="button-request-cancellation"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Request cancellation
              </Button>
            )}

            {canDelete && (
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/5"
                onClick={() => setConfirmDelete(true)}
                disabled={isCancelling || isDeleting}
                data-testid="button-delete-appointment"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete appointment
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent data-testid="dialog-confirm-cancel-appointment">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              The mediator&apos;s availability will be restored and the client will be notified by email.
              The appointment record will remain visible as cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-appointment-no">Keep appointment</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => {
                setConfirmCancel(false);
                onCancel(appointment.id);
              }}
              disabled={isCancelling}
              data-testid="button-cancel-appointment-confirm"
            >
              {isCancelling ? "Cancelling…" : "Yes, cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={requestCancelOpen} onOpenChange={setRequestCancelOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-request-cancellation">
          <DialogHeader>
            <DialogTitle>Request cancellation</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancellation-reason">Reason</Label>
            <Textarea
              id="cancellation-reason"
              rows={4}
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              placeholder="Please tell BFM why this meeting needs to be cancelled"
              data-testid="input-cancellation-reason"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRequestCancelOpen(false)}
              disabled={isRequestingCancellation}
              data-testid="button-request-cancellation-close"
            >
              Keep appointment
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={() => {
                if (!cancellationReason.trim()) return;
                onRequestCancellation(appointment.id, cancellationReason);
                setRequestCancelOpen(false);
              }}
              disabled={isRequestingCancellation || !cancellationReason.trim()}
              data-testid="button-request-cancellation-submit"
            >
              {isRequestingCancellation ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="dialog-confirm-delete-appointment">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the appointment record. This cannot be undone.
              {(appointment.status === "hold" || appointment.status === "held") && " The CRM payment hold will be released."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-appointment-no">Keep appointment</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => {
                setConfirmDelete(false);
                onDelete(appointment.id);
              }}
              disabled={isDeleting}
              data-testid="button-delete-appointment-confirm"
            >
              {isDeleting ? "Deleting…" : "Yes, delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface CalendarEventData {
  googleEventId: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  attendees: { email: string; displayName?: string; responseStatus?: string }[];
  organizerEmail: string | null;
  htmlLink: string | null;
  fetchedAt: string;
}

interface CalendarEventsResponse {
  mediatorEvent: CalendarEventData | null;
  bfmEvent: CalendarEventData | null;
}

function CalendarEventsSection({
  appointmentId,
  caseId,
  onViewCase,
}: {
  appointmentId: string;
  caseId: string;
  onViewCase: (caseId: string) => void;
}) {
  const { data, isLoading, isError } = useQuery<CalendarEventsResponse>({
    queryKey: ["/api/appointments", appointmentId, "calendar-events"],
    refetchOnWindowFocus: false,
  });
  const onReschedule = () => onViewCase(caseId);

  if (isLoading) {
    return (
      <div className="rounded-md border p-3 bg-muted/20" data-testid="section-calendar-events-loading">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Calendar events</div>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (isError || (!data?.mediatorEvent && !data?.bfmEvent)) {
    return (
      <div className="rounded-md border p-3 bg-muted/20" data-testid="section-calendar-events-empty">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Calendar events</div>
        <div className="text-xs text-muted-foreground">
          No Google calendar events linked to this appointment yet.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="section-calendar-events">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Calendar events</div>
      <CalendarEventCard
        title="Mediator-side event"
        subtitle="Mediator's Google calendar"
        event={data.mediatorEvent}
        testid="card-calendar-event-mediator"
        onReschedule={onReschedule}
      />
      <CalendarEventCard
        title="Client-side event (info@)"
        subtitle="Brighter Future Mediation organisation calendar"
        event={data.bfmEvent}
        testid="card-calendar-event-bfm"
        onReschedule={onReschedule}
      />
    </div>
  );
}

function CalendarEventCard({
  title,
  subtitle,
  event,
  testid,
  onReschedule,
}: {
  title: string;
  subtitle: string;
  event: CalendarEventData | null;
  testid: string;
  onReschedule?: () => void;
}) {
  if (!event) {
    return (
      <div className="rounded-md border border-dashed p-3 bg-muted/20" data-testid={`${testid}-missing`}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-sm font-medium">{title}</div>
          <Badge variant="outline" className="text-[10px]">Not linked</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
    );
  }
  const fetchedAt = new Date(event.fetchedAt);
  const startDate = event.start ? new Date(event.start) : null;
  const endDate = event.end ? new Date(event.end) : null;
  const dateLabel = startDate
    ? startDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : null;
  const timeLabel = startDate && endDate
    ? `${startDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} – ${endDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : null;
  // The Google event itself doesn't carry an explicit "status" field beyond
  // existence; an event we can read (kind === "found", non-cancelled) is
  // effectively confirmed on the calendar. Show that as the per-card status
  // so staff can see at a glance both legs are live.
  const statusLabel = "Confirmed on calendar";
  return (
    <div className="rounded-md border p-3 bg-card" data-testid={testid}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className="text-[10px]" data-testid={`${testid}-status`}>
          {statusLabel}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mb-2">{subtitle}</div>
      {dateLabel && (
        <div className="text-xs mb-1" data-testid={`${testid}-date`}>
          <span className="text-muted-foreground">Date:</span> {dateLabel}
        </div>
      )}
      {timeLabel && (
        <div className="text-xs mb-1" data-testid={`${testid}-time`}>
          <span className="text-muted-foreground">Time:</span> {timeLabel}
        </div>
      )}
      {event.summary && (
        <div className="text-xs mb-1">
          <span className="text-muted-foreground">Title:</span> {event.summary}
        </div>
      )}
      {event.organizerEmail && (
        <div className="text-xs mb-1">
          <span className="text-muted-foreground">Organiser:</span> {event.organizerEmail}
        </div>
      )}
      {event.attendees.length > 0 && (
        <div className="text-xs mb-1">
          <span className="text-muted-foreground">Attendees:</span>
          <ul className="ml-3 list-disc space-y-0.5 mt-1">
            {event.attendees.map(a => (
              <li key={a.email} className="break-all">
                {a.displayName ? `${a.displayName} (${a.email})` : a.email}
                {a.responseStatus && a.responseStatus !== "needsAction" && (
                  <span className="ml-1 text-[10px] text-muted-foreground">— {a.responseStatus}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-2">
        <div className="text-[10px] text-muted-foreground">
          Last synced: {fetchedAt.toLocaleString()}
        </div>
        <div className="flex items-center gap-3">
          {event.htmlLink && (
            <a
              href={event.htmlLink}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] inline-flex items-center gap-1 text-[#5a7d58] hover:underline"
              data-testid={`${testid}-open-in-google`}
            >
              <ArrowUpRight className="w-3 h-3" />
              Open in Google
            </a>
          )}
          {onReschedule && (
            <button
              type="button"
              onClick={onReschedule}
              className="text-[11px] inline-flex items-center gap-1 text-[#5a7d58] hover:underline"
              data-testid={`${testid}-reschedule`}
            >
              Edit / reschedule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
