import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, ENQUIRY_STATUS_STYLES, getStatusStyle } from "@/components/shared/status-badge";
import { ActivityTimeline } from "@/components/case-activity-timeline";
import { IntakeWorkflowCard, type IntakeCaseDetail } from "@/components/enquiry-intake-workflow-card";
import { ConfidentialBadge } from "@/components/shared/confidential-badge";
import { CaseEmailComposer } from "@/components/cases/case-email-composer";
import type { Case, Enquiry } from "@shared/schema";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ExternalLink, Info, Mail, RefreshCw, ShieldCheck, Shuffle, XCircle } from "lucide-react";

type EnquiryDetail = Enquiry & {
  convertedCaseRef?: string | null;
  caseConfidential?: boolean;
  claimedByName?: string | null;
  pendingDuplicateCount?: number;
};

type DuplicateReview = {
  id: string;
  sourceEnquiryId: string;
  matchedEnquiryId: string;
  primaryEnquiryId: string | null;
  matchReasons: string;
  status: "pending" | "linked" | "dismissed";
  reviewNote: string | null;
  reviewedAt: string | null;
  sourceEnquiry: Enquiry | null;
  matchedEnquiry: Enquiry | null;
  primaryEnquiry: Enquiry | null;
};

type EnquiryPrivacyConsentStatus = "pending" | "granted" | "refused";
type EnquiryAcknowledgementStatus = "not_attempted" | "sent" | "failed" | "skipped";

type CaseDetail = IntakeCaseDetail & Case & {
  mediatorName?: string | null;
};

type CalendlyMetadata = {
  eventUri?: string | null;
  inviteeUri?: string | null;
  eventTypeName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  status?: string | null;
  rescheduled?: boolean;
  questionsAndAnswers?: { question: string; answer: string }[];
};

type SendConsentResponse = {
  success: boolean;
  emailSent: boolean;
  consentUrl?: string;
};

function displayName(enquiry: Enquiry): string {
  const parts = [enquiry.firstName, enquiry.middleName, enquiry.lastName].filter(Boolean);
  return parts.join(" ") || "Unknown";
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getPrivacyConsentStatus(enquiry: Pick<Enquiry, "privacyConsent"> & { privacyConsentStatus?: string | null }): EnquiryPrivacyConsentStatus {
  if (enquiry.privacyConsentStatus === "granted" || enquiry.privacyConsentStatus === "refused" || enquiry.privacyConsentStatus === "pending") {
    return enquiry.privacyConsentStatus;
  }
  return enquiry.privacyConsent ? "granted" : "pending";
}

function formatConsentStatus(status: EnquiryPrivacyConsentStatus) {
  if (status === "granted") return "Granted";
  if (status === "refused") return "Refused";
  return "Pending";
}

function formatConsentDecisionSource(source: string | null | undefined) {
  if (source === "public_link") return "Public consent link";
  if (source === "manual_admin") return "Manual superadmin decision";
  return null;
}

function getAcknowledgementStatus(enquiry: { acknowledgementStatus?: string | null }): EnquiryAcknowledgementStatus {
  if (enquiry.acknowledgementStatus === "sent" || enquiry.acknowledgementStatus === "failed" || enquiry.acknowledgementStatus === "skipped") {
    return enquiry.acknowledgementStatus;
  }
  return "not_attempted";
}

function formatAcknowledgementStatus(status: EnquiryAcknowledgementStatus) {
  if (status === "sent") return "Sent";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Not attempted";
}

function formatDuplicateReasons(value: string | null | undefined) {
  if (!value) return "Matched details";
  return value.split(",").map((reason) => reason.trim()).filter(Boolean).join(" + ");
}

function parseCalendlyMetadata(metadata: string | null | undefined): CalendlyMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed?.source === "Calendly" && parsed.calendly ? parsed.calendly as CalendlyMetadata : null;
  } catch {
    return null;
  }
}

function formatCalendlyDateTime(value: string | null | undefined, timezone?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  try {
    return date.toLocaleString("en-GB", timezone ? { ...options, timeZone: timezone } : options);
  } catch {
    return date.toLocaleString("en-GB", options);
  }
}

function DetailItem({ label, value, testId }: { label: string; value?: string | null; testId?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm mt-0.5 break-words" data-testid={testId}>{value || "-"}</p>
    </div>
  );
}

export default function EnquiryDetailPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/enquiries/:id");
  const enquiryId = params?.id;
  const { toast } = useToast();
  const { user } = useAuth();
  const { canEdit } = usePermissions();
  const isStaff = user?.role === "superadmin" || user?.role === "subadmin" || user?.role === "staff" || user?.role === "mediator";
  const isAdminRole = user?.role === "superadmin" || user?.role === "subadmin";
  const isSuperadmin = user?.role === "superadmin";
  const [sendingConsentId, setSendingConsentId] = useState<string | null>(null);
  const [manualConsentLink, setManualConsentLink] = useState<{ enquiryId: string; url: string } | null>(null);
  const [consentDecisionOpen, setConsentDecisionOpen] = useState(false);
  const [consentDecisionStatus, setConsentDecisionStatus] = useState<"granted" | "refused">("granted");
  const [consentDecisionNote, setConsentDecisionNote] = useState("");
  const [duplicateReviewTarget, setDuplicateReviewTarget] = useState<DuplicateReview | null>(null);
  const [duplicateReviewStatus, setDuplicateReviewStatus] = useState<"linked" | "dismissed">("linked");
  const [duplicateReviewNote, setDuplicateReviewNote] = useState("");

  const enquiryQuery = useQuery<EnquiryDetail>({
    queryKey: ["/api/enquiries", enquiryId],
    queryFn: async () => {
      const res = await fetch(`/api/enquiries/${enquiryId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch enquiry");
      return res.json();
    },
    enabled: !!enquiryId,
  });

  const enquiry = enquiryQuery.data;
  const linkedCaseId = enquiry?.convertedCaseId || null;

  const caseQuery = useQuery<CaseDetail>({
    queryKey: ["/api/cases", linkedCaseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${linkedCaseId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch linked case");
      return res.json();
    },
    enabled: !!linkedCaseId,
    retry: false,
  });
  const linkedCaseHasSafeguardingConcern = caseQuery.data?.safeguardingStatus === "concern" || caseQuery.data?.intakeStatus === "Safeguarding";
  const linkedCaseConfidential = caseQuery.data?.confidential ?? enquiry?.caseConfidential ?? false;

  const duplicateQuery = useQuery<{ reviews: DuplicateReview[] }>({
    queryKey: ["/api/enquiries", enquiryId, "duplicates"],
    queryFn: async () => {
      const res = await fetch(`/api/enquiries/${enquiryId}/duplicates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch duplicate reviews");
      return res.json();
    },
    enabled: !!enquiryId,
  });

  const refreshEnquiry = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/enquiries", enquiryId] });
    queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
    if (linkedCaseId) queryClient.invalidateQueries({ queryKey: ["/api/cases", linkedCaseId] });
    queryClient.invalidateQueries({ queryKey: ["/api/enquiries", enquiryId, "duplicates"] });
  };

  const caseConfidentialMutation = useMutation({
    mutationFn: async (confidential: boolean) => {
      if (!linkedCaseId) throw new Error("No linked case");
      const res = await apiRequest("PATCH", `/api/cases/${linkedCaseId}/confidential`, { confidential });
      return res.json() as Promise<CaseDetail>;
    },
    onSuccess: () => {
      refreshEnquiry();
      if (linkedCaseId) {
        queryClient.invalidateQueries({ queryKey: ["/api/cases", linkedCaseId, "activities"] });
      }
      toast({ title: linkedCaseConfidential ? "Confidential marker removed" : "Case marked confidential" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update confidentiality", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const sendConsentMutation = useMutation({
    mutationFn: async (targetEnquiryId: string) => {
      setSendingConsentId(targetEnquiryId);
      const res = await apiRequest("POST", `/api/enquiries/${targetEnquiryId}/send-consent`, {});
      return res.json() as Promise<SendConsentResponse>;
    },
    onSuccess: (data, targetEnquiryId) => {
      refreshEnquiry();
      if (data.emailSent === false && data.consentUrl) {
        setManualConsentLink({ enquiryId: targetEnquiryId, url: data.consentUrl });
        toast({ title: "Manual consent link created", description: "Email delivery failed. Copy the fallback link below." });
      } else {
        setManualConsentLink(null);
        toast({ title: "Consent request sent" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message || "Could not send the consent request.", variant: "destructive" });
    },
    onSettled: () => setSendingConsentId(null),
  });

  const manualConsentDecisionMutation = useMutation({
    mutationFn: async ({ status, note }: { status: "granted" | "refused"; note: string }) => {
      const res = await apiRequest("PATCH", `/api/enquiries/${enquiryId}/privacy-consent`, { status, note });
      return res.json() as Promise<Enquiry>;
    },
    onSuccess: (updated) => {
      refreshEnquiry();
      setConsentDecisionOpen(false);
      setConsentDecisionNote("");
      toast({ title: "Privacy consent updated", description: `Consent marked ${formatConsentStatus(getPrivacyConsentStatus(updated)).toLowerCase()}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update consent", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const duplicateReviewMutation = useMutation({
    mutationFn: async ({ reviewId, status, note, primaryEnquiryId }: { reviewId: string; status: "linked" | "dismissed"; note: string; primaryEnquiryId?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/enquiries/duplicates/${reviewId}`, { status, note, primaryEnquiryId });
      return res.json();
    },
    onSuccess: () => {
      refreshEnquiry();
      setDuplicateReviewTarget(null);
      setDuplicateReviewNote("");
      toast({ title: "Duplicate review saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save duplicate review", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const resendAcknowledgementMutation = useMutation({
    mutationFn: async (targetEnquiryId: string) => {
      const res = await apiRequest("POST", `/api/enquiries/${targetEnquiryId}/send-acknowledgement`, {});
      return res.json();
    },
    onSuccess: (data) => {
      refreshEnquiry();
      toast({
        title: "Acknowledgement attempt recorded",
        description: data.emailSent ? "The enquiry acknowledgement email was sent." : "Check the status details below.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not send acknowledgement", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const shuttleMutation = useMutation({
    mutationFn: async (shuttleMediation: boolean) => {
      const res = await apiRequest("PATCH", `/api/enquiries/${enquiryId}/shuttle`, { shuttleMediation });
      return res.json() as Promise<EnquiryDetail>;
    },
    onSuccess: (updated) => {
      refreshEnquiry();
      toast({
        title: "Shuttle mediation updated",
        description: updated.shuttleMediation ? "This enquiry and linked case are marked SHUTTLE." : "SHUTTLE has been removed from this enquiry and linked case.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update shuttle mediation", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const openConsentDecision = (status: "granted" | "refused") => {
    setConsentDecisionStatus(status);
    setConsentDecisionNote("");
    setConsentDecisionOpen(true);
  };

  const submitConsentDecision = () => {
    if (!consentDecisionNote.trim()) return;
    manualConsentDecisionMutation.mutate({ status: consentDecisionStatus, note: consentDecisionNote.trim() });
  };

  const openDuplicateReview = (review: DuplicateReview, status: "linked" | "dismissed") => {
    setDuplicateReviewTarget(review);
    setDuplicateReviewStatus(status);
    setDuplicateReviewNote("");
  };

  const submitDuplicateReview = () => {
    if (!duplicateReviewTarget || !enquiry || !duplicateReviewNote.trim()) return;
    duplicateReviewMutation.mutate({
      reviewId: duplicateReviewTarget.id,
      status: duplicateReviewStatus,
      note: duplicateReviewNote.trim(),
      primaryEnquiryId: duplicateReviewStatus === "linked" ? enquiry.id : null,
    });
  };

  const copyManualConsentLink = async () => {
    if (!manualConsentLink) return;
    await navigator.clipboard.writeText(manualConsentLink.url);
    toast({ title: "Consent link copied" });
    setManualConsentLink(null);
  };

  if (!enquiryId) return null;

  if (enquiryQuery.isLoading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!enquiry) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Enquiry not found.</CardContent>
        </Card>
      </div>
    );
  }

  const statusStyle = getStatusStyle(enquiry.status, ENQUIRY_STATUS_STYLES);
  const duplicateReviews = duplicateQuery.data?.reviews ?? [];
  const calendlyMetadata = parseCalendlyMetadata(enquiry.metadata);
  const consentStatus = getPrivacyConsentStatus(enquiry);
  const consentDecisionSource = formatConsentDecisionSource(enquiry.privacyConsentDecisionSource);
  const acknowledgementStatus = getAcknowledgementStatus(enquiry);
  const linkedCaseMissing = !!linkedCaseId && caseQuery.isError;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="enquiry-detail-page">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/enquiries")} data-testid="button-back-enquiries">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-heading font-semibold text-foreground" data-testid="text-enquiry-detail-ref">{enquiry.enquiryRef}</h1>
            <StatusBadge label={enquiry.status} dotColor={statusStyle.dot} badgeClass={statusStyle.badge} testId="badge-enquiry-detail-status" />
            {enquiry.shuttleMediation && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700" data-testid="badge-enquiry-detail-shuttle">
                <Shuffle className="w-3 h-3 mr-1" />
                SHUTTLE
              </Badge>
            )}
            {linkedCaseConfidential && (
              <span data-testid="badge-enquiry-case-confidential">
                <ConfidentialBadge />
              </span>
            )}
            {(enquiry.pendingDuplicateCount || duplicateReviews.some(review => review.status === "pending")) && (
              <Badge variant="outline" className="border-[#b8825a]/30 bg-[#dcae96]/15 text-[#8a5d37]">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Possible duplicate
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {displayName(enquiry)} &middot; Received {formatDate(enquiry.dateReceived)} &middot; {enquiry.contactMethod || "Channel not recorded"}
          </p>
        </div>
        {isAdminRole && linkedCaseId && <CaseEmailComposer caseId={linkedCaseId} initialEmail={enquiry.email} label="Email enquirer" />}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="space-y-6 min-w-0">
          {linkedCaseMissing && (
            <Card className="border-destructive/30 bg-destructive/5" data-testid="missing-linked-case-warning">
              <CardContent className="py-4">
                <p className="text-sm font-medium text-destructive">Missing linked case</p>
                <p className="text-xs text-muted-foreground mt-1">This enquiry is still visible, but intake actions are disabled because the linked case shell could not be loaded.</p>
              </CardContent>
            </Card>
          )}

          {caseQuery.data ? (
            <IntakeWorkflowCard caseData={caseQuery.data} caseId={linkedCaseId!} onWorkflowUpdated={refreshEnquiry} />
          ) : linkedCaseId && caseQuery.isLoading ? (
            <Card><CardContent className="py-8"><Skeleton className="h-32 w-full" /></CardContent></Card>
          ) : (
            <Card data-testid="card-intake-workflow-disabled">
              <CardHeader><CardTitle className="text-base font-heading">Intake workflow</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Missing linked case. Intake actions are disabled until a case shell is available.</p>
              </CardContent>
            </Card>
          )}

          <Card data-testid="card-enquiry-contact-details">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading">Contact Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <DetailItem label="Name" value={displayName(enquiry)} />
              <DetailItem label="Email" value={enquiry.email} />
              <DetailItem label="Telephone" value={enquiry.mobileTelephone} />
              <DetailItem label="Address" value={[enquiry.addressLine1, enquiry.postcode].filter(Boolean).join(", ")} />
            </CardContent>
          </Card>

          <Card data-testid="card-enquiry-metadata">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading">Enquiry Metadata</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <DetailItem label="Mediation type" value={`${enquiry.issueType}${enquiry.issueTypeOther ? ` - ${enquiry.issueTypeOther}` : ""}`} />
              <DetailItem label="Contact method" value={enquiry.contactMethod || "Channel not recorded"} />
              <DetailItem label="Lead source" value={`${enquiry.leadSource || ""}${enquiry.leadSourceOther ? ` - ${enquiry.leadSourceOther}` : ""}`} />
              <DetailItem label="Referral type" value={enquiry.referralType} />
              <DetailItem label="Linked case" value={caseQuery.data?.caseRef || enquiry.convertedCaseRef || (linkedCaseId ? "Linked case" : "Not linked")} testId="text-enquiry-linked-case" />
              {enquiry.notes && (
                <div className="md:col-span-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Notes</p>
                  <p className="text-sm leading-relaxed mt-0.5 whitespace-pre-wrap">{enquiry.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {calendlyMetadata && (
            <Card data-testid="card-calendly-metadata">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-heading flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-[#5a7d58]" />
                  Calendly consultation
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <DetailItem label="Event type" value={calendlyMetadata.eventTypeName} />
                <DetailItem label="Status" value={calendlyMetadata.status || "Scheduled"} />
                <DetailItem label="Selected start" value={formatCalendlyDateTime(calendlyMetadata.startTime, calendlyMetadata.timezone)} />
                <DetailItem label="Selected end" value={formatCalendlyDateTime(calendlyMetadata.endTime, calendlyMetadata.timezone)} />
                <DetailItem label="Timezone" value={calendlyMetadata.timezone} />
              </CardContent>
            </Card>
          )}

        </div>

        <div className="space-y-6" data-testid="enquiry-detail-right-rail">
          <Card data-testid="card-linked-case-summary">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading">Linked case</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailItem label="Case reference" value={caseQuery.data?.caseRef || enquiry.convertedCaseRef || (linkedCaseId ? "Linked case" : "Not linked")} />
              <DetailItem label="Intake status" value={caseQuery.data?.intakeStatus || enquiry.status} />
              <DetailItem label="Claimed by" value={caseQuery.data?.claimedByName || enquiry.claimedByName || "Not claimed"} />
              {linkedCaseHasSafeguardingConcern && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700" data-testid="badge-linked-case-safeguarding-concern">
                  <AlertTriangle className="w-3 h-3 mr-1 inline" />
                  Safeguarding concern raised
                </div>
              )}
              {(caseQuery.data?.shuttleMediation || enquiry.shuttleMediation) && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  <Shuffle className="w-3 h-3 mr-1 inline" />
                  SHUTTLE enabled
                </div>
              )}
              {linkedCaseConfidential && (
                <div data-testid="badge-enquiry-linked-case-confidential">
                  <ConfidentialBadge />
                </div>
              )}
              {isAdminRole && linkedCaseId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => caseConfidentialMutation.mutate(!linkedCaseConfidential)}
                  disabled={caseConfidentialMutation.isPending}
                  data-testid="button-toggle-enquiry-case-confidential"
                >
                  {caseConfidentialMutation.isPending ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  {linkedCaseConfidential ? "Remove confidential marker" : "Mark case confidential"}
                </Button>
              )}
              {linkedCaseId && (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={`/cases/${linkedCaseId}`} data-testid="link-enquiry-detail-case">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View case
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-enquiry-shuttle">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <Shuffle className="w-4 h-4 text-amber-600" />
                Shuttle mediation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="enquiry-shuttle" className="text-sm cursor-pointer">
                  {enquiry.shuttleMediation ? "SHUTTLE is enabled" : "Mark enquiry as SHUTTLE"}
                </Label>
                <Switch
                  id="enquiry-shuttle"
                  checked={!!enquiry.shuttleMediation}
                  onCheckedChange={(checked) => shuttleMutation.mutate(checked)}
                  disabled={!canEdit("enquiries") || shuttleMutation.isPending}
                  data-testid="switch-enquiry-shuttle"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This syncs with the linked case so references and separated-process handling stay aligned.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-linked-case-activity">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-heading">Linked-case activity preview</CardTitle>
                {linkedCaseId && <Link href={`/cases/${linkedCaseId}?tab=communications`} className="text-xs text-primary hover:underline">View all activity</Link>}
              </div>
            </CardHeader>
            <CardContent>
              {linkedCaseId && isStaff ? (
                <ActivityTimeline caseId={linkedCaseId} isStaff={isStaff} compact maxItems={5} />
              ) : (
                <p className="text-sm text-muted-foreground">No linked case activity available.</p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="duplicate-review-panel">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#b8825a]" />
                Duplicate review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {duplicateReviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No possible duplicate enquiries found.</p>
              ) : duplicateReviews.map((review) => {
                const related = review.sourceEnquiryId === enquiry.id ? review.matchedEnquiry : review.sourceEnquiry;
                const isPending = review.status === "pending";
                return (
                  <div key={review.id} className="rounded-md border bg-background p-3 space-y-3" data-testid={`duplicate-review-${review.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{related?.enquiryRef || "Matched enquiry"}</p>
                        <p className="text-xs text-muted-foreground">{formatDuplicateReasons(review.matchReasons)} match across channels</p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground capitalize">{review.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <DetailItem label="Name" value={related ? displayName(related) : "-"} />
                      <DetailItem label="Received" value={formatDate(related?.dateReceived)} />
                      <DetailItem label="Email" value={related?.email} />
                      <DetailItem label="Telephone" value={related?.mobileTelephone} />
                    </div>
                    {review.reviewNote && <p className="text-xs text-muted-foreground">Review note: {review.reviewNote}</p>}
                    {isAdminRole && isPending && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openDuplicateReview(review, "linked")} data-testid={`button-link-duplicate-${review.id}`}>Link as duplicate</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => openDuplicateReview(review, "dismissed")} data-testid={`button-dismiss-duplicate-${review.id}`}>Dismiss</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card data-testid="acknowledgement-email-panel">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center justify-between">
                <span>Acknowledgement email</span>
                <Badge variant="outline">{formatAcknowledgementStatus(acknowledgementStatus)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label="Last attempted" value={formatDate(enquiry.acknowledgementLastAttemptedAt)} />
                <DetailItem label="Sent" value={formatDate(enquiry.acknowledgementSentAt)} />
              </div>
              {enquiry.acknowledgementLastError && <p className="text-xs text-destructive" data-testid="text-acknowledgement-error">{enquiry.acknowledgementLastError}</p>}
              {isAdminRole && (
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => resendAcknowledgementMutation.mutate(enquiry.id)} disabled={resendAcknowledgementMutation.isPending} data-testid="button-resend-acknowledgement">
                  <Mail className="w-4 h-4 mr-2" />
                  {resendAcknowledgementMutation.isPending ? "Sending..." : "Resend acknowledgement"}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card data-testid="privacy-consent-panel">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-heading flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#5a7d58]" />
                Privacy consent
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                {consentStatus === "granted" ? <CheckCircle2 className="w-4 h-4 text-[#5a7d58]" /> : consentStatus === "refused" ? <XCircle className="w-4 h-4 text-destructive" /> : <Info className="w-4 h-4 text-[#b8825a]" />}
                <span className="text-sm">Privacy policy: {formatConsentStatus(consentStatus)}</span>
              </div>
              {(enquiry.privacyConsentDecidedAt || consentDecisionSource || enquiry.privacyConsentDecisionNote) && (
                <div className="rounded-md border bg-background p-3 space-y-1" data-testid="privacy-consent-decision-details">
                  <DetailItem label="Decided" value={formatDate(enquiry.privacyConsentDecidedAt)} />
                  <DetailItem label="Source" value={consentDecisionSource} />
                  <DetailItem label="Note" value={enquiry.privacyConsentDecisionNote} />
                </div>
              )}
              {enquiry.consentRequestSentAt && <p className="text-xs text-muted-foreground" data-testid="text-consent-last-sent">Consent request last sent: {formatDate(enquiry.consentRequestSentAt)}</p>}
              {isSuperadmin && (
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openConsentDecision("granted")} disabled={consentStatus === "granted"} data-testid="button-manual-consent-granted">Mark granted</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => openConsentDecision("refused")} disabled={consentStatus === "refused"} data-testid="button-manual-consent-refused">Mark refused</Button>
                </div>
              )}
              {isAdminRole && consentStatus === "pending" && (
                <div className="space-y-3">
                  <Button variant="outline" size="sm" className="w-full" onClick={() => sendConsentMutation.mutate(enquiry.id)} disabled={sendingConsentId === enquiry.id} data-testid="button-send-consent-request">
                    <Mail className="w-4 h-4 mr-2" />
                    {sendingConsentId === enquiry.id ? "Sending..." : enquiry.consentRequestSentAt ? "Resend consent request" : "Send consent request"}
                  </Button>
                  {manualConsentLink?.enquiryId === enquiry.id && (
                    <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 space-y-2" data-testid="manual-consent-link-section">
                      <p className="text-sm font-medium text-foreground">Copy consent link</p>
                      <Input value={manualConsentLink.url} readOnly className="text-xs" data-testid="input-manual-consent-link" />
                      <Button type="button" size="sm" className="w-full" onClick={copyManualConsentLink} data-testid="button-copy-consent-link">Copy consent link</Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={consentDecisionOpen} onOpenChange={setConsentDecisionOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-manual-consent-decision">
          <DialogHeader>
            <DialogTitle>Mark privacy consent {formatConsentStatus(consentDecisionStatus).toLowerCase()}</DialogTitle>
            <DialogDescription>Record who confirmed this decision and why it is being entered manually.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="manual-consent-note">Review note *</label>
            <Textarea id="manual-consent-note" rows={4} value={consentDecisionNote} onChange={(event) => setConsentDecisionNote(event.target.value)} placeholder="Record the reason and who confirmed the consent decision." data-testid="input-manual-consent-note" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConsentDecisionOpen(false)}>Cancel</Button>
            <Button type="button" onClick={submitConsentDecision} disabled={!consentDecisionNote.trim() || manualConsentDecisionMutation.isPending} data-testid="button-submit-manual-consent">
              {manualConsentDecisionMutation.isPending ? "Saving..." : `Mark ${formatConsentStatus(consentDecisionStatus).toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!duplicateReviewTarget} onOpenChange={(open) => { if (!open) setDuplicateReviewTarget(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-duplicate-review">
          <DialogHeader>
            <DialogTitle>{duplicateReviewStatus === "linked" ? "Link duplicate enquiry" : "Dismiss duplicate match"}</DialogTitle>
            <DialogDescription>Add a review note before saving this possible duplicate decision.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {duplicateReviewTarget && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                {(() => {
                  const related = enquiry?.id === duplicateReviewTarget.sourceEnquiryId ? duplicateReviewTarget.matchedEnquiry : duplicateReviewTarget.sourceEnquiry;
                  return (
                    <p>
                      {formatDuplicateReasons(duplicateReviewTarget.matchReasons)} match with {related?.enquiryRef || "matched enquiry"}.
                    </p>
                  );
                })()}
              </div>
            )}
            {duplicateReviewStatus === "linked" && (
              <p className="text-xs text-muted-foreground">The current enquiry will be recorded as the primary enquiry. Records are not merged.</p>
            )}
            <label className="text-sm font-medium" htmlFor="duplicate-review-note">Review note *</label>
            <Textarea id="duplicate-review-note" rows={4} value={duplicateReviewNote} onChange={(event) => setDuplicateReviewNote(event.target.value)} placeholder={duplicateReviewStatus === "linked" ? "Record why these enquiries are duplicates." : "Record why this match is not a duplicate."} data-testid="input-duplicate-review-note" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDuplicateReviewTarget(null)} disabled={duplicateReviewMutation.isPending}>Cancel</Button>
            <Button type="button" onClick={submitDuplicateReview} disabled={!duplicateReviewNote.trim() || duplicateReviewMutation.isPending} data-testid="button-submit-duplicate-review">
              {duplicateReviewMutation.isPending ? "Saving..." : duplicateReviewStatus === "linked" ? "Link duplicate" : "Dismiss match"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
