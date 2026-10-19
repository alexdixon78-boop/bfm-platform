import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "./db";
import { seedDatabase } from "./seed";

export function assertDatabaseUrlConfiguredForBootstrap() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for db:bootstrap");
  }
}

function logBootstrap(message: string) {
  console.log(`[DbBootstrap] ${message}`);
}

async function cleanupLegacyBookingOnboardingCaseNotes() {
  const marker = "Booking onboarding description:";
  const cleanupResult = await db.execute(sql`
    WITH candidates AS (
      SELECT
        c.id,
        NULLIF(btrim(substring(c.notes from 1 for position(${marker} in c.notes) - 1)), '') AS preserved_notes,
        btrim(substring(c.notes from position(${marker} in c.notes) + char_length(${marker}))) AS booking_description
      FROM cases c
      WHERE c.notes LIKE ${`%${marker}%`}
    ),
    matched AS (
      SELECT DISTINCT c.id, c.preserved_notes
      FROM candidates c
      JOIN miam_records mr ON mr.case_id = c.id
      WHERE mr.intro_notes IS NOT NULL
        AND btrim(mr.intro_notes) = c.booking_description
    )
    UPDATE cases c
       SET notes = matched.preserved_notes,
           last_updated = NOW()
      FROM matched
     WHERE c.id = matched.id
    RETURNING c.id
  `);
  const cleaned = ((cleanupResult as unknown as { rows?: unknown[] }).rows ?? []).length;
  if (cleaned > 0) {
    logBootstrap(`Legacy booking onboarding case-note markers cleaned: ${cleaned}`);
  }
}

async function withBootstrapLock<T>(callback: () => Promise<T>): Promise<T> {
  const lockKey = 736_322_651;
  const startedAt = Date.now();
  logBootstrap("Waiting for advisory lock");
  await db.execute(sql`SELECT pg_advisory_lock(${lockKey})`);
  logBootstrap(`Advisory lock acquired in ${Date.now() - startedAt}ms`);
  try {
    return await callback();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
    logBootstrap("Advisory lock released");
  }
}

export async function runDatabaseBootstrap() {
  assertDatabaseUrlConfiguredForBootstrap();
  const startedAt = Date.now();
  await withBootstrapLock(async () => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'mediator'
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('bookingPaymentProvider', 'xero_invoice', NOW())
    ON CONFLICT (key) DO NOTHING
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS enquiries (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      date_received TIMESTAMP NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      contact_method TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      shuttle_mediation BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'New',
      notes TEXT,
      lead_source TEXT,
      converted_case_id VARCHAR
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS cases (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_ref TEXT NOT NULL UNIQUE,
      mediator_id VARCHAR,
      stage TEXT NOT NULL DEFAULT 'Enquiry',
      status TEXT NOT NULL DEFAULT 'Active',
      issue_type TEXT,
      lead_source TEXT,
      legacy_source_system TEXT,
      legacy_case_number TEXT,
      shuttle_mediation BOOLEAN NOT NULL DEFAULT false,
      confidential BOOLEAN NOT NULL DEFAULT false,
      last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      notes TEXT
    )
  `);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS legacy_source_system TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS legacy_case_number TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_legacy_case_number_idx ON cases(legacy_source_system, legacy_case_number) WHERE legacy_case_number IS NOT NULL`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT,
      email TEXT,
      phone TEXT,
      phone_code TEXT DEFAULT '+44',
      gender TEXT,
      ethnic_origin TEXT,
      national_insurance_number TEXT,
      disability_or_health_condition TEXT,
      additional_needs TEXT,
      address_line_1 TEXT,
      address_line_2 TEXT,
      city TEXT,
      postcode TEXT,
      country TEXT DEFAULT 'United Kingdom',
      user_id VARCHAR,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS clients_email_lower_idx ON clients(lower(email)) WHERE email IS NOT NULL`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS clients_user_id_idx ON clients(user_id) WHERE user_id IS NOT NULL`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS parties (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL,
      client_id VARCHAR NOT NULL REFERENCES clients(id),
      role TEXT NOT NULL,
      confidential BOOLEAN DEFAULT false,
      miam_mediator_id VARCHAR,
      allocated_mediator_id VARCHAR,
      portal_status TEXT NOT NULL DEFAULT 'inactive',
      invite_token TEXT,
      invite_expires_at TIMESTAMP,
      booking_token TEXT,
      booking_token_expires_at TIMESTAMP,
      miam_form_token TEXT,
      miam_form_token_expires_at TIMESTAMP
    )
  `);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS client_id VARCHAR REFERENCES clients(id)`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS booking_token TEXT`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS booking_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS miam_form_token TEXT`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS miam_form_token_expires_at TIMESTAMP`);
  await db.execute(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parties' AND column_name = 'first_name'
      ) THEN
        ALTER TABLE parties ALTER COLUMN first_name DROP NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parties' AND column_name = 'last_name'
      ) THEN
        ALTER TABLE parties ALTER COLUMN last_name DROP NOT NULL;
      END IF;
    END $$
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS permissions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      role TEXT NOT NULL,
      section TEXT NOT NULL,
      can_view BOOLEAN NOT NULL DEFAULT false,
      can_edit BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(role, section)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS api_integrations (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_by VARCHAR REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      revoked_by VARCHAR REFERENCES users(id),
      revoked_at TIMESTAMP,
      last_used_at TIMESTAMP
    )
  `);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS type TEXT`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS label TEXT`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS key_hash TEXT`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS key_prefix TEXT`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS created_by VARCHAR REFERENCES users(id)`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS revoked_by VARCHAR REFERENCES users(id)`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP`);
  await db.execute(`ALTER TABLE api_integrations ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS api_integrations_key_hash_idx ON api_integrations(key_hash)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS xero_connections (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL UNIQUE,
      tenant_name TEXT,
      tenant_type TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at TIMESTAMP NOT NULL,
      scopes TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      connected_by VARCHAR REFERENCES users(id),
      connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      disconnected_at TIMESTAMP,
      last_sync_at TIMESTAMP,
      last_error TEXT
    )
  `);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS tenant_id TEXT`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS tenant_name TEXT`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS tenant_type TEXT`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS access_token TEXT`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS refresh_token TEXT`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS scopes TEXT`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected'`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS connected_by VARCHAR REFERENCES users(id)`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS connected_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMP`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP`);
  await db.execute(`ALTER TABLE xero_connections ADD COLUMN IF NOT EXISTS last_error TEXT`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS xero_connections_tenant_id_idx ON xero_connections(tenant_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS xero_webhook_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      xero_event_id TEXT NOT NULL UNIQUE,
      event_category TEXT,
      event_type TEXT,
      resource_id TEXT,
      tenant_id TEXT,
      processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      action TEXT
    )
  `);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS xero_event_id TEXT`);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS event_category TEXT`);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS event_type TEXT`);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS resource_id TEXT`);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS tenant_id TEXT`);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`ALTER TABLE xero_webhook_events ADD COLUMN IF NOT EXISTS action TEXT`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS xero_webhook_events_event_id_idx ON xero_webhook_events(xero_event_id)`);

  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS first_name TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS middle_name TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS last_name TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS date_of_birth TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS mobile_telephone TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS phone_code TEXT DEFAULT '+44'`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS landline_telephone TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS referral_type TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS address_line_1 TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS address_line_2 TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS postcode TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_follow_up BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_follow_up_date TIMESTAMP`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_anonymised_data BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN DEFAULT false`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS lead_source_other TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS issue_type_other TEXT`);
  await db.execute(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'enquiries' AND column_name = 'name'
      ) THEN
        UPDATE enquiries
        SET
          first_name = COALESCE(first_name, CASE
            WHEN name IS NOT NULL AND name != '' AND position(' ' in name) > 0
            THEN left(name, length(name) - length(substring(name from '[^ ]*$')) - 1)
            ELSE name
          END),
          last_name = COALESCE(last_name, CASE
            WHEN name IS NOT NULL AND name != '' AND position(' ' in name) > 0
            THEN substring(name from '[^ ]*$')
            ELSE ''
          END)
        WHERE first_name IS NULL OR last_name IS NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'enquiries' AND column_name = 'phone'
      ) THEN
        UPDATE enquiries
        SET mobile_telephone = COALESCE(mobile_telephone, phone)
        WHERE mobile_telephone IS NULL;
      END IF;
    END $$
  `);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS metadata TEXT`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS enquiry_duplicate_reviews (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      source_enquiry_id VARCHAR NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
      matched_enquiry_id VARCHAR NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
      primary_enquiry_id VARCHAR REFERENCES enquiries(id) ON DELETE SET NULL,
      match_reasons TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT,
      reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE enquiry_duplicate_reviews ADD COLUMN IF NOT EXISTS primary_enquiry_id VARCHAR REFERENCES enquiries(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE enquiry_duplicate_reviews ADD COLUMN IF NOT EXISTS review_note TEXT`);
  await db.execute(`ALTER TABLE enquiry_duplicate_reviews ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE enquiry_duplicate_reviews ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`);
  await db.execute(`CREATE INDEX IF NOT EXISTS enquiry_duplicate_reviews_source_idx ON enquiry_duplicate_reviews(source_enquiry_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS enquiry_duplicate_reviews_matched_idx ON enquiry_duplicate_reviews(matched_enquiry_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS enquiry_duplicate_reviews_status_idx ON enquiry_duplicate_reviews(status)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS enquiry_duplicate_reviews_pair_idx ON enquiry_duplicate_reviews(source_enquiry_id, matched_enquiry_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS gmail_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      gmail_message_id TEXT NOT NULL UNIQUE,
      gmail_thread_id TEXT,
      from_name TEXT,
      from_email TEXT NOT NULL,
      to_emails TEXT,
      cc_emails TEXT,
      subject TEXT,
      received_at TIMESTAMP,
      snippet TEXT,
      text_body TEXT,
      sanitized_html_body TEXT,
      status TEXT NOT NULL DEFAULT 'imported',
      imported_by VARCHAR REFERENCES users(id),
      imported_at TIMESTAMP NOT NULL DEFAULT NOW(),
      linked_enquiry_id VARCHAR REFERENCES enquiries(id) ON DELETE SET NULL,
      linked_case_id VARCHAR REFERENCES cases(id) ON DELETE SET NULL,
      converted_by VARCHAR REFERENCES users(id),
      converted_at TIMESTAMP,
      archived_at TIMESTAMP,
      deleted_at TIMESTAMP,
      needs_action_at TIMESTAMP,
      last_action_by VARCHAR REFERENCES users(id),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
  await db.execute(`ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  await db.execute(`ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS needs_action_at TIMESTAMP`);
  await db.execute(`ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS last_action_by VARCHAR REFERENCES users(id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS gmail_messages_gmail_message_id_idx ON gmail_messages(gmail_message_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS gmail_messages_status_idx ON gmail_messages(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS gmail_messages_received_at_idx ON gmail_messages(received_at DESC)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS gmail_messages_from_email_idx ON gmail_messages(from_email)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS gmail_mail_inline_assets (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      imported_mail_id VARCHAR NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
      gmail_message_id TEXT NOT NULL,
      content_id TEXT NOT NULL,
      attachment_id TEXT,
      mime_type TEXT NOT NULL,
      filename TEXT,
      data TEXT NOT NULL,
      size INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (imported_mail_id, content_id)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS gmail_mail_inline_assets_imported_mail_idx ON gmail_mail_inline_assets(imported_mail_id)`);

  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS user_id VARCHAR`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS allocated_mediator_id VARCHAR`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS invite_token TEXT`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_confidential_notes (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), case_id VARCHAR NOT NULL REFERENCES cases(id), category TEXT NOT NULL CHECK (category IN ('Safety Concern', 'Case Update', 'Important Note', 'Risk Flag')), content TEXT NOT NULL, created_by VARCHAR NOT NULL REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`ALTER TABLE cases DROP COLUMN IF EXISTS confidential_notes`);
  await db.execute(`UPDATE users SET role = 'client' WHERE role IN ('client_party_a', 'client_party_b')`);
  await db.execute(`DELETE FROM permissions WHERE role IN ('client_party_a', 'client_party_b')`);
  await db.execute(`CREATE TABLE IF NOT EXISTS audit_logs (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), timestamp TIMESTAMP NOT NULL DEFAULT NOW(), user_id VARCHAR, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id VARCHAR, entity_ref TEXT, details TEXT, ip_address TEXT)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS service_types (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE, description TEXT, category TEXT NOT NULL, price_info TEXT, is_active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`ALTER TABLE service_types ADD COLUMN IF NOT EXISTS baseline_service_name TEXT`);
  await db.execute(`CREATE TABLE IF NOT EXISTS service_type_deletions (name TEXT PRIMARY KEY, deleted_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`ALTER TABLE service_types ADD COLUMN IF NOT EXISTS online_payment_enabled BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE service_types ADD COLUMN IF NOT EXISTS payment_amount_pence INTEGER`);
  await db.execute(`ALTER TABLE service_types ADD COLUMN IF NOT EXISTS payment_currency TEXT NOT NULL DEFAULT 'gbp'`);
  await db.execute(`
    UPDATE service_types
    SET online_payment_enabled = true,
        payment_amount_pence = 15000,
        payment_currency = 'gbp'
    WHERE name = 'MIAM'
  `);
  await db.execute(`
    UPDATE service_types
    SET online_payment_enabled = true,
        payment_amount_pence = 20000,
        payment_currency = 'gbp'
    WHERE name = 'Urgent (Same Day) MIAM'
  `);
  await db.execute(`
    UPDATE service_types
    SET payment_currency = 'gbp'
    WHERE name = 'Evening/weekend MIAM'
  `);
  await db.execute(`
    UPDATE service_types
    SET payment_currency = 'gbp'
    WHERE name = 'Direct to Court Express'
  `);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_service_types (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, service_type_id VARCHAR NOT NULL REFERENCES service_types(id) ON DELETE CASCADE, mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified', UNIQUE(mediator_id, service_type_id))`);
  await db.execute(`
    DO $$
    DECLARE
      role_column_exists BOOLEAN;
    BEGIN
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'mediator_service_types'
          AND column_name = 'mediation_role_qualification'
      ) INTO role_column_exists;

      IF NOT role_column_exists THEN
        ALTER TABLE mediator_service_types
          ADD COLUMN mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified';

        UPDATE mediator_service_types mst
        SET mediation_role_qualification = COALESCE(NULLIF(mp.mediation_role_qualification, ''), 'unclassified')
        FROM mediator_profiles mp
        WHERE mp.user_id = mst.mediator_id
          AND mst.mediation_role_qualification = 'unclassified';

        INSERT INTO mediator_service_types (
          mediator_id,
          service_type_id,
          mediation_role_qualification
        )
        SELECT
          msa.mediator_id,
          msa.service_type_id,
          COALESCE(NULLIF(mp.mediation_role_qualification, ''), 'unclassified')
        FROM mediator_service_approvals msa
        JOIN mediator_profiles mp ON mp.user_id = msa.mediator_id
        JOIN users u ON u.id = msa.mediator_id
        WHERE msa.mediator_id IS NOT NULL
          AND msa.status = 'approved'
          AND msa.expired_at IS NULL
          AND (msa.expiry_date IS NULL OR msa.expiry_date >= CURRENT_DATE::text)
          AND u.role = 'mediator'
          AND u.status = 'active'
        ON CONFLICT (mediator_id, service_type_id) DO NOTHING;
      END IF;
    END $$;
  `);
  await db.execute(`
    DO $$
    DECLARE
      fk_name TEXT;
    BEGIN
      SELECT constraint_name INTO fk_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name
      WHERE kcu.table_name = 'mediator_service_types'
        AND kcu.column_name = 'mediator_id'
        AND rc.delete_rule = 'NO ACTION'
      LIMIT 1;

      IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE mediator_service_types DROP CONSTRAINT %I', fk_name);
        ALTER TABLE mediator_service_types ADD CONSTRAINT mediator_service_types_mediator_id_cascade_fk
          FOREIGN KEY (mediator_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;

      SELECT constraint_name INTO fk_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name
      WHERE kcu.table_name = 'mediator_service_types'
        AND kcu.column_name = 'service_type_id'
        AND rc.delete_rule = 'NO ACTION'
      LIMIT 1;

      IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE mediator_service_types DROP CONSTRAINT %I', fk_name);
        ALTER TABLE mediator_service_types ADD CONSTRAINT mediator_service_types_service_type_id_cascade_fk
          FOREIGN KEY (service_type_id) REFERENCES service_types(id) ON DELETE CASCADE;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_availability (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, day_of_week INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS appointments (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), case_id VARCHAR NOT NULL REFERENCES cases(id), party_id VARCHAR REFERENCES parties(id), service_type_id VARCHAR REFERENCES service_types(id), mediator_id VARCHAR REFERENCES users(id), date_time TIMESTAMP NOT NULL, duration INTEGER NOT NULL DEFAULT 60, status TEXT NOT NULL DEFAULT 'hold', hold_expires_at TIMESTAMP, booking_token TEXT, notes TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`ALTER TABLE appointments ALTER COLUMN status SET DEFAULT 'hold'`);
  await db.execute(`UPDATE appointments SET status = 'hold' WHERE status = 'held'`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'payment_pending'`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status_updated_at TIMESTAMP`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status_updated_by VARCHAR`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_notes TEXT`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_provider TEXT`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_amount_pence INTEGER`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_currency TEXT`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS appointment_calendar_sync_jobs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id VARCHAR NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processing_lease_expires_at TIMESTAMP,
      last_attempt_at TIMESTAMP,
      completed_at TIMESTAMP,
      failure_stage TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS appointment_calendar_sync_jobs_due_idx ON appointment_calendar_sync_jobs(status, next_attempt_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS appointment_client_calendar_events (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id VARCHAR NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id),
      google_event_id TEXT NOT NULL,
      ical_uid TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS appointment_client_calendar_events_appointment_party_unique ON appointment_client_calendar_events(appointment_id, party_id)`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS stripe_payment_completed_at TIMESTAMP`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_failure_reason TEXT`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS hold_alert_sent_at TIMESTAMP`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mediator_availability_mediator ON mediator_availability(mediator_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_case ON appointments(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_mediator ON appointments(mediator_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_datetime ON appointments(date_time)`);
  await db.execute(`DROP INDEX IF EXISTS appointments_active_mediator_slot_unique`);
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_mediator_slot_unique
      ON appointments(mediator_id, date_time)
      WHERE status = 'confirmed'
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_sessions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL,
      session_number INTEGER NOT NULL,
      lead_mediator_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL,
      outcome TEXT,
      outcome_notes TEXT,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      allocated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      allocated_at TIMESTAMP,
      completed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      completed_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT mediation_sessions_case_number_unique UNIQUE (case_id, session_number)
    )
  `);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS lead_mediator_id VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS outcome TEXT`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS outcome_notes TEXT`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS next_action TEXT`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS documents_required TEXT`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS follow_up_requirements TEXT`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS next_session_required BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS summary_submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS summary_submitted_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_review_status TEXT NOT NULL DEFAULT 'not_submitted'`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_review_requested_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_review_requested_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_reviewed_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS post_session_review_notes TEXT`);
  await db.execute(`UPDATE mediation_sessions
    SET post_session_review_status = 'approved',
        post_session_reviewed_at = COALESCE(completed_at, summary_submitted_at, updated_at),
        post_session_reviewed_by = COALESCE(completed_by, summary_submitted_by)
    WHERE status = 'completed'
      AND post_session_review_status = 'not_submitted'`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS allocated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS completed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mediation_sessions_case ON mediation_sessions(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mediation_sessions_lead_mediator ON mediation_sessions(lead_mediator_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_sessions_post_session_review_status_idx ON mediation_sessions(post_session_review_status)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_notes (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_notes_session_idx ON mediation_session_notes(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_notes_case_idx ON mediation_session_notes(case_id)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS financial_disclosure_folders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      trigger_source TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS financial_disclosure_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      folder_id VARCHAR NOT NULL REFERENCES financial_disclosure_folders(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'outstanding',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_at TIMESTAMP,
      completed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS financial_disclosure_evidence_categories (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      folder_id VARCHAR NOT NULL REFERENCES financial_disclosure_folders(id) ON DELETE CASCADE,
      category_key TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`DO $$ BEGIN ALTER TABLE financial_disclosure_folders DROP CONSTRAINT financial_disclosure_folders_case_id_unique; EXCEPTION WHEN undefined_object THEN null; END $$;`);
  await db.execute(`ALTER TABLE financial_disclosure_folders ADD COLUMN IF NOT EXISTS party_id VARCHAR`);
  await db.execute(`DO $$ BEGIN ALTER TABLE financial_disclosure_folders ADD CONSTRAINT financial_disclosure_folders_party_id_parties_id_fk FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_folders_case_idx ON financial_disclosure_folders(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_folders_party_idx ON financial_disclosure_folders(party_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS financial_disclosure_folders_case_party_unique ON financial_disclosure_folders(case_id, party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_folders_status_idx ON financial_disclosure_folders(status)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS financial_disclosure_items_folder_type_unique ON financial_disclosure_items(folder_id, item_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_items_folder_idx ON financial_disclosure_items(folder_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_items_type_idx ON financial_disclosure_items(item_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_items_status_idx ON financial_disclosure_items(status)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS financial_disclosure_evidence_folder_key_unique ON financial_disclosure_evidence_categories(folder_id, category_key)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_evidence_folder_idx ON financial_disclosure_evidence_categories(folder_id)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS financial_disclosure_booklet_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      version_label TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      source_file_url TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      is_current BOOLEAN NOT NULL DEFAULT false,
      placeholder_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
      uploaded_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
      notes TEXT
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS financial_disclosure_booklet_templates_current_idx ON financial_disclosure_booklet_templates(is_current)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS financial_disclosure_booklet_templates_version_unique ON financial_disclosure_booklet_templates(version_label)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_draft_financial_schedules (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at TIMESTAMP,
      confirmed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      confirmed_in_session_id VARCHAR,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP`);
  await db.execute(`ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS confirmed_in_session_id VARCHAR`);
  await db.execute(`ALTER TABLE case_draft_financial_schedules ADD COLUMN IF NOT EXISTS mediation_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL`);
  await db.execute(`DROP INDEX IF EXISTS case_draft_financial_schedules_case_unique`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_draft_financial_schedules_session_unique ON case_draft_financial_schedules(mediation_session_id) WHERE mediation_session_id IS NOT NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_draft_financial_schedules_status_idx ON case_draft_financial_schedules(status)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_draft_financial_schedule_versions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_id VARCHAR NOT NULL REFERENCES case_draft_financial_schedules(id) ON DELETE CASCADE,
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      edited_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      edited_at TIMESTAMP NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL,
      confirmed_in_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_draft_financial_schedule_versions_schedule_version_unique ON case_draft_financial_schedule_versions(schedule_id, version_number)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_draft_financial_schedule_versions_schedule_idx ON case_draft_financial_schedule_versions(schedule_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_draft_financial_schedule_versions_case_idx ON case_draft_financial_schedule_versions(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_draft_financial_schedule_versions_edited_at_idx ON case_draft_financial_schedule_versions(edited_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_documents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL,
      financial_disclosure_folder_id VARCHAR REFERENCES financial_disclosure_folders(id) ON DELETE SET NULL,
      financial_disclosure_item_id VARCHAR REFERENCES financial_disclosure_items(id) ON DELETE SET NULL,
      financial_disclosure_evidence_category_id VARCHAR REFERENCES financial_disclosure_evidence_categories(id) ON DELETE SET NULL,
      financial_disclosure_upload_target TEXT,
      party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      document_category TEXT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      storage_key TEXT,
      mime_type TEXT,
      uploaded_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      review_status TEXT NOT NULL DEFAULT 'draft',
      ready_for_review_at TIMESTAMP,
      reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      shared_with_clients BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_case_idx ON case_documents(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_session_idx ON case_documents(mediation_session_id)`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS financial_disclosure_folder_id VARCHAR`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS financial_disclosure_item_id VARCHAR`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS financial_disclosure_evidence_category_id VARCHAR`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS financial_disclosure_upload_target TEXT`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS document_date TIMESTAMP`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS party_id VARCHAR`);
  await db.execute(`ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS document_category TEXT`);
  await db.execute(`DO $$ BEGIN ALTER TABLE case_documents ADD CONSTRAINT case_documents_financial_disclosure_folder_id_financial_disclosure_folders_id_fk FOREIGN KEY (financial_disclosure_folder_id) REFERENCES financial_disclosure_folders(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`DO $$ BEGIN ALTER TABLE case_documents ADD CONSTRAINT case_documents_financial_disclosure_item_id_financial_disclosure_items_id_fk FOREIGN KEY (financial_disclosure_item_id) REFERENCES financial_disclosure_items(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`DO $$ BEGIN ALTER TABLE case_documents ADD CONSTRAINT case_documents_financial_disclosure_evidence_category_id_financial_disclosure_evidence_categories_id_fk FOREIGN KEY (financial_disclosure_evidence_category_id) REFERENCES financial_disclosure_evidence_categories(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`DO $$ BEGIN ALTER TABLE case_documents ADD CONSTRAINT case_documents_party_id_parties_id_fk FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_financial_disclosure_folder_idx ON case_documents(financial_disclosure_folder_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_financial_disclosure_item_idx ON case_documents(financial_disclosure_item_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_financial_disclosure_category_idx ON case_documents(financial_disclosure_evidence_category_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_financial_disclosure_upload_target_idx ON case_documents(financial_disclosure_upload_target)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_party_idx ON case_documents(party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_category_idx ON case_documents(document_category)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_documents_review_status_idx ON case_documents(review_status)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS appointment_status_history (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL,
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL,
      previous_status TEXT,
      new_status TEXT,
      previous_date_time TIMESTAMP,
      new_date_time TIMESTAMP,
      previous_duration INTEGER,
      new_duration INTEGER,
      event_type TEXT NOT NULL,
      reason TEXT,
      changed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      metadata JSONB
    )
  `);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS case_id VARCHAR`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS mediation_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS previous_status TEXT`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS new_status TEXT`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS previous_date_time TIMESTAMP`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS new_date_time TIMESTAMP`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS previous_duration INTEGER`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS new_duration INTEGER`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS event_type TEXT`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS reason TEXT`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS changed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS changed_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`ALTER TABLE appointment_status_history ADD COLUMN IF NOT EXISTS metadata JSONB`);
  await db.execute(`CREATE INDEX IF NOT EXISTS appointment_status_history_appointment_idx ON appointment_status_history(appointment_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS appointment_status_history_case_idx ON appointment_status_history(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS appointment_status_history_session_idx ON appointment_status_history(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS appointment_status_history_changed_at_idx ON appointment_status_history(changed_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_participants (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      invitation_status TEXT NOT NULL DEFAULT 'accepted',
      invitation_token_hash TEXT UNIQUE,
      invitation_sent_at TIMESTAMP,
      invitation_viewed_at TIMESTAMP,
      invitation_responded_at TIMESTAMP,
      invitation_decline_notes TEXT,
      added_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      added_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT mediation_session_participants_session_user_role_unique UNIQUE (session_id, user_id, role)
    )
  `);
  await db.execute(`ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_status TEXT NOT NULL DEFAULT 'accepted'`);
  await db.execute(`ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_token_hash TEXT UNIQUE`);
  await db.execute(`ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_viewed_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_responded_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediation_session_participants ADD COLUMN IF NOT EXISTS invitation_decline_notes TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mediation_session_participants_session ON mediation_session_participants(session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mediation_session_participants_user ON mediation_session_participants(user_id)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_proposals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      appointment_id VARCHAR NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      proposed_start_at TIMESTAMP NOT NULL,
      proposed_end_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      voucher_form_required BOOLEAN NOT NULL DEFAULT false,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE mediation_session_proposals ADD COLUMN IF NOT EXISTS voucher_form_required BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediation_session_proposals_appointment_unique ON mediation_session_proposals(appointment_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_proposals_session_idx ON mediation_session_proposals(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_proposals_case_idx ON mediation_session_proposals(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_proposals_status_idx ON mediation_session_proposals(status)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_proposal_recipients (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id VARCHAR NOT NULL REFERENCES mediation_session_proposals(id) ON DELETE CASCADE,
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      party_id VARCHAR REFERENCES parties(id) ON DELETE CASCADE,
      user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
      participant_id VARCHAR REFERENCES mediation_session_participants(id) ON DELETE CASCADE,
      participant_role TEXT,
      recipient_type TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_email TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      response_status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMP,
      viewed_at TIMESTAMP,
      responded_at TIMESTAMP,
      decline_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE mediation_session_proposal_recipients ADD COLUMN IF NOT EXISTS participant_id VARCHAR REFERENCES mediation_session_participants(id) ON DELETE CASCADE`);
  await db.execute(`ALTER TABLE mediation_session_proposal_recipients ADD COLUMN IF NOT EXISTS participant_role TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_proposal_recipients_proposal_idx ON mediation_session_proposal_recipients(proposal_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_proposal_recipients_session_idx ON mediation_session_proposal_recipients(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_proposal_recipients_response_idx ON mediation_session_proposal_recipients(response_status)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS party_required_forms (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL,
      mediation_session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      form_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'outstanding',
      delivery_status TEXT NOT NULL DEFAULT 'not_sent',
      delivery_last_attempted_at TIMESTAMP,
      delivery_error TEXT,
      issued_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      sent_at TIMESTAMP,
      viewed_at TIMESTAMP,
      signed_at TIMESTAMP,
      signed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      signer_name TEXT,
      signature_ip_address TEXT,
      attestation_text TEXT,
      attestation_version TEXT,
      confirmation_ticked_at TIMESTAMP,
      signature_source TEXT,
      uploaded_document_id VARCHAR REFERENCES case_documents(id) ON DELETE SET NULL,
      upload_notes TEXT,
      withdrawn_at TIMESTAMP,
      withdrawn_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS attestation_version TEXT`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS confirmation_ticked_at TIMESTAMP`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS signature_source TEXT`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_sent'`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS delivery_last_attempted_at TIMESTAMP`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS delivery_error TEXT`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS uploaded_document_id VARCHAR`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS upload_notes TEXT`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMP`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS withdrawn_by VARCHAR`);
  await db.execute(`DO $$ BEGIN ALTER TABLE party_required_forms ADD CONSTRAINT party_required_forms_uploaded_document_id_case_documents_id_fk FOREIGN KEY (uploaded_document_id) REFERENCES case_documents(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`DO $$ BEGIN ALTER TABLE party_required_forms ADD CONSTRAINT party_required_forms_withdrawn_by_users_id_fk FOREIGN KEY (withdrawn_by) REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS party_required_forms_session_party_type_unique ON party_required_forms(mediation_session_id, party_id, form_type)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS party_required_forms_case_party_type_unique ON party_required_forms(case_id, party_id, form_type) WHERE mediation_session_id IS NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS party_required_forms_case_idx ON party_required_forms(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS party_required_forms_party_idx ON party_required_forms(party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS party_required_forms_appointment_idx ON party_required_forms(appointment_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS party_required_forms_status_idx ON party_required_forms(status)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_voucher_claims (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'voucher_claim_submitted',
      opia_claim_reference TEXT,
      submitted_at TIMESTAMP,
      submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      accepted_at TIMESTAMP,
      accepted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      paid_at TIMESTAMP,
      paid_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      last_chased_at TIMESTAMP,
      next_chase_due_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediation_session_voucher_claims_session_unique ON mediation_session_voucher_claims(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_voucher_claims_case_idx ON mediation_session_voucher_claims(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_voucher_claims_opia_ref_idx ON mediation_session_voucher_claims(opia_claim_reference)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_voucher_claims_status_idx ON mediation_session_voucher_claims(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_voucher_claims_next_chase_idx ON mediation_session_voucher_claims(next_chase_due_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_availability_windows (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      party_id VARCHAR REFERENCES parties(id) ON DELETE CASCADE,
      proposal_recipient_id VARCHAR REFERENCES mediation_session_proposal_recipients(id) ON DELETE CASCADE,
      start_at TIMESTAMP NOT NULL,
      end_at TIMESTAMP NOT NULL,
      source TEXT NOT NULL DEFAULT 'client',
      submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE mediation_session_availability_windows ALTER COLUMN party_id DROP NOT NULL`);
  await db.execute(`ALTER TABLE mediation_session_availability_windows ADD COLUMN IF NOT EXISTS proposal_recipient_id VARCHAR REFERENCES mediation_session_proposal_recipients(id) ON DELETE CASCADE`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_availability_session_idx ON mediation_session_availability_windows(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_availability_party_idx ON mediation_session_availability_windows(party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_availability_window_idx ON mediation_session_availability_windows(start_at, end_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mediation_session_party_attendance (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      mediation_session_id VARCHAR NOT NULL REFERENCES mediation_sessions(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'no_show',
      marked_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      marked_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediation_session_party_attendance_session_party_unique ON mediation_session_party_attendance(mediation_session_id, party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_party_attendance_session_idx ON mediation_session_party_attendance(mediation_session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediation_session_party_attendance_party_idx ON mediation_session_party_attendance(party_id)`);
  await db.execute(`
    DO $$
    BEGIN
      ALTER TABLE case_draft_financial_schedules
      ADD CONSTRAINT case_draft_financial_schedules_confirmed_in_session_id_mediation_sessions_id_fk
      FOREIGN KEY (confirmed_in_session_id) REFERENCES mediation_sessions(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);
  await db.execute(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'appointments_active_party_booking_token_unique'
      ) THEN
        IF EXISTS (
          SELECT 1
          FROM (
            SELECT party_id, booking_token
            FROM appointments
            WHERE party_id IS NOT NULL
              AND booking_token IS NOT NULL
              AND status NOT IN ('cancelled', 'expired')
            GROUP BY party_id, booking_token
            HAVING COUNT(*) > 1
          ) duplicate_active_booking_links
        ) THEN
          RAISE WARNING 'Skipping appointments_active_party_booking_token_unique because duplicate active party booking-token appointments exist';
        ELSE
          CREATE UNIQUE INDEX appointments_active_party_booking_token_unique
            ON appointments(party_id, booking_token)
            WHERE party_id IS NOT NULL
              AND booking_token IS NOT NULL
              AND status NOT IN ('cancelled', 'expired');
        END IF;
      END IF;
    END $$;
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS xero_invoice_records (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id VARCHAR NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      client_id VARCHAR REFERENCES clients(id) ON DELETE SET NULL,
      case_invoice_id VARCHAR,
      xero_connection_id VARCHAR REFERENCES xero_connections(id) ON DELETE SET NULL,
      xero_tenant_id TEXT NOT NULL,
      xero_contact_id TEXT,
      xero_invoice_id TEXT NOT NULL UNIQUE,
      xero_invoice_number TEXT,
      xero_invoice_url TEXT,
      xero_status TEXT NOT NULL DEFAULT 'AUTHORISED',
      amount_pence INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'gbp',
      sent_at TIMESTAMP,
      paid_at TIMESTAMP,
      last_synced_at TIMESTAMP,
      last_error TEXT,
      metadata TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS appointment_id VARCHAR REFERENCES appointments(id) ON DELETE CASCADE`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS case_id VARCHAR REFERENCES cases(id) ON DELETE CASCADE`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS client_id VARCHAR REFERENCES clients(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS case_invoice_id VARCHAR`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_connection_id VARCHAR REFERENCES xero_connections(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_tenant_id TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_contact_id TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_invoice_number TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_invoice_url TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS xero_status TEXT NOT NULL DEFAULT 'AUTHORISED'`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS amount_pence INTEGER`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'gbp'`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS last_error TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS metadata TEXT`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`ALTER TABLE xero_invoice_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await db.execute(`DROP INDEX IF EXISTS xero_invoice_records_appointment_unique_idx`);
  await db.execute(`CREATE INDEX IF NOT EXISTS xero_invoice_records_appointment_idx ON xero_invoice_records(appointment_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS xero_invoice_records_case_invoice_unique_idx ON xero_invoice_records(case_invoice_id) WHERE case_invoice_id IS NOT NULL`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS xero_invoice_records_invoice_unique_idx ON xero_invoice_records(xero_invoice_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS xero_invoice_records_status_idx ON xero_invoice_records(xero_status)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_invoices (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      bill_to_client_id VARCHAR NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      bill_to_party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      service_type_id VARCHAR REFERENCES service_types(id) ON DELETE SET NULL,
      appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL,
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_invoice_id TEXT,
      payment_link_url TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      failure_reason TEXT,
      invoice_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      issue_date TIMESTAMP NOT NULL DEFAULT NOW(),
      due_date TIMESTAMP,
      subtotal_pence INTEGER NOT NULL DEFAULT 0,
      vat_total_pence INTEGER NOT NULL DEFAULT 0,
      total_pence INTEGER NOT NULL DEFAULT 0,
      amount_paid_pence INTEGER NOT NULL DEFAULT 0,
      outstanding_pence INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'gbp',
      notes TEXT,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      voided_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      voided_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'manual'`);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS provider_invoice_id TEXT`);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS payment_link_url TEXT`);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS failure_reason TEXT`);
  await db.execute(`ALTER TABLE case_invoices ADD COLUMN IF NOT EXISTS voucher_discount_pence INTEGER NOT NULL DEFAULT 0`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_invoices_case_idx ON case_invoices(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_invoices_client_idx ON case_invoices(bill_to_client_id)`);
  await db.execute(`DROP INDEX IF EXISTS case_invoices_appointment_unique_idx`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_invoices_appointment_unique_idx ON case_invoices(appointment_id, bill_to_party_id) WHERE appointment_id IS NOT NULL AND bill_to_party_id IS NOT NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_invoices_status_idx ON case_invoices(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_invoices_payment_status_idx ON case_invoices(payment_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_invoices_due_date_idx ON case_invoices(due_date)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_invoice_line_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id VARCHAR NOT NULL REFERENCES case_invoices(id) ON DELETE CASCADE,
      service_type_id VARCHAR REFERENCES service_types(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_amount_pence INTEGER NOT NULL,
      vat_rate INTEGER,
      vat_amount_pence INTEGER NOT NULL DEFAULT 0,
      line_subtotal_pence INTEGER NOT NULL,
      line_total_pence INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_invoice_line_items_invoice_idx ON case_invoice_line_items(invoice_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_payments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      client_id VARCHAR NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      invoice_id VARCHAR REFERENCES case_invoices(id) ON DELETE SET NULL,
      appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL,
      amount_pence INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'gbp',
      payment_date TIMESTAMP NOT NULL DEFAULT NOW(),
      method TEXT NOT NULL DEFAULT 'bank_transfer',
      provider TEXT NOT NULL DEFAULT 'manual',
      provider_payment_id TEXT,
      checkout_session_id TEXT,
      payment_intent_id TEXT,
      payment_status TEXT NOT NULL DEFAULT 'paid',
      failure_reason TEXT,
      refunded_amount_pence INTEGER NOT NULL DEFAULT 0,
      refunded_at TIMESTAMP,
      receipt_number TEXT,
      receipt_generated_at TIMESTAMP,
      reference TEXT,
      notes TEXT,
      recorded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS appointment_id VARCHAR REFERENCES appointments(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'manual'`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS checkout_session_id TEXT`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS payment_intent_id TEXT`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid'`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS failure_reason TEXT`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS refunded_amount_pence INTEGER NOT NULL DEFAULT 0`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS receipt_number TEXT`);
  await db.execute(`ALTER TABLE case_payments ADD COLUMN IF NOT EXISTS receipt_generated_at TIMESTAMP`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_payments_case_idx ON case_payments(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_payments_client_idx ON case_payments(client_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_payments_invoice_idx ON case_payments(invoice_id)`);
  await db.execute(`DROP INDEX IF EXISTS case_payments_appointment_unique_idx`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_payments_appointment_unique_idx ON case_payments(appointment_id, party_id) WHERE appointment_id IS NOT NULL AND party_id IS NOT NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_payments_payment_status_idx ON case_payments(payment_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_payments_payment_date_idx ON case_payments(payment_date)`);
  await db.execute(`
    UPDATE permissions
    SET can_view = true, can_edit = true
    WHERE role = 'subadmin' AND section = 'finance'
  `);

  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS booking_token TEXT`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS booking_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS miam_form_token TEXT`);
  await db.execute(`ALTER TABLE parties ADD COLUMN IF NOT EXISTS miam_form_token_expires_at TIMESTAMP`);

  await db.execute(`CREATE TABLE IF NOT EXISTS demographic_data (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    date_of_birth TEXT,
    gender_identity TEXT,
    gender_self_description TEXT,
    ethnicity TEXT,
    country_of_birth TEXT,
    country_of_birth_other TEXT,
    first_language TEXT,
    first_language_other TEXT,
    interpreter_needed TEXT,
    interpreter_language TEXT,
    disability_or_health_conditions TEXT,
    additional_needs TEXT,
    employment_status TEXT,
    legal_aid_eligible TEXT,
    voucher_scheme_eligible TEXT,
    family_case_subtype TEXT,
    workplace_case_subtype TEXT,
    court_proceedings_status TEXT,
    court_reference TEXT,
    court_name TEXT,
    cafcass_involved BOOLEAN,
    solicitor_involved BOOLEAN,
    solicitor_name TEXT,
    children_ages TEXT,
    relationship_to_child TEXT,
    life_satisfaction INTEGER,
    anxiety_score INTEGER,
    emotional_wellbeing INTEGER,
    completed_by TEXT,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_demographic_data_party_id ON demographic_data(party_id)`);

  await db.execute(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demographic_data' AND column_name='interpreter_needed' AND data_type='boolean') THEN ALTER TABLE demographic_data ALTER COLUMN interpreter_needed TYPE TEXT USING CASE WHEN interpreter_needed=true THEN 'Yes - spoken interpreter' WHEN interpreter_needed=false THEN 'No' ELSE NULL END; END IF; END $$`);
  await db.execute(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demographic_data' AND column_name='legal_aid_eligible' AND data_type='boolean') THEN ALTER TABLE demographic_data ALTER COLUMN legal_aid_eligible TYPE TEXT USING CASE WHEN legal_aid_eligible=true THEN 'Yes' WHEN legal_aid_eligible=false THEN 'No' ELSE NULL END; END IF; END $$`);
  await db.execute(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demographic_data' AND column_name='voucher_scheme_eligible' AND data_type='boolean') THEN ALTER TABLE demographic_data ALTER COLUMN voucher_scheme_eligible TYPE TEXT USING CASE WHEN voucher_scheme_eligible=true THEN 'Yes' WHEN voucher_scheme_eligible=false THEN 'No' ELSE NULL END; END IF; END $$`);
  await db.execute(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demographic_data' AND column_name='cafcass_involved' AND data_type='boolean') THEN ALTER TABLE demographic_data ALTER COLUMN cafcass_involved TYPE TEXT USING CASE WHEN cafcass_involved=true THEN 'Yes' WHEN cafcass_involved=false THEN 'No' ELSE NULL END; END IF; END $$`);
  await db.execute(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demographic_data' AND column_name='solicitor_involved' AND data_type='boolean') THEN ALTER TABLE demographic_data ALTER COLUMN solicitor_involved TYPE TEXT USING CASE WHEN solicitor_involved=true THEN 'Yes' WHEN solicitor_involved=false THEN 'No' ELSE NULL END; END IF; END $$`);
  await db.execute(`ALTER TABLE demographic_data ADD COLUMN IF NOT EXISTS ethnic_self_disclose TEXT`);
  await db.execute(`ALTER TABLE demographic_data ADD COLUMN IF NOT EXISTS relationship_to_child TEXT`);
  try { await db.execute(`ALTER TABLE demographic_data ALTER COLUMN interpreter_needed DROP DEFAULT`); } catch(e) {}

  await db.execute(`CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    audience TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'assignees',
    type TEXT NOT NULL,
    urgency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    case_id VARCHAR,
    enquiry_id VARCHAR,
    complaint_id VARCHAR,
    appointment_id VARCHAR,
    due_at TIMESTAMP,
    completion_notes TEXT,
    completed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    completed_at TIMESTAMP,
    case_note_required BOOLEAN NOT NULL DEFAULT false,
    created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    legacy_notification_id VARCHAR UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP`);
  await db.execute(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS tasks_audience_status_idx ON tasks(audience, status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS tasks_case_idx ON tasks(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_at)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS task_assignees (
    task_id VARCHAR NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS task_assignees_user_idx ON task_assignees(user_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS task_schedules (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id VARCHAR NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    start_at TIMESTAMP,
    end_at TIMESTAMP,
    all_day_start TEXT,
    all_day_end_exclusive TEXT,
    reminder_minutes INTEGER,
    reminder_sent_at TIMESTAMP,
    active BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1,
    google_event_id TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    last_sync_error_code TEXT,
    last_sync_error_message TEXT,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS task_calendar_sync_jobs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id VARCHAR,
    task_schedule_id VARCHAR REFERENCES task_schedules(id) ON DELETE SET NULL,
    operation TEXT NOT NULL,
    schedule_version INTEGER NOT NULL,
    google_event_id TEXT,
    payload JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processing_lease_expires_at TIMESTAMP,
    last_attempt_at TIMESTAMP,
    completed_at TIMESTAMP,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, schedule_version, operation)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS task_calendar_sync_jobs_due_idx ON task_calendar_sync_jobs(status, next_attempt_at)`);

  await db.execute(`CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id VARCHAR,
    recipient_role TEXT NOT NULL,
    type TEXT NOT NULL,
    urgency TEXT NOT NULL,
    case_id VARCHAR,
    appointment_id VARCHAR,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    completed_by VARCHAR,
    completed_at TIMESTAMP,
    case_note_required BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(recipient_role)`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS assigned_to VARCHAR`);
  await db.execute(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'notifications_assigned_to_users_id_fk'
        AND table_name = 'notifications'
    ) THEN
      ALTER TABLE notifications ADD CONSTRAINT notifications_assigned_to_users_id_fk
        FOREIGN KEY (assigned_to) REFERENCES users(id);
    END IF;
  END $$`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMP`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS intake_follow_up_interval_days INTEGER`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS intake_follow_up_scheduled_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS completion_notes TEXT`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notifications_assigned ON notifications(assigned_to)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS notifications_dynamic_intake_due_alert_once
    ON notifications(type, task_id)
    WHERE type = 'task_follow_up_due_alert' AND task_id IS NOT NULL`);

  await db.execute(`CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS notification_assignees (
    notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notification_assignees_user ON notification_assignees(user_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS task_reminder_deliveries (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    task_schedule_id VARCHAR NOT NULL REFERENCES task_schedules(id) ON DELETE CASCADE,
    task_id VARCHAR NOT NULL,
    schedule_version INTEGER NOT NULL,
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id VARCHAR NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (task_schedule_id, schedule_version, user_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS task_reminder_deliveries_task_idx ON task_reminder_deliveries(task_id)`);
  await db.execute(`INSERT INTO notification_assignees (notification_id, user_id, assigned_by)
    SELECT id, assigned_to, NULL
    FROM notifications
    WHERE assigned_to IS NOT NULL
    ON CONFLICT (notification_id, user_id) DO NOTHING`);

  await db.execute(`UPDATE permissions SET can_view = true WHERE role = 'client' AND section = 'dashboard' AND can_view = false`);

  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS referral_partner_name TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS referral_partner_code TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS confidential BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS intake_status TEXT NOT NULL DEFAULT 'New'`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS claimed_by VARCHAR`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS first_contact_due_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS first_contact_attempted_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS first_contact_method TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS first_contact_notes TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS safeguarding_status TEXT NOT NULL DEFAULT 'pending'`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS safeguarding_checked_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS safeguarding_checked_by VARCHAR`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS safeguarding_notes TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS safeguarding_confidential BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS standard_chase_stopped BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS no_whatsapp_or_voicemail BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS national_da_helpline_signposted BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS rebecca_notified_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS cim_eligible BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS cim_eligibility_marked_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS cim_eligibility_marked_by VARCHAR`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS closure_reason TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS closure_details TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_cim_eligible_idx ON cases(cim_eligible)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_cim_consents (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      form_type TEXT NOT NULL DEFAULT 'cf10',
      status TEXT NOT NULL DEFAULT 'pending',
      recorded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      recorded_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_cim_consents_case_party_form_unique ON case_cim_consents(case_id, party_id, form_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_cim_consents_case_idx ON case_cim_consents(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_cim_consents_party_idx ON case_cim_consents(party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_cim_consents_status_idx ON case_cim_consents(status)`);
  // Backfill legacy enquiry statuses into the intake lifecycle now shown on /enquiries.
  await db.execute(`
    UPDATE enquiries e
    SET status = COALESCE(c.intake_status, 'New')
    FROM cases c
    WHERE e.converted_case_id = c.id
      AND e.status IN ('Converted', 'Reviewed', 'Rejected')
  `);
  await db.execute(`
    UPDATE enquiries
    SET status = 'New'
    WHERE converted_case_id IS NULL
      AND status IN ('Converted', 'Reviewed', 'Rejected')
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS case_activities (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id VARCHAR NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    metadata TEXT,
    direction TEXT,
    performed_by VARCHAR,
    performed_by_name TEXT,
    related_entity_id VARCHAR,
    related_entity_type TEXT,
    occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_case_activities_case ON case_activities(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_case_activities_occurred ON case_activities(occurred_at DESC)`);

  await db.execute(`CREATE TABLE IF NOT EXISTS case_communication_logs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    case_ref TEXT NOT NULL,
    party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
    client_id VARCHAR REFERENCES clients(id) ON DELETE SET NULL,
    recipient_type TEXT NOT NULL DEFAULT 'client',
    recipient_name TEXT,
    recipient_email TEXT,
    recipient_phone TEXT,
    channel TEXT NOT NULL,
    direction TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual',
    template_name TEXT,
    subject TEXT,
    sent_at TIMESTAMP,
    delivery_status TEXT NOT NULL DEFAULT 'unknown',
    source_entity_type TEXT,
    source_entity_id VARCHAR,
    provider_message_id TEXT,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_id VARCHAR,
    actor_name TEXT,
    preview TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    backfill_confidence TEXT NOT NULL DEFAULT 'exact',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_communication_logs_case_sent_idx ON case_communication_logs(case_id, sent_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_communication_logs_channel_idx ON case_communication_logs(channel)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_communication_logs_status_idx ON case_communication_logs(delivery_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_communication_logs_recipient_idx ON case_communication_logs(party_id, client_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_communication_logs_source_unique_idx ON case_communication_logs(source_entity_type, source_entity_id) WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL`);
  await db.execute(`CREATE TABLE IF NOT EXISTS email_templates (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT NOT NULL, is_archived BOOLEAN NOT NULL DEFAULT false, created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL, updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`CREATE INDEX IF NOT EXISTS email_templates_active_idx ON email_templates(is_archived)`);
  await db.execute(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual'`);
  await db.execute(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`);
  await db.execute(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS guidance TEXT NOT NULL DEFAULT ''`);
  await db.execute(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS required_variables JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS content_override BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`CREATE TABLE IF NOT EXISTS email_template_links (key TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL, updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`UPDATE email_templates SET code = 'SYSTEM_MIAM_INVITE', kind = 'system' WHERE code = 'M1' AND guidance = '' AND NOT EXISTS (SELECT 1 FROM email_templates WHERE code = 'SYSTEM_MIAM_INVITE')`);
  await db.execute(`UPDATE email_templates SET code = 'LEGACY_M1_' || id, kind = 'system' WHERE code = 'M1' AND guidance = ''`);
  await db.execute(`UPDATE email_templates SET kind = 'system', required_variables = '["client_first_name","portal_link"]'::jsonb WHERE code = 'PORTAL_INVITE'`);
  await db.execute(`UPDATE email_templates SET required_variables = '["client_first_name","booking_link"]'::jsonb WHERE code = 'SYSTEM_MIAM_INVITE'`);
  await db.execute(`UPDATE email_templates SET subject = replace(subject, '{{personalise_this_to_respond_to_the_client_x27_s_enquiry}}', '{{personalised_response}}'), body_html = replace(body_html, '{{personalise_this_to_respond_to_the_client_x27_s_enquiry}}', '{{personalised_response}}'), variables = (SELECT COALESCE(jsonb_agg(CASE WHEN variable->>'key' = 'personalise_this_to_respond_to_the_client_x27_s_enquiry' THEN jsonb_build_object('key', 'personalised_response', 'label', 'Personalised response') ELSE variable END), '[]'::jsonb) FROM jsonb_array_elements(variables) AS variable) WHERE code = 'E1' AND (subject LIKE '%personalise_this_to_respond_to_the_client_x27_s_enquiry%' OR body_html LIKE '%personalise_this_to_respond_to_the_client_x27_s_enquiry%' OR variables @> '[{"key":"personalise_this_to_respond_to_the_client_x27_s_enquiry"}]'::jsonb)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_email_messages (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), communication_log_id VARCHAR NOT NULL REFERENCES case_communication_logs(id) ON DELETE CASCADE, template_id VARCHAR REFERENCES email_templates(id) ON DELETE SET NULL, template_code TEXT, subject TEXT NOT NULL, body_html TEXT NOT NULL, recipient_kind TEXT NOT NULL, recipient_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL, included_booking_link BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS linked_case_email_message_id VARCHAR REFERENCES case_email_messages(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE case_email_messages ADD COLUMN IF NOT EXISTS reply_token_hash TEXT`);
  await db.execute(`ALTER TABLE case_email_messages ADD COLUMN IF NOT EXISTS reply_to_email TEXT`);
  await db.execute(`ALTER TABLE case_email_messages ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_email_messages_reply_token_hash_unique ON case_email_messages(reply_token_hash)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_email_messages_gmail_thread_idx ON case_email_messages(gmail_thread_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_email_attachments (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), email_message_id VARCHAR NOT NULL REFERENCES case_email_messages(id) ON DELETE CASCADE, document_id VARCHAR NOT NULL REFERENCES case_documents(id) ON DELETE RESTRICT, file_name TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_email_attachments_message_idx ON case_email_attachments(email_message_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS gmail_case_reply_attachments (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), gmail_message_id VARCHAR NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE, case_email_message_id VARCHAR NOT NULL REFERENCES case_email_messages(id) ON DELETE CASCADE, case_document_id VARCHAR REFERENCES case_documents(id) ON DELETE SET NULL, gmail_attachment_id TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', failure_reason TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS gmail_case_reply_attachments_message_attachment_unique ON gmail_case_reply_attachments(gmail_message_id, gmail_attachment_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS gmail_case_reply_attachments_document_idx ON gmail_case_reply_attachments(case_document_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS gmail_case_reply_notifications (id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), gmail_message_id VARCHAR NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE, recipient_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, notification_id VARCHAR REFERENCES notifications(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS gmail_case_reply_notifications_message_recipient_unique ON gmail_case_reply_notifications(gmail_message_id, recipient_user_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS gmail_reply_sync_state (id VARCHAR PRIMARY KEY, checkpoint_at TIMESTAMP, last_attempt_at TIMESTAMP, last_success_at TIMESTAMP, last_error TEXT, updated_at TIMESTAMP NOT NULL DEFAULT NOW())`);

  await db.execute(`UPDATE cases SET stage = 'Enquiry' WHERE stage = 'Enquiry received'`);
  await db.execute(`UPDATE cases SET stage = 'Client A MIAM complete - suitable' WHERE stage = 'Client A MIAM complete'`);
  await db.execute(`UPDATE cases SET stage = 'Client B invited to MIAM' WHERE stage = 'Client B invited'`);
  await db.execute(`UPDATE cases SET stage = 'Client B MIAM completed' WHERE stage = 'Client B MIAM complete'`);
  await db.execute(`UPDATE cases SET stage = 'Case suitable for mediation' WHERE stage = 'Suitable for mediation'`);
  await db.execute(`UPDATE cases SET stage = 'Case unsuitable - referral to recommended partner' WHERE stage = 'Referral to partner'`);
  await db.execute(`UPDATE cases SET stage = 'Case unsuitable - case closed' WHERE stage IN ('Mediation unsuitable', 'Case closed', 'Enquiry only')`);
  await db.execute(`UPDATE cases SET stage = 'C100 signed form pending' WHERE stage = 'Court form requested'`);
  await db.execute(`UPDATE cases SET stage = 'C100 signed form completed' WHERE stage = 'Court form sent'`);
  await db.execute(`UPDATE cases SET stage = 'C100 court application package' WHERE stage = 'Court application package requested'`);
  await db.execute(`UPDATE cases SET stage = 'C100 court application package' WHERE stage = 'Court application package completed'`);
  await db.execute(`UPDATE cases SET stage = 'Session 1 confirmed' WHERE stage = 'Joint sessions'`);
  await db.execute(`UPDATE cases SET stage = 'Mediation concluded - full agreement reached - no further action' WHERE stage = 'Mediation successful'`);
  await db.execute(`UPDATE cases SET stage = 'Enquiry' WHERE stage = 'Direct to court express'`);

  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoom_link TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_access_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_refresh_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_connected BOOLEAN DEFAULT FALSE`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_email TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_scope_granted TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_outlook_sync_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_outlook_sync_error TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS enquiry_ref TEXT`);
  await db.execute(`
    UPDATE enquiries SET enquiry_ref = sub.new_ref
    FROM (
      SELECT id AS rid,
        'ENQ-' || EXTRACT(YEAR FROM date_received)::INT || '-' || LPAD(ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM date_received) ORDER BY date_received, id)::TEXT, 4, '0') AS new_ref
      FROM enquiries WHERE enquiry_ref IS NULL
    ) sub
    WHERE enquiries.id = sub.rid
  `);
  await db.execute(`
    DO $$
    BEGIN
      ALTER TABLE enquiries ALTER COLUMN enquiry_ref SET NOT NULL;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$
  `);
  await db.execute(`
    DO $$
    BEGIN
      ALTER TABLE enquiries ADD CONSTRAINT enquiries_enquiry_ref_unique UNIQUE (enquiry_ref);
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS miam_records (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      party_id VARCHAR NOT NULL,
      case_id VARCHAR NOT NULL,
      session_mediator TEXT,
      session_date TEXT,
      session_time TEXT,
      other_people_present TEXT,
      case_reference TEXT,
      case_type TEXT,
      client_name TEXT,
      client_first_name TEXT,
      client_last_name TEXT,
      client_dob TEXT,
      client_address TEXT,
      client_phone TEXT,
      how_heard_about_bfm TEXT,
      client_occupation TEXT,
      client_disability TEXT,
      client_accessibility TEXT,
      client_ethnicity TEXT,
      client_religious_cultural_needs TEXT,
      client_new_partner TEXT,
      intro_notes TEXT,
      intro_purpose_discussed TEXT,
      intro_confidentiality_explained TEXT,
      children JSONB DEFAULT '[]'::jsonb,
      other_client_name TEXT,
      other_client_first_name TEXT,
      other_client_last_name TEXT,
      other_client_dob TEXT,
      other_client_address TEXT,
      other_client_phone TEXT,
      other_client_email TEXT,
      married TEXT,
      date_of_marriage TEXT,
      lived_together TEXT,
      date_of_cohabitation TEXT,
      date_of_separation TEXT,
      both_parents_pr TEXT,
      pr_is_issue TEXT,
      divorce_started TEXT,
      divorce_started_date TEXT,
      petitioner TEXT,
      decree_nisi_date TEXT,
      decree_absolute_date TEXT,
      court_orders TEXT,
      applications_to_court_text TEXT,
      checklist JSONB DEFAULT '{}'::jsonb,
      background_notes TEXT,
      bg_what_brings_you TEXT,
      bg_living_arrangements TEXT,
      bg_children_details TEXT,
      bg_contact_arrangements TEXT,
      welfare_of_children TEXT,
      welfare_agency_contacted TEXT,
      welfare_agency_name TEXT,
      welfare_agency_date TEXT,
      welfare_agency_time TEXT,
      welfare_notes TEXT,
      welfare_childrens_services TEXT,
      welfare_safety_concerns TEXT,
      welfare_witnessed_conflict TEXT,
      welfare_injuries_behavioural_changes TEXT,
      welfare_safeguarding_plans TEXT,
      child_inclusive_explained TEXT,
      child_inclusive_client_response TEXT,
      child_inclusive_confidentiality_explained TEXT,
      child_inclusive_notes TEXT,
      child_inclusive_consent_agreed TEXT,
      domestic_abuse_screening TEXT,
      da_hurt_or_scared TEXT,
      da_police_involved TEXT,
      da_physical TEXT,
      da_power_control TEXT,
      da_feel_safe TEXT,
      da_financial_control TEXT,
      da_permission_to_decide TEXT,
      da_afraid_of_reaction TEXT,
      domestic_abuse_safety_conclusions TEXT,
      domestic_abuse_support_services JSONB DEFAULT '[]'::jsonb,
      domestic_abuse_support_services_other TEXT,
      domestic_abuse_legal_aid_info TEXT,
      domestic_abuse_notes TEXT,
      emotional_readiness TEXT,
      er_equal_basis TEXT,
      er_choosing_freely TEXT,
      er_pressured_to_attend TEXT,
      er_can_withdraw TEXT,
      er_same_room TEXT,
      er_capacity TEXT,
      safety_measures_discussed TEXT,
      safety_measures_agreed TEXT,
      issues_for_mediation JSONB DEFAULT '{}'::jsonb,
      issues_other TEXT,
      further_info_requested JSONB DEFAULT '{}'::jsonb,
      further_info_other TEXT,
      suitable_for_mediation TEXT,
      suitability_reasons TEXT,
      next_steps TEXT,
      mediation_type TEXT,
      timeline TEXT,
      agreed_with_client TEXT,
      ofs_required TEXT,
      mou_required TEXT,
      statement_of_child_arrangements TEXT,
      ppc_required TEXT,
      ppc_reason JSONB DEFAULT '[]'::jsonb,
      ppc_reason_other TEXT,
      ppc_date TEXT,
      ppc_consultant_name TEXT,
      ppc_outcomes TEXT,
      referral_to_cafcass TEXT,
      referral_to_children_services TEXT,
      referral_to_children_services_details TEXT,
      referral_follow_up_contact TEXT,
      fee_per_session TEXT,
      total_estimated_fee TEXT,
      moj_voucher_applied TEXT,
      legal_aid_applied TEXT,
      payment_method TEXT,
      follow_up_contact_required TEXT,
      approval_status TEXT DEFAULT 'draft',
      submitted_by VARCHAR,
      submitted_at TIMESTAMP,
      reviewed_by VARCHAR,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      pending_party_user_id VARCHAR,
      pending_party_first_name TEXT,
      pending_party_last_name TEXT,
      pending_party_email TEXT,
      superseded_at TIMESTAMP,
      superseded_by VARCHAR,
      renewal_of_miam_record_id VARCHAR,
      renewal_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS superseded_by VARCHAR`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS renewal_of_miam_record_id VARCHAR`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS renewal_sequence INTEGER NOT NULL DEFAULT 0`);
  await db.execute(`ALTER TABLE miam_records DROP CONSTRAINT IF EXISTS miam_records_party_case_unique`);
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS miam_records_current_party_case_unique
      ON miam_records (party_id, case_id)
      WHERE superseded_at IS NULL
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS miam_edit_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      miam_record_id VARCHAR NOT NULL,
      case_id VARCHAR NOT NULL,
      requested_by VARCHAR NOT NULL,
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR,
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      proposed_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
      original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      request_note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS client_first_name TEXT`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS client_last_name TEXT`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS other_client_first_name TEXT`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS other_client_last_name TEXT`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS domestic_abuse_support_services_other TEXT`);
  await db.execute(`ALTER TABLE miam_records ADD COLUMN IF NOT EXISTS ppc_reason_other TEXT`);
  await db.execute(`
    UPDATE miam_records SET
      client_first_name = CASE
        WHEN client_name IS NOT NULL AND client_name != '' AND position(' ' in client_name) > 0
        THEN left(client_name, length(client_name) - length(substring(client_name from '[^ ]*$')) - 1)
        ELSE client_name END,
      client_last_name = CASE
        WHEN client_name IS NOT NULL AND client_name != '' AND position(' ' in client_name) > 0
        THEN substring(client_name from '[^ ]*$')
        ELSE NULL END
    WHERE client_first_name IS NULL AND client_name IS NOT NULL AND client_name != ''
  `);
  await db.execute(`
    UPDATE miam_records SET
      other_client_first_name = CASE
        WHEN other_client_name IS NOT NULL AND other_client_name != '' AND position(' ' in other_client_name) > 0
        THEN left(other_client_name, length(other_client_name) - length(substring(other_client_name from '[^ ]*$')) - 1)
        ELSE other_client_name END,
      other_client_last_name = CASE
        WHEN other_client_name IS NOT NULL AND other_client_name != '' AND position(' ' in other_client_name) > 0
        THEN substring(other_client_name from '[^ ]*$')
        ELSE NULL END
    WHERE other_client_first_name IS NULL AND other_client_name IS NOT NULL AND other_client_name != ''
  `);
  await cleanupLegacyBookingOnboardingCaseNotes();

  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_token TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_request_sent_at TIMESTAMP`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS privacy_consent_status TEXT NOT NULL DEFAULT 'pending'`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS privacy_consent_decided_at TIMESTAMP`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS privacy_consent_decided_by VARCHAR`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS privacy_consent_decision_source TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS privacy_consent_decision_note TEXT`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS shuttle_mediation BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS acknowledgement_status TEXT NOT NULL DEFAULT 'not_attempted'`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS acknowledgement_last_attempted_at TIMESTAMP`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS acknowledgement_sent_at TIMESTAMP`);
  await db.execute(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS acknowledgement_last_error TEXT`);
  await db.execute(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'enquiries' AND column_name = 'privacy_consent'
      ) THEN
        UPDATE enquiries
        SET privacy_consent_status = CASE
          WHEN privacy_consent = true THEN 'granted'
          ELSE privacy_consent_status
        END
        WHERE privacy_consent_status = 'pending';
      END IF;
    END $$
  `);
  await db.execute(`
    UPDATE enquiries e
    SET shuttle_mediation = c.shuttle_mediation
    FROM cases c
    WHERE e.converted_case_id = c.id
      AND e.shuttle_mediation IS DISTINCT FROM c.shuttle_mediation
  `);

  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_connected BOOLEAN DEFAULT FALSE`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_email TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_access_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_refresh_token TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_connected BOOLEAN DEFAULT FALSE`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_email TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_scope_granted TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_outlook_sync_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_outlook_sync_error TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_scope_granted TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_calendar_sync_at TIMESTAMP`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_calendar_sync_error TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_color TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS contractor_type TEXT`);
  await db.execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`);

  await db.execute(`CREATE TABLE IF NOT EXISTS google_calendar_events (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_event_id TEXT NOT NULL,
    title TEXT,
    start_at TIMESTAMP NOT NULL,
    end_at TIMESTAMP NOT NULL,
    is_all_day BOOLEAN NOT NULL DEFAULT false,
    synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(mediator_id, google_event_id)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_google_calendar_events_mediator ON google_calendar_events(mediator_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_google_calendar_events_start ON google_calendar_events(start_at)`);
  await db.execute(`ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS attendees JSONB DEFAULT '[]'`);
  await db.execute(`ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS bfm_attendance_status TEXT`);
  await db.execute(`ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS is_organiser BOOLEAN NOT NULL DEFAULT false`);

  // Task #163 — Cases list advanced filtering. Filter-cache columns on `cases`
  // (denormalised from MIAM record / enquiry / case status — refreshed by
  // case.service.refreshCaseFilterCache) plus a per-user saved-views table.
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS mediation_category TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS family_sub_type TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS workplace_sub_type TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS civil_sub_type TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS commercial_sub_type TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS other_sub_type TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS funding_source TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS voucher_status TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS in_court_status TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS cafcass_status TEXT`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS enquiry_date TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS miam_completed_date TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS closure_date TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS moj_voucher_eligible BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS voucher_claim_eligible BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS voucher_claim_eligible_set_at TIMESTAMP`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS voucher_claim_eligible_set_by VARCHAR`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS manual_revenue_pence INTEGER`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS manual_revenue_updated_by VARCHAR`);
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS manual_revenue_updated_at TIMESTAMP`);
  await db.execute(`DO $$ BEGIN ALTER TABLE cases ADD CONSTRAINT cases_voucher_claim_eligible_set_by_users_id_fk FOREIGN KEY (voucher_claim_eligible_set_by) REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN null; END $$;`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_mediation_category_idx ON cases(mediation_category)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_family_sub_type_idx ON cases(family_sub_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_funding_source_idx ON cases(funding_source)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_voucher_status_idx ON cases(voucher_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_in_court_status_idx ON cases(in_court_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_cafcass_status_idx ON cases(cafcass_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_enquiry_date_idx ON cases(enquiry_date)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_miam_completed_date_idx ON cases(miam_completed_date)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_closure_date_idx ON cases(closure_date)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_moj_voucher_eligible_idx ON cases(moj_voucher_eligible)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS cases_voucher_claim_eligible_idx ON cases(voucher_claim_eligible)`);
  await db.execute(`
    UPDATE cases
    SET moj_voucher_eligible = (
      COALESCE(mediation_category, 'Family') = 'Family'
      AND COALESCE(family_sub_type, issue_type) IN ('Child arrangements (CA)', 'All issues mediation (AIM)')
    )
  `);
  await db.execute(`
    UPDATE mediation_session_proposals proposal
    SET voucher_form_required = false
    FROM cases c
    WHERE proposal.case_id = c.id
      AND proposal.voucher_form_required = true
      AND NOT (
        COALESCE(c.mediation_category, 'Family') = 'Family'
        AND COALESCE(c.family_sub_type, c.issue_type) IN ('Child arrangements (CA)', 'All issues mediation (AIM)')
      )
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS case_closure_records (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id VARCHAR NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
    closure_reason TEXT NOT NULL,
    closure_details TEXT,
    closed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    closed_by_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    follow_up_consent_status TEXT NOT NULL,
    outreach_excluded BOOLEAN NOT NULL DEFAULT false,
    life_satisfaction INTEGER,
    anxiety_score INTEGER,
    service_rating INTEGER,
    net_promoter_score INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_records_case_id_idx ON case_closure_records(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_records_closed_at_idx ON case_closure_records(closed_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_records_follow_up_consent_idx ON case_closure_records(follow_up_consent_status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_records_outreach_excluded_idx ON case_closure_records(outreach_excluded)`);
  await db.execute(`
    INSERT INTO case_closure_records (
      case_id,
      closure_reason,
      closure_details,
      closed_at,
      closed_by_id,
      follow_up_consent_status,
      outreach_excluded,
      created_at,
      updated_at
    )
    SELECT
      c.id,
      COALESCE(c.closure_reason, 'Other'),
      c.closure_details,
      COALESCE(c.closure_date, c.last_updated, NOW()),
      NULL,
      'unknown',
      false,
      NOW(),
      NOW()
    FROM cases c
    WHERE c.status = 'Closed'
      AND NOT EXISTS (
        SELECT 1 FROM case_closure_records existing
        WHERE existing.case_id = c.id
      )
  `);

  await db.execute(`CREATE TABLE IF NOT EXISTS case_closure_party_follow_ups (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    closure_record_id VARCHAR REFERENCES case_closure_records(id) ON DELETE CASCADE,
    case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    client_id VARCHAR NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    consent_status TEXT NOT NULL,
    consent_source TEXT NOT NULL DEFAULT 'closure_admin',
    exclusion_reason TEXT,
    consent_recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    consent_recorded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    follow_up_consent_token_hash TEXT,
    follow_up_consent_token_expires_at TIMESTAMP,
    follow_up_consent_request_sent_at TIMESTAMP,
    follow_up_consent_email_status TEXT NOT NULL DEFAULT 'not_attempted',
    follow_up_consent_email_last_error TEXT,
    follow_up_consent_decided_at TIMESTAMP,
    follow_up_consent_decision_source TEXT,
    follow_up_tasks_scheduled INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (closure_record_id, party_id)
  )`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ALTER COLUMN closure_record_id DROP NOT NULL`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_token_hash TEXT`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_request_sent_at TIMESTAMP`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_email_status TEXT NOT NULL DEFAULT 'not_attempted'`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_email_last_error TEXT`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_decided_at TIMESTAMP`);
  await db.execute(`ALTER TABLE case_closure_party_follow_ups ADD COLUMN IF NOT EXISTS follow_up_consent_decision_source TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_party_follow_ups_case_idx ON case_closure_party_follow_ups(case_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_closure_party_follow_ups_case_party_unique ON case_closure_party_follow_ups(case_id, party_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_closure_party_follow_ups_token_hash_unique ON case_closure_party_follow_ups(follow_up_consent_token_hash) WHERE follow_up_consent_token_hash IS NOT NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_party_follow_ups_party_idx ON case_closure_party_follow_ups(party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_party_follow_ups_client_idx ON case_closure_party_follow_ups(client_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_closure_party_follow_ups_consent_idx ON case_closure_party_follow_ups(consent_status)`);

  await db.execute(`CREATE TABLE IF NOT EXISTS case_filter_presets (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR NOT NULL,
    name TEXT NOT NULL,
    filters JSONB NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_filter_presets_user_name_unique ON case_filter_presets(user_id, name)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_filter_presets_one_default_per_user ON case_filter_presets(user_id) WHERE is_default = true`);

  // Task #167 — multi-party + representatives.
  await db.execute(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS mediator_can_see_reps BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_representatives (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id VARCHAR NOT NULL,
    party_id VARCHAR NOT NULL,
    type TEXT NOT NULL,
    role_title TEXT,
    organisation TEXT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    phone_code TEXT DEFAULT '+44',
    address_line_1 TEXT,
    address_line_2 TEXT,
    city TEXT,
    postcode TEXT,
    country TEXT DEFAULT 'United Kingdom',
    preferred_channel TEXT DEFAULT 'email',
    notes TEXT,
    consent_status TEXT NOT NULL DEFAULT 'pending',
    consent_token_hash TEXT,
    consent_token_expires_at TIMESTAMP,
    consent_request_sent_at TIMESTAMP,
    consent_request_url TEXT,
    consent_decided_at TIMESTAMP,
    consent_decision_ip TEXT,
    created_by VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  // Idempotent column adds for environments where the table existed before this revision.
  await db.execute(`ALTER TABLE case_representatives ADD COLUMN IF NOT EXISTS role_title TEXT`);
  await db.execute(`ALTER TABLE case_representatives ADD COLUMN IF NOT EXISTS consent_token_hash TEXT`);
  await db.execute(`ALTER TABLE case_representatives ADD COLUMN IF NOT EXISTS consent_decision_ip TEXT`);
  // Earlier revisions briefly stored the full consent URL (which embeds the
  // raw token). Drop it — only the hash should ever be at rest.
  await db.execute(`ALTER TABLE case_representatives DROP COLUMN IF EXISTS consent_request_url`);
  // If an older `consent_token` plaintext column exists, drop it — never store plaintext tokens.
  await db.execute(`ALTER TABLE case_representatives DROP COLUMN IF EXISTS consent_token`);
  await db.execute(`DROP INDEX IF EXISTS case_reps_consent_token_idx`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_reps_case_idx ON case_representatives(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_reps_party_idx ON case_representatives(party_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_reps_consent_token_hash_idx ON case_representatives(consent_token_hash) WHERE consent_token_hash IS NOT NULL`);

  // Task #202 — Client-owned representatives master list (Rolodex). Each
  // case_representatives row is now an *attachment* of a client_representatives
  // master record. The master holds person-level fields; the attachment holds
  // case-scoped state (notes, preferred channel, GDPR consent).
  await db.execute(`CREATE TABLE IF NOT EXISTS client_representatives (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    role_title TEXT,
    organisation TEXT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    phone_code TEXT DEFAULT '+44',
    address_line_1 TEXT,
    address_line_2 TEXT,
    city TEXT,
    postcode TEXT,
    country TEXT DEFAULT 'United Kingdom',
    created_by VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS client_reps_client_idx ON client_representatives(client_id)`);
  // Per-client uniqueness on (lower(email), lower(full_name)). Skip rows where
  // email is NULL so two namesakes without contact details can both exist.
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS client_reps_dedupe_idx
    ON client_representatives(client_id, lower(email), lower(full_name))
    WHERE email IS NOT NULL`);
  // Attachment-side FK back to the master. Nullable for the backfill window;
  // the service layer always sets it on new rows.
  await db.execute(`ALTER TABLE case_representatives ADD COLUMN IF NOT EXISTS client_representative_id VARCHAR`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_reps_client_rep_idx ON case_representatives(client_representative_id) WHERE client_representative_id IS NOT NULL`);

  // Idempotent backfill: every existing case_representatives row without a
  // master FK gets matched (or created) against the owning client's Rolodex.
  //
  // Spec (Task #202): when email is present, dedupe on
  // (client_id, lower(email), lower(full_name)). When email is NULL, do NOT
  // collapse namesakes — every null-email attachment becomes its own master
  // row. We process row-by-row in JS rather than as a single SQL CTE so the
  // null-email "always insert" branch is unambiguous and easy to audit.
  // The volume here is bounded: this only runs for un-backed legacy rows on
  // boot, so a per-row loop is acceptable.
  const unbackedResult = await db.execute(sql`
    SELECT cr.id          AS attachment_id,
           p.client_id    AS client_id,
           cr.type, cr.role_title, cr.organisation,
           trim(cr.full_name)         AS full_name,
           nullif(trim(cr.email), '') AS email,
           cr.phone, cr.phone_code,
           cr.address_line_1, cr.address_line_2, cr.city, cr.postcode, cr.country,
           cr.created_by, cr.created_at
      FROM case_representatives cr
      JOIN parties p ON p.id = cr.party_id
     WHERE cr.client_representative_id IS NULL
  `);
  const unbackedRows = (unbackedResult as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  for (const row of unbackedRows) {
    const clientId = String(row.client_id);
    const fullName = String(row.full_name ?? "").trim();
    const email = row.email == null ? null : String(row.email);
    if (!fullName) continue; // legacy junk row, skip silently

    let masterId: string | undefined;

    // Email-bearing rows: try to fold into an existing master keyed by
    // (client, lower(email), lower(name)). Null-email rows skip this branch
    // entirely so namesakes can coexist.
    if (email) {
      const found = await db.execute(sql`
        SELECT id FROM client_representatives
         WHERE client_id = ${clientId}
           AND lower(nullif(trim(email), '')) = ${email.trim().toLowerCase()}
           AND lower(trim(full_name))         = ${fullName.toLowerCase()}
         LIMIT 1
      `);
      const foundRow = ((found as unknown as { rows?: Array<{ id: string }> }).rows ?? [])[0];
      masterId = foundRow?.id;
    }

    if (!masterId) {
      const inserted = await db.execute(sql`
        INSERT INTO client_representatives
          (client_id, type, role_title, organisation, full_name, email, phone, phone_code,
           address_line_1, address_line_2, city, postcode, country, created_by, created_at, updated_at)
        VALUES
          (${clientId}, ${row.type}, ${row.role_title}, ${row.organisation},
           ${fullName}, ${email}, ${row.phone}, ${row.phone_code},
           ${row.address_line_1}, ${row.address_line_2}, ${row.city}, ${row.postcode}, ${row.country},
           ${row.created_by}, ${row.created_at}, ${row.created_at})
        RETURNING id
      `);
      const insertedRow = ((inserted as unknown as { rows?: Array<{ id: string }> }).rows ?? [])[0];
      if (!insertedRow) continue;
      masterId = insertedRow.id;
    }

    await db.execute(sql`
      UPDATE case_representatives
         SET client_representative_id = ${masterId}
       WHERE id = ${row.attachment_id}
    `);
  }

  // Add a real FK from attachment → master. Idempotent guard via DO block so
  // the constraint is only created once. ON DELETE SET NULL because the
  // service-layer already blocks deleting a master that has live attachments;
  // SET NULL is a safety net for any out-of-band deletion.
  await db.execute(`DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'case_reps_client_rep_fk'
      ) THEN
        ALTER TABLE case_representatives
          ADD CONSTRAINT case_reps_client_rep_fk
          FOREIGN KEY (client_representative_id)
          REFERENCES client_representatives(id)
          ON DELETE SET NULL;
      END IF;
    END $$;`);

  // Task #171 — Mediator Profile & Compliance Hub.
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_profiles (
    user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT, middle_name TEXT, last_name TEXT,
    preferred_display_name TEXT, date_of_birth TEXT,
    profile_photo_url TEXT, profile_photo_approved BOOLEAN DEFAULT false,
    mobile_phone TEXT, mobile_phone_code TEXT DEFAULT '+44',
    additional_phone TEXT, additional_phone_code TEXT DEFAULT '+44',
    address_line_1 TEXT, address_line_2 TEXT, city TEXT,
    postcode TEXT, country TEXT DEFAULT 'United Kingdom',
    next_of_kin_name TEXT, next_of_kin_phone TEXT, next_of_kin_relationship TEXT,
    edi_sex TEXT, edi_gender_identity TEXT, edi_gender_self_describe TEXT,
    edi_ethnicity TEXT, edi_ethnicity_self_describe TEXT,
    edi_disability JSONB DEFAULT '[]'::jsonb, edi_disability_details TEXT,
    edi_first_language TEXT, edi_country_of_birth TEXT,
    edi_religion TEXT, edi_sexual_orientation TEXT,
    fmc_urn TEXT, fmc_accreditation_status TEXT, fmc_accreditation_date TEXT,
    cmc_reg_number TEXT, other_regulator_name TEXT, other_regulator_number TEXT,
    higher_qualifications TEXT,
    pi_provider TEXT, pi_policy_number TEXT, pi_cover_amount TEXT,
    pi_expiry_date TEXT, pi_certificate_url TEXT,
    ico_registration TEXT, ico_expiry_date TEXT,
    dbs_level TEXT, dbs_cert_number TEXT, dbs_issue_date TEXT, dbs_certificate_url TEXT,
    ppc_supervisor_name TEXT, ppc_supervisor_org TEXT, ppc_supervisor_email TEXT,
    practises_at_firms JSONB DEFAULT '[]'::jsonb,
    mediation_types JSONB DEFAULT '[]'::jsonb,
    mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified',
    family_sub_types JSONB DEFAULT '[]'::jsonb,
    workplace_sub_types JSONB DEFAULT '[]'::jsonb,
    civil_sub_types JSONB DEFAULT '[]'::jsonb,
    commercial_sub_types JSONB DEFAULT '[]'::jsonb,
    other_sub_types JSONB DEFAULT '[]'::jsonb,
    specialisms JSONB DEFAULT '[]'::jsonb,
    court_form_packages JSONB DEFAULT '[]'::jsonb,
    moj_voucher_eligible BOOLEAN DEFAULT false,
    solo_co_matrix JSONB DEFAULT '{}'::jsonb,
    can_supervise_wtas BOOLEAN DEFAULT false,
    co_mediation_cap INTEGER DEFAULT 1,
    high_conflict_opt_in BOOLEAN DEFAULT false,
    safeguarding_flagged_opt_in BOOLEAN DEFAULT false,
    geographic_coverage TEXT,
    bio_status TEXT DEFAULT 'draft',
    bio_long TEXT, bio_short TEXT,
    bio_approved_version_id VARCHAR, bio_approved_at TIMESTAMP,
    speaks_other_languages BOOLEAN DEFAULT false,
    languages_spoken JSONB DEFAULT '[]'::jsonb,
    bio_auto_tags JSONB DEFAULT '[]'::jsonb,
    bio_years_of_experience INTEGER,
    has_specific_skills BOOLEAN DEFAULT false,
    specific_skills JSONB DEFAULT '[]'::jsonb,
    working_days JSONB DEFAULT '[]'::jsonb,
    working_hours_start TEXT, working_hours_end TEXT,
    hours_per_week_cap INTEGER,
    engagement_type TEXT, contract_version TEXT,
    contract_signed_date TEXT, contract_file_url TEXT,
    timebank_agreement BOOLEAN DEFAULT false,
    timebank_signed_date TEXT, timebank_hours_per_week INTEGER,
    timebank_checkin_day TEXT, timebank_checkin_time TEXT,
    timebank_hours_cap INTEGER, timebank_pilot_start TEXT, timebank_review_date TEXT,
    onboarding_complete BOOLEAN DEFAULT false,
    panel_status TEXT DEFAULT 'Active', panel_status_reason TEXT,
    offboarding_date TEXT, offboarding_reason TEXT,
    bank_sort_code TEXT, bank_account_number TEXT, bank_account_name TEXT,
    vat_registered BOOLEAN DEFAULT false, vat_number TEXT,
    self_billing_agreement BOOLEAN DEFAULT false, self_billing_signed_date TEXT,
    utr TEXT, payment_terms INTEGER DEFAULT 30,
    safeguarding_training_date TEXT, safeguarding_provider TEXT,
    safeguarding_cert_url TEXT, safeguarding_refresher_due TEXT,
    confidentiality_signed_date TEXT, gdpr_training_date TEXT,
    annual_review_last TEXT, annual_review_next TEXT, annual_review_outcome TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  // Idempotent ALTERs for installs that pre-date the bio auto-derivation columns.
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS bio_auto_tags JSONB DEFAULT '[]'::jsonb`);
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS bio_years_of_experience INTEGER`);
  // Task #219 — PPC supervisor expanded fields (phone, last sign-off, next review).
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS ppc_supervisor_phone TEXT`);
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS ppc_supervisor_last_signoff TEXT`);
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS ppc_supervisor_next_review TEXT`);
  // Task #222 — structured geographic coverage multi-select (coexists with
  // the legacy free-text `geographic_coverage` column).
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS geographic_coverage_areas JSONB DEFAULT '[]'::jsonb`);
  // Task #226 — per-day working hours map (replaces single global start/end
  // pair in UI; service keeps legacy columns in sync for the booking engine).
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS working_hours_by_day JSONB DEFAULT '{}'::jsonb`);
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified'`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_cpd_entries (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL, activity TEXT NOT NULL, hours TEXT, evidence_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_cpd_mediator_idx ON mediator_cpd_entries(mediator_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_references (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, role TEXT, organisation TEXT,
    email TEXT, phone TEXT, date_checked TEXT,
    status TEXT NOT NULL DEFAULT 'pending', notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_references_mediator_idx ON mediator_references(mediator_id)`);
  await db.execute(`ALTER TABLE mediator_references ADD COLUMN IF NOT EXISTS verified_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediator_references ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_applicants (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT, source TEXT, notes TEXT,
    stage TEXT NOT NULL DEFAULT 'recruitment_approach',
    rejected_reason TEXT,
    converted_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    converted_at TIMESTAMP,
    created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_applicants_stage_idx ON mediator_applicants(stage)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_applicants_email_idx ON mediator_applicants(email)`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS accreditation_status TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS area_of_practice TEXT`);
  // Migrate area_of_practice from single TEXT to TEXT[] (idempotent — only runs
  // when the column is still scalar text). Wraps any existing single value
  // into a one-element array; NULLs stay NULL.
  await db.execute(`DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'mediator_applicants'
          AND column_name = 'area_of_practice'
          AND data_type = 'text'
      ) THEN
        ALTER TABLE mediator_applicants
          ALTER COLUMN area_of_practice TYPE TEXT[]
          USING CASE
            WHEN area_of_practice IS NULL THEN NULL
            WHEN area_of_practice = '' THEN NULL
            ELSE ARRAY[area_of_practice]
          END;
      END IF;
    END $$;`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_trainings (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, provider TEXT, date TEXT,
    cert_name TEXT, cert_url TEXT, notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_trainings_mediator_idx ON mediator_trainings(mediator_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_holidays (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, label TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_holidays_mediator_idx ON mediator_holidays(mediator_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_complaints (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL, case_id VARCHAR, summary TEXT, outcome TEXT, sign_off TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_complaints_mediator_idx ON mediator_complaints(mediator_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_timebank_entries (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL, activity TEXT NOT NULL, hours TEXT NOT NULL, type TEXT NOT NULL,
    approved_by_margaret BOOLEAN DEFAULT false, notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_timebank_mediator_idx ON mediator_timebank_entries(mediator_id)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_consents (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL, granted BOOLEAN NOT NULL DEFAULT false,
    granted_at TIMESTAMP, withdrawn_at TIMESTAMP, notes TEXT
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_consents_mediator_idx ON mediator_consents(mediator_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_consents_mediator_type_unique ON mediator_consents(mediator_id, consent_type)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_bio_versions (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bio_long TEXT, bio_short TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    submitted_by VARCHAR, submitted_at TIMESTAMP,
    reviewed_by VARCHAR, reviewed_at TIMESTAMP, review_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_bio_versions_mediator_idx ON mediator_bio_versions(mediator_id)`);

  // Task #185 — Mediator pipeline Kanban: applicant stage value migration +
  // new lifecycle_stage column on mediator_profiles. Idempotent.
  await db.execute(`UPDATE mediator_applicants SET stage='recruitment_approach' WHERE stage='prospect'`);
  await db.execute(`UPDATE mediator_applicants SET stage='reference_credential_check' WHERE stage='screening'`);
  await db.execute(`ALTER TABLE mediator_profiles ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT`);

  // Task #207 — Reference & Credential Check workflow at applicant stage
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_applicant_checks (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_id VARCHAR NOT NULL REFERENCES mediator_applicants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reference_number TEXT, provider TEXT,
    issued_at TEXT, expires_at TEXT,
    evidence_url TEXT, notes TEXT,
    ppc_supervisor_name TEXT,
    ppc_supervisor_org TEXT,
    ppc_supervisor_email TEXT,
    ppc_supervisor_phone TEXT,
    ppc_supervisor_last_signoff TEXT,
    ppc_supervisor_next_review TEXT,
    requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
    requested_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    verified_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
  )`);
  await db.execute(`ALTER TABLE mediator_applicant_checks ADD COLUMN IF NOT EXISTS ppc_supervisor_name TEXT`);
  await db.execute(`ALTER TABLE mediator_applicant_checks ADD COLUMN IF NOT EXISTS ppc_supervisor_org TEXT`);
  await db.execute(`ALTER TABLE mediator_applicant_checks ADD COLUMN IF NOT EXISTS ppc_supervisor_email TEXT`);
  await db.execute(`ALTER TABLE mediator_applicant_checks ADD COLUMN IF NOT EXISTS ppc_supervisor_phone TEXT`);
  await db.execute(`ALTER TABLE mediator_applicant_checks ADD COLUMN IF NOT EXISTS ppc_supervisor_last_signoff TEXT`);
  await db.execute(`ALTER TABLE mediator_applicant_checks ADD COLUMN IF NOT EXISTS ppc_supervisor_next_review TEXT`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_applicant_checks_applicant_kind_uniq ON mediator_applicant_checks(applicant_id, kind)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_applicant_references (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_id VARCHAR NOT NULL REFERENCES mediator_applicants(id) ON DELETE CASCADE,
    referee_name TEXT NOT NULL,
    referee_email TEXT NOT NULL,
    referee_phone TEXT, organisation TEXT, relationship TEXT,
    status TEXT NOT NULL DEFAULT 'pending', notes TEXT,
    requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
    requested_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMP,
    verified_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_applicant_references_applicant_idx ON mediator_applicant_references(applicant_id)`);

  // Task #260 â€” Per-service approval workflow with proof uploads and expiry tracking.
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_service_approvals (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_id VARCHAR REFERENCES mediator_applicants(id) ON DELETE CASCADE,
    mediator_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
    service_type_id VARCHAR NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'requested',
    proof_file_name TEXT,
    proof_file_url TEXT,
    proof_link TEXT,
    proof_mime_type TEXT,
    expiry_date TEXT,
    submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    requested_at TIMESTAMP,
    requested_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    review_reason TEXT,
    manual_approval_note TEXT,
    calendar_start_at TIMESTAMP,
    calendar_end_at TIMESTAMP,
    calendar_title TEXT,
    calendar_notes TEXT,
    calendar_google_event_id TEXT,
    calendar_updated_at TIMESTAMP,
    reminder_sent_at TIMESTAMP,
    expired_at TIMESTAMP
  )`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_approvals_mediator_service_unique ON mediator_service_approvals(mediator_id, service_type_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_approvals_applicant_service_unique ON mediator_service_approvals(applicant_id, service_type_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_service_approvals_service_idx ON mediator_service_approvals(service_type_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_service_approvals_status_idx ON mediator_service_approvals(status)`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS calendar_start_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS calendar_end_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS calendar_title TEXT`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS calendar_notes TEXT`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS calendar_google_event_id TEXT`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS calendar_updated_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_service_approvals ADD COLUMN IF NOT EXISTS manual_approval_note TEXT`);
  // Task #229 — Public mediator application link. One active row; POST replaces.
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_service_schedule_slots (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type_id VARCHAR NOT NULL REFERENCES service_types(id) ON DELETE CASCADE,
    start_at TIMESTAMP NOT NULL,
    end_at TIMESTAMP NOT NULL,
    google_event_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_schedule_slots_unique
    ON mediator_service_schedule_slots(mediator_id, service_type_id, start_at, end_at)`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS google_event_id TEXT`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
  await db.execute(`INSERT INTO mediator_service_schedule_slots (mediator_id, service_type_id, start_at, end_at, google_event_id, created_at, updated_at)
    SELECT mediator_id, service_type_id, calendar_start_at, calendar_end_at, calendar_google_event_id, COALESCE(calendar_updated_at, submitted_at, NOW()), COALESCE(calendar_updated_at, submitted_at, NOW())
    FROM mediator_service_approvals
    WHERE mediator_id IS NOT NULL AND calendar_start_at IS NOT NULL AND calendar_end_at IS NOT NULL
    ON CONFLICT (mediator_id, service_type_id, start_at, end_at) DO NOTHING`);

  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_application_links (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  // Task #244 — Applicant-initiated form update token (one-time, 7-day expiry)
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS update_token TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS update_token_expires_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS update_token_used_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS update_token_purpose TEXT`);

  // Task #208 — Applicant contract & registrations columns. All nullable,
  // additive; carried into mediator_profiles on conversion when populated.
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS engagement_type TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS contract_version TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS contract_signed_date TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS contract_file_url TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS timebank_agreement BOOLEAN DEFAULT false`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS timebank_signed_date TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS timebank_hours_per_week INTEGER`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS timebank_checkin_day TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS timebank_checkin_time TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS timebank_file_url TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS fmc_urn TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS fmc_accreditation_status TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS fmc_accreditation_date TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS cmc_reg_number TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS other_regulator_name TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS other_regulator_number TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS higher_qualifications TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS pi_provider TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS pi_policy_number TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS pi_cover_amount TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS pi_expiry_date TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS pi_certificate_url TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ico_registration TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ico_expiry_date TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ico_evidence_url TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS dbs_level TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS dbs_cert_number TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS dbs_issue_date TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS dbs_certificate_url TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ppc_supervisor_name TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ppc_supervisor_org TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ppc_supervisor_email TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ppc_supervisor_phone TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ppc_supervisor_last_signoff TEXT`);
  await db.execute(`ALTER TABLE mediator_applicants ADD COLUMN IF NOT EXISTS ppc_supervisor_next_review TEXT`);
  // Backfill from panel_status: Off-boarded → off_boarded; everything else with
  // any panel_status set → active_on_panel. Profiles with no panel_status stay
  // null and the pipeline will treat them as onboarding_portal_access.
  await db.execute(`UPDATE mediator_profiles SET lifecycle_stage='off_boarded' WHERE lifecycle_stage IS NULL AND panel_status='Off-boarded'`);
  // Default any remaining non-offboarded profile (including panel_status NULL)
  // to active_on_panel — these are existing live mediators on the platform.
  await db.execute(`UPDATE mediator_profiles SET lifecycle_stage='active_on_panel' WHERE lifecycle_stage IS NULL AND (panel_status IS NULL OR panel_status<>'Off-boarded')`);

  // Task #189 — Daily BFM info@ calendar health-check alert toggle. Default OFF
  // so existing deployments stop the daily failure email immediately on merge.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bfm_calendar_connection (
      id VARCHAR PRIMARY KEY,
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_calendar_connected BOOLEAN NOT NULL DEFAULT false,
      google_calendar_email TEXT,
      google_token_expires_at TIMESTAMP,
      google_scope_granted TEXT,
      last_health_check_at TIMESTAMP,
      last_health_check_error TEXT,
      connected_at TIMESTAMP,
      connected_by_user_id VARCHAR,
      health_check_alerts_enabled BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`ALTER TABLE bfm_calendar_connection ADD COLUMN IF NOT EXISTS health_check_alerts_enabled BOOLEAN NOT NULL DEFAULT false`);

  // Task #255 — Contractor Pipeline: new tables for applicants and application links.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contractor_applicants (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      contractor_type TEXT,
      source TEXT,
      notes TEXT,
      stage TEXT NOT NULL DEFAULT 'prospect',
      converted_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      converted_at TIMESTAMP,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS contractor_applicants_stage_idx ON contractor_applicants(stage)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS contractor_applicants_email_idx ON contractor_applicants(email)`);
  await db.execute(`ALTER TABLE contractor_applicants ADD COLUMN IF NOT EXISTS rejected_reason TEXT`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contractor_application_links (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      token TEXT NOT NULL UNIQUE,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // WhatsApp communication system: Meta webhook intake, conversation state,
  // OTP verification, attachment metadata, and outbound retry tracking.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_contacts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number TEXT NOT NULL,
      display_name TEXT,
      client_id VARCHAR REFERENCES clients(id) ON DELETE SET NULL,
      party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      case_id VARCHAR REFERENCES cases(id) ON DELETE SET NULL,
      enquiry_id VARCHAR REFERENCES enquiries(id) ON DELETE SET NULL,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contacts_phone_number_idx ON whatsapp_contacts(phone_number)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_contacts_case_idx ON whatsapp_contacts(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_contacts_enquiry_idx ON whatsapp_contacts(enquiry_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id VARCHAR NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open',
      flow_type TEXT NOT NULL DEFAULT 'start',
      automation_state TEXT NOT NULL DEFAULT 'awaiting_menu',
      automation_paused BOOLEAN NOT NULL DEFAULT false,
      case_id VARCHAR REFERENCES cases(id) ON DELETE SET NULL,
      enquiry_id VARCHAR REFERENCES enquiries(id) ON DELETE SET NULL,
      assigned_to VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      customer_service_window_expires_at TIMESTAMP,
      last_inbound_at TIMESTAMP,
      last_outbound_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_conversations_contact_idx ON whatsapp_conversations(contact_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_conversations_status_idx ON whatsapp_conversations(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_conversations_case_idx ON whatsapp_conversations(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_conversations_enquiry_idx ON whatsapp_conversations(enquiry_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_conversations_window_idx ON whatsapp_conversations(customer_service_window_expires_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id VARCHAR NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
      meta_message_id TEXT,
      direction TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      body TEXT,
      template_name TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      error_payload TEXT,
      raw_payload JSONB DEFAULT '{}'::jsonb,
      sent_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_meta_message_id_idx ON whatsapp_messages(meta_message_id) WHERE meta_message_id IS NOT NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_idx ON whatsapp_messages(conversation_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_messages_created_at_idx ON whatsapp_messages(created_at)`);
  await db.execute(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS case_id VARCHAR REFERENCES cases(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS client_id VARCHAR REFERENCES clients(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS content_classification TEXT NOT NULL DEFAULT 'ordinary'`);
  await db.execute(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS case_assignment_source TEXT`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_messages_case_idx ON whatsapp_messages(case_id, created_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_messages_party_idx ON whatsapp_messages(party_id, created_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_otps (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id VARCHAR NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
      case_id VARCHAR REFERENCES cases(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      verified_at TIMESTAMP,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_otps_conversation_idx ON whatsapp_otps(conversation_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_otps_case_idx ON whatsapp_otps(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_otps_expires_idx ON whatsapp_otps(expires_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id VARCHAR NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
      case_id VARCHAR REFERENCES cases(id) ON DELETE SET NULL,
      meta_media_id TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      storage_url TEXT,
      status TEXT NOT NULL DEFAULT 'metadata_only',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_attachments_message_idx ON whatsapp_attachments(message_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_attachments_case_idx ON whatsapp_attachments(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_attachments_meta_media_idx ON whatsapp_attachments(meta_media_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_outbox (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id VARCHAR NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_outbox_status_next_attempt_idx ON whatsapp_outbox(status, next_attempt_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_outbox_conversation_idx ON whatsapp_outbox(conversation_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_private_notes (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      source_conversation_id VARCHAR REFERENCES whatsapp_conversations(id) ON DELETE SET NULL, author_kind TEXT NOT NULL,
      author_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL, author_party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      author_role_snapshot TEXT NOT NULL, author_name_snapshot TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'draft',
      completed_at TIMESTAMP, cancelled_at TIMESTAMP, text_redacted_at TIMESTAMP, text_redacted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      text_redaction_reason TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_private_notes_case_idx ON case_private_notes(case_id, created_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_private_note_attachments (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), note_id VARCHAR NOT NULL REFERENCES case_private_notes(id) ON DELETE CASCADE,
      source_whatsapp_attachment_id VARCHAR REFERENCES whatsapp_attachments(id) ON DELETE SET NULL, source_message_id VARCHAR REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
      meta_media_id TEXT, file_name TEXT, declared_mime_type TEXT, detected_mime_type TEXT, size_bytes INTEGER, storage_key TEXT,
      status TEXT NOT NULL DEFAULT 'queued', retry_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processing_lease_expires_at TIMESTAMP, last_error TEXT, redacted_at TIMESTAMP, redacted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      redaction_reason TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_private_note_attachments_source_unique ON case_private_note_attachments(source_message_id) WHERE source_message_id IS NOT NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_private_note_attachments_work_idx ON case_private_note_attachments(status, next_attempt_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_private_note_sessions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id VARCHAR NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
      case_id VARCHAR REFERENCES cases(id) ON DELETE CASCADE, party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL,
      author_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL, note_id VARCHAR REFERENCES case_private_notes(id) ON DELETE SET NULL,
      otp_id VARCHAR REFERENCES whatsapp_otps(id) ON DELETE SET NULL, state TEXT NOT NULL DEFAULT 'awaiting_case_reference', case_reference_input TEXT,
      identity_email_hash TEXT, lookup_attempt_count INTEGER NOT NULL DEFAULT 0, verified_at TIMESTAMP, expires_at TIMESTAMP NOT NULL,
      completed_at TIMESTAMP, cancelled_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_private_note_sessions_one_active_idx ON whatsapp_private_note_sessions(conversation_id) WHERE completed_at IS NULL AND cancelled_at IS NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_private_note_sessions_expiry_idx ON whatsapp_private_note_sessions(expires_at)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS party_whatsapp_preferences (
      party_id VARCHAR PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'unknown', source TEXT,
      recorded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL, recorded_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_template_catalog (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), meta_template_id TEXT NOT NULL, name TEXT NOT NULL, language TEXT NOT NULL,
      category TEXT, status TEXT NOT NULL, components JSONB NOT NULL DEFAULT '[]'::jsonb, parameter_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
      header_media_type TEXT, last_synced_at TIMESTAMP NOT NULL DEFAULT NOW(), created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(name, language)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_outbound_media (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE, conversation_id VARCHAR REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL, source_document_id VARCHAR REFERENCES case_documents(id) ON DELETE SET NULL, file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, storage_key TEXT, meta_media_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
      retry_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(), processing_lease_expires_at TIMESTAMP,
      last_error TEXT, created_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS whatsapp_outbound_media_work_idx ON whatsapp_outbound_media(status, next_attempt_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS court_form_templates (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      form_type TEXT NOT NULL,
      version_label TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      source_file_url TEXT NOT NULL,
      storage_key TEXT,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      is_current BOOLEAN NOT NULL DEFAULT false,
      uploaded_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
      notes TEXT,
      verified_current_at TIMESTAMP,
      verified_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      field_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      field_metadata JSONB NOT NULL DEFAULT '[]'::jsonb,
      field_mapping JSONB NOT NULL DEFAULT '[]'::jsonb,
      deleted_at TIMESTAMP,
      deleted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await db.execute(`ALTER TABLE court_form_templates ADD COLUMN IF NOT EXISTS field_metadata JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(`ALTER TABLE court_form_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
  await db.execute(`ALTER TABLE court_form_templates ADD COLUMN IF NOT EXISTS deleted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_templates_type_idx ON court_form_templates(form_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_templates_current_idx ON court_form_templates(form_type, is_current)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_templates_deleted_idx ON court_form_templates(deleted_at)`);
  await db.execute(`DROP INDEX IF EXISTS court_form_templates_type_version_unique`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS court_form_templates_type_version_unique ON court_form_templates(form_type, version_label) WHERE deleted_at IS NULL`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS court_form_guidance (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      form_type TEXT NOT NULL,
      template_id VARCHAR REFERENCES court_form_templates(id) ON DELETE CASCADE,
      section_key TEXT NOT NULL,
      section_title TEXT NOT NULL,
      body TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      legal_signoff_status TEXT NOT NULL DEFAULT 'draft',
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_guidance_type_idx ON court_form_guidance(form_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_guidance_template_idx ON court_form_guidance(template_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS court_form_guidance_template_section_unique ON court_form_guidance(template_id, section_key)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS court_form_drafts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      form_type TEXT NOT NULL,
      template_id VARCHAR REFERENCES court_form_templates(id) ON DELETE SET NULL,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      updated_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS court_form_drafts_case_party_type_unique ON court_form_drafts(case_id, party_id, form_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_drafts_case_idx ON court_form_drafts(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_drafts_party_idx ON court_form_drafts(party_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS court_form_generations (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      party_id VARCHAR NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      template_id VARCHAR NOT NULL REFERENCES court_form_templates(id) ON DELETE RESTRICT,
      template_version_label TEXT NOT NULL,
      draft_id VARCHAR REFERENCES court_form_drafts(id) ON DELETE SET NULL,
      case_document_id VARCHAR REFERENCES case_documents(id) ON DELETE SET NULL,
      generated_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'requested',
      recipient_email TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'not_attempted',
      delivery_last_attempted_at TIMESTAMP,
      delivery_last_error TEXT,
      resend_history JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_generations_case_idx ON court_form_generations(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_generations_party_idx ON court_form_generations(party_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_generations_template_idx ON court_form_generations(template_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS court_form_generations_document_idx ON court_form_generations(case_document_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_proofing_items (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      session_id VARCHAR REFERENCES mediation_sessions(id) ON DELETE SET NULL,
      item_type TEXT NOT NULL,
      source_entity_type TEXT NOT NULL,
      source_entity_id VARCHAR NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_review',
      submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      return_comments TEXT,
      returned_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      returned_at TIMESTAMP,
      withdrawn_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      withdrawn_at TIMESTAMP,
      withdraw_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_proofing_items_source_unique ON case_proofing_items(source_entity_type, source_entity_id, item_type)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_proofing_items_case_idx ON case_proofing_items(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_proofing_items_session_idx ON case_proofing_items(session_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_proofing_items_status_idx ON case_proofing_items(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_proofing_items_item_type_idx ON case_proofing_items(item_type)`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS case_proofing_item_cycles (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      proofing_item_id VARCHAR NOT NULL REFERENCES case_proofing_items(id) ON DELETE CASCADE,
      cycle_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_review',
      submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
      reviewed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP,
      return_comments TEXT,
      returned_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      returned_at TIMESTAMP,
      withdrawn_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      withdrawn_at TIMESTAMP,
      withdraw_reason TEXT,
      source_entity_type TEXT NOT NULL,
      source_entity_id VARCHAR NOT NULL,
      file_name TEXT,
      document_date TIMESTAMP,
      upload_date TIMESTAMP,
      source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_proofing_item_cycles_item_cycle_unique ON case_proofing_item_cycles(proofing_item_id, cycle_number)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_proofing_item_cycles_item_idx ON case_proofing_item_cycles(proofing_item_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_proofing_item_cycles_status_idx ON case_proofing_item_cycles(status)`);
  await db.execute(`
    INSERT INTO case_proofing_items (case_id, session_id, item_type, source_entity_type, source_entity_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, created_at, updated_at)
    SELECT case_id, id, 'session_summary', 'mediation_session', id,
      CASE WHEN post_session_review_status = 'approved' THEN 'approved' ELSE 'awaiting_review' END,
      summary_submitted_by, COALESCE(summary_submitted_at, updated_at, created_at, NOW()), post_session_reviewed_by, post_session_reviewed_at,
      COALESCE(summary_submitted_at, created_at, NOW()), NOW()
    FROM mediation_sessions
    WHERE post_session_review_status IN ('submitted', 'changes_requested', 'approved')
    ON CONFLICT (source_entity_type, source_entity_id, item_type) DO NOTHING
  `);
  await db.execute(`
    INSERT INTO case_proofing_items (case_id, session_id, item_type, source_entity_type, source_entity_id, status, submitted_by, submitted_at, created_at, updated_at)
    SELECT case_id, confirmed_in_session_id, 'draft_financial_schedule', 'case_draft_financial_schedule', id,
      'awaiting_review', confirmed_by, COALESCE(confirmed_at, updated_at, created_at, NOW()), COALESCE(confirmed_at, created_at, NOW()), NOW()
    FROM case_draft_financial_schedules
    WHERE status = 'confirmed'
    ON CONFLICT (source_entity_type, source_entity_id, item_type) DO NOTHING
  `);
  await db.execute(`
    INSERT INTO case_proofing_items (case_id, session_id, item_type, source_entity_type, source_entity_id, status, submitted_by, submitted_at, created_at, updated_at)
    SELECT f.case_id, NULL, 'financial_disclosure_checklist', 'financial_disclosure_item', i.id,
      'awaiting_review', i.updated_by, COALESCE(i.updated_at, i.created_at, NOW()), COALESCE(i.created_at, NOW()), NOW()
    FROM financial_disclosure_items i
    JOIN financial_disclosure_folders f ON f.id = i.folder_id
    WHERE i.item_type = 'financial_disclosure_checklist'
    ON CONFLICT (source_entity_type, source_entity_id, item_type) DO NOTHING
  `);
  await db.execute(`
    INSERT INTO case_proofing_items (case_id, session_id, item_type, source_entity_type, source_entity_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, created_at, updated_at)
    SELECT g.case_id, NULL, 'court_form', 'court_form_generation', g.id,
      CASE WHEN d.review_status = 'reviewed' THEN 'approved' ELSE 'awaiting_review' END,
      g.generated_by, COALESCE(g.generated_at, d.ready_for_review_at, d.created_at, NOW()), d.reviewed_by, d.reviewed_at,
      COALESCE(g.generated_at, d.created_at, NOW()), NOW()
    FROM court_form_generations g
    LEFT JOIN case_documents d ON d.id = g.case_document_id
    ON CONFLICT (source_entity_type, source_entity_id, item_type) DO NOTHING
  `);
  await db.execute(`
    INSERT INTO case_proofing_items (case_id, session_id, item_type, source_entity_type, source_entity_id, status, submitted_by, submitted_at, reviewed_by, reviewed_at, created_at, updated_at)
    SELECT case_id, mediation_session_id, 'case_document', 'case_document', id,
      CASE WHEN review_status = 'reviewed' THEN 'approved' ELSE 'awaiting_review' END,
      uploaded_by, COALESCE(ready_for_review_at, created_at, NOW()), reviewed_by, reviewed_at, COALESCE(created_at, NOW()), NOW()
    FROM case_documents
    WHERE review_status IN ('ready_for_review', 'reviewed')
    ON CONFLICT (source_entity_type, source_entity_id, item_type) DO NOTHING
  `);
  await db.execute(`
    INSERT INTO case_proofing_item_cycles (
      proofing_item_id, cycle_number, status, submitted_by, submitted_at, reviewed_by, reviewed_at,
      return_comments, returned_by, returned_at, withdrawn_by, withdrawn_at, withdraw_reason,
      source_entity_type, source_entity_id, file_name, document_date, upload_date, source_metadata, created_at, updated_at
    )
    SELECT p.id, 1, p.status, p.submitted_by, p.submitted_at, p.reviewed_by, p.reviewed_at,
      p.return_comments, p.returned_by, p.returned_at, p.withdrawn_by, p.withdrawn_at, p.withdraw_reason,
      p.source_entity_type, p.source_entity_id, d.file_name, d.document_date, COALESCE(d.created_at, p.submitted_at),
      jsonb_build_object('itemType', p.item_type, 'sourceEntityType', p.source_entity_type, 'sourceEntityId', p.source_entity_id),
      p.created_at, NOW()
    FROM case_proofing_items p
    LEFT JOIN case_documents d ON p.source_entity_type = 'case_document' AND p.source_entity_id = d.id
    ON CONFLICT (proofing_item_id, cycle_number) DO NOTHING
  `);
  await db.execute(`
    UPDATE case_documents AS document
    SET
      shared_with_clients = FALSE,
      review_status = 'ready_for_review',
      reviewed_by = NULL,
      reviewed_at = NULL,
      ready_for_review_at = COALESCE(document.ready_for_review_at, document.created_at, NOW()),
      updated_at = NOW()
    WHERE document.document_category = 'draft_financial_schedule'
      AND EXISTS (
        SELECT 1
        FROM case_proofing_items AS proofing
        WHERE proofing.case_id = document.case_id
          AND proofing.item_type = 'draft_financial_schedule'
          AND proofing.status <> 'approved'
          AND (proofing.session_id IS NULL OR proofing.session_id = document.mediation_session_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM case_proofing_items AS approved_proofing
        WHERE approved_proofing.case_id = document.case_id
          AND approved_proofing.item_type = 'draft_financial_schedule'
          AND approved_proofing.status = 'approved'
          AND (approved_proofing.session_id IS NULL OR approved_proofing.session_id = document.mediation_session_id)
      )
  `);

  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS court_form_template_id VARCHAR`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS court_form_generation_id VARCHAR`);
  await db.execute(`ALTER TABLE party_required_forms ADD COLUMN IF NOT EXISTS generated_document_id VARCHAR`);

  await db.execute(`DO $$ BEGIN
    IF (SELECT count(*) FROM users WHERE role = 'superadmin') > 1 THEN
      RAISE EXCEPTION 'Cannot install confidential complaints: multiple superadmin users exist';
    END IF;
  END $$`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS users_single_superadmin_unique ON users(role) WHERE role = 'superadmin'`);
  await db.execute(`CREATE SEQUENCE IF NOT EXISTS case_complaint_ref_seq START WITH 1`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_complaints (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), complaint_ref TEXT NOT NULL UNIQUE DEFAULT ('CMP-' || lpad(nextval('case_complaint_ref_seq')::text, 6, '0')),
    case_id VARCHAR NOT NULL REFERENCES cases(id) ON DELETE RESTRICT, submitted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    submitted_by_role TEXT NOT NULL, submitter_name TEXT NOT NULL, submitter_email TEXT,
    complainant_party_id VARCHAR REFERENCES parties(id) ON DELETE SET NULL, submission_channel TEXT NOT NULL DEFAULT 'portal',
    on_behalf_of_name TEXT, on_behalf_of_email TEXT, category TEXT NOT NULL, target_type TEXT NOT NULL,
    target_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL, target_name TEXT, incident_date TEXT, details TEXT NOT NULL,
    desired_resolution TEXT, supporting_notes TEXT, status TEXT NOT NULL DEFAULT 'received', received_at TIMESTAMP NOT NULL DEFAULT NOW(),
    acknowledgement_due_at TIMESTAMP NOT NULL, acknowledged_at TIMESTAMP, acknowledged_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    response_due_at TIMESTAMP NOT NULL, next_update_at TIMESTAMP, final_response_at TIMESTAMP, closed_at TIMESTAMP, closed_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    escalated_at TIMESTAMP, outcome TEXT, resolution_summary TEXT, duplicate_of_id VARCHAR REFERENCES case_complaints(id) ON DELETE SET NULL,
    fmc_relevant_date TIMESTAMP, fmc_within_three_months BOOLEAN, receipt_email_status TEXT NOT NULL DEFAULT 'pending',
    receipt_email_last_attempted_at TIMESTAMP, receipt_email_sent_at TIMESTAMP, receipt_email_last_error TEXT,
    review_task_id VARCHAR, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaints_case_idx ON case_complaints(case_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaints_submitter_idx ON case_complaints(submitted_by)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaints_status_idx ON case_complaints(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaints_ack_due_idx ON case_complaints(acknowledgement_due_at)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaints_response_due_idx ON case_complaints(response_due_at)`);
  await db.execute(`ALTER TABLE case_complaints ADD COLUMN IF NOT EXISTS next_update_at TIMESTAMP`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_complaint_events (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), complaint_id VARCHAR NOT NULL REFERENCES case_complaints(id) ON DELETE CASCADE,
    type TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'internal', actor_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL, message TEXT, from_status TEXT, to_status TEXT,
    related_event_id VARCHAR REFERENCES case_complaint_events(id) ON DELETE SET NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    redacted_at TIMESTAMP, redacted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL, redaction_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaint_events_complaint_idx ON case_complaint_events(complaint_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaint_events_related_idx ON case_complaint_events(related_event_id)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS case_complaint_single_clarification_reply_idx
    ON case_complaint_events(related_event_id) WHERE type = 'clarification_replied'`);
  await db.execute(`CREATE OR REPLACE FUNCTION protect_case_complaint_events() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'case complaint events are append-only'; END IF;
      IF NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL THEN
        RAISE EXCEPTION 'case complaint event actor may only be cleared by retention handling';
      END IF;
      IF (to_jsonb(NEW) - 'actor_id' - 'redacted_at' - 'redacted_by' - 'redaction_reason') IS DISTINCT FROM
         (to_jsonb(OLD) - 'actor_id' - 'redacted_at' - 'redacted_by' - 'redaction_reason') THEN
        RAISE EXCEPTION 'case complaint event content is immutable';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
  await db.execute(`DROP TRIGGER IF EXISTS case_complaint_events_append_only ON case_complaint_events`);
  await db.execute(`CREATE TRIGGER case_complaint_events_append_only BEFORE UPDATE OR DELETE ON case_complaint_events
    FOR EACH ROW EXECUTE FUNCTION protect_case_complaint_events()`);
  await db.execute(`CREATE TABLE IF NOT EXISTS case_complaint_attachments (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), complaint_id VARCHAR NOT NULL REFERENCES case_complaints(id) ON DELETE CASCADE,
    event_id VARCHAR REFERENCES case_complaint_events(id) ON DELETE SET NULL, uploaded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, storage_key TEXT NOT NULL,
    redacted_at TIMESTAMP, redacted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL, redaction_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaint_attachments_complaint_idx ON case_complaint_attachments(complaint_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS case_complaint_attachments_event_idx ON case_complaint_attachments(event_id)`);
  await db.execute(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS complaint_id VARCHAR`);
  await db.execute(`DO $$ BEGIN IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE table_name='notifications'
      AND constraint_name='notifications_complaint_id_case_complaints_id_fk'
  ) THEN ALTER TABLE notifications ADD CONSTRAINT notifications_complaint_id_case_complaints_id_fk
    FOREIGN KEY (complaint_id) REFERENCES case_complaints(id) ON DELETE SET NULL; END IF; END $$`);
  await db.execute(`CREATE INDEX IF NOT EXISTS notifications_complaint_idx ON notifications(complaint_id)`);

  // Calendar availability imported from mediator-owned Google/Outlook events.
  // Keep this in lockstep with migrations 0064 and 0065.
  await db.execute(`CREATE TABLE IF NOT EXISTS mediator_calendar_availability_sources (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
    mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
    external_event_id TEXT NOT NULL,
    external_series_id TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('mediator_invite', 'bfm_service')),
    scope_mode TEXT NOT NULL CHECK (scope_mode IN ('all_approved_services', 'fixed_services')),
    title TEXT, is_all_day BOOLEAN NOT NULL DEFAULT false, start_at TIMESTAMP NOT NULL, end_at TIMESTAMP NOT NULL,
    provider_fingerprint TEXT NOT NULL, expected_provider_fingerprint TEXT,
    admin_task_id VARCHAR, audit_correlation_id VARCHAR NOT NULL DEFAULT gen_random_uuid(),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'historical', 'out_of_window', 'invalid', 'deleted', 'sync_error')),
    last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(), invalidated_at TIMESTAMP, deleted_at TIMESTAMP,
    historical_at TIMESTAMP, out_of_window_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_calendar_availability_source_event_unique ON mediator_calendar_availability_sources(mediator_id, provider, external_event_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_calendar_availability_source_series_idx ON mediator_calendar_availability_sources(mediator_id, provider, external_series_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS mediator_calendar_availability_source_state_idx ON mediator_calendar_availability_sources(state, last_seen_at)`);
  await db.execute(`ALTER TABLE mediator_calendar_availability_sources ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(`ALTER TABLE mediator_calendar_availability_sources ADD COLUMN IF NOT EXISTS historical_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_calendar_availability_sources ADD COLUMN IF NOT EXISTS out_of_window_at TIMESTAMP`);
  await db.execute(`ALTER TABLE mediator_calendar_availability_sources DROP CONSTRAINT IF EXISTS mediator_calendar_availability_sources_state_check`);
  await db.execute(`ALTER TABLE mediator_calendar_availability_sources ADD CONSTRAINT mediator_calendar_availability_sources_state_check CHECK (state IN ('active', 'historical', 'out_of_window', 'invalid', 'deleted', 'sync_error'))`);
  await db.execute(`ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS external_series_id TEXT`);
  await db.execute(`ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS organizer_email TEXT`);
  await db.execute(`CREATE TABLE IF NOT EXISTS outlook_calendar_events (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outlook_event_id TEXT NOT NULL, title TEXT, start_at TIMESTAMP NOT NULL, end_at TIMESTAMP NOT NULL,
    is_all_day BOOLEAN NOT NULL DEFAULT false, attendees JSONB DEFAULT '[]', bfm_attendance_status TEXT,
    is_organiser BOOLEAN NOT NULL DEFAULT false, synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(mediator_id, outlook_event_id)
  )`);
  await db.execute(`ALTER TABLE outlook_calendar_events ADD COLUMN IF NOT EXISTS external_series_id TEXT`);
  await db.execute(`ALTER TABLE outlook_calendar_events ADD COLUMN IF NOT EXISTS organizer_email TEXT`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS calendar_provider TEXT`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS availability_source_id VARCHAR REFERENCES mediator_calendar_availability_sources(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'active'`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS retired_reason TEXT`);
  await db.execute(`ALTER TABLE mediator_service_schedule_slots ADD COLUMN IF NOT EXISTS retired_at TIMESTAMP`);
  await db.execute(`INSERT INTO mediator_calendar_availability_sources (
      mediator_id, provider, external_event_id, origin, scope_mode, title, start_at, end_at, provider_fingerprint, last_seen_at
    )
    SELECT DISTINCT ON (mediator_id, COALESCE(calendar_provider, 'google'), google_event_id)
      mediator_id, COALESCE(calendar_provider, 'google'), google_event_id, 'bfm_service', 'fixed_services',
      'BFM service availability', start_at, end_at,
      'legacy_backfill:' || md5(COALESCE(calendar_provider, 'google') || ':' || google_event_id || ':' || start_at::text || ':' || end_at::text), NOW()
    FROM mediator_service_schedule_slots WHERE google_event_id IS NOT NULL
    ON CONFLICT (mediator_id, provider, external_event_id) DO NOTHING`);
  await db.execute(`UPDATE mediator_service_schedule_slots AS slot SET availability_source_id = source.id
    FROM mediator_calendar_availability_sources AS source
    WHERE slot.google_event_id IS NOT NULL AND source.mediator_id = slot.mediator_id
      AND source.provider = COALESCE(slot.calendar_provider, 'google')
      AND source.external_event_id = slot.google_event_id AND slot.availability_source_id IS NULL`);
  await db.execute(`DROP INDEX IF EXISTS mediator_service_schedule_slots_unique`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_schedule_slots_manual_unique
    ON mediator_service_schedule_slots(mediator_id, service_type_id, start_at, end_at)
    WHERE availability_source_id IS NULL AND lifecycle = 'active'`);
  await db.execute(`DROP INDEX IF EXISTS mediator_service_schedule_slots_source_service_unique`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mediator_service_schedule_slots_source_service_unique
    ON mediator_service_schedule_slots(availability_source_id, service_type_id, start_at, end_at)
    WHERE availability_source_id IS NOT NULL AND lifecycle = 'active'`);
  await db.execute(`CREATE TABLE IF NOT EXISTS calendar_webhook_subscriptions (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')), external_subscription_id TEXT,
    channel_id TEXT, resource_id TEXT, client_state_hash TEXT, status TEXT NOT NULL DEFAULT 'active',
    expires_at TIMESTAMP, last_notification_at TIMESTAMP, last_error TEXT, renewal_failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`ALTER TABLE calendar_webhook_subscriptions ADD COLUMN IF NOT EXISTS renewal_failure_count INTEGER NOT NULL DEFAULT 0`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS calendar_webhook_subscriptions_provider_external_unique ON calendar_webhook_subscriptions(provider, external_subscription_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS calendar_webhook_subscriptions_renewal_idx ON calendar_webhook_subscriptions(status, expires_at)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS calendar_availability_reconciliation_jobs (
    id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(), mediator_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')), trigger TEXT NOT NULL, dedupe_key TEXT NOT NULL,
    payload JSONB, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(), processing_lease_expires_at TIMESTAMP, last_attempt_at TIMESTAMP,
    completed_at TIMESTAMP, last_error TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS calendar_availability_reconciliation_jobs_due_idx ON calendar_availability_reconciliation_jobs(status, next_attempt_at)`);
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS calendar_availability_reconciliation_jobs_active_dedupe_unique
    ON calendar_availability_reconciliation_jobs(mediator_id, provider, dedupe_key) WHERE status IN ('pending', 'processing')`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS availability_source_id VARCHAR REFERENCES mediator_calendar_availability_sources(id) ON DELETE SET NULL`);
  await db.execute(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS availability_reservation_mode TEXT`);

  await seedDatabase();
  });
  logBootstrap(`Completed in ${Date.now() - startedAt}ms`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDatabaseBootstrap()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("[DbBootstrap] Failed", err);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
