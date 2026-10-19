import { storage } from "../storage";
import type { Case, Client, CourtFormTemplate, DemographicData, MiamRecord, Party } from "@shared/schema";
import { COURT_FORM_MERGE_SOURCE_GROUPS, COURT_FORM_MERGE_SOURCE_VALUES } from "@shared/court-form-merge-sources";

export type CourtFormMappingEntry = {
  pdfField: string;
  source: string;
  required?: boolean;
  defaultValue?: string | null;
};
export type CourtFormResolvedField = CourtFormMappingEntry & {
  value: string;
  missing: boolean;
  draftKey?: string | null;
};

export const COURT_FORM_MERGE_SOURCES = COURT_FORM_MERGE_SOURCE_VALUES;

type MergeContext = {
  caseRecord: Case;
  party: Party;
  client: Client;
  demographicData?: DemographicData | null;
  miamRecord?: MiamRecord | null;
  answers: Record<string, unknown>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stringify(item)).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function address(client: Client): string {
  return [client.addressLine1, client.addressLine2, client.city, client.postcode, client.country].filter(Boolean).join(", ");
}

function draftKey(source: string): string | null {
  return source.startsWith("draft.") ? source.replace(/^draft\./, "") : null;
}

function getDraftValue(answers: Record<string, unknown>, source: string): unknown {
  const key = draftKey(source) || "";
  return key.split(".").reduce<unknown>((current, part) => {
    if (!isObject(current)) return undefined;
    return current[part];
  }, answers);
}

function pathValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!isObject(current)) return undefined;
    return current[part];
  }, value);
}

export function normalizeCourtFormMapping(value: unknown): CourtFormMappingEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((entry) => ({
      pdfField: stringify(entry.pdfField).trim(),
      source: stringify(entry.source).trim(),
      required: Boolean(entry.required),
      defaultValue: entry.defaultValue === undefined || entry.defaultValue === null ? null : stringify(entry.defaultValue),
    }))
    .filter((entry) => entry.pdfField && entry.source);
}

class CourtFormMappingService {
  validateFieldMapping(template: Pick<CourtFormTemplate, "fieldNames">, mappingValue: unknown): CourtFormMappingEntry[] {
    const fieldNames = Array.isArray(template.fieldNames) ? template.fieldNames.map(String) : [];
    const fieldSet = new Set(fieldNames);
    const mapping = normalizeCourtFormMapping(mappingValue);
    for (const entry of mapping) {
      if (!fieldSet.has(entry.pdfField)) {
        throw new Error(`Unknown PDF field: ${entry.pdfField}`);
      }
      if (!this.isAllowedSource(entry.source)) {
        throw new Error(`Unknown court form merge source: ${entry.source}`);
      }
    }
    return mapping;
  }

  isAllowedSource(source: string): boolean {
    return source.startsWith("draft.")
      || COURT_FORM_MERGE_SOURCE_VALUES.includes(source);
  }

  async buildContext(caseId: string, partyId: string, answers: Record<string, unknown>): Promise<MergeContext> {
    const [caseRecord, party] = await Promise.all([
      storage.getCase(caseId),
      storage.getParty(partyId),
    ]);
    if (!caseRecord) throw new Error("Case not found");
    if (!party || party.caseId !== caseId) throw new Error("Party does not belong to this case");
    const [client, miamRecord, demographicData] = await Promise.all([
      storage.getClient(party.clientId),
      storage.getMiamRecord(partyId, caseId),
      storage.getDemographicDataByParty(partyId),
    ]);
    if (!client) throw new Error("Client not found");
    return { caseRecord, party, client, demographicData, miamRecord, answers };
  }

  resolveValue(entry: CourtFormMappingEntry, context: MergeContext): string {
    if (entry.source === "static") return entry.defaultValue || "";
    const value = this.resolveSource(entry.source, context);
    const resolved = stringify(value || entry.defaultValue || "");
    if (entry.required && !resolved.trim()) {
      throw new Error(`Required value missing for ${entry.pdfField}`);
    }
    return resolved;
  }

  resolveField(entry: CourtFormMappingEntry, context: MergeContext): CourtFormResolvedField {
    const value = entry.source === "static"
      ? entry.defaultValue || ""
      : stringify(this.resolveSource(entry.source, context) || entry.defaultValue || "");
    const missing = Boolean(entry.required && !value.trim());
    return { ...entry, value, missing, draftKey: draftKey(entry.source) };
  }

  resolveAllWithDetails(mapping: CourtFormMappingEntry[], context: MergeContext): CourtFormResolvedField[] {
    return mapping.map((entry) => this.resolveField(entry, context));
  }

  resolveAll(mapping: CourtFormMappingEntry[], context: MergeContext): Record<string, string> {
    return Object.fromEntries(mapping.map((entry) => [entry.pdfField, this.resolveValue(entry, context)]));
  }

  private resolveSource(source: string, context: MergeContext): unknown {
    const { caseRecord, party, client, demographicData, miamRecord, answers } = context;
    switch (source) {
      case "case.caseRef": return caseRecord.caseRef;
      case "case.stage": return caseRecord.stage;
      case "case.issueType": return caseRecord.issueType;
      case "case.courtName": return demographicData?.courtName;
      case "case.courtReference": return demographicData?.courtReference;
      case "case.inCourtStatus": return caseRecord.inCourtStatus;
      case "client.firstName": return client.firstName;
      case "client.lastName": return client.lastName;
      case "client.fullName": return `${client.firstName} ${client.lastName}`.trim();
      case "client.dateOfBirth": return client.dateOfBirth;
      case "client.email": return client.email;
      case "client.phone": return client.phone;
      case "client.address": return address(client);
      case "party.role": return party.role;
      default:
        if (source.startsWith("draft.")) return getDraftValue(answers, source);
        if (source.startsWith("demographic.")) return pathValue(demographicData, source.replace(/^demographic\./, ""));
        if (source.startsWith("miam.")) return pathValue(miamRecord, source.replace(/^miam\./, ""));
        return undefined;
    }
  }
}

export { COURT_FORM_MERGE_SOURCE_GROUPS, COURT_FORM_MERGE_SOURCE_VALUES };
export const courtFormMappingService = new CourtFormMappingService();
