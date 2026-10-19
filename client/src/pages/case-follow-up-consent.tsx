import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BFMLogoMark } from "@/components/bfm-logo";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export default function CaseFollowUpConsentPage() {
  const [, params] = useRoute("/case-follow-up-consent/:token");
  const token = params?.token;

  const { data, isLoading, error } = useQuery<{ success: boolean; firstName: string; caseRef: string }>({
    queryKey: ["/api/cases/follow-up-consent", token],
    queryFn: async () => {
      const res = await fetch(`/api/cases/follow-up-consent/${token}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Something went wrong");
      return body;
    },
    enabled: !!token,
    retry: false,
  });

  const consentMutation = useMutation<{ success: boolean; firstName: string }>({
    mutationFn: async () => {
      const res = await fetch(`/api/cases/follow-up-consent/${token}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Could not record your consent");
      return body;
    },
  });

  const accepted = consentMutation.data?.success;
  const firstName = consentMutation.data?.firstName || data?.firstName || "";
  const pageError = error || consentMutation.error;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f9f6f2] px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="flex justify-center mb-8">
          <BFMLogoMark className="h-16 w-auto" />
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-stone-200 overflow-hidden text-center">
          {isLoading && (
            <div className="p-8 space-y-6">
              <Loader2 className="w-12 h-12 text-[#5a7d58] animate-spin mx-auto" />
              <div>
                <h1 className="font-heading text-xl text-stone-800 mb-2">Checking your consent link...</h1>
                <p className="text-sm text-stone-500">Please wait a moment.</p>
              </div>
            </div>
          )}

          {!isLoading && data?.success && !accepted && !pageError && (
            <div>
              <div className="bg-gradient-to-br from-[#6b6b6b] to-[#4a4a4a] px-6 py-8">
                <h1 className="text-white text-[22px] m-0 font-semibold">Brighter Future Mediation</h1>
                <p className="text-white/70 text-[13px] mt-1.5 mb-0">Fully accredited online mediation specialists</p>
              </div>
              <div className="px-6 py-8 text-left">
                <h2 className="text-[#333] text-lg font-semibold mb-4">Follow-up contact consent</h2>
                <p className="text-[#555] text-sm leading-relaxed mb-4">Dear {firstName},</p>
                <p className="text-[#555] text-sm leading-relaxed mb-4">
                  Brighter Future Mediation would like your permission to contact you after your case closes for short follow-up checks.
                </p>
                <p className="text-[#555] text-sm leading-relaxed mb-6">
                  If you are happy for us to contact you, please confirm below.
                </p>
                <div className="text-center mb-6">
                  <Button
                    onClick={() => consentMutation.mutate()}
                    disabled={consentMutation.isPending}
                    className="bg-[#5a7d58] hover:bg-[#4a6948] text-white px-8 py-6 text-[15px] font-bold"
                    data-testid="button-case-follow-up-consent-grant"
                  >
                    {consentMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    I consent to follow-up contact
                  </Button>
                </div>
                <p className="text-[#888] text-xs leading-relaxed mb-0">
                  If you do not consent, you do not need to take any action. This link will expire in 30 days.
                </p>
              </div>
            </div>
          )}

          {!isLoading && accepted && (
            <div className="p-8 space-y-6">
              <div className="w-16 h-16 rounded-full bg-[#5a7d58]/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9 text-[#5a7d58]" />
              </div>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-3">
                  Thank you{firstName ? `, ${firstName}` : ""}
                </h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Your consent to follow-up contact has been recorded.
                </p>
              </div>
            </div>
          )}

          {!isLoading && pageError && !accepted && (
            <div className="p-8 space-y-6">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <XCircle className="w-9 h-9 text-destructive" />
              </div>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-3">Consent link unavailable</h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                  {pageError instanceof Error ? pageError.message : "This link is invalid or has expired."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
