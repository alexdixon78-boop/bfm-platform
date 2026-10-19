ALTER TABLE mediator_profiles
  ADD COLUMN IF NOT EXISTS mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified';

UPDATE mediator_profiles mp
SET mediation_role_qualification = 'lead'
FROM users u
WHERE mp.user_id = u.id
  AND mp.mediation_role_qualification = 'unclassified'
  AND u.role = 'mediator'
  AND u.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM mediator_service_approvals msa
    JOIN service_types st ON st.id = msa.service_type_id
    WHERE msa.mediator_id = mp.user_id
      AND st.name = 'Mediation Sessions'
      AND st.is_active = true
      AND msa.status = 'approved'
      AND msa.expired_at IS NULL
      AND (
        NULLIF(msa.expiry_date, '') IS NULL
        OR CASE
          WHEN msa.expiry_date ~ '^\d{4}-\d{2}-\d{2}$' THEN msa.expiry_date::date >= CURRENT_DATE
          ELSE false
        END
      )
  );
