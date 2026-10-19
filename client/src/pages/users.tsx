import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Plus, Pencil, Trash2, Users, ShieldCheck, Shield, Send } from "lucide-react";
import { ROLE_LABELS } from "@shared/permissions";
import { CONTRACTOR_TYPES } from "@shared/schema";
import { canSendTeamUserInvite } from "@shared/team-user-invitation";
import { StatCard } from "@/components/shared/stat-card";
import { AvatarCell } from "@/components/shared/avatar-cell";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { DeleteDialog } from "@/components/shared/delete-dialog";

type SafeUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  contractorType?: string | null;
};

function roleColor(role: string) {
  switch (role) {
    case "superadmin": return { bg: "bg-[#dcae96]/20", text: "text-[#b8825a]", badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30" };
    case "subadmin": return { bg: "bg-[#dcae96]/20", text: "text-[#b8825a]", badge: "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30" };
    case "staff": return { bg: "bg-[#a7baa4]/20", text: "text-[#5a7d58]", badge: "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30" };
    default: return { bg: "bg-gray-100", text: "text-gray-600", badge: "bg-gray-100 text-gray-600 border-gray-200" };
  }
}

export default function UsersPage() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { canEdit } = usePermissions();
  const isStaffActor = currentUser?.role === "staff";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SafeUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeUser | null>(null);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState("staff");
  const [formStaffType, setFormStaffType] = useState("");

  const { data: usersList, isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; role: string; contractorType?: string | null }) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: (data: { emailSent: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast(data.emailSent
        ? { title: "Invitation sent" }
        : { title: "User created", description: "The invitation email could not be sent. Check email configuration, then resend it from this table.", variant: "destructive" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create user", variant: "destructive" });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/users/${id}/send-invite`);
      return res.json() as Promise<{ emailSent: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast(data.emailSent
        ? { title: "Invitation resent" }
        : { title: "Invitation refreshed", description: "The email could not be sent. Check email configuration and try again.", variant: "destructive" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message || "Failed to resend invitation", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User updated" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update user", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted" });
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to delete user", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingUser(null);
    setFormName("");
    setFormEmail("");
    setFormRole(isStaffActor ? "staff" : "subadmin");
    setFormStaffType("");
    setDialogOpen(true);
  }

  function openEdit(user: SafeUser) {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormRole(user.role);
    setFormStaffType(user.role === "staff" ? (user.contractorType ?? "") : "");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingUser(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingUser) {
      const data: any = editingUser.role === "superadmin"
        ? { name: formName, email: formEmail }
        : { name: formName, email: formEmail, role: formRole };
      if (formRole === "staff") data.contractorType = formStaffType || null;
      else data.contractorType = null;
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      createMutation.mutate({
        name: formName,
        email: formEmail,
        role: formRole,
        contractorType: formRole === "staff" ? (formStaffType || null) : null,
      });
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canManageUser = (user: SafeUser) => canEdit("users") && (!isStaffActor || user.role === "staff");

  const superadminCount = usersList?.filter(u => u.role === "superadmin").length ?? 0;
  const subadminCount = usersList?.filter(u => u.role === "subadmin").length ?? 0;
  const staffCount = usersList?.filter(u => u.role === "staff").length ?? 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="users-page">
      <PageHeader
        title="Users"
        subtitle="Manage admin user accounts"
        icon={Users}
        iconColor="text-[#b8825a]"
        iconBg="bg-[#dcae96]/15"
        titleTestId="text-users-title"
        action={canEdit("users") ? (
          <Button onClick={openCreate} data-testid="button-add-user">
            <Plus className="w-4 h-4 mr-2" />
            Add user
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Superadmins"
          value={superadminCount}
          icon={ShieldCheck}
          iconColor="text-[#b8825a]"
          iconBg="bg-[#dcae96]/15"
          isLoading={isLoading}
          testId="text-stat-superadmins"
        />
        <StatCard
          label="Sub-admins"
          value={subadminCount}
          icon={Shield}
          iconColor="text-[#b8825a]"
          iconBg="bg-[#dcae96]/15"
          isLoading={isLoading}
          testId="text-stat-subadmins"
        />
        <StatCard
          label="Staff"
          value={staffCount}
          icon={Users}
          iconColor="text-[#5a7d58]"
          iconBg="bg-[#a7baa4]/15"
          isLoading={isLoading}
          testId="text-stat-staff"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Activation status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersList && usersList.length > 0 ? usersList.map(u => {
                  const colors = roleColor(u.role);
                  return (
                    <TableRow key={u.id} className="hover:bg-muted/20" data-testid={`row-user-${u.id}`}>
                      <TableCell>
                        <AvatarCell
                          name={u.name}
                          bgClass={colors.bg}
                          textClass={colors.text}
                          testId={`text-user-name-${u.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-user-email-${u.id}`}>{u.email}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}
                          badgeClass={colors.badge}
                          testId={`badge-user-role-${u.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-user-type-${u.id}`}>
                        {u.role === "staff" ? (u.contractorType ?? "—") : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          label={u.status === "pending" ? "Pending invite" : u.status === "active" ? "Active" : u.status}
                          badgeClass={u.status === "pending" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30"}
                          testId={`badge-user-status-${u.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {canManageUser(u) && (
                          <div className="flex items-center justify-end gap-1">
                            {canSendTeamUserInvite(u) && (
                              <Button size="sm" variant="ghost" onClick={() => inviteMutation.mutate(u.id)} disabled={inviteMutation.isPending} title="Resend invitation" data-testid={`button-resend-invite-${u.id}`}>
                                <Send className="w-4 h-4" />
                                <span className="sr-only">Resend invite</span>
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => openEdit(u)} data-testid={`button-edit-user-${u.id}`}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {currentUser?.id !== u.id && (
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(u)} data-testid={`button-delete-user-${u.id}`}>
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
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                      <p>No users found</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editingUser ? "Edit user" : "Add new user"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Full name</Label>
              <Input id="user-name" value={formName} onChange={e => setFormName(e.target.value)} required data-testid="input-user-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required data-testid="input-user-email" />
            </div>
            {editingUser?.role === "superadmin" ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">Superadmin role is fixed</p>
                <p className="text-muted-foreground">You can update this account’s name and login email, but not its role or password here.</p>
              </div>
            ) : <>
              <div className="space-y-2">
                <Label htmlFor="user-role">Role</Label>
                <Select
                  value={formRole}
                  onValueChange={v => {
                    setFormRole(v);
                    if (v !== "staff") setFormStaffType("");
                  }}
                >
                  <SelectTrigger data-testid="select-user-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!isStaffActor && <SelectItem value="subadmin">{ROLE_LABELS.subadmin}</SelectItem>}
                    <SelectItem value="staff">{ROLE_LABELS.staff}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formRole === "staff" && (
                <div className="space-y-2">
                  <Label htmlFor="user-staff-type">Staff type</Label>
                  <Select value={formStaffType} onValueChange={setFormStaffType}>
                    <SelectTrigger data-testid="select-user-staff-type">
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACTOR_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!editingUser && <p className="text-xs text-muted-foreground">The user will receive a secure email invitation to set their own password.</p>}
            </>}
            <Button
              type="submit"
              className="w-full"
              disabled={isPending || (editingUser?.role !== "superadmin" && formRole === "staff" && !formStaffType)}
              data-testid="button-submit-user"
            >
              {isPending ? "Saving..." : editingUser ? "Update user" : "Send invitation"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete user"
        description={`Are you sure you want to delete ${deleteTarget?.name}? This action cannot be undone.`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        cancelTestId="button-cancel-delete"
        confirmTestId="button-confirm-delete"
      />
    </div>
  );
}
