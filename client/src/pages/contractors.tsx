import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordField } from "@/components/ui/password-field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Building2, Search, Mail } from "lucide-react";
import { CONTRACTOR_TYPES, type PaginatedResponse } from "@shared/schema";
import { format } from "date-fns";
import { StatCard } from "@/components/shared/stat-card";
import { AvatarCell } from "@/components/shared/avatar-cell";
import { PageHeader } from "@/components/shared/page-header";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { PaginationControls } from "@/components/shared/pagination";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import { Badge } from "@/components/ui/badge";

type Contractor = {
  id: string;
  email: string;
  name: string;
  role: string;
  status?: string;
  contractorType?: string | null;
  lastLoginAt?: string | null;
};

const TABLE_COLS = 6;

export default function ContractorsPage() {
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const { user } = useAuth();
  const canDeleteContractors = user?.role === "superadmin" || user?.role === "subadmin";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContractor, setEditingContractor] = useState<Contractor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contractor | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortDirection>(null);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formContractorType, setFormContractorType] = useState<string>("");
  const [formContractorTypeOther, setFormContractorTypeOther] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("active");
  const [formSendInvite, setFormSendInvite] = useState(false);

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

  const { data: paginatedData, isLoading } = useQuery<PaginatedResponse<Contractor>>({
    queryKey: ["/api/contractors", { page, limit, search: debouncedSearch, sortBy, sortOrder }],
    queryFn: async () => {
      const res = await fetch(`/api/contractors?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contractors");
      return res.json();
    },
  });

  const contractors = paginatedData?.data;
  const totalCount = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;

  const totalStatsQuery = useQuery<PaginatedResponse<Contractor>>({
    queryKey: ["/api/contractors", { page: 1, limit: 200, search: "", sortBy: null, sortOrder: null }],
    queryFn: async () => {
      const res = await fetch("/api/contractors?page=1&limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const allForStats = totalStatsQuery.data?.data || [];
  const totalContractors = totalStatsQuery.data?.total ?? 0;
  const totalPending = allForStats.filter(c => c.status === "pending").length;
  const statsLoading = totalStatsQuery.isLoading;

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password?: string; contractorType?: string | null; sendInvite?: boolean }) => {
      const { sendInvite, ...createPayload } = data;
      const res = await apiRequest("POST", "/api/contractors", createPayload);
      const created = await res.json();
      const newId = created?.id ?? created?.user?.id;
      let inviteSent = false;
      if (sendInvite && newId) {
        try {
          await apiRequest("POST", `/api/contractors/${newId}/send-invite`);
          inviteSent = true;
        } catch (e: any) {
          throw new Error(`Contractor created, but invite email failed: ${e?.message || "unknown error"}`);
        }
      }
      return { ...created, _inviteSent: inviteSent };
    },
    onSuccess: (data: { _inviteSent?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      toast({
        title: data._inviteSent ? "Contractor created and invite sent" : "Contractor created",
      });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to create contractor", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; email: string; password?: string; contractorType?: string | null; status?: string } }) => {
      const res = await apiRequest("PATCH", `/api/contractors/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      toast({ title: "Contractor updated" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to update contractor", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/contractors/${id}`);
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contractors"] });
      toast({ title: "Contractor deleted", description: data.message });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to remove contractor", variant: "destructive" });
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/contractors/${id}/send-invite`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Invite sent", description: "The contractor will receive an email with a link to set up their account." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to send invite", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingContractor(null);
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setFormContractorType("");
    setFormContractorTypeOther("");
    setFormStatus("active");
    setFormSendInvite(false);
    setDialogOpen(true);
  }

  function openEdit(contractor: Contractor) {
    setEditingContractor(contractor);
    setFormName(contractor.name);
    setFormEmail(contractor.email);
    setFormPassword("");
    const storedType = contractor.contractorType || "";
    if (storedType.startsWith("Other — ")) {
      setFormContractorType("Other");
      setFormContractorTypeOther(storedType.slice("Other — ".length));
    } else {
      setFormContractorType(storedType);
      setFormContractorTypeOther("");
    }
    setFormStatus(contractor.status === "inactive" ? "inactive" : "active");
    setFormSendInvite(false);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingContractor(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolvedType = formContractorType === "Other" && formContractorTypeOther.trim()
      ? `Other — ${formContractorTypeOther.trim()}`
      : (formContractorType || null);
    const contractorType = resolvedType;
    if (editingContractor) {
      const data: { name: string; email: string; password?: string; contractorType?: string | null; status?: string } = {
        name: formName,
        email: formEmail,
        contractorType,
      };
      if (formPassword) data.password = formPassword;
      if (editingContractor.status !== "pending") {
        data.status = formStatus;
      }
      updateMutation.mutate({ id: editingContractor.id, data });
    } else {
      createMutation.mutate({
        name: formName,
        email: formEmail,
        password: formPassword || undefined,
        contractorType,
        sendInvite: !formPassword && formSendInvite,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="contractors-page">
      <PageHeader
        title="Contractors"
        subtitle="Manage external contractors (marketing, finance, legal and others)"
        icon={Building2}
        iconColor="text-[#5a7d58]"
        iconBg="bg-[#a7baa4]/15"
        titleTestId="text-contractors-title"
        action={canEdit("contractors") ? (
          <Button onClick={openCreate} data-testid="button-add-contractor">
            <Plus className="w-4 h-4 mr-2" />
            Add contractor
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          label="Total contractors"
          value={totalContractors}
          icon={Building2}
          iconColor="text-[#5a7d58]"
          iconBg="bg-[#a7baa4]/15"
          isLoading={statsLoading}
          testId="text-stat-total-contractors"
        />
        <StatCard
          label="Pending invites"
          value={totalPending}
          icon={Mail}
          iconColor="text-[#b8825a]"
          iconBg="bg-[#dcae96]/15"
          isLoading={statsLoading}
          testId="text-stat-pending-contractors"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email or type..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="pl-9"
            data-testid="input-search-contractors"
          />
        </div>
        {debouncedSearch && (
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
                    <SortableTableHead label="Contractor" sortKey="name" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-contractor-name" />
                    <SortableTableHead label="Email" sortKey="email" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-contractor-email" />
                    <SortableTableHead label="Type" sortKey="contractorType" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-contractor-type" />
                    <TableHead>Status</TableHead>
                    <TableHead>Last login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contractors && contractors.length > 0 ? contractors.map(c => (
                    <TableRow key={c.id} className="hover:bg-muted/20" data-testid={`row-contractor-${c.id}`}>
                      <TableCell>
                        <AvatarCell
                          name={c.name}
                          bgClass="bg-[#a7baa4]/20"
                          textClass="text-[#5a7d58]"
                          testId={`text-contractor-name-${c.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-contractor-email-${c.id}`}>
                        {c.email}
                      </TableCell>
                      <TableCell data-testid={`text-contractor-type-${c.id}`}>
                        {c.contractorType ? (
                          <Badge variant="outline" className="font-normal">
                            {c.contractorType}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.status === "pending" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200" data-testid={`badge-pending-${c.id}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                            Pending invite
                          </span>
                        ) : c.status === "inactive" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200" data-testid={`badge-inactive-${c.id}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
                            Inactive
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" data-testid={`badge-active-${c.id}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            Active
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-contractor-last-login-${c.id}`}>
                        {c.lastLoginAt ? format(new Date(c.lastLoginAt), "d MMM yyyy, HH:mm") : (
                          <span className="text-xs italic">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canEdit("contractors") && c.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => sendInviteMutation.mutate(c.id)}
                              disabled={sendInviteMutation.isPending}
                              data-testid={`button-send-invite-${c.id}`}
                            >
                              <Mail className="w-4 h-4 mr-1" />
                              Send invite
                            </Button>
                          )}
                          {canEdit("contractors") && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(c)}
                                data-testid={`button-edit-contractor-${c.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              {canDeleteContractors && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteTarget(c)}
                                  data-testid={`button-delete-contractor-${c.id}`}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={TABLE_COLS} className="text-center py-12 text-muted-foreground">
                        No contractors found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          limit={limit}
          onLimitChange={setLimit}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-contractor">
          <DialogHeader>
            <DialogTitle>{editingContractor ? "Edit contractor" : "Add contractor"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contractor-name">Name *</Label>
              <Input
                id="contractor-name"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                required
                data-testid="input-contractor-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractor-email">Email *</Label>
              <Input
                id="contractor-email"
                type="email"
                value={formEmail}
                onChange={e => setFormEmail(e.target.value)}
                required
                data-testid="input-contractor-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractor-type">Contractor type</Label>
              <Select
                value={formContractorType || "__none__"}
                onValueChange={(v) => {
                  setFormContractorType(v === "__none__" ? "" : v);
                  if (v !== "Other") setFormContractorTypeOther("");
                }}
              >
                <SelectTrigger id="contractor-type" data-testid="select-contractor-type">
                  <SelectValue placeholder="Select a type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not set —</SelectItem>
                  {CONTRACTOR_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formContractorType === "Other" && (
                <Input
                  value={formContractorTypeOther}
                  onChange={e => setFormContractorTypeOther(e.target.value)}
                  placeholder="Please specify…"
                  data-testid="input-contractor-type-other"
                />
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="contractor-password">
                {editingContractor ? "New password (optional)" : "Password (optional)"}
              </Label>
              <PasswordField
                id="contractor-password"
                value={formPassword}
                onChange={e => setFormPassword(e.target.value)}
                placeholder={editingContractor ? "Leave blank to keep current" : "Leave blank to send invite later"}
                showStrength
                data-testid="input-contractor-password"
                toggleTestId="button-toggle-contractor-password"
              />
              <p className="text-xs text-muted-foreground">
                {editingContractor
                  ? "Set a new password to override the contractor's existing one."
                  : "If left blank, the contractor will be created with a pending status — tick the option below to immediately email them an account-setup link, or use \"Send invite\" later."}
              </p>
            </div>

            {!editingContractor && !formPassword && (
              <div className="flex items-start gap-2 p-3 rounded-md border bg-muted/30">
                <Checkbox
                  id="contractor-send-invite"
                  checked={formSendInvite}
                  onCheckedChange={(v) => setFormSendInvite(v === true)}
                  data-testid="checkbox-send-invite"
                />
                <div className="space-y-1">
                  <Label htmlFor="contractor-send-invite" className="cursor-pointer">
                    Email account-setup invite immediately
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    The contractor will receive an email with a time-limited link to choose their own password.
                  </p>
                </div>
              </div>
            )}

            {editingContractor && editingContractor.status !== "pending" && (
              <div className="space-y-2">
                <Label htmlFor="contractor-status">Account status</Label>
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger id="contractor-status" data-testid="select-contractor-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive (cannot log in)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Inactive contractors keep their record and history but cannot sign in.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel-contractor">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending || (formContractorType === "Other" && !formContractorTypeOther.trim())}
                data-testid="button-save-contractor"
              >
                {isPending ? "Saving..." : (editingContractor ? "Save changes" : "Create contractor")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete contractor?"
        description={`This will permanently delete ${deleteTarget?.name}. This action cannot be undone.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
