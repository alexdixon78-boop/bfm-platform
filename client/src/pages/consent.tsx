import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BFMLogoMark } from "@/components/bfm-logo";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function ConsentPage() {
  const [, params] = useRoute("/consent/:token");
  const token = params?.token;

  const { data, isLoading, error } = useQuery<{ success: boolean; firstName: string }>({
    queryKey: ["/api/enquiries/consent", token],
    queryFn: async () => {
      const res = await fetch(`/api/enquiries/consent/${token}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Something went wrong");
      return body;
    },
    enabled: !!token,
    retry: false,
  });

  const consentMutation = useMutation<{ success: boolean; firstName: string }>({
    mutationFn: async () => {
      const res = await fetch(`/api/enquiries/consent/${token}`, { method: "POST" });
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
              <div className="flex justify-center">
                <Loader2 className="w-12 h-12 text-[#5a7d58] animate-spin" />
              </div>
              <div>
                <h1 className="font-heading text-xl text-stone-800 mb-2">Checking your consent link…</h1>
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
                <h2 className="text-[#333] text-lg font-semibold mb-4">Privacy Policy Consent</h2>
                <p className="text-[#555] text-sm leading-relaxed mb-4">Dear {firstName},</p>
                <p className="text-[#555] text-sm leading-relaxed mb-4">
                  We are writing to let you know that your details have been registered with Brighter Future Mediation. Before we can proceed with your enquiry, we require your consent to our privacy policy.
                </p>
                <p className="text-[#555] text-sm leading-relaxed mb-2">
                  Please read our privacy policy and click the button below to confirm your consent:
                </p>
                <p className="text-[#888] text-xs leading-relaxed mb-6">
                  By clicking "I give my consent" you agree to Brighter Future Mediation's privacy policy.
                </p>
                <div className="text-center mb-4">
                  <Button
                    onClick={() => consentMutation.mutate()}
                    disabled={consentMutation.isPending}
                    className="bg-[#5a7d58] hover:bg-[#4a6948] text-white px-10 py-6 text-[15px] font-bold"
                    data-testid="button-enquiry-consent-grant"
                  >
                    {consentMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    I give my consent
                  </Button>
                </div>
                <div className="text-center mb-6">
                  <a
                    href="https://www.brighterfuturemediation.co.uk/terms-of-use/"
                    className="inline-block bg-[#f3f4f6] text-[#555] no-underline px-7 py-2.5 rounded-md text-[13px] font-medium border border-[#e5e7eb] hover:bg-[#eceef1]"
                    target="_blank"
                    rel="noreferrer"
                    data-testid="link-view-privacy-policy"
                  >
                    View Privacy Policy
                  </a>
                </div>
                <p className="text-[#888] text-xs leading-relaxed mb-0">
                  This consent link will expire in 30 days. If you have any questions, please contact us at{" "}
                  <a href="mailto:info@brighterfuturemediation.co.uk" className="text-[#5a7d58] hover:underline">
                    info@brighterfuturemediation.co.uk
                  </a>.
                </p>
              </div>
            </div>
          )}

          {!isLoading && accepted && (
            <div className="p-8 space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-[#5a7d58]/10 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-[#5a7d58]" />
                </div>
              </div>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-3">
                  Thank you{firstName ? `, ${firstName}` : ""}
                </h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Your consent to the Brighter Future Mediation privacy policy has been recorded. A member of our team will be in touch with you shortly.
                </p>
              </div>
              <div className="pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-400">
                  If you have any questions, please contact us at{" "}
                  <a
                    href="mailto:info@brighterfuturemediation.co.uk"
                    className="text-[#5a7d58] hover:underline"
                  >
                    info@brighterfuturemediation.co.uk
                  </a>
                </p>
              </div>
            </div>
          )}

          {!isLoading && (pageError || (!data?.success && data !== undefined)) && !accepted && (
            <div className="p-8 space-y-6">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="w-9 h-9 text-destructive" />
                </div>
              </div>
              <div>
                <h1 className="font-heading text-2xl text-stone-800 mb-3">
                  This link has expired
                </h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                  {pageError instanceof Error
                    ? pageError.message
                    : "This consent link is no longer valid. It may have already been used or has expired."}
                </p>
              </div>
              <div className="pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-400">
                  Please contact us at{" "}
                  <a
                    href="mailto:info@brighterfuturemediation.co.uk"
                    className="text-[#5a7d58] hover:underline"
                  >
                    info@brighterfuturemediation.co.uk
                  </a>{" "}
                  to request a new consent link.
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">
          Brighter Future Mediation Ltd &middot; FMC Accredited &middot; Supporting you from conflict to resolution
        </p>
      </div>
    </div>
  );
}
