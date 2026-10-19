import type { MiamRecord } from "@shared/schema";

export const ALLOWED_PUBLIC_NEW_CASE_BOOKING_SERVICE_NAMES = [
  "MIAM",
  "Evening/weekend MIAM",
  "Urgent (Same Day) MIAM",
  "Direct to Court Express",
] as const;

export type BookingOnboardingDetails = {
  fullName: string;
  dateOfBirth: string;
  addressLine1: string;
  postcode: string;
  email: string;
  phone: string;
  caseType: string;
  caseSubtype: string;
  caseDescription: string;
  howHeard: string;
  termsConsent: boolean;
  childrenDetails?: string | null;
};

export const BOOKING_ONBOARDING_DESCRIPTION_MARKER = "Booking onboarding description:";

export type BookingOnboardingValidationResult =
  | { ok: true; data: BookingOnboardingDetails }
  | { ok: false; errors: Record<string, string> };

const allowedServiceNames = new Set<string>(ALLOWED_PUBLIC_NEW_CASE_BOOKING_SERVICE_NAMES);

export function isPublicNewCaseBookingServiceName(name: string): boolean {
  return allowedServiceNames.has(name);
}

export function normalizeFamilyCaseSubtype(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  const aliases: Record<string, string> = {
    "child arrangements": "Child arrangements (CA)",
    "child arrangements (ca)": "Child arrangements (CA)",
    "finance & property": "Property & finance (PF)",
    "property & finance": "Property & finance (PF)",
    "property & finance (pf)": "Property & finance (PF)",
    "property and finances (p&f)": "Property & finance (PF)",
    "all issues mediation": "All issues mediation (AIM)",
    "all issues mediation (aim)": "All issues mediation (AIM)",
    "aim (all issues mediation)": "All issues mediation (AIM)",
  };

  return aliases[trimmed.toLowerCase()] || trimmed;
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export function isChildRelatedBookingSubtype(caseSubtype: string): boolean {
  const normalized = caseSubtype.toLowerCase();
  return normalized.includes("child arrangements") || normalized.includes("all issues mediation");
}

export function stripBookingOnboardingDescriptionMarker(value: string | null | undefined): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw.trim()) return "";
  return raw
    .replaceAll(BOOKING_ONBOARDING_DESCRIPTION_MARKER, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildStableMiamRenewalPrefill(record: MiamRecord | null | undefined): Partial<MiamRecord> {
  if (!record) return {};
  return {
    sessionMediator: null,
    sessionDate: null,
    sessionTime: null,
    otherPeoplePresent: null,
    caseReference: record.caseReference,
    caseType: record.caseType,
    clientName: record.clientName,
    clientFirstName: record.clientFirstName,
    clientLastName: record.clientLastName,
    clientDob: record.clientDob,
    clientAddress: record.clientAddress,
    clientPhone: record.clientPhone,
    howHeardAboutBfm: record.howHeardAboutBfm,
    clientOccupation: record.clientOccupation,
    clientDisability: record.clientDisability,
    clientAccessibility: record.clientAccessibility,
    clientEthnicity: record.clientEthnicity,
    clientReligiousCulturalNeeds: record.clientReligiousCulturalNeeds,
    clientNewPartner: record.clientNewPartner,
    introNotes: record.introNotes,
    children: record.children,
    otherClientName: record.otherClientName,
    otherClientFirstName: record.otherClientFirstName,
    otherClientLastName: record.otherClientLastName,
    otherClientDob: record.otherClientDob,
    otherClientAddress: record.otherClientAddress,
    otherClientPhone: record.otherClientPhone,
    otherClientEmail: record.otherClientEmail,
    married: record.married,
    dateOfMarriage: record.dateOfMarriage,
    livedTogether: record.livedTogether,
    dateOfCohabitation: record.dateOfCohabitation,
    dateOfSeparation: record.dateOfSeparation,
    bothParentsPr: record.bothParentsPr,
    prIsIssue: record.prIsIssue,
    divorceStarted: record.divorceStarted,
    divorceStartedDate: record.divorceStartedDate,
    petitioner: record.petitioner,
    decreeNisiDate: record.decreeNisiDate,
    decreeAbsoluteDate: record.decreeAbsoluteDate,
    courtOrders: record.courtOrders,
    applicationsToCourtText: record.applicationsToCourtText,
    backgroundNotes: record.backgroundNotes,
    bgWhatBringsYou: record.bgWhatBringsYou,
    bgLivingArrangements: record.bgLivingArrangements,
    bgChildrenDetails: record.bgChildrenDetails,
    bgContactArrangements: record.bgContactArrangements,
  };
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateBookingOnboardingDetails(input: unknown, partyRole: string): BookingOnboardingValidationResult {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const isClientA = partyRole === "A";
  const data: BookingOnboardingDetails = {
    fullName: cleanString(raw.fullName),
    dateOfBirth: cleanString(raw.dateOfBirth),
    addressLine1: cleanString(raw.addressLine1),
    postcode: cleanString(raw.postcode),
    email: cleanString(raw.email).toLowerCase(),
    phone: cleanString(raw.phone),
    caseType: cleanString(raw.caseType),
    caseSubtype: cleanString(raw.caseType) === "Family"
      ? normalizeFamilyCaseSubtype(cleanString(raw.caseSubtype)) || ""
      : cleanString(raw.caseSubtype),
    caseDescription: isClientA ? cleanString(raw.caseDescription) : "",
    howHeard: isClientA ? cleanString(raw.howHeard) : "",
    termsConsent: raw.termsConsent === true,
    childrenDetails: isClientA ? cleanString(raw.childrenDetails) || null : null,
  };

  const errors: Record<string, string> = {};
  const required: Array<[keyof BookingOnboardingDetails, string]> = [
    ["fullName", "Full name is required"],
    ["dateOfBirth", "Date of birth is required"],
    ["addressLine1", "Address first line is required"],
    ["postcode", "Postcode is required"],
    ["email", "Email is required"],
    ["phone", "Phone is required"],
    ["caseType", "Case type is required"],
    ["caseSubtype", "Case subtype is required"],
  ];

  if (isClientA) {
    required.push(
      ["caseDescription", "Case description is required"],
      ["howHeard", "How-heard is required"],
    );
  }

  for (const [field, message] of required) {
    if (!data[field]) errors[field] = message;
  }

  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = "Valid email is required";
  }

  if (!data.termsConsent) {
    errors.termsConsent = "Terms consent is required";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data };
}
