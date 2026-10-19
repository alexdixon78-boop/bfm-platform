UPDATE email_templates
SET
  subject = replace(subject, '{{personalise_this_to_respond_to_the_client_x27_s_enquiry}}', '{{personalised_response}}'),
  body_html = replace(body_html, '{{personalise_this_to_respond_to_the_client_x27_s_enquiry}}', '{{personalised_response}}'),
  variables = (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN variable->>'key' = 'personalise_this_to_respond_to_the_client_x27_s_enquiry'
          THEN jsonb_build_object('key', 'personalised_response', 'label', 'Personalised response')
        ELSE variable
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(variables) AS variable
  )
WHERE code = 'E1'
  AND (
    subject LIKE '%personalise_this_to_respond_to_the_client_x27_s_enquiry%'
    OR body_html LIKE '%personalise_this_to_respond_to_the_client_x27_s_enquiry%'
    OR variables @> '[{"key":"personalise_this_to_respond_to_the_client_x27_s_enquiry"}]'::jsonb
  );
