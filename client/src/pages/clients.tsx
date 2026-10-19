import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Pencil,
  ExternalLink,
  Search,
  UsersRound,
  Info,
  Mail,
  Phone,
  MapPin,
  Shield,
  Trash2,
  AlertTriangle,
  Briefcase,
  FileUp,
} from "lucide-react";
import type { ClientRepresentative } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  MasterRepDialog,
  AttachToCaseDialog,
  REP_TYPE_LABELS,
  type AttachableCase,
} from "@/components/master-rep-dialogs";
import { useLocation } from "wouter";
import {
  SortableTableHead,
  type SortDirection,
} from "@/components/shared/sortable-table-head";
import { AvatarCell } from "@/components/shared/avatar-cell";
import {
  StatusBadge,
  type StatusStyleMap,
  getStatusStyle,
} from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { PipelinePills } from "@/components/shared/pipeline-pills";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { PaginationControls } from "@/components/shared/pagination";
import { GENDERS, ETHNIC_ORIGINS, DISABILITY_OPTIONS } from "@shared/schema";
import type { PaginatedResponse } from "@shared/schema";
import { LegacyClientImportDialog } from "@/components/clients/legacy-client-import-dialog";
import { LegacyCrmHistoryPanel } from "@/components/clients/legacy-crm-history-panel";

type RelatedCase = {
  partyId: string;
  caseId: string;
  caseRef: string;
  caseStatus: string;
  role: string;
  portalStatus: string;
  mediatorName: string;
};

type GroupedClient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneCode: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  ethnicOrigin: string | null;
  nationalInsuranceNumber: string | null;
  disabilityOrHealthCondition: string | null;
  additionalNeeds: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  userId: string | null;
  portalStatus: string;
  cases: RelatedCase[];
};

type MediatorOption = {
  id: string;
  name: string;
};

type CaseOption = {
  id: string;
  caseRef: string;
};

type ClientPayload = {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  phoneCode?: string;
  dateOfBirth?: string;
  gender?: string;
  ethnicOrigin?: string;
  nationalInsuranceNumber?: string;
  disabilityOrHealthCondition?: string;
  additionalNeeds?: string;
  confidential: boolean;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country?: string;
  miamMediatorId?: string | null;
  allocatedMediatorId?: string | null;
  caseId?: string;
  role?: string;
  portalStatus?: string;
};

const PHONE_CODES = [
  { value: "+44", label: "+44 (UK)" },
  { value: "+353", label: "+353 (Ireland)" },
  { value: "+1", label: "+1 (US/Canada)" },
  { value: "+33", label: "+33 (France)" },
  { value: "+49", label: "+49 (Germany)" },
  { value: "+34", label: "+34 (Spain)" },
  { value: "+39", label: "+39 (Italy)" },
  { value: "+61", label: "+61 (Australia)" },
  { value: "+91", label: "+91 (India)" },
];

function partyBadgeStyle(role: string) {
  return role === "A"
    ? "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30"
    : "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30";
}

const PORTAL_STATUS_STYLES: StatusStyleMap = {
  inactive: {
    dot: "bg-gray-400",
    badge:
      "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  },
  invited: {
    dot: "bg-[#b8825a]",
    badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30",
  },
  active: {
    dot: "bg-[#5a7d58]",
    badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30",
  },
};

const CASE_STATUS_STYLES: StatusStyleMap = {
  Active: {
    dot: "bg-[#5a7d58]",
    badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30",
  },
  "On hold": {
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
  },
  Closed: {
    dot: "bg-gray-400",
    badge: "bg-gray-100 text-gray-500 border-gray-200",
  },
};

/**
 * Full-CRUD Representatives panel inside the Client Sheet (Task #202).
 * Staff (superadmin/subadmin) can Add / Edit / Delete master Rolodex entries
 * for the client and attach an existing master to any of the client's cases.
 * Mediators never see this panel — the underlying API returns 403 and the
 * Sheet is gated upstream by `isStaff`.
 *
 * Cases for the attach picker are passed in directly from the parent (sourced
 * from `selectedClient.cases`) so the picker only ever offers cases this
 * client is actually a party on.
 */
export function ClientRepresentativesPanel({
  clientId,
  cases,
}: {
  clientId: string;
  cases: RelatedCase[];
}) {
  const { toast } = useToast();
  const {
    data: reps = [],
    isLoading,
    isError,
  } = useQuery<ClientRepresentative[]>({
    queryKey: ["/api/clients", clientId, "representatives"],
  });
  const attachableCases = useMemo<AttachableCase[]>(
    () =>
      cases.map((rc) => ({
        caseId: rc.caseId,
        caseRef: rc.caseRef,
        caseStatus: rc.caseStatus,
        partyId: rc.partyId,
        partyRole: rc.role,
      })),
    [cases],
  );
  const deleteMaster = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/client-representatives/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/clients", clientId, "representatives"],
      });
      toast({ title: "Representative deleted" });
    },
    onError: (err: Error) =>
      toast({
        variant: "destructive",
        title: "Could not delete",
        description: err.message || "Detach from all cases first.",
      }),
  });

  if (isError) return null;
  return (
    <div
      className="rounded-lg bg-muted/30 border p-4 space-y-3"
      data-testid="panel-client-reps"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold flex items-center gap-2">
          <Briefcase className="w-3.5 h-3.5" />
          Representatives ({reps.length})
        </p>
        <MasterRepDialog
          clientId={clientId}
          trigger={
            <Button
              size="sm"
              variant="outline"
              data-testid="button-add-client-rep"
            >
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          }
        />
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {!isLoading && reps.length === 0 && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="text-no-client-reps"
        >
          No representatives saved for this client.
        </p>
      )}
      {reps.map((rep) => (
        <div
          key={rep.id}
          className="rounded-md border bg-background p-3 space-y-2"
          data-testid={`panel-rep-${rep.id}`}
        >
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-sm font-medium"
                  data-testid={`text-panel-rep-name-${rep.id}`}
                >
                  {rep.fullName}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {REP_TYPE_LABELS[rep.type] || rep.type}
                </Badge>
              </div>
              {(rep.roleTitle || rep.organisation) && (
                <p className="text-xs text-muted-foreground">
                  {[rep.roleTitle, rep.organisation]
                    .filter(Boolean)
                    .join(" — ")}
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {rep.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {rep.email}
                  </span>
                )}
                {rep.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {rep.phone}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <AttachToCaseDialog
                master={rep}
                cases={attachableCases}
                alreadyAttachedCaseIds={new Set()}
                triggerLabel="Attach"
              />
              <MasterRepDialog
                clientId={clientId}
                existing={rep}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-edit-client-rep-${rep.id}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                }
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    data-testid={`button-delete-client-rep-${rep.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete this representative?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes {rep.fullName} from{" "}
                      {`this client's contacts`}. If they are still attached to
                      any case, the server will block this and ask you to detach
                      them first. This action is audit-logged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => deleteMaster.mutate(rep.id)}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ClientsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingClient, setEditingClient] = useState<GroupedClient | null>(
    null,
  );
  const [infoOpen, setInfoOpen] = useState(false);
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<GroupedClient | null>(
    null,
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const isSuperadmin = user?.role === "superadmin";
  const isAdmin = isSuperadmin || user?.role === "subadmin";

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortDirection>(null);

  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPhoneCode, setFormPhoneCode] = useState("+44");
  const [formDateOfBirth, setFormDateOfBirth] = useState("");
  const [formGender, setFormGender] = useState("");
  const [formEthnicOrigin, setFormEthnicOrigin] = useState("");
  const [formRole, setFormRole] = useState("A");
  const [formCaseId, setFormCaseId] = useState("");
  const [formPortalStatus, setFormPortalStatus] = useState("inactive");
  const [formNI, setFormNI] = useState("");
  const [formDisability, setFormDisability] = useState("");
  const [formAdditionalNeeds, setFormAdditionalNeeds] = useState("");
  const [formConfidential, setFormConfidential] = useState(false);
  const [formAddressLine1, setFormAddressLine1] = useState("");
  const [formAddressLine2, setFormAddressLine2] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formPostcode, setFormPostcode] = useState("");
  const [formCountry, setFormCountry] = useState("United Kingdom");
  const [formMiamMediatorId, setFormMiamMediatorId] = useState("");
  const [formAllocatedMediatorId, setFormAllocatedMediatorId] = useState("");

  const handleSort = useCallback(
    (key: string) => {
      if (sortBy === key) {
        if (sortOrder === "desc") setSortOrder("asc");
        else if (sortOrder === "asc") {
          setSortBy(null);
          setSortOrder(null);
        } else setSortOrder("desc");
      } else {
        setSortBy(key);
        setSortOrder("desc");
      }
      setPage(1);
    },
    [sortBy, sortOrder],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleStatusFilter = useCallback((status: string | null) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (statusFilter) queryParams.set("status", statusFilter);
  if (sortBy) queryParams.set("sortBy", sortBy);
  if (sortOrder) queryParams.set("sortOrder", sortOrder);

  const { data: paginatedData, isLoading } = useQuery<
    PaginatedResponse<GroupedClient>
  >({
    queryKey: [
      "/api/clients",
      {
        page,
        limit,
        search: debouncedSearch,
        status: statusFilter,
        sortBy,
        sortOrder,
      },
    ],
    queryFn: async () => {
      const res = await fetch(`/api/clients?${queryParams.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });

  const clients = paginatedData?.data;
  const totalCount = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;
  const counts = paginatedData?.counts ?? {};

  const { data: casesList } = useQuery<
    PaginatedResponse<{ id: string; caseRef: string }>
  >({
    queryKey: ["/api/cases", { page: 1, limit: 100 }],
    queryFn: async () => {
      const res = await fetch("/api/cases?page=1&limit=100", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch cases");
      return res.json();
    },
  });

  const caseOptions: CaseOption[] =
    casesList?.data?.map((c) => ({ id: c.id, caseRef: c.caseRef })) || [];

  const { data: mediatorsList } = useQuery<MediatorOption[]>({
    queryKey: ["/api/mediators", "all-for-dropdown"],
    queryFn: async () => {
      const res = await fetch("/api/mediators?page=1&limit=200", {
        credentials: "include",
      });
      if (!res.ok) return [];
      const json = await res.json();
      const list = json.data || json;
      return list.map((m: MediatorOption) => ({ id: m.id, name: m.name }));
    },
  });

  const mediatorOptions: MediatorOption[] = mediatorsList || [];

  const createMutation = useMutation({
    mutationFn: async (data: ClientPayload) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client record created" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create client",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ClientPayload>;
    }) => {
      const res = await apiRequest("PATCH", `/api/clients/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client updated" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to update client",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/clients/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client deleted" });
      setDeleteConfirmId(null);
      setSheetOpen(false);
      setSelectedClient(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Cannot delete",
        description: err.message || "Failed to delete client",
        variant: "destructive",
      });
      setDeleteConfirmId(null);
    },
  });

  function openCreate() {
    setEditingClient(null);
    setEditingClientId(null);
    setFormFirstName("");
    setFormLastName("");
    setFormEmail("");
    setFormPhone("");
    setFormPhoneCode("+44");
    setFormDateOfBirth("");
    setFormGender("");
    setFormEthnicOrigin("");
    setFormRole("A");
    setFormCaseId("");
    setFormPortalStatus("inactive");
    setFormNI("");
    setFormDisability("");
    setFormAdditionalNeeds("");
    setFormConfidential(false);
    setFormAddressLine1("");
    setFormAddressLine2("");
    setFormCity("");
    setFormPostcode("");
    setFormCountry("United Kingdom");
    setFormMiamMediatorId("");
    setFormAllocatedMediatorId("");
    setDialogOpen(true);
  }

  function openEdit(client: GroupedClient) {
    setEditingClient(client);
    setEditingClientId(client.id);
    setFormFirstName(client.firstName);
    setFormLastName(client.lastName);
    setFormEmail(client.email || "");
    setFormPhone(client.phone || "");
    setFormPhoneCode(client.phoneCode || "+44");
    setFormDateOfBirth(client.dateOfBirth || "");
    setFormGender(client.gender || "");
    setFormEthnicOrigin(client.ethnicOrigin || "");
    setFormRole("");
    setFormCaseId("");
    setFormPortalStatus("inactive");
    setFormNI(client.nationalInsuranceNumber || "");
    setFormDisability(client.disabilityOrHealthCondition || "");
    setFormAdditionalNeeds(client.additionalNeeds || "");
    setFormConfidential(false);
    setFormAddressLine1(client.addressLine1 || "");
    setFormAddressLine2(client.addressLine2 || "");
    setFormCity(client.city || "");
    setFormPostcode(client.postcode || "");
    setFormCountry(client.country || "United Kingdom");
    setFormMiamMediatorId("");
    setFormAllocatedMediatorId("");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingClient(null);
    setEditingClientId(null);
  }

  function openDetailSheet(client: GroupedClient) {
    setSelectedClient(client);
    setSheetOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizeMediatorId = (val: string): string | null | undefined =>
      val === "none" ? null : val || undefined;
    const commonFields: ClientPayload = {
      firstName: formFirstName,
      lastName: formLastName,
      email: formEmail || undefined,
      phone: formPhone || undefined,
      phoneCode: formPhoneCode || undefined,
      dateOfBirth: formDateOfBirth || undefined,
      gender: formGender || undefined,
      ethnicOrigin: formEthnicOrigin || undefined,
      nationalInsuranceNumber: formNI || undefined,
      disabilityOrHealthCondition: formDisability || undefined,
      additionalNeeds: formAdditionalNeeds || undefined,
      confidential: formConfidential,
      addressLine1: formAddressLine1 || undefined,
      addressLine2: formAddressLine2 || undefined,
      city: formCity || undefined,
      postcode: formPostcode || undefined,
      country: formCountry || undefined,
      miamMediatorId: normalizeMediatorId(formMiamMediatorId),
      allocatedMediatorId: normalizeMediatorId(formAllocatedMediatorId),
    };
    if (editingClient && editingClientId) {
      updateMutation.mutate({
        id: editingClientId,
        data: commonFields,
      });
    } else {
      createMutation.mutate({
        ...commonFields,
        caseId: formCaseId,
        role: formRole,
      });
    }
  }

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  const TABLE_COLS = 6;

  return (
    <div
      className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto"
      data-testid="clients-page"
    >
      <PageHeader
        title="Clients"
        subtitle="View and manage clients across all cases"
        icon={UsersRound}
        iconColor="text-[#b8825a]"
        iconBg="bg-[#dcae96]/15"
        titleTestId="text-clients-title"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setInfoOpen(true)}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              aria-label="About Clients"
              data-testid="button-client-info"
            >
              <Info className="w-4 h-4" />
            </Button>
            {canEdit("clients") && (
              <>
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => setLegacyImportOpen(true)}
                    data-testid="button-import-legacy-clients"
                  >
                    <FileUp className="w-4 h-4 mr-2" />
                    Import legacy clients
                  </Button>
                )}
                <Button onClick={openCreate} data-testid="button-add-client">
                  <Plus className="w-4 h-4 mr-2" />
                  Add client
                </Button>
              </>
            )}
          </div>
        }
      />

      {!isLoading && paginatedData && (
        <PipelinePills
          counts={counts}
          total={Object.values(counts).reduce((a, b) => a + b, 0)}
          statusStyles={PORTAL_STATUS_STYLES}
          activeFilter={statusFilter}
          onFilter={handleStatusFilter}
          testIdPrefix="pill-client"
        />
      )}

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email or case ref..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
            data-testid="input-search-clients"
          />
        </div>
        {(debouncedSearch || statusFilter) && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton columns={TABLE_COLS} rows={6} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <SortableTableHead
                      label="Client"
                      sortKey="name"
                      currentSortBy={sortBy}
                      currentSortOrder={sortOrder}
                      onSort={handleSort}
                      testId="sort-client-name"
                    />
                    <SortableTableHead
                      label="Email"
                      sortKey="email"
                      currentSortBy={sortBy}
                      currentSortOrder={sortOrder}
                      onSort={handleSort}
                      testId="sort-client-email"
                    />
                    <SortableTableHead
                      label="Phone"
                      sortKey="phone"
                      currentSortBy={sortBy}
                      currentSortOrder={sortOrder}
                      onSort={handleSort}
                      testId="sort-client-phone"
                    />
                    <SortableTableHead
                      label="Portal Status"
                      sortKey="portalStatus"
                      currentSortBy={sortBy}
                      currentSortOrder={sortOrder}
                      onSort={handleSort}
                      testId="sort-client-portal"
                    />
                    <SortableTableHead
                      label="Cases"
                      sortKey="cases"
                      currentSortBy={sortBy}
                      currentSortOrder={sortOrder}
                      onSort={handleSort}
                      testId="sort-client-cases"
                      className="text-center"
                    />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients && clients.length > 0 ? (
                    clients.map((c) => {
                      const portal = getStatusStyle(
                        c.portalStatus,
                        PORTAL_STATUS_STYLES,
                      );
                      return (
                        <TableRow
                          key={c.id}
                          className="hover:bg-muted/20 cursor-pointer"
                          onClick={() => navigate(`/clients/${c.id}`)}
                          data-testid={`row-client-${c.id}`}
                        >
                          <TableCell>
                            <AvatarCell
                              name={`${c.firstName} ${c.lastName}`}
                              bgClass="bg-[#dcae96]/15"
                              textClass="text-[#b8825a]"
                              testId={`text-client-name-${c.id}`}
                            />
                          </TableCell>
                          <TableCell
                            className="text-sm text-muted-foreground"
                            data-testid={`text-client-email-${c.id}`}
                          >
                            {c.email || "—"}
                          </TableCell>
                          <TableCell
                            className="text-sm text-muted-foreground"
                            data-testid={`text-client-phone-${c.id}`}
                          >
                            {c.phone
                              ? `${c.phoneCode || "+44"} ${c.phone}`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              label={c.portalStatus}
                              dotColor={portal.dot}
                              badgeClass={portal.badge}
                              testId={`badge-client-portal-${c.id}`}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            {c.cases.length === 0 ? (
                              <Badge
                                variant="outline"
                                className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/20"
                                data-testid={`badge-client-cases-${c.id}`}
                              >
                                No cases
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-xs"
                                data-testid={`badge-client-cases-${c.id}`}
                              >
                                {c.cases.length}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {canEdit("clients") && (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEdit(c);
                                  }}
                                  data-testid={`button-edit-client-${c.id}`}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                {c.cases.length === 0 && isSuperadmin && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedClient(c);
                                      setSheetOpen(true);
                                      setDeleteConfirmId(c.id);
                                      setDeleteConfirmText("");
                                    }}
                                    data-testid={`button-delete-client-${c.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={TABLE_COLS} className="py-12">
                        <div className="flex flex-col items-center justify-center gap-3 text-center">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                            <UsersRound className="w-6 h-6 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {debouncedSearch || statusFilter
                                ? "No clients match your filters"
                                : "No client records found"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {debouncedSearch || statusFilter
                                ? "Try adjusting your search or clearing the filter"
                                : "Clients are created when enquiries are converted to cases"}
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
          {paginatedData && paginatedData.total > 0 && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              limit={limit}
              total={totalCount}
              onPageChange={setPage}
              onLimitChange={(newLimit) => {
                setLimit(newLimit);
                setPage(1);
              }}
              testIdPrefix="pagination-clients"
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          className="sm:max-w-lg overflow-y-auto"
          data-testid="sheet-client-detail"
        >
          {selectedClient && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between pr-8">
                  <div>
                    <SheetTitle
                      className="font-heading"
                      data-testid="text-sheet-client-name"
                    >
                      {selectedClient.firstName} {selectedClient.lastName}
                    </SheetTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedClient.cases.length} case
                      {selectedClient.cases.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {canEdit("clients") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSheetOpen(false);
                        openEdit(selectedClient);
                      }}
                      data-testid="button-sheet-edit"
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
                <SheetDescription>
                  Client details and related cases
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-1">
                <div className="flex items-center gap-2 pb-4 flex-wrap">
                  {(() => {
                    const portal = getStatusStyle(
                      selectedClient.portalStatus,
                      PORTAL_STATUS_STYLES,
                    );
                    return (
                      <StatusBadge
                        label={selectedClient.portalStatus}
                        dotColor={portal.dot}
                        badgeClass={portal.badge + " text-sm px-3 py-1"}
                        testId="badge-sheet-portal-status"
                      />
                    );
                  })()}
                </div>

                <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Personal Details
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        First name
                      </p>
                      <p
                        className="text-sm font-medium"
                        data-testid="text-sheet-first-name"
                      >
                        {selectedClient.firstName}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last name</p>
                      <p
                        className="text-sm font-medium"
                        data-testid="text-sheet-last-name"
                      >
                        {selectedClient.lastName}
                      </p>
                    </div>
                  </div>
                  {selectedClient.dateOfBirth && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Date of birth
                      </p>
                      <p className="text-sm" data-testid="text-sheet-dob">
                        {new Date(
                          selectedClient.dateOfBirth,
                        ).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  )}
                  {selectedClient.gender && (
                    <div>
                      <p className="text-xs text-muted-foreground">Gender</p>
                      <p className="text-sm" data-testid="text-sheet-gender">
                        {selectedClient.gender}
                      </p>
                    </div>
                  )}
                  {selectedClient.ethnicOrigin && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Ethnic origin
                      </p>
                      <p
                        className="text-sm"
                        data-testid="text-sheet-ethnic-origin"
                      >
                        {selectedClient.ethnicOrigin}
                      </p>
                    </div>
                  )}
                  {selectedClient.nationalInsuranceNumber && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        National Insurance number
                      </p>
                      <p className="text-sm" data-testid="text-sheet-ni">
                        {selectedClient.nationalInsuranceNumber}
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Contact Details
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                        <p className="text-sm" data-testid="text-sheet-email">
                          {selectedClient.email || "—"}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        <p className="text-sm" data-testid="text-sheet-phone">
                          {selectedClient.phone
                            ? `${selectedClient.phoneCode || "+44"} ${selectedClient.phone}`
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {(selectedClient.addressLine1 ||
                  selectedClient.city ||
                  selectedClient.postcode) && (
                  <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                      Address
                    </p>
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
                      <div className="text-sm" data-testid="text-sheet-address">
                        {selectedClient.addressLine1 && (
                          <p>{selectedClient.addressLine1}</p>
                        )}
                        {selectedClient.addressLine2 && (
                          <p>{selectedClient.addressLine2}</p>
                        )}
                        {(selectedClient.city || selectedClient.postcode) && (
                          <p>
                            {[selectedClient.city, selectedClient.postcode]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {selectedClient.country &&
                          selectedClient.country !== "United Kingdom" && (
                            <p>{selectedClient.country}</p>
                          )}
                      </div>
                    </div>
                  </div>
                )}

                {(selectedClient.disabilityOrHealthCondition ||
                  selectedClient.additionalNeeds) && (
                  <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                      Additional Information
                    </p>
                    {selectedClient.disabilityOrHealthCondition && (
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Disability / health condition
                        </p>
                        <p
                          className="text-sm"
                          data-testid="text-sheet-disability"
                        >
                          {selectedClient.disabilityOrHealthCondition}
                        </p>
                      </div>
                    )}
                    {selectedClient.additionalNeeds && (
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Additional needs
                        </p>
                        <p
                          className="text-sm"
                          data-testid="text-sheet-additional-needs"
                        >
                          {selectedClient.additionalNeeds}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {selectedClient.cases.length === 0 && isSuperadmin && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        No cases linked
                      </p>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      This client has no linked cases and can be permanently
                      removed.
                    </p>
                    {deleteConfirmId === selectedClient.id ? (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                          Type{" "}
                          <strong>
                            {selectedClient.firstName} {selectedClient.lastName}
                          </strong>{" "}
                          to confirm permanent deletion:
                        </p>
                        <Input
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder="Full name"
                          className="h-8 text-sm"
                          data-testid="input-delete-confirm-text"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              deleteMutation.mutate(selectedClient.id)
                            }
                            disabled={
                              deleteMutation.isPending ||
                              deleteConfirmText !==
                                `${selectedClient.firstName} ${selectedClient.lastName}`
                            }
                            data-testid="button-sheet-confirm-delete"
                          >
                            {deleteMutation.isPending
                              ? "Deleting..."
                              : "Permanently delete"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setDeleteConfirmId(null);
                              setDeleteConfirmText("");
                            }}
                            data-testid="button-sheet-cancel-delete"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-100"
                        onClick={() => {
                          setDeleteConfirmId(selectedClient.id);
                          setDeleteConfirmText("");
                        }}
                        data-testid="button-sheet-delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Delete client
                      </Button>
                    )}
                  </div>
                )}

                <LegacyCrmHistoryPanel clientId={selectedClient.id} />

                <ClientRepresentativesPanel
                  clientId={selectedClient.id}
                  cases={selectedClient.cases}
                />

                <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Related Cases ({selectedClient.cases.length})
                  </p>
                  <div className="space-y-2">
                    {selectedClient.cases.map((rc) => {
                      const cs = getStatusStyle(
                        rc.caseStatus,
                        CASE_STATUS_STYLES,
                      );
                      return (
                        <div
                          key={rc.partyId}
                          className="rounded-md border p-3 space-y-2 hover:bg-muted/20 transition-colors"
                          data-testid={`sheet-related-case-${rc.caseId}`}
                        >
                          <div className="flex items-center justify-between">
                            <button
                              className="text-sm font-medium text-[#5a7d58] hover:text-[#5a7d58]/80 hover:underline flex items-center gap-1"
                              onClick={() => {
                                setSheetOpen(false);
                                navigate(`/cases/${rc.caseId}`);
                              }}
                              data-testid={`link-sheet-case-${rc.caseId}`}
                            >
                              {rc.caseRef}
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            <StatusBadge
                              label={rc.caseStatus}
                              dotColor={cs.dot}
                              badgeClass={cs.badge}
                              testId={`badge-sheet-case-status-${rc.caseId}`}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusBadge
                              label={`Client ${rc.role}`}
                              badgeClass={partyBadgeStyle(rc.role) + " text-xs"}
                              testId={`badge-sheet-role-${rc.caseId}`}
                            />
                            <span className="text-xs text-muted-foreground">
                              Mediator: {rc.mediatorName}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editingClient ? "Edit client" : "Add new client"}
            </DialogTitle>
            <DialogDescription>
              {editingClient
                ? "Update the client's personal and contact details."
                : "Create a new client party record linked to a case."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                Personal Details
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-first-name" className="text-xs">
                    First name
                  </Label>
                  <Input
                    id="client-first-name"
                    value={formFirstName}
                    onChange={(e) => setFormFirstName(e.target.value)}
                    required
                    data-testid="input-client-first-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-last-name" className="text-xs">
                    Last name
                  </Label>
                  <Input
                    id="client-last-name"
                    value={formLastName}
                    onChange={(e) => setFormLastName(e.target.value)}
                    required
                    data-testid="input-client-last-name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-dob" className="text-xs">
                    Date of birth
                  </Label>
                  <Input
                    id="client-dob"
                    type="date"
                    value={formDateOfBirth}
                    onChange={(e) => setFormDateOfBirth(e.target.value)}
                    data-testid="input-client-dob"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-gender" className="text-xs">
                    Gender
                  </Label>
                  <Select value={formGender} onValueChange={setFormGender}>
                    <SelectTrigger data-testid="select-client-gender">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                Contact Details
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="client-email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="client-email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  data-testid="input-client-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <div className="flex gap-2">
                  <Select
                    value={formPhoneCode}
                    onValueChange={setFormPhoneCode}
                  >
                    <SelectTrigger
                      className="w-[130px]"
                      data-testid="select-client-phone-code"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PHONE_CODES.map((pc) => (
                        <SelectItem key={pc.value} value={pc.value}>
                          {pc.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="Phone number"
                    className="flex-1"
                    data-testid="input-client-phone"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                Demographics
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="client-ethnic-origin" className="text-xs">
                  Ethnic origin
                </Label>
                <Select
                  value={formEthnicOrigin}
                  onValueChange={setFormEthnicOrigin}
                >
                  <SelectTrigger data-testid="select-client-ethnic-origin">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {ETHNIC_ORIGINS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-ni" className="text-xs">
                  National Insurance number
                </Label>
                <Input
                  id="client-ni"
                  value={formNI}
                  onChange={(e) => setFormNI(e.target.value)}
                  placeholder="e.g. QQ 12 34 56 C"
                  data-testid="input-client-ni"
                />
              </div>
            </div>

            <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                Address
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="client-address-1" className="text-xs">
                  Address line 1
                </Label>
                <Input
                  id="client-address-1"
                  value={formAddressLine1}
                  onChange={(e) => setFormAddressLine1(e.target.value)}
                  data-testid="input-client-address-1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-address-2" className="text-xs">
                  Address line 2
                </Label>
                <Input
                  id="client-address-2"
                  value={formAddressLine2}
                  onChange={(e) => setFormAddressLine2(e.target.value)}
                  data-testid="input-client-address-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="client-city" className="text-xs">
                    City
                  </Label>
                  <Input
                    id="client-city"
                    value={formCity}
                    onChange={(e) => setFormCity(e.target.value)}
                    data-testid="input-client-city"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-postcode" className="text-xs">
                    Postcode
                  </Label>
                  <Input
                    id="client-postcode"
                    value={formPostcode}
                    onChange={(e) => setFormPostcode(e.target.value)}
                    data-testid="input-client-postcode"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-country" className="text-xs">
                  Country
                </Label>
                <Input
                  id="client-country"
                  value={formCountry}
                  onChange={(e) => setFormCountry(e.target.value)}
                  data-testid="input-client-country"
                />
              </div>
            </div>

            <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                Additional Needs
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="client-disability" className="text-xs">
                  Disability / health condition
                </Label>
                <Select
                  value={formDisability}
                  onValueChange={setFormDisability}
                >
                  <SelectTrigger data-testid="select-client-disability">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISABILITY_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-additional-needs" className="text-xs">
                  Additional needs
                </Label>
                <Textarea
                  id="client-additional-needs"
                  value={formAdditionalNeeds}
                  onChange={(e) => setFormAdditionalNeeds(e.target.value)}
                  rows={2}
                  placeholder="Any additional support requirements..."
                  data-testid="input-client-additional-needs"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="client-confidential"
                  checked={formConfidential}
                  onCheckedChange={(checked) =>
                    setFormConfidential(checked === true)
                  }
                  data-testid="checkbox-client-confidential"
                />
                <Label htmlFor="client-confidential" className="text-xs">
                  Confidential record
                </Label>
              </div>
            </div>

            {!editingClient && (
              <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                  Mediator Assignment
                </p>
                <p className="text-xs text-muted-foreground">
                  These assignments apply to the case link and can be updated
                  from the case detail page.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="client-miam-mediator" className="text-xs">
                      MIAM mediator
                    </Label>
                    <Select
                      value={formMiamMediatorId}
                      onValueChange={setFormMiamMediatorId}
                    >
                      <SelectTrigger data-testid="select-client-miam-mediator">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {mediatorOptions.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="client-allocated-mediator"
                      className="text-xs"
                    >
                      Allocated mediator
                    </Label>
                    <Select
                      value={formAllocatedMediatorId}
                      onValueChange={setFormAllocatedMediatorId}
                    >
                      <SelectTrigger data-testid="select-client-allocated-mediator">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {mediatorOptions.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {!editingClient && (
              <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                  Case Assignment
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="client-case" className="text-xs">
                    Case
                  </Label>
                  <Select value={formCaseId} onValueChange={setFormCaseId}>
                    <SelectTrigger data-testid="select-client-case">
                      <SelectValue placeholder="Select a case" />
                    </SelectTrigger>
                    <SelectContent>
                      {caseOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.caseRef}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="client-party-role" className="text-xs">
                    Client role
                  </Label>
                  <Select value={formRole} onValueChange={setFormRole}>
                    <SelectTrigger data-testid="select-client-party-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Client A</SelectItem>
                      <SelectItem value="B">Client B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {editingClient && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  Portal status and mediator assignments are managed per-case.
                  Edit them from the case detail page.
                </p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={isPending || (!editingClient && !formCaseId)}
              data-testid="button-submit-client"
            >
              {isPending
                ? "Saving..."
                : editingClient
                  ? "Update client"
                  : "Create client"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <LegacyClientImportDialog
        open={legacyImportOpen}
        onOpenChange={setLegacyImportOpen}
        onImported={() =>
          queryClient.invalidateQueries({ queryKey: ["/api/clients"] })
        }
      />

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent
          className="max-w-lg max-h-[85vh] overflow-y-auto"
          data-testid="dialog-client-info"
        >
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Info className="w-5 h-5 text-[#b8825a]" />
              About Clients
            </DialogTitle>
            <DialogDescription>
              Understanding client records in the mediation system
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-foreground">
            <p>
              This page shows all clients as unique individuals. Each client may
              be involved in one or more mediation cases, and you can see all
              their related cases from the detail view.
            </p>

            <div>
              <h4 className="font-semibold mb-1.5">Client Roles per Case</h4>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <StatusBadge
                  label="Client A"
                  badgeClass={partyBadgeStyle("A")}
                />
                <span className="text-muted-foreground">•</span>
                <StatusBadge
                  label="Client B"
                  badgeClass={partyBadgeStyle("B")}
                />
              </div>
              <p className="text-muted-foreground mt-2">
                Each case has two sides — Client A (usually the person who made
                the enquiry) and Client B (the responding party). These roles
                are specific to each case, not to the person. The same client
                can be Client A on one case and Client B on another.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">Portal Statuses</h4>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <StatusBadge
                  label="Inactive"
                  dotColor={PORTAL_STATUS_STYLES.inactive.dot}
                  badgeClass={PORTAL_STATUS_STYLES.inactive.badge}
                />
                <span className="text-muted-foreground">→</span>
                <StatusBadge
                  label="Invited"
                  dotColor={PORTAL_STATUS_STYLES.invited.dot}
                  badgeClass={PORTAL_STATUS_STYLES.invited.badge}
                />
                <span className="text-muted-foreground">→</span>
                <StatusBadge
                  label="Active"
                  dotColor={PORTAL_STATUS_STYLES.active.dot}
                  badgeClass={PORTAL_STATUS_STYLES.active.badge}
                />
              </div>
              <ul className="space-y-1 text-muted-foreground list-disc pl-4 mt-2">
                <li>
                  <span className="text-foreground font-medium">Inactive</span>{" "}
                  — Account created but no invitation sent yet
                </li>
                <li>
                  <span className="text-foreground font-medium">Invited</span> —
                  Invitation email sent to the client with a registration link
                </li>
                <li>
                  <span className="text-foreground font-medium">Active</span> —
                  Client has registered and can access the portal
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">How Clients Are Created</h4>
              <p className="text-muted-foreground">
                Client A is automatically created when an enquiry is converted
                to a case. Client B can be added manually from this page or from
                the case detail page. If a client is involved in multiple cases,
                they appear once here with all their cases listed in the detail
                view.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">Key Information Captured</h4>
              <p className="text-muted-foreground">
                Each client record includes personal details (name, DOB, gender,
                ethnicity, NI number), contact information (email, phone),
                address, disability/health needs, additional support
                requirements, confidentiality flags, and mediator assignments.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
