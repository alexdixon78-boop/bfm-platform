import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MediatorDetailsButton } from "@/components/mediator/mediator-details-button";
import { getMediatorDetailsPath } from "@shared/mediator-profile-navigation";

function initials(name: string) { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

export default function MyProfilePage() {
  const { user } = useAuth();
  const mediatorDetailsPath = getMediatorDetailsPath(user);
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  const account = useMutation({
    mutationFn: async () => { await apiRequest("PATCH", "/api/account", { name }); },
    onSuccess: () => { void refresh(); toast({ title: "Name updated" }); },
    onError: (error: Error) => toast({ title: "Could not update name", description: error.message, variant: "destructive" }),
  });
  const password = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/account/password", { currentPassword, newPassword }); },
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); toast({ title: "Password updated" }); },
    onError: (error: Error) => toast({ title: "Could not update password", description: error.message, variant: "destructive" }),
  });
  const photo = useMutation({
    mutationFn: async (imageData: string) => { await apiRequest("POST", "/api/account/photo", { imageData }); },
    onSuccess: () => { void refresh(); toast({ title: user?.role === "mediator" ? "Picture uploaded for review" : "Picture updated" }); },
    onError: (error: Error) => toast({ title: "Could not upload picture", description: error.message, variant: "destructive" }),
  });

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ title: "Choose a PNG, JPEG or WebP image under 5 MB", variant: "destructive" }); return;
    }
    const imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });
    photo.mutate(imageData);
  }

  return <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
    <div><h1 className="text-2xl font-heading font-semibold">My profile</h1><p className="text-sm text-muted-foreground">Manage your account details and security.</p></div>
    <Card><CardHeader><CardTitle>Profile picture</CardTitle><CardDescription>{user?.role === "mediator" ? "Your account picture updates now. An admin reviews it before it appears on your mediator profile." : "This picture appears beside your name."}</CardDescription></CardHeader><CardContent className="flex items-center gap-5">
      <Avatar className="h-20 w-20"><AvatarImage src={user?.avatarUrl ?? undefined} alt="Your profile picture" /><AvatarFallback>{initials(user?.name ?? "")}</AvatarFallback></Avatar>
      <Input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload profile picture" disabled={photo.isPending} onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Account details</CardTitle><CardDescription>Your sign-in email is managed by an administrator.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div><label htmlFor="profile-name" className="text-sm font-medium">Name</label><Input id="profile-name" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></div>
      <div><p className="text-sm font-medium">Email</p><p className="text-sm text-muted-foreground">{user?.email}</p></div>
      <Button disabled={!name.trim() || account.isPending || name.trim() === user?.name} onClick={() => account.mutate()}>Save name</Button>
      {mediatorDetailsPath && <div className="space-y-2"><p className="text-sm text-muted-foreground">Your directory name will be reviewed separately.</p><MediatorDetailsButton mediatorId={user!.id} /></div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent className="space-y-4">
      <div><label htmlFor="current-password" className="text-sm font-medium">Current password</label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div><label htmlFor="new-password" className="text-sm font-medium">New password</label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
      <div><label htmlFor="confirm-password" className="text-sm font-medium">Confirm new password</label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <Button disabled={password.isPending || !currentPassword || newPassword.length < 6 || newPassword !== confirmPassword} onClick={() => password.mutate()}>Update password</Button>
    </CardContent></Card>
  </div>;
}
