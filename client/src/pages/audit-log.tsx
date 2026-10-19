import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ClipboardList, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { PaginationControls } from "@/components/shared/pagination";
import { apiRequest } from "@/lib/queryClient";
import { formatAuditAction, formatAuditEntity, parseAuditDetails } from "@shared/audit-log-utils";

interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string | null;
  userName: string;
  action: string;
  entity: string;
  entityId: string | null;
  entityRef: string | null;
  details: string | null;
  ipAddress: string | null;
}

interface AuditLogResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AuditLogOptions {
  actions: string[];
  entities: string[];
}

const ukTimestamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  timeZoneName: "short",
});

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : ukTimestamp.format(date);
}

function SearchableFilter({
  label, value, options, formatOption, onChange, testId,
}: {
  label: string;
  value: string | null;
  options: string[];
  formatOption: (value: string) => string;
  onChange: (value: string | null) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="h-9 w-[170px] justify-between gap-2 font-normal" data-testid={testId}>
          <span className="truncate">{value ? formatOption(value) : `All ${label}`}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[240px] p-0">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No {label.toLowerCase()} found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`All ${label}`} onSelect={() => { onChange(null); setOpen(false); }}>
                <Check className={value === null ? "opacity-100" : "opacity-0"} />All {label}
              </CommandItem>
              {options.map(option => (
                <CommandItem key={option} value={option} keywords={[formatOption(option)]}
                  onSelect={() => { onChange(option); setOpen(false); }}>
                  <Check className={value === option ? "opacity-100" : "opacity-0"} />
                  <span className="break-words">{formatOption(option)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AuditEntryDialog({ entry, onClose }: { entry: AuditLogEntry | null; onClose: () => void }) {
  if (!entry) return null;
  const fields: Array<[string, string]> = [
    ["Time (UK)", formatTimestamp(entry.timestamp)],
    ["Performed by", entry.userName],
    ["Action", formatAuditAction(entry.action)],
    ["Entity", formatAuditEntity(entry.entity)],
    ["Reference", entry.entityRef || "—"],
    ["Entity ID", entry.entityId || "—"],
    ["Actor ID", entry.userId || "—"],
    ["IP address", entry.ipAddress || "—"],
  ];
  const details = parseAuditDetails(entry.details);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-audit-entry">
        <DialogHeader>
          <DialogTitle>{formatAuditAction(entry.action)} · {formatAuditEntity(entry.entity)}</DialogTitle>
          <DialogDescription>Complete audit record. Times are shown in UK time.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-md border p-3">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-all text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Details</h3>
          {details.length === 0 ? <p className="text-sm text-muted-foreground">No additional details recorded.</p> : (
            <dl className="space-y-2">
              {details.map(([key, value]) => (
                <div key={key} className="rounded-md border p-3">
                  <dt className="text-xs font-medium text-muted-foreground break-all">{key}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AuditLogPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const optionsQuery = useQuery<AuditLogOptions>({
    queryKey: ["/api/audit-logs/options"],
    queryFn: async () => (await apiRequest("GET", "/api/audit-logs/options")).json(),
  });
  const options = optionsQuery.data;
  const queryParams = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) queryParams.set("search", search);
  if (entityFilter) queryParams.set("entity", entityFilter);
  if (actionFilter) queryParams.set("action", actionFilter);
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);

  const { data, isLoading, isError, error, refetch } = useQuery<AuditLogResponse>({
    queryKey: ["/api/audit-logs", page, limit, search, entityFilter, actionFilter, startDate, endDate],
    queryFn: async () => (await apiRequest("GET", `/api/audit-logs?${queryParams.toString()}`)).json(),
  });
  const hasFilters = Boolean(searchInput || entityFilter || actionFilter || startDate || endDate);
  const dateError = startDate && endDate && startDate > endDate;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <PageHeader title="Audit Log" subtitle="Track system activity and changes" icon={ClipboardList}
        iconColor="text-[#5a7d58]" iconBg="bg-[#a7baa4]/15" titleTestId="text-audit-log-title" />
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-end gap-3 p-4 border-b">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input aria-label="Search audit log" placeholder="Search actor, reference, action, entity, details..."
                value={searchInput} onChange={event => setSearchInput(event.target.value)}
                className="pl-9 h-9" data-testid="input-audit-search" />
            </div>
            <SearchableFilter label="Entities" value={entityFilter} options={options?.entities ?? []}
              formatOption={formatAuditEntity} onChange={value => { setEntityFilter(value); setPage(1); }}
              testId="select-audit-entity" />
            <SearchableFilter label="Actions" value={actionFilter} options={options?.actions ?? []}
              formatOption={formatAuditAction} onChange={value => { setActionFilter(value); setPage(1); }}
              testId="select-audit-action" />
            <label className="space-y-1 text-xs text-muted-foreground">From (UK)
              <Input type="date" value={startDate} onChange={event => { setStartDate(event.target.value); setPage(1); }}
                className="h-9 w-[155px] text-sm" data-testid="input-audit-start-date" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">To (UK)
              <Input type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setPage(1); }}
                className="h-9 w-[155px] text-sm" data-testid="input-audit-end-date" />
            </label>
            {hasFilters && <Button type="button" variant="ghost" size="sm" onClick={() => {
              setSearchInput(""); setSearch(""); setEntityFilter(null); setActionFilter(null);
              setStartDate(""); setEndDate(""); setPage(1);
            }}>Clear filters</Button>}
          </div>
          {dateError && <p className="px-4 pt-3 text-sm text-destructive">Start date must not be after end date.</p>}
          {optionsQuery.isError && <div className="px-4 pt-3 text-sm text-destructive" role="alert">
            Filter options could not be loaded. <Button variant="ghost" className="h-auto px-2" onClick={() => optionsQuery.refetch()}>Retry filters</Button>
          </div>}
          {isLoading ? <TableSkeleton columns={6} rows={10} /> : isError ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center" role="alert">
              <p className="font-medium">Could not load audit entries.</p>
              <p className="text-sm text-muted-foreground">{error instanceof Error && error.message.startsWith("400:") ? "Check the date range and try again." : "Please try again."}</p>
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : !data || data.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList className="w-12 h-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium" data-testid="text-audit-empty">
                {hasFilters ? "No matching audit entries" : "No audit log entries yet"}
              </p>
              <p className="text-muted-foreground/60 text-sm mt-1">
                {hasFilters ? "Try a different search or clear the filters." : "Activity will appear here as actions are performed."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-[190px]">Time (UK)</TableHead>
                    <TableHead className="w-[170px]">User</TableHead>
                    <TableHead className="w-[170px]">Action</TableHead>
                    <TableHead className="w-[140px]">Entity</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="w-[120px]">Details</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.data.map(entry => (
                      <TableRow key={entry.id} data-testid={`row-audit-${entry.id}`}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap" data-testid={`text-timestamp-${entry.id}`}>
                          {formatTimestamp(entry.timestamp)}
                        </TableCell>
                        <TableCell data-testid={`text-user-${entry.id}`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <User className="w-4 h-4 shrink-0 text-muted-foreground" />
                            <span className="text-sm font-medium break-words">{entry.userName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{formatAuditAction(entry.action)}</TableCell>
                        <TableCell className="text-sm" data-testid={`text-entity-${entry.id}`}>{formatAuditEntity(entry.entity)}</TableCell>
                        <TableCell className="text-sm font-mono break-all" data-testid={`text-ref-${entry.id}`}>{entry.entityRef || "—"}</TableCell>
                        <TableCell><Button variant="ghost" size="sm" className="px-2 underline" onClick={() => setSelectedEntry(entry)}
                          data-testid={`button-audit-details-${entry.id}`}>View details</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls page={data.page} totalPages={data.totalPages} limit={data.limit} total={data.total}
                onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} testIdPrefix="audit-pagination" />
            </>
          )}
        </CardContent>
      </Card>
      <AuditEntryDialog entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
