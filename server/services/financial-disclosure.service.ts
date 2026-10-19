import crypto from "crypto";
import zlib from "zlib";
import { storage } from "../storage";
import { logAudit } from "./audit-log.service";
import { caseActivityService, staffActor, systemActor } from "./case-activity.service";
import type {
  Case,
  CaseDocument,
  CaseDraftFinancialSchedule,
  CaseDraftFinancialScheduleVersion,
  CourtFormTemplate,
  DraftFinancialScheduleStatus,
  FinancialDisclosureBookletTemplate,
  FinancialDisclosureEvidenceCategory,
  FinancialDisclosureFolder,
  FinancialDisclosureItem,
  FinancialDisclosureItemStatus,
  FinancialDisclosureItemType,
  FinancialDisclosureUploadTarget,
  MediationSession,
  Party,
  User,
} from "@shared/schema";
import {
  DRAFT_FINANCIAL_SCHEDULE_STATUSES,
  FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES,
  FINANCIAL_DISCLOSURE_ITEM_STATUSES,
  FINANCIAL_DISCLOSURE_UPLOAD_TARGETS,
} from "@shared/schema";
import {
  applyDisclosureSourcePrefill,
  DISCLOSURE_BOOKLET_PROGRESS_STATUSES,
  FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA,
  buildCombinedDisclosureBookletView,
  calculateDisclosureBookletTotals,
  ensureFieldBasedBookletPayload,
  flattenDisclosureBookletTemplateData,
  flattenSingleDisclosureBookletPdfData,
  setDisclosureBookletAnswerByPdfSource,
  type DisclosureBookletPayload,
  type DisclosureBookletProgressStatus,
  type DisclosureSourcePrefill,
} from "@shared/financial-disclosure-booklet-schema";
import {
  applyDraftFinancialSchedulePrefill,
  buildDraftFinancialSchedulePdfTemplateData,
  normalizeDraftFinancialSchedulePayload,
  type DraftFinancialSchedulePayload,
  type DraftFinancialScheduleSource,
} from "@shared/draft-financial-schedule-schema";
import {
  type DraftFinancialScheduleAutoMapDiagnostics,
} from "@shared/draft-financial-schedule-auto-map";
import { reconcileDraftFinancialScheduleTemplateMapping } from "./draft-financial-schedule-template-mapping.service";
import {
  autoRepairFinancialDisclosureBookletMapping,
  type FinancialDisclosureBookletAutoMapDiagnostics,
} from "@shared/financial-disclosure-booklet-auto-map";
import { applyPdfFieldOverrides, fillCourtFormPdfBytes } from "./court-form-pdf-fill.service";
import { normalizeCourtFormMapping } from "./court-form-mapping.service";
import { courtFormTemplateService } from "./court-form-template.service";
import { fileStorageService } from "./file-storage.service";
import type { ServiceResult } from "./types";
import { withProtectedCaseDocumentUrl } from "../security/document-access";
import { classifyCaseAccess, hasFullOperationalCaseAccess } from "../security/case-access-policy";

type ActorUser = Pick<User, "id" | "name" | "role">;

type FolderTriggerSource = "booking_onboarding" | "case_type_update" | "mediation_session_hold";

type DraftFinancialScheduleEditability = {
  canEdit: boolean;
  canConfirm: boolean;
  reason: string | null;
  activeSessionId: string | null;
};

type DraftFinancialSchedulePresenceAttestation = {
  sessionId?: string | null;
  bothPartiesPresent?: boolean;
};

type DraftFinancialScheduleVersionSummary = {
  id: string;
  versionNumber: number;
  status: string;
  editedBy: string | null;
  editedByName: string;
  editedAt: Date;
  source: string;
  confirmedInSessionId: string | null;
};

type DraftFinancialScheduleResolvedField = {
  pdfField: string;
  source: string;
  required?: boolean;
  defaultValue?: string | null;
  value: string;
  missing: boolean;
};

type DraftFinancialSchedulePdfPreviewState = {
  template: Pick<CourtFormTemplate, "id" | "formType" | "versionLabel" | "isCurrent" | "fieldNames" | "fieldMetadata" | "fieldMapping"> | null;
  resolvedFields: DraftFinancialScheduleResolvedField[];
  mappingDiagnostics?: DraftFinancialScheduleAutoMapDiagnostics | null;
};

type FinancialDisclosureBookletResolvedField = {
  pdfField: string;
  source: string;
  required?: boolean;
  defaultValue?: string | null;
  value: string;
  missing: boolean;
};

type FinancialDisclosureBookletPdfPreviewState = {
  template: Pick<CourtFormTemplate, "id" | "formType" | "versionLabel" | "isCurrent" | "fieldNames" | "fieldMetadata" | "fieldMapping"> | null;
  resolvedFields: FinancialDisclosureBookletResolvedField[];
  mappingDiagnostics?: FinancialDisclosureBookletAutoMapDiagnostics | null;
  canEdit: boolean;
};

type DraftFinancialScheduleView = {
  schedule: CaseDraftFinancialSchedule | null;
  payload: DraftFinancialSchedulePayload;
  latestVersion: DraftFinancialScheduleVersionSummary | null;
  versions: DraftFinancialScheduleVersionSummary[];
  editability: DraftFinancialScheduleEditability;
  pdfPreview: DraftFinancialSchedulePdfPreviewState;
  reviewContext: {
    willSubmitWithPostSessionReview: boolean;
    activeSessionId: string | null;
    activeSessionPostSessionReviewStatus: string | null;
  };
};

type PartySummary = Pick<Party, "id" | "caseId" | "clientId" | "role"> & {
  firstName?: string | null;
  lastName?: string | null;
  userId?: string | null;
};

type FinancialDisclosureTag = {
  folderId: string;
  itemId: string | null;
  evidenceCategoryId: string | null;
  uploadTarget: FinancialDisclosureUploadTarget;
};

type DisclosureProgressStatus = DisclosureBookletProgressStatus;

export type FinancialDisclosureFolderView = FinancialDisclosureFolder & {
  party: PartySummary;
  ofsRequired: string | null;
  sourceSummary: FinancialDisclosureSourceSummary;
  items: FinancialDisclosureItem[];
  evidenceCategories: Array<FinancialDisclosureEvidenceCategory & { documents: CaseDocument[] }>;
  documents: CaseDocument[];
};

export type FinancialDisclosureSourceSummary = DisclosureSourcePrefill & {
  clientName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  employmentStatus: string | null;
  legalAidEligible: string | null;
  voucherSchemeEligible: string | null;
  courtProceedingsStatus: string | null;
  courtReference: string | null;
  courtName: string | null;
  cafcassInvolved: string | null;
  solicitorInvolved: string | null;
  solicitorName: string | null;
  childrenAges: string | null;
  additionalNeeds: string | null;
};

const ITEM_DEFINITIONS: Array<{
  itemType: FinancialDisclosureItemType;
  title: string;
  description: string;
  status: FinancialDisclosureItemStatus;
  payload: Record<string, unknown>;
}> = [
  {
    itemType: "online_disclosure_booklet",
    title: "Online disclosure booklet",
    description: "Client-completable online financial disclosure sections.",
    status: "outstanding",
    payload: {},
  },
  {
    itemType: "financial_disclosure_checklist",
    title: "Financial Disclosure Checklist",
    description: "Mediator-facing checklist for reviewing this party's disclosure readiness.",
    status: "outstanding",
    payload: {},
  },
];

const CHECKLIST_ROW_DEFINITIONS = [
  { key: "matrimonial_home_valuation", label: "Matrimonial home valuation" },
  { key: "matrimonial_home_mortgage", label: "Matrimonial home mortgage statement" },
  { key: "other_property_valuation", label: "Other property valuation" },
  { key: "other_property_mortgage", label: "Other property mortgage statement" },
  { key: "personal_bank_building_society_national_savings", label: "Personal bank, building society and National Savings statements" },
  { key: "other_investments", label: "Other investment statements" },
  { key: "life_insurance_policies", label: "Life insurance or endowment policy surrender valuations" },
  { key: "business_accounts", label: "Business accounts for the last two financial years" },
  { key: "business_valuation", label: "Business valuation evidence" },
  { key: "pension_cetv_statements", label: "Pension CETV statements" },
  { key: "p60", label: "P60 for the last financial year" },
  { key: "payslips", label: "Last three payslips" },
  { key: "p11d", label: "P11D work-related expenses form" },
  { key: "tax_assessment", label: "Tax assessment" },
  { key: "management_accounts", label: "Management accounts for changed self-employment income" },
  { key: "other_documents", label: "Description of other documents attached" },
  { key: "application_to_vary_order", label: "Application to vary an order" },
] as const;

const FINANCIAL_DISCLOSURE_EVIDENCE_CATEGORY_DEFINITIONS = [
  { key: "bank_statements", label: "Bank statements", description: "Personal bank, building society, and National Savings account statements" },
  { key: "payslips", label: "Payslips", description: "Recent payslips, P60, P11D, or employment income evidence" },
  { key: "pension_cetv_statements", label: "Pension CETV statements", description: "Cash equivalent transfer value statements and pension evidence" },
  { key: "mortgage_statements", label: "Mortgage statements", description: "Recent mortgage statements for the matrimonial home or other property" },
  { key: "property_valuations", label: "Property valuations", description: "Recent property valuations for the home or other property" },
  { key: "other_financial_evidence", label: "Other financial evidence", description: "Other evidence needed to explain or verify financial disclosure" },
] as const;

const OFS_VALUES = ["yes", "no", "unknown", "waived"] as const;
const DISCLOSURE_PROGRESS_STATUSES = DISCLOSURE_BOOKLET_PROGRESS_STATUSES;
const LEGACY_NOTES_PAYLOAD_KEY = "legacyNotes";

function normalizedFamilySubtype(caseRecord: Pick<Case, "mediationCategory" | "familySubType" | "issueType">): string {
  return (caseRecord.familySubType || caseRecord.issueType || "").trim();
}

export function isFinancialDisclosureEligibleCase(caseRecord: Pick<Case, "mediationCategory" | "familySubType" | "issueType"> | null | undefined): boolean {
  if (!caseRecord) return false;
  const subtype = normalizedFamilySubtype(caseRecord);
  const eligible = (FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES as readonly string[]).includes(subtype);
  if (caseRecord.mediationCategory) {
    return caseRecord.mediationCategory === "Family" && eligible;
  }
  return eligible;
}

function canEditStaffItem(actor: ActorUser | null | undefined): boolean {
  return actor?.role === "superadmin" || actor?.role === "subadmin" || actor?.role === "mediator";
}

function isScheduleAdmin(actor: ActorUser | null | undefined): boolean {
  return actor?.role === "superadmin" || actor?.role === "subadmin";
}

function normalizeDraftFinancialScheduleStatus(status: string | undefined): DraftFinancialScheduleStatus {
  return (DRAFT_FINANCIAL_SCHEDULE_STATUSES as readonly string[]).includes(status || "")
    ? status as DraftFinancialScheduleStatus
    : "draft";
}

function sessionEndTime(appointment: { dateTime: Date | string; duration: number }): Date {
  return new Date(new Date(appointment.dateTime).getTime() + Math.max(appointment.duration || 0, 0) * 60 * 1000);
}

function partyDisplayName(party: PartySummary): string {
  return `${party.firstName || ""} ${party.lastName || ""}`.trim() || `Client ${party.role}`;
}

function isDisclosureProgressStatus(status: string): status is DisclosureProgressStatus {
  return (DISCLOSURE_PROGRESS_STATUSES as readonly string[]).includes(status);
}

function ensureChecklistPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const existing = payload && typeof payload === "object" ? payload : {};
  const existingRows = Array.isArray((existing as any).rows)
    ? (existing as any).rows
    : Array.isArray((existing as any).checks)
      ? (existing as any).checks
      : [];
  const rows = CHECKLIST_ROW_DEFINITIONS.map((definition) => {
    const current = existingRows.find((row: any) => row?.key === definition.key) || {};
    return {
      key: definition.key,
      label: definition.label,
      status: current.status === "received" ? "completed" : isDisclosureProgressStatus(current.status) ? current.status : "not_started",
      received: Boolean(current.received || current.status === "received" || current.status === "completed"),
      documentDate: typeof current.documentDate === "string" ? current.documentDate : null,
      receivedAt: typeof current.receivedAt === "string" ? current.receivedAt : null,
      notes: typeof current.notes === "string" ? current.notes : "",
    };
  });
  return { ...existing, rows };
}

function financialDisclosureItemStatusFromSections(sections: unknown): FinancialDisclosureItemStatus {
  if (!Array.isArray(sections) || sections.length === 0) return "outstanding";
  if (sections.every((section: any) => section?.status === "completed" || section?.status === "submitted")) return "completed";
  if (sections.some((section: any) => section?.status === "in_progress" || section?.status === "completed" || section?.status === "submitted" || String(section?.notes || "").trim())) return "in_progress";
  return "outstanding";
}

function financialDisclosureItemStatusFromProgress(progress: DisclosureBookletPayload["progress"]): FinancialDisclosureItemStatus {
  const rows = Object.values(progress);
  if (rows.length > 0 && rows.every((row) => row.status === "submitted")) return "completed";
  if (rows.some((row) => row.status !== "not_started")) return "in_progress";
  return "outstanding";
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.*)$/);
  if (!match) throw new Error("Template upload must be a base64 data URL");
  return { mimeType: match[1] || "application/octet-stream", buffer: Buffer.from(match[2], "base64") };
}

type ZipEntry = { name: string; data: Buffer };

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (let index = 0; index < buffer.length; index++) {
    const byte = buffer[index];
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + fileNameLength).toString("utf8");
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
    entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

function writeZipEntries(entries: ZipEntry[]): Buffer {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { date, time } = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    fileParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...fileParts, central, end]);
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function templatePlaceholders(xml: string): string[] {
  const found = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}|\{\s*([a-zA-Z0-9_.-]+)\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    found.add(match[1] || match[2]);
  }
  return Array.from(found).sort();
}

function renderDocxTemplate(template: Buffer, values: Record<string, string>): { buffer: Buffer; placeholders: string[] } {
  const entries = readZipEntries(template);
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) throw new Error("DOCX template is missing word/document.xml");
  let xml = document.data.toString("utf8");
  const placeholders = templatePlaceholders(xml);
  for (const key of placeholders) {
    const escaped = xmlEscape(values[key] || "");
    xml = xml.replace(new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g"), escaped);
    xml = xml.replace(new RegExp(`\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`, "g"), escaped);
  }
  return {
    buffer: writeZipEntries(entries.map((entry) => entry.name === "word/document.xml" ? { ...entry, data: Buffer.from(xml, "utf8") } : entry)),
    placeholders,
  };
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "financial-disclosure-template.docx";
}

function resolveDraftFinancialSchedulePdfValues(
  mappingValue: unknown,
  payload: DraftFinancialSchedulePayload,
): Record<string, string> {
  return Object.fromEntries(resolveDraftFinancialSchedulePdfFields(mappingValue, payload).map((field) => [field.pdfField, field.value]));
}

function resolveDraftFinancialSchedulePdfFields(
  mappingValue: unknown,
  payload: DraftFinancialSchedulePayload,
  options: { enforceRequired?: boolean } = {},
): DraftFinancialScheduleResolvedField[] {
  const sourceValues = buildDraftFinancialSchedulePdfTemplateData(payload);
  const mapping = normalizeCourtFormMapping(mappingValue);
  return mapping.map((entry) => {
    const value = entry.source === "static"
      ? entry.defaultValue || ""
      : sourceValues[entry.source] || entry.defaultValue || "";
    if (options.enforceRequired !== false && entry.required && !value.trim()) {
      throw new Error(`Required value missing for ${entry.pdfField}`);
    }
    return { ...entry, value, missing: entry.required === true && !value.trim() };
  });
}

function templateFieldNames(template: Pick<CourtFormTemplate, "fieldNames" | "fieldMetadata">): string[] {
  const metadata = Array.isArray(template.fieldMetadata) ? template.fieldMetadata : [];
  const metadataNames = metadata
    .map((field) => field && typeof field === "object" ? (field as { name?: unknown }).name : null)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (metadataNames.length) return Array.from(new Set(metadataNames));
  return Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : [];
}

function assertDraftFinancialScheduleMappingFillsValues(
  template: Pick<CourtFormTemplate, "fieldMapping" | "fieldNames" | "fieldMetadata">,
  resolvedFields: DraftFinancialScheduleResolvedField[],
) {
  const fieldNames = templateFieldNames(template);
  const mappedFieldNames = new Set(resolvedFields.map((field) => field.pdfField));
  const hasMappedTemplateField = fieldNames.length === 0 || fieldNames.some((fieldName) => mappedFieldNames.has(fieldName));
  const hasScheduleValue = resolvedFields.some((field) => field.source.startsWith("draftFinancialSchedule.") && field.value.trim());
  if (!resolvedFields.length || !hasMappedTemplateField || !hasScheduleValue) {
    throw new Error("Draft financial schedule auto-mapping could not find any safe PDF field matches that fill saved schedule values. Review the DRAFT FINANCIAL SCHEDULE template mapping before exporting.");
  }
}

class FinancialDisclosureService {
  async getVisibleFoldersForCase(caseId: string, actor: Pick<User, "id" | "role">): Promise<FinancialDisclosureFolderView[]> {
    const folders = await storage.listFinancialDisclosureFoldersByCase(caseId);
    const views = await Promise.all(folders.map((folder) => this.assembleFolder(folder)));
    if (actor.role === "superadmin" || actor.role === "subadmin") return views;
    if (actor.role === "client") return views.filter((view) => view.party.userId === actor.id);
    const visible: FinancialDisclosureFolderView[] = [];
    for (const view of views) {
      if (await this.canActorAccessFolder(actor, view)) visible.push(view);
    }
    return visible;
  }

  async ensureFinancialDisclosureFoldersForCase(
    caseId: string,
    triggerSource: FolderTriggerSource,
    actor?: ActorUser | null,
  ): Promise<FinancialDisclosureFolderView[]> {
    const caseRecord = await storage.getCase(caseId);
    if (!isFinancialDisclosureEligibleCase(caseRecord)) return [];

    const parties = await storage.listPartiesByCase(caseId) as PartySummary[];
    const views: FinancialDisclosureFolderView[] = [];

    for (const party of parties) {
      const existing = await storage.getFinancialDisclosureFolderByCaseAndParty(caseId, party.id);
      const folder = existing || await storage.createFinancialDisclosureFolder({
        caseId,
        partyId: party.id,
        status: "active",
        triggerSource,
      });

      await this.seedFolderItems(folder.id);
      await this.seedEvidenceCategories(folder.id);
      if (!existing) await this.logCreatedFolder(folder, party, triggerSource, actor);
      views.push(await this.assembleFolder(folder, party));
    }

    return views;
  }

  async updateItem(
    itemId: string,
    actor: ActorUser,
    input: { status?: FinancialDisclosureItemStatus; payload?: Record<string, unknown> },
  ): Promise<FinancialDisclosureItem | null> {
    if (!FINANCIAL_DISCLOSURE_ITEM_STATUSES.includes((input.status || "outstanding") as FinancialDisclosureItemStatus)) {
      return null;
    }
    const item = await storage.getFinancialDisclosureItem(itemId);
    if (!item) return null;
    const folder = await storage.getFinancialDisclosureFolder(item.folderId);
    if (!folder || !(await this.canActorAccessFolder(actor, folder))) return null;
    if (!this.canUpdateItem(actor, item, folder)) return null;

    const patch: {
      status?: FinancialDisclosureItemStatus;
      payload?: Record<string, unknown>;
      completedAt?: Date | null;
      completedBy?: string | null;
      updatedBy?: string | null;
    } = {
      updatedBy: actor.id,
    };
    if (input.payload !== undefined) patch.payload = input.payload;
    if (input.status) {
      patch.status = input.status;
      patch.completedAt = input.status === "completed" ? new Date() : null;
      patch.completedBy = input.status === "completed" ? actor.id : null;
    }
    return await storage.updateFinancialDisclosureItem(itemId, patch) || null;
  }

  async updateBookletSection(
    itemId: string,
    actor: ActorUser,
    sectionKey: string,
    input: { status: DisclosureProgressStatus; answers?: Record<string, unknown>; notes?: string | null },
  ): Promise<ServiceResult<{ item: FinancialDisclosureItem }>> {
    const item = await storage.getFinancialDisclosureItem(itemId);
    if (!item || item.itemType !== "online_disclosure_booklet") return { ok: false, error: "Online disclosure booklet not found", status: 404 };
    const folder = await storage.getFinancialDisclosureFolder(item.folderId);
    if (!folder || !(await this.canActorAccessFolder(actor, folder))) return { ok: false, error: "Access denied", status: 403 };
    if (!this.canUpdateItem(actor, item, folder)) return { ok: false, error: "Not authorised to update this booklet", status: 403 };
    if (!isDisclosureProgressStatus(input.status)) return { ok: false, error: "Invalid booklet section status", status: 400 };

    const payload = ensureFieldBasedBookletPayload(item.payload as Record<string, unknown>);
    const section = FINANCIAL_DISCLOSURE_BOOKLET_SCHEMA.find((definition) => definition.key === sectionKey);
    if (!section) return { ok: false, error: "Booklet section not found", status: 404 };
    const now = new Date().toISOString();
    const nextPayload = ensureFieldBasedBookletPayload({
      ...payload,
      answers: {
        ...payload.answers,
        [sectionKey]: {
          ...(payload.answers as any)[sectionKey],
          ...(input.answers || {}),
        },
      },
      progress: {
        ...payload.progress,
        [sectionKey]: {
          ...payload.progress[sectionKey],
          status: input.status,
          updatedAt: now,
        },
      },
    });
    const updated = await storage.updateFinancialDisclosureItem(itemId, {
      payload: nextPayload,
      status: financialDisclosureItemStatusFromProgress(nextPayload.progress),
      completedAt: Object.values(nextPayload.progress).every((row) => row.status === "submitted") ? new Date() : null,
      completedBy: Object.values(nextPayload.progress).every((row) => row.status === "submitted") ? actor.id : null,
      updatedBy: actor.id,
    });
    if (!updated) return { ok: false, error: "Failed to update booklet section", status: 500 };
    return { ok: true, item: updated };
  }

  async submitBooklet(
    itemId: string,
    actor: ActorUser,
  ): Promise<ServiceResult<{ item: FinancialDisclosureItem }>> {
    const item = await storage.getFinancialDisclosureItem(itemId);
    if (!item || item.itemType !== "online_disclosure_booklet") return { ok: false, error: "Online disclosure booklet not found", status: 404 };
    const folder = await storage.getFinancialDisclosureFolder(item.folderId);
    if (!folder || !(await this.canActorAccessFolder(actor, folder))) return { ok: false, error: "Access denied", status: 403 };
    if (!this.canUpdateItem(actor, item, folder)) return { ok: false, error: "Not authorised to submit this booklet", status: 403 };
    const now = new Date().toISOString();
    const payload = ensureFieldBasedBookletPayload(item.payload as Record<string, unknown>);
    const progress = Object.fromEntries(Object.entries(payload.progress).map(([key, row]) => [
      key,
      { ...row, status: "submitted" as const, updatedAt: now, submittedAt: now, submittedBy: actor.id },
    ]));
    const nextPayload = ensureFieldBasedBookletPayload({ ...payload, progress });
    const updated = await storage.updateFinancialDisclosureItem(itemId, {
      payload: nextPayload,
      status: "completed",
      completedAt: new Date(),
      completedBy: actor.id,
      updatedBy: actor.id,
    });
    if (!updated) return { ok: false, error: "Failed to submit booklet", status: 500 };
    return { ok: true, item: updated };
  }

  async updateBookletAnnotation(
    itemId: string,
    actor: ActorUser,
    input: { path: string; note?: string | null; flagged?: boolean },
  ): Promise<ServiceResult<{ item: FinancialDisclosureItem }>> {
    if (!canEditStaffItem(actor)) return { ok: false, error: "Only staff can annotate disclosure booklets", status: 403 };
    const item = await storage.getFinancialDisclosureItem(itemId);
    if (!item || item.itemType !== "online_disclosure_booklet") return { ok: false, error: "Online disclosure booklet not found", status: 404 };
    const folder = await storage.getFinancialDisclosureFolder(item.folderId);
    if (!folder || !(await this.canActorAccessFolder(actor, folder))) return { ok: false, error: "Access denied", status: 403 };
    const payload = ensureFieldBasedBookletPayload(item.payload as Record<string, unknown>);
    const nextPayload = {
      ...payload,
      staffAnnotations: {
        ...payload.staffAnnotations,
        [input.path]: {
          note: input.note || "",
          flagged: Boolean(input.flagged),
          updatedAt: new Date().toISOString(),
          updatedBy: actor.id,
        },
      },
    };
    const updated = await storage.updateFinancialDisclosureItem(itemId, { payload: nextPayload, updatedBy: actor.id });
    if (!updated) return { ok: false, error: "Failed to update booklet annotation", status: 500 };
    return { ok: true, item: updated };
  }

  async updateChecklistRow(
    itemId: string,
    actor: ActorUser,
    rowKey: string,
    input: { status: DisclosureProgressStatus; documentDate?: Date | null; notes?: string | null },
  ): Promise<ServiceResult<{ item: FinancialDisclosureItem }>> {
    const item = await storage.getFinancialDisclosureItem(itemId);
    if (!item || item.itemType !== "financial_disclosure_checklist") return { ok: false, error: "Financial disclosure checklist not found", status: 404 };
    const folder = await storage.getFinancialDisclosureFolder(item.folderId);
    if (!folder || !(await this.canActorAccessFolder(actor, folder))) return { ok: false, error: "Access denied", status: 403 };
    if (!this.canUpdateItem(actor, item, folder)) return { ok: false, error: "Not authorised to update this checklist", status: 403 };
    if (!isDisclosureProgressStatus(input.status)) return { ok: false, error: "Invalid checklist row status", status: 400 };

    const payload = ensureChecklistPayload(item.payload as Record<string, unknown>);
    let found = false;
    const now = new Date().toISOString();
    const rows = ((payload.rows as any[]) || []).map((row) => {
      if (row.key !== rowKey) return row;
      found = true;
      return {
        ...row,
        status: input.status,
        received: input.status === "completed",
        documentDate: input.documentDate ? input.documentDate.toISOString() : null,
        receivedAt: input.status === "completed" ? row.receivedAt || now : null,
        notes: input.notes ?? row.notes ?? "",
      };
    });
    if (!found) return { ok: false, error: "Checklist row not found", status: 404 };
    const nextPayload = { ...payload, rows };
    const updated = await storage.updateFinancialDisclosureItem(itemId, {
      payload: nextPayload,
      status: financialDisclosureItemStatusFromSections(rows),
      completedAt: rows.every((row) => row.status === "completed") ? new Date() : null,
      completedBy: rows.every((row) => row.status === "completed") ? actor.id : null,
      updatedBy: actor.id,
    });
    if (!updated) return { ok: false, error: "Failed to update checklist row", status: 500 };
    if (input.status === "completed") {
      const { caseProofingService } = await import("./case-proofing.service");
      await caseProofingService.ensureProofingItemForSource({
        caseId: folder.caseId,
        sessionId: null,
        itemType: "financial_disclosure_checklist",
        sourceEntityType: "financial_disclosure_item",
        sourceEntityId: updated.id,
        status: "awaiting_review",
        submittedBy: actor.id,
        submittedAt: new Date(),
      });
    }
    return { ok: true, item: updated };
  }

  async getCombinedBookletView(caseId: string, actor: ActorUser): Promise<ServiceResult<{ combined: ReturnType<typeof buildCombinedDisclosureBookletView> }>> {
    if (actor.role === "client") return { ok: false, error: "Clients cannot view the combined disclosure booklet", status: 403 };
    const folders = await this.getVisibleFoldersForCase(caseId, actor);
    const bookletForRole = (role: string) => {
      const folder = folders.find((candidate) => (candidate.party.role || "").toUpperCase() === role);
      const item = folder?.items.find((candidate) => candidate.itemType === "online_disclosure_booklet");
      return folder && item ? {
        partyId: folder.partyId,
        clientName: partyDisplayName(folder.party),
        payload: ensureFieldBasedBookletPayload(item.payload as Record<string, unknown>),
      } : null;
    };
    return {
      ok: true,
      combined: buildCombinedDisclosureBookletView({
        clientA: bookletForRole("A"),
        clientB: bookletForRole("B"),
      }),
    };
  }

  private async getBookletPdfContext(
    caseId: string,
    partyId: string,
    actor: ActorUser,
  ): Promise<ServiceResult<{ caseRecord: Case; folder: FinancialDisclosureFolderView; item: FinancialDisclosureItem; partyName: string; payload: DisclosureBookletPayload }>> {
    const caseRecord = await storage.getCase(caseId);
    if (!caseRecord) return { ok: false, error: "Case not found", status: 404 };
    const folder = await storage.getFinancialDisclosureFolderByCaseAndParty(caseId, partyId);
    if (!folder) return { ok: false, error: "Financial disclosure folder not found", status: 404 };
    if (!(await this.canActorAccessFolder(actor, folder))) return { ok: false, error: "Access denied", status: 403 };
    const view = await this.assembleFolder(folder);
    const item = view.items.find((candidate) => candidate.itemType === "online_disclosure_booklet");
    if (!item) return { ok: false, error: "Online disclosure booklet not found", status: 404 };
    return {
      ok: true,
      caseRecord,
      folder: view,
      item: item as FinancialDisclosureItem,
      partyName: partyDisplayName(view.party),
      payload: ensureFieldBasedBookletPayload(item.payload as Record<string, unknown>),
    };
  }

  private async getAutoMappedFinancialDisclosureBookletTemplate(): Promise<{ template: CourtFormTemplate | null; diagnostics: FinancialDisclosureBookletAutoMapDiagnostics | null }> {
    const template = await courtFormTemplateService.getCurrentCourtFormTemplate("FinancialDisclosureBooklet");
    if (!template) return { template: null, diagnostics: null };
    const fieldNames = templateFieldNames(template);
    const repaired = autoRepairFinancialDisclosureBookletMapping({
      fieldNames,
      existingMapping: normalizeCourtFormMapping(template.fieldMapping),
    });
    if (!repaired.changed) return { template, diagnostics: repaired.diagnostics };
    const updated = await storage.updateCourtFormTemplate(template.id, { fieldMapping: repaired.fieldMapping });
    return { template: updated || { ...template, fieldMapping: repaired.fieldMapping }, diagnostics: repaired.diagnostics };
  }

  private resolveFinancialDisclosureBookletPdfFields(
    mappingValue: unknown,
    payload: DisclosureBookletPayload,
    partyName: string,
    options: { enforceRequired?: boolean } = {},
  ): FinancialDisclosureBookletResolvedField[] {
    const sourceValues = flattenSingleDisclosureBookletPdfData({ partyName, payload });
    const mapping = normalizeCourtFormMapping(mappingValue);
    return mapping.map((entry) => {
      const value = entry.source === "static"
        ? entry.defaultValue || ""
        : sourceValues[entry.source] || entry.defaultValue || "";
      if (options.enforceRequired !== false && entry.required && !value.trim()) {
        throw new Error(`Required value missing for ${entry.pdfField}`);
      }
      return { ...entry, value, missing: entry.required === true && !value.trim() };
    });
  }

  private assertFinancialDisclosureBookletMappingFillsValues(
    template: Pick<CourtFormTemplate, "fieldMapping" | "fieldNames" | "fieldMetadata">,
    resolvedFields: FinancialDisclosureBookletResolvedField[],
  ) {
    const fieldNames = templateFieldNames(template);
    const mappedFieldNames = new Set(resolvedFields.map((field) => field.pdfField));
    const hasMappedTemplateField = fieldNames.length === 0 || fieldNames.some((fieldName) => mappedFieldNames.has(fieldName));
    const hasBookletValue = resolvedFields.some((field) => field.source.startsWith("financialDisclosureBooklet.") && field.value.trim());
    if (!resolvedFields.length || !hasMappedTemplateField || !hasBookletValue) {
      throw new Error("Financial disclosure booklet auto-mapping could not find any safe PDF field matches that fill saved booklet values. Review the Financial Disclosure Booklet template mapping before exporting.");
    }
  }

  async getFinancialDisclosureBookletPdfPreviewState(
    caseId: string,
    partyId: string,
    actor: ActorUser,
  ): Promise<ServiceResult<FinancialDisclosureBookletPdfPreviewState>> {
    if (actor.role === "client") return { ok: false, error: "Clients cannot preview financial disclosure booklet PDFs", status: 403 };
    const context = await this.getBookletPdfContext(caseId, partyId, actor);
    if (!context.ok) return context as ServiceResult<FinancialDisclosureBookletPdfPreviewState>;
    const { template, diagnostics } = await this.getAutoMappedFinancialDisclosureBookletTemplate();
    if (!template) return { ok: true, template: null, resolvedFields: [], mappingDiagnostics: null, canEdit: this.canUpdateItem(actor, context.item, context.folder) };
    return {
      ok: true,
      template: {
        id: template.id,
        formType: template.formType,
        versionLabel: template.versionLabel,
        isCurrent: template.isCurrent,
        fieldNames: template.fieldNames,
        fieldMetadata: template.fieldMetadata,
        fieldMapping: template.fieldMapping,
      },
      resolvedFields: this.resolveFinancialDisclosureBookletPdfFields(template.fieldMapping, context.payload, context.partyName, { enforceRequired: false }),
      mappingDiagnostics: diagnostics,
      canEdit: this.canUpdateItem(actor, context.item, context.folder),
    };
  }

  async previewFinancialDisclosureBookletPdf(
    caseId: string,
    partyId: string,
    actor: ActorUser,
  ): Promise<ServiceResult<{ filename: string; buffer: Buffer }>> {
    if (actor.role === "client") return { ok: false, error: "Clients cannot preview financial disclosure booklet PDFs", status: 403 };
    const context = await this.getBookletPdfContext(caseId, partyId, actor);
    if (!context.ok) return context as ServiceResult<{ filename: string; buffer: Buffer }>;
    const { template } = await this.getAutoMappedFinancialDisclosureBookletTemplate();
    if (!template) return { ok: false, error: "No current Financial Disclosure Booklet PDF template is configured", status: 400 };
    try {
      const resolvedFields = this.resolveFinancialDisclosureBookletPdfFields(template.fieldMapping, context.payload, context.partyName);
      const values = Object.fromEntries(resolvedFields.map((field) => [field.pdfField, field.value]));
      const pdfBytes = await fillCourtFormPdfBytes(await courtFormTemplateService.getTemplateBuffer(template), values);
      return {
        ok: true,
        filename: `${context.caseRecord.caseRef || caseId}_${safeFileName(context.partyName)}_Financial_Disclosure_Booklet_preview.pdf`,
        buffer: Buffer.from(pdfBytes),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to preview financial disclosure booklet PDF", status: 400 };
    }
  }

  async exportFinancialDisclosureBookletPdf(
    caseId: string,
    partyId: string,
    actor: ActorUser,
  ): Promise<ServiceResult<{ filename: string; buffer: Buffer }>> {
    if (actor.role === "client") return { ok: false, error: "Clients cannot export financial disclosure booklet PDFs", status: 403 };
    const context = await this.getBookletPdfContext(caseId, partyId, actor);
    if (!context.ok) return context as ServiceResult<{ filename: string; buffer: Buffer }>;
    const { template } = await this.getAutoMappedFinancialDisclosureBookletTemplate();
    if (!template) return { ok: false, error: "No current Financial Disclosure Booklet PDF template is configured", status: 400 };
    try {
      const resolvedFields = this.resolveFinancialDisclosureBookletPdfFields(template.fieldMapping, context.payload, context.partyName);
      this.assertFinancialDisclosureBookletMappingFillsValues(template, resolvedFields);
      const values = Object.fromEntries(resolvedFields.map((field) => [field.pdfField, field.value]));
      const pdfBytes = await fillCourtFormPdfBytes(await courtFormTemplateService.getTemplateBuffer(template), values);
      const date = new Date().toISOString().slice(0, 10);
      return {
        ok: true,
        filename: `${context.caseRecord.caseRef || caseId}_${safeFileName(context.partyName)}_Financial_Disclosure_Booklet_${date}.pdf`,
        buffer: Buffer.from(pdfBytes),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to export financial disclosure booklet PDF", status: 400 };
    }
  }

  async updateBookletPdfField(
    caseId: string,
    partyId: string,
    actor: ActorUser,
    input: { source: string; value: string },
  ): Promise<ServiceResult<{ item: FinancialDisclosureItem }>> {
    if (actor.role === "client") return { ok: false, error: "Clients cannot update financial disclosure booklet PDFs", status: 403 };
    if (!input.source.startsWith("financialDisclosureBooklet.")) {
      return { ok: false, error: "PDF field updates must target financialDisclosureBooklet sources", status: 400 };
    }
    const context = await this.getBookletPdfContext(caseId, partyId, actor);
    if (!context.ok) return context as ServiceResult<{ item: FinancialDisclosureItem }>;
    if (!this.canUpdateItem(actor, context.item, context.folder)) return { ok: false, error: "Not authorised to update this booklet", status: 403 };
    let nextPayload: DisclosureBookletPayload;
    try {
      nextPayload = setDisclosureBookletAnswerByPdfSource(context.payload, input.source, input.value);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Invalid financial disclosure booklet PDF source", status: 400 };
    }
    const sectionKey = input.source.replace(/^financialDisclosureBooklet\./, "").split(".")[0];
    const now = new Date().toISOString();
    if (nextPayload.progress[sectionKey]) {
      nextPayload = ensureFieldBasedBookletPayload({
        ...nextPayload,
        progress: {
          ...nextPayload.progress,
          [sectionKey]: {
            ...nextPayload.progress[sectionKey],
            status: nextPayload.progress[sectionKey].status === "not_started" ? "in_progress" : nextPayload.progress[sectionKey].status,
            updatedAt: now,
          },
        },
      });
    }
    const updated = await storage.updateFinancialDisclosureItem(context.item.id, {
      payload: nextPayload,
      status: financialDisclosureItemStatusFromProgress(nextPayload.progress),
      completedAt: Object.values(nextPayload.progress).every((row) => row.status === "submitted") ? context.item.completedAt : null,
      completedBy: Object.values(nextPayload.progress).every((row) => row.status === "submitted") ? context.item.completedBy : null,
      updatedBy: actor.id,
    });
    if (!updated) return { ok: false, error: "Failed to update booklet PDF field", status: 500 };
    return { ok: true, item: updated };
  }

  async listBookletTemplates(actor: ActorUser): Promise<ServiceResult<{ templates: FinancialDisclosureBookletTemplate[] }>> {
    if (!canEditStaffItem(actor)) return { ok: false, error: "Only staff can manage financial disclosure booklet templates", status: 403 };
    return { ok: true, templates: await storage.listFinancialDisclosureBookletTemplates() };
  }

  async createBookletTemplate(
    actor: ActorUser,
    input: { versionLabel: string; sourceFileName: string; fileData: string; mimeType?: string | null; notes?: string | null },
  ): Promise<ServiceResult<{ template: FinancialDisclosureBookletTemplate }>> {
    if (actor.role !== "superadmin" && actor.role !== "subadmin") return { ok: false, error: "Only admins can upload financial disclosure booklet templates", status: 403 };
    if (!input.sourceFileName.toLowerCase().endsWith(".docx")) return { ok: false, error: "Financial disclosure booklet templates must be DOCX files", status: 400 };
    const parsed = parseDataUrl(input.fileData);
    const mimeType = input.mimeType || parsed.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const rendered = renderDocxTemplate(parsed.buffer, {});
    const emptyPayload = ensureFieldBasedBookletPayload({});
    const allowed = new Set(Object.keys(flattenDisclosureBookletTemplateData(buildCombinedDisclosureBookletView({
      clientA: { partyId: "client-a", clientName: "Client A", payload: emptyPayload },
      clientB: { partyId: "client-b", clientName: "Client B", payload: emptyPayload },
    }))));
    const unknown = rendered.placeholders.filter((key) => !allowed.has(key));
    if (unknown.length) return { ok: false, error: `Template contains unsupported financial disclosure placeholders: ${unknown.join(", ")}`, status: 400 };
    const storageName = `${crypto.randomUUID()}-${safeFileName(input.sourceFileName)}`;
    const stored = await fileStorageService.saveCourtFormTemplateFile({ fileName: storageName, buffer: parsed.buffer, mimeType });
    const template = await storage.createFinancialDisclosureBookletTemplate({
      versionLabel: input.versionLabel,
      sourceFileName: input.sourceFileName,
      sourceFileUrl: stored.fileUrl,
      storageKey: stored.storageKey,
      mimeType,
      isCurrent: false,
      placeholderKeys: rendered.placeholders,
      uploadedBy: actor.id,
      notes: input.notes || null,
    });
    const current = await storage.markFinancialDisclosureBookletTemplateCurrent(template.id, actor.id);
    return { ok: true, template: current || template };
  }

  async markBookletTemplateCurrent(id: string, actor: ActorUser): Promise<ServiceResult<{ template: FinancialDisclosureBookletTemplate }>> {
    if (actor.role !== "superadmin" && actor.role !== "subadmin") return { ok: false, error: "Only admins can mark financial disclosure booklet templates current", status: 403 };
    const template = await storage.getFinancialDisclosureBookletTemplate(id);
    if (!template) return { ok: false, error: "Financial disclosure booklet template not found", status: 404 };
    const emptyPayload = ensureFieldBasedBookletPayload({});
    const combined = buildCombinedDisclosureBookletView({
      clientA: { partyId: "client-a", clientName: "Client A", payload: emptyPayload },
      clientB: { partyId: "client-b", clientName: "Client B", payload: emptyPayload },
    });
    const allowed = new Set(Object.keys(flattenDisclosureBookletTemplateData(combined)));
    const unknown = (Array.isArray(template.placeholderKeys) ? template.placeholderKeys.map(String) : []).filter((key) => !allowed.has(key));
    if (unknown.length) return { ok: false, error: `Template contains unsupported financial disclosure placeholders: ${unknown.join(", ")}`, status: 400 };
    const updated = await storage.markFinancialDisclosureBookletTemplateCurrent(id, actor.id);
    if (!updated) return { ok: false, error: "Failed to mark financial disclosure booklet template current", status: 500 };
    return { ok: true, template: updated };
  }

  private async buildDraftScheduleSource(caseId: string, actor: ActorUser): Promise<ServiceResult<{ caseRecord: Case; source: DraftFinancialScheduleSource }>> {
    const caseRecord = await storage.getCase(caseId);
    if (!caseRecord) return { ok: false, error: "Case not found", status: 404 };
    const combinedResult = await this.getCombinedBookletView(caseId, actor);
    if (!combinedResult.ok) return combinedResult as ServiceResult<{ caseRecord: Case; source: DraftFinancialScheduleSource }>;
    return {
      ok: true,
      caseRecord,
      source: {
        caseRef: caseRecord.caseRef || caseId,
        clientAName: combinedResult.combined.clientA?.clientName || "Client A",
        clientBName: combinedResult.combined.clientB?.clientName || "Client B",
        currentDate: new Date().toISOString().slice(0, 10),
        clientAAnswers: combinedResult.combined.answerPayloads.clientA,
        clientBAnswers: combinedResult.combined.answerPayloads.clientB,
      },
    };
  }

  async ensureDraftFinancialScheduleForSession(sessionId: string, actor: ActorUser): Promise<ServiceResult<{ schedule: CaseDraftFinancialSchedule | null }>> {
    const session = await storage.getMediationSession(sessionId);
    if (!session) return { ok: false, error: "Mediation session not found", status: 404 };
    if (session.status !== "scheduled") return { ok: true, schedule: null };
    const existing = await storage.getMediationSessionDraftFinancialSchedule(session.id);
    if (existing) return { ok: true, schedule: existing };
    const sourceResult = await this.buildDraftScheduleSource(session.caseId, actor);
    if (!sourceResult.ok) return sourceResult as ServiceResult<{ schedule: CaseDraftFinancialSchedule | null }>;
    if (!isFinancialDisclosureEligibleCase(sourceResult.caseRecord)) return { ok: true, schedule: null };
    const payload = applyDraftFinancialSchedulePrefill(normalizeDraftFinancialSchedulePayload({}), sourceResult.source);
    const schedule = await storage.upsertMediationSessionDraftFinancialSchedule({
      caseId: session.caseId,
      mediationSessionId: session.id,
      status: "draft",
      payload,
      createdBy: actor.id,
      updatedBy: actor.id,
      confirmedInSessionId: session.id,
    });
    await storage.createCaseDraftFinancialScheduleVersion({
      scheduleId: schedule.id,
      caseId: session.caseId,
      versionNumber: 1,
      status: "draft",
      payload,
      editedBy: actor.id,
      source: "session_confirmation",
      confirmedInSessionId: session.id,
    });
    return { ok: true, schedule };
  }

  private async buildDraftFinancialScheduleEditability(caseId: string, actor: ActorUser, now = new Date()): Promise<DraftFinancialScheduleEditability> {
    if (isScheduleAdmin(actor)) return { canEdit: true, canConfirm: true, reason: null, activeSessionId: null };
    if (actor.role !== "mediator") {
      return { canEdit: false, canConfirm: false, reason: "Only admins and the lead mediator in a live session can amend the draft financial schedule", activeSessionId: null };
    }

    const sessions = await storage.listMediationSessionsByCase(caseId);
    const leadSessions = sessions.filter((session: MediationSession) => session.leadMediatorId === actor.id);
    if (leadSessions.length === 0) {
      return { canEdit: false, canConfirm: false, reason: "Draft financial schedule is locked to the lead mediator during a live mediation session", activeSessionId: null };
    }

    const parties = await storage.listPartiesByCase(caseId);
    const clientPartyIds = new Set(parties.map((party) => party.id));
    for (const session of leadSessions) {
      if (session.status === "scheduled" && session.appointmentId) {
        const appointment = await storage.getAppointment(session.appointmentId);
        if (appointment && appointment.status === "confirmed") {
          const startAt = new Date(appointment.dateTime);
          const endAt = sessionEndTime(appointment);
          if (!(now >= startAt && now <= endAt)) continue;
          const attendanceRows = await storage.listMediationSessionPartyAttendanceBySessionIds([session.id]);
          const noShowPartyIds = attendanceRows.filter((row) => clientPartyIds.has(row.partyId)).map((row) => row.partyId);
          if (noShowPartyIds.length > 0) {
            return { canEdit: false, canConfirm: false, reason: "Draft financial schedule cannot be amended because a party is marked as no-show", activeSessionId: session.id };
          }
          return { canEdit: true, canConfirm: true, reason: null, activeSessionId: session.id };
        }
      }
    }

    return { canEdit: false, canConfirm: false, reason: "Draft financial schedule is locked outside a live mediation session", activeSessionId: null };
  }

  private async validateDraftFinancialScheduleAmendment(caseId: string, actor: ActorUser, attestation?: DraftFinancialSchedulePresenceAttestation | null): Promise<ServiceResult<{ editability: DraftFinancialScheduleEditability; confirmedInSessionId: string | null }>> {
    const editability = await this.buildDraftFinancialScheduleEditability(caseId, actor);
    if (!editability.canEdit) return { ok: false, error: editability.reason || "Draft financial schedule is locked outside a live mediation session", status: 403 };
    if (isScheduleAdmin(actor)) return { ok: true, editability, confirmedInSessionId: null };
    if (attestation?.bothPartiesPresent !== true || attestation.sessionId !== editability.activeSessionId) {
      return { ok: false, error: "Confirm both parties are present before updating the draft financial schedule", status: 409 };
    }
    return { ok: true, editability, confirmedInSessionId: editability.activeSessionId };
  }

  private async getAutoMappedDraftFinancialScheduleTemplate(): Promise<{ template: CourtFormTemplate | null; diagnostics: DraftFinancialScheduleAutoMapDiagnostics | null }> {
    const template = await courtFormTemplateService.getCurrentCourtFormTemplate("DraftFinancialSchedule");
    if (!template) return { template: null, diagnostics: null };
    const fieldNames = templateFieldNames(template);
    const reconciled = await reconcileDraftFinancialScheduleTemplateMapping(template, fieldNames, {
      updateIfUnchanged: (id, expected, next) => storage.updateCourtFormTemplateMappingIfUnchanged(id, expected, next),
      reload: (id) => storage.getCourtFormTemplate(id),
    });
    return { template: reconciled.template, diagnostics: reconciled.diagnostics };
  }

  private async buildDraftFinancialSchedulePdfPreviewState(payload: DraftFinancialSchedulePayload): Promise<DraftFinancialSchedulePdfPreviewState> {
    const { template, diagnostics } = await this.getAutoMappedDraftFinancialScheduleTemplate();
    if (!template) return { template: null, resolvedFields: [], mappingDiagnostics: null };
    return {
      template: {
        id: template.id,
        formType: template.formType,
        versionLabel: template.versionLabel,
        isCurrent: template.isCurrent,
        fieldNames: template.fieldNames,
        fieldMetadata: template.fieldMetadata,
        fieldMapping: template.fieldMapping,
      },
      resolvedFields: resolveDraftFinancialSchedulePdfFields(template.fieldMapping, payload, { enforceRequired: false }),
      mappingDiagnostics: diagnostics,
    };
  }

  private async summarizeDraftScheduleVersions(versions: CaseDraftFinancialScheduleVersion[]): Promise<DraftFinancialScheduleVersionSummary[]> {
    const userIds = Array.from(new Set(versions.map((version) => version.editedBy).filter(Boolean) as string[]));
    const users = await Promise.all(userIds.map((id) => storage.getUser(id)));
    const namesById = new Map(users.filter(Boolean).map((user) => [user!.id, user!.name]));
    return versions.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      editedBy: version.editedBy,
      editedByName: version.editedBy ? namesById.get(version.editedBy) || "Unknown" : "Unknown",
      editedAt: version.editedAt,
      source: version.source,
      confirmedInSessionId: version.confirmedInSessionId,
    }));
  }

  async getDraftFinancialSchedule(caseId: string, actor: ActorUser): Promise<ServiceResult<DraftFinancialScheduleView>> {
    if (actor.role === "client") return { ok: false, error: "Clients cannot view the draft financial schedule", status: 403 };
    if (!canEditStaffItem(actor)) return { ok: false, error: "Only staff can view draft financial schedules", status: 403 };
    const sourceResult = await this.buildDraftScheduleSource(caseId, actor);
    if (!sourceResult.ok) return sourceResult as ServiceResult<DraftFinancialScheduleView>;
    const schedule = await storage.getCaseDraftFinancialSchedule(caseId);
    const payload = applyDraftFinancialSchedulePrefill(schedule?.payload as Record<string, unknown> | undefined, sourceResult.source);
    const versions = schedule ? await this.summarizeDraftScheduleVersions(await storage.listDraftScheduleVersions(schedule.id)) : [];
    const editability = await this.buildDraftFinancialScheduleEditability(caseId, actor);
    const pdfPreview = await this.buildDraftFinancialSchedulePdfPreviewState(payload);
    const activeSession = editability.activeSessionId ? await storage.getMediationSession(editability.activeSessionId) : null;
    return {
      ok: true,
      schedule: schedule || null,
      payload,
      latestVersion: versions[0] || null,
      versions,
      editability,
      pdfPreview,
      reviewContext: {
        willSubmitWithPostSessionReview: schedule?.status === "confirmed" && activeSession?.postSessionReviewStatus !== "submitted" && activeSession?.postSessionReviewStatus !== "approved",
        activeSessionId: editability.activeSessionId,
        activeSessionPostSessionReviewStatus: activeSession?.postSessionReviewStatus || null,
      },
    };
  }

  async saveDraftFinancialSchedule(
    caseId: string,
    actor: ActorUser,
    input: { payload: Record<string, unknown>; status?: DraftFinancialScheduleStatus; presenceAttestation?: DraftFinancialSchedulePresenceAttestation | null },
  ): Promise<ServiceResult<{ schedule: CaseDraftFinancialSchedule; payload: DraftFinancialSchedulePayload }>> {
    if (!canEditStaffItem(actor)) return { ok: false, error: "Only staff can update draft financial schedules", status: 403 };
    const access = await this.validateDraftFinancialScheduleAmendment(caseId, actor, input.presenceAttestation);
    if (!access.ok) return access as ServiceResult<{ schedule: CaseDraftFinancialSchedule; payload: DraftFinancialSchedulePayload }>;
    const sourceResult = await this.buildDraftScheduleSource(caseId, actor);
    if (!sourceResult.ok) return sourceResult as ServiceResult<{ schedule: CaseDraftFinancialSchedule; payload: DraftFinancialSchedulePayload }>;
    const payload = applyDraftFinancialSchedulePrefill(normalizeDraftFinancialSchedulePayload(input.payload), sourceResult.source);
    const existing = await storage.getCaseDraftFinancialSchedule(caseId);
    const status = normalizeDraftFinancialScheduleStatus(input.status);
    const now = new Date();
    const confirmedInSessionId = access.confirmedInSessionId;
    const schedule = await storage.upsertCaseDraftFinancialSchedule({
      caseId,
      status,
      payload,
      createdBy: existing?.createdBy || actor.id,
      updatedBy: actor.id,
      confirmedAt: status === "confirmed" ? now : existing?.confirmedAt ?? null,
      confirmedBy: status === "confirmed" ? actor.id : existing?.confirmedBy ?? null,
      confirmedInSessionId: status === "confirmed" ? confirmedInSessionId : existing?.confirmedInSessionId ?? null,
    });
    const versionNumber = await storage.getNextDraftScheduleVersionNumber(schedule.id);
    const versionSource = status === "confirmed" ? "confirm" : "save";
    const version = await storage.createCaseDraftFinancialScheduleVersion({
      scheduleId: schedule.id,
      caseId,
      versionNumber,
      status,
      payload,
      editedBy: actor.id,
      editedAt: now,
      source: versionSource,
      confirmedInSessionId: status === "confirmed" ? confirmedInSessionId : null,
    });
    const activityStatus = status === "confirmed" ? "confirmed" : "saved";
    await caseActivityService.log({
      caseId,
      type: status === "confirmed" ? "draft_financial_schedule_confirmed" : "draft_financial_schedule_saved",
      title: status === "confirmed" ? "Draft Financial Schedule confirmed" : "Draft Financial Schedule saved",
      description: `Version ${version.versionNumber} ${activityStatus} by ${actor.name}`,
      actor: staffActor(actor),
      relatedEntityId: schedule.id,
      relatedEntityType: "draft_financial_schedule",
      metadata: JSON.stringify({
        scheduleId: schedule.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        status,
        source: versionSource,
        confirmedInSessionId: version.confirmedInSessionId,
      }),
    }).catch(() => {});
    if (status === "confirmed") {
      const { caseProofingService } = await import("./case-proofing.service");
      await caseProofingService.ensureProofingItemForSource({
        caseId,
        sessionId: confirmedInSessionId || null,
        itemType: "draft_financial_schedule",
        sourceEntityType: "case_draft_financial_schedule",
        sourceEntityId: schedule.id,
        status: "awaiting_review",
        submittedBy: actor.id,
        submittedAt: now,
      });
    }
    return { ok: true, schedule, payload };
  }

  async exportDraftFinancialSchedulePdf(caseId: string, actor: ActorUser): Promise<ServiceResult<{ filename: string; buffer: Buffer }>> {
    if (!canEditStaffItem(actor)) return { ok: false, error: "Only staff can export draft financial schedules", status: 403 };
    const sourceResult = await this.buildDraftScheduleSource(caseId, actor);
    if (!sourceResult.ok) return sourceResult as ServiceResult<{ filename: string; buffer: Buffer }>;
    const { template } = await this.getAutoMappedDraftFinancialScheduleTemplate();
    if (!template) return { ok: false, error: "No current DRAFT FINANCIAL SCHEDULE PDF template is configured", status: 400 };
    const schedule = await storage.getCaseDraftFinancialSchedule(caseId);
    const payload = applyDraftFinancialSchedulePrefill(schedule?.payload as Record<string, unknown> | undefined, sourceResult.source);
    let pdfBytes: Uint8Array;
    try {
      const resolvedFields = resolveDraftFinancialSchedulePdfFields(template.fieldMapping, payload);
      assertDraftFinancialScheduleMappingFillsValues(template, resolvedFields);
      const values = Object.fromEntries(resolvedFields.map((field) => [field.pdfField, field.value]));
      const previewValues = applyPdfFieldOverrides(values, payload as unknown as Record<string, unknown>, template);
      pdfBytes = await fillCourtFormPdfBytes(await courtFormTemplateService.getTemplateBuffer(template), previewValues);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to export draft financial schedule PDF", status: 400 };
    }
    const date = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      filename: `${sourceResult.caseRecord.caseRef || caseId}_Draft_Financial_Schedule_${date}.pdf`,
      buffer: Buffer.from(pdfBytes),
    };
  }

  async previewDraftFinancialSchedulePdf(
    caseId: string,
    actor: ActorUser,
    input: { payload?: Record<string, unknown> | null },
  ): Promise<ServiceResult<{ filename: string; buffer: Buffer }>> {
    if (!canEditStaffItem(actor)) return { ok: false, error: "Only staff can preview draft financial schedules", status: 403 };
    const sourceResult = await this.buildDraftScheduleSource(caseId, actor);
    if (!sourceResult.ok) return sourceResult as ServiceResult<{ filename: string; buffer: Buffer }>;
    const { template } = await this.getAutoMappedDraftFinancialScheduleTemplate();
    if (!template) return { ok: false, error: "No current DRAFT FINANCIAL SCHEDULE PDF template is configured", status: 400 };
    const schedule = await storage.getCaseDraftFinancialSchedule(caseId);
    const basePayload = input.payload || schedule?.payload as Record<string, unknown> | undefined;
    const payload = applyDraftFinancialSchedulePrefill(normalizeDraftFinancialSchedulePayload(basePayload), sourceResult.source);
    let pdfBytes: Uint8Array;
    try {
      const resolvedFields = resolveDraftFinancialSchedulePdfFields(template.fieldMapping, payload);
      const values = Object.fromEntries(resolvedFields.map((field) => [field.pdfField, field.value]));
      const previewValues = applyPdfFieldOverrides(values, payload as unknown as Record<string, unknown>, template);
      pdfBytes = await fillCourtFormPdfBytes(await courtFormTemplateService.getTemplateBuffer(template), previewValues);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Failed to preview draft financial schedule PDF", status: 400 };
    }
    return {
      ok: true,
      filename: `${sourceResult.caseRecord.caseRef || caseId}_Draft_Financial_Schedule_preview.pdf`,
      buffer: Buffer.from(pdfBytes),
    };
  }

  async updateFolderOfsRequired(
    folderId: string,
    actor: ActorUser,
    ofsRequired: string | null,
  ): Promise<ServiceResult<{ folder: FinancialDisclosureFolderView }>> {
    if (ofsRequired !== null && !OFS_VALUES.includes(ofsRequired as typeof OFS_VALUES[number])) {
      return { ok: false, error: "Invalid OFS value", status: 400 };
    }
    const folder = await storage.getFinancialDisclosureFolder(folderId);
    if (!folder) return { ok: false, error: "Financial disclosure folder not found", status: 404 };
    if (!canEditStaffItem(actor)) return { ok: false, error: "Not authorised to update OFS", status: 403 };
    if (!(await this.canActorAccessFolder(actor, folder))) return { ok: false, error: "Access denied", status: 403 };

    await storage.upsertMiamRecord(folder.partyId, folder.caseId, { ofsRequired });
    const view = await this.assembleFolder(folder);
    return { ok: true, folder: view };
  }

  async validateFinancialDisclosureUploadMetadata(
    caseId: string,
    actor: Pick<User, "id" | "role">,
    input: {
      financialDisclosureFolderId?: string | null;
      financialDisclosureItemId?: string | null;
      financialDisclosureEvidenceCategoryId?: string | null;
      financialDisclosureUploadTarget?: FinancialDisclosureUploadTarget | null;
    },
  ): Promise<FinancialDisclosureTag | null> {
    const hasMetadata = Boolean(
      input.financialDisclosureFolderId
        || input.financialDisclosureItemId
        || input.financialDisclosureEvidenceCategoryId
        || input.financialDisclosureUploadTarget,
    );
    if (!hasMetadata) return null;
    if (!input.financialDisclosureFolderId) throw new Error("Financial disclosure folder is required");
    if (!input.financialDisclosureUploadTarget) throw new Error("Financial disclosure upload target is required");
    if (!FINANCIAL_DISCLOSURE_UPLOAD_TARGETS.includes(input.financialDisclosureUploadTarget)) {
      throw new Error("Invalid financial disclosure upload target");
    }

    const folder = await storage.getFinancialDisclosureFolder(input.financialDisclosureFolderId);
    if (!folder || folder.caseId !== caseId) throw new Error("Financial disclosure folder does not belong to this case");
    if (!(await this.canActorAccessFolder(actor, folder))) throw new Error("Financial disclosure folder is not available to this user");

    let itemId: string | null = null;
    let evidenceCategoryId: string | null = null;

    if (input.financialDisclosureUploadTarget === "form_e") {
      if (!(await this.canActorUploadToFolder(actor, folder))) {
        throw new Error("Only clients, staff, or assigned mediators can upload Form E documents");
      }
      if (input.financialDisclosureItemId) {
        throw new Error("Form E uploads must not be attached to a financial disclosure item");
      }
      if (input.financialDisclosureEvidenceCategoryId) {
        throw new Error("Evidence category can only be used with evidence category uploads");
      }
    }

    if (input.financialDisclosureUploadTarget === "online_disclosure_booklet" || input.financialDisclosureUploadTarget === "financial_disclosure_checklist") {
      if (!input.financialDisclosureItemId) throw new Error("Financial disclosure item is required for this upload target");
      const item = await storage.getFinancialDisclosureItem(input.financialDisclosureItemId);
      if (!item || item.folderId !== folder.id || item.itemType !== input.financialDisclosureUploadTarget) {
        throw new Error("Financial disclosure item does not belong to this folder and target");
      }
      if (item.itemType === "financial_disclosure_checklist" && !canEditStaffItem(actor as ActorUser)) {
        throw new Error("Only staff or assigned mediators can upload checklist documents");
      }
      itemId = item.id;
    }

    if (input.financialDisclosureUploadTarget === "ofs" && input.financialDisclosureItemId) {
      throw new Error("OFS uploads must not be attached to a financial disclosure item");
    }

    if (input.financialDisclosureUploadTarget === "evidence_category") {
      if (!input.financialDisclosureEvidenceCategoryId) throw new Error("Financial disclosure evidence category is required");
      const category = await storage.getFinancialDisclosureEvidenceCategory(input.financialDisclosureEvidenceCategoryId);
      if (!category || category.folderId !== folder.id) {
        throw new Error("Financial disclosure evidence category does not belong to this folder");
      }
      evidenceCategoryId = category.id;
    } else if (input.financialDisclosureEvidenceCategoryId) {
      throw new Error("Evidence category can only be used with evidence category uploads");
    }

    return {
      folderId: folder.id,
      itemId,
      evidenceCategoryId,
      uploadTarget: input.financialDisclosureUploadTarget,
    };
  }

  canUpdateItem(actor: ActorUser, item: FinancialDisclosureItem, folder?: FinancialDisclosureFolder): boolean {
    if (item.itemType === "financial_disclosure_checklist") {
      return canEditStaffItem(actor);
    }
    if (item.itemType !== "online_disclosure_booklet") return false;
    if (actor.role !== "client") return canEditStaffItem(actor);
    return Boolean(folder);
  }

  private async canActorUploadToFolder(actor: Pick<User, "id" | "role">, folder: FinancialDisclosureFolder): Promise<boolean> {
    const party = await storage.getParty(folder.partyId) as PartySummary | undefined;
    if (actor.role === "client") return party?.userId === actor.id;
    return hasFullOperationalCaseAccess(await classifyCaseAccess(folder.caseId, actor));
  }

  private async canActorAccessFolder(actor: Pick<User, "id" | "role">, folder: FinancialDisclosureFolder): Promise<boolean> {
    const party = await storage.getParty(folder.partyId) as PartySummary | undefined;
    if (actor.role === "client") return party?.userId === actor.id;
    return hasFullOperationalCaseAccess(await classifyCaseAccess(folder.caseId, actor));
  }

  private async seedFolderItems(folderId: string): Promise<void> {
    for (const item of ITEM_DEFINITIONS) {
      const row = await storage.createFinancialDisclosureItem({
        folderId,
        itemType: item.itemType,
        title: item.title,
        description: item.description,
        status: item.status,
        payload: item.itemType === "online_disclosure_booklet"
          ? ensureFieldBasedBookletPayload(item.payload)
          : ensureChecklistPayload(item.payload),
        completedAt: null,
        completedBy: null,
        updatedBy: null,
      });
      const normalizedPayload = row.itemType === "online_disclosure_booklet"
        ? ensureFieldBasedBookletPayload(row.payload as Record<string, unknown>)
        : ensureChecklistPayload(row.payload as Record<string, unknown>);
      const hasExpectedPayload = row.itemType === "online_disclosure_booklet"
        ? Boolean((row.payload as any)?.bookletSchemaVersion && (row.payload as any)?.answers)
        : Array.isArray((row.payload as any)?.rows);
      if (!hasExpectedPayload) {
        await storage.updateFinancialDisclosureItem(row.id, { payload: normalizedPayload });
      }
    }
  }

  private async seedEvidenceCategories(folderId: string): Promise<void> {
    for (let index = 0; index < FINANCIAL_DISCLOSURE_EVIDENCE_CATEGORY_DEFINITIONS.length; index++) {
      const category = FINANCIAL_DISCLOSURE_EVIDENCE_CATEGORY_DEFINITIONS[index];
      await storage.createFinancialDisclosureEvidenceCategory({
        folderId,
        categoryKey: category.key,
        label: category.label,
        description: category.description,
        sortOrder: index + 1,
      });
    }
  }

  private async logCreatedFolder(
    folder: FinancialDisclosureFolder,
    party: PartySummary,
    triggerSource: FolderTriggerSource,
    actor?: ActorUser | null,
  ): Promise<void> {
    const activityActor = actor ? staffActor(actor) : systemActor("financial disclosure folder creation");
    await caseActivityService.log({
      caseId: folder.caseId,
      type: "financial_disclosure_folder_created",
      title: "Financial Disclosure and Support Folder created",
      description: `SOP 1.3a folder created for ${partyDisplayName(party)} after ${triggerSource.replaceAll("_", " ")} identified AIM/PF case type.`,
      actor: activityActor,
    }).catch(() => {});
    await logAudit({
      userId: actor?.id,
      action: "create_financial_disclosure_folder",
      entity: "case",
      entityId: folder.caseId,
      details: JSON.stringify({ triggerSource, folderId: folder.id, partyId: folder.partyId }),
    });
  }

  private async assembleFolder(folder: FinancialDisclosureFolder, partyOverride?: PartySummary): Promise<FinancialDisclosureFolderView> {
    const [items, categories, documents, party, miamRecord, demographicRecord] = await Promise.all([
      storage.listFinancialDisclosureItems(folder.id),
      storage.listFinancialDisclosureEvidenceCategories(folder.id),
      storage.listCaseDocumentsByCase(folder.caseId),
      partyOverride ? Promise.resolve(partyOverride) : storage.getParty(folder.partyId) as Promise<PartySummary | undefined>,
      storage.getMiamRecord(folder.partyId, folder.caseId),
      storage.getDemographicDataByParty(folder.partyId),
    ]);
    const resolvedParty = party || { id: folder.partyId, caseId: folder.caseId, clientId: "", role: "" };
    const sourceSummary = this.buildSourceSummary(resolvedParty, demographicRecord);
    const viewItems = items.map((item) => item.itemType === "online_disclosure_booklet"
      ? {
        ...item,
        payload: applyDisclosureSourcePrefill(item.payload as Record<string, unknown>, sourceSummary),
      }
      : item);
    const folderDocuments = documents
      .filter((document) => document.financialDisclosureFolderId === folder.id)
      .map(withProtectedCaseDocumentUrl);
    const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      ...folder,
      party: resolvedParty,
      ofsRequired: miamRecord?.ofsRequired || null,
      sourceSummary,
      items: viewItems,
      evidenceCategories: sortedCategories.map((category) => ({
        ...category,
        documents: folderDocuments.filter((document) => document.financialDisclosureEvidenceCategoryId === category.id),
      })),
      documents: folderDocuments,
    };
  }

  private buildSourceSummary(party: PartySummary, demographicRecord?: Record<string, unknown> | null): FinancialDisclosureSourceSummary {
    const demo = demographicRecord || {};
    const address = [
      (party as any).addressLine1,
      (party as any).addressLine2,
      (party as any).city,
      (party as any).postcode,
      (party as any).country,
    ].filter(Boolean).join(", ");
    const phone = [(party as any).phoneCode, (party as any).phone].filter(Boolean).join(" ");
    return {
      clientName: partyDisplayName(party),
      dateOfBirth: String(demo.dateOfBirth || (party as any).dateOfBirth || "") || null,
      email: String((party as any).email || "") || null,
      phone: phone || null,
      address: address || null,
      nationalInsuranceNumber: String((party as any).nationalInsuranceNumber || "") || null,
      employmentStatus: String(demo.employmentStatus || "") || null,
      legalAidEligible: String(demo.legalAidEligible || "") || null,
      voucherSchemeEligible: String(demo.voucherSchemeEligible || "") || null,
      courtProceedingsStatus: String(demo.courtProceedingsStatus || "") || null,
      courtReference: String(demo.courtReference || "") || null,
      courtName: String(demo.courtName || "") || null,
      cafcassInvolved: String(demo.cafcassInvolved || "") || null,
      solicitorInvolved: String(demo.solicitorInvolved || "") || null,
      solicitorName: String(demo.solicitorName || "") || null,
      childrenAges: String(demo.childrenAges || "") || null,
      additionalNeeds: String(demo.additionalNeeds || (party as any).additionalNeeds || "") || null,
    };
  }
}

export const financialDisclosureService = new FinancialDisclosureService();
