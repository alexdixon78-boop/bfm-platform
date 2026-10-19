import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginData } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BFMLogoMark } from "@/components/bfm-logo";
import { Eye, EyeOff } from "lucide-react";
import bfmLogoDark from "@assets/5.png_1771924570738.png";
import fmcLogo from "@assets/FMC_logo_1771923562209.jpg";
import comLogo from "@assets/CoM_logo.png";
import fmaLogo from "@assets/FMA_logo.png";
import mojLogo from "@assets/MOJ_logo_1771923562210.png";
import { useCalendarOAuthResult } from "@/hooks/use-calendar-oauth-result";

export default function LoginPage() {
  useCalendarOAuthResult();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginData) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(data);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("401")) {
        setError("Invalid email or password");
      } else {
        try {
          const jsonPart = msg.substring(msg.indexOf("{"));
          const parsed = JSON.parse(jsonPart);
          setError(parsed.message || "Something went wrong. Please try again.");
        } catch {
          setError("Something went wrong. Please try again.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col items-center justify-center"
        style={{
          background:
            "linear-gradient(135deg, #6b6b6b 0%, #585858 40%, #4a4a4a 100%)",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/15" />
        <div className="relative z-10 px-12 text-center max-w-lg flex-1 flex flex-col items-center justify-center">
          <img
            src={bfmLogoDark}
            alt="Brighter Future Mediation"
            className="w-64 mx-auto mb-8"
            data-testid="img-bfm-logo-login"
          />
          <p className="text-white/85 text-lg leading-relaxed">
            Fully online mediation and coaching with FMC and CMC registered
            mediators
          </p>
        </div>
        <div className="relative z-10 pb-8 px-12 text-center">
          <p className="text-white/60 text-lg mb-4">
            FMC Accredited &middot; Regulated Service
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <a href="https://www.familymediationcouncil.org.uk" target="_blank" rel="noopener noreferrer">
              <img
                src={fmcLogo}
                alt="Family Mediation Council"
                className="h-20 rounded object-contain"
                data-testid="img-fmc-logo"
              />
            </a>
            <a href="https://www.collegeofmediators.co.uk" target="_blank" rel="noopener noreferrer">
              <img
                src={comLogo}
                alt="College of Mediators"
                className="h-14 object-contain"
                data-testid="img-com-logo"
              />
            </a>
            <a href="https://www.thefma.co.uk" target="_blank" rel="noopener noreferrer">
              <img
                src={fmaLogo}
                alt="Family Mediators Association"
                className="h-14 object-contain"
                data-testid="img-fma-logo"
              />
            </a>
            <a href="https://www.gov.uk/guidance/family-mediation-voucher-scheme" target="_blank" rel="noopener noreferrer">
              <img
                src={mojLogo}
                alt="Ministry of Justice"
                className="h-20 object-contain bg-white/90 rounded p-1"
                data-testid="img-moj-logo"
              />
            </a>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center justify-center mb-8">
            <BFMLogoMark size={48} className="mr-3" />
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                Brighter Future
              </h1>
              <p className="text-sm text-muted-foreground">Mediation Ltd</p>
            </div>
          </div>

          <div className="mb-8">
            <h2
              className="text-2xl font-heading font-semibold text-foreground"
              data-testid="text-login-title"
            >
              Welcome back
            </h2>
            <p className="text-muted-foreground mt-1">
              Sign in to your account to continue
            </p>
          </div>

          <Card>
            <CardContent className="pt-6">
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-5"
              >
                {error && (
                  <div
                    className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-md"
                    data-testid="text-login-error"
                  >
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="example@demo.co.uk"
                    data-testid="input-email"
                    {...form.register("email")}
                  />
                  {form.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-[#5a7d58] hover:text-[#4a6c49] font-medium transition-colors"
                      data-testid="link-forgot-password"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      className="pr-10"
                      data-testid="input-password"
                      {...form.register("password")}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      data-testid="button-toggle-login-password"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                  data-testid="button-sign-in"
                >
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Brighter Future Mediation Ltd &middot; Case Management System
          </p>
        </div>
      </div>
    </div>
  );
}
