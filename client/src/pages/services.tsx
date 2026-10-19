import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Pencil, Trash2, Layers, Package, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ServiceApprovalDrawer, type ServiceApprovalSheetRow } from "@/components/mediator/service-approval-drawer";
import type { ServiceScheduleSlotRow } from "@/components/mediator-service-schedule-modal";
import { SERVICE_TYPE_CATEGORIES } from "@shared/schema";
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

type ServiceType = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  priceInfo?: string | null;
  onlinePaymentEnabled?: boolean;
  paymentAmountPence?: number | null;
  paymentCurrency?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  MIAM: { bg: "bg-[#a7baa4]/15", text: "text-[#5a7d58]", border: "border-[#a7baa4]/30" },
  Mediation: { bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800" },
  "Court & Documentation": { bg: "bg-[#dcae96]/15", text: "text-[#b8825a]", border: "border-[#dcae96]/30" },
  Packages: { bg: "bg-purple-50 dark:bg-purple-950/30", text: "text-purple-700 dark:text-purple-400", border: "border-purple-200 dark:border-purple-800" },
};

export default function ServicesPage() {
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceType | null>(null);
  const [selectedServiceType, setSelectedServiceType] = useState<ServiceType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceType | null>(null);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formPriceInfo, setFormPriceInfo] = useState("");
  const [formOnlinePaymentEnabled, setFormOnlinePaymentEnabled] = useState(false);
  const [paymentAmountPounds, setPaymentAmountPounds] = useState("");
  const [formSortOrder, setFormSortOrder] = useState("0");

  const { data: serviceTypes, isLoading } = useQuery<ServiceType[]>({
    queryKey: ["/api/service-types"],
  });

  const isMediator = user?.role === "mediator";
  const isSuperadmin = user?.role === "superadmin";

  const { data: serviceApprovals } = useQuery<ServiceApprovalSheetRow[]>({
    queryKey: ["/api/mediators", user?.id, "service-approvals"],
    enabled: !!user?.id && isMediator,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const { data: serviceScheduleSlots } = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", user?.id, "service-schedule-slots"],
    enabled: !!user?.id && isMediator,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const approvalByServiceId = useMemo(
    () => new Map((serviceApprovals ?? []).map((row) => [row.serviceTypeId, row])),
    [serviceApprovals],
  );

  const scheduleSlotsByServiceId = useMemo(() => {
    const map = new Map<string, ServiceScheduleSlotRow[]>();
    for (const row of serviceScheduleSlots ?? []) {
      const arr = map.get(row.serviceTypeId) ?? [];
      arr.push(row);
      map.set(row.serviceTypeId, arr);
    }
    return map;
  }, [serviceScheduleSlots]);

  const selectedApproval = selectedServiceType ? (approvalByServiceId.get(selectedServiceType.id) ?? null) : null;
  const selectedScheduleSlots = selectedServiceType ? (scheduleSlotsByServiceId.get(selectedServiceType.id) ?? []) : [];

  const createMutation = useMutation({
    mutationFn: async (data: Partial<ServiceType>) => {
      const res = await apiRequest("POST", "/api/service-types", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
      toast({ title: "Service type created" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to create", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServiceType> }) => {
      const res = await apiRequest("PATCH", `/api/service-types/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
      toast({ title: "Service type updated" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to update", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/service-types/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to toggle", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/service-types/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-types"] });
      toast({ title: "Service type deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Unable to delete service type", description: getApiErrorMessage(err), variant: "destructive" });
    },
  });

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormDescription("");
    setFormCategory("");
    setFormPriceInfo("");
    setFormOnlinePaymentEnabled(false);
    setPaymentAmountPounds("");
    setFormSortOrder("0");
    setDialogOpen(true);
  }

  function openEdit(st: ServiceType) {
    setEditing(st);
    setFormName(st.name);
    setFormDescription(st.description || "");
    setFormCategory(st.category);
    setFormPriceInfo(st.priceInfo || "");
    setFormOnlinePaymentEnabled(Boolean(st.onlinePaymentEnabled));
    setPaymentAmountPounds(st.paymentAmountPence ? (st.paymentAmountPence / 100).toFixed(2) : "");
    setFormSortOrder(String(st.sortOrder));
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountPence = paymentAmountPounds.trim()
      ? Math.round(Number(paymentAmountPounds) * 100)
      : null;
    if (formOnlinePaymentEnabled && (!amountPence || amountPence <= 0)) {
      toast({ title: "Payment amount required", description: "Enter a positive GBP amount before enabling online payment.", variant: "destructive" });
      return;
    }
    const data = {
      name: formName,
      description: formDescription || null,
      category: formCategory,
      priceInfo: formPriceInfo || null,
      onlinePaymentEnabled: formOnlinePaymentEnabled,
      paymentAmountPence: amountPence,
      paymentCurrency: "gbp",
      sortOrder: parseInt(formSortOrder) || 0,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  const grouped = SERVICE_TYPE_CATEGORIES.map((cat) => ({
    category: cat,
    items: (serviceTypes || []).filter((s) => s.category === cat),
  })).filter((g) => g.items.length > 0);

  const totalActive = serviceTypes?.filter((s) => s.isActive).length ?? 0;
  const totalInactive = serviceTypes?.filter((s) => !s.isActive).length ?? 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="services-page">
      <PageHeader
        title="Services"
        subtitle={isMediator ? "Browse services and manage service-specific requests" : "Manage service types and pricing information"}
        icon={Layers}
        iconColor="text-[#5a7d58]"
        iconBg="bg-[#a7baa4]/15"
        titleTestId="text-services-title"
        action={canEdit("services") ? (
          <Button onClick={openCreate} data-testid="button-add-service-type">
            <Plus className="w-4 h-4 mr-2" />
            Add service type
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-card rounded-xl border p-4 flex items-center gap-3" data-testid="text-stat-total-services">
          <div className="w-10 h-10 rounded-lg bg-[#a7baa4]/15 flex items-center justify-center">
            <Package className="w-5 h-5 text-[#5a7d58]" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total services</p>
            <p className="text-xl font-semibold">{isLoading ? "—" : serviceTypes?.length ?? 0}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-card rounded-xl border p-4 flex items-center gap-3" data-testid="text-stat-active-services">
          <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Active</p>
            <p className="text-xl font-semibold">{isLoading ? "—" : totalActive}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-card rounded-xl border p-4 flex items-center gap-3" data-testid="text-stat-inactive-services">
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <XCircle className="w-5 h-5 text-gray-400" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Inactive</p>
            <p className="text-xl font-semibold">{isLoading ? "—" : totalInactive}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </CardContent>
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Layers className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <p>No service types found</p>
            {canEdit("services") && (
              <p className="text-sm mt-1">Click "Add service type" to get started</p>
            )}
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => {
          const colors = CATEGORY_COLORS[group.category] || CATEGORY_COLORS.Packages;
          return (
            <div key={group.category} className="space-y-2" data-testid={`section-category-${group.category.toLowerCase().replace(/\s+/g, "-")}`}>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`${colors.bg} ${colors.text} ${colors.border} text-xs`}>
                  {group.category}
                </Badge>
                <span className="text-xs text-muted-foreground">{group.items.length} service{group.items.length !== 1 ? "s" : ""}</span>
              </div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead>Service</TableHead>
                        <TableHead className="hidden md:table-cell">Description</TableHead>
                        {!isMediator && <TableHead>Price Info</TableHead>}
                        {!isMediator && <TableHead>Online payment</TableHead>}
                        <TableHead>Service status</TableHead>
                        {isMediator && <TableHead>Approval status</TableHead>}
                        {canEdit("services") && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.items.map((st) => (
                        <TableRow
                          key={st.id}
                          className={`${isMediator ? "cursor-pointer hover:bg-muted/20" : "hover:bg-muted/20"}`}
                          data-testid={`row-service-${st.id}`}
                          role={isMediator ? "button" : undefined}
                          tabIndex={isMediator ? 0 : undefined}
                          onClick={isMediator ? () => setSelectedServiceType(st) : undefined}
                          onKeyDown={isMediator ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedServiceType(st);
                            }
                          } : undefined}
                        >
                          <TableCell className="font-medium" data-testid={`text-service-name-${st.id}`}>
                            {isMediator ? (
                              <button
                                type="button"
                                className="text-left font-medium hover:underline"
                                onClick={() => setSelectedServiceType(st)}
                              >
                                {st.name}
                              </button>
                            ) : (
                              st.name
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-xs truncate" data-testid={`text-service-desc-${st.id}`}>{st.description || "—"}</TableCell>
                          {!isMediator && (
                            <TableCell className="text-sm" data-testid={`text-service-price-${st.id}`}>{st.priceInfo || "—"}</TableCell>
                          )}
                          {!isMediator && (
                            <TableCell className="text-sm" data-testid={`text-service-online-payment-${st.id}`}>
                              {st.onlinePaymentEnabled && st.paymentAmountPence ? `£${(st.paymentAmountPence / 100).toFixed(2)}` : "Off"}
                            </TableCell>
                          )}
                          <TableCell>
                            {canEdit("services") ? (
                              <Switch
                                checked={st.isActive}
                                onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: st.id, isActive: checked })}
                                data-testid={`switch-service-active-${st.id}`}
                              />
                            ) : (
                              <Badge
                                variant="outline"
                                className={st.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"}
                                data-testid={`badge-service-state-${st.id}`}
                              >
                                {st.isActive ? "Active" : "Inactive"}
                              </Badge>
                            )}
                          </TableCell>
                          {isMediator && (
                            <TableCell>
                              {(() => {
                                const approval = approvalByServiceId.get(st.id);
                                const status = (approval?.effectiveStatus ?? approval?.status ?? "").toLowerCase();
                                if (!approval) {
                                  return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-200">Not requested</Badge>;
                                }
                                const badgeClass =
                                  status === "approved"
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : status === "pending_review"
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : status === "rejected" || status === "expired" || status === "revoked"
                                        ? "bg-red-50 text-red-700 border-red-200"
                                        : "bg-gray-100 text-gray-500 border-gray-200";
                                return (
                                  <Badge variant="outline" className={`capitalize ${badgeClass}`}>
                                    {status.replaceAll("_", " ")}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                          )}
                          {canEdit("services") && (
                            <TableCell className="text-right">
                              <Button size="sm" variant="ghost" onClick={() => openEdit(st)} data-testid={`button-edit-service-${st.id}`}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              {isSuperadmin && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(st)}
                                  data-testid={`button-delete-service-${st.id}`}
                                  aria-label={`Delete ${st.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          );
        })
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editing ? "Edit service type" : "Add new service type"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="st-name">Name</Label>
              <Input id="st-name" value={formName} onChange={(e) => setFormName(e.target.value)} required data-testid="input-service-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-category">Category</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger data-testid="select-service-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-description">Description</Label>
              <Textarea id="st-description" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={3} data-testid="input-service-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="st-price">Price info</Label>
                <Input id="st-price" value={formPriceInfo} onChange={(e) => setFormPriceInfo(e.target.value)} placeholder="e.g. From £150" data-testid="input-service-price" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-sort">Sort order</Label>
                <Input id="st-sort" type="number" value={formSortOrder} onChange={(e) => setFormSortOrder(e.target.value)} data-testid="input-service-sort" />
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="st-online-payment">Online payment</Label>
                  <p className="text-xs text-muted-foreground">Enable Stripe Checkout for public booking links.</p>
                </div>
                <Switch
                  id="st-online-payment"
                  checked={formOnlinePaymentEnabled}
                  onCheckedChange={setFormOnlinePaymentEnabled}
                  data-testid="switch-service-online-payment"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="st-payment-amount">Payment amount (GBP)</Label>
                <Input
                  id="st-payment-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentAmountPounds}
                  onChange={(e) => setPaymentAmountPounds(e.target.value)}
                  placeholder="150.00"
                  data-testid="input-service-payment-amount"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isPending || !formCategory} data-testid="button-submit-service">
              {isPending ? "Saving..." : editing ? "Update service type" : "Create service type"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service type</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete {deleteTarget?.name}? This cannot be undone. Services linked to appointments, invoices, mediator approvals, or schedules cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteTarget || deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
              data-testid="button-confirm-delete-service"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete service"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isMediator && (
        <ServiceApprovalDrawer
          key={selectedServiceType?.id ?? "none"}
          open={selectedServiceType !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedServiceType(null);
          }}
          mediatorId={user?.id ?? ""}
          serviceTypeId={selectedServiceType?.id ?? ""}
          serviceType={selectedServiceType ? { id: selectedServiceType.id, name: selectedServiceType.name, category: selectedServiceType.category } : null}
          approval={selectedApproval}
          scheduleSlots={selectedScheduleSlots}
        />
      )}
    </div>
  );
}
