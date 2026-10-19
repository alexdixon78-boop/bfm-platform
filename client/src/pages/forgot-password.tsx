import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BFMLogoMark } from "@/components/bfm-logo";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Something went wrong");
      }
      setSubmitted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cardClasses = "shadow-lg border-0 overflow-hidden";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: "linear-gradient(180deg, #f8f6f3 0%, #f0ece6 100%)" }} data-testid="forgot-password-page">
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

        {!submitted ? (
          <Card className={cardClasses}>
            <div className="h-1.5 bg-gradient-to-r from-[#a7baa4] to-[#dcae96]" />
            <CardContent className="p-8">
              <div className="flex justify-center mb-4">
                <div className="w-12 h-12 rounded-full bg-[#a7baa4]/15 flex items-center justify-center">
                  <Mail className="w-6 h-6 text-[#5a7d58]" />
                </div>
              </div>
              <h2 className="text-lg font-heading font-semibold text-center mb-2" data-testid="text-forgot-title">
                Forgot your password?
              </h2>
              <p className="text-sm text-muted-foreground text-center mb-6 leading-relaxed">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    data-testid="input-forgot-email"
                  />
                </div>

                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20" data-testid="text-forgot-error">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[#5a7d58] hover:bg-[#4a6c49] text-white shadow-sm"
                  disabled={isSubmitting}
                  data-testid="button-send-reset-link"
                >
                  {isSubmitting ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>

              <div className="mt-4 text-center">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back-to-login">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to sign in
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className={cardClasses}>
            <div className="h-1.5 bg-gradient-to-r from-[#5a7d58] to-[#a7baa4]" />
            <CardContent className="p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-[#a7baa4]/15 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-[#5a7d58]" />
                </div>
              </div>
              <h2 className="text-lg font-heading font-semibold" data-testid="text-forgot-success-title">
                Check your email
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-forgot-success-message">
                If an account exists for <span className="font-medium text-foreground">{email}</span>, we've sent a password reset link. Please check your inbox and spam folder.
              </p>
              <p className="text-xs text-muted-foreground">
                The link will expire in 1 hour.
              </p>
              <div className="pt-2">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-[#5a7d58] hover:text-[#4a6c49] font-medium transition-colors" data-testid="link-back-to-login-success">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to sign in
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
