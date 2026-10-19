import crypto from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  cases,
  clients,
  legacyClientImportBatches,
  legacyCrmRecordClients,
  legacyCrmRecords,
  parties,
  type Client,
} from "@shared/schema";
import {
  inspectLegacyWorkbook,
  parseLegacyWorkbook,
  type LegacyClientProfile,
  type LegacyColumnMapping,
  type ParsedLegacyPerson,
  type ParsedLegacyRecord,
} from "./legacy-client-import.workbook";
import {
  findLegacyDuplicateMatches,
  groupStagedLegacyPeople,
  type LegacyExistingClientCandidate,
} from "./legacy-client-import.matching";
import { isLegacyOpenCaseStatus, legacyDateToDate } from "./legacy-client-import.open-cases";

export type LegacyImportAction = "use_existing" | "create_new" | "skip";

export interface LegacyImportResolution {
  targetKey: string;
  action: LegacyImportAction;
  memberKeys: string[];
  existingClientId?: string;
  clientData?: LegacyClientProfile;
  reviewedFields?: string[];
}

export interface LegacyWorkbookRequest {
  fileName: string;
  contentBase64: string;
  sheetName: string;
  mapping: LegacyColumnMapping;
  confirmedPlaceholders: string[];
}

export interface LegacyImportCommitRequest extends LegacyWorkbookRequest {
  previewHash: string;
  resolutions: LegacyImportResolution[];
  recordEdits?: Array<{
    sourceRowNumber: number;
    values: Record<string, unknown>;
  }>;
  personEdits?: Array<{ personKey: string; values: Record<string, unknown> }>;
}

type LegacyPreviewCandidate = ReturnType<
  typeof findLegacyDuplicateMatches
>[number] & { memberKeys: string[] };
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PROFILE_FIELDS: Array<keyof LegacyClientProfile> = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "email",
  "phone",
  "phoneCode",
  "gender",
  "ethnicOrigin",
  "nationalInsuranceNumber",
  "disabilityOrHealthCondition",
  "additionalNeeds",
  "addressLine1",
  "addressLine2",
  "city",
  "postcode",
  "country",
];

async function getNextCaseRefTx(tx: DbTransaction): Promise<string> {
  const year = new Date().getFullYear().toString();
  const prefix = `BFM-${year}-`;
  const result = await tx
    .select({ caseRef: cases.caseRef })
    .from(cases)
    .where(sql`${cases.caseRef} LIKE ${prefix + "%"}`)
    .orderBy(sql`${cases.caseRef} DESC`)
    .limit(1);

  const lastRef = result[0]?.caseRef;
  const lastNum = parseInt(lastRef?.split("-").pop() || "0", 10);
  const nextNum = Number.isNaN(lastNum) ? 1 : lastNum + 1;
  return `BFM-${year}-${nextNum.toString().padStart(4, "0")}`;
}

export function normalizeReviewedLegacyProfile(
  profile: LegacyClientProfile,
): LegacyClientProfile {
  const clean = (value: unknown) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  };
  return {
    firstName: clean(profile.firstName) || "",
    lastName: clean(profile.lastName) || "",
    dateOfBirth: clean(profile.dateOfBirth),
    email: clean(profile.email)?.toLowerCase() || null,
    phone: clean(profile.phone)?.replace(/\D/g, "") || null,
    phoneCode: clean(profile.phoneCode),
    gender: clean(profile.gender),
    ethnicOrigin: clean(profile.ethnicOrigin),
    nationalInsuranceNumber: clean(profile.nationalInsuranceNumber),
    disabilityOrHealthCondition: clean(profile.disabilityOrHealthCondition),
    additionalNeeds: clean(profile.additionalNeeds),
    addressLine1: clean(profile.addressLine1),
    addressLine2: clean(profile.addressLine2),
    city: clean(profile.city),
    postcode: clean(profile.postcode),
    country: clean(profile.country),
  };
}

const SAFE_RECORD_FIELDS = new Set([
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
]);

const RECORD_TARGET_TO_SAFE_FIELD: Record<string, string> = {
  legacyStatus: "status",
  mediatorFirstName: "mediatorName",
  mediatorLastName: "mediatorName",
};
const PERSON_TARGET_TO_PROFILE_FIELD: Record<
  string,
  keyof LegacyClientProfile
> = {
  FirstName: "firstName",
  LastName: "lastName",
  DateOfBirth: "dateOfBirth",
  Email: "email",
  Phone: "phone",
  PhoneCountry: "phoneCode",
  AddressLine1: "addressLine1",
  AddressLine2: "addressLine2",
  City: "city",
  Postcode: "postcode",
  Country: "country",
  Gender: "gender",
  EthnicOrigin: "ethnicOrigin",
  EthnicOriginFormatted: "ethnicOrigin",
  Disability: "disabilityOrHealthCondition",
  DisabilityFormatted: "disabilityOrHealthCondition",
  NationalInsuranceNumber: "nationalInsuranceNumber",
  AdditionalNeeds: "additionalNeeds",
};
const PERSON_TARGET_TO_LEGACY_FIELD: Record<string, string> = {
  MiddleName: "middleName",
  AssessmentDate: "assessmentDate",
  LegalAid: "legalAid",
  Confidential: "confidential",
};

export function validateLegacyRecordCorrections(
  records: ParsedLegacyRecord[],
  activeRows: Set<number>,
  edits: Map<number, Record<string, unknown>>,
) {
  for (const record of records) {
    if (!activeRows.has(record.sourceRowNumber)) continue;
    for (const issue of record.errors.filter(
      (candidate) => candidate.code === "formula_cell" && candidate.field,
    )) {
      const safeField =
        RECORD_TARGET_TO_SAFE_FIELD[issue.field!] || issue.field!;
      if (
        !Object.prototype.hasOwnProperty.call(
          edits.get(record.sourceRowNumber) || {},
          safeField,
        )
      ) {
        throw new Error(
          `Row ${record.sourceRowNumber} formula field ${safeField} requires an explicit reviewed correction`,
        );
      }
    }
  }
}

export function validateLegacyPersonCorrections(
  people: ParsedLegacyPerson[],
  resolutions: LegacyImportResolution[],
  personEdits: Map<string, Record<string, unknown>>,
) {
  for (const person of people) {
    const resolution = resolutions.find((candidate) =>
      candidate.memberKeys.includes(person.personKey),
    );
    if (!resolution || resolution.action === "skip") continue;
    for (const issue of person.errors.filter(
      (candidate) => candidate.code === "formula_cell" && candidate.field,
    )) {
      const suffix = issue.field!.replace(/^client[12]/, "");
      const profileField = PERSON_TARGET_TO_PROFILE_FIELD[suffix];
      if (profileField && !resolution.reviewedFields?.includes(profileField)) {
        throw new Error(
          `Formula field ${profileField} for ${person.personKey} requires an explicit reviewed correction`,
        );
      }
      const legacyField = PERSON_TARGET_TO_LEGACY_FIELD[suffix];
      if (
        legacyField &&
        !Object.prototype.hasOwnProperty.call(
          personEdits.get(person.personKey) || {},
          legacyField,
        )
      ) {
        throw new Error(
          `Formula field ${legacyField} for ${person.personKey} requires an explicit reviewed correction`,
        );
      }
    }
  }
}

function isBlank(value: unknown) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function fillBlankLegacyClientFields(
  existing: Partial<LegacyClientProfile>,
  imported: LegacyClientProfile,
) {
  const values: Partial<LegacyClientProfile> = {};
  const changedFields: string[] = [];
  for (const field of PROFILE_FIELDS) {
    if (isBlank(existing[field]) && !isBlank(imported[field])) {
      (values as Record<string, unknown>)[field] = imported[field];
      changedFields.push(field);
    }
  }
  return { values, changedFields };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          stableValue((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function createLegacyPreviewFingerprint(value: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function activeLegacyImportResolutions(
  resolutions: LegacyImportResolution[],
) {
  return resolutions.filter((resolution) => resolution.action !== "skip");
}

export function validateLegacyImportResolutions(
  personKeys: string[],
  resolutions: LegacyImportResolution[],
) {
  const expected = new Set(personKeys);
  const seen = new Set<string>();
  const newClientEmails = new Set<string>();
  for (const resolution of resolutions) {
    if (!resolution.targetKey.trim())
      throw new Error("Every resolution requires a target key");
    if (!resolution.memberKeys.length)
      throw new Error(`Resolution ${resolution.targetKey} has no people`);
    if (resolution.action === "use_existing" && !resolution.existingClientId)
      throw new Error(
        `Resolution ${resolution.targetKey} requires an existing client`,
      );
    if (resolution.action !== "skip") validateProfile(resolution.clientData);
    if (resolution.action === "create_new" && resolution.clientData?.email) {
      const email = resolution.clientData.email.trim().toLowerCase();
      if (newClientEmails.has(email))
        throw new Error(
          `Email ${email} is assigned to more than one new client`,
        );
      newClientEmails.add(email);
    }
    for (const key of resolution.memberKeys) {
      if (!expected.has(key)) throw new Error(`Unknown staged person: ${key}`);
      if (seen.has(key))
        throw new Error(`Staged person appears more than once: ${key}`);
      seen.add(key);
    }
  }
  for (const key of personKeys)
    if (!seen.has(key))
      throw new Error(`Missing resolution for staged person: ${key}`);
}

function validateProfile(profile: LegacyClientProfile | undefined) {
  if (!profile?.firstName?.trim() || !profile.lastName?.trim())
    throw new Error("Reviewed clients require first and last name");
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
    throw new Error(`Invalid reviewed email: ${profile.email}`);
  if (profile.dateOfBirth) {
    const matchesFormat = /^\d{4}-\d{2}-\d{2}$/.test(profile.dateOfBirth);
    const parsed = new Date(`${profile.dateOfBirth}T00:00:00Z`);
    if (
      !matchesFormat ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== profile.dateOfBirth
    ) {
      throw new Error(`Invalid reviewed date of birth: ${profile.dateOfBirth}`);
    }
  }
  if (profile.phone && !/^\d{6,15}$/.test(profile.phone))
    throw new Error(`Invalid reviewed phone: ${profile.phone}`);
}

function clientCandidate(client: Client): LegacyExistingClientCandidate {
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    dateOfBirth: client.dateOfBirth,
    email: client.email,
    phone: client.phone,
    phoneCode: client.phoneCode,
    gender: client.gender,
    ethnicOrigin: client.ethnicOrigin,
    nationalInsuranceNumber: client.nationalInsuranceNumber,
    disabilityOrHealthCondition: client.disabilityOrHealthCondition,
    additionalNeeds: client.additionalNeeds,
    addressLine1: client.addressLine1,
    addressLine2: client.addressLine2,
    city: client.city,
    postcode: client.postcode,
    country: client.country,
  };
}

function previewFingerprintInput(
  request: LegacyWorkbookRequest,
  parsed: Awaited<ReturnType<typeof parseLegacyWorkbook>>,
  groups: Array<
    ReturnType<typeof groupStagedLegacyPeople>[number] & {
      candidates: LegacyPreviewCandidate[];
    }
  >,
  conflicts: Awaited<ReturnType<typeof existingImportConflicts>>,
) {
  return {
    fileHash: parsed.fileHash,
    sheetName: request.sheetName,
    mapping: request.mapping,
    confirmedPlaceholders: [...request.confirmedPlaceholders].sort(),
    records: parsed.records,
    people: parsed.people,
    duplicateCandidates: groups.map((group) => ({
      groupId: group.groupId,
      candidates: group.candidates.map((candidate) => ({
        clientId: candidate.clientId,
        reasons: candidate.reasons,
        memberKeys: candidate.memberKeys,
        client: candidate.client,
      })),
    })),
    priorImports: {
      previousBatch: conflicts.previousBatch?.id || null,
      records: conflicts.records,
    },
  };
}

async function existingImportConflicts(
  parsed: Awaited<ReturnType<typeof parseLegacyWorkbook>>,
) {
  const sourceIds = parsed.records
    .map((record) => record.sourceRecordId)
    .filter((value): value is string => !!value);
  const references = parsed.records
    .map((record) => record.legacyReference)
    .filter(Boolean);
  const fileRows = await db
    .select({
      id: legacyClientImportBatches.id,
      fileSha256: legacyClientImportBatches.fileSha256,
    })
    .from(legacyClientImportBatches)
    .where(eq(legacyClientImportBatches.fileSha256, parsed.fileHash));
  const conditions = [];
  if (sourceIds.length)
    conditions.push(inArray(legacyCrmRecords.sourceRecordId, sourceIds));
  if (references.length)
    conditions.push(inArray(legacyCrmRecords.legacyReference, references));
  const recordRows = conditions.length
    ? await db
        .select({
          sourceRecordId: legacyCrmRecords.sourceRecordId,
          legacyReference: legacyCrmRecords.legacyReference,
          batchId: legacyCrmRecords.batchId,
        })
        .from(legacyCrmRecords)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    : [];
  return { previousBatch: fileRows[0] || null, records: recordRows };
}

async function buildLegacyPreviewState(input: LegacyWorkbookRequest) {
  const parsed = await parseLegacyWorkbook(input);
  const existingRows = await db.select().from(clients);
  const existing = existingRows.map(clientCandidate);
  const conflicts = await existingImportConflicts(parsed);
  const importedIds = new Set(
    conflicts.records.map((record) => record.sourceRecordId).filter(Boolean),
  );
  const importedRefs = new Set(
    conflicts.records.map((record) => record.legacyReference),
  );
  for (const person of parsed.people) {
    const record = parsed.records.find(
      (candidate) => candidate.sourceRowNumber === person.sourceRowNumber,
    );
    if (
      record &&
      ((record.sourceRecordId && importedIds.has(record.sourceRecordId)) ||
        importedRefs.has(record.legacyReference))
    ) {
      person.errors.push({
        code: "already_imported",
        message: "This old-CRM record was imported previously",
      });
    }
  }
  const groups = groupStagedLegacyPeople(parsed.people).map((group) => {
    const candidates = new Map<string, LegacyPreviewCandidate>();
    for (const member of group.members) {
      for (const match of findLegacyDuplicateMatches(member, existing)) {
        const prior = candidates.get(match.clientId);
        candidates.set(
          match.clientId,
          prior
            ? {
                ...prior,
                reasons: Array.from(
                  new Set([...prior.reasons, ...match.reasons]),
                ),
                memberKeys: Array.from(
                  new Set([...prior.memberKeys, member.personKey]),
                ),
              }
            : { ...match, memberKeys: [member.personKey] },
        );
      }
    }
    return { ...group, candidates: Array.from(candidates.values()) };
  });
  const previewHash = createLegacyPreviewFingerprint(
    previewFingerprintInput(input, parsed, groups, conflicts),
  );
  return { parsed, existingRows, conflicts, groups, previewHash };
}

export class LegacyClientImportService {
  async inspect(input: { fileName: string; contentBase64: string }) {
    const inspection = await inspectLegacyWorkbook(input);
    const firstSheet = inspection.sheets[0];
    const hasRequiredMappings =
      inspection.suggestedMapping.legacyReference &&
      inspection.suggestedMapping.client1FirstName &&
      inspection.suggestedMapping.client1LastName;
    if (!firstSheet || !hasRequiredMappings)
      return { ...inspection, placeholderCandidates: [] };
    const parsed = await parseLegacyWorkbook({
      ...input,
      sheetName: firstSheet.name,
      mapping: inspection.suggestedMapping,
      confirmedPlaceholders: [],
    });
    return {
      ...inspection,
      placeholderCandidates: parsed.placeholderCandidates,
    };
  }

  async preview(input: LegacyWorkbookRequest) {
    const { parsed, conflicts, groups, previewHash } =
      await buildLegacyPreviewState(input);
    return {
      ...parsed,
      previewHash,
      groups,
      previousBatch: conflicts.previousBatch,
      summary: {
        sourceRows: parsed.records.length,
        stagedPeople: parsed.people.length,
        legacyCasesToCreate: parsed.records.filter((record) =>
          isLegacyOpenCaseStatus(record.safeValues.status),
        ).length,
        groups: groups.length,
        duplicateGroups: groups.filter(
          (group) => group.candidates.length > 0 || group.members.length > 1,
        ).length,
        errorPeople: parsed.people.filter((person) => person.errors.length > 0)
          .length,
        warningPeople: parsed.people.filter(
          (person) => person.warnings.length > 0,
        ).length,
      },
    };
  }

  async commit(input: LegacyImportCommitRequest, actorId: string) {
    const {
      parsed,
      existingRows,
      conflicts,
      previewHash: expectedHash,
    } = await buildLegacyPreviewState(input);
    const resolutions = input.resolutions.map((resolution) => ({
      ...resolution,
      clientData: resolution.clientData
        ? normalizeReviewedLegacyProfile(resolution.clientData)
        : undefined,
    }));
    validateLegacyImportResolutions(
      parsed.people.map((person) => person.personKey),
      resolutions,
    );
    if (expectedHash !== input.previewHash)
      throw Object.assign(
        new Error(
          "Workbook, mapping, or duplicate candidates changed since preview; preview again",
        ),
        { status: 409 },
      );

    const activePeople = new Set(
      resolutions
        .filter((resolution) => resolution.action !== "skip")
        .flatMap((resolution) => resolution.memberKeys),
    );
    const activeRows = new Set(
      parsed.people
        .filter((person) => activePeople.has(person.personKey))
        .map((person) => person.sourceRowNumber),
    );
    const activeRecords = parsed.records.filter((record) =>
      activeRows.has(record.sourceRowNumber),
    );
    const activeConflict = conflicts.records.find((conflict) =>
      activeRecords.some(
        (record) =>
          (record.sourceRecordId &&
            record.sourceRecordId === conflict.sourceRecordId) ||
          record.legacyReference === conflict.legacyReference,
      ),
    );
    if (activeConflict)
      throw Object.assign(
        new Error(
          `One or more selected old-CRM records were already imported in batch ${activeConflict.batchId}`,
        ),
        { status: 409 },
      );

    const edits = new Map<number, Record<string, unknown>>();
    for (const edit of input.recordEdits || []) {
      const safe = Object.fromEntries(
        Object.entries(edit.values).filter(([key]) =>
          SAFE_RECORD_FIELDS.has(key),
        ),
      );
      edits.set(edit.sourceRowNumber, safe);
    }
    validateLegacyRecordCorrections(parsed.records, activeRows, edits);
    const personEdits = new Map(
      (input.personEdits || []).map((edit) => [
        edit.personKey,
        Object.fromEntries(
          Object.entries(edit.values).filter(([key]) =>
            Object.values(PERSON_TARGET_TO_LEGACY_FIELD).includes(key),
          ),
        ),
      ]),
    );
    validateLegacyPersonCorrections(parsed.people, resolutions, personEdits);
    const reviewedRecords = parsed.records.map((record) => ({
      ...record,
      safeValues: {
        ...record.safeValues,
        ...(edits.get(record.sourceRowNumber) || {}),
      },
    }));
    const references = new Set<string>();
    const sourceIds = new Set<string>();
    for (const record of reviewedRecords.filter((candidate) =>
      activeRows.has(candidate.sourceRowNumber),
    )) {
      const legacyReference = String(
        record.safeValues.legacyReference || "",
      ).trim();
      const sourceRecordId = record.safeValues.sourceRecordId
        ? String(record.safeValues.sourceRecordId).trim()
        : null;
      if (!legacyReference)
        throw new Error(
          `Row ${record.sourceRowNumber} requires a legacy reference`,
        );
      if (references.has(legacyReference))
        throw new Error(`Legacy reference is repeated: ${legacyReference}`);
      if (sourceRecordId && sourceIds.has(sourceRecordId))
        throw new Error(`Source record ID is repeated: ${sourceRecordId}`);
      references.add(legacyReference);
      if (sourceRecordId) sourceIds.add(sourceRecordId);
    }

    const existingById = new Map(
      existingRows.map((client) => [client.id, client]),
    );
    const existingByEmail = new Map(
      existingRows
        .filter((client) => client.email)
        .map((client) => [client.email!.trim().toLowerCase(), client.id]),
    );
    const peopleByKey = new Map(
      parsed.people.map((person) => [person.personKey, person]),
    );
    for (const resolution of activeLegacyImportResolutions(resolutions)) {
      const reviewedEmail =
        resolution.clientData?.email?.trim().toLowerCase() || null;
      const emailOwner = reviewedEmail
        ? existingByEmail.get(reviewedEmail)
        : undefined;
      if (resolution.action === "create_new" && emailOwner) {
        throw Object.assign(
          new Error(
            `Email ${reviewedEmail} already belongs to an existing client; edit or clear it`,
          ),
          { status: 409 },
        );
      }
      if (resolution.action !== "use_existing") continue;
      const selected = resolution.existingClientId
        ? existingById.get(resolution.existingClientId)
        : undefined;
      if (!selected)
        throw Object.assign(
          new Error(
            `Existing client no longer exists for ${resolution.targetKey}`,
          ),
          { status: 409 },
        );
      if (!selected.email && emailOwner && emailOwner !== selected.id) {
        throw Object.assign(
          new Error(
            `Email ${reviewedEmail} already belongs to another existing client; edit or clear it`,
          ),
          { status: 409 },
        );
      }
      const candidate = clientCandidate(selected);
      const stillMatches = resolution.memberKeys.some((key) => {
        const person = peopleByKey.get(key);
        return person
          ? findLegacyDuplicateMatches(person, [candidate]).length > 0
          : false;
      });
      if (!stillMatches)
        throw Object.assign(
          new Error(
            `Existing client is no longer a valid match for ${resolution.targetKey}`,
          ),
          { status: 409 },
        );
    }

    return db.transaction(async (tx) => {
      const skippedPeople = parsed.people.length - activePeople.size;
      const [batch] = await tx
        .insert(legacyClientImportBatches)
        .values({
          fileName: input.fileName,
          fileSha256: parsed.fileHash,
          selectedSheet: input.sheetName,
          columnMapping: input.mapping as Record<string, string | null>,
          confirmedPlaceholders: input.confirmedPlaceholders,
          sourceRowCount: parsed.records.length,
          stagedPersonCount: parsed.people.length,
          skippedPeople,
          importedBy: actorId,
        })
        .returning();

      const clientIdByPerson = new Map<string, string>();
      let clientsCreated = 0;
      const linkedClientIds = new Set<string>();
      const updatedClientIds = new Set<string>();
      for (const resolution of resolutions) {
        if (resolution.action === "skip") continue;
        const reviewed = resolution.clientData!;
        let clientId: string;
        let changedFields: string[] = [];
        if (resolution.action === "create_new") {
          const [created] = await tx
            .insert(clients)
            .values({
              ...reviewed,
              email: reviewed.email?.trim().toLowerCase() || null,
              userId: null,
            })
            .returning();
          clientId = created.id;
          clientsCreated += 1;
          await tx.insert(auditLogs).values({
            userId: actorId,
            action: "create",
            entity: "client",
            entityId: clientId,
            entityRef: clientId,
            details: JSON.stringify({
              legacyImportBatchId: batch.id,
              changedFields: PROFILE_FIELDS.filter(
                (field) => !isBlank(reviewed[field]),
              ),
            }),
          });
        } else {
          clientId = resolution.existingClientId!;
          const [current] = await tx
            .select()
            .from(clients)
            .where(eq(clients.id, clientId))
            .for("update")
            .limit(1);
          if (!current)
            throw Object.assign(
              new Error(
                `Existing client no longer exists for ${resolution.targetKey}`,
              ),
              { status: 409 },
            );
          const fill = fillBlankLegacyClientFields(current, reviewed);
          changedFields = fill.changedFields;
          if (changedFields.length) {
            await tx
              .update(clients)
              .set(fill.values)
              .where(eq(clients.id, clientId));
            updatedClientIds.add(clientId);
            await tx.insert(auditLogs).values({
              userId: actorId,
              action: "update",
              entity: "client",
              entityId: clientId,
              entityRef: clientId,
              details: JSON.stringify({
                legacyImportBatchId: batch.id,
                changedFields,
              }),
            });
          }
          linkedClientIds.add(clientId);
        }
        for (const key of resolution.memberKeys)
          clientIdByPerson.set(key, clientId);
      }

      let legacyRecordsCreated = 0;
      let legacyCasesCreated = 0;
      for (const record of reviewedRecords.filter((candidate) =>
        activeRows.has(candidate.sourceRowNumber),
      )) {
        const reviewed = record.safeValues;
        const legacyReference = String(reviewed.legacyReference);
        const recordPeople = parsed.people.filter(
          (candidate) =>
            candidate.sourceRowNumber === record.sourceRowNumber &&
            activePeople.has(candidate.personKey),
        );
        let createdCaseId: string | null = null;
        if (isLegacyOpenCaseStatus(reviewed.status) && recordPeople.length > 0) {
          const caseRef = await getNextCaseRefTx(tx);
          const [createdCase] = await tx
            .insert(cases)
            .values({
              caseRef,
              stage: "Enquiry",
              status: "Active",
              leadSource: reviewed.leadSource ? String(reviewed.leadSource) : null,
              enquiryDate: legacyDateToDate(reviewed.enquiryDate),
              intakeStatus: "New",
              safeguardingStatus: "pending",
              legacySourceSystem: "owner_old_crm",
              legacyCaseNumber: legacyReference,
            })
            .returning();
          createdCaseId = createdCase.id;
          legacyCasesCreated += 1;
          await tx.insert(auditLogs).values({
            userId: actorId,
            action: "create",
            entity: "case",
            entityId: createdCase.id,
            entityRef: createdCase.caseRef,
            details: JSON.stringify({
              legacyImportBatchId: batch.id,
              legacyCaseNumber: legacyReference,
              sourceRowNumber: record.sourceRowNumber,
            }),
          });
          for (const person of recordPeople) {
            const clientId = clientIdByPerson.get(person.personKey);
            if (!clientId) continue;
            await tx.insert(parties).values({
              caseId: createdCase.id,
              clientId,
              role: person.sourceRole === "client_1" ? "A" : "B",
              portalStatus: "inactive",
            });
          }
        }
        const changed =
          createLegacyPreviewFingerprint(record.originalValues) !==
          createLegacyPreviewFingerprint(reviewed);
        const [createdRecord] = await tx
          .insert(legacyCrmRecords)
          .values({
            batchId: batch.id,
            sourceRowNumber: record.sourceRowNumber,
            sourceRecordId: reviewed.sourceRecordId
              ? String(reviewed.sourceRecordId)
              : null,
            caseId: createdCaseId,
            legacyReference,
            enquiryDate: reviewed.enquiryDate
              ? String(reviewed.enquiryDate)
              : null,
            leadSource: reviewed.leadSource
              ? String(reviewed.leadSource)
              : null,
            mediationType: reviewed.mediationType
              ? String(reviewed.mediationType)
              : null,
            customMediationType: reviewed.customMediationType
              ? String(reviewed.customMediationType)
              : null,
            legacyStatus: reviewed.status ? String(reviewed.status) : null,
            closureOutcome: reviewed.closureOutcome
              ? String(reviewed.closureOutcome)
              : null,
            closedAt: reviewed.closedAt ? String(reviewed.closedAt) : null,
            reopenedAt: reviewed.reopenedAt
              ? String(reviewed.reopenedAt)
              : null,
            sourceCreatedAt: reviewed.sourceCreatedAt
              ? String(reviewed.sourceCreatedAt)
              : null,
            sourceUpdatedAt: reviewed.sourceUpdatedAt
              ? String(reviewed.sourceUpdatedAt)
              : null,
            mediatorName: reviewed.mediatorName
              ? String(reviewed.mediatorName)
              : null,
            mediatorEmail: reviewed.mediatorEmail
              ? String(reviewed.mediatorEmail)
              : null,
            mediatorCompany: reviewed.mediatorCompany
              ? String(reviewed.mediatorCompany)
              : null,
            originalValues: record.originalValues,
            reviewedValues: reviewed,
            correctedBy: changed ? actorId : null,
            correctedAt: changed ? new Date() : null,
          })
          .returning();
        legacyRecordsCreated += 1;
        for (const person of recordPeople) {
          const resolution = resolutions.find((candidate) =>
            candidate.memberKeys.includes(person.personKey),
          )!;
          const reviewedProfile = resolution.clientData!;
          const changedPerson =
            createLegacyPreviewFingerprint(person.profile) !==
            createLegacyPreviewFingerprint(reviewedProfile);
          await tx.insert(legacyCrmRecordClients).values({
            recordId: createdRecord.id,
            clientId: clientIdByPerson.get(person.personKey)!,
            sourceRole: person.sourceRole,
            originalValues: person.originalValues,
            reviewedValues: reviewedProfile as unknown as Record<
              string,
              unknown
            >,
            legacyOnlyValues: {
              ...person.legacyOnlyValues,
              ...(personEdits.get(person.personKey) || {}),
            },
            correctedBy: changedPerson ? actorId : null,
            correctedAt: changedPerson ? new Date() : null,
          });
        }
      }

      const clientsLinked = linkedClientIds.size;
      const clientsUpdated = updatedClientIds.size;
      const [receipt] = await tx
        .update(legacyClientImportBatches)
        .set({
          clientsCreated,
          clientsLinked,
          clientsUpdated,
          legacyRecordsCreated,
          legacyCasesCreated,
        })
        .where(eq(legacyClientImportBatches.id, batch.id))
        .returning();
      await tx.insert(auditLogs).values({
        userId: actorId,
        action: "create",
        entity: "legacy_client_import",
        entityId: batch.id,
        entityRef: batch.id,
        details: JSON.stringify({
          fileSha256: parsed.fileHash,
          clientsCreated,
          clientsLinked,
          clientsUpdated,
          legacyRecordsCreated,
          legacyCasesCreated,
          skippedPeople,
        }),
      });
      return receipt;
    });
  }

  async historyForClient(clientId: string) {
    const rows = await db
      .select({
        link: legacyCrmRecordClients,
        record: legacyCrmRecords,
        batch: legacyClientImportBatches,
        caseRef: cases.caseRef,
      })
      .from(legacyCrmRecordClients)
      .innerJoin(
        legacyCrmRecords,
        eq(legacyCrmRecordClients.recordId, legacyCrmRecords.id),
      )
      .innerJoin(
        legacyClientImportBatches,
        eq(legacyCrmRecords.batchId, legacyClientImportBatches.id),
      )
      .leftJoin(cases, eq(legacyCrmRecords.caseId, cases.id))
      .where(eq(legacyCrmRecordClients.clientId, clientId))
      .orderBy(
        desc(legacyClientImportBatches.importedAt),
        desc(legacyCrmRecords.sourceRowNumber),
      );
    return rows.map(({ link, record, batch, caseRef }) => ({
      id: link.id,
      legacyReference: record.legacyReference,
      caseId: record.caseId,
      caseRef,
      sourceRecordId: record.sourceRecordId,
      sourceRowNumber: record.sourceRowNumber,
      sourceRole: link.sourceRole,
      enquiryDate: record.enquiryDate,
      leadSource: record.leadSource,
      mediationType: record.mediationType,
      customMediationType: record.customMediationType,
      legacyStatus: record.legacyStatus,
      closureOutcome: record.closureOutcome,
      closedAt: record.closedAt,
      reopenedAt: record.reopenedAt,
      mediatorName: record.mediatorName,
      mediatorEmail: record.mediatorEmail,
      mediatorCompany: record.mediatorCompany,
      recordOriginalValues: record.originalValues,
      recordReviewedValues: record.reviewedValues,
      originalValues: link.originalValues,
      reviewedValues: link.reviewedValues,
      legacyOnlyValues: link.legacyOnlyValues,
      correctedAt: link.correctedAt,
      importReceipt: {
        id: batch.id,
        fileName: batch.fileName,
        importedAt: batch.importedAt,
      },
    }));
  }
}

export const legacyClientImportService = new LegacyClientImportService();
