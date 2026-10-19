import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEnquirySchema, updateEnquirySchema, ENQUIRY_CONTACT_METHODS, ISSUE_TYPES, LEAD_SOURCES, REFERRAL_TYPES, type Enquiry, type InsertEnquiry, type UpdateEnquiry, type PaginatedResponse } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Info, CheckCircle2, XCircle, MessageSquare, Search, Inbox, Pencil, ExternalLink, Mail, MoreHorizontal, Archive, ArchiveRestore, Trash2, Copy, CalendarClock, AlertTriangle, Shuffle } from "lucide-react";
import { Link } from "wouter";
import { SortableTableHead, type SortDirection } from "@/components/shared/sortable-table-head";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { AvatarCell } from "@/components/shared/avatar-cell";
import { StatusBadge, ENQUIRY_STATUS_STYLES, getStatusStyle } from "@/components/shared/status-badge";
import { PipelinePills } from "@/components/shared/pipeline-pills";
import { TableSkeleton } from "@/components/shared/table-skeleton";
import { PaginationControls } from "@/components/shared/pagination";
import { ConfidentialBadge } from "@/components/shared/confidential-badge";
import { revealFirstInvalidFormField } from "@/lib/form-validation-navigation";

const MANUAL_ENQUIRY_FIELD_ORDER = [
  "firstName",
  "lastName",
  "email",
  "mobileTelephone",
  "addressLine1",
  "postcode",
  "contactMethod",
  "leadSource",
  "leadSourceOther",
  "referralType",
  "issueType",
  "issueTypeOther",
] as const;

function displayName(enquiry: Enquiry): string {
  const parts = [enquiry.firstName, enquiry.middleName, enquiry.lastName].filter(Boolean);
  return parts.join(" ") || "Unknown";
}

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

type SourceMetadata = {
  source?: string | null;
};

function parseSourceMetadata(metadata: string | null | undefined): SourceMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" ? parsed as SourceMetadata : null;
  } catch {
    return null;
  }
}

function isWhatsappOrigin(enquiry: Pick<Enquiry, "contactMethod" | "metadata">): boolean {
  const metadata = parseSourceMetadata(enquiry.metadata);
  return enquiry.contactMethod === "WhatsApp message" || metadata?.source === "whatsapp";
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
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
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

type SendConsentResponse = {
  success: boolean;
  emailSent: boolean;
  consentUrl?: string;
};

type EnquiryListItem = Enquiry & {
  convertedCaseRef?: string | null;
  caseConfidential?: boolean;
  claimedByName?: string | null;
  pendingDuplicateCount?: number;
  nextFollowUpLabel?: string | null;
  nextFollowUpDueAt?: string | Date | null;
  nextFollowUpState?: "upcoming" | "due_today" | "overdue" | "none";
  nextFollowUpTitle?: string | null;
};

type FollowUpFilter = "due_today" | "overdue" | "unclaimed" | "safeguarding";

const FOLLOW_UP_FILTERS: FollowUpFilter[] = ["due_today", "overdue", "unclaimed", "safeguarding"];

function getInitialFollowUpFilter(): FollowUpFilter | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("followUpFilter");
  return FOLLOW_UP_FILTERS.includes(value as FollowUpFilter) ? value as FollowUpFilter : null;
}

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

function formatFollowUpBadge(enquiry: EnquiryListItem) {
  if (!enquiry.nextFollowUpLabel || !enquiry.nextFollowUpState || enquiry.nextFollowUpState === "none") {
    return null;
  }
  const label = enquiry.nextFollowUpLabel === "Ongoing" ? "Ongoing" : enquiry.nextFollowUpLabel;
  const due = enquiry.nextFollowUpDueAt
    ? new Date(enquiry.nextFollowUpDueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  const stateText = enquiry.nextFollowUpState === "due_today" ? "due today" : enquiry.nextFollowUpState;
  const className = enquiry.nextFollowUpState === "overdue"
    ? "border-red-300 bg-red-50 text-red-700"
    : enquiry.nextFollowUpState === "due_today"
      ? "border-[#b8825a]/40 bg-[#dcae96]/20 text-[#8a5d37]"
      : "border-muted bg-muted/40 text-muted-foreground";
  return {
    label,
    title: `${label} ${stateText.replace("_", " ")}${due ? ` - due ${due}` : ""}${enquiry.nextFollowUpTitle ? ` - ${enquiry.nextFollowUpTitle}` : ""}`,
    state: enquiry.nextFollowUpState,
    className,
  };
}

function normaliseContactMethod(value: string | null | undefined): (typeof ENQUIRY_CONTACT_METHODS)[number] {
  return (ENQUIRY_CONTACT_METHODS as readonly string[]).includes(value || "")
    ? value as (typeof ENQUIRY_CONTACT_METHODS)[number]
    : "Phone call";
}

export default function EnquiriesPage() {
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const { user } = useAuth();
  const isAdminRole = user?.role === "superadmin" || user?.role === "subadmin";
  const [sendingConsentId, setSendingConsentId] = useState<string | null>(null);
  const [selectedEnquiry, setSelectedEnquiry] = useState<EnquiryListItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createValidationMessage, setCreateValidationMessage] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter | null>(() => getInitialFollowUpFilter());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortDirection>(null);
  const [archiveTarget, setArchiveTarget] = useState<Enquiry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Enquiry | null>(null);
  const [manualConsentLink, setManualConsentLink] = useState<{ enquiryId: string; url: string } | null>(null);
  const [consentDecisionOpen, setConsentDecisionOpen] = useState(false);
  const [consentDecisionStatus, setConsentDecisionStatus] = useState<"granted" | "refused">("granted");
  const [consentDecisionNote, setConsentDecisionNote] = useState("");
  const [duplicateReviewTarget, setDuplicateReviewTarget] = useState<DuplicateReview | null>(null);
  const [duplicateReviewStatus, setDuplicateReviewStatus] = useState<"linked" | "dismissed">("linked");
  const [duplicateReviewNote, setDuplicateReviewNote] = useState("");
  const isSuperadmin = user?.role === "superadmin";
  const addEnquiryDialogRef = useRef<HTMLDivElement>(null);

  const handleSort = useCallback((key: string) => {
    if (sortBy === key) {
      if (sortOrder === "desc") setSortOrder("asc");
      else if (sortOrder === "asc") { setSortBy(null); setSortOrder(null); }
      else setSortOrder("desc");
    } else {
      setSortBy(key);
      setSortOrder("desc");
    }
    setPage(1);
  }, [sortBy, sortOrder]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!sheetOpen) setManualConsentLink(null);
  }, [sheetOpen]);

  const handleStatusFilter = useCallback((status: string | null) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (statusFilter) queryParams.set("status", statusFilter);
  if (followUpFilter) queryParams.set("followUpFilter", followUpFilter);
  if (sortBy) queryParams.set("sortBy", sortBy);
  if (sortOrder) queryParams.set("sortOrder", sortOrder);

  const { data: paginatedData, isLoading } = useQuery<PaginatedResponse<EnquiryListItem>>({
    queryKey: ["/api/enquiries", { page, limit, search: debouncedSearch, status: statusFilter, followUpFilter, sortBy, sortOrder }],
    queryFn: async () => {
      const res = await fetch(`/api/enquiries?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch enquiries");
      return res.json();
    },
  });

  const enquiries = paginatedData?.data;
  const totalCount = paginatedData?.total ?? 0;
  const totalPages = paginatedData?.totalPages ?? 1;
  const counts = paginatedData?.counts ?? {};

  const { data: duplicateData } = useQuery<{ reviews: DuplicateReview[] }>({
    queryKey: ["/api/enquiries", selectedEnquiry?.id, "duplicates"],
    queryFn: async () => {
      if (!selectedEnquiry) return { reviews: [] };
      const res = await fetch(`/api/enquiries/${selectedEnquiry.id}/duplicates`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch duplicate reviews");
      return res.json();
    },
    enabled: Boolean(selectedEnquiry?.id && sheetOpen),
  });
  const duplicateReviews = duplicateData?.reviews ?? [];

  const form = useForm<InsertEnquiry>({
    resolver: zodResolver(insertEnquirySchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      mobileTelephone: "",
      contactMethod: "Phone call",
      addressLine1: "",
      postcode: "",
      leadSource: "",
      leadSourceOther: "",
      referralType: "",
      issueType: "",
      issueTypeOther: "",
      notes: "",
      privacyConsent: false,
      consentFollowUp: false,
      consentAnonymisedData: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertEnquiry) => {
      const res = await apiRequest("POST", "/api/enquiries", data);
      return res.json();
    },
    onSuccess: (result: { enquiry: Enquiry; newCase: { caseRef: string } | null }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      const caseRef = result.newCase?.caseRef;
      toast({
        title: "Enquiry created & case opened",
        description: caseRef ? `Case ${caseRef} has been created automatically.` : "New enquiry has been created.",
      });
      setDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create enquiry.", variant: "destructive" });
    },
  });

  const submitNewEnquiry = (data: InsertEnquiry) => {
    setCreateValidationMessage(null);
    createMutation.mutate(data);
  };

  const revealNewEnquiryValidationError = (errors: object) => {
    setCreateValidationMessage("Please review the highlighted fields.");
    requestAnimationFrame(() => {
      revealFirstInvalidFormField({
        errors,
        fieldOrder: MANUAL_ENQUIRY_FIELD_ORDER,
        container: addEnquiryDialogRef.current,
      });
    });
  };

  const editForm = useForm<UpdateEnquiry>({
    resolver: zodResolver(updateEnquirySchema),
    defaultValues: {},
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateEnquiry }) => {
      const res = await apiRequest("PATCH", `/api/enquiries/${id}`, data);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      toast({ title: "Enquiry updated", description: "Changes saved successfully." });
      setEditDialogOpen(false);
      setSelectedEnquiry(updated);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update enquiry.", variant: "destructive" });
    },
  });

  const archiveEnquiryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/enquiries/${id}/archive`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Enquiry archived", description: "The enquiry has been moved to Archived." });
      setArchiveTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not archive", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const restoreEnquiryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/enquiries/${id}/restore`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Enquiry restored", description: "The enquiry is now active." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not restore", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const hardDeleteEnquiryMutation = useMutation({
    mutationFn: async ({ id, confirm }: { id: string; confirm: string }) => {
      const res = await apiRequest("DELETE", `/api/enquiries/${id}`, { confirm });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Enquiry permanently deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const sendConsentMutation = useMutation({
    mutationFn: async (enquiryId: string) => {
      setSendingConsentId(enquiryId);
      setManualConsentLink(null);
      const res = await apiRequest("POST", `/api/enquiries/${enquiryId}/send-consent`, {});
      return res.json() as Promise<SendConsentResponse>;
    },
    onSuccess: (data, enquiryId) => {
      const target = enquiries?.find(e => e.id === enquiryId) ?? selectedEnquiry;
      const consentRequestSentAt = new Date();
      if (data.emailSent === false && data.consentUrl) {
        setManualConsentLink({ enquiryId, url: data.consentUrl });
        if (target) {
          setSelectedEnquiry({ ...target, consentRequestSentAt });
          setSheetOpen(true);
        }
        toast({
          title: "Email failed",
          description: "A consent link was created. Copy it below and send it manually.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Consent request sent", description: target?.email ? `Email sent to ${target.email}` : "Consent request email sent." });
      }
      setSendingConsentId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      if (selectedEnquiry?.id === enquiryId) {
        setSelectedEnquiry(prev => prev ? { ...prev, consentRequestSentAt } : null);
      }
    },
    onError: () => {
      toast({ title: "Failed to send", description: "Could not send the consent request. Please try again.", variant: "destructive" });
      setSendingConsentId(null);
    },
  });

  const manualConsentDecisionMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: "granted" | "refused"; note: string }) => {
      const res = await apiRequest("PATCH", `/api/enquiries/${id}/privacy-consent`, { status, note });
      return res.json() as Promise<Enquiry>;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      setSelectedEnquiry(updated);
      setManualConsentLink(null);
      setConsentDecisionOpen(false);
      setConsentDecisionNote("");
      toast({
        title: "Privacy consent updated",
        description: `Consent marked ${formatConsentStatus(getPrivacyConsentStatus(updated)).toLowerCase()}.`,
      });
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
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      if (selectedEnquiry) {
        queryClient.invalidateQueries({ queryKey: ["/api/enquiries", selectedEnquiry.id, "duplicates"] });
      }
      setDuplicateReviewTarget(null);
      setDuplicateReviewNote("");
      toast({ title: "Duplicate review saved", description: "The possible duplicate record has been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save review", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const resendAcknowledgementMutation = useMutation({
    mutationFn: async (enquiryId: string) => {
      const res = await apiRequest("POST", `/api/enquiries/${enquiryId}/send-acknowledgement`, {});
      return res.json() as Promise<{ success: boolean; emailSent: boolean; enquiry: Enquiry }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/enquiries"] });
      setSelectedEnquiry(data.enquiry);
      toast({
        title: data.emailSent ? "Acknowledgement sent" : "Acknowledgement not sent",
        description: data.emailSent ? "The enquiry acknowledgement email was sent." : "The attempt was recorded. Check the status details below.",
        variant: data.emailSent ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not send acknowledgement", description: err.message || "Please try again.", variant: "destructive" });
    },
  });


  const openConsentDecision = (status: "granted" | "refused") => {
    setConsentDecisionStatus(status);
    setConsentDecisionNote("");
    setConsentDecisionOpen(true);
  };

  const submitConsentDecision = () => {
    if (!selectedEnquiry || !consentDecisionNote.trim()) return;
    manualConsentDecisionMutation.mutate({
      id: selectedEnquiry.id,
      status: consentDecisionStatus,
      note: consentDecisionNote.trim(),
    });
  };

  const openDuplicateReview = (review: DuplicateReview, status: "linked" | "dismissed") => {
    setDuplicateReviewTarget(review);
    setDuplicateReviewStatus(status);
    setDuplicateReviewNote("");
  };

  const submitDuplicateReview = () => {
    if (!duplicateReviewTarget || !selectedEnquiry || !duplicateReviewNote.trim()) return;
    duplicateReviewMutation.mutate({
      reviewId: duplicateReviewTarget.id,
      status: duplicateReviewStatus,
      note: duplicateReviewNote.trim(),
      primaryEnquiryId: duplicateReviewStatus === "linked" ? selectedEnquiry.id : null,
    });
  };

  const copyManualConsentLink = async () => {
    if (!manualConsentLink) return;
    await navigator.clipboard.writeText(manualConsentLink.url);
    toast({ title: "Consent link copied", description: "The fallback link has been copied to your clipboard." });
    setManualConsentLink(null);
  };

  const fmtDate = (d: string | Date | null | undefined) => {
    if (!d) return null;
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  const openEdit = (enquiry: Enquiry) => {
    editForm.reset({
      firstName: enquiry.firstName,
      lastName: enquiry.lastName,
      email: enquiry.email || "",
      mobileTelephone: enquiry.mobileTelephone || "",
      contactMethod: normaliseContactMethod(enquiry.contactMethod),
      addressLine1: enquiry.addressLine1 || "",
      postcode: enquiry.postcode || "",
      leadSource: enquiry.leadSource || "",
      leadSourceOther: enquiry.leadSourceOther || "",
      referralType: enquiry.referralType || "",
      issueType: enquiry.issueType,
      issueTypeOther: enquiry.issueTypeOther || "",
      notes: enquiry.notes || "",
    });
    setEditDialogOpen(true);
  };

  const openDetail = (enquiry: Enquiry) => {
    setSelectedEnquiry(enquiry);
    setSheetOpen(true);
  };

  const calendlyMetadata = selectedEnquiry ? parseCalendlyMetadata(selectedEnquiry.metadata) : null;
  const selectedConsentStatus = selectedEnquiry ? getPrivacyConsentStatus(selectedEnquiry) : "pending";
  const selectedConsentDecisionSource = selectedEnquiry ? formatConsentDecisionSource(selectedEnquiry.privacyConsentDecisionSource) : null;
  const selectedAcknowledgementStatus = selectedEnquiry ? getAcknowledgementStatus(selectedEnquiry) : "not_attempted";

  const TABLE_COLS = 9;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto" data-testid="enquiries-page">
      <PageHeader
        title="Enquiries"
        subtitle="Manage incoming enquiries through the intake workflow"
        icon={MessageSquare}
        iconColor="text-[#5a7d58]"
        iconBg="bg-[#a7baa4]/15"
        titleTestId="text-enquiries-title"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setInfoOpen(true)}
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              aria-label="About Enquiries"
              data-testid="button-enquiry-info"
            >
              <Info className="w-4 h-4" />
            </Button>
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setCreateValidationMessage(null);
            }}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-enquiry">
                  <Plus className="w-4 h-4 mr-2" />
                  Add enquiry manually
                </Button>
              </DialogTrigger>
              <DialogContent ref={addEnquiryDialogRef} className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-heading">Add new enquiry</DialogTitle>
                  <DialogDescription>Fill in the details below to create a new enquiry record.</DialogDescription>
                  {createValidationMessage && (
                    <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-enquiry-validation-summary">
                      {createValidationMessage}
                    </p>
                  )}
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(submitNewEnquiry, revealNewEnquiryValidationError)} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="firstName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>First name *</FormLabel>
                          <FormControl><Input {...field} placeholder="First name" data-form-field="firstName" data-testid="input-enquiry-firstName" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="lastName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Last name *</FormLabel>
                          <FormControl><Input {...field} placeholder="Last name" data-form-field="lastName" data-testid="input-enquiry-lastName" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email address *</FormLabel>
                          <FormControl><Input type="email" {...field} placeholder="Email address" data-form-field="email" data-testid="input-enquiry-email" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="mobileTelephone" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telephone *</FormLabel>
                          <FormControl><Input {...field} placeholder="Telephone" data-form-field="mobileTelephone" data-testid="input-enquiry-telephone" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="addressLine1" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address line 1 *</FormLabel>
                          <FormControl><Input {...field} value={field.value ?? ""} placeholder="First line of address" data-form-field="addressLine1" data-testid="input-enquiry-addressLine1" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="postcode" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postcode *</FormLabel>
                          <FormControl><Input {...field} value={field.value ?? ""} placeholder="Postcode" data-form-field="postcode" data-testid="input-enquiry-postcode" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <FormField control={form.control} name="contactMethod" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact method *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <FormControl><SelectTrigger ref={field.ref} data-form-field="contactMethod" data-testid="select-contact-method"><SelectValue placeholder="Select contact method" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ENQUIRY_CONTACT_METHODS.map(method => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="leadSource" render={({ field }) => (
                      <FormItem>
                        <FormLabel>How did you hear about us? *</FormLabel>
                        <Select onValueChange={(val) => {
                          field.onChange(val);
                          if (val !== "Other (please specify)" && val !== "Word of mouth (please tell us who?)") {
                            form.setValue("leadSourceOther", "");
                          }
                        }} value={field.value ?? ""}>
                          <FormControl><SelectTrigger ref={field.ref} data-form-field="leadSource" data-testid="select-lead-source"><SelectValue placeholder="Select an option" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    {(form.watch("leadSource") === "Other (please specify)" || form.watch("leadSource") === "Word of mouth (please tell us who?)") && (
                      <FormField control={form.control} name="leadSourceOther" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Please specify</FormLabel>
                          <FormControl><Input {...field} value={field.value ?? ""} placeholder="Please specify" data-form-field="leadSourceOther" data-testid="input-enquiry-leadSourceOther" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}

                    <FormField control={form.control} name="referralType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Are you referring yourself or a client? *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <FormControl><SelectTrigger ref={field.ref} data-form-field="referralType" data-testid="select-referral-type"><SelectValue placeholder="Select an option" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {REFERRAL_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="issueType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>What kind of mediation would you like to discuss? *</FormLabel>
                        <Select onValueChange={(val) => {
                          field.onChange(val);
                          if (val !== "Other (please give details below)") {
                            form.setValue("issueTypeOther", "");
                          }
                        }} value={field.value}>
                          <FormControl><SelectTrigger ref={field.ref} data-form-field="issueType" data-testid="select-issue-type"><SelectValue placeholder="Select mediation type" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />

                    {form.watch("issueType") === "Other (please give details below)" && (
                      <FormField control={form.control} name="issueTypeOther" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Please give details</FormLabel>
                          <FormControl><Input {...field} value={field.value ?? ""} placeholder="Please give details" data-form-field="issueTypeOther" data-testid="input-enquiry-issueTypeOther" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}


                    <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-enquiry">
                      {createMutation.isPending ? "Adding..." : "Add enquiry"}
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {!isLoading && paginatedData && (() => {
        const visibleCounts = isAdminRole
          ? counts
          : Object.fromEntries(Object.entries(counts).filter(([k]) => k !== "Archived"));
        const visibleStatuses = Object.keys(ENQUIRY_STATUS_STYLES).filter(
          s => isAdminRole || s !== "Archived",
        );
        return (
          <PipelinePills
            counts={visibleCounts}
            total={Object.values(visibleCounts).reduce((a, b) => a + b, 0)}
            statusStyles={ENQUIRY_STATUS_STYLES}
            statuses={visibleStatuses}
            activeFilter={statusFilter}
            onFilter={handleStatusFilter}
            testIdPrefix="pill-enquiry"
          />
        );
      })()}

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by reference, name, email, issue type or status..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="pl-9"
            data-testid="input-search-enquiries"
          />
        </div>
        {(debouncedSearch || statusFilter || followUpFilter) && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="enquiry-follow-up-filters">
        {[
          ["due_today", "Due today"],
          ["overdue", "Overdue"],
          ["unclaimed", "Unclaimed"],
          ["safeguarding", "Safeguarding"],
        ].map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={followUpFilter === value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFollowUpFilter(followUpFilter === value ? null : value as FollowUpFilter);
              setPage(1);
            }}
            data-testid={`filter-enquiry-${value}`}
          >
            {label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton columns={TABLE_COLS} rows={5} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <SortableTableHead label="Ref" sortKey="enquiryRef" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-ref" />
                    <SortableTableHead label="Date" sortKey="dateReceived" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-date" />
                    <SortableTableHead label="Name" sortKey="firstName" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-name" />
                    <SortableTableHead label="Email" sortKey="email" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-email" />
                    <SortableTableHead label="Issue type" sortKey="issueType" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-issue" />
                    <SortableTableHead label="Lead source" sortKey="leadSource" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-lead" />
                    <SortableTableHead label="Status" sortKey="status" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} testId="sort-status" />
                    <TableHead className="w-[120px]">Follow-up</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enquiries && enquiries.length > 0 ? enquiries.map(enquiry => {
                    const style = getStatusStyle(enquiry.status, ENQUIRY_STATUS_STYLES);
                    const followUpBadge = formatFollowUpBadge(enquiry);
                    return (
                      <TableRow
                        key={enquiry.id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => openDetail(enquiry)}
                        data-testid={`row-enquiry-${enquiry.id}`}
                      >
                        <TableCell className="text-sm font-medium text-[#5a7d58] whitespace-nowrap" data-testid={`text-enquiry-ref-${enquiry.id}`}>
                          <div className="flex flex-col gap-1">
                            <span>{enquiry.enquiryRef}</span>
                            {(enquiry.pendingDuplicateCount || 0) > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[#b8825a]/30 bg-[#dcae96]/15 px-2 py-0.5 text-[10px] font-medium text-[#8a5d37]" data-testid={`badge-possible-duplicate-${enquiry.id}`}>
                                <AlertTriangle className="w-3 h-3" />
                                Possible duplicate
                              </span>
                            )}
                            {enquiry.shuttleMediation && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700" data-testid={`badge-enquiry-shuttle-${enquiry.id}`}>
                                <Shuffle className="w-3 h-3" />
                                SHUTTLE
                              </span>
                            )}
                            {isWhatsappOrigin(enquiry) && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700" data-testid={`badge-enquiry-whatsapp-${enquiry.id}`}>
                                <MessageSquare className="w-3 h-3" />
                                <span>WhatsApp</span>
                              </span>
                            )}
                            {enquiry.caseConfidential && (
                              <span data-testid={`badge-enquiry-confidential-${enquiry.id}`}>
                                <ConfidentialBadge />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(enquiry.dateReceived).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </TableCell>
                        <TableCell data-testid={`text-enquiry-name-${enquiry.id}`}>
                          <AvatarCell
                            name={displayName(enquiry)}
                            bgClass="bg-[#a7baa4]/15"
                            textClass="text-[#5a7d58]"
                          />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {enquiry.email || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{enquiry.issueType}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {enquiry.leadSource || "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={enquiry.status}
                            dotColor={style.dot}
                            badgeClass={style.badge}
                            testId={`badge-enquiry-status-${enquiry.id}`}
                          />
                        </TableCell>
                        <TableCell className="w-[120px] align-middle">
                          {followUpBadge ? (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${followUpBadge.className}`} data-testid={`badge-enquiry-follow-up-${enquiry.id}`} title={followUpBadge.title}>
                              {followUpBadge.state === "overdue" ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                              <span>{followUpBadge.label}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                            <Button asChild variant="outline" size="sm" data-testid={`link-work-enquiry-${enquiry.id}`}>
                              <Link href={`/enquiries/${enquiry.id}`}>
                                <ExternalLink className="w-3 h-3 mr-1" />
                                Work enquiry
                              </Link>
                            </Button>
                            {isAdminRole && getPrivacyConsentStatus(enquiry) === "pending" && (
                              <div className="flex flex-col items-end gap-0.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => sendConsentMutation.mutate(enquiry.id)}
                                  disabled={sendingConsentId === enquiry.id}
                                  data-testid={`button-send-consent-row-${enquiry.id}`}
                                >
                                  <Mail className="w-3 h-3 mr-1" />
                                  {sendingConsentId === enquiry.id ? "Sending..." : "Send consent request"}
                                </Button>
                                {enquiry.consentRequestSentAt && (
                                  <span className="text-[10px] text-muted-foreground" data-testid={`text-consent-sent-date-${enquiry.id}`}>
                                    Last sent: {fmtDate(enquiry.consentRequestSentAt)}
                                  </span>
                                )}
                              </div>
                            )}
                            {enquiry.convertedCaseId && (
                              <div className="flex flex-col items-end gap-0.5">
                                <Link
                                  href={`/cases/${enquiry.convertedCaseId}`}
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                                  data-testid={`link-enquiry-case-${enquiry.id}`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  {enquiry.convertedCaseRef || "View case"}
                                </Link>
                                {enquiry.claimedByName && (
                                  <span className="text-[10px] text-muted-foreground" data-testid={`text-enquiry-claimed-by-${enquiry.id}`}>
                                    Claimed by {enquiry.claimedByName}
                                  </span>
                                )}
                              </div>
                            )}
                            {isAdminRole && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    data-testid={`button-enquiry-actions-${enquiry.id}`}
                                    aria-label="Enquiry actions"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {enquiry.status === "Archived" ? (
                                    <DropdownMenuItem
                                      onClick={() => restoreEnquiryMutation.mutate(enquiry.id)}
                                      disabled={restoreEnquiryMutation.isPending}
                                      data-testid={`menu-restore-enquiry-${enquiry.id}`}
                                    >
                                      <ArchiveRestore className="w-4 h-4 mr-2" />
                                      Restore
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onClick={() => setArchiveTarget(enquiry)}
                                      data-testid={`menu-archive-enquiry-${enquiry.id}`}
                                    >
                                      <Archive className="w-4 h-4 mr-2" />
                                      Archive
                                    </DropdownMenuItem>
                                  )}
                                  {isSuperadmin && (
                                    <>
                                      <DropdownMenuSeparator />
                                      {enquiry.convertedCaseId ? (
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <div>
                                                <DropdownMenuItem
                                                  disabled
                                                  className="text-muted-foreground"
                                                  data-testid={`menu-delete-enquiry-${enquiry.id}`}
                                                >
                                                  <Trash2 className="w-4 h-4 mr-2" />
                                                  Delete permanently
                                                </DropdownMenuItem>
                                              </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="left">
                                              {enquiry.convertedCaseRef
                                                ? `Linked to case ${enquiry.convertedCaseRef} — archive instead`
                                                : "Linked to a case — archive instead"}
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      ) : (
                                        <DropdownMenuItem
                                          onClick={() => setDeleteTarget(enquiry)}
                                          className="text-destructive focus:text-destructive"
                                          data-testid={`menu-delete-enquiry-${enquiry.id}`}
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete permanently
                                        </DropdownMenuItem>
                                      )}
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={TABLE_COLS} className="text-center py-16">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                            <Inbox className="w-6 h-6 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {debouncedSearch || statusFilter || followUpFilter ? "No enquiries match your filters" : "No enquiries yet"}
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {debouncedSearch || statusFilter || followUpFilter
                                ? "Try adjusting your search or clearing the filter"
                                : "New enquiries will appear here as they come in"}
                            </p>
                          </div>
                          {!debouncedSearch && !statusFilter && !followUpFilter && (
                            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)} data-testid="button-empty-add-enquiry">
                              <Plus className="w-4 h-4 mr-1" />
                              Add enquiry manually
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {paginatedData && paginatedData.total > 0 && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              limit={limit}
              total={totalCount}
              onPageChange={setPage}
              onLimitChange={(newLimit) => { setLimit(newLimit); setPage(1); }}
              testIdPrefix="pagination-enquiries"
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="sheet-enquiry-detail">
          {selectedEnquiry && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between pr-8">
                  <div>
                    <SheetTitle className="font-heading" data-testid="text-sheet-enquiry-ref">{selectedEnquiry.enquiryRef}</SheetTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Enquiry details</p>
                  </div>
                  {canEdit("enquiries") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(selectedEnquiry)}
                      data-testid="button-sheet-edit"
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
                <SheetDescription>
                  Received {new Date(selectedEnquiry.dateReceived).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-1">
                <div className="flex items-center justify-between pb-4">
                  {(() => {
                    const style = getStatusStyle(selectedEnquiry.status, ENQUIRY_STATUS_STYLES);
                    return (
                      <StatusBadge
                        label={selectedEnquiry.status}
                        dotColor={style.dot}
                        badgeClass={style.badge + " text-sm px-3 py-1"}
                      />
                    );
                  })()}
                  {selectedEnquiry.caseConfidential && (
                    <span data-testid="sheet-badge-enquiry-confidential">
                      <ConfidentialBadge />
                    </span>
                  )}
                  {selectedEnquiry.convertedCaseId && (
                    <Link
                      href={`/cases/${selectedEnquiry.convertedCaseId}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                      data-testid="link-sheet-view-case"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View linked case
                    </Link>
                  )}
                </div>
                <Button asChild className="w-full mb-4" data-testid="link-sheet-open-enquiry">
                  <Link href={`/enquiries/${selectedEnquiry.id}`}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open enquiry
                  </Link>
                </Button>

                <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Contact Details</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">First name</p>
                      <p className="text-sm font-medium">{selectedEnquiry.firstName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last name</p>
                      <p className="text-sm font-medium">{selectedEnquiry.lastName}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm">{selectedEnquiry.email || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Telephone</p>
                      <p className="text-sm">{selectedEnquiry.mobileTelephone || "—"}</p>
                    </div>
                  </div>
                  {selectedEnquiry.postcode && (
                    <div>
                      <p className="text-xs text-muted-foreground">Postcode</p>
                      <p className="text-sm font-medium">{selectedEnquiry.postcode}</p>
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Enquiry Details</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Mediation type</p>
                      <p className="text-sm">{selectedEnquiry.issueType}{selectedEnquiry.issueTypeOther ? ` — ${selectedEnquiry.issueTypeOther}` : ""}</p>
                    </div>
                    {selectedEnquiry.contactMethod && (
                      <div>
                        <p className="text-xs text-muted-foreground">Contact method</p>
                        <p className="text-sm">{selectedEnquiry.contactMethod}</p>
                      </div>
                    )}
                    {selectedEnquiry.leadSource && (
                      <div>
                        <p className="text-xs text-muted-foreground">How did you hear about us?</p>
                        <p className="text-sm">{selectedEnquiry.leadSource}{selectedEnquiry.leadSourceOther ? ` — ${selectedEnquiry.leadSourceOther}` : ""}</p>
                      </div>
                    )}
                  </div>
                  {selectedEnquiry.referralType && (
                    <div>
                      <p className="text-xs text-muted-foreground">Referral type</p>
                      <p className="text-sm">{selectedEnquiry.referralType}</p>
                    </div>
                  )}
	                  {selectedEnquiry.notes && (
	                    <div>
	                      <p className="text-xs text-muted-foreground">Additional notes</p>
	                      <p className="text-sm leading-relaxed">{selectedEnquiry.notes}</p>
	                    </div>
	                  )}
	                </div>

	                {calendlyMetadata && (
	                  <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
	                    <div className="flex items-center gap-2">
	                      <CalendarClock className="w-4 h-4 text-[#5a7d58]" />
	                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Calendly consultation</p>
	                    </div>
	                    <div className="grid grid-cols-2 gap-4">
	                      <div>
	                        <p className="text-xs text-muted-foreground">Event type</p>
	                        <p className="text-sm">{calendlyMetadata.eventTypeName || "—"}</p>
	                      </div>
	                      <div>
	                        <p className="text-xs text-muted-foreground">Status</p>
	                        <p className="text-sm">{calendlyMetadata.status || "Scheduled"}</p>
	                      </div>
	                    </div>
	                    <div className="grid grid-cols-2 gap-4">
	                      <div>
	                        <p className="text-xs text-muted-foreground">Selected start</p>
	                        <p className="text-sm">{formatCalendlyDateTime(calendlyMetadata.startTime, calendlyMetadata.timezone)}</p>
	                      </div>
	                      <div>
	                        <p className="text-xs text-muted-foreground">Selected end</p>
	                        <p className="text-sm">{formatCalendlyDateTime(calendlyMetadata.endTime, calendlyMetadata.timezone)}</p>
	                      </div>
	                    </div>
	                    {calendlyMetadata.timezone && (
	                      <div>
	                        <p className="text-xs text-muted-foreground">Timezone</p>
	                        <p className="text-sm">{calendlyMetadata.timezone}</p>
	                      </div>
	                    )}
	                    <div className="space-y-2">
	                      {calendlyMetadata.eventUri && (
	                        <div>
	                          <p className="text-xs text-muted-foreground">Event URI</p>
	                          <p className="text-xs break-all">{calendlyMetadata.eventUri}</p>
	                        </div>
	                      )}
	                      {calendlyMetadata.inviteeUri && (
	                        <div>
	                          <p className="text-xs text-muted-foreground">Invitee URI</p>
	                          <p className="text-xs break-all">{calendlyMetadata.inviteeUri}</p>
	                        </div>
	                      )}
	                    </div>
	                    {calendlyMetadata.questionsAndAnswers && calendlyMetadata.questionsAndAnswers.length > 0 && (
	                      <div>
	                        <p className="text-xs text-muted-foreground mb-2">Calendly answers</p>
	                        <div className="space-y-2">
	                          {calendlyMetadata.questionsAndAnswers.map((answer) => (
	                            <div key={answer.question} className="text-xs">
	                              <span className="font-medium">{answer.question}: </span>
	                              <span>{answer.answer}</span>
	                            </div>
	                          ))}
	                        </div>
	                      </div>
	                    )}
	                  </div>
	                )}

	                {duplicateReviews.length > 0 && (
	                  <div className="rounded-lg bg-muted/30 border p-4 space-y-3" data-testid="duplicate-review-panel">
	                    <div className="flex items-center gap-2">
	                      <AlertTriangle className="w-4 h-4 text-[#b8825a]" />
	                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Possible duplicate enquiries</p>
	                    </div>
	                    <div className="space-y-3">
	                      {duplicateReviews.map((review) => {
	                        const related = review.sourceEnquiryId === selectedEnquiry.id ? review.matchedEnquiry : review.sourceEnquiry;
	                        const isPending = review.status === "pending";
	                        return (
	                          <div key={review.id} className="rounded-md border bg-background p-3 space-y-3" data-testid={`duplicate-review-${review.id}`}>
	                            <div className="flex items-start justify-between gap-3">
	                              <div className="space-y-1">
	                                <div className="flex items-center gap-2 flex-wrap">
	                                  <p className="text-sm font-medium">{related?.enquiryRef || "Matched enquiry"}</p>
	                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground capitalize">{review.status}</span>
	                                </div>
	                                <p className="text-xs text-muted-foreground">
	                                  {formatDuplicateReasons(review.matchReasons)} match across {selectedEnquiry.contactMethod || "current channel"} and {related?.contactMethod || "another channel"}
	                                </p>
	                              </div>
	                              {related?.convertedCaseId && (
	                                <Link href={`/cases/${related.convertedCaseId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
	                                  <ExternalLink className="w-3 h-3" />
	                                  Case
	                                </Link>
	                              )}
	                            </div>
	                            <div className="grid grid-cols-2 gap-3 text-xs">
	                              <div>
	                                <p className="text-muted-foreground">Name</p>
	                                <p className="font-medium">{related ? displayName(related) : "—"}</p>
	                              </div>
	                              <div>
	                                <p className="text-muted-foreground">Received</p>
	                                <p className="font-medium">{fmtDate(related?.dateReceived) || "—"}</p>
	                              </div>
	                              <div>
	                                <p className="text-muted-foreground">Email</p>
	                                <p className="break-all">{related?.email || "—"}</p>
	                              </div>
	                              <div>
	                                <p className="text-muted-foreground">Telephone</p>
	                                <p>{related?.mobileTelephone || "—"}</p>
	                              </div>
	                            </div>
	                            {review.reviewNote && (
	                              <p className="text-xs text-muted-foreground">Review note: {review.reviewNote}</p>
	                            )}
	                            {isAdminRole && isPending && (
	                              <div className="grid grid-cols-2 gap-2">
	                                <Button type="button" size="sm" variant="outline" onClick={() => openDuplicateReview(review, "linked")} data-testid={`button-link-duplicate-${review.id}`}>
	                                  Link as duplicate
	                                </Button>
	                                <Button type="button" size="sm" variant="outline" onClick={() => openDuplicateReview(review, "dismissed")} data-testid={`button-dismiss-duplicate-${review.id}`}>
	                                  Dismiss
	                                </Button>
	                              </div>
	                            )}
	                          </div>
	                        );
	                      })}
	                    </div>
	                  </div>
	                )}

	                <div className="rounded-lg bg-muted/30 border p-4 space-y-3" data-testid="acknowledgement-email-panel">
	                  <div className="flex items-center justify-between gap-3">
	                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Acknowledgement email</p>
	                    <span className="rounded-full bg-background border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
	                      {formatAcknowledgementStatus(selectedAcknowledgementStatus)}
	                    </span>
	                  </div>
	                  <div className="grid grid-cols-2 gap-4 text-sm">
	                    <div>
	                      <p className="text-xs text-muted-foreground">Last attempted</p>
	                      <p>{fmtDate(selectedEnquiry.acknowledgementLastAttemptedAt) || "—"}</p>
	                    </div>
	                    <div>
	                      <p className="text-xs text-muted-foreground">Sent</p>
	                      <p>{fmtDate(selectedEnquiry.acknowledgementSentAt) || "—"}</p>
	                    </div>
	                  </div>
	                  {selectedEnquiry.acknowledgementLastError && (
	                    <p className="text-xs text-destructive" data-testid="text-acknowledgement-error">
	                      {selectedEnquiry.acknowledgementLastError}
	                    </p>
	                  )}
	                  {isAdminRole && (
	                    <Button
	                      type="button"
	                      variant="outline"
	                      size="sm"
	                      className="w-full"
	                      onClick={() => resendAcknowledgementMutation.mutate(selectedEnquiry.id)}
	                      disabled={resendAcknowledgementMutation.isPending}
	                      data-testid="button-resend-acknowledgement"
	                    >
	                      <Mail className="w-4 h-4 mr-2" />
	                      {resendAcknowledgementMutation.isPending ? "Sending..." : "Resend acknowledgement"}
	                    </Button>
	                  )}
	                </div>

	                <div className="rounded-lg bg-muted/30 border p-4 space-y-3">
	                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Consent</p>
                  <div className="flex items-center gap-2">
                    {selectedConsentStatus === "granted" ? (
                      <CheckCircle2 className="w-4 h-4 text-[#5a7d58] flex-shrink-0" />
                    ) : selectedConsentStatus === "refused" ? (
                      <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                    ) : (
                      <Info className="w-4 h-4 text-[#b8825a] flex-shrink-0" />
                    )}
                    <span className="text-sm">Privacy policy: {formatConsentStatus(selectedConsentStatus)}</span>
                  </div>
                  {(selectedEnquiry.privacyConsentDecidedAt || selectedConsentDecisionSource || selectedEnquiry.privacyConsentDecisionNote) && (
                    <div className="rounded-md border bg-background p-3 space-y-1" data-testid="privacy-consent-decision-details">
                      {selectedEnquiry.privacyConsentDecidedAt && (
                        <p className="text-xs text-muted-foreground">
                          Decided: {fmtDate(selectedEnquiry.privacyConsentDecidedAt)}
                        </p>
                      )}
                      {selectedConsentDecisionSource && (
                        <p className="text-xs text-muted-foreground">
                          Source: {selectedConsentDecisionSource}
                        </p>
                      )}
                      {selectedEnquiry.privacyConsentDecisionNote && (
                        <p className="text-xs text-muted-foreground">
                          Note: {selectedEnquiry.privacyConsentDecisionNote}
                        </p>
                      )}
                    </div>
                  )}
                  {selectedEnquiry.consentRequestSentAt && (
                    <p className="text-xs text-muted-foreground" data-testid="text-consent-last-sent">
                      Consent request last sent: {fmtDate(selectedEnquiry.consentRequestSentAt)}
                    </p>
                  )}
                  {isSuperadmin && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openConsentDecision("granted")}
                        disabled={selectedConsentStatus === "granted"}
                        data-testid="button-manual-consent-granted"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Mark granted
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openConsentDecision("refused")}
                        disabled={selectedConsentStatus === "refused"}
                        data-testid="button-manual-consent-refused"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Mark refused
                      </Button>
                    </div>
                  )}
                  {isAdminRole && selectedConsentStatus === "pending" && (
                    <div className="space-y-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-1"
                        onClick={() => sendConsentMutation.mutate(selectedEnquiry.id)}
                        disabled={sendingConsentId === selectedEnquiry.id}
                        data-testid="button-send-consent-request"
                      >
                        <Mail className="w-4 h-4 mr-2" />
                        {sendingConsentId === selectedEnquiry.id ? "Sending..." : selectedEnquiry.consentRequestSentAt ? "Resend consent request" : "Send consent request"}
                      </Button>
                      {manualConsentLink?.enquiryId === selectedEnquiry.id && (
                        <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 space-y-2" data-testid="manual-consent-link-section">
                          <div>
                            <p className="text-sm font-medium text-foreground">Copy consent link</p>
                            <p className="text-xs text-muted-foreground">
                              Email delivery failed. Copy this one-time fallback link and send it manually.
                            </p>
                          </div>
                          <Input
                            value={manualConsentLink.url}
                            readOnly
                            className="text-xs"
                            data-testid="input-manual-consent-link"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="w-full"
                            onClick={copyManualConsentLink}
                            data-testid="button-copy-consent-link"
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copy consent link
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={consentDecisionOpen} onOpenChange={setConsentDecisionOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-manual-consent-decision">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Mark privacy consent {formatConsentStatus(consentDecisionStatus).toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              Add the audit note explaining why this manual decision is being recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border p-3 text-sm">
              {selectedEnquiry ? (
                <span>{selectedEnquiry.enquiryRef} - {displayName(selectedEnquiry)}</span>
              ) : (
                <span>No enquiry selected</span>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="manual-consent-note">
                Decision note *
              </label>
              <Textarea
                id="manual-consent-note"
                value={consentDecisionNote}
                onChange={(event) => setConsentDecisionNote(event.target.value)}
                rows={4}
                placeholder="Record the reason and who confirmed the consent decision."
                data-testid="input-manual-consent-note"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConsentDecisionOpen(false)}
                disabled={manualConsentDecisionMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitConsentDecision}
                disabled={!consentDecisionNote.trim() || manualConsentDecisionMutation.isPending}
                data-testid="button-submit-manual-consent"
              >
                {manualConsentDecisionMutation.isPending ? "Saving..." : `Mark ${formatConsentStatus(consentDecisionStatus).toLowerCase()}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!duplicateReviewTarget} onOpenChange={(open) => { if (!open) setDuplicateReviewTarget(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-duplicate-review">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {duplicateReviewStatus === "linked" ? "Link duplicate enquiry" : "Dismiss duplicate match"}
            </DialogTitle>
            <DialogDescription>
              Add a review note before saving this possible duplicate decision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 border p-3 text-sm space-y-1">
              <p>
                <span className="font-medium">Current:</span> {selectedEnquiry ? `${selectedEnquiry.enquiryRef} - ${displayName(selectedEnquiry)}` : "No enquiry selected"}
              </p>
              {duplicateReviewTarget && (
                <p>
                  <span className="font-medium">Matched:</span>{" "}
                  {(() => {
                    const related = selectedEnquiry?.id === duplicateReviewTarget.sourceEnquiryId
                      ? duplicateReviewTarget.matchedEnquiry
                      : duplicateReviewTarget.sourceEnquiry;
                    return related ? `${related.enquiryRef} - ${displayName(related)}` : "Matched enquiry";
                  })()}
                </p>
              )}
              {duplicateReviewStatus === "linked" && (
                <p className="text-xs text-muted-foreground">
                  The current enquiry will be recorded as the primary record. No data will be merged or archived.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="duplicate-review-note">
                Review note *
              </label>
              <Textarea
                id="duplicate-review-note"
                value={duplicateReviewNote}
                onChange={(event) => setDuplicateReviewNote(event.target.value)}
                rows={4}
                placeholder={duplicateReviewStatus === "linked" ? "Record why these enquiries are duplicates." : "Record why this match is not a duplicate."}
                data-testid="input-duplicate-review-note"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDuplicateReviewTarget(null)}
                disabled={duplicateReviewMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={submitDuplicateReview}
                disabled={!duplicateReviewNote.trim() || duplicateReviewMutation.isPending}
                data-testid="button-submit-duplicate-review"
              >
                {duplicateReviewMutation.isPending ? "Saving..." : duplicateReviewStatus === "linked" ? "Link duplicate" : "Dismiss match"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-edit-enquiry">
          <DialogHeader>
            <DialogTitle className="font-heading">Edit enquiry</DialogTitle>
            <DialogDescription>Update the enquiry details below.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((data) => {
              if (selectedEnquiry) updateMutation.mutate({ id: selectedEnquiry.id, data });
            })} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name *</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-firstName" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name *</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-lastName" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email address *</FormLabel>
                    <FormControl><Input type="email" {...field} value={field.value ?? ""} data-testid="input-edit-email" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="mobileTelephone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Telephone *</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-telephone" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="addressLine1" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address line 1 *</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-addressLine1" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="postcode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postcode *</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-postcode" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={editForm.control} name="contactMethod" render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact method *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger data-testid="select-edit-contact-method"><SelectValue placeholder="Select contact method" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ENQUIRY_CONTACT_METHODS.map(method => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="leadSource" render={({ field }) => (
                <FormItem>
                  <FormLabel>How did you hear about us? *</FormLabel>
                  <Select onValueChange={(val) => {
                    field.onChange(val);
                    if (val !== "Other (please specify)" && val !== "Word of mouth (please tell us who?)") {
                      editForm.setValue("leadSourceOther", "");
                    }
                  }} value={field.value ?? ""}>
                    <FormControl><SelectTrigger data-testid="select-edit-lead-source"><SelectValue placeholder="Select an option" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {(editForm.watch("leadSource") === "Other (please specify)" || editForm.watch("leadSource") === "Word of mouth (please tell us who?)") && (
                <FormField control={editForm.control} name="leadSourceOther" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Please specify</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} placeholder="Please specify" data-testid="input-edit-leadSourceOther" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={editForm.control} name="referralType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Are you referring yourself or a client?</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl><SelectTrigger data-testid="select-edit-referral-type"><SelectValue placeholder="Select an option" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {REFERRAL_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="issueType" render={({ field }) => (
                <FormItem>
                  <FormLabel>What kind of mediation would you like to discuss? *</FormLabel>
                  <Select onValueChange={(val) => {
                    field.onChange(val);
                    if (val !== "Other (please give details below)") {
                      editForm.setValue("issueTypeOther", "");
                    }
                  }} value={field.value}>
                    <FormControl><SelectTrigger data-testid="select-edit-issue-type"><SelectValue placeholder="Select mediation type" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {editForm.watch("issueType") === "Other (please give details below)" && (
                <FormField control={editForm.control} name="issueTypeOther" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Please give details</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} placeholder="Please give details" data-testid="input-edit-issueTypeOther" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={editForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Anything else you'd like to tell us?</FormLabel>
                  <FormControl><Textarea rows={4} {...field} value={field.value ?? ""} placeholder="Please use this space to give us more information about your query" data-testid="input-edit-notes" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Button type="submit" className="w-full" disabled={updateMutation.isPending} data-testid="button-submit-edit-enquiry">
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-enquiry-info">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Info className="w-5 h-5 text-[#b8825a]" />
              About Enquiries
            </DialogTitle>
            <DialogDescription>How enquiries work and what the statuses mean.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-foreground">
            <p>
              Enquiries are the starting point of every client journey. When someone contacts Brighter Future Mediation, their details are logged here and the system automatically creates a case shell and Client A record for a linked audit trail.
            </p>

            <div>
              <h4 className="font-semibold mb-1.5">Enquiry Flow</h4>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {Object.entries(ENQUIRY_STATUS_STYLES).map(([status, style], i, arr) => (
                  <span key={status} className="contents">
                    <StatusBadge label={status} dotColor={style.dot} badgeClass={style.badge} />
                    {i < arr.length - 1 && (
                      <span className="text-muted-foreground">{i === arr.length - 2 ? "or" : "→"}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">Status Meanings</h4>
              <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                <li><span className="text-foreground font-medium">New</span> — Case shell created, awaiting claim</li>
                <li><span className="text-foreground font-medium">Claimed</span> — A staff member is responsible for intake work</li>
                <li><span className="text-foreground font-medium">Chasing</span> — First contact or standard chase is in progress</li>
                <li><span className="text-foreground font-medium">Safeguarding</span> — Safeguarding pathway is active</li>
                <li><span className="text-foreground font-medium">Closed</span> — Intake was closed with a reason code</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">Intake workspace</h4>
              <p className="text-muted-foreground">
                Open an enquiry&apos;s full workspace to claim it, record first contact and chasing, manage safeguarding, close intake, send or review privacy consent, check acknowledgement email delivery, and review possible duplicates. The enquiry status mirrors the linked case intake status.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">Triage and follow-up</h4>
              <p className="text-muted-foreground">
                Use the list filters and follow-up badges to prioritise due today, overdue, unclaimed, and safeguarding work. A closed enquiry records that intake has ended; it does not close the linked case, which is managed separately.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-1.5">Key Information Captured</h4>
              <p className="text-muted-foreground">
                Each enquiry records contact details, lead source, referral type, mediation type, notes, privacy consent, acknowledgement email status, follow-up state, and linked-case information.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={!!archiveTarget}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
        title={`Archive enquiry ${archiveTarget?.enquiryRef ?? ""}?`}
        description="Archived enquiries are hidden from default lists. You can restore them at any time from the Archived filter."
        onConfirm={() => archiveTarget && archiveEnquiryMutation.mutate(archiveTarget.id)}
        confirmLabel="Archive"
        cancelTestId="button-cancel-archive-enquiry"
        confirmTestId="button-confirm-archive-enquiry"
        isPending={archiveEnquiryMutation.isPending}
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Permanently delete enquiry?"
        description={`This will permanently remove enquiry ${deleteTarget?.enquiryRef ?? ""}. This cannot be undone.`}
        onConfirm={(typed) => deleteTarget && hardDeleteEnquiryMutation.mutate({ id: deleteTarget.id, confirm: typed ?? "" })}
        confirmLabel="Delete permanently"
        confirmText={deleteTarget?.enquiryRef}
        confirmInputTestId="input-confirm-delete-enquiry"
        cancelTestId="button-cancel-delete-enquiry"
        confirmTestId="button-confirm-delete-enquiry"
        isPending={hardDeleteEnquiryMutation.isPending}
      />
    </div>
  );
}
