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
  );
