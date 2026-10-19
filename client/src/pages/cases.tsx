import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Briefcase, Search, Shuffle, Info, FolderOpen, ExternalLink, Users as UsersIcon, MessageSquare, Calendar, CheckCircle2, MoreHorizontal, Archive, ArchiveRestore, Trash2, Filter, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import type { Case, Party, PaginatedResponse, CaseFilters } from "@shared/schema";
import { PageHeader } from "@/components/shared/page-header";
import { AvatarCell } from "@/components/shared/avatar-cell";
import { StatusBadge, CASE_STATUS_STYLES, CASE_STAGE_STYLES, getStatusStyle } from "@/components/shared/status-badge";
import { ConfidentialBadge } from "@/components/shared/confidential-badge";
import { CaseFilterSheet, countActiveFilters } from "@/components/cases/case-filter-sheet";
import { CaseSavedViews } from "@/components/cases/case-saved-views";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { PaginationControls } from "@/components/shared/pagination";
import { ActivityTimeline } from "@/components/case-activity-timeline";

type CaseWithParties = Case & {
  partyA?: Party;
  partyB?: Party;
  mediatorName: string;
  userPartyRole?: string;
  isSessionObserverOnly?: boolean;
  isSessionCoMediator?: boolean;
  sessionAccess?: "observer" | "co_mediator" | "full" | "none";
};

type KeyDateEntry = {
  type: string;
  label: string;
  date: string;
  status: string;
};

type KeyDatesResponse = {
  miamDates: KeyDateEntry[];
  mediationDates: KeyDateEntry[];
  otherAppointmentDates: KeyDateEntry[];
};

function partyName(party?: Party): string {
  if (!party) return "—";
  return [party.firstName, party.lastName].filter(Boolean).join(" ") || "—";
}

function caseType(c: CaseWithParties): string {
  return c.mediationCategory || c.issueType || "—";
}

function caseSubtype(c: CaseWithParties): string {
  switch (c.mediationCategory) {
    case "Family":
      return c.familySubType || "";
    case "Workplace":
      return c.workplaceSubType || "";
    case "Civil":
      return c.civilSubType || "";
    case "Commercial":
      return c.commercialSubType || "";
    case "Other":
      return c.otherSubType || "";
    default:
      return c.familySubType || c.workplaceSubType || c.civilSubType || c.commercialSubType || c.otherSubType || "";
  }
}

function formatKeyDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function KeyDatesSection({ caseId }: { caseId: string }) {
  const { data: keyDates, isLoading, isError } = useQuery<KeyDatesResponse>({
    queryKey: ["/api/cases", caseId, "key-dates"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/key-dates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load key dates");
      return res.json();
    },
    enabled: !!caseId,
  });

  const hasData = keyDates && (keyDates.miamDates.length > 0 || keyDates.mediationDates.length > 0 || keyDates.otherAppointmentDates.length > 0);

  if (isLoading) {
    return (
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-[#5a7d58]" />
          Key Dates
        </h4>
        <div className="space-y-2">
          <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (isError) {
    return null;
  }

  if (!hasData) {
    return (
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-[#5a7d58]" />
          Key Dates
        </h4>
        <p className="text-xs text-muted-foreground">No key dates recorded yet.</p>
        <Separator className="mt-4" />
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <Calendar className="w-4 h-4 text-[#5a7d58]" />
        Key Dates
      </h4>
      <div className="space-y-3" data-testid="sheet-key-dates">
        {keyDates.miamDates.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">MIAM</p>
            {keyDates.miamDates.map((entry, i) => (
              <div key={`miam-${i}`} className="flex items-start gap-2" data-testid={`key-date-miam-${i}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${entry.status === "approved" || entry.status === "completed" ? "text-[#5a7d58]" : "text-amber-500"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">{entry.label}</p>
                  <p className="text-xs text-muted-foreground">{formatKeyDate(entry.date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {keyDates.mediationDates.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Mediation Sessions</p>
            {keyDates.mediationDates.map((entry, i) => (
              <div key={`med-${i}`} className="flex items-start gap-2" data-testid={`key-date-mediation-${i}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${entry.status === "completed" ? "text-[#5a7d58]" : "text-blue-500"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">{entry.label}</p>
                  <p className="text-xs text-muted-foreground">{formatKeyDate(entry.date)} {entry.status === "completed" ? "(completed)" : "(confirmed)"}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {keyDates.otherAppointmentDates.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Other Appointments</p>
            {keyDates.otherAppointmentDates.map((entry, i) => (
              <div key={`appt-${i}`} className="flex items-start gap-2" data-testid={`key-date-appt-${i}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${entry.status === "completed" ? "text-[#5a7d58]" : "text-blue-500"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">{entry.label}</p>
                  <p className="text-xs text-muted-foreground">{formatKeyDate(entry.date)} {entry.status === "completed" ? "(completed)" : "(confirmed)"}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Separator className="mt-4" />
    </div>
  );
}

export default function CasesPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isClient = user?.role === "client";
  const isMediator = user?.role === "mediator";
  const isStaff = user?.role === "superadmin" || user?.role === "subadmin" || user?.role === "staff" || user?.role === "mediator";
  const canViewSensitiveCaseMarkers = !isClient;
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseWithParties | null>(null);
  const [filters, setFilters] = useState<CaseFilters>(() => {
    if (typeof window === "undefined") return {};
    try {
      const u = new URL(window.location.href);
      const raw = u.searchParams.get("f");
      return raw ? (JSON.parse(decodeURIComponent(raw)) as CaseFilters) : {};
    } catch { return {}; }
  });
  const [hasUrlFilters] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return new URL(window.location.href).searchParams.has("f"); } catch { return false; }
  });
  const [defaultApplied, setDefaultApplied] = useState(hasUrlFilters);

  // Auto-apply default saved view on first visit when URL has no ?f=.
  useQuery<{ filters: CaseFilters } | null>({
    queryKey: ["/api/case-filter-presets/default"],
    queryFn: async () => {
      const res = await fetch("/api/case-filter-presets/default", { credentials: "include" });
      if (!res.ok) return null;
      const p = await res.json();
      if (!defaultApplied && p && p.filters) {
        const { caseFiltersSchema } = await import("@shared/schema");
        const parsed = caseFiltersSchema.safeParse(p.filters);
        if (parsed.success) {
          setFilters(parsed.data);
          if (parsed.data.search) setSearchInput(parsed.data.search);
        }
        setDefaultApplied(true);
      }
      return p;
    },
    enabled: !hasUrlFilters,
  });
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search ?? "");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortDirection>(null);
  const [archiveTarget, setArchiveTarget] = useState<CaseWithParties | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseWithParties | null>(null);
  const { toast } = useToast();
  const isSuperadmin = user?.role === "superadmin";
  const isAdmin = user?.role === "superadmin" || user?.role === "subadmin";

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/cases/${id}/archive`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Case archived", description: "The case has been moved to Archived." });
      setArchiveTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not archive", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/cases/${id}/restore`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Case restored", description: "The case is now Active." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not restore", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async ({ id, confirm }: { id: string; confirm: string }) => {
      const res = await apiRequest("DELETE", `/api/cases/${id}`, { confirm });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Case permanently deleted", description: "All linked records have been removed." });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setFilters(prev => ({ ...prev, search: searchInput.trim() || undefined }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Sync filter object → URL (?f=encoded JSON) so views are shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    const hasAny = countActiveFilters(filters) > 0;
    if (hasAny) u.searchParams.set("f", encodeURIComponent(JSON.stringify(filters)));
    else u.searchParams.delete("f");
    window.history.replaceState({}, "", u.toString());
  }, [filters]);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  if (sortBy) queryParams.set("sortBy", sortBy);
  if (sortOrder) queryParams.set("sortOrder", sortOrder);
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { if (v.length) queryParams.set(k, v.join(",")); continue; }
    if (typeof v === "string" && v.trim().length === 0) continue;
    queryParams.set(k, String(v));
  }

  const { data: paginatedData, isLoading } = useQuery<PaginatedResponse<CaseWithParties>>({
    queryKey: ["/api/cases", { page, limit, sortBy, sortOrder, filters }],
    queryFn: async () => {
      const res = await fetch(`/api/cases?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch cases");
      return res.json();
    },
  });

  const activeFilterCount = countActiveFilters(filters);
  const clearAll = () => { setFilters({}); setSearchInput(""); setDebouncedSearch(""); setPage(1); };
  const removeFilterKey = (k: keyof CaseFilters) => {
    setFilters(prev => { const next = { ...prev }; delete next[k]; return next; });
    if (k === "search") { setSearchInput(""); setDebouncedSearch(""); }
    setPage(1);
  };

  const cases = paginatedData?.data;
  const totalCount = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;
  const counts = paginatedData?.counts ?? {};

  const TABLE_COLS = isClient ? 5 : 8;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="cases-page">
      <PageHeader
        title={isClient ? "Mediation" : "Cases"}
        subtitle={isClient ? "Your mediation cases. Click a row to view full details." : "Manage all mediation cases. Click a row to view full details."}
        icon={Briefcase}
        iconColor="text-[#b8825a]"
        iconBg="bg-[#dcae96]/15"
        titleTestId="text-cases-title"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setInfoOpen(true)}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="About Cases"
              data-testid="button-case-info"
            >
              <Info className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search cases..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="pl-9"
            data-testid="input-search-cases"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setFilterSheetOpen(true)} data-testid="button-open-filters">
          <Filter className="w-4 h-4 mr-1.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center text-xs rounded-full bg-primary text-primary-foreground px-1.5 py-0.5">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <CaseSavedViews
          currentFilters={filters}
          onLoad={(f) => { setFilters(f); setSearchInput(f.search ?? ""); setDebouncedSearch(f.search ?? ""); setPage(1); }}
        />
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} data-testid="button-clear-all-filters">
            <X className="w-4 h-4 mr-1" />
            Clear all
          </Button>
        )}
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="filter-chips">
          {Object.entries(filters).map(([k, v]) => {
            if (v === undefined || v === null) return null;
            const label = Array.isArray(v) ? `${k}: ${v.length}` : `${k}: ${String(v)}`;
            if (Array.isArray(v) && v.length === 0) return null;
            if (typeof v === "string" && v.trim().length === 0) return null;
            return (
              <button
                key={k}
                onClick={() => removeFilterKey(k as keyof CaseFilters)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs hover:bg-muted/80"
                data-testid={`chip-filter-${k}`}
              >
                {label}
                <X className="w-3 h-3" />
              </button>
            );
          })}
        </div>
      )}

      <CaseFilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        value={filters}
        onApply={(f) => { setFilters(f); setSearchInput(f.search ?? ""); setDebouncedSearch(f.search ?? ""); setPage(1); }}
        isAdmin={isAdmin || isMediator}
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton columns={TABLE_COLS} rows={6} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <SortableTableHead label="Case ref" sortKey="caseRef" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-caseref" />
                    {!isClient && <SortableTableHead label="Client A" sortKey="partyA" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-partya" />}
                    {!isClient && <SortableTableHead label="Client B" sortKey="partyB" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-partyb" />}
                    <SortableTableHead label="Mediator" sortKey="mediatorName" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-mediator" />
                    <SortableTableHead label="Case type" sortKey="issueType" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-issue" />
                    <SortableTableHead label="Stage" sortKey="stage" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-stage" />
                    <SortableTableHead label="Status" sortKey="status" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-status" />
                    {!isClient && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases && cases.length > 0 ? cases.map(c => {
                    const statusStyle = getStatusStyle(c.status, CASE_STATUS_STYLES);
                    const stageStyle = getStatusStyle(c.stage || "", CASE_STAGE_STYLES);
                    const aName = partyName(c.partyA);
                    const bName = partyName(c.partyB);
                    const typeLabel = caseType(c);
                    const subtypeLabel = caseSubtype(c);
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/cases/${c.id}`)}
                        data-testid={`row-case-${c.id}`}
                      >
                        <TableCell className="font-mono font-medium text-sm whitespace-nowrap" data-testid={`text-case-ref-${c.id}`}>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              {c.caseRef}
                              {c.shuttleMediation && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Shuffle className="w-3.5 h-3.5 text-amber-600" />
                                    </TooltipTrigger>
                                    <TooltipContent>Shuttle mediation</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {c.cimEligible && (
                                <Badge variant="outline" className="text-[#5a7d58] border-[#a7baa4] bg-[#a7baa4]/10 text-[10px]">
                                  CIM
                                </Badge>
                              )}
                              {c.mojVoucherEligible && (
                                <Badge variant="outline" className="text-[#5a7d58] border-[#a7baa4] bg-[#a7baa4]/10 text-[10px]">
                                  MoJ
                                </Badge>
                              )}
                            </div>
                            {canViewSensitiveCaseMarkers && c.confidential && (
                              <span data-testid={`badge-case-confidential-${c.id}`}>
                                <ConfidentialBadge />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        {!isClient && (
                          <TableCell>
                            {c.partyA ? (
                              <AvatarCell
                                name={aName}
                                bgClass="bg-[#dcae96]/15"
                                textClass="text-[#b8825a]"
                                testId={`text-party-a-${c.id}`}
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                        {!isClient && (
                          <TableCell>
                            {c.partyB ? (
                              <AvatarCell
                                name={bName}
                                bgClass="bg-[#a7baa4]/15"
                                textClass="text-[#5a7d58]"
                                testId={`text-party-b-${c.id}`}
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-sm" data-testid={`text-mediator-${c.id}`}>
                          {c.mediatorName || "—"}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-issue-${c.id}`}>
                          <div className="space-y-0.5">
                            <div className="font-medium" data-testid={`text-case-type-${c.id}`}>{typeLabel}</div>
                            <div className="text-xs text-muted-foreground" data-testid={`text-case-subtype-${c.id}`}>
                              {subtypeLabel || "No subtype"}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {c.stage ? (
                            <StatusBadge
                              label={c.stage}
                              badgeClass={stageStyle.badge}
                              testId={`badge-stage-${c.id}`}
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={c.status}
                            dotColor={statusStyle.dot}
                            badgeClass={statusStyle.badge}
                            testId={`badge-status-${c.id}`}
                          />
                        </TableCell>
                        {!isClient && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      onClick={() => setSelectedCase(c)}
                                      data-testid={`button-case-summary-${c.id}`}
                                    >
                                      <Info className="w-4 h-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Case Summary</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              {isAdmin && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                      data-testid={`button-case-actions-${c.id}`}
                                      aria-label="Case actions"
                                    >
                                      <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {c.status === "Archived" ? (
                                      isSuperadmin && (
                                        <DropdownMenuItem
                                          onClick={() => restoreMutation.mutate(c.id)}
                                          disabled={restoreMutation.isPending}
                                          data-testid={`menu-restore-case-${c.id}`}
                                        >
                                          <ArchiveRestore className="w-4 h-4 mr-2" />
                                          Restore
                                        </DropdownMenuItem>
                                      )
                                    ) : (
                                      <DropdownMenuItem
                                        onClick={() => setArchiveTarget(c)}
                                        data-testid={`menu-archive-case-${c.id}`}
                                      >
                                        <Archive className="w-4 h-4 mr-2" />
                                        Archive
                                      </DropdownMenuItem>
                                    )}
                                    {isSuperadmin && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onClick={() => setDeleteTarget(c)}
                                          className="text-destructive focus:text-destructive"
                                          data-testid={`menu-delete-case-${c.id}`}
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete permanently
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={TABLE_COLS} className="py-12">
                        <div className="flex flex-col items-center justify-center gap-3 text-center">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                            <FolderOpen className="w-6 h-6 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {activeFilterCount > 0 ? "No cases match your filters" : "No cases found"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {activeFilterCount > 0
                                ? "Try adjusting your filters or clearing them"
                                : "Cases are created when enquiries are converted"}
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
              onLimitChange={(newLimit) => { setLimit(newLimit); setPage(1); }}
              testIdPrefix="pagination-cases"
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selectedCase} onOpenChange={(open) => { if (!open) setSelectedCase(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="sheet-case-preview">
          {selectedCase && (
            <>
              <SheetHeader className="pb-4">
                <SheetTitle className="font-heading flex items-center gap-2 text-lg">
                  <Briefcase className="w-5 h-5 text-[#b8825a]" />
                  Case Record — {selectedCase.caseRef}
                  {selectedCase.shuttleMediation && (
                    <Shuffle className="w-4 h-4 text-amber-600" />
                  )}
                  {canViewSensitiveCaseMarkers && selectedCase.confidential && (
                    <span data-testid="sheet-badge-case-confidential">
                      <ConfidentialBadge />
                    </span>
                  )}
                </SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  Quick preview — click below to view full case details
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Status</p>
                    <StatusBadge
                      label={selectedCase.status}
                      dotColor={getStatusStyle(selectedCase.status, CASE_STATUS_STYLES).dot}
                      badgeClass={getStatusStyle(selectedCase.status, CASE_STATUS_STYLES).badge}
                      testId="sheet-badge-status"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Stage</p>
                    {selectedCase.stage ? (
                      <StatusBadge
                        label={selectedCase.stage}
                        badgeClass={getStatusStyle(selectedCase.stage, CASE_STAGE_STYLES).badge}
                        testId="sheet-badge-stage"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>

                {!isClient && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                        <UsersIcon className="w-3 h-3" /> Client A
                      </p>
                      <p className="text-sm font-medium" data-testid="sheet-text-party-a">
                        {partyName(selectedCase.partyA)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">
                        <UsersIcon className="w-3 h-3" /> Client B
                      </p>
                      <p className="text-sm font-medium" data-testid="sheet-text-party-b">
                        {partyName(selectedCase.partyB)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Mediator</p>
                    <p className="text-sm" data-testid="sheet-text-mediator">{selectedCase.mediatorName || "—"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Issue Type</p>
                    <p className="text-sm" data-testid="sheet-text-issue">{selectedCase.issueType || "—"}</p>
                  </div>
                </div>

                <Separator />

                {isStaff && !selectedCase.isSessionObserverOnly && !selectedCase.isSessionCoMediator && <KeyDatesSection caseId={selectedCase.id} />}

                {isStaff && !selectedCase.isSessionObserverOnly && !selectedCase.isSessionCoMediator && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-[#b8825a]" />
                      Recent Activity
                    </h4>
                    <ActivityTimeline caseId={selectedCase.id} isStaff={isStaff} compact maxItems={5} />
                  </div>
                )}

                <Separator />

                <Button
                  className="w-full"
                  onClick={() => { setSelectedCase(null); navigate(`/cases/${selectedCase.id}`); }}
                  data-testid="button-view-full-case"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Full Case Details
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-case-info">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Info className="w-5 h-5 text-[#b8825a]" />
              {isClient ? "Your Mediation Case" : "About Cases"}
            </DialogTitle>
          </DialogHeader>

          {isClient ? (
            <div className="space-y-4 text-sm text-foreground" data-testid="case-info-client">
              <p>
                This page shows your mediation case. Here you can follow the progress of your mediation and see key details about your case.
              </p>

              <div>
                <h4 className="font-semibold mb-1.5">Case Status</h4>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <StatusBadge label="Active" dotColor={CASE_STATUS_STYLES.Active.dot} badgeClass={CASE_STATUS_STYLES.Active.badge} />
                  <span className="text-muted-foreground">•</span>
                  <StatusBadge label="On Hold" dotColor={CASE_STATUS_STYLES["On hold"]?.dot} badgeClass={CASE_STATUS_STYLES["On hold"]?.badge || ""} />
                  <span className="text-muted-foreground">•</span>
                  <StatusBadge label="Closed" dotColor={CASE_STATUS_STYLES.Closed?.dot} badgeClass={CASE_STATUS_STYLES.Closed?.badge || ""} />
                </div>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4 mt-2">
                  <li><span className="text-foreground font-medium">Active</span> — Your mediation is currently in progress</li>
                  <li><span className="text-foreground font-medium">On Hold</span> — Your case is paused, usually while waiting for a response</li>
                  <li><span className="text-foreground font-medium">Closed</span> — Your mediation has been completed or withdrawn</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-1.5">Your Journey</h4>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <StatusBadge label="Enquiry" badgeClass={CASE_STAGE_STYLES["Enquiry"]?.badge || ""} />
                  <span className="text-muted-foreground">→</span>
                  <StatusBadge label="MIAM" badgeClass={CASE_STAGE_STYLES["MIAM"]?.badge || ""} />
                  <span className="text-muted-foreground">→</span>
                  <StatusBadge label="Mediation" badgeClass={CASE_STAGE_STYLES["Mediation"]?.badge || ""} />
                  <span className="text-muted-foreground">→</span>
                  <StatusBadge label="Outcome" badgeClass={CASE_STAGE_STYLES["Outcome"]?.badge || ""} />
                </div>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4 mt-2">
                  <li><span className="text-foreground font-medium">Enquiry</span> — Your initial enquiry has been received and a case created</li>
                  <li><span className="text-foreground font-medium">MIAM</span> — Your Mediation Information and Assessment Meeting, an initial one-to-one session with a mediator</li>
                  <li><span className="text-foreground font-medium">Mediation</span> — Joint or individual mediation sessions are taking place</li>
                  <li><span className="text-foreground font-medium">Outcome</span> — Your mediation has reached a conclusion</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-1.5">Need Help?</h4>
                <p className="text-muted-foreground">
                  If you have any questions about your case or the mediation process, please contact your mediator directly. They are here to support you throughout your journey.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm text-foreground" data-testid="case-info-staff">
              <p>
                Cases are where mediation work is managed after an enquiry has created the case record. Use this page to find a case, check its progress, and open the full case details.
              </p>

              <div className="rounded-lg bg-[#a7baa4]/10 border border-[#a7baa4]/20 p-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{isMediator ? "Your view:" : "Staff view:"}</span>{" "}
                  {isMediator
                    ? "You can see cases where you are involved as the lead mediator, MIAM mediator, or party mediator."
                    : "Superadmins and subadmins can see the wider case picture, review activity, manage key case work, and take closure or archive actions where appropriate."}
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1.5">Where Intake Work Happens</h4>
                <p className="text-muted-foreground">
                  First contact, chasing, and closing the intake stage are handled from Enquiries. Cases is for the mediation work that follows, including MIAMs, sessions, documents, payments, notes, and overall progress.
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-1.5">Case Statuses</h4>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <StatusBadge label="Active" dotColor={CASE_STATUS_STYLES.Active.dot} badgeClass={CASE_STATUS_STYLES.Active.badge} />
                  <span className="text-muted-foreground">•</span>
                  <StatusBadge label="On Hold" dotColor={CASE_STATUS_STYLES["On hold"]?.dot} badgeClass={CASE_STATUS_STYLES["On hold"]?.badge || ""} />
                  <span className="text-muted-foreground">•</span>
                  <StatusBadge label="Closed" dotColor={CASE_STATUS_STYLES.Closed?.dot} badgeClass={CASE_STATUS_STYLES.Closed?.badge || ""} />
                </div>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4 mt-2">
                  <li><span className="text-foreground font-medium">Active</span> — Currently being worked on</li>
                  <li><span className="text-foreground font-medium">On Hold</span> — Temporarily paused (e.g. awaiting client response)</li>
                  <li><span className="text-foreground font-medium">Closed</span> — Mediation concluded or case withdrawn</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-1.5">Case Journey</h4>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <StatusBadge label="Enquiry" badgeClass={CASE_STAGE_STYLES["Enquiry"]?.badge || ""} />
                  <span className="text-muted-foreground">→</span>
                  <StatusBadge label="MIAM" badgeClass={CASE_STAGE_STYLES["MIAM"]?.badge || ""} />
                  <span className="text-muted-foreground">→</span>
                  <StatusBadge label="Mediation" badgeClass={CASE_STAGE_STYLES["Mediation"]?.badge || ""} />
                  <span className="text-muted-foreground">→</span>
                  <StatusBadge label="Outcome" badgeClass={CASE_STAGE_STYLES["Outcome"]?.badge || ""} />
                </div>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4 mt-2">
                  <li><span className="text-foreground font-medium">Enquiry / intake</span> — Initial contact and follow-up are managed from Enquiries</li>
                  <li><span className="text-foreground font-medium">MIAM</span> — One-to-one assessment meetings and MIAM records are managed on the case</li>
                  <li><span className="text-foreground font-medium">Mediation sessions</span> — Session planning, attendance, forms, payments, and follow-up are tracked on the case</li>
                  <li><span className="text-foreground font-medium">Outcome / closure</span> — Final outcomes, closure details, and follow-up consent are recorded when the case concludes</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-1.5">Common Case Work</h4>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                  <li>Open full case details to manage clients, MIAMs, mediation sessions, documents, payments, and notes</li>
                  <li>Review recent activity to see what has happened on the case</li>
                  <li>Use the documents area for uploaded files, signed forms, and court-form PDFs</li>
                  <li>Check safeguarding and shuttle mediation markers before planning next steps</li>
                </ul>
              </div>

              {(isMediator || user?.role === "superadmin" || user?.role === "subadmin") && (
                <div>
                  <h4 className="font-semibold mb-1.5">Operational Workflows</h4>
                  <Accordion type="single" collapsible className="w-full rounded-lg border px-3" data-testid="accordion-case-operational-workflows">
                    <AccordionItem value="financial-disclosure">
                      <AccordionTrigger className="text-left text-sm font-medium">Financial Disclosure</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-muted-foreground">
                        <p>
                          Financial Disclosure is available only for Family cases with the <span className="font-medium text-foreground">Property &amp; finance (PF)</span> or <span className="font-medium text-foreground">All issues mediation (AIM)</span> subtype. Open the case and select the <span className="font-medium text-foreground">Financial Disclosure</span> tab.
                        </p>
                        <p>
                          Each active client has a separate folder. Work through their online booklet, Financial Disclosure Checklist, Form E and OFS where required, then upload supporting evidence to the right category. Clients can complete only their own booklet and upload their own evidence; staff and assigned mediators can review both folders.
                        </p>
                        <p>
                          Superadmins and subadmins can set the initial OFS requirement. Assigned mediators can update it later while managing the disclosure workflow. Use the combined booklet view to compare Client A and Client B entries without merging their underlying records.
                        </p>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="draft-financial-schedule">
                      <AccordionTrigger className="text-left text-sm font-medium">Draft Financial Schedule</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-muted-foreground">
                        <p>
                          A separate Draft Financial Schedule is created automatically for each eligible confirmed Family PF/AIM mediation session. Open the relevant session in the <span className="font-medium text-foreground">Mediation Sessions tab</span> to review its schedule, status, PDF, and immutable version history.
                        </p>
                        <p>
                          The assigned lead mediator and accepted co-mediators can edit their session&apos;s schedule during the eligible live confirmed appointment, after confirming that both parties are present. Only the session lead can submit the completed schedule. Superadmins and subadmins can edit, review, and make approved corrections. Clients and observers cannot view or edit it.
                        </p>
                        <p>
                          Submission is bundled with that session&apos;s post-session summary. Admin approval releases that session&apos;s PDF to clients; requested changes return the schedule to the session team. A draft for a cancelled or replaced session is archived, and a later session starts from the latest approved schedule when one is available.
                        </p>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="cim-eligibility" className="border-b-0">
                      <AccordionTrigger className="text-left text-sm font-medium">CIM eligibility</AccordionTrigger>
                      <AccordionContent className="space-y-2 text-muted-foreground">
                        <p>
                          Open the case <span className="font-medium text-foreground">Overview</span> to find the CIM eligibility card. It shows the current state and any readiness blockers before a case can be marked eligible.
                        </p>
                        <p>
                          Both Client A and Client B must exist, have approved MIAM records, and the safeguarding decision must be complete and clear. Consent evidence must also be recorded as granted for Client A&apos;s <span className="font-medium text-foreground">CF10</span> and Client B&apos;s <span className="font-medium text-foreground">CF12</span>.
                        </p>
                        <p>
                          <span className="font-medium text-foreground">Only superadmins and subadmins can record consent and mark a case CIM eligible.</span> Mediators can use the card to understand missing steps but cannot change it. Once marked, the case receives the CIM marker and can be found using the CIM-eligible Cases filter.
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}

              <div>
                <h4 className="font-semibold mb-1.5">Shuttle Mediation</h4>
                <p className="text-muted-foreground">
                  When shuttle mediation is enabled, the mediator works with each party separately rather than bringing everyone together in the same session. Shuttle cases are shown with a <Shuffle className="w-3 h-3 inline text-amber-600" /> icon next to their reference number.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!archiveTarget}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title={`Archive case ${archiveTarget?.caseRef ?? ""}?`}
        description="Archived cases are hidden from the default lists and dashboard. You can restore them at any time from the Archived filter."
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        confirmLabel="Archive"
        cancelTestId="button-cancel-archive-case"
        confirmTestId="button-confirm-archive-case"
        isPending={archiveMutation.isPending}
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Permanently delete case?"
        description={`This will permanently remove case ${deleteTarget?.caseRef ?? ""} and all linked records (parties, appointments, notes, MIAM records, activities). This cannot be undone.`}
        onConfirm={(typed) => deleteTarget && hardDeleteMutation.mutate({ id: deleteTarget.id, confirm: typed ?? "" })}
        confirmLabel="Delete permanently"
        confirmText={deleteTarget?.caseRef}
        confirmInputTestId="input-confirm-delete-case"
        cancelTestId="button-cancel-delete-case"
        confirmTestId="button-confirm-delete-case"
        isPending={hardDeleteMutation.isPending}
      />
    </div>
  );
}
