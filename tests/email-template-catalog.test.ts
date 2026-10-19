import test from "node:test";
import assert from "node:assert/strict";
import { docxTemplateCatalog } from "../server/services/email-template-catalog";

test("review document catalog contains 66 distinct drafts and 12 calendar descriptions", () => {
  assert.equal(docxTemplateCatalog.length, 66);
  assert.equal(new Set(docxTemplateCatalog.map(template => template.code)).size, 66);
  assert.equal(docxTemplateCatalog.filter(template => template.kind === "calendar").length, 12);
  assert.ok(docxTemplateCatalog.every(template => template.bodyHtml && template.status === "draft"));
  assert.ok(docxTemplateCatalog.find(template => template.code === "E1")?.bodyHtml.includes("Many thanks for reaching out"));
});

test("E1 uses a friendly required personalisation variable", () => {
  const template = docxTemplateCatalog.find(item => item.code === "E1");
  assert.ok(template);
  assert.match(template.bodyHtml, /\{\{personalised_response\}\}/);
  assert.deepEqual(template.variables.find(variable => variable.key === "personalised_response"), {
    key: "personalised_response",
    label: "Personalised response",
  });
  assert.doesNotMatch(template.bodyHtml, /&#x27;|personalise_this_to_respond_to_the_client_x27_s_enquiry/);
});

test("E1 has separate times for every suggested date and M1 includes a secure booking action", () => {
  const e1 = docxTemplateCatalog.find(item => item.code === "E1");
  const m1 = docxTemplateCatalog.find(item => item.code === "M1");
  assert.match(e1?.bodyHtml || "", /\{\{date_1\}\}: \{\{times_1\}\}/);
  assert.match(e1?.bodyHtml || "", /\{\{date_3\}\}: \{\{times_3\}\}/);
  assert.ok(e1?.variables.some(variable => variable.key === "times_2"));
  assert.match(m1?.bodyHtml || "", /\{\{booking_link\}\}/);
});
