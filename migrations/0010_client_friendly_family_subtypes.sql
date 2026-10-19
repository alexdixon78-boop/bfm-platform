UPDATE "cases"
SET "family_sub_type" = CASE "family_sub_type"
  WHEN 'Child arrangements' THEN 'Child arrangements (CA)'
  WHEN 'Finance & Property' THEN 'Property & finance (PF)'
  WHEN 'Property and finances (P&F)' THEN 'Property & finance (PF)'
  WHEN 'All Issues Mediation' THEN 'All issues mediation (AIM)'
  WHEN 'AIM (All Issues Mediation)' THEN 'All issues mediation (AIM)'
  ELSE "family_sub_type"
END
WHERE "family_sub_type" IN (
  'Child arrangements',
  'Finance & Property',
  'Property and finances (P&F)',
  'All Issues Mediation',
  'AIM (All Issues Mediation)'
);
--> statement-breakpoint
UPDATE "demographic_data"
SET "family_case_subtype" = CASE "family_case_subtype"
  WHEN 'Child arrangements' THEN 'Child arrangements (CA)'
  WHEN 'Finance & Property' THEN 'Property & finance (PF)'
  WHEN 'Property and finances (P&F)' THEN 'Property & finance (PF)'
  WHEN 'All Issues Mediation' THEN 'All issues mediation (AIM)'
  WHEN 'AIM (All Issues Mediation)' THEN 'All issues mediation (AIM)'
  ELSE "family_case_subtype"
END
WHERE "family_case_subtype" IN (
  'Child arrangements',
  'Finance & Property',
  'Property and finances (P&F)',
  'All Issues Mediation',
  'AIM (All Issues Mediation)'
);
--> statement-breakpoint
UPDATE "miam_records"
SET "case_type" = CASE "case_type"
  WHEN 'Child arrangements' THEN 'Child arrangements (CA)'
  WHEN 'Finance & Property' THEN 'Property & finance (PF)'
  WHEN 'Property and finances (P&F)' THEN 'Property & finance (PF)'
  WHEN 'All Issues Mediation' THEN 'All issues mediation (AIM)'
  WHEN 'AIM (All Issues Mediation)' THEN 'All issues mediation (AIM)'
  ELSE "case_type"
END
WHERE "case_type" IN (
  'Child arrangements',
  'Finance & Property',
  'Property and finances (P&F)',
  'All Issues Mediation',
  'AIM (All Issues Mediation)'
);
