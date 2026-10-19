import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Save, Plus, Trash2, FileText, Loader2, Download, CheckCircle, XCircle, Flag, Pencil, AlertTriangle } from "lucide-react";
import type { MiamRecord, Party } from "@shared/schema";
import { ISSUE_TYPES } from "@shared/schema";
import { StagedPartyCard } from "@/components/staged-party-card";
import { formatUkWallClockDate } from "@/lib/date-time";

interface MiamRecordTabProps {
  caseId: string;
  canEdit: boolean;
  isMiamOnlyMediator?: boolean;
}

interface ChildEntry {
  name: string;
  firstName: string;
  lastName: string;
  dob: string;
  age: string;
  gender: string;
  livesWithClient: string;
  residenceAddress: string;
  contactArrangements: string;
  school: string;
  notes: string;
}

interface MiamPrefill {
  sessionMediator: string;
  clientName: string;
  clientFirstName: string;
  clientLastName: string;
  clientDob: string;
  clientAddress: string;
  clientPhone: string;
  howHeardAboutBfm: string;
  clientDisability: string;
  clientAccessibility: string;
  clientEthnicity: string;
  caseReference: string;
  caseType: string;
  otherClientName: string;
  otherClientFirstName: string;
  otherClientLastName: string;
  otherClientDob: string;
  otherClientAddress: string;
  otherClientPhone: string;
  otherClientEmail: string;
  otherPartyHasMiamMediator?: boolean;
}

interface MiamEditRequest {
  id: string;
  miamRecordId: string;
  caseId: string;
  requestedBy: string;
  requestedAt: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  proposedChanges: Record<string, unknown>;
  originalValues: Record<string, unknown>;
  requestNote: string | null;
  requesterName: string;
}

interface MiamEditRequestFeedback extends MiamEditRequest {
  reviewerName: string;
}

interface MiamApiResponse {
  records: MiamRecord[];
  parties: Party[];
  prefill: Record<string, MiamPrefill>;
  caseRef: string;
  miamValidity?: {
    parties: Array<{
      partyId: string;
      valid: boolean;
      expired: boolean;
      expiresAt: string | null;
      sourceDate: string | null;
      renewalBookingAvailable: boolean;
    }>;
  };
  mediatorOptions?: Array<{ id: string; name: string }>;
  editRequests?: Record<string, MiamEditRequest>;
  lastEditRequestFeedback?: Record<string, MiamEditRequestFeedback>;
  miamMediatorTabHidden?: boolean;
  partyBExistsOnCase?: boolean;
  nextRoleLetterOnCase?: string | null;
}

const emptyChild: ChildEntry = {
  name: "", firstName: "", lastName: "", dob: "", age: "", gender: "", livesWithClient: "", residenceAddress: "", contactArrangements: "", school: "", notes: ""
};

interface ChecklistItemValue {
  status: string;
  notes: string;
}

type ChecklistEntry =
  | { key: string; label: string; type: "item" }
  | { key: string; label: string; type: "header" }
  | { key: string; label: string; type: "subItem" };

const CHECKLIST_ITEMS: ChecklistEntry[] = [
  { key: "fourMonthRule", label: "Made client aware of 4-month rule, in relation to filing court application", type: "item" },
  { key: "legalPrivilege", label: "Mediation legally privileged / not binding", type: "item" },
  { key: "legalAdvice", label: "Had legal advice? Would like free consultation?", type: "item" },
  { key: "legalAidInfo", label: "Information given on legal aid?", type: "item" },
  { key: "reconciliation", label: "Reconciliation tried? Recently?", type: "item" },
  { key: "otherAgencies", label: "Other agency/ies signposted (if yes, specify)", type: "item" },
  { key: "adrInfoHeader", label: "Info given about alternatives:", type: "header" },
  { key: "adrArbitration", label: "Arbitration — A private judge (arbitrator) makes a binding decision on financial or property disputes. It's quicker and more private than court, and the decision is final and legally enforceable", type: "subItem" },
  { key: "adrCollaborativeLaw", label: "Collaborative law — You and your ex each hire specially trained solicitors who work together in meetings to help you reach an agreement. If it breaks down, those solicitors can't represent you in court", type: "subItem" },
  { key: "adrNegotiation", label: "Negotiation through solicitors — Your solicitor and your ex's solicitor negotiate on your behalf, usually through letters or calls, to try to settle things without going to court", type: "subItem" },
  { key: "adrEarlyNeutralEvaluation", label: "Early neutral evaluation — An experienced family law professional gives a non-binding opinion on the likely outcome if your case went to court. It can help both sides see the bigger picture and encourage settlement", type: "subItem" },
  { key: "adrPrivateFdr", label: "Private FDR — You hire a senior lawyer or retired judge to act as a judge in a private financial hearing. They give an indication of what a court might decide, which often helps both sides agree", type: "subItem" },
  { key: "conflictOfInterest", label: "Conflict of interest?", type: "item" },
  { key: "priorCourtOrders", label: "Any previous or current court orders?", type: "item" },
  { key: "caringAdults", label: "Are there other adults with caring responsibilities who should be involved?", type: "item" },
  { key: "pfAimFinancial", label: "In P&F/AIM: Financial Disclosure booklet, OFS and MOU explanation with fees", type: "item" },
  { key: "childrenCasesMou", label: "In children's cases: MOU purpose/fees, Statement of child arrangements purpose/fees", type: "item" },
  { key: "onlineWillingness", label: "Willing to mediate online?", type: "item" },
  { key: "estimatedSessions", label: "No. of sessions estimated — special conditions e.g. shuttle or hybrid mediation?", type: "item" },
  { key: "mojVoucherScheme", label: "MOJ voucher discussed/eligible? (check they haven't claimed before)", type: "item" },
];

const ISSUES_ITEMS = [
  { key: "childArrangements", label: "Child/ren's arrangements" },
  { key: "livingArrangements", label: "Living arrangements" },
  { key: "timeWithEachParent", label: "Time spent with each parent" },
  { key: "prIssues", label: "PR issues, e.g. health, faith, education, travel, re-location, name change" },
  { key: "communications", label: "Communications" },
  { key: "maintenance", label: "Maintenance" },
  { key: "other", label: "Other (please specify)" },
  { key: "financialSettlement", label: "Financial settlement" },
  { key: "accommodation", label: "Accommodation / family home" },
  { key: "otherAssets", label: "Other assets" },
  { key: "liabilities", label: "Liabilities" },
  { key: "pensions", label: "Pensions" },
  { key: "spousalMaintenance", label: "Spousal maintenance" },
];

const FURTHER_INFO_ITEMS = [
  { key: "freeConsultation", label: "Free consultation" },
  { key: "c100Assistance", label: "Help with completing the C100/Form A/Draft Consent order?" },
  { key: "solicitorsLegalAdvice", label: "Solicitors/legal advice?" },
  { key: "divorceCoaching", label: "Divorce/separation coaching?" },
  { key: "counsellingTherapy", label: "Therapy/counselling?" },
  { key: "financialAdvice", label: "Financial advice/planning?" },
  { key: "mortgageAdvisors", label: "Mortgage Advisors" },
  { key: "wills", label: "Wills?" },
  { key: "otherInfo", label: "Other?" },
];

const DA_SUPPORT_SERVICES = [
  { key: "womensAid", label: "Women's Aid" },
  { key: "refuge", label: "Refuge" },
  { key: "respectMensAdviceLine", label: "Respect (Men's Advice Line)" },
  { key: "nationalDomesticAbuseHelpline", label: "National Domestic Abuse Helpline" },
  { key: "localIdvaServices", label: "Local IDVA services" },
  { key: "other", label: "Other" },
];

const PPC_REASON_OPTIONS = [
  "Complex safeguarding concerns",
  "Domestic abuse disclosed",
  "Power imbalance concerns",
  "Capacity concerns",
  "Difficult professional judgement",
  "Other",
];

function FormField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className || "space-y-1"}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <p className="text-sm py-1.5 px-3 bg-muted/50 rounded-md min-h-[2.25rem] flex items-center">{value || "—"}</p>
    </div>
  );
}

function formatMiamDisplayDate(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) return raw;
  return formatUkWallClockDate(parsed, { day: "numeric", month: "long", year: "numeric" });
}

function getCurrentUkMiamDateTime(now = new Date()): { date: string; time: string } {
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((item) => item.type === type)?.value || "";
  return {
    date: `${part(dateParts, "year")}-${part(dateParts, "month")}-${part(dateParts, "day")}`,
    time: `${part(timeParts, "hour")}:${part(timeParts, "minute")}`,
  };
}

function isBlankMiamHeaderValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function applyBlankMiamHeaderDefaults<T extends Partial<MiamRecord>>(draft: T, assignedMediator: string): T {
  const ukNow = getCurrentUkMiamDateTime();
  return {
    ...draft,
    sessionMediator: isBlankMiamHeaderValue(draft.sessionMediator) ? assignedMediator : draft.sessionMediator,
    sessionDate: isBlankMiamHeaderValue(draft.sessionDate) ? ukNow.date : draft.sessionDate,
    sessionTime: isBlankMiamHeaderValue(draft.sessionTime) ? ukNow.time : draft.sessionTime,
  } as T;
}

function HelperText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground italic leading-relaxed">{children}</p>
  );
}

function YesNoSelect({ value, onChange, id, disabled }: { value: string; onChange: (v: string) => void; id: string; disabled?: boolean }) {
  return (
    <Select value={value || ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger data-testid={`select-${id}`} className="h-9">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
        <SelectItem value="n/a">N/A</SelectItem>
      </SelectContent>
    </Select>
  );
}

function formatYesNo(val: string | null | undefined): string {
  if (!val) return "—";
  if (val === "yes") return "Yes";
  if (val === "no") return "No";
  if (val === "n/a") return "N/A";
  return val;
}

const TOP_LEVEL_DEPENDENT_FIELD_CLEARS: Record<string, Record<string, unknown>> = {
  ppcRequired: {
    ppcReason: [],
    ppcReasonOther: null,
    ppcDate: null,
    ppcConsultantName: null,
    ppcOutcomes: null,
  },
  referralToChildrenServices: {
    referralToChildrenServicesDetails: null,
    referralFollowUpContact: null,
  },
  welfareAgencyContacted: {
    welfareAgencyName: null,
    welfareAgencyDate: null,
    welfareAgencyTime: null,
  },
  married: {
    dateOfMarriage: null,
    divorceStarted: null,
    divorceStartedDate: null,
    petitioner: null,
    decreeNisiDate: null,
    decreeAbsoluteDate: null,
  },
  livedTogether: {
    dateOfCohabitation: null,
  },
  divorceStarted: {
    divorceStartedDate: null,
    petitioner: null,
    decreeNisiDate: null,
    decreeAbsoluteDate: null,
  },
  childInclusiveExplained: {
    childInclusiveClientResponse: null,
    childInclusiveConfidentialityExplained: null,
    childInclusiveConsentAgreed: null,
    childInclusiveNotes: null,
  },
};

function isYes(value: unknown): boolean {
  return value === "yes";
}

function isYesOrNo(value: unknown): boolean {
  return value === "yes" || value === "no";
}

function clearNestedNotesWhen(
  collection: unknown,
  shouldKeepNotes: (status: string) => boolean,
): Record<string, ChecklistItemValue> {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) return {};
  return Object.fromEntries(
    Object.entries(collection as Record<string, ChecklistItemValue>).map(([key, value]) => {
      const status = value?.status || "";
      return [key, { ...value, notes: shouldKeepNotes(status) ? value?.notes || "" : "" }];
    }),
  );
}

function normalizeMiamDependentFields<T extends Partial<MiamRecord>>(data: T): T {
  const next = { ...data } as T & Record<string, unknown>;
  for (const [controller, clears] of Object.entries(TOP_LEVEL_DEPENDENT_FIELD_CLEARS)) {
    if (!isYes(next[controller])) {
      Object.assign(next, clears);
    }
  }
  if (!isYesOrNo(next.suitableForMediation)) {
    next.suitabilityReasons = null;
  }
  next.furtherInfoRequested = clearNestedNotesWhen(next.furtherInfoRequested, isYes);
  next.checklist = clearNestedNotesWhen(next.checklist, isYesOrNo);
  return next as T;
}

class MiamSaveError extends Error {
  readonly miamSaved: boolean;
  constructor(message: string, miamSaved: boolean) {
    super(message);
    this.name = "MiamSaveError";
    this.miamSaved = miamSaved;
  }
}

export default function MiamRecordTab({ caseId, canEdit, isMiamOnlyMediator }: MiamRecordTabProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeParty, setActiveParty] = useState<string>("");
  const [formData, setFormData] = useState<Partial<MiamRecord>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [superadminEditMode, setSuperadminEditMode] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [flagNotes, setFlagNotes] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showFlagDialog, setShowFlagDialog] = useState(false);
  const [editRequestMode, setEditRequestMode] = useState(false);
  const [editRequestNote, setEditRequestNote] = useState("");
  const [originalFormSnapshot, setOriginalFormSnapshot] = useState<Partial<MiamRecord>>({});
  const [showEditReqRejectDialog, setShowEditReqRejectDialog] = useState(false);
  const [showEditReqFlagDialog, setShowEditReqFlagDialog] = useState(false);
  const [editReqRejectNotes, setEditReqRejectNotes] = useState("");
  const [editReqFlagNotes, setEditReqFlagNotes] = useState("");
  const [showDiffPanel, setShowDiffPanel] = useState(false);

  const isSuperadmin = user?.role === "superadmin";
  const isAdminRole = user?.role === "superadmin" || user?.role === "subadmin";
  const isNonSuperadminStaff = user?.role === "mediator" || user?.role === "subadmin";

  const { data: miamData, isLoading } = useQuery<MiamApiResponse>({
    queryKey: ["/api/miam-records/case", caseId],
    queryFn: async () => {
      const res = await fetch(`/api/miam-records/case/${caseId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const parties = miamData?.parties || [];
  const records = miamData?.records || [];
  const prefill = miamData?.prefill || {};

  // Use the authoritative case-level flags from the server (computed from
  // UNSCOPED parties) so that MIAM-only mediators with a scoped tab list still
  // see the correct "Party B exists" / next-letter behaviour in Section 5.
  // Fall back to a client-side scan of the (possibly scoped) parties array if
  // the server has not yet been redeployed.
  const partyBExistsOnCase = miamData?.partyBExistsOnCase
    ?? parties.some((p) => (p.role || "").toUpperCase() === "B");
  const nextRoleLetter = (miamData?.nextRoleLetterOnCase !== undefined)
    ? miamData.nextRoleLetterOnCase
    : (() => {
      if (parties.length === 0) return "A";
      const used = new Set(parties.map((p) => (p.role || "").toUpperCase()));
      for (let code = 65; code <= 90; code++) {
        const letter = String.fromCharCode(code);
        if (!used.has(letter)) return letter;
      }
      return null;
    })();
  // Once Party B exists on the case, Section 5's free-text "Other Client" form
  // is replaced by the structured AddPartyCard for adding Party C, D, ...
  const showAddPartyInsteadOfOtherClient = partyBExistsOnCase;

  // Gating for the AddPartyCard is intentionally decoupled from MIAM record
  // edit state (`effectiveCanEdit`): adding a new party is a case-level
  // operation, NOT a MIAM-form edit. Staff (superadmin/subadmin) and
  // mediators with `cases.edit` (the `canEdit` prop) can always add Party
  // C/D/... even on submitted/approved/flagged MIAM records. The backend
  // endpoint POST /api/cases/:caseId/parties enforces the same allowlist.
  const isStaffOrMediator = user?.role === "superadmin" || user?.role === "subadmin" || user?.role === "mediator";
  const canAddParty = canEdit && isStaffOrMediator;

  const editRequests = miamData?.editRequests || {};
  const lastEditRequestFeedback = miamData?.lastEditRequestFeedback || {};

  const activeRecord = records.find((r: MiamRecord) => r.partyId === activeParty);
  const approvalStatus = (activeRecord as MiamRecord & { approvalStatus?: string })?.approvalStatus || "draft";
  const reviewNotesText = (activeRecord as MiamRecord & { reviewNotes?: string })?.reviewNotes || "";
  const reviewedByName = (activeRecord as MiamRecord & { reviewedBy?: string })?.reviewedBy || "";
  const isFormLocked = !isAdminRole && !editRequestMode && ["submitted", "approved", "flagged"].includes(approvalStatus);
  const effectiveCanEdit = canEdit && !isFormLocked && (isAdminRole ? superadminEditMode || approvalStatus === "draft" : true);
  const recordId = activeRecord?.id;
  const pendingEditRequest = recordId ? editRequests[recordId] as MiamEditRequest | undefined : undefined;
  const hasPendingEditRequest = !!pendingEditRequest;
  const editRequestFeedback = recordId ? lastEditRequestFeedback[recordId] as MiamEditRequestFeedback | undefined : undefined;

  useEffect(() => {
    if (parties.length === 0) return;
    // Initialise on first load AND re-sync if the current activeParty is no
    // longer in the (possibly scoped) parties list. This protects MIAM-only
    // mediators who add a Party C they cannot themselves see: `onPartyAdded`
    // optimistically sets activeParty to the new id, the query refetches with
    // the scoped list (which omits the new party for that mediator), and this
    // effect then falls back to the first visible party so the tabs/form
    // never enter an "active id with no matching party" state.
    if (!activeParty || !parties.some((p) => p.id === activeParty)) {
      setActiveParty(parties[0].id);
    }
  }, [parties, activeParty]);

  useEffect(() => {
    if (!activeParty) return;
    const existing = records.find((r: MiamRecord) => r.partyId === activeParty);
    if (existing) {
      const pf = prefill[activeParty];
      const merged = { ...existing };
      const validCaseTypes: readonly string[] = ISSUE_TYPES;
      if ((!merged.caseType || !validCaseTypes.includes(merged.caseType)) && pf?.caseType) {
        merged.caseType = pf.caseType;
      }
      if (!merged.caseReference && pf?.caseReference) {
        merged.caseReference = pf.caseReference;
      }
      setFormData(normalizeMiamDependentFields(applyBlankMiamHeaderDefaults(merged, pf?.sessionMediator || "")));
    } else {
      const next = { ...(prefill[activeParty] || {}) };
      setFormData(normalizeMiamDependentFields(applyBlankMiamHeaderDefaults(next, next.sessionMediator || "")));
    }
    setIsDirty(false);
    setSuperadminEditMode(false);
    setEditRequestMode(false);
    setEditRequestNote("");
    setEditAndApproveMode(false);
  }, [activeParty, records, prefill]);

  const updateField = useCallback((field: string, value: unknown) => {
    setFormData((prev: Partial<MiamRecord>) => normalizeMiamDependentFields({ ...prev, [field]: value }));
    setIsDirty(true);
  }, []);

  function invalidateMiamWorkflowQueries() {
    queryClient.invalidateQueries({ queryKey: ["/api/miam-records/case", caseId] });
    queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId, "activities"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/bell"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/miam-records/party/${activeParty}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeMiamDependentFields(formData)),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new MiamSaveError(body?.message || `Unexpected error (${res.status})`, !!body?.miamSaved);
      }
      return body as { clientBCreated?: boolean; clientBName?: string; stageUpdated?: boolean; newStage?: string };
    },
    onSuccess: (data: { clientBCreated?: boolean; clientBName?: string; stageUpdated?: boolean; newStage?: string }) => {
      invalidateMiamWorkflowQueries();
      setIsDirty(false);
      toast({ title: "MIAM record saved", description: "Changes have been saved successfully." });
      if (data?.clientBCreated) {
        queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        toast({
          title: "Client B added",
          description: `${data.clientBName || "Client B"} has been added to this case from the Other Client's Details.`,
        });
      }
      if (data?.stageUpdated) {
        queryClient.invalidateQueries({ queryKey: ["/api/cases", caseId] });
        toast({
          title: "Case stage updated",
          description: `Case stage has been advanced to "${data.newStage}".`,
        });
      }
    },
    onError: (err: Error) => {
      const miamSaved = err instanceof MiamSaveError && err.miamSaved;
      if (miamSaved) {
        invalidateMiamWorkflowQueries();
      }
      toast({
        title: miamSaved ? "MIAM saved — party not added" : "Failed to save MIAM record",
        description: err.message || "An error occurred. Please try again.",
        variant: "destructive",
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!recordId) throw new Error("No record to approve");
      const res = await apiRequest("POST", `/api/miam-records/${recordId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      toast({ title: "MIAM record approved", description: "The record has been approved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve MIAM record.", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!recordId) throw new Error("No record to reject");
      const res = await apiRequest("POST", `/api/miam-records/${recordId}/reject`, { notes: rejectNotes });
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      setShowRejectDialog(false);
      setRejectNotes("");
      toast({ title: "MIAM record rejected", description: "The record has been rejected. The submitter will be notified." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reject MIAM record.", variant: "destructive" });
    },
  });

  const flagMutation = useMutation({
    mutationFn: async () => {
      if (!recordId) throw new Error("No record to flag");
      const res = await apiRequest("POST", `/api/miam-records/${recordId}/flag`, { notes: flagNotes });
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      setShowFlagDialog(false);
      setFlagNotes("");
      toast({ title: "MIAM record flagged", description: "The record has been flagged for attention." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to flag MIAM record.", variant: "destructive" });
    },
  });

  const submitEditRequestMutation = useMutation({
    mutationFn: async () => {
      if (!recordId) throw new Error("No record");
      const changedFields: Record<string, unknown> = {};
      const normalizedFormData = normalizeMiamDependentFields(formData);
      const currentFields = normalizedFormData as Record<string, unknown>;
      const snapshotFields = originalFormSnapshot as Record<string, unknown>;
      for (const key of Object.keys(currentFields)) {
        if (key === "id" || key === "partyId" || key === "caseId" || key === "createdAt" || key === "updatedAt") continue;
        if (JSON.stringify(currentFields[key]) !== JSON.stringify(snapshotFields[key])) {
          changedFields[key] = currentFields[key];
        }
      }
      if (Object.keys(changedFields).length === 0) {
        throw new Error("No changes detected. Please modify at least one field.");
      }
      const res = await apiRequest("POST", "/api/miam-edit-requests", {
        miamRecordId: recordId,
        proposedData: normalizeMiamDependentFields({ ...snapshotFields, ...changedFields }),
        requestNote: editRequestNote.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      setEditRequestMode(false);
      setEditRequestNote("");
      setIsDirty(false);
      toast({ title: "Edit request submitted", description: "Your change request has been sent to the superadmin for review." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message || "Failed to submit edit request.", variant: "destructive" });
    },
  });

  const [editAndApproveMode, setEditAndApproveMode] = useState(false);

  const approveEditRequestMutation = useMutation<unknown, Error, Record<string, unknown> | undefined>({
    mutationFn: async (overrides?: Record<string, unknown>) => {
      if (!pendingEditRequest) throw new Error("No pending edit request");
      const body = overrides ? { overrides } : {};
      const res = await apiRequest("POST", `/api/miam-edit-requests/${pendingEditRequest.id}/approve`, body);
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      setShowDiffPanel(false);
      setEditAndApproveMode(false);
      setSuperadminEditMode(false);
      toast({ title: "Edit request approved", description: "The changes have been applied to the MIAM record." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve edit request.", variant: "destructive" });
    },
  });

  const rejectEditRequestMutation = useMutation({
    mutationFn: async () => {
      if (!pendingEditRequest) throw new Error("No pending edit request");
      const res = await apiRequest("POST", `/api/miam-edit-requests/${pendingEditRequest.id}/reject`, { notes: editReqRejectNotes });
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      setShowEditReqRejectDialog(false);
      setShowDiffPanel(false);
      setEditReqRejectNotes("");
      toast({ title: "Edit request rejected", description: "The edit request has been dismissed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reject edit request.", variant: "destructive" });
    },
  });

  const flagEditRequestMutation = useMutation({
    mutationFn: async () => {
      if (!pendingEditRequest) throw new Error("No pending edit request");
      const res = await apiRequest("POST", `/api/miam-edit-requests/${pendingEditRequest.id}/flag`, { notes: editReqFlagNotes });
      return res.json();
    },
    onSuccess: () => {
      invalidateMiamWorkflowQueries();
      setShowEditReqFlagDialog(false);
      setShowDiffPanel(false);
      setEditReqFlagNotes("");
      toast({ title: "Edit request flagged", description: "The edit request has been flagged for revision." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to flag edit request.", variant: "destructive" });
    },
  });

  const startEditRequestMode = () => {
    setOriginalFormSnapshot({ ...formData });
    setEditRequestMode(true);
    setEditRequestNote("");
    setIsDirty(false);
  };

  const cancelEditRequestMode = () => {
    setFormData({ ...originalFormSnapshot });
    setEditRequestMode(false);
    setEditRequestNote("");
    setIsDirty(false);
  };

  const startEditAndApprove = () => {
    if (!pendingEditRequest) return;
    const mergedData = normalizeMiamDependentFields({ ...formData, ...pendingEditRequest.proposedChanges });
    setOriginalFormSnapshot({ ...formData });
    setFormData(mergedData);
    setEditAndApproveMode(true);
    setSuperadminEditMode(true);
    setIsDirty(true);
  };

  const cancelEditAndApprove = () => {
    setFormData({ ...originalFormSnapshot });
    setEditAndApproveMode(false);
    setSuperadminEditMode(false);
    setIsDirty(false);
  };

  const submitEditAndApprove = () => {
    if (!pendingEditRequest) return;
    const overrides: Record<string, unknown> = {};
    const formFields = formData as Record<string, unknown>;
    const originalFields = originalFormSnapshot as Record<string, unknown>;
    for (const key of Object.keys(formFields)) {
      if (key === "id" || key === "partyId" || key === "caseId" || key === "createdAt" || key === "updatedAt") continue;
      if (JSON.stringify(formFields[key]) !== JSON.stringify(originalFields[key])) {
        overrides[key] = formFields[key];
      }
    }
    approveEditRequestMutation.mutate(Object.keys(overrides).length > 0 ? overrides : undefined);
  };

  const FIELD_LABELS: Record<string, string> = {
    sessionMediator: "Session Mediator", sessionDate: "Session Date", sessionTime: "Session Time",
    otherPeoplePresent: "Other People Present", caseReference: "Case Reference", caseType: "Case Type",
    clientName: "Client Name", clientFirstName: "Client First Name", clientLastName: "Client Last Name",
    clientDob: "Client Date of Birth", clientAddress: "Client Address",
    clientPhone: "Client Phone", howHeardAboutBfm: "How Heard About BFM", clientOccupation: "Client Occupation",
    clientDisability: "Client Disability", clientAccessibility: "Client Accessibility",
    clientEthnicity: "Client Ethnicity", clientReligiousCulturalNeeds: "Religious/Cultural Needs",
    clientNewPartner: "Client New Partner", introNotes: "Introduction Notes",
    introPurposeDiscussed: "Purpose Discussed", introConfidentialityExplained: "Confidentiality Explained",
    children: "Children", otherClientName: "Other Client Name",
    otherClientFirstName: "Other Client First Name", otherClientLastName: "Other Client Last Name",
    otherClientDob: "Other Client DOB",
    otherClientAddress: "Other Client Address", otherClientPhone: "Other Client Phone",
    otherClientEmail: "Other Client Email", married: "Married", dateOfMarriage: "Date of Marriage",
    livedTogether: "Lived Together", dateOfCohabitation: "Date of Cohabitation",
    dateOfSeparation: "Date of Separation", bothParentsPr: "Both Parents PR", prIsIssue: "PR Is Issue",
    divorceStarted: "Divorce Started", divorceStartedDate: "Divorce Started Date", petitioner: "Petitioner",
    decreeNisiDate: "Decree Nisi Date", decreeAbsoluteDate: "Decree Absolute Date",
    courtOrders: "Court Orders", applicationsToCourtText: "Applications to Court",
    checklist: "Checklist", backgroundNotes: "Background Notes", bgWhatBringsYou: "What Brings You",
    bgLivingArrangements: "Living Arrangements", bgChildrenDetails: "Children Details",
    bgContactArrangements: "Contact Arrangements", welfareOfChildren: "Welfare of Children",
    welfareAgencyContacted: "Welfare Agency Contacted", welfareAgencyName: "Welfare Agency Name",
    welfareAgencyDate: "Welfare Agency Date", welfareAgencyTime: "Welfare Agency Time",
    welfareNotes: "Welfare Notes", welfareChildrensServices: "Children's Services",
    welfareSafetyConcerns: "Safety Concerns", welfareWitnessedConflict: "Witnessed Conflict",
    welfareInjuriesBehaviouralChanges: "Injuries/Behavioural Changes",
    welfareSafeguardingPlans: "Safeguarding Plans", childInclusiveExplained: "Child Inclusive Explained",
    childInclusiveClientResponse: "Child Inclusive Client Response",
    childInclusiveConfidentialityExplained: "Child Inclusive Confidentiality",
    childInclusiveNotes: "Child Inclusive Notes", childInclusiveConsentAgreed: "Child Inclusive Consent",
    domesticAbuseScreening: "DA Screening", daHurtOrScared: "DA Hurt or Scared",
    daPoliceInvolved: "DA Police Involved", daPhysical: "DA Physical", daPowerControl: "DA Power/Control",
    daFeelSafe: "DA Feel Safe", daFinancialControl: "DA Financial Control",
    daPermissionToDecide: "DA Permission to Decide", daAfraidOfReaction: "DA Afraid of Reaction",
    domesticAbuseSafetyConclusions: "DA Safety Conclusions", domesticAbuseSupportServices: "DA Support Services",
    domesticAbuseSupportServicesOther: "Other DA Support Service",
    domesticAbuseLegalAidInfo: "DA Legal Aid Info", domesticAbuseNotes: "DA Notes",
    emotionalReadiness: "Emotional Readiness", erEqualBasis: "ER Equal Basis",
    erChoosingFreely: "ER Choosing Freely", erPressuredToAttend: "ER Pressured to Attend",
    erCanWithdraw: "ER Can Withdraw", erSameRoom: "ER Same Room", erCapacity: "ER Capacity",
    safetyMeasuresDiscussed: "Safety Measures Discussed", safetyMeasuresAgreed: "Safety Measures Agreed",
    issuesForMediation: "Issues for Mediation", issuesOther: "Issues Other",
    furtherInfoRequested: "Further Info Requested", furtherInfoOther: "Further Info Other",
    suitableForMediation: "Suitable for Mediation", suitabilityReasons: "Suitability Reasons",
    nextSteps: "Next Steps", mediationType: "Mediation Type", timeline: "Timeline",
    agreedWithClient: "Agreed With Client", ofsRequired: "OFS Required", mouRequired: "MOU Required",
    statementOfChildArrangements: "Statement of Child Arrangements", ppcRequired: "PPC Required",
    ppcReason: "PPC Reason", ppcReasonOther: "Other PPC Reason", ppcDate: "PPC Date", ppcConsultantName: "PPC Consultant Name",
    ppcOutcomes: "PPC Outcomes", referralToCafcass: "Referral to Cafcass",
    referralToChildrenServices: "Referral to Children Services",
    referralToChildrenServicesDetails: "Referral Details", referralFollowUpContact: "Referral Follow-up",
    feePerSession: "Fee Per Session", totalEstimatedFee: "Total Estimated Fee",
    mojVoucherApplied: "MOJ Voucher Applied", legalAidApplied: "Legal Aid Applied",
    paymentMethod: "Payment Method", followUpContactRequired: "Follow-up Contact Required",
  };

  const formatFieldValue = (val: unknown): string => {
    if (val === null || val === undefined || val === "") return "—";
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val.map(v => typeof v === "object" ? JSON.stringify(v) : String(v)).join(", ");
    if (typeof val === "object") {
      const entries = Object.entries(val as Record<string, unknown>);
      return entries.map(([k, v]) => {
        if (typeof v === "object" && v !== null && "status" in (v as Record<string, unknown>)) {
          const item = v as { status: string; notes?: string };
          return `${k}: ${item.status}${item.notes ? ` (${item.notes})` : ""}`;
        }
        return `${k}: ${String(v)}`;
      }).join("; ");
    }
    return String(val);
  };

  const children: ChildEntry[] = Array.isArray(formData.children) ? (formData.children as ChildEntry[]).map(child => {
    if (child.name && !child.firstName && !child.lastName) {
      const parts = child.name.trim().split(/\s+/);
      const lastName = parts.length > 1 ? parts.pop()! : "";
      const firstName = parts.join(" ");
      return { ...child, firstName, lastName };
    }
    return child;
  }) : [];
  const checklist: Record<string, ChecklistItemValue> = typeof formData.checklist === "object" && formData.checklist !== null ? (formData.checklist as Record<string, ChecklistItemValue>) : {};
  const issues: Record<string, ChecklistItemValue> = typeof formData.issuesForMediation === "object" && formData.issuesForMediation !== null ? (formData.issuesForMediation as Record<string, ChecklistItemValue>) : {};
  const furtherInfo: Record<string, ChecklistItemValue> = typeof formData.furtherInfoRequested === "object" && formData.furtherInfoRequested !== null ? (formData.furtherInfoRequested as Record<string, ChecklistItemValue>) : {};
  const ppcReasons: string[] = Array.isArray(formData.ppcReason) ? (formData.ppcReason as string[]) : [];
  const mediatorOptions = miamData?.mediatorOptions ?? [];
  const marriedYes = isYes(formData.married);
  const livedTogetherYes = isYes(formData.livedTogether);
  const divorceStartedYes = isYes(formData.divorceStarted);
  const welfareAgencyContactedYes = isYes(formData.welfareAgencyContacted);
  const childInclusiveExplainedYes = isYes(formData.childInclusiveExplained);
  const ppcRequiredYes = isYes(formData.ppcRequired);
  const referralToChildrenServicesYes = isYes(formData.referralToChildrenServices);
  const showSuitabilityReasons = isYesOrNo(formData.suitableForMediation);

  const addChild = () => {
    updateField("children", [...children, { ...emptyChild }]);
  };

  const removeChild = (idx: number) => {
    updateField("children", children.filter((_, i) => i !== idx));
  };

  const updateChild = (idx: number, field: string, value: string) => {
    const updated = [...children];
    updated[idx] = { ...updated[idx], [field]: value };
    if (field === "firstName" || field === "lastName") {
      const child = updated[idx];
      updated[idx] = { ...child, name: [child.firstName, child.lastName].filter(Boolean).join(" ") };
    }
    updateField("children", updated);
  };

  const handleDownloadPdf = async () => {
    if (!activeParty) return;
    setIsDownloadingPdf(true);
    try {
      const res = await fetch(`/api/miam-records/party/${activeParty}/pdf`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to download PDF" }));
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      a.download = filenameMatch ? filenameMatch[1] : "MIAM_Record.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast({ title: "PDF downloaded", description: "MIAM record PDF has been downloaded." });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to download PDF";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const getItemValue = (collection: Record<string, ChecklistItemValue>, key: string): ChecklistItemValue => {
    return collection[key] || { status: "", notes: "" };
  };

  const updateChecklistItem = (key: string, field: "status" | "notes", value: string) => {
    const current = getItemValue(checklist, key);
    updateField("checklist", { ...checklist, [key]: { ...current, [field]: value } });
  };

  const updateIssueItem = (key: string, field: "status" | "notes", value: string) => {
    const current = getItemValue(issues, key);
    updateField("issuesForMediation", { ...issues, [key]: { ...current, [field]: value } });
  };

  const updateFurtherInfoItem = (key: string, field: "status" | "notes", value: string) => {
    const current = getItemValue(furtherInfo, key);
    updateField("furtherInfoRequested", { ...furtherInfo, [key]: { ...current, [field]: value } });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (parties.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <FileText className="w-12 h-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-heading font-semibold mb-1">No Parties Found</h3>
          <p className="text-sm text-muted-foreground">Add parties to this case to create MIAM records.</p>
        </CardContent>
      </Card>
    );
  }

  const partyLabel = (p: Party) => `Client ${p.role} — ${p.firstName} ${p.lastName}`;
  const activePartyDetails = parties.find((p: Party) => p.id === activeParty);
  const activePartyReviewLabel = activePartyDetails ? partyLabel(activePartyDetails) : "This client";
  const str = (v: string | null | undefined): string => v || "";
  const sessionMediatorValue = str(formData.sessionMediator);
  const selectedSessionMediatorValue = sessionMediatorValue || "__none__";
  const todayUkDate = getCurrentUkMiamDateTime().date;
  const activeMiamValidity = activeParty
    ? miamData?.miamValidity?.parties?.find((item) => item.partyId === activeParty)
    : undefined;
  const miamExpiryLabel = activeMiamValidity?.expiresAt
    ? formatMiamDisplayDate(activeMiamValidity.expiresAt)
    : null;

  const statusBadge = () => {
    const badges: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
      draft: { label: "Draft", className: "text-gray-600 border-gray-300 bg-gray-50", icon: null },
      submitted: { label: "Submitted — Awaiting Review", className: "text-blue-700 border-blue-300 bg-blue-50", icon: null },
      approved: { label: "Approved", className: "text-green-700 border-green-300 bg-green-50", icon: <CheckCircle className="w-3.5 h-3.5 mr-1" /> },
      rejected: { label: "Rejected — Revision Required", className: "text-red-700 border-red-300 bg-red-50", icon: <XCircle className="w-3.5 h-3.5 mr-1" /> },
      flagged: { label: "Flagged — Needs Attention", className: "text-amber-700 border-amber-300 bg-amber-50", icon: <Flag className="w-3.5 h-3.5 mr-1" /> },
    };
    const b = badges[approvalStatus] || badges.draft;
    return (
      <Badge variant="outline" className={`${b.className} flex items-center`} data-testid="badge-approval-status">
        {b.icon}{b.label}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-heading font-semibold">MIAM Record</h3>
          {activeRecord && (
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5" data-testid="text-active-miam-party">
              {activePartyReviewLabel}
            </Badge>
          )}
          {statusBadge()}
          {editRequestMode && <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">Edit Request Mode</Badge>}
          {!effectiveCanEdit && !isFormLocked && !editRequestMode && <Badge variant="outline" className="text-muted-foreground border-muted">Read only</Badge>}
          {isFormLocked && !editRequestMode && <Badge variant="outline" className="text-muted-foreground border-muted">Locked</Badge>}
          {effectiveCanEdit && isDirty && <Badge variant="outline" className="text-amber-600 border-amber-300">Unsaved changes</Badge>}
          {hasPendingEditRequest && <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50" data-testid="badge-pending-edit-request">Edit Requested</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeParty && (
            <Button
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              data-testid="btn-download-miam-pdf"
              size="sm"
              variant="outline"
            >
              {isDownloadingPdf ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              Download PDF
            </Button>
          )}
          {isNonSuperadminStaff && isFormLocked && !editRequestMode && !hasPendingEditRequest && activeRecord && (
            <Button
              onClick={startEditRequestMode}
              data-testid="btn-request-edit"
              size="sm"
              variant="outline"
              className="text-amber-700 border-amber-300 hover:bg-amber-50"
            >
              <Pencil className="w-4 h-4 mr-1" />
              Request Edit
            </Button>
          )}
          {editRequestMode && (
            <Button
              onClick={cancelEditRequestMode}
              size="sm"
              variant="outline"
              data-testid="btn-cancel-edit-request"
            >
              Cancel
            </Button>
          )}
          {editRequestMode && isDirty && (
            <Button
              onClick={() => submitEditRequestMutation.mutate()}
              disabled={submitEditRequestMutation.isPending}
              data-testid="btn-submit-edit-request"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submitEditRequestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Submit Edit Request
            </Button>
          )}
          {isAdminRole && activeRecord && !superadminEditMode && !editAndApproveMode && approvalStatus !== "draft" && (
            <Button
              onClick={() => setSuperadminEditMode(true)}
              data-testid="btn-superadmin-edit"
              size="sm"
              variant="outline"
            >
              <Pencil className="w-4 h-4 mr-1" />
              Edit
            </Button>
          )}
          {effectiveCanEdit && !editRequestMode && !editAndApproveMode && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !isDirty}
              data-testid="btn-save-miam"
              size="sm"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              {isAdminRole && superadminEditMode ? "Save & Approve" : "Save MIAM Record"}
            </Button>
          )}
        </div>
      </div>

      {miamExpiryLabel && (
        <div className={`rounded-md border px-4 py-3 text-sm ${activeMiamValidity?.expired ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-800"}`} data-testid="miam-record-expiry">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">MIAM expiry: {miamExpiryLabel}</span>
            <Badge variant={activeMiamValidity?.expired ? "outline" : "default"}>
              {activeMiamValidity?.expired ? "Expired for court applications" : "Valid for court applications"}
            </Badge>
          </div>
        </div>
      )}

      {approvalStatus === "rejected" && reviewNotesText && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50" data-testid="rejection-notes-banner">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Rejection Notes</p>
            <p className="text-sm text-red-700 mt-0.5">{reviewNotesText}</p>
            {!isAdminRole && (
              <p className="text-xs text-red-600 mt-1">Please review and address the notes above, then save to resubmit.</p>
            )}
          </div>
        </div>
      )}

      {approvalStatus === "flagged" && reviewNotesText && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50" data-testid="flag-notes-banner">
          <Flag className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">Flag Notes</p>
            <p className="text-sm text-amber-700 mt-0.5">{reviewNotesText}</p>
          </div>
        </div>
      )}

      {isAdminRole && activeRecord && ["submitted", "flagged", "rejected"].includes(approvalStatus) && !superadminEditMode && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 flex-wrap" data-testid="superadmin-review-panel">
          <p className="text-sm text-blue-800 font-medium mr-auto">
            {approvalStatus === "submitted" && `${activePartyReviewLabel}’s MIAM record is awaiting your review.`}
            {approvalStatus === "flagged" && `${activePartyReviewLabel}’s MIAM record has been flagged.`}
            {approvalStatus === "rejected" && `${activePartyReviewLabel}’s MIAM record was rejected and may be revised.`}
          </p>
          <Button
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
            data-testid="btn-approve-miam"
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
            Approve
          </Button>
          {approvalStatus !== "rejected" && (
            <Button
              onClick={() => setShowRejectDialog(true)}
              data-testid="btn-reject-miam"
              size="sm"
              variant="destructive"
            >
              <XCircle className="w-4 h-4 mr-1" />
              Reject
            </Button>
          )}
          {approvalStatus === "submitted" && (
            <Button
              onClick={() => setShowFlagDialog(true)}
              data-testid="btn-flag-miam"
              size="sm"
              variant="outline"
              className="text-amber-700 border-amber-300 hover:bg-amber-50"
            >
              <Flag className="w-4 h-4 mr-1" />
              Flag
            </Button>
          )}
        </div>
      )}

      {showRejectDialog && (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 space-y-3" data-testid="reject-dialog">
          <p className="text-sm font-medium text-red-800">Reject MIAM Record</p>
          <Textarea
            placeholder="Enter rejection notes (required)..."
            value={rejectNotes}
            onChange={e => setRejectNotes(e.target.value)}
            data-testid="input-reject-notes"
            className="bg-white"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !rejectNotes.trim()}
              data-testid="btn-confirm-reject"
              size="sm"
              variant="destructive"
            >
              {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Confirm Rejection
            </Button>
            <Button
              onClick={() => { setShowRejectDialog(false); setRejectNotes(""); }}
              size="sm"
              variant="outline"
              data-testid="btn-cancel-reject"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showFlagDialog && (
        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 space-y-3" data-testid="flag-dialog">
          <p className="text-sm font-medium text-amber-800">Flag MIAM Record</p>
          <Textarea
            placeholder="Enter flag notes (optional)..."
            value={flagNotes}
            onChange={e => setFlagNotes(e.target.value)}
            data-testid="input-flag-notes"
            className="bg-white"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => flagMutation.mutate()}
              disabled={flagMutation.isPending}
              data-testid="btn-confirm-flag"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {flagMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Confirm Flag
            </Button>
            <Button
              onClick={() => { setShowFlagDialog(false); setFlagNotes(""); }}
              size="sm"
              variant="outline"
              data-testid="btn-cancel-flag"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {editAndApproveMode && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-purple-200 bg-purple-50" data-testid="edit-and-approve-banner">
          <Pencil className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-purple-800">Edit & Approve Mode</p>
            <p className="text-xs text-purple-700">The proposed changes have been loaded into the form. Modify any fields as needed, then click "Save & Approve" above to apply and approve.</p>
          </div>
        </div>
      )}

      {editRequestMode && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50" data-testid="edit-request-mode-banner">
          <Pencil className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-amber-800">Edit Request Mode</p>
            <p className="text-xs text-amber-700">Make your changes below and add a note explaining the reason. Only the fields you modify will be included in the request.</p>
            <Textarea
              placeholder="Explain why these edits are needed (optional)..."
              value={editRequestNote}
              onChange={e => setEditRequestNote(e.target.value)}
              data-testid="input-edit-request-note"
              className="bg-white text-sm"
              rows={2}
            />
          </div>
        </div>
      )}

      {hasPendingEditRequest && !isSuperadmin && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-purple-200 bg-purple-50" data-testid="pending-edit-request-banner">
          <AlertTriangle className="w-5 h-5 text-purple-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-purple-800">Edit Request Pending</p>
            <p className="text-xs text-purple-700 mt-0.5">
              You have a pending edit request awaiting superadmin review.
              {pendingEditRequest?.requestNote && <span className="block mt-1 italic">Note: {pendingEditRequest.requestNote}</span>}
            </p>
          </div>
        </div>
      )}

      {!hasPendingEditRequest && editRequestFeedback && !isSuperadmin && (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${editRequestFeedback.status === "rejected" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`} data-testid="edit-request-feedback-banner">
          {editRequestFeedback.status === "rejected" ? (
            <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          ) : (
            <Flag className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          )}
          <div>
            <p className={`text-sm font-medium ${editRequestFeedback.status === "rejected" ? "text-red-800" : "text-amber-800"}`}>
              Edit Request {editRequestFeedback.status === "rejected" ? "Rejected" : "Flagged"}
            </p>
            {editRequestFeedback.reviewNotes && (
              <p className={`text-xs mt-0.5 ${editRequestFeedback.status === "rejected" ? "text-red-700" : "text-amber-700"}`}>
                {editRequestFeedback.reviewerName}: {editRequestFeedback.reviewNotes}
              </p>
            )}
            <p className={`text-xs mt-0.5 ${editRequestFeedback.status === "rejected" ? "text-red-600" : "text-amber-600"}`}>
              You can submit a new edit request if needed.
            </p>
          </div>
        </div>
      )}

      {isSuperadmin && hasPendingEditRequest && (
        <div className="space-y-3" data-testid="edit-request-review-section">
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-purple-200 bg-purple-50 flex-wrap">
            <div className="flex-1">
              <p className="text-sm font-medium text-purple-800">
                Edit Request from {pendingEditRequest?.requesterName}
              </p>
              {pendingEditRequest?.requestNote && (
                <p className="text-xs text-purple-700 mt-0.5 italic">"{pendingEditRequest.requestNote}"</p>
              )}
              <p className="text-xs text-purple-600 mt-0.5">
                Submitted {new Date(pendingEditRequest?.requestedAt || "").toLocaleDateString("en-GB")}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => setShowDiffPanel(!showDiffPanel)}
                size="sm"
                variant="outline"
                className="text-purple-700 border-purple-300 hover:bg-purple-100"
                data-testid="btn-toggle-diff-panel"
              >
                {showDiffPanel ? "Hide Changes" : "Review Changes"}
              </Button>
              {!editAndApproveMode && (
                <>
                  <Button
                    onClick={() => approveEditRequestMutation.mutate(undefined)}
                    disabled={approveEditRequestMutation.isPending}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    data-testid="btn-approve-edit-request"
                  >
                    {approveEditRequestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                    Approve
                  </Button>
                  <Button
                    onClick={startEditAndApprove}
                    size="sm"
                    variant="outline"
                    className="text-purple-700 border-purple-300 hover:bg-purple-100"
                    data-testid="btn-edit-and-approve"
                  >
                    <Pencil className="w-4 h-4 mr-1" />
                    Edit & Approve
                  </Button>
                  <Button
                    onClick={() => setShowEditReqRejectDialog(true)}
                    size="sm"
                    variant="destructive"
                    data-testid="btn-reject-edit-request"
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                  <Button
                    onClick={() => setShowEditReqFlagDialog(true)}
                    size="sm"
                    variant="outline"
                    className="text-amber-700 border-amber-300 hover:bg-amber-50"
                    data-testid="btn-flag-edit-request"
                  >
                    <Flag className="w-4 h-4 mr-1" />
                    Flag
                  </Button>
                </>
              )}
              {editAndApproveMode && (
                <>
                  <Button
                    onClick={submitEditAndApprove}
                    disabled={approveEditRequestMutation.isPending}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    data-testid="btn-submit-edit-and-approve"
                  >
                    {approveEditRequestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                    Save & Approve
                  </Button>
                  <Button
                    onClick={cancelEditAndApprove}
                    size="sm"
                    variant="outline"
                    data-testid="btn-cancel-edit-and-approve"
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>

          {showDiffPanel && pendingEditRequest && (
            <div className="rounded-lg border border-purple-200 bg-white overflow-hidden" data-testid="diff-panel">
              <div className="px-4 py-2 bg-purple-50 border-b border-purple-200">
                <p className="text-sm font-medium text-purple-800">Field-Level Changes</p>
              </div>
              <div className="divide-y divide-gray-100">
                {Object.keys(pendingEditRequest.proposedChanges).map(field => (
                  <div key={field} className="px-4 py-3 grid grid-cols-[200px_1fr_1fr] gap-3 items-start text-sm">
                    <div className="font-medium text-gray-700">{FIELD_LABELS[field] || field}</div>
                    <div className="p-2 rounded bg-red-50 border border-red-100">
                      <span className="text-xs font-medium text-red-600 block mb-0.5">Current</span>
                      <span className="text-red-800 text-xs break-words">{formatFieldValue(pendingEditRequest.originalValues[field])}</span>
                    </div>
                    <div className="p-2 rounded bg-green-50 border border-green-100">
                      <span className="text-xs font-medium text-green-600 block mb-0.5">Proposed</span>
                      <span className="text-green-800 text-xs break-words">{formatFieldValue(pendingEditRequest.proposedChanges[field])}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(pendingEditRequest.proposedChanges).length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">No changes detected</div>
                )}
              </div>
            </div>
          )}

          {showEditReqRejectDialog && (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 space-y-3" data-testid="edit-req-reject-dialog">
              <p className="text-sm font-medium text-red-800">Reject Edit Request</p>
              <Textarea
                placeholder="Enter rejection notes (required)..."
                value={editReqRejectNotes}
                onChange={e => setEditReqRejectNotes(e.target.value)}
                data-testid="input-edit-req-reject-notes"
                className="bg-white"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => rejectEditRequestMutation.mutate()}
                  disabled={rejectEditRequestMutation.isPending || !editReqRejectNotes.trim()}
                  data-testid="btn-confirm-reject-edit-request"
                  size="sm"
                  variant="destructive"
                >
                  {rejectEditRequestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Confirm Rejection
                </Button>
                <Button
                  onClick={() => { setShowEditReqRejectDialog(false); setEditReqRejectNotes(""); }}
                  size="sm"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {showEditReqFlagDialog && (
            <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 space-y-3" data-testid="edit-req-flag-dialog">
              <p className="text-sm font-medium text-amber-800">Flag Edit Request</p>
              <Textarea
                placeholder="Enter flag notes (optional)..."
                value={editReqFlagNotes}
                onChange={e => setEditReqFlagNotes(e.target.value)}
                data-testid="input-edit-req-flag-notes"
                className="bg-white"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => flagEditRequestMutation.mutate()}
                  disabled={flagEditRequestMutation.isPending}
                  data-testid="btn-confirm-flag-edit-request"
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {flagEditRequestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Confirm Flag
                </Button>
                <Button
                  onClick={() => { setShowEditReqFlagDialog(false); setEditReqFlagNotes(""); }}
                  size="sm"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {parties.length > 1 && (
        <Tabs value={activeParty} onValueChange={(v) => setActiveParty(v)}>
          <TabsList data-testid="tabs-miam-party">
            {parties.map((p: Party) => (
              <TabsTrigger key={p.id} value={p.id} data-testid={`tab-miam-party-${p.role}`}>
                {partyLabel(p)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Accordion type="multiple" defaultValue={["session-details", "client-details"]} className="space-y-2">

        {/* SECTION 1 — MIAM Record (Session Header) */}
        <AccordionItem value="session-details" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-session-details">
            1. MIAM Record
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {effectiveCanEdit ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {isSuperadmin ? (
                    <FormField label="Mediator">
                      <Select
                        value={selectedSessionMediatorValue}
                        onValueChange={v => updateField("sessionMediator", v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger data-testid="select-session-mediator" className="h-9">
                          <SelectValue placeholder="Select mediator..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unassigned</SelectItem>
                          {sessionMediatorValue && !mediatorOptions.some(m => m.name === sessionMediatorValue) && (
                            <SelectItem value={sessionMediatorValue}>{sessionMediatorValue}</SelectItem>
                          )}
                          {mediatorOptions.map(mediator => (
                            <SelectItem key={mediator.id} value={mediator.name}>{mediator.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  ) : (
                    <ReadOnlyField label="Mediator" value={str(formData.sessionMediator)} />
                  )}
                  <FormField label="Date">
                    <Input
                      type="date"
                      value={str(formData.sessionDate)}
                      max={todayUkDate}
                      onChange={e => {
                        const nextSessionDate = e.target.value > todayUkDate ? todayUkDate : e.target.value;
                        updateField("sessionDate", nextSessionDate);
                      }}
                      data-testid="input-session-date"
                    />
                  </FormField>
                  <FormField label="Time">
                    <Input type="time" value={str(formData.sessionTime)} onChange={e => updateField("sessionTime", e.target.value)} data-testid="input-session-time" />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="Other people present?">
                    <Input value={str(formData.otherPeoplePresent)} onChange={e => updateField("otherPeoplePresent", e.target.value)} data-testid="input-other-people" />
                  </FormField>
                  <FormField label="Case reference">
                    <Input value={str(formData.caseReference)} readOnly className="bg-muted cursor-not-allowed" data-testid="input-case-reference" />
                  </FormField>
                  <FormField label="Type of case">
                    <Select value={str(formData.caseType)} onValueChange={v => updateField("caseType", v)}>
                      <SelectTrigger data-testid="select-case-type" className="h-9">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ISSUE_TYPES.map(type => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ReadOnlyField label="Mediator" value={str(formData.sessionMediator)} />
                  <ReadOnlyField label="Date" value={formatMiamDisplayDate(formData.sessionDate)} />
                  <ReadOnlyField label="Time" value={str(formData.sessionTime)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ReadOnlyField label="Other people present?" value={str(formData.otherPeoplePresent)} />
                  <ReadOnlyField label="Case reference" value={str(formData.caseReference)} />
                  <ReadOnlyField label="Type of case" value={str(formData.caseType)} />
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 2 — Client Information */}
        <AccordionItem value="client-details" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-client-details">
            2. Client Information
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {effectiveCanEdit ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="First Name">
                    <Input value={str(formData.clientFirstName)} onChange={e => updateField("clientFirstName", e.target.value)} data-testid="input-client-first-name" />
                  </FormField>
                  <FormField label="Last Name">
                    <Input value={str(formData.clientLastName)} onChange={e => updateField("clientLastName", e.target.value)} data-testid="input-client-last-name" />
                  </FormField>
                  <FormField label="DOB">
                    <Input type="date" value={str(formData.clientDob)} onChange={e => updateField("clientDob", e.target.value)} data-testid="input-client-dob" />
                  </FormField>
                </div>
                <FormField label="Address">
                  <Input value={str(formData.clientAddress)} onChange={e => updateField("clientAddress", e.target.value)} data-testid="input-client-address" />
                </FormField>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Confirm Telephone">
                    <Input value={str(formData.clientPhone)} onChange={e => updateField("clientPhone", e.target.value)} data-testid="input-client-phone" />
                  </FormField>
                  <FormField label="How did you hear about BFM?">
                    <Input value={str(formData.howHeardAboutBfm)} onChange={e => updateField("howHeardAboutBfm", e.target.value)} data-testid="input-how-heard" />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Occupation">
                    <Input value={str(formData.clientOccupation)} onChange={e => updateField("clientOccupation", e.target.value)} data-testid="input-occupation" />
                  </FormField>
                  <FormField label="Do you consider yourself to have a disability or any accessibility needs you'd like to make us aware of?">
                    <Textarea rows={2} value={str(formData.clientDisability)} onChange={e => updateField("clientDisability", e.target.value)} data-testid="input-disability" />
                  </FormField>
                </div>
                <FormField label="How can we make the process most accessible for you?">
                  <Textarea rows={2} value={str(formData.clientAccessibility)} onChange={e => updateField("clientAccessibility", e.target.value)} data-testid="input-accessibility" />
                </FormField>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Ethnicity (for monitoring purposes only)">
                    <Input value={str(formData.clientEthnicity)} onChange={e => updateField("clientEthnicity", e.target.value)} data-testid="input-ethnicity" />
                  </FormField>
                  <FormField label="Religious/cultural/language needs/considerations? (please specify)">
                    <Input value={str(formData.clientReligiousCulturalNeeds)} onChange={e => updateField("clientReligiousCulturalNeeds", e.target.value)} data-testid="input-religious-needs" />
                  </FormField>
                </div>
                <FormField label="New partner (do you live together?)">
                  <Input value={str(formData.clientNewPartner)} onChange={e => updateField("clientNewPartner", e.target.value)} data-testid="input-new-partner" placeholder="e.g. Yes, living together" />
                </FormField>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ReadOnlyField label="First Name" value={str(formData.clientFirstName)} />
                  <ReadOnlyField label="Last Name" value={str(formData.clientLastName)} />
                  <ReadOnlyField label="DOB" value={formatMiamDisplayDate(formData.clientDob)} />
                </div>
                <ReadOnlyField label="Address" value={str(formData.clientAddress)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ReadOnlyField label="Confirm Telephone" value={str(formData.clientPhone)} />
                  <ReadOnlyField label="How did you hear about BFM?" value={str(formData.howHeardAboutBfm)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ReadOnlyField label="Occupation" value={str(formData.clientOccupation)} />
                  <ReadOnlyField label="Do you consider yourself to have a disability or any accessibility needs you'd like to make us aware of?" value={str(formData.clientDisability)} />
                </div>
                <ReadOnlyField label="How can we make the process most accessible for you?" value={str(formData.clientAccessibility)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ReadOnlyField label="Ethnicity (for monitoring purposes only)" value={str(formData.clientEthnicity)} />
                  <ReadOnlyField label="Religious/cultural/language needs/considerations? (please specify)" value={str(formData.clientReligiousCulturalNeeds)} />
                </div>
                <ReadOnlyField label="New partner (do you live together?)" value={str(formData.clientNewPartner)} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 3 — Introduction */}
        <AccordionItem value="introduction" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-introduction">
            3. Introduction
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <div className="space-y-3 bg-muted/30 rounded-lg p-4 border border-muted">
              <p className="text-sm font-medium">Purpose of meeting / the mediation process</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Confidentiality & exceptions — The mediation process is confidential and without prejudice. Exceptions to confidentiality include: where there is a risk of harm to a child or vulnerable adult; where disclosure is required by law; where the mediator suspects money laundering. (FMC Code of Practice 5.2.1)
              </p>
            </div>
            {effectiveCanEdit ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField label="Purpose of meeting discussed?">
                    <YesNoSelect value={str(formData.introPurposeDiscussed)} onChange={v => updateField("introPurposeDiscussed", v)} id="intro-purpose" />
                  </FormField>
                  <FormField label="Confidentiality & exceptions explained?">
                    <YesNoSelect value={str(formData.introConfidentialityExplained)} onChange={v => updateField("introConfidentialityExplained", v)} id="intro-confidentiality" />
                  </FormField>
                </div>
                <FormField label="Tell me a little bit about what brings you here today? Just a brief outline as I will be asking for more details as we go through">
                  <Textarea rows={4} value={str(formData.introNotes)} onChange={e => updateField("introNotes", e.target.value)} data-testid="input-intro-notes" />
                </FormField>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ReadOnlyField label="Purpose of meeting discussed?" value={formatYesNo(formData.introPurposeDiscussed)} />
                  <ReadOnlyField label="Confidentiality & exceptions explained?" value={formatYesNo(formData.introConfidentialityExplained)} />
                </div>
                <ReadOnlyField label="Tell me a little bit about what brings you here today? Just a brief outline as I will be asking for more details as we go through" value={str(formData.introNotes)} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 4 — Children */}
        <AccordionItem value="children" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-children">
            4. Child/ren's Names
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {children.map((child, idx) => (
              <Card key={idx} className="border-dashed">
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-medium">Child {idx + 1}</CardTitle>
                    {effectiveCanEdit && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeChild(idx)} data-testid={`btn-remove-child-${idx}`}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-3">
                  {effectiveCanEdit ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <FormField label="First Name">
                          <Input value={child.firstName || ""} onChange={e => updateChild(idx, "firstName", e.target.value)} data-testid={`input-child-first-name-${idx}`} />
                        </FormField>
                        <FormField label="Last Name">
                          <Input value={child.lastName || ""} onChange={e => updateChild(idx, "lastName", e.target.value)} data-testid={`input-child-last-name-${idx}`} />
                        </FormField>
                        <FormField label="Date of birth">
                          <Input type="date" value={child.dob} onChange={e => updateChild(idx, "dob", e.target.value)} data-testid={`input-child-dob-${idx}`} />
                        </FormField>
                        <FormField label="Address / place of residence">
                          <Input value={child.residenceAddress || ""} onChange={e => updateChild(idx, "residenceAddress", e.target.value)} data-testid={`input-child-address-${idx}`} />
                        </FormField>
                      </div>
                      <div className="border-t pt-3 mt-2">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Additional details</p>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <FormField label="Age">
                            <Input value={child.age} onChange={e => updateChild(idx, "age", e.target.value)} data-testid={`input-child-age-${idx}`} />
                          </FormField>
                          <FormField label="Gender">
                            <Input value={child.gender} onChange={e => updateChild(idx, "gender", e.target.value)} data-testid={`input-child-gender-${idx}`} />
                          </FormField>
                          <FormField label="Lives with client?">
                            <Input value={child.livesWithClient} onChange={e => updateChild(idx, "livesWithClient", e.target.value)} data-testid={`input-child-lives-${idx}`} />
                          </FormField>
                          <FormField label="Contact Arrangements">
                            <Input value={child.contactArrangements} onChange={e => updateChild(idx, "contactArrangements", e.target.value)} data-testid={`input-child-contact-${idx}`} />
                          </FormField>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <FormField label="School">
                            <Input value={child.school} onChange={e => updateChild(idx, "school", e.target.value)} data-testid={`input-child-school-${idx}`} />
                          </FormField>
                          <FormField label="Notes">
                            <Input value={child.notes} onChange={e => updateChild(idx, "notes", e.target.value)} data-testid={`input-child-notes-${idx}`} />
                          </FormField>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <ReadOnlyField label="First Name" value={child.firstName || child.name || ""} />
                        <ReadOnlyField label="Last Name" value={child.lastName || ""} />
                        <ReadOnlyField label="Date of birth" value={formatMiamDisplayDate(child.dob)} />
                        <ReadOnlyField label="Address / place of residence" value={child.residenceAddress || ""} />
                      </div>
                      <div className="border-t pt-3 mt-2">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Additional details</p>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                          <ReadOnlyField label="Age" value={child.age} />
                          <ReadOnlyField label="Gender" value={child.gender} />
                          <ReadOnlyField label="Lives with client?" value={child.livesWithClient} />
                          <ReadOnlyField label="Contact Arrangements" value={child.contactArrangements} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          <ReadOnlyField label="School" value={child.school} />
                          <ReadOnlyField label="Notes" value={child.notes} />
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
            {effectiveCanEdit && (
              <Button variant="outline" size="sm" onClick={addChild} data-testid="btn-add-child">
                <Plus className="w-4 h-4 mr-1" /> Add Child
              </Button>
            )}
            {!effectiveCanEdit && children.length === 0 && (
              <p className="text-sm text-muted-foreground">No children recorded.</p>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 5 — Other Client's Details (or Stage another party once Party B exists) */}
        <AccordionItem value="other-party" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-other-party">
            {showAddPartyInsteadOfOtherClient ? "5. Stage another party" : "5. Other Client's Details"}
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {showAddPartyInsteadOfOtherClient ? (
              canAddParty && nextRoleLetter ? (
                <div className="space-y-3">
                  {recordId ? (
                    <StagedPartyCard
                      recordId={recordId}
                      caseId={caseId}
                      nextRoleLetter={nextRoleLetter}
                      canStage={effectiveCanEdit}
                      pendingParty={activeRecord ? {
                        userId: activeRecord.pendingPartyUserId,
                        firstName: activeRecord.pendingPartyFirstName,
                        lastName: activeRecord.pendingPartyLastName,
                        email: activeRecord.pendingPartyEmail,
                      } : null}
                    />
                  ) : (
                    <div className="p-3 rounded-md border border-dashed text-center" data-testid="notice-save-first">
                      <p className="text-sm text-muted-foreground">
                        Save this MIAM record first — then you can stage a party here.
                      </p>
                    </div>
                  )}
                </div>
              ) : !nextRoleLetter ? (
                <div className="p-3 rounded-md border border-dashed text-center" data-testid="notice-max-parties">
                  <p className="text-sm text-muted-foreground">
                    The maximum of 26 parties (A–Z) has been reached for this case. No further parties can be added.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-md border border-dashed text-center" data-testid="notice-other-party-replaced">
                  <p className="text-sm text-muted-foreground">
                    Other party details are now captured directly on each party's record.
                  </p>
                </div>
              )
            ) : (
              <>
            {isMiamOnlyMediator && prefill[activeParty]?.otherPartyHasMiamMediator && (
              <p className="text-xs text-muted-foreground italic">Contact details for the other party are not shown as they have their own assigned MIAM mediator.</p>
            )}
            {effectiveCanEdit ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="First Name">
                    <Input value={str(formData.otherClientFirstName)} onChange={e => updateField("otherClientFirstName", e.target.value)} data-testid="input-other-first-name" />
                  </FormField>
                  <FormField label="Last Name">
                    <Input value={str(formData.otherClientLastName)} onChange={e => updateField("otherClientLastName", e.target.value)} data-testid="input-other-last-name" />
                  </FormField>
                  {!(isMiamOnlyMediator && prefill[activeParty]?.otherPartyHasMiamMediator) && (
                    <FormField label="Date of Birth">
                      <Input type="date" value={str(formData.otherClientDob)} onChange={e => updateField("otherClientDob", e.target.value)} data-testid="input-other-dob" />
                    </FormField>
                  )}
                </div>
                {!(isMiamOnlyMediator && prefill[activeParty]?.otherPartyHasMiamMediator) && (
                  <>
                    <FormField label="Address">
                      <Input value={str(formData.otherClientAddress)} onChange={e => updateField("otherClientAddress", e.target.value)} data-testid="input-other-address" />
                    </FormField>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField label="Telephone number">
                        <Input value={str(formData.otherClientPhone)} onChange={e => updateField("otherClientPhone", e.target.value)} data-testid="input-other-phone" />
                      </FormField>
                      <FormField label="Email">
                        <Input value={str(formData.otherClientEmail)} onChange={e => updateField("otherClientEmail", e.target.value)} data-testid="input-other-email" />
                      </FormField>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <ReadOnlyField label="First Name" value={str(formData.otherClientFirstName)} />
                  <ReadOnlyField label="Last Name" value={str(formData.otherClientLastName)} />
                  {!(isMiamOnlyMediator && prefill[activeParty]?.otherPartyHasMiamMediator) && (
                    <ReadOnlyField label="Date of Birth" value={formatMiamDisplayDate(formData.otherClientDob)} />
                  )}
                </div>
                {!(isMiamOnlyMediator && prefill[activeParty]?.otherPartyHasMiamMediator) && (
                  <>
                    <ReadOnlyField label="Address" value={str(formData.otherClientAddress)} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <ReadOnlyField label="Telephone number" value={str(formData.otherClientPhone)} />
                      <ReadOnlyField label="Email" value={str(formData.otherClientEmail)} />
                    </div>
                  </>
                )}
              </>
            )}
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 6 — Marriage and Co-habitation */}
        <AccordionItem value="relationship" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-relationship">
            6. Marriage and Co-habitation
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {effectiveCanEdit ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <FormField label="Married Y/N">
                      <YesNoSelect value={str(formData.married)} onChange={v => updateField("married", v)} id="married" />
                    </FormField>
                    {marriedYes && (
                      <FormField label="Date of marriage">
                        <Input type="date" value={str(formData.dateOfMarriage)} onChange={e => updateField("dateOfMarriage", e.target.value)} data-testid="input-date-marriage" />
                      </FormField>
                    )}
                    <FormField label="Lived together Y/N">
                      <YesNoSelect value={str(formData.livedTogether)} onChange={v => updateField("livedTogether", v)} id="lived-together" />
                    </FormField>
                    {livedTogetherYes && (
                      <FormField label="Date of cohabitation">
                        <Input type="date" value={str(formData.dateOfCohabitation)} onChange={e => updateField("dateOfCohabitation", e.target.value)} data-testid="input-date-cohabitation" />
                      </FormField>
                    )}
                    <FormField label="Date of separation">
                      <Input type="date" value={str(formData.dateOfSeparation)} onChange={e => updateField("dateOfSeparation", e.target.value)} data-testid="input-date-separation" />
                    </FormField>
                    <FormField label="Both parents have PR?">
                      <YesNoSelect value={str(formData.bothParentsPr)} onChange={v => updateField("bothParentsPr", v)} id="both-parents-pr" />
                    </FormField>
                    <FormField label="Is PR an issue?">
                      <YesNoSelect value={str(formData.prIsIssue)} onChange={v => updateField("prIsIssue", v)} id="pr-issue" />
                    </FormField>
                  </div>
                  <div className="space-y-4">
                    {marriedYes && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <FormField label="Divorce started? Y/N">
                            <YesNoSelect value={str(formData.divorceStarted)} onChange={v => updateField("divorceStarted", v)} id="divorce-started" />
                          </FormField>
                          {divorceStartedYes && (
                            <FormField label="Date">
                              <Input type="date" value={str(formData.divorceStartedDate)} onChange={e => updateField("divorceStartedDate", e.target.value)} data-testid="input-divorce-date" />
                            </FormField>
                          )}
                        </div>
                        {divorceStartedYes && (
                          <>
                            <FormField label="Petitioner?">
                              <Input value={str(formData.petitioner)} onChange={e => updateField("petitioner", e.target.value)} data-testid="input-petitioner" />
                            </FormField>
                            <FormField label="Decree Nisi/Conditional order (date)">
                              <Input type="date" value={str(formData.decreeNisiDate)} onChange={e => updateField("decreeNisiDate", e.target.value)} data-testid="input-decree-nisi" />
                            </FormField>
                            <FormField label="Decree Absolute/Final order (date)">
                              <Input type="date" value={str(formData.decreeAbsoluteDate)} onChange={e => updateField("decreeAbsoluteDate", e.target.value)} data-testid="input-decree-absolute" />
                            </FormField>
                          </>
                        )}
                      </>
                    )}
                    <FormField label="Court orders">
                      <Textarea rows={2} value={str(formData.courtOrders)} onChange={e => updateField("courtOrders", e.target.value)} data-testid="input-court-orders" />
                    </FormField>
                    <FormField label="Applications to court?">
                      <Textarea rows={2} value={str(formData.applicationsToCourtText)} onChange={e => updateField("applicationsToCourtText", e.target.value)} data-testid="input-applications-court" />
                    </FormField>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <ReadOnlyField label="Married Y/N" value={formatYesNo(formData.married)} />
                    {marriedYes && <ReadOnlyField label="Date of marriage" value={formatMiamDisplayDate(formData.dateOfMarriage)} />}
                    <ReadOnlyField label="Lived together Y/N" value={formatYesNo(formData.livedTogether)} />
                    {livedTogetherYes && <ReadOnlyField label="Date of cohabitation" value={formatMiamDisplayDate(formData.dateOfCohabitation)} />}
                    <ReadOnlyField label="Date of separation" value={formatMiamDisplayDate(formData.dateOfSeparation)} />
                    <ReadOnlyField label="Both parents have PR?" value={formatYesNo(formData.bothParentsPr)} />
                    <ReadOnlyField label="Is PR an issue?" value={formatYesNo(formData.prIsIssue)} />
                  </div>
                  <div className="space-y-3">
                    {marriedYes && (
                      <>
                        <ReadOnlyField label="Divorce started? Y/N" value={formatYesNo(formData.divorceStarted)} />
                        {divorceStartedYes && (
                          <>
                            <ReadOnlyField label="Divorce started date" value={formatMiamDisplayDate(formData.divorceStartedDate)} />
                            <ReadOnlyField label="Petitioner?" value={str(formData.petitioner)} />
                            <ReadOnlyField label="Decree Nisi/Conditional order (date)" value={formatMiamDisplayDate(formData.decreeNisiDate)} />
                            <ReadOnlyField label="Decree Absolute/Final order (date)" value={formatMiamDisplayDate(formData.decreeAbsoluteDate)} />
                          </>
                        )}
                      </>
                    )}
                    <ReadOnlyField label="Court orders" value={str(formData.courtOrders)} />
                    <ReadOnlyField label="Applications to court?" value={str(formData.applicationsToCourtText)} />
                  </div>
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 7 — Checklist */}
        <AccordionItem value="checklist" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-checklist">
            7. Checklist
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            {CHECKLIST_ITEMS.map(item => {
              if (item.type === "header") {
                return (
                  <div key={item.key} className="pt-2">
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                  </div>
                );
              }
              const val = getItemValue(checklist, item.key);
              const showChecklistNotes = isYesOrNo(val.status);
              return (
                <div key={item.key} className={`border rounded-md p-3 space-y-2 ${item.type === "subItem" ? "ml-6 border-muted bg-muted/20" : ""}`}>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-sm font-medium leading-snug flex-1">{item.label}</span>
                    {effectiveCanEdit ? (
                      <div className="w-28 flex-shrink-0">
                        <YesNoSelect value={val.status} onChange={v => updateChecklistItem(item.key, "status", v)} id={`checklist-${item.key}`} />
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs flex-shrink-0">{formatYesNo(val.status)}</Badge>
                    )}
                  </div>
                  {effectiveCanEdit && showChecklistNotes ? (
                    <Input
                      placeholder="Notes..."
                      value={val.notes}
                      onChange={e => updateChecklistItem(item.key, "notes", e.target.value)}
                      className="h-8 text-xs"
                      data-testid={`notes-checklist-${item.key}`}
                    />
                  ) : val.notes ? (
                    <p className="text-xs text-muted-foreground">{val.notes}</p>
                  ) : null}
                </div>
              );
            })}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 8 — Background Notes and Current Living/Parenting Arrangements */}
        <AccordionItem value="background" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-background">
            8. Background Notes and Current Living/Parenting Arrangements
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {effectiveCanEdit ? (
              <>
                <FormField label="What brings you here today?">
                  <Textarea rows={3} value={str(formData.bgWhatBringsYou)} onChange={e => updateField("bgWhatBringsYou", e.target.value)} data-testid="input-bg-what-brings" />
                </FormField>
                <FormField label="Where does each client / the child/ren live? With whom?">
                  <Textarea rows={3} value={str(formData.bgLivingArrangements)} onChange={e => updateField("bgLivingArrangements", e.target.value)} data-testid="input-bg-living" />
                </FormField>
                <FormField label="The children? Biological and any other relevant children">
                  <Textarea rows={3} value={str(formData.bgChildrenDetails)} onChange={e => updateField("bgChildrenDetails", e.target.value)} data-testid="input-bg-children" />
                </FormField>
                <FormField label="Current contact arrangements?">
                  <Textarea rows={3} value={str(formData.bgContactArrangements)} onChange={e => updateField("bgContactArrangements", e.target.value)} data-testid="input-bg-contact" />
                </FormField>
                <FormField label="Additional background notes">
                  <Textarea rows={4} value={str(formData.backgroundNotes)} onChange={e => updateField("backgroundNotes", e.target.value)} data-testid="input-background-notes" />
                </FormField>
              </>
            ) : (
              <>
                <ReadOnlyField label="What brings you here today?" value={str(formData.bgWhatBringsYou)} />
                <ReadOnlyField label="Where does each client / the child/ren live? With whom?" value={str(formData.bgLivingArrangements)} />
                <ReadOnlyField label="The children? Biological and any other relevant children" value={str(formData.bgChildrenDetails)} />
                <ReadOnlyField label="Current contact arrangements?" value={str(formData.bgContactArrangements)} />
                <ReadOnlyField label="Additional background notes" value={str(formData.backgroundNotes)} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 9 — Welfare of Child/ren and Other Children's Issues */}
        <AccordionItem value="welfare" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-welfare">
            9. Welfare of Child/ren and Other Children's Issues
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <div className="space-y-2 bg-muted/30 rounded-lg p-4 border border-muted">
              <HelperText>
                Are there any concerns about the welfare of any children? Have you contacted, or do you need to contact, any agency in relation to any child? (FMC Code of Practice 7.9)
              </HelperText>
            </div>
            {effectiveCanEdit ? (
              <>
                <FormField label="Any welfare concerns regarding children?">
                  <YesNoSelect value={str(formData.welfareOfChildren)} onChange={v => updateField("welfareOfChildren", v)} id="welfare-children" />
                </FormField>
                <FormField label="Have children's services been involved?">
                  <Textarea rows={2} value={str(formData.welfareChildrensServices)} onChange={e => updateField("welfareChildrensServices", e.target.value)} data-testid="input-welfare-childrens-services" />
                </FormField>
                <FormField label="Are there any safety concerns for any child?">
                  <Textarea rows={2} value={str(formData.welfareSafetyConcerns)} onChange={e => updateField("welfareSafetyConcerns", e.target.value)} data-testid="input-welfare-safety-concerns" />
                </FormField>
                <FormField label="Has any child witnessed conflict or domestic abuse?">
                  <Textarea rows={2} value={str(formData.welfareWitnessedConflict)} onChange={e => updateField("welfareWitnessedConflict", e.target.value)} data-testid="input-welfare-witnessed-conflict" />
                </FormField>
                <FormField label="Has any child sustained injuries or shown behavioural changes?">
                  <Textarea rows={2} value={str(formData.welfareInjuriesBehaviouralChanges)} onChange={e => updateField("welfareInjuriesBehaviouralChanges", e.target.value)} data-testid="input-welfare-injuries" />
                </FormField>
                <FormField label="Any safeguarding plans in place?">
                  <Textarea rows={2} value={str(formData.welfareSafeguardingPlans)} onChange={e => updateField("welfareSafeguardingPlans", e.target.value)} data-testid="input-welfare-safeguarding" />
                </FormField>
                <FormField label="Agency contacted?">
                  <YesNoSelect value={str(formData.welfareAgencyContacted)} onChange={v => updateField("welfareAgencyContacted", v)} id="welfare-agency" />
                </FormField>
                {welfareAgencyContactedYes && (
                  <>
                    <FormField label="Agency Name">
                      <Input value={str(formData.welfareAgencyName)} onChange={e => updateField("welfareAgencyName", e.target.value)} data-testid="input-welfare-agency-name" />
                    </FormField>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField label="Agency Contact Date">
                        <Input type="date" value={str(formData.welfareAgencyDate)} onChange={e => updateField("welfareAgencyDate", e.target.value)} data-testid="input-welfare-date" />
                      </FormField>
                      <FormField label="Agency Contact Time">
                        <Input type="time" value={str(formData.welfareAgencyTime)} onChange={e => updateField("welfareAgencyTime", e.target.value)} data-testid="input-welfare-time" />
                      </FormField>
                    </div>
                  </>
                )}
                <FormField label="Welfare Notes">
                  <Textarea rows={4} value={str(formData.welfareNotes)} onChange={e => updateField("welfareNotes", e.target.value)} data-testid="input-welfare-notes" />
                </FormField>
              </>
            ) : (
              <>
                <ReadOnlyField label="Any welfare concerns regarding children?" value={formatYesNo(formData.welfareOfChildren)} />
                <ReadOnlyField label="Have children's services been involved?" value={str(formData.welfareChildrensServices)} />
                <ReadOnlyField label="Are there any safety concerns for any child?" value={str(formData.welfareSafetyConcerns)} />
                <ReadOnlyField label="Has any child witnessed conflict or domestic abuse?" value={str(formData.welfareWitnessedConflict)} />
                <ReadOnlyField label="Has any child sustained injuries or shown behavioural changes?" value={str(formData.welfareInjuriesBehaviouralChanges)} />
                <ReadOnlyField label="Any safeguarding plans in place?" value={str(formData.welfareSafeguardingPlans)} />
                <ReadOnlyField label="Agency contacted?" value={formatYesNo(formData.welfareAgencyContacted)} />
                {welfareAgencyContactedYes && (
                  <>
                    <ReadOnlyField label="Agency Name" value={str(formData.welfareAgencyName)} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <ReadOnlyField label="Agency Contact Date" value={formatMiamDisplayDate(formData.welfareAgencyDate)} />
                      <ReadOnlyField label="Agency Contact Time" value={str(formData.welfareAgencyTime)} />
                    </div>
                  </>
                )}
                <ReadOnlyField label="Welfare Notes" value={str(formData.welfareNotes)} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 10 — Child Inclusive Mediation */}
        <AccordionItem value="child-inclusive" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-child-inclusive">
            10. Child Inclusive Mediation
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            <div className="space-y-2 bg-muted/30 rounded-lg p-4 border border-muted">
              <p className="text-sm font-medium">All children and young people aged 10 and above SHOULD be offered the opportunity to have their voice heard through Child Inclusive Mediation.</p>
              <HelperText>
                Fees: £100 per parent for 1 hour with specialist mediator. The child's consent will be obtained separately as well as consent from both parents.
              </HelperText>
            </div>
            {effectiveCanEdit ? (
              <>
                <FormField label="Have you explained this option to the client?">
                  <YesNoSelect value={str(formData.childInclusiveExplained)} onChange={v => updateField("childInclusiveExplained", v)} id="child-inclusive-explained" />
                </FormField>
                {childInclusiveExplainedYes && (
                  <>
                    <FormField label="Client's response">
                      <Textarea rows={3} value={str(formData.childInclusiveClientResponse)} onChange={e => updateField("childInclusiveClientResponse", e.target.value)} data-testid="input-child-inclusive-response" />
                    </FormField>
                    <FormField label="Explained to client: Discussions with children are confidential unless safeguarding concerns arise. The child decides what, if anything, is shared with parents.">
                      <YesNoSelect value={str(formData.childInclusiveConfidentialityExplained)} onChange={v => updateField("childInclusiveConfidentialityExplained", v)} id="child-inclusive-confidentiality" />
                    </FormField>
                    <FormField label="Consent agreed by client?">
                      <YesNoSelect value={str(formData.childInclusiveConsentAgreed)} onChange={v => updateField("childInclusiveConsentAgreed", v)} id="child-inclusive-consent" />
                    </FormField>
                    <FormField label="Notes">
                      <Textarea rows={3} value={str(formData.childInclusiveNotes)} onChange={e => updateField("childInclusiveNotes", e.target.value)} data-testid="input-child-inclusive-notes" />
                    </FormField>
                  </>
                )}
              </>
            ) : (
              <>
                <ReadOnlyField label="Have you explained this option to the client?" value={formatYesNo(formData.childInclusiveExplained)} />
                {childInclusiveExplainedYes && (
                  <>
                    <ReadOnlyField label="Client's response" value={str(formData.childInclusiveClientResponse)} />
                    <ReadOnlyField label="Explained to client: Discussions with children are confidential unless safeguarding concerns arise. The child decides what, if anything, is shared with parents." value={formatYesNo(formData.childInclusiveConfidentialityExplained)} />
                    <ReadOnlyField label="Consent agreed by client?" value={formatYesNo(formData.childInclusiveConsentAgreed)} />
                    <ReadOnlyField label="Notes" value={str(formData.childInclusiveNotes)} />
                  </>
                )}
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 11 — Screening for Domestic Abuse/Imbalance of Power and Control */}
        <AccordionItem value="domestic-abuse" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-domestic-abuse">
            11. Screening for Domestic Abuse / Imbalance of Power and Control
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {effectiveCanEdit ? (
              <>
                <FormField label="Have you ever been hurt by or felt scared of your partner/ex-partner or a family member?">
                  <Textarea rows={2} value={str(formData.daHurtOrScared)} onChange={e => updateField("daHurtOrScared", e.target.value)} data-testid="input-da-hurt-scared" />
                </FormField>
                <FormField label="Have the police ever been involved in any incident between you?">
                  <Textarea rows={2} value={str(formData.daPoliceInvolved)} onChange={e => updateField("daPoliceInvolved", e.target.value)} data-testid="input-da-police" />
                </FormField>
                <FormField label="Have you ever been hit, slapped, kicked or otherwise physically hurt?">
                  <Textarea rows={2} value={str(formData.daPhysical)} onChange={e => updateField("daPhysical", e.target.value)} data-testid="input-da-physical" />
                </FormField>
                <FormField label="Has your partner/ex-partner ever tried to control you — e.g. who you see, where you go, what you wear?">
                  <Textarea rows={2} value={str(formData.daPowerControl)} onChange={e => updateField("daPowerControl", e.target.value)} data-testid="input-da-power-control" />
                </FormField>
                <FormField label="Do you feel safe to mediate with the other person?">
                  <Textarea rows={2} value={str(formData.daFeelSafe)} onChange={e => updateField("daFeelSafe", e.target.value)} data-testid="input-da-feel-safe" />
                </FormField>
                <FormField label="Has your partner/ex-partner ever controlled your finances or prevented you from working?">
                  <Textarea rows={2} value={str(formData.daFinancialControl)} onChange={e => updateField("daFinancialControl", e.target.value)} data-testid="input-da-financial-control" />
                </FormField>
                <FormField label="Do you feel you need your partner's/ex-partner's permission to make decisions?">
                  <Textarea rows={2} value={str(formData.daPermissionToDecide)} onChange={e => updateField("daPermissionToDecide", e.target.value)} data-testid="input-da-permission" />
                </FormField>
                <FormField label="Are you afraid of how your partner/ex-partner will react to things you say or do?">
                  <Textarea rows={2} value={str(formData.daAfraidOfReaction)} onChange={e => updateField("daAfraidOfReaction", e.target.value)} data-testid="input-da-afraid-reaction" />
                </FormField>
                <FormField label="Additional screening notes">
                  <Textarea rows={3} value={str(formData.domesticAbuseScreening)} onChange={e => updateField("domesticAbuseScreening", e.target.value)} data-testid="input-da-screening" />
                </FormField>
                <FormField label="Set out any conclusions affecting mediation reached by you and client, including safety measures (e.g. shuttle)">
                  <Textarea rows={3} value={str(formData.domesticAbuseSafetyConclusions)} onChange={e => updateField("domesticAbuseSafetyConclusions", e.target.value)} data-testid="input-da-safety" />
                </FormField>
                <FormField label="Support services information provided">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                    {DA_SUPPORT_SERVICES.map(svc => {
                      const selected: string[] = Array.isArray(formData.domesticAbuseSupportServices) ? formData.domesticAbuseSupportServices : [];
                      const isChecked = selected.includes(svc.key);
                      return (
                        <label key={svc.key} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`da-support-${svc.key}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const updated = isChecked
                                ? selected.filter((k: string) => k !== svc.key)
                                : [...selected, svc.key];
                              updateField("domesticAbuseSupportServices", updated);
                            }}
                            className="rounded border-gray-300"
                          />
                          {svc.label}
                        </label>
                      );
                    })}
                  </div>
                </FormField>
                {Array.isArray(formData.domesticAbuseSupportServices) && formData.domesticAbuseSupportServices.includes("other") && (
                  <FormField label="Other support service">
                    <Input
                      value={str(formData.domesticAbuseSupportServicesOther)}
                      onChange={e => updateField("domesticAbuseSupportServicesOther", e.target.value)}
                      data-testid="input-da-support-other"
                    />
                  </FormField>
                )}
                <FormField label="If domestic abuse disclosed, explained legal aid may be available if evidence meets prescribed requirements — direct to MIAM exemptions">
                  <Textarea rows={2} value={str(formData.domesticAbuseLegalAidInfo)} onChange={e => updateField("domesticAbuseLegalAidInfo", e.target.value)} data-testid="input-da-legal-aid" />
                </FormField>
                <FormField label="Additional notes">
                  <Textarea rows={3} value={str(formData.domesticAbuseNotes)} onChange={e => updateField("domesticAbuseNotes", e.target.value)} data-testid="input-da-notes" />
                </FormField>
              </>
            ) : (
              <>
                <ReadOnlyField label="Have you ever been hurt by or felt scared of your partner/ex-partner or a family member?" value={str(formData.daHurtOrScared)} />
                <ReadOnlyField label="Have the police ever been involved in any incident between you?" value={str(formData.daPoliceInvolved)} />
                <ReadOnlyField label="Have you ever been hit, slapped, kicked or otherwise physically hurt?" value={str(formData.daPhysical)} />
                <ReadOnlyField label="Has your partner/ex-partner ever tried to control you?" value={str(formData.daPowerControl)} />
                <ReadOnlyField label="Do you feel safe to mediate with the other person?" value={str(formData.daFeelSafe)} />
                <ReadOnlyField label="Has your partner/ex-partner ever controlled your finances or prevented you from working?" value={str(formData.daFinancialControl)} />
                <ReadOnlyField label="Do you feel you need your partner's/ex-partner's permission to make decisions?" value={str(formData.daPermissionToDecide)} />
                <ReadOnlyField label="Are you afraid of how your partner/ex-partner will react?" value={str(formData.daAfraidOfReaction)} />
                <ReadOnlyField label="Additional screening notes" value={str(formData.domesticAbuseScreening)} />
                <ReadOnlyField label="Set out any conclusions affecting mediation reached by you and client, including safety measures (e.g. shuttle)" value={str(formData.domesticAbuseSafetyConclusions)} />
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Support services information provided</Label>
                  <div className="flex flex-wrap gap-1">
                    {Array.isArray(formData.domesticAbuseSupportServices) && formData.domesticAbuseSupportServices.length > 0
                      ? formData.domesticAbuseSupportServices.map((key: string) => {
                          const svc = DA_SUPPORT_SERVICES.find(s => s.key === key);
                          const label = key === "other" && formData.domesticAbuseSupportServicesOther
                            ? `Other: ${formData.domesticAbuseSupportServicesOther}`
                            : svc?.label || key;
                          return <Badge key={key} variant="outline" className="text-xs">{label}</Badge>;
                        })
                      : <span className="text-sm text-muted-foreground">—</span>
                    }
                  </div>
                </div>
                <ReadOnlyField label="If domestic abuse disclosed, explained legal aid may be available if evidence meets prescribed requirements — direct to MIAM exemptions" value={str(formData.domesticAbuseLegalAidInfo)} />
                <ReadOnlyField label="Additional notes" value={str(formData.domesticAbuseNotes)} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 12 — Emotional Readiness to Engage and Safety During Mediation */}
        <AccordionItem value="emotional-readiness" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-emotional-readiness">
            12. Emotional Readiness to Engage and Safety During Mediation
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pb-4">
            {effectiveCanEdit ? (
              <>
                <FormField label="Do you feel you can engage on an equal basis with the other person?">
                  <Textarea rows={2} value={str(formData.erEqualBasis)} onChange={e => updateField("erEqualBasis", e.target.value)} data-testid="input-er-equal-basis" />
                </FormField>
                <FormField label="Are you choosing freely to attend mediation?">
                  <Textarea rows={2} value={str(formData.erChoosingFreely)} onChange={e => updateField("erChoosingFreely", e.target.value)} data-testid="input-er-choosing-freely" />
                </FormField>
                <FormField label="Do you feel pressured to attend by anyone?">
                  <Textarea rows={2} value={str(formData.erPressuredToAttend)} onChange={e => updateField("erPressuredToAttend", e.target.value)} data-testid="input-er-pressured" />
                </FormField>
                <FormField label="Do you understand you can withdraw from mediation at any time?">
                  <Textarea rows={2} value={str(formData.erCanWithdraw)} onChange={e => updateField("erCanWithdraw", e.target.value)} data-testid="input-er-can-withdraw" />
                </FormField>
                <FormField label="Would you feel comfortable being in the same (virtual) room as the other person?">
                  <Textarea rows={2} value={str(formData.erSameRoom)} onChange={e => updateField("erSameRoom", e.target.value)} data-testid="input-er-same-room" />
                </FormField>
                <FormField label="Do you have the capacity to engage in mediation? (mental health, substance use, etc.)">
                  <Textarea rows={2} value={str(formData.erCapacity)} onChange={e => updateField("erCapacity", e.target.value)} data-testid="input-er-capacity" />
                </FormField>
                <FormField label="Additional emotional readiness notes">
                  <Textarea rows={3} value={str(formData.emotionalReadiness)} onChange={e => updateField("emotionalReadiness", e.target.value)} data-testid="input-emotional-readiness" />
                </FormField>
                <FormField label="Safety measures discussed:">
                  <HelperText>
                    Consider: shuttle mediation, support person present, breaks during sessions, ground rules for communication
                  </HelperText>
                  <Textarea rows={3} value={str(formData.safetyMeasuresDiscussed)} onChange={e => updateField("safetyMeasuresDiscussed", e.target.value)} data-testid="input-safety-discussed" />
                </FormField>
                <FormField label="Safety measures agreed:">
                  <Textarea rows={3} value={str(formData.safetyMeasuresAgreed)} onChange={e => updateField("safetyMeasuresAgreed", e.target.value)} data-testid="input-safety-agreed" />
                </FormField>
              </>
            ) : (
              <>
                <ReadOnlyField label="Do you feel you can engage on an equal basis with the other person?" value={str(formData.erEqualBasis)} />
                <ReadOnlyField label="Are you choosing freely to attend mediation?" value={str(formData.erChoosingFreely)} />
                <ReadOnlyField label="Do you feel pressured to attend by anyone?" value={str(formData.erPressuredToAttend)} />
                <ReadOnlyField label="Do you understand you can withdraw from mediation at any time?" value={str(formData.erCanWithdraw)} />
                <ReadOnlyField label="Would you feel comfortable being in the same (virtual) room as the other person?" value={str(formData.erSameRoom)} />
                <ReadOnlyField label="Do you have the capacity to engage in mediation?" value={str(formData.erCapacity)} />
                <ReadOnlyField label="Additional emotional readiness notes" value={str(formData.emotionalReadiness)} />
                <ReadOnlyField label="Safety measures discussed:" value={str(formData.safetyMeasuresDiscussed)} />
                <ReadOnlyField label="Safety measures agreed:" value={str(formData.safetyMeasuresAgreed)} />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 13 — Issues for Mediation (X as appropriate) */}
        <AccordionItem value="issues" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-issues">
            13. Issues for Mediation (X as appropriate)
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ISSUES_ITEMS.map(item => {
                const val = getItemValue(issues, item.key);
                const isChecked = val.status === "yes";
                return (
                  <div key={item.key} className="border rounded-md p-3 space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      {effectiveCanEdit ? (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => updateIssueItem(item.key, "status", isChecked ? "" : "yes")}
                          className="rounded border-gray-300 w-4 h-4"
                          data-testid={`checkbox-issue-${item.key}`}
                        />
                      ) : (
                        <span className="w-4 h-4 flex items-center justify-center border rounded text-xs font-bold">{isChecked ? "X" : ""}</span>
                      )}
                      <span className="text-sm font-medium">{item.label}</span>
                    </label>
                    {effectiveCanEdit && item.key === "other" ? (
                      <Input
                        placeholder="Please specify..."
                        value={val.notes}
                        onChange={e => updateIssueItem(item.key, "notes", e.target.value)}
                        className="h-8 text-xs"
                        data-testid={`notes-issue-${item.key}`}
                      />
                    ) : effectiveCanEdit ? (
                      <Input
                        placeholder="Notes..."
                        value={val.notes}
                        onChange={e => updateIssueItem(item.key, "notes", e.target.value)}
                        className="h-8 text-xs"
                        data-testid={`notes-issue-${item.key}`}
                      />
                    ) : val.notes ? (
                      <p className="text-xs text-muted-foreground">{val.notes}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 14 — Would You Like More Information on Any of the Following */}
        <AccordionItem value="further-info" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-further-info">
            14. Would You Like More Information on Any of the Following:
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <HelperText>Please indicate below and one of our team will get back to them.</HelperText>
            {FURTHER_INFO_ITEMS.map(item => {
              const val = getItemValue(furtherInfo, item.key);
              const showFurtherInfoNotes = isYes(val.status);
              return (
                <div key={item.key} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{item.label}</span>
                    {effectiveCanEdit ? (
                      <div className="w-28 flex-shrink-0">
                        <YesNoSelect value={val.status} onChange={v => updateFurtherInfoItem(item.key, "status", v)} id={`further-${item.key}`} />
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs">{formatYesNo(val.status)}</Badge>
                    )}
                  </div>
                  {effectiveCanEdit && showFurtherInfoNotes ? (
                    <Input
                      placeholder="Notes..."
                      value={val.notes}
                      onChange={e => updateFurtherInfoItem(item.key, "notes", e.target.value)}
                      className="h-8 text-xs"
                      data-testid={`notes-further-${item.key}`}
                    />
                  ) : val.notes ? (
                    <p className="text-xs text-muted-foreground">{val.notes}</p>
                  ) : null}
                </div>
              );
            })}
          </AccordionContent>
        </AccordionItem>

        {/* SECTION 15 — Mediator's Checklist */}
        <AccordionItem value="suitability" className="border rounded-lg px-4">
          <AccordionTrigger className="text-sm font-heading font-semibold" data-testid="accordion-suitability">
            15. Mediator's Checklist
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pb-4">
            {effectiveCanEdit ? (
              <>
                <div className="space-y-4">
                  <FormField label="Suitable for mediation? Yes/No and reasons (not to be communicated with clients)">
                    <div className="flex gap-4 items-start">
                      <div className="w-28 flex-shrink-0">
                        <YesNoSelect value={str(formData.suitableForMediation)} onChange={v => updateField("suitableForMediation", v)} id="suitable" />
                      </div>
                      {showSuitabilityReasons && (
                        <Textarea rows={2} value={str(formData.suitabilityReasons)} onChange={e => updateField("suitabilityReasons", e.target.value)} data-testid="input-suitability-reasons" placeholder="Reasons..." className="flex-1" />
                      )}
                    </div>
                  </FormField>
                  <FormField label="Next steps?">
                    <Textarea rows={2} value={str(formData.nextSteps)} onChange={e => updateField("nextSteps", e.target.value)} data-testid="input-next-steps" />
                  </FormField>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField label="Type of mediation?">
                      <Input value={str(formData.mediationType)} onChange={e => updateField("mediationType", e.target.value)} data-testid="input-mediation-type" />
                    </FormField>
                    <FormField label="Agreed with client?">
                      <YesNoSelect value={str(formData.agreedWithClient)} onChange={v => updateField("agreedWithClient", v)} id="agreed-client" />
                    </FormField>
                  </div>
                  <FormField label="MOJ Voucher Applied">
                    <YesNoSelect value={str(formData.mojVoucherApplied)} onChange={v => updateField("mojVoucherApplied", v)} id="moj-voucher-applied" />
                  </FormField>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-semibold mb-3">Documents</p>
                  <div className="space-y-3">
                    <FormField label="OFS required? (inform of fees and payment upfront)">
                      <YesNoSelect value={str(formData.ofsRequired)} onChange={v => updateField("ofsRequired", v)} id="ofs-required" />
                    </FormField>
                    <FormField label="MOU required? (inform of fees)">
                      <YesNoSelect value={str(formData.mouRequired)} onChange={v => updateField("mouRequired", v)} id="mou-required" />
                    </FormField>
                    <FormField label="Statement of child arrangements required? (inform of fees)">
                      <YesNoSelect value={str(formData.statementOfChildArrangements)} onChange={v => updateField("statementOfChildArrangements", v)} id="statement-child" />
                    </FormField>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-semibold mb-3">Professional Practice Consultancy (PPC)</p>
                  <div className="space-y-3">
                    <FormField label="Professional Practice Consultancy discussion required? Y/N">
                      <YesNoSelect value={str(formData.ppcRequired)} onChange={v => updateField("ppcRequired", v)} id="ppc-required" />
                    </FormField>
                    {ppcRequiredYes && (
                      <>
                        <FormField label="Reason for PPC">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                            {PPC_REASON_OPTIONS.map(reason => {
                              const isChecked = ppcReasons.includes(reason);
                              return (
                                <label key={reason} className="flex items-center gap-2 text-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      const updated = isChecked
                                        ? ppcReasons.filter(r => r !== reason)
                                        : [...ppcReasons, reason];
                                      updateField("ppcReason", updated);
                                    }}
                                    className="rounded border-gray-300"
                                  />
                                  {reason}
                                </label>
                              );
                            })}
                          </div>
                        </FormField>
                        {ppcReasons.includes("Other") && (
                          <FormField label="Other PPC reason">
                            <Input
                              value={str(formData.ppcReasonOther)}
                              onChange={e => updateField("ppcReasonOther", e.target.value)}
                              data-testid="input-ppc-reason-other"
                            />
                          </FormField>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField label="PPC discussion date">
                            <Input type="date" value={str(formData.ppcDate)} onChange={e => updateField("ppcDate", e.target.value)} data-testid="input-ppc-date" />
                          </FormField>
                          <FormField label="PPC consultant name">
                            <Input value={str(formData.ppcConsultantName)} onChange={e => updateField("ppcConsultantName", e.target.value)} data-testid="input-ppc-consultant" />
                          </FormField>
                        </div>
                        <FormField label="Key outcomes / guidance">
                          <Textarea rows={3} value={str(formData.ppcOutcomes)} onChange={e => updateField("ppcOutcomes", e.target.value)} data-testid="input-ppc-outcomes" />
                        </FormField>
                      </>
                    )}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="text-sm font-semibold mb-3">Referrals</p>
                  <div className="space-y-3">
                    <FormField label="Referral to CAFCASS/Other">
                      <YesNoSelect value={str(formData.referralToCafcass)} onChange={v => updateField("referralToCafcass", v)} id="referral-cafcass" />
                    </FormField>
                    <FormField label="Referral to children's services (give details)">
                      <div className="flex gap-4 items-start">
                        <div className="w-28 flex-shrink-0">
                          <YesNoSelect value={str(formData.referralToChildrenServices)} onChange={v => updateField("referralToChildrenServices", v)} id="referral-children" />
                        </div>
                        {referralToChildrenServicesYes && (
                          <Textarea rows={2} value={str(formData.referralToChildrenServicesDetails)} onChange={e => updateField("referralToChildrenServicesDetails", e.target.value)} data-testid="input-referral-children-details" placeholder="Details..." className="flex-1" />
                        )}
                      </div>
                    </FormField>
                    {referralToChildrenServicesYes && (
                      <FormField label="Follow up contact with children's services required?">
                        <YesNoSelect value={str(formData.referralFollowUpContact)} onChange={v => updateField("referralFollowUpContact", v)} id="follow-up-contact" />
                      </FormField>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <ReadOnlyField label="Suitable for mediation? Yes/No and reasons (not to be communicated with clients)" value={`${formatYesNo(formData.suitableForMediation)}${showSuitabilityReasons && formData.suitabilityReasons ? ` — ${formData.suitabilityReasons}` : ""}`} />
                  <ReadOnlyField label="Next steps?" value={str(formData.nextSteps)} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ReadOnlyField label="Type of mediation?" value={str(formData.mediationType)} />
                    <ReadOnlyField label="Agreed with client?" value={formatYesNo(formData.agreedWithClient)} />
                  </div>
                  <ReadOnlyField label="MOJ Voucher Applied" value={formatYesNo(formData.mojVoucherApplied)} />
                </div>
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-semibold mb-1">Documents</p>
                  <ReadOnlyField label="OFS required? (inform of fees and payment upfront)" value={formatYesNo(formData.ofsRequired)} />
                  <ReadOnlyField label="MOU required? (inform of fees)" value={formatYesNo(formData.mouRequired)} />
                  <ReadOnlyField label="Statement of child arrangements required? (inform of fees)" value={formatYesNo(formData.statementOfChildArrangements)} />
                </div>
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-semibold mb-1">Professional Practice Consultancy (PPC)</p>
                  <ReadOnlyField label="Professional Practice Consultancy discussion required? Y/N" value={formatYesNo(formData.ppcRequired)} />
                  {ppcRequiredYes && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium text-muted-foreground">Reason for PPC</Label>
                        <div className="flex flex-wrap gap-1">
                          {ppcReasons.length > 0
                            ? ppcReasons.map((r: string) => (
                              <Badge key={r} variant="outline" className="text-xs">
                                {r === "Other" && formData.ppcReasonOther ? `Other: ${formData.ppcReasonOther}` : r}
                              </Badge>
                            ))
                            : <span className="text-sm text-muted-foreground">—</span>
                          }
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <ReadOnlyField label="PPC discussion date" value={str(formData.ppcDate)} />
                        <ReadOnlyField label="PPC consultant name" value={str(formData.ppcConsultantName)} />
                      </div>
                      <ReadOnlyField label="Key outcomes / guidance" value={str(formData.ppcOutcomes)} />
                    </>
                  )}
                </div>
                <div className="border-t pt-4 space-y-3">
                  <p className="text-sm font-semibold mb-1">Referrals</p>
                  <ReadOnlyField label="Referral to CAFCASS/Other" value={formatYesNo(formData.referralToCafcass)} />
                  <ReadOnlyField label="Referral to children's services (give details)" value={`${formatYesNo(formData.referralToChildrenServices)}${referralToChildrenServicesYes && formData.referralToChildrenServicesDetails ? ` — ${formData.referralToChildrenServicesDetails}` : ""}`} />
                  {referralToChildrenServicesYes && <ReadOnlyField label="Follow up contact with children's services required?" value={formatYesNo(formData.referralFollowUpContact)} />}
                </div>
              </>
            )}
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {(activeParty || (effectiveCanEdit && !editRequestMode && !editAndApproveMode)) && (
        <div className="flex items-center justify-end gap-2 pt-4 border-t mt-4">
          {activeParty && (
            <Button
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              data-testid="btn-download-miam-pdf-bottom"
              size="sm"
              variant="outline"
            >
              {isDownloadingPdf ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
              Download PDF
            </Button>
          )}
          {effectiveCanEdit && !editRequestMode && !editAndApproveMode && (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !isDirty}
              data-testid="btn-save-miam-bottom"
              size="sm"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              {isAdminRole && superadminEditMode ? "Save & Approve" : "Save MIAM Record"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
