ALTER TABLE mediator_service_types
  ADD COLUMN IF NOT EXISTS mediation_role_qualification TEXT NOT NULL DEFAULT 'unclassified';

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
