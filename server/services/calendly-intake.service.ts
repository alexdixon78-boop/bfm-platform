import { ISSUE_TYPES, LEAD_SOURCES, REFERRAL_TYPES } from "@shared/schema";

export type CalendlyQuestionAnswer = {
  question: string;
  answer: string;
};

export type CalendlyMappedData = {
  firstName: string;
  lastName: string;
  email: string;
  mobileTelephone: string;
  addressLine1: string;
  postcode: string;
  leadSource: string;
  leadSourceOther: string | null;
  referralType: string;
  issueType: string;
  issueTypeOther: string | null;
  notes: string | null;
};

export type CalendlyMappedConsultation = {
  event: string;
  webhookCreatedAt: string;
  payload: Record<string, unknown>;
  questionsAndAnswers: CalendlyQuestionAnswer[];
  data: CalendlyMappedData;
  enrichment: {
    status: "not_needed" | "skipped" | "fetched" | "failed";
    reason?: string;
    httpStatus?: number;
    retryable?: boolean;
  };
};

type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

type EnrichmentOptions = {
  token?: string;
  fetchImpl?: FetchImpl;
};

const REQUIRED_FIELDS: Array<keyof CalendlyMappedData> = [
  "firstName",
  "lastName",
  "email",
  "mobileTelephone",
  "addressLine1",
  "postcode",
  "leadSource",
  "referralType",
  "issueType",
];

const PHONE_CANDIDATE_PAYLOAD_FIELDS = [
  "text_reminder_number",
  "phone_number",
  "phoneNumber",
  "invitee_phone_number",
  "mobile_phone_number",
  "contact_number",
] as const;

const LEAD_SOURCE_ALIASES: Record<string, string> = {
  google: "Google search",
  googlesearch: "Google search",
  website: "Website",
  bfmwebsite: "Website",
  govuk: "Gov.uk website",
  govukwebsite: "Gov.uk website",
  facebook: "Facebook",
  tiktok: "Tiktok",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  fmc: "Family Mediation Council (FMC website)",
  familymediationcouncil: "Family Mediation Council (FMC website)",
  nfm: "National Family Mediation (NFM website)",
  nationalfamilymediation: "National Family Mediation (NFM website)",
  wordofmouth: "Word of mouth (please tell us who?)",
  flyer: "Promotional flyer/other",
  other: "Other (please specify)",
};

const REFERRAL_TYPE_ALIASES: Record<string, string> = {
  self: "Self-referral",
  selfreferral: "Self-referral",
  myself: "Self-referral",
  client: "Client referral",
  clientreferral: "Client referral",
  referringaclient: "Client referral",
};

const ISSUE_TYPE_ALIASES: Record<string, string> = {
  civil: "Civil mediation",
  civilmediation: "Civil mediation",
  commercial: "Commercial",
  workplace: "Workplace mediation",
  workplacemediation: "Workplace mediation",
  child: "Child arrangements",
  children: "Child arrangements",
  childarrangements: "Child arrangements",
  property: "Property & Finance",
  finance: "Property & Finance",
  propertyfinance: "Property & Finance",
  propertyandfinance: "Property & Finance",
  childrenpropertyfinance: "Children, property & Finance",
  grandparent: "Grandparent contact",
  grandparentcontact: "Grandparent contact",
  family: "Other family mediation",
  otherfamilymediation: "Other family mediation",
  other: "Other (please give details below)",
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function answerToString(value: unknown): string {
  if (Array.isArray(value)) return value.map(answerToString).filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value).trim();
}

export function extractCalendlyQuestionAnswers(
  payload: Record<string, unknown>,
): CalendlyQuestionAnswer[] {
  const rawAnswers =
    payload.questions_and_answers ||
    payload.questionsAndAnswers ||
    payload.custom_answers ||
    [];
  if (!Array.isArray(rawAnswers)) return [];

  return rawAnswers
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const question = answerToString(record.question || record.name || record.label);
      const answer = answerToString(record.answer || record.value);
      return question && answer ? { question, answer } : null;
    })
    .filter((item): item is CalendlyQuestionAnswer => Boolean(item));
}

function findCalendlyAnswer(
  answers: CalendlyQuestionAnswer[],
  labels: string[],
): string | undefined {
  const normalizedLabels = labels.map(normalizeKey);
  const match = answers.find((answer) =>
    normalizedLabels.includes(normalizeKey(answer.question)),
  );
  return match?.answer || undefined;
}

function splitCalendlyName(payload: Record<string, unknown>): {
  firstName: string;
  lastName: string;
} {
  const firstName = answerToString(payload.first_name || payload.firstName);
  const lastName = answerToString(payload.last_name || payload.lastName);
  if (firstName && lastName) return { firstName, lastName };

  const [first, ...rest] = answerToString(payload.name).split(/\s+/).filter(Boolean);
  return { firstName: first || "", lastName: rest.join(" ") || "" };
}

function normalizeEnumValue(
  value: string | undefined,
  allowed: readonly string[],
  aliases: Record<string, string>,
): string {
  const raw = answerToString(value);
  if (!raw) return "";
  const exact = allowed.find((candidate) => candidate === raw);
  if (exact) return exact;
  const normalized = normalizeKey(raw);
  return aliases[normalized] || raw;
}

function firstAnswer(...values: unknown[]): string {
  for (const value of values) {
    const answer = answerToString(value);
    if (answer) return answer;
  }
  return "";
}

function mapPayload(payload: Record<string, unknown>): {
  data: CalendlyMappedData;
  answers: CalendlyQuestionAnswer[];
} {
  const answers = extractCalendlyQuestionAnswers(payload);
  const names = splitCalendlyName(payload);
  const leadSourceRaw = findCalendlyAnswer(answers, [
    "How did you hear about us?",
    "How did you hear about us",
    "Lead source",
    "leadSource",
  ]);
  const referralTypeRaw = findCalendlyAnswer(answers, [
    "Are you referring yourself or a client?",
    "Referral type",
    "referralType",
  ]);
  const issueTypeRaw = findCalendlyAnswer(answers, [
    "What kind of mediation would you like to discuss?",
    "Mediation type",
    "Issue type",
    "issueType",
  ]);

  return {
    answers,
    data: {
      firstName: names.firstName,
      lastName: names.lastName,
      email: answerToString(payload.email),
      mobileTelephone: firstAnswer(
        findCalendlyAnswer(answers, [
          "Mobile telephone",
          "Mobile Telephone",
          "Telephone",
          "Telephone number",
          "Phone number",
          "Phone",
          "Mobile",
          "Mobile number",
          "Contact number",
          "Contact telephone",
          "Best phone number",
          "Your phone number",
          "What is your phone number?",
          "What is your phone number",
          "mobileTelephone",
        ]),
        payload.text_reminder_number,
        payload.phone_number,
        payload.phoneNumber,
        payload.invitee_phone_number,
        payload.mobile_phone_number,
        payload.contact_number,
      ),
      addressLine1: findCalendlyAnswer(answers, [
        "First line of address",
        "Address line 1",
        "Address",
        "addressLine1",
      ]) || "",
      postcode: findCalendlyAnswer(answers, [
        "Postcode",
        "Post code",
        "Postal code",
        "postcode",
      ]) || "",
      leadSource: normalizeEnumValue(leadSourceRaw, LEAD_SOURCES, LEAD_SOURCE_ALIASES),
      leadSourceOther:
        findCalendlyAnswer(answers, [
          "Please specify",
          "Lead source other",
          "leadSourceOther",
        ]) || null,
      referralType: normalizeEnumValue(
        referralTypeRaw,
        REFERRAL_TYPES,
        REFERRAL_TYPE_ALIASES,
      ),
      issueType: normalizeEnumValue(issueTypeRaw, ISSUE_TYPES, ISSUE_TYPE_ALIASES),
      issueTypeOther:
        findCalendlyAnswer(answers, [
          "Please give details",
          "Issue type other",
          "issueTypeOther",
        ]) || null,
      notes:
        findCalendlyAnswer(answers, [
          "Anything else you'd like to tell us?",
          "Anything else you would like to tell us?",
          "Notes",
          "Additional notes",
          "notes",
        ]) || null,
    },
  };
}

export function getCalendlySafeDiagnostics(mapped: CalendlyMappedConsultation): {
  answerLabels: string[];
  normalizedAnswerLabels: string[];
  phoneCandidateFieldsPresent: Record<typeof PHONE_CANDIDATE_PAYLOAD_FIELDS[number], boolean>;
} {
  return {
    answerLabels: mapped.questionsAndAnswers.map((answer) => answer.question),
    normalizedAnswerLabels: mapped.questionsAndAnswers.map((answer) => normalizeKey(answer.question)),
    phoneCandidateFieldsPresent: Object.fromEntries(
      PHONE_CANDIDATE_PAYLOAD_FIELDS.map((field) => [
        field,
        Boolean(answerToString(mapped.payload[field])),
      ]),
    ) as Record<typeof PHONE_CANDIDATE_PAYLOAD_FIELDS[number], boolean>,
  };
}

export function getCalendlyValidationDiagnostics(data: CalendlyMappedData): {
  missingFields: string[];
  invalidEnums: Record<string, string>;
} {
  const missingFields = REQUIRED_FIELDS.filter((field) => !answerToString(data[field]));
  const invalidEnums: Record<string, string> = {};
  if (data.leadSource && !LEAD_SOURCES.includes(data.leadSource as any)) {
    invalidEnums.leadSource = data.leadSource;
  }
  if (data.referralType && !REFERRAL_TYPES.includes(data.referralType as any)) {
    invalidEnums.referralType = data.referralType;
  }
  if (data.issueType && !ISSUE_TYPES.includes(data.issueType as any)) {
    invalidEnums.issueType = data.issueType;
  }
  return { missingFields, invalidEnums };
}

function shouldFetchInviteeDetails(mapped: CalendlyMappedConsultation): boolean {
  const diagnostics = getCalendlyValidationDiagnostics(mapped.data);
  return (
    mapped.questionsAndAnswers.length === 0 ||
    diagnostics.missingFields.length > 0
  );
}

function getInviteeUri(payload: Record<string, unknown>): string {
  return answerToString(payload.uri || payload.invitee);
}

async function fetchCalendlyInvitee(
  inviteeUri: string,
  options: Required<Pick<EnrichmentOptions, "token" | "fetchImpl">>,
): Promise<Record<string, unknown>> {
  const response = await options.fetchImpl(inviteeUri, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${options.token}`,
    },
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object"
        ? answerToString((parsed as Record<string, unknown>).message)
        : "";
    throw Object.assign(new Error(message || response.statusText), {
      httpStatus: response.status,
    });
  }
  const record = parsed && typeof parsed === "object"
    ? parsed as Record<string, unknown>
    : {};
  const resource = record.resource;
  return resource && typeof resource === "object"
    ? resource as Record<string, unknown>
    : record;
}

export function mapCalendlyConsultation(body: unknown): CalendlyMappedConsultation {
  const webhook = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const payload = webhook.payload && typeof webhook.payload === "object"
    ? webhook.payload as Record<string, unknown>
    : {};
  const mapped = mapPayload(payload);

  return {
    event: answerToString(webhook.event),
    webhookCreatedAt: answerToString(webhook.created_at || webhook.time),
    payload,
    questionsAndAnswers: mapped.answers,
    data: mapped.data,
    enrichment: { status: "not_needed" },
  };
}

export async function enrichCalendlyConsultation(
  body: unknown,
  options: EnrichmentOptions = {},
): Promise<CalendlyMappedConsultation> {
  const mapped = mapCalendlyConsultation(body);
  if (!shouldFetchInviteeDetails(mapped)) return mapped;

  const inviteeUri = getInviteeUri(mapped.payload);
  if (!inviteeUri) {
    return {
      ...mapped,
      enrichment: { status: "skipped", reason: "invitee_uri_missing" },
    };
  }
  if (!options.token) {
    return {
      ...mapped,
      enrichment: { status: "skipped", reason: "calendly_pat_missing" },
    };
  }

  try {
    const fetched = await fetchCalendlyInvitee(inviteeUri, {
      token: options.token,
      fetchImpl: options.fetchImpl || fetch,
    });
    const mergedPayload = {
      ...mapped.payload,
      ...fetched,
      questions_and_answers:
        fetched.questions_and_answers ||
        fetched.questionsAndAnswers ||
        mapped.payload.questions_and_answers ||
        mapped.payload.questionsAndAnswers,
    };
    const merged = mapCalendlyConsultation({
      ...(body && typeof body === "object" ? body as Record<string, unknown> : {}),
      payload: mergedPayload,
    });
    return {
      ...merged,
      enrichment: { status: "fetched" },
    };
  } catch (err) {
    const httpStatus = typeof (err as { httpStatus?: unknown }).httpStatus === "number"
      ? (err as { httpStatus: number }).httpStatus
      : undefined;
    return {
      ...mapped,
      enrichment: {
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
        httpStatus,
        retryable: true,
      },
    };
  }
}

export function buildCalendlyMetadata(mapped: CalendlyMappedConsultation) {
  const payload = mapped.payload;
  const scheduledEvent = payload.scheduled_event && typeof payload.scheduled_event === "object"
    ? payload.scheduled_event as Record<string, unknown>
    : {};

  return {
    source: "Calendly",
    calendly: {
      webhookEvent: mapped.event,
      webhookCreatedAt: mapped.webhookCreatedAt || null,
      enrichmentStatus: mapped.enrichment.status,
      eventUri: answerToString(payload.event || scheduledEvent.uri) || null,
      inviteeUri: getInviteeUri(payload) || null,
      eventTypeName:
        answerToString(payload.event_type_name || scheduledEvent.name || payload.event_type) ||
        null,
      startTime: answerToString(payload.start_time || scheduledEvent.start_time) || null,
      endTime: answerToString(payload.end_time || scheduledEvent.end_time) || null,
      timezone:
        answerToString(payload.timezone || payload.timezone_name || scheduledEvent.timezone) ||
        null,
      status: answerToString(payload.status) || null,
      canceled: Boolean(payload.canceled),
      rescheduled: Boolean(payload.rescheduled),
      questionsAndAnswers: mapped.questionsAndAnswers,
    },
  };
}

export function buildCalendlyDuplicateNeedle(inviteeUri: string | null | undefined): string | null {
  const safeInviteeUri = answerToString(inviteeUri);
  return safeInviteeUri ? `"inviteeUri":"${safeInviteeUri}"` : null;
}
