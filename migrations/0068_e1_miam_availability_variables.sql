UPDATE email_templates
SET
  body_html = replace(
    replace(
      replace(body_html, '{{date_1}}: {{times}}', '{{date_1}}: {{times_1}}'),
      '{{date_2}}: {{times}}', '{{date_2}}: {{times_2}}'
    ),
    '{{date_3}}: {{times}}', '{{date_3}}: {{times_3}}'
  ),
  variables = '[
    {"key":"case_ref","label":"Case ref"},
    {"key":"client_first_name","label":"Client first name"},
    {"key":"personalised_response","label":"Personalised response"},
    {"key":"date_1","label":"Date 1"},
    {"key":"times_1","label":"Times 1"},
    {"key":"date_2","label":"Date 2"},
    {"key":"times_2","label":"Times 2"},
    {"key":"date_3","label":"Date 3"},
    {"key":"times_3","label":"Times 3"}
  ]'::jsonb,
  updated_at = NOW()
WHERE code = 'E1'
  AND content_override = false
  AND body_html LIKE '%{{date_1}}: {{times}}%';

UPDATE email_templates
SET body_html = body_html || '<p><a href="{{booking_link}}">Book your MIAM appointment</a></p>', updated_at = NOW()
WHERE code = 'M1'
  AND content_override = false
  AND body_html NOT LIKE '%{{booking_link}}%';
