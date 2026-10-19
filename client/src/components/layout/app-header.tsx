import { useAuth } from "@/hooks/use-auth";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "wouter";
import { LogOut } from "lucide-react";
import { BFMLogoMark } from "@/components/bfm-logo";
import { ROLE_LABELS } from "@shared/permissions";
import { NotificationBell } from "@/components/notifications/notification-bell";

export function AppHeader() {
  const { user, logout } = useAuth();
  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "U";

  const roleLabel = ROLE_LABELS[user?.role as keyof typeof ROLE_LABELS] || user?.role;

  return (
    <header className="flex items-center justify-between gap-2 px-4 h-14 border-b bg-background sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <div className="hidden md:flex items-center gap-2" data-testid="text-header-logo">
          <BFMLogoMark size={32} />
          <span className="text-sm font-heading font-semibold text-foreground">
            Brighter Future Mediation
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <NotificationBell />
        <Link href="/my-profile" className="hidden sm:block text-right rounded-md hover:bg-muted px-2 py-1" aria-label="My profile">
          <p className="text-sm font-medium text-foreground leading-tight" data-testid="text-user-name">
            {user?.name}
          </p>
          <p className="text-xs text-muted-foreground leading-tight">
            {roleLabel}
          </p>
        </Link>
        <Link href="/my-profile" aria-label="My profile picture"><Avatar className="h-8 w-8">
          <AvatarImage src={user?.avatarUrl ?? undefined} alt="" />
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {initials}
          </AvatarFallback>
        </Avatar></Link>
        <Button
          size="icon"
          variant="ghost"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
