// Field-level RBAC and tab visibility for the Mediator Profile & Compliance Hub.
// Used by both the server (filtering response payloads + validating PATCH bodies)
// and the client (hiding tabs / disabling fields).

export type MediatorRole = "superadmin" | "subadmin" | "mediator" | "client" | "contractor";

export function requiresMediatorProfileCompletion(actorRole: MediatorRole): boolean {
  return actorRole !== "superadmin";
}

export function hasPublishableMediatorBio(shortBio: unknown, longBio: unknown): boolean {
  return typeof shortBio === "string" && shortBio.trim().length > 0
    && typeof longBio === "string" && longBio.trim().length > 0;
}

export function canManageMediatorServiceSlots(actorRole: MediatorRole, actorId: string, mediatorId: string): boolean {
  return actorRole === "superadmin" || (actorRole === "mediator" && actorId === mediatorId);
}

export const MEDIATOR_TABS = [
  "profile",
  "edi",
  "credentials",
  "service_offering",
  "bio",
  "availability",
  "contracts",
  "payment",
  "compliance",
] as const;
export type MediatorTab = (typeof MEDIATOR_TABS)[number];

// Tab visibility. `mediator` only ever sees their own record (enforced server-side
// by checking userId === mediatorId). `client` never sees the detail page — they
// only see the approved bio via a public API on the booking flow.
export const TAB_VISIBILITY: Record<MediatorTab, MediatorRole[]> = {
  profile:          ["superadmin", "subadmin", "mediator"],
  edi:              ["superadmin", "subadmin", "mediator"], // subadmin sees aggregate-only inside the tab
  credentials:      ["superadmin", "subadmin", "mediator"],
  service_offering: ["superadmin", "subadmin", "mediator"],
  bio:              ["superadmin", "subadmin", "mediator"],
  availability:     ["superadmin", "subadmin", "mediator"],
  contracts:        ["superadmin", "subadmin", "mediator"],
  payment:          ["superadmin"],
  compliance:       ["superadmin", "subadmin", "mediator"],
};

// Section-level RBAC for read & edit. Sections roughly match the tabs but
// fine-grained field exceptions live in FIELD_OVERRIDES below.
export type SectionAccess = { view: MediatorRole[]; edit: MediatorRole[] };

export const SECTION_ACCESS: Record<MediatorTab, SectionAccess> = {
  profile:          { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin", "mediator"] },
  edi:              { view: ["superadmin", "mediator"],             edit: ["superadmin", "mediator"] },
  credentials:      { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  service_offering: { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  bio:              { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] }, // subadmin can request, mediator drafts
  availability:     { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin", "mediator"] },
  contracts:        { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  payment:          { view: ["superadmin"],                         edit: ["superadmin"] },
  compliance:       { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
};

// Per-field overrides. Use either `viewOnly` (omit edit roles entirely) or full SectionAccess.
// Keys are mediator_profiles column property names from the Drizzle model.
export const FIELD_OVERRIDES: Record<string, SectionAccess> = {
  mediationRoleQualification: { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  // Profile — superadmin-only sensitive fields
  dateOfBirth:           { view: ["superadmin"], edit: ["superadmin"] },
  nextOfKinName:         { view: ["superadmin"], edit: ["superadmin"] },
  nextOfKinPhone:        { view: ["superadmin"], edit: ["superadmin"] },
  nextOfKinRelationship: { view: ["superadmin"], edit: ["superadmin"] },
  // Profile photo: mediator can upload; approval (the boolean) is staff-gated.
  // Task #214 — spec says "Subadmin must approve before going live", so
  // subadmin is included in the edit roles alongside superadmin.
  profilePhotoUrl:       { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin"] },
  profilePhotoApproved:  { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },

  // Task #214 — Section A admin-only fields per spec ("Superadmin, Subadmin"
  // column). Mediators can VIEW their own contact + address details, but only
  // staff can edit them.
  middleName:            { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  mobilePhone:           { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  mobilePhoneCode:       { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  additionalPhone:       { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  additionalPhoneCode:   { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  addressLine1:          { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  addressLine2:          { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  city:                  { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  postcode:              { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },
  country:               { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },

  // Task #214 — `email` is not a column on `mediator_profiles` (it lives on
  // `users`), but we still want it to flow through the profile GET/PATCH so
  // the form has a single source of truth. The service intercepts `email` on
  // the way in and out (see mediator-profile.service.ts).
  email:                 { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "subadmin"] },

  // Bio body fields — mediator can edit but every save creates a new draft version
  // (handled in service); the published copy on profile only updates on approve.
  bioLong:               { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] },
  bioShort:              { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] },
  bioStatus:             { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin"] },
  speaksOtherLanguages:  { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] },
  languagesSpoken:       { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] },
  hasSpecificSkills:     { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] },
  specificSkills:        { view: ["superadmin", "subadmin", "mediator"], edit: ["superadmin", "mediator"] },
};

// Map every column on mediator_profiles to its tab so we can look up section-level
// access when there is no field-specific override. Anything not listed here
// defaults to the "profile" tab (safe default for unknown / future fields).
export const FIELD_TO_TAB: Record<string, MediatorTab> = {
  // Profile (Section A)
  firstName: "profile", middleName: "profile", lastName: "profile",
  preferredDisplayName: "profile", dateOfBirth: "profile",
  profilePhotoUrl: "profile", profilePhotoApproved: "profile",
  mobilePhone: "profile", mobilePhoneCode: "profile",
  additionalPhone: "profile", additionalPhoneCode: "profile",
  addressLine1: "profile", addressLine2: "profile", city: "profile",
  postcode: "profile", country: "profile",
  nextOfKinName: "profile", nextOfKinPhone: "profile", nextOfKinRelationship: "profile",

  // EDI (Section B)
  ediSex: "edi", ediGenderIdentity: "edi", ediGenderSelfDescribe: "edi",
  ediEthnicity: "edi", ediEthnicitySelfDescribe: "edi",
  ediDisability: "edi", ediDisabilityDetails: "edi",
  ediFirstLanguage: "edi", ediCountryOfBirth: "edi",
  ediReligion: "edi", ediSexualOrientation: "edi",

  // Credentials (Section C)
  fmcUrn: "credentials", fmcAccreditationStatus: "credentials", fmcAccreditationDate: "credentials",
  cmcRegNumber: "credentials", otherRegulatorName: "credentials", otherRegulatorNumber: "credentials",
  higherQualifications: "credentials",
  piProvider: "credentials", piPolicyNumber: "credentials", piCoverAmount: "credentials",
  piExpiryDate: "credentials", piCertificateUrl: "credentials",
  icoRegistration: "credentials", icoExpiryDate: "credentials",
  dbsLevel: "credentials", dbsCertNumber: "credentials", dbsIssueDate: "credentials", dbsCertificateUrl: "credentials",
  ppcSupervisorName: "credentials", ppcSupervisorOrg: "credentials", ppcSupervisorEmail: "credentials",
  ppcSupervisorPhone: "credentials", ppcSupervisorLastSignoff: "credentials", ppcSupervisorNextReview: "credentials",
  practisesAtFirms: "bio",

  // Service offering (Section D)
  mediationRoleQualification: "service_offering",
  mediationTypes: "service_offering",
  familySubTypes: "service_offering", workplaceSubTypes: "service_offering",
  civilSubTypes: "service_offering", commercialSubTypes: "service_offering", otherSubTypes: "service_offering",
  specialisms: "service_offering", courtFormPackages: "service_offering",
  mojVoucherEligible: "service_offering", soloCoMatrix: "service_offering",
  canSuperviseWtas: "service_offering", coMediationCap: "service_offering",
  highConflictOptIn: "service_offering", safeguardingFlaggedOptIn: "service_offering",
  geographicCoverage: "service_offering",
  geographicCoverageAreas: "service_offering",

  // Bio (Section E)
  bioStatus: "bio", bioLong: "bio", bioShort: "bio",
  bioApprovedVersionId: "bio", bioApprovedAt: "bio",
  speaksOtherLanguages: "bio", languagesSpoken: "bio",
  hasSpecificSkills: "bio", specificSkills: "bio",

  // Availability (Section F)
  workingDays: "availability", workingHoursStart: "availability",
  workingHoursEnd: "availability", workingHoursByDay: "availability",
  hoursPerWeekCap: "availability",
  // `zoomLink` lives on the users table — surfaced through the bundle so the
  // Availability tab can edit it inline (mirrors how `email` is handled).
  zoomLink: "availability",

  // Contracts (Section G)
  engagementType: "contracts", contractVersion: "contracts", contractSignedDate: "contracts", contractFileUrl: "contracts",
  timebankAgreement: "contracts", timebankSignedDate: "contracts", timebankHoursPerWeek: "contracts",
  timebankCheckinDay: "contracts", timebankCheckinTime: "contracts", timebankHoursCap: "contracts",
  timebankPilotStart: "contracts", timebankReviewDate: "contracts",
  onboardingComplete: "contracts", panelStatus: "contracts", panelStatusReason: "contracts",
  offboardingDate: "contracts", offboardingReason: "contracts",

  // Payment (Section H) — superadmin-only
  bankSortCode: "payment", bankAccountNumber: "payment", bankAccountName: "payment",
  vatRegistered: "payment", vatNumber: "payment",
  selfBillingAgreement: "payment", selfBillingSignedDate: "payment",
  utr: "payment", paymentTerms: "payment",

  // Compliance (Section I)
  safeguardingTrainingDate: "compliance", safeguardingProvider: "compliance",
  safeguardingCertUrl: "compliance", safeguardingRefresherDue: "compliance",
  confidentialitySignedDate: "compliance", gdprTrainingDate: "compliance",
  annualReviewLast: "compliance", annualReviewNext: "compliance", annualReviewOutcome: "compliance",
};

// Task #214 — Section A mandatory metadata. Used by the client to render
// required asterisks / Recommended / Optional badges and an "Auto" marker on
// the derived age, and by the server to enforce shape rules. `Y` = mandatory,
// `Rec` = recommended, `N` = optional, `Auto` = system-derived (no input).
export type MandatoryLevel = "Y" | "Rec" | "N" | "Auto";
export function mediatorFieldMandatoryLevel(level: MandatoryLevel | undefined, actorRole: MediatorRole, key: string): MandatoryLevel | undefined {
  return actorRole === "superadmin" && level === "Y" && key !== "email" ? "N" : level;
}
export interface SectionAFieldMeta {
  key: string;
  label: string;
  mandatory: MandatoryLevel;
}
export const SECTION_A_FIELD_META: SectionAFieldMeta[] = [
  { key: "firstName",             label: "First name",             mandatory: "Y" },
  { key: "middleName",            label: "Middle name",            mandatory: "N" },
  { key: "lastName",              label: "Last name",              mandatory: "Y" },
  { key: "preferredDisplayName",  label: "Preferred display name", mandatory: "Rec" },
  { key: "dateOfBirth",           label: "Date of birth",          mandatory: "Y" },
  { key: "age",                   label: "Age",                    mandatory: "Auto" },
  { key: "profilePhotoUrl",       label: "Profile photo",          mandatory: "Rec" },
  { key: "profilePhotoApproved",  label: "Photo approved",         mandatory: "Y" },
  { key: "email",                 label: "Email (primary)",        mandatory: "Y" },
  { key: "mobilePhone",           label: "Mobile phone",           mandatory: "Y" },
  { key: "additionalPhone",       label: "Additional phone",       mandatory: "N" },
  { key: "addressLine1",          label: "Address line 1",         mandatory: "Y" },
  { key: "addressLine2",          label: "Address line 2",         mandatory: "Y" },
  { key: "city",                  label: "Town / city",            mandatory: "Y" },
  { key: "postcode",              label: "Postcode",               mandatory: "Y" },
  { key: "country",               label: "Country",                mandatory: "Y" },
  { key: "nextOfKinName",         label: "Next of kin name",       mandatory: "Rec" },
  { key: "nextOfKinPhone",        label: "Next of kin phone",      mandatory: "Rec" },
  { key: "nextOfKinRelationship", label: "Next of kin relationship", mandatory: "Rec" },
];

// Task #214 — Section A validators. Pure functions so both client and server
// can call them. Each returns null on success or a short error message.
const NAME_MAX = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Allow UK + international: leading +, digits, spaces, hyphens, parens. At
// least 7 digits in total. Empty strings pass — the mandatory check is
// separate.
const PHONE_RE = /^[+\d][\d\s()-]{6,}$/;

export type SectionAValidationError = { field: string; message: string };

export function validateSectionA(patch: Record<string, unknown>): SectionAValidationError[] {
  const errors: SectionAValidationError[] = [];
  const nameField = (k: string) => {
    if (!(k in patch)) return;
    const v = patch[k];
    if (v === null || v === undefined || v === "") return;
    if (typeof v !== "string") {
      errors.push({ field: k, message: `${k} must be text` });
      return;
    }
    if (v.length > NAME_MAX) {
      errors.push({ field: k, message: `${k} must be ${NAME_MAX} characters or fewer` });
    }
  };
  nameField("firstName");
  nameField("middleName");
  nameField("lastName");
  nameField("preferredDisplayName");

  if ("email" in patch && patch.email !== null && patch.email !== undefined && patch.email !== "") {
    const v = patch.email;
    if (typeof v !== "string" || !EMAIL_RE.test(v.trim())) {
      errors.push({ field: "email", message: "Email is not a valid address" });
    }
  }

  for (const k of ["mobilePhone", "additionalPhone"]) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v !== "string" || !PHONE_RE.test(v.trim())) {
      errors.push({ field: k, message: `${k} must be a valid phone number (UK or international)` });
    }
  }

  if ("dateOfBirth" in patch && patch.dateOfBirth !== null && patch.dateOfBirth !== undefined && patch.dateOfBirth !== "") {
    const v = patch.dateOfBirth;
    if (typeof v !== "string") {
      errors.push({ field: "dateOfBirth", message: "Date of birth must be a date" });
    } else {
      const d = new Date(v);
      if (isNaN(d.getTime())) {
        errors.push({ field: "dateOfBirth", message: "Date of birth is not a valid date" });
      } else if (d.getTime() > Date.now()) {
        errors.push({ field: "dateOfBirth", message: "Date of birth cannot be in the future" });
      }
    }
  }

  return errors;
}

// Task #217 — Section B–I mandatory metadata + generic validator. Same shape
// as SECTION_A_FIELD_META so the client can drive aria-required, asterisks,
// and the save-time required check from a single source of truth. The server
// re-runs the mandatory check on every PATCH key to keep client + server in
// sync. Each list ONLY contains fields whose mandatory level differs from
// "N" (Optional) plus any field we want to render with an explicit
// Optional/Recommended/Auto badge.

// Task #217 — Format hints drive both client UX (`aria-required`, input
// types) and shared server-side shape validators in `validateSectionShape`.
// All formats are optional; absence means "free-form text / boolean / number
// — no shape check beyond the required presence check".
export type FieldFormat =
  | "date"          // ISO yyyy-mm-dd, must parse and not be in the future
  | "futureOrPastDate" // ISO yyyy-mm-dd, must parse (no temporal constraint)
  | "time"          // HH:MM
  | "email"
  | "url"           // http(s)://…
  | "currency"      // £ amount, digits + optional decimal
  | "sortcode"      // 6 digits, optional dashes
  | "accountNumber" // 6–8 digits
  | "vat"           // UK VAT no.: "GB" + 9 digits OR 9 digits
  | "utr"           // 10 digits
  | "ico"           // "Z" + 7 digits
  | "postcode"      // UK-ish: alnum + space + alnum
  | "phone";        // UK or international, 7–15 digits with optional +,-,(),space

export interface SectionFieldMeta {
  key: string;
  label: string;
  mandatory: MandatoryLevel;
  format?: FieldFormat;
  maxLength?: number;
}

// Section B — EDI. All fields are Recommended or Optional per BFM spec; the
// "self-describe" follow-ups are Optional because they only apply when the
// preceding select chose "Self-describe".
export const SECTION_B_FIELD_META: SectionFieldMeta[] = [
  { key: "ediSex",                  label: "Sex",                  mandatory: "Rec" },
  { key: "ediGenderIdentity",       label: "Gender identity",      mandatory: "Rec" },
  { key: "ediGenderSelfDescribe",   label: "Gender self-describe", mandatory: "N" },
  { key: "ediEthnicity",            label: "Ethnicity",            mandatory: "Rec" },
  { key: "ediEthnicitySelfDescribe",label: "Ethnicity self-describe", mandatory: "N" },
  { key: "ediDisability",           label: "Disability",           mandatory: "Rec" },
  { key: "ediDisabilityDetails",    label: "Disability details",   mandatory: "N" },
  { key: "ediFirstLanguage",        label: "First language",       mandatory: "Rec" },
  { key: "ediCountryOfBirth",       label: "Country of birth",     mandatory: "Rec" },
  { key: "ediReligion",             label: "Religion or belief",   mandatory: "N" },
  { key: "ediSexualOrientation",    label: "Sexual orientation",   mandatory: "N" },
];

// Section C — Credentials & insurance. Regulator + insurance + DBS are
// mandatory; supervisor + secondary regulator are Recommended.
export const SECTION_C_FIELD_META: SectionFieldMeta[] = [
  { key: "fmcUrn",                 label: "FMC URN",                       mandatory: "Rec" },
  { key: "fmcAccreditationStatus", label: "FMC accreditation status",      mandatory: "Y" },
  { key: "fmcAccreditationDate",   label: "FMC accreditation date",        mandatory: "N",   format: "date" },
  { key: "cmcRegNumber",           label: "CMC registration number",       mandatory: "N" },
  { key: "otherRegulatorName",     label: "Other regulator",               mandatory: "N" },
  { key: "otherRegulatorNumber",   label: "Other regulator number",        mandatory: "N" },
  { key: "higherQualifications",   label: "Higher qualifications",         mandatory: "N" },
  { key: "piProvider",             label: "PI insurance provider",         mandatory: "Y" },
  { key: "piPolicyNumber",         label: "PI policy number",              mandatory: "Y" },
  { key: "piCoverAmount",          label: "PI cover amount",               mandatory: "Y",   format: "currency" },
  { key: "piExpiryDate",           label: "PI expiry date",                mandatory: "Y",   format: "futureOrPastDate" },
  { key: "piCertificateUrl",       label: "PI certificate URL",            mandatory: "Rec", format: "url" },
  { key: "icoRegistration",        label: "ICO registration",              mandatory: "Y",   format: "ico" },
  { key: "icoExpiryDate",          label: "ICO expiry date",               mandatory: "Y",   format: "futureOrPastDate" },
  { key: "dbsLevel",               label: "DBS level",                     mandatory: "Y" },
  { key: "dbsCertNumber",          label: "DBS certificate number",        mandatory: "Y" },
  { key: "dbsIssueDate",           label: "DBS issue date",                mandatory: "Y",   format: "date" },
  { key: "dbsCertificateUrl",      label: "DBS certificate URL",           mandatory: "Rec", format: "url" },
  // PPC supervisor block — Rec by default, escalated to Y in the UI/server
  // when fmcAccreditationStatus === "WTA" (Working towards accreditation).
  { key: "ppcSupervisorName",      label: "PPC supervisor name",           mandatory: "Rec" },
  { key: "ppcSupervisorOrg",       label: "PPC supervisor organisation",   mandatory: "Rec" },
  { key: "ppcSupervisorEmail",     label: "PPC supervisor email",          mandatory: "Rec", format: "email" },
  { key: "ppcSupervisorPhone",     label: "PPC supervisor phone",          mandatory: "Rec", format: "phone" },
  { key: "ppcSupervisorLastSignoff", label: "PPC last sign-off date",      mandatory: "Rec", format: "date" },
  { key: "ppcSupervisorNextReview",  label: "PPC next review due",         mandatory: "Rec", format: "futureOrPastDate" },
];

// Keys in Section C that flip from Rec → Y when the mediator is "Working
// towards accreditation" (WTA). Used by both client `checkRequired` and the
// server `validateSectionC` wrapper to enforce the same conditional rule.
export const SECTION_C_WTA_REQUIRED_KEYS = [
  "ppcSupervisorName",
  "ppcSupervisorOrg",
  "ppcSupervisorEmail",
  "ppcSupervisorPhone",
  "ppcSupervisorLastSignoff",
  "ppcSupervisorNextReview",
] as const;

// Task #219 — FMC's published rolling-12-month CPD minimum. Lives in shared
// so client UI, server policies, and future consumers stay aligned.
export const FMC_MIN_CPD_HOURS = 6;

// Robust enough to recognise both the canonical schema value ("WTA") and
// common written-out variants such as "Working towards (WTA)" or
// "Working Towards Accreditation" so legacy data and free-form imports don't
// silently skip the conditional PPC enforcement.
export function isWtaStatus(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const s = status.trim().toLowerCase();
  if (s === "wta") return true;
  if (s.includes("(wta)")) return true;
  if (s.startsWith("working towards")) return true;
  return false;
}

// Section D — Service offering. Mediation role qualification now lives on each
// selected service assignment; the profile-level field remains only as legacy
// readable data while migrations/backfills complete. Mediation types are
// optional; per-type sub-lists become Recommended once the matching top-level
// type is selected (UI-level conditional, see tab JSX).
export const SECTION_D_FIELD_META: SectionFieldMeta[] = [
  { key: "mediationRoleQualification", label: "Mediation role qualification", mandatory: "N" },
  { key: "mediationTypes",          label: "Mediation types",          mandatory: "N" },
  { key: "familySubTypes",          label: "Family sub-types",         mandatory: "Rec" },
  { key: "workplaceSubTypes",       label: "Workplace sub-types",      mandatory: "Rec" },
  { key: "civilSubTypes",           label: "Civil sub-types",          mandatory: "Rec" },
  { key: "commercialSubTypes",      label: "Commercial sub-types",     mandatory: "Rec" },
  { key: "otherSubTypes",           label: "Other sub-types",          mandatory: "N" },
  { key: "specialisms",             label: "Specialisms",              mandatory: "Rec" },
  { key: "courtFormPackages",       label: "Court form packages",      mandatory: "N" },
  { key: "mojVoucherEligible",      label: "MoJ voucher eligible",     mandatory: "Y" },
  { key: "canSuperviseWtas",        label: "Can supervise WTAs",       mandatory: "Y" },
  { key: "coMediationCap",          label: "Co-mediation cap",         mandatory: "Rec" },
  { key: "highConflictOptIn",       label: "High-conflict opt-in",     mandatory: "Rec" },
  { key: "safeguardingFlaggedOptIn",label: "Safeguarding-flagged opt-in", mandatory: "Rec" },
  { key: "geographicCoverage",      label: "Geographic coverage (free text)", mandatory: "N" },
  { key: "geographicCoverageAreas", label: "Geographic coverage",      mandatory: "N" },
];

// Section E — Bio. Short + long copy are Recommended (mediator submits, then
// staff approve); auxiliary skills are Optional.
export const SECTION_E_FIELD_META: SectionFieldMeta[] = [
  { key: "bioShort",             label: "Short bio",             mandatory: "Rec" },
  { key: "bioLong",              label: "Long bio",              mandatory: "Rec" },
  { key: "speaksOtherLanguages", label: "Speaks other languages",mandatory: "N" },
  { key: "languagesSpoken",      label: "Languages spoken",      mandatory: "N" },
  { key: "hasSpecificSkills",    label: "Has specific skills",   mandatory: "N" },
  { key: "specificSkills",       label: "Specific skills",       mandatory: "N" },
  // Task #219 — moved here from Section C per BFM spec (Profile/Bio section).
  { key: "practisesAtFirms",     label: "Practises at firms",    mandatory: "N" },
];

// Section F — Availability. Per BFM spec: working pattern, hours/week cap,
// recurring Zoom link, and an active calendar sync are all mandatory; the
// holiday register is Recommended (managed via the child collection).
// Task #226 — `workingHoursByDay` replaces the legacy global start/end pair
// so each working day can carry its own (start, end, optional lunch) window.
// `calendarConnected` is an "Auto" marker — the live state is derived from
// the users.googleCalendarConnected column; the validator never sees it
// because it's never present in a PATCH body.
// Task #226 — Section F spec order is Y / Y / Y / Rec / Y / Y:
//   working days, working hours per day, hours per week, holiday calendar,
//   calendar sync OAuth, recurring Zoom link.
// `calendarConnected` and `holidayCalendar` are synthetic, metadata-only
// keys (never sent in a PATCH body — `calendarConnected` is resolved against
// live OAuth state on the user row, `holidayCalendar` is satisfied by the
// `mediator_holidays` child collection). Both carry the "Auto" marker so the
// UI doesn't render a misleading asterisk on rows the mediator can't fill in
// on this tab — backend enforcement still gates Section F writes on the
// live calendar-connected flag.
export const SECTION_F_FIELD_META: SectionFieldMeta[] = [
  { key: "workingDays",       label: "Working days",                   mandatory: "Y" },
  { key: "workingHoursByDay", label: "Working hours per day",          mandatory: "Y" },
  { key: "hoursPerWeekCap",   label: "Hours per week willing to take", mandatory: "Y" },
  { key: "holidayCalendar",   label: "Holiday calendar",               mandatory: "Rec" },
  { key: "calendarConnected", label: "Calendar sync (OAuth)",          mandatory: "Y" },
  { key: "zoomLink",          label: "Recurring Zoom link",            mandatory: "Y", format: "url" },
];

// Section G — Contracts. Engagement + contract + panel status are mandatory;
// time-bank fields are Optional because they only apply when the time-bank
// agreement switch is on (UI-level conditional, see tab JSX).
export const SECTION_G_FIELD_META: SectionFieldMeta[] = [
  { key: "engagementType",       label: "Engagement type",     mandatory: "Y" },
  { key: "contractVersion",      label: "Contract version",    mandatory: "Y" },
  { key: "contractSignedDate",   label: "Contract signed date",mandatory: "Y", format: "date" },
  { key: "contractFileUrl",      label: "Contract file URL",   mandatory: "Rec", format: "url" },
  { key: "timebankAgreement",    label: "Time-bank agreement", mandatory: "N" },
  { key: "timebankSignedDate",   label: "Time-bank signed date",mandatory: "N", format: "date" },
  { key: "timebankHoursPerWeek", label: "Time-bank hours/week",mandatory: "N" },
  { key: "timebankCheckinDay",   label: "Time-bank check-in day",mandatory: "N" },
  { key: "timebankCheckinTime",  label: "Time-bank check-in time",mandatory: "N" },
  { key: "timebankHoursCap",     label: "Time-bank hours cap", mandatory: "N" },
  { key: "timebankPilotStart",   label: "Time-bank pilot start",mandatory: "N" },
  { key: "timebankReviewDate",   label: "Time-bank review date",mandatory: "N" },
  { key: "onboardingComplete",   label: "Onboarding complete", mandatory: "N" },
  { key: "panelStatus",          label: "Panel status",        mandatory: "Y" },
  { key: "panelStatusReason",    label: "Status reason",       mandatory: "N" },
  { key: "offboardingDate",      label: "Off-boarding date",   mandatory: "N" },
  { key: "offboardingReason",    label: "Off-boarding reason", mandatory: "N" },
];

// Section H — Payment. Bank details + self-billing + UTR are mandatory so we
// can actually pay the mediator; VAT number is Optional (conditional on
// vatRegistered).
export const SECTION_H_FIELD_META: SectionFieldMeta[] = [
  { key: "bankSortCode",          label: "Bank sort code",        mandatory: "Y", format: "sortcode" },
  { key: "bankAccountNumber",     label: "Bank account number",   mandatory: "Y", format: "accountNumber" },
  { key: "bankAccountName",       label: "Account name",          mandatory: "Y" },
  { key: "vatRegistered",         label: "VAT registered",        mandatory: "N" },
  { key: "vatNumber",             label: "VAT number",            mandatory: "N", format: "vat" },
  { key: "selfBillingAgreement",  label: "Self-billing agreement",mandatory: "Y" },
  { key: "selfBillingSignedDate", label: "Self-billing signed date",mandatory: "Y", format: "date" },
  { key: "utr",                   label: "UTR",                   mandatory: "Y", format: "utr" },
  { key: "paymentTerms",          label: "Payment terms (days)",  mandatory: "Rec" },
];

// Section I — Compliance. Safeguarding + confidentiality + GDPR training are
// mandatory; the rest are Recommended evidence trails.
export const SECTION_I_FIELD_META: SectionFieldMeta[] = [
  { key: "safeguardingTrainingDate", label: "Safeguarding training date",  mandatory: "Y",   format: "date" },
  { key: "safeguardingProvider",     label: "Safeguarding provider",       mandatory: "Rec" },
  { key: "safeguardingCertUrl",      label: "Safeguarding certificate URL",mandatory: "Rec", format: "url" },
  { key: "safeguardingRefresherDue", label: "Safeguarding refresher due",  mandatory: "Rec", format: "futureOrPastDate" },
  { key: "confidentialitySignedDate",label: "Confidentiality signed date", mandatory: "Y",   format: "date" },
  { key: "gdprTrainingDate",         label: "GDPR training date",          mandatory: "Y",   format: "date" },
  { key: "annualReviewLast",         label: "Last annual review",          mandatory: "Rec", format: "date" },
  { key: "annualReviewNext",         label: "Next annual review",          mandatory: "Rec", format: "futureOrPastDate" },
  { key: "annualReviewOutcome",      label: "Annual review outcome",       mandatory: "N" },
];

// Task #217 — Section-aware mandatory check. Only fires for keys that the
// caller is actually editing (i.e. present in `patch`) so partial saves from
// other tabs are never blocked. Boolean fields are always treated as "set"
// (a default `false` is a valid recorded decision). Empty arrays and
// whitespace-only strings count as empty.
export function validateSectionRequired(
  meta: SectionFieldMeta[],
  patch: Record<string, unknown>,
): SectionAValidationError[] {
  const errors: SectionAValidationError[] = [];
  for (const m of meta) {
    if (m.mandatory !== "Y") continue;
    if (!(m.key in patch)) continue;
    const v = patch[m.key];
    if (typeof v === "boolean") continue;
    const isEmpty =
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) {
      errors.push({ field: m.key, message: `${m.label} is required` });
    }
  }
  return errors;
}

// Task #217 — Generic, metadata-driven shape validator. Only checks fields
// that (a) are present in `patch`, (b) are non-empty strings, and (c) have a
// `format` hint. Empty values are passed to the required check, not here.
const URL_RE       = /^https?:\/\/\S+$/i;
const EMAIL_RE2    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE      = /^([01]\d|2[0-3]):[0-5]\d$/;
const SORTCODE_RE  = /^\d{2}-?\d{2}-?\d{2}$/;
const ACCT_RE      = /^\d{6,8}$/;
const VAT_RE       = /^(GB)?\d{9}$/i;
const UTR_RE       = /^\d{10}$/;
const ICO_RE       = /^Z\d{7}$/i;
const POSTCODE_RE  = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const CURRENCY_RE  = /^£?\s?\d+(\.\d{1,2})?$/;
// UK or international phone — accepts +, digits, spaces, dashes, parens;
// requires 7-15 digits in total per ITU-T E.164 + UK formats.
const PHONE_SHAPE_RE = /^\+?[\d\s()\-]{7,25}$/;

export function validateSectionShape(
  meta: SectionFieldMeta[],
  patch: Record<string, unknown>,
): SectionAValidationError[] {
  const errors: SectionAValidationError[] = [];
  for (const m of meta) {
    if (!m.format) continue;
    if (!(m.key in patch)) continue;
    const v = patch[m.key];
    if (v === null || v === undefined) continue;
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s === "") continue;
    if (typeof m.maxLength === "number" && s.length > m.maxLength) {
      errors.push({ field: m.key, message: `${m.label} must be ${m.maxLength} characters or fewer` });
      continue;
    }
    let bad = false;
    switch (m.format) {
      case "date": {
        const d = new Date(s);
        if (isNaN(d.getTime())) { bad = true; break; }
        if (d.getTime() > Date.now() + 24 * 3600 * 1000) bad = true;
        break;
      }
      case "futureOrPastDate": {
        const d = new Date(s); if (isNaN(d.getTime())) bad = true; break;
      }
      case "time":          bad = !TIME_RE.test(s); break;
      case "email":         bad = !EMAIL_RE2.test(s); break;
      case "url":           bad = !URL_RE.test(s); break;
      case "currency":      bad = !CURRENCY_RE.test(s); break;
      case "sortcode":      bad = !SORTCODE_RE.test(s); break;
      case "accountNumber": bad = !ACCT_RE.test(s); break;
      case "vat":           bad = !VAT_RE.test(s); break;
      case "utr":           bad = !UTR_RE.test(s); break;
      case "ico":           bad = !ICO_RE.test(s); break;
      case "postcode":      bad = !POSTCODE_RE.test(s); break;
      case "phone": {
        if (!PHONE_SHAPE_RE.test(s)) { bad = true; break; }
        const digits = s.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) bad = true;
        break;
      }
    }
    if (bad) {
      errors.push({ field: m.key, message: `${m.label} is not in the expected format` });
    }
  }
  return errors;
}

// Task #217 — Per-section validators. Each composes the shared required +
// shape checks against its own metadata so client save handlers and the
// server `updateProfile` route can call a single named function per tab.
const sectionValidator = (meta: SectionFieldMeta[]) =>
  (patch: Record<string, unknown>): SectionAValidationError[] => [
    ...validateSectionRequired(meta, patch),
    ...validateSectionShape(meta, patch),
  ];
export const validateSectionB = sectionValidator(SECTION_B_FIELD_META);

// Task #219 — Section C honours a conditional WTA rule: when the merged
// (existing + patch) `fmcAccreditationStatus` is "WTA", every PPC supervisor
// field in `SECTION_C_WTA_REQUIRED_KEYS` is treated as Mandatory even though
// its declared level is Rec. Pass `context` (the loaded profile) so the
// server-side validator can see the effective status when the patch doesn't
// include the status field itself.
export function validateSectionC(
  patch: Record<string, unknown>,
  context?: Record<string, unknown> | null,
  requireComplete = true,
): SectionAValidationError[] {
  const errors: SectionAValidationError[] = [
    ...(requireComplete ? validateSectionRequired(SECTION_C_FIELD_META, patch) : []),
    ...validateSectionShape(SECTION_C_FIELD_META, patch),
  ];
  // Only run the conditional WTA enforcement when the patch actually touches a
  // Section C field. Without this gate, edits to unrelated tabs (Bio,
  // Availability, etc.) would be rejected for WTA mediators whose PPC fields
  // aren't yet populated — breaking the project-wide partial-save contract.
  const sectionCKeys = new Set(SECTION_C_FIELD_META.map((m) => m.key));
  const touchesSectionC = Object.keys(patch).some((k) => sectionCKeys.has(k));
  if (!touchesSectionC || !requireComplete) return errors;
  const effectiveStatus =
    "fmcAccreditationStatus" in patch
      ? patch.fmcAccreditationStatus
      : context?.fmcAccreditationStatus;
  if (!isWtaStatus(effectiveStatus)) return errors;
  const labelByKey: Record<string, string> = {};
  for (const m of SECTION_C_FIELD_META) labelByKey[m.key] = m.label;
  // Validate against the merged (context + patch) value, not just touched
  // keys, so a partial save can't leave WTA mediators with empty PPC fields.
  for (const key of SECTION_C_WTA_REQUIRED_KEYS) {
    const v = key in patch ? patch[key] : context?.[key];
    const isEmpty =
      v === null ||
      v === undefined ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty && !errors.find((e) => e.field === key)) {
      errors.push({ field: key, message: `${labelByKey[key] ?? key} is required when accreditation status is WTA` });
    }
  }
  return errors;
}
export function validateSectionD(patch: Record<string, unknown>, requireComplete = true): SectionAValidationError[] {
  const errors = requireComplete
    ? sectionValidator(SECTION_D_FIELD_META)(patch)
    : validateSectionShape(SECTION_D_FIELD_META, patch);
  return errors;
}

export function validateServiceOfferingRequirements(
  draft: Record<string, unknown>,
  selectedServiceTypeIds: readonly string[],
  requireComplete = true,
): SectionAValidationError[] {
  const errors = validateSectionD(draft, requireComplete);
  if (requireComplete && selectedServiceTypeIds.length === 0) {
    errors.push({ field: "services", message: "Services are required" });
  }
  return errors;
}
export const validateSectionE = sectionValidator(SECTION_E_FIELD_META);

// Task #226 — Section F validator. On top of the standard required/shape
// checks, when `workingHoursByDay` is in the patch (or the merged context
// already has it) we enforce per-day coverage + per-day shape: every
// working day must have a (start, end) entry with start < end, and any
// optional lunch window must sit inside that day's window.
const F_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validateSectionF(
  patch: Record<string, unknown>,
  context?: Record<string, unknown> | null,
  requireComplete = true,
): SectionAValidationError[] {
  const errors: SectionAValidationError[] = [
    ...(requireComplete ? validateSectionRequired(SECTION_F_FIELD_META, patch) : []),
    ...validateSectionShape(SECTION_F_FIELD_META, patch),
  ];
  const touchesHours =
    "workingHoursByDay" in patch || "workingDays" in patch;
  if (!touchesHours) return errors;
  const mergedDays = ("workingDays" in patch ? patch.workingDays : context?.workingDays) as unknown;
  const mergedHours = ("workingHoursByDay" in patch ? patch.workingHoursByDay : context?.workingHoursByDay) as unknown;
  const days = Array.isArray(mergedDays) ? (mergedDays as string[]) : [];
  if (days.length === 0) return errors;
  if (mergedHours === null || mergedHours === undefined) {
    if (requireComplete) errors.push({ field: "workingHoursByDay", message: "Working hours per day are required" });
    return errors;
  }
  if (typeof mergedHours !== "object" || Array.isArray(mergedHours)) {
    errors.push({ field: "workingHoursByDay", message: "Working hours per day must be an object" });
    return errors;
  }
  const map = mergedHours as Record<string, {
    start?: unknown; end?: unknown; lunchStart?: unknown; lunchEnd?: unknown;
  }>;
  for (const day of days) {
    const entry = map[day];
    if (!entry || typeof entry !== "object") {
      if (requireComplete) errors.push({ field: "workingHoursByDay", message: `Working hours for ${day} are required` });
      continue;
    }
    const start = typeof entry.start === "string" ? entry.start : "";
    const end = typeof entry.end === "string" ? entry.end : "";
    if (!requireComplete && !start && !end && !entry.lunchStart && !entry.lunchEnd) continue;
    if (!F_TIME_RE.test(start) || !F_TIME_RE.test(end)) {
      errors.push({ field: "workingHoursByDay", message: `Working hours for ${day} must be in HH:MM format` });
      continue;
    }
    if (start >= end) {
      errors.push({ field: "workingHoursByDay", message: `Working hours for ${day}: start must be before end` });
      continue;
    }
    const lsRaw = entry.lunchStart;
    const leRaw = entry.lunchEnd;
    const hasLunch =
      (typeof lsRaw === "string" && lsRaw !== "") ||
      (typeof leRaw === "string" && leRaw !== "");
    if (hasLunch) {
      const ls = typeof lsRaw === "string" ? lsRaw : "";
      const le = typeof leRaw === "string" ? leRaw : "";
      if (!F_TIME_RE.test(ls) || !F_TIME_RE.test(le)) {
        errors.push({ field: "workingHoursByDay", message: `Lunch hours for ${day} must be in HH:MM format` });
        continue;
      }
      if (ls >= le) {
        errors.push({ field: "workingHoursByDay", message: `Lunch for ${day}: start must be before end` });
        continue;
      }
      if (ls < start || le > end) {
        errors.push({ field: "workingHoursByDay", message: `Lunch for ${day} must sit inside working hours` });
      }
    }
  }
  return errors;
}
export const validateSectionG = sectionValidator(SECTION_G_FIELD_META);
export const validateSectionH = sectionValidator(SECTION_H_FIELD_META);
export const validateSectionI = sectionValidator(SECTION_I_FIELD_META);

/** Compute an integer age in years from an ISO date string, or null. */
export function computeAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const d = new Date(dateOfBirth);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

// Fields that must NEVER be edited via the public PATCH endpoint, regardless of role.
const PROTECTED_FIELDS = new Set<string>([
  "userId", "createdAt", "updatedAt",
  "bioApprovedVersionId", "bioApprovedAt", // managed only by the bio approval workflow
]);

export function getFieldAccess(field: string): SectionAccess {
  if (FIELD_OVERRIDES[field]) return FIELD_OVERRIDES[field];
  // Only fields explicitly mapped to a tab are editable; unknown fields are denied.
  if (!(field in FIELD_TO_TAB)) return { view: [], edit: [] };
  const tab = FIELD_TO_TAB[field];
  return SECTION_ACCESS[tab];
}

export function isProtectedField(field: string): boolean {
  return PROTECTED_FIELDS.has(field);
}

/** True when `role` may VIEW `field` for `targetUserId`. `actorUserId` is the
 *  caller. A mediator may always view their OWN field provided the section
 *  itself isn't restricted (we still consult the access map first). */
export function canViewField(field: string, actorRole: MediatorRole, actorUserId: string, targetUserId: string): boolean {
  const access = getFieldAccess(field);
  if (access.view.includes(actorRole)) {
    // Mediators are scoped to their own record.
    if (actorRole === "mediator" && actorUserId !== targetUserId) return false;
    return true;
  }
  return false;
}

export function canEditField(field: string, actorRole: MediatorRole, actorUserId: string, targetUserId: string): boolean {
  if (isProtectedField(field)) return false;
  const access = getFieldAccess(field);
  if (access.edit.includes(actorRole)) {
    if (actorRole === "mediator" && actorUserId !== targetUserId) return false;
    return true;
  }
  return false;
}

const MEDIATOR_REVIEW_EXCLUDED = new Set([
  "email", "dateOfBirth", "nextOfKinName", "nextOfKinPhone", "nextOfKinRelationship",
  "profilePhotoApproved", "bioStatus", "panelStatus", "panelStatusReason",
  "offboardingDate", "offboardingReason", "onboardingComplete", "contractVersion",
  "engagementType", "contractSignedDate", "timebankAgreement", "timebankSignedDate",
  "timebankHoursCap", "timebankPilotStart", "timebankReviewDate",
  "annualReviewOutcome", "mediationRoleQualification", "selfBillingAgreement",
  "paymentTerms", "profilePhotoUrl",
]);

/** Fields a mediator may propose for review without gaining direct write access. */
export function canRequestMediatorField(field: string, actorUserId: string, targetUserId: string): boolean {
  if (actorUserId !== targetUserId || isProtectedField(field) || MEDIATOR_REVIEW_EXCLUDED.has(field)) return false;
  if (!canViewField(field, "mediator", actorUserId, targetUserId)) return false;
  if (field === "firstName" || field === "lastName") return true;
  return !canEditField(field, "mediator", actorUserId, targetUserId)
    && canEditField(field, "subadmin", actorUserId, targetUserId);
}

export function canReviewMediatorField(field: string, reviewerRole: MediatorRole): boolean {
  return (reviewerRole === "superadmin" || reviewerRole === "subadmin")
    && canRequestMediatorField(field, "mediator", "mediator")
    && canEditField(field, reviewerRole, "reviewer", "mediator");
}

export function canViewTab(tab: MediatorTab, actorRole: MediatorRole, actorUserId: string, targetUserId: string): boolean {
  if (!TAB_VISIBILITY[tab].includes(actorRole)) return false;
  if (actorRole === "mediator" && actorUserId !== targetUserId) return false;
  return true;
}

/** Strip fields the actor isn't allowed to view. Returns a shallow copy. */
export function redactProfile<T extends Record<string, unknown>>(
  profile: T,
  actorRole: MediatorRole,
  actorUserId: string,
  targetUserId: string,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(profile)) {
    if (key === "userId" || key === "createdAt" || key === "updatedAt") {
      out[key] = profile[key];
      continue;
    }
    if (canViewField(key, actorRole, actorUserId, targetUserId)) {
      out[key] = profile[key];
    }
  }
  return out as Partial<T>;
}

/** Filter a PATCH body to only the fields the actor is allowed to edit. */
export function filterEditableFields<T extends Record<string, unknown>>(
  patch: T,
  actorRole: MediatorRole,
  actorUserId: string,
  targetUserId: string,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (canEditField(key, actorRole, actorUserId, targetUserId)) {
      out[key] = patch[key];
    }
  }
  return out as Partial<T>;
}

/** Compute expiry alerts. Returns ISO date strings + days-until for items
 *  expiring within `withinDays`. Negative `daysUntil` = already expired. */
export interface ExpiryAlert {
  field: string;
  label: string;
  date: string;
  daysUntil: number;
  expired: boolean;
}

export function computeExpiryAlerts(profile: Record<string, unknown>, withinDays = 30): ExpiryAlert[] {
  const items: Array<{ field: string; label: string }> = [
    { field: "piExpiryDate",            label: "PI insurance" },
    { field: "icoExpiryDate",           label: "ICO registration" },
    { field: "dbsIssueDate",            label: "DBS check (3-yr)" },
    { field: "safeguardingRefresherDue",label: "Safeguarding refresher" },
    { field: "annualReviewNext",        label: "Annual review" },
  ];
  const out: ExpiryAlert[] = [];
  const now = Date.now();
  for (const it of items) {
    const raw = profile[it.field];
    if (typeof raw !== "string" || !raw) continue;
    let expiry: Date | null = null;
    if (it.field === "dbsIssueDate") {
      // DBS treated as expiring 3 years after issue.
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        d.setFullYear(d.getFullYear() + 3);
        expiry = d;
      }
    } else {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) expiry = d;
    }
    if (!expiry) continue;
    const days = Math.floor((expiry.getTime() - now) / 86400000);
    if (days <= withinDays) {
      out.push({
        field: it.field,
        label: it.label,
        date: expiry.toISOString().slice(0, 10),
        daysUntil: days,
        expired: days < 0,
      });
    }
  }
  return out;
}
