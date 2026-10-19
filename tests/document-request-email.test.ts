import { test } from "node:test";
import assert from "node:assert/strict";

test("document request email names the evidence and links to the exact portal request", async () => {
  const module = await import("../server/services/document-request-email.service").catch(() => null);
  assert.ok(module, "document request email service must exist");
  const rendered = module.buildDocumentRequestEmail({
    clientName: "Alex <Client>",
    caseRef: "BFM-1",
    documentName: "Bank statement",
    instructions: "Include <all> pages",
    requestUrl: "https://example.test/cases/case-1?tab=documents&documentRequestId=request-1",
  });
  assert.equal(rendered.subject, "Document requested — BFM-1");
  assert.match(rendered.html, /Bank statement/);
  assert.match(rendered.html, /Include &lt;all&gt; pages/);
  assert.match(rendered.html, /documentRequestId=request-1/);
  assert.doesNotMatch(rendered.html, /Alex <Client>/);
});
