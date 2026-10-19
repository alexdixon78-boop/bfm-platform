import { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BFMLogoMark } from "@/components/bfm-logo";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react";

export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/reset-password/:token");
  const token = params?.token;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: validation, isLoading, error: fetchError } = useQuery<{ valid: boolean }>({
    queryKey: ["/api/auth/reset-password", token],
    queryFn: async () => {
      const res = await fetch(`/api/auth/reset-password/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Invalid or expired reset link");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to reset password");
      }
      return res.json();
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to reset password. Please try again.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    resetMutation.mutate();
  };

  useEffect(() => {
    if (resetMutation.isSuccess) {
      const timer = setTimeout(() => navigate("/login"), 3000);
      return () => clearTimeout(timer);
    }
  }, [resetMutation.isSuccess, navigate]);

  const invalidToken = fetchError || (!isLoading && !validation);
  const cardClasses = "shadow-lg border-0 overflow-hidden";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: "linear-gradient(180deg, #f8f6f3 0%, #f0ece6 100%)" }} data-testid="reset-password-page">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <BFMLogoMark size={52} />
          </div>
          <h1 className="text-2xl font-heading font-semibold text-foreground">
            Brighter Future Mediation
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">Case Management System</p>
        </div>

        {isLoading && (
          <Card className={cardClasses}>
            <div className="h-1.5 bg-gradient-to-r from-[#a7baa4] to-[#dcae96]" />
            <CardContent className="p-8 space-y-5">
              <Skeleton className="h-6 w-48 mx-auto" />
              <Skeleton className="h-4 w-64 mx-auto" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        )}

        {invalidToken && !isLoading && (
          <Card className={cardClasses}>
            <div className="h-1.5 bg-gradient-to-r from-red-400 to-red-300" />
            <CardContent className="p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                </div>
              </div>
              <h2 className="text-lg font-heading font-semibold" data-testid="text-reset-error">
                Invalid Reset Link
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-reset-error-detail">
                {(fetchError as Error)?.message || "This password reset link is invalid or has expired. Please request a new one."}
              </p>
              <div className="pt-2">
                <Link href="/forgot-password" className="text-sm text-[#5a7d58] hover:text-[#4a6c49] font-medium transition-colors" data-testid="link-request-new-reset">
                  Request a new reset link
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {validation && !invalidToken && !resetMutation.isSuccess && (
          <Card className={cardClasses}>
            <div className="h-1.5 bg-gradient-to-r from-[#a7baa4] to-[#dcae96]" />
            <CardHeader className="pb-4 pt-6">
              <div className="flex justify-center mb-2">
                <div className="w-10 h-10 rounded-full bg-[#a7baa4]/15 flex items-center justify-center">
                  <KeyRound className="w-5 h-5 text-[#5a7d58]" />
                </div>
              </div>
              <CardTitle className="text-lg font-heading text-center">
                Set New Password
              </CardTitle>
              <p className="text-sm text-muted-foreground text-center mt-1.5 leading-relaxed">
                Enter your new password below. It must be at least 6 characters.
              </p>
            </CardHeader>
            <CardContent className="pb-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="pr-10"
                      required
                      data-testid="input-reset-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      data-testid="button-toggle-reset-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your new password"
                    required
                    data-testid="input-reset-confirm-password"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20" data-testid="text-reset-form-error">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[#5a7d58] hover:bg-[#4a6c49] text-white shadow-sm"
                  disabled={resetMutation.isPending}
                  data-testid="button-reset-submit"
                >
                  {resetMutation.isPending ? "Resetting password..." : "Reset Password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {resetMutation.isSuccess && (
          <Card className={cardClasses}>
            <div className="h-1.5 bg-gradient-to-r from-[#5a7d58] to-[#a7baa4]" />
            <CardContent className="p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-[#a7baa4]/15 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-[#5a7d58]" />
                </div>
              </div>
              <h2 className="text-lg font-heading font-semibold" data-testid="text-reset-success">
                Password Reset Complete
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-reset-success-detail">
                Your password has been updated successfully. Redirecting to sign in...
              </p>
              <div className="pt-2">
                <Link href="/login">
                  <Button className="bg-[#5a7d58] hover:bg-[#4a6c49] text-white shadow-sm" data-testid="button-go-to-login">
                    Sign In
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Brighter Future Mediation Ltd &middot; Case Management System
        </p>
      </div>
    </div>
  );
}
