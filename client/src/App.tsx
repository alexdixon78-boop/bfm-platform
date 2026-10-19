import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { isPublicRoute } from "@/lib/public-routes";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import BookPage from "@/pages/book";
import DemographicFormPage from "@/pages/demographic-form";
import ConsentPage from "@/pages/consent";
import CaseFollowUpConsentPage from "@/pages/case-follow-up-consent";
import RepresentativeConsentPage from "@/pages/representative-consent";
import SessionAvailabilityPage from "@/pages/session-availability";
import OnboardingPage from "@/pages/onboarding";
import MediatorApplyPage from "@/pages/mediator-apply";
import ApplicantUpdatePage from "@/pages/applicant-update";
import ContractorApplyPage from "@/pages/contractor-apply";

function safeLoginReturnPath(loginLocation: string): string {
  const query = loginLocation.split("?")[1] || "";
  const returnTo = new URLSearchParams(query).get("returnTo");
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  if (returnTo.split(/[?#]/, 1)[0] === "/login") return "/";
  return returnTo;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Skeleton className="h-12 w-12 rounded-xl mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to={`/login?returnTo=${encodeURIComponent(location)}`} />;
  }

  return <Component />;
}

function AuthRoute() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Skeleton className="h-12 w-12 rounded-xl mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (user) {
    return <Redirect to={safeLoginReturnPath(location)} />;
  }

  return <LoginPage />;
}

function App() {
  const [location] = useLocation();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider skipUserQuery={isPublicRoute(location)}>
          <Toaster />
          <Switch>
            <Route path="/login" component={AuthRoute} />
            <Route path="/forgot-password" component={ForgotPasswordPage} />
            <Route path="/reset-password/:token" component={ResetPasswordPage} />
            <Route path="/register/:token" component={RegisterPage} />
            <Route path="/book/:token" component={BookPage} />
            <Route path="/demographic-form/:token" component={DemographicFormPage} />
            <Route path="/consent/representative/:token" component={RepresentativeConsentPage} />
            <Route path="/consent/:token" component={ConsentPage} />
            <Route path="/case-follow-up-consent/:token" component={CaseFollowUpConsentPage} />
            <Route path="/session-availability/:token" component={SessionAvailabilityPage} />
            <Route path="/onboarding" component={OnboardingPage} />
            <Route path="/apply/mediator/:token" component={MediatorApplyPage} />
            <Route path="/apply/contractor/:token" component={ContractorApplyPage} />
            <Route path="/update-application/:token" component={ApplicantUpdatePage} />
            <Route>
              <ProtectedRoute component={DashboardLayout} />
            </Route>
          </Switch>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
