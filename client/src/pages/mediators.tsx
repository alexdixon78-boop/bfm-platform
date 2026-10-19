import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/ui/password-field";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Info, Pencil, Trash2, UserCheck, Search, Video, Mail, Calendar, CheckCircle2, RefreshCw, Unlink, Clock, AlertTriangle, KeyRound } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { SiGoogle } from "react-icons/si";
import { getMediationRoleQualificationLabel, MEDIATION_ROLE_QUALIFICATIONS } from "@shared/schema";
import type { GoogleCalendarEvent, MediationRoleQualification } from "@shared/schema";
import { StatCard } from "@/components/shared/stat-card";
import { AvatarCell } from "@/components/shared/avatar-cell";
import { PageHeader } from "@/components/shared/page-header";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { PaginationControls } from "@/components/shared/pagination";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { autoColorFromMediatorId } from "@/components/shared/weekly-calendar";
import type { PaginatedResponse } from "@shared/schema";

type ServiceType = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
};

type MediatorServiceLink = {
  id: string;
  mediatorId: string;
  serviceTypeId: string;
  mediationRoleQualification: MediationRoleQualification;
};

type CalendarProvider = "google" | "outlook";

type Mediator = {
  id: string;
  email: string;
  name: string;
  role: string;
  status?: string;
  assignedCasesCount: number;
  activeCasesCount: number;
  appointmentsCount?: number;
  zoomLink?: string | null;
  googleCalendarConnected?: boolean;
  googleCalendarEmail?: string | null;
  lastCalendarSyncAt?: string | null;
  lastCalendarSyncError?: string | null;
  outlookCalendarConnected?: boolean;
  outlookCalendarEmail?: string | null;
  lastOutlookSyncAt?: string | null;
  lastOutlookSyncError?: string | null;
  activeCalendarProvider?: CalendarProvider | null;
  availabilityColor?: string | null;
  mediationRoleQualification: MediationRoleQualification;
};

type DeleteResponse = {
  success: boolean;
  archived: boolean;
  deleted: boolean;
  references: { appointments: number; cases: number };
  message: string;
};

const SERVICE_CATEGORY_COLORS: Record<string, string> = {
  "MIAM": "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30",
  "Mediation": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  "Court & Documentation": "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30",
  "Packages": "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800",
};

const TABLE_COLS = 5;

function getMediatorCalendarStatus(mediator: Mediator) {
  const googleConnected = (mediator.activeCalendarProvider === "google" && !!mediator.googleCalendarConnected)
    || (!mediator.activeCalendarProvider && !!mediator.googleCalendarConnected);
  const outlookConnected = (mediator.activeCalendarProvider === "outlook" && !!mediator.outlookCalendarConnected)
    || (!mediator.activeCalendarProvider && !!mediator.outlookCalendarConnected);
  const connected = googleConnected || outlookConnected;
  const provider: CalendarProvider | null = googleConnected
    ? "google"
    : outlookConnected
      ? "outlook"
      : mediator.activeCalendarProvider ?? null;
  const label = provider === "outlook" ? "Microsoft Outlook" : provider === "google" ? "Google Calendar" : "Calendar";
  const email = provider === "outlook" ? mediator.outlookCalendarEmail ?? null : provider === "google" ? mediator.googleCalendarEmail ?? null : null;
  const lastSyncAt = provider === "outlook" ? mediator.lastOutlookSyncAt ?? null : provider === "google" ? mediator.lastCalendarSyncAt ?? null : null;
  const lastSyncError = provider === "outlook" ? mediator.lastOutlookSyncError ?? null : provider === "google" ? mediator.lastCalendarSyncError ?? null : null;
  const needsReconnect = connected && (lastSyncError === "needs_write_scope" || lastSyncError === "needs_reauth");

  return { connected, provider, label, email, lastSyncAt, lastSyncError, needsReconnect };
}

export default function MediatorsPage() {
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const { user } = useAuth();
  const canDeleteMediators = user?.role === "superadmin" || user?.role === "subadmin";
  const canManageMediatorPasswords = (user?.role === "superadmin" || user?.role === "subadmin") && canEdit("mediators");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const mediatorInfoButtonRef = useRef<HTMLButtonElement>(null);
  const [editingMediator, setEditingMediator] = useState<Mediator | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Mediator | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<Mediator | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortDirection>(null);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formMediationRoleQualification, setFormMediationRoleQualification] = useState<MediationRoleQualification | "">("");
  const [formPassword, setFormPassword] = useState("");
  const [formZoomLink, setFormZoomLink] = useState("");
  const [formAvailabilityColor, setFormAvailabilityColor] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedServiceQualifications, setSelectedServiceQualifications] = useState<Record<string, MediationRoleQualification>>({});

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleSort = useCallback((key: string) => {
    if (sortBy === key) {
      if (sortOrder === "desc") setSortOrder("asc");
      else if (sortOrder === "asc") { setSortBy(null); setSortOrder(null); }
      else setSortOrder("desc");
    } else {
      setSortBy(key);
      setSortOrder("desc");
    }
    setPage(1);
  }, [sortBy, sortOrder]);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (sortBy) queryParams.set("sortBy", sortBy);
  if (sortOrder) queryParams.set("sortOrder", sortOrder);

  const { data: paginatedData, isLoading } = useQuery<PaginatedResponse<Mediator>>({
    queryKey: ["/api/mediators", { page, limit, search: debouncedSearch, sortBy, sortOrder }],
    queryFn: async () => {
      const res = await fetch(`/api/mediators?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch mediators");
      return res.json();
    },
  });

  const mediators = paginatedData?.data;
  const totalCount = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const { data: allServiceTypes } = useQuery<ServiceType[]>({
    queryKey: ["/api/service-types"],
    retry: false,
  });

  const { data: allMediatorServices } = useQuery<MediatorServiceLink[]>({
    queryKey: ["/api/mediator-service-types"],
    retry: false,
  });

  const editingCalendarStatus = editingMediator ? getMediatorCalendarStatus(editingMediator) : null;

  const { data: calendarEvents, isLoading: calendarEventsLoading } = useQuery<GoogleCalendarEvent[]>({
    queryKey: [`/api/calendar/events/${editingMediator?.id}`],
    enabled: !!editingMediator?.id && !!editingCalendarStatus?.connected,
    retry: false,
  });

  const activeServiceTypes = allServiceTypes?.filter(s => s.isActive) || [];
  const serviceAssignmentsPayload = selectedServiceIds.map((serviceTypeId) => ({
    serviceTypeId,
    mediationRoleQualification: selectedServiceQualifications[serviceTypeId] ?? "unclassified",
  }));

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password?: string; zoomLink?: string; mediationRoleQualification: MediationRoleQualification }) => {
      const res = await apiRequest("POST", "/api/mediators", data);
      return res.json();
    },
    onSuccess: async (newMediator: Mediator) => {
      if (selectedServiceIds.length > 0 && newMediator?.id) {
        await apiRequest("PUT", `/api/mediators/${newMediator.id}/services`, { services: serviceAssignmentsPayload });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-service-types"] });
      toast({ title: "Mediator created" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to create mediator", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; email: string; password?: string; zoomLink?: string | null; availabilityColor?: string | null; mediationRoleQualification?: MediationRoleQualification } }) => {
      const res = await apiRequest("PATCH", `/api/mediators/${id}`, data);
      return res.json();
    },
    onSuccess: async () => {
      if (editingMediator) {
        await apiRequest("PUT", `/api/mediators/${editingMediator.id}/services`, { services: serviceAssignmentsPayload });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-service-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/events"] });
      toast({ title: "Mediator updated" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to update mediator", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/mediators/${id}`);
      return (await res.json()) as DeleteResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-service-types"] });
      toast({
        title: data.archived ? "Mediator archived" : "Mediator deleted",
        description: data.message,
      });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to remove mediator", variant: "destructive" });
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/mediators/${id}/send-invite`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invite sent", description: "The mediator will receive an email with a link to set up their account." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to send invite", variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async ({ id, password, confirmPassword }: { id: string; password: string; confirmPassword: string }) => {
      const res = await apiRequest("POST", `/api/mediators/${id}/password`, { password, confirmPassword });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      toast({ title: "Password changed", description: "The mediator can now sign in with the new password." });
      closePasswordDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to change password", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingMediator(null);
    setFormName("");
    setFormEmail("");
    setFormMediationRoleQualification("");
    setFormPassword("");
    setFormZoomLink("");
    setFormAvailabilityColor(null);
    setSelectedServiceIds([]);
    setSelectedServiceQualifications({});
    setDialogOpen(true);
  }

  useEffect(() => {
    if (editingMediator && allMediatorServices) {
      const mediatorLinks = allMediatorServices.filter(l => l.mediatorId === editingMediator.id);
      setSelectedServiceIds(mediatorLinks.map(l => l.serviceTypeId));
      setSelectedServiceQualifications(Object.fromEntries(mediatorLinks.map((link) => [
        link.serviceTypeId,
        link.mediationRoleQualification ?? "unclassified",
      ])));
    }
  }, [editingMediator, allMediatorServices]);

  async function openEdit(mediator: Mediator) {
    setEditingMediator(mediator);
    setFormName(mediator.name);
    setFormEmail(mediator.email);
    setFormMediationRoleQualification(mediator.mediationRoleQualification || "unclassified");
    setFormPassword("");
    setFormZoomLink(mediator.zoomLink || "");
    setFormAvailabilityColor(mediator.availabilityColor ?? null);
    const mediatorLinks = allMediatorServices?.filter(l => l.mediatorId === mediator.id) || [];
    setSelectedServiceIds(mediatorLinks.map(l => l.serviceTypeId));
    setSelectedServiceQualifications(Object.fromEntries(mediatorLinks.map((link) => [
      link.serviceTypeId,
      link.mediationRoleQualification ?? "unclassified",
    ])));
    setDialogOpen(true);
  }

  function toggleServiceId(id: string) {
    setSelectedServiceIds(prev => {
      const next = prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id];
      if (!prev.includes(id)) {
        setSelectedServiceQualifications((current) => ({ ...current, [id]: current[id] ?? "unclassified" }));
      }
      return next;
    });
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingMediator(null);
  }

  function openPasswordDialog(mediator: Mediator) {
    setPasswordTarget(mediator);
    setAdminPassword("");
    setConfirmPassword("");
    setPasswordError(null);
  }

  function closePasswordDialog() {
    setPasswordTarget(null);
    setAdminPassword("");
    setConfirmPassword("");
    setPasswordError(null);
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (!passwordTarget) return;
    if (adminPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (adminPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    changePasswordMutation.mutate({ id: passwordTarget.id, password: adminPassword, confirmPassword });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formZoomLink) {
      try {
        const url = new URL(formZoomLink);
        if (url.protocol !== "https:") {
          toast({ title: "Invalid Zoom link", description: "Zoom link must start with https://", variant: "destructive" });
          return;
        }
      } catch {
        toast({ title: "Invalid Zoom link", description: "Please enter a valid URL starting with https://", variant: "destructive" });
        return;
      }
    }
    if (editingMediator) {
      const data: { name: string; email: string; password?: string; zoomLink?: string | null; availabilityColor?: string | null; mediationRoleQualification: MediationRoleQualification } = {
        name: formName,
        email: formEmail,
        mediationRoleQualification: formMediationRoleQualification || "unclassified",
        zoomLink: formZoomLink || null,
        availabilityColor: formAvailabilityColor,
      };
      if (formPassword) data.password = formPassword;
      updateMutation.mutate({ id: editingMediator.id, data });
    } else {
      createMutation.mutate({ name: formName, email: formEmail, password: formPassword || undefined, zoomLink: formZoomLink || undefined, mediationRoleQualification: "unclassified" });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  const totalStatsQuery = useQuery<PaginatedResponse<Mediator>>({
    queryKey: ["/api/mediators", { page: 1, limit: 1, search: "", sortBy: null, sortOrder: null }],
    queryFn: async () => {
      const res = await fetch("/api/mediators?page=1&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const totalMediators = totalStatsQuery.data?.total ?? 0;
  const statsLoading = totalStatsQuery.isLoading;
  const EditingCalendarIcon = editingCalendarStatus?.provider === "outlook" ? Mail : SiGoogle;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="mediators-page">
      <PageHeader
        title="Mediators"
        subtitle="Manage mediator accounts and case assignments"
        icon={UserCheck}
        iconColor="text-[#5a7d58]"
        iconBg="bg-[#a7baa4]/15"
        titleTestId="text-mediators-title"
        action={
          <div className="flex items-center gap-2">
            <Button
              ref={mediatorInfoButtonRef}
              variant="ghost"
              size="icon"
              onClick={() => setInfoOpen(true)}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              aria-label="About Mediators"
              data-testid="button-mediator-info"
            >
              <Info className="w-4 h-4" />
            </Button>
            {canEdit("mediators") && (
              <Button onClick={openCreate} data-testid="button-add-mediator">
                <Plus className="w-4 h-4 mr-2" />
                Add mediator
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total mediators"
          value={totalMediators}
          icon={UserCheck}
          iconColor="text-[#5a7d58]"
          iconBg="bg-[#a7baa4]/15"
          isLoading={statsLoading}
          testId="text-stat-total-mediators"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="pl-9"
            data-testid="input-search-mediators"
          />
        </div>
        {(debouncedSearch) && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton columns={TABLE_COLS} rows={5} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <SortableTableHead label="Mediator" sortKey="name" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-mediator-name" />
                    <SortableTableHead label="Email" sortKey="email" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-mediator-email" />
                    <TableHead>Qualification</TableHead>
                    <TableHead>Services</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mediators && mediators.length > 0 ? mediators.map(m => {
                    const calendarStatus = getMediatorCalendarStatus(m);
                    const CalendarProviderIcon = calendarStatus.provider === "outlook" ? Mail : SiGoogle;
                    return (
                    <TableRow key={m.id} className="hover:bg-muted/20" data-testid={`row-mediator-${m.id}`}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Link href={`/mediators/${m.id}`} data-testid={`link-mediator-${m.id}`} className="hover:underline">
                            <AvatarCell
                              name={m.name}
                              bgClass="bg-[#a7baa4]/20"
                              textClass="text-[#5a7d58]"
                              testId={`text-mediator-name-${m.id}`}
                            />
                          </Link>
                          {m.status === "pending" ? (
                            <span className="ml-8 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 w-fit" data-testid={`badge-pending-invite-${m.id}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                              Pending invite
                            </span>
                          ) : calendarStatus.needsReconnect ? (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="ml-8 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full w-fit cursor-default bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
                                    data-testid={`badge-calendar-needs-write-scope-${m.id}`}
                                  >
                                    <CalendarProviderIcon className="w-2.5 h-2.5" />
                                    {calendarStatus.label}
                                    <AlertTriangle className="w-3 h-3" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {calendarStatus.lastSyncError === "needs_reauth"
                                    ? `${calendarStatus.label} must be reconnected`
                                    : "Booking paused — must reconnect with full permissions"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : calendarStatus.connected ? (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="ml-8 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full w-fit cursor-default bg-[#a7baa4]/15 text-[#5a7d58] border border-[#a7baa4]/30"
                                    data-testid={`badge-calendar-connected-${m.id}`}
                                  >
                                    <CalendarProviderIcon className="w-2.5 h-2.5" />
                                    {calendarStatus.label}
                                    <CheckCircle2 className="w-3 h-3" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {calendarStatus.email
                                    ? `Connected as ${calendarStatus.email}`
                                    : `${calendarStatus.label} connected`}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span
                              className="ml-8 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 w-fit"
                              data-testid={`badge-calendar-not-connected-${m.id}`}
                            >
                              <Calendar className="w-2.5 h-2.5" />
                              Calendar not connected
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-mediator-email-${m.id}`}>
                        <div className="flex items-center gap-1.5">
                          <span>{m.email}</span>
                          {m.zoomLink && <span title="Zoom link configured"><Video className="w-3.5 h-3.5 text-blue-600 shrink-0" /></span>}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`cell-mediator-qualification-${m.id}`}>
                        <Badge variant="outline">
                          {getMediationRoleQualificationLabel(m.mediationRoleQualification)}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`cell-mediator-services-${m.id}`}>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {(() => {
                            const links = allMediatorServices?.filter(l => l.mediatorId === m.id) || [];
                            if (links.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
                            return links.map(link => {
                              const st = allServiceTypes?.find(s => s.id === link.serviceTypeId);
                              if (!st) return null;
                              const colorClass = SERVICE_CATEGORY_COLORS[st.category] || SERVICE_CATEGORY_COLORS["Packages"];
                              return (
                                <Badge key={link.serviceTypeId} variant="outline" className={`${colorClass} text-[10px] px-1.5 py-0`}>
                                  {st.name}
                                </Badge>
                              );
                            });
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit("mediators") && (
                          <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className={m.status === "pending" ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-muted-foreground hover:text-foreground"}
                                onClick={() => sendInviteMutation.mutate(m.id)}
                                disabled={sendInviteMutation.isPending}
                                title={m.status === "pending" ? "Send invite email" : "Resend invite email"}
                                data-testid={`button-send-invite-${m.id}`}
                              >
                                <Mail className="w-4 h-4" />
                              </Button>
                            {/* Legacy edit dialog retired (Task #171). Use the detail page instead. */}
                            <Button size="sm" variant="ghost" asChild data-testid={`button-open-mediator-${m.id}`} title="Open mediator profile">
                              <Link href={`/mediators/${m.id}`}><Pencil className="w-4 h-4" /></Link>
                            </Button>
                            {canManageMediatorPasswords && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openPasswordDialog(m)}
                                title="Change mediator password"
                                data-testid={`button-change-password-${m.id}`}
                              >
                                <KeyRound className="w-4 h-4" />
                              </Button>
                            )}
                            {canDeleteMediators && (
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(m)} data-testid={`button-delete-mediator-${m.id}`}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={TABLE_COLS} className="py-12">
                        <div className="flex flex-col items-center justify-center gap-3 text-center">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                            <UserCheck className="w-6 h-6 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {debouncedSearch ? "No mediators match your search" : "No mediators found"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {debouncedSearch
                                ? "Try adjusting your search term"
                                : "Add a mediator to get started"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          <PaginationControls
            page={page}
            totalPages={totalPages}
            limit={limit}
            total={totalCount}
            onPageChange={setPage}
            onLimitChange={(newLimit) => { setLimit(newLimit); setPage(1); }}
            testIdPrefix="pagination-mediators"
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editingMediator ? "Edit mediator" : "Add new mediator"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account Details</p>
              <div className="space-y-2">
                <Label htmlFor="mediator-name">Full name</Label>
                <Input id="mediator-name" value={formName} onChange={e => setFormName(e.target.value)} required data-testid="input-mediator-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mediator-email">Email</Label>
                <Input id="mediator-email" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required data-testid="input-mediator-email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mediator-password">
                  {editingMediator ? "New password (leave blank to keep)" : "Password"}
                  {!editingMediator && <span className="text-muted-foreground font-normal"> — optional</span>}
                </Label>
                <PasswordField
                  id="mediator-password"
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  showStrength
                  data-testid="input-mediator-password"
                  toggleTestId="button-toggle-mediator-password"
                />
                {!editingMediator && (
                  <p className="text-[11px] text-muted-foreground">Leave blank to send an invite email instead — the mediator will set their own password.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="mediator-zoom-link" className="flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5" />
                  Zoom link
                </Label>
                <Input id="mediator-zoom-link" type="url" value={formZoomLink} onChange={e => setFormZoomLink(e.target.value)} placeholder="https://zoom.us/j/..." data-testid="input-mediator-zoom-link" />
                <p className="text-[11px] text-muted-foreground">Auto-attached to all new appointments for this mediator</p>
              </div>
              {editingMediator && (
                <CalendarColourPicker
                  mediatorId={editingMediator.id}
                  value={formAvailabilityColor}
                  onChange={setFormAvailabilityColor}
                />
              )}
            </div>
            {activeServiceTypes.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Qualified Services</p>
                  <p className="text-xs text-muted-foreground">
                    Lead mediators can act as Lead, Co-mediator, or Observer. Co-mediators can act as Co-mediator or Observer. Observers can only observe.
                  </p>
                  <div className="grid gap-1.5 max-h-52 overflow-y-auto pr-1 border rounded-md p-2 bg-muted/20">
                    {activeServiceTypes.map(st => {
                      const colorClass = SERVICE_CATEGORY_COLORS[st.category] || SERVICE_CATEGORY_COLORS["Packages"];
                      return (
                        <div
                          key={st.id}
                          className="grid gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors sm:grid-cols-[minmax(0,1fr)_190px]"
                          data-testid={`checkbox-service-${st.id}`}
                        >
                          <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                            <Checkbox
                              checked={selectedServiceIds.includes(st.id)}
                              onCheckedChange={() => toggleServiceId(st.id)}
                            />
                            <span className="text-sm flex-1 truncate">{st.name}</span>
                            <Badge variant="outline" className={`${colorClass} text-[10px] px-1.5 py-0 shrink-0`}>
                              {st.category}
                            </Badge>
                          </label>
                          {selectedServiceIds.includes(st.id) && (
                            <Select
                              value={selectedServiceQualifications[st.id] ?? "unclassified"}
                              onValueChange={(value) => setSelectedServiceQualifications((current) => ({ ...current, [st.id]: value as MediationRoleQualification }))}
                            >
                              <SelectTrigger data-testid={`select-service-role-${st.id}`}>
                                <SelectValue placeholder="Service role" />
                              </SelectTrigger>
                              <SelectContent>
                                {MEDIATION_ROLE_QUALIFICATIONS.map((qualification) => (
                                  <SelectItem key={qualification} value={qualification}>{getMediationRoleQualificationLabel(qualification)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {selectedServiceIds.length > 0 && (
                    <p className="text-xs text-muted-foreground">{selectedServiceIds.length} service{selectedServiceIds.length !== 1 ? "s" : ""} selected</p>
                  )}
                </div>
              </>
            )}
            {editingMediator && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Calendar integrations
                  </p>
                  {editingCalendarStatus?.needsReconnect && (
                    <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-3 space-y-2" data-testid="calendar-needs-write-scope-section">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                        <p className="text-sm font-medium text-red-700 dark:text-red-300">Booking paused — reconnect required</p>
                      </div>
                      <p className="text-xs text-red-600/90 dark:text-red-400/90">
                        {editingCalendarStatus.email
                          ? `Connected as ${editingCalendarStatus.email}. `
                          : ""}
                        {editingCalendarStatus.lastSyncError === "needs_reauth"
                          ? `The mediator must reconnect ${editingCalendarStatus.label} before clients can book appointments.`
                          : `The mediator must reconnect ${editingCalendarStatus.label} and grant calendar edit permissions before clients can book appointments.`}
                      </p>
                    </div>
                  )}
                  {editingCalendarStatus?.connected ? (
                    <div className="rounded-lg border border-[#a7baa4]/30 bg-[#a7baa4]/5 p-3 space-y-3" data-testid="calendar-connected-section">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <EditingCalendarIcon className="w-4 h-4 text-[#5a7d58] shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#5a7d58] flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {editingCalendarStatus.label} connected
                            </p>
                            {editingCalendarStatus.email && (
                              <p className="text-xs text-muted-foreground truncate" data-testid="text-calendar-email">{editingCalendarStatus.email}</p>
                            )}
                            {editingCalendarStatus.lastSyncAt && (
                              <p className="text-[11px] text-muted-foreground/80" data-testid="text-calendar-last-sync">
                                Last synced {formatDistanceToNow(new Date(editingCalendarStatus.lastSyncAt), { addSuffix: true })}
                              </p>
                            )}
                            {editingCalendarStatus.lastSyncError && editingCalendarStatus.lastSyncError !== "needs_reauth" && editingCalendarStatus.lastSyncError !== "needs_write_scope" && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="text-calendar-last-error">
                                Last sync error: {editingCalendarStatus.lastSyncError}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            data-testid="button-sync-calendar"
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/calendar/sync/${editingMediator.id}`, { method: "POST", credentials: "include" });
                                const data = await res.json();
                                if (res.ok) {
                                  toast({ title: "Calendar synced", description: `${data.syncedCount} BFM event${data.syncedCount !== 1 ? "s" : ""} synced` });
                                  queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
                                  queryClient.invalidateQueries({ queryKey: [`/api/calendar/events/${editingMediator.id}`] });
                                } else {
                                  toast({ title: "Sync failed", description: data.message, variant: "destructive" });
                                }
                              } catch {
                                toast({ title: "Sync failed", description: "Could not sync calendar", variant: "destructive" });
                              }
                            }}
                          >
                            <RefreshCw className="w-3 h-3" />
                            Sync
                          </Button>
                          {editingCalendarStatus.provider === "google" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                              data-testid="button-disconnect-calendar"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/calendar/disconnect/${editingMediator.id}`, { method: "DELETE", credentials: "include" });
                                  if (res.ok) {
                                    toast({ title: "Calendar disconnected" });
                                    queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
                                    queryClient.invalidateQueries({ queryKey: [`/api/calendar/events/${editingMediator.id}`] });
                                    setEditingMediator({
                                      ...editingMediator,
                                      googleCalendarConnected: false,
                                      googleCalendarEmail: null,
                                      activeCalendarProvider: editingMediator.outlookCalendarConnected ? "outlook" : null,
                                    });
                                  } else {
                                    const data = await res.json();
                                    toast({ title: "Error", description: data.message, variant: "destructive" });
                                  }
                                } catch {
                                  toast({ title: "Error", description: "Could not disconnect calendar", variant: "destructive" });
                                }
                              }}
                            >
                              <Unlink className="w-3 h-3" />
                              Disconnect
                            </Button>
                          )}
                        </div>
                      </div>
                      <div data-testid="calendar-events-list">
                        {calendarEventsLoading ? (
                          <p className="text-xs text-muted-foreground">Loading synced appointments…</p>
                        ) : calendarEvents && calendarEvents.length > 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">Upcoming BFM appointments</p>
                            {calendarEvents.slice(0, 8).map(event => {
                              const start = new Date(event.startAt);
                              const end = new Date(event.endAt);
                              const duration = Math.round((end.getTime() - start.getTime()) / 60000);
                              const statusColor = event.bfmAttendanceStatus === "accepted" || event.bfmAttendanceStatus === "organiser"
                                ? "bg-[#a7baa4]/15 text-[#5a7d58]"
                                : event.bfmAttendanceStatus === "declined"
                                  ? "bg-red-50 text-red-600"
                                  : "bg-amber-50 text-amber-700";
                              return (
                                <div key={event.id} className="flex items-center gap-2 text-xs p-1.5 rounded-md bg-white border border-[#a7baa4]/10">
                                  <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="truncate font-medium">{event.title ?? "(no title)"}</p>
                                    <p className="text-muted-foreground">
                                      {start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} ({duration}m)
                                    </p>
                                  </div>
                                  <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor}`}>
                                    {event.bfmAttendanceStatus === "organiser"
                                      ? "Organiser"
                                      : event.bfmAttendanceStatus === "accepted"
                                        ? "Accepted"
                                        : event.bfmAttendanceStatus === "declined"
                                          ? "Declined"
                                          : event.bfmAttendanceStatus === "tentative"
                                            ? "Tentative"
                                            : "Pending"}
                                  </span>
                                </div>
                              );
                            })}
                            {calendarEvents.length > 8 && (
                              <p className="text-xs text-muted-foreground pl-1">+{calendarEvents.length - 8} more</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No BFM appointments synced yet. Click Sync to fetch from {editingCalendarStatus.label}.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="calendar-not-connected-section">
                      <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/5 p-3 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <SiGoogle className="w-4 h-4 text-muted-foreground shrink-0" />
                          <p className="text-sm text-muted-foreground">Google Calendar</p>
                        </div>
                        <p className="text-xs text-muted-foreground">Not connected. Send the mediator their onboarding invite — they can connect Google Calendar during calendar setup.</p>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5a7d58] hover:underline disabled:opacity-50"
                          data-testid="link-connect-google-calendar"
                          disabled={sendInviteMutation.isPending || !editingMediator}
                          onClick={() => editingMediator && sendInviteMutation.mutate(editingMediator.id)}
                        >
                          <Mail className="w-3 h-3" />
                          Send onboarding invite
                        </button>
                      </div>
                      <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/5 p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-[#0078d4] shrink-0" />
                          <p className="text-sm text-muted-foreground">Outlook / Microsoft 365</p>
                        </div>
                        <p className="text-xs text-muted-foreground">Not connected. The mediator can connect Microsoft Outlook from their calendar setup or Settings page.</p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="pt-1">
              <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-mediator">
                {isPending ? "Saving..." : editingMediator ? "Update mediator" : "Create mediator"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!passwordTarget} onOpenChange={(open) => !open && closePasswordDialog()}>
        <DialogContent className="max-w-md" data-testid="dialog-change-mediator-password">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[#5a7d58]" />
              Change mediator password
            </DialogTitle>
            <DialogDescription>
              {passwordTarget ? `${passwordTarget.name} (${passwordTarget.email})` : "Set a new mediator password."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The mediator will not receive an automatic email. Please share this password securely out of band.
            </div>
            <div className="space-y-2">
              <Label htmlFor="mediator-admin-password">New password</Label>
              <PasswordField
                id="mediator-admin-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                showStrength
                required
                data-testid="input-change-mediator-password"
                toggleTestId="button-toggle-change-mediator-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mediator-admin-confirm-password">Confirm password</Label>
              <PasswordField
                id="mediator-admin-confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                data-testid="input-change-mediator-confirm-password"
                toggleTestId="button-toggle-change-mediator-confirm-password"
              />
            </div>
            {passwordError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2" data-testid="text-change-password-error">
                {passwordError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closePasswordDialog} data-testid="button-cancel-change-password">
                Cancel
              </Button>
              <Button type="submit" disabled={changePasswordMutation.isPending} data-testid="button-submit-change-password">
                {changePasswordMutation.isPending ? "Changing..." : "Change password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent
          className="max-w-lg max-h-[85vh] overflow-y-auto"
          data-testid="dialog-mediator-info"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mediatorInfoButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Info className="w-5 h-5 text-[#b8825a]" />
              About Mediators
            </DialogTitle>
            <DialogDescription>How to use the mediator directory and its operational indicators.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-foreground">
            <div>
              <h4 className="font-semibold mb-1.5">Directory and profiles</h4>
              <p className="text-muted-foreground">
                Use search to find a mediator by name or email. Select a mediator&apos;s name or profile action to open their profile, where authorised users manage their account, service offerings, availability, and supporting information.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-1.5">Invites</h4>
              <p className="text-muted-foreground">
                A Pending invite badge means the mediator has not completed account setup. Users with Mediator Management edit access can use the email action to send or resend the onboarding invitation.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-1.5">Qualification and services</h4>
              <p className="text-muted-foreground">
                The Qualification badge shows the mediator&apos;s session-role eligibility. Service badges show the services linked to their profile; approvals and service schedules are managed from the mediator profile.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-1.5">Calendar indicators</h4>
              <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                <li><span className="text-foreground font-medium">Google Calendar connected</span> — the connected account is shown in the profile.</li>
                <li><span className="text-foreground font-medium">Calendar not connected</span> — the mediator still needs to connect their calendar.</li>
                <li><span className="text-foreground font-medium">Booking paused</span> — the calendar must be reconnected with full edit permissions before clients can book.</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-1.5">Removing a mediator</h4>
              <p className="text-muted-foreground">
                Administrators can remove a mediator. When they have appointments or case history, the record is archived instead so existing records keep their historical mediator information; unlinked records may be permanently deleted.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {(() => {
        const hasHistory = !!deleteTarget && (
          (deleteTarget.appointmentsCount ?? 0) > 0 ||
          (deleteTarget.assignedCasesCount ?? 0) > 0
        );
        const apptCount = deleteTarget?.appointmentsCount ?? 0;
        const caseCount = deleteTarget?.assignedCasesCount ?? 0;
        const description = !deleteTarget
          ? ""
          : hasHistory
            ? `${deleteTarget.name} has ${apptCount} appointment${apptCount === 1 ? "" : "s"} and ${caseCount} case${caseCount === 1 ? "" : "s"} on record. To preserve that history, they will be archived instead of deleted: their account is disabled, they're hidden from all mediator lists, and existing records keep their name attached.`
            : `${deleteTarget.name} has no appointments or cases. This will permanently delete their account and cannot be undone.`;
        return (
          <DeleteDialog
            open={!!deleteTarget}
            onOpenChange={(open) => !open && setDeleteTarget(null)}
            title={hasHistory ? "Archive mediator" : "Delete mediator"}
            description={description}
            onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            cancelTestId="button-cancel-delete-mediator"
            confirmTestId="button-confirm-delete-mediator"
          />
        );
      })()}
    </div>
  );
}

const COLOUR_PRESETS = [
  "#5a7d58",
  "#b8825a",
  "#c0392b",
  "#7d5fa3",
  "#2c7a7b",
  "#2563eb",
  "#d97706",
  "#475569",
];

function CalendarColourPicker({
  mediatorId,
  value,
  onChange,
}: {
  mediatorId: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const autoColour = autoColorFromMediatorId(mediatorId);
  const effective = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : autoColour;
  const isAuto = !value;
  const [hexInput, setHexInput] = useState<string>(value ?? "");
  const [hexError, setHexError] = useState<string | null>(null);

  useEffect(() => {
    setHexInput(value ?? "");
    setHexError(null);
  }, [value, mediatorId]);

  const commitHex = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setHexError(null);
      onChange(null);
      return;
    }
    const normalised = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(normalised)) {
      setHexError("Use 6-digit hex, e.g. #5a7d58");
      return;
    }
    setHexError(null);
    onChange(normalised.toLowerCase());
  };

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" />
        Calendar colour
      </Label>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-7 h-7 rounded-md border border-border shrink-0"
          style={{ backgroundColor: effective }}
          aria-label="Current calendar colour"
          data-testid="swatch-calendar-colour-current"
        />
        <span className="text-xs text-muted-foreground">
          {isAuto ? "Auto (from mediator ID)" : "Custom"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs ml-auto"
          onClick={() => onChange(null)}
          disabled={isAuto}
          data-testid="button-reset-calendar-colour"
        >
          Reset to auto
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {COLOUR_PRESETS.map((preset) => {
          const selected = !isAuto && effective === preset.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              className={`w-6 h-6 rounded-md border transition-all ${selected ? "ring-2 ring-offset-2 ring-foreground border-transparent" : "border-border hover:scale-110"}`}
              style={{ backgroundColor: preset }}
              onClick={() => onChange(preset)}
              aria-label={`Set calendar colour to ${preset}`}
              data-testid={`button-colour-preset-${preset.replace("#", "")}`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitHex((e.target as HTMLInputElement).value);
            }
          }}
          placeholder={autoColour}
          className="h-8 text-xs font-mono w-32"
          data-testid="input-calendar-colour-hex"
        />
        {hexError && <span className="text-[11px] text-destructive">{hexError}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Used to colour-code this mediator&apos;s available bookable slots on the appointments calendar.
      </p>
    </div>
  );
}
