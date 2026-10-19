import test from "node:test";
import assert from "node:assert/strict";
import { renderEmailHtml, sanitizeEmailHtml } from "../server/services/email-template-html";

test("email HTML sanitizer retains formatting and tokens but removes active content", () => {
  const html = '<p><strong>Hello {{client_first_name}}</strong><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">link</a></p>';
  const cleaned = sanitizeEmailHtml(html);
  assert.match(cleaned, /<strong>Hello \{\{client_first_name\}\}<\/strong>/);
  assert.doesNotMatch(cleaned, /script|onclick|javascript:/i);
  assert.match(sanitizeEmailHtml('<a href="{{link_terms}}">Terms</a>'), /href="\{\{link_terms\}\}"/);
});

test("rendering keeps safe generated HTML fragments and escapes plain names", () => {
  const result = renderEmailHtml("<p>Hello {{name}}</p>{{detail}}", { name: "<Jane>", detail: "<p><strong>Ready</strong></p><script>alert(1)</script>" });
  assert.match(result.output, /&lt;Jane&gt;/);
  assert.match(result.output, /<strong>Ready<\/strong>/);
  assert.doesNotMatch(result.output, /script|alert\(1\)/);
});
