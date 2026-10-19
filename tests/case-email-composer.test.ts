import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("case email composer has persistent templates, messages, and protected attachments", () => {
  const schema = read("../shared/schema.ts");
  assert.match(schema, /emailTemplates = pgTable\("email_templates"/);
  assert.match(schema, /caseEmailMessages = pgTable\("case_email_messages"/);
  assert.match(schema, /caseEmailAttachments = pgTable\("case_email_attachments"/);
  assert.match(schema, /templateId: varchar\("template_id"\)/);
  assert.match(schema, /bodyHtml: text\("body_html"\)/);
  assert.match(schema, /documentId: varchar\("document_id"\)/);
});

test("email templates and sending are restricted to admins and registered", () => {
  const routes = read("../server/routes/case-email.routes.ts");
  const index = read("../server/routes/index.ts");
  assert.match(routes, /isEmailAdmin/);
  assert.match(routes, /user\.role === "superadmin" \|\| user\.role === "subadmin"/);
  assert.match(routes, /\/api\/email-templates/);
  assert.match(routes, /\/api\/cases\/:caseId\/email-compose-context/);
  assert.match(routes, /\/api\/cases\/:caseId\/emails/);
  assert.match(index, /caseEmailRoutes/);
});

test("email authentication applies only to email APIs, not the SPA router mount", () => {
  const routes = read("../server/routes/case-email.routes.ts");
  assert.doesNotMatch(routes, /router\.use\(requireAuth\)/);
  assert.match(routes, /router\.get\("\/api\/email-templates", requireAuth,/);
  assert.match(routes, /router\.post\("\/api\/email-templates", requireAuth,/);
  assert.match(routes, /router\.patch\("\/api\/email-templates\/:id", requireAuth,/);
  assert.match(routes, /router\.get\("\/api\/cases\/:caseId\/email-compose-context", requireAuth,/);
  assert.match(routes, /router\.post\("\/api\/cases\/:caseId\/emails", requireAuth,/);
});

test("template service seeds portal and MIAM defaults, keeps send snapshots, and supports booking links", () => {
  const service = read("../server/services/case-email.service.ts");
  assert.match(service, /PORTAL_INVITE_TEMPLATE_CODE/);
  assert.match(service, /MIAM_INVITE_TEMPLATE_CODE/);
  assert.match(service, /SYSTEM_MIAM_INVITE/);
  assert.match(read("../server/services/email-template-catalog.ts"), /Invitation to attend a MIAM/);
  assert.match(service, /sendEmailWithAttachments/);
  assert.match(service, /bookingLink/);
  assert.match(service, /caseCommunicationLogService\.record/);
});

test("successful case email sends create one linked Recent Activity entry and refresh the timeline", () => {
  const service = read("../server/services/case-email.service.ts");
  const composer = read("../client/src/components/cases/case-email-composer.tsx");

  assert.match(service, /import \{ caseActivityService, staffActor \} from "\.\/case-activity\.service"/);
  assert.match(service, /if \(sent\) \{[\s\S]*?caseActivityService\.log\([\s\S]*?type: "email_sent"[\s\S]*?relatedEntityId: log\.id[\s\S]*?relatedEntityType: "case_communication"[\s\S]*?actor: staffActor\(actor\)/);
  assert.match(service, /metadata: JSON\.stringify\(\{ recipientName: allowed\.name, recipientEmail: allowed\.email, subject, deliveryStatus: "sent", communicationLogId: log\.id \}\)/);
  assert.match(composer, /if \(result\.sent\) queryClient\.invalidateQueries\(\{ queryKey: \["\/api\/cases", caseId, "activities"\], exact: false \}\)/);
});

test("MIAM compose flow prefers the canonical system invite and E1 exposes suggested availability", () => {
  const composer = read("../client/src/components/cases/case-email-composer.tsx");
  const service = read("../server/services/case-email.service.ts");
  assert.match(composer, /SYSTEM_MIAM_INVITE"\) \|\| templates\.find\(t => t\.code === "M1"\)/);
  assert.match(composer, /Use suggested MIAM availability/);
  assert.match(service, /availabilityPreview/);
});

test("templates menu and case composer are present with admin-only entry points", () => {
  const templates = read("../client/src/pages/email-templates.tsx");
  const sidebar = read("../client/src/components/layout/app-sidebar.tsx");
  const layout = read("../client/src/components/layout/dashboard-layout.tsx");
  const casePage = read("../client/src/pages/case-detail.tsx");
  const composer = read("../client/src/components/cases/case-email-composer.tsx");
  assert.match(templates, /Email templates/);
  assert.match(sidebar, /Email templates/);
  assert.match(layout, /email-templates/);
  assert.match(casePage, /CaseEmailComposer/);
  assert.match(casePage, /New email/);
  assert.match(composer, /button-compose-case-email/);
});

test("case email composer only blocks blank required variables", () => {
  const composer = read("../client/src/components/cases/case-email-composer.tsx");
  assert.match(composer, /requiredVariables: string\[\]/);
  assert.match(composer, /requiredFields/);
  assert.match(composer, /requiredFields\.some\(key => !variables\[key\]\?\.trim\(\)\)/);
  assert.doesNotMatch(composer, /fields\.some\(key => !variables\[key\]\?\.trim\(\)\)/);
});

test("case email send blanks optional variables while preserving required-variable safeguards", () => {
  const service = read("../server/services/case-email.service.ts");
  const templateService = read("../server/services/email-template.service.ts");
  assert.match(service, /allowBlankOptionalVariables: true/);
  assert.match(templateService, /requiredVariables/);
  assert.match(templateService, /allowBlankOptionalVariables/);
});

test("case email attachment picker supports multiple queued files and removal", async () => {
  const {
    CaseEmailAttachmentPicker,
    appendQueuedAttachments,
    removeQueuedAttachment,
  } = await import("../client/src/components/cases/case-email-attachments");
  const first = { name: "first.pdf" };
  const second = { name: "second.docx" };

  const selection = appendQueuedAttachments([first], [second], 2);
  assert.deepEqual(selection, { files: [first, second], error: null });
  assert.deepEqual(removeQueuedAttachment(selection.files, 0), [second]);

  const markup = renderToStaticMarkup(React.createElement(CaseEmailAttachmentPicker, {
    files: selection.files,
    attachmentCount: 4,
    error: null,
    disabled: true,
    onFilesSelected: () => undefined,
    onRemove: () => undefined,
  }));
  assert.match(markup, /type="file"/);
  assert.match(markup, /multiple=""/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /first\.pdf/);
  assert.match(markup, /second\.docx/);
  assert.match(markup, /Remove first\.pdf/);
  assert.match(markup, /4 of 10 attachments selected/);
});

test("case email attachment selection rejects more than ten combined attachments", async () => {
  const { appendQueuedAttachments, CASE_EMAIL_ATTACHMENT_LIMIT } = await import("../client/src/components/cases/case-email-attachments");
  const current = Array.from({ length: 2 }, (_, index) => ({ name: `queued-${index}.pdf` }));
  const incoming = [{ name: "too-many.pdf" }];

  const selection = appendQueuedAttachments(current, incoming, 8);

  assert.equal(CASE_EMAIL_ATTACHMENT_LIMIT, 10);
  assert.deepEqual(selection.files, current);
  assert.match(selection.error || "", /up to 10 attachments/i);
});

test("case email uploads every queued file and combines new and existing document IDs", async () => {
  const { uploadQueuedAttachments } = await import("../client/src/components/cases/case-email-attachments");
  const uploadedNames: string[] = [];
  const files = [{ name: "first.pdf" }, { name: "second.docx" }];

  const result = await uploadQueuedAttachments(["existing-1"], files, async (file) => {
    uploadedNames.push(file.name);
    return `uploaded-${file.name}`;
  });

  assert.deepEqual(uploadedNames, ["first.pdf", "second.docx"]);
  assert.deepEqual(result, {
    documentIds: ["existing-1", "uploaded-first.pdf", "uploaded-second.docx"],
    failedFiles: [],
    errors: [],
  });
});

test("case email validates the combined attachment limit before uploading", async () => {
  const { uploadQueuedAttachments } = await import("../client/src/components/cases/case-email-attachments");
  let uploadCount = 0;

  await assert.rejects(
    uploadQueuedAttachments(
      Array.from({ length: 9 }, (_, index) => `existing-${index}`),
      [{ name: "first.pdf" }, { name: "second.pdf" }],
      async () => {
        uploadCount += 1;
        return "unexpected";
      },
    ),
    /up to 10 attachments/i,
  );
  assert.equal(uploadCount, 0);
});

test("case email waits for every upload and preserves successful IDs when another upload fails", async () => {
  const { uploadQueuedAttachments } = await import("../client/src/components/cases/case-email-attachments");
  let finishDeferredUpload!: (id: string) => void;
  const deferredUpload = new Promise<string>((resolve) => { finishDeferredUpload = resolve; });
  let settled = false;

  const resultPromise = uploadQueuedAttachments(
    ["existing-1"],
    [{ name: "fails.pdf" }, { name: "finishes-later.pdf" }],
    async (file) => {
      if (file.name === "fails.pdf") throw new Error("Upload failed");
      return deferredUpload;
    },
  ).then((result) => { settled = true; return result; });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false);
  finishDeferredUpload("uploaded-later");

  assert.deepEqual(await resultPromise, {
    documentIds: ["existing-1", "uploaded-later"],
    failedFiles: [{ name: "fails.pdf" }],
    errors: [new Error("Upload failed")],
  });
});

test("case email retains attachment IDs after delivery failure and clears them after success", async () => {
  const { caseEmailAttachmentStateAfterSend } = await import("../client/src/components/cases/case-email-attachments");
  const documentIds = ["existing-1", "uploaded-1"];

  assert.deepEqual(caseEmailAttachmentStateAfterSend(false, documentIds), {
    documentIds,
    shouldClose: false,
  });
  assert.deepEqual(caseEmailAttachmentStateAfterSend(true, documentIds), {
    documentIds: [],
    shouldClose: true,
  });
});
