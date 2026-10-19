import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { OffboardDialog } from "@/components/mediator/offboard-dialog";
import { ServiceScheduleModal, type ServiceScheduleSlotRow, type ServiceScheduleSlotDraft } from "@/components/mediator-service-schedule-modal";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { saveMediatorServiceSchedule } from "@/lib/mediator-service-schedule-save";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ArrowLeft, Save, AlertTriangle, ShieldCheck, Shield, FileText, User, Calendar,
  Briefcase, CreditCard, ClipboardCheck, Plus, Trash2, CheckCircle2, XCircle,
  Clock, MessageSquare, Video, RefreshCw, ExternalLink, HelpCircle,
} from "lucide-react";
import {
  FMC_ACCREDITATION_STATUSES, PANEL_STATUSES, ENGAGEMENT_TYPES,
  TRAINING_TYPES, REFERENCE_STATUSES, COURT_FORM_PACKAGES,
  SEX_OPTIONS, RELIGION_OPTIONS, SEXUAL_ORIENTATION_OPTIONS,
  MEDIATION_CATEGORIES, FAMILY_CASE_SUBTYPES, WORKPLACE_CASE_SUBTYPES,
  CIVIL_CASE_SUBTYPES, COMMERCIAL_CASE_SUBTYPES, OTHER_CASE_SUBTYPES,
  MEDIATOR_SPECIALISMS, GEOGRAPHIC_COVERAGE_PRESETS,
  GENDERS, ETHNIC_ORIGINS, DISABILITY_OPTIONS, COMMON_LANGUAGES, COUNTRIES_OF_BIRTH,
  MEDIATION_ROLE_QUALIFICATIONS, getMediationRoleQualificationLabel,
} from "@shared/schema";
import type {
  MediatorProfile, MediatorCpdEntry, MediatorReference, MediatorTraining,
  MediatorHoliday, MediatorComplaint, MediatorTimebankEntry,
  MediatorConsent, MediatorBioVersion, ServiceType, MediationRoleQualification,
} from "@shared/schema";

const SERVICE_CATEGORY_COLORS: Record<string, string> = {
  "MIAM": "bg-[#a7baa4]/15 text-[#5a7d58] border-[#a7baa4]/30",
  "Mediation": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800",
  "Court & Documentation": "bg-[#dcae96]/15 text-[#b8825a] border-[#dcae96]/30",
  "Packages": "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800",
};

const SERVICE_CATEGORY_ORDER = ["Family", "Workplace", "Civil", "Commercial", "Other", "Packages"];
type MediatorServiceAssignment = {
  serviceTypeId: string;
  mediationRoleQualification: MediationRoleQualification;
};

function groupServicesByCategory(services: ServiceType[]): { category: string; items: ServiceType[] }[] {
  const groups = new Map<string, ServiceType[]>();
  for (const s of services) {
    const arr = groups.get(s.category) ?? [];
    arr.push(s);
    groups.set(s.category, arr);
  }
  Array.from(groups.values()).forEach((arr: ServiceType[]) => arr.sort((a: ServiceType, b: ServiceType) => a.name.localeCompare(b.name)));

  const known: { category: string; items: ServiceType[] }[] = [];
  for (const cat of SERVICE_CATEGORY_ORDER) {
    const items = groups.get(cat);
    if (items && items.length > 0) {
      known.push({ category: cat, items });
      groups.delete(cat);
    }
  }
  const unknown = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({ category, items }));
  return [...known, ...unknown];
}

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const x of b) if (!set.has(x)) return false;
  return true;
}

function getTodayIsoDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fileToDataUrl(file: File): Promise<{ fileName: string; fileData: string; fileMimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      fileData: String(reader.result ?? ""),
      fileMimeType: file.type || "application/octet-stream",
    });
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
import type { MediatorRole, MediatorTab, ExpiryAlert, MandatoryLevel, SectionFieldMeta } from "@shared/mediator-rbac";
import {
  SECTION_A_FIELD_META, canEditField, computeAge, validateSectionA,
  SECTION_B_FIELD_META, SECTION_C_FIELD_META, SECTION_D_FIELD_META,
  SECTION_E_FIELD_META, SECTION_F_FIELD_META, SECTION_G_FIELD_META,
  SECTION_H_FIELD_META, SECTION_I_FIELD_META, validateSectionRequired,
  validateSectionShape, SECTION_C_WTA_REQUIRED_KEYS, isWtaStatus,
  FMC_MIN_CPD_HOURS, validateServiceOfferingRequirements,
  requiresMediatorProfileCompletion, mediatorFieldMandatoryLevel,
  hasPublishableMediatorBio,
  canRequestMediatorField, FIELD_TO_TAB,
} from "@shared/mediator-rbac";
import { getMediatorDetailBackNavigation } from "@shared/mediator-profile-navigation";

// Task #219 — DBS levels accepted by FMC; sourced from BFM spec.
const DBS_LEVELS = ["Basic", "Standard", "Enhanced", "Enhanced with barred lists"] as const;

// Task #217 — Build a `metaFor`/`isMandatory` pair from any section meta
// array, plus an `onSubmit` helper that runs the required-field check and
// surfaces the first issue via a toast (mirroring the Section A pattern in
// ProfileTab). Used by every tab below so the visual asterisk, the
// aria-required attribute, and the save-time block can never drift apart.
function useSectionMeta(meta: SectionFieldMeta[], role: TabProps["role"]) {
  const byKey = useMemo(() => {
    const m: Record<string, MandatoryLevel> = {};
    for (const x of meta) m[x.key] = x.mandatory;
    return m;
  }, [meta]);
  return {
    mandatoryFor: (key: string): MandatoryLevel | undefined => mediatorFieldMandatoryLevel(byKey[key], role, key),
    isMandatory: (key: string): boolean => mediatorFieldMandatoryLevel(byKey[key], role, key) === "Y",
  };
}

function checkRequired(
  meta: SectionFieldMeta[],
  draft: Record<string, unknown>,
  /** Optional predicate that hides conditional rows (e.g. VAT number when
   *  vatRegistered is false). Hidden keys are NEVER required, regardless of
   *  their declared mandatory level. */
  isVisible: (key: string) => boolean = () => true,
  requireComplete = true,
): Record<string, string> {
  const errors: Record<string, string> = {};
  // Required (presence) check.
  for (const m of meta) {
    if (!requireComplete || m.mandatory !== "Y") continue;
    if (!isVisible(m.key)) continue;
    const v = draft[m.key];
    if (typeof v === "boolean") continue;
    const isEmpty =
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) errors[m.key] = `${m.label} is required`;
  }
  // Task #217 — Shape check (URL/date/email/sortcode/etc.). Run shared
  // validator over a draft snapshot filtered to visible keys so a hidden
  // conditional row can't trip format errors.
  const visibleDraft: Record<string, unknown> = {};
  for (const k of Object.keys(draft)) if (isVisible(k)) visibleDraft[k] = draft[k];
  for (const e of validateSectionShape(meta, visibleDraft)) {
    if (!errors[e.field]) errors[e.field] = e.message;
  }
  return errors;
}

// Task #217 — Scope PATCH payloads to keys the user actually changed in this
// tab. The server-side mandatory + shape validators only fire on keys
// present in the patch, so a partial save from (e.g.) the Bio tab must NOT
// carry unrelated null/empty mandatory fields from other tabs that would
// otherwise trip required-field errors. Returns a new object containing only
// the keys whose value differs from the loaded profile.
function diffPatch<T extends Record<string, unknown>>(
  before: Partial<T> | undefined,
  after: Partial<T>,
): Partial<T> {
  const out: Partial<T> = {};
  const eq = (a: unknown, b: unknown) => {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (Array.isArray(a) || Array.isArray(b) || (typeof a === "object" && a !== null) || (typeof b === "object" && b !== null)) {
      try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); } catch { return false; }
    }
    return false;
  };
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (!eq(before?.[k], after[k])) out[k] = after[k];
  }
  return out;
}

type ProfileBundle = {
  profile: Partial<MediatorProfile>;
  expiryAlerts: ExpiryAlert[];
  visibleTabs: MediatorTab[];
};

type Mediator = { id: string; name: string; email: string; role: string; status?: string };

const TAB_LABELS: Record<MediatorTab, string> = {
  profile: "Profile",
  edi: "EDI",
  credentials: "Credentials",
  service_offering: "Service offering",
  bio: "Bio",
  availability: "Availability",
  contracts: "Contracts",
  payment: "Payment",
  compliance: "Compliance",
};

function useProfileQuery(id: string) {
  return useQuery<ProfileBundle>({ queryKey: ["/api/mediators", id, "profile"], enabled: !!id });
}

function useMediator(id: string) {
  const { data } = useQuery<{ data: Mediator[] }>({ queryKey: ["/api/mediators"], enabled: !!id });
  return data?.data.find((m) => m.id === id);
}

// ---------- generic helpers ----------
function asArr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function asStr(v: unknown, d = ""): string { return typeof v === "string" ? v : d; }
function asBool(v: unknown): boolean { return v === true; }
function asNum(v: unknown): string { return v === null || v === undefined ? "" : String(v); }

// ---------- Reusable section editor ----------
// Profile tab carries an extra synthetic `email` field on the draft, mirroring
// the bundle injected by the server. Typing it here removes the need for
// `any` casts in the Section A form.
type ProfileDraft = Partial<MediatorProfile> & { email?: string | null };

function MandatoryMarker({ level }: { level?: MandatoryLevel }) {
  if (!level || level === "Y") {
    return level === "Y"
      ? <span className="ml-1 text-destructive" title="Mandatory" data-testid="marker-mandatory">*</span>
      : null;
  }
  if (level === "Rec") {
    return <span className="ml-2 inline-flex items-center rounded-sm bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium" data-testid="marker-recommended">Recommended</span>;
  }
  if (level === "N") {
    return <span className="ml-2 inline-flex items-center rounded-sm bg-muted text-muted-foreground px-1.5 py-0.5 text-[10px] font-medium" data-testid="marker-optional">Optional</span>;
  }
  if (level === "Auto") {
    return <span className="ml-2 inline-flex items-center rounded-sm bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 px-1.5 py-0.5 text-[10px] font-medium" data-testid="marker-auto">Auto</span>;
  }
  return null;
}

function FieldRow({
  label, children, hint, mandatory, error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  mandatory?: MandatoryLevel;
  error?: string;
}) {
  // Task #217 — Every metadata-driven row carries an explicit aria-required
  // boolean on the input wrapper (role="group"), so screen-reader users hear
  // the required state even when the inner control is a Switch / multi-check
  // or other non-native element. Rows with no mandatory metadata stay silent.
  const ariaReq = mandatory === undefined ? undefined : mandatory === "Y";
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4 py-2">
      <Label className="md:pt-2 text-sm font-medium text-muted-foreground flex items-start">
        <span>{label}</span>
        <MandatoryMarker level={mandatory} />
      </Label>
      <div
        className="md:col-span-2"
        {...(ariaReq !== undefined ? { role: "group", "aria-required": ariaReq, "aria-label": label } : {})}
      >
        {children}
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
        {error && <p className="text-xs text-destructive mt-1" data-testid="text-field-error">{error}</p>}
      </div>
    </div>
  );
}

function MultiCheck({ value, options, onChange, testId }: { value: string[]; options: readonly string[]; onChange: (v: string[]) => void; testId?: string }) {
  const set = new Set(value);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid={testId}>
      {options.map((opt) => (
        <label key={opt} className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={set.has(opt)}
            onCheckedChange={(c) => {
              const next = new Set(value);
              if (c) next.add(opt); else next.delete(opt);
              onChange(Array.from(next));
            }}
          />
          <span>{opt}</span>
        </label>
      ))}
    </div>
  );
}

// Generic so the Profile tab can extend the draft shape with synthetic fields
// (e.g. `email`, which lives on `users` not `mediator_profiles`). All other
// tabs still get strong typing against MediatorProfile by default.
function useSectionForm<T extends Record<string, unknown> = MediatorProfile>(initial: Partial<T>) {
  const [draft, setDraft] = useState<Partial<T>>(initial);
  const set = <K extends keyof T>(k: K, v: T[K]) =>
    setDraft((p) => ({ ...p, [k]: v }));
  return { draft, set, setDraft };
}

function SaveBar({ canEdit, isPending, onSave, onReset }: { canEdit: boolean; isPending: boolean; onSave: () => void; onReset: () => void }) {
  if (!canEdit) return null;
  return (
    <div className="flex justify-end gap-2 pt-4 border-t mt-4">
      <Button variant="ghost" onClick={onReset} disabled={isPending} data-testid="button-reset">Reset</Button>
      <Button onClick={onSave} disabled={isPending} data-testid="button-save">
        <Save className="w-4 h-4 mr-2" />{isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

type ProfileChangeRequest = {
  id: string;
  field: string;
  proposedValue: unknown;
  status: string;
  submittedAt: string;
  reviewNote: string | null;
};

const REVIEW_META = [SECTION_A_FIELD_META, SECTION_B_FIELD_META, SECTION_C_FIELD_META, SECTION_D_FIELD_META,
  SECTION_E_FIELD_META, SECTION_F_FIELD_META, SECTION_G_FIELD_META, SECTION_I_FIELD_META].flat();

function ProfileChangeRequests({ id, tab, role, actorId, profile }: {
  id: string; tab: MediatorTab; role: "superadmin" | "subadmin" | "mediator" | "client" | "contractor";
  actorId: string; profile: Partial<MediatorProfile>;
}) {
  const { toast } = useToast();
  const [field, setField] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [note, setNote] = useState("");
  const { data: requests = [] } = useQuery<ProfileChangeRequest[]>({
    queryKey: ["/api/mediators", id, "change-requests"],
    queryFn: async () => { const response = await fetch(`/api/mediators/${id}/change-requests`, { credentials: "include" }); if (!response.ok) throw new Error("Could not load requests"); return response.json(); },
  });
  const eligible = REVIEW_META.filter((meta) => FIELD_TO_TAB[meta.key] === tab && canRequestMediatorField(meta.key, actorId, id));
  const submit = useMutation({
    mutationFn: async () => {
      if (!field) throw new Error("Choose a field");
      const currentValue = (profile as Record<string, unknown>)[field];
      let proposedValue: unknown = rawValue.trim();
      if (typeof currentValue === "boolean") proposedValue = rawValue.trim().toLowerCase() === "true";
      else if (typeof currentValue === "number") proposedValue = Number(rawValue);
      else if (Array.isArray(currentValue) || (currentValue && typeof currentValue === "object")) proposedValue = JSON.parse(rawValue);
      await apiRequest("POST", `/api/mediators/${id}/change-requests`, { field, proposedValue });
    },
    onSuccess: () => { setField(""); setRawValue(""); void queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "change-requests"] }); toast({ title: "Change submitted for review" }); },
    onError: (error: Error) => toast({ title: "Could not submit change", description: error.message, variant: "destructive" }),
  });
  const review = useMutation({
    mutationFn: async ({ requestId, decision }: { requestId: string; decision: "approved" | "rejected" }) => {
      await apiRequest("POST", `/api/mediators/${id}/change-requests/${requestId}/review`, { decision, note });
    },
    onSuccess: () => { setNote(""); void queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "change-requests"] }); void queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "profile"] }); toast({ title: "Review saved" }); },
    onError: (error: Error) => toast({ title: "Could not review change", description: error.message, variant: "destructive" }),
  });
  const tabRequests = requests.filter((request) => request.field === "profilePhotoUrl" ? tab === "profile" : FIELD_TO_TAB[request.field] === tab);
  if (eligible.length === 0 && tabRequests.length === 0) return null;
  return <Card className="mt-4"><CardHeader><CardTitle className="text-base">Change requests</CardTitle><CardDescription>Mediator changes to staff-controlled details are reviewed before they are applied.</CardDescription></CardHeader><CardContent className="space-y-4">
    {role === "mediator" && eligible.length > 0 && <div className="space-y-2 rounded-md border p-3">
      <Select value={field} onValueChange={(value) => { setField(value); const current = (profile as Record<string, unknown>)[value]; setRawValue(current == null ? "" : typeof current === "string" ? current : JSON.stringify(current)); }}><SelectTrigger><SelectValue placeholder="Choose a detail to update" /></SelectTrigger><SelectContent>{eligible.map((meta) => <SelectItem key={meta.key} value={meta.key}>{meta.label}</SelectItem>)}</SelectContent></Select>
      {field && <><Textarea aria-label="Proposed value" value={rawValue} onChange={(event) => setRawValue(event.target.value)} /><p className="text-xs text-muted-foreground">For lists or structured values, use JSON. The change is checked before approval.</p><Button disabled={submit.isPending} onClick={() => submit.mutate()}>Submit for review</Button></>}
    </div>}
    {tabRequests.map((request) => <div key={request.id} className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex items-center justify-between"><strong>{REVIEW_META.find((meta) => meta.key === request.field)?.label || (request.field === "profilePhotoUrl" ? "Profile picture" : request.field)}</strong><Badge variant="outline">{request.status}</Badge></div>
      <p className="break-all">Proposed: {request.field === "profilePhotoUrl" && typeof request.proposedValue === "string" ? <img src={request.proposedValue} alt="Proposed profile" className="h-16 w-16 rounded-full object-cover" /> : JSON.stringify(request.proposedValue)}</p>
      {request.reviewNote && <p>Review note: {request.reviewNote}</p>}
      {request.status === "pending" && (role === "superadmin" || role === "subadmin") && <div className="space-y-2"><Input placeholder="Review note (optional)" aria-label="Review note" value={note} onChange={(event) => setNote(event.target.value)} /><div className="flex gap-2"><Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, decision: "approved" })}>Approve</Button><Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, decision: "rejected" })}>Reject</Button></div></div>}
    </div>)}
  </CardContent></Card>;
}

// ---------- Main page ----------
export default function MediatorDetailPage() {
  const [, params] = useRoute<{ id: string }>("/mediators/:id");
  const [location] = useLocation();
  const id = params?.id || "";
  const { user } = useAuth();
  const role = (user?.role || "client") as "superadmin" | "subadmin" | "mediator" | "client" | "contractor";
  const backNavigation = getMediatorDetailBackNavigation(role);
  const { data, isLoading } = useProfileQuery(id);
  const mediator = useMediator(id);
  const [tab, setTab] = useState<MediatorTab>("profile");
  const queryParams = useMemo(() => new URLSearchParams(location.split("?")[1] ?? ""), [location]);
  const requestedTab = queryParams.get("tab") as MediatorTab | null;
  const focusSection = queryParams.get("section");
  const focusServiceTypeId = queryParams.get("serviceTypeId");

  useEffect(() => {
    if (!data) return;
    if (requestedTab && data.visibleTabs.includes(requestedTab)) {
      setTab(requestedTab);
    }
  }, [data, requestedTab]);

  if (isLoading) {
    return <div className="p-6 space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-96" /></div>;
  }
  if (!data) {
    return (
      <div className="p-6">
        <Link href={backNavigation.href}><Button variant="ghost"><ArrowLeft className="w-4 h-4 mr-2" />Back to {backNavigation.label}</Button></Link>
        <p className="mt-4 text-muted-foreground">Mediator not found or access denied.</p>
      </div>
    );
  }
  const visible = data.visibleTabs;
  const displayName = `${asStr(data.profile.firstName)} ${asStr(data.profile.lastName)}`.trim() || mediator?.name || "Mediator";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={backNavigation.href}>
            <Button variant="ghost" size="sm" data-testid="button-back-to-mediators">
              <ArrowLeft className="w-4 h-4 mr-2" />{backNavigation.label}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-heading font-semibold" data-testid="text-mediator-name">{displayName}</h1>
            <p className="text-sm text-muted-foreground">{mediator?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.profile.panelStatus && (
            <Badge variant="outline" data-testid="badge-panel-status">{data.profile.panelStatus}</Badge>
          )}
          {data.profile.fmcAccreditationStatus && (
            <Badge variant="secondary">{data.profile.fmcAccreditationStatus}</Badge>
          )}
        </div>
      </div>

      {/* Off-boarded banner — visible the moment a mediator is off-boarded */}
      {data.profile.panelStatus === "Off-boarded" && (
        <Alert variant="destructive" data-testid="alert-offboarded">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This mediator has been off-boarded</AlertTitle>
          <AlertDescription>
            {data.profile.offboardingDate ? `Off-boarded on ${data.profile.offboardingDate}. ` : ""}
            {data.profile.offboardingReason || data.profile.panelStatusReason || "All open cases were reassigned and the user account is inactive."}
          </AlertDescription>
        </Alert>
      )}

      {/* Expiry alerts strip */}
      {data.expiryAlerts.length > 0 && (
        <Alert variant="destructive" data-testid="alert-expiries">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Expiring or expired credentials</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 mt-1 space-y-0.5 text-sm">
              {data.expiryAlerts.map((a) => (
                <li key={a.field}>
                  <strong>{a.label}:</strong> {a.expired ? `expired ${Math.abs(a.daysUntil)} day(s) ago` : `expires in ${a.daysUntil} day(s)`} ({a.date})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as MediatorTab)}>
        <TabsList className="flex-wrap h-auto">
          {visible.map((t) => (
            <TabsTrigger key={t} value={t} data-testid={`tab-${t}`}>{TAB_LABELS[t]}</TabsTrigger>
          ))}
        </TabsList>

        {visible.includes("profile") && <TabsContent value="profile"><ProfileTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("edi") && <TabsContent value="edi"><EdiTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("credentials") && <TabsContent value="credentials"><CredentialsTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("service_offering") && (
          <TabsContent value="service_offering">
            <ServiceOfferingTab
              id={id}
              bundle={data}
              role={role}
              actorId={user?.id || ""}
              focusSection={focusSection}
              focusServiceTypeId={focusServiceTypeId}
            />
          </TabsContent>
        )}
        {visible.includes("bio") && <TabsContent value="bio"><BioTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("availability") && <TabsContent value="availability"><AvailabilityTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("contracts") && <TabsContent value="contracts"><ContractsTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("payment") && <TabsContent value="payment"><PaymentTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
        {visible.includes("compliance") && <TabsContent value="compliance"><ComplianceTab id={id} bundle={data} role={role} actorId={user?.id || ""} /></TabsContent>}
      </Tabs>
      <ProfileChangeRequests id={id} tab={tab} role={role} actorId={user?.id || ""} profile={data.profile} />
    </div>
  );
}

// ---------- Shared mutation hook ----------
function useProfilePatch(id: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (patch: Partial<MediatorProfile>) =>
      apiRequest("PATCH", `/api/mediators/${id}/profile`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "profile"] });
      toast({ title: "Saved", description: "Mediator profile updated." });
    },
    onError: (e: unknown) => toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }),
  });
}

type TabProps = {
  id: string;
  bundle: ProfileBundle;
  role: MediatorRole;
  actorId: string;
  focusSection?: string | null;
  focusServiceTypeId?: string | null;
};

// =====================================================
// Profile tab (Section A)
// =====================================================
const SECTION_A_META_BY_KEY: Record<string, MandatoryLevel> = SECTION_A_FIELD_META.reduce(
  (acc, m) => { acc[m.key] = m.mandatory; return acc; },
  {} as Record<string, MandatoryLevel>,
);
function sectionAMandatoryFor(key: string): MandatoryLevel | undefined {
  return SECTION_A_META_BY_KEY[key];
}

function ProfileTab({ id, bundle, role, actorId }: TabProps) {
  const { profile } = bundle;
  // Profile includes a synthetic `email` field injected by the server
  // (mediator-profile.service.ts). We store it on the same draft so a single
  // PATCH carries every Section A field.
  const initial: ProfileDraft = profile as ProfileDraft;
  const { draft, set, setDraft } = useSectionForm<ProfileDraft>(initial);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mediatorRole = (role as "superadmin" | "subadmin" | "mediator" | "client" | "contractor");
  const canEdit = (field: string) => canEditField(field, mediatorRole, actorId, id);
  const canEditAny = ["firstName", "lastName", "email", "mobilePhone", "profilePhotoUrl"].some(canEdit);
  const isSuperadmin = role === "superadmin";
  const mandatoryFor = (key: string) => mediatorFieldMandatoryLevel(sectionAMandatoryFor(key), role, key);

  // Driven from SECTION_A_FIELD_META — used for both `aria-required` on the
  // inputs and the mandatory enforcement loop in onSave. Kept in one place so
  // the visual asterisk, the assistive-tech hint, and the save-time validation
  // can never drift apart.
  const isMandatory = (key: string): boolean => mandatoryFor(key) === "Y";

  // Auto-calculate age from DOB as the admin edits. Pure derivation — never
  // stored on the profile; the spec marks "Age" as Auto.
  const age = computeAge(asStr(draft.dateOfBirth) || null);

  const onSave = () => {
    // Mandatory check — driven directly from SECTION_A_FIELD_META so the
    // visible asterisks and the save-time validation can never drift apart.
    // We only block on fields the current actor can actually edit; if a field
    // is admin-only and a mediator is saving, the absence isn't their problem.
    // Booleans (e.g. profilePhotoApproved) are always "set" — the marker is
    // shown to highlight that an approval decision must be recorded, but the
    // default `false` value counts as a valid decision and never blocks save.
    const mandatoryErrors: Record<string, string> = {};
    const d = draft as Record<string, unknown>;
    for (const meta of SECTION_A_FIELD_META) {
      if (mandatoryFor(meta.key) !== "Y") continue;
      if (meta.key === "age") continue; // Auto-derived, never required input.
      if (!canEdit(meta.key)) continue;
      const v = d[meta.key];
      if (typeof v === "boolean") continue;
      const isEmpty =
        v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      if (isEmpty) {
        mandatoryErrors[meta.key] = `${meta.label} is required`;
      }
    }

    // Shape validation reuses the shared validator so client + server stay in sync.
    const shape = validateSectionA(d);
    for (const s of shape) {
      if (canEdit(s.field) && !mandatoryErrors[s.field]) mandatoryErrors[s.field] = s.message;
    }

    if (Object.keys(mandatoryErrors).length > 0) {
      setErrors(mandatoryErrors);
      toast({
        title: "Please fix the highlighted fields",
        description: Object.values(mandatoryErrors)[0],
        variant: "destructive",
      });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };

  // Phone-code defaults must not be sent as `+44` when the row is otherwise
  // empty — leave it to the input default.
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><User className="w-5 h-5" />Personal identity</CardTitle>
        <CardDescription>
          Section A — basic identity, contact, and emergency details. Fields marked <span className="text-destructive">*</span> are mandatory.
          DOB and next of kin are visible to superadmins only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldRow label="First name" mandatory={mandatoryFor("firstName")} error={errors.firstName}>
          <Input value={asStr(draft.firstName)} disabled={!canEdit("firstName")} maxLength={100} aria-required={isMandatory("firstName")} onChange={(e) => set("firstName", e.target.value)} data-testid="input-first-name" />
        </FieldRow>
        <FieldRow label="Middle name" mandatory={mandatoryFor("middleName")} error={errors.middleName}>
          <Input value={asStr(draft.middleName)} disabled={!canEdit("middleName")} maxLength={100} aria-required={isMandatory("middleName")} onChange={(e) => set("middleName", e.target.value)} data-testid="input-middle-name" />
        </FieldRow>
        <FieldRow label="Last name" mandatory={mandatoryFor("lastName")} error={errors.lastName}>
          <Input value={asStr(draft.lastName)} disabled={!canEdit("lastName")} maxLength={100} aria-required={isMandatory("lastName")} onChange={(e) => set("lastName", e.target.value)} data-testid="input-last-name" />
        </FieldRow>
        <FieldRow label="Preferred display name" mandatory={mandatoryFor("preferredDisplayName")} error={errors.preferredDisplayName}>
          <Input value={asStr(draft.preferredDisplayName)} disabled={!canEdit("preferredDisplayName")} maxLength={100} aria-required={isMandatory("preferredDisplayName")} onChange={(e) => set("preferredDisplayName", e.target.value)} data-testid="input-display-name" />
        </FieldRow>

        {isSuperadmin && (
          <FieldRow label="Date of birth" mandatory={mandatoryFor("dateOfBirth")} hint="Visible to superadmins only" error={errors.dateOfBirth}>
            <Input type="date" value={asStr(draft.dateOfBirth)} aria-required={isMandatory("dateOfBirth")} onChange={(e) => set("dateOfBirth", e.target.value)} data-testid="input-dob" />
          </FieldRow>
        )}
        {isSuperadmin && (
          <FieldRow label="Age" mandatory="Auto" hint="Auto-calculated from date of birth.">
            <div className="text-sm" data-testid="text-age">{age !== null ? `${age} years` : "—"}</div>
          </FieldRow>
        )}

        <FieldRow label="Profile photo URL" mandatory={mandatoryFor("profilePhotoUrl")} error={errors.profilePhotoUrl}>
          <Input value={asStr(draft.profilePhotoUrl)} disabled={!canEdit("profilePhotoUrl")} aria-required={isMandatory("profilePhotoUrl")} onChange={(e) => set("profilePhotoUrl", e.target.value)} placeholder="https://…" data-testid="input-photo-url" />
          {role === "mediator" && <Link href="/my-profile" className="mt-1 block text-sm text-primary underline">Upload a new profile picture</Link>}
          {asStr(draft.profilePhotoUrl) && (
            <img src={asStr(draft.profilePhotoUrl)} alt="Profile preview" className="mt-2 h-20 w-20 rounded-full object-cover border" data-testid="img-photo-preview" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          )}
        </FieldRow>
        {/* Photo approval is a subadmin/superadmin-only control. Mediators
            shouldn't see the toggle at all (the field is staff-edit per
            FIELD_OVERRIDES), so the row is only rendered for staff. */}
        {(role === "superadmin" || role === "subadmin") && (
          <FieldRow label="Photo approved" mandatory={mandatoryFor("profilePhotoApproved")} hint="Subadmin or superadmin must approve before the photo appears on the public bio.">
            <Switch checked={asBool(draft.profilePhotoApproved)} disabled={!canEdit("profilePhotoApproved")} aria-required={isMandatory("profilePhotoApproved")} onCheckedChange={(v) => set("profilePhotoApproved", v)} data-testid="switch-photo-approved" />
          </FieldRow>
        )}

        <Separator className="my-4" />

        <FieldRow label="Email (primary)" mandatory={mandatoryFor("email")} hint="Used for login and notifications." error={errors.email}>
          <Input
            type="email"
            value={asStr(draft.email)}
            disabled={!canEdit("email")}
            aria-required={isMandatory("email")}
            onChange={(e) => set("email", e.target.value)}
            data-testid="input-email"
          />
        </FieldRow>
        <FieldRow label="Mobile phone" mandatory={mandatoryFor("mobilePhone")} error={errors.mobilePhone}>
          <div className="flex gap-2">
            <Input className="w-20" value={asStr(draft.mobilePhoneCode, "+44")} disabled={!canEdit("mobilePhoneCode")} onChange={(e) => set("mobilePhoneCode", e.target.value)} data-testid="input-mobile-code" />
            <Input value={asStr(draft.mobilePhone)} disabled={!canEdit("mobilePhone")} aria-required={isMandatory("mobilePhone")} onChange={(e) => set("mobilePhone", e.target.value)} data-testid="input-mobile" />
          </div>
        </FieldRow>
        <FieldRow label="Additional phone" mandatory={mandatoryFor("additionalPhone")} error={errors.additionalPhone}>
          <div className="flex gap-2">
            <Input className="w-20" value={asStr(draft.additionalPhoneCode, "+44")} disabled={!canEdit("additionalPhoneCode")} onChange={(e) => set("additionalPhoneCode", e.target.value)} data-testid="input-additional-code" />
            <Input value={asStr(draft.additionalPhone)} disabled={!canEdit("additionalPhone")} aria-required={isMandatory("additionalPhone")} onChange={(e) => set("additionalPhone", e.target.value)} data-testid="input-additional-phone" />
          </div>
        </FieldRow>
        <FieldRow label="Address line 1" mandatory={mandatoryFor("addressLine1")} error={errors.addressLine1}>
          <Input value={asStr(draft.addressLine1)} disabled={!canEdit("addressLine1")} aria-required={isMandatory("addressLine1")} onChange={(e) => set("addressLine1", e.target.value)} data-testid="input-address-1" />
        </FieldRow>
        <FieldRow label="Address line 2" mandatory={mandatoryFor("addressLine2")} error={errors.addressLine2}>
          <Input value={asStr(draft.addressLine2)} disabled={!canEdit("addressLine2")} aria-required={isMandatory("addressLine2")} onChange={(e) => set("addressLine2", e.target.value)} data-testid="input-address-2" />
        </FieldRow>
        <FieldRow label="Town / city" mandatory={mandatoryFor("city")} error={errors.city}>
          <Input value={asStr(draft.city)} disabled={!canEdit("city")} aria-required={isMandatory("city")} onChange={(e) => set("city", e.target.value)} data-testid="input-city" />
        </FieldRow>
        <FieldRow label="Postcode" mandatory={mandatoryFor("postcode")} error={errors.postcode}>
          <Input value={asStr(draft.postcode)} disabled={!canEdit("postcode")} aria-required={isMandatory("postcode")} onChange={(e) => set("postcode", e.target.value)} data-testid="input-postcode" />
        </FieldRow>
        <FieldRow label="Country" mandatory={mandatoryFor("country")} error={errors.country}>
          <Input value={asStr(draft.country, "United Kingdom")} disabled={!canEdit("country")} aria-required={isMandatory("country")} onChange={(e) => set("country", e.target.value)} data-testid="input-country" />
        </FieldRow>

        {isSuperadmin && (
          <>
            <Separator className="my-4" />
            <p className="text-sm font-medium text-muted-foreground">Next of kin (superadmin-only)</p>
            <FieldRow label="Name" mandatory={mandatoryFor("nextOfKinName")} error={errors.nextOfKinName}>
              <Input value={asStr(draft.nextOfKinName)} aria-required={isMandatory("nextOfKinName")} onChange={(e) => set("nextOfKinName", e.target.value)} data-testid="input-nok-name" />
            </FieldRow>
            <FieldRow label="Phone" mandatory={mandatoryFor("nextOfKinPhone")} error={errors.nextOfKinPhone}>
              <Input value={asStr(draft.nextOfKinPhone)} aria-required={isMandatory("nextOfKinPhone")} onChange={(e) => set("nextOfKinPhone", e.target.value)} data-testid="input-nok-phone" />
            </FieldRow>
            <FieldRow label="Relationship" mandatory={mandatoryFor("nextOfKinRelationship")} error={errors.nextOfKinRelationship}>
              <Input value={asStr(draft.nextOfKinRelationship)} aria-required={isMandatory("nextOfKinRelationship")} onChange={(e) => set("nextOfKinRelationship", e.target.value)} data-testid="input-nok-rel" />
            </FieldRow>
          </>
        )}

        <SaveBar canEdit={canEditAny} isPending={patch.isPending} onSave={onSave} onReset={() => { setDraft(initial); setErrors({}); }} />
      </CardContent>
    </Card>
  );
}

// =====================================================
// EDI tab (Section B)
// =====================================================
function EdiTab({ id, bundle, role }: TabProps) {
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_B_FIELD_META, role);
  const canEdit = role === "superadmin" || role === "mediator";
  const isAggregateOnly = role === "subadmin";
  const showGenderSelf = asStr(draft.ediGenderIdentity) === "Self-describe";
  const showEthnicitySelf = /self[- ]?describe/i.test(asStr(draft.ediEthnicity));
  const onSave = () => {
    const errs = checkRequired(SECTION_B_FIELD_META, draft as Record<string, unknown>, undefined, requiresMediatorProfileCompletion(role));
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };

  const aggregate = useQuery<Record<string, Record<string, number>>>({
    queryKey: ["/api/mediators/edi/aggregate"],
    enabled: isAggregateOnly,
  });

  if (isAggregateOnly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>EDI aggregate</CardTitle>
          <CardDescription>Subadmins see anonymised aggregate counts only — no individual EDI data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!aggregate.data && <Skeleton className="h-32" />}
          {aggregate.data && Object.entries(aggregate.data).map(([field, counts]) => (
            <div key={field}>
              <h4 className="text-sm font-medium mb-1">{field.replace(/^edi/, "").replace(/([A-Z])/g, " $1").trim()}</h4>
              <ul className="text-sm text-muted-foreground">
                {Object.entries(counts).map(([k, n]) => <li key={k}>{k}: {n}</li>)}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" />Equality, diversity & inclusion</CardTitle>
        <CardDescription>Section B — confidential demographic data. Visible to superadmin and the mediator themselves only.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldRow label="Sex" mandatory={mandatoryFor("ediSex")} error={errors.ediSex}><Select value={asStr(draft.ediSex)} onValueChange={(v) => set("ediSex", v)}><SelectTrigger aria-required={isMandatory("ediSex")}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{SEX_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
        <FieldRow label="Gender identity" mandatory={mandatoryFor("ediGenderIdentity")} error={errors.ediGenderIdentity}><Select value={asStr(draft.ediGenderIdentity)} onValueChange={(v) => set("ediGenderIdentity", v)}><SelectTrigger aria-required={isMandatory("ediGenderIdentity")}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{GENDERS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
        {showGenderSelf && (
          <FieldRow label="If self-describe" mandatory={mandatoryFor("ediGenderSelfDescribe")} error={errors.ediGenderSelfDescribe}><Input value={asStr(draft.ediGenderSelfDescribe)} onChange={(e) => set("ediGenderSelfDescribe", e.target.value)} /></FieldRow>
        )}
        <FieldRow label="Ethnicity" mandatory={mandatoryFor("ediEthnicity")} error={errors.ediEthnicity}><Select value={asStr(draft.ediEthnicity)} onValueChange={(v) => set("ediEthnicity", v)}><SelectTrigger aria-required={isMandatory("ediEthnicity")}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{ETHNIC_ORIGINS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
        {showEthnicitySelf && (
          <FieldRow label="Ethnicity self-describe" mandatory={mandatoryFor("ediEthnicitySelfDescribe")} error={errors.ediEthnicitySelfDescribe}><Input value={asStr(draft.ediEthnicitySelfDescribe)} onChange={(e) => set("ediEthnicitySelfDescribe", e.target.value)} /></FieldRow>
        )}
        <FieldRow label="Disability" mandatory={mandatoryFor("ediDisability")} error={errors.ediDisability}><MultiCheck value={asArr(draft.ediDisability)} options={DISABILITY_OPTIONS} onChange={(v) => set("ediDisability", v)} /></FieldRow>
        <FieldRow label="Disability details" mandatory={mandatoryFor("ediDisabilityDetails")}><Textarea value={asStr(draft.ediDisabilityDetails)} onChange={(e) => set("ediDisabilityDetails", e.target.value)} /></FieldRow>
        <FieldRow label="First language" mandatory={mandatoryFor("ediFirstLanguage")} error={errors.ediFirstLanguage}><Select value={asStr(draft.ediFirstLanguage)} onValueChange={(v) => set("ediFirstLanguage", v)}><SelectTrigger aria-required={isMandatory("ediFirstLanguage")}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{COMMON_LANGUAGES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
        <FieldRow label="Country of birth" mandatory={mandatoryFor("ediCountryOfBirth")} error={errors.ediCountryOfBirth}><Select value={asStr(draft.ediCountryOfBirth)} onValueChange={(v) => set("ediCountryOfBirth", v)}><SelectTrigger aria-required={isMandatory("ediCountryOfBirth")}><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{COUNTRIES_OF_BIRTH.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
        <FieldRow label="Religion or belief" mandatory={mandatoryFor("ediReligion")}><Select value={asStr(draft.ediReligion)} onValueChange={(v) => set("ediReligion", v)}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{RELIGION_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
        <FieldRow label="Sexual orientation" mandatory={mandatoryFor("ediSexualOrientation")}><Select value={asStr(draft.ediSexualOrientation)} onValueChange={(v) => set("ediSexualOrientation", v)}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{SEXUAL_ORIENTATION_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>

        <Separator className="my-4" />
        <ConsentToggles id={id} />

        <SaveBar canEdit={canEdit} isPending={patch.isPending} onSave={onSave} onReset={() => { setDraft(profile); setErrors({}); }} />
      </CardContent>
    </Card>
  );
}

// ---------- Consent toggles (3 GDPR consents) ----------
function ConsentToggles({ id }: { id: string }) {
  const { data } = useQuery<MediatorConsent[]>({ queryKey: ["/api/mediators", id, "consents"] });
  const { toast } = useToast();
  const upsert = useMutation({
    mutationFn: ({ consentType, granted }: { consentType: string; granted: boolean }) =>
      apiRequest("POST", `/api/mediators/${id}/consents`, { consentType, granted }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "consents"] }); toast({ title: "Consent updated" }); },
  });
  const map = new Map<string, boolean>((data ?? []).map((c) => [c.consentType, c.granted]));
  const items: { key: string; label: string }[] = [
    { key: "name_bio", label: "Display name & bio publicly" },
    { key: "photo", label: "Display photo publicly" },
    { key: "edi_aggregate", label: "Include EDI in aggregate reporting" },
  ];
  return (
    <div>
      <h4 className="text-sm font-medium mb-2">GDPR consents</h4>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.key} className="flex items-center justify-between rounded border p-3">
            <span className="text-sm">{it.label}</span>
            <Switch
              checked={!!map.get(it.key)}
              onCheckedChange={(v) => upsert.mutate({ consentType: it.key, granted: v })}
              data-testid={`consent-${it.key}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================
// Credentials tab (Section C)
// =====================================================
function CredentialsTab({ id, bundle, role }: TabProps) {
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_C_FIELD_META, role);
  const canEdit = role === "superadmin" || role === "subadmin";
  const isStaff = role === "superadmin" || role === "subadmin";
  const { data: applicants } = useQuery<Array<{ id: string; convertedUserId: string | null; convertedAt: string | null; firstName: string; lastName: string }>>({
    queryKey: ["/api/mediator-applicants"],
    enabled: isStaff,
  });
  const sourceApplicant = (applicants ?? []).find((a) => a.convertedUserId === id);

  // Task #219 — Composite checks: ≥1 Initial training, ≥1 CPD entry,
  // and exactly 2 references on file before Credentials can be saved.
  const { data: trainings } = useQuery<MediatorTraining[]>({ queryKey: ["/api/mediators", id, "trainings"] });
  const { data: cpdEntries } = useQuery<MediatorCpdEntry[]>({ queryKey: ["/api/mediators", id, "cpd"] });
  const { data: references } = useQuery<MediatorReference[]>({ queryKey: ["/api/mediators", id, "references"] });

  // PPC supervisor fields become Mandatory when accreditation is "WTA".
  const wta = isWtaStatus(draft.fmcAccreditationStatus);
  const ppcMandatoryFor = (key: string): MandatoryLevel | undefined => {
    if (role !== "superadmin" && wta && (SECTION_C_WTA_REQUIRED_KEYS as readonly string[]).includes(key)) return "Y";
    return mandatoryFor(key);
  };
  const ppcIsMandatory = (key: string): boolean => ppcMandatoryFor(key) === "Y";

  const onSave = () => {
    const requireComplete = requiresMediatorProfileCompletion(role);
    const errs = checkRequired(SECTION_C_FIELD_META, draft as Record<string, unknown>, undefined, requireComplete);
    // Layer the conditional WTA rule on top of the metadata-driven checks.
    if (requireComplete && wta) {
      const labelByKey: Record<string, string> = {};
      for (const m of SECTION_C_FIELD_META) labelByKey[m.key] = m.label;
      for (const key of SECTION_C_WTA_REQUIRED_KEYS) {
        const v = (draft as Record<string, unknown>)[key];
        const isEmpty = v === null || v === undefined || (typeof v === "string" && v.trim() === "");
        if (isEmpty && !errs[key]) {
          errs[key] = `${labelByKey[key] ?? key} is required when accreditation status is WTA`;
        }
      }
    }
    // Composite child-resource checks. Surfaced as toast-only messages because
    // the rows live in their own tables below.
    const compositeIssues: string[] = [];
    if (requireComplete && !(trainings ?? []).some((t) => t.type === "Initial")) {
      compositeIssues.push("Add at least one Initial mediation training record below.");
    }
    if (requireComplete && !(cpdEntries ?? []).length) {
      compositeIssues.push("Add at least one CPD log entry below.");
    }
    if (requireComplete && (references ?? []).length < 2) {
      compositeIssues.push("Add 2 professional references below.");
    }
    if (Object.keys(errs).length > 0 || compositeIssues.length > 0) {
      setErrors(errs);
      const firstMsg = Object.values(errs)[0] ?? compositeIssues[0];
      toast({ title: "Please fix the highlighted fields", description: firstMsg, variant: "destructive" });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" />Credentials & registrations</CardTitle>
          <CardDescription>Section C — accreditation, regulator numbers, insurance, DBS, and PPC supervision.</CardDescription>
          {sourceApplicant && (
            <div className="mt-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="text-credentials-provenance">
              Verified FMC / PI / DBS values, plus any populated contract, time-banking &amp; ICO fields, were carried over from the applicant record on {sourceApplicant.convertedAt ? new Date(sourceApplicant.convertedAt).toLocaleDateString() : "conversion"}. Pending or failed applicant checks were not copied. You can edit any value below.
            </div>
          )}
        </CardHeader>
        <CardContent>
          <FieldRow label="FMC URN" mandatory={mandatoryFor("fmcUrn")} error={errors.fmcUrn}><Input value={asStr(draft.fmcUrn)} aria-required={isMandatory("fmcUrn")} onChange={(e) => set("fmcUrn", e.target.value)} data-testid="input-fmc-urn" /></FieldRow>
          <FieldRow label="FMC accreditation" mandatory={mandatoryFor("fmcAccreditationStatus")} error={errors.fmcAccreditationStatus}><Select value={asStr(draft.fmcAccreditationStatus)} onValueChange={(v) => set("fmcAccreditationStatus", v)}><SelectTrigger aria-required={isMandatory("fmcAccreditationStatus")} data-testid="select-fmc-status"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{FMC_ACCREDITATION_STATUSES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></FieldRow>
          <FieldRow label="FMC accreditation date" mandatory={mandatoryFor("fmcAccreditationDate")} error={errors.fmcAccreditationDate}><Input type="date" value={asStr(draft.fmcAccreditationDate)} onChange={(e) => set("fmcAccreditationDate", e.target.value)} /></FieldRow>
          <FieldRow label="CMC reg number" mandatory={mandatoryFor("cmcRegNumber")}><Input value={asStr(draft.cmcRegNumber)} onChange={(e) => set("cmcRegNumber", e.target.value)} /></FieldRow>
          <FieldRow label="Other regulator" mandatory={mandatoryFor("otherRegulatorName")}><Input value={asStr(draft.otherRegulatorName)} onChange={(e) => set("otherRegulatorName", e.target.value)} placeholder="Name" /></FieldRow>
          <FieldRow label="Other regulator number" mandatory={mandatoryFor("otherRegulatorNumber")}><Input value={asStr(draft.otherRegulatorNumber)} onChange={(e) => set("otherRegulatorNumber", e.target.value)} /></FieldRow>
          <FieldRow label="Higher qualifications" mandatory={mandatoryFor("higherQualifications")}><Textarea value={asStr(draft.higherQualifications)} onChange={(e) => set("higherQualifications", e.target.value)} /></FieldRow>

          <Separator className="my-4" />
          <p className="text-sm font-medium text-muted-foreground">Professional indemnity</p>
          <FieldRow label="PI provider" mandatory={mandatoryFor("piProvider")} error={errors.piProvider}><Input value={asStr(draft.piProvider)} aria-required={isMandatory("piProvider")} onChange={(e) => set("piProvider", e.target.value)} /></FieldRow>
          <FieldRow label="PI policy number" mandatory={mandatoryFor("piPolicyNumber")} error={errors.piPolicyNumber}><Input value={asStr(draft.piPolicyNumber)} aria-required={isMandatory("piPolicyNumber")} onChange={(e) => set("piPolicyNumber", e.target.value)} /></FieldRow>
          <FieldRow label="PI cover amount" mandatory={mandatoryFor("piCoverAmount")} error={errors.piCoverAmount} hint="FMC minimum £1,000,000"><Input value={asStr(draft.piCoverAmount)} aria-required={isMandatory("piCoverAmount")} onChange={(e) => set("piCoverAmount", e.target.value)} placeholder="£" data-testid="input-pi-cover" /></FieldRow>
          <FieldRow label="PI expiry" mandatory={mandatoryFor("piExpiryDate")} error={errors.piExpiryDate}><Input type="date" value={asStr(draft.piExpiryDate)} aria-required={isMandatory("piExpiryDate")} onChange={(e) => set("piExpiryDate", e.target.value)} data-testid="input-pi-expiry" /></FieldRow>
          <FieldRow label="PI certificate URL" mandatory={mandatoryFor("piCertificateUrl")}><Input value={asStr(draft.piCertificateUrl)} onChange={(e) => set("piCertificateUrl", e.target.value)} /></FieldRow>

          <Separator className="my-4" />
          <p className="text-sm font-medium text-muted-foreground">ICO data registration</p>
          <FieldRow label="ICO registration" mandatory={mandatoryFor("icoRegistration")} error={errors.icoRegistration}><Input value={asStr(draft.icoRegistration)} aria-required={isMandatory("icoRegistration")} onChange={(e) => set("icoRegistration", e.target.value)} /></FieldRow>
          <FieldRow label="ICO expiry" mandatory={mandatoryFor("icoExpiryDate")} error={errors.icoExpiryDate}><Input type="date" value={asStr(draft.icoExpiryDate)} aria-required={isMandatory("icoExpiryDate")} onChange={(e) => set("icoExpiryDate", e.target.value)} /></FieldRow>

          <Separator className="my-4" />
          <p className="text-sm font-medium text-muted-foreground">DBS</p>
          <FieldRow label="DBS level" mandatory={mandatoryFor("dbsLevel")} error={errors.dbsLevel}>
            <Select value={asStr(draft.dbsLevel)} onValueChange={(v) => set("dbsLevel", v)}>
              <SelectTrigger aria-required={isMandatory("dbsLevel")} data-testid="select-dbs-level"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{DBS_LEVELS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="DBS cert number" mandatory={mandatoryFor("dbsCertNumber")} error={errors.dbsCertNumber}><Input value={asStr(draft.dbsCertNumber)} aria-required={isMandatory("dbsCertNumber")} onChange={(e) => set("dbsCertNumber", e.target.value)} /></FieldRow>
          <FieldRow label="DBS issue date" mandatory={mandatoryFor("dbsIssueDate")} error={errors.dbsIssueDate}><Input type="date" value={asStr(draft.dbsIssueDate)} aria-required={isMandatory("dbsIssueDate")} onChange={(e) => set("dbsIssueDate", e.target.value)} /></FieldRow>
          <FieldRow label="DBS certificate URL" mandatory={mandatoryFor("dbsCertificateUrl")}><Input value={asStr(draft.dbsCertificateUrl)} onChange={(e) => set("dbsCertificateUrl", e.target.value)} /></FieldRow>

          <Separator className="my-4" />
          <p className="text-sm font-medium text-muted-foreground">PPC supervisor{wta && role !== "superadmin" && <span className="ml-2 text-xs font-normal text-destructive">— required while WTA</span>}</p>
          <FieldRow label="Name" mandatory={ppcMandatoryFor("ppcSupervisorName")} error={errors.ppcSupervisorName}><Input value={asStr(draft.ppcSupervisorName)} aria-required={ppcIsMandatory("ppcSupervisorName")} onChange={(e) => set("ppcSupervisorName", e.target.value)} data-testid="input-ppc-name" /></FieldRow>
          <FieldRow label="Organisation" mandatory={ppcMandatoryFor("ppcSupervisorOrg")} error={errors.ppcSupervisorOrg}><Input value={asStr(draft.ppcSupervisorOrg)} aria-required={ppcIsMandatory("ppcSupervisorOrg")} onChange={(e) => set("ppcSupervisorOrg", e.target.value)} /></FieldRow>
          <FieldRow label="Email" mandatory={ppcMandatoryFor("ppcSupervisorEmail")} error={errors.ppcSupervisorEmail}><Input type="email" value={asStr(draft.ppcSupervisorEmail)} aria-required={ppcIsMandatory("ppcSupervisorEmail")} onChange={(e) => set("ppcSupervisorEmail", e.target.value)} /></FieldRow>
          <FieldRow label="Phone" mandatory={ppcMandatoryFor("ppcSupervisorPhone")} error={errors.ppcSupervisorPhone}><Input value={asStr(draft.ppcSupervisorPhone)} aria-required={ppcIsMandatory("ppcSupervisorPhone")} onChange={(e) => set("ppcSupervisorPhone", e.target.value)} placeholder="+44…" data-testid="input-ppc-phone" /></FieldRow>
          <FieldRow label="Last sign-off date" mandatory={ppcMandatoryFor("ppcSupervisorLastSignoff")} error={errors.ppcSupervisorLastSignoff}><Input type="date" value={asStr(draft.ppcSupervisorLastSignoff)} aria-required={ppcIsMandatory("ppcSupervisorLastSignoff")} onChange={(e) => set("ppcSupervisorLastSignoff", e.target.value)} data-testid="input-ppc-last-signoff" /></FieldRow>
          <FieldRow label="Next review due" mandatory={ppcMandatoryFor("ppcSupervisorNextReview")} error={errors.ppcSupervisorNextReview}><Input type="date" value={asStr(draft.ppcSupervisorNextReview)} aria-required={ppcIsMandatory("ppcSupervisorNextReview")} onChange={(e) => set("ppcSupervisorNextReview", e.target.value)} data-testid="input-ppc-next-review" /></FieldRow>

          <SaveBar canEdit={canEdit} isPending={patch.isPending} onSave={onSave} onReset={() => { setDraft(profile); setErrors({}); }} />
        </CardContent>
      </Card>

      {/* CPD and holidays may be self-edited by the mediator; refs/trainings are staff-only. */}
      <CpdSection id={id} canEdit={canEdit || role === "mediator"} />
      <ReferencesSection id={id} canEdit={canEdit} />
      <TrainingsSection id={id} canEdit={canEdit} />
    </div>
  );
}

// ---------- CPD ----------
function CpdSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { data } = useQuery<MediatorCpdEntry[]>({ queryKey: ["/api/mediators", id, "cpd"] });
  const { toast } = useToast();
  const [draft, setDraft] = useState({ date: "", activity: "", hours: "", evidenceUrl: "" });
  // Task #219 — Rolling 12-month CPD hours tile (Auto). Sums `hours` for
  // entries dated within the last 365 days. Below FMC's minimum triggers a
  // warning chip so admins can spot under-CPD'd mediators at a glance.
  const rollingHours = useMemo(() => {
    const cutoff = Date.now() - 365 * 24 * 3600 * 1000;
    let sum = 0;
    for (const e of data ?? []) {
      const d = e.date ? Date.parse(e.date) : NaN;
      if (!isNaN(d) && d >= cutoff) {
        const h = parseFloat(String(e.hours ?? "0"));
        if (!isNaN(h)) sum += h;
      }
    }
    return Math.round(sum * 10) / 10;
  }, [data]);
  const belowMin = rollingHours < FMC_MIN_CPD_HOURS;
  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/cpd`, draft),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "cpd"] }); setDraft({ date: "", activity: "", hours: "", evidenceUrl: "" }); toast({ title: "CPD entry added" }); },
  });
  const remove = useMutation({
    mutationFn: (cid: string) => apiRequest("DELETE", `/api/mediators/${id}/cpd/${cid}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "cpd"] }),
  });
  return (
    <Card>
      <CardHeader><CardTitle>CPD log</CardTitle><CardDescription>Continuing professional development entries.</CardDescription></CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">CPD hours — rolling 12 months</span>
            <MandatoryMarker level="Auto" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tabular-nums" data-testid="text-cpd-rolling-hours">{rollingHours}</span>
            <span className="text-xs text-muted-foreground">/ {FMC_MIN_CPD_HOURS} hrs</span>
            {belowMin && (
              <Badge variant="destructive" data-testid="badge-cpd-below-min">Below FMC minimum</Badge>
            )}
          </div>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Activity</TableHead><TableHead>Hours</TableHead><TableHead>Evidence</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.date}</TableCell><TableCell>{e.activity}</TableCell><TableCell>{e.hours}</TableCell>
                <TableCell>{e.evidenceUrl ? <a href={e.evidenceUrl} className="underline" target="_blank" rel="noreferrer">link</a> : "—"}</TableCell>
                <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove.mutate(e.id)}><Trash2 className="w-4 h-4" /></Button>}</TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center">No CPD entries yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mt-4">
            <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            <Input placeholder="Activity" value={draft.activity} onChange={(e) => setDraft((d) => ({ ...d, activity: e.target.value }))} />
            <Input placeholder="Hours" value={draft.hours} onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))} />
            <Input placeholder="Evidence URL" value={draft.evidenceUrl} onChange={(e) => setDraft((d) => ({ ...d, evidenceUrl: e.target.value }))} />
            <Button onClick={() => create.mutate()} disabled={!draft.date || !draft.activity}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- References ----------
function ReferencesSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { toast } = useToast();
  const { data } = useQuery<MediatorReference[]>({ queryKey: ["/api/mediators", id, "references"] });
  const [draft, setDraft] = useState({ name: "", role: "", organisation: "", email: "", phone: "", status: "pending" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", role: "", organisation: "", email: "", phone: "", status: "pending" });
  const atCap = (data?.length ?? 0) >= 2;
  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/references`, draft),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "references"] }); setDraft({ name: "", role: "", organisation: "", email: "", phone: "", status: "pending" }); },
    onError: (err: Error) => toast({ title: "Couldn't add reference", description: err?.message, variant: "destructive" }),
  });
  const verify = useMutation({
    mutationFn: (rid: string) => apiRequest("PATCH", `/api/mediators/${id}/references/${rid}`, { status: "verified" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "references"] }); toast({ title: "Reference marked verified" }); },
  });
  const update = useMutation({
    mutationFn: (payload: { rid: string; patch: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/mediators/${id}/references/${payload.rid}`, payload.patch),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "references"] }); setEditingId(null); toast({ title: "Reference updated" }); },
    onError: (err: Error) => toast({ title: "Couldn't update reference", description: err?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (rid: string) => apiRequest("DELETE", `/api/mediators/${id}/references/${rid}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "references"] }),
  });
  function startEdit(r: MediatorReference) {
    setEditingId(r.id);
    setEditDraft({
      name: r.name ?? "",
      role: r.role ?? "",
      organisation: r.organisation ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      status: r.status ?? "pending",
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>References</CardTitle>
        <CardDescription>Up to 2 professional references. Subadmins manually verify after speaking to each referee.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role / org</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((r) => {
              const isEditing = editingId === r.id;
              if (isEditing) {
                return (
                  <TableRow key={r.id} data-testid={`row-reference-${r.id}`}>
                    <TableCell>
                      <Input value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} data-testid={`input-edit-ref-name-${r.id}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Input placeholder="Role" value={editDraft.role} onChange={(e) => setEditDraft((d) => ({ ...d, role: e.target.value }))} />
                        <Input placeholder="Organisation" value={editDraft.organisation} onChange={(e) => setEditDraft((d) => ({ ...d, organisation: e.target.value }))} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Input placeholder="Email" value={editDraft.email} onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))} />
                        <Input placeholder="Phone" value={editDraft.phone} onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select value={editDraft.status} onValueChange={(v) => setEditDraft((d) => ({ ...d, status: v }))}>
                        <SelectTrigger data-testid={`select-edit-ref-status-${r.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{REFERENCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="default" className="mr-1" disabled={update.isPending || !editDraft.name} onClick={() => update.mutate({ rid: r.id, patch: editDraft })} data-testid={`button-save-ref-${r.id}`}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} data-testid={`button-cancel-ref-${r.id}`}>Cancel</Button>
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow key={r.id} data-testid={`row-reference-${r.id}`}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{[r.role, r.organisation].filter(Boolean).join(" — ")}</TableCell>
                  <TableCell>{[r.email, r.phone].filter(Boolean).join(" / ")}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "verified" ? "default" : "outline"} data-testid={`badge-ref-status-${r.id}`}>{r.status}</Badge>
                    {r.verifiedAt && (
                      <span className="text-xs text-muted-foreground ml-2">on {r.verifiedAt ? new Date(r.verifiedAt).toLocaleDateString() : ""}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && r.status !== "verified" && (
                      <Button size="sm" variant="outline" onClick={() => verify.mutate(r.id)} className="mr-1" data-testid={`button-verify-${r.id}`}>Mark verified</Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => startEdit(r)} className="mr-1" data-testid={`button-edit-ref-${r.id}`}>Edit</Button>
                    )}
                    {canEdit && (
                      <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)} data-testid={`button-delete-ref-${r.id}`}><Trash2 className="w-4 h-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!data?.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center">No references yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {canEdit && !atCap && (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-4">
            <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} data-testid="input-ref-name" />
            <Input placeholder="Role" value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} />
            <Input placeholder="Organisation" value={draft.organisation} onChange={(e) => setDraft((d) => ({ ...d, organisation: e.target.value }))} />
            <Input placeholder="Email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REFERENCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={() => create.mutate()} disabled={!draft.name || create.isPending} data-testid="button-add-reference"><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        )}
        {canEdit && atCap && (
          <p className="text-xs text-muted-foreground mt-3">Maximum of 2 references reached. Delete one to add another.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Trainings ----------
function TrainingsSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { data } = useQuery<MediatorTraining[]>({ queryKey: ["/api/mediators", id, "trainings"] });
  const [draft, setDraft] = useState({ type: "Initial", provider: "", date: "", certName: "", certUrl: "" });
  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/trainings`, draft),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "trainings"] }); setDraft({ type: "Initial", provider: "", date: "", certName: "", certUrl: "" }); },
  });
  const remove = useMutation({
    mutationFn: (tid: string) => apiRequest("DELETE", `/api/mediators/${id}/trainings/${tid}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "trainings"] }),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Trainings & certificates</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Provider</TableHead><TableHead>Date</TableHead><TableHead>Certificate</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell><Badge variant="secondary">{t.type}</Badge></TableCell>
                <TableCell>{t.provider}</TableCell>
                <TableCell>{t.date}</TableCell>
                <TableCell>{t.certUrl ? <a href={t.certUrl} className="underline" target="_blank" rel="noreferrer">{t.certName || "view"}</a> : t.certName}</TableCell>
                <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove.mutate(t.id)}><Trash2 className="w-4 h-4" /></Button>}</TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center">No training records yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-4">
            <Select value={draft.type} onValueChange={(v) => setDraft((d) => ({ ...d, type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TRAINING_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="Provider" value={draft.provider} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))} />
            <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            <Input placeholder="Cert name" value={draft.certName} onChange={(e) => setDraft((d) => ({ ...d, certName: e.target.value }))} />
            <Input placeholder="Cert URL" value={draft.certUrl} onChange={(e) => setDraft((d) => ({ ...d, certUrl: e.target.value }))} />
            <Button onClick={() => create.mutate()}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================
// Service offering tab (Section D)
// =====================================================
function ServiceOfferingTab({ id, bundle, role, actorId, focusSection, focusServiceTypeId }: TabProps) {
  const { toast } = useToast();
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const canEdit = role === "superadmin" || role === "subadmin";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_D_FIELD_META, role);
  // Task #222 — controlled input for the "Add bespoke specialism" form.
  const [specialismDraft, setSpecialismDraft] = useState("");

  const { data: allServiceTypes } = useQuery<ServiceType[]>({ queryKey: ["/api/service-types"] });
  const { data: mediatorServiceAssignments } = useQuery<MediatorServiceAssignment[]>({ queryKey: ["/api/mediators", id, "services"], enabled: !!id });
  const { data: serviceApprovals } = useQuery<Array<{
    id: string;
    serviceTypeId: string;
    status: string;
    effectiveStatus?: string;
    requestedBy?: string | null;
    requestedAt?: string | null;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    proofFileName?: string | null;
    proofFileUrl?: string | null;
    proofLink?: string | null;
    expiryDate?: string | null;
    reviewReason?: string | null;
    manualApprovalNote?: string | null;
    calendarStartAt?: string | null;
    calendarEndAt?: string | null;
    calendarTitle?: string | null;
    calendarNotes?: string | null;
    calendarGoogleEventId?: string | null;
    calendarUpdatedAt?: string | null;
    calendarIsBooked?: boolean;
    scheduleSlots?: ServiceScheduleSlotRow[];
    mediationRoleQualification?: MediationRoleQualification;
  }>>({
    queryKey: ["/api/mediators", id, "service-approvals"],
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const isSelfMediator = role === "mediator" && actorId === id;
  const canInspectSchedule = isSelfMediator || role === "superadmin" || role === "subadmin";
  const { data: serviceScheduleSlots } = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", id, "service-schedule-slots"],
    enabled: !!id && canInspectSchedule,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const activeServiceTypes = useMemo(
    () => (allServiceTypes ?? []).filter(s => s.isActive),
    [allServiceTypes],
  );
  const groupedServices = useMemo(() => groupServicesByCategory(activeServiceTypes), [activeServiceTypes]);

  const initialServiceIds = useMemo(
    () => (Array.isArray(mediatorServiceAssignments) ? mediatorServiceAssignments.map((assignment) => assignment.serviceTypeId).sort() : null),
    [mediatorServiceAssignments],
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedServiceQualifications, setSelectedServiceQualifications] = useState<Record<string, MediationRoleQualification>>({});
  const [hydratedForId, setHydratedForId] = useState<string | null>(null);

  // Hydrate local selection once per mediator so a background refetch never
  // clobbers in-flight checkbox edits the user hasn't saved yet.
  useEffect(() => {
    if (initialServiceIds && hydratedForId !== id) {
      setSelectedServiceIds(initialServiceIds);
      setSelectedServiceQualifications(Object.fromEntries((mediatorServiceAssignments ?? []).map((assignment) => [
        assignment.serviceTypeId,
        assignment.mediationRoleQualification ?? "unclassified",
      ])));
      setHydratedForId(id);
    }
  }, [id, initialServiceIds, hydratedForId, mediatorServiceAssignments]);

  const toggleServiceId = (sid: string) =>
    setSelectedServiceIds(prev => {
      const next = prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid];
      if (!prev.includes(sid)) {
        setSelectedServiceQualifications((current) => ({ ...current, [sid]: current[sid] ?? "unclassified" }));
      }
      return next;
    });

  const servicesDirty = useMemo(
    () => !arraysEqualUnordered(selectedServiceIds, initialServiceIds ?? []),
    [selectedServiceIds, initialServiceIds],
  );
  const serviceQualificationsDirty = useMemo(() => {
    const initial = new Map((mediatorServiceAssignments ?? []).map((assignment) => [
      assignment.serviceTypeId,
      assignment.mediationRoleQualification ?? "unclassified",
    ]));
    if (!initialServiceIds) return false;
    return selectedServiceIds.some((serviceId) => (selectedServiceQualifications[serviceId] ?? "unclassified") !== (initial.get(serviceId) ?? "unclassified"));
  }, [initialServiceIds, mediatorServiceAssignments, selectedServiceIds, selectedServiceQualifications]);
  const serviceAssignmentsPayload = selectedServiceIds.map((serviceTypeId) => ({
    serviceTypeId,
    mediationRoleQualification: selectedServiceQualifications[serviceTypeId] ?? "unclassified",
  }));

  const servicesPatch = useMutation({
    mutationFn: (services: MediatorServiceAssignment[]) =>
      apiRequest("PUT", `/api/mediators/${id}/services`, { services }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-service-types"] });
      toast({ title: "Saved", description: "Services updated." });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not save services", description: (e as Error).message, variant: "destructive" }),
  });

  const [serviceProofDrafts, setServiceProofDrafts] = useState<Record<string, { proofLink: string; proofFileName: string; proofFileData: string; proofMimeType: string; expiryDate: string }>>({});
  const [serviceEventDrafts, setServiceEventDrafts] = useState<Record<string, { startDate: string; startTime: string; endDate: string; endTime: string; title: string; notes: string }>>({});
  const [rejectReasonByServiceId, setRejectReasonByServiceId] = useState<Record<string, string>>({});
  const [revokeReasonByServiceId, setRevokeReasonByServiceId] = useState<Record<string, string>>({});
  const [revokeServiceId, setRevokeServiceId] = useState<string | null>(null);
  const [manualApprovalServiceId, setManualApprovalServiceId] = useState<string | null>(null);
  const [manualApprovalDraft, setManualApprovalDraft] = useState({
    proofLink: "",
    proofFileName: "",
    proofFileData: "",
    proofMimeType: "",
    evidenceNote: "",
    expiryDate: "",
  });
  const [scheduleModalServiceId, setScheduleModalServiceId] = useState<string | null>(null);
  const [scheduleModalReadOnly, setScheduleModalReadOnly] = useState(false);
  const [scheduleModalNotice, setScheduleModalNotice] = useState<string | null>(null);
  const [scheduleNoticeByServiceId, setScheduleNoticeByServiceId] = useState<Record<string, string>>({});
  const consumedSchedulePromptRef = useRef<string | null>(null);
  const serviceProofSectionRef = useRef<HTMLDivElement | null>(null);
  const serviceProofCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightedServiceTypeId, setHighlightedServiceTypeId] = useState<string | null>(null);
  const expiryMinDate = getTodayIsoDate();

  function toLocalDateTimeParts(value?: string | null) {
    if (!value) return { date: "", time: "" };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { date: "", time: "" };
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
    return { date: local.slice(0, 10), time: local.slice(11, 16) };
  }

  useEffect(() => {
    if (!serviceApprovals) return;
    setServiceEventDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const approval of serviceApprovals) {
        if (next[approval.serviceTypeId]) continue;
        if (!approval.calendarStartAt || !approval.calendarEndAt) continue;
        const start = toLocalDateTimeParts(approval.calendarStartAt);
        const end = toLocalDateTimeParts(approval.calendarEndAt);
        next[approval.serviceTypeId] = {
          startDate: start.date,
          startTime: start.time,
          endDate: end.date,
          endTime: end.time,
          title: approval.calendarTitle ?? "",
          notes: approval.calendarNotes ?? "",
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [serviceApprovals]);

  const saveServiceCalendarEvent = useMutation({
    mutationFn: (input: { serviceTypeId: string; startDate: string; startTime: string; endDate: string; endTime: string; title: string; notes: string }) =>
      apiRequest("PUT", `/api/mediators/${id}/service-approvals/${input.serviceTypeId}/calendar-event`, {
        startAt: new Date(`${input.startDate}T${input.startTime}:00`).toISOString(),
        endAt: new Date(`${input.endDate}T${input.endTime}:00`).toISOString(),
        title: input.title.trim() || null,
        notes: input.notes.trim() || null,
      }),
    onSuccess: (_, variables) => {
      setServiceEventDrafts((prev) => ({
        ...prev,
        [variables.serviceTypeId]: {
          startDate: variables.startDate,
          startTime: variables.startTime,
          endDate: variables.endDate,
          endTime: variables.endTime,
          title: variables.title,
          notes: variables.notes,
        },
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/appointments"] });
      toast({ title: "Service calendar event saved", description: "The event was saved and synced to the mediator's connected calendar." });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not save calendar event", description: (e as Error).message, variant: "destructive" }),
  });

  const deleteServiceCalendarEvent = useMutation({
    mutationFn: (serviceTypeId: string) =>
      apiRequest("DELETE", `/api/mediators/${id}/service-approvals/${serviceTypeId}/calendar-event`),
    onSuccess: (_, serviceTypeId) => {
      setServiceEventDrafts((prev) => {
        const next = { ...prev };
        delete next[serviceTypeId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/appointments"] });
      toast({ title: "Service calendar event removed" });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not remove calendar event", description: (e as Error).message, variant: "destructive" }),
  });
  const saveServiceProof = useMutation({
    mutationFn: (input: { serviceTypeId: string; proofLink: string; proofFileName: string; proofFileData: string; proofMimeType: string; expiryDate: string }) =>
      apiRequest("PUT", `/api/mediators/${id}/service-approvals/${input.serviceTypeId}`, {
        proofLink: input.proofLink || null,
        proofFileName: input.proofFileName || null,
        proofFileData: input.proofFileData || null,
        proofMimeType: input.proofMimeType || null,
        expiryDate: input.expiryDate || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      toast({ title: "Service proof saved" });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not save proof", description: (e as Error).message, variant: "destructive" }),
  });

  const reviewServiceApproval = useMutation({
    mutationFn: async (input: { serviceTypeId: string; decision: "approved" | "rejected"; reviewReason?: string | null }) => {
      const res = await apiRequest("POST", `/api/mediators/${id}/service-approvals/${input.serviceTypeId}/review`, {
        decision: input.decision,
        reviewReason: input.reviewReason ?? null,
      });
      return await res.json() as { emailSent?: boolean };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "services"] });
      toast({
        title: "Service review saved",
        description: result.emailSent
          ? `The mediator was notified that the service was ${variables.decision}.`
          : "The mediator was notified in-app, but the email was not sent.",
      });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not save review", description: (e as Error).message, variant: "destructive" }),
  });

  const revokeServiceApproval = useMutation({
    mutationFn: async (input: { serviceTypeId: string; reviewReason: string }) => {
      const res = await apiRequest("POST", `/api/mediators/${id}/service-approvals/${input.serviceTypeId}/revoke`, {
        reviewReason: input.reviewReason,
      });
      return await res.json() as { emailSent?: boolean };
    },
    onSuccess: (result, variables) => {
      setRevokeServiceId(null);
      setRevokeReasonByServiceId((prev) => {
        const next = { ...prev };
        delete next[variables.serviceTypeId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/appointments"] });
      toast({
        title: "Service approval revoked",
        description: result.emailSent ? "The mediator was asked to upload fresh proof." : "The mediator was notified in-app, but the email was not sent.",
      });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not revoke approval", description: (e as Error).message, variant: "destructive" }),
  });

  const requestServiceProof = useMutation({
    mutationFn: async (serviceTypeId: string) => {
      const res = await apiRequest("POST", `/api/mediators/${id}/service-approvals/${serviceTypeId}/request`, {});
      return await res.json() as { emailSent?: boolean };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "services"] });
      toast({
        title: "Proof request sent",
        description: result.emailSent ? "The mediator was notified in-app and by email." : "The mediator was notified in-app, but the email was not sent.",
      });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not request proof", description: (e as Error).message, variant: "destructive" }),
  });

  const manualApproveService = useMutation({
    mutationFn: async (input: typeof manualApprovalDraft & { serviceTypeId: string }) => {
      const res = await apiRequest("POST", `/api/mediators/${id}/service-approvals/${input.serviceTypeId}/manual-approve`, {
        proofLink: input.proofLink.trim() || null,
        proofFileName: input.proofFileName || null,
        proofFileData: input.proofFileData || null,
        proofMimeType: input.proofMimeType || null,
        evidenceNote: input.evidenceNote.trim() || null,
        expiryDate: input.expiryDate || null,
      });
      return await res.json();
    },
    onSuccess: (_, variables) => {
      setManualApprovalServiceId(null);
      setManualApprovalDraft({ proofLink: "", proofFileName: "", proofFileData: "", proofMimeType: "", evidenceNote: "", expiryDate: "" });
      setSelectedServiceIds((current) => current.includes(variables.serviceTypeId) ? current : [...current, variables.serviceTypeId]);
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "services"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediator-service-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators"] });
      queryClient.invalidateQueries({ queryKey: ["/api/booking"] });
      toast({ title: "Service manually approved", description: "The mediator was notified in-app." });
    },
    onError: (e: unknown) =>
      toast({ title: "Could not manually approve service", description: (e as Error).message, variant: "destructive" }),
  });

  const saveServiceScheduleSlots = useMutation({
    mutationFn: async (input: { serviceTypeId: string; rows: ServiceScheduleSlotDraft[] }) => {
      return saveMediatorServiceSchedule({
        mediatorId: id,
        serviceTypeId: input.serviceTypeId,
        originalSlots: scheduleModalRows,
        rows: input.rows,
      });
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals", variables.serviceTypeId, "schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/appointments"] });
      const description = result.preservedCount > 0
        ? `Saved with ${result.preservedCount} booked slot(s) kept in place.`
        : "The service schedule was saved and synced to the mediator's connected calendar.";
      toast({ title: "Schedule saved", description });
      setScheduleModalNotice(result.preservedCount > 0 ? description : null);
      if (result.preservedCount > 0) {
        setScheduleNoticeByServiceId((prev) => ({
          ...prev,
          [variables.serviceTypeId]: description,
        }));
      } else {
        setScheduleNoticeByServiceId((prev) => {
          const next = { ...prev };
          delete next[variables.serviceTypeId];
          return next;
        });
      }
      if (result.preservedCount === 0) {
        setScheduleModalServiceId(null);
      }
    },
    onError: (e: unknown) =>
      toast({ title: "Could not save schedule", description: (e as Error).message, variant: "destructive" }),
  });

  const slotsByServiceId = useMemo(() => {
    const map = new Map<string, ServiceScheduleSlotRow[]>();
    for (const row of serviceScheduleSlots ?? []) {
      const arr = map.get(row.serviceTypeId) ?? [];
      arr.push(row);
      map.set(row.serviceTypeId, arr);
    }
    return map;
  }, [serviceScheduleSlots]);

  const approvedServicesNeedingSchedule = useMemo(
    () => (activeServiceTypes ?? []).filter((service) => {
      const approval = serviceApprovals?.find((row) => row.serviceTypeId === service.id);
      return (approval?.effectiveStatus ?? approval?.status) === "approved" && (slotsByServiceId.get(service.id)?.length ?? 0) === 0;
    }),
    [activeServiceTypes, serviceApprovals, slotsByServiceId],
  );

  const scheduleModalService = useMemo(
    () => activeServiceTypes.find((service) => service.id === scheduleModalServiceId) ?? null,
    [activeServiceTypes, scheduleModalServiceId],
  );
  const manualApprovalService = useMemo(
    () => activeServiceTypes.find((service) => service.id === manualApprovalServiceId) ?? null,
    [activeServiceTypes, manualApprovalServiceId],
  );

  const scheduleModalApproval = useMemo(
    () => serviceApprovals?.find((row) => row.serviceTypeId === scheduleModalServiceId) ?? null,
    [scheduleModalServiceId, serviceApprovals],
  );
  const googleCalendarConnected = !!(profile as { googleCalendarConnected?: boolean }).googleCalendarConnected;

  const { data: scheduleModalServiceSlots } = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", id, "service-approvals", scheduleModalServiceId, "schedule-slots"],
    enabled: !!id && canInspectSchedule && !!scheduleModalServiceId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });

  const scheduleModalRows = useMemo<ServiceScheduleSlotRow[]>(
    () => scheduleModalServiceSlots ?? scheduleModalApproval?.scheduleSlots ?? (scheduleModalServiceId ? (slotsByServiceId.get(scheduleModalServiceId) ?? []) : []),
    [scheduleModalApproval?.scheduleSlots, scheduleModalServiceId, scheduleModalServiceSlots, slotsByServiceId],
  );

  const firstApprovedServiceNeedingSchedule = useMemo(
    () => (activeServiceTypes ?? []).find((service) => {
      const approval = serviceApprovals?.find((row) => row.serviceTypeId === service.id);
      return (approval?.effectiveStatus ?? approval?.status) === "approved" && (slotsByServiceId.get(service.id)?.length ?? 0) === 0;
    }) ?? null,
    [activeServiceTypes, serviceApprovals, slotsByServiceId],
  );

  useEffect(() => {
    if (!isSelfMediator) return;
    if (!googleCalendarConnected) return;
    if (!firstApprovedServiceNeedingSchedule) return;
    if (scheduleModalServiceId) return;
    if (consumedSchedulePromptRef.current === firstApprovedServiceNeedingSchedule.id) return;
    consumedSchedulePromptRef.current = firstApprovedServiceNeedingSchedule.id;
    setScheduleModalServiceId(firstApprovedServiceNeedingSchedule.id);
    setScheduleModalReadOnly(false);
  }, [firstApprovedServiceNeedingSchedule, googleCalendarConnected, isSelfMediator, scheduleModalServiceId]);
  const proofServices = useMemo(
    () => {
      if (!isSelfMediator) {
        const visibleIds = new Set([
          ...(initialServiceIds ?? selectedServiceIds),
          ...(serviceApprovals ?? []).map((row) => row.serviceTypeId),
        ]);
        return activeServiceTypes.filter((service) => visibleIds.has(service.id));
      }
      const selectedSet = new Set(selectedServiceIds);
      const statusRank = (serviceId: string) => {
        const approval = serviceApprovals?.find((row) => row.serviceTypeId === serviceId);
        const status = (approval?.effectiveStatus ?? approval?.status ?? "").toLowerCase();
        if (status === "approved") return 0;
        if (status === "pending_review") return 1;
        if (status === "rejected" || status === "expired") return 2;
        return 3;
      };
      return [...activeServiceTypes].sort((a, b) => {
        const aSelected = selectedSet.has(a.id);
        const bSelected = selectedSet.has(b.id);
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        const statusDiff = statusRank(a.id) - statusRank(b.id);
        if (statusDiff !== 0) return statusDiff;
        return a.name.localeCompare(b.name);
      });
    },
    [activeServiceTypes, initialServiceIds, isSelfMediator, selectedServiceIds, serviceApprovals],
  );

  useEffect(() => {
    if (focusSection !== "service-proof") return;
    if (proofServices.length === 0) return;
    const target = focusServiceTypeId ? serviceProofCardRefs.current[focusServiceTypeId] : null;
    const scrollTarget = target ?? serviceProofSectionRef.current;
    scrollTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focusServiceTypeId && target) {
      setHighlightedServiceTypeId(focusServiceTypeId);
      const timer = window.setTimeout(() => setHighlightedServiceTypeId(null), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [focusSection, focusServiceTypeId, proofServices.length]);

  useEffect(() => {
    if (!isSelfMediator) return;
    if (!googleCalendarConnected) return;
    if (scheduleModalServiceId) return;
    if (approvedServicesNeedingSchedule.length === 0) return;
    if (consumedSchedulePromptRef.current === approvedServicesNeedingSchedule[0].id) return;
    consumedSchedulePromptRef.current = approvedServicesNeedingSchedule[0].id;
    setScheduleModalServiceId(approvedServicesNeedingSchedule[0].id);
  }, [approvedServicesNeedingSchedule, googleCalendarConnected, isSelfMediator, scheduleModalServiceId]);

  const onSave = () => {
    const activeServiceIds = new Set(activeServiceTypes.map((service) => service.id));
    const selectedActiveServiceIds = selectedServiceIds.filter((serviceId) => activeServiceIds.has(serviceId));
    const errs = Object.fromEntries(
      validateServiceOfferingRequirements(
        draft as Record<string, unknown>,
        selectedActiveServiceIds,
        requiresMediatorProfileCompletion(role),
      ).map((error) => [error.field, error.message]),
    );
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    const profileChanges = diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>);
    if (Object.keys(profileChanges).length > 0) patch.mutate(profileChanges as never);
    if (servicesDirty || serviceQualificationsDirty) servicesPatch.mutate(serviceAssignmentsPayload);
  };
  const onReset = () => {
    setDraft(profile);
    setSelectedServiceIds(initialServiceIds ?? []);
    setSelectedServiceQualifications(Object.fromEntries((mediatorServiceAssignments ?? []).map((assignment) => [
      assignment.serviceTypeId,
      assignment.mediationRoleQualification ?? "unclassified",
    ])));
    setErrors({});
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5" />Service offering</CardTitle>
        <CardDescription>Section D — what the mediator can take on, including mediation role qualification and special opt-ins.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldRow
          label="Services"
          mandatory={role === "superadmin" ? "N" : "Y"}
          hint="Tick every service this mediator is qualified to deliver. Sourced from the active services list under Settings → Service types."
          error={errors.services}
        >
          {activeServiceTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active services configured.</p>
          ) : (
            <div className="space-y-2" role="group" aria-required={role !== "superadmin"} aria-label="Services">
              <p className="text-xs text-muted-foreground">
                Lead mediators can act as Lead, Co-mediator, or Observer. Co-mediators can act as Co-mediator or Observer. Observers can only observe.
              </p>
              <div
                className="space-y-3 max-h-72 overflow-y-auto pr-1 border rounded-md p-2 bg-muted/20"
                data-testid="services-checkbox-grid"
              >
                {groupedServices.map(({ category, items }) => {
                  const colorClass = SERVICE_CATEGORY_COLORS[category] || SERVICE_CATEGORY_COLORS["Packages"];
                  return (
                    <Fragment key={category}>
                      <div
                        className="flex items-center gap-2 px-1 pt-1"
                        data-testid={`services-group-${category}`}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {category}
                        </p>
                        <Badge variant="outline" className={`${colorClass} text-[10px] px-1.5 py-0`}>
                          {items.length}
                        </Badge>
                      </div>
                      <div className="grid gap-1">
                        {items.map(st => {
                          const checked = selectedServiceIds.includes(st.id);
                          return (
                            <div
                              key={st.id}
                              className={`grid gap-2 p-2 rounded-md transition-colors sm:grid-cols-[minmax(0,1fr)_190px] ${canEdit ? "hover:bg-muted/50" : "cursor-default opacity-90"}`}
                              data-testid={`checkbox-service-${st.id}`}
                            >
                              <label className={`flex items-center gap-2.5 min-w-0 ${canEdit ? "cursor-pointer" : "cursor-default"}`}>
                                <Checkbox
                                  checked={checked}
                                  disabled={!canEdit}
                                  onCheckedChange={() => canEdit && toggleServiceId(st.id)}
                                />
                                <span className="text-sm flex-1 truncate">{st.name}</span>
                                <Badge variant="outline" className={`${colorClass} text-[10px] px-1.5 py-0 shrink-0`}>
                                  {st.category}
                                </Badge>
                              </label>
                              {checked && (
                                <Select
                                  value={selectedServiceQualifications[st.id] ?? "unclassified"}
                                  onValueChange={(value) => setSelectedServiceQualifications((current) => ({ ...current, [st.id]: value as MediationRoleQualification }))}
                                  disabled={!canEdit}
                                >
                                  <SelectTrigger data-testid={`select-profile-service-role-${st.id}`}>
                                    <SelectValue placeholder="Service role qualification" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {MEDIATION_ROLE_QUALIFICATIONS.map((qualification) => (
                                      <SelectItem key={qualification} value={qualification}>{getMediationRoleQualificationLabel(qualification)}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Fragment>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground" data-testid="text-services-selected-count">
                  {selectedServiceIds.length} service{selectedServiceIds.length !== 1 ? "s" : ""} selected
                </p>
                {canEdit && selectedServiceIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedServiceIds([])}
                    data-testid="button-clear-services"
                  >
                    Clear all
                  </Button>
                )}
              </div>
            </div>
          )}
        </FieldRow>
        <Separator className="my-4" />
        <div className="space-y-3 scroll-mt-24" ref={serviceProofSectionRef} data-testid="section-service-proof-expiry">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <h3 className="text-sm font-semibold">Service proof & expiry</h3>
            <span className="text-xs text-muted-foreground">{serviceApprovals?.length ?? 0} record(s)</span>
          </div>
          {proofServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active services configured.</p>
          ) : (
            <div className="space-y-2">
              {proofServices.map((service) => {
                const approval = serviceApprovals?.find((row) => row.serviceTypeId === service.id);
                const draft = serviceProofDrafts[service.id] ?? { proofLink: "", proofFileName: "", proofFileData: "", proofMimeType: "", expiryDate: "" };
                const rawStatus = approval ? (approval.effectiveStatus ?? approval.status ?? null) : null;
                const status = rawStatus?.toLowerCase() ?? null;
                const isRejectedByAdmin = Boolean(approval?.reviewReason && status === "requested");
                const hasRealRequest = Boolean(
                  approval && (
                    approval.requestedBy ||
                    approval.requestedAt ||
                    approval.reviewedAt ||
                    approval.proofFileUrl ||
                    approval.proofLink ||
                    status !== "requested" ||
                    isRejectedByAdmin
                  ),
                );
                const displayStatus = isRejectedByAdmin ? "rejected" : status;
                const showStatusBadge = Boolean(displayStatus && (displayStatus !== "requested" || hasRealRequest));
                const isApproved = displayStatus === "approved";
                const isRejectedOrExpired = displayStatus === "rejected" || displayStatus === "expired" || displayStatus === "revoked";
                const canUpload = isSelfMediator && (!approval || displayStatus === "requested" || isRejectedOrExpired || isRejectedByAdmin);
                const calendarDraft = serviceEventDrafts[service.id] ?? {
                  startDate: "",
                  startTime: "",
                  endDate: "",
                  endTime: "",
                  title: "",
                  notes: "",
                };
                const serviceSlots = slotsByServiceId.get(service.id) ?? [];
                const booked = !!approval?.calendarIsBooked;
                const canManageSchedule = isSelfMediator && isApproved;
                const scheduleRequired = canManageSchedule && serviceSlots.length === 0;
                const canViewSchedule = isApproved && canInspectSchedule;
                const canReviewApproval = !isSelfMediator && (role === "superadmin" || role === "subadmin") && status === "pending_review";
                const canRevokeApproval = !isSelfMediator && (role === "superadmin" || role === "subadmin") && isApproved;
                const canManualApprove = !isSelfMediator && (role === "superadmin" || role === "subadmin") && !isApproved;
                const canRequestProof = !isSelfMediator
                  && (role === "superadmin" || role === "subadmin")
                  && (!approval || displayStatus === "rejected" || displayStatus === "expired");
                const rejectReason = rejectReasonByServiceId[service.id] ?? "";
                const revokeReason = revokeReasonByServiceId[service.id] ?? "";
                return (
                  <div
                    key={service.id}
                    ref={(node) => { serviceProofCardRefs.current[service.id] = node; }}
                    className={`rounded-md border bg-card p-3 space-y-2 transition-colors ${highlightedServiceTypeId === service.id ? "border-[#5a7d58] bg-[#a7baa4]/15 shadow-sm" : ""}`}
                    data-testid={`card-service-proof-${service.id}`}
                  >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{service.name}</p>
                          <p className="text-xs text-muted-foreground">{service.category}</p>
                        </div>
                      {showStatusBadge && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${
                            displayStatus === "approved"
                              ? "bg-green-50 text-green-700 border-green-200"
                              : displayStatus === "rejected" || displayStatus === "expired" || displayStatus === "revoked"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : displayStatus === "pending_review"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-gray-100 text-gray-500 border-gray-200"
                          }`}
                        >
                          {displayStatus?.replaceAll("_", " ")}
                        </Badge>
                      )}
                    </div>
                    {canRequestProof && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => requestServiceProof.mutate(service.id)}
                        disabled={requestServiceProof.isPending}
                        data-testid={`button-request-service-proof-${service.id}`}
                      >
                        {requestServiceProof.isPending ? "Sending..." : "Request proof"}
                      </Button>
                    )}
                    {canManualApprove && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setManualApprovalDraft({ proofLink: "", proofFileName: "", proofFileData: "", proofMimeType: "", evidenceNote: "", expiryDate: "" });
                          setManualApprovalServiceId(service.id);
                        }}
                        disabled={manualApproveService.isPending}
                        data-testid={`button-manual-approve-service-${service.id}`}
                      >
                        Manually approve
                      </Button>
                    )}
                    {canReviewApproval && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => reviewServiceApproval.mutate({ serviceTypeId: service.id, decision: "approved" })}
                            disabled={reviewServiceApproval.isPending}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => reviewServiceApproval.mutate({ serviceTypeId: service.id, decision: "rejected", reviewReason: rejectReason || null })}
                            disabled={reviewServiceApproval.isPending || !rejectReason.trim()}
                          >
                            Reject
                          </Button>
                        </div>
                        <Input
                          value={rejectReason}
                          onChange={(e) => setRejectReasonByServiceId((prev) => ({ ...prev, [service.id]: e.target.value }))}
                          placeholder="Rejection reason"
                        />
                      </div>
                    )}
                    {canRevokeApproval && (
                      <div className="space-y-2 rounded-md border border-red-200 bg-red-50/40 p-2">
                        {revokeServiceId !== service.id ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setRevokeServiceId(service.id)}
                            disabled={revokeServiceApproval.isPending}
                            data-testid={`button-revoke-service-approval-${service.id}`}
                          >
                            Revoke approval
                          </Button>
                        ) : (
                          <>
                            <Input
                              value={revokeReason}
                              onChange={(e) => setRevokeReasonByServiceId((prev) => ({ ...prev, [service.id]: e.target.value }))}
                              placeholder="Revocation reason"
                              data-testid={`input-revoke-service-approval-reason-${service.id}`}
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => revokeServiceApproval.mutate({ serviceTypeId: service.id, reviewReason: revokeReason.trim() })}
                                disabled={revokeServiceApproval.isPending || !revokeReason.trim()}
                              >
                                {revokeServiceApproval.isPending ? "Revoking..." : "Confirm revoke"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRevokeServiceId(null)}
                                disabled={revokeServiceApproval.isPending}
                              >
                                Cancel
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {approval?.proofFileUrl && (
                      <a href={approval.proofFileUrl} target="_blank" rel="noreferrer" className="text-xs text-[#5a7d58] hover:underline">
                        Open uploaded file
                      </a>
                    )}
                    {approval?.proofLink && (
                      <a href={approval.proofLink} target="_blank" rel="noreferrer" className="text-xs text-[#5a7d58] hover:underline">
                        Open supporting link
                      </a>
                    )}
                    {approval?.expiryDate && <p className="text-xs text-muted-foreground">Expiry: {approval.expiryDate}</p>}
                    {approval?.reviewReason && (
                      <p className="text-xs text-destructive">
                        {displayStatus === "revoked" ? "Revocation reason" : "Reason"}: {approval.reviewReason}
                      </p>
                    )}
                    {approval?.manualApprovalNote !== null && approval?.manualApprovalNote !== undefined && (
                      <div className="rounded-md border border-green-200 bg-green-50/50 p-2 text-xs text-green-900">
                        <p className="font-medium">{isApproved ? "Manual approval" : "Previous manual approval"}</p>
                        {approval.manualApprovalNote && (
                          <p className="whitespace-pre-wrap">Evidence note: {approval.manualApprovalNote}</p>
                        )}
                        {isApproved && approval.reviewedAt && (
                          <p className="mt-1 text-green-700">
                            Manually approved by Superadmin on {new Date(approval.reviewedAt).toLocaleString("en-GB")}.
                          </p>
                        )}
                        {!isApproved && <p className="mt-1 text-green-700">This earlier manual approval is no longer active.</p>}
                      </div>
                    )}
                    {canUpload && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          placeholder="Supporting link"
                          value={draft.proofLink}
                          onChange={(e) => setServiceProofDrafts((prev) => ({ ...prev, [service.id]: { ...draft, proofLink: e.target.value } }))}
                        />
                        <Input
                          type="date"
                          min={expiryMinDate}
                          value={draft.expiryDate}
                          onChange={(e) => setServiceProofDrafts((prev) => ({ ...prev, [service.id]: { ...draft, expiryDate: e.target.value } }))}
                        />
                        <Input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const uploaded = await fileToDataUrl(file);
                            setServiceProofDrafts((prev) => ({ ...prev, [service.id]: {
                              ...draft,
                              proofFileName: uploaded.fileName,
                              proofFileData: uploaded.fileData,
                              proofMimeType: uploaded.fileMimeType,
                            } }));
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveServiceProof.mutate({
                              serviceTypeId: service.id,
                              proofLink: draft.proofLink,
                              proofFileName: draft.proofFileName,
                              proofFileData: draft.proofFileData,
                              proofMimeType: draft.proofMimeType,
                              expiryDate: draft.expiryDate,
                            })}
                            disabled={saveServiceProof.isPending}
                          >
                            Send request
                          </Button>
                          {draft.proofFileName && <span className="text-xs text-muted-foreground">{draft.proofFileName}</span>}
                        </div>
                      </div>
                    )}
                    {canViewSchedule && (
                      <>
                        <Separator className="my-3" />
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">Service schedule</p>
                              <p className="text-xs text-muted-foreground">
                                {canManageSchedule
                                  ? "Add one or more date/time slots for this service. Each slot becomes its own connected calendar event."
                                  : "View the saved availability slots for this approved service."}
                              </p>
                            </div>
                            {scheduleRequired ? (
                              <Badge variant="secondary" className="text-[10px]">Schedule required</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">{serviceSlots.length} slot{serviceSlots.length !== 1 ? "s" : ""}</Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setScheduleModalServiceId(service.id);
                                setScheduleModalReadOnly(!canManageSchedule);
                              }}
                            >
                              {canManageSchedule ? "Set schedule" : "View availability"}
                            </Button>
                            {serviceSlots.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {serviceSlots.length} slot{serviceSlots.length !== 1 ? "s" : ""} captured
                              </span>
                            )}
                          </div>
                          {scheduleNoticeByServiceId[service.id] && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              {scheduleNoticeByServiceId[service.id]}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <Dialog
          open={Boolean(manualApprovalServiceId)}
          onOpenChange={(open) => {
            if (!open && !manualApproveService.isPending) setManualApprovalServiceId(null);
          }}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Manually approve {manualApprovalService?.name ?? "service"}</DialogTitle>
              <DialogDescription>
                Use this override only when BFM already holds suitable evidence. Add at least one new file, URL, or written note.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manual-approval-url">Supporting URL</Label>
                <Input
                  id="manual-approval-url"
                  type="url"
                  placeholder="https://…"
                  value={manualApprovalDraft.proofLink}
                  onChange={(event) => setManualApprovalDraft((draft) => ({ ...draft, proofLink: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-approval-file">Supporting file</Label>
                <Input
                  id="manual-approval-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      setManualApprovalDraft((draft) => ({ ...draft, proofFileName: "", proofFileData: "", proofMimeType: "" }));
                      return;
                    }
                    const uploaded = await fileToDataUrl(file);
                    setManualApprovalDraft((draft) => ({
                      ...draft,
                      proofFileName: uploaded.fileName,
                      proofFileData: uploaded.fileData,
                      proofMimeType: uploaded.fileMimeType,
                    }));
                  }}
                />
                {manualApprovalDraft.proofFileName && <p className="text-xs text-muted-foreground">{manualApprovalDraft.proofFileName}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-approval-note">Written evidence note</Label>
                <Textarea
                  id="manual-approval-note"
                  rows={4}
                  maxLength={5000}
                  placeholder="Describe the evidence BFM holds and why it supports approval."
                  value={manualApprovalDraft.evidenceNote}
                  onChange={(event) => setManualApprovalDraft((draft) => ({ ...draft, evidenceNote: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-approval-expiry">Optional expiry date</Label>
                <Input
                  id="manual-approval-expiry"
                  type="date"
                  min={expiryMinDate}
                  value={manualApprovalDraft.expiryDate}
                  onChange={(event) => setManualApprovalDraft((draft) => ({ ...draft, expiryDate: event.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Leave blank for an indefinite approval.</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setManualApprovalServiceId(null)}
                disabled={manualApproveService.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!manualApprovalServiceId) return;
                  manualApproveService.mutate({ serviceTypeId: manualApprovalServiceId, ...manualApprovalDraft });
                }}
                disabled={manualApproveService.isPending || !(
                  manualApprovalDraft.proofFileData
                  || manualApprovalDraft.proofLink.trim()
                  || manualApprovalDraft.evidenceNote.trim()
                )}
                data-testid="button-confirm-manual-service-approval"
              >
                {manualApproveService.isPending ? "Approving…" : "Approve service"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ServiceScheduleModal
          open={Boolean(scheduleModalServiceId)}
          onOpenChange={(open) => {
            if (!open) {
              setScheduleModalServiceId(null);
              setScheduleModalReadOnly(false);
              setScheduleModalNotice(null);
            }
          }}
          service={scheduleModalService}
          slots={scheduleModalRows}
          isSaving={saveServiceScheduleSlots.isPending}
          readOnly={scheduleModalReadOnly}
          notice={scheduleModalNotice}
          onSave={(rows) => {
            if (!scheduleModalService) return;
            saveServiceScheduleSlots.mutate({
              serviceTypeId: scheduleModalService.id,
              rows,
            });
          }}
        />
        <Separator className="my-4" />
        {(() => {
          // Hide+clear sub-type pickers when their parent mediation type is not selected.
          const types = asArr<string>(draft.mediationTypes);
          const setTypes = (v: string[]) => {
            const next: Record<string, unknown> = { mediationTypes: v };
            if (!v.includes("Family")) next.familySubTypes = [];
            if (!v.includes("Workplace")) next.workplaceSubTypes = [];
            if (!v.includes("Civil")) next.civilSubTypes = [];
            if (!v.includes("Commercial")) next.commercialSubTypes = [];
            if (!v.includes("Other")) next.otherSubTypes = [];
            setDraft((d) => ({ ...d, ...next }));
          };
          return (
            <>
              <FieldRow label="Mediation types" mandatory={mandatoryFor("mediationTypes")} error={errors.mediationTypes}><div aria-required={isMandatory("mediationTypes")}><MultiCheck value={types} options={MEDIATION_CATEGORIES} onChange={setTypes} /></div></FieldRow>
              {types.includes("Family") && <FieldRow label="Family sub-types" mandatory={mandatoryFor("familySubTypes")}><MultiCheck value={asArr(draft.familySubTypes)} options={FAMILY_CASE_SUBTYPES} onChange={(v) => set("familySubTypes", v as never)} /></FieldRow>}
              {types.includes("Workplace") && <FieldRow label="Workplace sub-types" mandatory={mandatoryFor("workplaceSubTypes")}><MultiCheck value={asArr(draft.workplaceSubTypes)} options={WORKPLACE_CASE_SUBTYPES} onChange={(v) => set("workplaceSubTypes", v as never)} /></FieldRow>}
              {types.includes("Civil") && <FieldRow label="Civil sub-types" mandatory={mandatoryFor("civilSubTypes")}><MultiCheck value={asArr(draft.civilSubTypes)} options={CIVIL_CASE_SUBTYPES} onChange={(v) => set("civilSubTypes", v as never)} /></FieldRow>}
              {types.includes("Commercial") && <FieldRow label="Commercial sub-types" mandatory={mandatoryFor("commercialSubTypes")}><MultiCheck value={asArr(draft.commercialSubTypes)} options={COMMERCIAL_CASE_SUBTYPES} onChange={(v) => set("commercialSubTypes", v as never)} /></FieldRow>}
              {types.includes("Other") && <FieldRow label="Other sub-types" mandatory={mandatoryFor("otherSubTypes")}><MultiCheck value={asArr(draft.otherSubTypes)} options={OTHER_CASE_SUBTYPES} onChange={(v) => set("otherSubTypes", v as never)} /></FieldRow>}
            </>
          );
        })()}
        {/* Task #222 — Specialisms multi-select with self-add for bespoke values. */}
        {(() => {
          const current = asArr<string>(draft.specialisms);
          const presetSet = new Set(MEDIATOR_SPECIALISMS as readonly string[]);
          const bespoke = current.filter((s) => !presetSet.has(s));
          const addBespoke = () => {
            const v = specialismDraft.trim();
            if (!v) return;
            if (current.includes(v)) { setSpecialismDraft(""); return; }
            set("specialisms", [...current, v] as never);
            setSpecialismDraft("");
          };
          return (
            <FieldRow label="Specialisms" mandatory={mandatoryFor("specialisms")} hint="Tick from the standard list; add bespoke values below.">
              <div className="space-y-3">
                <MultiCheck
                  value={current}
                  options={MEDIATOR_SPECIALISMS}
                  onChange={(v) => {
                    // Merge: preserve any bespoke (non-preset) entries the user already added.
                    const next = [...v, ...bespoke.filter((b) => !v.includes(b))];
                    set("specialisms", next as never);
                  }}
                  testId="multicheck-specialisms"
                />
                {bespoke.length > 0 && (
                  <div className="flex flex-wrap gap-2" data-testid="list-specialisms-bespoke">
                    {bespoke.map((b) => (
                      <Badge key={b} variant="outline" className="gap-1">
                        {b}
                        <button
                          type="button"
                          className="ml-1 text-muted-foreground hover:text-destructive"
                          onClick={() => set("specialisms", current.filter((x) => x !== b) as never)}
                          data-testid={`button-remove-specialism-${b}`}
                          aria-label={`Remove ${b}`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {canEdit && (
                  <div className="flex gap-2">
                    <Input
                      value={specialismDraft}
                      onChange={(e) => setSpecialismDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addBespoke(); } }}
                      placeholder="Add a bespoke specialism…"
                      data-testid="input-specialism-bespoke"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addBespoke} data-testid="button-add-specialism">
                      <Plus className="w-4 h-4 mr-1" />Add
                    </Button>
                  </div>
                )}
              </div>
            </FieldRow>
          );
        })()}
        <FieldRow label="Court form packages" mandatory={mandatoryFor("courtFormPackages")}><MultiCheck value={asArr(draft.courtFormPackages)} options={COURT_FORM_PACKAGES} onChange={(v) => set("courtFormPackages", v as never)} /></FieldRow>
        <FieldRow label="MoJ voucher eligible" mandatory={mandatoryFor("mojVoucherEligible")}><Switch checked={asBool(draft.mojVoucherEligible)} onCheckedChange={(v) => set("mojVoucherEligible", v)} /></FieldRow>
        <FieldRow label="Can supervise WTAs" mandatory={mandatoryFor("canSuperviseWtas")}><Switch checked={asBool(draft.canSuperviseWtas)} onCheckedChange={(v) => set("canSuperviseWtas", v)} /></FieldRow>
        <FieldRow label="Co-mediation cap" mandatory={mandatoryFor("coMediationCap")} error={errors.coMediationCap}><Input type="number" value={asNum(draft.coMediationCap)} onChange={(e) => set("coMediationCap", parseInt(e.target.value || "0"))} /></FieldRow>
        <FieldRow label="High-conflict opt-in" mandatory={mandatoryFor("highConflictOptIn")}><Switch checked={asBool(draft.highConflictOptIn)} onCheckedChange={(v) => set("highConflictOptIn", v)} /></FieldRow>
        <FieldRow label="Safeguarding-flagged opt-in" mandatory={mandatoryFor("safeguardingFlaggedOptIn")}><Switch checked={asBool(draft.safeguardingFlaggedOptIn)} onCheckedChange={(v) => set("safeguardingFlaggedOptIn", v)} /></FieldRow>
        <FieldRow label="Geographic coverage" mandatory={mandatoryFor("geographicCoverageAreas")} hint="Tick every region the mediator covers (online-only is a valid choice).">
          <MultiCheck
            value={asArr(draft.geographicCoverageAreas)}
            options={GEOGRAPHIC_COVERAGE_PRESETS}
            onChange={(v) => set("geographicCoverageAreas", v as never)}
            testId="multicheck-geographic-coverage"
          />
        </FieldRow>
        <FieldRow label="Coverage notes (free text)" mandatory={mandatoryFor("geographicCoverage")} hint="Optional — for unusual catchments not captured above."><Textarea value={asStr(draft.geographicCoverage)} onChange={(e) => set("geographicCoverage", e.target.value)} placeholder="e.g. Cross-border (UK/EU) commercial mediations…" /></FieldRow>

        <SaveBar canEdit={canEdit} isPending={patch.isPending || servicesPatch.isPending} onSave={onSave} onReset={onReset} />
      </CardContent>
    </Card>
  );
}

// =====================================================
// Bio tab (Section E) — with approval workflow
// =====================================================
function BioTab({ id, bundle, role }: TabProps) {
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const canEditBody = role === "superadmin" || role === "mediator";
  // Subadmin approves; Superadmin can override at any stage.
  const canApprove = role === "subadmin" || role === "superadmin";
  const { toast } = useToast();
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_E_FIELD_META, role);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Conditional rows: hide language/skill detail fields from required-check
  // when their parent toggle is off.
  const sectionEVisible = (key: string) => {
    if (key === "languagesSpoken") return asBool(draft.speaksOtherLanguages);
    if (key === "specificSkills") return asBool(draft.hasSpecificSkills);
    return true;
  };
  const validateBio = (forSubmission = false): boolean => {
    const errs = checkRequired(SECTION_E_FIELD_META, draft as Record<string, unknown>, sectionEVisible, forSubmission || requiresMediatorProfileCompletion(role));
    if (forSubmission && !hasPublishableMediatorBio(draft.bioShort, draft.bioLong)) {
      errs.bioShort = errs.bioShort ?? "Short bio and long bio are required for submission";
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return false;
    }
    setErrors({});
    return true;
  };
  const versions = useQuery<MediatorBioVersion[]>({ queryKey: ["/api/mediators", id, "bio-versions"] });

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/bio/submit`, { bioLong: draft.bioLong, bioShort: draft.bioShort }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "bio-versions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "profile"] });
      toast({ title: "Bio submitted for approval" });
    },
  });

  const review = useMutation({
    mutationFn: ({ versionId, decision, notes }: { versionId: string; decision: "approved" | "rejected"; notes?: string }) =>
      apiRequest("POST", `/api/mediators/${id}/bio/${versionId}/review`, { decision, reviewNotes: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "bio-versions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "profile"] });
      toast({ title: "Bio review recorded" });
    },
  });

  const pending = (versions.data ?? []).find((v) => v.status === "pending");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Public bio</CardTitle>
          <CardDescription>
            Section E — published copy for booking pages. Status: <Badge variant="outline">{asStr(profile.bioStatus, "draft")}</Badge>
            {role === "superadmin" && <span className="block mt-1">You can save an incomplete draft. Submission requires both short and long bio text.</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldRow label="Short bio (1–2 sentences)" mandatory={mandatoryFor("bioShort")} error={errors.bioShort}><Textarea rows={3} value={asStr(draft.bioShort)} aria-required={isMandatory("bioShort")} onChange={(e) => set("bioShort", e.target.value)} data-testid="textarea-bio-short" /></FieldRow>
          <FieldRow label="Long bio" mandatory={mandatoryFor("bioLong")} error={errors.bioLong}><Textarea rows={8} value={asStr(draft.bioLong)} aria-required={isMandatory("bioLong")} onChange={(e) => set("bioLong", e.target.value)} data-testid="textarea-bio-long" /></FieldRow>
          <FieldRow label="Speaks other languages" mandatory={mandatoryFor("speaksOtherLanguages")}><Switch checked={asBool(draft.speaksOtherLanguages)} onCheckedChange={(v) => set("speaksOtherLanguages", v)} /></FieldRow>
          {asBool(draft.speaksOtherLanguages) && (
            <FieldRow label="Languages spoken (comma)" mandatory={mandatoryFor("languagesSpoken")}>
              <Input value={asArr<string>(draft.languagesSpoken).join(", ")} onChange={(e) => set("languagesSpoken", e.target.value.split(",").map((s) => s.trim()).filter(Boolean) as never)} />
            </FieldRow>
          )}
          <FieldRow label="Has specific skills" mandatory={mandatoryFor("hasSpecificSkills")}><Switch checked={asBool(draft.hasSpecificSkills)} onCheckedChange={(v) => set("hasSpecificSkills", v)} /></FieldRow>
          {asBool(draft.hasSpecificSkills) && (
            <FieldRow label="Specific skills (comma)" mandatory={mandatoryFor("specificSkills")}>
              <Input value={asArr<string>(draft.specificSkills).join(", ")} onChange={(e) => set("specificSkills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean) as never)} />
            </FieldRow>
          )}
          {/* Task #219 — moved here from the Credentials tab per BFM spec. */}
          <FieldRow label="Practises at firms" mandatory={mandatoryFor("practisesAtFirms")} hint="Comma-separated list of firms or panels">
            <Input
              value={asArr<string>(draft.practisesAtFirms).join(", ")}
              onChange={(e) => set("practisesAtFirms", e.target.value.split(",").map((s) => s.trim()).filter(Boolean) as never)}
              data-testid="input-practises-at-firms"
            />
          </FieldRow>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            {canEditBody && (
              <>
                <Button variant="ghost" onClick={() => { setDraft(profile); setErrors({}); }} disabled={patch.isPending}>Reset</Button>
                <Button variant="outline" onClick={() => { if (validateBio()) patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never); }} disabled={patch.isPending}>
                  <Save className="w-4 h-4 mr-2" />Save draft
                </Button>
                <Button onClick={() => { if (validateBio(true)) submit.mutate(); }} disabled={submit.isPending} data-testid="button-submit-bio">
                  Submit for approval
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bio history</CardTitle></CardHeader>
        <CardContent>
          {pending && canApprove && (
            <Alert className="mb-4">
              <Clock className="h-4 w-4" />
              <AlertTitle>Pending approval</AlertTitle>
              <AlertDescription className="mt-2 space-y-2">
                <Textarea placeholder="Optional review notes…" id="review-notes" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => {
                    const el = document.getElementById("review-notes") as HTMLTextAreaElement | null;
                    review.mutate({ versionId: pending.id, decision: "approved", notes: el?.value });
                  }} data-testid="button-approve-bio"><CheckCircle2 className="w-4 h-4 mr-1" />Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => {
                    const el = document.getElementById("review-notes") as HTMLTextAreaElement | null;
                    review.mutate({ versionId: pending.id, decision: "rejected", notes: el?.value });
                  }} data-testid="button-reject-bio"><XCircle className="w-4 h-4 mr-1" />Reject</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader><TableRow><TableHead>Submitted</TableHead><TableHead>Status</TableHead><TableHead>Reviewer</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
            <TableBody>
              {(versions.data ?? []).map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="text-xs">{v.submittedAt ? new Date(v.submittedAt).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant={v.status === "approved" ? "default" : v.status === "rejected" ? "destructive" : "outline"}>{v.status}</Badge></TableCell>
                  <TableCell className="text-xs">{v.reviewedBy ?? "—"}</TableCell>
                  <TableCell className="text-xs">{v.reviewNotes ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!versions.data?.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center">No bio history yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================
// Availability tab (Section F)
// =====================================================
// Task #226 — Availability tab draft carries synthetic `zoomLink` (lives on
// users, surfaced via bundle) and the per-day working-hours map alongside
// the standard mediator_profiles columns.
type AvailabilityHoursEntry = {
  start: string;
  end: string;
  lunchStart?: string | null;
  lunchEnd?: string | null;
};
type AvailabilityDraft = Partial<MediatorProfile> & {
  zoomLink?: string | null;
  workingHoursByDay?: Record<string, AvailabilityHoursEntry> | null;
};

const WORKING_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function asHoursMap(v: unknown): Record<string, AvailabilityHoursEntry> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, AvailabilityHoursEntry>;
}

function AvailabilityTab({ id, bundle, role, actorId }: TabProps) {
  const { profile } = bundle;
  // Task #226 — `calendarConnected` is a Y-mandatory Section F row, but its
  // value lives on the users row (resolved from the live OAuth flag in the
  // bundle), not on mediator_profiles. Project it into the draft as a
  // boolean so the metadata-driven `checkRequired` flow sees it without
  // demanding an empty-string check (booleans are intentionally skipped by
  // `checkRequired`). Server-side `validateSectionRequired` also ignores it
  // because the key is never present in a PATCH body.
  const calendarProfile = profile as {
    googleCalendarConnected?: boolean;
    outlookCalendarConnected?: boolean;
    activeCalendarProvider?: "google" | "outlook" | null;
  };
  const activeCalendarProvider = calendarProfile.activeCalendarProvider ?? null;
  const calendarReady = (activeCalendarProvider === "google" && !!calendarProfile.googleCalendarConnected)
    || (activeCalendarProvider === "outlook" && !!calendarProfile.outlookCalendarConnected);
  const seededProfile: AvailabilityDraft = {
    ...(profile as AvailabilityDraft),
    calendarConnected: calendarReady,
  } as AvailabilityDraft & { calendarConnected: boolean };
  const { draft, set, setDraft } = useSectionForm<AvailabilityDraft>(seededProfile);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_F_FIELD_META, role);
  const canEdit = role === "superadmin" || role === "subadmin" || role === "mediator";

  const selectedDays = asArr<string>(draft.workingDays);
  const hoursMap = useMemo(() => asHoursMap(draft.workingHoursByDay), [draft.workingHoursByDay]);

  // When a working day is added, seed its hours from an existing entry (or
  // 09:00–17:00 fallback). When a day is removed, drop its entry.
  const setWorkingDays = (next: string[]) => {
    const ordered = WORKING_DAYS.filter((d) => next.includes(d));
    const fallback = Object.values(hoursMap)[0] ?? { start: "09:00", end: "17:00" };
    const nextMap: Record<string, AvailabilityHoursEntry> = {};
    for (const d of ordered) {
      nextMap[d] = hoursMap[d] ?? { start: fallback.start, end: fallback.end };
    }
    setDraft((prev) => ({ ...prev, workingDays: ordered, workingHoursByDay: nextMap }));
  };

  const setHourField = (
    day: string,
    field: "start" | "end" | "lunchStart" | "lunchEnd",
    value: string,
  ) => {
    setDraft((prev) => {
      const current = asHoursMap(prev.workingHoursByDay);
      const entry: AvailabilityHoursEntry = {
        start: current[day]?.start ?? "09:00",
        end: current[day]?.end ?? "17:00",
        lunchStart: current[day]?.lunchStart ?? null,
        lunchEnd: current[day]?.lunchEnd ?? null,
      };
      if (field === "lunchStart" || field === "lunchEnd") {
        entry[field] = value === "" ? null : value;
      } else {
        entry[field] = value;
      }
      return { ...prev, workingHoursByDay: { ...current, [day]: entry } };
    });
  };

  const onSave = () => {
    // Local required-field check — server re-validates with the merged
    // context, including the per-day coverage + lunch-within-window rules.
    const draftRec = draft as Record<string, unknown>;
    // `calendarConnected` is Y-mandatory but its value is a boolean projected
    // from the live OAuth flag — `checkRequired` skips booleans, so the
    // explicit live-state check below is what actually enforces the
    // requirement client-side. `holidayCalendar` is Rec and is also skipped.
    const requireComplete = requiresMediatorProfileCompletion(role);
    const errs = checkRequired(SECTION_F_FIELD_META, draftRec, undefined, requireComplete);
    // Extra per-day coverage check — UX symmetry with server validator.
    if (!errs.workingHoursByDay) {
      for (const d of selectedDays) {
        const entry = hoursMap[d];
        if ((!entry || !entry.start || !entry.end) && requireComplete) {
          errs.workingHoursByDay = `Working hours for ${d} are required`;
          break;
        }
        if (!entry || (!entry.start && !entry.end && !entry.lunchStart && !entry.lunchEnd)) continue;
        if (!entry.start || !entry.end) {
          errs.workingHoursByDay = `Working hours for ${d} must have a start and end`;
          break;
        }
        if (entry.start >= entry.end) {
          errs.workingHoursByDay = `Working hours for ${d}: start must be before end`;
          break;
        }
        if (entry.lunchStart && entry.lunchEnd) {
          if (entry.lunchStart >= entry.lunchEnd) {
            errs.workingHoursByDay = `Lunch for ${d}: start must be before end`;
            break;
          }
          if (entry.lunchStart < entry.start || entry.lunchEnd > entry.end) {
            errs.workingHoursByDay = `Lunch for ${d} must sit inside working hours`;
            break;
          }
        }
      }
    }
    // Calendar sync is mandatory but lives outside the patch — surface a
    // single inline error if it's still disconnected when the user saves.
    if (requireComplete && !calendarReady) {
      errs.calendarConnected = "Calendar sync is required — connect your calendar to continue.";
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };

  return (
    <div className="space-y-4">
      <CalendarSyncCard
        bundle={bundle}
        viewingSelf={actorId === id}
        error={errors.calendarConnected}
        requiredForProfile={requiresMediatorProfileCompletion(role)}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" />Working pattern</CardTitle>
          <CardDescription>Section F — preferred working days, hours per day, hours-per-week willing to take, and the recurring Zoom link used for all sessions. Service slots are managed below by superadmins or by mediators in Service offering.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldRow label="Working days" mandatory={mandatoryFor("workingDays")} error={errors.workingDays}>
            <div aria-required={isMandatory("workingDays")}>
              <MultiCheck
                value={selectedDays}
                options={WORKING_DAYS}
                onChange={(v) => setWorkingDays(v)}
                testId="checks-working-days"
              />
            </div>
          </FieldRow>
          <FieldRow
            label="Working hours per day"
            mandatory={mandatoryFor("workingHoursByDay")}
            hint="Set start and end for each working day (lunch break optional and excluded from booking)."
            error={errors.workingHoursByDay}
          >
            {selectedDays.length === 0 ? (
              <p className="text-sm text-muted-foreground italic" data-testid="text-no-working-days">
                Pick at least one working day above to set its hours.
              </p>
            ) : (
              <div className="space-y-2" data-testid="grid-working-hours">
                <div className="hidden md:grid grid-cols-[60px_1fr_1fr_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground px-1">
                  <div>Day</div><div>Start</div><div>End</div><div>Lunch start</div><div>Lunch end</div>
                </div>
                {WORKING_DAYS.filter((d) => selectedDays.includes(d)).map((d) => {
                  const entry = hoursMap[d] ?? { start: "", end: "", lunchStart: null, lunchEnd: null };
                  return (
                    <div key={d} className="grid grid-cols-2 md:grid-cols-[60px_1fr_1fr_1fr_1fr] gap-2 items-center" data-testid={`row-hours-${d}`}>
                      <div className="font-medium text-sm md:text-center">{d}</div>
                      <Input type="time" value={entry.start ?? ""} disabled={!canEdit} onChange={(e) => setHourField(d, "start", e.target.value)} data-testid={`input-start-${d}`} />
                      <Input type="time" value={entry.end ?? ""} disabled={!canEdit} onChange={(e) => setHourField(d, "end", e.target.value)} data-testid={`input-end-${d}`} />
                      <Input type="time" value={entry.lunchStart ?? ""} disabled={!canEdit} onChange={(e) => setHourField(d, "lunchStart", e.target.value)} placeholder="—" data-testid={`input-lunch-start-${d}`} />
                      <Input type="time" value={entry.lunchEnd ?? ""} disabled={!canEdit} onChange={(e) => setHourField(d, "lunchEnd", e.target.value)} placeholder="—" data-testid={`input-lunch-end-${d}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </FieldRow>
          <FieldRow
            label="Hours per week willing to take"
            mandatory={mandatoryFor("hoursPerWeekCap")}
            hint="Used by the case allocator to balance workload across the panel."
            error={errors.hoursPerWeekCap}
          >
            <Input
              type="number"
              min={1}
              max={80}
              value={asNum(draft.hoursPerWeekCap)}
              disabled={!canEdit}
              aria-required={isMandatory("hoursPerWeekCap")}
              onChange={(e) => set("hoursPerWeekCap", (parseInt(e.target.value || "0") || null) as never)}
              data-testid="input-hours-per-week"
              className="w-32"
            />
          </FieldRow>
          <FieldRow
            label="Recurring Zoom link"
            mandatory={mandatoryFor("zoomLink")}
            hint={
              <span className="inline-flex items-center gap-1">
                <Video className="w-3.5 h-3.5" />
                Used for every session unless overridden on the booking.{" "}
                <a
                  href="https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0061226"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                  data-testid="link-zoom-kb"
                >
                  How to create a recurring Zoom meeting <ExternalLink className="w-3 h-3" />
                </a>
              </span>
            }
            error={errors.zoomLink}
          >
            <Input
              type="url"
              value={asStr(draft.zoomLink)}
              disabled={!canEdit}
              aria-required={isMandatory("zoomLink")}
              placeholder="https://us02web.zoom.us/j/…?pwd=…"
              onChange={(e) => set("zoomLink", e.target.value as never)}
              data-testid="input-zoom-link"
            />
          </FieldRow>
          <SaveBar
            canEdit={canEdit}
            isPending={patch.isPending}
            onSave={onSave}
            onReset={() => { setDraft(seededProfile); setErrors({}); }}
          />
        </CardContent>
      </Card>
      {role === "superadmin" && <SuperadminServiceScheduleSection id={id} calendarReady={calendarReady} />}
      <HolidaysSection id={id} canEdit={canEdit} />
    </div>
  );
}

function SuperadminServiceScheduleSection({ id, calendarReady }: { id: string; calendarReady: boolean }) {
  const { toast } = useToast();
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [noticeByServiceId, setNoticeByServiceId] = useState<Record<string, string>>({});
  const serviceTypes = useQuery<ServiceType[]>({ queryKey: ["/api/service-types"] });
  const assignments = useQuery<MediatorServiceAssignment[]>({ queryKey: ["/api/mediators", id, "services"], enabled: !!id });
  const approvals = useQuery<Array<{ serviceTypeId: string; status: string; effectiveStatus?: string; scheduleSlots?: ServiceScheduleSlotRow[] }>>({
    queryKey: ["/api/mediators", id, "service-approvals"], enabled: !!id,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always",
  });
  const scheduleSlots = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", id, "service-schedule-slots"], enabled: !!id,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always",
  });
  const exactSlots = useQuery<ServiceScheduleSlotRow[]>({
    queryKey: ["/api/mediators", id, "service-approvals", selectedServiceId, "schedule-slots"],
    enabled: !!id && !!selectedServiceId,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always",
  });
  const assignedIds = new Set([...(assignments.data ?? []).map((assignment) => assignment.serviceTypeId), ...(approvals.data ?? []).map((row) => row.serviceTypeId)]);
  const services = (serviceTypes.data ?? []).filter((service) => service.isActive && assignedIds.has(service.id));
  const selectedService = services.find((service) => service.id === selectedServiceId) ?? null;
  const selectedOriginalSlots = exactSlots.data
    ?? approvals.data?.find((row) => row.serviceTypeId === selectedServiceId)?.scheduleSlots
    ?? (scheduleSlots.data ?? []).filter((row) => row.serviceTypeId === selectedServiceId);
  const saveSlots = useMutation({
    mutationFn: async (rows: ServiceScheduleSlotDraft[]) => {
      if (!selectedServiceId) throw new Error("Select a service first.");
      return saveMediatorServiceSchedule({
        mediatorId: id,
        serviceTypeId: selectedServiceId,
        originalSlots: selectedOriginalSlots,
        rows,
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "service-approvals", selectedServiceId, "schedule-slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/appointments"] });
      const message = result.preservedCount > 0
        ? `Saved with ${result.preservedCount} booked slot(s) kept in place.`
        : "The service schedule was saved and synced to the mediator's connected calendar.";
      toast({ title: "Schedule saved", description: message });
      if (selectedServiceId) {
        setNoticeByServiceId((current) => ({ ...current, [selectedServiceId]: result.preservedCount > 0 ? message : "" }));
      }
      if (result.preservedCount === 0) setSelectedServiceId(null);
    },
    onError: (error: unknown) => toast({ title: "Could not save schedule", description: (error as Error).message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-superadmin-service-schedules">
      <CardHeader>
        <CardTitle>Service availability slots</CardTitle>
        <CardDescription>Manage slots for the mediator's approved services. Each saved slot syncs to their active calendar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!calendarReady && (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            The mediator must connect and choose an active calendar in their Settings before slots can be saved.
          </p>
        )}
        {assignments.isError || approvals.isError || serviceTypes.isError || scheduleSlots.isError ? (
          <p className="text-sm text-destructive">Could not load service availability. Refresh the page and try again.</p>
        ) : null}
        {selectedServiceId && exactSlots.isError && (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive">Could not load this service's slots.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedServiceId(null)}>Dismiss</Button>
          </div>
        )}
        {!assignments.isLoading && !approvals.isLoading && !serviceTypes.isLoading && services.length === 0 && (
          <p className="text-sm text-muted-foreground">No active services are assigned. Add a service in Service offering first.</p>
        )}
        {services.map((service) => {
          const approval = approvals.data?.find((row) => row.serviceTypeId === service.id);
          const approved = (approval?.effectiveStatus ?? approval?.status) === "approved";
          const count = (scheduleSlots.data ?? []).filter((row) => row.serviceTypeId === service.id).length;
          return (
            <div key={service.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{service.name}</p>
                <p className="text-xs text-muted-foreground">
                  {approved ? `${count} saved slot${count === 1 ? "" : "s"}` : "Approve this service in Service offering before scheduling."}
                </p>
                {noticeByServiceId[service.id] && <p className="mt-1 text-xs text-amber-800">{noticeByServiceId[service.id]}</p>}
              </div>
              <Button type="button" size="sm" variant="outline" disabled={!approved || !calendarReady || scheduleSlots.isLoading || scheduleSlots.isError}
                onClick={() => setSelectedServiceId(service.id)} data-testid={`button-manage-service-slots-${service.id}`}>
                Manage slots
              </Button>
            </div>
          );
        })}
      </CardContent>
      <ServiceScheduleModal
        open={Boolean(selectedServiceId && exactSlots.data)}
        onOpenChange={(open) => { if (!open && !saveSlots.isPending) setSelectedServiceId(null); }}
        service={selectedService}
        slots={exactSlots.data ?? []}
        isSaving={saveSlots.isPending}
        notice={selectedServiceId ? noticeByServiceId[selectedServiceId] : null}
        onSave={(rows) => saveSlots.mutate(rows)}
      />
    </Card>
  );
}

// Task #226 — Calendar sync mini-card. Renders the live OAuth state for the
// mediator being viewed (data comes from the profile bundle so we don't need
// a second round-trip). Shows distinct badges for Connected /
// Reauthentication required / Disconnected and a CTA that points at the
// mediator's own /settings page when they're viewing their own profile, or a
// neutral note when staff are viewing someone else's tab (they can't OAuth
// on the mediator's behalf — the mediator has to do it themselves).
function CalendarSyncCard({
  bundle, viewingSelf, error, requiredForProfile,
}: {
  bundle: ProfileBundle;
  viewingSelf: boolean;
  error?: string;
  requiredForProfile: boolean;
}) {
  const p = bundle.profile as {
    googleCalendarConnected?: boolean;
    googleCalendarEmail?: string | null;
    lastCalendarSyncAt?: string | null;
    lastCalendarSyncError?: string | null;
    outlookCalendarConnected?: boolean;
    outlookCalendarEmail?: string | null;
    lastOutlookSyncAt?: string | null;
    lastOutlookSyncError?: string | null;
    activeCalendarProvider?: "google" | "outlook" | null;
  };
  const activeCalendarProvider = p.activeCalendarProvider ?? null;
  const googleReady = activeCalendarProvider === "google" && !!p.googleCalendarConnected;
  const outlookReady = activeCalendarProvider === "outlook" && !!p.outlookCalendarConnected;
  const connected = googleReady || outlookReady;
  const hasConnectedProvider = !!p.googleCalendarConnected || !!p.outlookCalendarConnected;
  const needsReauth = activeCalendarProvider === "outlook"
    ? p.lastOutlookSyncError === "needs_reauth"
    : p.lastCalendarSyncError === "needs_reauth";
  const needsWriteScope = activeCalendarProvider === "outlook"
    ? p.lastOutlookSyncError === "needs_write_scope"
    : p.lastCalendarSyncError === "needs_write_scope";
  const activeProviderLabel = activeCalendarProvider === "outlook" ? "Microsoft Outlook" : activeCalendarProvider === "google" ? "Google Calendar" : "Calendar";
  const activeProviderEmail = activeCalendarProvider === "outlook" ? p.outlookCalendarEmail : activeCalendarProvider === "google" ? p.googleCalendarEmail : null;
  const activeProviderLastSync = activeCalendarProvider === "outlook" ? p.lastOutlookSyncAt : activeCalendarProvider === "google" ? p.lastCalendarSyncAt : null;
  let state: "connected" | "choose" | "reauth" | "scope" | "disconnected" = "disconnected";
  if (connected && !needsReauth && !needsWriteScope) state = "connected";
  else if (needsReauth) state = "reauth";
  else if (needsWriteScope) state = "scope";
  else if (hasConnectedProvider && !activeCalendarProvider) state = "choose";

  const badge = (() => {
    if (state === "connected") return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" data-testid="badge-calendar-connected"><CheckCircle2 className="w-3 h-3 mr-1" />Connected</Badge>;
    if (state === "choose") return <Badge variant="secondary" data-testid="badge-calendar-choose-provider"><AlertTriangle className="w-3 h-3 mr-1" />Choose active calendar</Badge>;
    if (state === "reauth") return <Badge variant="destructive" data-testid="badge-calendar-reauth"><RefreshCw className="w-3 h-3 mr-1" />Reauthentication required</Badge>;
    if (state === "scope") return <Badge variant="destructive" data-testid="badge-calendar-scope"><Shield className="w-3 h-3 mr-1" />Permission upgrade required</Badge>;
    return <Badge variant="outline" data-testid="badge-calendar-disconnected"><XCircle className="w-3 h-3 mr-1" />Disconnected</Badge>;
  })();

  const isError = state !== "connected";
  return (
    <Card className={isError ? "border-destructive/40" : undefined} data-testid="card-calendar-sync">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 mt-0.5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Calendar sync (OAuth)
                {requiredForProfile && <MandatoryMarker level="Y" />}
              </CardTitle>
              <CardDescription className="mt-1">
                {requiredForProfile
                  ? "Required so the booking engine can detect conflicts and write confirmed sessions back to your calendar."
                  : "A connected calendar is needed to publish service availability slots, but not to save this working pattern."}
              </CardDescription>
            </div>
          </div>
          {badge}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {connected && activeProviderEmail && (
          <p className="text-sm" data-testid="text-calendar-email">
            <span className="text-muted-foreground">Connected account:</span> <span className="font-medium">{activeProviderLabel} — {activeProviderEmail}</span>
          </p>
        )}
        {connected && activeProviderLastSync && (
          <p className="text-xs text-muted-foreground" data-testid="text-calendar-last-sync">
            Last synced {new Date(activeProviderLastSync).toLocaleString()}
          </p>
        )}
        {state === "reauth" && (
          <p className="text-sm text-destructive">
            The mediator's {activeProviderLabel} sign-in expired. Reconnect to restore sync; existing bookings are unaffected.
          </p>
        )}
        {state === "scope" && (
          <p className="text-sm text-destructive">
            Calendar write permission is missing. Reconnect and accept the calendar write scope so new bookings can be created.
          </p>
        )}
        {state === "choose" && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            A calendar is connected, but no active calendar provider is selected.
          </p>
        )}
        {state === "disconnected" && (
          <p className="text-sm text-muted-foreground">
            Calendar isn't connected yet.
          </p>
        )}
        {error && <p className="text-xs text-destructive" data-testid="text-calendar-required-error">{error}</p>}
        <div className="pt-1">
          {viewingSelf ? (
            <Link href="/settings">
              <Button size="sm" variant={isError ? "default" : "outline"} data-testid="button-calendar-connect">
                <RefreshCw className="w-4 h-4 mr-2" />
                {state === "connected" ? "Manage connection" : state === "choose" ? "Choose active calendar" : state === "disconnected" ? "Connect calendar" : "Reconnect"}
              </Button>
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1" data-testid="text-calendar-self-only">
              <HelpCircle className="w-3 h-3" />
              Only the mediator can connect or choose their own calendar from their Settings page.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HolidaysSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { data } = useQuery<MediatorHoliday[]>({ queryKey: ["/api/mediators", id, "holidays"] });
  const [draft, setDraft] = useState({ startDate: "", endDate: "", label: "" });
  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/holidays`, draft),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "holidays"] }); setDraft({ startDate: "", endDate: "", label: "" }); },
  });
  const remove = useMutation({
    mutationFn: (hid: string) => apiRequest("DELETE", `/api/mediators/${id}/holidays/${hid}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "holidays"] }),
  });
  return (
    <Card data-testid="card-holidays">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Holidays & out-of-office
          <MandatoryMarker level="Rec" />
        </CardTitle>
        <CardDescription>Mediator-managed. Dates listed here auto-block bookable slots on the Appointments calendar.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Label</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.startDate}</TableCell><TableCell>{h.endDate}</TableCell><TableCell>{h.label}</TableCell>
                <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove.mutate(h.id)}><Trash2 className="w-4 h-4" /></Button>}</TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center">No holidays scheduled.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-4">
            <Input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
            <Input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
            <Input placeholder="Label" value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
            <Button onClick={() => create.mutate()} disabled={!draft.startDate || !draft.endDate}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================
// Contracts tab (Section G) — including time-bank ledger
// =====================================================
function ContractsTab({ id, bundle, role }: TabProps) {
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_G_FIELD_META, role);
  const canEdit = role === "superadmin" || role === "subadmin";
  const canOffboard = (role === "superadmin" || role === "subadmin") && (profile?.panelStatus !== "Off-boarded");
  const [offboardOpen, setOffboardOpen] = useState(false);
  const mediatorName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "this mediator";
  const timebankOn = asBool(draft.timebankAgreement);
  const onSave = () => {
    // Hide time-bank rows from required check when the agreement switch is off.
    const errs = checkRequired(
      SECTION_G_FIELD_META,
      draft as Record<string, unknown>,
      (key) => !key.startsWith("timebank") || key === "timebankAgreement" || timebankOn,
      requiresMediatorProfileCompletion(role),
    );
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Contracts & engagement</CardTitle>
            <CardDescription>Section G — engagement type, contract version, panel status, and time-bank pilot terms.</CardDescription>
          </div>
          {canOffboard && (
            <Button variant="destructive" onClick={() => setOffboardOpen(true)} data-testid="button-offboard-mediator">
              Off-board mediator
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <FieldRow label="Engagement type" mandatory={mandatoryFor("engagementType")} error={errors.engagementType}>
            <Select value={asStr(draft.engagementType)} onValueChange={(v) => set("engagementType", v)}>
              <SelectTrigger aria-required={isMandatory("engagementType")}><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{ENGAGEMENT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Contract version" mandatory={mandatoryFor("contractVersion")} error={errors.contractVersion}><Input value={asStr(draft.contractVersion)} aria-required={isMandatory("contractVersion")} onChange={(e) => set("contractVersion", e.target.value)} /></FieldRow>
          <FieldRow label="Contract signed date" mandatory={mandatoryFor("contractSignedDate")} error={errors.contractSignedDate}><Input type="date" value={asStr(draft.contractSignedDate)} aria-required={isMandatory("contractSignedDate")} onChange={(e) => set("contractSignedDate", e.target.value)} /></FieldRow>
          <FieldRow label="Contract file URL" mandatory={mandatoryFor("contractFileUrl")}><Input value={asStr(draft.contractFileUrl)} onChange={(e) => set("contractFileUrl", e.target.value)} /></FieldRow>

          <Separator className="my-4" />
          <p className="text-sm font-medium text-muted-foreground">Time-bank pilot</p>
          <FieldRow label="Time-bank agreement" mandatory={mandatoryFor("timebankAgreement")}><Switch checked={timebankOn} onCheckedChange={(v) => set("timebankAgreement", v)} /></FieldRow>
          {timebankOn && (
            <>
              <FieldRow label="Signed date" mandatory={mandatoryFor("timebankSignedDate")}><Input type="date" value={asStr(draft.timebankSignedDate)} onChange={(e) => set("timebankSignedDate", e.target.value)} /></FieldRow>
              <FieldRow label="Hours per week" mandatory={mandatoryFor("timebankHoursPerWeek")}><Input type="number" value={asNum(draft.timebankHoursPerWeek)} onChange={(e) => set("timebankHoursPerWeek", parseInt(e.target.value || "0") || (null as never))} /></FieldRow>
              <FieldRow label="Check-in day" mandatory={mandatoryFor("timebankCheckinDay")}><Input value={asStr(draft.timebankCheckinDay)} onChange={(e) => set("timebankCheckinDay", e.target.value)} placeholder="e.g. Monday" /></FieldRow>
              <FieldRow label="Check-in time" mandatory={mandatoryFor("timebankCheckinTime")}><Input type="time" value={asStr(draft.timebankCheckinTime)} onChange={(e) => set("timebankCheckinTime", e.target.value)} /></FieldRow>
              <FieldRow label="Hours cap" mandatory={mandatoryFor("timebankHoursCap")}><Input type="number" value={asNum(draft.timebankHoursCap)} onChange={(e) => set("timebankHoursCap", parseInt(e.target.value || "0") || (null as never))} /></FieldRow>
              <FieldRow label="Pilot start" mandatory={mandatoryFor("timebankPilotStart")}><Input type="date" value={asStr(draft.timebankPilotStart)} onChange={(e) => set("timebankPilotStart", e.target.value)} /></FieldRow>
              <FieldRow label="Review date" mandatory={mandatoryFor("timebankReviewDate")}><Input type="date" value={asStr(draft.timebankReviewDate)} onChange={(e) => set("timebankReviewDate", e.target.value)} /></FieldRow>
            </>
          )}

          <Separator className="my-4" />
          <FieldRow label="Onboarding complete" mandatory={mandatoryFor("onboardingComplete")}><Switch checked={asBool(draft.onboardingComplete)} onCheckedChange={(v) => set("onboardingComplete", v)} /></FieldRow>
          <FieldRow label="Panel status" mandatory={mandatoryFor("panelStatus")} error={errors.panelStatus}>
            <Select value={asStr(draft.panelStatus, "Active")} onValueChange={(v) => set("panelStatus", v)}>
              <SelectTrigger aria-required={isMandatory("panelStatus")} data-testid="select-panel-status"><SelectValue /></SelectTrigger>
              <SelectContent>{PANEL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Status reason" mandatory={mandatoryFor("panelStatusReason")}><Textarea value={asStr(draft.panelStatusReason)} onChange={(e) => set("panelStatusReason", e.target.value)} /></FieldRow>
          <FieldRow label="Off-boarding date" mandatory={mandatoryFor("offboardingDate")}><Input type="date" value={asStr(draft.offboardingDate)} onChange={(e) => set("offboardingDate", e.target.value)} /></FieldRow>
          <FieldRow label="Off-boarding reason" mandatory={mandatoryFor("offboardingReason")}><Textarea value={asStr(draft.offboardingReason)} onChange={(e) => set("offboardingReason", e.target.value)} /></FieldRow>

          <SaveBar canEdit={canEdit} isPending={patch.isPending} onSave={onSave} onReset={() => { setDraft(profile); setErrors({}); }} />
        </CardContent>
      </Card>
      <TimebankLedgerSection id={id} canEdit={canEdit} />
      <OffboardDialog open={offboardOpen} onOpenChange={setOffboardOpen} mediatorId={id} mediatorName={mediatorName} />
    </div>
  );
}

function TimebankLedgerSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { data } = useQuery<MediatorTimebankEntry[]>({ queryKey: ["/api/mediators", id, "timebank"] });
  const [draft, setDraft] = useState({ date: "", activity: "", hours: "", type: "earned", approvedByMargaret: false });
  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/timebank`, draft),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "timebank"] }); setDraft({ date: "", activity: "", hours: "", type: "earned", approvedByMargaret: false }); },
  });
  const remove = useMutation({
    mutationFn: (eid: string) => apiRequest("DELETE", `/api/mediators/${id}/timebank/${eid}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "timebank"] }),
  });
  const balance = useMemo(() => {
    let n = 0;
    for (const e of data ?? []) {
      const h = parseFloat(e.hours) || 0;
      n += e.type === "earned" ? h : -h;
    }
    return n;
  }, [data]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Time-bank ledger</CardTitle>
        <CardDescription>Running balance: <strong data-testid="text-timebank-balance">{balance.toFixed(2)} hrs</strong></CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Activity</TableHead><TableHead>Hours</TableHead><TableHead>Type</TableHead><TableHead>Approved</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.date}</TableCell><TableCell>{e.activity}</TableCell><TableCell>{e.hours}</TableCell>
                <TableCell><Badge variant={e.type === "earned" ? "default" : "secondary"}>{e.type}</Badge></TableCell>
                <TableCell>{e.approvedByMargaret ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : "—"}</TableCell>
                <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove.mutate(e.id)}><Trash2 className="w-4 h-4" /></Button>}</TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center">No ledger entries yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-4">
            <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            <Input placeholder="Activity" value={draft.activity} onChange={(e) => setDraft((d) => ({ ...d, activity: e.target.value }))} />
            <Input placeholder="Hours" value={draft.hours} onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))} />
            <Select value={draft.type} onValueChange={(v) => setDraft((d) => ({ ...d, type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="earned">earned</SelectItem><SelectItem value="used">used</SelectItem></SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={draft.approvedByMargaret} onCheckedChange={(v) => setDraft((d) => ({ ...d, approvedByMargaret: v === true }))} />
              Approved
            </label>
            <Button onClick={() => create.mutate()} disabled={!draft.date || !draft.activity || !draft.hours}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================
// Payment tab (Section H) — superadmin-only
// =====================================================
function PaymentTab({ id, bundle, role }: TabProps) {
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_H_FIELD_META, role);
  const canEdit = role === "superadmin";
  // Task #217 — VAT number only applies when vatRegistered is on; hide it
  // from required + shape checks otherwise so a stale value can't block save.
  const sectionHVisible = (key: string) => key !== "vatNumber" || asBool(draft.vatRegistered);
  const onSave = () => {
    const errs = checkRequired(SECTION_H_FIELD_META, draft as Record<string, unknown>, sectionHVisible, requiresMediatorProfileCompletion(role));
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5" />Payment & banking</CardTitle>
        <CardDescription>Section H — superadmin-only banking and tax info.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldRow label="Bank sort code" mandatory={mandatoryFor("bankSortCode")} error={errors.bankSortCode}><Input value={asStr(draft.bankSortCode)} aria-required={isMandatory("bankSortCode")} onChange={(e) => set("bankSortCode", e.target.value)} placeholder="00-00-00" /></FieldRow>
        <FieldRow label="Bank account number" mandatory={mandatoryFor("bankAccountNumber")} error={errors.bankAccountNumber}><Input value={asStr(draft.bankAccountNumber)} aria-required={isMandatory("bankAccountNumber")} onChange={(e) => set("bankAccountNumber", e.target.value)} /></FieldRow>
        <FieldRow label="Account name" mandatory={mandatoryFor("bankAccountName")} error={errors.bankAccountName}><Input value={asStr(draft.bankAccountName)} aria-required={isMandatory("bankAccountName")} onChange={(e) => set("bankAccountName", e.target.value)} /></FieldRow>
        <FieldRow label="VAT registered" mandatory={mandatoryFor("vatRegistered")}><Switch checked={asBool(draft.vatRegistered)} onCheckedChange={(v) => set("vatRegistered", v)} /></FieldRow>
        {asBool(draft.vatRegistered) && (
          <FieldRow label="VAT number" mandatory={mandatoryFor("vatNumber")}><Input value={asStr(draft.vatNumber)} onChange={(e) => set("vatNumber", e.target.value)} /></FieldRow>
        )}
        <FieldRow label="Self-billing agreement" mandatory={mandatoryFor("selfBillingAgreement")}><Switch checked={asBool(draft.selfBillingAgreement)} onCheckedChange={(v) => set("selfBillingAgreement", v)} /></FieldRow>
        <FieldRow label="Self-billing signed date" mandatory={mandatoryFor("selfBillingSignedDate")} error={errors.selfBillingSignedDate}><Input type="date" value={asStr(draft.selfBillingSignedDate)} aria-required={isMandatory("selfBillingSignedDate")} onChange={(e) => set("selfBillingSignedDate", e.target.value)} /></FieldRow>
        <FieldRow label="UTR" mandatory={mandatoryFor("utr")} error={errors.utr}><Input value={asStr(draft.utr)} aria-required={isMandatory("utr")} onChange={(e) => set("utr", e.target.value)} /></FieldRow>
        <FieldRow label="Payment terms (days)" mandatory={mandatoryFor("paymentTerms")}><Input type="number" value={asNum(draft.paymentTerms)} onChange={(e) => set("paymentTerms", parseInt(e.target.value || "0") || 30)} /></FieldRow>
        <SaveBar canEdit={canEdit} isPending={patch.isPending} onSave={onSave} onReset={() => { setDraft(profile); setErrors({}); }} />
      </CardContent>
    </Card>
  );
}

// =====================================================
// Compliance tab (Section I)
// =====================================================
function ComplianceTab({ id, bundle, role }: TabProps) {
  const { profile } = bundle;
  const { draft, set, setDraft } = useSectionForm(profile);
  const patch = useProfilePatch(id);
  const { toast } = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { mandatoryFor, isMandatory } = useSectionMeta(SECTION_I_FIELD_META, role);
  const canEdit = role === "superadmin" || role === "subadmin";
  const onSave = () => {
    const errs = checkRequired(SECTION_I_FIELD_META, draft as Record<string, unknown>, undefined, requiresMediatorProfileCompletion(role));
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast({ title: "Please fix the highlighted fields", description: Object.values(errs)[0], variant: "destructive" });
      return;
    }
    setErrors({});
    patch.mutate(diffPatch(profile as Record<string, unknown>, draft as Record<string, unknown>) as never);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5" />Compliance & ongoing duties</CardTitle>
          <CardDescription>Section I — safeguarding, GDPR, confidentiality, and annual review tracking.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldRow label="Safeguarding training date" mandatory={mandatoryFor("safeguardingTrainingDate")} error={errors.safeguardingTrainingDate}><Input type="date" value={asStr(draft.safeguardingTrainingDate)} aria-required={isMandatory("safeguardingTrainingDate")} onChange={(e) => set("safeguardingTrainingDate", e.target.value)} /></FieldRow>
          <FieldRow label="Safeguarding provider" mandatory={mandatoryFor("safeguardingProvider")}><Input value={asStr(draft.safeguardingProvider)} onChange={(e) => set("safeguardingProvider", e.target.value)} /></FieldRow>
          <FieldRow label="Safeguarding cert URL" mandatory={mandatoryFor("safeguardingCertUrl")}><Input value={asStr(draft.safeguardingCertUrl)} onChange={(e) => set("safeguardingCertUrl", e.target.value)} /></FieldRow>
          <FieldRow label="Safeguarding refresher due" mandatory={mandatoryFor("safeguardingRefresherDue")}><Input type="date" value={asStr(draft.safeguardingRefresherDue)} onChange={(e) => set("safeguardingRefresherDue", e.target.value)} /></FieldRow>
          <FieldRow label="Confidentiality signed" mandatory={mandatoryFor("confidentialitySignedDate")} error={errors.confidentialitySignedDate}><Input type="date" value={asStr(draft.confidentialitySignedDate)} aria-required={isMandatory("confidentialitySignedDate")} onChange={(e) => set("confidentialitySignedDate", e.target.value)} /></FieldRow>
          <FieldRow label="GDPR training" mandatory={mandatoryFor("gdprTrainingDate")} error={errors.gdprTrainingDate}><Input type="date" value={asStr(draft.gdprTrainingDate)} aria-required={isMandatory("gdprTrainingDate")} onChange={(e) => set("gdprTrainingDate", e.target.value)} /></FieldRow>
          <FieldRow label="Last annual review" mandatory={mandatoryFor("annualReviewLast")}><Input type="date" value={asStr(draft.annualReviewLast)} onChange={(e) => set("annualReviewLast", e.target.value)} /></FieldRow>
          <FieldRow label="Next annual review" mandatory={mandatoryFor("annualReviewNext")}><Input type="date" value={asStr(draft.annualReviewNext)} onChange={(e) => set("annualReviewNext", e.target.value)} /></FieldRow>
          <FieldRow label="Annual review outcome" mandatory={mandatoryFor("annualReviewOutcome")}><Textarea value={asStr(draft.annualReviewOutcome)} onChange={(e) => set("annualReviewOutcome", e.target.value)} /></FieldRow>
          <SaveBar canEdit={canEdit} isPending={patch.isPending} onSave={onSave} onReset={() => { setDraft(profile); setErrors({}); }} />
        </CardContent>
      </Card>
      <ComplaintsSection id={id} canEdit={canEdit} />
    </div>
  );
}

function ComplaintsSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { data } = useQuery<MediatorComplaint[]>({ queryKey: ["/api/mediators", id, "complaints"] });
  const [draft, setDraft] = useState({ date: "", caseId: "", summary: "", outcome: "", signOff: "" });
  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/mediators/${id}/complaints`, draft),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "complaints"] }); setDraft({ date: "", caseId: "", summary: "", outcome: "", signOff: "" }); },
  });
  const remove = useMutation({
    mutationFn: (cid: string) => apiRequest("DELETE", `/api/mediators/${id}/complaints/${cid}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/mediators", id, "complaints"] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5" />Complaints register</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Case</TableHead><TableHead>Summary</TableHead><TableHead>Outcome</TableHead><TableHead>Sign-off</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.date}</TableCell>
                <TableCell className="text-xs">{c.caseId ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{c.summary}</TableCell>
                <TableCell className="max-w-xs truncate">{c.outcome}</TableCell>
                <TableCell>{c.signOff}</TableCell>
                <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 className="w-4 h-4" /></Button>}</TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground text-center">No complaints recorded.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-4">
            <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            <Input placeholder="Case ID (opt)" value={draft.caseId} onChange={(e) => setDraft((d) => ({ ...d, caseId: e.target.value }))} />
            <Input placeholder="Summary" value={draft.summary} onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} />
            <Input placeholder="Outcome" value={draft.outcome} onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value }))} />
            <Input placeholder="Sign-off" value={draft.signOff} onChange={(e) => setDraft((d) => ({ ...d, signOff: e.target.value }))} />
            <Button onClick={() => create.mutate()} disabled={!draft.date || !draft.summary}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
