import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  MessageSquare,
  MessageCircle,
  Mail,
  FilePenLine,
  Briefcase,
  Calendar,
  Users,
  UserCog,
  FileText,
  PoundSterling,
  BarChart3,
  Settings,
  Shield,
  ClipboardList,
  KeyRound,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  ListChecks,
  Building2,
  ShieldAlert,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { BFMLogo, BFMLogoMark } from "@/components/bfm-logo";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface MenuItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  section: string;
  staffOnly?: boolean;
  superadminOnly?: boolean;
  adminOnly?: boolean;
  staffComplaintOnly?: boolean;
  emailAdminOnly?: boolean;
}

const menuItems: MenuItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, section: "dashboard" },
  { title: "Enquiries", url: "/enquiries", icon: MessageSquare, section: "enquiries" },
  { title: "Mail Inbox", url: "/mail-inbox", icon: Mail, section: "enquiries", staffOnly: true, adminOnly: true },
  { title: "Email templates", url: "/email-templates", icon: FilePenLine, section: "settings", emailAdminOnly: true },
  { title: "Cases", url: "/cases", icon: Briefcase, section: "cases" },
  { title: "Appointments", url: "/appointments", icon: Calendar, section: "appointments" },
  { title: "Tasks", url: "/tasks", icon: ListChecks, section: "cases", staffOnly: true },
  { title: "Complaints", url: "/complaints", icon: ShieldAlert, section: "dashboard", superadminOnly: true },
  { title: "Raise complaint", url: "/raise-complaint", icon: ShieldAlert, section: "dashboard", staffComplaintOnly: true },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle, section: "whatsapp", staffOnly: true },
  { title: "Clients", url: "/clients", icon: Users, section: "clients" },
  { title: "Mediators", url: "/mediators", icon: UserCog, section: "mediators" },
  { title: "Mediator Applicants", url: "/mediator-applicants", icon: UserCog, section: "mediators", staffOnly: true },
  { title: "Contractors", url: "/contractors", icon: Building2, section: "contractors" },
  { title: "Contractor Pipeline", url: "/contractor-pipeline", icon: Building2, section: "contractors", staffOnly: true },
  { title: "Services", url: "/services", icon: Layers, section: "services" },
  { title: "Finance", url: "/finance", icon: PoundSterling, section: "finance" },
  { title: "Forms", url: "/court-forms", icon: FileText, section: "court_forms" },
  { title: "Reports", url: "/reports", icon: BarChart3, section: "reports" },
  { title: "Users", url: "/users", icon: Shield, section: "users" },
  { title: "API", url: "/api-integrations", icon: KeyRound, section: "settings", superadminOnly: true },
  { title: "Audit Log", url: "/audit-log", icon: ClipboardList, section: "audit_log" },
  { title: "Settings", url: "/settings", icon: Settings, section: "settings" },
];

const SETTINGS_ROLES = new Set(["superadmin", "subadmin", "mediator"]);

export function AppSidebar() {
  const [location] = useLocation();
  const { canView } = usePermissions();
  const { user } = useAuth();
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isClient = user?.role === "client";
  const isContractor = user?.role === "contractor";

  const visibleItems = isContractor ? [] : menuItems.filter(item => {
    if (item.staffOnly && isClient) return false;
    if (item.superadminOnly && user?.role !== "superadmin") return false;
    if (item.staffComplaintOnly && user?.role !== "staff") return false;
    if (item.adminOnly && user?.role !== "superadmin" && user?.role !== "subadmin") return false;
    if (item.emailAdminOnly && user?.role !== "superadmin" && user?.role !== "subadmin") return false;
    if (item.url === "/settings") return !!user?.role && SETTINGS_ROLES.has(user.role);
    if (item.superadminOnly || item.staffComplaintOnly) return true;
    if (!canView(item.section)) return false;
    return true;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3 transition-all duration-200">
        <Link href="/" className="block overflow-hidden">
          <div className={`transition-all duration-200 ${isCollapsed ? "flex items-center justify-center" : ""}`}>
            {isCollapsed ? (
              <BFMLogoMark size={28} className="transition-transform duration-200 scale-100" data-testid="img-bfm-logo-collapsed" />
            ) : (
              <div className="transition-opacity duration-200 opacity-100">
                <BFMLogo size={32} />
              </div>
            )}
          </div>
        </Link>
      </SidebarHeader>
      <Separator className="mx-2 w-auto bg-sidebar-border" />
      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = item.url === "/" ? location === "/" : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className="text-sidebar-foreground/70 hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium"
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4 shrink-0" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <Separator className="mx-2 w-auto bg-sidebar-border" />
      <SidebarFooter className="p-2">
        {!isCollapsed && (
          <p className="text-[10px] text-muted-foreground/60 text-center pb-1">
            v1.0 · Phase 2
          </p>
        )}
        {!isMobile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="w-full h-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
            data-testid="button-sidebar-collapse"
          >
            {isCollapsed ? (
              <ChevronsRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronsLeft className="w-4 h-4 mr-2" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
