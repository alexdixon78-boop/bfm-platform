import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, unique, uniqueIndex, jsonb, index, primaryKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  accountDisplayName: text("account_display_name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("mediator"),
  status: text("status").notNull().default("active"),
  resetToken: text("reset_token"),
  resetExpiresAt: timestamp("reset_expires_at"),
  zoomLink: text("zoom_link"),
  onboardingToken: text("onboarding_token"),
  onboardingTokenExpiresAt: timestamp("onboarding_token_expires_at"),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleCalendarConnected: boolean("google_calendar_connected").default(false),
  googleCalendarEmail: text("google_calendar_email"),
  googleTokenExpiresAt: timestamp("google_token_expires_at"),
  googleScopeGranted: text("google_scope_granted"),
  lastCalendarSyncAt: timestamp("last_calendar_sync_at"),
  lastCalendarSyncError: text("last_calendar_sync_error"),
  outlookAccessToken: text("outlook_access_token"),
  outlookRefreshToken: text("outlook_refresh_token"),
  outlookCalendarConnected: boolean("outlook_calendar_connected").default(false),
  outlookCalendarEmail: text("outlook_calendar_email"),
  outlookTokenExpiresAt: timestamp("outlook_token_expires_at"),
  outlookScopeGranted: text("outlook_scope_granted"),
  lastOutlookSyncAt: timestamp("last_outlook_sync_at"),
  lastOutlookSyncError: text("last_outlook_sync_error"),
  activeCalendarProvider: text("active_calendar_provider"),
  availabilityColor: text("availability_color"),
  contractorType: text("contractor_type"),
  lastLoginAt: timestamp("last_login_at"),
}, (table) => [
  uniqueIndex("users_single_superadmin_unique").on(table.role).where(sql`${table.role} = 'superadmin'`),
]);

export const enquiries = pgTable("enquiries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  enquiryRef: text("enquiry_ref").notNull().unique(),
  dateReceived: timestamp("date_received").notNull().defaultNow(),
  firstName: text("first_name").notNull(),
  middleName: text("middle_name"),
  lastName: text("last_name").notNull(),
  dateOfBirth: text("date_of_birth"),
  email: text("email").notNull(),
  mobileTelephone: text("mobile_telephone").notNull(),
  phoneCode: text("phone_code").default("+44"),
  landlineTelephone: text("landline_telephone"),
  contactMethod: text("contact_method"),
  issueType: text("issue_type").notNull(),
  referralType: text("referral_type"),
  shuttleMediation: boolean("shuttle_mediation").notNull().default(false),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  postcode: text("postcode"),
  consentFollowUp: boolean("consent_follow_up").notNull().default(false),
  consentFollowUpDate: timestamp("consent_follow_up_date"),
  consentAnonymisedData: boolean("consent_anonymised_data").notNull().default(false),
  privacyConsent: boolean("privacy_consent").default(false),
  privacyConsentStatus: text("privacy_consent_status").notNull().default("pending"),
  privacyConsentDecidedAt: timestamp("privacy_consent_decided_at"),
  privacyConsentDecidedBy: varchar("privacy_consent_decided_by"),
  privacyConsentDecisionSource: text("privacy_consent_decision_source"),
  privacyConsentDecisionNote: text("privacy_consent_decision_note"),
  consentToken: text("consent_token"),
  consentTokenExpiresAt: timestamp("consent_token_expires_at"),
  consentRequestSentAt: timestamp("consent_request_sent_at"),
  status: text("status").notNull().default("New"),
  notes: text("notes"),
  leadSource: text("lead_source"),
  leadSourceOther: text("lead_source_other"),
  issueTypeOther: text("issue_type_other"),
  metadata: text("metadata"),
  convertedCaseId: varchar("converted_case_id"),
  acknowledgementStatus: text("acknowledgement_status").notNull().default("not_attempted"),
  acknowledgementLastAttemptedAt: timestamp("acknowledgement_last_attempted_at"),
  acknowledgementSentAt: timestamp("acknowledgement_sent_at"),
  acknowledgementLastError: text("acknowledgement_last_error"),
});

export const enquiryDuplicateReviews = pgTable("enquiry_duplicate_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceEnquiryId: varchar("source_enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  matchedEnquiryId: varchar("matched_enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  primaryEnquiryId: varchar("primary_enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  matchReasons: text("match_reasons").notNull(),
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("enquiry_duplicate_reviews_source_idx").on(table.sourceEnquiryId),
  index("enquiry_duplicate_reviews_matched_idx").on(table.matchedEnquiryId),
  index("enquiry_duplicate_reviews_status_idx").on(table.status),
  uniqueIndex("enquiry_duplicate_reviews_pair_idx").on(table.sourceEnquiryId, table.matchedEnquiryId),
]);

export type EnquiryDuplicateReview = typeof enquiryDuplicateReviews.$inferSelect;

export const apiIntegrations = pgTable("api_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  label: text("label").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedBy: varchar("revoked_by").references(() => users.id),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
});

export const xeroConnections = pgTable("xero_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text("tenant_id").notNull().unique(),
  tenantName: text("tenant_name"),
  tenantType: text("tenant_type"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at").notNull(),
  scopes: text("scopes"),
  status: text("status").notNull().default("connected"),
  connectedBy: varchar("connected_by").references(() => users.id, { onDelete: "set null" }),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  disconnectedAt: timestamp("disconnected_at"),
  lastSyncAt: timestamp("last_sync_at"),
  lastError: text("last_error"),
});

export const xeroWebhookEvents = pgTable("xero_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  xeroEventId: text("xero_event_id").notNull().unique(),
  eventCategory: text("event_category"),
  eventType: text("event_type"),
  resourceId: text("resource_id"),
  tenantId: text("tenant_id"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  action: text("action"),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const gmailMessages = pgTable("gmail_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  gmailThreadId: text("gmail_thread_id"),
  fromName: text("from_name"),
  fromEmail: text("from_email").notNull(),
  toEmails: text("to_emails"),
  ccEmails: text("cc_emails"),
  subject: text("subject"),
  receivedAt: timestamp("received_at"),
  snippet: text("snippet"),
  textBody: text("text_body"),
  sanitizedHtmlBody: text("sanitized_html_body"),
  status: text("status").notNull().default("imported"),
  importedBy: varchar("imported_by").references(() => users.id),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  linkedEnquiryId: varchar("linked_enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  linkedCaseId: varchar("linked_case_id").references(() => cases.id, { onDelete: "set null" }),
  linkedCaseEmailMessageId: varchar("linked_case_email_message_id").references(() => caseEmailMessages.id, { onDelete: "set null" }),
  convertedBy: varchar("converted_by").references(() => users.id),
  convertedAt: timestamp("converted_at"),
  archivedAt: timestamp("archived_at"),
  deletedAt: timestamp("deleted_at"),
  needsActionAt: timestamp("needs_action_at"),
  lastActionBy: varchar("last_action_by").references(() => users.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("gmail_messages_status_idx").on(table.status),
  index("gmail_messages_received_at_idx").on(table.receivedAt),
  index("gmail_messages_from_email_idx").on(table.fromEmail),
]);

export type GmailMessage = typeof gmailMessages.$inferSelect;
export type InsertGmailMessage = typeof gmailMessages.$inferInsert;

export const gmailMailInlineAssets = pgTable("gmail_mail_inline_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  importedMailId: varchar("imported_mail_id").notNull().references(() => gmailMessages.id, { onDelete: "cascade" }),
  gmailMessageId: text("gmail_message_id").notNull(),
  contentId: text("content_id").notNull(),
  attachmentId: text("attachment_id"),
  mimeType: text("mime_type").notNull(),
  filename: text("filename"),
  data: text("data").notNull(),
  size: integer("size"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("gmail_mail_inline_assets_mail_content_idx").on(table.importedMailId, table.contentId),
  index("gmail_mail_inline_assets_imported_mail_idx").on(table.importedMailId),
]);

export type GmailMailInlineAsset = typeof gmailMailInlineAssets.$inferSelect;
export type InsertGmailMailInlineAsset = typeof gmailMailInlineAssets.$inferInsert;

export const cases = pgTable("cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseRef: text("case_ref").notNull().unique(),
  mediatorId: varchar("mediator_id"),
  stage: text("stage").notNull().default("Enquiry"),
  status: text("status").notNull().default("Active"),
  issueType: text("issue_type"),
  leadSource: text("lead_source"),
  legacySourceSystem: text("legacy_source_system"),
  legacyCaseNumber: text("legacy_case_number"),
  shuttleMediation: boolean("shuttle_mediation").notNull().default(false),
  confidential: boolean("confidential").notNull().default(false),
  intakeStatus: text("intake_status").notNull().default("New"),
  claimedBy: varchar("claimed_by").references(() => users.id),
  claimedAt: timestamp("claimed_at"),
  firstContactDueAt: timestamp("first_contact_due_at"),
  firstContactAttemptedAt: timestamp("first_contact_attempted_at"),
  firstContactMethod: text("first_contact_method"),
  firstContactNotes: text("first_contact_notes"),
  safeguardingStatus: text("safeguarding_status").notNull().default("pending"),
  safeguardingCheckedAt: timestamp("safeguarding_checked_at"),
  safeguardingCheckedBy: varchar("safeguarding_checked_by").references(() => users.id),
  safeguardingNotes: text("safeguarding_notes"),
  safeguardingConfidential: boolean("safeguarding_confidential").notNull().default(false),
  standardChaseStopped: boolean("standard_chase_stopped").notNull().default(false),
  noWhatsappOrVoicemail: boolean("no_whatsapp_or_voicemail").notNull().default(false),
  nationalDaHelplineSignposted: boolean("national_da_helpline_signposted").notNull().default(false),
  rebeccaNotifiedAt: timestamp("rebecca_notified_at"),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  notes: text("notes"),
  referralPartnerName: text("referral_partner_name"),
  referralPartnerCode: text("referral_partner_code"),
  closureReason: text("closure_reason"),
  closureDetails: text("closure_details"),
  // --- Filter cache columns (Task #163). Populated by case.service refreshCaseFilterCache ---
  // Source of truth lives in MIAM records / appointments; these are denormalised
  // for SQL filtering on the cases list and refreshed on relevant write events.
  mediationCategory: text("mediation_category"),       // Family | Workplace | Civil | Commercial | Other
  familySubType: text("family_sub_type"),
  workplaceSubType: text("workplace_sub_type"),
  civilSubType: text("civil_sub_type"),
  commercialSubType: text("commercial_sub_type"),
  otherSubType: text("other_sub_type"),
  fundingSource: text("funding_source"),               // Self-funded | Legal Aid | MOJ Voucher | Insurance | Employer-funded | Other
  voucherStatus: text("voucher_status"),               // VOUCHER_SCHEME_OPTIONS
  inCourtStatus: text("in_court_status"),              // COURT_PROCEEDINGS_STATUSES
  cafcassStatus: text("cafcass_status"),               // CAFCASS_OPTIONS
  enquiryDate: timestamp("enquiry_date"),              // when enquiry was received (for enquiries-converted-to-case)
  miamCompletedDate: timestamp("miam_completed_date"), // earliest approved MIAM session date
  closureDate: timestamp("closure_date"),              // when status moved to Closed
  // Task #167 — case-level toggle controlling whether non-allocated mediators
  // can see representatives belonging to any party on this case. Admins
  // (superadmin/subadmin) and party owners always see their own reps; this
  // flag only widens visibility for the mediator role. Default false.
  mediatorCanSeeReps: boolean("mediator_can_see_reps").notNull().default(false),
  cimEligible: boolean("cim_eligible").notNull().default(false),
  cimEligibilityMarkedAt: timestamp("cim_eligibility_marked_at"),
  cimEligibilityMarkedBy: varchar("cim_eligibility_marked_by").references(() => users.id, { onDelete: "set null" }),
  mojVoucherEligible: boolean("moj_voucher_eligible").notNull().default(false),
  voucherClaimEligible: boolean("voucher_claim_eligible").notNull().default(false),
  voucherClaimEligibleSetAt: timestamp("voucher_claim_eligible_set_at"),
  voucherClaimEligibleSetBy: varchar("voucher_claim_eligible_set_by").references(() => users.id, { onDelete: "set null" }),
  manualRevenuePence: integer("manual_revenue_pence"),
  manualRevenueUpdatedBy: varchar("manual_revenue_updated_by").references(() => users.id, { onDelete: "set null" }),
  manualRevenueUpdatedAt: timestamp("manual_revenue_updated_at"),
}, (table) => [
  // BTREE indexes on every filter-cache column so the AND-composed WHERE in
  // listCasesFiltered remains O(log n) per dimension rather than seq-scanning
  // a growing cases table. Status/stage/mediator are the hottest predicates.
  index("cases_status_idx").on(table.status),
  index("cases_stage_idx").on(table.stage),
  index("cases_mediator_id_idx").on(table.mediatorId),
  index("cases_mediation_category_idx").on(table.mediationCategory),
  index("cases_family_sub_type_idx").on(table.familySubType),
  index("cases_workplace_sub_type_idx").on(table.workplaceSubType),
  index("cases_civil_sub_type_idx").on(table.civilSubType),
  index("cases_commercial_sub_type_idx").on(table.commercialSubType),
  index("cases_other_sub_type_idx").on(table.otherSubType),
  index("cases_funding_source_idx").on(table.fundingSource),
  index("cases_voucher_status_idx").on(table.voucherStatus),
  index("cases_in_court_status_idx").on(table.inCourtStatus),
  index("cases_cafcass_status_idx").on(table.cafcassStatus),
  index("cases_enquiry_date_idx").on(table.enquiryDate),
  index("cases_miam_completed_date_idx").on(table.miamCompletedDate),
  index("cases_closure_date_idx").on(table.closureDate),
  index("cases_cim_eligible_idx").on(table.cimEligible),
  index("cases_moj_voucher_eligible_idx").on(table.mojVoucherEligible),
  index("cases_voucher_claim_eligible_idx").on(table.voucherClaimEligible),
  index("cases_last_updated_idx").on(table.lastUpdated),
]);

export const caseClosureRecords = pgTable("case_closure_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }).unique(),
  closureReason: text("closure_reason").notNull(),
  closureDetails: text("closure_details"),
  closedAt: timestamp("closed_at").notNull().defaultNow(),
  closedById: varchar("closed_by_id").references(() => users.id, { onDelete: "set null" }),
  followUpConsentStatus: text("follow_up_consent_status").notNull(),
  outreachExcluded: boolean("outreach_excluded").notNull().default(false),
  lifeSatisfaction: integer("life_satisfaction"),
  anxietyScore: integer("anxiety_score"),
  serviceRating: integer("service_rating"),
  netPromoterScore: integer("net_promoter_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_closure_records_case_id_idx").on(table.caseId),
  index("case_closure_records_closed_at_idx").on(table.closedAt),
  index("case_closure_records_follow_up_consent_idx").on(table.followUpConsentStatus),
  index("case_closure_records_outreach_excluded_idx").on(table.outreachExcluded),
]);

export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: text("date_of_birth"),
  email: text("email"),
  phone: text("phone"),
  phoneCode: text("phone_code").default("+44"),
  gender: text("gender"),
  ethnicOrigin: text("ethnic_origin"),
  nationalInsuranceNumber: text("national_insurance_number"),
  disabilityOrHealthCondition: text("disability_or_health_condition"),
  additionalNeeds: text("additional_needs"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  userId: varchar("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("clients_email_lower_idx").on(sql`lower(${table.email})`).where(sql`${table.email} IS NOT NULL`),
  uniqueIndex("clients_user_id_idx").on(table.userId).where(sql`${table.userId} IS NOT NULL`),
]);

export const legacyClientImportBatches = pgTable("legacy_client_import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceSystem: text("source_system").notNull().default("owner_old_crm"),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  selectedSheet: text("selected_sheet").notNull(),
  columnMapping: jsonb("column_mapping").$type<Record<string, string | null>>().notNull().default({}),
  confirmedPlaceholders: jsonb("confirmed_placeholders").$type<string[]>().notNull().default([]),
  sourceRowCount: integer("source_row_count").notNull(),
  stagedPersonCount: integer("staged_person_count").notNull(),
  clientsCreated: integer("clients_created").notNull().default(0),
  clientsLinked: integer("clients_linked").notNull().default(0),
  clientsUpdated: integer("clients_updated").notNull().default(0),
  legacyRecordsCreated: integer("legacy_records_created").notNull().default(0),
  legacyCasesCreated: integer("legacy_cases_created").notNull().default(0),
  skippedPeople: integer("skipped_people").notNull().default(0),
  importedBy: varchar("imported_by").references(() => users.id, { onDelete: "set null" }),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legacy_client_import_batches_source_hash_unique").on(table.sourceSystem, table.fileSha256),
  index("legacy_client_import_batches_imported_at_idx").on(table.importedAt),
]);

export const legacyCrmRecords = pgTable("legacy_crm_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull().references(() => legacyClientImportBatches.id, { onDelete: "restrict" }),
  sourceSystem: text("source_system").notNull().default("owner_old_crm"),
  sourceRowNumber: integer("source_row_number").notNull(),
  sourceRecordId: text("source_record_id"),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "set null" }),
  legacyReference: text("legacy_reference").notNull(),
  enquiryDate: text("enquiry_date"),
  leadSource: text("lead_source"),
  mediationType: text("mediation_type"),
  customMediationType: text("custom_mediation_type"),
  legacyStatus: text("legacy_status"),
  closureOutcome: text("closure_outcome"),
  closedAt: text("closed_at"),
  reopenedAt: text("reopened_at"),
  sourceCreatedAt: text("source_created_at"),
  sourceUpdatedAt: text("source_updated_at"),
  mediatorName: text("mediator_name"),
  mediatorEmail: text("mediator_email"),
  mediatorCompany: text("mediator_company"),
  originalValues: jsonb("original_values").$type<Record<string, unknown>>().notNull().default({}),
  reviewedValues: jsonb("reviewed_values").$type<Record<string, unknown>>().notNull().default({}),
  correctedBy: varchar("corrected_by").references(() => users.id, { onDelete: "set null" }),
  correctedAt: timestamp("corrected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legacy_crm_records_source_record_unique").on(table.sourceSystem, table.sourceRecordId).where(sql`${table.sourceRecordId} IS NOT NULL`),
  uniqueIndex("legacy_crm_records_source_reference_unique").on(table.sourceSystem, table.legacyReference),
  uniqueIndex("legacy_crm_records_batch_row_unique").on(table.batchId, table.sourceRowNumber),
  index("legacy_crm_records_batch_idx").on(table.batchId),
  index("legacy_crm_records_case_id_idx").on(table.caseId),
]);

export const legacyCrmRecordClients = pgTable("legacy_crm_record_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordId: varchar("record_id").notNull().references(() => legacyCrmRecords.id, { onDelete: "restrict" }),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  sourceRole: text("source_role").notNull(),
  originalValues: jsonb("original_values").$type<Record<string, unknown>>().notNull().default({}),
  reviewedValues: jsonb("reviewed_values").$type<Record<string, unknown>>().notNull().default({}),
  legacyOnlyValues: jsonb("legacy_only_values").$type<Record<string, unknown>>().notNull().default({}),
  correctedBy: varchar("corrected_by").references(() => users.id, { onDelete: "set null" }),
  correctedAt: timestamp("corrected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("legacy_crm_record_clients_record_role_unique").on(table.recordId, table.sourceRole),
  index("legacy_crm_record_clients_client_idx").on(table.clientId),
]);

// Task #167 — Representatives are professional contacts (solicitor, HR, union,
// advocate, other) attached to a specific party on a case. They are
// CONTACT-RECORDS ONLY: no portal user account, no general email — the only
// outbound email is the one-off GDPR consent request. Visibility:
//   - admins (superadmin/subadmin): always see all reps
//   - party-owner client (own portal session): sees their own party's reps only
//   - mediators: see reps only when cases.mediatorCanSeeReps is true
//   - other parties on the same case: NEVER see another party's reps
// Server enforces this in representativeService.listVisibleByCase.
export const REPRESENTATIVE_TYPES = ["solicitor", "hr", "union", "advocate", "other"] as const;
export const REPRESENTATIVE_CONSENT_STATUSES = ["pending", "sent", "granted", "withdrawn", "refused"] as const;
export const REPRESENTATIVE_CHANNELS = ["email", "phone", "post"] as const;

// Task #202 — Client-owned master record for a representative. The same
// solicitor / HR contact / advocate may be used across many of a client's
// cases; this table is the Rolodex. Per-case usage lives on
// `case_representatives` (the attachment), which now carries a nullable
// `clientRepresentativeId` FK to this table. Person-level fields (name /
// org / contact details / address) are mirrored back here on edit so the
// data stays canonical.
export const clientRepresentatives = pgTable("client_representatives", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  roleTitle: text("role_title"),
  organisation: text("organisation"),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  phoneCode: text("phone_code").default("+44"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("client_reps_client_idx").on(table.clientId),
  // Dedupe per client: same email + same name = same person. Skip rows with
  // NULL email so two namesakes without contact details can co-exist.
  uniqueIndex("client_reps_dedupe_idx")
    .on(table.clientId, sql`lower(${table.email})`, sql`lower(${table.fullName})`)
    .where(sql`${table.email} IS NOT NULL`),
]);

export type ClientRepresentative = typeof clientRepresentatives.$inferSelect;
export const insertClientRepresentativeSchema = createInsertSchema(clientRepresentatives, {
  type: z.enum(REPRESENTATIVE_TYPES),
  email: z.string().email().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClientRepresentative = z.infer<typeof insertClientRepresentativeSchema>;
export const updateClientRepresentativeSchema = insertClientRepresentativeSchema.partial().omit({
  clientId: true, createdBy: true,
});
export type UpdateClientRepresentative = z.infer<typeof updateClientRepresentativeSchema>;

export const caseRepresentatives = pgTable("case_representatives", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull(),
  partyId: varchar("party_id").notNull(),
  // Task #202 — FK back to the client-owned master record. Nullable for the
  // backfill window only; new rows always have it set by the service layer.
  clientRepresentativeId: varchar("client_representative_id").references(() => clientRepresentatives.id, { onDelete: "set null" }),
  type: text("type").notNull(),                  // REPRESENTATIVE_TYPES
  roleTitle: text("role_title"),                 // free-text role / job title (e.g. "Senior Partner")
  organisation: text("organisation"),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  phoneCode: text("phone_code").default("+44"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  preferredChannel: text("preferred_channel").default("email"),  // REPRESENTATIVE_CHANNELS
  notes: text("notes"),
  consentStatus: text("consent_status").notNull().default("pending"),
  // Token is sent in the consent URL only; the DB stores its sha256 hash so a DB
  // leak alone cannot grant consent on behalf of the recipient.
  consentTokenHash: text("consent_token_hash"),
  consentTokenExpiresAt: timestamp("consent_token_expires_at"),
  consentRequestSentAt: timestamp("consent_request_sent_at"),
  consentDecidedAt: timestamp("consent_decided_at"),
  consentDecisionIp: text("consent_decision_ip"),    // IP address of the responder
  createdBy: varchar("created_by"),     // userId of the actor who added the rep (staff or client)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_reps_case_idx").on(table.caseId),
  index("case_reps_party_idx").on(table.partyId),
  uniqueIndex("case_reps_consent_token_hash_idx").on(table.consentTokenHash).where(sql`${table.consentTokenHash} IS NOT NULL`),
]);

export type CaseRepresentative = typeof caseRepresentatives.$inferSelect;
// `consentStatus` is intentionally NOT settable via create/update — only the
// public token flow (`respondToConsent`) may change consent state, and the
// service flips the row to "sent" when an email is dispatched. Allowing
// authenticated users to set "granted" / "withdrawn" / "refused" directly
// would break the GDPR audit trail.
export const insertCaseRepresentativeSchema = createInsertSchema(caseRepresentatives, {
  type: z.enum(REPRESENTATIVE_TYPES),
  preferredChannel: z.enum(REPRESENTATIVE_CHANNELS).optional().default("email"),
  email: z.string().email().optional().nullable(),
}).omit({
  id: true, createdAt: true, updatedAt: true,
  // Task #202: `clientRepresentativeId` is set by the service layer (it links
  // every attachment back to a per-client master record). Allowing public
  // PATCH to mutate it would let any user re-point an attachment at an
  // arbitrary master ID — IDOR-style data tampering across clients.
  clientRepresentativeId: true,
  consentStatus: true,
  consentTokenHash: true, consentTokenExpiresAt: true, consentRequestSentAt: true,
  consentDecidedAt: true, consentDecisionIp: true,
});
export type InsertCaseRepresentative = z.infer<typeof insertCaseRepresentativeSchema>;

export const updateCaseRepresentativeSchema = insertCaseRepresentativeSchema.partial().omit({
  caseId: true, partyId: true, createdBy: true,
});
export type UpdateCaseRepresentative = z.infer<typeof updateCaseRepresentativeSchema>;

export const parties = pgTable("parties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull(),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  role: text("role").notNull(),
  confidential: boolean("confidential").default(false),
  miamMediatorId: varchar("miam_mediator_id"),
  allocatedMediatorId: varchar("allocated_mediator_id"),
  portalStatus: text("portal_status").notNull().default("inactive"),
  inviteToken: text("invite_token"),
  inviteExpiresAt: timestamp("invite_expires_at"),
  bookingToken: text("booking_token"),
  bookingTokenExpiresAt: timestamp("booking_token_expires_at"),
  miamFormToken: text("miam_form_token"),
  miamFormTokenExpiresAt: timestamp("miam_form_token_expires_at"),
});

export const CASE_PARTY_FOLLOW_UP_CONSENT_STATUSES = ["granted", "declined", "excluded", "pending"] as const;
export const CASE_PARTY_FOLLOW_UP_CONSENT_SOURCES = ["enquiry_carry_forward", "closure_admin", "legacy_case", "system_exclusion", "email_request", "public_link"] as const;

export const caseClosurePartyFollowUps = pgTable("case_closure_party_follow_ups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  closureRecordId: varchar("closure_record_id").references(() => caseClosureRecords.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  consentStatus: text("consent_status").notNull(),
  consentSource: text("consent_source").notNull().default("closure_admin"),
  exclusionReason: text("exclusion_reason"),
  consentRecordedAt: timestamp("consent_recorded_at").notNull().defaultNow(),
  consentRecordedBy: varchar("consent_recorded_by").references(() => users.id, { onDelete: "set null" }),
  followUpConsentTokenHash: text("follow_up_consent_token_hash"),
  followUpConsentTokenExpiresAt: timestamp("follow_up_consent_token_expires_at"),
  followUpConsentRequestSentAt: timestamp("follow_up_consent_request_sent_at"),
  followUpConsentEmailStatus: text("follow_up_consent_email_status").notNull().default("not_attempted"),
  followUpConsentEmailLastError: text("follow_up_consent_email_last_error"),
  followUpConsentDecidedAt: timestamp("follow_up_consent_decided_at"),
  followUpConsentDecisionSource: text("follow_up_consent_decision_source"),
  followUpTasksScheduled: integer("follow_up_tasks_scheduled").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_closure_party_follow_ups_closure_party_unique").on(table.closureRecordId, table.partyId),
  uniqueIndex("case_closure_party_follow_ups_case_party_unique").on(table.caseId, table.partyId),
  uniqueIndex("case_closure_party_follow_ups_token_hash_unique").on(table.followUpConsentTokenHash).where(sql`${table.followUpConsentTokenHash} IS NOT NULL`),
  index("case_closure_party_follow_ups_case_idx").on(table.caseId),
  index("case_closure_party_follow_ups_party_idx").on(table.partyId),
  index("case_closure_party_follow_ups_client_idx").on(table.clientId),
  index("case_closure_party_follow_ups_consent_idx").on(table.consentStatus),
]);

export const CASE_CIM_CONSENT_FORM_TYPES = ["cf10", "cf12"] as const;
export type CaseCimConsentFormType = typeof CASE_CIM_CONSENT_FORM_TYPES[number];

export const CASE_CIM_CONSENT_STATUSES = ["pending", "granted", "refused"] as const;
export type CaseCimConsentStatus = typeof CASE_CIM_CONSENT_STATUSES[number];

export const caseCimConsents = pgTable("case_cim_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  formType: text("form_type").notNull(),
  status: text("status").notNull().default("pending"),
  recordedBy: varchar("recorded_by").references(() => users.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_cim_consents_case_party_form_unique").on(table.caseId, table.partyId, table.formType),
  index("case_cim_consents_case_idx").on(table.caseId),
  index("case_cim_consents_party_idx").on(table.partyId),
  index("case_cim_consents_status_idx").on(table.status),
]);

export const permissions = pgTable("permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  role: text("role").notNull(),
  section: text("section").notNull(),
  canView: boolean("can_view").notNull().default(false),
  canEdit: boolean("can_edit").notNull().default(false),
}, (table) => [
  unique("permissions_role_section_unique").on(table.role, table.section),
]);

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  userId: varchar("user_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: varchar("entity_id"),
  entityRef: text("entity_ref"),
  details: text("details"),
  ipAddress: text("ip_address"),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  entityRef?: string | null;
  details?: string | null;
  ipAddress?: string | null;
};

export const AUDIT_ACTIONS = [
  "create", "update", "delete", "login", "login_failed", "logout",
  "password_changed",
  "convert", "register", "update_stage", "update_notes", "update_shuttle",
  "generate_invite", "generate_booking_link", "book_appointment",
  "confirm_appointment", "cancel_appointment", "expire_appointment",
  "request_appointment_cancellation",
  "assign_mediator", "assign_miam_mediator",
  "allocate_mediation_session", "reallocate_mediation_session",
  "add_session_participant", "remove_session_participant", "record_session_outcome",
  "send_demographic_form", "submit_demographic_form",
  "add_party", "link_party",
  // Task #167 — multi-party + representatives
  "remove_party",
  "create_representative", "update_representative", "delete_representative",
  "send_rep_consent",
  "rep_consent_granted", "rep_consent_withdrawn", "rep_consent_refused",
  "update_mediator_rep_visibility",
  // Task #202 — Client-owned representatives master list
  "create_client_representative", "update_client_representative", "delete_client_representative",
  "attach_representative", "detach_representative",
] as const;

export const AUDIT_ENTITIES = [
  "enquiry", "case", "user", "client", "permissions",
  "confidential_note", "session", "mediator", "party", "service_type",
  "appointment", "demographic_data", "contractor",
  "case_representative",
  "client_representative",
  "case_complaint",
] as const;

export const CONTRACTOR_TYPES = [
  "Marketing",
  "Finance",
  "Investor",
  "Legal",
  "IT",
  "Other",
] as const;
export type ContractorType = (typeof CONTRACTOR_TYPES)[number];

export const CONFIDENTIAL_NOTE_CATEGORIES = [
  "Safety Concern",
  "Case Update",
  "Important Note",
  "Risk Flag",
] as const;

export const caseConfidentialNotes = pgTable("case_confidential_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  category: text("category").notNull(),
  content: text("content").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertConfidentialNoteSchema = createInsertSchema(caseConfidentialNotes).pick({
  caseId: true,
  category: true,
  content: true,
  createdBy: true,
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
  role: true,
  status: true,
  zoomLink: true,
});

export const ENQUIRY_CONTACT_METHODS = [
  "Website form",
  "Direct email",
  "Phone call",
  "WhatsApp message",
  "WhatsApp call",
  "Landline / Air Landline",
  "Calendly consultation",
] as const;
export const CONTACT_METHODS = ENQUIRY_CONTACT_METHODS;
export const CASE_CLOSURE_REASONS = [
  "LA (legal aid)",
  "ELSE (going elsewhere)",
  "COST",
  "DA (domestic abuse)",
  "Unsuitable – mediator decision",
  "Unsuitable – C1 refused",
  "Unsuitable – C2 refused",
  "Enquiry only – non-mediation",
  "Enquiry only – mediation",
  "Agreement reached",
  "Partial agreement reached",
  "Mediation became unsuitable",
  "Other",
] as const;
export const CASE_FOLLOW_UP_CONSENT_STATUSES = ["granted", "declined"] as const;
export const CASE_INTAKE_STATUSES = ["New", "Claimed", "Chasing", "Safeguarding", "Closed"] as const;
export const ENQUIRY_STATUSES = ["New", "Claimed", "Chasing", "Safeguarding", "Closed", "Archived"] as const;

const optionalClosureScore = z.preprocess(
  value => value === undefined || value === "" ? null : value,
  z.number().int().min(0).max(10).nullable().default(null),
);

export const caseClosurePayloadSchema = z.object({
  closureReason: z.enum(CASE_CLOSURE_REASONS),
  closureDetails: z.string().max(10000).optional().nullable(),
  followUpConsentStatus: z.enum(CASE_FOLLOW_UP_CONSENT_STATUSES).optional(),
  partyFollowUpConsents: z.array(z.object({
    partyId: z.string().min(1),
    consentStatus: z.enum(CASE_PARTY_FOLLOW_UP_CONSENT_STATUSES),
    source: z.enum(CASE_PARTY_FOLLOW_UP_CONSENT_SOURCES).optional().default("closure_admin"),
    exclusionReason: z.string().max(1000).optional().nullable(),
  })).optional(),
  lifeSatisfaction: optionalClosureScore,
  anxietyScore: optionalClosureScore,
  serviceRating: optionalClosureScore,
  netPromoterScore: optionalClosureScore,
}).superRefine((value, ctx) => {
  if (value.closureReason === "Other" && !value.closureDetails?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["closureDetails"],
      message: "Other closure reason requires an explanation",
    });
  }
  const partyConsents = value.partyFollowUpConsents ?? [];
  if (!value.followUpConsentStatus && partyConsents.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["followUpConsentStatus"],
      message: "Follow-up consent decision is required",
    });
  }
  const partyIds = new Set<string>();
  partyConsents.forEach((partyConsent, index) => {
    if (partyIds.has(partyConsent.partyId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partyFollowUpConsents", index, "partyId"],
        message: "Each party can only have one follow-up consent decision",
      });
    }
    partyIds.add(partyConsent.partyId);
    if (partyConsent.consentStatus === "excluded" && !partyConsent.exclusionReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partyFollowUpConsents", index, "exclusionReason"],
        message: "Excluded clients require an audit reason",
      });
    }
    if (partyConsent.consentStatus === "pending" && partyConsent.source !== "email_request") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partyFollowUpConsents", index, "source"],
        message: "Pending follow-up consent requires an emailed consent request",
      });
    }
  });
});
export type CaseClosurePayload = z.infer<typeof caseClosurePayloadSchema>;

export const insertEnquirySchema = createInsertSchema(enquiries).pick({
  firstName: true,
  middleName: true,
  lastName: true,
  dateOfBirth: true,
  email: true,
  mobileTelephone: true,
  phoneCode: true,
  landlineTelephone: true,
  contactMethod: true,
  issueType: true,
  referralType: true,
  shuttleMediation: true,
  addressLine1: true,
  addressLine2: true,
  postcode: true,
  consentFollowUp: true,
  consentFollowUpDate: true,
  consentAnonymisedData: true,
  privacyConsent: true,
  leadSource: true,
  leadSourceOther: true,
  issueTypeOther: true,
  metadata: true,
  notes: true,
}).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  mobileTelephone: z.string().min(1, "Telephone is required"),
  contactMethod: z.enum(ENQUIRY_CONTACT_METHODS),
  issueType: z.string().min(1, "Mediation type is required"),
  addressLine1: z.string().min(1, "First line of address is required"),
  postcode: z.string().min(1, "Postcode is required"),
  leadSource: z.string().min(1, "Lead source is required"),
  referralType: z.string().min(1, "Referral type is required"),
  shuttleMediation: z.boolean().optional().default(false),
  privacyConsent: z.boolean().optional().default(false),
  consentFollowUp: z.boolean().optional().default(false),
  consentAnonymisedData: z.boolean().optional().default(false),
});

export const updateEnquirySchema = insertEnquirySchema.omit({ consentFollowUpDate: true }).partial().extend({
  status: z.enum(ENQUIRY_STATUSES).optional(),
  postcode: z.string().min(1, "Postcode is required").optional(),
  leadSource: z.string().min(1, "Lead source is required").optional(),
  privacyConsent: z.boolean().optional(),
});
export type UpdateEnquiry = z.infer<typeof updateEnquirySchema>;
export type UpdateEnquiryData = UpdateEnquiry & {
  consentFollowUpDate?: Date | null;
};

export const insertCaseSchema = createInsertSchema(cases).pick({
  caseRef: true,
  mediatorId: true,
  stage: true,
  status: true,
  issueType: true,
  leadSource: true,
  legacySourceSystem: true,
  legacyCaseNumber: true,
  shuttleMediation: true,
  confidential: true,
  intakeStatus: true,
  claimedBy: true,
  claimedAt: true,
  firstContactDueAt: true,
  firstContactAttemptedAt: true,
  firstContactMethod: true,
  firstContactNotes: true,
  safeguardingStatus: true,
  safeguardingCheckedAt: true,
  safeguardingCheckedBy: true,
  safeguardingNotes: true,
  safeguardingConfidential: true,
  standardChaseStopped: true,
  noWhatsappOrVoicemail: true,
  nationalDaHelplineSignposted: true,
  rebeccaNotifiedAt: true,
  cimEligible: true,
  cimEligibilityMarkedAt: true,
  cimEligibilityMarkedBy: true,
  voucherClaimEligible: true,
  voucherClaimEligibleSetAt: true,
  voucherClaimEligibleSetBy: true,
  referralPartnerName: true,
  referralPartnerCode: true,
  closureReason: true,
  closureDetails: true,
  enquiryDate: true,
  closureDate: true,
});

export const insertCaseClosureRecordSchema = createInsertSchema(caseClosureRecords).pick({
  caseId: true,
  closureReason: true,
  closureDetails: true,
  closedAt: true,
  closedById: true,
  followUpConsentStatus: true,
  outreachExcluded: true,
  lifeSatisfaction: true,
  anxietyScore: true,
  serviceRating: true,
  netPromoterScore: true,
});

export const insertCaseClosurePartyFollowUpSchema = createInsertSchema(caseClosurePartyFollowUps).pick({
  closureRecordId: true,
  caseId: true,
  partyId: true,
  clientId: true,
  consentStatus: true,
  consentSource: true,
  exclusionReason: true,
  consentRecordedAt: true,
  consentRecordedBy: true,
  followUpConsentTokenHash: true,
  followUpConsentTokenExpiresAt: true,
  followUpConsentRequestSentAt: true,
  followUpConsentEmailStatus: true,
  followUpConsentEmailLastError: true,
  followUpConsentDecidedAt: true,
  followUpConsentDecisionSource: true,
  followUpTasksScheduled: true,
});

export const insertPartySchema = createInsertSchema(parties).pick({
  caseId: true,
  clientId: true,
  role: true,
  confidential: true,
  miamMediatorId: true,
  allocatedMediatorId: true,
  portalStatus: true,
});

export const insertCaseCimConsentSchema = createInsertSchema(caseCimConsents).pick({
  caseId: true,
  partyId: true,
  formType: true,
  status: true,
  recordedBy: true,
  recordedAt: true,
  notes: true,
}).extend({
  formType: z.enum(CASE_CIM_CONSENT_FORM_TYPES),
  status: z.enum(CASE_CIM_CONSENT_STATUSES).optional(),
});

export const insertPermissionSchema = createInsertSchema(permissions).pick({
  role: true,
  section: true,
  canView: true,
  canEdit: true,
});

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const CASE_STAGES = [
  "Enquiry",
  "Client A MIAM pending",
  "Client A MIAM booked",
  "Client A MIAM complete - suitable",
  "Client B invited to MIAM",
  "Client B MIAM pending",
  "Client B MIAM booked",
  "Client B MIAM completed",
  "C100 signed form pending",
  "C100 signed form completed",
  "Form A signed form pending",
  "Form A signed form completed",
  "FM1 signed form pending",
  "FM1 signed form completed",
  "Case suitable for mediation",
  "Session 1 pending",
  "Session 1 confirmed",
  "Session 2 pending",
  "Session 2 confirmed",
  "Session 3 pending",
  "Session 3 confirmed",
  "Session 4 pending",
  "Session 4 confirmed",
  "Session 5 pending",
  "Session 5 confirmed",
  "Client A MIAM complete - unsuitable",
  "C100 court application package",
  "Form A court application package",
  "Case unsuitable - referral to recommended partner",
  "Case unsuitable - case closed",
  "Mediation concluded - full agreement reached - referral to recommended provider",
  "Mediation concluded - partial agreement reached - referral to recommended provider",
  "Mediation concluded - full agreement reached - no further action",
  "Mediation concluded - partial agreement reached - no further action",
] as const;

export const ISSUE_TYPES = [
  "Child arrangements",
  "Property & Finance",
  "Children, property & Finance",
  "Grandparent contact",
  "Other family mediation",
  "Workplace mediation",
  "Civil mediation",
  "Commercial",
  "Other (please give details below)",
] as const;

export const LEAD_SOURCES = [
  "Website",
  "Gov.uk website",
  "Google search",
  "Another search engine (e.g. Bing)",
  "Google Ads",
  "Family Mediation Council (FMC website)",
  "Word of mouth (please tell us who?)",
  "National Family Mediation (NFM website)",
  "College of Mediators website",
  "Family Mediation Association (FMA website)",
  "Facebook",
  "Tiktok",
  "LinkedIn",
  "Instagram",
  "Promotional flyer/other",
  "Other (please specify)",
] as const;

export const REFERRAL_TYPES = ["Self-referral", "Client referral"] as const;

export const GENDERS = [
  "Woman",
  "Man",
  "Non-binary",
  "Self-describe",
  "Prefer not to say",
] as const;

export const ETHNIC_ORIGINS = [
  "White - English, Welsh, Scottish, Northern Irish or British",
  "White - Irish",
  "White - Gypsy or Irish Traveller",
  "White - Roma",
  "White - Any other White background",
  "Mixed - White and Black Caribbean",
  "Mixed - White and Black African",
  "Mixed - White and Asian",
  "Mixed - Any other Mixed or Multiple background",
  "Asian - Indian",
  "Asian - Pakistani",
  "Asian - Bangladeshi",
  "Asian - Chinese",
  "Asian - Any other Asian background",
  "Black - African",
  "Black - Caribbean",
  "Black - Any other Black, African or Caribbean background",
  "Other - Arab",
  "Other - Any other ethnic group",
  "Prefer not to say",
  "Self-disclose",
] as const;

export const ETHNIC_GROUPS = {
  "White": [
    "White - English, Welsh, Scottish, Northern Irish or British",
    "White - Irish",
    "White - Gypsy or Irish Traveller",
    "White - Roma",
    "White - Any other White background",
  ],
  "Mixed or Multiple": [
    "Mixed - White and Black Caribbean",
    "Mixed - White and Black African",
    "Mixed - White and Asian",
    "Mixed - Any other Mixed or Multiple background",
  ],
  "Asian or Asian British": [
    "Asian - Indian",
    "Asian - Pakistani",
    "Asian - Bangladeshi",
    "Asian - Chinese",
    "Asian - Any other Asian background",
  ],
  "Black, African, Caribbean or Black British": [
    "Black - African",
    "Black - Caribbean",
    "Black - Any other Black, African or Caribbean background",
  ],
  "Other ethnic group": [
    "Other - Arab",
    "Other - Any other ethnic group",
  ],
  "Other": [
    "Prefer not to say",
    "Self-disclose",
  ],
} as const;

export const DISABILITY_OPTIONS = [
  "None",
  "Blindness or partial sight",
  "Deafness or partial hearing",
  "Mental health condition",
  "Learning disability or difficulty",
  "Memory or cognitive difficulties",
  "Autistic spectrum condition",
  "Neurodivergent - ADHD, dyslexia, dyspraxia or other",
  "Long-term physical health condition or illness",
  "Other",
  "Prefer not to say",
] as const;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type LoginData = z.infer<typeof loginSchema>;
export type Enquiry = typeof enquiries.$inferSelect;
export type InsertEnquiry = z.infer<typeof insertEnquirySchema>;
export type ApiIntegration = typeof apiIntegrations.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type CaseClosureRecord = typeof caseClosureRecords.$inferSelect;
export type InsertCaseClosureRecord = z.infer<typeof insertCaseClosureRecordSchema>;
export type CaseClosurePartyFollowUp = typeof caseClosurePartyFollowUps.$inferSelect;
export type InsertCaseClosurePartyFollowUp = z.infer<typeof insertCaseClosurePartyFollowUpSchema>;
export type PartyLink = typeof parties.$inferSelect;
export type InsertParty = z.infer<typeof insertPartySchema>;
export type Client = typeof clients.$inferSelect;
export type LegacyClientImportBatch = typeof legacyClientImportBatches.$inferSelect;
export type LegacyCrmRecord = typeof legacyCrmRecords.$inferSelect;
export type LegacyCrmRecordClient = typeof legacyCrmRecordClients.$inferSelect;

export type Party = PartyLink & {
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
  userId: string | null;
};
export type InsertClient = {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneCode?: string | null;
  gender?: string | null;
  ethnicOrigin?: string | null;
  nationalInsuranceNumber?: string | null;
  disabilityOrHealthCondition?: string | null;
  additionalNeeds?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  userId?: string | null;
};
export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type ConfidentialNote = typeof caseConfidentialNotes.$inferSelect;
export type InsertConfidentialNote = z.infer<typeof insertConfidentialNoteSchema>;

export const SERVICE_TYPE_CATEGORIES = [
  "MIAM",
  "Mediation",
  "Court & Documentation",
  "Packages",
] as const;

export const serviceTypes = pgTable("service_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  category: text("category").notNull(),
  priceInfo: text("price_info"),
  onlinePaymentEnabled: boolean("online_payment_enabled").notNull().default(false),
  paymentAmountPence: integer("payment_amount_pence"),
  paymentCurrency: text("payment_currency").notNull().default("gbp"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  baselineServiceName: text("baseline_service_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const serviceTypeDeletions = pgTable("service_type_deletions", {
  name: text("name").primaryKey(),
  deletedAt: timestamp("deleted_at").notNull().defaultNow(),
});

export const mediatorServiceTypes = pgTable("mediator_service_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceTypeId: varchar("service_type_id").notNull().references(() => serviceTypes.id, { onDelete: "cascade" }),
  mediationRoleQualification: text("mediation_role_qualification").notNull().default("unclassified"),
}, (table) => [
  unique("mediator_service_types_unique").on(table.mediatorId, table.serviceTypeId),
]);

export const insertServiceTypeSchema = createInsertSchema(serviceTypes).pick({
  name: true,
  description: true,
  category: true,
  priceInfo: true,
  onlinePaymentEnabled: true,
  paymentAmountPence: true,
  paymentCurrency: true,
  isActive: true,
  sortOrder: true,
}).extend({
  name: z.string().min(1, "Name is required"),
  category: z.enum(SERVICE_TYPE_CATEGORIES, { errorMap: () => ({ message: "Invalid category" }) }),
  onlinePaymentEnabled: z.boolean().optional(),
  paymentAmountPence: z.number().int().positive().nullable().optional(),
  paymentCurrency: z.string().trim().toLowerCase().default("gbp"),
});

export type ServiceType = typeof serviceTypes.$inferSelect;
export type InsertServiceType = z.infer<typeof insertServiceTypeSchema>;
export type MediatorServiceType = typeof mediatorServiceTypes.$inferSelect;
export type MediatorServiceAssignmentInput = {
  serviceTypeId: string;
  mediationRoleQualification: MediationRoleQualification;
};

export const mediatorCalendarAvailabilitySources = pgTable("mediator_calendar_availability_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  externalSeriesId: text("external_series_id"),
  origin: text("origin").notNull(),
  scopeMode: text("scope_mode").notNull(),
  title: text("title"),
  isAllDay: boolean("is_all_day").notNull().default(false),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  providerFingerprint: text("provider_fingerprint").notNull(),
  expectedProviderFingerprint: text("expected_provider_fingerprint"),
  adminTaskId: varchar("admin_task_id"),
  auditCorrelationId: varchar("audit_correlation_id").notNull().default(sql`gen_random_uuid()`),
  state: text("state").notNull().default("active"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  invalidatedAt: timestamp("invalidated_at"),
  deletedAt: timestamp("deleted_at"),
  historicalAt: timestamp("historical_at"),
  outOfWindowAt: timestamp("out_of_window_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediator_calendar_availability_source_event_unique")
    .on(table.mediatorId, table.provider, table.externalEventId),
  index("mediator_calendar_availability_source_series_idx").on(table.mediatorId, table.provider, table.externalSeriesId),
  index("mediator_calendar_availability_source_state_idx").on(table.state, table.lastSeenAt),
]);

export const mediatorServiceScheduleSlots = pgTable("mediator_service_schedule_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceTypeId: varchar("service_type_id").notNull().references(() => serviceTypes.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  googleEventId: text("google_event_id"),
  calendarProvider: text("calendar_provider"),
  availabilitySourceId: varchar("availability_source_id").references(() => mediatorCalendarAvailabilitySources.id, { onDelete: "set null" }),
  lifecycle: text("lifecycle").notNull().default("active"),
  retiredReason: text("retired_reason"),
  retiredAt: timestamp("retired_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediator_service_schedule_slots_manual_unique")
    .on(table.mediatorId, table.serviceTypeId, table.startAt, table.endAt)
    .where(sql`${table.availabilitySourceId} IS NULL AND ${table.lifecycle} = 'active'`),
  uniqueIndex("mediator_service_schedule_slots_source_service_unique")
    .on(table.availabilitySourceId, table.serviceTypeId, table.startAt, table.endAt)
    .where(sql`${table.availabilitySourceId} IS NOT NULL AND ${table.lifecycle} = 'active'`),
]);

export const calendarWebhookSubscriptions = pgTable("calendar_webhook_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalSubscriptionId: text("external_subscription_id"),
  channelId: text("channel_id"),
  resourceId: text("resource_id"),
  clientStateHash: text("client_state_hash"),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  lastNotificationAt: timestamp("last_notification_at"),
  lastError: text("last_error"),
  renewalFailureCount: integer("renewal_failure_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("calendar_webhook_subscriptions_provider_external_unique").on(table.provider, table.externalSubscriptionId),
  index("calendar_webhook_subscriptions_renewal_idx").on(table.status, table.expiresAt),
]);

export const calendarAvailabilityReconciliationJobs = pgTable("calendar_availability_reconciliation_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  trigger: text("trigger").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("calendar_availability_reconciliation_jobs_due_idx").on(table.status, table.nextAttemptAt),
  uniqueIndex("calendar_availability_reconciliation_jobs_active_dedupe_unique")
    .on(table.mediatorId, table.provider, table.dedupeKey)
    .where(sql`${table.status} IN ('pending', 'processing')`),
]);

export type MediatorCalendarAvailabilitySource = typeof mediatorCalendarAvailabilitySources.$inferSelect;
export type CalendarWebhookSubscription = typeof calendarWebhookSubscriptions.$inferSelect;
export type CalendarAvailabilityReconciliationJob = typeof calendarAvailabilityReconciliationJobs.$inferSelect;

export const insertMediatorServiceScheduleSlotSchema = createInsertSchema(mediatorServiceScheduleSlots).pick({
  mediatorId: true,
  serviceTypeId: true,
  startAt: true,
  endAt: true,
  googleEventId: true,
}).extend({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  googleEventId: z.string().nullable().optional(),
  calendarProvider: z.enum(["google", "outlook"]).nullable().optional(),
});

export type MediatorServiceScheduleSlot = typeof mediatorServiceScheduleSlots.$inferSelect;
export type InsertMediatorServiceScheduleSlot = z.infer<typeof insertMediatorServiceScheduleSlotSchema>;

export const DAYS_OF_WEEK = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export const APPOINTMENT_STATUSES = [
  "hold", "confirmed", "cancelled", "completed", "expired",
] as const;

export const APPOINTMENT_PAYMENT_STATUSES = [
  "payment_pending",
  "paid",
  "voucher_pending",
  "voucher_accepted_by_opia",
  "payment_not_required",
  "failed_or_not_received",
] as const;

export const mediatorAvailability = pgTable("mediator_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  partyId: varchar("party_id").references(() => parties.id),
  serviceTypeId: varchar("service_type_id").references(() => serviceTypes.id),
  mediatorId: varchar("mediator_id").references(() => users.id),
  dateTime: timestamp("date_time").notNull(),
  dateTimeBasis: text("date_time_basis").notNull().default("wall_clock_utc"),
  duration: integer("duration").notNull().default(60),
  status: text("status").notNull().default("hold"),
  holdExpiresAt: timestamp("hold_expires_at"),
  holdAlertSentAt: timestamp("hold_alert_sent_at"),
  bookingToken: text("booking_token"),
  paymentStatus: text("payment_status").notNull().default("payment_pending"),
  paymentStatusUpdatedAt: timestamp("payment_status_updated_at"),
  paymentStatusUpdatedBy: varchar("payment_status_updated_by").references(() => users.id, { onDelete: "set null" }),
  paymentNotes: text("payment_notes"),
  paymentProvider: text("payment_provider"),
  paymentAmountPence: integer("payment_amount_pence"),
  paymentCurrency: text("payment_currency"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripePaymentCompletedAt: timestamp("stripe_payment_completed_at"),
  paymentFailureReason: text("payment_failure_reason"),
  notes: text("notes"),
  meetingLink: text("meeting_link"),
  parentGoogleEventId: text("parent_google_event_id"),
  parentCalendarProvider: text("parent_calendar_provider"),
  parentEventOriginalStart: timestamp("parent_event_original_start"),
  parentEventOriginalEnd: timestamp("parent_event_original_end"),
  parentEventOriginalTitle: text("parent_event_original_title"),
  // JSON-encoded snapshot of the parent Google event's attendees at split
  // time, e.g. [{"email":"...","displayName":"..."}]. Used during restore
  // when the original parent event was deleted (atStart / exact-fill cases)
  // so the recreated event preserves the original invite list rather than
  // dropping back to BFM-only.
  parentEventOriginalAttendees: text("parent_event_original_attendees"),
  googleBookingEventId: text("google_booking_event_id"),
  bookingCalendarProvider: text("booking_calendar_provider"),
  googleTrailingRemnantEventId: text("google_trailing_remnant_event_id"),
  trailingRemnantCalendarProvider: text("trailing_remnant_calendar_provider"),
  availabilitySourceId: varchar("availability_source_id").references(() => mediatorCalendarAvailabilitySources.id, { onDelete: "set null" }),
  availabilityReservationMode: text("availability_reservation_mode"),
  // The "client-side" Google event sitting on the BFM info@ calendar.
  // Created with sendUpdates:"all" so Google emails the invite to the client
  // on behalf of info@. Never carries the mediator's email — kept separate
  // from googleBookingEventId (which sits on the mediator's calendar with
  // attendees mediator+info@ only) so neither side leaks to the other.
  googleClientEventId: text("google_client_event_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  activeSlotUnique: uniqueIndex("appointments_active_mediator_slot_unique")
    .on(table.mediatorId, table.dateTime)
    .where(sql`status = 'confirmed'`),
  activePartyBookingTokenUnique: uniqueIndex("appointments_active_party_booking_token_unique")
    .on(table.partyId, table.bookingToken)
    .where(sql`party_id IS NOT NULL AND booking_token IS NOT NULL AND status NOT IN ('cancelled', 'expired')`),
}));

export const appointmentClientCalendarEvents = pgTable("appointment_client_calendar_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appointmentId: varchar("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id),
  googleEventId: text("google_event_id").notNull(),
  icalUid: text("ical_uid").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("appointment_client_calendar_events_appointment_party_unique").on(table.appointmentId, table.partyId),
]);

export const appointmentCalendarSyncJobs = pgTable("appointment_calendar_sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appointmentId: varchar("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }).unique(),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
  failureStage: text("failure_stage"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("appointment_calendar_sync_jobs_due_idx").on(table.status, table.nextAttemptAt),
]);

export type AppointmentCalendarSyncJob = typeof appointmentCalendarSyncJobs.$inferSelect;

export const insertMediatorAvailabilitySchema = createInsertSchema(mediatorAvailability).pick({
  mediatorId: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  isActive: true,
}).extend({
  dayOfWeek: z.number().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format"),
});

export const insertAppointmentSchema = createInsertSchema(appointments).pick({
  caseId: true,
  partyId: true,
  serviceTypeId: true,
  mediatorId: true,
  dateTime: true,
  dateTimeBasis: true,
  duration: true,
  status: true,
  holdExpiresAt: true,
  holdAlertSentAt: true,
  bookingToken: true,
  paymentStatus: true,
  paymentStatusUpdatedAt: true,
  paymentStatusUpdatedBy: true,
  paymentNotes: true,
  paymentProvider: true,
  paymentAmountPence: true,
  paymentCurrency: true,
  stripeCheckoutSessionId: true,
  stripePaymentIntentId: true,
  stripePaymentCompletedAt: true,
  paymentFailureReason: true,
  notes: true,
  meetingLink: true,
  parentGoogleEventId: true,
  parentCalendarProvider: true,
  parentEventOriginalStart: true,
  parentEventOriginalEnd: true,
  parentEventOriginalTitle: true,
  parentEventOriginalAttendees: true,
  googleBookingEventId: true,
  bookingCalendarProvider: true,
  googleTrailingRemnantEventId: true,
  trailingRemnantCalendarProvider: true,
  availabilitySourceId: true,
  availabilityReservationMode: true,
  googleClientEventId: true,
});

export type MediatorAvailability = typeof mediatorAvailability.$inferSelect;
export type InsertMediatorAvailability = z.infer<typeof insertMediatorAvailabilitySchema>;
export type Appointment = typeof appointments.$inferSelect;
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;

export const MEDIATION_SESSION_STATUSES = ["pending", "allocated", "scheduled", "completed", "cancelled"] as const;
export type MediationSessionStatus = typeof MEDIATION_SESSION_STATUSES[number];

export const MEDIATION_SESSION_PARTICIPANT_ROLES = ["lead_mediator", "co_mediator", "observer"] as const;
export type MediationSessionParticipantRole = typeof MEDIATION_SESSION_PARTICIPANT_ROLES[number];

export const MEDIATION_ROLE_QUALIFICATIONS = ["unclassified", "observer", "co_mediator", "lead"] as const;
export type MediationRoleQualification = typeof MEDIATION_ROLE_QUALIFICATIONS[number];

export function normalizeMediationRoleQualification(value: unknown): MediationRoleQualification {
  return (MEDIATION_ROLE_QUALIFICATIONS as readonly unknown[]).includes(value)
    ? value as MediationRoleQualification
    : "unclassified";
}

export function getMediationRoleQualificationLabel(value: unknown): string {
  switch (normalizeMediationRoleQualification(value)) {
    case "lead": return "Lead mediator";
    case "co_mediator": return "Co-mediator";
    case "observer": return "Observer";
    default: return "Unclassified";
  }
}

export function attachMediatorQualifications<T extends { id: string }>(
  mediators: T[],
  profiles: Array<{ userId: string; mediationRoleQualification: unknown }>,
) {
  const qualificationByMediatorId = new Map(
    profiles.map((profile) => [
      profile.userId,
      normalizeMediationRoleQualification(profile.mediationRoleQualification),
    ]),
  );
  return mediators.map((mediator) => ({
    ...mediator,
    mediationRoleQualification: qualificationByMediatorId.get(mediator.id) ?? "unclassified",
  }));
}

const MEDIATION_ROLE_QUALIFICATION_RANK: Record<MediationRoleQualification, number> = {
  unclassified: 0,
  observer: 1,
  co_mediator: 2,
  lead: 3,
};

const MEDIATION_SESSION_ROLE_MINIMUM_RANK: Record<MediationSessionParticipantRole, number> = {
  observer: 1,
  co_mediator: 2,
  lead_mediator: 3,
};

export function isMediationRoleQualifiedFor(
  qualification: unknown,
  role: MediationSessionParticipantRole,
): boolean {
  if (!(MEDIATION_ROLE_QUALIFICATIONS as readonly unknown[]).includes(qualification)) return false;
  return MEDIATION_ROLE_QUALIFICATION_RANK[qualification as MediationRoleQualification]
    >= MEDIATION_SESSION_ROLE_MINIMUM_RANK[role];
}

export type MediationRoleOption = {
  id: string;
  name: string;
  email: string;
  status: string;
  mediationRoleQualification: MediationRoleQualification;
};

export type MediationRoleOptionCandidate = MediationRoleOption & {
  mediationSessionsApproved: boolean;
};

export type MediationRoleOptionSets = {
  leadMediators: MediationRoleOption[];
  coMediators: MediationRoleOption[];
  observers: MediationRoleOption[];
};

export type CaseLeadMediatorOption = {
  id: string;
  name: string;
};

export type CaseLeadMediatorOptionCandidate = CaseLeadMediatorOption & {
  role: string;
  status: string;
  serviceTypeId: string;
  mediationRoleQualification: MediationRoleQualification;
  serviceApproved: boolean;
};

export function buildCaseLeadMediatorOptions(
  candidates: CaseLeadMediatorOptionCandidate[],
): CaseLeadMediatorOption[] {
  const optionsByMediatorId = new Map<string, CaseLeadMediatorOption>();
  for (const candidate of candidates) {
    if (
      candidate.role !== "mediator"
      || candidate.status !== "active"
      || candidate.mediationRoleQualification !== "lead"
      || !candidate.serviceApproved
    ) continue;
    optionsByMediatorId.set(candidate.id, { id: candidate.id, name: candidate.name });
  }
  return Array.from(optionsByMediatorId.values()).sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

export function buildMediationRoleOptionSets(
  candidates: MediationRoleOptionCandidate[],
): MediationRoleOptionSets {
  const eligible = candidates.filter((candidate) => candidate.status === "active" && candidate.mediationSessionsApproved);
  const forRole = (role: MediationSessionParticipantRole) => eligible
    .filter((candidate) => isMediationRoleQualifiedFor(candidate.mediationRoleQualification, role))
    .map(({ mediationSessionsApproved: _approved, ...candidate }) => candidate);
  return {
    leadMediators: forRole("lead_mediator"),
    coMediators: forRole("co_mediator"),
    observers: forRole("observer"),
  };
}

export function findDuplicateMediationSessionRoleIds(
  leadMediatorId: string,
  coMediatorIds: string[],
  observerIds: string[],
): string[] {
  const rolesByUserId = new Map<string, Set<MediationSessionParticipantRole>>();
  const add = (userId: string, role: MediationSessionParticipantRole) => {
    const cleanId = String(userId || "").trim();
    if (!cleanId) return;
    const roles = rolesByUserId.get(cleanId) || new Set<MediationSessionParticipantRole>();
    roles.add(role);
    rolesByUserId.set(cleanId, roles);
  };
  add(leadMediatorId, "lead_mediator");
  coMediatorIds.forEach((id) => add(id, "co_mediator"));
  observerIds.forEach((id) => add(id, "observer"));
  return Array.from(rolesByUserId.entries())
    .filter(([, roles]) => roles.size > 1)
    .map(([userId]) => userId);
}

export const MEDIATION_SESSION_PARTICIPANT_INVITATION_STATUSES = ["invited", "accepted", "declined"] as const;
export type MediationSessionParticipantInvitationStatus = typeof MEDIATION_SESSION_PARTICIPANT_INVITATION_STATUSES[number];

export const MEDIATION_SESSION_OUTCOMES = [
  "next_session_needed",
  "full_agreement",
  "partial_agreement",
  "no_agreement_closed",
  "unsuitable",
] as const;
export type MediationSessionOutcome = typeof MEDIATION_SESSION_OUTCOMES[number];

export const POST_SESSION_REVIEW_STATUSES = ["not_submitted", "submitted", "changes_requested", "approved"] as const;
export type PostSessionReviewStatus = typeof POST_SESSION_REVIEW_STATUSES[number];

export const mediationSessions = pgTable("mediation_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  sessionNumber: integer("session_number").notNull(),
  leadMediatorId: varchar("lead_mediator_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  outcome: text("outcome"),
  outcomeNotes: text("outcome_notes"),
  nextAction: text("next_action"),
  documentsRequired: text("documents_required"),
  followUpRequirements: text("follow_up_requirements"),
  nextSessionRequired: boolean("next_session_required").notNull().default(false),
  summarySubmittedBy: varchar("summary_submitted_by").references(() => users.id, { onDelete: "set null" }),
  summarySubmittedAt: timestamp("summary_submitted_at"),
  postSessionReviewStatus: text("post_session_review_status").notNull().default("not_submitted"),
  postSessionReviewRequestedBy: varchar("post_session_review_requested_by").references(() => users.id, { onDelete: "set null" }),
  postSessionReviewRequestedAt: timestamp("post_session_review_requested_at"),
  postSessionReviewedBy: varchar("post_session_reviewed_by").references(() => users.id, { onDelete: "set null" }),
  postSessionReviewedAt: timestamp("post_session_reviewed_at"),
  postSessionReviewNotes: text("post_session_review_notes"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  allocatedBy: varchar("allocated_by").references(() => users.id, { onDelete: "set null" }),
  allocatedAt: timestamp("allocated_at"),
  completedBy: varchar("completed_by").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediation_sessions_case_number_unique").on(table.caseId, table.sessionNumber),
  index("mediation_sessions_case_idx").on(table.caseId),
  index("mediation_sessions_lead_mediator_idx").on(table.leadMediatorId),
]);

export const APPOINTMENT_LIFECYCLE_EVENT_TYPES = [
  "appointment_created",
  "appointment_rescheduled",
  "appointment_confirmed",
  "appointment_cancelled",
  "appointment_expired",
  "appointment_completed",
  "appointment_deleted",
  "mediation_session_hold_released",
  "mediation_session_replacement_proposed",
] as const;
export type AppointmentLifecycleEventType = typeof APPOINTMENT_LIFECYCLE_EVENT_TYPES[number];

export const appointmentStatusHistory = pgTable("appointment_status_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").references(() => mediationSessions.id, { onDelete: "set null" }),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  previousDateTime: timestamp("previous_date_time"),
  newDateTime: timestamp("new_date_time"),
  previousDuration: integer("previous_duration"),
  newDuration: integer("new_duration"),
  eventType: text("event_type").notNull(),
  reason: text("reason"),
  changedBy: varchar("changed_by").references(() => users.id, { onDelete: "set null" }),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  metadata: jsonb("metadata"),
}, (table) => [
  index("appointment_status_history_appointment_idx").on(table.appointmentId),
  index("appointment_status_history_case_idx").on(table.caseId),
  index("appointment_status_history_session_idx").on(table.mediationSessionId),
  index("appointment_status_history_changed_at_idx").on(table.changedAt),
]);

export const mediationSessionParticipants = pgTable("mediation_session_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  invitationStatus: text("invitation_status").notNull().default("accepted"),
  invitationTokenHash: text("invitation_token_hash").unique(),
  invitationSentAt: timestamp("invitation_sent_at"),
  invitationViewedAt: timestamp("invitation_viewed_at"),
  invitationRespondedAt: timestamp("invitation_responded_at"),
  invitationDeclineNotes: text("invitation_decline_notes"),
  addedBy: varchar("added_by").references(() => users.id, { onDelete: "set null" }),
  addedAt: timestamp("added_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediation_session_participants_session_user_role_unique").on(table.sessionId, table.userId, table.role),
  index("mediation_session_participants_session_idx").on(table.sessionId),
  index("mediation_session_participants_user_idx").on(table.userId),
]);

export const MEDIATION_SESSION_PROPOSAL_STATUSES = ["held", "accepted", "declined", "confirmed", "expired", "released"] as const;
export type MediationSessionProposalStatus = typeof MEDIATION_SESSION_PROPOSAL_STATUSES[number];

export const MEDIATION_SESSION_PROPOSAL_RECIPIENT_TYPES = ["client", "mediator", "mediator_participant"] as const;
export type MediationSessionProposalRecipientType = typeof MEDIATION_SESSION_PROPOSAL_RECIPIENT_TYPES[number];

export const MEDIATION_SESSION_PROPOSAL_RESPONSE_STATUSES = ["pending", "viewed", "accepted", "declined"] as const;
export type MediationSessionProposalResponseStatus = typeof MEDIATION_SESSION_PROPOSAL_RESPONSE_STATUSES[number];

export const mediationSessionProposals = pgTable("mediation_session_proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  appointmentId: varchar("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  proposedStartAt: timestamp("proposed_start_at").notNull(),
  proposedEndAt: timestamp("proposed_end_at").notNull(),
  status: text("status").notNull().default("held"),
  voucherFormRequired: boolean("voucher_form_required").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediation_session_proposals_appointment_unique").on(table.appointmentId),
  index("mediation_session_proposals_session_idx").on(table.mediationSessionId),
  index("mediation_session_proposals_case_idx").on(table.caseId),
  index("mediation_session_proposals_status_idx").on(table.status),
]);

export const mediationSessionProposalRecipients = pgTable("mediation_session_proposal_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id").notNull().references(() => mediationSessionProposals.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  participantId: varchar("participant_id").references(() => mediationSessionParticipants.id, { onDelete: "cascade" }),
  participantRole: text("participant_role"),
  recipientType: text("recipient_type").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email"),
  tokenHash: text("token_hash").notNull().unique(),
  responseStatus: text("response_status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),
  declineNotes: text("decline_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("mediation_session_proposal_recipients_proposal_idx").on(table.proposalId),
  index("mediation_session_proposal_recipients_session_idx").on(table.mediationSessionId),
  index("mediation_session_proposal_recipients_response_idx").on(table.responseStatus),
]);

export const PARTY_REQUIRED_FORM_TYPES = [
  "agreement_to_mediate_confidentiality",
  "voucher_scheme_client_consent",
  "voucher_diversity_questionnaire_opt_in",
  "voucher_moj_research_contact_opt_in",
] as const;
export type PartyRequiredFormType = typeof PARTY_REQUIRED_FORM_TYPES[number];

export const PARTY_REQUIRED_FORM_STATUSES = ["outstanding", "sent", "viewed", "signed"] as const;
export type PartyRequiredFormStatus = typeof PARTY_REQUIRED_FORM_STATUSES[number];
export const PARTY_REQUIRED_FORM_DELIVERY_STATUSES = ["not_sent", "in_app_task_created", "email_sent", "email_skipped", "email_failed"] as const;
export type PartyRequiredFormDeliveryStatus = typeof PARTY_REQUIRED_FORM_DELIVERY_STATUSES[number];
export const PARTY_REQUIRED_FORM_SIGNATURE_SOURCES = ["platform", "upload", "admin_offline"] as const;
export type PartyRequiredFormSignatureSource = typeof PARTY_REQUIRED_FORM_SIGNATURE_SOURCES[number];

export const partyRequiredForms = pgTable("party_required_forms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  mediationSessionId: varchar("mediation_session_id").references(() => mediationSessions.id, { onDelete: "cascade" }),
  formType: text("form_type").notNull(),
  status: text("status").notNull().default("outstanding"),
  deliveryStatus: text("delivery_status").notNull().default("not_sent"),
  deliveryLastAttemptedAt: timestamp("delivery_last_attempted_at"),
  deliveryError: text("delivery_error"),
  issuedBy: varchar("issued_by").references(() => users.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  signedAt: timestamp("signed_at"),
  signedBy: varchar("signed_by").references(() => users.id, { onDelete: "set null" }),
  signerName: text("signer_name"),
  signatureIpAddress: text("signature_ip_address"),
  attestationText: text("attestation_text"),
  attestationVersion: text("attestation_version"),
  confirmationTickedAt: timestamp("confirmation_ticked_at"),
  signatureSource: text("signature_source"),
  uploadedDocumentId: varchar("uploaded_document_id"),
  uploadNotes: text("upload_notes"),
  withdrawnAt: timestamp("withdrawn_at"),
  withdrawnBy: varchar("withdrawn_by").references(() => users.id, { onDelete: "set null" }),
  courtFormTemplateId: varchar("court_form_template_id"),
  courtFormGenerationId: varchar("court_form_generation_id"),
  generatedDocumentId: varchar("generated_document_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("party_required_forms_session_party_type_unique").on(table.mediationSessionId, table.partyId, table.formType),
  uniqueIndex("party_required_forms_case_party_type_unique")
    .on(table.caseId, table.partyId, table.formType)
    .where(sql`${table.mediationSessionId} IS NULL`),
  index("party_required_forms_case_idx").on(table.caseId),
  index("party_required_forms_party_idx").on(table.partyId),
  index("party_required_forms_appointment_idx").on(table.appointmentId),
  index("party_required_forms_status_idx").on(table.status),
]);

export const VOUCHER_CLAIM_STATUSES = [
  "voucher_claim_submitted",
  "claim_accepted",
  "claim_paid",
] as const;
export type VoucherClaimStatus = typeof VOUCHER_CLAIM_STATUSES[number];

export const mediationSessionVoucherClaims = pgTable("mediation_session_voucher_claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  status: text("status").notNull().default("voucher_claim_submitted"),
  opiaClaimReference: text("opia_claim_reference"),
  submittedAt: timestamp("submitted_at"),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: varchar("accepted_by").references(() => users.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at"),
  paidBy: varchar("paid_by").references(() => users.id, { onDelete: "set null" }),
  lastChasedAt: timestamp("last_chased_at"),
  nextChaseDueAt: timestamp("next_chase_due_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediation_session_voucher_claims_session_unique").on(table.mediationSessionId),
  index("mediation_session_voucher_claims_case_idx").on(table.caseId),
  index("mediation_session_voucher_claims_opia_ref_idx").on(table.opiaClaimReference),
  index("mediation_session_voucher_claims_status_idx").on(table.status),
  index("mediation_session_voucher_claims_next_chase_idx").on(table.nextChaseDueAt),
]);

export const MEDIATION_SESSION_AVAILABILITY_SOURCES = ["client", "admin", "reschedule_request", "next_session_request"] as const;
export type MediationSessionAvailabilitySource = typeof MEDIATION_SESSION_AVAILABILITY_SOURCES[number];

export const mediationSessionAvailabilityWindows = pgTable("mediation_session_availability_windows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "cascade" }),
  proposalRecipientId: varchar("proposal_recipient_id").references(() => mediationSessionProposalRecipients.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  source: text("source").notNull().default("client"),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("mediation_session_availability_session_idx").on(table.mediationSessionId),
  index("mediation_session_availability_party_idx").on(table.partyId),
  index("mediation_session_availability_window_idx").on(table.startAt, table.endAt),
]);

export const MEDIATION_SESSION_PARTY_ATTENDANCE_STATUSES = ["no_show"] as const;
export type MediationSessionPartyAttendanceStatus = typeof MEDIATION_SESSION_PARTY_ATTENDANCE_STATUSES[number];

export const mediationSessionPartyAttendance = pgTable("mediation_session_party_attendance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("no_show"),
  markedBy: varchar("marked_by").references(() => users.id, { onDelete: "set null" }),
  markedAt: timestamp("marked_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mediation_session_party_attendance_session_party_unique").on(table.mediationSessionId, table.partyId),
  index("mediation_session_party_attendance_session_idx").on(table.mediationSessionId),
  index("mediation_session_party_attendance_party_idx").on(table.partyId),
]);

export const CASE_DOCUMENT_REVIEW_STATUSES = ["draft", "ready_for_review", "reviewed"] as const;
export type CaseDocumentReviewStatus = typeof CASE_DOCUMENT_REVIEW_STATUSES[number];

export const FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES = [
  "Property & finance (PF)",
  "All issues mediation (AIM)",
] as const;
export type FinancialDisclosureEligibleFamilySubtype = typeof FINANCIAL_DISCLOSURE_ELIGIBLE_FAMILY_SUBTYPES[number];

export const MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES = [
  "Child arrangements (CA)",
  "All issues mediation (AIM)",
] as const;
export type MojVoucherEligibleFamilySubtype = typeof MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES[number];

export function isMojVoucherEligibleCase(
  caseRecord: Pick<Case, "mediationCategory" | "familySubType" | "issueType"> | null | undefined,
): boolean {
  if (!caseRecord) return false;
  const subtype = (caseRecord.familySubType || caseRecord.issueType || "").trim();
  const eligible = (MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES as readonly string[]).includes(subtype);
  if (caseRecord.mediationCategory) {
    return caseRecord.mediationCategory === "Family" && eligible;
  }
  return eligible;
}

export function isVoucherClaimEligibleCase(
  caseRecord: Pick<Case, "mediationCategory" | "familySubType" | "issueType"> | null | undefined,
): boolean {
  if (!caseRecord) return false;
  if (caseRecord.mediationCategory && caseRecord.mediationCategory !== "Family") return false;

  const familySubType = (caseRecord.familySubType || "").trim();
  if (familySubType) {
    return (MOJ_VOUCHER_ELIGIBLE_FAMILY_SUBTYPES as readonly string[]).includes(familySubType);
  }

  const issueType = (caseRecord.issueType || "").trim().toLowerCase();
  if (!issueType) return false;
  if (issueType.includes("property") || issueType.includes("finance") || issueType.includes("financial")) {
    return false;
  }
  return issueType.includes("child") || issueType.includes("aim");
}

export const FINANCIAL_DISCLOSURE_FOLDER_STATUSES = ["active", "completed", "archived"] as const;
export type FinancialDisclosureFolderStatus = typeof FINANCIAL_DISCLOSURE_FOLDER_STATUSES[number];

export const FINANCIAL_DISCLOSURE_ITEM_TYPES = [
  "online_disclosure_booklet",
  "financial_disclosure_checklist",
] as const;
export type FinancialDisclosureItemType = typeof FINANCIAL_DISCLOSURE_ITEM_TYPES[number];

export const FINANCIAL_DISCLOSURE_ITEM_STATUSES = ["outstanding", "in_progress", "completed", "waived"] as const;
export type FinancialDisclosureItemStatus = typeof FINANCIAL_DISCLOSURE_ITEM_STATUSES[number];

export const FINANCIAL_DISCLOSURE_UPLOAD_TARGETS = [
  "online_disclosure_booklet",
  "form_e",
  "ofs",
  "financial_disclosure_checklist",
  "evidence_category",
] as const;
export type FinancialDisclosureUploadTarget = typeof FINANCIAL_DISCLOSURE_UPLOAD_TARGETS[number];

export const FINANCIAL_DISCLOSURE_EVIDENCE_CATEGORY_DEFINITIONS = [
  { key: "bank_statements", label: "Bank statements", description: "Current and recent bank account statements" },
  { key: "payslips_income", label: "Payslips / income", description: "Payslips, benefit income, maintenance, or other income evidence" },
  { key: "tax_business_records", label: "Tax / business records", description: "Tax returns, accounts, dividend, or self-employment records" },
  { key: "mortgage_property", label: "Mortgage / property", description: "Mortgage statements, valuations, title, rent, or property details" },
  { key: "pensions_cetv", label: "Pensions / CETV", description: "Pension statements and cash equivalent transfer values" },
  { key: "debts_loans", label: "Debts / loans", description: "Credit cards, loans, overdrafts, and other liabilities" },
  { key: "savings_investments", label: "Savings / investments", description: "Savings accounts, ISAs, shares, crypto, trusts, and investments" },
  { key: "other_evidence", label: "Other evidence", description: "Other financial disclosure evidence" },
] as const;
export type FinancialDisclosureEvidenceCategoryKey = typeof FINANCIAL_DISCLOSURE_EVIDENCE_CATEGORY_DEFINITIONS[number]["key"];

export const mediationSessionNotes = pgTable("mediation_session_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").notNull().references(() => mediationSessions.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("mediation_session_notes_session_idx").on(table.mediationSessionId),
  index("mediation_session_notes_case_idx").on(table.caseId),
]);

export const financialDisclosureFolders = pgTable("financial_disclosure_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  triggerSource: text("trigger_source").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("financial_disclosure_folders_case_party_unique").on(table.caseId, table.partyId),
  index("financial_disclosure_folders_case_idx").on(table.caseId),
  index("financial_disclosure_folders_party_idx").on(table.partyId),
  index("financial_disclosure_folders_status_idx").on(table.status),
]);

export const financialDisclosureItems = pgTable("financial_disclosure_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  folderId: varchar("folder_id").notNull().references(() => financialDisclosureFolders.id, { onDelete: "cascade" }),
  itemType: text("item_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("outstanding"),
  payload: jsonb("payload").notNull().default({}),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("financial_disclosure_items_folder_type_unique").on(table.folderId, table.itemType),
  index("financial_disclosure_items_folder_idx").on(table.folderId),
  index("financial_disclosure_items_type_idx").on(table.itemType),
  index("financial_disclosure_items_status_idx").on(table.status),
]);

export const financialDisclosureEvidenceCategories = pgTable("financial_disclosure_evidence_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  folderId: varchar("folder_id").notNull().references(() => financialDisclosureFolders.id, { onDelete: "cascade" }),
  categoryKey: text("category_key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("financial_disclosure_evidence_folder_key_unique").on(table.folderId, table.categoryKey),
  index("financial_disclosure_evidence_folder_idx").on(table.folderId),
]);

export const financialDisclosureBookletTemplates = pgTable("financial_disclosure_booklet_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  versionLabel: text("version_label").notNull(),
  sourceFileName: text("source_file_name").notNull(),
  sourceFileUrl: text("source_file_url").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull().default("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  isCurrent: boolean("is_current").notNull().default(false),
  placeholderKeys: jsonb("placeholder_keys").notNull().default([]),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  notes: text("notes"),
}, (table) => [
  index("financial_disclosure_booklet_templates_current_idx").on(table.isCurrent),
  uniqueIndex("financial_disclosure_booklet_templates_version_unique").on(table.versionLabel),
]);

export const DRAFT_FINANCIAL_SCHEDULE_STATUSES = ["draft", "submitted", "changes_requested", "approved", "archived", "confirmed"] as const;
export type DraftFinancialScheduleStatus = typeof DRAFT_FINANCIAL_SCHEDULE_STATUSES[number];

export const caseDraftFinancialSchedules = pgTable("case_draft_financial_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  // Null only for preserved legacy case-level schedules that could not be mapped to a session.
  mediationSessionId: varchar("mediation_session_id").references(() => mediationSessions.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  payload: jsonb("payload").notNull().default({}),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at"),
  confirmedBy: varchar("confirmed_by").references(() => users.id, { onDelete: "set null" }),
  confirmedInSessionId: varchar("confirmed_in_session_id").references(() => mediationSessions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_draft_financial_schedules_session_unique").on(table.mediationSessionId),
  index("case_draft_financial_schedules_status_idx").on(table.status),
]);

export const caseDraftFinancialScheduleVersions = pgTable("case_draft_financial_schedule_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scheduleId: varchar("schedule_id").notNull().references(() => caseDraftFinancialSchedules.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull().default({}),
  editedBy: varchar("edited_by").references(() => users.id, { onDelete: "set null" }),
  editedAt: timestamp("edited_at").notNull().defaultNow(),
  source: text("source").notNull(),
  confirmedInSessionId: varchar("confirmed_in_session_id").references(() => mediationSessions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_draft_financial_schedule_versions_schedule_version_unique").on(table.scheduleId, table.versionNumber),
  index("case_draft_financial_schedule_versions_schedule_idx").on(table.scheduleId),
  index("case_draft_financial_schedule_versions_case_idx").on(table.caseId),
  index("case_draft_financial_schedule_versions_edited_at_idx").on(table.editedAt),
]);

export const COURT_FORM_TYPES = [
  "FM1",
  "C100",
  "FormA",
  "FormE",
  "AgreementToMediate",
  "VoucherSchemeClientConsent",
  "VoucherDiversityQuestionnaireOptIn",
  "VoucherMojResearchContactOptIn",
  "DraftFinancialSchedule",
  "FinancialDisclosureBooklet",
] as const;
export type CourtFormType = typeof COURT_FORM_TYPES[number];

export const COURT_FORM_TEMPLATE_FORM_TYPES = COURT_FORM_TYPES;
export const COURT_FORM_GUIDANCE_SIGNOFF_STATUSES = ["draft", "pending_review", "approved"] as const;
export type CourtFormGuidanceSignoffStatus = typeof COURT_FORM_GUIDANCE_SIGNOFF_STATUSES[number];
export const COURT_FORM_DRAFT_STATUSES = ["draft", "ready_to_generate", "generated"] as const;
export type CourtFormDraftStatus = typeof COURT_FORM_DRAFT_STATUSES[number];
export const COURT_FORM_GENERATION_STATUSES = ["requested", "generated", "sent", "saved"] as const;
export type CourtFormGenerationStatus = typeof COURT_FORM_GENERATION_STATUSES[number];
export const COURT_FORM_DELIVERY_STATUSES = ["not_attempted", "sent", "failed"] as const;
export type CourtFormDeliveryStatus = typeof COURT_FORM_DELIVERY_STATUSES[number];

export const courtFormTemplates = pgTable("court_form_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  formType: text("form_type").notNull(),
  versionLabel: text("version_label").notNull(),
  sourceFileName: text("source_file_name").notNull(),
  sourceFileUrl: text("source_file_url").notNull(),
  storageKey: text("storage_key"),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  isCurrent: boolean("is_current").notNull().default(false),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  notes: text("notes"),
  verifiedCurrentAt: timestamp("verified_current_at"),
  verifiedBy: varchar("verified_by").references(() => users.id, { onDelete: "set null" }),
  fieldNames: jsonb("field_names").notNull().default([]),
  fieldMetadata: jsonb("field_metadata").notNull().default([]),
  fieldMapping: jsonb("field_mapping").notNull().default([]),
  deletedAt: timestamp("deleted_at"),
  deletedBy: varchar("deleted_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  index("court_form_templates_type_idx").on(table.formType),
  index("court_form_templates_current_idx").on(table.formType, table.isCurrent),
  index("court_form_templates_deleted_idx").on(table.deletedAt),
  uniqueIndex("court_form_templates_type_version_unique")
    .on(table.formType, table.versionLabel)
    .where(sql`deleted_at IS NULL`),
]);

export const courtFormGuidance = pgTable("court_form_guidance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  formType: text("form_type").notNull(),
  templateId: varchar("template_id").references(() => courtFormTemplates.id, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  sectionTitle: text("section_title").notNull(),
  body: text("body").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  legalSignoffStatus: text("legal_signoff_status").notNull().default("draft"),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("court_form_guidance_type_idx").on(table.formType),
  index("court_form_guidance_template_idx").on(table.templateId),
  uniqueIndex("court_form_guidance_template_section_unique").on(table.templateId, table.sectionKey),
]);

export const courtFormDrafts = pgTable("court_form_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  formType: text("form_type").notNull(),
  templateId: varchar("template_id").references(() => courtFormTemplates.id, { onDelete: "set null" }),
  answers: jsonb("answers").notNull().default({}),
  status: text("status").notNull().default("draft"),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("court_form_drafts_case_party_type_unique").on(table.caseId, table.partyId, table.formType),
  index("court_form_drafts_case_idx").on(table.caseId),
  index("court_form_drafts_party_idx").on(table.partyId),
]);

export const caseDocumentRequests = pgTable("case_document_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  requestedBy: varchar("requested_by").references(() => users.id, { onDelete: "set null" }),
  documentType: text("document_type").notNull(),
  documentName: text("document_name").notNull(),
  instructions: text("instructions"),
  status: text("status").notNull().default("outstanding"),
  deliveryStatus: text("delivery_status").notNull().default("not_attempted"),
  deliveryLastAttemptedAt: timestamp("delivery_last_attempted_at"),
  deliveryError: text("delivery_error"),
  submittedAt: timestamp("submitted_at"),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by").references(() => users.id, { onDelete: "set null" }),
  returnedAt: timestamp("returned_at"),
  returnedBy: varchar("returned_by").references(() => users.id, { onDelete: "set null" }),
  returnReason: text("return_reason"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: varchar("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_document_requests_case_idx").on(table.caseId),
  index("case_document_requests_party_status_idx").on(table.partyId, table.status),
  index("case_document_requests_delivery_idx").on(table.deliveryStatus),
]);

export const caseDocuments = pgTable("case_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  mediationSessionId: varchar("mediation_session_id").references(() => mediationSessions.id, { onDelete: "set null" }),
  financialDisclosureFolderId: varchar("financial_disclosure_folder_id").references(() => financialDisclosureFolders.id, { onDelete: "set null" }),
  financialDisclosureItemId: varchar("financial_disclosure_item_id").references(() => financialDisclosureItems.id, { onDelete: "set null" }),
  financialDisclosureEvidenceCategoryId: varchar("financial_disclosure_evidence_category_id").references(() => financialDisclosureEvidenceCategories.id, { onDelete: "set null" }),
  financialDisclosureUploadTarget: text("financial_disclosure_upload_target"),
  documentRequestId: varchar("document_request_id").references(() => caseDocumentRequests.id, { onDelete: "set null" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  documentCategory: text("document_category"),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  storageKey: text("storage_key"),
  mimeType: text("mime_type"),
  documentDate: timestamp("document_date"),
  fileSizeBytes: integer("file_size_bytes"),
  uploadedBy: varchar("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  reviewStatus: text("review_status").notNull().default("draft"),
  readyForReviewAt: timestamp("ready_for_review_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  sharedWithClients: boolean("shared_with_clients").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_documents_case_idx").on(table.caseId),
  index("case_documents_session_idx").on(table.mediationSessionId),
  index("case_documents_financial_disclosure_folder_idx").on(table.financialDisclosureFolderId),
  index("case_documents_financial_disclosure_item_idx").on(table.financialDisclosureItemId),
  index("case_documents_financial_disclosure_category_idx").on(table.financialDisclosureEvidenceCategoryId),
  index("case_documents_financial_disclosure_upload_target_idx").on(table.financialDisclosureUploadTarget),
  index("case_documents_document_request_idx").on(table.documentRequestId),
  index("case_documents_party_idx").on(table.partyId),
  index("case_documents_category_idx").on(table.documentCategory),
  index("case_documents_review_status_idx").on(table.reviewStatus),
]);

export const CASE_PROOFING_ITEM_TYPES = [
  "session_summary",
  "draft_financial_schedule",
  "financial_disclosure_checklist",
  "court_form",
  "case_document",
] as const;
export type CaseProofingItemType = typeof CASE_PROOFING_ITEM_TYPES[number];

export const CASE_PROOFING_STATUSES = ["awaiting_review", "approved", "returned", "withdrawn"] as const;
export type CaseProofingStatus = typeof CASE_PROOFING_STATUSES[number];

export const caseProofingItems = pgTable("case_proofing_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  sessionId: varchar("session_id").references(() => mediationSessions.id, { onDelete: "set null" }),
  itemType: text("item_type").notNull(),
  sourceEntityType: text("source_entity_type").notNull(),
  sourceEntityId: varchar("source_entity_id").notNull(),
  status: text("status").notNull().default("awaiting_review"),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  returnComments: text("return_comments"),
  returnedBy: varchar("returned_by").references(() => users.id, { onDelete: "set null" }),
  returnedAt: timestamp("returned_at"),
  withdrawnBy: varchar("withdrawn_by").references(() => users.id, { onDelete: "set null" }),
  withdrawnAt: timestamp("withdrawn_at"),
  withdrawReason: text("withdraw_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_proofing_items_source_unique").on(table.sourceEntityType, table.sourceEntityId, table.itemType),
  index("case_proofing_items_case_idx").on(table.caseId),
  index("case_proofing_items_session_idx").on(table.sessionId),
  index("case_proofing_items_status_idx").on(table.status),
  index("case_proofing_items_item_type_idx").on(table.itemType),
]);

export const caseProofingItemCycles = pgTable("case_proofing_item_cycles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proofingItemId: varchar("proofing_item_id").notNull().references(() => caseProofingItems.id, { onDelete: "cascade" }),
  cycleNumber: integer("cycle_number").notNull(),
  status: text("status").notNull().default("awaiting_review"),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  returnComments: text("return_comments"),
  returnedBy: varchar("returned_by").references(() => users.id, { onDelete: "set null" }),
  returnedAt: timestamp("returned_at"),
  withdrawnBy: varchar("withdrawn_by").references(() => users.id, { onDelete: "set null" }),
  withdrawnAt: timestamp("withdrawn_at"),
  withdrawReason: text("withdraw_reason"),
  sourceEntityType: text("source_entity_type").notNull(),
  sourceEntityId: varchar("source_entity_id").notNull(),
  fileName: text("file_name"),
  documentDate: timestamp("document_date"),
  uploadDate: timestamp("upload_date"),
  sourceMetadata: jsonb("source_metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_proofing_item_cycles_item_cycle_unique").on(table.proofingItemId, table.cycleNumber),
  index("case_proofing_item_cycles_item_idx").on(table.proofingItemId),
  index("case_proofing_item_cycles_status_idx").on(table.status),
]);

export const courtFormGenerations = pgTable("court_form_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  templateId: varchar("template_id").notNull().references(() => courtFormTemplates.id, { onDelete: "restrict" }),
  templateVersionLabel: text("template_version_label").notNull(),
  draftId: varchar("draft_id").references(() => courtFormDrafts.id, { onDelete: "set null" }),
  caseDocumentId: varchar("case_document_id").references(() => caseDocuments.id, { onDelete: "set null" }),
  generatedBy: varchar("generated_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  status: text("status").notNull().default("requested"),
  recipientEmail: text("recipient_email"),
  deliveryStatus: text("delivery_status").notNull().default("not_attempted"),
  deliveryLastAttemptedAt: timestamp("delivery_last_attempted_at"),
  deliveryLastError: text("delivery_last_error"),
  resendHistory: jsonb("resend_history").notNull().default([]),
}, (table) => [
  index("court_form_generations_case_idx").on(table.caseId),
  index("court_form_generations_party_idx").on(table.partyId),
  index("court_form_generations_template_idx").on(table.templateId),
  index("court_form_generations_document_idx").on(table.caseDocumentId),
]);

export const insertMediationSessionSchema = createInsertSchema(mediationSessions).pick({
  caseId: true,
  sessionNumber: true,
  leadMediatorId: true,
  status: true,
  appointmentId: true,
  outcome: true,
  outcomeNotes: true,
  nextAction: true,
  documentsRequired: true,
  followUpRequirements: true,
  nextSessionRequired: true,
  summarySubmittedBy: true,
  summarySubmittedAt: true,
  postSessionReviewStatus: true,
  postSessionReviewRequestedBy: true,
  postSessionReviewRequestedAt: true,
  postSessionReviewedBy: true,
  postSessionReviewedAt: true,
  postSessionReviewNotes: true,
  createdBy: true,
  allocatedBy: true,
  allocatedAt: true,
  completedBy: true,
  completedAt: true,
});

export const insertAppointmentStatusHistorySchema = createInsertSchema(appointmentStatusHistory).pick({
  appointmentId: true,
  caseId: true,
  mediationSessionId: true,
  previousStatus: true,
  newStatus: true,
  previousDateTime: true,
  newDateTime: true,
  previousDuration: true,
  newDuration: true,
  eventType: true,
  reason: true,
  changedBy: true,
  changedAt: true,
  metadata: true,
}).extend({
  eventType: z.enum(APPOINTMENT_LIFECYCLE_EVENT_TYPES),
});

export const insertMediationSessionParticipantSchema = createInsertSchema(mediationSessionParticipants).pick({
  sessionId: true,
  userId: true,
  role: true,
  invitationStatus: true,
  invitationTokenHash: true,
  invitationSentAt: true,
  invitationViewedAt: true,
  invitationRespondedAt: true,
  invitationDeclineNotes: true,
  addedBy: true,
}).extend({
  role: z.enum(MEDIATION_SESSION_PARTICIPANT_ROLES),
  invitationStatus: z.enum(MEDIATION_SESSION_PARTICIPANT_INVITATION_STATUSES).optional(),
});

export const insertMediationSessionProposalSchema = createInsertSchema(mediationSessionProposals).pick({
  caseId: true,
  mediationSessionId: true,
  appointmentId: true,
  proposedStartAt: true,
  proposedEndAt: true,
  status: true,
  voucherFormRequired: true,
  createdBy: true,
  expiresAt: true,
}).extend({
  status: z.enum(MEDIATION_SESSION_PROPOSAL_STATUSES).optional(),
});

export const insertMediationSessionProposalRecipientSchema = createInsertSchema(mediationSessionProposalRecipients).pick({
  proposalId: true,
  caseId: true,
  mediationSessionId: true,
  partyId: true,
  userId: true,
  participantId: true,
  participantRole: true,
  recipientType: true,
  recipientName: true,
  recipientEmail: true,
  tokenHash: true,
  responseStatus: true,
  sentAt: true,
  viewedAt: true,
  respondedAt: true,
  declineNotes: true,
}).extend({
  recipientType: z.enum(MEDIATION_SESSION_PROPOSAL_RECIPIENT_TYPES),
  responseStatus: z.enum(MEDIATION_SESSION_PROPOSAL_RESPONSE_STATUSES).optional(),
});

export const insertPartyRequiredFormSchema = createInsertSchema(partyRequiredForms).pick({
  caseId: true,
  partyId: true,
  appointmentId: true,
  mediationSessionId: true,
  formType: true,
  status: true,
  deliveryStatus: true,
  deliveryLastAttemptedAt: true,
  deliveryError: true,
  issuedBy: true,
  sentAt: true,
  viewedAt: true,
  signedAt: true,
  signedBy: true,
  signerName: true,
  signatureIpAddress: true,
  attestationText: true,
  attestationVersion: true,
  confirmationTickedAt: true,
  signatureSource: true,
  uploadedDocumentId: true,
  uploadNotes: true,
  withdrawnAt: true,
  withdrawnBy: true,
  courtFormTemplateId: true,
  courtFormGenerationId: true,
  generatedDocumentId: true,
}).extend({
  formType: z.enum(PARTY_REQUIRED_FORM_TYPES),
  status: z.enum(PARTY_REQUIRED_FORM_STATUSES).optional(),
  deliveryStatus: z.enum(PARTY_REQUIRED_FORM_DELIVERY_STATUSES).optional(),
  signatureSource: z.enum(PARTY_REQUIRED_FORM_SIGNATURE_SOURCES).optional().nullable(),
});

export const insertMediationSessionVoucherClaimSchema = createInsertSchema(mediationSessionVoucherClaims).pick({
  caseId: true,
  mediationSessionId: true,
  appointmentId: true,
  status: true,
  opiaClaimReference: true,
  submittedAt: true,
  submittedBy: true,
  acceptedAt: true,
  acceptedBy: true,
  paidAt: true,
  paidBy: true,
  lastChasedAt: true,
  nextChaseDueAt: true,
}).extend({
  status: z.enum(VOUCHER_CLAIM_STATUSES).optional(),
});

export const insertMediationSessionAvailabilityWindowSchema = createInsertSchema(mediationSessionAvailabilityWindows).pick({
  caseId: true,
  mediationSessionId: true,
  partyId: true,
  proposalRecipientId: true,
  startAt: true,
  endAt: true,
  source: true,
  submittedBy: true,
  notes: true,
}).extend({
  source: z.enum(MEDIATION_SESSION_AVAILABILITY_SOURCES).optional(),
});

export const insertMediationSessionPartyAttendanceSchema = createInsertSchema(mediationSessionPartyAttendance).pick({
  caseId: true,
  mediationSessionId: true,
  partyId: true,
  status: true,
  markedBy: true,
  markedAt: true,
}).extend({
  status: z.enum(MEDIATION_SESSION_PARTY_ATTENDANCE_STATUSES).optional(),
});

export const insertMediationSessionNoteSchema = createInsertSchema(mediationSessionNotes).pick({
  caseId: true,
  mediationSessionId: true,
  content: true,
  createdBy: true,
});

export const insertFinancialDisclosureFolderSchema = createInsertSchema(financialDisclosureFolders).pick({
  caseId: true,
  partyId: true,
  status: true,
  triggerSource: true,
}).extend({
  status: z.enum(FINANCIAL_DISCLOSURE_FOLDER_STATUSES).optional(),
});

export const insertFinancialDisclosureItemSchema = createInsertSchema(financialDisclosureItems).pick({
  folderId: true,
  itemType: true,
  title: true,
  description: true,
  status: true,
  payload: true,
  completedAt: true,
  completedBy: true,
  updatedBy: true,
}).extend({
  itemType: z.enum(FINANCIAL_DISCLOSURE_ITEM_TYPES),
  status: z.enum(FINANCIAL_DISCLOSURE_ITEM_STATUSES).optional(),
});

export const insertFinancialDisclosureEvidenceCategorySchema = createInsertSchema(financialDisclosureEvidenceCategories).pick({
  folderId: true,
  categoryKey: true,
  label: true,
  description: true,
  sortOrder: true,
});

export const insertFinancialDisclosureBookletTemplateSchema = createInsertSchema(financialDisclosureBookletTemplates).pick({
  versionLabel: true,
  sourceFileName: true,
  sourceFileUrl: true,
  storageKey: true,
  mimeType: true,
  isCurrent: true,
  placeholderKeys: true,
  uploadedBy: true,
  notes: true,
});

export const insertCaseDraftFinancialScheduleSchema = createInsertSchema(caseDraftFinancialSchedules).pick({
  caseId: true,
  mediationSessionId: true,
  status: true,
  payload: true,
  createdBy: true,
  updatedBy: true,
  confirmedAt: true,
  confirmedBy: true,
  confirmedInSessionId: true,
});

export const insertCaseDraftFinancialScheduleVersionSchema = createInsertSchema(caseDraftFinancialScheduleVersions).pick({
  scheduleId: true,
  caseId: true,
  versionNumber: true,
  status: true,
  payload: true,
  editedBy: true,
  editedAt: true,
  source: true,
  confirmedInSessionId: true,
});

export const insertCourtFormTemplateSchema = createInsertSchema(courtFormTemplates).pick({
  formType: true,
  versionLabel: true,
  sourceFileName: true,
  sourceFileUrl: true,
  storageKey: true,
  mimeType: true,
  isCurrent: true,
  uploadedBy: true,
  uploadedAt: true,
  notes: true,
  verifiedCurrentAt: true,
  verifiedBy: true,
  fieldNames: true,
  fieldMetadata: true,
  fieldMapping: true,
  deletedAt: true,
  deletedBy: true,
}).extend({
  formType: z.enum(COURT_FORM_TYPES),
});

export const insertCourtFormGuidanceSchema = createInsertSchema(courtFormGuidance).pick({
  formType: true,
  templateId: true,
  sectionKey: true,
  sectionTitle: true,
  body: true,
  sortOrder: true,
  legalSignoffStatus: true,
  updatedBy: true,
}).extend({
  formType: z.enum(COURT_FORM_TYPES),
  legalSignoffStatus: z.enum(COURT_FORM_GUIDANCE_SIGNOFF_STATUSES).optional(),
});

export const insertCourtFormDraftSchema = createInsertSchema(courtFormDrafts).pick({
  caseId: true,
  partyId: true,
  formType: true,
  templateId: true,
  answers: true,
  status: true,
  updatedBy: true,
}).extend({
  formType: z.enum(COURT_FORM_TYPES),
  status: z.enum(COURT_FORM_DRAFT_STATUSES).optional(),
});

export const insertCaseDocumentSchema = createInsertSchema(caseDocuments).pick({
  caseId: true,
  mediationSessionId: true,
  financialDisclosureFolderId: true,
  financialDisclosureItemId: true,
  financialDisclosureEvidenceCategoryId: true,
  financialDisclosureUploadTarget: true,
  documentRequestId: true,
  partyId: true,
  documentCategory: true,
  title: true,
  fileName: true,
  fileUrl: true,
  storageKey: true,
  mimeType: true,
  documentDate: true,
  fileSizeBytes: true,
  uploadedBy: true,
  reviewStatus: true,
  readyForReviewAt: true,
  reviewedBy: true,
  reviewedAt: true,
  sharedWithClients: true,
}).extend({
  reviewStatus: z.enum(CASE_DOCUMENT_REVIEW_STATUSES).optional(),
  financialDisclosureUploadTarget: z.enum(FINANCIAL_DISCLOSURE_UPLOAD_TARGETS).optional().nullable(),
});

export const insertCaseDocumentRequestSchema = createInsertSchema(caseDocumentRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCaseProofingItemSchema = createInsertSchema(caseProofingItems).pick({
  caseId: true,
  sessionId: true,
  itemType: true,
  sourceEntityType: true,
  sourceEntityId: true,
  status: true,
  submittedBy: true,
  submittedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  returnComments: true,
  returnedBy: true,
  returnedAt: true,
  withdrawnBy: true,
  withdrawnAt: true,
  withdrawReason: true,
}).extend({
  itemType: z.enum(CASE_PROOFING_ITEM_TYPES),
  status: z.enum(CASE_PROOFING_STATUSES).optional(),
});

export const insertCaseProofingItemCycleSchema = createInsertSchema(caseProofingItemCycles).pick({
  proofingItemId: true,
  cycleNumber: true,
  status: true,
  submittedBy: true,
  submittedAt: true,
  reviewedBy: true,
  reviewedAt: true,
  returnComments: true,
  returnedBy: true,
  returnedAt: true,
  withdrawnBy: true,
  withdrawnAt: true,
  withdrawReason: true,
  sourceEntityType: true,
  sourceEntityId: true,
  fileName: true,
  documentDate: true,
  uploadDate: true,
  sourceMetadata: true,
}).extend({
  status: z.enum(CASE_PROOFING_STATUSES).optional(),
});

export const insertCourtFormGenerationSchema = createInsertSchema(courtFormGenerations).pick({
  caseId: true,
  partyId: true,
  templateId: true,
  templateVersionLabel: true,
  draftId: true,
  caseDocumentId: true,
  generatedBy: true,
  generatedAt: true,
  status: true,
  recipientEmail: true,
  deliveryStatus: true,
  deliveryLastAttemptedAt: true,
  deliveryLastError: true,
  resendHistory: true,
}).extend({
  status: z.enum(COURT_FORM_GENERATION_STATUSES).optional(),
  deliveryStatus: z.enum(COURT_FORM_DELIVERY_STATUSES).optional(),
});

export type MediationSession = typeof mediationSessions.$inferSelect;
export type InsertMediationSession = z.infer<typeof insertMediationSessionSchema>;
export type AppointmentStatusHistory = typeof appointmentStatusHistory.$inferSelect;
export type InsertAppointmentStatusHistory = z.infer<typeof insertAppointmentStatusHistorySchema>;
export type MediationSessionParticipant = typeof mediationSessionParticipants.$inferSelect;
export type InsertMediationSessionParticipant = z.infer<typeof insertMediationSessionParticipantSchema>;
export type MediationSessionProposal = typeof mediationSessionProposals.$inferSelect;
export type InsertMediationSessionProposal = z.infer<typeof insertMediationSessionProposalSchema>;
export type MediationSessionProposalRecipient = typeof mediationSessionProposalRecipients.$inferSelect;
export type InsertMediationSessionProposalRecipient = z.infer<typeof insertMediationSessionProposalRecipientSchema>;
export type PartyRequiredForm = typeof partyRequiredForms.$inferSelect;
export type InsertPartyRequiredForm = z.infer<typeof insertPartyRequiredFormSchema>;
export type MediationSessionVoucherClaim = typeof mediationSessionVoucherClaims.$inferSelect;
export type InsertMediationSessionVoucherClaim = z.infer<typeof insertMediationSessionVoucherClaimSchema>;
export type CaseCimConsent = typeof caseCimConsents.$inferSelect;
export type InsertCaseCimConsent = z.infer<typeof insertCaseCimConsentSchema>;
export type MediationSessionAvailabilityWindow = typeof mediationSessionAvailabilityWindows.$inferSelect;
export type InsertMediationSessionAvailabilityWindow = z.infer<typeof insertMediationSessionAvailabilityWindowSchema>;
export type MediationSessionPartyAttendance = typeof mediationSessionPartyAttendance.$inferSelect;
export type InsertMediationSessionPartyAttendance = z.infer<typeof insertMediationSessionPartyAttendanceSchema>;
export type MediationSessionNote = typeof mediationSessionNotes.$inferSelect;
export type InsertMediationSessionNote = z.infer<typeof insertMediationSessionNoteSchema>;
export type FinancialDisclosureFolder = typeof financialDisclosureFolders.$inferSelect;
export type InsertFinancialDisclosureFolder = z.infer<typeof insertFinancialDisclosureFolderSchema>;
export type FinancialDisclosureItem = typeof financialDisclosureItems.$inferSelect;
export type InsertFinancialDisclosureItem = z.infer<typeof insertFinancialDisclosureItemSchema>;
export type FinancialDisclosureEvidenceCategory = typeof financialDisclosureEvidenceCategories.$inferSelect;
export type InsertFinancialDisclosureEvidenceCategory = z.infer<typeof insertFinancialDisclosureEvidenceCategorySchema>;
export type FinancialDisclosureBookletTemplate = typeof financialDisclosureBookletTemplates.$inferSelect;
export type InsertFinancialDisclosureBookletTemplate = z.infer<typeof insertFinancialDisclosureBookletTemplateSchema>;
export type CaseDraftFinancialSchedule = typeof caseDraftFinancialSchedules.$inferSelect;
export type InsertCaseDraftFinancialSchedule = z.infer<typeof insertCaseDraftFinancialScheduleSchema>;
export type CaseDraftFinancialScheduleVersion = typeof caseDraftFinancialScheduleVersions.$inferSelect;
export type InsertCaseDraftFinancialScheduleVersion = z.infer<typeof insertCaseDraftFinancialScheduleVersionSchema>;
export type CaseDocument = typeof caseDocuments.$inferSelect;
export type InsertCaseDocument = z.infer<typeof insertCaseDocumentSchema>;
export type CaseDocumentRequest = typeof caseDocumentRequests.$inferSelect;
export type InsertCaseDocumentRequest = z.infer<typeof insertCaseDocumentRequestSchema>;
export type CaseProofingItem = typeof caseProofingItems.$inferSelect;
export type InsertCaseProofingItem = z.infer<typeof insertCaseProofingItemSchema>;
export type CaseProofingItemCycle = typeof caseProofingItemCycles.$inferSelect;
export type InsertCaseProofingItemCycle = z.infer<typeof insertCaseProofingItemCycleSchema>;
export type CourtFormTemplate = typeof courtFormTemplates.$inferSelect;
export type InsertCourtFormTemplate = z.infer<typeof insertCourtFormTemplateSchema>;
export type CourtFormGuidance = typeof courtFormGuidance.$inferSelect;
export type InsertCourtFormGuidance = z.infer<typeof insertCourtFormGuidanceSchema>;
export type CourtFormDraft = typeof courtFormDrafts.$inferSelect;
export type InsertCourtFormDraft = z.infer<typeof insertCourtFormDraftSchema>;
export type CourtFormGeneration = typeof courtFormGenerations.$inferSelect;
export type InsertCourtFormGeneration = z.infer<typeof insertCourtFormGenerationSchema>;

export const xeroInvoiceRecords = pgTable("xero_invoice_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appointmentId: varchar("appointment_id").notNull().references(() => appointments.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "set null" }),
  caseInvoiceId: varchar("case_invoice_id"),
  xeroConnectionId: varchar("xero_connection_id").references(() => xeroConnections.id, { onDelete: "set null" }),
  xeroTenantId: text("xero_tenant_id").notNull(),
  xeroContactId: text("xero_contact_id"),
  xeroInvoiceId: text("xero_invoice_id").notNull().unique(),
  xeroInvoiceNumber: text("xero_invoice_number"),
  xeroInvoiceUrl: text("xero_invoice_url"),
  xeroStatus: text("xero_status").notNull().default("AUTHORISED"),
  amountPence: integer("amount_pence").notNull(),
  currency: text("currency").notNull().default("gbp"),
  sentAt: timestamp("sent_at"),
  paidAt: timestamp("paid_at"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("xero_invoice_records_appointment_idx").on(table.appointmentId),
  uniqueIndex("xero_invoice_records_case_invoice_unique_idx").on(table.caseInvoiceId).where(sql`${table.caseInvoiceId} IS NOT NULL`),
  index("xero_invoice_records_status_idx").on(table.xeroStatus),
]);

export type XeroConnection = typeof xeroConnections.$inferSelect;
export type XeroInvoiceRecord = typeof xeroInvoiceRecords.$inferSelect;
export type XeroWebhookEvent = typeof xeroWebhookEvents.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;

export const CASE_INVOICE_STATUSES = [
  "draft",
  "issued",
  "part_paid",
  "paid",
  "overdue",
  "void",
] as const;

export const CASE_PAYMENT_METHODS = [
  "bank_transfer",
  "card",
  "cash",
  "voucher",
  "other",
] as const;

export const CASE_PAYMENT_STATUSES = [
  "unpaid",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
] as const;

export const caseInvoices = pgTable("case_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  billToClientId: varchar("bill_to_client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  billToPartyId: varchar("bill_to_party_id").references(() => parties.id, { onDelete: "set null" }),
  serviceTypeId: varchar("service_type_id").references(() => serviceTypes.id, { onDelete: "set null" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  provider: text("provider").notNull().default("manual"),
  providerInvoiceId: text("provider_invoice_id"),
  paymentLinkUrl: text("payment_link_url"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  failureReason: text("failure_reason"),
  invoiceNumber: text("invoice_number").notNull().unique(),
  status: text("status").notNull().default("draft"),
  issueDate: timestamp("issue_date").notNull().defaultNow(),
  dueDate: timestamp("due_date"),
  subtotalPence: integer("subtotal_pence").notNull().default(0),
  vatTotalPence: integer("vat_total_pence").notNull().default(0),
  voucherDiscountPence: integer("voucher_discount_pence").notNull().default(0),
  totalPence: integer("total_pence").notNull().default(0),
  amountPaidPence: integer("amount_paid_pence").notNull().default(0),
  outstandingPence: integer("outstanding_pence").notNull().default(0),
  currency: text("currency").notNull().default("gbp"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  voidedBy: varchar("voided_by").references(() => users.id, { onDelete: "set null" }),
  voidedAt: timestamp("voided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_invoices_case_idx").on(table.caseId),
  index("case_invoices_client_idx").on(table.billToClientId),
  uniqueIndex("case_invoices_appointment_unique_idx").on(table.appointmentId, table.billToPartyId).where(sql`${table.appointmentId} IS NOT NULL AND ${table.billToPartyId} IS NOT NULL`),
  index("case_invoices_status_idx").on(table.status),
  index("case_invoices_payment_status_idx").on(table.paymentStatus),
  index("case_invoices_due_date_idx").on(table.dueDate),
]);

export const caseInvoiceLineItems = pgTable("case_invoice_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => caseInvoices.id, { onDelete: "cascade" }),
  serviceTypeId: varchar("service_type_id").references(() => serviceTypes.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmountPence: integer("unit_amount_pence").notNull(),
  vatRate: integer("vat_rate"),
  vatAmountPence: integer("vat_amount_pence").notNull().default(0),
  lineSubtotalPence: integer("line_subtotal_pence").notNull(),
  lineTotalPence: integer("line_total_pence").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("case_invoice_line_items_invoice_idx").on(table.invoiceId),
]);

export const casePayments = pgTable("case_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  invoiceId: varchar("invoice_id").references(() => caseInvoices.id, { onDelete: "set null" }),
  appointmentId: varchar("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  amountPence: integer("amount_pence").notNull(),
  currency: text("currency").notNull().default("gbp"),
  paymentDate: timestamp("payment_date").notNull().defaultNow(),
  method: text("method").notNull().default("bank_transfer"),
  provider: text("provider").notNull().default("manual"),
  providerPaymentId: text("provider_payment_id"),
  checkoutSessionId: text("checkout_session_id"),
  paymentIntentId: text("payment_intent_id"),
  paymentStatus: text("payment_status").notNull().default("paid"),
  failureReason: text("failure_reason"),
  refundedAmountPence: integer("refunded_amount_pence").notNull().default(0),
  refundedAt: timestamp("refunded_at"),
  receiptNumber: text("receipt_number"),
  receiptGeneratedAt: timestamp("receipt_generated_at"),
  reference: text("reference"),
  notes: text("notes"),
  recordedBy: varchar("recorded_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_payments_case_idx").on(table.caseId),
  index("case_payments_client_idx").on(table.clientId),
  index("case_payments_invoice_idx").on(table.invoiceId),
  uniqueIndex("case_payments_appointment_unique_idx").on(table.appointmentId, table.partyId).where(sql`${table.appointmentId} IS NOT NULL AND ${table.partyId} IS NOT NULL`),
  index("case_payments_payment_status_idx").on(table.paymentStatus),
  index("case_payments_payment_date_idx").on(table.paymentDate),
]);

export const insertCaseInvoiceSchema = createInsertSchema(caseInvoices).pick({
  caseId: true,
  billToClientId: true,
  billToPartyId: true,
  serviceTypeId: true,
  appointmentId: true,
  provider: true,
  providerInvoiceId: true,
  paymentLinkUrl: true,
  paymentStatus: true,
  failureReason: true,
  status: true,
  issueDate: true,
  dueDate: true,
  voucherDiscountPence: true,
  currency: true,
  notes: true,
}).extend({
  caseId: z.string().min(1),
  billToClientId: z.string().min(1),
  billToPartyId: z.string().nullable().optional(),
  serviceTypeId: z.string().nullable().optional(),
  appointmentId: z.string().nullable().optional(),
  provider: z.string().trim().default("manual"),
  providerInvoiceId: z.string().nullable().optional(),
  paymentLinkUrl: z.string().nullable().optional(),
  paymentStatus: z.enum(CASE_PAYMENT_STATUSES).default("unpaid"),
  failureReason: z.string().nullable().optional(),
  status: z.enum(CASE_INVOICE_STATUSES).optional(),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  voucherDiscountPence: z.number().int().min(0).optional(),
  currency: z.string().trim().toLowerCase().default("gbp"),
  notes: z.string().nullable().optional(),
  lineItems: z.array(z.object({
    serviceTypeId: z.string().nullable().optional(),
    description: z.string().trim().min(1),
    quantity: z.number().int().positive().default(1),
    unitAmountPence: z.number().int().min(0),
    vatRate: z.number().int().min(0).max(100).nullable().optional(),
  })).min(1),
});

export const insertCasePaymentSchema = createInsertSchema(casePayments).pick({
  caseId: true,
  clientId: true,
  partyId: true,
  invoiceId: true,
  appointmentId: true,
  amountPence: true,
  currency: true,
  paymentDate: true,
  method: true,
  provider: true,
  providerPaymentId: true,
  checkoutSessionId: true,
  paymentIntentId: true,
  paymentStatus: true,
  failureReason: true,
  refundedAmountPence: true,
  refundedAt: true,
  receiptNumber: true,
  receiptGeneratedAt: true,
  reference: true,
  notes: true,
}).extend({
  caseId: z.string().min(1),
  clientId: z.string().min(1),
  partyId: z.string().nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  appointmentId: z.string().nullable().optional(),
  amountPence: z.number().int().min(0),
  currency: z.string().trim().toLowerCase().default("gbp"),
  paymentDate: z.coerce.date().optional(),
  method: z.enum(CASE_PAYMENT_METHODS).default("bank_transfer"),
  provider: z.string().trim().default("manual"),
  providerPaymentId: z.string().nullable().optional(),
  checkoutSessionId: z.string().nullable().optional(),
  paymentIntentId: z.string().nullable().optional(),
  paymentStatus: z.enum(CASE_PAYMENT_STATUSES).default("paid"),
  failureReason: z.string().nullable().optional(),
  refundedAmountPence: z.number().int().min(0).default(0),
  refundedAt: z.coerce.date().nullable().optional(),
  receiptNumber: z.string().nullable().optional(),
  receiptGeneratedAt: z.coerce.date().nullable().optional(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  overrideNoShowNoRefund: z.boolean().optional(),
  refundOverrideReason: z.string().max(5000).nullable().optional(),
});

export type CaseInvoice = typeof caseInvoices.$inferSelect;
export type InsertCaseInvoice = z.infer<typeof insertCaseInvoiceSchema>;
export type CaseInvoiceLineItem = typeof caseInvoiceLineItems.$inferSelect;
export type CasePayment = typeof casePayments.$inferSelect;
export type InsertCasePayment = z.infer<typeof insertCasePaymentSchema>;

export const EMPLOYMENT_STATUSES = [
  "Employed full-time",
  "Employed part-time",
  "Self-employed",
  "Unemployed and seeking work",
  "Not working due to long-term illness or disability",
  "Retired",
  "Student",
  "Full-time carer or homemaker",
  "Prefer not to say",
] as const;

export const FAMILY_CASE_SUBTYPES = [
  "Child arrangements (CA)",
  "Property & finance (PF)",
  "All issues mediation (AIM)",
  "Grandparent",
  "Other family",
] as const;

export const WORKPLACE_CASE_SUBTYPES = [
  "Employee & employee",
  "Manager & employee",
  "Team conflict",
  "Grievance",
  "Harassment or bullying",
  "Redundancy",
  "Disciplinary matter",
  "Other",
] as const;

export const COURT_PROCEEDINGS_STATUSES = [
  "Yes - active proceedings",
  "Yes - proceedings threatened or imminent",
  "No",
  "Unknown",
] as const;

export const INTERPRETER_SUPPORT_OPTIONS = [
  "No",
  "Yes - spoken interpreter",
  "Yes - British Sign Language interpreter",
  "Yes - written translation needed",
  "Not sure yet",
] as const;

export const LEGAL_AID_OPTIONS = [
  "Yes",
  "No",
  "Unknown or not yet assessed",
] as const;

export const VOUCHER_SCHEME_OPTIONS = [
  "Yes",
  "No",
  "Not applicable",
  "Other",
] as const;

export const CAFCASS_OPTIONS = [
  "Yes",
  "No",
  "Unknown",
] as const;

export const SOLICITOR_OPTIONS = [
  "Yes",
  "No",
  "Unknown",
] as const;

export const EMOTIONAL_WELLBEING_LABELS: Record<number, string> = {
  1: "Very poor",
  2: "Poor",
  3: "Fair",
  4: "Good",
  5: "Very good",
} as const;

export const demographicData = pgTable("demographic_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  partyId: varchar("party_id").notNull().unique().references(() => parties.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),

  dateOfBirth: text("date_of_birth"),
  genderIdentity: text("gender_identity"),
  genderSelfDescription: text("gender_self_description"),
  ethnicity: text("ethnicity"),
  ethnicSelfDisclose: text("ethnic_self_disclose"),
  countryOfBirth: text("country_of_birth"),
  countryOfBirthOther: text("country_of_birth_other"),
  firstLanguage: text("first_language"),
  firstLanguageOther: text("first_language_other"),
  interpreterNeeded: text("interpreter_needed"),
  interpreterLanguage: text("interpreter_language"),

  disabilityOrHealthConditions: text("disability_or_health_conditions"),
  additionalNeeds: text("additional_needs"),

  employmentStatus: text("employment_status"),
  legalAidEligible: text("legal_aid_eligible"),
  voucherSchemeEligible: text("voucher_scheme_eligible"),

  familyCaseSubtype: text("family_case_subtype"),
  workplaceCaseSubtype: text("workplace_case_subtype"),
  courtProceedingsStatus: text("court_proceedings_status"),
  courtReference: text("court_reference"),
  courtName: text("court_name"),
  cafcassInvolved: text("cafcass_involved"),
  solicitorInvolved: text("solicitor_involved"),
  solicitorName: text("solicitor_name"),
  childrenAges: text("children_ages"),
  relationshipToChild: text("relationship_to_child"),

  lifeSatisfaction: integer("life_satisfaction"),
  anxietyScore: integer("anxiety_score"),
  emotionalWellbeing: integer("emotional_wellbeing"),

  completedBy: text("completed_by"),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDemographicDataSchema = createInsertSchema(demographicData).pick({
  partyId: true,
  caseId: true,
  dateOfBirth: true,
  genderIdentity: true,
  genderSelfDescription: true,
  ethnicity: true,
  ethnicSelfDisclose: true,
  countryOfBirth: true,
  countryOfBirthOther: true,
  firstLanguage: true,
  firstLanguageOther: true,
  interpreterNeeded: true,
  interpreterLanguage: true,
  disabilityOrHealthConditions: true,
  additionalNeeds: true,
  employmentStatus: true,
  legalAidEligible: true,
  voucherSchemeEligible: true,
  familyCaseSubtype: true,
  workplaceCaseSubtype: true,
  courtProceedingsStatus: true,
  courtReference: true,
  courtName: true,
  cafcassInvolved: true,
  solicitorInvolved: true,
  solicitorName: true,
  childrenAges: true,
  relationshipToChild: true,
  lifeSatisfaction: true,
  anxietyScore: true,
  emotionalWellbeing: true,
  completedBy: true,
  completedAt: true,
});

export type DemographicData = typeof demographicData.$inferSelect;
export type InsertDemographicData = z.infer<typeof insertDemographicDataSchema>;

export const COMMON_LANGUAGES = [
  "English",
  "Welsh",
  "Polish",
  "Punjabi",
  "Urdu",
  "Bengali",
  "Gujarati",
  "Arabic",
  "French",
  "Portuguese",
  "Spanish",
  "Tamil",
  "Somali",
  "Turkish",
  "Italian",
  "Lithuanian",
  "Romanian",
  "Mandarin",
  "Cantonese",
  "Other (specify below)",
  "Prefer not to say",
] as const;

export const COUNTRIES_OF_BIRTH = [
  "England",
  "Wales",
  "Scotland",
  "Northern Ireland",
  "Republic of Ireland",
  "EU country (specify)",
  "Other country (specify)",
  "Prefer not to say",
] as const;

export const TASK_STATUSES = ["scheduled", "active", "in_progress", "follow_up", "completed", "cancelled"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const COMPLAINT_CATEGORIES = [
  "mediator_conduct",
  "staff_conduct",
  "service_process",
  "communication",
  "billing",
  "confidentiality_data",
  "other",
] as const;
export type ComplaintCategory = typeof COMPLAINT_CATEGORIES[number];

export const COMPLAINT_TARGET_TYPES = ["mediator", "staff", "service", "other"] as const;
export type ComplaintTargetType = typeof COMPLAINT_TARGET_TYPES[number];

export const COMPLAINT_STATUSES = [
  "received",
  "acknowledged",
  "under_review",
  "awaiting_information",
  "response_issued",
  "closed",
  "withdrawn",
  "duplicate",
] as const;
export type CaseComplaintStatus = typeof COMPLAINT_STATUSES[number];

export const COMPLAINT_OUTCOMES = [
  "upheld",
  "partially_upheld",
  "not_upheld",
  "resolved_informally",
  "no_further_action",
  "withdrawn",
  "duplicate",
] as const;
export type ComplaintOutcome = typeof COMPLAINT_OUTCOMES[number];

export const COMPLAINT_EVENT_TYPES = [
  "submitted",
  "acknowledged",
  "status_changed",
  "internal_note",
  "released_update",
  "clarification_requested",
  "clarification_replied",
  "deadline_extended",
  "response_issued",
  "closed",
  "escalated",
  "withdrawn",
  "duplicate_marked",
  "redacted",
  "email_delivery",
] as const;
export type ComplaintEventType = typeof COMPLAINT_EVENT_TYPES[number];

export const caseComplaints = pgTable("case_complaints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  complaintRef: text("complaint_ref").notNull().unique().default(sql`'CMP-' || lpad(nextval('case_complaint_ref_seq')::text, 6, '0')`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "restrict" }),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "set null" }),
  submittedByRole: text("submitted_by_role").notNull(),
  submitterName: text("submitter_name").notNull(),
  submitterEmail: text("submitter_email"),
  complainantPartyId: varchar("complainant_party_id").references(() => parties.id, { onDelete: "set null" }),
  submissionChannel: text("submission_channel").notNull().default("portal"),
  onBehalfOfName: text("on_behalf_of_name"),
  onBehalfOfEmail: text("on_behalf_of_email"),
  category: text("category").notNull(),
  targetType: text("target_type").notNull(),
  targetUserId: varchar("target_user_id").references(() => users.id, { onDelete: "set null" }),
  targetName: text("target_name"),
  incidentDate: text("incident_date"),
  details: text("details").notNull(),
  desiredResolution: text("desired_resolution"),
  supportingNotes: text("supporting_notes"),
  status: text("status").notNull().default("received"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  acknowledgementDueAt: timestamp("acknowledgement_due_at").notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: varchar("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  responseDueAt: timestamp("response_due_at").notNull(),
  nextUpdateAt: timestamp("next_update_at"),
  finalResponseAt: timestamp("final_response_at"),
  closedAt: timestamp("closed_at"),
  closedBy: varchar("closed_by").references(() => users.id, { onDelete: "set null" }),
  escalatedAt: timestamp("escalated_at"),
  outcome: text("outcome"),
  resolutionSummary: text("resolution_summary"),
  duplicateOfId: varchar("duplicate_of_id").references((): AnyPgColumn => caseComplaints.id, { onDelete: "set null" }),
  fmcRelevantDate: timestamp("fmc_relevant_date"),
  fmcWithinThreeMonths: boolean("fmc_within_three_months"),
  receiptEmailStatus: text("receipt_email_status").notNull().default("pending"),
  receiptEmailLastAttemptedAt: timestamp("receipt_email_last_attempted_at"),
  receiptEmailSentAt: timestamp("receipt_email_sent_at"),
  receiptEmailLastError: text("receipt_email_last_error"),
  reviewTaskId: varchar("review_task_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_complaints_case_idx").on(table.caseId),
  index("case_complaints_submitter_idx").on(table.submittedBy),
  index("case_complaints_status_idx").on(table.status),
  index("case_complaints_ack_due_idx").on(table.acknowledgementDueAt),
  index("case_complaints_response_due_idx").on(table.responseDueAt),
]);

export const caseComplaintEvents = pgTable("case_complaint_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  complaintId: varchar("complaint_id").notNull().references(() => caseComplaints.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  visibility: text("visibility").notNull().default("internal"),
  actorId: varchar("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  message: text("message"),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  relatedEventId: varchar("related_event_id").references((): AnyPgColumn => caseComplaintEvents.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").notNull().default({}),
  redactedAt: timestamp("redacted_at"),
  redactedBy: varchar("redacted_by").references(() => users.id, { onDelete: "set null" }),
  redactionReason: text("redaction_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("case_complaint_events_complaint_idx").on(table.complaintId),
  index("case_complaint_events_related_idx").on(table.relatedEventId),
  uniqueIndex("case_complaint_single_clarification_reply_idx").on(table.relatedEventId).where(sql`${table.type} = 'clarification_replied'`),
]);

export const caseComplaintAttachments = pgTable("case_complaint_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  complaintId: varchar("complaint_id").notNull().references(() => caseComplaints.id, { onDelete: "cascade" }),
  eventId: varchar("event_id").references(() => caseComplaintEvents.id, { onDelete: "set null" }),
  uploadedBy: varchar("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  redactedAt: timestamp("redacted_at"),
  redactedBy: varchar("redacted_by").references(() => users.id, { onDelete: "set null" }),
  redactionReason: text("redaction_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("case_complaint_attachments_complaint_idx").on(table.complaintId),
  index("case_complaint_attachments_event_idx").on(table.eventId),
]);

export type CaseComplaint = typeof caseComplaints.$inferSelect;
export type InsertCaseComplaint = typeof caseComplaints.$inferInsert;
export type ComplaintEvent = typeof caseComplaintEvents.$inferSelect;
export type InsertComplaintEvent = typeof caseComplaintEvents.$inferInsert;
export type ComplaintAttachment = typeof caseComplaintAttachments.$inferSelect;
export type InsertComplaintAttachment = typeof caseComplaintAttachments.$inferInsert;

export const complaintAttachmentInputSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileData: z.string().trim().min(1).max(14_000_000),
}).strict();

export const complaintSubmissionSchema = z.object({
  caseId: z.string().trim().min(1).optional(),
  caseRef: z.string().trim().min(1).max(100).optional(),
  submissionChannel: z.enum(["portal", "phone", "email", "staff_recorded"]).default("portal"),
  onBehalfOfName: z.string().trim().min(1).max(200).optional().nullable(),
  onBehalfOfEmail: z.string().trim().email().max(320).optional().nullable(),
  category: z.enum(COMPLAINT_CATEGORIES),
  targetType: z.enum(COMPLAINT_TARGET_TYPES),
  targetUserId: z.string().trim().min(1).optional().nullable(),
  targetName: z.string().trim().min(1).max(200).optional().nullable(),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  details: z.string().trim().min(10).max(20_000),
  desiredResolution: z.string().trim().max(10_000).optional().nullable(),
  supportingNotes: z.string().trim().max(20_000).optional().nullable(),
  attachments: z.array(complaintAttachmentInputSchema).max(5).default([]),
}).strict().superRefine((value, ctx) => {
  if (!!value.caseId === !!value.caseRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["caseId"], message: "Provide exactly one of caseId or caseRef" });
  }
});
export type ComplaintSubmissionInput = z.infer<typeof complaintSubmissionSchema>;

export const complaintStatusActionSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  clarificationRequest: z.string().trim().min(1).max(10_000).optional(),
  releasedResponse: z.string().trim().min(1).max(20_000).optional(),
  outcome: z.enum(COMPLAINT_OUTCOMES).optional(),
  resolutionSummary: z.string().trim().min(1).max(20_000).optional(),
  duplicateOfId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "awaiting_information" && !value.clarificationRequest) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["clarificationRequest"], message: "Clarification request is required" });
  }
  if (value.status === "response_issued" && !value.releasedResponse) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["releasedResponse"], message: "Released response is required" });
  }
  if (value.status === "closed" && (!value.outcome || !value.resolutionSummary)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resolutionSummary"], message: "Outcome and resolution summary are required" });
  }
  if (value.status === "withdrawn" && !value.resolutionSummary) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resolutionSummary"], message: "Withdrawal reason is required" });
  }
  if (value.status === "duplicate" && !value.duplicateOfId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["duplicateOfId"], message: "Original complaint is required" });
  }
});

export const clarificationReplySchema = z.object({
  requestEventId: z.string().trim().min(1),
  response: z.string().trim().min(1).max(20_000),
  attachments: z.array(complaintAttachmentInputSchema).max(5).default([]),
}).strict();

export const complaintNoteSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  visibility: z.enum(["internal", "submitter"]),
  nextUpdateAt: z.string().datetime().optional(),
}).strict();

export const complaintDeadlineExtensionSchema = z.object({
  responseDueAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(5_000),
  releasedUpdate: z.string().trim().min(1).max(10_000),
}).strict();

export const complaintEscalationSchema = z.object({
  destination: z.enum(["subject", "ppc", "fmsb", "other"]),
  note: z.string().trim().min(1).max(10_000),
}).strict();

export const complaintRedactionSchema = z.object({
  reason: z.string().trim().min(1).max(5_000),
}).strict();

export type ComplaintAttachmentSummary = Pick<ComplaintAttachment, "id" | "fileName" | "mimeType" | "sizeBytes" | "createdAt" | "redactedAt">;
export type SubmitterComplaintStatus = Pick<CaseComplaint,
  "id" | "complaintRef" | "caseId" | "status" | "receivedAt" | "acknowledgementDueAt" | "acknowledgedAt" |
  "responseDueAt" | "nextUpdateAt" | "finalResponseAt" | "closedAt" | "outcome" | "resolutionSummary" | "fmcRelevantDate" | "fmcWithinThreeMonths"
> & { events: ComplaintEvent[] };
export type SuperadminComplaintDetail = CaseComplaint & { events: ComplaintEvent[]; attachments: ComplaintAttachmentSummary[] };

export const TASK_AUDIENCES = ["internal", "mediator", "client"] as const;
export type TaskAudience = typeof TASK_AUDIENCES[number];

export const TASK_VISIBILITIES = ["assignees", "admin_wide", "superadmin_only"] as const;
export type TaskVisibility = typeof TASK_VISIBILITIES[number];

export const TASK_SCHEDULE_KINDS = ["timed", "all_day"] as const;
export type TaskScheduleKind = typeof TASK_SCHEDULE_KINDS[number];

export const TASK_REMINDER_MINUTES = [15, 30, 60, 1440, 10080] as const;

export const taskSeries = pgTable("task_series", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  urgency: text("urgency").notNull(),
  caseId: varchar("case_id"),
  frequency: text("frequency").notNull(),
  firstDate: text("first_date").notNull(),
  endDate: text("end_date"),
  schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull(),
  assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull(),
  generatedThrough: text("generated_through"),
  active: boolean("active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  audience: text("audience").notNull(),
  visibility: text("visibility").notNull().default("assignees"),
  type: text("type").notNull(),
  urgency: text("urgency").notNull(),
  status: text("status").notNull().default("active"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  caseId: varchar("case_id"),
  enquiryId: varchar("enquiry_id"),
  complaintId: varchar("complaint_id").references(() => caseComplaints.id, { onDelete: "set null" }),
  appointmentId: varchar("appointment_id"),
  dueAt: timestamp("due_at"),
  completionNotes: text("completion_notes"),
  completedBy: varchar("completed_by").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  cancelledBy: varchar("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  caseNoteRequired: boolean("case_note_required").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  legacyNotificationId: varchar("legacy_notification_id").unique(),
  seriesId: varchar("series_id").references(() => taskSeries.id, { onDelete: "set null" }),
  seriesAssigneeId: varchar("series_assignee_id").references(() => users.id, { onDelete: "set null" }),
  occurrenceDate: text("occurrence_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("tasks_audience_status_idx").on(table.audience, table.status),
  index("tasks_case_idx").on(table.caseId),
  index("tasks_due_idx").on(table.dueAt),
  uniqueIndex("tasks_series_occurrence_unique").on(table.seriesId, table.seriesAssigneeId, table.occurrenceDate),
]);

export const taskAssignees = pgTable("task_assignees", {
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedBy: varchar("assigned_by").references(() => users.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.taskId, table.userId] }),
  index("task_assignees_user_idx").on(table.userId),
]);

export const taskSavedViews = pgTable("task_saved_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  query: jsonb("query").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("task_saved_views_user_name_unique").on(table.userId, table.name),
  index("task_saved_views_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const taskSchedules = pgTable("task_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }).unique(),
  kind: text("kind").notNull(),
  startAt: timestamp("start_at"),
  endAt: timestamp("end_at"),
  allDayStart: text("all_day_start"),
  allDayEndExclusive: text("all_day_end_exclusive"),
  reminderMinutes: integer("reminder_minutes"),
  reminderSentAt: timestamp("reminder_sent_at"),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  googleEventId: text("google_event_id"),
  deliveryKind: text("delivery_kind").notNull().default("bfm"),
  deliveryUserId: varchar("delivery_user_id").references(() => users.id, { onDelete: "set null" }),
  syncStatus: text("sync_status").notNull().default("pending"),
  lastSyncErrorCode: text("last_sync_error_code"),
  lastSyncErrorMessage: text("last_sync_error_message"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("task_schedules_active_start_idx").on(table.active, table.startAt),
  index("task_schedules_reminder_idx").on(table.active, table.reminderSentAt),
]);

export const taskCalendarSyncJobs = pgTable("task_calendar_sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id"),
  taskScheduleId: varchar("task_schedule_id").references(() => taskSchedules.id, { onDelete: "set null" }),
  operation: text("operation").notNull(),
  scheduleVersion: integer("schedule_version").notNull(),
  googleEventId: text("google_event_id"),
  deliveryKind: text("delivery_kind"),
  deliveryUserId: varchar("delivery_user_id"),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("task_calendar_sync_jobs_version_unique").on(table.taskId, table.scheduleVersion, table.operation),
  index("task_calendar_sync_jobs_due_idx").on(table.status, table.nextAttemptAt),
]);

export type Task = typeof tasks.$inferSelect;
export type TaskSavedView = typeof taskSavedViews.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;
export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type TaskSchedule = typeof taskSchedules.$inferSelect;
export type TaskCalendarSyncJob = typeof taskCalendarSyncJobs.$inferSelect;

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipientId: varchar("recipient_id"),
  recipientRole: text("recipient_role").notNull(),
  type: text("type").notNull(),
  urgency: text("urgency").notNull(),
  caseId: varchar("case_id"),
  complaintId: varchar("complaint_id").references(() => caseComplaints.id, { onDelete: "set null" }),
  appointmentId: varchar("appointment_id"),
  taskId: varchar("task_id").references(() => tasks.id, { onDelete: "set null" }),
  documentRequestId: varchar("document_request_id").references(() => caseDocumentRequests.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("active"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  followUpDate: timestamp("follow_up_date"),
  intakeFollowUpIntervalDays: integer("intake_follow_up_interval_days"),
  intakeFollowUpScheduledBy: varchar("intake_follow_up_scheduled_by").references(() => users.id, { onDelete: "set null" }),
  completionNotes: text("completion_notes"),
  completedBy: varchar("completed_by"),
  completedAt: timestamp("completed_at"),
  caseNoteRequired: boolean("case_note_required").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("notifications_dynamic_intake_due_alert_once")
    .on(table.type, table.taskId)
    .where(sql`${table.type} = 'task_follow_up_due_alert' AND ${table.taskId} IS NOT NULL`),
  index("notifications_document_request_idx").on(table.documentRequestId),
]);

export const notificationReads = pgTable("notification_reads", {
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.notificationId, table.userId] }),
  index("notification_reads_user_idx").on(table.userId),
]);

export const notificationTaskLinks = pgTable("notification_task_links", {
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  taskId: varchar("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  reopenedAt: timestamp("reopened_at"),
}, (table) => [
  primaryKey({ columns: [table.notificationId, table.userId] }),
  uniqueIndex("notification_task_links_task_unique").on(table.taskId),
  index("notification_task_links_user_idx").on(table.userId),
]);

export const notificationAssignees = pgTable("notification_assignees", {
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedBy: varchar("assigned_by").references(() => users.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.notificationId, table.userId] }),
  index("notification_assignees_user_idx").on(table.userId),
]);

export const taskReminderDeliveries = pgTable("task_reminder_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskScheduleId: varchar("task_schedule_id").notNull().references(() => taskSchedules.id, { onDelete: "cascade" }),
  taskId: varchar("task_id").notNull(),
  scheduleVersion: integer("schedule_version").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("task_reminder_deliveries_once_unique").on(table.taskScheduleId, table.scheduleVersion, table.userId),
  index("task_reminder_deliveries_task_idx").on(table.taskId),
]);

export const insertNotificationSchema = createInsertSchema(notifications).pick({
  recipientId: true,
  recipientRole: true,
  type: true,
  urgency: true,
  caseId: true,
  complaintId: true,
  appointmentId: true,
  taskId: true,
  documentRequestId: true,
  title: true,
  message: true,
  status: true,
  assignedTo: true,
  followUpDate: true,
  caseNoteRequired: true,
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type NotificationRead = typeof notificationReads.$inferSelect;
export type NotificationTaskLink = typeof notificationTaskLinks.$inferSelect;
export type NotificationAssignee = typeof notificationAssignees.$inferSelect;
export type TaskReminderDelivery = typeof taskReminderDeliveries.$inferSelect;

export const CASE_ACTIVITY_TYPES = [
  "enquiry_created",
  "case_created",
  "appointment_hold",
  "appointment_held",
  "appointment_confirmed",
  "appointment_cancelled",
  "appointment_cancellation_requested",
  "appointment_expired",
  "appointment_completed",
  "email_sent",
  "call_logged",
  "whatsapp_logged",
  "note_added",
  "miam_submitted",
  "miam_approved",
  "miam_rejected",
  "miam_flagged",
  "stage_changed",
  "task_created",
  "task_assigned",
  "task_status_changed",
  "task_completed",
  "party_added",
  "party_linked",
  "mediation_session_allocated",
  "mediation_session_reallocated",
  "mediation_session_participant_added",
  "mediation_session_participant_removed",
  "mediation_session_proposal_link_resent",
  "mediation_session_outcome_recorded",
  "mediation_session_note_added",
  "mediation_session_summary_recorded",
  "case_document_uploaded",
  "proofing_submitted",
  "proofing_approved",
  "proofing_returned",
  "proofing_withdrawn",
  "proofing_client_release",
] as const;

export const caseActivities = pgTable("case_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  metadata: text("metadata"),
  direction: text("direction"),
  performedBy: varchar("performed_by"),
  performedByName: text("performed_by_name"),
  actorType: text("actor_type"),
  actorChannel: text("actor_channel"),
  relatedEntityId: varchar("related_entity_id"),
  relatedEntityType: text("related_entity_type"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCaseActivitySchema = createInsertSchema(caseActivities).omit({
  id: true,
  createdAt: true,
});

export type CaseActivity = typeof caseActivities.$inferSelect;
export type InsertCaseActivity = z.infer<typeof insertCaseActivitySchema>;

export const CASE_COMMUNICATION_CHANNELS = ["email", "whatsapp", "phone", "manual"] as const;
export const CASE_COMMUNICATION_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export const CASE_COMMUNICATION_DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
  "skipped",
  "manual",
  "unknown",
] as const;
export const CASE_COMMUNICATION_BACKFILL_CONFIDENCES = ["exact", "inferred", "partial"] as const;

export const caseCommunicationLogs = pgTable("case_communication_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  caseRef: text("case_ref").notNull(),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "set null" }),
  recipientType: text("recipient_type").notNull().default("client"),
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  channel: text("channel").notNull(),
  direction: text("direction").notNull(),
  trigger: text("trigger").notNull().default("manual"),
  templateName: text("template_name"),
  subject: text("subject"),
  sentAt: timestamp("sent_at"),
  deliveryStatus: text("delivery_status").notNull().default("unknown"),
  sourceEntityType: text("source_entity_type"),
  sourceEntityId: varchar("source_entity_id"),
  providerMessageId: text("provider_message_id"),
  actorType: text("actor_type").notNull().default("system"),
  actorId: varchar("actor_id"),
  actorName: text("actor_name"),
  preview: text("preview"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  backfillConfidence: text("backfill_confidence").notNull().default("exact"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_communication_logs_case_sent_idx").on(table.caseId, table.sentAt),
  index("case_communication_logs_channel_idx").on(table.channel),
  index("case_communication_logs_status_idx").on(table.deliveryStatus),
  index("case_communication_logs_recipient_idx").on(table.partyId, table.clientId),
  uniqueIndex("case_communication_logs_source_unique_idx")
    .on(table.sourceEntityType, table.sourceEntityId)
    .where(sql`${table.sourceEntityType} IS NOT NULL AND ${table.sourceEntityId} IS NOT NULL`),
]);

export const insertCaseCommunicationLogSchema = createInsertSchema(caseCommunicationLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CaseCommunicationLog = typeof caseCommunicationLogs.$inferSelect;
export type InsertCaseCommunicationLog = z.infer<typeof insertCaseCommunicationLogSchema>;

export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  kind: text("kind").notNull().default("manual"),
  status: text("status").notNull().default("published"),
  guidance: text("guidance").notNull().default(""),
  variables: jsonb("variables").$type<Array<{ key: string; label: string }>>().notNull().default(sql`'[]'::jsonb`),
  requiredVariables: jsonb("required_variables").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  contentOverride: boolean("content_override").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [index("email_templates_active_idx").on(table.isArchived)]);
export type EmailTemplate = typeof emailTemplates.$inferSelect;

export const emailTemplateLinks = pgTable("email_template_links", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  url: text("url").notNull(),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const caseEmailMessages = pgTable("case_email_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  communicationLogId: varchar("communication_log_id").notNull().references(() => caseCommunicationLogs.id, { onDelete: "cascade" }),
  templateId: varchar("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  templateCode: text("template_code"),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  recipientKind: text("recipient_kind").notNull(),
  recipientUserId: varchar("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  includedBookingLink: boolean("included_booking_link").notNull().default(false),
  replyTokenHash: text("reply_token_hash").unique(),
  replyToEmail: text("reply_to_email"),
  gmailThreadId: text("gmail_thread_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("case_email_messages_gmail_thread_idx").on(table.gmailThreadId)]);
export type CaseEmailMessage = typeof caseEmailMessages.$inferSelect;

export const caseEmailAttachments = pgTable("case_email_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  emailMessageId: varchar("email_message_id").notNull().references(() => caseEmailMessages.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").notNull().references(() => caseDocuments.id, { onDelete: "restrict" }),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [index("case_email_attachments_message_idx").on(table.emailMessageId)]);

export const gmailCaseReplyAttachments = pgTable("gmail_case_reply_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gmailMessageId: varchar("gmail_message_id").notNull().references(() => gmailMessages.id, { onDelete: "cascade" }),
  caseEmailMessageId: varchar("case_email_message_id").notNull().references(() => caseEmailMessages.id, { onDelete: "cascade" }),
  caseDocumentId: varchar("case_document_id").references(() => caseDocuments.id, { onDelete: "set null" }),
  gmailAttachmentId: text("gmail_attachment_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  status: text("status").notNull().default("pending"),
  failureReason: text("failure_reason"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("gmail_case_reply_attachments_message_attachment_unique").on(table.gmailMessageId, table.gmailAttachmentId),
  index("gmail_case_reply_attachments_document_idx").on(table.caseDocumentId),
]);

export const gmailCaseReplyNotifications = pgTable("gmail_case_reply_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gmailMessageId: varchar("gmail_message_id").notNull().references(() => gmailMessages.id, { onDelete: "cascade" }),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationId: varchar("notification_id").references(() => notifications.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("gmail_case_reply_notifications_message_recipient_unique").on(table.gmailMessageId, table.recipientUserId),
]);

export const gmailReplySyncState = pgTable("gmail_reply_sync_state", {
  id: varchar("id").primaryKey(),
  checkpointAt: timestamp("checkpoint_at"),
  lastAttemptAt: timestamp("last_attempt_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const miamRecords = pgTable("miam_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  partyId: varchar("party_id").notNull(),
  caseId: varchar("case_id").notNull(),

  sessionMediator: text("session_mediator"),
  sessionDate: text("session_date"),
  sessionTime: text("session_time"),
  otherPeoplePresent: text("other_people_present"),
  caseReference: text("case_reference"),
  caseType: text("case_type"),

  clientName: text("client_name"),
  clientFirstName: text("client_first_name"),
  clientLastName: text("client_last_name"),
  clientDob: text("client_dob"),
  clientAddress: text("client_address"),
  clientPhone: text("client_phone"),
  howHeardAboutBfm: text("how_heard_about_bfm"),
  clientOccupation: text("client_occupation"),
  clientDisability: text("client_disability"),
  clientAccessibility: text("client_accessibility"),
  clientEthnicity: text("client_ethnicity"),
  clientReligiousCulturalNeeds: text("client_religious_cultural_needs"),
  clientNewPartner: text("client_new_partner"),

  introNotes: text("intro_notes"),
  introPurposeDiscussed: text("intro_purpose_discussed"),
  introConfidentialityExplained: text("intro_confidentiality_explained"),

  children: jsonb("children").default([]),

  otherClientName: text("other_client_name"),
  otherClientFirstName: text("other_client_first_name"),
  otherClientLastName: text("other_client_last_name"),
  otherClientDob: text("other_client_dob"),
  otherClientAddress: text("other_client_address"),
  otherClientPhone: text("other_client_phone"),
  otherClientEmail: text("other_client_email"),

  married: text("married"),
  dateOfMarriage: text("date_of_marriage"),
  livedTogether: text("lived_together"),
  dateOfCohabitation: text("date_of_cohabitation"),
  dateOfSeparation: text("date_of_separation"),
  bothParentsPr: text("both_parents_pr"),
  prIsIssue: text("pr_is_issue"),
  divorceStarted: text("divorce_started"),
  divorceStartedDate: text("divorce_started_date"),
  petitioner: text("petitioner"),
  decreeNisiDate: text("decree_nisi_date"),
  decreeAbsoluteDate: text("decree_absolute_date"),
  courtOrders: text("court_orders"),
  applicationsToCourtText: text("applications_to_court_text"),

  checklist: jsonb("checklist").default({}),

  backgroundNotes: text("background_notes"),
  bgWhatBringsYou: text("bg_what_brings_you"),
  bgLivingArrangements: text("bg_living_arrangements"),
  bgChildrenDetails: text("bg_children_details"),
  bgContactArrangements: text("bg_contact_arrangements"),

  welfareOfChildren: text("welfare_of_children"),
  welfareAgencyContacted: text("welfare_agency_contacted"),
  welfareAgencyName: text("welfare_agency_name"),
  welfareAgencyDate: text("welfare_agency_date"),
  welfareAgencyTime: text("welfare_agency_time"),
  welfareNotes: text("welfare_notes"),
  welfareChildrensServices: text("welfare_childrens_services"),
  welfareSafetyConcerns: text("welfare_safety_concerns"),
  welfareWitnessedConflict: text("welfare_witnessed_conflict"),
  welfareInjuriesBehaviouralChanges: text("welfare_injuries_behavioural_changes"),
  welfareSafeguardingPlans: text("welfare_safeguarding_plans"),

  childInclusiveExplained: text("child_inclusive_explained"),
  childInclusiveClientResponse: text("child_inclusive_client_response"),
  childInclusiveConfidentialityExplained: text("child_inclusive_confidentiality_explained"),
  childInclusiveNotes: text("child_inclusive_notes"),
  childInclusiveConsentAgreed: text("child_inclusive_consent_agreed"),

  domesticAbuseScreening: text("domestic_abuse_screening"),
  daHurtOrScared: text("da_hurt_or_scared"),
  daPoliceInvolved: text("da_police_involved"),
  daPhysical: text("da_physical"),
  daPowerControl: text("da_power_control"),
  daFeelSafe: text("da_feel_safe"),
  daFinancialControl: text("da_financial_control"),
  daPermissionToDecide: text("da_permission_to_decide"),
  daAfraidOfReaction: text("da_afraid_of_reaction"),
  domesticAbuseSafetyConclusions: text("domestic_abuse_safety_conclusions"),
  domesticAbuseSupportServices: jsonb("domestic_abuse_support_services").default([]),
  domesticAbuseSupportServicesOther: text("domestic_abuse_support_services_other"),
  domesticAbuseLegalAidInfo: text("domestic_abuse_legal_aid_info"),
  domesticAbuseNotes: text("domestic_abuse_notes"),

  emotionalReadiness: text("emotional_readiness"),
  erEqualBasis: text("er_equal_basis"),
  erChoosingFreely: text("er_choosing_freely"),
  erPressuredToAttend: text("er_pressured_to_attend"),
  erCanWithdraw: text("er_can_withdraw"),
  erSameRoom: text("er_same_room"),
  erCapacity: text("er_capacity"),
  safetyMeasuresDiscussed: text("safety_measures_discussed"),
  safetyMeasuresAgreed: text("safety_measures_agreed"),

  issuesForMediation: jsonb("issues_for_mediation").default({}),
  issuesOther: text("issues_other"),

  furtherInfoRequested: jsonb("further_info_requested").default({}),
  furtherInfoOther: text("further_info_other"),

  suitableForMediation: text("suitable_for_mediation"),
  suitabilityReasons: text("suitability_reasons"),
  nextSteps: text("next_steps"),
  mediationType: text("mediation_type"),
  timeline: text("timeline"),
  agreedWithClient: text("agreed_with_client"),
  ofsRequired: text("ofs_required"),
  mouRequired: text("mou_required"),
  statementOfChildArrangements: text("statement_of_child_arrangements"),
  ppcRequired: text("ppc_required"),
  ppcReason: jsonb("ppc_reason").default([]),
  ppcReasonOther: text("ppc_reason_other"),
  ppcDate: text("ppc_date"),
  ppcConsultantName: text("ppc_consultant_name"),
  ppcOutcomes: text("ppc_outcomes"),
  referralToCafcass: text("referral_to_cafcass"),
  referralToChildrenServices: text("referral_to_children_services"),
  referralToChildrenServicesDetails: text("referral_to_children_services_details"),
  referralFollowUpContact: text("referral_follow_up_contact"),
  feePerSession: text("fee_per_session"),
  totalEstimatedFee: text("total_estimated_fee"),
  mojVoucherApplied: text("moj_voucher_applied"),
  legalAidApplied: text("legal_aid_applied"),
  paymentMethod: text("payment_method"),
  followUpContactRequired: text("follow_up_contact_required"),

  approvalStatus: text("approval_status").default("draft"),
  submittedBy: varchar("submitted_by"),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),

  pendingPartyUserId: varchar("pending_party_user_id"),
  pendingPartyFirstName: text("pending_party_first_name"),
  pendingPartyLastName: text("pending_party_last_name"),
  pendingPartyEmail: text("pending_party_email"),
  supersededAt: timestamp("superseded_at"),
  supersededBy: varchar("superseded_by"),
  renewalOfMiamRecordId: varchar("renewal_of_miam_record_id"),
  renewalSequence: integer("renewal_sequence").notNull().default(0),

  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("miam_records_current_party_case_unique")
    .on(table.partyId, table.caseId)
    .where(sql`superseded_at IS NULL`),
]);

export const insertMiamRecordSchema = createInsertSchema(miamRecords).omit({
  id: true,
  createdAt: true,
});

export type MiamRecord = typeof miamRecords.$inferSelect;
export type InsertMiamRecord = z.infer<typeof insertMiamRecordSchema>;

export const miamEditRequests = pgTable("miam_edit_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  miamRecordId: varchar("miam_record_id").notNull(),
  caseId: varchar("case_id").notNull(),
  requestedBy: varchar("requested_by").notNull(),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  status: text("status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  proposedChanges: jsonb("proposed_changes").notNull().default({}),
  originalValues: jsonb("original_values").notNull().default({}),
  requestNote: text("request_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MiamEditRequest = typeof miamEditRequests.$inferSelect;
export type InsertMiamEditRequest = typeof miamEditRequests.$inferInsert;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<string, number>;
}

export const googleCalendarEvents = pgTable("google_calendar_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleEventId: text("google_event_id").notNull(),
  externalSeriesId: text("external_series_id"),
  organizerEmail: text("organizer_email"),
  title: text("title"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  isAllDay: boolean("is_all_day").notNull().default(false),
  attendees: jsonb("attendees").$type<Array<{ email: string; displayName?: string; responseStatus: string }>>().default([]),
  bfmAttendanceStatus: text("bfm_attendance_status"),
  isOrganiser: boolean("is_organiser").notNull().default(false),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
}, (t) => ({
  uniqueEvent: unique().on(t.mediatorId, t.googleEventId),
}));

export type GoogleCalendarEvent = typeof googleCalendarEvents.$inferSelect;
export type InsertGoogleCalendarEvent = typeof googleCalendarEvents.$inferInsert;

export const outlookCalendarEvents = pgTable("outlook_calendar_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  outlookEventId: text("outlook_event_id").notNull(),
  externalSeriesId: text("external_series_id"),
  organizerEmail: text("organizer_email"),
  title: text("title"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  isAllDay: boolean("is_all_day").notNull().default(false),
  attendees: jsonb("attendees").$type<Array<{ email: string; displayName?: string; responseStatus: string }>>().default([]),
  bfmAttendanceStatus: text("bfm_attendance_status"),
  isOrganiser: boolean("is_organiser").notNull().default(false),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
}, (t) => ({
  uniqueEvent: unique().on(t.mediatorId, t.outlookEventId),
}));

export type OutlookCalendarEvent = typeof outlookCalendarEvents.$inferSelect;
export type InsertOutlookCalendarEvent = typeof outlookCalendarEvents.$inferInsert;

// Singleton table holding OAuth tokens for the organisation-level
// info@brighterfuturemediation.co.uk Google Calendar. Used for the
// "client-side" leg of every booking so Google emails the calendar invite
// from info@ (with sendUpdates:"all") rather than from a mediator's mailbox,
// preventing client/mediator email leakage. Always exactly one row with
// id="bfm". Superadmin-managed via the Settings page.
export const bfmCalendarConnection = pgTable("bfm_calendar_connection", {
  id: varchar("id").primaryKey(),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleCalendarConnected: boolean("google_calendar_connected").notNull().default(false),
  googleCalendarEmail: text("google_calendar_email"),
  googleTokenExpiresAt: timestamp("google_token_expires_at"),
  googleScopeGranted: text("google_scope_granted"),
  lastHealthCheckAt: timestamp("last_health_check_at"),
  lastHealthCheckError: text("last_health_check_error"),
  connectedAt: timestamp("connected_at"),
  connectedByUserId: varchar("connected_by_user_id"),
  healthCheckAlertsEnabled: boolean("health_check_alerts_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BfmCalendarConnection = typeof bfmCalendarConnection.$inferSelect;
export type InsertBfmCalendarConnection = typeof bfmCalendarConnection.$inferInsert;

export const WHATSAPP_CONVERSATION_STATUSES = ["open", "closed", "blocked"] as const;
export const WHATSAPP_FLOW_TYPES = ["start", "new_enquiry", "existing_case", "manual"] as const;
export const WHATSAPP_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export const WHATSAPP_MESSAGE_TYPES = ["text", "interactive", "template", "image", "document", "audio", "video", "unknown"] as const;
export const WHATSAPP_MESSAGE_STATUSES = ["received", "queued", "sent", "delivered", "read", "failed"] as const;
export const WHATSAPP_ATTACHMENT_STATUSES = ["metadata_only", "downloaded", "blocked", "failed"] as const;
export const WHATSAPP_OUTBOX_STATUSES = ["pending", "sent", "failed", "cancelled"] as const;

export const whatsappContacts = pgTable("whatsapp_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull(),
  displayName: text("display_name"),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "set null" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "set null" }),
  enquiryId: varchar("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("whatsapp_contacts_phone_number_idx").on(table.phoneNumber),
  index("whatsapp_contacts_case_idx").on(table.caseId),
  index("whatsapp_contacts_enquiry_idx").on(table.enquiryId),
]);

export const whatsappConversations = pgTable("whatsapp_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => whatsappContacts.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"),
  flowType: text("flow_type").notNull().default("start"),
  automationState: text("automation_state").notNull().default("awaiting_menu"),
  automationPaused: boolean("automation_paused").notNull().default(false),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "set null" }),
  enquiryId: varchar("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  customerServiceWindowExpiresAt: timestamp("customer_service_window_expires_at"),
  lastInboundAt: timestamp("last_inbound_at"),
  lastOutboundAt: timestamp("last_outbound_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("whatsapp_conversations_contact_idx").on(table.contactId),
  index("whatsapp_conversations_status_idx").on(table.status),
  index("whatsapp_conversations_case_idx").on(table.caseId),
  index("whatsapp_conversations_enquiry_idx").on(table.enquiryId),
  index("whatsapp_conversations_window_idx").on(table.customerServiceWindowExpiresAt),
]);

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => whatsappConversations.id, { onDelete: "cascade" }),
  metaMessageId: text("meta_message_id"),
  direction: text("direction").notNull(),
  type: text("type").notNull().default("text"),
  body: text("body"),
  templateName: text("template_name"),
  status: text("status").notNull().default("received"),
  errorPayload: text("error_payload"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().default({}),
  sentByUserId: varchar("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "set null" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  clientId: varchar("client_id").references(() => clients.id, { onDelete: "set null" }),
  contentClassification: text("content_classification").notNull().default("ordinary"),
  caseAssignmentSource: text("case_assignment_source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("whatsapp_messages_meta_message_id_idx").on(table.metaMessageId).where(sql`${table.metaMessageId} IS NOT NULL`),
  index("whatsapp_messages_conversation_idx").on(table.conversationId),
  index("whatsapp_messages_created_at_idx").on(table.createdAt),
  index("whatsapp_messages_case_idx").on(table.caseId, table.createdAt),
  index("whatsapp_messages_party_idx").on(table.partyId, table.createdAt),
]);

export const whatsappOtps = pgTable("whatsapp_otps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => whatsappConversations.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  verifiedAt: timestamp("verified_at"),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("whatsapp_otps_conversation_idx").on(table.conversationId),
  index("whatsapp_otps_case_idx").on(table.caseId),
  index("whatsapp_otps_expires_idx").on(table.expiresAt),
]);

export const whatsappAttachments = pgTable("whatsapp_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => whatsappMessages.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "set null" }),
  metaMediaId: text("meta_media_id").notNull(),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  storageUrl: text("storage_url"),
  status: text("status").notNull().default("metadata_only"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("whatsapp_attachments_message_idx").on(table.messageId),
  index("whatsapp_attachments_case_idx").on(table.caseId),
  index("whatsapp_attachments_meta_media_idx").on(table.metaMediaId),
]);

export const whatsappOutbox = pgTable("whatsapp_outbox", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => whatsappConversations.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("whatsapp_outbox_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
  index("whatsapp_outbox_conversation_idx").on(table.conversationId),
]);

export const CASE_PRIVATE_NOTE_STATUSES = ["draft", "completed", "cancelled"] as const;
export const CASE_PRIVATE_NOTE_AUTHOR_KINDS = ["party", "user"] as const;
export const PRIVATE_NOTE_ATTACHMENT_STATUSES = ["queued", "downloading", "quarantined", "scanning", "clean", "blocked", "failed", "redacted"] as const;

export const casePrivateNotes = pgTable("case_private_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  sourceConversationId: varchar("source_conversation_id").references(() => whatsappConversations.id, { onDelete: "set null" }),
  authorKind: text("author_kind").notNull(),
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),
  authorPartyId: varchar("author_party_id").references(() => parties.id, { onDelete: "set null" }),
  authorRoleSnapshot: text("author_role_snapshot").notNull(),
  authorNameSnapshot: text("author_name_snapshot").notNull(),
  body: text("body"),
  status: text("status").notNull().default("draft"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  textRedactedAt: timestamp("text_redacted_at"),
  textRedactedBy: varchar("text_redacted_by").references(() => users.id, { onDelete: "set null" }),
  textRedactionReason: text("text_redaction_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("case_private_notes_case_idx").on(table.caseId, table.createdAt),
  index("case_private_notes_party_idx").on(table.authorPartyId, table.createdAt),
  index("case_private_notes_user_idx").on(table.authorUserId, table.createdAt),
]);

export const casePrivateNoteAttachments = pgTable("case_private_note_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  noteId: varchar("note_id").notNull().references(() => casePrivateNotes.id, { onDelete: "cascade" }),
  sourceWhatsappAttachmentId: varchar("source_whatsapp_attachment_id").references(() => whatsappAttachments.id, { onDelete: "set null" }),
  sourceMessageId: varchar("source_message_id").references(() => whatsappMessages.id, { onDelete: "set null" }),
  metaMediaId: text("meta_media_id"),
  fileName: text("file_name"),
  declaredMimeType: text("declared_mime_type"),
  detectedMimeType: text("detected_mime_type"),
  sizeBytes: integer("size_bytes"),
  storageKey: text("storage_key"),
  status: text("status").notNull().default("queued"),
  retryCount: integer("retry_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
  lastError: text("last_error"),
  redactedAt: timestamp("redacted_at"),
  redactedBy: varchar("redacted_by").references(() => users.id, { onDelete: "set null" }),
  redactionReason: text("redaction_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("case_private_note_attachments_source_unique").on(table.sourceMessageId).where(sql`${table.sourceMessageId} IS NOT NULL`),
  index("case_private_note_attachments_note_idx").on(table.noteId),
  index("case_private_note_attachments_work_idx").on(table.status, table.nextAttemptAt),
]);

export const whatsappPrivateNoteSessions = pgTable("whatsapp_private_note_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => whatsappConversations.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").references(() => parties.id, { onDelete: "set null" }),
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),
  noteId: varchar("note_id").references(() => casePrivateNotes.id, { onDelete: "set null" }),
  otpId: varchar("otp_id").references(() => whatsappOtps.id, { onDelete: "set null" }),
  state: text("state").notNull().default("awaiting_case_reference"),
  caseReferenceInput: text("case_reference_input"),
  identityEmailHash: text("identity_email_hash"),
  lookupAttemptCount: integer("lookup_attempt_count").notNull().default(0),
  verifiedAt: timestamp("verified_at"),
  expiresAt: timestamp("expires_at").notNull(),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("whatsapp_private_note_sessions_conversation_idx").on(table.conversationId, table.createdAt),
  index("whatsapp_private_note_sessions_expiry_idx").on(table.expiresAt),
  uniqueIndex("whatsapp_private_note_sessions_one_active_idx").on(table.conversationId).where(sql`${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL`),
]);

export const partyWhatsappPreferences = pgTable("party_whatsapp_preferences", {
  partyId: varchar("party_id").primaryKey().references(() => parties.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("unknown"),
  source: text("source"),
  recordedBy: varchar("recorded_by").references(() => users.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappTemplateCatalog = pgTable("whatsapp_template_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  metaTemplateId: text("meta_template_id").notNull(),
  name: text("name").notNull(),
  language: text("language").notNull(),
  category: text("category"),
  status: text("status").notNull(),
  components: jsonb("components").$type<Array<Record<string, unknown>>>().notNull().default([]),
  parameterDefinitions: jsonb("parameter_definitions").$type<Array<Record<string, unknown>>>().notNull().default([]),
  headerMediaType: text("header_media_type"),
  lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("whatsapp_template_catalog_name_language_unique").on(table.name, table.language),
  index("whatsapp_template_catalog_status_idx").on(table.status),
]);

export const whatsappOutboundMedia = pgTable("whatsapp_outbound_media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  partyId: varchar("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").references(() => whatsappConversations.id, { onDelete: "set null" }),
  sourceType: text("source_type").notNull(),
  sourceDocumentId: varchar("source_document_id").references(() => caseDocuments.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key"),
  metaMediaId: text("meta_media_id"),
  status: text("status").notNull().default("queued"),
  retryCount: integer("retry_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  processingLeaseExpiresAt: timestamp("processing_lease_expires_at"),
  lastError: text("last_error"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("whatsapp_outbound_media_case_idx").on(table.caseId, table.createdAt),
  index("whatsapp_outbound_media_work_idx").on(table.status, table.nextAttemptAt),
]);

export type WhatsappContact = typeof whatsappContacts.$inferSelect;
export type InsertWhatsappContact = typeof whatsappContacts.$inferInsert;
export type WhatsappConversation = typeof whatsappConversations.$inferSelect;
export type InsertWhatsappConversation = typeof whatsappConversations.$inferInsert;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type InsertWhatsappMessage = typeof whatsappMessages.$inferInsert;
export type WhatsappOtp = typeof whatsappOtps.$inferSelect;
export type InsertWhatsappOtp = typeof whatsappOtps.$inferInsert;
export type WhatsappAttachment = typeof whatsappAttachments.$inferSelect;
export type InsertWhatsappAttachment = typeof whatsappAttachments.$inferInsert;
export type WhatsappOutbox = typeof whatsappOutbox.$inferSelect;
export type InsertWhatsappOutbox = typeof whatsappOutbox.$inferInsert;
export type CasePrivateNote = typeof casePrivateNotes.$inferSelect;
export type CasePrivateNoteAttachment = typeof casePrivateNoteAttachments.$inferSelect;
export type WhatsappPrivateNoteSession = typeof whatsappPrivateNoteSessions.$inferSelect;
export type PartyWhatsappPreference = typeof partyWhatsappPreferences.$inferSelect;
export type WhatsappTemplateCatalogEntry = typeof whatsappTemplateCatalog.$inferSelect;
export type WhatsappOutboundMedia = typeof whatsappOutboundMedia.$inferSelect;

export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  followUpFilter?: "due_today" | "overdue" | "unclaimed" | "safeguarding";
}

// =====================================================================
// Task #163 — Cases List Advanced Filtering
// =====================================================================

export const MEDIATION_CATEGORIES = ["Family", "Workplace", "Civil", "Commercial", "Other"] as const;
export type MediationCategory = (typeof MEDIATION_CATEGORIES)[number];

export const CIVIL_CASE_SUBTYPES = [
  "Neighbour dispute",
  "Landlord & tenant",
  "Consumer dispute",
  "Personal injury",
  "Other",
] as const;

export const COMMERCIAL_CASE_SUBTYPES = [
  "Contract dispute",
  "Partnership dispute",
  "Shareholder dispute",
  "Supplier or customer dispute",
  "Intellectual property",
  "Other",
] as const;

export const OTHER_CASE_SUBTYPES = [
  "Community",
  "Educational",
  "SEND",
  "Restorative",
  "Coaching individual",
  "Coaching couple",
  "Coaching team",
  "Other",
] as const;

export const FUNDING_SOURCES = [
  "Self-funded",
  "Legal Aid",
  "MOJ Voucher",
  "Insurance",
  "Employer-funded",
  "Other",
] as const;

export const CASE_STATUSES = ["Active", "On hold", "Closed", "Archived"] as const;

export const caseFiltersSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  statuses: z.array(z.string()).max(10).optional(),
  stages: z.array(z.string()).max(40).optional(),
  mediationCategories: z.array(z.enum(MEDIATION_CATEGORIES)).max(10).optional(),
  familySubTypes: z.array(z.string()).max(20).optional(),
  workplaceSubTypes: z.array(z.string()).max(20).optional(),
  civilSubTypes: z.array(z.string()).max(20).optional(),
  commercialSubTypes: z.array(z.string()).max(20).optional(),
  otherSubTypes: z.array(z.string()).max(20).optional(),
  assignedMediatorIds: z.array(z.string().min(1)).max(50).optional(),
  miamMediatorIds: z.array(z.string().min(1)).max(50).optional(),
  fundingSources: z.array(z.string()).max(20).optional(),
  voucherStatuses: z.array(z.string()).max(20).optional(),
  inCourtStatuses: z.array(z.string()).max(20).optional(),
  cafcassStatuses: z.array(z.string()).max(20).optional(),
  cimEligible: z.boolean().optional(),
  enquiryDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  enquiryDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  miamCompletedDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  miamCompletedDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closureDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closureDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export type CaseFilters = z.infer<typeof caseFiltersSchema>;

export const caseFilterPresets = pgTable("case_filter_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userNameUnique: unique("case_filter_presets_user_name_unique").on(t.userId, t.name),
  oneDefaultPerUser: uniqueIndex("case_filter_presets_one_default_per_user")
    .on(t.userId)
    .where(sql`is_default = true`),
}));

export const insertCaseFilterPresetSchema = createInsertSchema(caseFilterPresets).pick({
  name: true,
  filters: true,
  isDefault: true,
}).extend({
  name: z.string().trim().min(1, "Name is required").max(80),
  filters: caseFiltersSchema,
  isDefault: z.boolean().optional().default(false),
});

export type CaseFilterPreset = typeof caseFilterPresets.$inferSelect;
export type InsertCaseFilterPreset = z.infer<typeof insertCaseFilterPresetSchema>;

// =====================================================================
// Task #171 — Mediator Profile & Compliance Hub
// =====================================================================

export const FMC_ACCREDITATION_STATUSES = ["Fully Accredited", "WTA", "Not applicable"] as const;
export const PANEL_STATUSES = ["Active", "Paused", "Inactive", "Off-boarded"] as const;
export const ENGAGEMENT_TYPES = ["Self-employed contractor", "Time-bank pilot", "Employed", "Volunteer", "Other"] as const;
export const BIO_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export const MEDIATOR_CONSENT_TYPES = ["name_bio", "photo", "edi_aggregate"] as const;
export const TRAINING_TYPES = ["Initial", "Workplace", "Civil", "Commercial", "Refresher", "Other"] as const;
// Task #222 — per-type availability vocabulary for the Section D solo / co
// matrix. Stored on `mediator_profiles.solo_co_matrix` as `{ type → option }`.
export const SOLO_CO_OPTIONS = ["Solo", "Conditional", "Not available", "By request"] as const;
export const REFERENCE_STATUSES = ["pending", "requested", "received", "verified", "failed"] as const;
export const TIMEBANK_ENTRY_TYPES = ["earned", "used"] as const;
// Task #222 — canonical court-form vocabulary per BFM Section D spec.
// Legacy `Form C100` rows are auto-normalized to `C100` at read time in
// `mediatorProfileService.getView` so historical data stays editable
// without exposing the legacy label in the picker.
export const COURT_FORM_PACKAGES = ["Form A", "C100", "FM1", "None"] as const;

// Task #222 — canonical specialism vocabulary per BFM spec. Mediators can
// also self-add bespoke specialisms via the "+ Add" input in the UI.
export const MEDIATOR_SPECIALISMS = [
  "Hybrid",
  "Shuttle",
  "Online-only",
  "Vulnerable parties",
  "LGBTQ+",
  "Faith-sensitive",
  "Trauma-informed",
  "Children's voice",
  "High-conflict",
  "SEND",
  "Domestic abuse aware",
  "Other",
] as const;

// Task #222 — geographic coverage presets. UK regions + online/anywhere.
// Stored as a string[] in `geographic_coverage_areas`; admins may also
// retain free-text in the legacy `geographic_coverage` field.
export const GEOGRAPHIC_COVERAGE_PRESETS = [
  "Online only",
  "Anywhere",
  "England — North East",
  "England — North West",
  "England — Yorkshire & Humber",
  "England — East Midlands",
  "England — West Midlands",
  "England — East of England",
  "England — London",
  "England — South East",
  "England — South West",
  "Scotland",
  "Wales",
  "Northern Ireland",
  "Channel Islands",
  "Isle of Man",
] as const;
export const SEX_OPTIONS = ["Female", "Male", "Intersex", "Prefer not to say"] as const;
export const RELIGION_OPTIONS = [
  "No religion", "Christian", "Buddhist", "Hindu", "Jewish",
  "Muslim", "Sikh", "Other", "Prefer not to say",
] as const;
export const SEXUAL_ORIENTATION_OPTIONS = [
  "Heterosexual or straight", "Gay or lesbian", "Bisexual",
  "Other", "Prefer not to say",
] as const;

export const mediatorProfiles = pgTable("mediator_profiles", {
  userId: varchar("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),

  // Section A — Personal identity
  firstName: text("first_name"),
  middleName: text("middle_name"),
  lastName: text("last_name"),
  preferredDisplayName: text("preferred_display_name"),
  dateOfBirth: text("date_of_birth"),                 // superadmin-only
  profilePhotoUrl: text("profile_photo_url"),
  profilePhotoApproved: boolean("profile_photo_approved").default(false),
  mobilePhone: text("mobile_phone"),
  mobilePhoneCode: text("mobile_phone_code").default("+44"),
  additionalPhone: text("additional_phone"),
  additionalPhoneCode: text("additional_phone_code").default("+44"),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  city: text("city"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  nextOfKinName: text("next_of_kin_name"),            // superadmin-only
  nextOfKinPhone: text("next_of_kin_phone"),          // superadmin-only
  nextOfKinRelationship: text("next_of_kin_relationship"), // superadmin-only

  // Section B — EDI (superadmin-only; subadmin sees aggregate only)
  ediSex: text("edi_sex"),
  ediGenderIdentity: text("edi_gender_identity"),
  ediGenderSelfDescribe: text("edi_gender_self_describe"),
  ediEthnicity: text("edi_ethnicity"),
  ediEthnicitySelfDescribe: text("edi_ethnicity_self_describe"),
  ediDisability: jsonb("edi_disability").$type<string[]>().default([]),
  ediDisabilityDetails: text("edi_disability_details"),
  ediFirstLanguage: text("edi_first_language"),
  ediCountryOfBirth: text("edi_country_of_birth"),
  ediReligion: text("edi_religion"),
  ediSexualOrientation: text("edi_sexual_orientation"),

  // Section C — Credentials & insurance
  fmcUrn: text("fmc_urn"),
  fmcAccreditationStatus: text("fmc_accreditation_status"),
  fmcAccreditationDate: text("fmc_accreditation_date"),
  cmcRegNumber: text("cmc_reg_number"),
  otherRegulatorName: text("other_regulator_name"),
  otherRegulatorNumber: text("other_regulator_number"),
  higherQualifications: text("higher_qualifications"),
  piProvider: text("pi_provider"),
  piPolicyNumber: text("pi_policy_number"),
  piCoverAmount: text("pi_cover_amount"),
  piExpiryDate: text("pi_expiry_date"),
  piCertificateUrl: text("pi_certificate_url"),
  icoRegistration: text("ico_registration"),
  icoExpiryDate: text("ico_expiry_date"),
  dbsLevel: text("dbs_level"),
  dbsCertNumber: text("dbs_cert_number"),
  dbsIssueDate: text("dbs_issue_date"),
  dbsCertificateUrl: text("dbs_certificate_url"),
  ppcSupervisorName: text("ppc_supervisor_name"),
  ppcSupervisorOrg: text("ppc_supervisor_org"),
  ppcSupervisorEmail: text("ppc_supervisor_email"),
  ppcSupervisorPhone: text("ppc_supervisor_phone"),
  ppcSupervisorLastSignoff: text("ppc_supervisor_last_signoff"),
  ppcSupervisorNextReview: text("ppc_supervisor_next_review"),
  practisesAtFirms: jsonb("practises_at_firms").$type<string[]>().default([]),

  // Section D — Service offering
  mediationRoleQualification: text("mediation_role_qualification").notNull().default("unclassified"),
  mediationTypes: jsonb("mediation_types").$type<string[]>().default([]),
  familySubTypes: jsonb("family_sub_types").$type<string[]>().default([]),
  workplaceSubTypes: jsonb("workplace_sub_types").$type<string[]>().default([]),
  civilSubTypes: jsonb("civil_sub_types").$type<string[]>().default([]),
  commercialSubTypes: jsonb("commercial_sub_types").$type<string[]>().default([]),
  otherSubTypes: jsonb("other_sub_types").$type<string[]>().default([]),
  specialisms: jsonb("specialisms").$type<string[]>().default([]),
  courtFormPackages: jsonb("court_form_packages").$type<string[]>().default([]),
  mojVoucherEligible: boolean("moj_voucher_eligible").default(false),
  soloCoMatrix: jsonb("solo_co_matrix").$type<Record<string, string>>().default({}),
  canSuperviseWtas: boolean("can_supervise_wtas").default(false),
  coMediationCap: integer("co_mediation_cap").default(1),
  highConflictOptIn: boolean("high_conflict_opt_in").default(false),
  safeguardingFlaggedOptIn: boolean("safeguarding_flagged_opt_in").default(false),
  geographicCoverage: text("geographic_coverage"),
  // Task #222 — structured multi-select coverage (presets + bespoke).
  // Coexists with the legacy `geographic_coverage` text field for back-compat.
  geographicCoverageAreas: jsonb("geographic_coverage_areas").$type<string[]>().default([]),

  // Section E — Bio (current published copy + workflow state)
  bioStatus: text("bio_status").default("draft"),
  bioLong: text("bio_long"),
  bioShort: text("bio_short"),
  bioApprovedVersionId: varchar("bio_approved_version_id"),
  bioApprovedAt: timestamp("bio_approved_at"),
  speaksOtherLanguages: boolean("speaks_other_languages").default(false),
  languagesSpoken: jsonb("languages_spoken").$type<string[]>().default([]),
  // Auto-derived bio metadata (populated by mediatorProfileService.updateProfile
  // whenever credentials / service offering / EDI language fields change).
  bioAutoTags: jsonb("bio_auto_tags").$type<string[]>().default([]),
  bioYearsOfExperience: integer("bio_years_of_experience"),
  hasSpecificSkills: boolean("has_specific_skills").default(false),
  specificSkills: jsonb("specific_skills").$type<string[]>().default([]),

  // Section F — Availability
  workingDays: jsonb("working_days").$type<string[]>().default([]),
  workingHoursStart: text("working_hours_start"),
  workingHoursEnd: text("working_hours_end"),
  // Task #226 — per-day working hours (excl. lunch). Replaces the global
  // start/end pair in the UI; the service mirrors the first day back into
  // the legacy columns so the booking engine keeps working unchanged.
  workingHoursByDay: jsonb("working_hours_by_day").$type<Record<string, {
    start: string; end: string; lunchStart?: string | null; lunchEnd?: string | null;
  }>>().default({}),
  hoursPerWeekCap: integer("hours_per_week_cap"),

  // Section G — Contracts & engagement
  engagementType: text("engagement_type"),
  contractVersion: text("contract_version"),
  contractSignedDate: text("contract_signed_date"),
  contractFileUrl: text("contract_file_url"),
  timebankAgreement: boolean("timebank_agreement").default(false),
  timebankSignedDate: text("timebank_signed_date"),
  timebankHoursPerWeek: integer("timebank_hours_per_week"),
  timebankCheckinDay: text("timebank_checkin_day"),
  timebankCheckinTime: text("timebank_checkin_time"),
  timebankHoursCap: integer("timebank_hours_cap"),
  timebankPilotStart: text("timebank_pilot_start"),
  timebankReviewDate: text("timebank_review_date"),
  onboardingComplete: boolean("onboarding_complete").default(false),
  panelStatus: text("panel_status").default("Active"),
  panelStatusReason: text("panel_status_reason"),
  offboardingDate: text("offboarding_date"),
  offboardingReason: text("offboarding_reason"),

  // Section H — Payment (superadmin-only)
  bankSortCode: text("bank_sort_code"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountName: text("bank_account_name"),
  vatRegistered: boolean("vat_registered").default(false),
  vatNumber: text("vat_number"),
  selfBillingAgreement: boolean("self_billing_agreement").default(false),
  selfBillingSignedDate: text("self_billing_signed_date"),
  utr: text("utr"),
  paymentTerms: integer("payment_terms").default(30),

  // Section I — Compliance & ongoing
  safeguardingTrainingDate: text("safeguarding_training_date"),
  safeguardingProvider: text("safeguarding_provider"),
  safeguardingCertUrl: text("safeguarding_cert_url"),
  safeguardingRefresherDue: text("safeguarding_refresher_due"),
  confidentialitySignedDate: text("confidentiality_signed_date"),
  gdprTrainingDate: text("gdpr_training_date"),
  annualReviewLast: text("annual_review_last"),
  annualReviewNext: text("annual_review_next"),
  annualReviewOutcome: text("annual_review_outcome"),

  // Task #185 — pipeline lifecycle stage for converted mediators (cols 4-7)
  lifecycleStage: text("lifecycle_stage"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MediatorProfile = typeof mediatorProfiles.$inferSelect;
export type InsertMediatorProfile = typeof mediatorProfiles.$inferInsert;

export const mediatorProfileChangeRequests = pgTable("mediator_profile_change_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  proposedValue: jsonb("proposed_value").$type<unknown>(),
  status: text("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
}, (table) => [index("mediator_profile_change_requests_mediator_idx").on(table.mediatorId)]);
export type MediatorProfileChangeRequest = typeof mediatorProfileChangeRequests.$inferSelect;

// Child tables — multi-row composites
export const mediatorCpdEntries = pgTable("mediator_cpd_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  activity: text("activity").notNull(),
  hours: text("hours"),
  evidenceUrl: text("evidence_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_cpd_mediator_idx").on(t.mediatorId)]);
export type MediatorCpdEntry = typeof mediatorCpdEntries.$inferSelect;
export type InsertMediatorCpdEntry = typeof mediatorCpdEntries.$inferInsert;

export const mediatorReferences = pgTable("mediator_references", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role"),
  organisation: text("organisation"),
  email: text("email"),
  phone: text("phone"),
  dateChecked: text("date_checked"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  verifiedBy: varchar("verified_by").references(() => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_references_mediator_idx").on(t.mediatorId)]);
export type MediatorReference = typeof mediatorReferences.$inferSelect;
export type InsertMediatorReference = typeof mediatorReferences.$inferInsert;

export const mediatorTrainings = pgTable("mediator_trainings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider"),
  date: text("date"),
  certName: text("cert_name"),
  certUrl: text("cert_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_trainings_mediator_idx").on(t.mediatorId)]);
export type MediatorTraining = typeof mediatorTrainings.$inferSelect;
export type InsertMediatorTraining = typeof mediatorTrainings.$inferInsert;

export const mediatorHolidays = pgTable("mediator_holidays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_holidays_mediator_idx").on(t.mediatorId)]);
export type MediatorHoliday = typeof mediatorHolidays.$inferSelect;
export type InsertMediatorHoliday = typeof mediatorHolidays.$inferInsert;

export const mediatorComplaints = pgTable("mediator_complaints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  caseId: varchar("case_id"),
  summary: text("summary"),
  outcome: text("outcome"),
  signOff: text("sign_off"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_complaints_mediator_idx").on(t.mediatorId)]);
export type MediatorComplaint = typeof mediatorComplaints.$inferSelect;
export type InsertMediatorComplaint = typeof mediatorComplaints.$inferInsert;

export const mediatorTimebankEntries = pgTable("mediator_timebank_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  activity: text("activity").notNull(),
  hours: text("hours").notNull(),
  type: text("type").notNull(),                       // earned | used
  approvedByMargaret: boolean("approved_by_margaret").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_timebank_mediator_idx").on(t.mediatorId)]);
export type MediatorTimebankEntry = typeof mediatorTimebankEntries.$inferSelect;
export type InsertMediatorTimebankEntry = typeof mediatorTimebankEntries.$inferInsert;

export const mediatorConsents = pgTable("mediator_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  consentType: text("consent_type").notNull(),       // MEDIATOR_CONSENT_TYPES
  granted: boolean("granted").notNull().default(false),
  grantedAt: timestamp("granted_at"),
  withdrawnAt: timestamp("withdrawn_at"),
  notes: text("notes"),
}, (t) => [
  index("mediator_consents_mediator_idx").on(t.mediatorId),
  unique("mediator_consents_mediator_type_unique").on(t.mediatorId, t.consentType),
]);
export type MediatorConsent = typeof mediatorConsents.$inferSelect;
export type InsertMediatorConsent = typeof mediatorConsents.$inferInsert;

export const mediatorBioVersions = pgTable("mediator_bio_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mediatorId: varchar("mediator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  bioLong: text("bio_long"),
  bioShort: text("bio_short"),
  status: text("status").notNull().default("draft"),  // BIO_STATUSES
  submittedBy: varchar("submitted_by"),
  submittedAt: timestamp("submitted_at"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("mediator_bio_versions_mediator_idx").on(t.mediatorId)]);
export type MediatorBioVersion = typeof mediatorBioVersions.$inferSelect;
export type InsertMediatorBioVersion = typeof mediatorBioVersions.$inferInsert;

// =====================================================================
// Task #175 — Mediator Lifecycle: Applicants pipeline
// =====================================================================
export const MEDIATOR_APPLICANT_STAGES = [
  "recruitment_approach",
  "interview",
  "reference_credential_check",
  "contract_issued",
  "onboarded",
  "rejected",
] as const;
export type MediatorApplicantStage = (typeof MEDIATOR_APPLICANT_STAGES)[number];

// Task #185 — full mediator pipeline (applicant + mediator combined Kanban).
// The applicant table covers the first three columns; `mediatorProfiles.lifecycleStage`
// covers columns 4-7 (post-conversion lifecycle).
export const MEDIATOR_LIFECYCLE_STAGES = [
  "recruitment_approach",
  "interview",
  "reference_credential_check",
  "contract_issued",
  "onboarding_portal_access",
  "active_on_panel",
  "annual_review",
  "off_boarded",
] as const;
export type MediatorLifecycleStage = (typeof MEDIATOR_LIFECYCLE_STAGES)[number];

export const MEDIATOR_PROFILE_LIFECYCLE_STAGES = [
  "onboarding_portal_access",
  "active_on_panel",
  "annual_review",
  "off_boarded",
] as const;
export type MediatorProfileLifecycleStage = (typeof MEDIATOR_PROFILE_LIFECYCLE_STAGES)[number];

export const mediatorApplicants = pgTable("mediator_applicants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  source: text("source"),
  notes: text("notes"),
  // Recruitment-specific fields captured during screening — surfaced on the
  // applicants table and carried through into the eventual mediator record.
  accreditationStatus: text("accreditation_status"),  // e.g. FMC accredited / Working towards / Not yet
  areaOfPractice: text("area_of_practice").array(),   // e.g. ["Family mediation session", "Workplace"]
  stage: text("stage").notNull().default("recruitment_approach"),
  rejectedReason: text("rejected_reason"),
  convertedUserId: varchar("converted_user_id").references(() => users.id, { onDelete: "set null" }),
  convertedAt: timestamp("converted_at"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Task #208 — Contract & registrations captured at the "Contract issued"
  // stage. All optional; carried into mediator_profiles Section G + ICO
  // columns on conversion (only when populated).
  engagementType: text("engagement_type"),                // "wta" | "accredited" (freelance mediator agreement variant)
  contractVersion: text("contract_version"),
  contractSignedDate: text("contract_signed_date"),
  contractFileUrl: text("contract_file_url"),
  timebankAgreement: boolean("timebank_agreement").default(false),
  timebankSignedDate: text("timebank_signed_date"),
  timebankHoursPerWeek: integer("timebank_hours_per_week"),
  timebankCheckinDay: text("timebank_checkin_day"),       // e.g. "monday"
  timebankCheckinTime: text("timebank_checkin_time"),     // "HH:MM"
  timebankFileUrl: text("timebank_file_url"),
  // Task #244 — credentials captured through the public update link before
  // conversion, then carried into the mediator profile on onboarding.
  fmcUrn: text("fmc_urn"),
  fmcAccreditationStatus: text("fmc_accreditation_status"),
  fmcAccreditationDate: text("fmc_accreditation_date"),
  cmcRegNumber: text("cmc_reg_number"),
  otherRegulatorName: text("other_regulator_name"),
  otherRegulatorNumber: text("other_regulator_number"),
  higherQualifications: text("higher_qualifications"),
  piProvider: text("pi_provider"),
  piPolicyNumber: text("pi_policy_number"),
  piCoverAmount: text("pi_cover_amount"),
  piExpiryDate: text("pi_expiry_date"),
  piCertificateUrl: text("pi_certificate_url"),
  icoRegistration: text("ico_registration"),
  icoExpiryDate: text("ico_expiry_date"),
  icoEvidenceUrl: text("ico_evidence_url"),
  dbsLevel: text("dbs_level"),
  dbsCertNumber: text("dbs_cert_number"),
  dbsIssueDate: text("dbs_issue_date"),
  dbsCertificateUrl: text("dbs_certificate_url"),
  ppcSupervisorName: text("ppc_supervisor_name"),
  ppcSupervisorOrg: text("ppc_supervisor_org"),
  ppcSupervisorEmail: text("ppc_supervisor_email"),
  ppcSupervisorPhone: text("ppc_supervisor_phone"),
  ppcSupervisorLastSignoff: text("ppc_supervisor_last_signoff"),
  ppcSupervisorNextReview: text("ppc_supervisor_next_review"),
  // Task #244 — applicant-initiated form update token (one-time, 7-day expiry)
  updateToken: text("update_token"),
  updateTokenExpiresAt: timestamp("update_token_expires_at"),
  updateTokenUsedAt: timestamp("update_token_used_at"),
  updateTokenPurpose: text("update_token_purpose"),
}, (t) => [
  index("mediator_applicants_stage_idx").on(t.stage),
  index("mediator_applicants_email_idx").on(t.email),
]);
export type MediatorApplicant = typeof mediatorApplicants.$inferSelect;
export type InsertMediatorApplicant = typeof mediatorApplicants.$inferInsert;

export const insertMediatorApplicantSchema = createInsertSchema(mediatorApplicants, {
  email: (s) => s.email("Please enter a valid email"),
  firstName: (s) => s.min(1, "First name is required"),
  lastName: (s) => s.min(1, "Last name is required"),
}).omit({
  id: true,
  convertedUserId: true,
  convertedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

// Task #208 — Contract & registrations PATCH payload. All fields optional;
// nulls clear the column. engagementType is constrained to the two
// freelance mediator agreement variants.
export const APPLICANT_ENGAGEMENT_TYPES = ["wta", "accredited"] as const;
export type ApplicantEngagementType = (typeof APPLICANT_ENGAGEMENT_TYPES)[number];
export const applicantContractPatchSchema = z.object({
  engagementType: z.enum(APPLICANT_ENGAGEMENT_TYPES).nullable().optional(),
  contractVersion: z.string().nullable().optional(),
  contractSignedDate: z.string().nullable().optional(),
  contractFileUrl: z.string().nullable().optional(),
  timebankAgreement: z.boolean().nullable().optional(),
  timebankSignedDate: z.string().nullable().optional(),
  timebankHoursPerWeek: z.number().int().min(0).max(80).nullable().optional(),
  timebankCheckinDay: z.string().nullable().optional(),
  timebankCheckinTime: z.string().nullable().optional(),
  timebankFileUrl: z.string().nullable().optional(),
  icoRegistration: z.string().nullable().optional(),
  icoExpiryDate: z.string().nullable().optional(),
  icoEvidenceUrl: z.string().nullable().optional(),
}).strict();
export type ApplicantContractPatch = z.infer<typeof applicantContractPatchSchema>;

// =====================================================================
// Task #207 — Reference & Credential Check workflow at applicant stage
// =====================================================================
export const APPLICANT_CHECK_KINDS = ["fmc_cmc", "other_regulator", "pi_insurance", "dbs", "ppc_supervision"] as const;
export type ApplicantCheckKind = (typeof APPLICANT_CHECK_KINDS)[number];
export const APPLICANT_CHECK_STATUSES = ["pending", "verified", "failed"] as const;
export type ApplicantCheckStatus = (typeof APPLICANT_CHECK_STATUSES)[number];

export const mediatorApplicantChecks = pgTable("mediator_applicant_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  applicantId: varchar("applicant_id").notNull().references(() => mediatorApplicants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  referenceNumber: text("reference_number"),
  provider: text("provider"),
  issuedAt: text("issued_at"),
  expiresAt: text("expires_at"),
  evidenceUrl: text("evidence_url"),
  notes: text("notes"),
  ppcSupervisorName: text("ppc_supervisor_name"),
  ppcSupervisorOrg: text("ppc_supervisor_org"),
  ppcSupervisorEmail: text("ppc_supervisor_email"),
  ppcSupervisorPhone: text("ppc_supervisor_phone"),
  ppcSupervisorLastSignoff: text("ppc_supervisor_last_signoff"),
  ppcSupervisorNextReview: text("ppc_supervisor_next_review"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  requestedBy: varchar("requested_by").references(() => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: varchar("verified_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("mediator_applicant_checks_applicant_kind_uniq").on(t.applicantId, t.kind),
]);
export type MediatorApplicantCheck = typeof mediatorApplicantChecks.$inferSelect;
export type InsertMediatorApplicantCheck = typeof mediatorApplicantChecks.$inferInsert;
export const insertMediatorApplicantCheckSchema = createInsertSchema(mediatorApplicantChecks).omit({
  id: true,
  requestedAt: true,
  requestedBy: true,
  verifiedAt: true,
  verifiedBy: true,
});

// Task #260 — Per-service approval workflow for mediator applicants and live
// mediators. One row represents one service / case-type approval attempt with
// proof, expiry, and staff review metadata.
export const MEDIATOR_SERVICE_APPROVAL_STATUSES = [
  "requested",
  "pending_review",
  "approved",
  "rejected",
  "expired",
  "revoked",
] as const;
export type MediatorServiceApprovalStatus = (typeof MEDIATOR_SERVICE_APPROVAL_STATUSES)[number];

export const mediatorServiceApprovals = pgTable("mediator_service_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  applicantId: varchar("applicant_id").references(() => mediatorApplicants.id, { onDelete: "cascade" }),
  mediatorId: varchar("mediator_id").references(() => users.id, { onDelete: "cascade" }),
  serviceTypeId: varchar("service_type_id").notNull().references(() => serviceTypes.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("requested"),
  proofFileName: text("proof_file_name"),
  proofFileUrl: text("proof_file_url"),
  proofLink: text("proof_link"),
  proofMimeType: text("proof_mime_type"),
  expiryDate: text("expiry_date"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  requestedAt: timestamp("requested_at"),
  requestedBy: varchar("requested_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewReason: text("review_reason"),
  manualApprovalNote: text("manual_approval_note"),
  calendarStartAt: timestamp("calendar_start_at"),
  calendarEndAt: timestamp("calendar_end_at"),
  calendarTitle: text("calendar_title"),
  calendarNotes: text("calendar_notes"),
  calendarGoogleEventId: text("calendar_google_event_id"),
  calendarUpdatedAt: timestamp("calendar_updated_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  expiredAt: timestamp("expired_at"),
}, (t) => [
  uniqueIndex("mediator_service_approvals_mediator_service_unique").on(t.mediatorId, t.serviceTypeId),
  uniqueIndex("mediator_service_approvals_applicant_service_unique").on(t.applicantId, t.serviceTypeId),
  index("mediator_service_approvals_service_idx").on(t.serviceTypeId),
  index("mediator_service_approvals_status_idx").on(t.status),
]);
export type MediatorServiceApproval = typeof mediatorServiceApprovals.$inferSelect;
export type InsertMediatorServiceApproval = typeof mediatorServiceApprovals.$inferInsert;
export const insertMediatorServiceApprovalSchema = createInsertSchema(mediatorServiceApprovals).omit({
  id: true,
  requestedAt: true,
  requestedBy: true,
  reviewedAt: true,
  reviewedBy: true,
  reminderSentAt: true,
  expiredAt: true,
});

// Task #229 — Public mediator application link. One active token at a time;
// generating a new token hard-deletes the previous row so old links stop
// working immediately. Token is a UUID v4 so it's unguessable.
export const mediatorApplicationLinks = pgTable("mediator_application_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type MediatorApplicationLink = typeof mediatorApplicationLinks.$inferSelect;

// =====================================================================
// Task #255 — Contractor Pipeline
// =====================================================================
export const CONTRACTOR_APPLICANT_STAGES = [
  "prospect",
  "screening",
  "contract_sent",
  "active",
  "off_boarded",
] as const;
export type ContractorApplicantStage = (typeof CONTRACTOR_APPLICANT_STAGES)[number];

// "rejected" is a terminal state for applicants who are turned down. It is NOT
// a kanban column — rejected applicants are collected into a hidden list that
// staff can show/hide, mirroring the mediator pipeline's rejected bucket.
export const CONTRACTOR_APPLICANT_COLUMN_STAGES = CONTRACTOR_APPLICANT_STAGES;

export const contractorApplicants = pgTable("contractor_applicants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  contractorType: text("contractor_type"),
  source: text("source"),
  notes: text("notes"),
  stage: text("stage").notNull().default("prospect"),
  rejectedReason: text("rejected_reason"),
  convertedUserId: varchar("converted_user_id").references(() => users.id, { onDelete: "set null" }),
  convertedAt: timestamp("converted_at"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("contractor_applicants_stage_idx").on(t.stage),
  index("contractor_applicants_email_idx").on(t.email),
]);
export type ContractorApplicant = typeof contractorApplicants.$inferSelect;
export type InsertContractorApplicant = typeof contractorApplicants.$inferInsert;

export const insertContractorApplicantSchema = createInsertSchema(contractorApplicants, {
  email: (s) => s.email("Please enter a valid email"),
  firstName: (s) => s.min(1, "First name is required"),
  lastName: (s) => s.min(1, "Last name is required"),
}).omit({
  id: true,
  convertedUserId: true,
  convertedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

// One active shared token; generating a new token hard-deletes the previous row.
export const contractorApplicationLinks = pgTable("contractor_application_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ContractorApplicationLink = typeof contractorApplicationLinks.$inferSelect;

export const mediatorApplicantReferences = pgTable("mediator_applicant_references", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  applicantId: varchar("applicant_id").notNull().references(() => mediatorApplicants.id, { onDelete: "cascade" }),
  refereeName: text("referee_name").notNull(),
  refereeEmail: text("referee_email").notNull(),
  refereePhone: text("referee_phone"),
  organisation: text("organisation"),
  relationship: text("relationship"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  requestedBy: varchar("requested_by").references(() => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: varchar("verified_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("mediator_applicant_references_applicant_idx").on(t.applicantId),
]);
export type MediatorApplicantReference = typeof mediatorApplicantReferences.$inferSelect;
export type InsertMediatorApplicantReference = typeof mediatorApplicantReferences.$inferInsert;
export const insertMediatorApplicantReferenceSchema = createInsertSchema(mediatorApplicantReferences, {
  refereeName: (s) => s.min(1, "Referee name is required"),
  refereeEmail: (s) => s.email("Valid referee email is required"),
}).omit({
  id: true,
  requestedAt: true,
  requestedBy: true,
  verifiedAt: true,
  verifiedBy: true,
});
