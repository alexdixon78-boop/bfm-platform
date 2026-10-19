import { useEffect, useState } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { ClientTopNav } from "@/components/layout/client-top-nav";
import { MissingDemographicsModal } from "@/components/missing-demographics-modal";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";
import AccessDeniedPage from "@/pages/access-denied";
import DashboardPage from "@/pages/dashboard";
import EnquiriesPage from "@/pages/enquiries";
import EnquiryDetailPage from "@/pages/enquiry-detail";
import MailInboxPage from "@/pages/mail-inbox";
import CasesPage from "@/pages/cases";
import CaseDetailPage from "@/pages/case-detail";
import UsersPage from "@/pages/users";
import MediatorsPage from "@/pages/mediators";
import MediatorDetailPage from "@/pages/mediator-detail";
import MediatorApplicantsPage from "@/pages/mediator-applicants";
import ContractorsPage from "@/pages/contractors";
import ContractorPipelinePage from "@/pages/contractor-pipeline";
import ContractorHomePage from "@/pages/contractor-home";
import ClientsPage from "@/pages/clients";
import ClientDetailPage from "@/pages/client-detail";
import ContactsPage from "@/pages/contacts";
import SettingsPage from "@/pages/settings";
import AuditLogPage from "@/pages/audit-log";
import ServicesPage from "@/pages/services-page";
import AppointmentsPage from "@/pages/appointments";
import TasksPage from "@/pages/tasks";
import ApiIntegrationsPage from "@/pages/api-integrations";
import WhatsAppPage from "@/pages/whatsapp";
import FinancePage from "@/pages/finance";
import CourtFormsPage from "@/pages/court-forms";
import ReportsPage from "@/pages/reports";
import NotFound from "@/pages/not-found";
import ComplaintsPage from "@/pages/complaints";
import ComplaintDetailPage from "@/pages/complaint-detail";
import RaiseComplaintPage from "@/pages/raise-complaint";
import EmailTemplatesPage from "@/pages/email-templates";
import MyProfilePage from "@/pages/my-profile";
import NotificationsPage from "@/pages/notifications";

// Mediator detail page is accessible to staff with `mediators` permission AND
// to any mediator viewing their OWN record (so a mediator can manage their
// profile/EDI/credentials/bio without being granted the `mediators` section).
function MediatorDetailRoute({ paramId }: { paramId: string }) {
  const { canView, isLoading } = usePermissions();
  const { user } = useAuth();
  if (isLoading)
    return (
      <div className="p-8 flex items-center justify-center min-h-[40vh]">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  if (user?.role === "contractor") return <Redirect to="/contractor-home" />;
  const isSelf = user?.role === "mediator" && user.id === paramId;
  if (!isSelf && !canView("mediators")) return <AccessDeniedPage />;
  return <MediatorDetailPage />;
}

function GuardedPage({
  section,
  component: Component,
  staffOnly,
  clientOnly,
  superadminOnly,
  adminOnly,
  allowedRoles,
}: {
  section: string;
  component: React.ComponentType;
  staffOnly?: boolean;
  clientOnly?: boolean;
  superadminOnly?: boolean;
  adminOnly?: boolean;
  allowedRoles?: string[];
}) {
  const { canView, isLoading } = usePermissions();
  const { user } = useAuth();
  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[40vh]">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (user?.role === "contractor") return <Redirect to="/contractor-home" />;
  // clientOnly takes precedence: hard-block any non-client role at the route
  // boundary even if their default permission grant would allow it (e.g.
  // superadmin's blanket allow-all). This keeps client-portal-only pages
  // strictly partitioned from staff UX.
  if (clientOnly && user?.role !== "client") return <AccessDeniedPage />;
  if (superadminOnly && user?.role !== "superadmin")
    return <AccessDeniedPage />;
  if (adminOnly && user?.role !== "superadmin" && user?.role !== "subadmin")
    return <AccessDeniedPage />;
  if (allowedRoles) {
    return user?.role && allowedRoles.includes(user.role) ? <Component /> : <AccessDeniedPage />;
  }
  if (!canView(section)) return <AccessDeniedPage />;
  if (staffOnly && user?.role === "client") return <AccessDeniedPage />;
  return <Component />;
}

function ClientRedirect() {
  const { canView } = usePermissions();
  const { user } = useAuth();
  if (user?.role === "contractor") return <Redirect to="/contractor-home" />;
  if (canView("dashboard"))
    return <GuardedPage section="dashboard" component={DashboardPage} />;
  if (canView("cases")) return <Redirect to="/cases" />;
  return <AccessDeniedPage />;
}

function ContractorHomeRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[40vh]">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (user?.role !== "contractor") return <AccessDeniedPage />;
  return <ContractorHomePage />;
}

function ComplaintDetailRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  if (!user || user.role === "contractor") return <AccessDeniedPage />;
  return <ComplaintDetailPage />;
}

function RaiseComplaintRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading)
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  if (
    !user ||
    !["superadmin", "subadmin", "staff", "mediator", "client"].includes(
      user.role,
    )
  )
    return <AccessDeniedPage />;
  return <RaiseComplaintPage />;
}

const style = {
  "--sidebar-width": "15rem",
  "--sidebar-width-icon": "3.5rem",
};

type MissingDemographicsCase = {
  caseId: string;
  caseRef: string;
  stage: string;
  status: string;
};

function getSidebarCookieState(): boolean {
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=([^;]*)/);
  if (match) return match[1] === "true";
  return true;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/my-profile" component={MyProfilePage} />
      <Route path="/notifications" component={NotificationsPage} />
      <Route path="/" component={ClientRedirect} />
      <Route path="/dashboard" component={ClientRedirect} />
      <Route path="/enquiries/:id">
        {() => (
          <GuardedPage
            section="enquiries"
            component={EnquiryDetailPage}
            staffOnly
          />
        )}
      </Route>
      <Route path="/enquiries">
        {() => <GuardedPage section="enquiries" component={EnquiriesPage} />}
      </Route>
      <Route path="/mail-inbox">
        {() => (
          <GuardedPage
            section="enquiries"
            component={MailInboxPage}
            staffOnly
            adminOnly
          />
        )}
      </Route>
      <Route path="/cases/:id">
        {() => <GuardedPage section="cases" component={CaseDetailPage} />}
      </Route>
      <Route path="/cases">
        {() => <GuardedPage section="cases" component={CasesPage} />}
      </Route>
      <Route path="/mediators/:id">
        {(p) => <MediatorDetailRoute paramId={p.id} />}
      </Route>
      <Route path="/mediator-applicants">
        {() => (
          <GuardedPage
            section="mediators"
            component={MediatorApplicantsPage}
            staffOnly
          />
        )}
      </Route>
      <Route path="/mediators">
        {() => <GuardedPage section="mediators" component={MediatorsPage} />}
      </Route>
      <Route path="/contractors">
        {() => (
          <GuardedPage
            section="contractors"
            component={ContractorsPage}
            staffOnly
          />
        )}
      </Route>
      <Route path="/contractor-pipeline">
        {() => (
          <GuardedPage
            section="contractors"
            component={ContractorPipelinePage}
            staffOnly
          />
        )}
      </Route>
      <Route path="/contractor-home" component={ContractorHomeRoute} />
      <Route path="/clients/:id">
        {() => <GuardedPage section="clients" component={ClientDetailPage} />}
      </Route>
      <Route path="/clients">
        {() => <GuardedPage section="clients" component={ClientsPage} />}
      </Route>
      <Route path="/contacts">
        {() => (
          <GuardedPage section="contacts" component={ContactsPage} clientOnly />
        )}
      </Route>
      <Route path="/services">
        {() => <GuardedPage section="services" component={ServicesPage} />}
      </Route>
      <Route path="/appointments">
        {() => (
          <GuardedPage section="appointments" component={AppointmentsPage} />
        )}
      </Route>
      <Route path="/tasks">
        {() => <GuardedPage section="cases" component={TasksPage} staffOnly />}
      </Route>
      <Route path="/complaints/:id" component={ComplaintDetailRoute} />
      <Route path="/complaints">
        {() => (
          <GuardedPage
            section="dashboard"
            component={ComplaintsPage}
            superadminOnly
          />
        )}
      </Route>
      <Route path="/raise-complaint" component={RaiseComplaintRoute} />
      <Route path="/whatsapp">
        {() => (
          <GuardedPage section="whatsapp" component={WhatsAppPage} staffOnly />
        )}
      </Route>
      <Route path="/finance">
        {() => <GuardedPage section="finance" component={FinancePage} />}
      </Route>
      <Route path="/court-forms">
        {() => <GuardedPage section="court_forms" component={CourtFormsPage} />}
      </Route>
      <Route path="/reports">
        {() => <GuardedPage section="reports" component={ReportsPage} />}
      </Route>
      <Route path="/users">
        {() => <GuardedPage section="users" component={UsersPage} />}
      </Route>
      <Route path="/api-integrations">
        {() => (
          <GuardedPage
            section="settings"
            component={ApiIntegrationsPage}
            superadminOnly
          />
        )}
      </Route>
      <Route path="/audit-log">
        {() => <GuardedPage section="audit_log" component={AuditLogPage} />}
      </Route>
      <Route path="/email-templates">
        {() => <GuardedPage section="settings" component={EmailTemplatesPage} adminOnly />}
      </Route>
      <Route path="/settings">
        {() => <GuardedPage section="settings" component={SettingsPage} allowedRoles={["superadmin", "subadmin", "mediator"]} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export function DashboardLayout() {
  const { user, isLoading } = useAuth();
  const isClient = user?.role === "client";
  const [location] = useLocation();
  const isClientDashboard = location === "/dashboard" || location === "/";
  const [demogModalOpen, setDemogModalOpen] = useState(false);

  const { data: missingDemCases } = useQuery<MissingDemographicsCase[]>({
    queryKey: ["/api/client/cases/missing-demographics"],
    enabled: !isLoading && isClient,
  });

  useEffect(() => {
    if (!isClient) return;
    if (isClientDashboard) {
      setDemogModalOpen(false);
      return;
    }
    if (!missingDemCases || missingDemCases.length === 0) return;
    if (
      typeof window !== "undefined" &&
      sessionStorage.getItem("bfm:demogPromptDismissed") === "1"
    )
      return;
    setDemogModalOpen(true);
  }, [isClient, isClientDashboard, missingDemCases]);

  const dismissDemogModal = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("bfm:demogPromptDismissed", "1");
    }
    setDemogModalOpen(false);
  };

  // Clients get a top-tab nav shell instead of the staff sidebar. Staff
  // (superadmin/subadmin/mediator/contractor) keep the existing sidebar.
  if (!isLoading && isClient) {
    return (
      <div className="flex flex-col min-h-screen w-full">
        <MissingDemographicsModal
          open={demogModalOpen}
          cases={missingDemCases ?? []}
          onDismiss={dismissDemogModal}
        />
        <ClientTopNav />
        <main className="flex-1 bg-muted/30">
          <AppRoutes />
        </main>
      </div>
    );
  }

  return (
    <SidebarProvider
      defaultOpen={getSidebarCookieState()}
      style={style as React.CSSProperties}
    >
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <AppHeader />
          <main className="flex-1 overflow-auto bg-muted/30">
            <AppRoutes />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
