import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Step = "Upload" | "Mapping" | "Review" | "Confirm";
type ReviewFilter = "Ready" | "Possible duplicates" | "Errors" | "Skipped";
type BusyOperation = "inspect" | "preview" | "commit" | null;
type ConfirmationTab = "Importing records" | "Skipped";

type ClientProfile = {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  phoneCode: string | null;
  gender: string | null;
  ethnicOrigin: string | null;
  nationalInsuranceNumber: string | null;
  disabilityOrHealthCondition: string | null;
  additionalNeeds: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
};

type Person = {
  personKey: string;
  sourceRowNumber: number;
  sourceRole: "client_1" | "client_2";
  legacyReference: string;
  profile: ClientProfile;
  originalValues: Record<string, unknown>;
  legacyOnlyValues: Record<string, unknown>;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
};

type Candidate = {
  clientId: string;
  reasons: string[];
  memberKeys: string[];
  client: ClientProfile & { id: string };
};
type ReviewGroup = {
  groupId: string;
  memberKeys: string[];
  members: Person[];
  candidates: Candidate[];
};
type Resolution = {
  targetKey: string;
  action: "use_existing" | "create_new" | "skip";
  memberKeys: string[];
  existingClientId?: string;
  clientData?: ClientProfile;
  reviewedFields?: string[];
};

type Inspection = {
  fileHash: string;
  sheets: Array<{ name: string; headers: string[]; dataRowCount: number }>;
  mappingTargets: Array<{
    key: string;
    label: string;
    section: "Legacy record" | "Client 1" | "Client 2";
    required: boolean;
  }>;
  suggestedMapping: Record<string, string | null>;
  unmappedHeaders: string[];
  ignoredHeaders: string[];
  placeholderCandidates?: Array<{
    kind: "email" | "phone";
    value: string;
    count: number;
  }>;
};

type Preview = {
  previewHash: string;
  records: Array<{
    sourceRowNumber: number;
    legacyReference: string;
    sourceRecordId: string | null;
    safeValues: Record<string, unknown>;
    errors: Array<{ code: string; message: string; field?: string }>;
  }>;
  groups: ReviewGroup[];
  placeholderCandidates: Array<{
    kind: "email" | "phone";
    value: string;
    count: number;
  }>;
  summary: {
    sourceRows: number;
    stagedPeople: number;
    legacyCasesToCreate: number;
    groups: number;
    duplicateGroups: number;
    errorPeople: number;
    warningPeople: number;
  };
  previousBatch: { id: string } | null;
};

const steps: Step[] = ["Upload", "Mapping", "Review", "Confirm"];
const filters: ReviewFilter[] = [
  "Ready",
  "Possible duplicates",
  "Errors",
  "Skipped",
];
const mappingSections: Inspection["mappingTargets"][number]["section"][] = [
  "Legacy record",
  "Client 1",
  "Client 2",
];
const confirmationPageSize = 25;
const busyLabels: Record<Exclude<BusyOperation, null>, string> = {
  inspect: "Reading and checking workbook…",
  preview: "Preparing import preview…",
  commit: "Importing clients…",
};
export const legacyImportDialogContentClassName =
  "max-w-[96vw] h-[92vh] overflow-hidden flex flex-col";
export const legacyImportLoaderClassName =
  "absolute inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm";
const editableFields: Array<{ key: keyof ClientProfile; label: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "email", label: "Email" },
  { key: "phoneCode", label: "Phone code" },
  { key: "phone", label: "Phone" },
  { key: "gender", label: "Gender" },
  { key: "ethnicOrigin", label: "Ethnic origin" },
  { key: "nationalInsuranceNumber", label: "NI number" },
  {
    key: "disabilityOrHealthCondition",
    label: "Disability / health condition",
  },
  { key: "additionalNeeds", label: "Additional needs" },
  { key: "addressLine1", label: "Address line 1" },
  { key: "addressLine2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "postcode", label: "Postcode" },
  { key: "country", label: "Country" },
];
const editableRecordFields = [
  "legacyReference",
  "sourceRecordId",
  "enquiryDate",
  "leadSource",
  "mediationType",
  "customMediationType",
  "status",
  "closureOutcome",
  "closedAt",
  "reopenedAt",
  "sourceCreatedAt",
  "sourceUpdatedAt",
  "mediatorName",
  "mediatorEmail",
  "mediatorCompany",
] as const;

function bytesToBase64(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 32_768;
  for (let index = 0; index < view.length; index += chunk) {
    binary += String.fromCharCode(
      ...Array.from(view.subarray(index, Math.min(index + chunk, view.length))),
    );
  }
  return btoa(binary);
}

export function groupHasPriorImport(group: ReviewGroup) {
  return group.members.some((member) =>
    member.errors.some((issue) => issue.code === "already_imported"),
  );
}

export function splitReviewGroup(group: ReviewGroup): ReviewGroup[] {
  return group.members.map((member) => ({
    groupId: member.personKey,
    memberKeys: [member.personKey],
    members: [member],
    candidates: group.candidates.filter((candidate) =>
      candidate.memberKeys.includes(member.personKey),
    ),
  }));
}

export function classifyReviewGroup(group: ReviewGroup): Exclude<ReviewFilter, "Skipped"> {
  if (group.members.some((member) => member.errors.length > 0)) return "Errors";
  if (group.candidates.length > 0 || group.members.length > 1)
    return "Possible duplicates";
  return "Ready";
}

export function canBulkResolve(
  groups: ReviewGroup[],
  action: Resolution["action"],
) {
  if (!groups.length) return false;
  if (action === "skip") return true;
  if (groups.some(groupHasPriorImport)) return false;
  if (action === "use_existing")
    return groups.every((group) => group.candidates.length === 1);
  return true;
}

function buildResolution(
  group: ReviewGroup,
  action: Resolution["action"],
  prior?: Resolution,
): Resolution {
  return {
    targetKey: group.groupId,
    action,
    memberKeys: group.memberKeys,
    existingClientId:
      action === "use_existing"
        ? prior?.existingClientId || group.candidates[0]?.clientId
        : undefined,
    clientData:
      action === "skip"
        ? undefined
        : prior?.clientData || group.members[0].profile,
  };
}

export function preparePriorImportSkips(
  groups: ReviewGroup[],
  resolutions: Record<string, Resolution>,
) {
  const replacedGroupIds = new Set(
    groups
      .filter((group) => groupHasPriorImport(group) && group.members.length > 1)
      .map((group) => group.groupId),
  );
  const expandedGroups = groups.flatMap((group) =>
    replacedGroupIds.has(group.groupId) ? splitReviewGroup(group) : [group],
  );
  const nextResolutions: Record<string, Resolution> = Object.fromEntries(
    Object.entries(resolutions).filter(
      ([groupId]) => !replacedGroupIds.has(groupId),
    ),
  );
  const importedGroups = expandedGroups.filter(groupHasPriorImport);
  importedGroups.forEach((group) => {
    nextResolutions[group.groupId] = buildResolution(group, "skip");
  });
  return {
    groups: expandedGroups,
    resolutions: nextResolutions,
    importedGroupIds: importedGroups.map((group) => group.groupId),
  };
}

export type ConfirmationRow = {
  personKey: string;
  name: string;
  sourceRole: Person["sourceRole"];
  sourceRowNumber: number;
  legacyReference: string;
  action: Resolution["action"];
  destination: string;
  issueCount: number;
};

export function buildConfirmationRows(
  groups: ReviewGroup[],
  resolutions: Record<string, Resolution>,
): ConfirmationRow[] {
  return groups.flatMap((group) => {
    const resolution = resolutions[group.groupId];
    if (!resolution) return [];
    const selectedCandidate = group.candidates.find(
      (candidate) => candidate.clientId === resolution.existingClientId,
    );
    const destination =
      resolution.action === "create_new"
        ? "New CRM client"
        : resolution.action === "skip"
          ? "Not imported"
          : selectedCandidate
            ? `${selectedCandidate.client.firstName} ${selectedCandidate.client.lastName}`.trim() ||
              selectedCandidate.clientId
            : resolution.existingClientId || "Existing CRM client";
    return group.members.map((member) => ({
      personKey: member.personKey,
      name: `${member.profile.firstName} ${member.profile.lastName}`.trim(),
      sourceRole: member.sourceRole,
      sourceRowNumber: member.sourceRowNumber,
      legacyReference: member.legacyReference,
      action: resolution.action,
      destination,
      issueCount: member.errors.length + member.warnings.length,
    }));
  });
}

type DuplicateComparisonField = {
  key: "firstName" | "lastName" | "dateOfBirth" | "email" | "phone";
  label: string;
  workbookValue: string;
  crmValue: string;
  matched: boolean;
};

type DuplicateComparisonSource = {
  personKey: string;
  sourceRole: Person["sourceRole"];
  sourceRowNumber: number;
  legacyReference: string;
  reasonLabels: string[];
  fields: DuplicateComparisonField[];
};

export type DuplicateCandidateComparison = {
  clientId: string;
  clientName: string;
  reasonLabels: string[];
  sources: DuplicateComparisonSource[];
};

export function formatDuplicateReason(reason: string) {
  if (reason === "email") return "Same email";
  if (reason === "name_dob") return "Same name and date of birth";
  if (reason === "phone_last_name") return "Same phone and last name";
  return "Matching client details";
}

function normalizedComparisonValue(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizedComparisonPhone(profile: ClientProfile) {
  const phone = (profile.phone || "").replace(/\D/g, "").replace(/^0/, "");
  const code = (profile.phoneCode || "").replace(/\D/g, "");
  return phone ? `${code}${phone}` : "";
}

function displayComparisonValue(value: string | null | undefined) {
  const displayed = (value || "").trim();
  return displayed || "—";
}

function displayComparisonPhone(profile: ClientProfile) {
  if (!profile.phone?.trim()) return "—";
  return displayComparisonValue(
    [profile.phoneCode, profile.phone].filter(Boolean).join(" "),
  );
}

function comparisonReasons(
  workbook: ClientProfile,
  crm: ClientProfile,
  candidateReasons: string[],
) {
  const reasons: string[] = [];
  const workbookEmail = normalizedComparisonValue(workbook.email);
  if (
    candidateReasons.includes("email") &&
    workbookEmail &&
    workbookEmail === normalizedComparisonValue(crm.email)
  ) {
    reasons.push("email");
  }

  const sameFullName =
    !!normalizedComparisonValue(workbook.firstName) &&
    normalizedComparisonValue(workbook.firstName) ===
      normalizedComparisonValue(crm.firstName) &&
    normalizedComparisonValue(workbook.lastName) ===
      normalizedComparisonValue(crm.lastName);
  if (
    candidateReasons.includes("name_dob") &&
    sameFullName &&
    workbook.dateOfBirth &&
    workbook.dateOfBirth === crm.dateOfBirth
  ) {
    reasons.push("name_dob");
  }

  const workbookPhone = normalizedComparisonPhone(workbook);
  if (
    candidateReasons.includes("phone_last_name") &&
    workbookPhone &&
    workbookPhone === normalizedComparisonPhone(crm) &&
    normalizedComparisonValue(workbook.lastName) &&
    normalizedComparisonValue(workbook.lastName) ===
      normalizedComparisonValue(crm.lastName)
  ) {
    reasons.push("phone_last_name");
  }
  return reasons;
}

export function buildDuplicateCandidateComparisons(
  group: ReviewGroup,
): DuplicateCandidateComparison[] {
  return group.candidates.map((candidate) => {
    const sources = group.members
      .filter((member) => candidate.memberKeys.includes(member.personKey))
      .map((member) => {
        const reasons = comparisonReasons(
          member.profile,
          candidate.client,
          candidate.reasons,
        );
        const matchesNameDob = reasons.includes("name_dob");
        const matchesPhoneLastName = reasons.includes("phone_last_name");
        return {
          personKey: member.personKey,
          sourceRole: member.sourceRole,
          sourceRowNumber: member.sourceRowNumber,
          legacyReference: member.legacyReference,
          reasonLabels: reasons.map(formatDuplicateReason),
          fields: [
            {
              key: "firstName" as const,
              label: "First name",
              workbookValue: displayComparisonValue(
                member.profile.firstName,
              ),
              crmValue: displayComparisonValue(candidate.client.firstName),
              matched: matchesNameDob,
            },
            {
              key: "lastName" as const,
              label: "Last name",
              workbookValue: displayComparisonValue(member.profile.lastName),
              crmValue: displayComparisonValue(candidate.client.lastName),
              matched: matchesNameDob || matchesPhoneLastName,
            },
            {
              key: "dateOfBirth" as const,
              label: "Date of birth",
              workbookValue: displayComparisonValue(
                member.profile.dateOfBirth,
              ),
              crmValue: displayComparisonValue(candidate.client.dateOfBirth),
              matched: matchesNameDob,
            },
            {
              key: "email" as const,
              label: "Email",
              workbookValue: displayComparisonValue(member.profile.email),
              crmValue: displayComparisonValue(candidate.client.email),
              matched: reasons.includes("email"),
            },
            {
              key: "phone" as const,
              label: "Phone",
              workbookValue: displayComparisonPhone(member.profile),
              crmValue: displayComparisonPhone(candidate.client),
              matched: matchesPhoneLastName,
            },
          ],
        };
      });
    return {
      clientId: candidate.clientId,
      clientName:
        `${candidate.client.firstName} ${candidate.client.lastName}`.trim() ||
        "Existing CRM client",
      reasonLabels: Array.from(
        new Set(sources.flatMap((source) => source.reasonLabels)),
      ),
      sources,
    };
  });
}

export function LegacyClientImportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("Upload");
  const [fileName, setFileName] = useState("");
  const [contentBase64, setContentBase64] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [confirmedPlaceholders, setConfirmedPlaceholders] = useState<string[]>(
    [],
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    {},
  );
  const [recordEdits, setRecordEdits] = useState<
    Record<number, Record<string, unknown>>
  >({});
  const [personEdits, setPersonEdits] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<ReviewFilter>("Ready");
  const [busyOperation, setBusyOperation] = useState<BusyOperation>(null);
  const [confirmationTab, setConfirmationTab] =
    useState<ConfirmationTab>("Importing records");
  const [confirmationSearch, setConfirmationSearch] = useState("");
  const [confirmationPage, setConfirmationPage] = useState(1);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Record<
    string,
    number | string
  > | null>(null);

  const reset = () => {
    setStep("Upload");
    setFileName("");
    setContentBase64("");
    setInspection(null);
    setSheetName("");
    setMapping({});
    setConfirmedPlaceholders([]);
    setPreview(null);
    setGroups([]);
    setResolutions({});
    setRecordEdits({});
    setPersonEdits({});
    setSelectedGroupId(null);
    setSelectedGroupIds([]);
    setFilter("Ready");
    setBusyOperation(null);
    setConfirmationTab("Importing records");
    setConfirmationSearch("");
    setConfirmationPage(1);
    setError("");
    setReceipt(null);
  };
  const close = (open: boolean) => {
    if (!open && busyOperation) return;
    if (!open) reset();
    props.onOpenChange(open);
  };

  const request = async <T,>(url: string, body: unknown): Promise<T> => {
    const response = await apiRequest("POST", url, body);
    return response.json() as Promise<T>;
  };

  const inspectFile = async (file: File) => {
    setError("");
    if (!file.name.toLowerCase().endsWith(".xlsx"))
      return setError("Choose an .xlsx workbook.");
    if (file.size > 10 * 1024 * 1024)
      return setError("Workbook must be 10 MB or smaller.");
    setBusyOperation("inspect");
    try {
      const encoded = bytesToBase64(await file.arrayBuffer());
      const result = await request<Inspection>(
        "/api/clients/legacy-import/inspect",
        { fileName: file.name, contentBase64: encoded },
      );
      setFileName(file.name);
      setContentBase64(encoded);
      setInspection(result);
      setSheetName(result.sheets[0]?.name || "");
      setMapping(result.suggestedMapping);
      setStep("Mapping");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not inspect workbook",
      );
    } finally {
      setBusyOperation(null);
    }
  };

  const createPreview = async () => {
    setBusyOperation("preview");
    setError("");
    try {
      const result = await request<Preview>(
        "/api/clients/legacy-import/preview",
        { fileName, contentBase64, sheetName, mapping, confirmedPlaceholders },
      );
      setPreview(result);
      setGroups(result.groups);
      setResolutions({});
      setRecordEdits({});
      setPersonEdits({});
      setSelectedGroupId(result.groups[0]?.groupId || null);
      setSelectedGroupIds([]);
      const firstFilter = result.groups[0]
        ? classifyReviewGroup(result.groups[0])
        : "Ready";
      setFilter(firstFilter);
      setStep("Review");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not preview workbook",
      );
    } finally {
      setBusyOperation(null);
    }
  };

  const resolveGroup = (group: ReviewGroup, action: Resolution["action"]) => {
    setResolutions((current) => ({
      ...current,
      [group.groupId]: buildResolution(group, action, current[group.groupId]),
    }));
  };

  const splitGroup = (group: ReviewGroup) => {
    const split = splitReviewGroup(group);
    setGroups((current) =>
      current.flatMap((candidate) =>
        candidate.groupId === group.groupId ? split : [candidate],
      ),
    );
    setResolutions((current) => {
      const next = { ...current };
      delete next[group.groupId];
      return next;
    });
    setSelectedGroupIds((current) =>
      current.filter((groupId) => groupId !== group.groupId),
    );
    setSelectedGroupId(split[0]?.groupId || null);
    if (split[0]) setFilter(classifyReviewGroup(split[0]));
  };

  const markReadyAsNew = () => {
    setResolutions((current) => {
      const next = { ...current };
      for (const group of groups) {
        if (
          !group.candidates.length &&
          group.members.length === 1 &&
          !group.members.some((member) => member.errors.length)
        ) {
          next[group.groupId] = {
            targetKey: group.groupId,
            action: "create_new",
            memberKeys: group.memberKeys,
            clientData: group.members[0].profile,
          };
        }
      }
      return next;
    });
  };

  const visibleGroups = useMemo(
    () =>
      groups.filter((group) => {
        const resolution = resolutions[group.groupId];
        if (filter === "Skipped") return resolution?.action === "skip";
        return (
          resolution?.action !== "skip" && classifyReviewGroup(group) === filter
        );
      }),
    [filter, groups, resolutions],
  );
  const groupsForFilter = (candidateFilter: ReviewFilter) =>
    groups.filter((group) => {
      const resolution = resolutions[group.groupId];
      if (candidateFilter === "Skipped") return resolution?.action === "skip";
      return (
        resolution?.action !== "skip" &&
        classifyReviewGroup(group) === candidateFilter
      );
    });

  const selectedGroup =
    groups.find((group) => group.groupId === selectedGroupId) || null;
  const selectedResolution = selectedGroup
    ? resolutions[selectedGroup.groupId]
    : undefined;
  const selectedDuplicateComparisons = selectedGroup
    ? buildDuplicateCandidateComparisons(selectedGroup)
    : [];
  const unresolved = groups.filter(
    (group) => !resolutions[group.groupId],
  ).length;
  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        filters.map((candidateFilter) => [
          candidateFilter,
          groups.filter((group) => {
            const resolution = resolutions[group.groupId];
            if (candidateFilter === "Skipped")
              return resolution?.action === "skip";
            return (
              resolution?.action !== "skip" &&
              classifyReviewGroup(group) === candidateFilter
            );
          }).length,
        ]),
      ) as Record<ReviewFilter, number>,
    [groups, resolutions],
  );
  const selectedGroups = groups.filter((group) =>
    selectedGroupIds.includes(group.groupId),
  );
  const allVisibleSelected =
    visibleGroups.length > 0 &&
    visibleGroups.every((group) => selectedGroupIds.includes(group.groupId));

  const toggleGroupSelection = (groupId: string, checked: boolean) => {
    setSelectedGroupIds((current) =>
      checked
        ? Array.from(new Set([...current, groupId]))
        : current.filter((candidate) => candidate !== groupId),
    );
  };

  const toggleAllVisible = () => {
    const visibleIds = new Set(visibleGroups.map((group) => group.groupId));
    setSelectedGroupIds((current) =>
      allVisibleSelected
        ? current.filter((groupId) => !visibleIds.has(groupId))
        : Array.from(new Set([...current, ...Array.from(visibleIds)])),
    );
  };

  const bulkResolve = (action: Resolution["action"]) => {
    if (!canBulkResolve(selectedGroups, action)) return;
    setResolutions((current) => {
      const next = { ...current };
      selectedGroups.forEach((group) => {
        next[group.groupId] = buildResolution(
          group,
          action,
          current[group.groupId],
        );
      });
      return next;
    });
    setSelectedGroupIds([]);
  };

  const skipAllPreviouslyImported = () => {
    const prepared = preparePriorImportSkips(groups, resolutions);
    setGroups(prepared.groups);
    setResolutions(prepared.resolutions);
    setSelectedGroupIds(prepared.importedGroupIds);
    setSelectedGroupId(prepared.importedGroupIds[0] || null);
    setFilter("Skipped");
  };
  const counts = useMemo(() => {
    let created = 0;
    let skipped = 0;
    const linked = new Set<string>();
    const supplemented = new Set<string>();
    const legacyRows = new Set<number>();
    for (const group of groups) {
      const resolution = resolutions[group.groupId];
      if (!resolution) continue;
      if (resolution.action === "skip") {
        skipped += resolution.memberKeys.length;
        continue;
      }
      group.members.forEach((member) => legacyRows.add(member.sourceRowNumber));
      if (resolution.action === "create_new") created += 1;
      if (resolution.action === "use_existing" && resolution.existingClientId) {
        linked.add(resolution.existingClientId);
        const candidate = group.candidates.find(
          (item) => item.clientId === resolution.existingClientId,
        );
        if (
          candidate &&
          resolution.clientData &&
          editableFields.some(
            ({ key }) =>
              !candidate.client[key] && !!resolution.clientData?.[key],
          )
        ) {
          supplemented.add(resolution.existingClientId);
        }
      }
    }
    return {
      created,
      linked: linked.size,
      supplemented: supplemented.size,
      legacyRecords: legacyRows.size,
      skipped,
    };
  }, [groups, resolutions]);

  const commit = async () => {
    if (!preview || unresolved) return;
    setBusyOperation("commit");
    setError("");
    try {
      const result = await request<Record<string, number | string>>(
        "/api/clients/legacy-import/commit",
        {
          fileName,
          contentBase64,
          sheetName,
          mapping,
          confirmedPlaceholders,
          previewHash: preview.previewHash,
          resolutions: Object.values(resolutions),
          recordEdits: Object.entries(recordEdits).map(
            ([sourceRowNumber, values]) => ({
              sourceRowNumber: Number(sourceRowNumber),
              values,
            }),
          ),
          personEdits: Object.entries(personEdits).map(
            ([personKey, values]) => ({ personKey, values }),
          ),
        },
      );
      setReceipt(result);
      setContentBase64("");
      props.onImported();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import clients",
      );
    } finally {
      setBusyOperation(null);
    }
  };

  const currentHeaders = (
    inspection?.sheets.find((sheet) => sheet.name === sheetName)?.headers || []
  ).filter((header) => !inspection?.ignoredHeaders.includes(header));
  const placeholderOptions =
    inspection?.placeholderCandidates || preview?.placeholderCandidates || [];
  const busy = busyOperation !== null;
  const confirmationRows = useMemo(
    () => buildConfirmationRows(groups, resolutions),
    [groups, resolutions],
  );
  const filteredConfirmationRows = useMemo(() => {
    const query = confirmationSearch.trim().toLowerCase();
    return confirmationRows.filter((row) => {
      const belongsToTab =
        confirmationTab === "Skipped"
          ? row.action === "skip"
          : row.action !== "skip";
      if (!belongsToTab) return false;
      if (!query) return true;
      return [
        row.name,
        row.legacyReference,
        String(row.sourceRowNumber),
        row.destination,
        row.action,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [confirmationRows, confirmationSearch, confirmationTab]);
  const confirmationPageCount = Math.max(
    1,
    Math.ceil(filteredConfirmationRows.length / confirmationPageSize),
  );
  const safeConfirmationPage = Math.min(
    confirmationPage,
    confirmationPageCount,
  );
  const paginatedConfirmationRows = filteredConfirmationRows.slice(
    (safeConfirmationPage - 1) * confirmationPageSize,
    safeConfirmationPage * confirmationPageSize,
  );

  return (
    <Dialog open={props.open} onOpenChange={close}>
      <DialogContent
        className={legacyImportDialogContentClassName}
        data-testid="dialog-legacy-client-import"
      >
        {busyOperation && (
          <div
            className={legacyImportLoaderClassName}
            role="status"
            aria-live="polite"
            data-testid="legacy-import-loading"
          >
            <div className="flex flex-col items-center gap-3 rounded-lg border bg-background px-8 py-6 shadow-lg">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-medium">{busyLabels[busyOperation]}</p>
              <p className="text-xs text-muted-foreground">
                Keep this window open while the operation completes.
              </p>
            </div>
          </div>
        )}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import legacy clients
          </DialogTitle>
          <DialogDescription>
            Create client records, attach safe read-only old-CRM history, and
            create legacy cases for open old-CRM rows. No enquiries, users,
            tasks or emails are created.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 border-b pb-3">
          {steps.map((label) => (
            <Badge key={label} variant={step === label ? "default" : "outline"}>
              {label}
            </Badge>
          ))}
        </div>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {receipt ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
            <h3 className="text-xl font-semibold">
              Legacy client import completed
            </h3>
            <p className="text-sm text-muted-foreground">
              Batch {String(receipt.id)} created{" "}
              {String(receipt.clientsCreated || 0)} clients and{" "}
              {String(receipt.legacyRecordsCreated || 0)} legacy records.
              {" "}Legacy cases created: {String(receipt.legacyCasesCreated || 0)}.
            </p>
            <Button onClick={() => close(false)}>Close</Button>
          </div>
        ) : step === "Upload" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">Choose an old-CRM Excel workbook</p>
              <p className="text-sm text-muted-foreground">
                .xlsx only, maximum 10 MB
              </p>
            </div>
            <Input
              type="file"
              accept=".xlsx"
              className="max-w-sm"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void inspectFile(file);
              }}
            />
          </div>
        ) : step === "Mapping" && inspection ? (
          <div className="flex-1 overflow-y-auto space-y-5 pr-2">
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    Confirm which Excel columns will populate each CRM field.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">
                    {Object.values(mapping).filter(Boolean).length} mapped CRM fields
                  </Badge>
                  <Badge variant="outline">
                    {inspection.unmappedHeaders.length} unmapped workbook columns
                  </Badge>
                  <Badge variant="outline">
                    {inspection.ignoredHeaders.length} security-excluded columns
                  </Badge>
                </div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Worksheet</Label>
                <Select
                  value={sheetName}
                  onValueChange={setSheetName}
                  disabled={busy}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {inspection.sheets.map((sheet) => (
                      <SelectItem key={sheet.name} value={sheet.name}>
                        {sheet.name} ({sheet.dataRowCount} rows)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md bg-muted/30 p-3 text-sm">
                <strong>
                  {inspection.sheets.find((sheet) => sheet.name === sheetName)
                    ?.dataRowCount || 0}
                </strong>{" "}
                source rows in the selected worksheet
              </div>
            </div>
            {mappingSections.map((section) => (
              <section key={section} className="space-y-2">
                <h3 className="font-semibold">{section}</h3>
                <div className="overflow-hidden rounded-md border">
                  <div className="grid grid-cols-[minmax(180px,1fr)_32px_minmax(220px,1fr)] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <span>CRM field</span>
                    <span aria-hidden="true" />
                    <span>Excel column</span>
                  </div>
                  {inspection.mappingTargets
                    .filter((target) => target.section === section)
                    .map((target) => (
                      <div
                        key={target.key}
                        className="grid grid-cols-[minmax(180px,1fr)_32px_minmax(220px,1fr)] items-center gap-3 border-b px-3 py-2 last:border-b-0"
                      >
                        <Label className="text-sm">
                          {target.label}
                          {target.required && (
                            <span className="ml-1 text-destructive">*</span>
                          )}
                        </Label>
                        <span className="text-center text-muted-foreground" aria-hidden="true">
                          ←
                        </span>
                        <Select
                          value={mapping[target.key] || "__none"}
                          disabled={busy}
                          onValueChange={(value) =>
                            setMapping((current) => ({
                              ...current,
                              [target.key]: value === "__none" ? null : value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Not mapped</SelectItem>
                            {currentHeaders.map((header) => (
                              <SelectItem key={header} value={header}>
                                {header}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                </div>
              </section>
            ))}
            {!!inspection.ignoredHeaders.length && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <strong>Ignored for safety:</strong>{" "}
                {inspection.ignoredHeaders.join(", ")}
              </div>
            )}
            {!!placeholderOptions.length && (
              <div className="space-y-2">
                <Label>Possible placeholder contacts</Label>
                {placeholderOptions.map((item) => (
                  <label
                    key={`${item.kind}:${item.value}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={confirmedPlaceholders.includes(item.value)}
                      onCheckedChange={(checked) =>
                        setConfirmedPlaceholders((current) =>
                          checked
                            ? [...current, item.value]
                            : current.filter((value) => value !== item.value),
                        )
                      }
                    />
                    Treat {item.value} as a placeholder ({item.count} people)
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep("Upload")}
                disabled={busy}
              >
                Back
              </Button>
              <Button onClick={() => void createPreview()} disabled={busy}>
                Preview import
              </Button>
            </div>
          </div>
        ) : step === "Review" && preview ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {preview.previousBatch && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This workbook was previously imported as batch{" "}
                {preview.previousBatch.id}. Skipped or resolved rows remain
                reviewable; only active conflicting records are blocked.
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center text-sm">
              {Object.entries(preview.summary).map(([key, value]) => (
                <div key={key} className="rounded-md border p-2">
                  <div className="font-semibold">{value}</div>
                  <div className="text-xs text-muted-foreground">
                    {key === "legacyCasesToCreate" ? "Legacy cases" : key}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              {filters.map((label) => (
                <Button
                  key={label}
                  size="sm"
                  variant={filter === label ? "default" : "outline"}
                  onClick={() => {
                    setFilter(label);
                    setSelectedGroupIds([]);
                    setSelectedGroupId(groupsForFilter(label)[0]?.groupId || null);
                  }}
                >
                  {label} ({filterCounts[label]})
                </Button>
              ))}
              <Button size="sm" variant="secondary" onClick={markReadyAsNew}>
                Mark ready as Create new
              </Button>
              {groups.some(groupHasPriorImport) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={skipAllPreviouslyImported}
                >
                  Skip all previously imported
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
              <label className="flex items-center gap-2 px-1 text-sm">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={() => toggleAllVisible()}
                  aria-label="Select all visible groups"
                />
                Select all visible
              </label>
              <span className="text-xs text-muted-foreground">
                {selectedGroups.length} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!canBulkResolve(selectedGroups, "create_new")}
                onClick={() => bulkResolve("create_new")}
              >
                Create new
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canBulkResolve(selectedGroups, "use_existing")}
                onClick={() => bulkResolve("use_existing")}
                title="Available only when every selected group has one CRM match"
              >
                Use unique existing
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canBulkResolve(selectedGroups, "skip")}
                onClick={() => bulkResolve("skip")}
              >
                Skip
              </Button>
            </div>
            <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(340px,1fr)_minmax(420px,1fr)] gap-3">
              <div className="overflow-y-auto border rounded-md divide-y">
                {visibleGroups.map((group) => {
                  const resolution = resolutions[group.groupId];
                  return (
                    <div
                      key={group.groupId}
                      role="button"
                      tabIndex={0}
                      className={`flex w-full cursor-pointer items-start gap-3 p-3 text-left hover:bg-muted/40 ${selectedGroupId === group.groupId ? "bg-muted" : ""}`}
                      onClick={() => setSelectedGroupId(group.groupId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedGroupId(group.groupId);
                        }
                      }}
                    >
                      <Checkbox
                        checked={selectedGroupIds.includes(group.groupId)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) =>
                          toggleGroupSelection(group.groupId, checked === true)
                        }
                        aria-label={`Select ${group.members[0].profile.firstName} ${group.members[0].profile.lastName}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            {group.members[0].profile.firstName}{" "}
                            {group.members[0].profile.lastName}
                          </span>
                          <Badge variant="outline">
                            {resolution?.action?.replace("_", " ") ||
                              "Unresolved"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {group.members.length} source occurrence(s) ·{" "}
                          {group.candidates.length} CRM match(es)
                        </p>
                      </div>
                    </div>
                  );
                })}
                {!visibleGroups.length && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No groups in this view.
                  </p>
                )}
              </div>
              <div className="overflow-y-auto border rounded-md p-4 space-y-4">
                {selectedGroup ? (
                  <>
                    <div>
                      <h3 className="font-semibold">
                        {selectedGroup.members[0].profile.firstName}{" "}
                        {selectedGroup.members[0].profile.lastName}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {selectedGroup.members
                          .map(
                            (member) =>
                              `${member.legacyReference} (${member.sourceRole === "client_1" ? "Client 1" : "Client 2"}, row ${member.sourceRowNumber})`,
                          )
                          .join(" · ")}
                      </p>
                    </div>
                    {selectedGroup.members
                      .flatMap((member) => [
                        ...member.errors,
                        ...member.warnings,
                      ])
                      .map((issue, index) => (
                        <div
                          key={`${issue.code}-${index}`}
                          className="flex gap-2 text-sm text-amber-700"
                        >
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          {issue.message}
                        </div>
                      ))}
                    {selectedGroup.members.length > 1 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => splitGroup(selectedGroup)}
                      >
                        Split group
                      </Button>
                    )}
                    {selectedDuplicateComparisons.length > 0 && (
                      <section
                        className="space-y-3"
                        aria-labelledby="duplicate-match-explanation"
                      >
                        <div>
                          <h4
                            id="duplicate-match-explanation"
                            className="flex items-center gap-2 text-sm font-semibold"
                          >
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            Why this may be a duplicate
                          </h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Compare the workbook record with each possible CRM
                            client. Viewing these details does not select a
                            resolution.
                          </p>
                        </div>
                        {selectedDuplicateComparisons.map((comparison) => (
                          <div
                            key={comparison.clientId}
                            className="space-y-3 rounded-md border bg-muted/10 p-3"
                          >
                            <div className="space-y-2">
                              <p className="text-sm font-semibold">
                                {comparison.clientName}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {comparison.reasonLabels.map((reason) => (
                                  <Badge
                                    key={reason}
                                    variant="outline"
                                    className="border-amber-300 bg-amber-50 text-amber-800"
                                  >
                                    {reason}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            {comparison.sources.map((source) => (
                              <div
                                key={source.personKey}
                                className="space-y-2 border-t pt-3"
                              >
                                <div>
                                  <p className="text-xs font-medium">
                                    {source.legacyReference} (
                                    {source.sourceRole === "client_1"
                                      ? "Client 1"
                                      : "Client 2"}
                                    , row {source.sourceRowNumber})
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {source.reasonLabels.join(" · ") ||
                                      "Matching client details"}
                                  </p>
                                </div>
                                <div className="overflow-x-auto rounded-md border text-xs">
                                  <table className="w-full min-w-[360px] text-left">
                                    <thead className="bg-muted font-medium">
                                      <tr>
                                        <th scope="col" className="px-2 py-1.5">
                                          Field
                                        </th>
                                        <th scope="col" className="px-2 py-1.5">
                                          Workbook record
                                        </th>
                                        <th scope="col" className="px-2 py-1.5">
                                          Existing CRM client
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {source.fields.map((field) => (
                                        <tr
                                          key={field.key}
                                          className={`border-t ${field.matched ? "border-emerald-200 bg-emerald-50/70" : ""}`}
                                        >
                                          <th
                                            scope="row"
                                            className="px-2 py-2 font-medium"
                                          >
                                            <span className="flex items-center gap-1">
                                              {field.matched && (
                                                <>
                                                  <CheckCircle2
                                                    aria-hidden="true"
                                                    className="h-3.5 w-3.5 shrink-0 text-emerald-700"
                                                  />
                                                  <span className="sr-only">
                                                    Match trigger: {" "}
                                                  </span>
                                                </>
                                              )}
                                              {field.label}
                                            </span>
                                          </th>
                                          <td className="break-words px-2 py-2">
                                            {field.workbookValue}
                                          </td>
                                          <td className="break-words px-2 py-2">
                                            {field.crmValue}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </section>
                    )}
                    {groupHasPriorImport(selectedGroup) && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        This source record already has retained legacy history.
                        It must be skipped to avoid importing that history twice.
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        variant={
                          selectedResolution?.action === "create_new"
                            ? "default"
                            : "outline"
                        }
                        disabled={groupHasPriorImport(selectedGroup)}
                        onClick={() =>
                          resolveGroup(selectedGroup, "create_new")
                        }
                      >
                        Create new
                      </Button>
                      <Button
                        variant={
                          selectedResolution?.action === "use_existing"
                            ? "default"
                            : "outline"
                        }
                        disabled={
                          !selectedGroup.candidates.length ||
                          groupHasPriorImport(selectedGroup)
                        }
                        onClick={() =>
                          resolveGroup(selectedGroup, "use_existing")
                        }
                      >
                        Use existing
                      </Button>
                      <Button
                        variant={
                          selectedResolution?.action === "skip"
                            ? "default"
                            : "outline"
                        }
                        onClick={() => resolveGroup(selectedGroup, "skip")}
                      >
                        Skip
                      </Button>
                    </div>
                    {selectedResolution?.action === "use_existing" && (
                      <div>
                        <Label>Existing client</Label>
                        <Select
                          value={selectedResolution.existingClientId}
                          onValueChange={(value) =>
                            setResolutions((current) => ({
                              ...current,
                              [selectedGroup.groupId]: {
                                ...selectedResolution,
                                existingClientId: value,
                              },
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedGroup.candidates.map((candidate) => (
                              <SelectItem
                                key={candidate.clientId}
                                value={candidate.clientId}
                              >
                                {candidate.client.firstName}{" "}
                                {candidate.client.lastName} —{" "}
                                {selectedDuplicateComparisons
                                  .find(
                                    (comparison) =>
                                      comparison.clientId ===
                                      candidate.clientId,
                                  )
                                  ?.reasonLabels.join(", ") ||
                                  "Matching client details"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {selectedResolution?.action !== "skip" &&
                      selectedResolution?.clientData && (
                        <div className="grid md:grid-cols-2 gap-3">
                          {editableFields.map(({ key, label }) => (
                            <div key={key}>
                              <Label className="text-xs">{label}</Label>
                              <Input
                                value={
                                  selectedResolution.clientData?.[key] || ""
                                }
                                onChange={(event) =>
                                  setResolutions((current) => ({
                                    ...current,
                                    [selectedGroup.groupId]: {
                                      ...selectedResolution,
                                      reviewedFields: Array.from(
                                        new Set([
                                          ...(selectedResolution.reviewedFields ||
                                            []),
                                          key,
                                        ]),
                                      ),
                                      clientData: {
                                        ...selectedResolution.clientData!,
                                        [key]: event.target.value || null,
                                      },
                                    },
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    {selectedResolution?.action !== "skip" &&
                      selectedGroup.members.map((member) => (
                        <div
                          key={`${member.personKey}-history`}
                          className="border-t pt-4 space-y-3"
                        >
                          <h4 className="text-sm font-semibold">
                            History-only values ·{" "}
                            {member.sourceRole === "client_1"
                              ? "Client 1"
                              : "Client 2"}
                            , row {member.sourceRowNumber}
                          </h4>
                          <div className="grid md:grid-cols-2 gap-3">
                            {Object.entries(member.legacyOnlyValues).map(
                              ([key, value]) => (
                                <div key={key}>
                                  <Label className="text-xs">{key}</Label>
                                  <Input
                                    value={String(
                                      personEdits[member.personKey]?.[key] ??
                                        value ??
                                        "",
                                    )}
                                    onChange={(event) =>
                                      setPersonEdits((current) => ({
                                        ...current,
                                        [member.personKey]: {
                                          ...(current[member.personKey] || {}),
                                          [key]: event.target.value || null,
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    {Array.from(
                      new Set(
                        selectedGroup.members.map(
                          (member) => member.sourceRowNumber,
                        ),
                      ),
                    ).map((rowNumber) => {
                      const record = preview.records.find(
                        (item) => item.sourceRowNumber === rowNumber,
                      );
                      if (!record) return null;
                      return (
                        <div
                          key={rowNumber}
                          className="border-t pt-4 space-y-3"
                        >
                          <div>
                            <h4 className="text-sm font-semibold">
                              Legacy record · row {rowNumber}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              Edit safe old-CRM context only. Security-sensitive
                              source columns are never available.
                            </p>
                          </div>
                          <div className="grid md:grid-cols-2 gap-3">
                            {editableRecordFields.map((key) => (
                              <div key={key}>
                                <Label className="text-xs">{key}</Label>
                                <Input
                                  value={String(
                                    recordEdits[rowNumber]?.[key] ??
                                      record.safeValues[key] ??
                                      "",
                                  )}
                                  onChange={(event) =>
                                    setRecordEdits((current) => ({
                                      ...current,
                                      [rowNumber]: {
                                        ...(current[rowNumber] || {}),
                                        [key]: event.target.value || null,
                                      },
                                    }))
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a staged client.
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-between items-center">
              <Button
                variant="outline"
                onClick={() => setStep("Mapping")}
                disabled={busy}
              >
                Back
              </Button>
              <span className="text-sm text-muted-foreground">
                {unresolved} unresolved group(s)
              </span>
              <Button
                disabled={unresolved > 0 || !preview.groups.length}
                onClick={() => setStep("Confirm")}
              >
                Review confirmation
              </Button>
            </div>
          </div>
        ) : step === "Confirm" && preview ? (
          <div className="flex-1 overflow-y-auto space-y-5">
            <div className="rounded-lg border p-5 space-y-3">
              <h3 className="font-semibold">Confirm atomic import</h3>
              <p className="text-sm text-muted-foreground">
                The whole import will roll back if any selected client or legacy
                record fails. The workbook itself will not be retained.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <strong>{counts.created}</strong>
                  <p className="text-xs">new clients</p>
                </div>
                <div>
                  <strong>{counts.linked}</strong>
                  <p className="text-xs">existing clients linked</p>
                </div>
                <div>
                  <strong>{counts.supplemented}</strong>
                  <p className="text-xs">existing profiles supplemented</p>
                </div>
                <div>
                  <strong>{counts.legacyRecords}</strong>
                  <p className="text-xs">legacy records created</p>
                </div>
                <div>
                  <strong>{counts.skipped}</strong>
                  <p className="text-xs">people skipped</p>
                </div>
              </div>
            </div>
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  {(["Importing records", "Skipped"] as ConfirmationTab[]).map(
                    (tab) => (
                      <Button
                        key={tab}
                        size="sm"
                        variant={confirmationTab === tab ? "default" : "outline"}
                        onClick={() => {
                          setConfirmationTab(tab);
                          setConfirmationPage(1);
                        }}
                      >
                        {tab} (
                        {
                          confirmationRows.filter((row) =>
                            tab === "Skipped"
                              ? row.action === "skip"
                              : row.action !== "skip",
                          ).length
                        }
                        )
                      </Button>
                    ),
                  )}
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={confirmationSearch}
                    onChange={(event) => {
                      setConfirmationSearch(event.target.value);
                      setConfirmationPage(1);
                    }}
                    placeholder="Search name, reference or row"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Person</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Legacy reference</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Destination</th>
                      <th className="px-3 py-2 font-medium">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paginatedConfirmationRows.map((row) => (
                      <tr key={row.personKey}>
                        <td className="px-3 py-2 font-medium">{row.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.sourceRole === "client_1" ? "Client 1" : "Client 2"},{" "}
                          row {row.sourceRowNumber}
                        </td>
                        <td className="px-3 py-2">{row.legacyReference}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline">
                            {row.action.replace("_", " ")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">{row.destination}</td>
                        <td className="px-3 py-2">
                          {row.issueCount ? `${row.issueCount} issue(s)` : "None"}
                        </td>
                      </tr>
                    ))}
                    {!paginatedConfirmationRows.length && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          No records match this view.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {filteredConfirmationRows.length} record(s) · 25 per page
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeConfirmationPage <= 1}
                    onClick={() =>
                      setConfirmationPage((current) => Math.max(1, current - 1))
                    }
                    aria-label="Previous confirmation page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span>
                    Page {safeConfirmationPage} of {confirmationPageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeConfirmationPage >= confirmationPageCount}
                    onClick={() =>
                      setConfirmationPage((current) =>
                        Math.min(confirmationPageCount, current + 1),
                      )
                    }
                    aria-label="Next confirmation page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep("Review")}
                disabled={busy}
              >
                Back
              </Button>
              <Button onClick={() => void commit()} disabled={busy}>
                {busy ? "Importing…" : "Import clients"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
