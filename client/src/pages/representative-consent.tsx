import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { BFMLogoMark } from "@/components/bfm-logo";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

type Decision = "granted" | "withdrawn" | "refused";

export default function RepresentativeConsentPage() {
  const [, params] = useRoute("/consent/representative/:token");
  const token = params?.token;
  const [submitting, setSubmitting] = useState<Decision | null>(null);
  const [result, setResult] = useState<{ status: "success" | "error"; message: string; decision?: Decision; fullName?: string } | null>(null);
  const [validating, setValidating] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [recipientName, setRecipientName] = useState("");

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/representatives/consent/${token}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setResult({ status: "error", message: body.message || "Invalid or expired consent link" });
        } else {
          setLinkValid(true);
          setRecipientName(body.fullName || "");
        }
      } catch (err: any) {
        setResult({ status: "error", message: err?.message || "Could not validate link" });
      } finally {
        setValidating(false);
      }
    })();
  }, [token]);

  async function submit(decision: Decision) {
    if (!token) return;
    setSubmitting(decision);
    try {
      const res = await fetch(`/api/representatives/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not record your response");
      setResult({ status: "success", message: body.message || "Recorded", decision, fullName: body.fullName });
    } catch (err: any) {
      setResult({ status: "error", message: err?.message || "Something went wrong" });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f9f6f2] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <BFMLogoMark className="h-16 w-auto" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center space-y-6" data-testid="card-rep-consent">
          {validating && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-8 h-8 text-[#5a7d58] animate-spin" />
              <p className="text-sm text-stone-500">Checking link…</p>
            </div>
          )}

          {!validating && linkValid && !result && (
            <>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-2">Representative GDPR Consent</h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                  {recipientName ? <><strong>{recipientName}</strong> &mdash; you</> : "You"} have been listed as a representative on a mediation matter with Brighter Future Mediation.
                  Before we communicate with you about this case, please record your consent below.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <Button
                  className="w-full bg-[#5a7d58] hover:bg-[#4a6948] text-white"
                  size="lg"
                  disabled={!!submitting}
                  onClick={() => submit("granted")}
                  data-testid="button-consent-grant"
                >
                  {submitting === "granted" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  I consent &mdash; please contact me about this matter
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!!submitting}
                  onClick={() => submit("refused")}
                  data-testid="button-consent-refuse"
                >
                  {submitting === "refused" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  I do not consent
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-stone-500"
                  disabled={!!submitting}
                  onClick={() => submit("withdrawn")}
                  data-testid="button-consent-withdraw"
                >
                  Withdraw a previously given consent
                </Button>
              </div>

              <p className="text-xs text-stone-400 pt-4 border-t border-stone-100">
                You may change your mind at any time by contacting{" "}
                <a href="mailto:info@brighterfuturemediation.co.uk" className="text-[#5a7d58] hover:underline">
                  info@brighterfuturemediation.co.uk
                </a>.
              </p>
            </>
          )}

          {result?.status === "success" && (
            <>
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-[#5a7d58]/10 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-[#5a7d58]" />
                </div>
              </div>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-3" data-testid="text-rep-consent-success">
                  Thank you{result.fullName ? `, ${result.fullName}` : ""}
                </h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Your response{result.decision ? ` (${result.decision})` : ""} has been recorded.
                  A member of our team has been notified.
                </p>
              </div>
            </>
          )}

          {result?.status === "error" && (
            <>
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="w-9 h-9 text-destructive" />
                </div>
              </div>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-3">This link is no longer valid</h1>
                <p className="text-stone-600 text-sm leading-relaxed" data-testid="text-rep-consent-error">{result.message}</p>
                <p className="text-stone-500 text-xs mt-4">
                  Please contact{" "}
                  <a href="mailto:info@brighterfuturemediation.co.uk" className="text-[#5a7d58] hover:underline">
                    info@brighterfuturemediation.co.uk
                  </a>{" "}
                  if you need a new link.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
