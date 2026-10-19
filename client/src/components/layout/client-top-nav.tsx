import { Link, useLocation } from "wouter";
import { LayoutDashboard, Briefcase, Calendar, Users, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BFMLogo } from "@/components/bfm-logo";
import { ROLE_LABELS } from "@shared/permissions";
import { NotificationBell } from "@/components/notifications/notification-bell";

interface Tab {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  matchPrefix?: string;
}

const CLIENT_TABS: Tab[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Mediation", url: "/cases", icon: Briefcase, matchPrefix: "/cases" },
  { title: "Appointments", url: "/appointments", icon: Calendar, matchPrefix: "/appointments" },
  { title: "My Contacts", url: "/contacts", icon: Users, matchPrefix: "/contacts" },
];

export function ClientTopNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "U";
  const roleLabel = ROLE_LABELS[user?.role as keyof typeof ROLE_LABELS] || user?.role;

  return (
    <header
      className="sticky top-0 z-50 border-b bg-background"
      data-testid="client-top-nav"
    >
      <div className="flex items-center gap-4 px-4 md:px-6 h-14">
        <Link href="/" className="shrink-0" data-testid="link-client-nav-logo">
          <BFMLogo size={28} />
        </Link>
        <nav
          aria-label="Primary"
          className="flex-1 min-w-0 overflow-x-auto -mx-2 px-2"
        >
          <ul className="flex items-center gap-1">
            {CLIENT_TABS.map((t) => {
              const isActive = t.url === "/"
                ? location === "/"
                : location === t.url || (t.matchPrefix ? location.startsWith(t.matchPrefix + "/") || location === t.matchPrefix : false);
              return (
                <li key={t.url}>
                  <Link
                    href={t.url}
                    aria-current={isActive ? "page" : undefined}
                    data-testid={`tab-${t.title.toLowerCase()}`}
                    className={`inline-flex items-center gap-2 px-3 h-10 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? "bg-[#a7baa4]/20 text-[#5a7d58]"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    <span>{t.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <NotificationBell />
          <Link href="/my-profile" className="hidden sm:block text-right rounded-md hover:bg-muted px-2 py-1" aria-label="My profile">
            <p className="text-sm font-medium leading-tight" data-testid="text-user-name">{user?.name}</p>
            <p className="text-xs text-muted-foreground leading-tight">{roleLabel}</p>
          </Link>
          <Link href="/my-profile" aria-label="My profile picture"><Avatar className="h-8 w-8">
            <AvatarImage src={user?.avatarUrl ?? undefined} alt="" />
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
          </Avatar></Link>
          <Button size="icon" variant="ghost" onClick={logout} data-testid="button-logout" aria-label="Log out">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
