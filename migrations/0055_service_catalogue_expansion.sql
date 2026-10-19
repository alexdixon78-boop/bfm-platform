CREATE TABLE IF NOT EXISTS service_type_deletions (
  name TEXT PRIMARY KEY,
  deleted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE service_types ADD COLUMN IF NOT EXISTS baseline_service_name TEXT;
UPDATE service_types
SET baseline_service_name = name
WHERE baseline_service_name IS NULL;

INSERT INTO service_types (name, description, category, price_info, online_payment_enabled, payment_amount_pence, payment_currency, is_active, sort_order, baseline_service_name)
SELECT seed.name, seed.description, seed.category, seed.price_info, seed.online_payment_enabled, seed.payment_amount_pence, seed.payment_currency, seed.is_active, seed.sort_order, seed.name
FROM (
  VALUES
    ('Mediation Child only', 'Mediation focused on child arrangements and parenting matters', 'Mediation', 'Contact for pricing', false, NULL::integer, 'gbp', true, 6),
    ('Mediation AIM', 'All Issues Mediation covering child arrangements and property and finance matters', 'Mediation', 'Contact for pricing', false, NULL::integer, 'gbp', true, 7),
    ('Mediation P&F', 'Mediation focused on property and financial matters', 'Mediation', 'Contact for pricing', false, NULL::integer, 'gbp', true, 8),
    ('Child Inclusive Parent Prep session', 'Parent preparation session before child inclusive mediation', 'Mediation', 'Contact for pricing', false, NULL::integer, 'gbp', true, 9),
    ('Child Inclusive Mediation session', 'Child inclusive mediation session with a trained mediator', 'Mediation', 'Contact for pricing', false, NULL::integer, 'gbp', true, 10),
    ('Open Financial Statement (OFS)', 'Formal statement recording the financial information disclosed during mediation', 'Court & Documentation', 'Contact for pricing', false, NULL::integer, 'gbp', true, 11),
    ('Consent Order Essential Package', 'Essential support to prepare a consent order from a mediated agreement', 'Packages', 'Contact for pricing', false, NULL::integer, 'gbp', true, 13),
    ('Consent Order Supported Package', 'Supported consent order package with additional guidance through the process', 'Packages', 'Contact for pricing', false, NULL::integer, 'gbp', true, 14)
) AS seed(name, description, category, price_info, online_payment_enabled, payment_amount_pence, payment_currency, is_active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM service_type_deletions WHERE service_type_deletions.name = seed.name)
  AND NOT EXISTS (SELECT 1 FROM service_types WHERE service_types.baseline_service_name = seed.name)
ON CONFLICT (name) DO NOTHING;
