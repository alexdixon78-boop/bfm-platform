import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Calendar, Lock } from "lucide-react";
import bfmLogoDark from "@assets/5.png_1771924570738.png";
import { onboardingDestination } from "@/lib/onboarding-destination";
import { useCalendarOAuthResult } from "@/hooks/use-calendar-oauth-result";

type ValidateSuccess = { valid: true; name: string; email: string };
type ValidateFailure = { valid: false; reason: "expired" | "not_found" };
type ValidateResult = ValidateSuccess | ValidateFailure;

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const initialParams = new URLSearchParams(window.location.search);
  const token = initialParams.get("token") ?? "";
  const calendarSetup = initialParams.get("calendarSetup") === "true";

  const [step, setStep] = useState<"password" | "calendar">(calendarSetup ? "calendar" : "password");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  useCalendarOAuthResult();

  const { data: validation, isLoading, error: fetchError } = useQuery<ValidateResult>({
    queryKey: ["/api/onboarding/validate", token],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding/validate?token=${encodeURIComponent(token)}`);
      return res.json();
    },
    enabled: !!token && !calendarSetup,
    retry: false,
  });

  useEffect(() => {
    if (validation?.valid && validation.name) {
      setUserName(validation.name);
    }
  }, [validation]);

  const setPasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to set password");
      return data;
    },
    onSuccess: (data: { role?: string }) => {
      const destination = onboardingDestination(data?.role ?? "");
      if (destination) {
        navigate(destination);
        return;
      }
      setStep("calendar");
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match");
      return;
    }
    setPasswordMutation.mutate();
  };

  function getStrength(pw: string): { label: string; color: string; width: string } {
    if (!pw) return { label: "", color: "", width: "0%" };
    if (pw.length < 8) return { label: "Too short", color: "bg-red-500", width: "20%" };
    let score = 0;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (pw.length >= 12) score++;
    if (score <= 1) return { label: "Weak", color: "bg-orange-400", width: "40%" };
    if (score === 2) return { label: "Fair", color: "bg-yellow-400", width: "60%" };
    if (score === 3) return { label: "Good", color: "bg-[#a7baa4]", width: "80%" };
    return { label: "Strong", color: "bg-[#5a7d58]", width: "100%" };
  }

  const strength = getStrength(password);

  const isInvalid = !calendarSetup && !isLoading && (fetchError || !validation?.valid);
  const shellClass = "rounded-3xl border border-white/70 bg-white/95 shadow-[0_24px_70px_rgba(90,125,88,0.12)] backdrop-blur-sm";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f7f5f2] px-4 py-8 sm:py-12" data-testid="onboarding-page">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#a7baa4]/10 blur-3xl" />
        <div className="absolute -bottom-28 right-1/4 h-72 w-72 rounded-full bg-[#dcae96]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col items-center justify-center gap-8">
        <div className="text-center">
          <img src={bfmLogoDark} alt="Brighter Future Mediation" className="mx-auto h-14 sm:h-16" data-testid="img-bfm-logo-onboarding" />
        </div>

        {!calendarSetup && isLoading && (
          <Card className={shellClass}>
            <CardContent className="p-8 sm:p-10 space-y-4">
              <Skeleton className="h-6 w-48 mx-auto" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        )}

        {!isLoading && isInvalid && (
          <Card className={shellClass} data-testid="onboarding-invalid">
            <CardContent className="p-8 sm:p-10 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto ring-8 ring-red-50/70">
                <AlertCircle className="w-7 h-7 text-red-500" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-semibold text-foreground mb-2">
                  {validation && !validation.valid && validation.reason === "expired"
                    ? "Invitation link expired"
                    : "Invalid invitation link"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {validation && !validation.valid && validation.reason === "expired"
                    ? "This invitation link has expired. Please ask your administrator to resend the invitation."
                    : "This invitation link is not valid. Please contact your administrator."}
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/login")} data-testid="button-onboarding-go-login">
                Back to login
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && validation?.valid && step === "password" && (
          <Card className={shellClass} data-testid="onboarding-step-password">
            <CardContent className="p-8 sm:p-10">
              <div className="mb-8 text-center sm:text-left">
                <div className="w-12 h-12 rounded-2xl bg-[#a7baa4]/20 flex items-center justify-center mb-4 mx-auto sm:mx-0">
                  <Lock className="w-6 h-6 text-[#5a7d58]" />
                </div>
                <h2 className="font-heading text-2xl font-semibold text-foreground tracking-tight">
                  Welcome, {validation.name}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Set up your password to access the BFM platform.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="onboarding-email">Email</Label>
                  <Input
                    id="onboarding-email"
                    type="email"
                    value={validation.email}
                    readOnly
                    className="bg-muted/40 text-muted-foreground"
                    data-testid="input-onboarding-email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="onboarding-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="onboarding-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="At least 8 characters"
                      className="pr-10"
                      data-testid="input-onboarding-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {password && (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${strength.color}`} style={{ width: strength.width }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground">{strength.label}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="onboarding-confirm">Confirm password</Label>
                  <div className="relative">
                    <Input
                      id="onboarding-confirm"
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Re-enter your password"
                      className="pr-10"
                      data-testid="input-onboarding-confirm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-confirm"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {formError && (
                  <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-3" data-testid="onboarding-error">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={setPasswordMutation.isPending}
                  data-testid="button-onboarding-submit"
                >
                  {setPasswordMutation.isPending ? "Setting up your account..." : "Set password & continue"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {step === "calendar" && (
          <div className="w-full max-w-2xl space-y-5" data-testid="onboarding-step-calendar">
            <Card className={shellClass}>
              <CardContent className="p-6 sm:p-10">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-full bg-[#5a7d58]/10 flex items-center justify-center mx-auto mb-4 ring-8 ring-[#a7baa4]/10">
                    <CheckCircle2 className="w-8 h-8 text-[#5a7d58]" />
                  </div>
                  <h2 className="font-heading text-3xl font-bold text-foreground tracking-tight">
                    Account set up!
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground max-w-md mx-auto">
                    Connect your calendar so BFM appointments sync automatically and you avoid double-booking.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-stretch">
                  <div className="group flex h-full flex-col rounded-2xl border border-[#a7baa4]/30 bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#5a7d58]/50 hover:shadow-lg">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-11 h-11 rounded-xl bg-[#a7baa4]/20 flex items-center justify-center shrink-0 group-hover:bg-[#a7baa4]/30 transition-colors">
                        <Calendar className="w-5 h-5 text-[#5a7d58]" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-base text-foreground">Google Calendar</p>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          Sync your BFM appointments automatically with your Google account.
                        </p>
                      </div>
                    </div>
                    <a
                      href="/api/auth/google?returnTo=onboarding"
                      className="block w-full mt-auto"
                      data-testid="button-connect-google-calendar"
                    >
                      <Button className="w-full bg-[#5a7d58] text-white hover:bg-[#4a6b48]" variant="default">
                        Connect Google Calendar
                      </Button>
                    </a>
                  </div>

                  <div
                    className="group flex h-full flex-col rounded-2xl border border-[#a7baa4]/30 bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#5a7d58]/50 hover:shadow-lg"
                    data-testid="card-outlook"
                  >
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-11 h-11 rounded-xl bg-[#a7baa4]/20 flex items-center justify-center shrink-0 group-hover:bg-[#a7baa4]/30 transition-colors">
                        <Calendar className="w-5 h-5 text-[#5a7d58]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-base text-foreground">Microsoft Outlook</p>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          Sync your BFM appointments with your Microsoft 365 / Outlook account.
                        </p>
                      </div>
                    </div>
                    <a href="/api/auth/outlook?returnTo=onboarding" className="block mt-auto w-full" data-testid="link-connect-outlook">
                      <Button className="mt-auto w-full bg-[#5a7d58] text-white hover:bg-[#4a6b48]" variant="default" data-testid="button-connect-outlook">
                        Connect Microsoft Outlook
                      </Button>
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="text-center">
              <button
                onClick={() => navigate("/dashboard")}
                className="text-xs text-muted-foreground transition-colors underline-offset-2 hover:text-foreground hover:underline"
                data-testid="button-skip-calendar"
              >
                Skip for now — go to dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
