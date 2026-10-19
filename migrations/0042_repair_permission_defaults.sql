-- Repair the permission rows omitted by the legacy 96-row seed. The normal
-- bootstrap now inserts every missing canonical default with the same
-- conflict-safe behavior, so configured values are never overwritten.
INSERT INTO permissions (role, section, can_view, can_edit)
VALUES
  ('superadmin', 'court_forms', true, true),
  ('subadmin', 'court_forms', true, true),
  ('staff', 'court_forms', false, false),
  ('mediator', 'court_forms', true, true),
  ('client', 'court_forms', false, false),
  ('contractor', 'court_forms', false, false)
ON CONFLICT (role, section) DO NOTHING;
