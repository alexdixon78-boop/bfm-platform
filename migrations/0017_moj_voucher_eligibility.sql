ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "moj_voucher_eligible" boolean NOT NULL DEFAULT false;

UPDATE "cases"
SET "moj_voucher_eligible" = (
  COALESCE("mediation_category", 'Family') = 'Family'
  AND COALESCE("family_sub_type", "issue_type") IN ('Child arrangements (CA)', 'All issues mediation (AIM)')
);

UPDATE "mediation_session_proposals" proposal
SET "voucher_form_required" = false
FROM "cases" c
WHERE proposal."case_id" = c."id"
  AND proposal."voucher_form_required" = true
  AND NOT (
    COALESCE(c."mediation_category", 'Family') = 'Family'
    AND COALESCE(c."family_sub_type", c."issue_type") IN ('Child arrangements (CA)', 'All issues mediation (AIM)')
  );

CREATE INDEX IF NOT EXISTS "cases_moj_voucher_eligible_idx"
  ON "cases" ("moj_voucher_eligible");
