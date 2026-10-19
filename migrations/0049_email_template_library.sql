ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS guidance text NOT NULL DEFAULT '';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS required_variables jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS content_override boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS email_template_links (
  key text PRIMARY KEY,
  label text NOT NULL,
  url text NOT NULL,
  updated_by varchar REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

UPDATE email_templates
SET code = 'SYSTEM_MIAM_INVITE', kind = 'system'
WHERE code = 'M1' AND guidance = '' AND NOT EXISTS (SELECT 1 FROM email_templates WHERE code = 'SYSTEM_MIAM_INVITE');
UPDATE email_templates SET code = 'LEGACY_M1_' || id, kind = 'system' WHERE code = 'M1' AND guidance = '';
UPDATE email_templates SET kind = 'system' WHERE code = 'PORTAL_INVITE';
UPDATE email_templates SET required_variables = '["client_first_name","portal_link"]'::jsonb WHERE code = 'PORTAL_INVITE';
UPDATE email_templates SET required_variables = '["client_first_name","booking_link"]'::jsonb WHERE code = 'SYSTEM_MIAM_INVITE';
UPDATE email_templates SET content_override = true WHERE kind = 'system' AND updated_by IS NOT NULL;
